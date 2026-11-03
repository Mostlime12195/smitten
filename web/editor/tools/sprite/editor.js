// The image editor: one instance per opened image. It paints a PNG (one
// image, or a sheet of frames) and its .sprite file (frame size, origin,
// animations). Brushes are smooth (antialiased, round) or pixel (hard,
// square); both work at any image size up to 4096×4096.
//
// tool-host.js mounts it: the host gives read/write/exists/setDirty/toast/
// openFile/project/ui, and this class gives element, show, hide, focus,
// handleKey, save, reload and destroy.

import { SpriteDoc, spritePaths, loadSprite, encodeSprite, stemOf, DEFAULT_FPS, META_EXT } from './doc.js';
import * as draw from './draw.js';
import { sicon } from './icons.js';
import { encodePNG } from './png.js';

const { clamp } = draw;

export const MAX_SIZE = 4096;
export const SIZE_PRESETS = [32, 64, 128, 256, 512, 1024];
export const DEFAULT_SIZE = 256;
const MAX_BRUSH = 128;
const MIN_ZOOM = 1 / 64;
const MAX_ZOOM = 64;
const ZOOM_LEVELS = [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const GRID_ZOOM = 8; // the pixel grid shows from this zoom up
const MAX_UNDO = 200;
const MAX_UNDO_BYTES = 256 * 1024 * 1024;
const TRANSPARENT = [0, 0, 0, 0];
const SHAPES = new Set(['line', 'rect', 'ellipse']);
const PAINT_TOOLS = new Set(['brush', 'eraser', 'line', 'rect', 'ellipse']);
const MAX_RECENT = 16;

const TOOLS = [
  { id: 'brush', label: 'Brush', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'picker', label: 'Color picker', key: 'I' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rectangle', key: 'U' },
  { id: 'ellipse', label: 'Ellipse', key: 'Shift+U' },
  { id: 'select', label: 'Select', key: 'M' },
];
const TOOL_LABELS = Object.fromEntries([...TOOLS.map((t) => [t.id, t.label]), ['origin', 'Origin']]);

// Optional color sets to pick from; none is the default.
export const PALETTES = [
  { id: 'none', label: 'None', colors: [] },
  {
    id: 'sweetie16', label: 'Sweetie 16', // by GrafxKid
    colors: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
      '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'],
  },
  {
    id: 'pico8', label: 'PICO-8',
    colors: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  },
  { id: 'grayscale', label: 'Grayscale', colors: Array.from({ length: 16 }, (_, i) => `#${(i * 17).toString(16).padStart(2, '0').repeat(3)}`) },
];

const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

// Marks drawn over the image (selection, brush outline, origin) use a dark
// and a light line, so they show on any color.
const MARK_DARK = 'rgba(0, 0, 0, 0.6)';
const MARK_LIGHT = 'rgba(255, 255, 255, 0.92)';

// Shared by every open image, so copy and paste works between them.
let clipboard = null;

const PREFS_KEY = 'smitten-editor.image';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

let cssAdded = false;
function addStyles() {
  if (cssAdded) return;
  cssAdded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./sprite.css', import.meta.url).href;
  document.head.append(link);
}

// Pointer capture throws for pointers that aren't active (e.g. synthetic events).
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* not capturable */ } };
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
const toBox = (r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
const sameColor = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** A project set up for pixel art (Project settings > Display) gets pixel brushes by default. */
function isPixelProject(host) {
  try {
    const d = host.project?.()?.display || {};
    return d.filter === 'pixel' || d.stretch === 'pixel';
  } catch { return false; }
}

/** The palette in smitten.json, if the project has one of its own. */
function projectPalette(host) {
  try {
    const text = host.read('smitten.json');
    const data = typeof text === 'string' ? JSON.parse(text) : null;
    const colors = Array.isArray(data?.palette) ? data.palette.filter((c) => typeof c === 'string' && draw.hexToRgba(c)) : [];
    return colors.length ? colors : null;
  } catch { return null; }
}

/** "0-3, 5, 7-6" -> [0, 1, 2, 3, 5, 7, 6]; null if it doesn't parse. */
export function parseFrameList(text, count) {
  const out = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
    if (a >= count || b >= count) return null;
    const step = a <= b ? 1 : -1;
    for (let i = a; ; i += step) { out.push(i); if (i === b) break; }
  }
  return out;
}

/** [0, 1, 2, 3, 5] -> "0-3, 5" */
export function formatFrameList(frames) {
  const parts = [];
  for (let i = 0; i < frames.length;) {
    let j = i;
    while (j + 1 < frames.length && frames[j + 1] === frames[j] + 1) j++;
    parts.push(j - i >= 2 ? `${frames[i]}-${frames[j]}` : frames.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}

export class SpriteEditor {
  constructor(host) {
    addStyles();
    this.host = host;
    this.ui = host.ui;
    Object.assign(this, spritePaths(host, host.path));
    this.doc = SpriteDoc.blank(DEFAULT_SIZE, DEFAULT_SIZE, 1);
    this.loaded = false;
    this.failed = null;
    this.current = 0;
    const prefs = (this.prefs = loadPrefs());
    this.pixelProject = isPixelProject(host);
    this.tool = 'brush';
    this.lastShape = 'rect';
    this.mode = prefs.modes?.[this.pixelProject ? 'pixel' : 'smooth'] || (this.pixelProject ? 'pixel' : 'smooth');
    this.sizes = { smooth: clamp(prefs.sizes?.smooth || 8, 1, MAX_BRUSH), pixel: clamp(prefs.sizes?.pixel || 1, 1, MAX_BRUSH) };
    this.hardness = clamp(prefs.hardness ?? 100, 0, 100);
    this.opacity = clamp(prefs.opacity ?? 100, 1, 100);
    this.tolerance = clamp(prefs.tolerance ?? 0, 0, 100);
    this.contiguous = prefs.contiguous ?? true;
    this.filled = prefs.filled ?? false;
    this.mirrorX = false;
    this.mirrorY = false;
    this.pixelGrid = prefs.pixelGrid ?? true;
    this.grid = prefs.grid ?? false;
    this.gridW = prefs.gridW || 16;
    this.gridH = prefs.gridH || 16;
    this.onion = prefs.onion ?? false;
    this.recent = Array.isArray(prefs.recent) ? prefs.recent.filter((c) => draw.hexToRgba(c)).slice(0, MAX_RECENT) : [];
    this.paletteId = prefs.palette || 'none';
    this.primary = [0, 0, 0, 255];
    this.secondary = TRANSPARENT.slice();
    this.hsv = [0, 0, 0];
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.fitted = false;
    this.selection = null; // {x, y, w, h}
    this.floating = null; // {x, y, w, h, data, canvas}
    this.editBase = null; // copy of the frame when a pixel edit started
    this.mask = null;
    this.drag = null;
    this.hover = null;
    this.lastPoint = null;
    this.spaceDown = false;
    this.pointers = new Map();
    this.gesture = null;
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.nextId = 1;
    this.savedId = 0;
    this.selectedAnim = null;
    this.previewPlaying = true;
    this.visible = false;
    this.frameCanvases = [];
    this.seen = {};

    this.build();
    this.readTheme();
    this.onThemeChange = () => { this.readTheme(); this.previewDirty = true; this.render(); };
    this.themeObserver = new MutationObserver(this.onThemeChange);
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    this.colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    this.colorScheme?.addEventListener?.('change', this.onThemeChange);
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.viewport);
    this.ready = this.load();
  }

  get size() { return this.sizes[this.mode]; }
  get frame() { return this.doc.frames[this.current]; }

  // -------------------------------------------------------------------------
  // Files

  async load({ keepView = false } = {}) {
    const { host } = this;
    try {
      const { doc, warnings } = await loadSprite(host, this.pngPath, this.readPath);
      this.failed = null;
      this.errorEl.hidden = true;
      this.setDoc(doc, keepView);
      for (const w of warnings) host.toast(w, { type: 'info', timeout: 6000 });
    } catch (e) {
      console.error(e);
      this.failed = e.message;
      this.errorEl.textContent = `Can't open ${host.path}: ${e.message}`;
      this.errorEl.hidden = false;
      host.toast(`Can't open ${host.path}: ${e.message}`, { type: 'error', timeout: 8000 });
    }
    this.seen = {};
    for (const p of [this.pngPath, this.metaPath, this.legacyPath]) this.seen[p] = host.read(p);
    this.loaded = true;
    this.updateEmptyHint();
    this.render();
  }

  setDoc(doc, keepView) {
    this.doc = doc;
    this.current = keepView ? clamp(this.current, 0, doc.count - 1) : 0;
    this.selection = null;
    this.floating = null;
    this.editBase = null;
    this.mask = null;
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.savedId = 0;
    if (this.selectedAnim && !doc.animations.some((a) => a.name === this.selectedAnim)) this.selectedAnim = null;
    this.rebuildFrames();
    this.updateDirty();
    if (!keepView || !this.fitted) this.fit();
    this.renderAnimations();
    this.renderOrigin();
    this.renderInfo();
  }

  async save() {
    if (!this.loaded || this.failed) return;
    this.commitFloating();
    this.finishDrag();
    const { doc, host } = this;
    const layout = doc.layout();
    const hadMeta = host.exists(this.metaPath) || host.exists(this.legacyPath);
    const { png, json } = await encodeSprite(doc, this.pngPath, this.metaPath, hadMeta);
    this.seen[this.pngPath] = png;
    if (json !== null) this.seen[this.metaPath] = json;
    await host.write(this.pngPath, png);
    if (json !== null) {
      await host.write(this.metaPath, json);
      if (this.readPath !== this.metaPath) {
        this.readPath = this.metaPath;
        if (host.exists(this.legacyPath)) {
          const name = (p) => p.slice(p.lastIndexOf('/') + 1);
          host.toast(`Saved as ${name(this.metaPath)}, the new name for ${name(this.legacyPath)}. The old file isn't used any more and can be deleted.`, { type: 'info', timeout: 8000 });
        }
      }
    }
    doc.columns = layout.columns;
    doc.rows = layout.rows;
    this.savedId = this.undoStack.at(-1)?.id ?? 0;
    this.updateDirty();
    this.renderInfo();
  }

  reload(path) {
    if (path !== this.pngPath && path !== this.metaPath && path !== this.legacyPath) return;
    const data = this.host.read(path);
    if (data === this.seen[path]) return;
    if (this.isDirty()) {
      this.seen[path] = data;
      this.host.toast(`${path} changed outside the image editor. Your unsaved edits are kept; saving replaces the file.`, { type: 'info', timeout: 6000 });
      return;
    }
    if (path === this.metaPath && data !== undefined) this.readPath = this.metaPath;
    this.load({ keepView: true });
  }

  isDirty() {
    return (this.undoStack.at(-1)?.id ?? 0) !== this.savedId;
  }

  updateDirty() {
    this.host.setDirty(this.isDirty());
    if (this.btnUndo) {
      this.btnUndo.disabled = !this.undoStack.length;
      this.btnRedo.disabled = !this.redoStack.length;
    }
  }

  // -------------------------------------------------------------------------
  // Controls

  iconButton(iconName, title, onclick, extra = {}) {
    const { class: cls = '', ...rest } = extra;
    return this.ui.h('button', { type: 'button', class: `spr-ibtn ${cls}`, title, 'aria-label': title, onclick, ...rest }, sicon(iconName));
  }

  /** Buttons where one is on: {el, set(value)}. */
  segmented(options, onChange, label) {
    const { h } = this.ui;
    const el = h('div', { class: 'spr-seg', role: 'radiogroup', 'aria-label': label });
    const buttons = options.map(([value, text, title]) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', title: title || null, onclick: () => onChange(value) }, text);
      b.dataset.value = value;
      return b;
    });
    el.append(...buttons);
    return { el, set: (v) => { for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.value === v)); } };
  }

  /**
   * A labeled slider with a number field: {el, set(value)}. curve > 1 gives
   * the low end more of the track (for brush sizes).
   */
  slider({ label, min, max, unit = '', curve = 1, title, onInput }) {
    const { h } = this.ui;
    const span = max - min;
    const toT = (v) => Math.round(1000 * ((clamp(v, min, max) - min) / span) ** (1 / curve));
    const fromT = (t) => Math.round(min + span * (t / 1000) ** curve);
    let value = min;
    const range = h('input', { type: 'range', class: 'spr-range', min: '0', max: '1000', step: '1', 'aria-label': label });
    const num = h('input', { type: 'text', class: 'spr-num-field', inputmode: 'numeric', spellcheck: 'false', autocomplete: 'off', 'aria-label': `${label}${unit === '%' ? ' (percent)' : ''}` });
    range.addEventListener('input', () => onInput(fromT(Number(range.value))));
    // Give the keyboard back to the canvas (shortcuts) once the slider is let go.
    range.addEventListener('change', () => this.element.focus({ preventScroll: true }));
    const commit = () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v)) onInput(clamp(Math.round(v), min, max));
      else num.value = String(value);
    };
    num.addEventListener('change', commit);
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); num.blur(); this.element.focus({ preventScroll: true }); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        onInput(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), min, max));
      }
    });
    num.addEventListener('focus', () => num.select());
    const el = h('div', { class: 'spr-slider', title: title || null },
      h('span', { class: 'spr-slider-label' }, label), range,
      h('span', { class: 'spr-num-wrap' }, num, unit ? h('span', { class: 'spr-unit' }, unit) : null));
    return {
      el,
      set: (v) => {
        value = v;
        range.value = String(toT(v));
        range.style.setProperty('--fill', `${Number(range.value) / 10}%`);
        if (document.activeElement !== num) num.value = String(v);
      },
    };
  }

  // -------------------------------------------------------------------------
  // DOM

  build() {
    const { h } = this.ui;

    // Tool rail
    this.toolButtons = new Map();
    const rail = h('div', { class: 'spr-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
    for (const t of TOOLS) {
      const b = this.iconButton(t.id, `${t.label} (${t.key})`, () => this.setTool(t.id), { 'aria-pressed': 'false', class: 'spr-tool' });
      this.toolButtons.set(t.id, b);
      if (t.id === 'line' || t.id === 'select') rail.append(h('div', { class: 'spr-rail-sep' }));
      rail.append(b);
    }

    // Tool options
    this.optTitle = h('span', { class: 'spr-opt-title' });
    this.optMode = this.segmented([
      ['smooth', 'Smooth', 'Smooth: antialiased round brush'],
      ['pixel', 'Pixel', 'Pixel: hard square pixels, no antialiasing'],
    ], (v) => this.setMode(v), 'Brush mode');
    this.optSize = this.slider({ label: 'Size', min: 1, max: MAX_BRUSH, unit: 'px', curve: 2.2, title: 'Brush size ([ and ])', onInput: (v) => this.setSize(v) });
    this.optHardness = this.slider({ label: 'Hardness', min: 0, max: 100, unit: '%', title: 'How sharp the brush edge is (Shift+[ and Shift+])', onInput: (v) => this.setHardness(v) });
    this.optOpacity = this.slider({ label: 'Opacity', min: 1, max: 100, unit: '%', title: 'Opacity of each stroke', onInput: (v) => this.setOpacity(v) });
    this.optShape = this.segmented([['outline', 'Outline'], ['filled', 'Filled']], (v) => { this.filled = v === 'filled'; this.persist(); this.renderOptions(); }, 'Shape style');
    this.optTolerance = this.slider({ label: 'Tolerance', min: 0, max: 100, unit: '%', title: 'How different a color can be and still be filled', onInput: (v) => { this.tolerance = v; this.persist(); this.renderOptions(); } });
    this.optContiguous = h('label', { class: 'spr-check', title: 'Fill only the area touching the click. Shift+click does the opposite.' },
      this.contiguousInput = h('input', { type: 'checkbox' }), h('span', {}, 'Contiguous'));
    this.contiguousInput.addEventListener('change', () => { this.contiguous = this.contiguousInput.checked; this.persist(); });
    this.optHint = h('span', { class: 'spr-hint' });
    this.options = h('div', { class: 'spr-options' }, this.optTitle, this.optMode.el, this.optSize.el, this.optHardness.el,
      this.optShape.el, this.optOpacity.el, this.optTolerance.el, this.optContiguous, this.optHint);

    this.btnMirrorX = this.iconButton('mirrorX', 'Mirror left and right: paint on both sides', () => { this.mirrorX = !this.mirrorX; this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });
    this.btnMirrorY = this.iconButton('mirrorY', 'Mirror top and bottom: paint on both halves', () => { this.mirrorY = !this.mirrorY; this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });
    this.btnOnion = this.iconButton('onion', 'Onion skin: see the frames before and after this one', () => { this.onion = !this.onion; this.persist(); this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });
    this.btnSize = h('button', { type: 'button', class: 'spr-btn spr-size-btn', title: 'Image size: scale the image or resize the canvas', onclick: () => this.resizeDialog('image') });
    this.btnUndo = this.iconButton('undo', `Undo (${this.ui.modKey}+Z)`, () => this.undo());
    this.btnRedo = this.iconButton('redo', `Redo (${this.ui.modKey}+Shift+Z)`, () => this.redo());
    const moreBtn = this.iconButton('more', 'More: new image, resize, frames, grid, flip, copy and paste', () => this.showMoreMenu(moreBtn));
    this.top = h('div', { class: 'spr-top' },
      this.options,
      h('div', { class: 'spr-spacer' }),
      h('div', { class: 'spr-group' }, this.btnMirrorX, this.btnMirrorY, this.btnOnion),
      h('div', { class: 'spr-sep' }),
      this.btnSize,
      h('div', { class: 'spr-sep' }),
      h('div', { class: 'spr-group' }, this.btnUndo, this.btnRedo, moreBtn));

    // Canvas
    this.canvas = h('canvas', { class: 'spr-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.statusEl = h('div', { class: 'spr-status' }, this.statusInfo = h('span', {}), this.statusPos = h('span', {}));
    this.errorEl = h('div', { class: 'spr-error', hidden: true });
    this.emptyHint = h('div', { class: 'spr-empty-hint', hidden: true },
      h('strong', {}, 'Pick a color, then drag to paint'),
      h('span', {}, 'Right-click paints with the second color · Space+drag pans · Scroll to zoom'));
    this.btnGrid = this.iconButton('pixelGrid', `Pixel grid (shows from ${GRID_ZOOM}× zoom)`, () => { this.pixelGrid = !this.pixelGrid; this.persist(); this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });
    this.zoomLabel = h('button', { type: 'button', class: 'spr-btn spr-zoom-label', title: 'Zoom: click to fit the image in the view (0)', onclick: () => this.fit() });
    this.viewBar = h('div', { class: 'spr-viewbar' },
      this.btnGrid,
      h('div', { class: 'spr-sep' }),
      this.iconButton('zoomOut', 'Zoom out (-)', () => this.zoomStep(-1)),
      this.zoomLabel,
      this.iconButton('zoomIn', 'Zoom in (+)', () => this.zoomStep(1)),
      this.iconButton('fit', 'Fit to view (0)', () => this.fit()));
    this.viewport = h('div', { class: 'spr-viewport' }, this.canvas, this.emptyHint, this.statusEl, this.viewBar, this.errorEl);
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e, true));
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.renderStatus(); this.render(); } });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Side panel: color, preview and animations, sprite settings
    this.buildColor();
    this.previewCanvas = h('canvas', { class: 'spr-preview-canvas' });
    this.previewCaption = h('div', { class: 'spr-preview-caption' });
    this.btnPreviewPlay = h('button', { type: 'button', class: 'spr-ibtn', title: 'Play or pause the preview (pick an animation below to preview it)', onclick: () => { this.previewPlaying = !this.previewPlaying; this.renderPreviewControls(); this.startPreview(); } });
    this.animList = h('div', { class: 'spr-anim-list', role: 'listbox', 'aria-label': 'Animations' });
    this.animDetail = h('div', { class: 'spr-anim-detail' });
    this.originBody = h('div', { class: 'spr-origin' });
    this.btnOriginTool = h('button', {
      type: 'button', class: 'spr-btn spr-origin-tool', title: 'Click the image to place its origin, the point it is drawn and rotated around (O)',
      'aria-pressed': 'false', onclick: () => this.setTool(this.tool === 'origin' ? 'brush' : 'origin'),
    }, sicon('origin', 14), 'Place');
    this.toolButtons.set('origin', this.btnOriginTool);
    this.infoEl = h('div', { class: 'spr-info' });
    this.settings = this.disclosure('settingsOpen', 'Sprite settings',
      h('div', { class: 'spr-settings' },
        h('div', { class: 'spr-subhead', title: 'The point the image is drawn and rotated around' }, 'Origin'),
        this.originBody,
        this.infoEl));
    this.settings.button.title = 'Origin and sheet layout';
    this.sidePanel = h('div', { class: 'spr-side' },
      this.colorSection,
      h('section', { class: 'spr-section' },
        h('div', { class: 'spr-section-head' }, 'Preview', h('span', { class: 'spr-spacer' }), this.btnPreviewPlay),
        h('div', { class: 'spr-preview' }, this.previewCanvas),
        this.previewCaption,
        h('div', { class: 'spr-section-head spr-section-head-sub' }, 'Animations', h('span', { class: 'spr-spacer' }),
          this.iconButton('plus', 'New animation', () => this.addAnimation())),
        this.animList,
        this.animDetail),
      h('section', { class: 'spr-section' }, this.settings.element));

    // Frames
    this.frameList = h('div', { class: 'spr-frame-list', role: 'listbox', 'aria-label': 'Frames' });
    this.framesBar = h('div', { class: 'spr-frames' },
      h('div', { class: 'spr-frame-actions' },
        h('span', { class: 'spr-frames-label' }, 'Frames'),
        h('div', { class: 'spr-group' },
          this.iconButton('plus', 'New empty frame after this one (, and . move between frames)', () => this.addFrame(false)),
          this.iconButton('copy', 'Duplicate this frame', () => this.addFrame(true)),
          this.btnDeleteFrame = this.iconButton('trash', 'Delete this frame', () => this.deleteFrame(this.current)))),
      this.frameList);

    this.element = h('div', { class: 'spr', tabindex: '-1' },
      this.top,
      h('div', { class: 'spr-body' }, rail, this.viewport, this.sidePanel),
      this.framesBar);
    this.probe = h('span', { class: 'spr-probe', 'aria-hidden': 'true' });
    this.element.append(this.probe);
    this.element.addEventListener('keydown', (e) => {
      if (this.onKeyDown(e)) { e.preventDefault(); e.stopPropagation(); }
    });
    this.element.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.code === 'Space') { this.spaceDown = false; this.updateCursor(); this.render(); }
    });
    this.onBlur = () => { this.spaceDown = false; this.updateCursor(); };
    window.addEventListener('blur', this.onBlur);

    this.renderToolbar();
    this.setPrimary(this.primary);
    this.renderPalette();
    this.renderRecent();
    this.renderPreviewControls();
  }

  buildColor() {
    const { h } = this.ui;
    this.primarySwatch = h('button', { type: 'button', class: 'spr-swatch spr-primary', title: 'Color for the left button; the picker below changes it', onclick: () => this.hexInput.focus() });
    this.secondarySwatch = h('button', { type: 'button', class: 'spr-swatch spr-secondary', title: 'Color for the right button (transparent erases). Click to swap (X)', onclick: () => this.swapColors() });
    this.hexInput = h('input', { type: 'text', class: 'spr-input spr-hex', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Color (hex)', title: 'Hex color: #rrggbb, or #rrggbbaa with alpha' });
    this.hexInput.addEventListener('change', () => {
      const c = draw.hexToRgba(this.hexInput.value);
      if (c) { this.setPrimary(c); this.addRecent(c); } else this.renderColor();
    });
    this.hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.hexInput.blur(); this.element.focus({ preventScroll: true }); } });
    this.alphaLabel = h('span', { class: 'spr-alpha-label', title: 'Alpha' });

    this.svHandle = h('div', { class: 'spr-handle' });
    this.svBox = h('div', { class: 'spr-sv', role: 'slider', tabindex: '0', 'aria-label': 'Saturation and brightness' }, this.svHandle);
    this.hueHandle = h('div', { class: 'spr-handle' });
    this.hueBar = h('div', { class: 'spr-bar spr-hue', role: 'slider', tabindex: '0', 'aria-label': 'Hue', 'aria-valuemin': '0', 'aria-valuemax': '360' }, this.hueHandle);
    this.alphaHandle = h('div', { class: 'spr-handle' });
    this.alphaFill = h('div', { class: 'spr-bar-fill' });
    this.alphaBar = h('div', { class: 'spr-bar spr-alpha', role: 'slider', tabindex: '0', 'aria-label': 'Alpha', 'aria-valuemin': '0', 'aria-valuemax': '255' }, this.alphaFill, this.alphaHandle);

    const setHsv = (hh, s, v) => {
      this.hsv = [hh, s, v];
      const [r, g, b] = draw.hsvToRgb(hh, s, v);
      this.setPrimary([r, g, b, this.primary[3] || 255], { fromPicker: true });
    };
    this.dragArea(this.svBox, (x, y) => setHsv(this.hsv[0], x, 1 - y));
    this.dragArea(this.hueBar, (x) => setHsv(x * 360, this.hsv[1], this.hsv[2]));
    this.dragArea(this.alphaBar, (x) => this.setPrimary([this.primary[0], this.primary[1], this.primary[2], Math.round(x * 255)], { fromPicker: true }));
    this.arrowKeys(this.svBox, (dx, dy, big) => setHsv(this.hsv[0], clamp(this.hsv[1] + dx * (big ? 0.1 : 0.01), 0, 1), clamp(this.hsv[2] - dy * (big ? 0.1 : 0.01), 0, 1)));
    this.arrowKeys(this.hueBar, (dx, dy, big) => setHsv(((this.hsv[0] + (dx - dy) * (big ? 10 : 1)) % 360 + 360) % 360, this.hsv[1], this.hsv[2]));
    this.arrowKeys(this.alphaBar, (dx, dy, big) => this.setPrimary([...this.primary.slice(0, 3), clamp(this.primary[3] + (dx - dy) * (big ? 16 : 1), 0, 255)], { fromPicker: true }));

    this.recentGrid = h('div', { class: 'spr-swatches', 'aria-label': 'Recent colors' });
    this.recentHead = h('div', { class: 'spr-subhead' }, 'Recent');
    this.paletteSelect = h('select', { class: 'spr-select', 'aria-label': 'Palette', title: 'Show a set of colors to pick from' });
    this.paletteSelect.addEventListener('change', () => { this.paletteId = this.paletteSelect.value; this.persist(); this.renderPalette(); });
    this.paletteGrid = h('div', { class: 'spr-swatches', 'aria-label': 'Palette colors' });

    this.colorSection = h('section', { class: 'spr-section spr-color' },
      h('div', { class: 'spr-section-head' }, 'Color'),
      h('div', { class: 'spr-color-row' },
        h('div', { class: 'spr-swatch-pair' }, this.secondarySwatch, this.primarySwatch),
        h('div', { class: 'spr-color-fields' },
          this.hexInput,
          h('div', { class: 'spr-color-meta' },
            this.iconButton('swap', 'Swap the two colors (X)', () => this.swapColors()),
            this.alphaLabel))),
      this.svBox,
      this.hueBar,
      this.alphaBar,
      this.recentHead,
      this.recentGrid,
      h('div', { class: 'spr-subhead spr-subhead-row' }, h('span', {}, 'Palette'), this.paletteSelect),
      this.paletteGrid);
  }

  /** Pointer dragging over el, reporting the position as 0-1 fractions of its size. */
  dragArea(el, onPos) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      capture(el, e.pointerId);
      const move = (ev) => {
        const r = el.getBoundingClientRect();
        onPos(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      move(e);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  arrowKeys(el, fn) {
    el.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      fn(d[0], d[1], e.shiftKey);
    });
  }

  persist() {
    Object.assign(this.prefs, {
      modes: { ...this.prefs.modes, [this.pixelProject ? 'pixel' : 'smooth']: this.mode },
      sizes: this.sizes, hardness: this.hardness, opacity: this.opacity, tolerance: this.tolerance,
      contiguous: this.contiguous, filled: this.filled, pixelGrid: this.pixelGrid, grid: this.grid,
      gridW: this.gridW, gridH: this.gridH, onion: this.onion, recent: this.recent, palette: this.paletteId,
    });
    savePrefs(this.prefs);
  }

  /** A section folded away by default; open or closed is remembered in prefs[key]. */
  disclosure(key, label, body) {
    const { h } = this.ui;
    const note = h('span', { class: 'spr-disclosure-note' });
    const button = h('button', { type: 'button', class: 'spr-disclosure', 'aria-expanded': 'false' },
      h('span', { class: 'spr-disclosure-chevron', 'aria-hidden': 'true' }, sicon('chevronRight', 14)),
      h('span', {}, label), note);
    const d = {
      button, body, note,
      element: h('div', { class: 'spr-disclosure-wrap' }, button, body),
      setOpen: (on) => {
        button.setAttribute('aria-expanded', String(!!on));
        body.hidden = !on;
      },
    };
    button.addEventListener('click', () => {
      const open = body.hidden;
      d.setOpen(open);
      this.prefs[key] = open;
      savePrefs(this.prefs);
    });
    d.setOpen(!!this.prefs[key]);
    return d;
  }

  /** Theme colors for the canvas, resolved to plain colors through a probe element. */
  readTheme() {
    const resolve = (name, fallback) => {
      this.probe.style.color = fallback;
      this.probe.style.color = `var(${name}, ${fallback})`;
      return this.probe.isConnected ? getComputedStyle(this.probe).color || fallback : fallback;
    };
    this.theme = {
      bg: resolve('--editor-bg', '#1d1e22'),
      border: resolve('--border-strong', '#5a5d66'),
      accent: resolve('--accent', '#3b82f6'),
      checkA: resolve('--panel-elev', '#3a3c42'),
      checkB: resolve('--border', '#2c2e33'),
      line: resolve('--fg', '#eeeeee'),
    };
    const p = document.createElement('canvas');
    p.width = p.height = 2;
    const pc = p.getContext('2d');
    pc.fillStyle = this.theme.checkA;
    pc.fillRect(0, 0, 2, 2);
    pc.fillStyle = this.theme.checkB;
    pc.fillRect(0, 0, 1, 1);
    pc.fillRect(1, 1, 1, 1);
    this.checker = this.ctx.createPattern(p, 'repeat');
    this.previewChecker = null;
  }

  // -------------------------------------------------------------------------
  // Tool state

  setTool(id) {
    if (this.tool === id) return;
    if (this.drag) this.finishDrag();
    if (id !== 'select') this.commitFloating();
    this.tool = id;
    if (id === 'rect' || id === 'ellipse') this.lastShape = id;
    this.renderToolbar();
    this.updateCursor();
    this.render();
  }

  setMode(mode) {
    this.mode = mode === 'pixel' ? 'pixel' : 'smooth';
    this.persist();
    this.renderOptions();
    this.updateCursor();
    this.render();
  }

  setSize(n) {
    this.sizes[this.mode] = clamp(Math.round(n), 1, MAX_BRUSH);
    this.persist();
    this.renderOptions();
    this.updateCursor();
    this.render();
  }

  stepSize(dir) {
    const s = this.size;
    this.setSize(dir > 0 ? Math.max(s + 1, Math.round(s * 1.2)) : Math.min(s - 1, Math.round(s / 1.2)));
  }

  setHardness(v) {
    this.hardness = clamp(Math.round(v), 0, 100);
    this.persist();
    this.renderOptions();
  }

  setOpacity(v) {
    this.opacity = clamp(Math.round(v), 1, 100);
    this.persist();
    this.renderOptions();
  }

  renderToolbar() {
    for (const [id, b] of this.toolButtons) b.setAttribute('aria-pressed', String(id === this.tool));
    this.btnMirrorX.setAttribute('aria-pressed', String(this.mirrorX));
    this.btnMirrorY.setAttribute('aria-pressed', String(this.mirrorY));
    this.btnGrid.setAttribute('aria-pressed', String(this.pixelGrid));
    this.btnOnion.setAttribute('aria-pressed', String(this.onion));
    this.btnOnion.hidden = this.doc.count < 2;
    this.renderOptions();
    this.renderZoom();
  }

  renderOptions() {
    const t = this.tool;
    const paint = PAINT_TOOLS.has(t);
    const brush = t === 'brush' || t === 'eraser';
    this.optTitle.textContent = TOOL_LABELS[t] || '';
    this.optMode.el.hidden = !paint;
    this.optMode.set(this.mode);
    this.optSize.el.hidden = !paint;
    this.optSize.set(this.size);
    this.optHardness.el.hidden = !(brush && this.mode === 'smooth');
    this.optHardness.set(this.hardness);
    this.optShape.el.hidden = !(t === 'rect' || t === 'ellipse');
    this.optShape.set(this.filled ? 'filled' : 'outline');
    this.optOpacity.el.hidden = !(paint || t === 'fill');
    this.optOpacity.set(this.opacity);
    this.optTolerance.el.hidden = t !== 'fill';
    this.optTolerance.set(this.tolerance);
    this.optContiguous.hidden = t !== 'fill';
    this.contiguousInput.checked = this.contiguous;
    const hints = {
      picker: 'Click to pick a color · right-click picks the second color · Alt+click with any tool',
      select: 'Drag to select · drag inside to move · Alt+drag copies · arrows nudge',
      origin: 'Click to place the origin · right-click clears it',
      line: '',
      rect: '',
      ellipse: '',
    };
    this.optHint.textContent = hints[t] || '';
    this.optHint.hidden = !hints[t];
  }

  updateCursor() {
    let c = 'crosshair';
    if (this.spaceDown || this.drag?.kind === 'pan') c = this.drag?.kind === 'pan' ? 'grabbing' : 'grab';
    else if (this.tool === 'select' && this.hover && this.insideSelection(this.hover.x, this.hover.y)) c = 'move';
    else if (this.drag?.kind === 'move') c = 'move';
    else if ((this.tool === 'brush' || this.tool === 'eraser') && this.mode === 'smooth' && this.size * this.zoom >= 6) c = 'none';
    this.canvas.style.cursor = c;
  }

  showMoreMenu(anchor) {
    const sel = this.selection || this.floating;
    const m = this.ui.modKey;
    this.ui.showMenu(anchor, [
      { label: 'New image…', icon: 'filePlus', action: () => this.newImageDialog() },
      '-',
      { label: 'Scale image…', icon: 'maximize', action: () => this.resizeDialog('image') },
      { label: 'Resize canvas…', action: () => this.resizeDialog('canvas') },
      { label: 'Split into frames…', icon: 'hash', action: () => this.splitDialog() },
      '-',
      { label: this.grid ? 'Hide grid' : 'Show grid', icon: 'grid', action: () => { this.grid = !this.grid; this.persist(); this.render(); } },
      { label: `Grid size (${this.gridW}×${this.gridH})…`, action: () => this.gridDialog() },
      '-',
      { label: sel ? 'Flip selection horizontally' : 'Flip horizontally', shortcut: 'Shift+H', action: () => this.flip(true) },
      { label: sel ? 'Flip selection vertically' : 'Flip vertically', shortcut: 'Shift+V', action: () => this.flip(false) },
      '-',
      { label: 'Select all', shortcut: `${m}+A`, action: () => { this.setTool('select'); this.selectAll(); } },
      { label: 'Deselect', shortcut: `${m}+D`, disabled: !sel, action: () => this.deselect() },
      { label: 'Copy', shortcut: `${m}+C`, icon: 'copy', action: () => this.copy() },
      { label: 'Cut', shortcut: `${m}+X`, action: () => this.cut() },
      { label: 'Paste', shortcut: `${m}+V`, disabled: !clipboard, action: () => this.paste() },
      '-',
      { label: 'Clear origin', disabled: !this.doc.origin, action: () => this.setOrigin(null, true) },
    ]);
  }

  // -------------------------------------------------------------------------
  // Colors

  setPrimary(c, { fromPicker = false } = {}) {
    this.primary = [c[0], c[1], c[2], c[3]];
    if (!fromPicker) {
      const [hh, s, v] = draw.rgbToHsv(c[0], c[1], c[2]);
      // Keep the hue (and saturation) where they don't show, so the picker doesn't jump.
      this.hsv = [s > 0 && v > 0 ? hh : this.hsv[0], v > 0 ? s : this.hsv[1], v];
    }
    this.renderColor();
  }

  setSecondary(c) {
    this.secondary = [c[0], c[1], c[2], c[3]];
    this.renderColor();
  }

  swapColors() {
    const p = this.primary;
    this.primary = this.secondary;
    this.secondary = p;
    this.setPrimary(this.primary);
  }

  addRecent(c) {
    if (!c || c[3] === 0) return;
    const hex = draw.rgbaToHex(c);
    if (this.recent[0] === hex) return;
    this.recent = [hex, ...this.recent.filter((x) => x !== hex)].slice(0, MAX_RECENT);
    this.persist();
    this.renderRecent();
  }

  swatch(hex, title) {
    const c = draw.hexToRgba(hex) || TRANSPARENT;
    const el = this.ui.h('button', { type: 'button', class: 'spr-swatch', title: `${title} (right-click: second color)`, 'aria-label': title });
    el.style.setProperty('--c', draw.cssColor(c));
    el.dataset.hex = draw.rgbaToHex(c);
    el.addEventListener('click', () => { this.setPrimary(c); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.setSecondary(c); });
    return el;
  }

  renderColor() {
    const [r, g, b, a] = this.primary;
    const [hh, s, v] = this.hsv;
    this.primarySwatch.style.setProperty('--c', draw.cssColor(this.primary));
    this.secondarySwatch.style.setProperty('--c', draw.cssColor(this.secondary));
    this.secondarySwatch.classList.toggle('transparent', this.secondary[3] === 0);
    if (document.activeElement !== this.hexInput) this.hexInput.value = draw.rgbaToHex(this.primary);
    this.alphaLabel.textContent = `${Math.round((a / 255) * 100)}%`;
    this.svBox.style.setProperty('--hue', `hsl(${hh} 100% 50%)`);
    this.svHandle.style.left = `${s * 100}%`;
    this.svHandle.style.top = `${(1 - v) * 100}%`;
    this.svHandle.style.setProperty('--c', `rgb(${r}, ${g}, ${b})`);
    this.svBox.setAttribute('aria-valuetext', `saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`);
    this.hueHandle.style.left = `${(hh / 360) * 100}%`;
    this.hueHandle.style.setProperty('--c', `hsl(${hh} 100% 50%)`);
    this.hueBar.setAttribute('aria-valuenow', String(Math.round(hh)));
    this.alphaFill.style.setProperty('--c', `rgb(${r}, ${g}, ${b})`);
    this.alphaHandle.style.left = `${(a / 255) * 100}%`;
    this.alphaHandle.style.setProperty('--c', draw.cssColor(this.primary));
    this.alphaBar.setAttribute('aria-valuenow', String(a));
    const cur = draw.rgbaToHex(this.primary);
    for (const grid of [this.paletteGrid, this.recentGrid]) {
      for (const el of grid?.children || []) el.classList.toggle('selected', el.dataset.hex === cur);
    }
  }

  palettes() {
    const own = projectPalette(this.host);
    return own ? [...PALETTES, { id: 'project', label: 'Project', colors: own }] : PALETTES;
  }

  renderPalette() {
    const { h } = this.ui;
    const list = this.palettes();
    if (!list.some((p) => p.id === this.paletteId)) this.paletteId = 'none';
    this.paletteSelect.replaceChildren(...list.map((p) => h('option', { value: p.id }, p.label)));
    this.paletteSelect.value = this.paletteId;
    const pal = list.find((p) => p.id === this.paletteId);
    this.paletteGrid.replaceChildren(...pal.colors.map((c) => this.swatch(c, c)));
    this.paletteGrid.hidden = !pal.colors.length;
    this.renderColor();
  }

  renderRecent() {
    this.recentGrid.replaceChildren(...this.recent.map((c) => this.swatch(c, c)));
    this.recentHead.hidden = !this.recent.length;
    this.recentGrid.hidden = !this.recent.length;
    this.renderColor();
  }

  pickColor(p, secondary) {
    const { fw, fh } = this.doc;
    if (p.x < 0 || p.y < 0 || p.x >= fw || p.y >= fh) return;
    const i = (p.y * fw + p.x) * 4;
    const f = this.frame;
    const c = f[i + 3] === 0 ? TRANSPARENT.slice() : [f[i], f[i + 1], f[i + 2], f[i + 3]];
    if (secondary) this.setSecondary(c); else if (!sameColor(c, this.primary)) this.setPrimary(c);
  }

  // -------------------------------------------------------------------------
  // Frames

  rebuildFrames() {
    const { doc } = this;
    const { h } = this.ui;
    this.builtFor = { fw: doc.fw, fh: doc.fh, frames: doc.frames.slice() };
    this.frameCanvases = doc.frames.map(() => {
      const c = document.createElement('canvas');
      c.width = doc.fw;
      c.height = doc.fh;
      return c;
    });
    doc.frames.forEach((_, i) => this.updateFrameCanvas(i));
    const s = Math.min(44 / doc.fw, 44 / doc.fh);
    const scale = s >= 1 ? Math.floor(s) : s;
    this.frameItems = this.frameCanvases.map((c, i) => {
      c.className = `spr-thumb${scale >= 1 ? ' pixelated' : ''}`;
      c.style.width = `${Math.max(1, Math.round(doc.fw * scale))}px`;
      c.style.height = `${Math.max(1, Math.round(doc.fh * scale))}px`;
      const item = h('div', { class: 'spr-frame', role: 'option', title: `Frame ${i}` },
        h('div', { class: 'spr-thumb-box' }, c),
        h('span', { class: 'spr-frame-num' }, String(i)),
        h('span', { class: 'spr-frame-badge' }));
      item.addEventListener('pointerdown', (e) => this.onFramePointerDown(e, i));
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); this.frameMenu(e, i); });
      return item;
    });
    this.frameList.replaceChildren(...this.frameItems);
    this.current = clamp(this.current, 0, doc.count - 1);
    this.renderFrames();
    this.renderInfo();
    this.render();
  }

  /** Copy a frame's pixels (or the part in box) to its canvas. */
  updateFrameCanvas(i, box = null) {
    const c = this.frameCanvases[i];
    if (!c) return;
    const { fw, fh } = this.doc;
    const img = new ImageData(this.doc.frames[i], fw, fh);
    const ctx = c.getContext('2d');
    if (box) ctx.putImageData(img, 0, 0, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    else ctx.putImageData(img, 0, 0);
    this.previewDirty = true;
    if (!box || !this.emptyHint.hidden) this.updateEmptyHint();
  }

  /** The "how to paint" hint, for an image with one empty frame. */
  updateEmptyHint() {
    const { doc } = this;
    let empty = this.loaded && !this.failed && doc.count === 1;
    if (empty) {
      const f = doc.frames[0];
      for (let i = 3; i < f.length; i += 4) if (f[i]) { empty = false; break; }
    }
    this.emptyHint.hidden = !empty;
  }

  renderFrames() {
    const anim = this.doc.animations.find((a) => a.name === this.selectedAnim);
    this.frameItems?.forEach((item, i) => {
      item.classList.toggle('current', i === this.current);
      item.setAttribute('aria-selected', String(i === this.current));
      const pos = anim ? anim.frames.flatMap((f, k) => (f === i ? [k + 1] : [])) : [];
      item.classList.toggle('in-anim', pos.length > 0);
      item.lastChild.textContent = pos.length ? `#${pos.join(',')}` : '';
      item.lastChild.title = pos.length ? `Step ${pos.join(', ')} of "${anim.name}"` : '';
    });
    this.btnDeleteFrame.disabled = this.doc.count <= 1;
    this.btnOnion.hidden = this.doc.count < 2;
    this.frameItems?.[this.current]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  goToFrame(i) {
    i = clamp(i, 0, this.doc.count - 1);
    if (i === this.current) return;
    this.finishDrag();
    this.commitFloating();
    this.current = i;
    this.renderFrames();
    this.renderStatus();
    this.render();
  }

  addFrame(duplicate) {
    this.change(() => {
      const data = duplicate ? this.frame.slice() : new Uint8ClampedArray(this.doc.fw * this.doc.fh * 4);
      this.doc.insertFrame(this.current + 1, data);
      this.current += 1;
    });
  }

  deleteFrame(i) {
    if (this.doc.count <= 1) return;
    this.change(() => {
      this.doc.deleteFrame(i);
      if (this.current >= this.doc.count || this.current > i) this.current = Math.max(0, this.current - 1);
    });
  }

  moveFrame(from, to) {
    if (from === to) return;
    this.change(() => {
      this.doc.moveFrame(from, to);
      this.current = to;
    });
  }

  frameMenu(e, i) {
    const anim = this.doc.animations.find((a) => a.name === this.selectedAnim);
    const items = [
      { label: 'Duplicate', icon: 'copy', action: () => { this.goToFrame(i); this.addFrame(true); } },
      { label: 'Insert empty frame after', icon: 'plus', action: () => { this.goToFrame(i); this.addFrame(false); } },
      { label: 'Move left', disabled: i === 0, action: () => this.moveFrame(i, i - 1) },
      { label: 'Move right', disabled: i === this.doc.count - 1, action: () => this.moveFrame(i, i + 1) },
    ];
    if (anim) {
      items.push('-',
        { label: `Add to "${anim.name}"`, icon: 'plus', action: () => this.editAnimation(anim.name, (a) => { a.frames.push(i); }) },
        { label: `Remove from "${anim.name}"`, disabled: !anim.frames.includes(i), action: () => this.editAnimation(anim.name, (a) => { a.frames = a.frames.filter((f) => f !== i); }) });
    }
    items.push('-', { label: 'Delete', icon: 'trash', danger: true, disabled: this.doc.count <= 1, action: () => this.deleteFrame(i) });
    this.ui.showMenu({ x: e.clientX, y: e.clientY }, items);
  }

  onFramePointerDown(e, i) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.element.focus({ preventScroll: true });
    const item = this.frameItems[i];
    const startX = e.clientX;
    let target = i;
    let dragging = false;
    capture(item, e.pointerId);
    const clearMarks = () => this.frameItems.forEach((it) => it.classList.remove('drop-before', 'drop-after', 'dragging'));
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - startX) < 5) return;
      dragging = true;
      clearMarks();
      item.classList.add('dragging');
      // Where it would land: before the first item whose middle is right of the pointer.
      let idx = this.frameItems.findIndex((it) => {
        const r = it.getBoundingClientRect();
        return ev.clientX < r.left + r.width / 2;
      });
      if (idx < 0) idx = this.frameItems.length;
      target = idx > i ? idx - 1 : idx;
      if (idx < this.frameItems.length) this.frameItems[idx].classList.add('drop-before');
      else this.frameItems.at(-1).classList.add('drop-after');
    };
    const up = () => {
      item.removeEventListener('pointermove', move);
      item.removeEventListener('pointerup', up);
      item.removeEventListener('pointercancel', up);
      clearMarks();
      if (dragging) this.moveFrame(i, target);
      else this.goToFrame(i);
    };
    item.addEventListener('pointermove', move);
    item.addEventListener('pointerup', up);
    item.addEventListener('pointercancel', up);
  }

  // -------------------------------------------------------------------------
  // Undo
  //
  // Two kinds of entries: "pixels" (the changed rectangle of one frame,
  // before and after) and "doc" (snapshots of the frame list, size, origin
  // and animations; frame buffers are shared, so a resize keeps the old
  // buffers and the new ones).

  /** A change to the image's structure (frames, size, origin, animations). */
  change(fn) {
    this.finishDrag();
    this.commitFloating();
    const before = this.doc.snapshot();
    const beforeCurrent = this.current;
    fn();
    const after = this.doc.snapshot();
    const same = before.fw === after.fw && before.fh === after.fh && before.columns === after.columns
      && before.frames.length === after.frames.length && before.frames.every((f, i) => f === after.frames[i])
      && JSON.stringify([before.origin, before.animations]) === JSON.stringify([after.origin, after.animations]);
    if (!same) {
      const kept = new Set(before.frames);
      const bytes = after.frames.reduce((n, f) => n + (kept.has(f) ? 0 : f.length), 0);
      this.pushUndo({ kind: 'doc', before, after, beforeCurrent, afterCurrent: this.current, bytes });
    }
    this.afterStructureChange();
  }

  afterStructureChange() {
    if (this.selection) this.selection = this.clipRect(this.selection);
    const built = this.builtFor;
    const { doc } = this;
    if (built && built.fw === doc.fw && built.fh === doc.fh && built.frames.length === doc.count && built.frames.every((f, i) => f === doc.frames[i])) {
      // Same frames (an origin or animation change): no new thumbnails needed.
      this.current = clamp(this.current, 0, doc.count - 1);
      this.renderFrames();
      this.renderInfo();
      this.render();
    } else {
      this.rebuildFrames();
    }
    this.renderToolbar();
    this.renderAnimations();
    this.renderOrigin();
  }

  pushUndo(entry) {
    entry.id = this.nextId++;
    this.undoStack.push(entry);
    this.undoBytes += entry.bytes || 0;
    this.redoStack = [];
    while (this.undoStack.length > MAX_UNDO || (this.undoBytes > MAX_UNDO_BYTES && this.undoStack.length > 1)) {
      const old = this.undoStack.shift();
      this.undoBytes -= old.bytes || 0;
      // The saved state can no longer be reached by undoing.
      if (old.id === this.savedId) this.savedId = -1;
    }
    this.updateDirty();
  }

  beginPixelEdit() {
    if (this.editBase) return;
    this.editBase = this.frame.slice();
    this.editFrame = this.current;
  }

  /** Record what changed since beginPixelEdit (only the changed rectangle is kept). */
  endPixelEdit() {
    if (!this.editBase) return;
    const { fw, fh } = this.doc;
    const f = this.doc.frames[this.editFrame];
    const r = f && f.length === this.editBase.length ? draw.diffRect(this.editBase, f, fw, fh) : null;
    if (r) {
      this.pushUndo({
        kind: 'pixels', frame: this.editFrame, rect: r,
        before: draw.extract(this.editBase, fw, fh, r.x, r.y, r.w, r.h),
        after: draw.extract(f, fw, fh, r.x, r.y, r.w, r.h),
        bytes: r.w * r.h * 8,
      });
    }
    this.editBase = null;
  }

  cancelPixelEdit() {
    if (!this.editBase) return;
    this.doc.frames[this.editFrame].set(this.editBase);
    this.updateFrameCanvas(this.editFrame);
    this.editBase = null;
  }

  undo() {
    this.finishDrag();
    this.commitFloating();
    const e = this.undoStack.pop();
    if (!e) return;
    this.undoBytes -= e.bytes || 0;
    this.redoStack.push(e);
    this.apply(e, 'before');
  }

  redo() {
    this.finishDrag();
    this.commitFloating();
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push(e);
    this.undoBytes += e.bytes || 0;
    this.apply(e, 'after');
  }

  apply(e, which) {
    if (e.kind === 'pixels') {
      const { fw, fh } = this.doc;
      const r = e.rect;
      draw.stamp(this.doc.frames[e.frame], fw, fh, e[which], r.x, r.y, r.w, r.h);
      this.updateFrameCanvas(e.frame, toBox(r));
      this.updateEmptyHint();
      if (this.current !== e.frame) { this.current = e.frame; this.renderFrames(); }
      this.render();
    } else {
      this.doc.restore(e[which]);
      this.current = which === 'before' ? e.beforeCurrent : e.afterCurrent;
      const resized = e.before.fw !== e.after.fw || e.before.fh !== e.after.fh;
      this.afterStructureChange();
      if (resized) this.fit();
    }
    this.updateDirty();
    this.renderStatus();
  }

  // -------------------------------------------------------------------------
  // Painting

  clipRect(r) {
    const { fw, fh } = this.doc;
    const x0 = clamp(r.x, 0, fw), y0 = clamp(r.y, 0, fh);
    const x1 = clamp(r.x + r.w, 0, fw), y1 = clamp(r.y + r.h, 0, fh);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  insideSelection(x, y) {
    const s = this.floating || this.selection;
    return !!s && x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;
  }

  /** Painting stays inside the selection, if there is one. */
  clip() {
    const s = this.floating ? null : this.selection;
    return s ? toBox(s) : null;
  }

  prepareMask() {
    const { fw, fh } = this.doc;
    if (!this.mask || this.mask.w !== fw || this.mask.h !== fh) this.mask = new draw.Mask(fw, fh);
    else this.mask.clear();
    return this.mask;
  }

  mirror(p, mx, my) {
    const { fw, fh } = this.doc;
    return { x: mx ? fw - 1 - p.x : p.x, y: my ? fh - 1 - p.y : p.y, fx: mx ? fw - p.fx : p.fx, fy: my ? fh - p.fy : p.fy };
  }

  /** [a, b] and its mirror images. */
  mirrorPairs(a, b) {
    const out = [[a, b]];
    if (this.mirrorX) out.push([this.mirror(a, true, false), this.mirror(b, true, false)]);
    if (this.mirrorY) out.push([this.mirror(a, false, true), this.mirror(b, false, true)]);
    if (this.mirrorX && this.mirrorY) out.push([this.mirror(a, true, true), this.mirror(b, true, true)]);
    return out;
  }

  frameChanged(box = null) {
    this.updateFrameCanvas(this.current, box);
    this.render();
  }

  /** Paint d's color through the mask over box. */
  paintBox(d, box) {
    if (!box) return;
    draw.composite(this.frame, this.editBase, this.mask, this.doc.fw, box, d.color, this.opacity / 100, d.erase);
    this.frameChanged(box);
  }

  /** Add the brush dragged from a to b (and its mirrors) to the mask; returns the box touched. */
  strokeMask(a, b) {
    const clip = this.clip();
    let box = null;
    for (const [s, t] of this.mirrorPairs(a, b)) {
      box = draw.union(box, this.mode === 'pixel'
        ? draw.pixelLine(this.mask, s.x, s.y, t.x, t.y, this.size, clip)
        : draw.capsule(this.mask, s.fx, s.fy, t.fx, t.fy, this.size / 2, this.hardness / 100, clip));
    }
    return box;
  }

  startStroke(base, p, shift) {
    this.beginPixelEdit();
    this.prepareMask();
    const d = { ...base, kind: 'stroke', last: p };
    this.drag = d;
    this.paintBox(d, this.strokeMask(shift && this.lastPoint ? this.lastPoint : p, p));
  }

  /** Shift: lines snap to 45°, rectangles and ellipses become squares and circles. */
  constrain(a, b, shift, tool) {
    if (!shift) return [a, b];
    const snap = (dx, dy) => {
      const n = Math.max(Math.abs(dx), Math.abs(dy));
      if (tool === 'line') {
        if (Math.abs(dx) > 2 * Math.abs(dy)) return [dx, 0];
        if (Math.abs(dy) > 2 * Math.abs(dx)) return [0, dy];
      }
      return [Math.sign(dx || 1) * n, Math.sign(dy || 1) * n];
    };
    const [ix, iy] = snap(b.x - a.x, b.y - a.y);
    const [fx, fy] = snap(b.fx - a.fx, b.fy - a.fy);
    return [a, { x: a.x + ix, y: a.y + iy, fx: a.fx + fx, fy: a.fy + fy }];
  }

  shapeMask(tool, s, t) {
    const clip = this.clip(), n = this.size, m = this.mask;
    const pixel = this.mode === 'pixel';
    if (tool === 'line') {
      return pixel ? draw.pixelLine(m, s.x, s.y, t.x, t.y, n, clip) : draw.capsule(m, s.fx, s.fy, t.fx, t.fy, n / 2, 1, clip);
    }
    if (pixel) {
      const x0 = Math.min(s.x, t.x), x1 = Math.max(s.x, t.x), y0 = Math.min(s.y, t.y), y1 = Math.max(s.y, t.y);
      return tool === 'rect'
        ? draw.rectShape(m, x0, y0, x1 + 1, y1 + 1, n, this.filled, clip)
        : draw.pixelEllipse(m, x0, y0, x1, y1, n, this.filled, clip);
    }
    const L = Math.round(Math.min(s.fx, t.fx)), T = Math.round(Math.min(s.fy, t.fy));
    const R = Math.max(L + 1, Math.round(Math.max(s.fx, t.fx))), B = Math.max(T + 1, Math.round(Math.max(s.fy, t.fy)));
    return tool === 'rect'
      ? draw.rectShape(m, L, T, R, B, n, this.filled, clip)
      : draw.ellipseShape(m, L, T, R, B, n, this.filled, clip);
  }

  drawShape(d) {
    const [a, b] = this.constrain(d.start, d.end, d.shift, d.tool);
    this.mask.clear();
    let box = null;
    for (const [s, t] of this.mirrorPairs(a, b)) box = draw.union(box, this.shapeMask(d.tool, s, t));
    const area = draw.union(box, d.prev);
    d.prev = box;
    d.shownEnd = b;
    if (area) {
      draw.composite(this.frame, this.editBase, this.mask, this.doc.fw, area, d.color, this.opacity / 100, d.erase);
      this.frameChanged(area);
    }
  }

  doFill(p, color, global) {
    const { fw, fh } = this.doc;
    const erase = color[3] === 0;
    this.beginPixelEdit();
    this.prepareMask();
    const clip = this.clip();
    const tol = Math.round(this.tolerance * 2.55);
    let box = null;
    for (const [q] of this.mirrorPairs(p, p)) box = draw.union(box, draw.floodMask(this.mask, this.editBase, fw, fh, q.x, q.y, tol, !global, clip));
    if (box) draw.composite(this.frame, this.editBase, this.mask, fw, box, color, this.opacity / 100, erase);
    this.endPixelEdit();
    if (box) this.frameChanged(box);
    if (!erase) this.addRecent(color);
  }

  // Selection and the floating (lifted) pixels

  makeFloating(x, y, w, h, data) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const f = { x, y, w, h, data, canvas };
    this.updateFloatingCanvas(f);
    return f;
  }

  updateFloatingCanvas(f) {
    f.canvas.getContext('2d').putImageData(new ImageData(f.data, f.w, f.h), 0, 0);
  }

  liftSelection(copy) {
    if (this.floating || !this.selection) return;
    const { fw, fh } = this.doc;
    const s = this.selection;
    this.beginPixelEdit();
    const data = draw.extract(this.frame, fw, fh, s.x, s.y, s.w, s.h);
    if (!copy) draw.stamp(this.frame, fw, fh, new Uint8ClampedArray(s.w * s.h * 4), s.x, s.y, s.w, s.h);
    this.floating = this.makeFloating(s.x, s.y, s.w, s.h, data);
    this.frameChanged(toBox(s));
  }

  commitFloating() {
    const fl = this.floating;
    if (!fl) return;
    const { fw, fh } = this.doc;
    draw.stamp(this.frame, fw, fh, fl.data, fl.x, fl.y, fl.w, fl.h, true);
    this.floating = null;
    this.selection = this.clipRect(fl);
    this.endPixelEdit();
    this.frameChanged();
  }

  selectAll() {
    this.commitFloating();
    this.selection = { x: 0, y: 0, w: this.doc.fw, h: this.doc.fh };
    this.renderStatus();
    this.render();
  }

  deselect() {
    this.commitFloating();
    this.selection = null;
    this.renderStatus();
    this.render();
  }

  copy() {
    const { fw, fh } = this.doc;
    if (this.floating) {
      const f = this.floating;
      clipboard = { x: f.x, y: f.y, w: f.w, h: f.h, data: f.data.slice() };
    } else {
      const s = this.selection || { x: 0, y: 0, w: fw, h: fh };
      clipboard = { ...s, data: draw.extract(this.frame, fw, fh, s.x, s.y, s.w, s.h) };
    }
    this.host.toast(`Copied ${clipboard.w}×${clipboard.h} pixels`, { type: 'info', timeout: 1500 });
  }

  cut() {
    this.copy();
    if (!this.floating && !this.selection) this.selectAll();
    this.deleteSelection();
  }

  paste() {
    if (!clipboard) return;
    this.finishDrag();
    this.commitFloating();
    const { fw, fh } = this.doc;
    const c = clipboard;
    const x = c.x + c.w <= fw && c.x >= 0 ? c.x : 0;
    const y = c.y + c.h <= fh && c.y >= 0 ? c.y : 0;
    this.beginPixelEdit();
    this.floating = this.makeFloating(x, y, c.w, c.h, c.data.slice());
    this.selection = null;
    if (this.tool !== 'select') { this.tool = 'select'; this.renderToolbar(); }
    this.render();
  }

  deleteSelection() {
    const { fw, fh } = this.doc;
    if (this.floating) {
      this.selection = this.clipRect(this.floating);
      this.floating = null;
      this.endPixelEdit();
      this.frameChanged();
      return;
    }
    if (!this.selection) return;
    const s = this.selection;
    this.beginPixelEdit();
    draw.stamp(this.frame, fw, fh, new Uint8ClampedArray(s.w * s.h * 4), s.x, s.y, s.w, s.h);
    this.endPixelEdit();
    this.frameChanged(toBox(s));
  }

  nudge(dx, dy) {
    if (!this.floating) this.liftSelection(false);
    if (!this.floating) return;
    this.floating.x += dx;
    this.floating.y += dy;
    this.render();
  }

  flip(horizontal) {
    const { fw, fh } = this.doc;
    if (this.floating) {
      const f = this.floating;
      draw.flip(f.data, f.w, f.h, horizontal);
      this.updateFloatingCanvas(f);
      this.render();
      return;
    }
    const s = this.selection || { x: 0, y: 0, w: fw, h: fh };
    this.beginPixelEdit();
    const data = draw.extract(this.frame, fw, fh, s.x, s.y, s.w, s.h);
    draw.flip(data, s.w, s.h, horizontal);
    draw.stamp(this.frame, fw, fh, data, s.x, s.y, s.w, s.h);
    this.endPixelEdit();
    this.frameChanged(toBox(s));
  }

  // Origin

  setOrigin(origin, record) {
    if (record) {
      this.change(() => { this.doc.origin = origin; });
    } else {
      this.doc.origin = origin;
      this.renderOrigin();
      this.render();
    }
  }

  // -------------------------------------------------------------------------
  // Pointer input

  /** Image coordinates under a pointer event: whole pixel (x, y) and exact (fx, fy). */
  toPixel(e) {
    const r = this.canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left - this.panX) / this.zoom;
    const fy = (e.clientY - r.top - this.panY) / this.zoom;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
  }

  onPointerDown(e) {
    this.element.focus({ preventScroll: true });
    if (!this.loaded || this.failed) return;
    if (e.pointerType === 'touch') {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        this.cancelDrag();
        this.startGesture();
        capture(this.canvas, e.pointerId);
        return;
      }
      if (this.pointers.size > 2 || this.gesture) return;
    }
    if (this.drag) return;
    const p = this.toPixel(e);
    capture(this.canvas, e.pointerId);
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: 'pan', id: e.pointerId, sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
      this.updateCursor();
      return;
    }
    const eraserButton = e.button === 5; // pen eraser end
    if (e.button !== 0 && e.button !== 2 && !eraserButton) return;
    const secondary = e.button === 2;
    let tool = eraserButton ? 'eraser' : this.tool;
    if (e.altKey && tool !== 'select' && tool !== 'origin') tool = 'picker';
    if (tool !== 'select') this.commitFloating();
    const color = secondary ? this.secondary : this.primary;
    const base = { id: e.pointerId, tool, color, erase: tool === 'eraser' || color[3] === 0 };

    if (tool === 'brush' || tool === 'eraser') {
      this.startStroke(base, p, e.shiftKey);
    } else if (tool === 'fill') {
      this.doFill(p, color, this.contiguous === e.shiftKey);
    } else if (SHAPES.has(tool)) {
      this.beginPixelEdit();
      this.prepareMask();
      this.drag = { ...base, kind: 'shape', start: p, end: p, shift: e.shiftKey, prev: null };
      this.drawShape(this.drag);
    } else if (tool === 'picker') {
      this.pickColor(p, secondary);
      this.drag = { ...base, kind: 'pick', secondary };
    } else if (tool === 'select') {
      if (this.insideSelection(p.x, p.y) && e.button === 0) {
        const copy = e.altKey || e.ctrlKey || e.metaKey;
        if (!this.floating) this.liftSelection(copy);
        else if (copy) { // stamp a copy and keep moving the lifted pixels
          const fl = this.floating;
          draw.stamp(this.frame, this.doc.fw, this.doc.fh, fl.data, fl.x, fl.y, fl.w, fl.h, true);
          this.frameChanged();
        }
        this.drag = { ...base, kind: 'move', grab: [p.x, p.y], from: [this.floating.x, this.floating.y] };
      } else {
        this.commitFloating();
        this.drag = { ...base, kind: 'select', start: [p.x, p.y], moved: false };
        this.updateSelectionDrag(p);
      }
    } else if (tool === 'origin') {
      if (secondary) {
        if (this.doc.origin) this.setOrigin(null, true);
        return;
      }
      this.drag = { ...base, kind: 'origin', before: this.doc.snapshot(), beforeCurrent: this.current };
      this.doc.origin = [clamp(Math.round(p.fx), 0, this.doc.fw), clamp(Math.round(p.fy), 0, this.doc.fh)];
      this.renderOrigin();
      this.render();
    }
    this.updateCursor();
  }

  updateSelectionDrag(p) {
    const [sx, sy] = this.drag.start;
    const x0 = Math.min(sx, p.x), y0 = Math.min(sy, p.y);
    const x1 = Math.max(sx, p.x), y1 = Math.max(sy, p.y);
    this.selection = this.clipRect({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    if (p.x !== sx || p.y !== sy) this.drag.moved = true;
    this.render();
  }

  onPointerMove(e) {
    if (e.pointerType === 'touch' && this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.gesture) { this.updateGesture(); return; }
    }
    const p = this.toPixel(e);
    const prevHover = this.hover;
    this.hover = p;
    const d = this.drag;
    if (!d || d.id !== e.pointerId) {
      if (!prevHover || prevHover.x !== p.x || prevHover.y !== p.y) {
        this.renderStatus();
        this.updateCursor();
      }
      this.render(); // the brush outline follows the pointer
      return;
    }
    switch (d.kind) {
      case 'pan':
        this.panX = d.px + e.clientX - d.sx;
        this.panY = d.py + e.clientY - d.sy;
        this.render();
        break;
      case 'stroke': {
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        let box = null;
        for (const ev of events.length ? events : [e]) {
          const q = this.toPixel(ev);
          const still = this.mode === 'pixel'
            ? q.x === d.last.x && q.y === d.last.y
            : Math.hypot(q.fx - d.last.fx, q.fy - d.last.fy) < 0.25;
          if (still) continue;
          box = draw.union(box, this.strokeMask(d.last, q));
          d.last = q;
        }
        this.paintBox(d, box);
        break;
      }
      case 'shape': {
        const moved = this.mode === 'pixel' ? p.x !== d.end.x || p.y !== d.end.y : p.fx !== d.end.fx || p.fy !== d.end.fy;
        if (moved || e.shiftKey !== d.shift) {
          d.end = p;
          d.shift = e.shiftKey;
          this.drawShape(d);
        }
        break;
      }
      case 'pick':
        this.pickColor(p, d.secondary);
        break;
      case 'select':
        this.updateSelectionDrag(p);
        break;
      case 'move':
        this.floating.x = d.from[0] + p.x - d.grab[0];
        this.floating.y = d.from[1] + p.y - d.grab[1];
        this.render();
        break;
      case 'origin':
        this.doc.origin = [clamp(Math.round(p.fx), 0, this.doc.fw), clamp(Math.round(p.fy), 0, this.doc.fh)];
        this.renderOrigin();
        this.render();
        break;
      default:
    }
    this.renderStatus();
  }

  onPointerUp(e, cancelled = false) {
    if (e.pointerType === 'touch') {
      this.pointers.delete(e.pointerId);
      if (this.gesture) {
        if (this.pointers.size < 2) this.gesture = null;
        return;
      }
    }
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (cancelled && (d.kind === 'stroke' || d.kind === 'shape')) {
      this.cancelDrag();
      return;
    }
    this.finishDrag();
  }

  /** End the current drag, keeping its result. */
  finishDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    switch (d.kind) {
      case 'stroke':
        this.endPixelEdit();
        this.lastPoint = d.last;
        if (!d.erase) this.addRecent(d.color);
        break;
      case 'shape':
        this.endPixelEdit();
        this.lastPoint = d.shownEnd || d.end;
        if (!d.erase) this.addRecent(d.color);
        break;
      case 'pick':
        if (!d.secondary) this.addRecent(this.primary);
        break;
      case 'select':
        if (!d.moved) this.selection = null;
        break;
      case 'origin': {
        const after = this.doc.snapshot();
        const b = d.before.origin, a = after.origin;
        if (!(b && a && b[0] === a[0] && b[1] === a[1])) {
          this.pushUndo({ kind: 'doc', before: d.before, after, beforeCurrent: d.beforeCurrent, afterCurrent: this.current, bytes: 0 });
        }
        break;
      }
      default:
    }
    this.updateCursor();
    this.render();
    this.renderStatus();
  }

  /** Abandon the current drag (undoing what it drew). */
  cancelDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'stroke' || d.kind === 'shape') this.cancelPixelEdit();
    else if (d.kind === 'origin') { this.doc.origin = d.before.origin; this.renderOrigin(); }
    else if (d.kind === 'move') { this.floating.x = d.from[0]; this.floating.y = d.from[1]; }
    this.render();
  }

  startGesture() {
    const [a, b] = [...this.pointers.values()];
    const r = this.canvas.getBoundingClientRect();
    this.gesture = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      cx: (a.x + b.x) / 2 - r.left,
      cy: (a.y + b.y) / 2 - r.top,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
    };
  }

  updateGesture() {
    const g = this.gesture;
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const r = this.canvas.getBoundingClientRect();
    const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    const z = clamp(g.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist), MIN_ZOOM, MAX_ZOOM);
    // The point under the gesture's start center stays under its current center.
    const fx = (g.cx - g.panX) / g.zoom, fy = (g.cy - g.panY) / g.zoom;
    this.zoom = z;
    this.panX = cx - fx * z;
    this.panY = cy - fy * z;
    this.renderZoom();
    this.render();
  }

  onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * scale, dy = e.deltaY * scale;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch (or Ctrl+wheel): zoom smoothly around the pointer.
      this.setZoom(this.zoom * Math.exp(-dy * 0.01), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
      this.panX -= e.shiftKey && !dx ? dy : dx;
      if (!e.shiftKey) this.panY -= dy;
      this.render();
      return;
    }
    this.setZoom(this.zoom * Math.exp(-clamp(dy, -200, 200) * 0.0025), e.clientX - r.left, e.clientY - r.top);
  }

  // -------------------------------------------------------------------------
  // Keyboard

  handleKey(e) { return this.onKeyDown(e); }

  onKeyDown(e) {
    if (isTyping(e.target)) {
      if (e.key === 'Escape') { e.target.blur(); this.element.focus({ preventScroll: true }); return true; }
      return false;
    }
    if (document.querySelector('dialog[open]')) return false;
    if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return false;
    if (e.target.getAttribute?.('role') === 'slider' && e.key.startsWith('Arrow')) return false;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod && !e.altKey) {
      if (k === 'z') { if (e.shiftKey) this.redo(); else this.undo(); return true; }
      if (k === 'y') { this.redo(); return true; }
      if (k === 'c') { this.copy(); return true; }
      if (k === 'x') { this.cut(); return true; }
      if (k === 'v') { this.paste(); return true; }
      if (k === 'a') { this.setTool('select'); this.selectAll(); return true; }
      if (k === 'd') { this.deselect(); return true; }
      if (k === '=' || k === '+') { this.zoomStep(1); return true; }
      if (k === '-') { this.zoomStep(-1); return true; }
      if (k === '0') { this.fit(); return true; }
      return false;
    }
    if (mod || e.altKey) return false;
    if (e.key === ' ') {
      if (!this.spaceDown) { this.spaceDown = true; this.updateCursor(); this.render(); }
      return true;
    }
    const tools = { b: 'brush', e: 'eraser', g: 'fill', i: 'picker', l: 'line', m: 'select', o: 'origin' };
    if (!e.shiftKey && tools[k]) { this.setTool(tools[k]); return true; }
    if (k === 'u') {
      if (e.shiftKey) this.setTool('ellipse');
      else if (this.tool === 'rect') this.setTool('ellipse');
      else if (this.tool === 'ellipse') this.setTool('rect');
      else this.setTool(this.lastShape);
      return true;
    }
    if (e.shiftKey && k === 'h') { this.flip(true); return true; }
    if (e.shiftKey && k === 'v') { this.flip(false); return true; }
    switch (k) {
      case 'x': this.swapColors(); return true;
      case '[': if (e.shiftKey) this.setHardness(this.hardness - 10); else this.stepSize(-1); return true;
      case ']': if (e.shiftKey) this.setHardness(this.hardness + 10); else this.stepSize(1); return true;
      case '{': this.setHardness(this.hardness - 10); return true;
      case '}': this.setHardness(this.hardness + 10); return true;
      case '+': case '=': this.zoomStep(1); return true;
      case '-': case '_': this.zoomStep(-1); return true;
      case '0': this.fit(); return true;
      case '1': this.setZoom(1); return true;
      case ',': this.goToFrame(this.current - 1); return true;
      case '.': this.goToFrame(this.current + 1); return true;
      case 'Delete': case 'Backspace': this.deleteSelection(); return true;
      case 'Escape': this.cancelDrag(); this.deselect(); return true;
      case 'Enter': this.commitFloating(); return true;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
        const dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
        const n = e.shiftKey ? 8 : 1;
        if (this.floating || this.selection) this.nudge(dx * n, dy * n);
        else if (dx) this.goToFrame(this.current + dx);
        else return false;
        return true;
      }
      default: return false;
    }
  }

  // -------------------------------------------------------------------------
  // View

  setZoom(z, ax, ay) {
    z = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const W = this.viewport.clientWidth, H = this.viewport.clientHeight;
    ax ??= W / 2;
    ay ??= H / 2;
    const fx = (ax - this.panX) / this.zoom, fy = (ay - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = ax - fx * z;
    this.panY = ay - fy * z;
    this.renderZoom();
    this.renderStatus();
    this.updateCursor();
    this.render();
  }

  zoomStep(dir, ax, ay) {
    const z = this.zoom;
    const next = dir > 0
      ? ZOOM_LEVELS.find((v) => v > z * 1.001) ?? MAX_ZOOM
      : [...ZOOM_LEVELS].reverse().find((v) => v < z / 1.001) ?? MIN_ZOOM;
    this.setZoom(next, ax, ay);
  }

  /** Show the whole image, as big as fits (whole-number zoom when enlarging, so pixels stay even). */
  fit() {
    const W = this.viewport.clientWidth, H = this.viewport.clientHeight;
    if (!W || !H) return;
    const { fw, fh } = this.doc;
    let z = Math.min((W - 48) / fw, (H - 72) / fh);
    if (z > 1) z = Math.floor(z);
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.panX = Math.round((W - fw * this.zoom) / 2);
    this.panY = Math.round((H - fh * this.zoom) / 2);
    this.fitted = true;
    this.renderZoom();
    this.renderStatus();
    this.updateCursor();
    this.render();
  }

  renderZoom() {
    if (!this.zoomLabel) return;
    const pct = this.zoom * 100;
    this.zoomLabel.textContent = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  }

  resizeCanvas() {
    const W = this.viewport.clientWidth, H = this.viewport.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    if (!this.fitted && this.loaded) this.fit();
    this.renderNow();
  }

  render() {
    if (this.renderQueued || !this.visible) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  renderNow() {
    const { ctx, canvas, doc, zoom: z, theme } = this;
    const dpr = canvas.width / (canvas.clientWidth || 1) || 1;
    const W = canvas.width / dpr, H = canvas.height / dpr;
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    if (!this.loaded || this.failed) return;
    const { fw, fh } = doc;
    const px = 1 / dpr; // one device pixel
    const ox = Math.round(this.panX * dpr) / dpr, oy = Math.round(this.panY * dpr) / dpr;
    const pw = fw * z, ph = fh * z;
    const snap = (v) => Math.round(v * dpr) / dpr + px / 2;

    // Checkerboard cells: a power of two of image pixels, at least 8 screen pixels.
    let cell = 1;
    while (cell * z < 8) cell *= 2;
    this.checker.setTransform(new DOMMatrix().translate(ox, oy).scale(cell * z));
    ctx.fillStyle = this.checker;
    ctx.fillRect(ox, oy, pw, ph);

    // Zoomed out, filter the image so it looks as it will; zoomed in, show the pixels.
    ctx.imageSmoothingEnabled = z < 1;
    ctx.imageSmoothingQuality = 'high';
    if (this.onion && doc.count > 1) {
      ctx.globalAlpha = 0.3;
      if (this.current > 0) ctx.drawImage(this.frameCanvases[this.current - 1], ox, oy, pw, ph);
      ctx.globalAlpha = 0.18;
      if (this.current < doc.count - 1) ctx.drawImage(this.frameCanvases[this.current + 1], ox, oy, pw, ph);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.frameCanvases[this.current], ox, oy, pw, ph);
    const fl = this.floating;
    if (fl) ctx.drawImage(fl.canvas, ox + fl.x * z, oy + fl.y * z, fl.w * z, fl.h * z);
    ctx.imageSmoothingEnabled = false;

    // Visible pixel range
    const vx0 = clamp(Math.floor(-ox / z), 0, fw), vx1 = clamp(Math.ceil((W - ox) / z), 0, fw);
    const vy0 = clamp(Math.floor(-oy / z), 0, fh), vy1 = clamp(Math.ceil((H - oy) / z), 0, fh);
    const gridLines = (stepX, stepY, alpha) => {
      ctx.beginPath();
      for (let x = Math.ceil(vx0 / stepX) * stepX; x <= vx1; x += stepX) {
        const sx = snap(ox + x * z);
        ctx.moveTo(sx, oy + vy0 * z);
        ctx.lineTo(sx, oy + vy1 * z);
      }
      for (let y = Math.ceil(vy0 / stepY) * stepY; y <= vy1; y += stepY) {
        const sy = snap(oy + y * z);
        ctx.moveTo(ox + vx0 * z, sy);
        ctx.lineTo(ox + vx1 * z, sy);
      }
      ctx.strokeStyle = theme.line;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = px;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    if (this.pixelGrid && z >= GRID_ZOOM) gridLines(1, 1, 0.12);
    if (this.grid && this.gridW * z >= 4 && this.gridH * z >= 4) gridLines(this.gridW, this.gridH, 0.32);

    ctx.lineWidth = px;
    ctx.strokeStyle = theme.border;
    ctx.strokeRect(snap(ox) - px, snap(oy) - px, Math.round(pw * dpr) / dpr + px, Math.round(ph * dpr) / dpr + px);

    // Mirror axes
    if (this.mirrorX || this.mirrorY) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(1, px);
      ctx.beginPath();
      if (this.mirrorX) { ctx.moveTo(snap(ox + pw / 2), oy - 8); ctx.lineTo(snap(ox + pw / 2), oy + ph + 8); }
      if (this.mirrorY) { ctx.moveTo(ox - 8, snap(oy + ph / 2)); ctx.lineTo(ox + pw + 8, snap(oy + ph / 2)); }
      ctx.stroke();
      ctx.restore();
    }

    this.drawBrushOutline(ox, oy, snap, px);

    // Selection outline
    const s = fl || this.selection;
    if (s) {
      const sx = snap(ox + s.x * z), sy = snap(oy + s.y * z);
      ctx.save();
      ctx.lineWidth = Math.max(1, px);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = MARK_DARK;
      ctx.strokeRect(sx, sy, s.w * z, s.h * z);
      ctx.lineDashOffset = 4;
      ctx.strokeStyle = MARK_LIGHT;
      ctx.strokeRect(sx, sy, s.w * z, s.h * z);
      ctx.restore();
    }

    // Origin
    const o = doc.origin;
    const hv = this.hover;
    if (o) this.drawOriginMarker(ox + o[0] * z, oy + o[1] * z, 1);
    else if (this.tool === 'origin' && hv) this.drawOriginMarker(ox + clamp(Math.round(hv.fx), 0, fw) * z, oy + clamp(Math.round(hv.fy), 0, fh) * z, 0.5);
  }

  /** The brush's footprint under the pointer: a circle (smooth) or the pixels it covers (pixel). */
  drawBrushOutline(ox, oy, snap, px) {
    const { ctx, zoom: z } = this;
    const hv = this.hover;
    const t = this.drag?.kind === 'stroke' ? this.drag.tool : this.tool;
    if (!hv || this.spaceDown || this.gesture || !(t === 'brush' || t === 'eraser' || (t === 'line' && !this.drag))) return;
    if (this.drag && this.drag.kind !== 'stroke') return;
    ctx.save();
    ctx.lineWidth = Math.max(1, px);
    if (this.mode === 'pixel') {
      const off = Math.floor((this.size - 1) / 2);
      const bx = ox + (hv.x - off) * z, by = oy + (hv.y - off) * z, bs = this.size * z;
      if (bs >= 3) {
        ctx.strokeStyle = MARK_DARK;
        ctx.strokeRect(snap(bx) - px, snap(by) - px, bs + px, bs + px);
        ctx.strokeStyle = MARK_LIGHT;
        ctx.strokeRect(snap(bx), snap(by), bs - px, bs - px);
      }
    } else {
      const cx = ox + hv.fx * z, cy = oy + hv.fy * z, r = (this.size / 2) * z;
      if (r >= 3) {
        for (const [color, rr] of [[MARK_DARK, r + px], [MARK_LIGHT, r]]) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (this.canvas.style.cursor === 'none') {
        // Small crosshair at the center, since the system cursor is hidden.
        ctx.strokeStyle = MARK_DARK;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy + 0.5); ctx.lineTo(cx + 4, cy + 0.5);
        ctx.moveTo(cx + 0.5, cy - 4); ctx.lineTo(cx + 0.5, cy + 4);
        ctx.stroke();
        ctx.strokeStyle = MARK_LIGHT;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
        ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawOriginMarker(x, y, alpha) {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [color, width, a] of [[MARK_DARK, 4, 0.7], [this.theme.accent, 2, 1]]) {
      ctx.globalAlpha = alpha * a;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x - 9, y); ctx.lineTo(x - 3, y);
      ctx.moveTo(x + 3, y); ctx.lineTo(x + 9, y);
      ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 3);
      ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderStatus() {
    const { doc } = this;
    const hv = this.hover;
    const parts = [];
    if (hv && hv.x >= 0 && hv.y >= 0 && hv.x < doc.fw && hv.y < doc.fh) parts.push(`${hv.x}, ${hv.y}`);
    const s = this.floating || this.selection;
    if (s) parts.push(`${s.w}×${s.h} selected`);
    this.statusPos.textContent = parts.join('  ·  ');
    this.statusInfo.textContent = doc.count > 1 ? `Frame ${this.current} of ${doc.count}` : '';
  }

  renderInfo() {
    const { doc } = this;
    const { columns, rows } = doc.layout();
    const name = (p) => p.slice(p.lastIndexOf('/') + 1);
    const withMeta = doc.needsMeta() || this.host.exists(this.metaPath) || this.host.exists(this.legacyPath);
    const files = withMeta ? `${this.pngPath} and ${name(this.metaPath)}` : this.pngPath;
    const frames = doc.count > 1 ? `${doc.count} frames of ${doc.fw}×${doc.fh} in a ${columns * doc.fw}×${rows * doc.fh} sheet.` : `One ${doc.fw}×${doc.fh} image.`;
    this.infoEl.textContent = `${frames} Saves ${files}.`;
    if (this.btnSize) this.btnSize.textContent = `${doc.fw} × ${doc.fh}`;
    this.renderStatus();
  }

  // -------------------------------------------------------------------------
  // Origin panel

  renderOrigin() {
    const { h } = this.ui;
    const o = this.doc.origin;
    const num = (i) => {
      const input = h('input', { type: 'number', class: 'spr-input spr-num-input', step: '1', value: o ? String(o[i]) : '', placeholder: 'center', 'aria-label': i ? 'Origin y' : 'Origin x' });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (input.value === '' || !Number.isFinite(v)) { this.renderOrigin(); return; }
        const next = o ? [...o] : [Math.round(this.doc.fw / 2), Math.round(this.doc.fh / 2)];
        next[i] = v;
        this.setOrigin(next, true);
      });
      return input;
    };
    this.originBody.replaceChildren(
      h('label', { class: 'spr-field' }, h('span', {}, 'x'), num(0)),
      h('label', { class: 'spr-field' }, h('span', {}, 'y'), num(1)),
      this.btnOriginTool,
      this.iconButton('x', o ? 'Clear the origin (the center is used)' : 'No origin set: the center is used', () => this.setOrigin(null, true), { disabled: !o }));
    this.settings.note.textContent = o ? `origin ${o[0]}, ${o[1]}` : '';
    this.renderInfo();
  }

  // -------------------------------------------------------------------------
  // Animations

  selectAnimation(name) {
    this.selectedAnim = name;
    this.previewStart = performance.now();
    this.renderAnimations();
    this.renderFrames();
  }

  editAnimation(name, fn) {
    this.change(() => {
      const a = this.doc.animations.find((x) => x.name === name);
      if (a) fn(a);
    });
  }

  async addAnimation() {
    const names = new Set(this.doc.animations.map((a) => a.name));
    const suggestion = ['idle', 'run', 'walk', 'jump', 'fall', 'attack', 'hurt'].find((n) => !names.has(n)) || `anim${names.size + 1}`;
    const name = await this.ui.promptDialog({
      title: 'New animation', label: 'Name (an AnimatedSprite2D plays it by this name)', value: suggestion, okLabel: 'Create',
      validate: (v) => (!v ? 'Please enter a name.' : names.has(v) ? 'There is already an animation with that name.' : ''),
    });
    this.element.focus({ preventScroll: true });
    if (!name) return;
    this.change(() => {
      this.doc.animations.push({ name, frames: this.doc.frames.map((_, i) => i), fps: DEFAULT_FPS, loop: true, extra: {} });
    });
    this.selectAnimation(name);
  }

  async renameAnimation(a) {
    const names = new Set(this.doc.animations.map((x) => x.name));
    const name = await this.ui.promptDialog({
      title: 'Rename animation', label: 'Name', value: a.name, okLabel: 'Rename',
      validate: (v) => (!v ? 'Please enter a name.' : v !== a.name && names.has(v) ? 'There is already an animation with that name.' : ''),
    });
    this.element.focus({ preventScroll: true });
    if (!name || name === a.name) return;
    this.editAnimation(a.name, (x) => { x.name = name; });
    this.selectAnimation(name);
  }

  async deleteAnimation(a) {
    if (!await this.ui.confirmDialog({ title: 'Delete animation', message: `Delete the animation "${a.name}"? Its frames stay in the image.`, okLabel: 'Delete', danger: true })) return;
    this.change(() => { this.doc.animations = this.doc.animations.filter((x) => x.name !== a.name); });
    this.selectAnimation(null);
  }

  renderAnimations() {
    const { h } = this.ui;
    const anims = this.doc.animations;
    if (this.selectedAnim && !anims.some((a) => a.name === this.selectedAnim)) this.selectedAnim = null;
    this.animList.replaceChildren(...anims.map((a) => {
      const item = h('button', {
        type: 'button', class: `spr-anim ${a.name === this.selectedAnim ? 'selected' : ''}`, role: 'option',
        'aria-selected': String(a.name === this.selectedAnim), title: 'Double-click to rename',
      }, h('span', { class: 'spr-anim-name' }, a.name), h('span', { class: 'spr-anim-meta' }, `${a.frames.length} frames · ${a.fps} fps${a.loop ? '' : ' · once'}`));
      item.addEventListener('click', () => this.selectAnimation(a.name === this.selectedAnim ? null : a.name));
      item.addEventListener('dblclick', () => this.renameAnimation(a));
      return item;
    }));
    if (!anims.length) {
      this.animList.append(h('div', { class: 'spr-empty' }, this.doc.count > 1
        ? 'Add an animation with + to play these frames in your game.'
        : 'To animate, add frames below, then name an animation with +.'));
    }

    const a = anims.find((x) => x.name === this.selectedAnim);
    this.previewCaption.textContent = a
      ? `“${a.name}” · ${a.fps} fps${a.loop ? '' : ' · once'}`
      : this.doc.count > 1 ? `All ${this.doc.count} frames` : '';
    if (!a) { this.animDetail.replaceChildren(); this.animDetail.hidden = true; return; }
    this.animDetail.hidden = false;
    const framesInput = h('input', { type: 'text', class: 'spr-input', value: formatFrameList(a.frames), spellcheck: 'false', 'aria-label': 'Frames', title: 'Frame numbers in play order, e.g. 0-3, 5' });
    framesInput.addEventListener('change', () => {
      const list = parseFrameList(framesInput.value, this.doc.count);
      if (!list) {
        framesInput.classList.add('invalid');
        this.host.toast(`Frames should be numbers from 0 to ${this.doc.count - 1}, like "0-3, 5"`, { type: 'error' });
        return;
      }
      framesInput.classList.remove('invalid');
      this.editAnimation(a.name, (x) => { x.frames = list; });
    });
    const fpsInput = h('input', { type: 'number', class: 'spr-input spr-num-input', min: '0', step: '1', value: String(a.fps), 'aria-label': 'Frames per second' });
    fpsInput.addEventListener('change', () => {
      const v = Number(fpsInput.value);
      if (!Number.isFinite(v) || v < 0) { fpsInput.value = String(a.fps); return; }
      this.editAnimation(a.name, (x) => { x.fps = v; });
    });
    const loopInput = h('input', { type: 'checkbox', 'aria-label': 'Loop' });
    loopInput.checked = a.loop;
    loopInput.addEventListener('change', () => this.editAnimation(a.name, (x) => { x.loop = !x.loop; }));
    this.animDetail.replaceChildren(
      h('label', { class: 'spr-field spr-field-wide' }, h('span', {}, 'Frames'), framesInput),
      h('div', { class: 'spr-row' },
        h('label', { class: 'spr-field' }, h('span', {}, 'Speed'), fpsInput, h('span', { class: 'spr-unit' }, 'fps')),
        h('label', { class: 'spr-check' }, loopInput, h('span', {}, 'Loop'))),
      h('div', { class: 'spr-row' },
        h('button', { type: 'button', class: 'spr-btn', title: 'Add the frame being edited to the end of this animation', onclick: () => this.editAnimation(a.name, (x) => { x.frames.push(this.current); }) }, sicon('plus', 14), `Add frame ${this.current}`),
        h('span', { class: 'spr-spacer' }),
        this.iconButton('pencil', 'Rename animation', () => this.renameAnimation(a)),
        this.iconButton('trash', 'Delete animation', () => this.deleteAnimation(a))));
  }

  // -------------------------------------------------------------------------
  // Preview

  renderPreviewControls() {
    this.btnPreviewPlay.replaceChildren(sicon(this.previewPlaying ? 'pause' : 'play'));
    this.btnPreviewPlay.setAttribute('aria-label', this.previewPlaying ? 'Pause preview' : 'Play preview');
  }

  startPreview() {
    if (this.previewRaf || !this.visible) return;
    this.previewStart ??= performance.now();
    const tick = (t) => {
      this.previewRaf = null;
      if (!this.visible) return;
      this.drawPreview(t);
      this.previewRaf = requestAnimationFrame(tick);
    };
    this.previewRaf = requestAnimationFrame(tick);
  }

  stopPreview() {
    if (this.previewRaf) cancelAnimationFrame(this.previewRaf);
    this.previewRaf = null;
  }

  drawPreview(t) {
    const { doc } = this;
    const c = this.previewCanvas;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H || !this.loaded || this.failed) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const anim = doc.animations.find((a) => a.name === this.selectedAnim);
    const frames = anim ? anim.frames : doc.frames.map((_, i) => i);
    const fps = anim ? anim.fps : DEFAULT_FPS;
    const loop = anim ? anim.loop : true;
    let frame = this.current;
    if (frames.length && this.previewPlaying && fps > 0) {
      const steps = Math.floor(((t - this.previewStart) / 1000) * fps);
      if (loop) frame = frames[steps % frames.length];
      else {
        // Play once, hold the last frame for a second, then start over.
        const hold = Math.ceil(fps);
        frame = frames[Math.min(steps % (frames.length + hold), frames.length - 1)];
      }
    } else if (frames.length && !this.previewPlaying) {
      frame = frames.includes(this.current) ? this.current : frames[0];
    }
    if (frame === this.previewShown && !this.previewDirty && this.previewSize === `${W}x${H}`) return;
    this.previewShown = frame;
    this.previewSize = `${W}x${H}`;
    this.previewDirty = false;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, W, H);
    const fit = Math.min((W - 8) / doc.fw, (H - 8) / doc.fh);
    const s = fit >= 1 ? Math.floor(fit) : fit;
    const w = doc.fw * s, h = doc.fh * s;
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
    this.previewChecker ??= ctx.createPattern(this.patternCanvas(), 'repeat');
    ctx.fillStyle = this.previewChecker;
    ctx.fillRect(x, y, w, h);
    ctx.imageSmoothingEnabled = s < 1;
    ctx.imageSmoothingQuality = 'high';
    const src = this.frameCanvases[frame];
    if (src) ctx.drawImage(src, x, y, w, h);
  }

  patternCanvas() {
    const p = document.createElement('canvas');
    p.width = p.height = 8;
    const pc = p.getContext('2d');
    pc.fillStyle = this.theme.checkA;
    pc.fillRect(0, 0, 8, 8);
    pc.fillStyle = this.theme.checkB;
    pc.fillRect(0, 0, 4, 4);
    pc.fillRect(4, 4, 4, 4);
    return p;
  }

  // -------------------------------------------------------------------------
  // Dialogs

  /** A whole number field for dialogs. */
  numInput(value, label) {
    return this.ui.h('input', { type: 'text', class: 'spr-input', inputmode: 'numeric', value: String(value), spellcheck: 'false', autocomplete: 'off', 'aria-label': label });
  }

  /** Show a dialog with body; resolves true if confirmed. validate() returns an error message or ''. */
  async formDialog({ title, body, okLabel, validate, focus }) {
    const { h } = this.ui;
    const error = h('div', { class: 'spr-form-error', role: 'alert' });
    body.addEventListener('input', () => { error.textContent = ''; });
    const check = () => {
      const msg = validate?.() || '';
      error.textContent = msg;
      return !msg;
    };
    const res = await this.ui.openDialog({
      title,
      body: h('div', { class: 'spr-form' }, body, error),
      actions: [
        { label: 'Cancel', value: null, ghost: true },
        { label: okLabel, value: 'ok', primary: true, submit: true, validate: check },
      ],
      onOpen: () => { focus?.focus(); focus?.select?.(); },
    });
    this.element.focus({ preventScroll: true });
    return res === 'ok';
  }

  field(label, ...controls) {
    const { h } = this.ui;
    return h('label', { class: 'spr-form-field' }, h('span', { class: 'spr-form-label' }, label), ...controls);
  }

  /** "W must be a whole number from 1 to 4096" style checks. */
  checkInt(input, label, min = 1, max = MAX_SIZE) {
    const v = Number(input.value.trim());
    return Number.isInteger(v) && v >= min && v <= max ? '' : `${label} should be a whole number from ${min} to ${max}.`;
  }

  /** Width and height fields with a preset menu. */
  sizeFields(w, hgt, onChange = () => {}) {
    const { h } = this.ui;
    const wIn = this.numInput(w, 'Width'), hIn = this.numInput(hgt, 'Height');
    const preset = h('select', { class: 'spr-select', 'aria-label': 'Size preset' },
      ...SIZE_PRESETS.map((n) => h('option', { value: String(n) }, `${n} × ${n}`)),
      h('option', { value: '' }, 'Custom'));
    const sync = () => {
      const a = wIn.value.trim(), b = hIn.value.trim();
      preset.value = a === b && SIZE_PRESETS.includes(Number(a)) ? a : '';
    };
    preset.addEventListener('change', () => {
      if (!preset.value) { wIn.focus(); return; }
      wIn.value = preset.value;
      hIn.value = preset.value;
      onChange('preset');
    });
    wIn.addEventListener('input', () => { onChange('w'); sync(); });
    hIn.addEventListener('input', () => { onChange('h'); sync(); });
    sync();
    return { wIn, hIn, preset, sync };
  }

  async resizeDialog(kind = 'image') {
    this.finishDrag();
    this.commitFloating();
    const { doc } = this;
    const { h } = this.ui;
    let mode = kind === 'canvas' ? 'canvas' : 'image';
    let lock = true;
    let anchor = 'center';
    let smooth = this.mode !== 'pixel';
    const ratio = doc.fw / doc.fh;
    let size;
    const keepRatio = (which) => {
      if (mode !== 'image' || !lock || which === 'preset') return;
      const v = Number(which === 'w' ? size.wIn.value : size.hIn.value);
      if (!Number.isFinite(v) || v <= 0) return;
      if (which === 'w') size.hIn.value = String(Math.max(1, Math.round(v / ratio)));
      else size.wIn.value = String(Math.max(1, Math.round(v * ratio)));
    };
    size = this.sizeFields(doc.fw, doc.fh, keepRatio);
    const lockBtn = h('button', { type: 'button', class: 'spr-ibtn spr-lock', 'aria-pressed': 'true', title: 'Keep the proportions', 'aria-label': 'Keep the proportions' }, sicon('link'));
    lockBtn.addEventListener('click', () => {
      lock = !lock;
      lockBtn.setAttribute('aria-pressed', String(lock));
      lockBtn.replaceChildren(sicon(lock ? 'link' : 'unlink'));
      keepRatio('w');
      size.sync();
    });
    const resample = this.segmented([['smooth', 'Smooth', 'Blends pixels: for photos, painted and smooth art'], ['pixel', 'Pixel', 'Nearest pixel: keeps hard edges, for pixel art']], (v) => { smooth = v === 'smooth'; resample.set(v); }, 'Resampling');
    resample.set(smooth ? 'smooth' : 'pixel');
    const anchorButtons = ANCHORS.map((a) => {
      const b = h('button', { type: 'button', class: 'spr-anchor-cell', title: a.replace('-', ' '), 'aria-label': `Anchor ${a.replace('-', ' ')}`, 'aria-pressed': String(a === anchor) });
      b.addEventListener('click', () => { anchor = a; for (const x of anchorButtons) x.setAttribute('aria-pressed', String(x === b)); });
      return b;
    });
    const note = h('p', { class: 'spr-form-note' });
    const imageRow = this.field('Resampling', resample.el);
    const anchorRow = this.field('Keep pixels at', h('div', { class: 'spr-anchor' }, ...anchorButtons));
    const modeSeg = this.segmented([['image', 'Scale image'], ['canvas', 'Resize canvas']], (v) => { mode = v; update(); }, 'What to resize');
    const update = () => {
      modeSeg.set(mode);
      imageRow.hidden = mode !== 'image';
      anchorRow.hidden = mode !== 'canvas';
      lockBtn.hidden = mode !== 'image';
      const frames = doc.count > 1 ? ` Every frame (${doc.count}) changes the same way.` : '';
      note.textContent = (mode === 'image'
        ? 'Stretches or shrinks the pixels to the new size.'
        : 'Adds transparent space or crops, without scaling the pixels.') + frames;
    };
    update();
    const body = h('div', { class: 'spr-form-stack' },
      modeSeg.el,
      note,
      h('div', { class: 'spr-form-grid' },
        this.field('Size', size.preset),
        h('div', { class: 'spr-form-field' },
          h('span', { class: 'spr-form-label' }, `Width × height (now ${doc.fw} × ${doc.fh})`),
          h('div', { class: 'spr-wh' }, size.wIn, h('span', { class: 'spr-times' }, '×'), size.hIn, lockBtn))),
      imageRow,
      anchorRow);
    const ok = await this.formDialog({
      title: 'Image size', body, okLabel: 'Apply', focus: size.wIn,
      validate: () => this.checkInt(size.wIn, 'Width') || this.checkInt(size.hIn, 'Height'),
    });
    if (!ok) return;
    const w = Number(size.wIn.value.trim()), hh = Number(size.hIn.value.trim());
    if (w === doc.fw && hh === doc.fh) return;
    this.selection = null;
    if (mode === 'image') {
      this.change(() => doc.scale(w, hh, smooth));
    } else {
      const col = anchor.includes('left') ? 0 : anchor.includes('right') ? 2 : 1;
      const row = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 2 : 1;
      const dx = Math.floor(((w - doc.fw) * col) / 2), dy = Math.floor(((hh - doc.fh) * row) / 2);
      this.change(() => doc.resizeCanvas(w, hh, dx, dy));
    }
    this.fit();
  }

  async splitDialog() {
    const { doc } = this;
    const { h } = this.ui;
    const sheet = doc.toSheet();
    const guess = doc.count === 1 && doc.fw > doc.fh && doc.fw % doc.fh === 0 ? doc.fh : doc.fw;
    const wIn = this.numInput(guess, 'Frame width'), hIn = this.numInput(doc.fh, 'Frame height');
    const body = h('div', { class: 'spr-form-stack' },
      h('p', { class: 'spr-form-note' }, `Cuts the whole sheet (${sheet.width}×${sheet.height}) into frames of this size, numbered left to right, then top to bottom.`),
      h('div', { class: 'spr-form-grid' }, this.field('Frame width', wIn), this.field('Frame height', hIn)));
    const ok = await this.formDialog({
      title: 'Split into frames', body, okLabel: 'Split', focus: wIn,
      validate: () => this.checkInt(wIn, 'Frame width', 1, sheet.width) || this.checkInt(hIn, 'Frame height', 1, sheet.height),
    });
    if (!ok) return;
    const w = Number(wIn.value.trim()), hh = Number(hIn.value.trim());
    if (w === doc.fw && hh === doc.fh) return;
    this.selection = null;
    this.change(() => {
      const next = SpriteDoc.fromSheet(sheet.data, sheet.width, sheet.height, w, hh);
      doc.frames = next.frames;
      doc.fw = w;
      doc.fh = hh;
      doc.columns = next.columns;
      doc.rows = next.rows;
      for (const a of doc.animations) a.frames = a.frames.filter((f) => f < doc.count);
      if (doc.origin) doc.origin = [Math.min(doc.origin[0], w), Math.min(doc.origin[1], hh)];
      this.current = 0;
    });
    this.fit();
  }

  async gridDialog() {
    const { h } = this.ui;
    const wIn = this.numInput(this.gridW, 'Cell width'), hIn = this.numInput(this.gridH, 'Cell height');
    const body = h('div', { class: 'spr-form-grid' }, this.field('Cell width', wIn), this.field('Cell height', hIn));
    const ok = await this.formDialog({
      title: 'Grid size', body, okLabel: 'Show grid', focus: wIn,
      validate: () => this.checkInt(wIn, 'Cell width', 1, 1024) || this.checkInt(hIn, 'Cell height', 1, 1024),
    });
    if (!ok) return;
    this.gridW = Number(wIn.value.trim());
    this.gridH = Number(hIn.value.trim());
    this.grid = true;
    this.persist();
    this.render();
  }

  async newImageDialog() {
    const { host } = this;
    const { h } = this.ui;
    const folder = this.pngPath.includes('/') ? this.pngPath.slice(0, this.pngPath.lastIndexOf('/') + 1) : 'sprites/';
    let n = 1;
    while (host.exists(`${folder}image${n > 1 ? n : ''}.png`)) n++;
    const pathIn = h('input', { type: 'text', class: 'spr-input', value: `${folder}image${n > 1 ? n : ''}.png`, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'File' });
    const size = this.sizeFields(DEFAULT_SIZE, DEFAULT_SIZE);
    const framesIn = this.numInput(1, 'Frames');
    const body = h('div', { class: 'spr-form-stack' },
      this.field('File', pathIn),
      h('div', { class: 'spr-form-grid' },
        this.field('Size', size.preset),
        h('div', { class: 'spr-form-field' },
          h('span', { class: 'spr-form-label' }, 'Width × height'),
          h('div', { class: 'spr-wh' }, size.wIn, h('span', { class: 'spr-times' }, '×'), size.hIn))),
      h('div', { class: 'spr-form-grid' }, this.field('Frames', framesIn)));
    const pathOf = () => pathIn.value.trim().replace(/^\/+/, '');
    const ok = await this.formDialog({
      title: 'New image', body, okLabel: 'Create', focus: pathIn,
      validate: () => {
        const p = pathOf();
        if (!/\.png$/i.test(p)) return 'The file name should end in .png.';
        if (/(^|\/)\.\.?(\/|$)/.test(p) || /[\\:*?"<>|]/.test(p)) return 'That isn\'t a valid file name.';
        if (host.exists(p)) return 'A file with that name already exists.';
        return this.checkInt(size.wIn, 'Width') || this.checkInt(size.hIn, 'Height') || this.checkInt(framesIn, 'Frames', 1, 256);
      },
    });
    if (!ok) return;
    const path = pathOf();
    const doc = SpriteDoc.blank(Number(size.wIn.value.trim()), Number(size.hIn.value.trim()), Number(framesIn.value.trim()));
    const sheet = doc.toSheet();
    await host.write(path, await encodePNG(sheet.data, sheet.width, sheet.height));
    if (doc.needsMeta()) {
      const metaPath = `${stemOf(path)}${META_EXT}`;
      await host.write(metaPath, doc.metaText(metaPath, path));
    }
    host.openFile(path);
  }

  // -------------------------------------------------------------------------
  // Tool host interface

  show() {
    this.visible = true;
    this.readTheme();
    this.renderPalette();
    this.resizeCanvas();
    this.previewDirty = true;
    this.startPreview();
  }

  hide() {
    this.visible = false;
    this.finishDrag();
    this.stopPreview();
    this.mask = null; // up to 16 MB; made again on the next stroke
  }

  focus() {
    this.element.focus({ preventScroll: true });
  }

  destroy() {
    this.visible = false;
    this.stopPreview();
    this.themeObserver.disconnect();
    this.colorScheme?.removeEventListener?.('change', this.onThemeChange);
    this.resizeObserver.disconnect();
    window.removeEventListener('blur', this.onBlur);
  }
}
