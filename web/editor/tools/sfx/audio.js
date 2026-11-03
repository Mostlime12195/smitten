// Helpers shared by the sound effect and music editors: the synthesizer's
// status, WAV encoding, the waveform view, undo history, theme colors and
// the tools' stylesheets. Audio only ever comes from host.synth().

import { toPosition, fromPosition, roundParam } from './params.js';

/** Load a stylesheet next to a tool module once (url: new URL('x.css', import.meta.url)). */
export function loadStyle(url) {
  const href = String(url);
  if (document.querySelector(`link[data-tool-style="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.toolStyle = href;
  document.head.append(link);
}

/**
 * The synthesizer for one tool instance. status: 'loading' | 'ready' |
 * 'unavailable'. onChange runs whenever the status changes.
 */
export class SynthState {
  constructor(host, onChange) {
    this.host = host;
    this.onChange = onChange;
    this.synth = null;
    this.error = null;
    this.status = 'loading';
    this.load();
  }

  async load() {
    this.status = 'loading';
    this.error = null;
    this.onChange?.(this);
    try {
      const synth = await this.host.synth();
      if (!synth || typeof synth.renderSfx !== 'function') throw new Error('The synthesizer did not load.');
      this.synth = synth;
      this.status = 'ready';
    } catch (e) {
      this.synth = null;
      this.error = e;
      this.status = 'unavailable';
    }
    if (!this.destroyed) this.onChange?.(this);
    return this.synth;
  }

  get ready() { return this.status === 'ready'; }
  get sampleRate() { return this.synth?.sampleRate || 44100; }

  get message() {
    if (this.status === 'loading') return 'Loading the synthesizer…';
    if (this.status === 'unavailable') {
      const why = this.error?.message || 'unknown error';
      return `Sound previews are off: ${why.replace(/\.$/, '')}.`;
    }
    return '';
  }
}

/** A status line for the synthesizer, with a retry button. */
export function synthBanner(ui, state) {
  const text = ui.h('span', { class: 'snd-banner-text' });
  const retry = ui.h('button', { type: 'button', class: 'btn small ghost', onclick: () => state.load() }, 'Retry');
  const el = ui.h('div', { class: 'snd-banner', role: 'status' }, ui.icon('info'), text, retry);
  const update = () => {
    el.hidden = state.ready;
    el.classList.toggle('loading', state.status === 'loading');
    text.textContent = state.message;
    retry.hidden = state.status !== 'unavailable';
  };
  update();
  return { element: el, update };
}

/** Plays samples one at a time; stop() stops the current playback. */
export class Player {
  constructor(state) {
    this.state = state;
    this.handles = new Set();
  }

  play(samples) {
    if (!this.state.ready || !samples?.length) return null;
    const handle = this.state.synth.play(samples);
    if (handle) this.handles.add(handle);
    return handle;
  }

  stop() {
    for (const h of this.handles) {
      try { h.stop(); } catch { /* already stopped */ }
    }
    this.handles.clear();
  }
}

// ---------------------------------------------------------------------------
// WAV

/** 16-bit PCM mono WAV bytes from float samples. */
export function encodeWav(samples, sampleRate = 44100) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------------------------------------------------------------------------
// Theme

/** Read a CSS variable from an element (resolved for the current theme). */
export function cssVar(el, name, fallback = '#888') {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Call fn when the editor's theme changes; returns an unsubscribe function. */
export function onThemeChange(fn) {
  const mo = new MutationObserver(() => fn());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  return () => mo.disconnect();
}

/** Size a canvas to its CSS box at device resolution; returns its 2D context (in CSS pixels). */
export function fitCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const hgt = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ---------------------------------------------------------------------------
// Undo

/** Snapshot undo history. snapshot()/restore(s) convert the tool's state. */
export class History {
  constructor({ snapshot, restore, limit = 200 }) {
    this.snapshot = snapshot;
    this.restore = restore;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  }

  /** Record the state before an edit. key: coalesce consecutive edits with the same key. */
  record(key = null) {
    if (key && this.pending === key) return;
    this.pending = key;
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** End a coalesced edit (a slider drag let go). */
  settle() { this.pending = null; }

  undo() {
    this.pending = null;
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    return true;
  }

  redo() {
    this.pending = null;
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    return true;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}

// ---------------------------------------------------------------------------
// Keys and paths

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Ctrl (Cmd on macOS) held, without Alt. */
export function modHeld(e) {
  return (e.ctrlKey || e.metaKey) && !e.altKey;
}

/** True when the key event belongs to a text field and shouldn't drive the tool. */
export function typingTarget(e) {
  const t = e.target;
  if (!(t instanceof Element)) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') return !['range', 'checkbox', 'radio', 'button'].includes(t.type);
  return false;
}

export function dirName(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function baseName(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Resolve a path relative to a directory ("" is the project root). */
export function resolvePath(dir, rel) {
  const parts = rel.startsWith('/') ? [] : (dir ? dir.split('/') : []);
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** The relative path from directory `from` to project path `to`. */
export function relativePath(from, to) {
  const a = from ? from.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** Wave icons for wave buttons (SVG markup, 24x16). */
export const WAVE_ICONS = {
  square: '<path d="M2 12V4h5v8h5V4h5v8h5"/>',
  sawtooth: '<path d="M2 12 9 4v8l7-8v8l6-7"/>',
  triangle: '<path d="m2 8 4-4 8 8 8-8"/>',
  sine: '<path d="M2 8c2.5-6 5-6 7.5 0s5 6 7.5 0 3.5-4 5-2"/>',
  noise: '<path d="M2 8l1.5-3 1.5 6 1.5-8 1.5 9 1.5-5 1.5 3 1.5-6 1.5 8 1.5-4 1.5 2 1.5-5 1.5 6 1.5-3"/>',
};

export function waveIcon(wave) {
  const span = document.createElement('span');
  span.className = 'icon snd-wave-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${WAVE_ICONS[wave] || ''}</svg>`;
  return span;
}

// ---------------------------------------------------------------------------
// Parameter sliders

/** Parse a typed value ("250 ms", "40%", "off", "1.5") for a parameter (see params.js PARAMS). */
export function parseTyped(p, text) {
  const s = text.trim().toLowerCase();
  if (s === 'off' && p.off !== undefined) return p.off;
  const m = s.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*([a-z%/²]*)/);
  if (!m) return null;
  let v = Number(m[1]);
  const unit = m[2];
  if (unit === 'ms') v /= 1000;
  else if (unit === 'khz') v *= 1000;
  else if (unit.startsWith('%') || (p.unit === '%' && !unit && Math.abs(v) > 1)) v /= 100;
  if (p.fromHz && (unit === 'hz' || unit === 'khz')) v = p.fromHz(Math.max(v, 1e-9));
  return Number.isFinite(v) ? roundParam(p, v) : null;
}

/**
 * A labeled slider with an editable readout for parameter p.
 * get(): the value. set(value, gesture): gesture is true while the slider is
 * dragged (one undo step per drag; end() runs when it's let go).
 * reset: the value a double-click restores.
 */
export function createSlider(ui, p, { get, set, end, reset, escape }) {
  const { h } = ui;
  const id = `snd-${p.key}-${Math.random().toString(36).slice(2, 8)}`;
  const range = h('input', { type: 'range', id, min: '0', max: '1000', step: '1', class: 'snd-range', 'aria-label': p.label });
  const readout = h('input', { type: 'text', class: 'snd-readout', spellcheck: 'false', autocomplete: 'off', 'aria-label': `${p.label} value` });
  const label = h('label', { for: id, class: 'snd-label', title: `${p.help}. Double-click to reset.` }, p.label);
  const row = h('div', { class: 'snd-row' }, label, range, readout);

  const sync = () => {
    const v = get();
    range.value = String(Math.round(toPosition(p, v) * 1000));
    if (document.activeElement !== readout) readout.value = p.format(v);
    row.classList.toggle('off', p.off !== undefined && v === p.off);
  };

  range.addEventListener('input', () => set(fromPosition(p, range.value / 1000), true));
  range.addEventListener('change', () => end?.());
  const doReset = () => { if (reset !== undefined && get() !== reset) set(reset, false); };
  range.addEventListener('dblclick', doReset);
  label.addEventListener('dblclick', doReset);

  readout.addEventListener('focus', () => {
    readout.value = String(get());
    readout.select();
  });
  const commit = () => {
    const v = parseTyped(p, readout.value);
    if (v !== null && v !== get()) set(v, false);
    sync();
  };
  readout.addEventListener('blur', () => { commit(); readout.value = p.format(get()); });
  readout.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); readout.value = String(get()); readout.select(); }
    if (e.key === 'Escape') { e.preventDefault(); readout.value = p.format(get()); escape?.(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const t = toPosition(p, get()) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.05 : 0.01);
      set(fromPosition(p, t), false);
      readout.value = String(get());
    }
  });

  sync();
  return { element: row, sync, range, readout };
}

/** Shared CSS for parameter sliders and the synthesizer banner lives in sfx.css. */
export const SHARED_STYLE = new URL('./sfx.css', import.meta.url);
