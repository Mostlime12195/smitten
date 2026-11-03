// The tileset editor: tile size, the image as a grid of tiles, and per-tile
// properties ("solid" and free key/values). Opens .tileset.json files; the
// image itself is drawn in the pixel editor.

import { basename, joinPath, parseTileset, pngSize, relativePath, tilesetText } from './model.js';
import {
  History, Viewport, decodeImage, drawChecker, drawGrid, icon, iconButton, isTyping, numberInput, propertyEditor,
  themeColors,
} from './widgets.js';

export class TilesetEditor {
  constructor(host) {
    this.host = host;
    this.ui = host.ui;
    this.path = host.path;
    this.sel = null; // {x0, y0, x1, y1} in tiles
    this.hover = null;
    this.showGrid = true;
    this.showSolid = true;
    this.dirty = false;
    this.history = new History(() => this.updateToolbar());
    this.build();
    this.load();
  }

  load() {
    try {
      this.ts = parseTileset(this.host.read(this.path), this.path);
      this.error = null;
    } catch (e) {
      this.ts = null;
      this.error = e.message;
    }
    this.dirty = false;
    this.history.clear();
    this.loadImage();
    if (!this.sel && this.count) this.sel = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.vp.fitted = false;
    this.vp.fit();
    this.refresh();
  }

  loadImage() {
    this.imagePath = this.ts?.image ? joinPath(this.path, this.ts.image) : null;
    const bytes = this.imagePath ? this.host.read(this.imagePath) : undefined;
    const size = pngSize(bytes);
    this.imgW = size?.width || 0;
    this.imgH = size?.height || 0;
    this.imageError = !this.ts ? null
      : !this.ts.image ? 'Choose the image with this tileset\'s tiles.'
        : bytes === undefined ? `The image ${this.imagePath} doesn't exist.`
          : !size ? `${this.imagePath} isn't a PNG.` : null;
    this.bitmap = null;
    const token = (this.imageToken = {});
    if (size) {
      decodeImage(bytes).then((bmp) => {
        if (this.imageToken !== token) return;
        this.bitmap = bmp;
        this.vp.render();
      });
    }
  }

  get columns() { return this.ts ? Math.floor(this.imgW / this.ts.tileWidth) : 0; }
  get rows() { return this.ts ? Math.floor(this.imgH / this.ts.tileHeight) : 0; }
  get count() { return this.columns * this.rows; }

  // -------------------------------------------------------------------------
  // UI

  build() {
    const { h } = this.ui;
    this.toolbar = h('div', { class: 'mt-toolbar', role: 'toolbar', 'aria-label': 'Tileset' });
    this.undoBtn = iconButton(this.ui, { icon: 'undo', title: `Undo (${this.ui.modKey}+Z)`, onclick: () => this.undo() });
    this.redoBtn = iconButton(this.ui, { icon: 'redo', title: `Redo (${this.ui.modKey}+Shift+Z)`, onclick: () => this.redo() });
    this.gridBtn = iconButton(this.ui, { icon: 'grid', title: 'Grid (#)', onclick: () => { this.showGrid = !this.showGrid; this.updateToolbar(); this.vp.render(); }, pressed: true });
    this.solidBtn = iconButton(this.ui, { icon: 'solid', title: 'Show solid tiles', onclick: () => { this.showSolid = !this.showSolid; this.updateToolbar(); this.vp.render(); }, pressed: true });
    this.zoomLabel = h('span', { class: 'mt-zoom' }, '100%');
    this.sizeSlot = h('span', { style: { display: 'contents' } });
    this.imageSlot = h('span', { style: { display: 'contents' } });
    this.toolbar.append(
      this.sizeSlot, h('div', { class: 'mt-sep' }), this.imageSlot,
      h('div', { class: 'mt-sep' }), this.undoBtn, this.redoBtn,
      h('div', { class: 'mt-sep' }), this.gridBtn, this.solidBtn,
      iconButton(this.ui, { icon: 'zoomOut', title: 'Zoom out (-)', onclick: () => this.vp.step(-1) }),
      this.zoomLabel,
      iconButton(this.ui, { icon: 'zoomIn', title: 'Zoom in (+)', onclick: () => this.vp.step(1) }),
      iconButton(this.ui, { icon: 'fit', title: 'Fit (0)', onclick: () => this.vp.fit() }),
    );

    this.viewEl = h('div', { class: 'mt-viewport tool-select' });
    this.emptyEl = h('div', { class: 'mt-empty', hidden: true });
    this.viewEl.append(this.emptyEl);
    this.vp = new Viewport(this.viewEl, {
      draw: (ctx, vp) => this.draw(ctx, vp),
      onPointer: (type, e, w) => this.pointer(type, e, w),
      contentSize: () => ({ width: this.imgW || 128, height: this.imgH || 64 }),
      onZoom: (z) => { this.zoomLabel.textContent = `${Math.round(z * 100)}%`; },
    });
    this.statusPos = h('span');
    this.statusHint = h('span', { class: 'mt-hint' }, 'Click a tile, or drag over several, to edit their properties.');
    const status = h('div', { class: 'mt-status' }, this.statusPos, this.statusHint);
    this.side = h('div', { class: 'mt-side' });
    this.element = h('div', { class: 'mt-root', tabindex: '0' }, this.toolbar, this.viewEl, status, this.side);
    this.element.addEventListener('keydown', (e) => {
      if (this.handleKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.onKeyUp = (e) => { if (e.code === 'Space') this.vp.setSpace(false); };
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onKeyUp);
    this.themeObserver = new MutationObserver(() => this.vp.render());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  refresh() {
    this.renderToolbar();
    this.renderSide();
    this.updateToolbar();
    const { h } = this.ui;
    this.emptyEl.replaceChildren();
    const msg = this.error || this.imageError;
    this.emptyEl.hidden = !msg;
    if (msg) {
      const pngs = this.host.list().filter((p) => /\.png$/i.test(p));
      this.emptyEl.append(h('div', {},
        h('div', {}, msg),
        this.ts && pngs.length ? h('div', { class: 'mt-note' }, 'Pick an image in the toolbar.') : null));
    }
    this.vp.render();
  }

  renderToolbar() {
    const { h } = this.ui;
    this.sizeSlot.replaceChildren();
    this.imageSlot.replaceChildren();
    if (!this.ts) return;
    const size = (key) => numberInput(this.ui, {
      value: this.ts[key], min: 1, max: 512, title: key === 'tileWidth' ? 'Tile width' : 'Tile height', className: 'input small mt-num',
      onCommit: (n, input) => {
        n = Math.round(n);
        if (n < 1 || n > 512) { input.value = String(this.ts[key]); return; }
        this.change(() => { this.ts[key] = n; });
        this.sel = this.count ? { x0: 0, y0: 0, x1: 0, y1: 0 } : null;
        this.refresh();
      },
    });
    this.sizeSlot.append(h('span', { class: 'mt-label' }, 'Tile size'), size('tileWidth'), h('span', { class: 'mt-label' }, '×'), size('tileHeight'));
    const pngs = this.host.list().filter((p) => /\.png$/i.test(p)).sort();
    const select = h('select', { class: 'select small', 'aria-label': 'Image', title: 'The image with the tiles' },
      !this.imagePath || !pngs.includes(this.imagePath) ? h('option', { value: '' }, this.ts.image ? `${this.ts.image} (missing)` : 'Choose an image…') : null,
      pngs.map((p) => h('option', { value: p, selected: p === this.imagePath }, p)));
    select.addEventListener('change', () => {
      if (!select.value) return;
      const rel = relativePath(this.path, select.value);
      this.change(() => { this.ts.image = rel; });
      this.loadImage();
      this.sel = this.count ? { x0: 0, y0: 0, x1: 0, y1: 0 } : null;
      this.vp.fitted = false;
      this.vp.fit();
      this.refresh();
    });
    const edit = h('button', {
      type: 'button', class: 'btn ghost small', disabled: !this.imagePath || !this.host.exists(this.imagePath),
      title: 'Open the image in the pixel editor', onclick: () => this.host.openFile(this.imagePath),
    }, icon(this.ui, 'pencil', 14), 'Edit image');
    this.imageSlot.append(h('span', { class: 'mt-label' }, 'Image'), select, edit);
  }

  updateToolbar() {
    this.undoBtn.disabled = !this.history.done.length;
    this.redoBtn.disabled = !this.history.undone.length;
    this.gridBtn.setAttribute('aria-pressed', String(this.showGrid));
    this.solidBtn.setAttribute('aria-pressed', String(this.showSolid));
  }

  selectedTiles() {
    const s = this.sel;
    if (!s || !this.count) return [];
    const out = [];
    for (let y = Math.min(s.y0, s.y1); y <= Math.max(s.y0, s.y1); y++) {
      for (let x = Math.min(s.x0, s.x1); x <= Math.max(s.x0, s.x1); x++) {
        if (x < this.columns && y < this.rows) out.push(y * this.columns + x);
      }
    }
    return out;
  }

  renderSide() {
    const { h } = this.ui;
    this.side.replaceChildren();
    if (!this.ts) return;
    const info = h('div', { class: 'mt-section' },
      h('div', { class: 'mt-section-head' }, h('span', {}, basename(this.path))),
      h('div', { class: 'mt-section-body' },
        h('p', { class: 'mt-note' }, this.imgW
          ? `${this.columns} × ${this.rows} = ${this.count} tiles of ${this.ts.tileWidth} × ${this.ts.tileHeight} pixels, numbered from 0 left to right, then top to bottom.`
          : 'No image yet.'),
        this.imgW && (this.imgW % this.ts.tileWidth || this.imgH % this.ts.tileHeight)
          ? h('p', { class: 'mt-note warn' }, `The image (${this.imgW} × ${this.imgH}) isn't a whole number of tiles; the leftover edge isn't used.`) : null));
    this.side.append(info);

    const tiles = this.selectedTiles();
    const section = h('div', { class: 'mt-section grow' });
    this.side.append(section);
    if (!tiles.length) {
      section.append(h('div', { class: 'mt-section-head' }, h('span', {}, 'Tile')),
        h('div', { class: 'mt-section-body' }, h('p', { class: 'mt-note' }, 'Select a tile to edit its properties.')));
      return;
    }
    const title = tiles.length === 1 ? `Tile ${tiles[0]}` : `${tiles.length} tiles`;
    const solidCount = tiles.filter((t) => this.ts.tiles.get(t)?.solid).length;
    const solid = h('input', { type: 'checkbox', checked: solidCount === tiles.length });
    solid.indeterminate = solidCount > 0 && solidCount < tiles.length;
    solid.addEventListener('change', () => {
      const on = solid.checked;
      this.change(() => {
        for (const t of tiles) this.setProp(t, 'solid', on ? true : undefined);
      });
      this.refresh();
    });
    const body = h('div', { class: 'mt-section-body' },
      h('label', { class: 'mt-check', title: 'smitten.collide and level:isSolid treat solid tiles as walls and floors' }, solid, 'Solid'),
      h('p', { class: 'mt-note' }, 'Solid tiles block boxes moved with smitten.collide.move.'));
    if (tiles.length === 1) {
      const t = tiles[0];
      body.append(propertyEditor(this.ui, {
        props: this.ts.tiles.get(t) || {}, hidden: ['solid'],
        onCommit: (props) => {
          this.change(() => {
            const keep = this.ts.tiles.get(t)?.solid ? { solid: true } : {};
            const next = { ...keep, ...props };
            if (Object.keys(next).length) this.ts.tiles.set(t, next); else this.ts.tiles.delete(t);
          });
          this.vp.render();
        },
      }), h('p', { class: 'mt-note' }, 'Read them in code with level:tileProperties(tile) or tileset:properties(tile).'));
    } else {
      body.append(h('p', { class: 'mt-note' }, 'Select one tile to edit its other properties.'));
    }
    section.append(h('div', { class: 'mt-section-head' }, h('span', {}, title)), body);
  }

  setProp(t, key, value) {
    const p = { ...(this.ts.tiles.get(t) || {}) };
    if (value === undefined) delete p[key]; else p[key] = value;
    if (Object.keys(p).length) this.ts.tiles.set(t, p); else this.ts.tiles.delete(t);
  }

  // -------------------------------------------------------------------------
  // Undo

  snapshot() {
    return { ...this.ts, tiles: new Map([...this.ts.tiles].map(([k, v]) => [k, structuredClone(v)])), extra: { ...this.ts.extra } };
  }

  restore(s) {
    this.ts = { ...s, tiles: new Map([...s.tiles].map(([k, v]) => [k, structuredClone(v)])) };
    if (joinPath(this.path, this.ts.image) !== this.imagePath) this.loadImage();
  }

  change(fn) {
    const before = this.snapshot();
    fn();
    const after = this.snapshot();
    this.history.push({ undo: () => this.restore(before), redo: () => this.restore(after) });
    this.markDirty();
  }

  markDirty() {
    this.dirty = true;
    this.host.setDirty(true);
  }

  undo() { if (this.history.undo()) { this.markDirty(); this.refresh(); } }

  redo() { if (this.history.redo()) { this.markDirty(); this.refresh(); } }

  // -------------------------------------------------------------------------
  // Canvas

  pointer(type, e, w) {
    if (!this.ts || !this.count) return;
    const { tileWidth: tw, tileHeight: th } = this.ts;
    const x = Math.floor(w.x / tw);
    const y = Math.floor(w.y / th);
    const inside = x >= 0 && y >= 0 && x < this.columns && y < this.rows;
    const cx = Math.max(0, Math.min(this.columns - 1, x));
    const cy = Math.max(0, Math.min(this.rows - 1, y));
    if (type === 'leave') {
      this.hover = null;
      this.statusPos.textContent = '';
      this.vp.render();
      return;
    }
    this.hover = inside ? { x, y } : null;
    this.statusPos.textContent = inside ? `Tile ${y * this.columns + x} (column ${x}, row ${y})` : '';
    if (type === 'down' && e.button === 0) {
      if (e.shiftKey && this.sel) { this.sel.x1 = cx; this.sel.y1 = cy; } else this.sel = { x0: cx, y0: cy, x1: cx, y1: cy };
      this.dragging = true;
    } else if (type === 'move' && this.dragging) {
      this.sel.x1 = cx;
      this.sel.y1 = cy;
    } else if (type === 'up' && this.dragging) {
      this.dragging = false;
      this.renderSide();
    }
    this.vp.render();
  }

  draw(ctx, vp) {
    const colors = themeColors(this.element);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!this.ts || !this.imgW) return;
    const { tileWidth: tw, tileHeight: th } = this.ts;
    drawChecker(ctx, vp, this.imgW, this.imgH, colors);
    vp.worldTransform(ctx);
    if (this.bitmap) ctx.drawImage(this.bitmap, 0, 0);
    // Solid tiles: a red tint with diagonal stripes.
    if (this.showSolid) {
      vp.screenTransform(ctx);
      for (const [t, p] of this.ts.tiles) {
        if (!p?.solid || t >= this.count) continue;
        const x0 = vp.sx((t % this.columns) * tw);
        const y0 = vp.sy(Math.floor(t / this.columns) * th);
        const x1 = vp.sx((t % this.columns + 1) * tw);
        const y1 = vp.sy((Math.floor(t / this.columns) + 1) * th);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let d = -(y1 - y0); d < x1 - x0; d += 8) {
          ctx.moveTo(x0 + d, y1);
          ctx.lineTo(x0 + d + (y1 - y0), y0);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    // Tiles with other properties get a dot in the corner.
    vp.screenTransform(ctx);
    for (const [t, p] of this.ts.tiles) {
      if (t >= this.count || !Object.keys(p || {}).some((k) => k !== 'solid')) continue;
      const x = vp.sx((t % this.columns + 1) * tw);
      const y = vp.sy(Math.floor(t / this.columns) * th);
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(x - 5, y + 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.showGrid) drawGrid(ctx, vp, this.columns * tw, this.rows * th, tw, th, colors.grid);
    vp.screenTransform(ctx);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(vp.sx(0) - 0.5, vp.sy(0) - 0.5, vp.sx(this.imgW) - vp.sx(0) + 1, vp.sy(this.imgH) - vp.sy(0) + 1);
    const box = (x0, y0, x1, y1, color, width) => {
      const ax = vp.sx(Math.min(x0, x1) * tw);
      const ay = vp.sy(Math.min(y0, y1) * th);
      const bx = vp.sx((Math.max(x0, x1) + 1) * tw);
      const by = vp.sy((Math.max(y0, y1) + 1) * th);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(ax, ay, bx - ax, by - ay);
    };
    if (this.hover) box(this.hover.x, this.hover.y, this.hover.x, this.hover.y, colors.muted, 1);
    if (this.sel) {
      box(this.sel.x0, this.sel.y0, this.sel.x1, this.sel.y1, colors.dark ? '#000' : '#fff', 4);
      box(this.sel.x0, this.sel.y0, this.sel.x1, this.sel.y1, colors.accent, 2);
    }
    // Tile numbers when zoomed in enough.
    if (tw * vp.zoom >= 28 && th * vp.zoom >= 20) {
      ctx.font = `600 10px ${colors.font}`;
      ctx.textBaseline = 'top';
      const vis = vp.visible();
      for (let y = Math.max(0, Math.floor(vis.y0 / th)); y < Math.min(this.rows, Math.ceil(vis.y1 / th)); y++) {
        for (let x = Math.max(0, Math.floor(vis.x0 / tw)); x < Math.min(this.columns, Math.ceil(vis.x1 / tw)); x++) {
          const text = String(y * this.columns + x);
          const px = vp.sx(x * tw) + 3;
          const py = vp.sy(y * th) + 3;
          const m = ctx.measureText(text).width;
          ctx.fillStyle = colors.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)';
          ctx.fillRect(px - 2, py - 1, m + 4, 12);
          ctx.fillStyle = colors.fg;
          ctx.fillText(text, px, py);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Keys

  handleKey(e) {
    if (e.__mapToolHandled) return true;
    if (isTyping(e) || document.querySelector('dialog[open]')) return false;
    const mod = this.ui.isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let used = true;
    if (mod && key === 'z' && !e.shiftKey) this.undo();
    else if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) this.redo();
    else if (mod || e.altKey) used = false;
    else if (e.code === 'Space') { if (!e.repeat) this.vp.setSpace(true); }
    else if (key === '#' || key === "'") { this.showGrid = !this.showGrid; this.updateToolbar(); this.vp.render(); }
    else if (key === '+' || key === '=') this.vp.step(1);
    else if (key === '-') this.vp.step(-1);
    else if (key === '0') this.vp.fit();
    else if (key === 's' && this.selectedTiles().length) {
      // S toggles solid on the selection.
      const tiles = this.selectedTiles();
      const on = !tiles.every((t) => this.ts.tiles.get(t)?.solid);
      this.change(() => { for (const t of tiles) this.setProp(t, 'solid', on ? true : undefined); });
      this.refresh();
    } else if (key.startsWith('Arrow') && this.sel) {
      const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
      const x = Math.max(0, Math.min(this.columns - 1, this.sel.x1 + dx));
      const y = Math.max(0, Math.min(this.rows - 1, this.sel.y1 + dy));
      this.sel = e.shiftKey ? { ...this.sel, x1: x, y1: y } : { x0: x, y0: y, x1: x, y1: y };
      this.renderSide();
      this.vp.render();
    } else used = false;
    if (used) e.__mapToolHandled = true;
    return used;
  }

  // -------------------------------------------------------------------------
  // Tool instance interface

  async save() {
    if (!this.ts) return;
    await this.host.write(this.path, tilesetText(this.ts));
    this.dirty = false;
  }

  focus() { this.element.focus({ preventScroll: true }); }

  show() { this.vp.resize(); }

  hide() { this.vp.setSpace(false); }

  reload(path) {
    if (path === undefined || path === this.path) {
      if (this.host.exists(this.path) && !this.dirty) this.load();
      return;
    }
    if (path === this.imagePath || /\.png$/i.test(path)) {
      const before = this.count;
      this.loadImage();
      if (this.count !== before) this.sel = this.count ? { x0: 0, y0: 0, x1: 0, y1: 0 } : null;
      if (!this.imgW || before === 0) { this.vp.fitted = false; this.vp.fit(); }
      this.refresh();
    }
  }

  destroy() {
    this.vp.destroy();
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onKeyUp);
    this.themeObserver.disconnect();
  }
}
