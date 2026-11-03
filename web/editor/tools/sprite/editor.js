// The sprite and pixel editor: one instance per opened sprite.

import { SpriteDoc, spritePaths, loadSprite, encodeSprite, stemOf, DEFAULT_FPS } from './doc.js';
import * as draw from './draw.js';
import { sicon } from './icons.js';
import { encodePNG } from './png.js';

const ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];
const MAX_UNDO = 200;
const MAX_UNDO_BYTES = 192 * 1024 * 1024;
const TRANSPARENT = [0, 0, 0, 0];
const SHAPES = new Set(['line', 'rect', 'ellipse']);
const BRUSH_TOOLS = new Set(['pencil', 'eraser', 'line', 'rect', 'ellipse']);

const TOOLS = [
  { id: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rectangle', key: 'U' },
  { id: 'ellipse', label: 'Ellipse', key: 'Shift+U' },
  { id: 'select', label: 'Select', key: 'M' },
  { id: 'picker', label: 'Color picker', key: 'I' },
  { id: 'origin', label: 'Origin', key: 'O' },
];

const ANCHORS = [
  ['top-left', 'Top left'], ['top', 'Top'], ['top-right', 'Top right'],
  ['left', 'Left'], ['center', 'Center'], ['right', 'Right'],
  ['bottom-left', 'Bottom left'], ['bottom', 'Bottom'], ['bottom-right', 'Bottom right'],
];

// Shared by every open sprite, so copy and paste works between them.
let clipboard = null;

const PREFS_KEY = 'smitten-editor.sprite';
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
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

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
    this.doc = SpriteDoc.blank(16, 16, 1);
    this.loaded = false;
    this.failed = null;
    this.current = 0;
    this.prefs = loadPrefs();
    this.tool = 'pencil';
    this.brush = clamp(this.prefs.brush || 1, 1, 64);
    this.filled = false;
    this.contiguous = true;
    this.mirrorX = false;
    this.mirrorY = false;
    this.pixelGrid = this.prefs.pixelGrid ?? true;
    this.grid = this.prefs.grid ?? false;
    this.gridW = this.prefs.gridW || 8;
    this.gridH = this.prefs.gridH || 8;
    this.onion = this.prefs.onion ?? false;
    this.recent = Array.isArray(this.prefs.recent) ? this.prefs.recent.slice(0, 16) : [];
    const palette = host.palette();
    this.primary = draw.hexToRgba(palette[palette.length > 12 ? 12 : palette.length - 1]) || [255, 255, 255, 255];
    this.secondary = TRANSPARENT.slice();
    this.zoom = 8;
    this.panX = 0;
    this.panY = 0;
    this.fitted = false;
    this.selection = null; // {x, y, w, h}
    this.floating = null; // {x, y, w, h, data, canvas}
    this.editBase = null; // frame copy at the start of a pixel edit
    this.drag = null;
    this.hover = null;
    this.spaceDown = false;
    this.pointers = new Map();
    this.gesture = null;
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.nextId = 1;
    this.savedId = 0;
    this.selectedAnim = null; // animation name
    this.previewPlaying = true;
    this.visible = false;
    this.frameCanvases = [];
    this.wheelAcc = 0;
    this.seen = {};

    this.build();
    this.readTheme();
    this.themeObserver = new MutationObserver(() => { this.readTheme(); this.previewDirty = true; this.render(); this.renderSwatches(); });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.viewport);
    this.ready = this.load();
  }

  // -------------------------------------------------------------------------
  // Files

  async load({ keepView = false } = {}) {
    const { host } = this;
    try {
      const { doc, warnings } = await loadSprite(host, this.pngPath, this.metaPath);
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
    this.seen = { png: host.read(this.pngPath), json: host.read(this.metaPath) };
    this.loaded = true;
  }

  setDoc(doc, keepView) {
    this.doc = doc;
    this.current = keepView ? clamp(this.current, 0, doc.count - 1) : 0;
    this.selection = null;
    this.floating = null;
    this.editBase = null;
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
    const metaExists = host.exists(this.metaPath);
    const { png, json } = await encodeSprite(doc, this.pngPath, this.metaPath, metaExists);
    this.seen = { png, json: json ?? host.read(this.metaPath) };
    await host.write(this.pngPath, png);
    if (json !== null) await host.write(this.metaPath, json);
    doc.columns = layout.columns;
    doc.rows = layout.rows;
    this.savedId = this.undoStack.at(-1)?.id ?? 0;
    this.updateDirty();
  }

  reload(path) {
    if (path !== this.pngPath && path !== this.metaPath) return;
    const key = path === this.pngPath ? 'png' : 'json';
    if (this.host.read(path) === this.seen[key]) return;
    if (this.isDirty()) {
      this.seen[key] = this.host.read(path);
      this.host.toast(`${path} changed outside the sprite editor. Your unsaved edits are kept; saving replaces the file.`, { type: 'info', timeout: 6000 });
      return;
    }
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
  // DOM

  build() {
    const { h } = this.ui;
    const btn = (iconName, title, onclick, extra = {}) => h('button', { type: 'button', class: 'icon-btn small', title, 'aria-label': title, onclick, ...extra }, sicon(iconName));

    // Toolbar
    this.toolButtons = new Map();
    const toolGroup = h('div', { class: 'spr-group', role: 'toolbar', 'aria-label': 'Tools' });
    for (const t of TOOLS) {
      const b = btn(t.id, `${t.label} (${t.key})`, () => this.setTool(t.id), { 'aria-pressed': 'false' });
      this.toolButtons.set(t.id, b);
      toolGroup.append(b);
    }

    this.brushValue = h('span', { class: 'spr-num', title: 'Brush size ([ and ])' }, '1');
    this.brushGroup = h('div', { class: 'spr-group spr-brush' },
      h('span', { class: 'spr-label' }, 'Size'),
      h('button', { type: 'button', class: 'icon-btn small spr-step', title: 'Smaller brush ([)', onclick: () => this.setBrush(this.brush - 1) }, '−'),
      this.brushValue,
      h('button', { type: 'button', class: 'icon-btn small spr-step', title: 'Bigger brush (])', onclick: () => this.setBrush(this.brush + 1) }, '+'));
    this.btnFilled = btn('filled', 'Filled shape', () => { this.filled = !this.filled; this.renderToolbar(); }, { 'aria-pressed': 'false' });
    this.btnGlobal = h('button', { type: 'button', class: 'btn small ghost spr-toggle', title: 'Fill every pixel of that color, not just the touching ones (or Shift+click)', 'aria-pressed': 'false', onclick: () => { this.contiguous = !this.contiguous; this.renderToolbar(); } }, 'Global');
    this.btnMirrorX = btn('mirrorX', 'Mirror left and right', () => { this.mirrorX = !this.mirrorX; this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });
    this.btnMirrorY = btn('mirrorY', 'Mirror top and bottom', () => { this.mirrorY = !this.mirrorY; this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });

    this.btnPixelGrid = btn('pixelGrid', 'Pixel grid', () => { this.pixelGrid = !this.pixelGrid; this.persist(); this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });
    this.btnGrid = btn('grid', 'Grid (size in the menu)', () => { this.grid = !this.grid; this.persist(); this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });
    this.btnOnion = btn('onion', 'Onion skin: show the frames before and after', () => { this.onion = !this.onion; this.persist(); this.renderToolbar(); this.render(); }, { 'aria-pressed': 'false' });
    this.zoomLabel = h('button', { type: 'button', class: 'btn small ghost spr-zoom-label', title: 'Fit to the view (0)', onclick: () => this.fit() }, '100%');
    this.btnUndo = btn('undo', `Undo (${this.ui.modKey}+Z)`, () => this.undo());
    this.btnRedo = btn('redo', `Redo (${this.ui.modKey}+Shift+Z)`, () => this.redo());
    const moreBtn = btn('more', 'More', () => this.showMoreMenu(moreBtn));

    this.toolbar = h('div', { class: 'spr-toolbar' },
      toolGroup,
      h('div', { class: 'spr-sep' }),
      this.optionsGroup = h('div', { class: 'spr-group spr-options' }, this.brushGroup, this.btnFilled, this.btnGlobal),
      h('div', { class: 'spr-group' }, this.btnMirrorX, this.btnMirrorY),
      h('div', { class: 'spr-spacer' }),
      h('div', { class: 'spr-group' }, this.btnPixelGrid, this.btnGrid, this.btnOnion),
      h('div', { class: 'spr-sep' }),
      h('div', { class: 'spr-group' },
        btn('zoomOut', 'Zoom out (-)', () => this.zoomStep(-1)),
        this.zoomLabel,
        btn('zoomIn', 'Zoom in (+)', () => this.zoomStep(1))),
      h('div', { class: 'spr-sep' }),
      h('div', { class: 'spr-group' }, this.btnUndo, this.btnRedo, moreBtn));

    // Colors panel
    this.primarySwatch = h('button', { type: 'button', class: 'spr-swatch spr-primary', title: 'Primary color (left click)', onclick: () => { try { this.colorInput.showPicker(); } catch { this.colorInput.click(); } } });
    this.secondarySwatch = h('button', { type: 'button', class: 'spr-swatch spr-secondary', title: 'Secondary color (right click). Click to swap (X)', onclick: () => this.swapColors() });
    this.colorInput = h('input', { type: 'color', class: 'spr-color-input', 'aria-label': 'Pick a color', tabindex: '-1' });
    this.colorInput.addEventListener('input', () => {
      const c = draw.hexToRgba(this.colorInput.value);
      if (c) this.setPrimary([c[0], c[1], c[2], this.primary[3] || 255]);
    });
    this.colorInput.addEventListener('change', () => this.addRecent(this.primary));
    this.hexInput = h('input', { type: 'text', class: 'input small spr-hex', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Primary color (hex)', title: 'Primary color: #rrggbb or #rrggbbaa' });
    this.hexInput.addEventListener('change', () => {
      const c = draw.hexToRgba(this.hexInput.value);
      if (c) { this.setPrimary(c); this.addRecent(c); } else this.renderSwatches();
    });
    this.alphaInput = h('input', { type: 'range', class: 'spr-alpha', min: '0', max: '255', step: '1', 'aria-label': 'Opacity', title: 'Opacity' });
    this.alphaInput.addEventListener('input', () => this.setPrimary([this.primary[0], this.primary[1], this.primary[2], Number(this.alphaInput.value)]));
    this.paletteGrid = h('div', { class: 'spr-palette-grid', role: 'listbox', 'aria-label': 'Project palette' });
    this.recentGrid = h('div', { class: 'spr-palette-grid', 'aria-label': 'Recent colors' });
    this.colorsPanel = h('div', { class: 'spr-panel spr-colors' },
      h('div', { class: 'spr-current' },
        h('div', { class: 'spr-swatch-pair' }, this.secondarySwatch, this.primarySwatch),
        h('button', { type: 'button', class: 'icon-btn small', title: 'Swap colors (X)', 'aria-label': 'Swap colors', onclick: () => this.swapColors() }, sicon('swap')),
        this.colorInput),
      h('div', { class: 'spr-hex-row' }, this.hexInput),
      h('div', { class: 'spr-alpha-row' }, h('span', { class: 'spr-label' }, 'Opacity'), this.alphaInput),
      h('div', { class: 'spr-heading' }, 'Palette'),
      this.paletteGrid,
      this.recentHeading = h('div', { class: 'spr-heading' }, 'Recent'),
      this.recentGrid);

    // Canvas viewport
    this.canvas = h('canvas', { class: 'spr-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.statusPos = h('span', {}, '');
    this.statusInfo = h('span', {}, '');
    this.errorEl = h('div', { class: 'spr-error', hidden: true });
    this.viewport = h('div', { class: 'spr-viewport' }, this.canvas,
      h('div', { class: 'spr-status' }, this.statusInfo, this.statusPos), this.errorEl);
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e, true));
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.renderStatus(); this.render(); } });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Side panel: preview, animations, origin
    this.previewCanvas = h('canvas', { class: 'spr-preview-canvas' });
    this.previewSelect = h('select', { class: 'select small spr-preview-select', 'aria-label': 'Animation to preview' });
    this.previewSelect.addEventListener('change', () => this.selectAnimation(this.previewSelect.value || null));
    this.btnPreviewPlay = h('button', { type: 'button', class: 'icon-btn small', title: 'Play or pause the preview', onclick: () => { this.previewPlaying = !this.previewPlaying; this.renderPreviewControls(); this.startPreview(); } });
    this.animList = h('div', { class: 'spr-anim-list', role: 'listbox', 'aria-label': 'Animations' });
    this.animDetail = h('div', { class: 'spr-anim-detail' });
    this.originBody = h('div', { class: 'spr-origin' });
    this.infoEl = h('div', { class: 'spr-info' });
    this.sidePanel = h('div', { class: 'spr-panel spr-side' },
      h('div', { class: 'spr-heading spr-heading-row' }, 'Preview', h('span', { class: 'spr-spacer' }), this.btnPreviewPlay),
      h('div', { class: 'spr-preview' }, this.previewCanvas),
      this.previewSelect,
      h('div', { class: 'spr-heading spr-heading-row' }, 'Animations', h('span', { class: 'spr-spacer' }),
        h('button', { type: 'button', class: 'icon-btn small', title: 'New animation', 'aria-label': 'New animation', onclick: () => this.addAnimation() }, sicon('plus'))),
      this.animList,
      this.animDetail,
      h('div', { class: 'spr-heading' }, 'Origin'),
      this.originBody,
      this.infoEl);

    // Frames strip
    this.frameList = h('div', { class: 'spr-frame-list', role: 'listbox', 'aria-label': 'Frames' });
    this.framesBar = h('div', { class: 'spr-frames' },
      h('div', { class: 'spr-frame-actions' },
        h('span', { class: 'spr-label' }, 'Frames'),
        btn('plus', 'New empty frame after this one', () => this.addFrame(false)),
        btn('copy', 'Duplicate this frame', () => this.addFrame(true)),
        this.btnDeleteFrame = btn('trash', 'Delete this frame', () => this.deleteFrame(this.current))),
      this.frameList);

    this.element = h('div', { class: 'spr', tabindex: '-1' },
      this.toolbar,
      h('div', { class: 'spr-body' }, this.colorsPanel, this.viewport, this.sidePanel),
      this.framesBar);
    this.element.addEventListener('keydown', (e) => {
      if (this.onKeyDown(e)) { e.preventDefault(); e.stopPropagation(); }
    });
    this.element.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.code === 'Space') { this.spaceDown = false; this.updateCursor(); }
    });
    this.onBlur = () => { this.spaceDown = false; this.updateCursor(); };
    window.addEventListener('blur', this.onBlur);

    this.renderToolbar();
    this.renderSwatches();
    this.renderPreviewControls();
  }

  persist() {
    Object.assign(this.prefs, {
      brush: this.brush, pixelGrid: this.pixelGrid, grid: this.grid, gridW: this.gridW, gridH: this.gridH,
      onion: this.onion, recent: this.recent,
    });
    savePrefs(this.prefs);
  }

  readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const light = document.documentElement.dataset.theme === 'light';
    this.theme = {
      bg: v('--editor-bg') || (light ? '#ffffff' : '#141416'),
      border: v('--border-strong') || '#3a3a40',
      accent: v('--accent') || '#4d8eff',
      checkA: light ? '#ffffff' : '#2e2e33',
      checkB: light ? '#e4e4e9' : '#252529',
      pixelGrid: light ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.11)',
      grid: light ? 'rgba(0, 0, 0, 0.32)' : 'rgba(255, 255, 255, 0.28)',
    };
    const p = document.createElement('canvas');
    p.width = p.height = 2;
    const pc = p.getContext('2d');
    pc.fillStyle = this.theme.checkA;
    pc.fillRect(0, 0, 2, 2);
    pc.fillStyle = this.theme.checkB;
    pc.fillRect(0, 0, 1, 1);
    pc.fillRect(1, 1, 1, 1);
    // Cells line up with the sprite's pixels (scaled per render).
    this.checker = this.ctx.createPattern(p, 'repeat');
    this.previewChecker = null;
  }

  // -------------------------------------------------------------------------
  // Toolbar state

  setTool(id) {
    if (this.tool === id) return;
    if (this.drag) this.finishDrag();
    if (id !== 'select') this.commitFloating();
    this.tool = id;
    this.renderToolbar();
    this.updateCursor();
    this.render();
  }

  setBrush(n) {
    this.brush = clamp(n, 1, 64);
    this.persist();
    this.renderToolbar();
    this.render();
  }

  renderToolbar() {
    for (const [id, b] of this.toolButtons) b.setAttribute('aria-pressed', String(id === this.tool));
    this.brushGroup.hidden = !BRUSH_TOOLS.has(this.tool);
    this.brushValue.textContent = String(this.brush);
    this.btnFilled.hidden = !(this.tool === 'rect' || this.tool === 'ellipse');
    this.btnFilled.setAttribute('aria-pressed', String(this.filled));
    this.btnFilled.replaceChildren(sicon(this.filled ? 'filled' : 'outline'));
    this.btnFilled.title = this.filled ? 'Filled shape (click for outline)' : 'Outline shape (click for filled)';
    this.btnGlobal.hidden = this.tool !== 'fill';
    this.btnGlobal.setAttribute('aria-pressed', String(!this.contiguous));
    this.btnMirrorX.setAttribute('aria-pressed', String(this.mirrorX));
    this.btnMirrorY.setAttribute('aria-pressed', String(this.mirrorY));
    this.btnPixelGrid.setAttribute('aria-pressed', String(this.pixelGrid));
    this.btnGrid.setAttribute('aria-pressed', String(this.grid));
    this.btnOnion.setAttribute('aria-pressed', String(this.onion));
    this.zoomLabel.textContent = `${this.zoom * 100}%`;
  }

  updateCursor() {
    let c = 'crosshair';
    if (this.spaceDown || this.drag?.kind === 'pan') c = this.drag?.kind === 'pan' ? 'grabbing' : 'grab';
    else if (this.tool === 'select' && this.hover && this.insideSelection(this.hover.x, this.hover.y)) c = 'move';
    else if (this.drag?.kind === 'move') c = 'move';
    this.canvas.style.cursor = c;
  }

  showMoreMenu(anchor) {
    const sel = this.selection || this.floating;
    this.ui.showMenu(anchor, [
      { label: 'New sprite…', icon: 'filePlus', action: () => this.newSpriteDialog() },
      '-',
      { label: 'Resize canvas…', icon: 'maximize', action: () => this.resizeDialog() },
      { label: 'Split into frames…', icon: 'hash', action: () => this.splitDialog() },
      { label: 'Grid size…', icon: 'hash', action: () => this.gridDialog() },
      '-',
      { label: sel ? 'Flip selection horizontally' : 'Flip frame horizontally', shortcut: 'Shift+H', action: () => this.flip(true) },
      { label: sel ? 'Flip selection vertically' : 'Flip frame vertically', shortcut: 'Shift+V', action: () => this.flip(false) },
      '-',
      { label: 'Select all', shortcut: `${this.ui.modKey}+A`, action: () => this.selectAll() },
      { label: 'Deselect', shortcut: `${this.ui.modKey}+D`, disabled: !sel, action: () => this.deselect() },
      { label: 'Copy', shortcut: `${this.ui.modKey}+C`, icon: 'copy', action: () => this.copy() },
      { label: 'Paste', shortcut: `${this.ui.modKey}+V`, disabled: !clipboard, action: () => this.paste() },
      '-',
      { label: 'Clear origin', disabled: !this.doc.origin, action: () => this.setOrigin(null, true) },
    ]);
  }

  // -------------------------------------------------------------------------
  // Colors

  setPrimary(c) {
    this.primary = c.slice();
    this.renderSwatches();
  }

  setSecondary(c) {
    this.secondary = c.slice();
    this.renderSwatches();
  }

  swapColors() {
    [this.primary, this.secondary] = [this.secondary, this.primary];
    this.renderSwatches();
  }

  addRecent(c) {
    if (!c || c[3] === 0) return;
    const hex = draw.rgbaToHex(c);
    this.recent = [hex, ...this.recent.filter((x) => x !== hex)].slice(0, 16);
    this.persist();
    this.renderRecent();
  }

  swatch(hex, title) {
    const { h } = this.ui;
    const c = draw.hexToRgba(hex) || TRANSPARENT;
    const el = h('button', { type: 'button', class: 'spr-swatch', title, 'aria-label': title });
    el.style.setProperty('--c', draw.cssColor(c));
    el.dataset.hex = hex;
    el.addEventListener('click', () => this.setPrimary(c));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.setSecondary(c); });
    return el;
  }

  renderSwatches() {
    this.primarySwatch.style.setProperty('--c', draw.cssColor(this.primary));
    this.secondarySwatch.style.setProperty('--c', draw.cssColor(this.secondary));
    const hex = draw.rgbaToHex(this.primary);
    if (document.activeElement !== this.hexInput) this.hexInput.value = this.primary[3] === 0 ? 'transparent' : hex;
    this.colorInput.value = hex.slice(0, 7);
    this.alphaInput.value = String(this.primary[3]);
    this.renderPalette();
  }

  renderPalette() {
    const palette = this.host.palette();
    const key = palette.join(',');
    if (key !== this.paletteKey) {
      this.paletteKey = key;
      this.paletteGrid.replaceChildren(
        this.swatch('#00000000', 'Transparent'),
        ...palette.map((c, i) => this.swatch(c, `${c} (palette ${i})`)));
      this.renderRecent();
    }
    const cur = draw.rgbaToHex(this.primary);
    for (const el of this.paletteGrid.children) el.classList.toggle('selected', el.dataset.hex === cur || (el.dataset.hex === '#00000000' && this.primary[3] === 0));
  }

  renderRecent() {
    this.recentHeading.hidden = !this.recent.length;
    this.recentGrid.replaceChildren(...this.recent.map((c) => this.swatch(c, c)));
  }

  pickColor(x, y, secondary) {
    const { fw, fh } = this.doc;
    if (x < 0 || y < 0 || x >= fw || y >= fh) return;
    const i = (y * fw + x) * 4;
    const f = this.frame;
    const c = f[i + 3] === 0 ? TRANSPARENT.slice() : [f[i], f[i + 1], f[i + 2], f[i + 3]];
    if (secondary) this.setSecondary(c); else this.setPrimary(c);
  }

  // -------------------------------------------------------------------------
  // Frames

  get frame() { return this.doc.frames[this.current]; }

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
      c.className = 'spr-thumb';
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

  updateFrameCanvas(i) {
    const c = this.frameCanvases[i];
    if (!c) return;
    c.getContext('2d').putImageData(new ImageData(this.doc.frames[i], this.doc.fw, this.doc.fh), 0, 0);
    this.previewDirty = true;
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

  /** A change to the sprite's structure (frames, size, origin, animations). */
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
    if (!same) this.pushUndo({ kind: 'doc', before, after, beforeCurrent, afterCurrent: this.current, bytes: 0 });
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

  endPixelEdit() {
    if (!this.editBase) return;
    const f = this.doc.frames[this.editFrame];
    if (f && !draw.equalBuffers(this.editBase, f)) {
      this.pushUndo({ kind: 'pixels', frame: this.editFrame, before: this.editBase, after: f.slice(), bytes: this.editBase.length * 2 });
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
      this.doc.frames[e.frame].set(e[which]);
      this.updateFrameCanvas(e.frame);
      if (this.current !== e.frame) { this.current = e.frame; this.renderFrames(); }
      this.render();
    } else {
      this.doc.restore(e[which]);
      this.current = which === 'before' ? e.beforeCurrent : e.afterCurrent;
      this.afterStructureChange();
    }
    this.updateDirty();
    this.renderStatus();
  }

  // -------------------------------------------------------------------------
  // Drawing

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

  /** A plot(x, y) function painting color with the brush, the mirrors and the selection limit. */
  plotter(color, brush = this.brush) {
    const { fw, fh } = this.doc;
    const f = this.frame;
    const sel = this.floating ? null : this.selection;
    const [r, g, b, a] = color[3] === 0 ? TRANSPARENT : color;
    const off = Math.floor((brush - 1) / 2);
    const put = (x, y) => {
      if (x < 0 || y < 0 || x >= fw || y >= fh) return;
      if (sel && (x < sel.x || y < sel.y || x >= sel.x + sel.w || y >= sel.y + sel.h)) return;
      const i = (y * fw + x) * 4;
      f[i] = r; f[i + 1] = g; f[i + 2] = b; f[i + 3] = a;
    };
    const mx = this.mirrorX, my = this.mirrorY;
    return (x, y) => {
      for (let by = 0; by < brush; by++) {
        for (let bx = 0; bx < brush; bx++) {
          const px = x - off + bx, py = y - off + by;
          put(px, py);
          if (mx) put(fw - 1 - px, py);
          if (my) put(px, fh - 1 - py);
          if (mx && my) put(fw - 1 - px, fh - 1 - py);
        }
      }
    };
  }

  frameChanged() {
    this.updateFrameCanvas(this.current);
    this.render();
  }

  drawShape(d, shift) {
    let [x0, y0] = d.start;
    let [x1, y1] = d.end;
    if (shift) {
      const dx = x1 - x0, dy = y1 - y0;
      if (this.tool === 'line') {
        if (Math.abs(dx) > 2 * Math.abs(dy)) y1 = y0;
        else if (Math.abs(dy) > 2 * Math.abs(dx)) x1 = x0;
        else {
          const n = Math.max(Math.abs(dx), Math.abs(dy));
          x1 = x0 + Math.sign(dx || 1) * n;
          y1 = y0 + Math.sign(dy || 1) * n;
        }
      } else {
        const n = Math.max(Math.abs(dx), Math.abs(dy));
        x1 = x0 + Math.sign(dx || 1) * n;
        y1 = y0 + Math.sign(dy || 1) * n;
      }
    }
    this.frame.set(this.editBase);
    const plot = this.plotter(d.color);
    if (this.tool === 'line') draw.line(x0, y0, x1, y1, plot);
    else if (this.tool === 'rect') {
      if (this.filled) draw.rect(x0, y0, x1, y1, true, this.plotter(d.color, 1));
      else draw.rect(x0, y0, x1, y1, false, plot);
    } else if (this.filled) draw.ellipse(x0, y0, x1, y1, true, this.plotter(d.color, 1));
    else draw.ellipse(x0, y0, x1, y1, false, plot);
    d.shown = [x0, y0, x1, y1];
    this.frameChanged();
  }

  doFill(x, y, color, global) {
    const { fw, fh } = this.doc;
    const sel = this.selection;
    const inside = sel ? (px, py) => px >= sel.x && py >= sel.y && px < sel.x + sel.w && py < sel.y + sel.h : undefined;
    const pts = [[x, y]];
    if (this.mirrorX) pts.push([fw - 1 - x, y]);
    if (this.mirrorY) pts.push([x, fh - 1 - y]);
    if (this.mirrorX && this.mirrorY) pts.push([fw - 1 - x, fh - 1 - y]);
    this.beginPixelEdit();
    for (const [px, py] of pts) draw.fill(this.frame, fw, fh, px, py, color, global, inside);
    this.endPixelEdit();
    this.frameChanged();
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
    this.frameChanged();
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
    this.render();
  }

  deselect() {
    this.commitFloating();
    this.selection = null;
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
    this.frameChanged();
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
    this.frameChanged();
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
    if (e.altKey && (tool === 'pencil' || tool === 'eraser' || tool === 'fill' || SHAPES.has(tool))) tool = 'picker';
    if (tool !== 'select') this.commitFloating();
    const color = tool === 'eraser' ? TRANSPARENT : secondary ? this.secondary : this.primary;
    const base = { id: e.pointerId, tool, color };

    if (tool === 'pencil' || tool === 'eraser') {
      this.beginPixelEdit();
      const plot = this.plotter(color);
      if (e.shiftKey && this.lastPoint) draw.line(this.lastPoint[0], this.lastPoint[1], p.x, p.y, plot);
      else plot(p.x, p.y);
      this.drag = { ...base, kind: 'stroke', last: [p.x, p.y], plot };
      this.frameChanged();
    } else if (tool === 'fill') {
      this.doFill(p.x, p.y, color, this.contiguous === e.shiftKey);
      this.addRecent(color);
    } else if (SHAPES.has(tool)) {
      this.beginPixelEdit();
      this.drag = { ...base, kind: 'shape', start: [p.x, p.y], end: [p.x, p.y] };
      this.drawShape(this.drag, e.shiftKey);
    } else if (tool === 'picker') {
      this.pickColor(p.x, p.y, secondary);
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
        this.render();
      }
      return;
    }
    switch (d.kind) {
      case 'pan':
        this.panX = Math.round(d.px + e.clientX - d.sx);
        this.panY = Math.round(d.py + e.clientY - d.sy);
        this.render();
        break;
      case 'stroke': {
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ev of events.length ? events : [e]) {
          const q = this.toPixel(ev);
          if (q.x === d.last[0] && q.y === d.last[1]) continue;
          draw.line(d.last[0], d.last[1], q.x, q.y, d.plot);
          d.last = [q.x, q.y];
        }
        this.frameChanged();
        break;
      }
      case 'shape':
        if (p.x !== d.end[0] || p.y !== d.end[1] || e.shiftKey !== d.shift) {
          d.end = [p.x, p.y];
          d.shift = e.shiftKey;
          this.drawShape(d, e.shiftKey);
        }
        break;
      case 'pick':
        this.pickColor(p.x, p.y, d.secondary);
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
        this.addRecent(d.color);
        break;
      case 'shape':
        this.endPixelEdit();
        this.lastPoint = d.end;
        this.addRecent(d.color);
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
    const target = g.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist);
    const z = ZOOMS.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), ZOOMS[0]);
    // The pixel under the gesture's start center stays under its current center.
    const fx = (g.cx - g.panX) / g.zoom, fy = (g.cy - g.panY) / g.zoom;
    this.zoom = z;
    this.panX = Math.round(cx - fx * z);
    this.panY = Math.round(cy - fy * z);
    this.renderToolbar();
    this.render();
  }

  onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * scale, dy = e.deltaY * scale;
    if (!e.ctrlKey && !e.metaKey && (e.shiftKey || Math.abs(dx) > Math.abs(dy))) {
      this.panX -= Math.round(e.shiftKey && !dx ? dy : dx);
      if (!e.shiftKey) this.panY -= Math.round(dy);
      this.render();
      return;
    }
    this.wheelAcc += dy;
    const step = e.ctrlKey || e.metaKey ? 20 : 50;
    if (Math.abs(this.wheelAcc) < step) return;
    const dir = this.wheelAcc < 0 ? 1 : -1;
    this.wheelAcc = 0;
    this.zoomStep(dir, e.clientX - r.left, e.clientY - r.top);
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
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod && !e.altKey) {
      if (k === 'z') { if (e.shiftKey) this.redo(); else this.undo(); return true; }
      if (k === 'y') { this.redo(); return true; }
      if (k === 'c') { this.copy(); return true; }
      if (k === 'x') { this.cut(); return true; }
      if (k === 'v') { this.paste(); return true; }
      if (k === 'a') { this.selectAll(); return true; }
      if (k === 'd') { this.deselect(); return true; }
      if (k === '=' || k === '+') { this.zoomStep(1); return true; }
      if (k === '-') { this.zoomStep(-1); return true; }
      if (k === '0') { this.fit(); return true; }
      return false;
    }
    if (mod || e.altKey) return false;
    if (e.key === ' ') {
      if (!this.spaceDown) { this.spaceDown = true; this.updateCursor(); }
      return true;
    }
    const tools = { b: 'pencil', e: 'eraser', g: 'fill', l: 'line', m: 'select', i: 'picker', o: 'origin' };
    if (!e.shiftKey && tools[k]) { this.setTool(tools[k]); return true; }
    if (k === 'u') { this.setTool(e.shiftKey ? 'ellipse' : 'rect'); return true; }
    if (e.shiftKey && k === 'h') { this.flip(true); return true; }
    if (e.shiftKey && k === 'v') { this.flip(false); return true; }
    switch (k) {
      case 'x': this.swapColors(); return true;
      case '[': this.setBrush(this.brush - 1); return true;
      case ']': this.setBrush(this.brush + 1); return true;
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
    z = clamp(Math.round(z), 1, 32);
    const W = this.viewport.clientWidth, H = this.viewport.clientHeight;
    ax ??= W / 2;
    ay ??= H / 2;
    const fx = (ax - this.panX) / this.zoom, fy = (ay - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = Math.round(ax - fx * z);
    this.panY = Math.round(ay - fy * z);
    this.renderToolbar();
    this.renderStatus();
    this.render();
  }

  zoomStep(dir, ax, ay) {
    const next = dir > 0
      ? ZOOMS.find((z) => z > this.zoom) ?? ZOOMS.at(-1)
      : [...ZOOMS].reverse().find((z) => z < this.zoom) ?? ZOOMS[0];
    this.setZoom(next, ax, ay);
  }

  fit() {
    const W = this.viewport.clientWidth, H = this.viewport.clientHeight;
    if (!W || !H) return;
    const { fw, fh } = this.doc;
    this.zoom = clamp(Math.floor(Math.min((W - 48) / fw, (H - 48) / fh)), 1, 32);
    this.panX = Math.round((W - fw * this.zoom) / 2);
    this.panY = Math.round((H - fh * this.zoom) / 2);
    this.fitted = true;
    this.renderToolbar();
    this.renderStatus();
    this.render();
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
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    if (!this.loaded || this.failed) return;
    const { fw, fh } = doc;
    const ox = this.panX, oy = this.panY;
    const pw = fw * z, ph = fh * z;
    const px = 1 / dpr; // one device pixel

    // Checkerboard cells: a power of two of sprite pixels, at least 8 screen pixels.
    let cell = 1;
    while (cell * z < 8) cell *= 2;
    this.checker.setTransform(new DOMMatrix().translate(ox, oy).scale(cell * z));
    ctx.fillStyle = this.checker;
    ctx.fillRect(ox, oy, pw, ph);

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

    // Visible pixel range
    const vx0 = clamp(Math.floor(-ox / z), 0, fw), vx1 = clamp(Math.ceil((W - ox) / z), 0, fw);
    const vy0 = clamp(Math.floor(-oy / z), 0, fh), vy1 = clamp(Math.ceil((H - oy) / z), 0, fh);
    const snap = (v) => Math.round(v * dpr) / dpr + px / 2;
    const gridLines = (stepX, stepY, color) => {
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
      ctx.strokeStyle = color;
      ctx.lineWidth = px;
      ctx.stroke();
    };
    if (this.pixelGrid && z >= 6) gridLines(1, 1, theme.pixelGrid);
    if (this.grid && this.gridW * z >= 4 && this.gridH * z >= 4) gridLines(this.gridW, this.gridH, theme.grid);

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

    // Hovered brush footprint
    const h = this.hover;
    if (h && !this.drag && !this.spaceDown && BRUSH_TOOLS.has(this.tool) && h.x >= 0 && h.y >= 0 && h.x < fw && h.y < fh) {
      const off = Math.floor((this.brush - 1) / 2);
      const bx = ox + (h.x - off) * z, by = oy + (h.y - off) * z, bs = this.brush * z;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = Math.max(1, px);
      ctx.strokeRect(snap(bx) - px, snap(by) - px, bs + px, bs + px);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.strokeRect(snap(bx), snap(by), bs - px, bs - px);
    }

    // Selection outline
    const s = fl || this.selection;
    if (s) {
      const sx = snap(ox + s.x * z), sy = snap(oy + s.y * z);
      ctx.save();
      ctx.lineWidth = Math.max(1, px);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(sx, sy, s.w * z, s.h * z);
      ctx.lineDashOffset = 4;
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(sx, sy, s.w * z, s.h * z);
      ctx.restore();
    }

    // Origin
    const o = doc.origin;
    if (o) this.drawOriginMarker(ox + o[0] * z, oy + o[1] * z, 1);
    else if (this.tool === 'origin' && h) this.drawOriginMarker(ox + clamp(Math.round(h.fx), 0, fw) * z, oy + clamp(Math.round(h.fy), 0, fh) * z, 0.5);
  }

  drawOriginMarker(x, y, alpha) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    for (const [color, width] of [['rgba(0, 0, 0, 0.7)', 4], [this.theme.accent, 2]]) {
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
    const h = this.hover;
    const parts = [];
    if (h && h.x >= 0 && h.y >= 0 && h.x < doc.fw && h.y < doc.fh) parts.push(`${h.x}, ${h.y}`);
    const s = this.floating || this.selection;
    if (s) parts.push(`${s.w}×${s.h} selected`);
    this.statusPos.textContent = parts.join('  ·  ');
    this.statusInfo.textContent = `Frame ${this.current} of ${doc.count}  ·  ${doc.fw}×${doc.fh}`;
  }

  renderInfo() {
    const { doc } = this;
    const { columns, rows } = doc.layout();
    const files = doc.needsMeta() || this.host.exists(this.metaPath) ? `${this.pngPath} + ${this.metaPath.slice(this.metaPath.lastIndexOf('/') + 1)}` : this.pngPath;
    this.infoEl.textContent = `${doc.count} frame${doc.count === 1 ? '' : 's'} of ${doc.fw}×${doc.fh}, sheet ${columns * doc.fw}×${rows * doc.fh}. Saves ${files}.`;
    this.renderStatus();
  }

  // -------------------------------------------------------------------------
  // Origin panel

  renderOrigin() {
    const { h } = this.ui;
    const o = this.doc.origin;
    const num = (i) => {
      const input = h('input', { type: 'number', class: 'input small spr-num-input', step: '1', value: o ? String(o[i]) : '', placeholder: '0', 'aria-label': i ? 'Origin y' : 'Origin x' });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (input.value === '' || !Number.isFinite(v)) { this.renderOrigin(); return; }
        const next = o ? [...o] : [0, 0];
        next[i] = v;
        this.setOrigin(next, true);
      });
      return input;
    };
    this.originBody.replaceChildren(
      h('label', { class: 'spr-field' }, h('span', {}, 'x'), num(0)),
      h('label', { class: 'spr-field' }, h('span', {}, 'y'), num(1)),
      h('button', { type: 'button', class: 'icon-btn small', title: o ? 'Clear the origin' : 'Set it with the origin tool (O)', 'aria-label': 'Clear the origin', disabled: !o, onclick: () => this.setOrigin(null, true) }, sicon('x')));
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
      title: 'New animation', label: 'Name (used in code: sprite:animation("name"))', value: suggestion, okLabel: 'Create',
      validate: (v) => (!v ? 'Please enter a name.' : names.has(v) ? 'There is already an animation with that name.' : ''),
    });
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
    if (!name || name === a.name) return;
    const old = a.name;
    this.editAnimation(old, (x) => { x.name = name; });
    this.selectAnimation(name);
  }

  async deleteAnimation(a) {
    if (!await this.ui.confirmDialog({ title: 'Delete animation', message: `Delete the animation "${a.name}"? Its frames stay in the sprite.`, okLabel: 'Delete', danger: true })) return;
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
      }, h('span', { class: 'spr-anim-name' }, a.name), h('span', { class: 'spr-anim-meta' }, `${a.frames.length}f · ${a.fps} fps${a.loop ? '' : ' · once'}`));
      item.addEventListener('click', () => this.selectAnimation(a.name === this.selectedAnim ? null : a.name));
      item.addEventListener('dblclick', () => this.renameAnimation(a));
      return item;
    }));
    if (!anims.length) this.animList.append(h('div', { class: 'spr-empty' }, 'No animations yet. Add one to name a list of frames for sprite:animation("name").'));

    // Preview choices
    this.previewSelect.replaceChildren(h('option', { value: '' }, 'All frames'),
      ...anims.map((a) => h('option', { value: a.name }, a.name)));
    this.previewSelect.value = this.selectedAnim || '';

    const a = anims.find((x) => x.name === this.selectedAnim);
    if (!a) { this.animDetail.replaceChildren(); this.animDetail.hidden = true; return; }
    this.animDetail.hidden = false;
    const framesInput = h('input', { type: 'text', class: 'input small', value: formatFrameList(a.frames), spellcheck: 'false', 'aria-label': 'Frames', title: 'Frame numbers in play order, e.g. 0-3, 5' });
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
    const fpsInput = h('input', { type: 'number', class: 'input small spr-num-input', min: '0', step: '1', value: String(a.fps), 'aria-label': 'Frames per second' });
    fpsInput.addEventListener('change', () => {
      const v = Number(fpsInput.value);
      if (!Number.isFinite(v) || v < 0) { fpsInput.value = String(a.fps); return; }
      this.editAnimation(a.name, (x) => { x.fps = v; });
    });
    const loopSwitch = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(a.loop), 'aria-label': 'Loop' });
    loopSwitch.addEventListener('click', () => this.editAnimation(a.name, (x) => { x.loop = !x.loop; }));
    this.animDetail.replaceChildren(
      h('label', { class: 'spr-field spr-field-wide' }, h('span', {}, 'Frames'), framesInput),
      h('div', { class: 'spr-row' },
        h('label', { class: 'spr-field' }, h('span', {}, 'FPS'), fpsInput),
        h('label', { class: 'spr-field' }, h('span', {}, 'Loop'), loopSwitch)),
      h('div', { class: 'spr-row' },
        h('button', { type: 'button', class: 'btn small', title: 'Add the frame being edited to the end of this animation', onclick: () => this.editAnimation(a.name, (x) => { x.frames.push(this.current); }) }, sicon('plus', 14), `Add frame ${this.current}`),
        h('span', { class: 'spr-spacer' }),
        h('button', { type: 'button', class: 'icon-btn small', title: 'Rename', 'aria-label': 'Rename animation', onclick: () => this.renameAnimation(a) }, sicon('pencil')),
        h('button', { type: 'button', class: 'icon-btn small', title: 'Delete animation', 'aria-label': 'Delete animation', onclick: () => this.deleteAnimation(a) }, sicon('trash'))));
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
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, W, H);
    const fit = Math.min((W - 8) / doc.fw, (H - 8) / doc.fh);
    const s = fit >= 1 ? Math.floor(fit) : fit;
    const w = doc.fw * s, h = doc.fh * s;
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
    this.previewChecker ??= ctx.createPattern(this.patternCanvas(), 'repeat');
    ctx.fillStyle = this.previewChecker;
    ctx.fillRect(x, y, w, h);
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

  async formDialog({ title, fields, okLabel, validate, note }) {
    const { h } = this.ui;
    const inputs = {};
    const error = h('div', { class: 'field-error', role: 'alert' });
    const body = h('div', { class: 'spr-form' },
      note ? h('p', { class: 'dialog-message spr-form-note' }, note) : null,
      h('div', { class: 'spr-form-grid' }, ...fields.map((f) => {
        let input;
        if (f.type === 'select') {
          input = h('select', { class: 'select' }, ...f.options.map(([v, label]) => h('option', { value: v }, label)));
          input.value = f.value;
        } else {
          // No min/max attributes: check() explains out-of-range values itself.
          input = h('input', { class: 'input', type: f.type || 'number', value: String(f.value), spellcheck: 'false', autocomplete: 'off', inputmode: f.type === 'text' ? null : 'numeric' });
        }
        input.addEventListener('input', () => { error.textContent = ''; });
        inputs[f.name] = input;
        return h('label', { class: `field ${f.wide ? 'spr-wide' : ''}` }, h('span', { class: 'spr-form-label' }, f.label), input);
      })),
      error);
    const read = () => {
      const out = {};
      for (const f of fields) out[f.name] = f.type === 'text' || f.type === 'select' ? inputs[f.name].value.trim() : Number(inputs[f.name].value);
      return out;
    };
    const check = () => {
      const values = read();
      for (const f of fields) {
        if (f.type === 'text' || f.type === 'select') continue;
        const v = values[f.name];
        if (!Number.isInteger(v) || v < (f.min ?? 1) || v > (f.max ?? 4096)) {
          error.textContent = `${f.label} should be a whole number from ${f.min ?? 1} to ${f.max ?? 4096}.`;
          return false;
        }
      }
      const msg = validate?.(values);
      error.textContent = msg || '';
      return !msg;
    };
    const res = await this.ui.openDialog({
      title,
      body,
      actions: [
        { label: 'Cancel', value: null, ghost: true },
        { label: okLabel, value: 'ok', primary: true, submit: true, validate: check },
      ],
      onOpen: () => { const first = Object.values(inputs)[0]; first.focus(); first.select?.(); },
    });
    this.element.focus({ preventScroll: true });
    return res === 'ok' ? read() : null;
  }

  async resizeDialog() {
    const { doc } = this;
    const v = await this.formDialog({
      title: 'Resize canvas',
      note: 'Changes the size of every frame. Pixels are kept, anchored to the side you choose.',
      fields: [
        { name: 'w', label: 'Width', value: doc.fw },
        { name: 'h', label: 'Height', value: doc.fh },
        { name: 'anchor', label: 'Anchor', type: 'select', value: 'center', options: ANCHORS, wide: true },
      ],
      okLabel: 'Resize',
    });
    if (!v || (v.w === doc.fw && v.h === doc.fh)) return;
    const col = v.anchor.includes('left') ? 0 : v.anchor.includes('right') ? 2 : 1;
    const row = v.anchor.includes('top') ? 0 : v.anchor.includes('bottom') ? 2 : 1;
    const dx = Math.floor(((v.w - doc.fw) * col) / 2), dy = Math.floor(((v.h - doc.fh) * row) / 2);
    this.selection = null;
    this.change(() => {
      doc.frames = doc.frames.map((f) => {
        const out = new Uint8ClampedArray(v.w * v.h * 4);
        draw.stamp(out, v.w, v.h, f, dx, dy, doc.fw, doc.fh);
        return out;
      });
      doc.fw = v.w;
      doc.fh = v.h;
      if (doc.origin) doc.origin = [doc.origin[0] + dx, doc.origin[1] + dy];
    });
    this.fit();
  }

  async splitDialog() {
    const { doc } = this;
    const sheet = doc.toSheet();
    const guess = doc.count === 1 && doc.fw > doc.fh && doc.fw % doc.fh === 0 ? doc.fh : doc.fw;
    const v = await this.formDialog({
      title: 'Split into frames',
      note: `Cuts the whole sheet (${sheet.width}×${sheet.height}) into frames of a new size, numbered left to right, then top to bottom.`,
      fields: [
        { name: 'w', label: 'Frame width', value: guess, max: sheet.width },
        { name: 'h', label: 'Frame height', value: doc.fh, max: sheet.height },
      ],
      okLabel: 'Split',
    });
    if (!v || (v.w === doc.fw && v.h === doc.fh)) return;
    this.selection = null;
    this.change(() => {
      const next = SpriteDoc.fromSheet(sheet.data, sheet.width, sheet.height, v.w, v.h);
      doc.frames = next.frames;
      doc.fw = v.w;
      doc.fh = v.h;
      doc.columns = next.columns;
      doc.rows = next.rows;
      for (const a of doc.animations) a.frames = a.frames.filter((f) => f < doc.count);
      if (doc.origin) doc.origin = [Math.min(doc.origin[0], v.w), Math.min(doc.origin[1], v.h)];
      this.current = 0;
    });
    this.fit();
  }

  async gridDialog() {
    const v = await this.formDialog({
      title: 'Grid size',
      fields: [
        { name: 'w', label: 'Cell width', value: this.gridW, max: 1024 },
        { name: 'h', label: 'Cell height', value: this.gridH, max: 1024 },
      ],
      okLabel: 'Show grid',
    });
    if (!v) return;
    this.gridW = v.w;
    this.gridH = v.h;
    this.grid = true;
    this.persist();
    this.renderToolbar();
    this.render();
  }

  async newSpriteDialog() {
    const { host } = this;
    const folder = this.pngPath.includes('/') ? this.pngPath.slice(0, this.pngPath.lastIndexOf('/') + 1) : 'sprites/';
    let n = 1;
    while (host.exists(`${folder}sprite${n > 1 ? n : ''}.png`)) n++;
    const v = await this.formDialog({
      title: 'New sprite',
      fields: [
        { name: 'path', label: 'File', type: 'text', value: `${folder}sprite${n > 1 ? n : ''}.png`, wide: true },
        { name: 'w', label: 'Frame width', value: 16 },
        { name: 'h', label: 'Frame height', value: 16 },
        { name: 'frames', label: 'Frames', value: 1, max: 1024 },
      ],
      okLabel: 'Create',
      validate: (vals) => {
        const p = vals.path.replace(/^\/+/, '');
        if (!/\.png$/i.test(p)) return 'The file name should end in .png.';
        if (/(^|\/)\.\.?(\/|$)/.test(p) || /[\\:*?"<>|]/.test(p)) return 'That isn\'t a valid file name.';
        if (host.exists(p)) return 'A file with that name already exists.';
        return '';
      },
    });
    if (!v) return;
    const path = v.path.replace(/^\/+/, '');
    const doc = SpriteDoc.blank(v.w, v.h, v.frames);
    const sheet = doc.toSheet();
    await host.write(path, await encodePNG(sheet.data, sheet.width, sheet.height));
    if (doc.needsMeta()) {
      const metaPath = `${stemOf(path)}.sprite.json`;
      await host.write(metaPath, doc.metaText(metaPath, path));
    }
    host.openFile(path);
  }

  // -------------------------------------------------------------------------
  // Tool host interface

  show() {
    this.visible = true;
    this.readTheme();
    this.paletteKey = null;
    this.renderSwatches();
    this.resizeCanvas();
    this.previewDirty = true;
    this.startPreview();
  }

  hide() {
    this.visible = false;
    this.finishDrag();
    this.stopPreview();
  }

  focus() {
    this.element.focus({ preventScroll: true });
  }

  destroy() {
    this.visible = false;
    this.stopPreview();
    this.themeObserver.disconnect();
    this.resizeObserver.disconnect();
    window.removeEventListener('blur', this.onBlur);
  }
}
