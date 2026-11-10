// The tile panel, shown below the scene view while a Tiles piece is selected:
// the tileset's tiles to pick from, the painting tools, and a small tileset
// editor, saved in the .tileset file: a tile's settings (solid, one-way, a
// name), the terrains (sets of tiles that fit their neighbours by
// themselves; terrain.js picks the tiles) and the animated tiles.
//
// It paints through the viewport: Viewport2D calls paintDown / paintMove /
// paintUp / paintHover / paintOverlay / paintKey / paintCancel on it while
// its tool is 'paint'. Painting changes the node's `cells` property through
// the doc, one undo step per stroke.

import { decodeCells, cellsValue, cellKey, cellBounds } from './cells.js';
import { Gesture, dirOf, relativePath, normalizePath, cssVarColor, rgba } from './viewport2d.js';
import * as terrain from './terrain.js';

// What the side of the panel shows.
const SIDES = [
  { id: 'tile', label: 'Tile', hint: 'The picked tiles\' settings: solid, one-way, a name' },
  { id: 'terrains', label: 'Terrains', hint: 'Sets of tiles that fit their neighbours by themselves when you paint' },
  { id: 'animation', label: 'Animation', hint: 'Tiles that show other tiles in turn' },
];

// A terrain's color in the panel when its entry has none.
const TERRAIN_COLORS = ['#4caf50', '#42a5f5', '#ffb300', '#ab47bc', '#ef5350', '#26c6da', '#8d6e63', '#ec407a'];

// Which side or corner each third of a tile stands for while marking a
// terrain's tiles (0: the middle, which puts the tile in the terrain).
const ZONES = [
  [terrain.NW, terrain.N, terrain.NE],
  [terrain.W, 0, terrain.E],
  [terrain.SW, terrain.S, terrain.SE],
];
const SIDE_BITS = terrain.N | terrain.E | terrain.S | terrain.W;
const bitCounts = (bit, match) => (match === 'sides' ? !!(bit & SIDE_BITS) : match === 'corners' ? !(bit & SIDE_BITS) : true);

const SETS = new WeakMap(); // a tileset file's data -> its terrains, ready to use

const objectOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function sortedByNumber(map) {
  const out = {};
  for (const k of Object.keys(map).sort((a, b) => Number(a) - Number(b))) out[k] = map[k];
  return out;
}

/** The frame (a tile number) an animated tile shows at a time, as tilemap.lua works it out. */
export function animationFrame(a, time, count = Infinity) {
  const frames = [];
  const ends = [];
  let total = 0;
  const fps = Number(a?.fps) > 0 ? Number(a.fps) : 8;
  (Array.isArray(a?.frames) ? a.frames : []).forEach((f, i) => {
    const d = Array.isArray(a.durations) && Number(a.durations[i]) ? Number(a.durations[i]) : 1 / fps;
    if (Number.isInteger(f) && f >= 0 && f < count && d > 0) {
      total += d;
      frames.push(f);
      ends.push(total);
    }
  });
  if (!frames.length) return null;
  const t = ((time % total) + total) % total;
  let k = 0;
  while (k < ends.length - 1 && t >= ends[k]) k++;
  return frames[k];
}

const TOOLS = [
  { id: 'paint', label: 'Paint', key: 'B', hint: 'Paint with the picked tiles' },
  { id: 'erase', label: 'Erase', key: 'E', hint: 'Erase tiles (Shift-drag: a rectangle). With a terrain picked, the edges around the hole are fitted' },
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
    this.brush = null; // the name of the terrain to paint with; null: the picked tiles
    this.side = 'tile'; // what the side of the panel shows (SIDES)
    this.terrainSel = 0; // the terrain shown in the Terrains side
    this.marking = false; // clicks in the picture mark the terrain's tiles
    this.draft = null; // a terrain's tiles while a marking drag is going on
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
      this.brush = null;
      this.terrainSel = 0;
      this.marking = false;
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
    this.stopAnimating();
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

  /** The tileset's terrains ready to use: {list, byName, of} (terrain.js). */
  terrainSets() {
    const ts = this.tileset();
    if (!ts) return terrain.compileAll(null);
    let sets = SETS.get(ts.data);
    if (!sets) {
      sets = terrain.compileAll(ts.data.terrains);
      SETS.set(ts.data, sets);
    }
    return sets;
  }

  /** The terrains as the file lists them (what the Terrains side edits). */
  terrainDefs() {
    const list = this.tileset()?.data?.terrains;
    return Array.isArray(list) ? list.filter((d) => d && typeof d === 'object') : [];
  }

  terrainColor(def, i) {
    return typeof def?.color === 'string' && /^#[0-9a-f]{6}$/i.test(def.color) ? def.color : TERRAIN_COLORS[i % TERRAIN_COLORS.length];
  }

  /** The terrain being painted with, or null when painting plain tiles. */
  brushTerrain() {
    return this.brush ? this.terrainSets().byName.get(this.brush) || null : null;
  }

  setBrush(name) {
    this.brush = name || null;
    if (this.brushSelect) this.brushSelect.value = this.brush || '';
    if (this.brush && (this.tool === 'pick' || this.viewport?.tool !== 'paint')) this.setTool(this.tool === 'pick' ? 'paint' : this.tool);
    this.viewport?.redraw();
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
    // Keep the picture where it was scrolled to (saving a tile's settings
    // comes back here).
    const scroll = this.palette && this.renderedTileset === this.tilesetPath() ? [this.palette.wrap.scrollLeft, this.palette.wrap.scrollTop] : null;
    this.root.replaceChildren();
    this.paletteObserver?.disconnect();
    this.stopAnimating();
    this.palette = null;
    this.brushSelect = null;
    this.draft = null;
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
    if (scroll && this.palette) {
      this.palette.wrap.scrollLeft = scroll[0];
      this.palette.wrap.scrollTop = scroll[1];
    }
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
    // What the tools paint with: the picked tiles, or a terrain.
    const sets = this.terrainSets();
    if (this.brush && !sets.byName.has(this.brush)) this.brush = null;
    const brush = h('select', { class: 'tmp-select', title: 'What the tools paint with: the tiles you picked, or a terrain, which picks the tiles that fit their neighbours', 'aria-label': 'Paint with' });
    brush.append(h('option', { value: '', selected: !this.brush }, 'Picked tiles'));
    for (const t of sets.list) brush.append(h('option', { value: t.name, selected: t.name === this.brush }, `Terrain: ${t.name}`));
    if (!sets.list.length) brush.append(h('option', { value: '__make' }, 'Make a terrain…'));
    brush.addEventListener('change', () => {
      if (brush.value === '__make') {
        brush.value = '';
        this.side = 'terrains';
        this.renderSide();
        return;
      }
      this.setBrush(brush.value);
    });
    this.brushSelect = brush;
    const bar = h('div', { class: 'tmp-bar' },
      tools,
      h('span', { class: 'tmp-sep' }),
      h('label', { class: 'tmp-field' }, h('span', {}, 'Paint with'), brush),
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
    this.sideTabs = h('div', { class: 'tmp-tabs', role: 'tablist', 'aria-label': 'Tileset' });
    this.root.append(bar, h('div', { class: 'tmp-body' }, wrap, h('div', { class: 'tmp-side' }, this.sideTabs, this.propsEl)));
    this.updateTools();
    this.renderSide();
    this.updateInfo();
    this.startAnimating();
  }

  /** The side of the panel: its tabs and what the chosen one shows. */
  renderSide() {
    if (!this.sideTabs) return;
    this.sideTabs.replaceChildren();
    for (const t of SIDES) {
      this.sideTabs.append(h('button', {
        type: 'button', class: 'tmp-tab', role: 'tab', title: t.hint, 'aria-selected': String(t.id === this.side),
        onclick: () => {
          this.side = t.id;
          this.renderSide();
        },
      }, t.label));
    }
    this.renderProps();
    this.drawPalette();
  }

  // The picture plays its animated tiles while there are any.
  startAnimating() {
    this.stopAnimating();
    const anims = Object.keys(objectOf(this.tileset()?.data?.animations));
    if (!anims.length || typeof setInterval === 'undefined') return;
    this.animTimer = setInterval(() => {
      if (!this.palette || !this.root.isConnected) this.stopAnimating();
      else if (!this.paletteDrag && !this.draft && this.root.offsetParent !== null) this.drawPalette();
    }, 100);
  }

  stopAnimating() {
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = null;
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
    // Animated tiles: the frame they show now, and a mark in the corner.
    const time = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    for (const [k, a] of Object.entries(objectOf(ts.data.animations))) {
      const t = Number(k);
      if (!(t >= 0 && t < ts.count)) continue;
      const f = animationFrame(a, time, ts.count);
      if (f === null) continue;
      const [x, y] = cell(t);
      if (f !== t) {
        g.clearRect(x, y, tw, th);
        g.drawImage(img.bitmap, (f % ts.columns) * ts.tileWidth, Math.floor(f / ts.columns) * ts.tileHeight, ts.tileWidth, ts.tileHeight, x, y, tw, th);
      }
      const m = Math.max(5, Math.min(9, tw / 3));
      g.beginPath();
      g.moveTo(x + 2, y + 2);
      g.lineTo(x + 2 + m, y + 2 + m / 2);
      g.lineTo(x + 2, y + 2 + m);
      g.closePath();
      g.fillStyle = c.accent;
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = rgba(c.bg, 0.8);
      g.stroke();
    }
    // Terrains: where each tile of a terrain carries on (its sides and
    // corners), in the terrain's color. The chosen terrain in full, the
    // others as a dot.
    if (this.side === 'terrains') {
      const defs = this.terrainDefs();
      defs.forEach((def, i) => {
        const chosen = i === this.terrainSel;
        const color = this.terrainColor(def, i);
        const match = terrain.matchOf(def.match);
        const tiles = chosen && this.draft ? this.draft.tiles : objectOf(def.tiles);
        for (const [k, v] of Object.entries(tiles)) {
          const t = Number(k);
          if (!(Number.isInteger(t) && t >= 0 && t < ts.count)) continue;
          const [x, y] = cell(t);
          if (!chosen) {
            g.beginPath();
            g.arc(x + tw / 2, y + th / 2, Math.max(2, Math.min(tw, th) / 8), 0, Math.PI * 2);
            g.fillStyle = color;
            g.fill();
            continue;
          }
          const mask = Number(v) || 0;
          const counted = terrain.reduce(mask, match, true);
          for (let j = 0; j < 3; j++) {
            for (let zi = 0; zi < 3; zi++) {
              const bit = ZONES[j][zi];
              if (bit && !(mask & bit)) continue;
              if (bit && !bitCounts(bit, match)) continue;
              // A corner without both its sides doesn't count: drawn faint.
              g.globalAlpha = bit === 0 ? 0.75 : counted & bit ? 0.6 : 0.2;
              g.fillStyle = color;
              g.fillRect(x + (zi * tw) / 3, y + (j * th) / 3, tw / 3, th / 3);
            }
          }
          g.globalAlpha = 1;
        }
      });
      // While marking, the tile under the pointer shows its nine parts.
      if (this.marking && this.paletteHover && defs[this.terrainSel]) {
        const x = this.paletteHover.x * tw;
        const y = this.paletteHover.y * th;
        g.beginPath();
        for (let i = 1; i < 3; i++) {
          g.moveTo(x + (i * tw) / 3, y);
          g.lineTo(x + (i * tw) / 3, y + th);
          g.moveTo(x, y + (i * th) / 3);
          g.lineTo(x + tw, y + (i * th) / 3);
        }
        g.lineWidth = 1;
        g.strokeStyle = rgba(c.fg, 0.6);
        g.stroke();
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

  /** Marking a terrain's tiles: a click or a drag over the thirds of the tiles in the picture. */
  maskPointer(type, e) {
    const ts = this.tileset();
    const defs = this.terrainDefs();
    const def = defs[this.terrainSel];
    const r = this.palette.canvas.getBoundingClientRect();
    const z = this.paletteZoom();
    const fx = (e.clientX - r.left) / (ts.tileWidth * z);
    const fy = (e.clientY - r.top) / (ts.tileHeight * z);
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const inside = x >= 0 && y >= 0 && x < ts.columns && y < ts.rows;
    this.paletteHover = inside ? { x, y } : null;
    const tile = y * ts.columns + x;
    const bit = inside ? ZONES[Math.min(2, Math.floor((fy - y) * 3))][Math.min(2, Math.floor((fx - x) * 3))] : 0;
    const match = terrain.matchOf(def.match);
    const apply = () => {
      const d = this.draft;
      if (!d || !inside || (bit === 0) !== d.middle || (bit && !bitCounts(bit, match))) return;
      const key = String(tile);
      const has = key in d.tiles;
      const cur = has ? Number(d.tiles[key]) || 0 : 0;
      if (d.middle) {
        if (d.on && !has) d.tiles[key] = 0;
        else if (!d.on && has) delete d.tiles[key];
        else return;
      } else {
        const next = d.on ? cur | bit : cur & ~bit;
        if (has && next === cur) return;
        if (!has && !d.on) return;
        d.tiles[key] = next;
      }
      d.changed = true;
    };
    if (type === 'down' && e.button === 0 && inside) {
      this.root.focus({ preventScroll: true });
      try {
        this.palette.canvas.setPointerCapture(e.pointerId);
      } catch {
        // not a live pointer
      }
      const tiles = { ...objectOf(def.tiles) };
      const key = String(tile);
      // The first click decides: it turns that part on, or off, and the drag does the same.
      const on = bit === 0 ? !(key in tiles) : !(key in tiles) || !((Number(tiles[key]) || 0) & bit);
      this.draft = { tiles, on, middle: bit === 0, changed: false };
      apply();
    } else if (type === 'move') apply();
    else if (type === 'up' && this.draft) {
      const d = this.draft;
      this.draft = null;
      if (d.changed) {
        this.updateTerrain(this.terrainSel, (t) => {
          t.tiles = d.tiles;
        });
        return;
      }
    }
    this.drawPalette();
    this.updateInfo();
  }

  palettePointer(type, e) {
    const ts = this.tileset();
    if (!ts?.count || !this.palette) return;
    if (this.side === 'terrains' && this.marking && this.terrainDefs()[this.terrainSel]) {
      this.maskPointer(type, e);
      return;
    }
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
      this.brush = null;
      if (this.brushSelect) this.brushSelect.value = '';
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
    if (ts && this.side === 'terrains') {
      this.renderTerrains(el, ts);
      return;
    }
    if (ts && this.side === 'animation') {
      this.renderAnimation(el, ts);
      return;
    }
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
      el.append(h('label', { class: 'tmp-field tmp-field-col', title: 'Read it in scripts with tiles:tileInfo(tile).name' }, h('span', {}, 'Name'), input));
    }
    el.append(h('p', { class: 'tmp-note' }, `Saved in ${ts.path.split('/').pop()}.`));
  }

  /** Changes the .tileset file: fn gets its data to change. */
  updateTileset(fn) {
    const ts = this.tileset();
    if (!ts) return;
    let data;
    try {
      data = JSON.parse(this.project.readText(ts.path));
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    fn(data);
    this.project.write(ts.path, `${JSON.stringify(data, null, 2)}\n`);
  }

  /** Changes the properties of tiles in the .tileset file. */
  updateTiles(tiles, fn) {
    this.updateTileset((data) => {
      const map = { ...(data.tiles || {}) };
      for (const t of tiles) {
        const p = { ...(map[String(t)] || {}) };
        fn(p);
        if (Object.keys(p).length) map[String(t)] = p;
        else delete map[String(t)];
      }
      data.tiles = sortedByNumber(map);
    });
  }

  // Terrains -------------------------------------------------------------------

  /**
   * Changes terrain i of the .tileset file: fn gets its entry. A tile
   * belongs to one terrain, so the tiles it has afterwards leave the others.
   */
  updateTerrain(i, fn) {
    this.updateTileset((data) => {
      const list = Array.isArray(data.terrains) ? data.terrains.filter((d) => d && typeof d === 'object') : [];
      const def = list[i];
      if (!def) return;
      fn(def, list);
      def.tiles = sortedByNumber(objectOf(def.tiles));
      for (const other of list) {
        if (other === def || !other.tiles) continue;
        for (const k of Object.keys(def.tiles)) delete other.tiles[k];
      }
      data.terrains = list;
    });
  }

  addTerrain() {
    const names = new Set(this.terrainDefs().map((d, i) => terrain.compile(d, i + 1).name));
    let name = 'terrain';
    for (let n = 2; names.has(name); n++) name = `terrain${n}`;
    this.terrainSel = this.terrainDefs().length;
    this.marking = true;
    this.updateTileset((data) => {
      const list = Array.isArray(data.terrains) ? data.terrains.filter((d) => d && typeof d === 'object') : [];
      list.push({ name, match: 'all', color: TERRAIN_COLORS[list.length % TERRAIN_COLORS.length], tiles: {} });
      data.terrains = list;
    });
  }

  /** Fills in a terrain's tiles from a sheet layout, starting at the picked tile. */
  applyLayout(id) {
    const ts = this.tileset();
    const layout = terrain.LAYOUTS.find((l) => l.id === id);
    if (!ts || !layout) return;
    const first = this.selectedTiles()[0] ?? 0;
    const map = terrain.layoutTiles(layout, first, ts.columns, ts.count);
    if (!map) {
      this.viewport?.flash(`That layout is ${layout.rows[0].length} × ${layout.rows.length} tiles: it doesn't fit in the picture starting at tile ${first}. Pick its top-left tile first.`);
      return;
    }
    this.updateTerrain(this.terrainSel, (t) => {
      t.match = layout.match;
      t.tiles = { ...objectOf(t.tiles), ...map };
    });
  }

  renderTerrains(el, ts) {
    const defs = this.terrainDefs();
    if (this.terrainSel >= defs.length) this.terrainSel = Math.max(0, defs.length - 1);
    el.append(h('p', { class: 'tmp-note' }, 'A terrain is a set of tiles for one material: grass, a wall, water. Paint with it and the edges and corners fit by themselves.'));
    const list = h('div', { class: 'tmp-terrains', role: 'listbox', 'aria-label': 'Terrains' });
    defs.forEach((d, i) => {
      const t = terrain.compile(d, i + 1);
      list.append(h('button', {
        type: 'button', class: 'tmp-terrain', role: 'option', 'aria-selected': String(i === this.terrainSel), title: `${t.name}: ${t.tiles.size} tiles`,
        onclick: () => {
          this.terrainSel = i;
          this.renderProps();
          this.drawPalette();
        },
      }, h('span', { class: 'tmp-swatch', style: `background:${this.terrainColor(d, i)}` }), h('span', { class: 'tmp-terrain-name' }, t.name), h('span', { class: 'tmp-terrain-count' }, String(t.tiles.size))));
    });
    el.append(list, h('button', { type: 'button', class: 'tmp-btn', title: 'Add a terrain to this tileset', onclick: () => this.addTerrain() }, 'New terrain'));
    const def = defs[this.terrainSel];
    if (!def) {
      this.marking = false;
      return;
    }
    const sel = this.terrainSel;
    const compiled = terrain.compile(def, sel + 1);
    const stop = (input) => input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      e.stopPropagation();
    });

    const name = h('input', { type: 'text', class: 'tmp-input', value: compiled.name, spellcheck: 'false' });
    name.addEventListener('change', () => {
      const others = new Set(defs.filter((d) => d !== def).map((d, i) => terrain.compile(d, i + 1).name));
      let v = name.value.trim() || compiled.name;
      for (let n = 2; others.has(v); n++) v = `${name.value.trim()}${n}`;
      if (v === compiled.name) {
        name.value = v;
        return;
      }
      if (this.brush === compiled.name) this.brush = v;
      this.updateTerrain(sel, (t) => {
        t.name = v;
      });
    });
    stop(name);

    const match = h('select', { class: 'tmp-select' });
    for (const m of terrain.MATCHES) match.append(h('option', { value: m.id, selected: m.id === compiled.match, title: m.hint }, m.label));
    match.addEventListener('change', () => this.updateTerrain(sel, (t) => {
      t.match = match.value;
    }));
    const matchHint = terrain.MATCHES.find((m) => m.id === compiled.match).hint;

    const color = h('input', { type: 'color', class: 'tmp-color', value: this.terrainColor(def, sel), 'aria-label': 'Color in this panel' });
    color.addEventListener('change', () => this.updateTerrain(sel, (t) => {
      t.color = color.value;
    }));

    const mark = h('button', {
      type: 'button', class: 'tmp-btn tmp-toggle', 'aria-pressed': String(this.marking),
      title: 'Then click in the picture: the middle of a tile puts it in the terrain, its sides and corners say where the terrain carries on into the next cell',
      onclick: () => {
        this.marking = !this.marking;
        this.renderProps();
        this.drawPalette();
      },
    }, this.marking ? 'Marking tiles: click the picture' : 'Mark its tiles');

    const first = this.selectedTiles()[0] ?? 0;
    const layout = h('select', { class: 'tmp-select', title: `Marks a whole sheet at once, when the picture is drawn in one of these layouts. It starts at the picked tile (tile ${first}): pick the sheet's top-left tile first (with marking off).` });
    layout.append(h('option', { value: '' }, 'Fill in from a layout…'));
    for (const l of terrain.LAYOUTS) layout.append(h('option', { value: l.id, title: l.hint }, l.label));
    layout.addEventListener('change', () => {
      const id = layout.value;
      layout.value = '';
      if (id) this.applyLayout(id);
    });

    el.append(
      h('label', { class: 'tmp-field tmp-field-col', title: 'Scripts use it: level:setTerrain(column, row, "grass")' }, h('span', {}, 'Name'), h('div', { class: 'tmp-row' }, name, color)),
      h('label', { class: 'tmp-field tmp-field-col', title: matchHint }, h('span', {}, 'Neighbours that count'), match),
      mark,
      this.marking ? h('p', { class: 'tmp-note' }, 'Click the middle of every tile of this terrain, then the sides and corners where it joins more of itself. Click again to take a mark away; drag to mark many.') : null,
      layout,
      h('button', {
        type: 'button', class: 'tmp-btn tmp-primary', disabled: compiled.first === null, title: compiled.first === null ? 'Mark some tiles first' : `Paint ${compiled.name} in the scene`,
        onclick: () => {
          this.marking = false;
          this.setBrush(compiled.name);
          this.setTool(this.tool === 'pick' ? 'paint' : this.tool);
          this.renderProps();
          this.drawPalette();
        },
      }, 'Paint with it'),
      h('button', {
        type: 'button', class: 'tmp-btn', title: 'Removes the terrain from the tileset. Tiles already painted stay as they are.',
        onclick: () => {
          if (this.brush === compiled.name) this.brush = null;
          this.updateTileset((data) => {
            const all = Array.isArray(data.terrains) ? data.terrains.filter((d) => d && typeof d === 'object') : [];
            all.splice(sel, 1);
            if (all.length) data.terrains = all;
            else delete data.terrains;
          });
        },
      }, 'Delete terrain'),
      h('p', { class: 'tmp-note' }, `${compiled.tiles.size} tiles · saved in ${ts.path.split('/').pop()}.`),
    );
  }

  // Animated tiles -------------------------------------------------------------

  renderAnimation(el, ts) {
    const tiles = this.selectedTiles();
    const t = tiles[0];
    const anims = objectOf(ts.data.animations);
    el.append(h('p', { class: 'tmp-note' }, 'An animated tile shows other tiles in turn: water, lava, torches. Paint with its first tile; the game plays the rest.'));
    if (t === undefined) {
      el.append(h('p', { class: 'tmp-note' }, 'Pick a tile to animate.'));
      return;
    }
    const a = objectOf(anims[String(t)]);
    const has = Array.isArray(a.frames) && a.frames.length > 0;
    const setAnim = (fn) => this.updateTileset((data) => {
      const map = { ...objectOf(data.animations) };
      const cur = { ...objectOf(map[String(t)]) };
      fn(cur);
      if (Array.isArray(cur.frames) && cur.frames.length) map[String(t)] = cur;
      else delete map[String(t)];
      if (Object.keys(map).length) data.animations = sortedByNumber(map);
      else delete data.animations;
    });
    const numbers = (text, whole) => text.split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v) && (whole ? Number.isInteger(v) && v >= 0 && v < ts.count : v > 0));
    const stop = (input) => input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      e.stopPropagation();
    });
    el.append(h('div', { class: 'tmp-props-title' }, `Tile ${t}`));
    if (tiles.length >= 2) {
      el.append(h('button', {
        type: 'button', class: 'tmp-btn tmp-primary', title: `Tile ${t} will show tiles ${tiles.join(', ')} in turn`,
        onclick: () => setAnim((cur) => {
          cur.frames = tiles.slice();
          if (!(Number(cur.fps) > 0)) cur.fps = 8;
          delete cur.durations;
        }),
      }, `${has ? 'Use' : 'Animate with'} these ${tiles.length} tiles`));
    } else if (!has) {
      el.append(h('p', { class: 'tmp-note' }, 'Drag over the frames in the picture (in a row, first to last) and press the button that appears, or type the tile numbers here.'));
    }
    const frames = h('input', { type: 'text', class: 'tmp-input', value: has ? a.frames.join(', ') : '', placeholder: 'For example 8, 9, 10', spellcheck: 'false' });
    frames.addEventListener('change', () => {
      const list = numbers(frames.value, true);
      setAnim((cur) => {
        cur.frames = list;
        if (list.length && !(Number(cur.fps) > 0)) cur.fps = 8;
        if (Array.isArray(cur.durations) && cur.durations.length !== list.length) delete cur.durations;
      });
    });
    stop(frames);
    el.append(h('label', { class: 'tmp-field tmp-field-col', title: 'The tiles it shows, in order (tile numbers, counted from 0 across the picture)' }, h('span', {}, 'Frames'), frames));
    if (!has) return;
    const fps = h('input', { type: 'number', class: 'tmp-input tmp-num', min: '0.1', max: '60', step: '1', value: String(Number(a.fps) > 0 ? a.fps : 8) });
    fps.addEventListener('change', () => {
      const v = Number(fps.value);
      if (v > 0) setAnim((cur) => {
        cur.fps = v;
      });
    });
    stop(fps);
    const times = h('input', { type: 'text', class: 'tmp-input', value: Array.isArray(a.durations) ? a.durations.join(', ') : '', placeholder: 'All the same', spellcheck: 'false' });
    times.addEventListener('change', () => {
      const list = numbers(times.value, false);
      setAnim((cur) => {
        if (list.length) {
          // One time for each frame; the last one given stands for the rest.
          cur.durations = cur.frames.map((_, i) => list[Math.min(i, list.length - 1)]);
        } else delete cur.durations;
      });
    });
    stop(times);
    const random = h('input', { type: 'checkbox' });
    random.checked = a.randomStart === true;
    random.addEventListener('change', () => setAnim((cur) => {
      if (random.checked) cur.randomStart = true;
      else delete cur.randomStart;
    }));
    el.append(
      h('label', { class: 'tmp-field tmp-field-col', title: 'How many frames it shows each second' }, h('span', {}, 'Frames a second'), fps),
      h('label', { class: 'tmp-field tmp-field-col', title: 'Seconds for each frame, like 0.8, 0.1, 0.1, when they aren\'t all the same. Empty: the speed above.' }, h('span', {}, 'Seconds for each frame'), times),
      h('label', { class: 'tmp-check', title: 'Every cell starts at a different point of the loop, so a lake doesn\'t ripple all in step' }, random, h('span', {}, 'Random start')),
      h('button', { type: 'button', class: 'tmp-btn', onclick: () => setAnim((cur) => delete cur.frames) }, 'Remove animation'),
      h('p', { class: 'tmp-note' }, `Solid and the other settings come from tile ${t}. Saved in ${ts.path.split('/').pop()}.`),
    );
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

  /**
   * get and set on the stroke's cells for terrain.js; changed() tells
   * whether a set changed anything since the stroke's cells were made.
   */
  terrainAccess() {
    let changed = false;
    return {
      get: (x, y) => this.work.get(cellKey(x, y)),
      set: (x, y, t) => {
        if (this.setCell(x, y, t)) changed = true;
      },
      changed: () => changed,
    };
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
    // A terrain paints cell by cell and fits the cells around each one; with
    // a terrain picked, erasing fits the cells around the hole too.
    const sets = d.sets;
    const access = sets ? this.terrainAccess() : null;
    const { w, h: hh } = erase || sets ? { w: 1, h: 1 } : this.stamp;
    let changed = false;
    for (let guard = 0; guard < 100000; guard++) {
      // Multi-tile stamps repeat on a grid from where the stroke started.
      const ax = d.ox + Math.floor((x0 - d.ox) / w) * w;
      const ay = d.oy + Math.floor((y0 - d.oy) / hh) * hh;
      const key = `${ax},${ay}`;
      if (!d.done.has(key)) {
        d.done.add(key);
        if (sets) terrain.place(access.get, access.set, sets.of, ax, ay, erase ? null : d.terrain);
        else if (erase ? this.setCell(ax, ay, -1) : this.stampAt(ax, ay)) changed = true;
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
    if (changed || access?.changed()) this.commit();
  }

  paintDown(info, e) {
    if (!this.node || !info) return;
    const ts = this.tileset();
    if (!ts) return;
    let tool = e.altKey ? 'pick' : this.tool;
    if (tool === 'erase' && e.shiftKey) tool = 'eraseRect';
    const brush = tool === 'pick' ? null : this.brushTerrain();
    const paints = tool === 'paint' || tool === 'rect' || tool === 'bucket';
    if (paints && brush && brush.first === null) {
      this.viewport.flash(`The terrain ${brush.name} has no tiles yet: mark some in the Tiles panel (Terrains).`);
      return;
    }
    if (paints && !brush && !this.hasStamp()) {
      this.viewport.flash(ts.count ? 'Pick a tile in the Tiles panel first.' : 'This tileset has no tiles yet: check its image.');
      return;
    }
    this.hover = info;
    this.drag = { tool, x0: info.cx, y0: info.cy, x1: info.cx, y1: info.cy, terrain: brush, sets: brush ? this.terrainSets() : null };
    if (tool === 'paint' || tool === 'erase') {
      this.beginStroke(tool === 'paint' ? 'Paint tiles' : 'Erase tiles');
      Object.assign(this.drag, { last: [info.cx, info.cy], ox: info.cx, oy: info.cy, done: new Set() });
      this.strokeTo(info.cx, info.cy);
    } else if (tool === 'bucket') {
      this.drag = null;
      this.bucket(info.cx, info.cy, info.visible, brush);
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
    if (d.sets) {
      const access = this.terrainAccess();
      terrain.fill(access.get, access.set, d.sets.of, x0, y0, x1 - x0 + 1, y1 - y0 + 1, erase ? null : d.terrain);
      changed = access.changed();
    } else {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = erase ? -1 : this.patternAt(x, y, x0, y0);
          if ((erase || t >= 0) && this.setCell(x, y, t)) changed = true;
        }
      }
    }
    if (changed) this.commit();
    this.endStroke();
  }

  /**
   * Fills the connected cells holding the same tile, inside the used area
   * and the view. With a terrain: the connected cells of the same terrain
   * (or the same plain tile, or empty), and the edges are fitted.
   */
  bucket(cx, cy, visible, brush = null) {
    const work = this.cells();
    const used = cellBounds(work);
    let b = visible ? { ...visible } : { x0: cx - 32, y0: cy - 32, x1: cx + 32, y1: cy + 32 };
    if (used) b = { x0: Math.min(b.x0, used.x0), y0: Math.min(b.y0, used.y0), x1: Math.max(b.x1, used.x1), y1: Math.max(b.y1, used.y1) };
    const sets = brush ? this.terrainSets() : null;
    // What a cell counts as: its terrain when a terrain is the brush, else its tile.
    const kind = (v) => (sets && v >= 0 && sets.of.get(v)) || v;
    const target = kind(work.has(cellKey(cx, cy)) ? work.get(cellKey(cx, cy)) : -1);
    if (brush ? target === brush : this.stamp.w === 1 && this.stamp.h === 1 && this.stamp.tiles[0] === target) return;
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
        const v = kind(work.has(k) ? work.get(k) : -1);
        if (v !== target) continue;
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
    this.beginStroke('Fill tiles');
    let changed = false;
    if (brush) {
      const access = this.terrainAccess();
      for (const [x, y] of cells) access.set(x, y, brush.first);
      for (const [x, y] of cells) terrain.refresh(access.get, access.set, sets.of, x, y, true);
      for (const [x, y] of cells) {
        for (const [dx, dy] of terrain.AROUND) {
          if (!seen.has(cellKey(x + dx, y + dy))) terrain.refresh(access.get, access.set, sets.of, x + dx, y + dy, false);
        }
      }
      changed = access.changed();
    } else {
      for (const [x, y] of cells) {
        const t = this.patternAt(x, y, cx, cy);
        if (t >= 0 && this.setCell(x, y, t)) changed = true;
      }
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
    this.brush = null;
    if (this.brushSelect) this.brushSelect.value = '';
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
      if (d.tool === 'rect' && d.terrain) api.fill(x0, y0, x1, y1, rgba(cssVarColor(this.root, '--accent', '#41a6f6'), 0.25));
      else if (d.tool === 'rect' && (x1 - x0 + 1) * (y1 - y0 + 1) <= limit) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.tile(x, y, this.patternAt(x, y, x0, y0), 0.65);
      }
      if (d.tool === 'eraseRect') api.fill(x0, y0, x1, y1, api.colors.dangerFill);
      api.outline(x0, y0, x1, y1, d.tool === 'eraseRect' ? api.colors.danger : api.colors.accent);
      return;
    }
    const c = this.hover;
    if (!c) return;
    const tool = d?.tool || this.tool;
    // A terrain: its lone tile under the pointer (the real ones come as you paint).
    const brush = d ? d.terrain : this.brushTerrain();
    if (brush && (tool === 'paint' || tool === 'bucket' || tool === 'rect')) {
      api.tile(c.cx, c.cy, terrain.pick(brush, 0, c.cx, c.cy), 0.65);
      api.outline(c.cx, c.cy, c.cx, c.cy);
      return;
    }
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
