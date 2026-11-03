// The .song model (docs/reference.md, "Songs"): defaults, normalizing
// decoded JSON (keeping fields the editor doesn't know), the default song and
// the file's text.

import { WAVES, formatLowpass } from '../sfx/params.js';

export const SONG_FORMAT = 'smitten.song';
export const SONG_VERSION = 1;

export const LIMITS = {
  bpm: [20, 400],
  stepsPerBeat: [1, 16],
  patternLength: [1, 256],
};

export const SYNTH_DEFAULTS = Object.freeze({
  wave: 'square', volume: 0.5,
  attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.1,
  duty: 0.5, vibratoDepth: 0, vibratoSpeed: 5, lowpass: 1,
});

/** Synth instrument sliders (same shape as the sound effect PARAMS). */
const trim = (n, d) => Number(n.toFixed(d)).toString();
const secs = (v) => (v === 0 ? '0 s' : v < 1 ? `${trim(v * 1000, 0)} ms` : `${trim(v, 2)} s`);
const pct = (v) => `${trim(v * 100, 0)}%`;
export const SYNTH_PARAMS = [
  { key: 'volume', label: 'Volume', min: 0, max: 1, unit: '%', digits: 2, format: pct, help: 'Instrument level' },
  { key: 'attack', label: 'Attack', min: 0, max: 2, curve: 'sq+', unit: 's', digits: 3, format: secs, help: 'Time to rise to full level' },
  { key: 'decay', label: 'Decay', min: 0, max: 2, curve: 'sq+', unit: 's', digits: 3, format: secs, help: 'Time to fall to the sustain level' },
  { key: 'sustain', label: 'Sustain', min: 0, max: 1, unit: '%', digits: 2, format: pct, help: 'Level held while the note lasts' },
  { key: 'release', label: 'Release', min: 0, max: 3, curve: 'sq+', unit: 's', digits: 3, format: secs, help: 'Time to fade out after the note ends' },
  { key: 'duty', label: 'Duty', min: 0, max: 1, unit: '%', digits: 2, format: pct, help: 'Square-wave pulse width' },
  { key: 'vibratoDepth', label: 'Vibrato depth', min: 0, max: 4, curve: 'sq+', unit: 'st', digits: 2, off: 0,
    format: (v) => (v === 0 ? 'off' : `${trim(v, 2)} st`), help: 'Vibrato amount, in semitones' },
  { key: 'vibratoSpeed', label: 'Vibrato speed', min: 0, max: 20, unit: 'Hz', digits: 1, format: (v) => `${trim(v, 1)} Hz`, help: 'Vibrato rate' },
  { key: 'lowpass', label: 'Low-pass', min: 0, max: 1, unit: '%', digits: 3, off: 1,
    format: formatLowpass, fromHz: (hz) => Math.log(hz / 100) / Math.log(200), help: 'Low-pass cutoff (100 Hz to 20 kHz); lower is darker' },
];

const SONG_KEYS = ['format', 'version', 'bpm', 'stepsPerBeat', 'patternLength', 'loop', 'loopStart', 'channels', 'instruments', 'patterns', 'order'];
const CHANNEL_KEYS = ['name', 'instrument', 'volume'];
const SYNTH_KEYS = ['name', 'type', ...Object.keys(SYNTH_DEFAULTS)];
const SFX_INSTRUMENT_KEYS = ['name', 'type', 'sfx', 'pitched', 'volume'];
const PATTERN_KEYS = ['name', 'notes'];
const NOTE_KEYS = ['channel', 'step', 'length', 'note', 'volume'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function num(v, fallback, lo = -Infinity, hi = Infinity) {
  const n = Number(v);
  return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}
function int(v, fallback, lo = -Infinity, hi = Infinity) {
  return Math.round(num(v, fallback, lo, hi));
}

/** Known keys first (in the reference's order), then the rest as they were. */
function ordered(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  for (const [k, v] of Object.entries(obj)) if (!(k in out)) out[k] = v;
  return out;
}

export function normalizeInstrument(src, i = 0) {
  const ins = isObj(src) ? { ...src } : {};
  ins.name = typeof ins.name === 'string' ? ins.name : `Instrument ${i + 1}`;
  if (ins.type === 'sfx') {
    ins.sfx = typeof ins.sfx === 'string' ? ins.sfx : '';
    ins.pitched = !!ins.pitched;
    // volume is optional for sound effect instruments (default 1).
    if (ins.volume !== undefined) ins.volume = num(ins.volume, 1, 0, 1);
    return ordered(ins, SFX_INSTRUMENT_KEYS);
  }
  ins.type = 'synth';
  ins.wave = WAVES.includes(ins.wave) ? ins.wave : SYNTH_DEFAULTS.wave;
  for (const p of SYNTH_PARAMS) ins[p.key] = num(ins[p.key], SYNTH_DEFAULTS[p.key], p.min, p.max);
  return ordered(ins, SYNTH_KEYS);
}

export function normalizeNote(src) {
  const n = isObj(src) ? { ...src } : {};
  n.channel = int(n.channel, 0, 0, 63);
  // Steps and lengths may be fractional; the editor's grid makes whole ones.
  n.step = num(n.step, 0, 0, 100000);
  n.length = num(n.length, 1, 1 / 64, 100000);
  n.note = int(n.note, 60, 0, 127);
  n.volume = num(n.volume, 1, 0, 1);
  return ordered(n, NOTE_KEYS);
}

/** A decoded .song with defaults applied (unknown fields kept). */
export function normalizeSong(data) {
  const s = isObj(data) ? { ...data } : {};
  s.format = SONG_FORMAT;
  s.version = Number.isInteger(s.version) ? s.version : SONG_VERSION;
  s.bpm = num(s.bpm, 120, ...LIMITS.bpm);
  s.stepsPerBeat = int(s.stepsPerBeat, 4, ...LIMITS.stepsPerBeat);
  s.patternLength = int(s.patternLength, 32, ...LIMITS.patternLength);
  s.loop = s.loop === undefined ? true : !!s.loop;
  s.instruments = (Array.isArray(s.instruments) ? s.instruments : []).map(normalizeInstrument);
  if (!s.instruments.length) s.instruments.push(normalizeInstrument({ name: 'Square lead' }));
  s.channels = (Array.isArray(s.channels) ? s.channels : []).map((c, i) => {
    const ch = isObj(c) ? { ...c } : {};
    ch.name = typeof ch.name === 'string' ? ch.name : `Channel ${i + 1}`;
    ch.instrument = int(ch.instrument, Math.min(i, s.instruments.length - 1), 0, s.instruments.length - 1);
    ch.volume = num(ch.volume, 1, 0, 1);
    return ordered(ch, CHANNEL_KEYS);
  });
  if (!s.channels.length) s.channels.push({ name: 'Channel 1', instrument: 0, volume: 0.8 });
  s.patterns = (Array.isArray(s.patterns) ? s.patterns : []).map((p, i) => {
    const pat = isObj(p) ? { ...p } : {};
    pat.name = typeof pat.name === 'string' ? pat.name : `Pattern ${i + 1}`;
    pat.notes = (Array.isArray(pat.notes) ? pat.notes : []).map(normalizeNote);
    return ordered(pat, PATTERN_KEYS);
  });
  if (!s.patterns.length) s.patterns.push({ name: 'Pattern 1', notes: [] });
  s.order = (Array.isArray(s.order) ? s.order : [0]).map((v) => int(v, 0, 0, s.patterns.length - 1));
  if (!s.order.length) s.order.push(0);
  s.loopStart = int(s.loopStart, 0, 0, s.order.length - 1);
  return ordered(s, SONG_KEYS);
}

export function parseSong(text) {
  const data = typeof text === 'string' && text.trim() ? JSON.parse(text) : {};
  if (!isObj(data)) throw new Error('A song file must hold a JSON object.');
  return normalizeSong(data);
}

// ---------------------------------------------------------------------------
// Text: indented JSON, with each note and the order list on one line so
// files stay short and diff well.

function pretty(value, indent, inline) {
  if (inline || value === null || typeof value !== 'object') return JSON.stringify(value);
  const pad = '  '.repeat(indent + 1);
  const end = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((v) => v === null || typeof v !== 'object')) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[\n${value.map((v) => pad + pretty(v, indent + 1, false)).join(',\n')}\n${end}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => {
    const inlineChild = k === 'notes' && Array.isArray(v);
    const text = inlineChild
      ? (v.length ? `[\n${v.map((n) => `${pad}  ${noteLine(n)}`).join(',\n')}\n${pad}]` : '[]')
      : pretty(v, indent + 1, false);
    return `${pad}${JSON.stringify(k)}: ${text}`;
  }).join(',\n')}\n${end}}`;
}

function noteLine(n) {
  if (!isObj(n)) return JSON.stringify(n);
  const parts = Object.entries(n).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

export function songText(song) {
  return `${pretty(song, 0, false)}\n`;
}

// ---------------------------------------------------------------------------
// The default song: 4 channels and a short example so it plays right away.

export function defaultSong() {
  const notes = [];
  const add = (channel, step, length, note, volume = 1) => notes.push({ channel, step, length, note, volume });

  // Lead: C - Am - F - G, two bars.
  [[0, 2, 72], [2, 2, 76], [4, 2, 79], [6, 2, 76], [8, 3, 81], [11, 1, 79], [12, 4, 76],
    [16, 2, 77], [18, 2, 81], [20, 2, 84], [22, 2, 81], [24, 2, 83], [26, 2, 79], [28, 4, 74]]
    .forEach(([s, l, n]) => add(0, s, l, n, 0.9));
  // Bass: root, octave, root on each chord.
  [48, 45, 41, 43].forEach((root, i) => {
    const s = i * 8;
    add(1, s, 3, root);
    add(1, s + 4, 2, root + 12, 0.8);
    add(1, s + 6, 2, root, 0.8);
  });
  // Drums (noise): low kick, mid snare, high hats.
  for (let s = 0; s < 32; s += 8) add(2, s, 1, 36);
  add(2, 22, 1, 36, 0.7);
  for (let s = 4; s < 32; s += 8) add(2, s, 1, 60, 0.9);
  for (let s = 2; s < 32; s += 4) add(2, s, 1, 84, 0.4);
  // Pad: the chords.
  [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]].forEach((chord, i) => {
    for (const n of chord) add(3, i * 8, 8, n, 0.7);
  });
  notes.sort((a, b) => a.step - b.step || a.channel - b.channel || a.note - b.note);

  return normalizeSong({
    format: SONG_FORMAT,
    version: SONG_VERSION,
    bpm: 120,
    stepsPerBeat: 4,
    patternLength: 32,
    loop: true,
    loopStart: 0,
    channels: [
      { name: 'Lead', instrument: 0, volume: 0.8 },
      { name: 'Bass', instrument: 1, volume: 0.8 },
      { name: 'Drums', instrument: 2, volume: 0.8 },
      { name: 'Pad', instrument: 3, volume: 0.6 },
    ],
    instruments: [
      { name: 'Square lead', type: 'synth', wave: 'square', volume: 0.4, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.1, duty: 0.5, vibratoDepth: 0, vibratoSpeed: 5, lowpass: 1 },
      { name: 'Triangle bass', type: 'synth', wave: 'triangle', volume: 0.5, attack: 0.005, decay: 0.05, sustain: 0.8, release: 0.05, duty: 0.5, vibratoDepth: 0, vibratoSpeed: 5, lowpass: 1 },
      { name: 'Noise drums', type: 'synth', wave: 'noise', volume: 0.45, attack: 0, decay: 0.12, sustain: 0, release: 0.05, duty: 0.5, vibratoDepth: 0, vibratoSpeed: 5, lowpass: 1 },
      { name: 'Soft pad', type: 'synth', wave: 'sawtooth', volume: 0.3, attack: 0.25, decay: 0.3, sustain: 0.7, release: 0.6, duty: 0.5, vibratoDepth: 0.1, vibratoSpeed: 5, lowpass: 0.35 },
    ],
    patterns: [{ name: 'Intro', notes }],
    order: [0],
  });
}
