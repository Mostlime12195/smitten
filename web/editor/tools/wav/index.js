// Sound file editor: opens .wav files in the Sound workspace. Records from
// the microphone (recorder.js), shows the waveform, trims the start and end
// with handles, changes the volume (with Normalize) and the speed, plays the
// result and saves it as a 16-bit WAV (wav.js). The edits are kept apart from
// the sound while the file is open, so a trim can be made wider again; the
// saved file holds only the result. Recording is one way to get a sound;
// a .wav file from anywhere opens the same way.

import {
  decodeWav, encodeWav, toMono, peak, normalizeVolume, findSound, renderClip, wavSize,
  RECORD_RATE, MAX_RECORD_SECONDS,
} from './wav.js';
import { Recorder, recordingProblem, microphoneMessage } from './recorder.js';
import {
  loadStyle, cssVar, onThemeChange, fitCanvas, History, modHeld, typingTarget, isMac, createSlider, SHARED_STYLE,
} from '../sfx/audio.js';
import { micIcon, undoIcon } from '../sfx/index.js';

loadStyle(SHARED_STYLE);
loadStyle(new URL('./wav.css', import.meta.url));

const HANDLE_HIT = 10; // px around a trim handle that grab it
const NUDGE = 0.01; // seconds an arrow key moves a handle (Shift: ten times)

const trimDigits = (n, d) => Number(n.toFixed(d)).toString();
const secondsText = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${trimDigits(s, 2)} s`);

const VOLUME = {
  key: 'volume', label: 'Volume', min: 0, max: 10, curve: 'sq+', unit: '%', digits: 2,
  format: (v) => `${Math.round(v * 100)}%`, help: 'How loud the sound is: 100% is as recorded',
};
const SPEED = {
  key: 'speed', label: 'Speed', min: 0.5, max: 2, curve: 'log', unit: '', digits: 2,
  format: (v) => `${trimDigits(v, 2)}×`, help: 'Faster makes the sound shorter and higher; slower makes it longer and lower',
};

let nextSourceId = 1;

/** A sound to edit: {id, sampleRate, channels, mono}. */
function makeSource(sampleRate, channels) {
  return { id: nextSourceId++, sampleRate, channels, mono: toMono(channels) };
}

let playContext = null;

/** Plays channels of samples at a rate through WebAudio. -> {stop()} */
function playChannels(channels, sampleRate) {
  playContext ??= new AudioContext();
  if (playContext.state === 'suspended') playContext.resume();
  const len = Math.max(1, channels[0].length);
  const buffer = playContext.createBuffer(channels.length, len, sampleRate);
  channels.forEach((ch, c) => buffer.copyToChannel(ch, c));
  const node = playContext.createBufferSource();
  node.buffer = buffer;
  node.connect(playContext.destination);
  node.start();
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try { node.stop(); } catch { /* already ended */ }
      node.disconnect();
    },
  };
}

class WavEditor {
  constructor(host) {
    this.host = host;
    this.ui = host.ui;
    this.source = null;
    this.edit = { start: 0, end: 0, volume: 1, speed: 1 };
    this.savedKey = '';
    this.problem = '';
    this.recorder = null;
    this.levels = [];
    this.raf = 0;
    this.playing = null; // {handle, started, duration}
    this.drag = null;
    this.handled = new WeakSet();
    this.history = new History({
      snapshot: () => ({ source: this.source, ...this.edit }),
      restore: (s) => {
        this.source = s.source;
        this.edit = { start: s.start, end: s.end, volume: s.volume, speed: s.speed };
        this.changed();
      },
    });
    this.build();
    this.load();
    this.savedKey = this.key();
    this.unwatchTheme = onThemeChange(() => this.draw());
  }

  /** The editor's state as a string: the file is dirty when it differs from the saved one. */
  key() {
    if (!this.source) return '';
    const { start, end, volume, speed } = this.edit;
    return `${this.source.id}:${start}:${end}:${volume}:${speed}`;
  }

  load() {
    const bytes = this.host.read(this.host.path);
    this.problem = '';
    this.source = null;
    if (bytes instanceof Uint8Array && bytes.length) {
      try {
        const d = decodeWav(bytes);
        this.setSource(makeSource(d.sampleRate, d.channels), { find: false, record: false });
        return;
      } catch (e) {
        this.problem = e.message;
      }
    }
    this.changed();
  }

  // -------------------------------------------------------------------------
  // UI

  build() {
    const { h, icon } = this.ui;
    const mod = isMac ? '⌘' : 'Ctrl+';

    this.btnUndo = h('button', { type: 'button', class: 'icon-btn small', title: `Undo (${mod}Z)`, 'aria-label': 'Undo', onclick: () => this.history.undo() }, undoIcon());
    this.btnRedo = h('button', { type: 'button', class: 'icon-btn small', title: `Redo (${mod}Shift+Z)`, 'aria-label': 'Redo', onclick: () => this.history.redo() }, undoIcon(true));
    this.btnRecordAgain = h('button', {
      type: 'button', class: 'btn small ghost wav-record-again', title: 'Record a new sound in place of this one',
      onclick: () => this.start(),
    }, micIcon(14), h('span', {}, 'Record again'));
    const toolbar = h('div', { class: 'snd-toolbar' },
      this.btnUndo, this.btnRedo, h('span', { class: 'snd-spacer' }), this.btnRecordAgain);

    this.message = h('div', { class: 'snd-banner wav-message', role: 'status', hidden: true });

    // Nothing to edit yet: the big Record button.
    this.btnRecord = h('button', { type: 'button', class: 'wav-record', title: 'Record with your microphone', onclick: () => this.start() },
      micIcon(28), h('span', {}, 'Record'));
    this.emptyText = h('p', { class: 'wav-empty-text' });
    this.empty = h('div', { class: 'wav-empty' }, this.btnRecord, this.emptyText,
      h('p', { class: 'wav-empty-note' }, `Up to ${MAX_RECORD_SECONDS} seconds. Saved as a mono WAV file at ${RECORD_RATE} Hz. You can also open any .wav file of the project here.`));

    // Recording: a stop button and a live waveform.
    this.btnStop = h('button', { type: 'button', class: 'wav-record recording', title: 'Stop recording (Space)', onclick: () => this.stopRecording() },
      icon('stop', 24), h('span', {}, 'Stop'));

    // Editing: the play button, the waveform with trim handles.
    this.btnPlay = h('button', { type: 'button', class: 'sfx-play', title: 'Play (Space)', 'aria-label': 'Play', onclick: () => this.togglePlay() },
      icon('play', 26), h('span', { class: 'sfx-play-label' }, 'Play'));
    this.canvas = h('canvas', { class: 'sfx-wave-canvas', 'aria-hidden': 'true' });
    this.info = h('div', { class: 'sfx-wave-info' });
    this.recTime = this.info;
    const handle = (which) => {
      const el = h('div', {
        class: `wav-handle wav-handle-${which}`, role: 'slider', tabindex: '0',
        'aria-label': which === 'start' ? 'Start of the sound' : 'End of the sound',
        title: `Drag to trim the ${which}. Arrow keys move it by 10 ms (Shift: 100 ms).`,
      });
      el.addEventListener('keydown', (e) => this.handleArrow(e, which));
      return el;
    };
    this.handleStart = handle('start');
    this.handleEnd = handle('end');
    this.waveBox = h('div', { class: 'sfx-wave wav-wave' }, this.canvas, this.handleStart, this.handleEnd, this.info);
    this.waveBox.addEventListener('pointerdown', (e) => this.waveDown(e));
    this.waveBox.addEventListener('pointermove', (e) => this.waveMove(e));
    this.waveBox.addEventListener('pointerup', (e) => this.waveUp(e));
    this.waveBox.addEventListener('pointercancel', () => { this.drag = null; });
    this.waveRow = h('div', { class: 'sfx-wave-row' }, this.btnPlay, this.btnStop, this.waveBox);

    // Trim, volume and speed.
    this.trimText = h('span', { class: 'snd-card-note' });
    this.btnFit = h('button', { type: 'button', class: 'btn small', title: 'Put the handles around the sound, without the quiet parts at the start and end', onclick: () => this.fitToSound() }, 'Fit to the sound');
    this.btnAll = h('button', { type: 'button', class: 'btn small ghost', title: 'Use all of the sound', onclick: () => this.setTrim(0, this.length) }, 'Use all');
    const trimCard = h('section', { class: 'snd-card wav-card' },
      h('h3', { class: 'snd-card-title' }, 'Trim', this.trimText),
      h('div', { class: 'wav-buttons' }, this.btnFit, this.btnAll),
      h('p', { class: 'wav-hint' }, 'Drag the handles on the waveform, or drag across it to pick a part.'));
    this.volume = this.slider(VOLUME);
    this.speed = this.slider(SPEED);
    this.btnNormalize = h('button', { type: 'button', class: 'btn small', title: 'Make the loudest part as loud as it can be without clipping', onclick: () => this.normalize() }, 'Normalize');
    this.clipNote = h('p', { class: 'wav-warning', hidden: true }, 'Too loud: some parts clip (they are cut off at full volume). Make the volume lower, or click Normalize.');
    const soundCard = h('section', { class: 'snd-card wav-card' },
      h('h3', { class: 'snd-card-title' }, 'Sound'),
      this.volume.element,
      h('div', { class: 'wav-buttons' }, this.btnNormalize),
      this.clipNote,
      this.speed.element);
    this.cards = h('div', { class: 'wav-cards' }, trimCard, soundCard);

    this.editorView = h('div', { class: 'wav-editor' }, this.waveRow, this.cards);
    const main = h('div', { class: 'sfx-main wav-main' }, this.empty, this.editorView);
    this.element = h('div', { class: 'snd-tool wav-tool', tabindex: '-1' }, toolbar, this.message, main);
    this.element.addEventListener('keydown', (e) => { if (this.handleKey(e)) { e.preventDefault(); e.stopPropagation(); } });

    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.waveBox);
  }

  slider(p) {
    const slider = createSlider(this.ui, p, {
      get: () => this.edit[p.key],
      set: (v, gesture) => {
        this.history.record(gesture ? `slider:${p.key}` : null);
        this.edit = { ...this.edit, [p.key]: v };
        this.changed();
      },
      end: () => this.history.settle(),
      reset: 1,
      escape: () => this.element.focus(),
    });
    return slider;
  }

  get length() { return this.source?.mono.length ?? 0; }
  get rate() { return this.source?.sampleRate ?? RECORD_RATE; }

  showMessage(text, type = 'info') {
    this.message.hidden = !text;
    this.message.textContent = text || '';
    this.message.classList.toggle('error', type === 'error');
  }

  /** Show what fits the state: the Record button, the recorder or the waveform and controls. */
  sync() {
    const recording = !!this.recorder;
    const has = !!this.source;
    this.empty.hidden = has || recording;
    this.editorView.hidden = !has && !recording;
    this.cards.hidden = recording || !has;
    this.btnPlay.hidden = recording;
    this.btnStop.hidden = !recording;
    this.handleStart.hidden = this.handleEnd.hidden = recording || !has;
    this.btnRecordAgain.hidden = !has || recording;
    this.btnUndo.disabled = recording || !this.history.canUndo;
    this.btnRedo.disabled = recording || !this.history.canRedo;
    this.waveBox.classList.toggle('recording', recording);
    const why = recordingProblem();
    this.btnRecord.disabled = !!why;
    this.btnRecordAgain.disabled = !!why;
    this.emptyText.textContent = this.problem
      ? `${this.problem} Record a new sound to put in its place.`
      : why || 'Record a sound with your microphone: a voice, a clap, a “bap” for a drum.';
    if (has) {
      const { start, end, speed } = this.edit;
      const out = Math.max(0, Math.round((end - start) / speed));
      const ch = this.source.channels.length;
      this.trimText.textContent = `${secondsText(start / this.rate)} to ${secondsText(end / this.rate)}`;
      this.info.textContent = `${secondsText(out / this.rate)} · ${this.rate} Hz · ${ch === 1 ? 'mono' : ch === 2 ? 'stereo' : `${ch} channels`} · ${this.ui.formatBytes(wavSize(out, ch))}`;
      this.clipNote.hidden = peak(this.source.channels, start, end) * this.edit.volume <= 1;
      this.volume.sync();
      this.speed.sync();
      this.placeHandles();
    }
  }

  /** After any change to the source or the edits. */
  changed() {
    this.sync();
    this.draw();
    this.host.setDirty(this.key() !== this.savedKey);
  }

  // -------------------------------------------------------------------------
  // Recording

  /** Start recording (the workspace calls it for "Record a sound"). */
  async start() {
    if (this.recorder) return;
    const why = recordingProblem();
    if (why) {
      this.showMessage(why, 'error');
      this.sync();
      return;
    }
    this.stopPlayback();
    this.showMessage('');
    const recorder = new Recorder({
      onLimit: () => this.stopRecording(`Recording stopped at ${MAX_RECORD_SECONDS} seconds, the longest a recording can be.`),
    });
    this.recorder = recorder;
    this.levels = [];
    this.sync();
    this.recTime.textContent = 'Waiting for the microphone…';
    try {
      await recorder.start();
    } catch (e) {
      if (this.recorder === recorder) this.recorder = null;
      recorder.cancel();
      this.showMessage(microphoneMessage(e), 'error');
      this.sync();
      this.draw();
      return;
    }
    if (this.recorder !== recorder) {
      recorder.cancel();
      return;
    }
    this.element.focus({ preventScroll: true });
    const tick = () => {
      if (this.recorder !== recorder || this.destroyed) return;
      this.levels.push(recorder.level());
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  async stopRecording(note = '') {
    const recorder = this.recorder;
    if (!recorder?.recording) return;
    cancelAnimationFrame(this.raf);
    this.recTime.textContent = 'Reading the recording…';
    let clip;
    try {
      clip = await recorder.stop();
    } catch (e) {
      this.recorder = null;
      this.showMessage(e.message || String(e), 'error');
      this.sync();
      this.draw();
      return;
    }
    this.recorder = null;
    if (this.destroyed) return;
    this.showMessage(note);
    this.setSource(makeSource(clip.sampleRate, clip.channels), { find: true, record: true });
    this.element.focus({ preventScroll: true });
  }

  /** Use a new sound (a recording); find: put the handles around the sound in it. */
  setSource(source, { find = false, record = true } = {}) {
    if (record) this.history.record();
    this.source = source;
    this.problem = '';
    const all = { start: 0, end: source.mono.length };
    const range = find ? findSound(source.mono, source.sampleRate) : all;
    this.edit = { ...range, volume: 1, speed: 1 };
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Editing

  setTrim(start, end, { record = true, key = null } = {}) {
    const n = this.length;
    const min = Math.min(n, Math.max(1, Math.round(0.005 * this.rate))); // at least 5 ms
    let a = Math.max(0, Math.min(n, Math.round(start)));
    let b = Math.max(0, Math.min(n, Math.round(end)));
    if (b - a < min) {
      if (a + min <= n) b = a + min;
      else a = b - min;
    }
    if (a === this.edit.start && b === this.edit.end) return;
    if (record) this.history.record(key);
    this.edit = { ...this.edit, start: a, end: b };
    this.changed();
  }

  fitToSound() {
    if (!this.source) return;
    const r = findSound(this.source.mono, this.rate);
    this.setTrim(r.start, r.end);
  }

  normalize() {
    if (!this.source) return;
    const v = Math.min(VOLUME.max, Math.floor(normalizeVolume(peak(this.source.channels, this.edit.start, this.edit.end)) * 100) / 100);
    if (v === this.edit.volume) return;
    this.history.record();
    this.edit = { ...this.edit, volume: v };
    this.changed();
  }

  handleArrow(e, which) {
    if (!this.source || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    e.stopPropagation();
    const d = (e.key === 'ArrowLeft' ? -1 : 1) * NUDGE * (e.shiftKey ? 10 : 1) * this.rate;
    if (which === 'start') this.setTrim(this.edit.start + d, this.edit.end, { key: 'nudge:start' });
    else this.setTrim(this.edit.start, this.edit.end + d, { key: 'nudge:end' });
  }

  /** The source sample under a client x position. */
  sampleAt(clientX) {
    const r = this.waveBox.getBoundingClientRect();
    return ((clientX - r.left) / Math.max(1, r.width)) * this.length;
  }

  xOf(sample) {
    return (sample / Math.max(1, this.length)) * this.waveBox.clientWidth;
  }

  waveDown(e) {
    if (!this.source || this.recorder || e.button !== 0) return;
    const r = this.waveBox.getBoundingClientRect();
    const x = e.clientX - r.left;
    const ds = Math.abs(x - this.xOf(this.edit.start));
    const de = Math.abs(x - this.xOf(this.edit.end));
    let mode = 'click';
    if (Math.min(ds, de) <= HANDLE_HIT) mode = ds <= de ? 'start' : 'end';
    this.drag = { mode, x0: e.clientX, from: this.sampleAt(e.clientX), recorded: false };
    this.waveBox.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.element.focus({ preventScroll: true });
  }

  waveMove(e) {
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'click' && Math.abs(e.clientX - d.x0) > 4) d.mode = 'select';
    if (d.mode === 'click') return;
    if (!d.recorded) {
      this.history.record();
      d.recorded = true;
    }
    const at = this.sampleAt(e.clientX);
    if (d.mode === 'start') this.setTrim(Math.min(at, this.edit.end - 1), this.edit.end, { record: false });
    else if (d.mode === 'end') this.setTrim(this.edit.start, Math.max(at, this.edit.start + 1), { record: false });
    else this.setTrim(Math.min(d.from, at), Math.max(d.from, at), { record: false });
  }

  waveUp() {
    const d = this.drag;
    this.drag = null;
    if (d?.mode === 'click') this.togglePlay();
  }

  placeHandles() {
    const w = this.waveBox.clientWidth;
    if (!w || !this.source) return;
    this.handleStart.style.left = `${this.xOf(this.edit.start)}px`;
    this.handleEnd.style.left = `${this.xOf(this.edit.end)}px`;
    for (const [el, v] of [[this.handleStart, this.edit.start], [this.handleEnd, this.edit.end]]) {
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(Math.round((this.length / this.rate) * 1000) / 1000));
      el.setAttribute('aria-valuenow', String(Math.round((v / this.rate) * 1000) / 1000));
      el.setAttribute('aria-valuetext', secondsText(v / this.rate));
    }
  }

  // -------------------------------------------------------------------------
  // Playing and drawing

  rendered() {
    return renderClip(this.source, this.edit);
  }

  togglePlay() {
    if (this.playing) this.stopPlayback();
    else this.play();
  }

  play() {
    if (!this.source || this.recorder) return;
    this.stopPlayback();
    const clip = this.rendered();
    let handle;
    try {
      handle = playChannels(clip.channels, clip.sampleRate);
    } catch (e) {
      this.showMessage(`The sound could not play: ${e.message}`, 'error');
      return;
    }
    const run = { handle, started: performance.now(), duration: (clip.channels[0].length / clip.sampleRate) * 1000 };
    this.playing = run;
    const tick = () => {
      if (this.playing !== run || this.destroyed) return;
      if (performance.now() - run.started >= run.duration) {
        this.playing = null;
        this.draw();
        return;
      }
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  stopPlayback() {
    if (!this.playing) return;
    this.playing.handle.stop();
    this.playing = null;
    cancelAnimationFrame(this.raf);
    this.draw();
  }

  draw() {
    if (!this.canvas || this.element?.hidden || this.editorView.hidden) return;
    const w = this.waveBox.clientWidth;
    const hgt = this.waveBox.clientHeight;
    if (!w || !hgt) return;
    const ctx = fitCanvas(this.canvas, w, hgt);
    const el = this.element;
    ctx.clearRect(0, 0, w, hgt);
    const mid = hgt / 2;
    const amp = mid - 6;
    ctx.fillStyle = cssVar(el, '--border');
    ctx.fillRect(0, Math.round(mid), w, 1);
    const accent = cssVar(el, '--accent');

    if (this.recorder) {
      // Live: the level of each frame, newest at the right, over the longest time.
      const seconds = this.recorder.seconds();
      this.recTime.textContent = `${seconds.toFixed(1)} s of ${MAX_RECORD_SECONDS} s`;
      this.info.textContent = this.recTime.textContent;
      ctx.fillStyle = cssVar(el, '--danger', '#e5484d');
      const n = this.levels.length;
      const span = Math.max(1, (seconds / MAX_RECORD_SECONDS) * w);
      for (let x = 0; x < span; x++) {
        const a = this.levels[Math.min(n - 1, Math.floor((x / span) * n))] || 0;
        const hh = Math.max(1, a * amp);
        ctx.fillRect(x, mid - hh, 1, hh * 2);
      }
      return;
    }

    const src = this.source;
    if (!src) return;
    const s = src.mono;
    const n = s.length;
    const seconds = n / src.sampleRate;
    // A faint line every 100 ms (every second for long sounds).
    ctx.fillStyle = cssVar(el, '--hover');
    const grid = seconds > 4 ? 1 : 0.1;
    for (let t = grid; t < seconds; t += grid) ctx.fillRect(Math.round((t / seconds) * w), 0, 1, hgt);

    const { start, end, volume } = this.edit;
    const xa = this.xOf(start);
    const xb = this.xOf(end);
    const muted = cssVar(el, '--fg-subtle');
    const danger = cssVar(el, '--danger', '#e5484d');
    const per = n / w;
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x * per);
      const b = Math.min(n, Math.max(a + 1, Math.floor((x + 1) * per)));
      let lo = 0;
      let hi = 0;
      for (let i = a; i < b; i++) {
        const v = s[i] * volume;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const inside = x >= xa && x < xb;
      ctx.fillStyle = !inside ? muted : hi > 1 || lo < -1 ? danger : accent;
      lo = Math.max(-1, lo);
      hi = Math.min(1, hi);
      const y0 = mid - hi * amp;
      const y1 = mid - lo * amp;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    // The parts the trim cuts off, shaded.
    ctx.fillStyle = cssVar(el, '--editor-bg');
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, xa, hgt);
    ctx.fillRect(xb, 0, w - xb, hgt);
    ctx.globalAlpha = 1;

    if (this.playing) {
      const t = (performance.now() - this.playing.started) / 1000;
      const at = start + t * src.sampleRate * this.edit.speed;
      if (at <= end) {
        ctx.fillStyle = cssVar(el, '--fg');
        ctx.fillRect(Math.round(this.xOf(at)), 0, 2, hgt);
      }
    }
    this.placeHandles();
  }

  // -------------------------------------------------------------------------
  // Keys

  handleKey(e) {
    if (this.handled.has(e)) return false;
    this.handled.add(e);
    const typing = typingTarget(e);
    if (modHeld(e)) {
      const k = e.key.toLowerCase();
      if (typing || this.recorder) return false;
      if (k === 'z' && !e.shiftKey) { this.history.undo(); return true; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { this.history.redo(); return true; }
      return false;
    }
    if (typing || e.altKey) return false;
    if (e.key === ' ') {
      if (!e.repeat) {
        if (this.recorder) this.stopRecording();
        else if (this.source) this.togglePlay();
        else this.start();
      }
      return true;
    }
    if (e.key === 'Escape' && this.playing) { this.stopPlayback(); return true; }
    return false;
  }

  // -------------------------------------------------------------------------
  // Tool interface

  async save() {
    if (!this.source) return;
    const clip = this.rendered();
    const key = this.key();
    await this.host.write(this.host.path, encodeWav(clip.channels, clip.sampleRate));
    this.savedKey = key;
    this.host.setDirty(this.key() !== this.savedKey);
  }

  focus() {
    if (!this.element.contains(document.activeElement)) this.element.focus({ preventScroll: true });
  }

  show() {
    requestAnimationFrame(() => { this.sync(); this.draw(); });
  }

  hide() {
    this.stopPlayback();
  }

  reload(path) {
    if (path !== this.host.path || this.recorder || this.key() !== this.savedKey) return;
    this.history.clear();
    this.load();
    this.savedKey = this.key();
    this.host.setDirty(false);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.recorder?.cancel();
    this.recorder = null;
    this.stopPlayback();
    this.resizeObserver.disconnect();
    this.unwatchTheme();
  }
}

export default {
  id: 'wav',
  label: 'Sound file editor',
  match: (path) => /\.wav$/i.test(path),
  newAssets: [{
    label: 'Recording',
    folder: 'sounds',
    extension: '.wav',
    files: (base) => ({ [`${base}.wav`]: new Uint8Array(0) }),
  }],
  open(host) {
    return new WavEditor(host);
  },
};
