// The tile panel, shown below the scene view while a Tiles piece is selected:
// the tileset's tiles to pick from, the painting tools, and a small tileset
// editor (solid, one-way and a name per tile, saved in the .tileset file).
//
// It paints through the viewport: Viewport2D calls paintDown / paintMove /
// paintUp / paintHover / paintOverlay / paintKey / paintCancel on it while
// its tool is 'paint'. Painting changes the node's `cells` property through
// the doc, one undo step per stroke.

import { decodeCells, cellsValue, cellKey, cellBounds } from './cells.js';
import { Gesture, dirOf, relativePath, normalizePath, cssVarColor, rgba } from './viewport2d.js';

const TOOLS = [
  { id: 'paint', label: 'Paint', key: 'B', hint: 'Paint with the picked tiles' },
  { id: 'erase', label: 'Erase', key: 'E', hint: 'Erase tiles (Shift-drag: a rectangle)' },
  { id: 'rect', label: 'Rectangle', key: 'U', hint: 'Drag to fill a rectangle with the picked tiles' },
  { id: 'bucket', label: 'Bucket fill', key: 'G', hint: 'Fill the connected area of the same tile' },
  { id: 'pick', label: 'Pick', key: 'I', hint: 'Drag over the map to paint with those tiles (or Alt-drag with any tool)' },
];
const KEYS = { b: 'paint', e: 'erase', u: 'rect', g: 'bucket', i: 'pick' };

const ICONS = {
  paint: '<path d="M10.5 2.5l3 3-6.5 6.5-3-3z"/><path d="M4 9l3 3-1.5 1.5c-.8.8-2.5 1-3.5 1 0-1 .2-2.7 1-3.5z"/>',
  erase: '<path d="M6 13.5h7.5"/><path d="M2.8 9.7l6-6a1.4 1.4 0 0 1 2 0l2.5 2.5a1.4 1.4 0 0 1 0 2l-5.3 5.3H6.2L2.8 10.1a.3.3 0 0 1 0-.4z"/><path d="M5.5 7l4.5 4.5"/>',
  rect: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M5 6.5h6M5 9.5h6"/>',
  bucket: '<path d="M3 7.5L8 2.5l5 5-5 5z"/><path d="M3 7.5h10"/><path d="M14 10.5c0 1-.6 2-1.3 2s-1.2-1-1.2-2c0-.8 1.2-2.2 1.2-2.2s1.3 1.4 1.3 2.2z"/>',
  pick: '<path d="M9.5 3.5l3 3"/><path d="M11 2a1.4 1.4 0 0 1 2 2l-1.5 1.5-2-2z"/><path d="M10 5.5L4 11.5l-1.5 2.5 2.5-1.5 6-6"/>',
  minus: '<path d="M4 8h8"/>',
  plus: '<path d="M4 8h8M8 4v8"/>',
};

const IMAGE_RE = /\.(png|jpe?g|gif|bmp|webp)$/i;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function icon(name) {
  const span = document.createElement('span');
  span.className = 'tmp-icon';
  span.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

export class TilesPanel {
  constructor(container, { doc, project, viewport }) {
    this.container = container;
    this._doc = null;
    this._viewport = null;
    this.viewportCleanup = [];
    this.project = project;
    this.node = null;
    this.tool = 'paint';
    this.prevTool = 'select';
    this.sel = { x0: 0, y0: 0, x1: 0, y1: 0 }; // palette selection, in tiles
    this.stamp = { w: 1, h: 1, tiles: [0] };
    this.zoom = 0; // palette zoom; 0 = pick one from the tile size
    this.mode = 'tiles'; // or 'new': the new tileset form
    this.drag = null;
    this.hover = null;
    this.paletteHover = null;
    this.cleanup = [];
    this.root = h('div', { class: 'tmp', tabindex: '-1' });
    container.append(this.root);
    // Tile tool keys work here too (after picking tiles in the palette).
    this.listen(this.root, 'keydown', (e) => {
      const t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (this.viewport && this.paintKey(e, this.viewport.tool === 'paint')) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.onDocChange = () => this.docChanged();
    this.listen(project, 'file', (e) => this.fileChanged(e.detail || {}));
    this.viewport = viewport;
    this.doc = doc;
    this.render();
  }

  listen(target, type, fn, list = this.cleanup) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn);
    list.push(() => target.removeEventListener(type, fn));
  }

  get doc() {
    return this._doc;
  }

  /** Assigning doc (or calling setDoc) moves the panel to another open scene. */
  set doc(doc) {
    this.setDoc(doc);
  }

  setDoc(doc) {
    if (this._doc === doc) return;
    this.cancelStroke();
    this._doc?.removeEventListener('change', this.onDocChange);
    this._doc = doc || null;
    this._doc?.addEventListener('change', this.onDocChange);
    this.node = null;
    this.render();
  }

  get viewport() {
    return this._viewport;
  }

  /** The Viewport2D it paints in (it registers itself as the viewport's painter). */
  set viewport(vp) {
    if (vp === this._viewport) return;
    this.cancelStroke();
    for (const fn of this.viewportCleanup) fn();
    this.viewportCleanup = [];
    if (this._viewport?.painter === this) this._viewport.setPainter(null);
    this._viewport = vp || null;
    this.assets = vp?.assets || null;
    if (!vp) return;
    this.listen(this.assets, 'load', () => {
      if (this.mode === 'new') this.newFormUpdate?.();
      else {
        this.drawPalette();
        this.updateInfo();
      }
    }, this.viewportCleanup);
    this.listen(vp.root, 'viewport-tool', () => this.updateTools(), this.viewportCleanup);
    vp.setPainter(this);
    if (this.root) this.render();
  }

  /** The selected Tiles node, or null. */
  setNode(node) {
    if (node === this.node) return;
    this.cancelStroke();
    const before = this.node ? this.tilesetPath() : null;
    this.node = node || null;
    this.mode = 'tiles';
    if (!this.node) {
      if (this.viewport?.tool === 'paint') this.viewport.setTool(this.prevTool || 'select');
    } else if (this.tilesetPath() !== before) {
      this.sel = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.stamp = { w: 1, h: 1, tiles: [0] };
    }
    this.render();
    this.viewport?.redraw();
  }

  dispose() {
    this.cancelStroke();
    if (this.viewport?.painter === this && this.viewport.tool === 'paint') this.viewport.setTool(this.prevTool || 'select');
    this.viewport = null;
    this.doc = null;
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    this.paletteObserver?.disconnect();
    this.root.remove();
  }

  // -------------------------------------------------------------------------
  // State

  tilesetPath() {
    return this.node && this.doc ? normalizePath(this.doc.get(this.node, 'tileset') || '') : '';
  }

  tileset() {
    const p = this.tilesetPath();
    return p && this.assets ? this.assets.tileset(p) : null;
  }

  paths() {
    try {
      if (this.project?.paths) return this.project.paths();
      if (this.project?.files) return [...this.project.files.keys()].sort();
    } catch {
      // fall through
    }
    return [];
  }

  docChanged() {
    if (!this.node) return;
    // The node may have been deleted, or its tileset changed.
    let inDoc = false;
    this.doc.walk((n) => {
      if (n === this.node) inDoc = true;
      return inDoc ? false : undefined;
    });
    if (!inDoc) {
      this.node = null;
      this.render();
      return;
    }
    const path = this.tilesetPath();
    if (path !== this.renderedTileset) this.render();
  }

  fileChanged({ path, from }) {
    const ts = this.tileset();
    const mine = ts && (path === ts.path || path === ts.imagePath || from === ts.path);
    if (mine || /\.tileset$/i.test(path || '') || IMAGE_RE.test(path || '')) {
      // The viewport has forgotten the old file (it listened first); show it again.
      if (this.mode === 'new') this.renderNewForm(true);
      else this.render();
    }
  }

  selectedTiles() {
    const ts = this.tileset();
    const s = this.sel;
    if (!ts || !s || !ts.columns) return [];
    const out = [];
    for (let y = Math.min(s.y0, s.y1); y <= Math.max(s.y0, s.y1); y++) {
      for (let x = Math.min(s.x0, s.x1); x <= Math.max(s.x0, s.x1); x++) {
        if (x < ts.columns && y < ts.rows) out.push(y * ts.columns + x);
      }
    }
    return out;
  }

  stampFromSelection() {
    const ts = this.tileset();
    const s = this.sel;
    if (!ts || !s || !ts.columns) return;
    const x0 = Math.min(s.x0, s.x1);
    const y0 = Math.min(s.y0, s.y1);
    const w = Math.abs(s.x1 - s.x0) + 1;
    const hh = Math.abs(s.y1 - s.y0) + 1;
    const tiles = [];
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) tiles.push((y0 + j) * ts.columns + x0 + i);
    this.stamp = { w, h: hh, tiles };
  }

  hasStamp() {
    const ts = this.tileset();
    return !!ts && this.stamp.tiles.some((t) => t >= 0 && (!ts.count || t < ts.count));
  }

  setTool(id) {
    if (!this.viewport || !TOOLS.some((t) => t.id === id)) return;
    this.tool = id;
    if (this.viewport.tool !== 'paint') {
      this.prevTool = this.viewport.tool;
      this.viewport.setTool('paint');
    }
    this.updateTools();
    this.viewport.redraw();
  }

  // -------------------------------------------------------------------------
  // Rendering

  render() {
    this.root.replaceChildren();
    this.paletteObserver?.disconnect();
    this.palette = null;
    this.renderedTileset = this.tilesetPath();
    if (!this.viewport) {
      this.root.append(h('div', { class: 'tmp-empty' }, 'Tiles are painted in the scene view.'));
      return;
    }
    if (!this.node) {
      this.root.append(h('div', { class: 'tmp-empty' }, 'Select a Tiles piece to paint its tiles.'));
      return;
    }
    if (this.mode === 'new') {
      this.renderNewForm();
      return;
    }
    const path = this.tilesetPath();
    const ts = path ? this.tileset() : null;
    if (!path || !ts) {
      this.renderSetup(path);
      return;
    }
    this.renderTiles(ts);
  }

  renderSetup(path) {
    const files = this.paths().filter((p) => /\.tileset$/i.test(p));
    const missing = path && !this.project?.has?.(path);
    const intro = path
      ? h('div', { class: 'tmp-setup-text' },
        h('strong', {}, missing ? `The tileset ${path} doesn't exist.` : `${path} isn't a tileset file.`),
        h('p', {}, 'Pick another tileset, or make a new one from an image.'))
      : h('div', { class: 'tmp-setup-text' },
        h('strong', {}, 'This Tiles has no tileset yet.'),
        h('p', {}, 'A tileset is an image cut into tiles, saved as a .tileset file. Pick one to paint with, or make one from an image in the project.'));
    const list = h('div', { class: 'tmp-list', role: 'list' });
    for (const f of files) {
      list.append(h('button', {
        type: 'button', class: 'tmp-list-item', role: 'listitem', title: `Paint with ${f}`,
        onclick: () => this.useTileset(f),
      }, h('span', { class: 'tmp-list-name' }, f.split('/').pop()), h('span', { class: 'tmp-list-path' }, dirOf(f))));
    }
    if (!files.length) list.append(h('p', { class: 'tmp-note' }, 'There are no .tileset files in the project yet.'));
    this.root.append(h('div', { class: 'tmp-setup' },
      intro,
      list,
      h('div', { class: 'tmp-actions' },
        h('button', { type: 'button', class: 'tmp-btn tmp-primary', onclick: () => this.openNewForm() }, 'New tileset from image…'))));
  }

  useTileset(path) {
    if (!this.node) return;
    this.doc.setProps(this.node, { tileset: path }, { label: 'Set tileset' });
    this.sel = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.stamp = { w: 1, h: 1, tiles: [0] };
    this.mode = 'tiles';
    this.render();
  }

  renderTiles(ts) {
    // Toolbar
    const tools = h('div', { class: 'tmp-tools', role: 'toolbar', 'aria-label': 'Tile tools' });
    this.toolButtons = {};
    for (const t of TOOLS) {
      const b = h('button', {
        type: 'button', class: 'tmp-tool', title: `${t.label} (${t.key}) — ${t.hint}`, 'aria-label': t.label,
        onclick: () => this.setTool(t.id),
      }, icon(t.id), h('span', { class: 'tmp-tool-label' }, t.label));
      this.toolButtons[t.id] = b;
      tools.append(b);
    }
    const files = this.paths().filter((p) => /\.tileset$/i.test(p));
    const select = h('select', { class: 'tmp-select', title: 'The tileset this Tiles paints with', 'aria-label': 'Tileset' });
    for (const f of files) select.append(h('option', { value: f, selected: f === ts.path }, f));
    if (!files.includes(ts.path)) select.prepend(h('option', { value: ts.path, selected: true }, ts.path));
    select.append(h('option', { value: '__new' }, 'New tileset from image…'));
    select.addEventListener('change', () => {
      if (select.value === '__new') {
        select.value = ts.path;
        this.openNewForm();
      } else this.useTileset(select.value);
    });
    this.infoEl = h('span', { class: 'tmp-info' });
    this.zoomLabel = h('span', { class: 'tmp-zoom' });
    const bar = h('div', { class: 'tmp-bar' },
      tools,
      h('span', { class: 'tmp-sep' }),
      h('label', { class: 'tmp-field' }, h('span', {}, 'Tileset'), select),
      h('span', { class: 'tmp-spacer' }),
      this.infoEl,
      h('span', { class: 'tmp-sep' }),
      h('button', { type: 'button', class: 'tmp-icon-btn', title: 'Zoom out (Ctrl+wheel)', 'aria-label': 'Zoom out', onclick: () => this.setZoom(this.paletteZoom() / 2) }, icon('minus')),
      this.zoomLabel,
      h('button', { type: 'button', class: 'tmp-icon-btn', title: 'Zoom in (Ctrl+wheel)', 'aria-label': 'Zoom in', onclick: () => this.setZoom(this.paletteZoom() * 2) }, icon('plus')));

    // Palette
    const canvas = h('canvas', { class: 'tmp-palette', 'aria-label': 'Tiles: click one, or drag over several, to paint with them' });
    const wrap = h('div', { class: 'tmp-palette-wrap' }, canvas);
    this.palette = { canvas, wrap, g: canvas.getContext('2d') };
    canvas.addEventListener('pointerdown', (e) => this.palettePointer('down', e));
    canvas.addEventListener('pointermove', (e) => this.palettePointer('move', e));
    canvas.addEventListener('pointerup', (e) => this.palettePointer('up', e));
    canvas.addEventListener('pointerleave', () => {
      this.paletteHover = null;
      this.drawPalette();
      this.updateInfo();
    });
    wrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.paletteZoom() * (e.deltaY < 0 ? 2 : 0.5));
    }, { passive: false });
    if (typeof ResizeObserver !== 'undefined') {
      this.paletteObserver = new ResizeObserver(() => this.drawPalette());
      this.paletteObserver.observe(wrap);
    }

    this.propsEl = h('div', { class: 'tmp-props' });
    this.root.append(bar, h('div', { class: 'tmp-body' }, wrap, this.propsEl));
    this.updateTools();
    this.renderProps();
    this.drawPalette();
    this.updateInfo();
  }

  updateTools() {
    if (!this.toolButtons) return;
    const painting = this.viewport.tool === 'paint';
    for (const [id, b] of Object.entries(this.toolButtons)) b.setAttribute('aria-pressed', String(painting && id === this.tool));
  }

  updateInfo() {
    if (!this.infoEl) return;
    const ts = this.tileset();
    if (!ts) return;
    let text = '';
    if (this.paletteHover) {
      const { x, y } = this.paletteHover;
      text = `Tile ${y * ts.columns + x}`;
    } else if (ts.img?.status === 'missing') text = `Image ${ts.imagePath || '(none)'} not found`;
    else if (!ts.count) text = ts.img?.status === 'loading' ? 'Loading…' : 'No tiles';
    else {
      const tiles = this.selectedTiles();
      text = tiles.length === 1 ? `Tile ${tiles[0]}` : tiles.length ? `${this.stamp.w} × ${this.stamp.h} tiles` : `Picked ${this.stamp.w} × ${this.stamp.h} from the map`;
    }
    text += ts.count ? ` · ${ts.columns} × ${ts.rows} tiles of ${ts.tileWidth} × ${ts.tileHeight}` : '';
    this.infoEl.textContent = text;
    this.zoomLabel.textContent = `${Math.round(this.paletteZoom() * 100)}%`;
  }

  paletteZoom() {
    if (this.zoom) return this.zoom;
    const ts = this.tileset();
    const tw = ts?.tileWidth || 16;
    return Math.max(1, Math.min(8, Math.round(32 / tw)));
  }

  setZoom(z) {
    this.zoom = Math.max(0.25, Math.min(16, z));
    this.drawPalette();
    this.updateInfo();
  }

  colors() {
    const el = this.root;
    return {
      accent: rgba(cssVarColor(el, '--accent', '#41a6f6')),
      fg: cssVarColor(el, '--fg', '#f4f4f4'),
      danger: cssVarColor(el, '--danger', '#e0606e'),
      bg: cssVarColor(el, '--bg', '#1a1c2c'),
    };
  }

  drawPalette() {
    const p = this.palette;
    const ts = this.tileset();
    if (!p || !ts) return;
    const z = this.paletteZoom();
    const dpr = window.devicePixelRatio || 1;
    const img = ts.img;
    const iw = img?.w || 0;
    const ih = img?.h || 0;
    const w = Math.max(1, Math.round(iw * z));
    const hh = Math.max(1, Math.round(ih * z));
    p.canvas.style.width = `${w}px`;
    p.canvas.style.height = `${hh}px`;
    p.canvas.width = Math.round(w * dpr);
    p.canvas.height = Math.round(hh * dpr);
    const g = p.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, p.canvas.width, p.canvas.height);
    if (img?.status !== 'ready') return;
    const c = this.colors();
    g.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
    g.imageSmoothingEnabled = z < 1;
    g.drawImage(img.bitmap, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tw = ts.tileWidth * z;
    const th = ts.tileHeight * z;
    const cell = (t) => [(t % ts.columns) * tw, Math.floor(t / ts.columns) * th];
    // Tile properties: solid (hatched), one-way (a bar on top), named (a dot).
    for (const [k, props] of Object.entries(ts.tiles)) {
      const t = Number(k);
      if (!(t >= 0 && t < ts.count)) continue;
      const [x, y] = cell(t);
      if (props.solid) {
        g.save();
        g.beginPath();
        g.rect(x, y, tw, th);
        g.clip();
        g.fillStyle = rgba(c.danger, 0.2);
        g.fillRect(x, y, tw, th);
        g.beginPath();
        for (let d = -th; d < tw; d += 6) {
          g.moveTo(x + d, y + th);
          g.lineTo(x + d + th, y);
        }
        g.strokeStyle = rgba(c.danger, 0.6);
        g.lineWidth = 1;
        g.stroke();
        g.restore();
      }
      if (props.oneWay) {
        g.fillStyle = rgba(c.danger, 0.9);
        g.fillRect(x + 1, y + 1, tw - 2, Math.max(2, th / 8));
      }
      if (props.name) {
        g.beginPath();
        g.arc(x + tw - 5, y + th - 5, 2.5, 0, Math.PI * 2);
        g.fillStyle = c.accent;
        g.fill();
      }
    }
    // Grid
    if (tw >= 6 && th >= 6) {
      g.beginPath();
      for (let i = 0; i <= ts.columns; i++) {
        const x = Math.round(i * tw * dpr) / dpr + 0.5 / dpr;
        g.moveTo(x, 0);
        g.lineTo(x, ts.rows * th);
      }
      for (let j = 0; j <= ts.rows; j++) {
        const y = Math.round(j * th * dpr) / dpr + 0.5 / dpr;
        g.moveTo(0, y);
        g.lineTo(ts.columns * tw, y);
      }
      g.lineWidth = 1 / dpr;
      g.strokeStyle = rgba(c.fg, 0.18);
      g.stroke();
    }
    const box = (s, color, width) => {
      const x0 = Math.min(s.x0, s.x1) * tw;
      const y0 = Math.min(s.y0, s.y1) * th;
      const x1 = (Math.max(s.x0, s.x1) + 1) * tw;
      const y1 = (Math.max(s.y0, s.y1) + 1) * th;
      g.lineWidth = width + 2;
      g.strokeStyle = rgba(c.bg, 0.7);
      g.strokeRect(x0 + width / 2, y0 + width / 2, x1 - x0 - width, y1 - y0 - width);
      g.lineWidth = width;
      g.strokeStyle = color;
      g.strokeRect(x0 + width / 2, y0 + width / 2, x1 - x0 - width, y1 - y0 - width);
    };
    if (this.paletteHover) box({ x0: this.paletteHover.x, y0: this.paletteHover.y, x1: this.paletteHover.x, y1: this.paletteHover.y }, rgba(c.fg, 0.7), 1);
    if (this.sel) box(this.sel, c.accent, 2);
  }

  palettePointer(type, e) {
    const ts = this.tileset();
    if (!ts?.count || !this.palette) return;
    const r = this.palette.canvas.getBoundingClientRect();
    const z = this.paletteZoom();
    const x = Math.floor((e.clientX - r.left) / (ts.tileWidth * z));
    const y = Math.floor((e.clientY - r.top) / (ts.tileHeight * z));
    const inside = x >= 0 && y >= 0 && x < ts.columns && y < ts.rows;
    const cx = Math.max(0, Math.min(ts.columns - 1, x));
    const cy = Math.max(0, Math.min(ts.rows - 1, y));
    this.paletteHover = inside ? { x, y } : null;
    if (type === 'down' && e.button === 0) {
      this.root.focus({ preventScroll: true });
      try {
        this.palette.canvas.setPointerCapture(e.pointerId);
      } catch {
        // not a live pointer
      }
      if (e.shiftKey && this.sel) this.sel = { ...this.sel, x1: cx, y1: cy };
      else this.sel = { x0: cx, y0: cy, x1: cx, y1: cy };
      this.paletteDrag = true;
    } else if (type === 'move' && this.paletteDrag) {
      this.sel = { ...this.sel, x1: cx, y1: cy };
    } else if (type === 'up' && this.paletteDrag) {
      this.paletteDrag = false;
      this.stampFromSelection();
      // Picking tiles means painting with them next.
      if (this.tool === 'erase' || this.tool === 'pick') this.tool = 'paint';
      this.setTool(this.tool);
      this.renderProps();
    }
    this.drawPalette();
    this.updateInfo();
  }

  // Tile properties ----------------------------------------------------------

  renderProps() {
    const el = this.propsEl;
    if (!el) return;
    el.replaceChildren();
    const ts = this.tileset();
    const tiles = this.selectedTiles();
    if (!ts || !tiles.length) {
      el.append(h('p', { class: 'tmp-note' }, ts?.count ? 'Pick tiles to see their properties.' : 'Tile properties show here once the tileset has tiles.'));
      return;
    }
    const all = (key) => tiles.every((t) => ts.tiles[t]?.[key]);
    const some = (key) => tiles.some((t) => ts.tiles[t]?.[key]);
    const check = (key, label, title) => {
      const input = h('input', { type: 'checkbox' });
      input.checked = all(key);
      input.indeterminate = !input.checked && some(key);
      input.addEventListener('change', () => {
        const on = input.checked;
        this.updateTiles(tiles, (p) => {
          if (on) p[key] = true;
          else delete p[key];
        });
      });
      return h('label', { class: 'tmp-check', title }, input, h('span', {}, label));
    };
    el.append(
      h('div', { class: 'tmp-props-title' }, tiles.length === 1 ? `Tile ${tiles[0]}` : `${tiles.length} tiles`),
      check('solid', 'Solid', 'Bodies can\'t pass this tile (when the Tiles piece is solid)'),
      check('oneWay', 'One-way', 'Bodies pass up through it and land on top of it; needs Solid'),
    );
    if (tiles.length === 1) {
      const t = tiles[0];
      const input = h('input', { type: 'text', class: 'tmp-input', value: ts.tiles[t]?.name || '', placeholder: 'None', spellcheck: 'false' });
      const commit = () => {
        const v = input.value.trim();
        if (v === (ts.tiles[t]?.name || '')) return;
        this.updateTiles([t], (p) => {
          if (v) p.name = v;
          else delete p.name;
        });
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        e.stopPropagation();
      });
      el.append(h('label', { class: 'tmp-field tmp-field-col', title: 'Read it in scripts with tilemap:getTileProperties(tile).name' }, h('span', {}, 'Name'), input));
    }
    el.append(h('p', { class: 'tmp-note' }, `Saved in ${ts.path.split('/').pop()}.`));
  }

  /** Changes the properties of tiles in the .tileset file. */
  updateTiles(tiles, fn) {
    const ts = this.tileset();
    if (!ts) return;
    let data;
    try {
      data = JSON.parse(this.project.readText(ts.path));
    } catch {
      return;
    }
    const map = { ...(data.tiles || {}) };
    for (const t of tiles) {
      const p = { ...(map[String(t)] || {}) };
      fn(p);
      if (Object.keys(p).length) map[String(t)] = p;
      else delete map[String(t)];
    }
    const sorted = {};
    for (const k of Object.keys(map).sort((a, b) => Number(a) - Number(b))) sorted[k] = map[k];
    data.tiles = sorted;
    this.project.write(ts.path, `${JSON.stringify(data, null, 2)}\n`);
  }

  // New tileset ---------------------------------------------------------------

  openNewForm() {
    this.mode = 'new';
    this.newForm = null;
    this.render();
  }

  renderNewForm(keep = false) {
    const images = this.paths().filter((p) => IMAGE_RE.test(p));
    const prev = keep && this.newForm ? this.newForm : null;
    const state = prev || {
      image: images.find((p) => /tile/i.test(p)) || images[0] || '',
      tw: 16,
      th: 16,
      path: '',
      pathEdited: false,
    };
    this.newForm = state;
    const suggest = () => {
      if (!state.image) return '';
      const dir = dirOf(state.image);
      const base = state.image.split('/').pop().replace(/\.[^.]*$/, '');
      let p = `${dir ? `${dir}/` : ''}${base}.tileset`;
      for (let i = 2; this.project?.has?.(p); i++) p = `${dir ? `${dir}/` : ''}${base}${i}.tileset`;
      return p;
    };
    if (!state.pathEdited) state.path = suggest();
    this.root.replaceChildren();
    if (!images.length) {
      this.root.append(h('div', { class: 'tmp-setup' },
        h('div', { class: 'tmp-setup-text' }, h('strong', {}, 'There are no images in the project.'),
          h('p', {}, 'Add or draw an image with your tiles (in a grid of equal squares), then make a tileset from it.')),
        h('div', { class: 'tmp-actions' }, h('button', { type: 'button', class: 'tmp-btn', onclick: () => this.closeNewForm() }, 'Back'))));
      return;
    }
    const imageSel = h('select', { class: 'tmp-select', 'aria-label': 'Image' });
    for (const p of images) imageSel.append(h('option', { value: p, selected: p === state.image }, p));
    const num = (value, label) => h('input', { type: 'number', class: 'tmp-input tmp-num', min: '1', max: '1024', step: '1', value: String(value), 'aria-label': label });
    const twIn = num(state.tw, 'Tile width');
    const thIn = num(state.th, 'Tile height');
    const pathIn = h('input', { type: 'text', class: 'tmp-input', value: state.path, spellcheck: 'false', 'aria-label': 'Save as' });
    const note = h('p', { class: 'tmp-note' });
    const error = h('p', { class: 'tmp-error', hidden: true });
    const preview = h('canvas', { class: 'tmp-new-preview' });
    const create = h('button', { type: 'submit', class: 'tmp-btn tmp-primary' }, 'Create tileset');
    const update = () => {
      const img = this.assets.image(state.image);
      if (img?.status === 'ready') {
        const cols = Math.floor(img.w / state.tw);
        const rows = Math.floor(img.h / state.th);
        note.textContent = cols && rows
          ? `${cols} × ${rows} = ${cols * rows} tiles${img.w % state.tw || img.h % state.th ? ` (the image is ${img.w} × ${img.h}; the leftover edge isn't used)` : ''}`
          : `The image (${img.w} × ${img.h}) is smaller than one tile.`;
        this.drawPreview(preview, img, state.tw, state.th);
      } else note.textContent = img?.status === 'loading' ? 'Loading the image…' : `Can't read ${state.image}.`;
    };
    imageSel.addEventListener('change', () => {
      state.image = imageSel.value;
      if (!state.pathEdited) {
        state.path = suggest();
        pathIn.value = state.path;
      }
      update();
    });
    const readSize = () => {
      state.tw = Math.max(1, Math.min(1024, Math.round(Number(twIn.value)) || 16));
      state.th = Math.max(1, Math.min(1024, Math.round(Number(thIn.value)) || 16));
      update();
    };
    twIn.addEventListener('input', readSize);
    thIn.addEventListener('input', readSize);
    pathIn.addEventListener('input', () => {
      state.path = pathIn.value.trim();
      state.pathEdited = true;
    });
    const form = h('form', { class: 'tmp-new' },
      h('div', { class: 'tmp-new-fields' },
        h('div', { class: 'tmp-props-title' }, 'New tileset from image'),
        h('label', { class: 'tmp-field tmp-field-col' }, h('span', {}, 'Image'), imageSel),
        h('div', { class: 'tmp-field tmp-field-col' }, h('span', {}, 'Tile size'), h('div', { class: 'tmp-row' }, twIn, h('span', { class: 'tmp-times' }, '×'), thIn, h('span', { class: 'tmp-unit' }, 'px'))),
        h('label', { class: 'tmp-field tmp-field-col' }, h('span', {}, 'Save as'), pathIn),
        note, error,
        h('div', { class: 'tmp-actions' }, create, h('button', { type: 'button', class: 'tmp-btn', onclick: () => this.closeNewForm() }, 'Cancel'))),
      h('div', { class: 'tmp-new-preview-wrap' }, preview));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      readSize();
      let path = normalizePath(state.path);
      if (path && !/\.tileset$/i.test(path)) path += '.tileset';
      const fail = (msg) => {
        error.textContent = msg;
        error.hidden = false;
      };
      if (!path) return fail('Choose a name for the tileset file.');
      if (this.project?.has?.(path)) return fail(`${path} already exists. Choose another name.`);
      const data = { format: 'smitten.tileset', version: 1, image: relativePath(path, state.image), tileWidth: state.tw, tileHeight: state.th, tiles: {} };
      this.mode = 'tiles';
      this.newForm = null;
      this.newFormUpdate = null;
      this.project.write(path, `${JSON.stringify(data, null, 2)}\n`);
      this.useTileset(path);
      return undefined;
    });
    form.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.append(form);
    this.newFormUpdate = update;
    update();
  }

  closeNewForm() {
    this.mode = 'tiles';
    this.newForm = null;
    this.newFormUpdate = null;
    this.render();
  }

  drawPreview(canvas, img, tw, th) {
    const max = 220;
    const z = Math.min(4, max / Math.max(img.w, img.h)) || 1;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(img.w * z);
    const hh = Math.round(img.h * z);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hh}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hh * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
    g.imageSmoothingEnabled = z < 1;
    g.drawImage(img.bitmap, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = this.colors();
    g.beginPath();
    for (let x = 0; x <= img.w; x += tw) {
      g.moveTo(x * z, 0);
      g.lineTo(x * z, hh);
    }
    for (let y = 0; y <= img.h; y += th) {
      g.moveTo(0, y * z);
      g.lineTo(w, y * z);
    }
    g.lineWidth = 1;
    g.strokeStyle = c.accent;
    g.globalAlpha = 0.6;
    g.stroke();
  }

  // -------------------------------------------------------------------------
  // Painting (called by the viewport)

  cells() {
    return decodeCells(this.doc.get(this.node, 'cells'));
  }

  beginStroke(label) {
    this.work = this.cells();
    this.gesture = new Gesture(this.doc, label);
  }

  setCell(cx, cy, t) {
    const k = cellKey(cx, cy);
    const prev = this.work.get(k);
    if (!(t >= 0)) {
      if (prev === undefined) return false;
      this.work.delete(k);
      return true;
    }
    if (prev === t) return false;
    this.work.set(k, t);
    return true;
  }

  commit() {
    this.gesture.set([[this.node, { cells: cellsValue(this.work) }]]);
  }

  endStroke() {
    this.gesture?.end();
    this.gesture = null;
    this.work = null;
  }

  cancelStroke() {
    this.drag = null;
    if (this.gesture) {
      this.gesture.cancel();
      this.gesture = null;
      this.work = null;
    }
  }

  /** The stamp's tile for (x, y) when it repeats from (ox, oy). */
  patternAt(x, y, ox, oy) {
    const { w, h: hh, tiles } = this.stamp;
    const i = (((x - ox) % w) + w) % w;
    const j = (((y - oy) % hh) + hh) % hh;
    return tiles[j * w + i];
  }

  stampAt(ax, ay) {
    let changed = false;
    const { w, h: hh, tiles } = this.stamp;
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < w; i++) {
        const t = tiles[j * w + i];
        if (t >= 0 && this.setCell(ax + i, ay + j, t)) changed = true;
      }
    }
    return changed;
  }

  /** Paints or erases every cell on the line from the last point, so fast strokes have no gaps. */
  strokeTo(x1, y1) {
    const d = this.drag;
    let [x0, y0] = d.last;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const erase = d.tool === 'erase';
    const { w, h: hh } = erase ? { w: 1, h: 1 } : this.stamp;
    let changed = false;
    for (let guard = 0; guard < 100000; guard++) {
      // Multi-tile stamps repeat on a grid from where the stroke started.
      const ax = d.ox + Math.floor((x0 - d.ox) / w) * w;
      const ay = d.oy + Math.floor((y0 - d.oy) / hh) * hh;
      const key = `${ax},${ay}`;
      if (!d.done.has(key)) {
        d.done.add(key);
        if (erase ? this.setCell(ax, ay, -1) : this.stampAt(ax, ay)) changed = true;
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    d.last = [x1, y1];
    if (changed) this.commit();
  }

  paintDown(info, e) {
    if (!this.node || !info) return;
    const ts = this.tileset();
    if (!ts) return;
    let tool = e.altKey ? 'pick' : this.tool;
    if (tool === 'erase' && e.shiftKey) tool = 'eraseRect';
    if ((tool === 'paint' || tool === 'rect' || tool === 'bucket') && !this.hasStamp()) {
      this.viewport.flash(ts.count ? 'Pick a tile in the Tiles panel first.' : 'This tileset has no tiles yet: check its image.');
      return;
    }
    this.hover = info;
    this.drag = { tool, x0: info.cx, y0: info.cy, x1: info.cx, y1: info.cy };
    if (tool === 'paint' || tool === 'erase') {
      this.beginStroke(tool === 'paint' ? 'Paint tiles' : 'Erase tiles');
      Object.assign(this.drag, { last: [info.cx, info.cy], ox: info.cx, oy: info.cy, done: new Set() });
      this.strokeTo(info.cx, info.cy);
    } else if (tool === 'bucket') {
      this.drag = null;
      this.bucket(info.cx, info.cy, info.visible);
    }
  }

  paintMove(info) {
    if (!info) return;
    this.hover = info;
    const d = this.drag;
    if (!d) return;
    if (d.tool === 'paint' || d.tool === 'erase') this.strokeTo(info.cx, info.cy);
    else {
      d.x1 = info.cx;
      d.y1 = info.cy;
    }
  }

  paintUp(info) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (info) {
      d.x1 = info.cx;
      d.y1 = info.cy;
    }
    if (d.tool === 'paint' || d.tool === 'erase') this.endStroke();
    else if (d.tool === 'rect' || d.tool === 'eraseRect') this.fillRect(d, d.tool === 'eraseRect');
    else if (d.tool === 'pick') this.pick(d);
  }

  paintHover(info) {
    this.hover = info;
  }

  paintCancel() {
    this.cancelStroke();
    this.viewport.redraw();
  }

  fillRect(d, erase) {
    const x0 = Math.min(d.x0, d.x1);
    const x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1);
    const y1 = Math.max(d.y0, d.y1);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1e6) return;
    this.beginStroke(erase ? 'Erase tiles' : 'Fill rectangle');
    let changed = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = erase ? -1 : this.patternAt(x, y, x0, y0);
        if ((erase || t >= 0) && this.setCell(x, y, t)) changed = true;
      }
    }
    if (changed) this.commit();
    this.endStroke();
  }

  /** Fills the connected cells holding the same tile, inside the used area and the view. */
  bucket(cx, cy, visible) {
    const work = this.cells();
    const used = cellBounds(work);
    let b = visible ? { ...visible } : { x0: cx - 32, y0: cy - 32, x1: cx + 32, y1: cy + 32 };
    if (used) b = { x0: Math.min(b.x0, used.x0), y0: Math.min(b.y0, used.y0), x1: Math.max(b.x1, used.x1), y1: Math.max(b.y1, used.y1) };
    const target = work.has(cellKey(cx, cy)) ? work.get(cellKey(cx, cy)) : -1;
    if (this.stamp.w === 1 && this.stamp.h === 1 && this.stamp.tiles[0] === target) return;
    const seen = new Set([cellKey(cx, cy)]);
    const stack = [[cx, cy]];
    const cells = [];
    while (stack.length && cells.length < 250000) {
      const [x, y] = stack.pop();
      cells.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < b.x0 || ny < b.y0 || nx > b.x1 || ny > b.y1) continue;
        const k = cellKey(nx, ny);
        if (seen.has(k)) continue;
        const v = work.has(k) ? work.get(k) : -1;
        if (v !== target) continue;
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
    this.beginStroke('Fill tiles');
    let changed = false;
    for (const [x, y] of cells) {
      const t = this.patternAt(x, y, cx, cy);
      if (t >= 0 && this.setCell(x, y, t)) changed = true;
    }
    if (changed) this.commit();
    this.endStroke();
  }

  /** Takes the tiles under a rectangle of the map as the stamp. */
  pick(d) {
    const x0 = Math.min(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0) + 1;
    const hh = Math.abs(d.y1 - d.y0) + 1;
    if (w * hh > 4096) {
      this.viewport.flash('That area is too big to pick.');
      return;
    }
    const grid = this.cells();
    const tiles = [];
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) tiles.push(grid.has(cellKey(x0 + i, y0 + j)) ? grid.get(cellKey(x0 + i, y0 + j)) : -1);
    if (tiles.every((t) => t < 0)) {
      this.viewport.flash('There are no tiles there to pick.');
      return;
    }
    this.stamp = { w, h: hh, tiles };
    // Show it in the palette when it's a block of the tileset as it is.
    const ts = this.tileset();
    this.sel = null;
    if (ts?.columns && tiles[0] >= 0) {
      const px = tiles[0] % ts.columns;
      const py = Math.floor(tiles[0] / ts.columns);
      const block = px + w <= ts.columns && tiles.every((t, k) => t === (py + Math.floor(k / w)) * ts.columns + px + (k % w));
      if (block) this.sel = { x0: px, y0: py, x1: px + w - 1, y1: py + hh - 1 };
    }
    this.tool = 'paint';
    this.updateTools();
    this.drawPalette();
    this.renderProps();
    this.updateInfo();
  }

  paintOverlay(api) {
    if (!this.node) return;
    const d = this.drag;
    const limit = 4000;
    if (d && (d.tool === 'rect' || d.tool === 'eraseRect' || d.tool === 'pick')) {
      const x0 = Math.min(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1);
      const x1 = Math.max(d.x0, d.x1);
      const y1 = Math.max(d.y0, d.y1);
      if (d.tool === 'rect' && (x1 - x0 + 1) * (y1 - y0 + 1) <= limit) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.tile(x, y, this.patternAt(x, y, x0, y0), 0.65);
      }
      if (d.tool === 'eraseRect') api.fill(x0, y0, x1, y1, api.colors.dangerFill);
      api.outline(x0, y0, x1, y1, d.tool === 'eraseRect' ? api.colors.danger : api.colors.accent);
      return;
    }
    const c = this.hover;
    if (!c) return;
    const tool = d?.tool || this.tool;
    if (tool === 'paint') {
      const { w, h: hh } = this.stamp;
      const ax = d ? d.ox + Math.floor((c.cx - d.ox) / w) * w : c.cx;
      const ay = d ? d.oy + Math.floor((c.cy - d.oy) / hh) * hh : c.cy;
      for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) api.tile(ax + i, ay + j, this.stamp.tiles[j * w + i], 0.65);
      api.outline(ax, ay, ax + w - 1, ay + hh - 1);
    } else if (tool === 'erase') {
      api.fill(c.cx, c.cy, c.cx, c.cy, api.colors.dangerFill);
      api.outline(c.cx, c.cy, c.cx, c.cy, api.colors.danger);
    } else {
      if (tool === 'bucket') api.tile(c.cx, c.cy, this.stamp.tiles[0], 0.65);
      api.outline(c.cx, c.cy, c.cx, c.cy);
    }
  }

  /** Keys from the viewport: B / E / U / G / I pick tile tools; Escape stops painting. */
  paintKey(e, painting) {
    if (!this.node || e.altKey || e.ctrlKey || e.metaKey) return false;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (painting && key === 'Escape') {
      if (this.drag) this.paintCancel();
      else this.viewport.setTool(this.prevTool && this.prevTool !== 'paint' ? this.prevTool : 'select');
      return true;
    }
    const tool = KEYS[key];
    if (!tool) return false;
    // E rotates unless tiles are being painted.
    if (tool === 'erase' && !painting) return false;
    if (!this.tileset()) return false;
    this.setTool(tool);
    return true;
  }
}
