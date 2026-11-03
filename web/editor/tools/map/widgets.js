// Pieces shared by the map and tileset editors: icons, a zoomable and
// pannable canvas viewport, undo history and a key/value property editor.

import { formatValue, parseValue } from './model.js';

// ---------------------------------------------------------------------------
// Icons (Lucide-style, 24×24, stroke = currentColor); others come from ui.js.

const ICONS = {
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  rectFill: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7.5" y="7.5" width="9" height="9" rx="1" fill="currentColor" stroke="none"/>',
  bucket: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
  picker: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
  pointer: '<path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"/>',
  placeObject: '<rect x="3" y="3" width="13" height="13" rx="2"/><path d="M19.5 14v7"/><path d="M16 17.5h7"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
  grid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14"/><path d="m2 2 20 20"/>',
  tilesLayer: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/><path d="M12 3v18"/>',
  objectsLayer: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M14 7h7"/><path d="M3 17h7"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  solid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m3 15 6-6"/><path d="m3 21 18-18"/><path d="m9 21 12-12"/><path d="m15 21 6-6"/>',
};

export function icon(ui, name, size = 16) {
  if (!ICONS[name]) return ui.icon(name, size);
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

/** An icon button: {icon, title, onclick, pressed} */
export function iconButton(ui, { icon: name, title, onclick, pressed, small = false }) {
  const b = ui.h('button', {
    type: 'button', class: `icon-btn${small ? ' small' : ''}`, title, 'aria-label': title, onclick,
  }, icon(ui, name));
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
  return b;
}

/** Theme colors from the editor's CSS variables. */
export function themeColors(el) {
  const cs = getComputedStyle(el);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const dark = (document.documentElement.dataset.theme || 'dark') !== 'light';
  return {
    dark,
    bg: v('--editor-bg', '#141416'),
    panel: v('--panel-2', '#222226'),
    border: v('--border-strong', '#3a3a40'),
    fg: v('--fg', '#ededef'),
    muted: v('--fg-muted', '#a1a1aa'),
    accent: v('--accent', '#4d8eff'),
    danger: v('--danger', '#f87171'),
    font: v('--font-ui', 'system-ui, sans-serif'),
    checkA: dark ? '#2a2a2f' : '#e9e9ec',
    checkB: dark ? '#323238' : '#f7f7f8',
    grid: dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.13)',
    gridStrong: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
  };
}

/** A distinct, readable color for an object type name. */
export function typeColor(type) {
  let h = 0;
  for (const c of type || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 75% 55%)`;
}

// ---------------------------------------------------------------------------
// Viewport: a canvas with zoom (wheel) and pan (space-drag, middle-drag).

const ZOOMS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];

export class Viewport {
  /**
   * el: the container; draw(ctx, viewport) paints; onPointer(type, event, world)
   * handles 'down' | 'move' | 'up' | 'leave' when not panning;
   * contentSize() -> {width, height} in world pixels.
   */
  constructor(el, { draw, onPointer, contentSize, onZoom }) {
    this.el = el;
    this.drawFn = draw;
    this.onPointer = onPointer;
    this.contentSize = contentSize;
    this.onZoom = onZoom;
    this.canvas = document.createElement('canvas');
    el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.zoom = 1;
    this.ox = 0;
    this.oy = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.spaceDown = false;
    this.pan = null;
    this.fitted = false;
    this.frame = 0;
    this.mouse = null; // last pointer position in CSS px, or null when outside

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(el);
    this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.pointerUp(e));
    this.canvas.addEventListener('pointerleave', (e) => {
      this.mouse = null;
      if (!this.pan) this.onPointer('leave', e, null);
    });
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('auxclick', (e) => e.preventDefault());
  }

  destroy() {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = window.devicePixelRatio || 1;
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.fitted) this.fit();
    this.render(true);
  }

  /** Zoom so the content fits (whole-number zoom when it's at least 1). */
  fit() {
    const { width, height } = this.contentSize();
    if (!this.width || !width || !height) return;
    this.fitted = true;
    const z = Math.min((this.width - 48) / width, (this.height - 48) / height);
    this.zoom = z >= 1 ? Math.min(32, Math.floor(z)) : Math.max(0.1, z);
    this.ox = Math.round((this.width - width * this.zoom) / 2);
    this.oy = Math.round((this.height - height * this.zoom) / 2);
    this.onZoom?.(this.zoom);
    this.render();
  }

  setZoom(z, cx = this.width / 2, cy = this.height / 2) {
    z = Math.max(0.1, Math.min(64, z));
    const wx = (cx - this.ox) / this.zoom;
    const wy = (cy - this.oy) / this.zoom;
    this.zoom = z;
    this.ox = Math.round(cx - wx * z);
    this.oy = Math.round(cy - wy * z);
    this.onZoom?.(z);
    this.render();
  }

  step(dir, cx, cy) {
    const z = this.zoom;
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 1e-9) : [...ZOOMS].reverse().find((v) => v < z - 1e-9);
    if (next) this.setZoom(next, cx, cy);
  }

  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.ox) / this.zoom, y: (clientY - r.top - this.oy) / this.zoom };
  }

  /** The visible part of the world: {x0, y0, x1, y1}. */
  visible() {
    return { x0: -this.ox / this.zoom, y0: -this.oy / this.zoom, x1: (this.width - this.ox) / this.zoom, y1: (this.height - this.oy) / this.zoom };
  }

  setSpace(down) {
    this.spaceDown = down;
    this.el.classList.toggle('pan-ready', down);
  }

  pointerDown(e) {
    this.el.closest('.mt-root')?.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, id: e.pointerId };
      this.canvas.setPointerCapture(e.pointerId);
      this.el.classList.add('panning');
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.onPointer('down', e, this.toWorld(e.clientX, e.clientY));
  }

  pointerMove(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (this.pan) {
      this.ox = this.pan.ox + e.clientX - this.pan.x;
      this.oy = this.pan.oy + e.clientY - this.pan.y;
      this.render();
      return;
    }
    this.onPointer('move', e, this.toWorld(e.clientX, e.clientY));
  }

  pointerUp(e) {
    if (this.pan) {
      this.pan = null;
      this.el.classList.remove('panning');
      return;
    }
    this.onPointer('up', e, this.toWorld(e.clientX, e.clientY));
  }

  wheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    if (e.shiftKey && !e.ctrlKey) {
      // Shift+wheel scrolls sideways.
      this.ox -= e.deltaY || e.deltaX;
      this.render();
      return;
    }
    if (e.ctrlKey) {
      // Trackpad pinch: smooth zoom.
      this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.01), cx, cy);
      return;
    }
    this.wheelAcc = (this.wheelAcc || 0) + e.deltaY;
    if (Math.abs(this.wheelAcc) < 40 && e.deltaMode === 0) return;
    this.step(this.wheelAcc < 0 ? 1 : -1, cx, cy);
    this.wheelAcc = 0;
  }

  /** Schedule a redraw (or draw now with immediate = true). */
  render(immediate = false) {
    if (immediate) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.paint();
      return;
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  paint() {
    if (!this.width || this.el.offsetParent === null) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.drawFn(ctx, this);
  }

  /** Set ctx to draw in world coordinates. */
  worldTransform(ctx) {
    const d = this.dpr;
    ctx.setTransform(d * this.zoom, 0, 0, d * this.zoom, d * this.ox, d * this.oy);
    ctx.imageSmoothingEnabled = false;
  }

  /** Set ctx to draw in CSS pixels of the viewport. */
  screenTransform(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** World x -> screen x (CSS px), snapped to the device pixel grid + 0.5 for crisp 1px lines. */
  sx(x) { return Math.round((this.ox + x * this.zoom) * this.dpr) / this.dpr; }
  sy(y) { return Math.round((this.oy + y * this.zoom) * this.dpr) / this.dpr; }
}

/** Draw a grid over [0, w] × [0, h] world pixels with cells cw × ch, in screen space. */
export function drawGrid(ctx, vp, w, h, cw, ch, color) {
  if (cw * vp.zoom < 5 || ch * vp.zoom < 5) return;
  const vis = vp.visible();
  const c0 = Math.max(0, Math.floor(vis.x0 / cw));
  const c1 = Math.min(Math.floor(w / cw), Math.ceil(vis.x1 / cw));
  const r0 = Math.max(0, Math.floor(vis.y0 / ch));
  const r1 = Math.min(Math.floor(h / ch), Math.ceil(vis.y1 / ch));
  vp.screenTransform(ctx);
  ctx.beginPath();
  const half = 0.5 / vp.dpr;
  const top = vp.sy(0);
  const bottom = vp.sy(h);
  const left = vp.sx(0);
  const right = vp.sx(w);
  for (let c = c0; c <= c1; c++) {
    const x = vp.sx(c * cw) + half;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let r = r0; r <= r1; r++) {
    const y = vp.sy(r * ch) + half;
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / vp.dpr;
  ctx.stroke();
}

/** A checkerboard behind [0, w] × [0, h] (transparent areas), in world space. */
export function drawChecker(ctx, vp, w, h, colors) {
  vp.worldTransform(ctx);
  ctx.fillStyle = colors.checkB;
  ctx.fillRect(0, 0, w, h);
  // Squares of about 8 screen pixels, in whole world pixels.
  const size = Math.max(1, Math.round(8 / vp.zoom));
  const vis = vp.visible();
  const x0 = Math.max(0, Math.floor(vis.x0 / size));
  const x1 = Math.min(Math.ceil(w / size), Math.ceil(vis.x1 / size));
  const y0 = Math.max(0, Math.floor(vis.y0 / size));
  const y1 = Math.min(Math.ceil(h / size), Math.ceil(vis.y1 / size));
  if ((x1 - x0) * (y1 - y0) > 40000) return;
  ctx.fillStyle = colors.checkA;
  for (let y = y0; y < y1; y++) {
    for (let x = x0 + ((x0 + y) & 1); x < x1; x += 2) {
      ctx.fillRect(x * size, y * size, Math.min(size, w - x * size), Math.min(size, h - y * size));
    }
  }
}

// ---------------------------------------------------------------------------
// Undo history: entries are {undo(), redo()}.

export class History {
  constructor(onChange) {
    this.done = [];
    this.undone = [];
    this.onChange = onChange;
  }

  push(entry) {
    this.done.push(entry);
    if (this.done.length > 200) this.done.shift();
    this.undone = [];
    this.onChange?.();
  }

  undo() {
    const e = this.done.pop();
    if (!e) return false;
    e.undo();
    this.undone.push(e);
    this.onChange?.();
    return true;
  }

  redo() {
    const e = this.undone.pop();
    if (!e) return false;
    e.redo();
    this.done.push(e);
    this.onChange?.();
    return true;
  }

  clear() {
    this.done = [];
    this.undone = [];
    this.onChange?.();
  }
}

// ---------------------------------------------------------------------------
// Property editor: rows of key and value inputs.

/**
 * props: an object; onCommit(newProps) is called when a key or value is
 * changed (on change/blur), a row is removed or added. Values are typed:
 * "true"/"false" become booleans, numbers become numbers.
 */
export function propertyEditor(ui, { title = 'Properties', props, onCommit, hidden = [] }) {
  const { h } = ui;
  const list = h('div', { class: 'mt-props' });
  const entries = Object.entries(props).filter(([k]) => !hidden.includes(k));
  const rows = [];
  const commit = () => {
    const out = {};
    for (const k of hidden) if (k in props) out[k] = props[k];
    for (const r of rows) {
      const key = r.key.value.trim();
      if (!key || hidden.includes(key)) continue;
      out[key] = parseValue(r.value.value);
    }
    onCommit(out);
  };
  const addRow = (key, value, focus = false) => {
    const k = h('input', { class: 'input small', value: key, placeholder: 'name', spellcheck: 'false', 'aria-label': 'Property name' });
    const v = h('input', { class: 'input small', value: formatValue(value), placeholder: 'value', spellcheck: 'false', 'aria-label': 'Property value' });
    const row = { key: k, value: v };
    const del = iconButton(ui, {
      icon: 'trash', title: 'Remove property', small: true,
      onclick: () => {
        rows.splice(rows.indexOf(row), 1);
        el.remove();
        commit();
      },
    });
    const el = h('div', { class: 'mt-prop' }, k, v, del);
    for (const input of [k, v]) {
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    }
    rows.push(row);
    list.insertBefore(el, addBtn);
    if (focus) k.focus();
  };
  const addBtn = h('button', { type: 'button', class: 'btn ghost small' }, ui.icon('plus', 14), 'Add property');
  addBtn.addEventListener('click', () => addRow('', '', true));
  list.append(addBtn);
  for (const [k, v] of entries) addRow(k, v);
  return h('div', {}, h('div', { class: 'mt-props-title' }, title), list);
}

/** A small labelled number input that calls onCommit(value) on change. */
export function numberInput(ui, { value, min, max, step = 1, onCommit, title, className = 'input small' }) {
  const input = ui.h('input', { type: 'number', class: className, value: String(value), min, max, step, title, 'aria-label': title });
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) { input.value = String(value); return; }
    onCommit(n, input);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return input;
}

/** Whether a key event comes from a text field (so tool shortcuts shouldn't run). */
export function isTyping(e) {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** Load a PNG's bytes as an ImageBitmap (null if it can't be decoded). */
export async function decodeImage(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  try {
    return await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  } catch {
    return null;
  }
}
