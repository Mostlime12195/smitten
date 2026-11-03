// Sound effect editor: opens .sfx.json files (docs/reference.md, "Sound
// effects"). Presets, mutate, a slider for every parameter, a waveform view
// and previews rendered by the editor's synthesizer (host.synth()), so they
// sound exactly like the game.

import {
  PARAMS, PARAM, GROUPS, WAVES, PRESETS, SFX_DEFAULTS,
  roundParam, normalizeSfx, parseSfx, sfxText, sfxDuration, mutate, newSfxParams,
} from './params.js';
import {
  loadStyle, SynthState, synthBanner, Player, encodeWav, cssVar, onThemeChange, fitCanvas, History,
  modHeld, typingTarget, baseName, waveIcon, isMac, createSlider, SHARED_STYLE,
} from './audio.js';

loadStyle(SHARED_STYLE);

const RENDER_DELAY = 180; // ms after the last change before the preview renders
const AUTOPLAY_KEY = 'smitten.sfx.autoplay';

function readAutoplay() {
  try { return localStorage.getItem(AUTOPLAY_KEY) !== '0'; } catch { return true; }
}
function writeAutoplay(on) {
  try { localStorage.setItem(AUTOPLAY_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}

class SfxEditor {
  constructor(host) {
    this.host = host;
    this.ui = host.ui;
    const text = host.read(host.path);
    const parsed = parseSfx(typeof text === 'string' ? text : '');
    this.params = parsed.params;
    this.extra = parsed.extra;
    this.version = parsed.version;
    this.savedText = sfxText(this.params, this.extra, this.version);
    this.samples = null;
    this.samplesKey = '';
    this.renderTimer = 0;
    this.renderSeq = 0;
    this.autoplay = readAutoplay();
    this.playStart = 0;
    this.playLength = 0;
    this.raf = 0;
    this.handled = new WeakSet();

    this.history = new History({
      snapshot: () => ({ ...this.params }),
      restore: (s) => { this.params = { ...s }; this.changed({ record: false }); },
    });

    this.synth = new SynthState(host, () => this.onSynthStatus());
    this.player = new Player(this.synth);
    this.build();
    this.unwatchTheme = onThemeChange(() => this.drawWave());
  }

  // -------------------------------------------------------------------------
  // UI

  build() {
    const { h, icon } = this.ui;
    const mod = isMac ? '⌘' : 'Ctrl+';

    this.btnUndo = h('button', { type: 'button', class: 'icon-btn small', title: `Undo (${mod}Z)`, 'aria-label': 'Undo', onclick: () => this.undo() }, undoIcon());
    this.btnRedo = h('button', { type: 'button', class: 'icon-btn small', title: `Redo (${mod}Shift+Z)`, 'aria-label': 'Redo', onclick: () => this.redo() }, undoIcon(true));
    this.btnExport = h('button', { type: 'button', class: 'btn small ghost', title: 'Download the rendered sound as a 16-bit WAV file', onclick: () => this.exportWav() }, icon('download', 14), 'Export WAV');
    this.autoSwitch = h('button', {
      type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(this.autoplay), 'aria-label': 'Play on change',
      onclick: () => {
        this.autoplay = !this.autoplay;
        writeAutoplay(this.autoplay);
        this.autoSwitch.setAttribute('aria-checked', String(this.autoplay));
      },
    });

    const toolbar = h('div', { class: 'snd-toolbar' },
      this.btnUndo, this.btnRedo,
      h('span', { class: 'snd-sep' }),
      h('button', { type: 'button', class: 'btn small ghost', title: 'Copy the parameters as JSON', onclick: () => this.copyParams() }, icon('copy', 14), 'Copy'),
      h('button', { type: 'button', class: 'btn small ghost', title: 'Paste parameters copied as JSON', onclick: () => this.pasteParams() }, pasteIcon(), 'Paste'),
      h('span', { class: 'snd-sep' }),
      this.btnExport,
      h('span', { class: 'snd-spacer' }),
      h('label', { class: 'snd-switch-label', onclick: (e) => { if (e.target !== this.autoSwitch) this.autoSwitch.click(); } }, 'Play on change'),
      this.autoSwitch,
    );

    this.banner = synthBanner(this.ui, this.synth);

    // Presets
    const presetList = h('div', { class: 'sfx-presets' },
      h('div', { class: 'snd-heading' }, 'Presets'),
      ...PRESETS.map((p) => h('button', {
        type: 'button', class: 'sfx-preset', title: `A new random ${p.label.toLowerCase()} sound`, onclick: () => this.applyPreset(p),
      }, presetIcon(p.id), h('span', {}, p.label))),
      h('div', { class: 'snd-divider' }),
      h('button', { type: 'button', class: 'sfx-preset', title: 'Change the parameters slightly', onclick: () => this.mutate() }, mutateIcon(), h('span', {}, 'Mutate')),
    );

    // Waveform and the big play button
    this.btnPlay = h('button', { type: 'button', class: 'sfx-play', title: 'Play (Space)', 'aria-label': 'Play', onclick: () => this.play() }, icon('play', 26));
    this.canvas = h('canvas', { class: 'sfx-wave-canvas', 'aria-label': 'Waveform of the rendered sound' });
    this.waveInfo = h('div', { class: 'sfx-wave-info' });
    this.waveBox = h('div', { class: 'sfx-wave' }, this.canvas, this.waveInfo);
    const waveRow = h('div', { class: 'sfx-wave-row' }, this.btnPlay, this.waveBox);

    // Parameter groups
    this.rows = new Map();
    this.waveButtons = new Map();
    const cards = GROUPS.map((g) => {
      const card = h('section', { class: `snd-card sfx-group-${g.id}` }, h('h3', { class: 'snd-card-title' }, g.label));
      if (g.id === 'oscillator') {
        const seg = h('div', { class: 'sfx-waves', role: 'group', 'aria-label': 'Wave' });
        for (const w of WAVES) {
          const b = h('button', { type: 'button', title: w[0].toUpperCase() + w.slice(1), 'aria-pressed': 'false', onclick: () => this.setWave(w) }, waveIcon(w), h('span', {}, w));
          this.waveButtons.set(w, b);
          seg.append(b);
        }
        card.append(seg);
      }
      if (g.id === 'envelope') {
        this.lengthInfo = h('span', { class: 'snd-card-note' });
        card.firstChild.append(this.lengthInfo);
      }
      if (g.id === 'duty') {
        this.dutyNote = h('span', { class: 'snd-card-note' }, 'square wave only');
        card.firstChild.append(this.dutyNote);
        this.dutyCard = card;
      }
      for (const p of PARAMS.filter((q) => q.group === g.id)) card.append(this.paramRow(p));
      return card;
    });
    this.groups = h('div', { class: 'sfx-groups' }, ...cards);

    const main = h('div', { class: 'sfx-main' }, waveRow, this.groups);
    const body = h('div', { class: 'sfx-body' }, presetList, main);

    this.element = h('div', { class: 'snd-tool sfx-tool', tabindex: '-1' }, toolbar, this.banner.element, body);
    this.element.addEventListener('keydown', (e) => { if (this.handleKey(e)) { e.preventDefault(); e.stopPropagation(); } });
    this.element.addEventListener('copy', (e) => this.onCopy(e));
    this.element.addEventListener('paste', (e) => this.onPaste(e));

    this.resizeObserver = new ResizeObserver(() => this.drawWave());
    this.resizeObserver.observe(this.waveBox);

    this.syncControls();
    this.onSynthStatus();
  }

  paramRow(p) {
    const slider = createSlider(this.ui, p, {
      get: () => this.params[p.key],
      set: (v, gesture) => {
        if (gesture) this.history.record(`slider:${p.key}`);
        this.setParam(p.key, v, { record: !gesture });
      },
      end: () => this.history.settle(),
      reset: p.off ?? SFX_DEFAULTS[p.key],
      escape: () => this.element.focus(),
    });
    this.rows.set(p.key, slider);
    return slider.element;
  }

  syncRow(key) {
    this.rows.get(key)?.sync();
  }

  syncControls() {
    for (const p of PARAMS) this.syncRow(p.key);
    for (const [w, b] of this.waveButtons) b.setAttribute('aria-pressed', String(this.params.wave === w));
    this.dutyCard.classList.toggle('inactive', this.params.wave !== 'square');
    this.dutyNote.hidden = this.params.wave === 'square';
    this.lengthInfo.textContent = `length ${PARAM.sustain.format(roundParam({ digits: 3, min: 0, max: 99 }, sfxDuration(this.params)))}`;
    this.btnUndo.disabled = !this.history.canUndo;
    this.btnRedo.disabled = !this.history.canRedo;
  }

  onSynthStatus() {
    if (!this.element) return;
    this.banner.update();
    const ready = this.synth.ready;
    this.btnPlay.disabled = !ready;
    this.btnExport.disabled = !ready;
    this.element.classList.toggle('no-synth', !ready);
    if (ready) this.render({ play: false });
    else this.drawWave();
  }

  // -------------------------------------------------------------------------
  // Editing

  setParam(key, value, { record = true } = {}) {
    if (this.params[key] === value) return;
    if (record) this.history.record();
    this.params = { ...this.params, [key]: value };
    this.changed({ record: false });
  }

  setWave(wave) {
    if (this.params.wave === wave) {
      this.scheduleRender(true);
      return;
    }
    this.history.record();
    this.params = { ...this.params, wave };
    this.changed();
  }

  applyPreset(preset) {
    this.history.record();
    this.params = { ...preset.make(Math.random), volume: this.params.volume };
    this.changed({ immediate: true });
  }

  mutate() {
    this.history.record();
    this.params = mutate(this.params);
    this.changed({ immediate: true });
  }

  replaceParams(params) {
    this.history.record();
    this.params = normalizeSfx(params);
    this.changed({ immediate: true });
  }

  /** After any change to this.params. */
  changed({ immediate = false } = {}) {
    this.syncControls();
    this.updateDirty();
    this.scheduleRender(this.autoplay, immediate);
  }

  updateDirty() {
    this.host.setDirty(sfxText(this.params, this.extra, this.version) !== this.savedText);
  }

  undo() {
    if (this.history.undo()) this.syncControls();
  }

  redo() {
    if (this.history.redo()) this.syncControls();
  }

  // -------------------------------------------------------------------------
  // Rendering and playback

  scheduleRender(play, immediate = false) {
    clearTimeout(this.renderTimer);
    if (immediate) this.render({ play });
    else this.renderTimer = setTimeout(() => this.render({ play }), RENDER_DELAY);
  }

  /** Render the current params (if they changed); returns the samples or null. */
  async render({ play = false } = {}) {
    clearTimeout(this.renderTimer);
    if (!this.synth.ready) return null;
    const key = JSON.stringify(this.params);
    if (key !== this.samplesKey) {
      const seq = ++this.renderSeq;
      let samples;
      try {
        samples = await this.synth.synth.renderSfx({ format: 'smitten.sfx', version: 1, ...this.params });
      } catch (e) {
        console.error(e);
        this.waveInfo.textContent = `Could not render: ${e.message}`;
        return null;
      }
      if (seq !== this.renderSeq || this.destroyed) return null;
      this.samples = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
      this.samplesKey = key;
      this.drawWave();
    }
    if (play) this.startPlayback();
    return this.samples;
  }

  async play() {
    if (!this.synth.ready) return;
    await this.render({ play: true });
  }

  startPlayback() {
    this.player.stop();
    if (!this.samples?.length) return;
    this.player.play(this.samples);
    this.playStart = performance.now();
    this.playLength = (this.samples.length / this.synth.sampleRate) * 1000;
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.drawWave();
      if (performance.now() - this.playStart < this.playLength && !this.destroyed) this.raf = requestAnimationFrame(tick);
      else this.playLength = 0;
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.player.stop();
    cancelAnimationFrame(this.raf);
    this.playLength = 0;
    this.drawWave();
  }

  drawWave() {
    if (!this.canvas || this.element?.hidden) return;
    const w = this.waveBox.clientWidth;
    const hgt = this.waveBox.clientHeight;
    if (!w || !hgt) return;
    const ctx = fitCanvas(this.canvas, w, hgt);
    const el = this.element;
    ctx.clearRect(0, 0, w, hgt);
    const mid = hgt / 2;
    ctx.fillStyle = cssVar(el, '--border');
    ctx.fillRect(0, Math.round(mid), w, 1);

    const samples = this.synth.ready ? this.samples : null;
    if (!samples?.length) {
      this.waveInfo.textContent = this.synth.ready ? '' : 'No preview';
      return;
    }
    const n = samples.length;
    const seconds = n / this.synth.sampleRate;
    this.waveInfo.textContent = `${seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`} · ${this.synth.sampleRate} Hz`;

    // Time grid: a faint line every 100 ms.
    ctx.fillStyle = cssVar(el, '--hover');
    for (let t = 0.1; t < seconds; t += 0.1) ctx.fillRect(Math.round((t / seconds) * w), 0, 1, hgt);

    const accent = cssVar(el, '--accent');
    const amp = mid - 6;
    ctx.fillStyle = accent;
    const per = n / w;
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x * per);
      const b = Math.min(n, Math.max(a + 1, Math.floor((x + 1) * per)));
      let lo = 1;
      let hi = -1;
      for (let i = a; i < b; i++) {
        const s = samples[i];
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      lo = Math.max(-1, lo);
      hi = Math.min(1, hi);
      const y0 = mid - hi * amp;
      const y1 = mid - lo * amp;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }

    if (this.playLength) {
      const t = (performance.now() - this.playStart) / this.playLength;
      if (t >= 0 && t <= 1) {
        ctx.fillStyle = cssVar(el, '--fg');
        ctx.fillRect(Math.round(t * w), 0, 2, hgt);
      }
    }
  }

  async exportWav() {
    const samples = await this.render();
    if (!samples?.length) {
      this.host.toast('There is nothing to export: the synthesizer is not available.', { type: 'error' });
      return;
    }
    const name = baseName(this.host.path).replace(/\.sfx\.json$/i, '') || 'sound';
    this.ui.downloadBlob(encodeWav(samples, this.synth.sampleRate), `${name}.wav`);
  }

  // -------------------------------------------------------------------------
  // Clipboard

  paramsJson() {
    return sfxText(this.params).trim();
  }

  async copyParams() {
    try {
      await navigator.clipboard.writeText(this.paramsJson());
      this.host.toast('Copied the sound effect parameters.', { type: 'success' });
    } catch {
      this.host.toast('Could not copy to the clipboard.', { type: 'error' });
    }
  }

  async pasteParams() {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch { text = null; }
    if (!text || !this.tryPaste(text, true)) {
      const typed = await this.ui.promptDialog({
        title: 'Paste parameters', label: 'Sound effect JSON', okLabel: 'Paste', placeholder: '{"wave": "square", ...}',
        validate: (v) => (tryParseObject(v) ? '' : 'That is not a JSON object.'),
      });
      if (typed) this.tryPaste(typed, false);
    }
  }

  tryPaste(text, quiet) {
    const obj = tryParseObject(text);
    if (!obj) {
      if (!quiet) this.host.toast('The clipboard does not hold sound effect JSON.', { type: 'error' });
      return false;
    }
    this.replaceParams(obj);
    this.host.toast('Pasted the sound effect parameters.', { type: 'success' });
    return true;
  }

  onCopy(e) {
    if (typingTarget(e)) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', this.paramsJson());
    this.host.toast('Copied the sound effect parameters.', { type: 'success' });
  }

  onPaste(e) {
    if (typingTarget(e)) return;
    e.preventDefault();
    this.tryPaste(e.clipboardData.getData('text/plain'), false);
  }

  // -------------------------------------------------------------------------
  // Keys

  handleKey(e) {
    if (this.handled.has(e)) return false;
    this.handled.add(e);
    const typing = typingTarget(e);
    if (modHeld(e)) {
      const k = e.key.toLowerCase();
      if (typing) return false;
      if (k === 'z' && !e.shiftKey) { this.undo(); return true; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { this.redo(); return true; }
      return false;
    }
    if (typing || e.altKey) return false;
    if (e.key === ' ' && !e.repeat) { this.play(); return true; }
    if (e.key === ' ') return true;
    if (e.key === 'Escape' && this.playLength) { this.stop(); return true; }
    return false;
  }

  // -------------------------------------------------------------------------
  // Tool interface

  async save() {
    const text = sfxText(this.params, this.extra, this.version);
    await this.host.write(this.host.path, text);
    this.savedText = text;
    this.host.setDirty(false);
  }

  focus() {
    if (!this.element.contains(document.activeElement)) this.element.focus({ preventScroll: true });
  }

  show() {
    requestAnimationFrame(() => this.drawWave());
  }

  hide() {
    this.stop();
  }

  reload(path) {
    if (path !== this.host.path) return;
    const text = this.host.read(this.host.path);
    if (typeof text !== 'string') return;
    const dirty = sfxText(this.params, this.extra, this.version) !== this.savedText;
    if (dirty) return;
    let parsed;
    try { parsed = parseSfx(text); } catch { return; }
    const next = sfxText(parsed.params, parsed.extra, parsed.version);
    if (next === this.savedText) return;
    this.params = parsed.params;
    this.extra = parsed.extra;
    this.version = parsed.version;
    this.savedText = next;
    this.history.clear();
    this.syncControls();
    this.host.setDirty(false);
    this.scheduleRender(false, true);
  }

  destroy() {
    this.destroyed = true;
    this.synth.destroyed = true;
    clearTimeout(this.renderTimer);
    cancelAnimationFrame(this.raf);
    this.player.stop();
    this.resizeObserver.disconnect();
    this.unwatchTheme();
  }
}

function tryParseObject(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Small icons the shared icon set doesn't have.
function svgIcon(body, size = 16) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return span;
}

export function undoIcon(redo = false) {
  return svgIcon(redo
    ? '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'
    : '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>');
}

function pasteIcon() {
  return svgIcon('<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>', 14);
}

function mutateIcon() {
  return svgIcon('<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>');
}

const PRESET_ICONS = {
  pickup: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/><path d="M9.5 10.5h5"/>',
  laser: '<path d="M4 20 20 4"/><path d="m14 4h6v6"/>',
  explosion: '<path d="m12 2 2 6 6-2-3 5 5 3-6 1 1 6-5-4-4 5v-6l-6-1 5-3-3-5 6 2z"/>',
  powerup: '<path d="m12 3 3 6 6 .9-4.5 4.4 1 6.2L12 17.6 6.5 20.5l1-6.2L3 9.9 9 9z"/>',
  hit: '<path d="m13 2-3 7h5l-4 13"/><path d="M5 12h3"/><path d="M16 12h3"/>',
  jump: '<path d="M12 21V5"/><path d="m6 11 6-6 6 6"/><path d="M5 21h14"/>',
  blip: '<rect x="4" y="9" width="16" height="6" rx="2"/><path d="M8 12h.01"/>',
  random: '<rect width="16" height="16" x="4" y="4" rx="3"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01"/>',
};

function presetIcon(id) {
  return svgIcon(PRESET_ICONS[id] || '', 15);
}

export default {
  id: 'sfx',
  label: 'Sound editor',
  match: (path) => /\.sfx\.json$/i.test(path),
  newAssets: [{
    label: 'Sound effect',
    folder: 'sfx',
    extension: '.sfx.json',
    files: (base) => ({ [`${base}.sfx.json`]: sfxText(newSfxParams()) }),
  }],
  open(host) {
    return new SfxEditor(host);
  },
};
