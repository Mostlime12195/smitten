// The scene editor: paints tile layers with stamps from a scene's tilesets
// and places the project's objects (objects/*.lua) on object layers, drawn
// with their sprites. Opens .scene.json and .map.json files (the same format,
// docs/reference.md "Maps" and docs/objects-and-scenes.md "Scenes").

import {
  assetName, basename, formatValue, isScenePath, joinPath, mapText, newTilesetText, parseMap, parseTileset, parseValue,
  pngSize, relativePath, transparentPng,
} from './model.js';
import {
  History, Viewport, decodeImage, drawChecker, drawGrid, icon, iconButton, isTyping, propertyEditor,
  themeColors, typeColor,
} from './widgets.js';
import { ObjectTypes, drawThumbnail } from './objects.js';

const TILE_TOOLS = ['brush', 'eraser', 'rect', 'fill', 'picker'];
const OBJECT_TOOLS = ['select', 'object'];

// `more`: in the "…" menu instead of the toolbar (the shortcut still works).
const TOOLS = [
  { id: 'brush', icon: 'brush', label: 'Brush', key: 'B', hint: 'Paint the selected tiles. Right-drag erases, Alt+click picks a tile from the scene.' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E', hint: 'Erase tiles.' },
  { id: 'rect', icon: 'rectFill', label: 'Rectangle', key: 'U', hint: 'Drag to fill a rectangle with the selected tiles. Right-drag erases.' },
  { id: 'fill', icon: 'bucket', label: 'Fill', key: 'G', hint: 'Fill the connected area of the same tile. Right-click erases it.' },
  { id: 'picker', icon: 'picker', label: 'Pick tiles from the scene', key: 'I', hint: 'Click a tile in the scene, or drag over several, to paint with them.', more: true },
  { id: 'select', icon: 'pointer', label: 'Select and move', key: 'V', hint: 'Click an object to edit it, drag to move it (Alt: off the grid). Arrows nudge, Delete removes.' },
  { id: 'object', icon: 'placeObject', label: 'Place objects', key: 'O', hint: 'Click to place the chosen object (Alt: off the grid).' },
];

const SHORTCUTS = [
  ['B / E / U / G / I', 'Brush, eraser, rectangle, fill, pick tiles'],
  ['V / O', 'Select and move, place objects'],
  ['Right-drag', 'Erase tiles'],
  ['Alt', 'Pick a tile (brush), or place and move objects off the grid'],
  ['Space+drag, middle-drag', 'Move around'],
  ['Mouse wheel, + / -', 'Zoom'],
  ['0', 'Fit the scene in view'],
  ['#', 'Show or hide the grid'],
  ['[ / ]', 'Previous or next tileset'],
  ['Arrows (Shift: a whole tile)', 'Nudge the selected object'],
  ['Delete', 'Delete the selected object'],
  ['Ctrl/⌘+D', 'Duplicate the selected object'],
  ['Ctrl/⌘+Z, Ctrl/⌘+Shift+Z', 'Undo, redo'],
  ['Esc', 'Deselect'],
];

export class MapEditor {
  constructor(host) {
    this.host = host;
    this.ui = host.ui;
    this.path = host.path;
    this.noun = isScenePath(this.path) ? 'scene' : 'map';
    this.Noun = this.noun === 'scene' ? 'Scene' : 'Map';
    this.tilesets = []; // loaded tileset entries, in the map's order
    this.cache = new Map(); // tileset path -> entry (kept while the editor is open)
    this.images = new Map(); // image path -> {bytes, bitmap, promise}
    this.tool = 'brush';
    this.lastTileLayer = 0;
    this.lastObjectLayer = -1;
    this.activeLayer = 0;
    this.activeTileset = 0;
    this.stamp = { w: 1, h: 1, tiles: Int32Array.of(0) };
    this.paletteSel = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.selected = null; // selected object id
    this.hoverObject = null; // id of the object under the pointer
    this.objectType = '';
    this.showGrid = true;
    this.hover = null; // {x, y} world pixels
    this.altDown = false;
    this.drag = null;
    this.error = null;
    this.history = new History(() => this.updateToolbar());
    this.types = new ObjectTypes(host, (path, bytes) => this.image(path, bytes));

    this.build();
    this.load();
  }

  // -------------------------------------------------------------------------
  // Loading

  load() {
    try {
      this.map = parseMap(this.host.read(this.path), this.path);
      this.error = null;
    } catch (e) {
      this.map = null;
      this.error = e.message;
    }
    if (this.map) {
      this.activeLayer = Math.max(0, this.map.layers.findIndex((l) => l.type === 'tiles'));
      this.lastTileLayer = this.activeLayer;
      this.lastObjectLayer = this.map.layers.findIndex((l) => l.type === 'objects');
      if (!this.objectType) {
        const used = this.map.layers.flatMap((l) => (l.objects || []).map((o) => o.type)).filter(Boolean);
        this.objectType = this.types.list()[0]?.type || used[0] || '';
      }
      this.syncTilesets();
      if (this.tilesets[0]?.count) this.setStampFromPalette(0, 0, 0, 0, 0);
    }
    this.selected = null;
    this.dirty = false;
    this.history.clear();
    this.vp.fitted = false;
    this.vp.fit();
    this.refresh();
  }

  /** Load or reuse the tileset entries the map lists, and number their tiles. */
  syncTilesets() {
    let first = 0;
    this.tilesets = this.map.tilesets.map((rel) => {
      const path = joinPath(this.path, rel);
      let entry = this.cache.get(path);
      if (!entry) {
        entry = this.loadTileset(path);
        this.cache.set(path, entry);
      }
      entry.rel = rel;
      entry.first = first;
      first += entry.count;
      return entry;
    });
    this.tileCount = first;
    // Tile number -> tileset index, for drawing.
    this.owner = new Int16Array(first);
    this.tilesets.forEach((t, i) => this.owner.fill(i, t.first, t.first + t.count));
    this.activeTileset = Math.min(this.activeTileset, Math.max(0, this.tilesets.length - 1));
  }

  loadTileset(path) {
    const entry = { path, rel: '', ts: null, error: null, imagePath: null, image: null, imgW: 0, imgH: 0, columns: 0, rows: 0, count: 0, first: 0 };
    try {
      entry.ts = parseTileset(this.host.read(path), path);
    } catch (e) {
      entry.error = e.message;
      return entry;
    }
    const ts = entry.ts;
    if (!ts.image) {
      entry.error = `${basename(path)} has no image`;
      return entry;
    }
    entry.imagePath = joinPath(path, ts.image);
    const bytes = this.host.read(entry.imagePath);
    const size = pngSize(bytes);
    if (!size) {
      entry.error = bytes === undefined ? `Its image ${entry.imagePath} doesn't exist` : `Its image ${entry.imagePath} isn't a PNG`;
      return entry;
    }
    entry.imgW = size.width;
    entry.imgH = size.height;
    entry.columns = Math.floor(size.width / ts.tileWidth);
    entry.rows = Math.floor(size.height / ts.tileHeight);
    entry.count = entry.columns * entry.rows;
    entry.image = this.image(entry.imagePath, bytes);
    return entry;
  }

  /** The decoded image for a path (decoding starts on first use; redraws when ready). */
  image(path, bytes) {
    let img = this.images.get(path);
    if (!img || img.bytes !== bytes) {
      img = { bytes, bitmap: null };
      this.images.set(path, img);
      decodeImage(bytes).then((bitmap) => {
        if (this.images.get(path) !== img) return;
        img.bitmap = bitmap;
        this.refresh();
      });
    }
    return img;
  }

  /** A tileset (or its image) changed: reload it, keeping tiles pointing at the same tileset tiles. */
  reloadTileset(path) {
    const old = this.tilesets.map((t) => ({ first: t.first, count: t.count, path: t.path }));
    this.cache.delete(path);
    for (const [p, e] of this.cache) if (e.imagePath === path) this.cache.delete(p);
    this.syncTilesets();
    this.renumber(old);
    this.refresh();
  }

  /**
   * Tile numbers depend on how many tiles the tilesets before have. When that
   * changes (an image was resized, a tileset removed), move every tile so it
   * keeps showing the same tile of the same tileset.
   */
  renumber(old, removed = null) {
    const changed = old.length !== this.tilesets.length || old.some((o, i) => o.first !== this.tilesets[i].first || o.count !== this.tilesets[i].count);
    if (!changed && !removed) return false;
    const byPath = new Map(this.tilesets.map((t) => [t.path, t]));
    const remap = (g) => {
      if (g < 0) return g;
      const o = old.find((t) => g >= t.first && g < t.first + t.count);
      if (!o || o.path === removed) return -1;
      const now = byPath.get(o.path);
      const local = g - o.first;
      return now && local < now.count ? now.first + local : -1;
    };
    let any = false;
    for (const l of this.map.layers) {
      if (!l.data) continue;
      for (let i = 0; i < l.data.length; i++) {
        const g = l.data[i];
        const n = remap(g);
        if (n !== g) { l.data[i] = n; any = true; }
      }
    }
    this.stamp.tiles = this.stamp.tiles.map(remap);
    if (any && !removed) {
      // Undo steps hold the old numbers.
      this.history.clear();
      this.markDirty();
      this.host.toast(`${basename(this.path)}: a tileset's tile count changed, so its tiles were renumbered.`, { type: 'info' });
    }
    return any;
  }

  // -------------------------------------------------------------------------
  // Building the UI

  build() {
    const { h } = this.ui;
    this.toolButtons = new Map();
    const toolbar = h('div', { class: 'mt-toolbar', role: 'toolbar', 'aria-label': `${this.Noun} tools` });
    const group = (label, ids) => {
      const g = h('div', { class: 'mt-group', role: 'group', 'aria-label': label }, h('span', { class: 'mt-label' }, label));
      for (const id of ids) {
        const t = TOOLS.find((x) => x.id === id);
        const b = iconButton(this.ui, { icon: t.icon, title: `${t.label} (${t.key})`, onclick: () => this.setTool(t.id), pressed: false });
        this.toolButtons.set(t.id, b);
        g.append(b);
      }
      return g;
    };
    this.undoBtn = iconButton(this.ui, { icon: 'undo', title: `Undo (${this.ui.modKey}+Z)`, onclick: () => this.undo() });
    this.redoBtn = iconButton(this.ui, { icon: 'redo', title: `Redo (${this.ui.modKey}+Shift+Z)`, onclick: () => this.redo() });
    this.zoomLabel = h('button', {
      type: 'button', class: 'btn ghost small mt-zoom', onclick: () => this.vp.fit(),
      title: 'Zoom. Click to fit the scene (0); scroll the mouse wheel to zoom in and out (+ / -).',
    }, '100%');
    toolbar.append(
      group('Tiles', ['brush', 'eraser', 'rect', 'fill']),
      h('div', { class: 'mt-sep' }),
      group('Objects', ['select', 'object']),
      h('div', { class: 'mt-sep' }), this.undoBtn, this.redoBtn,
      h('div', { class: 'spacer' }),
      this.zoomLabel,
      h('button', {
        type: 'button', class: 'btn ghost small', onclick: () => this.mapDialog(),
        title: `${this.Noun} size, tile size, background color and properties`,
      }, icon(this.ui, 'sliders', 14), this.Noun),
      iconButton(this.ui, { icon: 'more', title: 'More tools and view options', onclick: (e) => this.moreMenu(e.currentTarget) }),
    );

    const viewEl = h('div', { class: 'mt-viewport tool-paint' });
    this.viewEl = viewEl;
    this.emptyEl = h('div', { class: 'mt-empty', hidden: true });
    viewEl.append(this.emptyEl);
    this.vp = new Viewport(viewEl, {
      draw: (ctx, vp) => this.draw(ctx, vp),
      onPointer: (type, e, w) => this.pointer(type, e, w),
      contentSize: () => (this.map ? { width: this.map.width * this.map.tileWidth, height: this.map.height * this.map.tileHeight } : { width: 0, height: 0 }),
      onZoom: (z) => { this.zoomLabel.textContent = `${Math.round(z * 100)}%`; },
    });

    this.statusPos = h('span');
    this.statusTile = h('span');
    this.statusHint = h('span', { class: 'mt-hint' });
    const status = h('div', { class: 'mt-status' }, this.statusPos, this.statusTile, this.statusHint);

    this.side = h('div', { class: 'mt-side' });
    this.tilesetSection = h('div', { class: 'mt-section' });
    this.typesSection = h('div', { class: 'mt-section' });
    this.objectSection = h('div', { class: 'mt-section' });
    this.layerSection = h('div', { class: 'mt-section mt-section-end' });
    this.side.append(this.tilesetSection, this.typesSection, this.objectSection, this.layerSection);

    this.paletteCanvas = h('canvas');
    this.paletteBox = h('div', { class: 'mt-palette' }, this.paletteCanvas);
    this.paletteInfo = h('div', { class: 'mt-palette-info' });
    this.paletteCanvas.addEventListener('pointerdown', (e) => this.palettePointer('down', e));
    this.paletteCanvas.addEventListener('pointermove', (e) => this.palettePointer('move', e));
    this.paletteCanvas.addEventListener('pointerup', (e) => this.palettePointer('up', e));
    this.paletteCanvas.addEventListener('pointerleave', () => { this.paletteHover = null; this.drawPalette(); });

    this.element = h('div', { class: 'mt-root', tabindex: '0' }, toolbar, viewEl, status, this.side);
    // Enter in a side panel field commits it; give the keys back to the editor so shortcuts work again.
    this.side.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && document.activeElement !== e.target) this.focus();
    });
    this.element.addEventListener('keydown', (e) => {
      if (this.handleKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.onKeyUp = (e) => {
      if (e.code === 'Space' || e.type === 'blur') this.vp.setSpace(false);
      if ((e.key === 'Alt' || e.type === 'blur') && this.altDown) { this.altDown = false; this.vp.render(); }
    };
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onKeyUp);
    this.themeObserver = new MutationObserver(() => this.refresh());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
  }

  /** The "…" menu: tools and options that are used less often. */
  moreMenu(anchor) {
    const picker = TOOLS.find((t) => t.id === 'picker');
    this.ui.showMenu(anchor, [
      { label: picker.label, icon: this.tool === 'picker' ? 'check' : null, shortcut: picker.key, action: () => this.setTool('picker') },
      { label: 'Show the grid', icon: this.showGrid ? 'check' : null, shortcut: '#', action: () => this.toggleGrid() },
      '-',
      { label: 'Zoom in', icon: null, shortcut: '+', action: () => this.vp.step(1) },
      { label: 'Zoom out', icon: null, shortcut: '-', action: () => this.vp.step(-1) },
      { label: `Fit the ${this.noun}`, icon: 'maximize', shortcut: '0', action: () => this.vp.fit() },
      '-',
      { label: 'Add a tile layer', icon: 'grid', action: () => this.addLayer('tiles'), disabled: !this.map },
      { label: 'Add an object layer', icon: 'package', action: () => this.addLayer('objects'), disabled: !this.map },
      { label: `${this.Noun} properties…`, icon: 'sliders', action: () => this.mapDialog(), disabled: !this.map },
      '-',
      { label: 'Keyboard shortcuts', icon: 'keyboard', action: () => this.shortcutsDialog() },
    ]);
  }

  shortcutsDialog() {
    const { h } = this.ui;
    const body = h('div', { class: 'mt-dialog-grid mt-shortcuts' },
      SHORTCUTS.flatMap(([k, what]) => [h('kbd', {}, k), h('span', {}, what)]));
    this.ui.openDialog({ title: `${this.Noun} editor shortcuts`, body, actions: [{ label: 'Close', value: null, primary: true }] });
  }

  /** Redraw everything. */
  refresh() {
    this.renderSide();
    this.updateToolbar();
    this.updateEmpty();
    this.vp.render();
  }

  updateToolbar() {
    for (const [id, b] of this.toolButtons) b.setAttribute('aria-pressed', String(id === this.tool));
    this.undoBtn.disabled = !this.history.done.length;
    this.redoBtn.disabled = !this.history.undone.length;
    const t = TOOLS.find((x) => x.id === this.tool);
    let hint = t ? t.hint : '';
    if (this.tool === 'object') {
      hint = this.objectType
        ? `Click to place a ${this.objectType} (Alt: off the grid). Pick another object on the right.`
        : 'Pick an object on the right, then click to place it.';
    }
    this.statusHint.textContent = hint;
    this.viewEl.classList.toggle('tool-paint', TILE_TOOLS.includes(this.tool) || this.tool === 'object');
    this.viewEl.classList.toggle('tool-select', this.tool === 'select');
  }

  updateEmpty() {
    const { h } = this.ui;
    this.emptyEl.replaceChildren();
    let content = null;
    if (this.error) {
      content = h('div', {}, h('strong', {}, `This ${this.noun} can't be opened`), h('div', { class: 'mt-note warn' }, this.error));
    } else if (this.map && !this.tilesets.length && this.isBlank()) {
      // A new scene without tiles: say what to do first.
      content = h('div', { class: 'mt-empty-card' },
        h('strong', {}, `This ${this.noun} is empty`),
        h('p', { class: 'mt-note' }, 'Paint the ground with tiles from a tileset, and place objects like the player.'),
        h('div', {},
          h('button', { type: 'button', class: 'btn primary small', onclick: () => this.newTileset() }, this.ui.icon('plus', 14), 'Create a tileset'),
          h('button', { type: 'button', class: 'btn small', onclick: () => this.setTool('object') }, icon(this.ui, 'placeObject', 14), 'Place objects')));
    }
    this.emptyEl.hidden = !content;
    if (content) this.emptyEl.append(content);
  }

  /** Whether the map has no tiles and no objects. */
  isBlank() {
    return this.map.layers.every((l) => (l.data ? !l.data.some((g) => g >= 0) : !l.objects.length));
  }

  get layer() { return this.map?.layers[this.activeLayer] || null; }

  // -------------------------------------------------------------------------
  // Side panel

  /** The side panel shows what the active layer needs: tiles for a tile layer, objects for an object layer. */
  renderSide() {
    const objects = this.layer?.type === 'objects';
    this.tilesetSection.hidden = objects;
    this.typesSection.hidden = !objects;
    this.objectSection.hidden = !objects;
    if (objects) {
      this.tilesetSection.replaceChildren();
      this.renderTypesSection();
      this.renderObjectSection();
    } else {
      this.typesSection.replaceChildren();
      this.objectSection.replaceChildren();
      this.renderTilesetSection();
    }
    this.renderLayerSection();
  }

  sectionHead(title, ...buttons) {
    return this.ui.h('div', { class: 'mt-section-head' }, this.ui.h('span', {}, title), ...buttons);
  }

  renderTilesetSection() {
    const { h } = this.ui;
    const s = this.tilesetSection;
    s.replaceChildren();
    if (!this.map || this.layer?.type === 'objects') return;
    const ts = this.tilesets[this.activeTileset];
    const head = this.sectionHead('Tiles');
    if (ts) {
      head.append(
        iconButton(this.ui, {
          icon: 'pencil', small: true, title: `Draw these tiles (opens ${ts.imagePath || 'the image'} in the pixel editor)`,
          onclick: () => ts.imagePath && this.host.openFile(ts.imagePath),
        }),
        iconButton(this.ui, {
          icon: 'more', small: true, title: 'More tileset options',
          onclick: (e) => this.ui.showMenu(e.currentTarget, [
            { label: 'Add another tileset…', icon: 'plus', action: () => this.tilesetMenu(head) },
            { label: 'Tile properties (solid, …)', icon: 'settings', action: () => this.host.openFile(ts.path) },
            '-',
            { label: `Remove this tileset from the ${this.noun}`, icon: 'trash', danger: true, action: () => this.removeTileset(this.activeTileset) },
          ]),
        }),
      );
    }
    s.append(head);
    const body = h('div', { class: 'mt-section-body' });
    s.append(body);
    if (!this.tilesets.length) {
      const files = this.host.list();
      const choices = files.some((p) => /\.(tileset\.json|png)$/i.test(p));
      body.append(
        h('div', { class: 'mt-cta' },
          h('p', { class: 'mt-cta-title' }, 'No tiles yet'),
          h('p', { class: 'mt-note' }, 'A tileset is one picture with all your tiles in a grid (ground, walls, grass…). Make one, draw its tiles, then paint them here.'),
          h('button', { type: 'button', class: 'btn primary small', onclick: () => this.newTileset() }, this.ui.icon('plus', 14), 'Create a tileset'),
          choices ? h('button', { type: 'button', class: 'btn small', onclick: (e) => this.tilesetMenu(e.currentTarget) }, 'Use an existing one…') : null,
          h('p', { class: 'mt-note' }, 'You can place objects without tiles: pick Place objects (O) in the toolbar.')),
      );
      return;
    }
    if (this.tilesets.length > 1) {
      const select = h('select', { class: 'select small', 'aria-label': 'Tileset', title: 'Tileset ([ and ] switch)' },
        this.tilesets.map((t, i) => h('option', { value: String(i), selected: i === this.activeTileset }, assetName(t.path))));
      select.addEventListener('change', () => {
        this.activeTileset = Number(select.value);
        this.paletteSel = null;
        this.renderTilesetSection();
      });
      body.append(h('div', { class: 'mt-row' }, select));
    }
    if (ts.error) {
      body.append(h('p', { class: 'mt-note warn' }, ts.error));
      return;
    }
    body.append(this.paletteBox, this.paletteInfo);
    this.layoutPalette();
  }

  layoutPalette() {
    const ts = this.tilesets[this.activeTileset];
    if (!ts || ts.error) return;
    const avail = 280 - 24 - 2;
    let scale = Math.floor(avail / ts.imgW);
    scale = scale >= 1 ? Math.min(scale, 4) : avail / ts.imgW;
    this.paletteScale = scale;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(ts.imgW * scale);
    const hgt = Math.round(ts.imgH * scale);
    this.paletteCanvas.width = Math.round(w * dpr);
    this.paletteCanvas.height = Math.round(hgt * dpr);
    this.paletteCanvas.style.width = `${w}px`;
    this.paletteCanvas.style.height = `${hgt}px`;
    this.drawPalette();
  }

  drawPalette() {
    const ts = this.tilesets[this.activeTileset];
    const c = this.paletteCanvas;
    if (!ts || ts.error || !c.isConnected) return;
    const ctx = c.getContext('2d');
    const colors = themeColors(this.element);
    const dpr = window.devicePixelRatio || 1;
    const s = this.paletteScale * dpr;
    const { tileWidth: tw, tileHeight: th } = ts.ts;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    // Checkerboard per half tile.
    ctx.fillStyle = colors.checkB;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = colors.checkA;
    for (let y = 0; y < ts.imgH; y += th / 2) {
      for (let x = 0; x < ts.imgW; x += tw / 2) {
        if ((x / (tw / 2) + y / (th / 2)) & 1) ctx.fillRect(Math.round(x * s), Math.round(y * s), Math.ceil(tw / 2 * s), Math.ceil(th / 2 * s));
      }
    }
    ctx.imageSmoothingEnabled = false;
    if (ts.image?.bitmap) ctx.drawImage(ts.image.bitmap, 0, 0, ts.imgW * s, ts.imgH * s);
    // Grid.
    ctx.beginPath();
    for (let x = 1; x < ts.columns; x++) { const px = Math.round(x * tw * s) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, c.height); }
    for (let y = 1; y < ts.rows; y++) { const py = Math.round(y * th * s) + 0.5; ctx.moveTo(0, py); ctx.lineTo(c.width, py); }
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.stroke();
    const rect = (x0, y0, x1, y1, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      const off = width / 2;
      ctx.strokeRect(Math.round(x0 * tw * s) + off, Math.round(y0 * th * s) + off,
        Math.round((x1 - x0 + 1) * tw * s) - width, Math.round((y1 - y0 + 1) * th * s) - width);
    };
    if (this.paletteHover) rect(this.paletteHover.x, this.paletteHover.y, this.paletteHover.x, this.paletteHover.y, colors.muted, dpr);
    const sel = this.paletteSel;
    if (sel && sel.ts === this.activeTileset) {
      const x0 = Math.min(sel.x0, sel.x1); const x1 = Math.max(sel.x0, sel.x1);
      const y0 = Math.min(sel.y0, sel.y1); const y1 = Math.max(sel.y0, sel.y1);
      rect(x0, y0, x1, y1, colors.halo, 4 * dpr);
      rect(x0, y0, x1, y1, colors.accent, 2 * dpr);
    }
    this.updatePaletteInfo();
  }

  updatePaletteInfo() {
    const ts = this.tilesets[this.activeTileset];
    if (!ts || !this.paletteInfo) return;
    const hov = this.paletteHover;
    if (hov) {
      const local = hov.y * ts.columns + hov.x;
      const props = ts.ts.tiles.get(local) || {};
      const extra = Object.keys(props).filter((k) => k !== 'solid');
      this.paletteInfo.textContent = `Tile ${ts.first + local}${props.solid ? ' · solid' : ''}${extra.length ? ` · ${extra.join(', ')}` : ''}`;
    } else if (this.stamp.w * this.stamp.h > 1) {
      this.paletteInfo.textContent = `Stamp ${this.stamp.w} × ${this.stamp.h} tiles`;
    } else {
      const g = this.stamp.tiles[0];
      this.paletteInfo.textContent = g >= 0 ? `Tile ${g}` : '';
    }
  }

  palettePointer(type, e) {
    const ts = this.tilesets[this.activeTileset];
    if (!ts || ts.error) return;
    const r = this.paletteCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / this.paletteScale / ts.ts.tileWidth);
    const y = Math.floor((e.clientY - r.top) / this.paletteScale / ts.ts.tileHeight);
    const cx = Math.max(0, Math.min(ts.columns - 1, x));
    const cy = Math.max(0, Math.min(ts.rows - 1, y));
    if (type === 'down' && e.button === 0) {
      this.paletteCanvas.setPointerCapture(e.pointerId);
      this.paletteDrag = true;
      this.paletteSel = { ts: this.activeTileset, x0: cx, y0: cy, x1: cx, y1: cy };
    } else if (type === 'move') {
      this.paletteHover = x >= 0 && y >= 0 && x < ts.columns && y < ts.rows ? { x, y } : null;
      if (this.paletteDrag) { this.paletteSel.x1 = cx; this.paletteSel.y1 = cy; }
    } else if (type === 'up' && this.paletteDrag) {
      this.paletteDrag = false;
      const s = this.paletteSel;
      this.setStampFromPalette(this.activeTileset, s.x0, s.y0, s.x1, s.y1);
      if (!TILE_TOOLS.includes(this.tool) || this.tool === 'eraser' || this.tool === 'picker') this.setTool('brush');
    }
    this.drawPalette();
  }

  setStampFromPalette(index, ax, ay, bx, by) {
    const ts = this.tilesets[index];
    if (!ts || !ts.count) return;
    const x0 = Math.min(ax, bx); const x1 = Math.max(ax, bx);
    const y0 = Math.min(ay, by); const y1 = Math.max(ay, by);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const tiles = new Int32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = ts.first + (y0 + y) * ts.columns + x0 + x;
    this.stamp = { w, h, tiles };
    this.paletteSel = { ts: index, x0, y0, x1, y1 };
    this.vp.render();
  }

  /** After picking tiles from the map, show them in the palette if they form a rectangle there. */
  syncPaletteToStamp() {
    const { w, h, tiles } = this.stamp;
    const g = tiles[0];
    if (g < 0 || g >= this.tileCount) { this.paletteSel = null; this.drawPalette(); return; }
    const index = this.owner[g];
    const ts = this.tilesets[index];
    const local = g - ts.first;
    const x0 = local % ts.columns;
    const y0 = Math.floor(local / ts.columns);
    let rect = x0 + w <= ts.columns;
    for (let y = 0; rect && y < h; y++) {
      for (let x = 0; x < w; x++) if (tiles[y * w + x] !== ts.first + (y0 + y) * ts.columns + x0 + x) { rect = false; break; }
    }
    this.paletteSel = rect ? { ts: index, x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 } : null;
    if (index !== this.activeTileset) {
      this.activeTileset = index;
      this.renderTilesetSection();
    } else this.drawPalette();
  }

  tilesetMenu(anchor) {
    const files = this.host.list();
    const used = new Set(this.tilesets.map((t) => t.path));
    const existing = files.filter((p) => /\.tileset\.json$/i.test(p) && !used.has(p)).sort();
    const pngs = files.filter((p) => /\.png$/i.test(p)).sort();
    const items = [];
    if (existing.length) {
      items.push({ heading: 'Add a tileset' });
      for (const p of existing) items.push({ label: p, icon: 'hash', action: () => this.addTileset(p) });
    }
    const imageTilesets = new Set(files.filter((p) => /\.tileset\.json$/i.test(p)).map((p) => p.replace(/\.tileset\.json$/i, '.png')));
    const fresh = pngs.filter((p) => !imageTilesets.has(p));
    if (fresh.length) {
      if (items.length) items.push('-');
      items.push({ heading: 'Make a tileset from an image' });
      for (const p of fresh) items.push({ label: p, icon: 'image', action: () => this.tilesetFromImage(p) });
    }
    if (items.length) items.push('-');
    items.push({ label: 'New blank tileset…', icon: 'plus', action: () => this.newTileset() });
    this.ui.showMenu(anchor, items);
  }

  addTileset(path) {
    if (this.tilesets.some((t) => t.path === path)) return;
    this.change(() => {
      this.map.tilesets.push(relativePath(this.path, path));
      this.syncTilesets();
      this.activeTileset = this.tilesets.length - 1;
    });
    const ts = this.tilesets[this.activeTileset];
    if (ts?.ts && (ts.ts.tileWidth !== this.map.tileWidth || ts.ts.tileHeight !== this.map.tileHeight)) {
      this.host.toast(`${basename(path)} has ${ts.ts.tileWidth}×${ts.ts.tileHeight} tiles; the map's cells are ${this.map.tileWidth}×${this.map.tileHeight}.`, { type: 'info' });
    }
    if (ts?.count) this.setStampFromPalette(this.activeTileset, 0, 0, 0, 0);
    this.refresh();
  }

  async tilesetFromImage(png) {
    const path = png.replace(/\.png$/i, '.tileset.json');
    if (!this.host.exists(path)) {
      await this.host.write(path, newTilesetText(basename(png), this.map.tileWidth, this.map.tileHeight));
    }
    this.cache.delete(path);
    this.addTileset(path);
  }

  async newTileset() {
    let n = 1;
    while (this.host.exists(`tiles/tiles${n > 1 ? n : ''}.png`) || this.host.exists(`tiles/tiles${n > 1 ? n : ''}.tileset.json`)) n++;
    const name = await this.ui.promptDialog({
      title: 'New tileset', label: 'Name (in tiles/)', value: `tiles${n > 1 ? n : ''}`, okLabel: 'Create',
      validate: (v) => {
        if (!/^[\w.-]+$/.test(v)) return 'Use letters, numbers, - and _.';
        if (this.host.exists(`tiles/${v}.png`) || this.host.exists(`tiles/${v}.tileset.json`)) return 'A tileset with that name exists.';
        return '';
      },
    });
    if (!name) return;
    const tw = this.map.tileWidth;
    const th = this.map.tileHeight;
    await this.host.write(`tiles/${name}.png`, transparentPng(tw * 8, th * 4));
    await this.host.write(`tiles/${name}.tileset.json`, newTilesetText(`${name}.png`, tw, th));
    this.addTileset(`tiles/${name}.tileset.json`);
    this.host.toast(`Created tiles/${name}.png. Click the pencil above the tiles to draw them in the pixel editor.`, { type: 'success', timeout: 6000 });
  }

  async removeTileset(index) {
    const ts = this.tilesets[index];
    if (!ts) return;
    let used = 0;
    for (const l of this.map.layers) if (l.data) for (const g of l.data) if (g >= ts.first && g < ts.first + ts.count) used++;
    if (used && !await this.ui.confirmDialog({
      title: 'Remove tileset?',
      message: `${used} tile${used === 1 ? '' : 's'} on this map use ${basename(ts.path)}; they'll be erased. The tileset's files stay in the project.`,
      okLabel: 'Remove', danger: true,
    })) return;
    this.change(() => {
      const old = this.tilesets.map((t) => ({ first: t.first, count: t.count, path: t.path }));
      this.map.tilesets.splice(index, 1);
      this.syncTilesets();
      this.renumber(old, ts.path);
    });
    this.refresh();
  }

  renderLayerSection() {
    const { h } = this.ui;
    const s = this.layerSection;
    s.replaceChildren();
    if (!this.map) return;
    const n = this.map.layers.length;
    const i = this.activeLayer;
    s.append(this.sectionHead('Layers',
      iconButton(this.ui, {
        icon: 'plus', title: 'Add a layer', small: true, onclick: (e) => this.ui.showMenu(e.currentTarget, [
          { label: 'Tile layer (to paint tiles)', icon: 'grid', action: () => this.addLayer('tiles') },
          { label: 'Object layer (to place objects)', icon: 'package', action: () => this.addLayer('objects') },
        ]),
      }),
      iconButton(this.ui, {
        icon: 'more', title: 'Arrange, rename or delete the selected layer', small: true, onclick: (e) => this.ui.showMenu(e.currentTarget, [
          { label: 'Move up (drawn later, on top)', icon: null, action: () => this.moveLayer(1), disabled: !n || i >= n - 1 },
          { label: 'Move down', icon: null, action: () => this.moveLayer(-1), disabled: !n || i <= 0 },
          { label: 'Rename…', icon: 'pencil', action: () => this.renameLayer(i), disabled: !n },
          '-',
          { label: 'Delete layer', icon: 'trash', danger: true, action: () => this.deleteLayer(i), disabled: !n },
        ]),
      })));
    const list = h('div', { class: 'mt-layers', role: 'listbox', 'aria-label': 'Layers' });
    // Topmost layer first, as it's drawn last.
    for (let j = n - 1; j >= 0; j--) {
      const l = this.map.layers[j];
      const eye = iconButton(this.ui, {
        icon: l.visible ? 'eye' : 'eyeOff', title: l.visible ? 'Hide layer' : 'Show layer', small: true,
        onclick: (e) => {
          e.stopPropagation();
          this.change(() => { l.visible = !l.visible; });
          this.refresh();
        },
      });
      const kind = l.type === 'objects' ? 'objects' : 'tiles';
      const row = h('div', {
        class: `mt-layer${j === i ? ' active' : ''}${l.visible ? '' : ' hidden-layer'}`,
        role: 'option', 'aria-selected': String(j === i),
        title: `${l.name}: ${kind === 'objects' ? 'objects are placed on it' : 'tiles are painted on it'}. Double-click to rename.`,
      }, eye, h('span', { class: 'mt-layer-name' }, l.name), h('span', { class: 'mt-layer-kind' }, kind));
      row.addEventListener('click', () => this.selectLayer(j));
      row.addEventListener('dblclick', () => this.renameLayer(j));
      list.append(row);
    }
    if (!n) list.append(h('p', { class: 'mt-note', style: { padding: '0 6px' } }, 'No layers. Add a tile layer with + to paint tiles, or an object layer to place objects.'));
    s.append(list);
  }

  selectLayer(i) {
    this.activeLayer = i;
    const l = this.layer;
    if (l?.type === 'objects') {
      this.lastObjectLayer = i;
      if (!OBJECT_TOOLS.includes(this.tool)) this.tool = 'select';
    } else if (l) {
      this.lastTileLayer = i;
      if (!TILE_TOOLS.includes(this.tool)) this.tool = 'brush';
      this.selected = null;
    }
    this.refresh();
  }

  uniqueLayerName(base) {
    const names = new Set(this.map.layers.map((l) => l.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  addLayer(type) {
    const name = this.uniqueLayerName(type === 'objects' ? 'objects' : 'tiles');
    this.change(() => {
      const layer = type === 'objects'
        ? { name, type, visible: true, objects: [], extra: {} }
        : { name, type: 'tiles', visible: true, data: new Int32Array(this.map.width * this.map.height).fill(-1), extra: {} };
      this.map.layers.splice(this.activeLayer + 1, 0, layer);
    });
    this.selectLayer(Math.min(this.activeLayer + 1, this.map.layers.length - 1));
    return this.activeLayer;
  }

  async renameLayer(i) {
    const l = this.map.layers[i];
    if (!l) return;
    const name = await this.ui.promptDialog({
      title: 'Rename layer', label: 'Name (code uses it, e.g. level:getTile("ground", x, y))', value: l.name, okLabel: 'Rename',
      validate: (v) => (!v ? 'Please enter a name.' : this.map.layers.some((o, j) => j !== i && o.name === v) ? 'Another layer has that name.' : ''),
    });
    if (!name || name === l.name) return;
    this.change(() => { l.name = name; });
    this.refresh();
  }

  moveLayer(dir) {
    const i = this.activeLayer;
    const j = i + dir;
    if (j < 0 || j >= this.map.layers.length) return;
    this.change(() => {
      const [l] = this.map.layers.splice(i, 1);
      this.map.layers.splice(j, 0, l);
    });
    this.activeLayer = j;
    this.lastTileLayer = this.map.layers.findIndex((l) => l.type === 'tiles');
    this.lastObjectLayer = this.map.layers.findIndex((l) => l.type === 'objects');
    this.refresh();
  }

  async deleteLayer(i) {
    const l = this.map.layers[i];
    if (!l) return;
    const used = l.data ? l.data.some((g) => g >= 0) : l.objects.length > 0;
    if (used && !await this.ui.confirmDialog({
      title: 'Delete layer?', message: `Delete the layer "${l.name}" and everything on it? (You can undo this.)`, okLabel: 'Delete', danger: true,
    })) return;
    this.change(() => { this.map.layers.splice(i, 1); });
    this.selected = null;
    this.activeLayer = Math.max(0, Math.min(i, this.map.layers.length - 1));
    this.lastTileLayer = this.map.layers.findIndex((x) => x.type === 'tiles');
    this.lastObjectLayer = this.map.layers.findIndex((x) => x.type === 'objects');
    this.selectLayer(Math.min(this.activeLayer, this.map.layers.length - 1));
  }

  /** Every object type name used in this map. */
  usedTypes() {
    return [...new Set(this.map.layers.flatMap((x) => (x.objects || []).map((o) => o.type)).filter(Boolean))].sort();
  }

  /** The object palette: the project's object types, types used here without an object file, and "Other…". */
  renderTypesSection() {
    const { h } = this.ui;
    const s = this.typesSection;
    s.replaceChildren();
    if (!this.map) return;
    const known = this.types.list();
    const plain = this.usedTypes().filter((t) => !this.types.get(t));
    if (this.objectType && !this.types.get(this.objectType) && !plain.includes(this.objectType)) plain.push(this.objectType);
    const grid = h('div', { class: 'mt-types', role: 'listbox', 'aria-label': 'Objects to place' });
    const card = (type, thumb, title) => {
      const selected = type === this.objectType;
      const b = h('button', {
        type: 'button', class: `mt-type${selected ? ' selected' : ''}`, role: 'option', 'aria-selected': String(selected), title,
        onclick: () => this.chooseType(type),
      }, thumb, h('span', { class: 'mt-type-name' }, type));
      grid.append(b);
    };
    for (const t of known) {
      const c = h('canvas', { class: 'mt-type-thumb', 'aria-hidden': 'true' });
      const drawn = drawThumbnail(c, t, 40);
      const why = !t.sprite ? 'It has no sprite yet (sprite = "..." in its file).' : t.sprite.error ? `${t.sprite.error}.` : '';
      card(t.type, drawn ? c : h('span', { class: 'mt-type-thumb mt-type-blank' }, icon(this.ui, 'question', 18)),
        `${t.type} (${t.path})${t.behaviors.length ? `\nBehaviors: ${t.behaviors.join(', ')}` : ''}${why ? `\n${why}` : ''}\nClick, then click in the ${this.noun} to place it.`);
    }
    for (const type of plain.sort()) {
      card(type, h('span', { class: 'mt-type-thumb mt-type-plain', style: { '--type-color': typeColor(type, themeColors(this.element)) } }),
        `${type}: there's no objects/${type}.lua, so it's plain data (level:objects("${type}") in code).`);
    }
    grid.append(h('button', {
      type: 'button', class: 'mt-type mt-type-other', title: 'Place an object of another type: a name your code looks for (level:objects("name"))',
      onclick: () => this.otherType(),
    }, h('span', { class: 'mt-type-thumb mt-type-blank' }, this.ui.icon('plus', 18)), h('span', { class: 'mt-type-name' }, 'Other…')));
    s.append(this.sectionHead('Objects'), h('div', { class: 'mt-section-body' },
      known.length ? null : h('p', { class: 'mt-note' }, 'No objects in this project yet. An object is a thing in your game, like the player or a coin: a script in objects/ with a sprite. Create one with New object, and it shows up here.'),
      grid,
      this.selected == null ? h('p', { class: 'mt-note' }, this.objectType
        ? `Click in the ${this.noun} to place a ${this.objectType}. Click an object with Select (V) to change it.`
        : `Pick an object, then click in the ${this.noun} to place it.`) : null));
  }

  chooseType(type) {
    this.objectType = type;
    if (this.tool !== 'object') this.setTool('object');
    else this.refresh();
  }

  async otherType() {
    const type = await this.ui.promptDialog({
      title: 'Other object type', label: 'Type name (your code finds these with level:objects("name"))', value: '', placeholder: 'spawn',
      okLabel: 'Use', validate: (v) => (!v.trim() ? 'Please enter a name.' : /\s/.test(v.trim()) ? 'Use one word, without spaces.' : ''),
    });
    if (type) this.chooseType(type.trim());
  }

  /** The selected object's inspector. */
  renderObjectSection() {
    const { h } = this.ui;
    const s = this.objectSection;
    s.replaceChildren();
    if (!this.map) return;
    const l = this.layer;
    const obj = l?.objects?.find((o) => o.id === this.selected);
    s.hidden = !obj;
    if (!obj) return;
    const commit = (fn) => {
      this.change(fn);
      this.vp.render();
    };
    const t = this.types.get(obj.type);
    const sprite = t?.sprite && !t.sprite.error ? t.sprite : null;

    // Head: thumbnail, type, and buttons to open its files.
    let thumb;
    if (sprite) {
      thumb = h('canvas', { class: 'mt-inspect-thumb', 'aria-hidden': 'true' });
      drawThumbnail(thumb, t, 22);
    } else {
      thumb = h('span', { class: 'mt-inspect-thumb mt-type-plain', style: { '--type-color': typeColor(obj.type, themeColors(this.element)) } });
    }
    const head = h('div', { class: 'mt-section-head mt-inspect-head' }, thumb, h('span', {}, obj.type || 'Object'));
    if (t) {
      head.append(iconButton(this.ui, { icon: 'script', small: true, title: `Open its script (${t.path})`, onclick: () => this.host.openFile(t.path) }));
      const spritePath = t.sprite?.imagePath && this.host.exists(t.sprite.imagePath) ? t.sprite.imagePath : null;
      const sb = iconButton(this.ui, {
        icon: 'image', small: true,
        title: spritePath ? `Open its sprite (${spritePath})` : t.sprite ? `${t.sprite.error}` : 'It has no sprite (set sprite = "sprites/name" in its script)',
        onclick: () => spritePath && this.host.openFile(spritePath),
      });
      sb.disabled = !spritePath;
      head.append(sb);
    }
    head.append(iconButton(this.ui, {
      icon: 'more', small: true, title: 'Duplicate or delete', onclick: (e) => this.ui.showMenu(e.currentTarget, [
        { label: 'Duplicate', icon: 'copy', shortcut: `${this.ui.modKey}+D`, action: () => this.duplicateObject() },
        { label: 'Delete', icon: 'trash', shortcut: 'Del', danger: true, action: () => this.deleteObject() },
      ]),
    }));

    const types = [...new Set([...this.types.list().map((x) => x.type), ...this.usedTypes()])].sort();
    const listId = `mt-types-${Math.random().toString(36).slice(2)}`;
    const datalist = h('datalist', { id: listId }, types.map((x) => h('option', { value: x })));
    const typeInput = h('input', { class: 'input small', value: obj.type, list: listId, spellcheck: 'false', 'aria-label': 'Type', title: t ? `Defined in ${t.path}` : `No objects/${obj.type || 'type'}.lua: plain data for your code` });
    typeInput.addEventListener('change', () => {
      const v = typeInput.value.trim();
      commit(() => { obj.type = v; });
      if (v) this.objectType = v;
      this.refresh();
    });
    typeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') typeInput.blur(); });
    // A number field; with a placeholder, empty means "the type's default" (the key is left out).
    const num = (key, opts = {}) => {
      const input = h('input', {
        type: 'number', class: 'input small', value: obj[key] ?? '', min: opts.min, step: 1, title: opts.title || key, 'aria-label': opts.title || key,
        placeholder: opts.placeholder !== undefined ? String(opts.placeholder) : null,
      });
      input.addEventListener('change', () => {
        const text = input.value.trim();
        if (text === '' && opts.placeholder !== undefined) {
          if (obj[key] !== undefined) commit(() => { delete obj[key]; });
          return;
        }
        const n = Number(text);
        if (text === '' || !Number.isFinite(n) || (opts.min !== undefined && n < opts.min)) { input.value = String(obj[key] ?? ''); return; }
        commit(() => { obj[key] = n; });
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      return input;
    };
    const fields = h('div', { class: 'mt-fields' },
      h('label', {}, 'Type'), h('div', { class: 'wide' }, typeInput, datalist),
      h('label', { title: sprite ? 'Where the sprite\'s origin is, in pixels from the top left' : 'Pixels from the top left' }, 'X'),
      num('x', { title: 'X' }), h('label', {}, 'Y'), num('y', { title: 'Y' }));
    const body = h('div', { class: 'mt-section-body' }, fields);

    if (t) {
      // The type's values, with its defaults as placeholders; empty = the default.
      const defs = this.types.fields(t);
      const defaults = defs.map((d) => d.key);
      if (defs.length) {
        const grid = h('div', { class: 'mt-kv' });
        for (const d of defs) {
          const shown = d.value && typeof d.value === 'object' ? (Array.isArray(d.value) ? d.value.join(', ') : d.value.expr) : formatValue(d.value);
          const input = h('input', {
            class: 'input small', value: d.key in obj.properties ? formatValue(obj.properties[d.key]) : '', placeholder: shown, spellcheck: 'false',
            'aria-label': d.key, title: d.from === 'definition' ? `${d.key}: ${shown} in ${t.path} unless you set it here` : `${d.key}: ${shown} by default (${d.from} behavior)`,
          });
          input.addEventListener('change', () => {
            const text = input.value;
            commit(() => {
              const p = { ...obj.properties };
              if (text.trim() === '') delete p[d.key];
              else p[d.key] = parseValue(text);
              obj.properties = p;
            });
          });
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
          grid.append(h('label', { title: input.title }, d.key), input);
        }
        body.append(h('div', { class: 'mt-props-title' }, 'Properties', h('span', { class: 'mt-props-sub' }, ' (empty: the default)')), grid);
      }
      body.append(propertyEditor(this.ui, {
        title: defs.length ? 'More properties' : 'Properties',
        props: obj.properties,
        hidden: defaults,
        onCommit: (p) => commit(() => {
          const keep = {};
          for (const k of defaults) if (k in obj.properties) keep[k] = obj.properties[k];
          for (const k of defaults) delete p[k];
          obj.properties = { ...keep, ...p };
        }),
      }));
      const size = this.types.defaultSize(t);
      body.append(h('div', { class: 'mt-props-title' }, 'Hitbox size', h('span', { class: 'mt-props-sub' }, ' (empty: from the type)')),
        h('div', { class: 'mt-fields' },
          h('label', {}, 'W'), num('width', { min: 0, placeholder: size.width, title: 'Hitbox width' }),
          h('label', {}, 'H'), num('height', { min: 0, placeholder: size.height, title: 'Hitbox height' })));
    } else {
      fields.append(h('label', {}, 'W'), num('width', { min: 0, title: 'Width' }), h('label', {}, 'H'), num('height', { min: 0, title: 'Height' }));
      body.append(propertyEditor(this.ui, {
        props: obj.properties,
        onCommit: (props) => commit(() => { obj.properties = props; }),
      }));
      if (obj.type) {
        body.append(h('p', { class: 'mt-note' }, `There's no objects/${obj.type}.lua, so this is plain data: your code reads it with level:objects("${obj.type}").`));
      }
    }
    s.append(head, body);
  }

  // -------------------------------------------------------------------------
  // Scene (map) properties dialog: size, tile size, background, properties

  async mapDialog() {
    if (!this.map) return;
    const { h } = this.ui;
    const m = this.map;
    const field = (value, min, max) => h('input', { type: 'number', class: 'input', value: String(value), min, max, step: 1 });
    const w = field(m.width, 1, 4096);
    const hh = field(m.height, 1, 4096);
    const tw = field(m.tileWidth, 1, 512);
    const th = field(m.tileHeight, 1, 512);
    let anchor = [0, 0];
    const anchorBtns = [];
    const anchorEl = h('div', { class: 'mt-anchor', role: 'group', 'aria-label': 'Resize anchor' });
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const b = h('button', { type: 'button', title: `Keep the ${['top', 'middle', 'bottom'][y]} ${['left', 'center', 'right'][x]} in place`, 'aria-pressed': String(x === 0 && y === 0) });
        b.addEventListener('click', () => {
          anchor = [x / 2, y / 2];
          for (const o of anchorBtns) o.setAttribute('aria-pressed', String(o === b));
        });
        anchorBtns.push(b);
        anchorEl.append(b);
      }
    }
    const hasBg = h('input', { type: 'checkbox', checked: !!m.background });
    const firstColor = this.host.palette?.()?.[0];
    const color = h('input', {
      type: 'color', class: 'mt-color', value: (m.background || (/^#[0-9a-f]{6}/i.test(firstColor || '') ? firstColor : '#000000')).slice(0, 7),
      disabled: !m.background, 'aria-label': 'Background color',
    });
    hasBg.addEventListener('change', () => { color.disabled = !hasBg.checked; });
    let props = { ...m.properties };
    const body = h('div', {},
      h('div', { class: 'mt-dialog-grid' },
        h('label', {}, 'Size'), h('div', { class: 'mt-pair' }, w, h('span', {}, '×'), hh, h('span', {}, 'tiles')),
        h('label', {}, 'Anchor'), h('div', { class: 'mt-pair' }, anchorEl, h('span', {}, 'Where existing tiles stay when resizing')),
        h('label', {}, 'Tile size'), h('div', { class: 'mt-pair' }, tw, h('span', {}, '×'), th, h('span', {}, 'pixels')),
        h('label', {}, 'Background'), h('div', { class: 'mt-pair' }, h('label', { class: 'mt-check', style: { margin: 0 } }, hasBg, 'Color'), color)),
      propertyEditor(this.ui, { title: `${this.Noun} properties (level.properties in code)`, props, onCommit: (p) => { props = p; } }));
    const res = await this.ui.openDialog({
      title: `${this.Noun} properties`, body, wide: false,
      actions: [{ label: 'Cancel', value: null, ghost: true }, { label: 'Apply', value: 'ok', primary: true, submit: true }],
    });
    if (res !== 'ok') return;
    // Commit any property field still being edited.
    const clamp = (input, lo, hi, d) => {
      const n = Math.round(Number(input.value));
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
    };
    const nw = clamp(w, 1, 4096, m.width);
    const nh = clamp(hh, 1, 4096, m.height);
    const ntw = clamp(tw, 1, 512, m.tileWidth);
    const nth = clamp(th, 1, 512, m.tileHeight);
    const bg = hasBg.checked ? color.value.toLowerCase() : null;
    this.change(() => {
      if (nw !== m.width || nh !== m.height) this.resize(nw, nh, anchor);
      m.tileWidth = ntw;
      m.tileHeight = nth;
      m.background = bg;
      m.properties = props;
    });
    this.vp.fitted = false;
    this.vp.fit();
    this.refresh();
  }

  resize(nw, nh, [ax, ay]) {
    const m = this.map;
    const dx = Math.round((nw - m.width) * ax);
    const dy = Math.round((nh - m.height) * ay);
    for (const l of m.layers) {
      if (l.data) {
        const data = new Int32Array(nw * nh).fill(-1);
        for (let y = 0; y < m.height; y++) {
          const ny = y + dy;
          if (ny < 0 || ny >= nh) continue;
          for (let x = 0; x < m.width; x++) {
            const nx = x + dx;
            if (nx >= 0 && nx < nw) data[ny * nw + nx] = l.data[y * m.width + x];
          }
        }
        l.data = data;
      } else {
        for (const o of l.objects) {
          o.x += dx * m.tileWidth;
          o.y += dy * m.tileHeight;
        }
      }
    }
    m.width = nw;
    m.height = nh;
  }

  // -------------------------------------------------------------------------
  // Undo

  snapshot() {
    const m = this.map;
    return {
      width: m.width, height: m.height, tileWidth: m.tileWidth, tileHeight: m.tileHeight, background: m.background,
      tilesets: [...m.tilesets], properties: structuredClone(m.properties), nextId: m.nextId,
      layers: m.layers.map((l) => ({ ...l, extra: { ...l.extra }, data: l.data ? l.data.slice() : undefined, objects: l.objects ? structuredClone(l.objects) : undefined })),
    };
  }

  restore(s) {
    const copy = { ...s, layers: s.layers.map((l) => ({ ...l, data: l.data ? l.data.slice() : undefined, objects: l.objects ? structuredClone(l.objects) : undefined })) };
    copy.properties = structuredClone(s.properties);
    copy.tilesets = [...s.tilesets];
    Object.assign(this.map, copy);
    for (const l of this.map.layers) if (!l.data) delete l.data;
    for (const l of this.map.layers) if (!l.objects) delete l.objects;
    this.syncTilesets();
    this.activeLayer = Math.min(this.activeLayer, Math.max(0, this.map.layers.length - 1));
    if (this.selected && !this.findObject(this.selected)) this.selected = null;
  }

  /** Make a change to the map as one undo step. */
  change(fn) {
    const before = this.snapshot();
    fn();
    const after = this.snapshot();
    this.history.push({
      undo: () => this.restore(before),
      redo: () => this.restore(after),
    });
    this.markDirty();
  }

  undo() {
    if (this.drag) return;
    if (this.history.undo()) { this.markDirty(); this.refresh(); }
  }

  redo() {
    if (this.drag) return;
    if (this.history.redo()) { this.markDirty(); this.refresh(); }
  }

  // -------------------------------------------------------------------------
  // Tools

  setTool(id) {
    if (TILE_TOOLS.includes(id) && this.layer?.type !== 'tiles') {
      const i = this.map?.layers[this.lastTileLayer]?.type === 'tiles' ? this.lastTileLayer : this.map?.layers.findIndex((l) => l.type === 'tiles');
      if (i == null || i < 0) {
        this.host.toast('Add a tile layer to paint tiles.', { type: 'info' });
      } else this.activeLayer = i;
      this.selected = null;
    } else if (OBJECT_TOOLS.includes(id) && this.layer?.type !== 'objects' && this.map) {
      let i = this.map.layers[this.lastObjectLayer]?.type === 'objects' ? this.lastObjectLayer : this.map.layers.findIndex((l) => l.type === 'objects');
      if (i < 0) i = this.addLayer('objects');
      this.activeLayer = i;
    }
    this.tool = id;
    this.drag = null;
    this.refresh();
  }

  toggleGrid() {
    this.showGrid = !this.showGrid;
    this.updateToolbar();
    this.vp.render();
  }

  cellAt(w) {
    return { x: Math.floor(w.x / this.map.tileWidth), y: Math.floor(w.y / this.map.tileHeight) };
  }

  inside(x, y) { return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height; }

  pointer(type, e, w) {
    if (!this.map) return;
    if (type === 'leave') {
      this.hover = null;
      this.hoverObject = null;
      this.updateStatus();
      this.vp.render();
      return;
    }
    this.hover = w;
    this.altDown = e.altKey;
    const l = this.layer;
    this.hoverObject = l?.type === 'objects' && !this.drag ? this.objectAt(l, w)?.id ?? null : null;
    this.updateStatus();
    if (l?.type === 'objects' && OBJECT_TOOLS.includes(this.tool)) this.objectPointer(type, e, w, l);
    else if (l?.type === 'tiles' && TILE_TOOLS.includes(this.tool)) this.tilePointer(type, e, w, l);
    else if (type === 'down') this.host.toast(TILE_TOOLS.includes(this.tool) ? 'Select a tile layer to paint on.' : 'Select an object layer to place objects.', { type: 'info' });
    this.vp.render();
  }

  // Tile strokes record each changed cell once: index -> old value.
  beginStroke(layer) {
    this.stroke = { layer, old: new Map() };
  }

  set(layer, x, y, g) {
    if (!this.inside(x, y)) return;
    const i = y * this.map.width + x;
    const prev = layer.data[i];
    if (prev === g) return;
    if (this.stroke && !this.stroke.old.has(i)) this.stroke.old.set(i, prev);
    layer.data[i] = g;
  }

  endStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (!s || !s.old.size) return;
    const idx = [...s.old.keys()];
    const olds = idx.map((i) => s.old.get(i));
    const news = idx.map((i) => s.layer.data[i]);
    // Find the layer by identity at undo time (layers may be replaced by snapshots).
    const layerIndex = this.map.layers.indexOf(s.layer);
    const apply = (values) => {
      const layer = this.map.layers[layerIndex];
      if (!layer?.data) return;
      idx.forEach((i, k) => { layer.data[i] = values[k]; });
    };
    this.history.push({ undo: () => apply(olds), redo: () => apply(news) });
    this.markDirty();
  }

  /** Paint the stamp with its top left at cell (x, y); cells of -1 in the stamp are skipped. */
  stampAt(layer, x, y, erase = false) {
    const { w, h, tiles } = this.stamp;
    if (erase || this.tool === 'eraser') {
      this.set(layer, x, y, -1);
      return;
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const g = tiles[j * w + i];
        if (g >= 0) this.set(layer, x + i, y + j, g);
      }
    }
  }

  /** The stamp's tile for cell (x, y) when the stamp is repeated from (ox, oy). */
  patternAt(x, y, ox, oy) {
    const { w, h, tiles } = this.stamp;
    const i = (((x - ox) % w) + w) % w;
    const j = (((y - oy) % h) + h) % h;
    return tiles[j * w + i];
  }

  tilePointer(type, e, w, layer) {
    const c = this.cellAt(w);
    const erase = e.button === 2 || (e.buttons & 2) !== 0;
    if (type === 'down') {
      if (!this.tileCount && !erase && ['brush', 'rect', 'fill'].includes(this.tool)) {
        this.host.toast(this.tilesets.length
          ? 'This tileset has no tiles to paint with. Check its image in the Tiles panel.'
          : 'Create or pick a tileset first (Tiles, on the right), then paint with its tiles.', { type: 'info' });
        return;
      }
      if (this.tool === 'brush' && e.altKey && !erase) {
        this.drag = { kind: 'pick', x0: c.x, y0: c.y, x1: c.x, y1: c.y };
        return;
      }
      switch (this.tool) {
        case 'brush':
        case 'eraser': {
          this.beginStroke(layer);
          // Multi-tile stamps repeat on a grid from where the stroke started.
          this.drag = { kind: 'paint', erase, ox: c.x, oy: c.y, last: c, done: new Set() };
          this.paintTo(layer, c);
          break;
        }
        case 'rect':
          this.drag = { kind: 'rect', erase, x0: c.x, y0: c.y, x1: c.x, y1: c.y };
          break;
        case 'fill':
          this.bucket(layer, c.x, c.y, erase);
          break;
        case 'picker':
          this.drag = { kind: 'pick', x0: c.x, y0: c.y, x1: c.x, y1: c.y };
          break;
        default:
      }
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (type === 'move') {
      if (d.kind === 'paint') this.paintTo(layer, c);
      else { d.x1 = c.x; d.y1 = c.y; }
      return;
    }
    if (type === 'up') {
      this.drag = null;
      if (d.kind === 'paint') this.endStroke();
      else if (d.kind === 'rect') this.fillRect(layer, d);
      else if (d.kind === 'pick') this.pick(layer, d);
    }
  }

  paintTo(layer, c) {
    const d = this.drag;
    // Every cell on the line from the last position, so fast strokes have no gaps.
    let { x: x0, y: y0 } = d.last;
    const { x: x1, y: y1 } = c;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const { w, h } = d.erase || this.tool === 'eraser' ? { w: 1, h: 1 } : this.stamp;
    for (;;) {
      const ax = d.ox + Math.floor((x0 - d.ox) / w) * w;
      const ay = d.oy + Math.floor((y0 - d.oy) / h) * h;
      const key = `${ax},${ay}`;
      if (!d.done.has(key)) {
        d.done.add(key);
        this.stampAt(layer, ax, ay, d.erase);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    d.last = c;
  }

  fillRect(layer, d) {
    const x0 = Math.max(0, Math.min(d.x0, d.x1));
    const x1 = Math.min(this.map.width - 1, Math.max(d.x0, d.x1));
    const y0 = Math.max(0, Math.min(d.y0, d.y1));
    const y1 = Math.min(this.map.height - 1, Math.max(d.y0, d.y1));
    const ox = Math.min(d.x0, d.x1);
    const oy = Math.min(d.y0, d.y1);
    this.beginStroke(layer);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const g = d.erase ? -1 : this.patternAt(x, y, ox, oy);
        if (g >= 0 || d.erase) this.set(layer, x, y, g);
      }
    }
    this.endStroke();
  }

  bucket(layer, x, y, erase) {
    if (!this.inside(x, y)) return;
    const { width: W, height: H } = this.map;
    const target = layer.data[y * W + x];
    const seen = new Uint8Array(W * H);
    const stack = [y * W + x];
    seen[y * W + x] = 1;
    const cells = [];
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const cx = i % W;
      const cy = (i - cx) / W;
      const visit = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
        const j = ny * W + nx;
        if (!seen[j] && layer.data[j] === target) { seen[j] = 1; stack.push(j); }
      };
      visit(cx + 1, cy); visit(cx - 1, cy); visit(cx, cy + 1); visit(cx, cy - 1);
    }
    this.beginStroke(layer);
    for (const i of cells) {
      const cx = i % W;
      const cy = (i - cx) / W;
      const g = erase ? -1 : this.patternAt(cx, cy, x, y);
      if (g >= 0 || erase) this.set(layer, cx, cy, g);
    }
    this.endStroke();
  }

  pick(layer, d) {
    const x0 = Math.max(0, Math.min(d.x0, d.x1));
    const x1 = Math.min(this.map.width - 1, Math.max(d.x0, d.x1));
    const y0 = Math.max(0, Math.min(d.y0, d.y1));
    const y1 = Math.min(this.map.height - 1, Math.max(d.y0, d.y1));
    if (x1 < x0 || y1 < y0) return;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const tiles = new Int32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = layer.data[(y0 + y) * this.map.width + x0 + x];
    if (tiles.every((g) => g < 0)) {
      this.host.toast('There are no tiles there to pick.', { type: 'info' });
      return;
    }
    this.stamp = { w, h, tiles };
    this.syncPaletteToStamp();
    this.setTool('brush');
  }

  // -------------------------------------------------------------------------
  // Objects

  findObject(id) {
    for (const l of this.map.layers) {
      const o = l.objects?.find((x) => x.id === id);
      if (o) return o;
    }
    return null;
  }

  /**
   * Where an object is drawn and hit. Objects of a type with a sprite are
   * drawn like at runtime: the sprite's origin at the object's x, y, so the
   * frame's top left is (x - originX, y - originY). Others are boxes from
   * x, y (their size, or the type's default size, or one tile).
   */
  objectBounds(o) {
    const t = this.types.get(o.type);
    const s = t?.sprite && !t.sprite.error ? t.sprite : null;
    if (s) return { x: o.x - s.originX, y: o.y - s.originY, w: s.frameWidth, h: s.frameHeight, sprite: s, type: t };
    if (t) {
      const d = this.types.defaultSize(t);
      return { x: o.x, y: o.y, w: o.width ?? d.width, h: o.height ?? d.height, sprite: null, type: t };
    }
    return { x: o.x, y: o.y, w: o.width ?? this.map.tileWidth, h: o.height ?? this.map.tileHeight, sprite: null, type: null };
  }

  /** Objects in drawing order, as at runtime: by `layer` (the object's, else its type's, else 0), then by y. */
  sortedObjects(layer) {
    const key = (o) => {
      const v = o.properties?.layer ?? this.types.get(o.type)?.def.layer;
      return typeof v === 'number' ? v : 0;
    };
    return layer.objects.map((o, i) => ({ o, i, k: key(o) }))
      .sort((a, b) => a.k - b.k || a.o.y - b.o.y || a.i - b.i).map((e) => e.o);
  }

  objectAt(layer, w) {
    const list = this.sortedObjects(layer);
    const min = 4 / this.vp.zoom;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      const b = this.objectBounds(o);
      const bw = Math.max(b.w, min);
      const bh = Math.max(b.h, min);
      if (w.x >= b.x && w.y >= b.y && w.x < b.x + bw && w.y < b.y + bh) return o;
    }
    return null;
  }

  /** Objects drawn as boxes can be resized from their bottom right corner. */
  onResizeHandle(o, w) {
    const b = this.objectBounds(o);
    if (b.sprite) return false;
    const r = 6 / this.vp.zoom;
    return Math.abs(w.x - (b.x + b.w)) <= r && Math.abs(w.y - (b.y + b.h)) <= r;
  }

  snap(v, size, free) {
    return free ? Math.round(v) : Math.round(v / size) * size;
  }

  /**
   * Where a new object of a type goes for the pointer at w: objects of a type
   * are centered on the pointer (free) or in the cells under it (snapped);
   * the result is the sprite's origin, as at runtime. Other objects fill the
   * cell under the pointer.
   */
  placement(type, w, free) {
    const { tileWidth: tw, tileHeight: th } = this.map;
    const t = this.types.get(type);
    if (t) {
      const s = t.sprite && !t.sprite.error ? t.sprite : null;
      const size = s ? { width: s.frameWidth, height: s.frameHeight } : this.types.defaultSize(t);
      let left = Math.round(w.x - size.width / 2);
      let top = Math.round(w.y - size.height / 2);
      if (!free) {
        // In the whole cells it covers: centered across, and down at their
        // bottom when the sprite's origin is at its feet (it stands on the
        // ground below), else centered.
        const cw = Math.max(1, Math.ceil(size.width / tw)) * tw;
        const ch = Math.max(1, Math.ceil(size.height / th)) * th;
        left = Math.round((w.x - cw / 2) / tw) * tw + Math.floor((cw - size.width) / 2);
        const cellTop = Math.round((w.y - ch / 2) / th) * th;
        top = cellTop + (s && s.originY >= size.height ? ch - size.height : Math.floor((ch - size.height) / 2));
      }
      return { x: left + (s ? s.originX : 0), y: top + (s ? s.originY : 0), typed: true };
    }
    return { x: free ? Math.round(w.x) : Math.floor(w.x / tw) * tw, y: free ? Math.round(w.y) : Math.floor(w.y / th) * th, typed: false };
  }

  objectPointer(type, e, w, layer) {
    const free = e.altKey;
    const { tileWidth: tw, tileHeight: th } = this.map;
    if (type === 'down') {
      if (e.button !== 0) return;
      const sel = layer.objects.find((o) => o.id === this.selected);
      if (this.tool === 'select') {
        if (sel && this.onResizeHandle(sel, w)) {
          const b = this.objectBounds(sel);
          this.drag = { kind: 'resize', obj: sel, before: this.snapshot(), w0: b.w, h0: b.h, sx: w.x, sy: w.y, moved: false };
          return;
        }
        const o = this.objectAt(layer, w);
        this.selected = o ? o.id : null;
        if (o) this.drag = { kind: 'move', obj: o, before: this.snapshot(), x0: o.x, y0: o.y, sx: w.x, sy: w.y, moved: false };
        this.renderSide();
        return;
      }
      // Place a new object.
      if (!this.objectType) {
        this.host.toast('Pick an object on the right first.', { type: 'info' });
        return;
      }
      const at = this.placement(this.objectType, w, free);
      const before = this.snapshot();
      const obj = { id: this.map.nextId++, type: this.objectType, x: at.x, y: at.y };
      // Typed objects take their size from the type unless it's set; plain ones have one.
      if (!at.typed) Object.assign(obj, { width: tw, height: th });
      obj.properties = {};
      layer.objects.push(obj);
      this.selected = obj.id;
      this.drag = at.typed ? { kind: 'place-move', obj, before } : { kind: 'place', obj, before, ax: at.x, ay: at.y };
      return;
    }
    const d = this.drag;
    if (type === 'move') {
      if (!d) {
        const sel = layer.objects.find((o) => o.id === this.selected);
        const cls = this.tool === 'select' ? (sel && this.onResizeHandle(sel, w) ? 'tool-resize' : this.objectAt(layer, w) ? 'tool-move' : '') : '';
        this.viewEl.classList.toggle('tool-resize', cls === 'tool-resize');
        this.viewEl.classList.toggle('tool-move', cls === 'tool-move');
        return;
      }
      if (d.kind === 'move') {
        // Snapped moves go in whole tiles, keeping the object's offset in its cell.
        const nx = d.x0 + this.snap(w.x - d.sx, tw, free);
        const ny = d.y0 + this.snap(w.y - d.sy, th, free);
        if (nx !== d.obj.x || ny !== d.obj.y) d.moved = true;
        d.obj.x = nx;
        d.obj.y = ny;
      } else if (d.kind === 'resize') {
        d.obj.width = Math.max(free ? 1 : tw, this.snap(d.w0 + w.x - d.sx, tw, free));
        d.obj.height = Math.max(free ? 1 : th, this.snap(d.h0 + w.y - d.sy, th, free));
        d.moved = true;
      } else if (d.kind === 'place-move') {
        // Dragging right after placing moves the new object.
        const at = this.placement(d.obj.type, w, free);
        d.obj.x = at.x;
        d.obj.y = at.y;
      } else if (d.kind === 'place') {
        // The new object covers the cells from where the drag started to here.
        if (free) {
          const px = Math.round(w.x);
          const py = Math.round(w.y);
          d.obj.x = Math.min(d.ax, px);
          d.obj.y = Math.min(d.ay, py);
          d.obj.width = Math.abs(px - d.ax) || tw;
          d.obj.height = Math.abs(py - d.ay) || th;
        } else {
          const cx = Math.floor(w.x / tw) * tw;
          const cy = Math.floor(w.y / th) * th;
          d.obj.x = Math.min(d.ax, cx);
          d.obj.y = Math.min(d.ay, cy);
          d.obj.width = Math.max(d.ax, cx) + tw - d.obj.x;
          d.obj.height = Math.max(d.ay, cy) + th - d.obj.y;
        }
      }
      this.renderObjectFieldsLater();
      return;
    }
    if (type === 'up' && d) {
      this.drag = null;
      const placed = d.kind === 'place' || d.kind === 'place-move';
      if (placed || d.moved) {
        const after = this.snapshot();
        this.history.push({ undo: () => this.restore(d.before), redo: () => this.restore(after) });
        this.markDirty();
      }
      if (placed) this.refresh();
      else this.renderSide();
    }
  }

  renderObjectFieldsLater() {
    if (this.fieldsFrame) return;
    this.fieldsFrame = requestAnimationFrame(() => {
      this.fieldsFrame = 0;
      this.renderObjectSection();
    });
  }

  deleteObject() {
    const l = this.layer;
    if (!l?.objects || this.selected == null) return false;
    const i = l.objects.findIndex((o) => o.id === this.selected);
    if (i < 0) return false;
    this.change(() => { l.objects.splice(i, 1); });
    this.selected = null;
    this.hoverObject = null;
    this.refresh();
    return true;
  }

  duplicateObject() {
    const l = this.layer;
    const o = l?.objects?.find((x) => x.id === this.selected);
    if (!o) return false;
    let copy;
    this.change(() => {
      copy = { ...structuredClone(o), id: this.map.nextId++, x: o.x + this.map.tileWidth, y: o.y };
      l.objects.push(copy);
    });
    this.selected = copy.id;
    this.refresh();
    return true;
  }

  nudge(dx, dy) {
    const o = this.layer?.objects?.find((x) => x.id === this.selected);
    if (!o) return false;
    this.change(() => { o.x += dx; o.y += dy; });
    this.renderObjectSection();
    this.vp.render();
    return true;
  }

  // -------------------------------------------------------------------------
  // Status bar

  updateStatus() {
    if (!this.map || !this.hover) {
      this.statusPos.textContent = '';
      this.statusTile.textContent = '';
      return;
    }
    const c = this.cellAt(this.hover);
    if (!this.inside(c.x, c.y)) {
      this.statusPos.textContent = '';
      this.statusTile.textContent = '';
      return;
    }
    this.statusPos.textContent = `Tile ${c.x}, ${c.y} · Pixel ${Math.floor(this.hover.x)}, ${Math.floor(this.hover.y)}`;
    const l = this.layer;
    if (l?.data) {
      const g = l.data[c.y * this.map.width + c.x];
      if (g < 0) this.statusTile.textContent = 'Empty';
      else {
        const ts = this.tilesets[this.owner[g]];
        const props = ts?.ts?.tiles.get(g - ts.first);
        this.statusTile.textContent = `Tile ${g}${ts ? ` (${assetName(ts.path)})` : ' (no tileset)'}${props?.solid ? ' · solid' : ''}`;
      }
    } else if (l?.objects) {
      const o = this.objectAt(l, this.hover);
      this.statusTile.textContent = o ? `${o.type || 'object'} #${o.id} at ${o.x}, ${o.y}` : '';
    }
  }

  // -------------------------------------------------------------------------
  // Drawing

  drawTile(ctx, g, x, y) {
    const ts = this.tilesets[this.owner[g]];
    const bmp = ts?.image?.bitmap;
    const { tileWidth: mw, tileHeight: mh } = this.map;
    if (!ts || ts.error) {
      ctx.fillStyle = this.colors.dangerFill;
      ctx.fillRect(x * mw, y * mh, mw, mh);
      return;
    }
    if (!bmp) return;
    const local = g - ts.first;
    const { tileWidth: tw, tileHeight: th } = ts.ts;
    ctx.drawImage(bmp, (local % ts.columns) * tw, Math.floor(local / ts.columns) * th, tw, th, x * mw, y * mh, tw, th);
  }

  draw(ctx, vp) {
    const colors = themeColors(this.element);
    this.colors = colors;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!this.map) return;
    const m = this.map;
    const W = m.width * m.tileWidth;
    const H = m.height * m.tileHeight;
    if (m.background) {
      vp.worldTransform(ctx);
      ctx.fillStyle = m.background;
      ctx.fillRect(0, 0, W, H);
    } else drawChecker(ctx, vp, W, H, colors);

    // Visible cells (with room for tiles bigger than a cell).
    const vis = vp.visible();
    const extraX = Math.max(0, ...this.tilesets.map((t) => (t.ts ? t.ts.tileWidth - m.tileWidth : 0)));
    const extraY = Math.max(0, ...this.tilesets.map((t) => (t.ts ? t.ts.tileHeight - m.tileHeight : 0)));
    const cx0 = Math.max(0, Math.floor((vis.x0 - extraX) / m.tileWidth));
    const cy0 = Math.max(0, Math.floor((vis.y0 - extraY) / m.tileHeight));
    const cx1 = Math.min(m.width - 1, Math.floor(vis.x1 / m.tileWidth));
    const cy1 = Math.min(m.height - 1, Math.floor(vis.y1 / m.tileHeight));

    vp.worldTransform(ctx);
    const active = this.layer;
    for (const l of m.layers) {
      if (!l.visible) continue;
      if (l.data) {
        // Other layers fade a little while placing objects, so objects stand out.
        ctx.globalAlpha = active?.type === 'objects' ? 0.75 : 1;
        for (let y = cy0; y <= cy1; y++) {
          for (let x = cx0; x <= cx1; x++) {
            const g = l.data[y * m.width + x];
            if (g >= 0) this.drawTile(ctx, g, x, y);
          }
        }
        ctx.globalAlpha = 1;
      } else this.drawObjects(ctx, vp, l, l === active, colors);
    }

    this.drawPreview(ctx, vp, colors);
    this.drawPlaceGhost(ctx, vp, colors);

    if (this.showGrid) drawGrid(ctx, vp, W, H, m.tileWidth, m.tileHeight, colors.grid);
    // Map border.
    vp.screenTransform(ctx);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(vp.sx(0) - 0.5, vp.sy(0) - 0.5, vp.sx(W) - vp.sx(0) + 1, vp.sy(H) - vp.sy(0) + 1);

    // Object outlines and names, in screen space so they stay readable.
    for (const l of m.layers) if (l.visible && l.objects) this.drawObjectOverlays(ctx, vp, l, l === active, colors);
  }

  drawObjects(ctx, vp, layer, active, colors) {
    const dim = active || this.layer?.type !== 'objects' ? 1 : 0.55;
    for (const o of this.sortedObjects(layer)) {
      const b = this.objectBounds(o);
      if (b.sprite) {
        // As the game draws it: the first frame of its starting animation, origin at x, y.
        const s = b.sprite;
        const bmp = s.img?.bitmap;
        vp.worldTransform(ctx);
        ctx.globalAlpha = dim;
        if (bmp) {
          ctx.drawImage(bmp, (s.frame % s.columns) * s.frameWidth, Math.floor(s.frame / s.columns) * s.frameHeight,
            s.frameWidth, s.frameHeight, b.x, b.y, s.frameWidth, s.frameHeight);
        }
        continue;
      }
      vp.screenTransform(ctx);
      const x = vp.sx(b.x);
      const y = vp.sy(b.y);
      const w = Math.max(3, vp.sx(b.x + b.w) - x);
      const h = Math.max(3, vp.sy(b.y + b.h) - y);
      const color = typeColor(o.type, colors);
      ctx.globalAlpha = (active ? 1 : 0.55) * 0.22;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = active ? 1 : 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    }
    ctx.globalAlpha = 1;
    vp.worldTransform(ctx);
  }

  /**
   * Over the objects: names of objects drawn as boxes, and for the active
   * layer, a subtle outline and name for the hovered object and a clear one
   * (with its origin, or a resize handle) for the selected one.
   */
  drawObjectOverlays(ctx, vp, layer, active, colors) {
    vp.screenTransform(ctx);
    ctx.font = `600 11px ${colors.font}`;
    ctx.textBaseline = 'bottom';
    const label = (text, x, y, color) => {
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = colors.labelBg;
      ctx.fillRect(x - 1, y - 14, tw + 6, 14);
      ctx.fillStyle = color;
      ctx.fillText(text, x + 2, y - 1);
    };
    for (const o of layer.objects) {
      const b = this.objectBounds(o);
      const selected = active && o.id === this.selected;
      const hovered = active && o.id === this.hoverObject && !this.drag;
      const x = vp.sx(b.x);
      const y = vp.sy(b.y);
      const w = Math.max(3, vp.sx(b.x + b.w) - x);
      const h = Math.max(3, vp.sy(b.y + b.h) - y);
      if (selected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = colors.halo;
        ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colors.accent;
        ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
        if (b.sprite) {
          // The origin: the point the object's x, y names.
          const ox = vp.sx(o.x);
          const oy = vp.sy(o.y);
          ctx.lineWidth = 3;
          ctx.strokeStyle = colors.halo;
          ctx.beginPath();
          ctx.moveTo(ox - 4, oy); ctx.lineTo(ox + 4, oy); ctx.moveTo(ox, oy - 4); ctx.lineTo(ox, oy + 4);
          ctx.stroke();
          ctx.lineWidth = 1;
          ctx.strokeStyle = colors.accent;
          ctx.stroke();
        } else {
          ctx.fillStyle = colors.accent;
          ctx.fillRect(x + w - 4, y + h - 4, 8, 8);
          ctx.lineWidth = 1;
          ctx.strokeStyle = colors.halo;
          ctx.strokeRect(x + w - 4.5, y + h - 4.5, 9, 9);
        }
      } else if (hovered) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = colors.hover;
        ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      }
      // Boxes always show their type (they look alike); sprites only when hovered or selected.
      if (!o.type) continue;
      if (b.sprite ? !(selected || hovered) : !layer.visible) continue;
      if (!b.sprite && !selected && !hovered && ctx.measureText(o.type).width > Math.max(w, 40) * 2.5) continue;
      ctx.globalAlpha = active || selected ? 1 : 0.6;
      label(o.type, x, y - (selected ? 3 : 2), b.sprite ? colors.fg : typeColor(o.type, colors));
      ctx.globalAlpha = 1;
    }
  }

  /** The object about to be placed, under the pointer. */
  drawPlaceGhost(ctx, vp, colors) {
    if (this.tool !== 'object' || !this.objectType || !this.hover || this.drag || vp.pan || this.layer?.type !== 'objects') return;
    const at = this.placement(this.objectType, this.hover, this.altDown);
    const b = this.objectBounds({ type: this.objectType, x: at.x, y: at.y, ...(at.typed ? {} : { width: this.map.tileWidth, height: this.map.tileHeight }) });
    if (b.sprite?.img?.bitmap) {
      const s = b.sprite;
      vp.worldTransform(ctx);
      ctx.globalAlpha = 0.55;
      ctx.drawImage(s.img.bitmap, (s.frame % s.columns) * s.frameWidth, Math.floor(s.frame / s.columns) * s.frameHeight,
        s.frameWidth, s.frameHeight, b.x, b.y, s.frameWidth, s.frameHeight);
      ctx.globalAlpha = 1;
    }
    vp.screenTransform(ctx);
    const x = vp.sx(b.x);
    const y = vp.sy(b.y);
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.accent;
    ctx.strokeRect(x - 0.5, y - 0.5, vp.sx(b.x + b.w) - x + 1, vp.sy(b.y + b.h) - y + 1);
    ctx.setLineDash([]);
  }

  drawPreview(ctx, vp, colors) {
    const m = this.map;
    const l = this.layer;
    const outline = (x0, y0, x1, y1, color = colors.accent) => {
      vp.screenTransform(ctx);
      const ax = vp.sx(Math.min(x0, x1) * m.tileWidth);
      const ay = vp.sy(Math.min(y0, y1) * m.tileHeight);
      const bx = vp.sx((Math.max(x0, x1) + 1) * m.tileWidth);
      const by = vp.sy((Math.max(y0, y1) + 1) * m.tileHeight);
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.halo;
      ctx.strokeRect(ax - 1.5, ay - 1.5, bx - ax + 3, by - ay + 3);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(ax, ay, bx - ax, by - ay);
      vp.worldTransform(ctx);
    };
    const ghost = (x0, y0, x1, y1, ox, oy) => {
      vp.worldTransform(ctx);
      ctx.globalAlpha = 0.6;
      for (let y = Math.max(0, y0); y <= Math.min(m.height - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(m.width - 1, x1); x++) {
          const g = this.patternAt(x, y, ox, oy);
          if (g >= 0 && g < this.tileCount) this.drawTile(ctx, g, x, y);
        }
      }
      ctx.globalAlpha = 1;
    };
    const d = this.drag;
    if (d?.kind === 'rect') {
      const x0 = Math.min(d.x0, d.x1); const y0 = Math.min(d.y0, d.y1);
      const x1 = Math.max(d.x0, d.x1); const y1 = Math.max(d.y0, d.y1);
      if (d.erase) {
        vp.worldTransform(ctx);
        ctx.fillStyle = colors.dangerFill;
        ctx.fillRect(x0 * m.tileWidth, y0 * m.tileHeight, (x1 - x0 + 1) * m.tileWidth, (y1 - y0 + 1) * m.tileHeight);
      } else ghost(x0, y0, x1, y1, x0, y0);
      outline(x0, y0, x1, y1, d.erase ? colors.danger : colors.accent);
      return;
    }
    if (d?.kind === 'pick') {
      outline(d.x0, d.y0, d.x1, d.y1);
      return;
    }
    if (!this.hover || !l || l.type !== 'tiles' || !TILE_TOOLS.includes(this.tool) || vp.pan) return;
    const c = this.cellAt(this.hover);
    if (!this.inside(c.x, c.y)) return;
    if (this.tool === 'brush' && !d?.erase) {
      const { w, h } = this.stamp;
      // While painting, the ghost snaps to the stroke's stamp grid.
      const ax = d ? d.ox + Math.floor((c.x - d.ox) / w) * w : c.x;
      const ay = d ? d.oy + Math.floor((c.y - d.oy) / h) * h : c.y;
      ghost(ax, ay, ax + w - 1, ay + h - 1, ax, ay);
      outline(ax, ay, ax + w - 1, ay + h - 1);
    } else if (this.tool === 'eraser' || d?.erase) outline(c.x, c.y, c.x, c.y, colors.danger);
    else outline(c.x, c.y, c.x, c.y);
  }

  // -------------------------------------------------------------------------
  // Keys

  handleKey(e) {
    if (e.__mapToolHandled) return true;
    if (!this.map || isTyping(e) || document.querySelector('dialog[open]')) return false;
    if (e.key === 'Alt' && !this.altDown) {
      // The placing ghost shows where Alt (off the grid) puts the object.
      this.altDown = true;
      this.vp.render();
      return false;
    }
    const mod = this.ui.isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let used = true;
    if (mod && key === 'z' && !e.shiftKey) this.undo();
    else if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) this.redo();
    else if (mod && key === 'd') used = this.duplicateObject();
    else if (mod || e.altKey) used = false;
    else if (e.code === 'Space') { if (!e.repeat) this.vp.setSpace(true); }
    else if (key === '#' || key === "'") this.toggleGrid();
    else if (key === '+' || key === '=') this.vp.step(1);
    else if (key === '-') this.vp.step(-1);
    else if (key === '0') this.vp.fit();
    else if (key === 'Escape') { this.drag = null; this.selected = null; this.refresh(); }
    else if ((key === 'Delete' || key === 'Backspace') && this.selected != null) used = this.deleteObject();
    else if (key.startsWith('Arrow') && this.selected != null) {
      const step = e.shiftKey ? { x: this.map.tileWidth, y: this.map.tileHeight } : { x: 1, y: 1 };
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
      used = this.nudge(dir[0] * step.x, dir[1] * step.y);
    } else if (key === '[' || key === ']') {
      if (this.tilesets.length > 1) {
        this.activeTileset = (this.activeTileset + (key === ']' ? 1 : -1) + this.tilesets.length) % this.tilesets.length;
        this.renderTilesetSection();
      }
    } else {
      const t = TOOLS.find((x) => x.key.toLowerCase() === key);
      if (t && !e.shiftKey) this.setTool(t.id);
      else used = false;
    }
    if (used) e.__mapToolHandled = true;
    return used;
  }

  // -------------------------------------------------------------------------
  // Tool instance interface

  markDirty() {
    this.dirty = true;
    this.host.setDirty(true);
  }

  async save() {
    if (!this.map) return;
    await this.host.write(this.path, mapText(this.map));
    this.dirty = false;
  }

  focus() { this.element.focus({ preventScroll: true }); }

  show() {
    this.vp.resize();
    if (this.tilesetSection.isConnected) this.layoutPalette();
  }

  hide() { this.vp.setSpace(false); }

  /** A project file changed outside this tab. */
  reload(path) {
    if (path === undefined || path === this.path) {
      // Changed by another tab (e.g. as text): take it, unless there are unsaved edits here.
      if (this.host.exists(this.path) && !this.dirty && !this.drag) this.load();
      return;
    }
    const affected = this.tilesets.some((t) => t.path === path || t.imagePath === path)
      || [...this.cache.values()].some((t) => t.path === path || t.imagePath === path);
    if (affected) this.reloadTileset(path);
    // Object scripts and their sprites: re-read the object types.
    if (this.types.affects(path)) {
      this.types.scan();
      if (this.map) this.refresh();
    }
  }

  destroy() {
    this.vp.destroy();
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onKeyUp);
    this.themeObserver.disconnect();
    cancelAnimationFrame(this.fieldsFrame);
  }
}
