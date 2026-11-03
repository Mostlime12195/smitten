// Sound effect parameters (docs/reference.md, "Sound effects"): defaults,
// slider metadata, presets, mutation and the .sfx text. Shared with the
// music editor, whose instruments can play sound effects.

export const SFX_FORMAT = 'smitten.sfx';
export const SFX_VERSION = 1;

export const WAVES = ['square', 'sawtooth', 'triangle', 'sine', 'noise'];

/** The values missing fields take (the example in the reference). */
export const SFX_DEFAULTS = Object.freeze({
  wave: 'square',
  volume: 0.5,
  attack: 0.0,
  sustain: 0.08,
  punch: 0.3,
  decay: 0.25,
  frequency: 440,
  minFrequency: 30,
  slide: 1.5,
  deltaSlide: 0,
  vibratoDepth: 0,
  vibratoSpeed: 0,
  arpeggio: 0,
  arpeggioTime: 0,
  duty: 0.5,
  dutySweep: 0,
  repeat: 0,
  lowpass: 1,
  highpass: 0,
  bitcrush: 0,
});

/** Every field, in the order they're written. */
export const SFX_KEYS = Object.keys(SFX_DEFAULTS);

/** A neutral starting point for presets: one plain tone, no effects. */
const NEUTRAL = Object.freeze({
  ...SFX_DEFAULTS,
  punch: 0,
  slide: 0,
  minFrequency: 20,
  sustain: 0.1,
  decay: 0.2,
});

// ---------------------------------------------------------------------------
// Formatting

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 60 -> "C4" */
export function noteName(midi) {
  const n = Math.round(midi);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export function hzToMidi(hz) { return 69 + 12 * Math.log2(hz / 440); }

function trim(n, digits) {
  return Number(n.toFixed(digits)).toString();
}

const fmt = {
  seconds: (v) => (v === 0 ? '0 s' : v < 1 ? `${trim(v * 1000, 0)} ms` : `${trim(v, 2)} s`),
  percent: (v) => `${trim(v * 100, 0)}%`,
  hz: (v) => `${v >= 100 ? trim(v, 0) : trim(v, 1)} Hz`,
  cutoff: (hz) => (hz >= 1000 ? `${trim(hz / 1000, hz >= 10000 ? 0 : 1)} kHz` : `${trim(hz, 0)} Hz`),
};

// The synthesizer's filter cutoffs (Synth.cpp): exponential from 100 Hz to
// 20 kHz (low-pass) and 10 Hz to 5 kHz (high-pass).
export const lowpassHz = (v) => 100 * 200 ** v;
export const highpassHz = (v) => 10 * 500 ** v;
export const formatLowpass = (v) => (v >= 1 ? 'off' : fmt.cutoff(lowpassHz(v)));
export const formatHighpass = (v) => (v <= 0 ? 'off' : fmt.cutoff(highpassHz(v)));

/**
 * Slider metadata. curve: 'lin', 'log' (frequencies) or 'sq' (signed,
 * finer near zero). off: the value meaning "off", shown as such.
 */
export const PARAMS = [
  { key: 'frequency', group: 'oscillator', label: 'Frequency', min: 20, max: 8000, curve: 'log', unit: 'Hz', digits: 1,
    format: (v) => `${fmt.hz(v)} · ${noteName(hzToMidi(v))}`, help: 'Start pitch' },
  { key: 'volume', group: 'oscillator', label: 'Volume', min: 0, max: 1, unit: '%', digits: 2, format: fmt.percent, help: 'Output level' },

  { key: 'attack', group: 'envelope', label: 'Attack', min: 0, max: 2, curve: 'sq+', unit: 's', digits: 3, format: fmt.seconds, help: 'Time to rise to full level' },
  { key: 'sustain', group: 'envelope', label: 'Sustain', min: 0, max: 2, curve: 'sq+', unit: 's', digits: 3, format: fmt.seconds, help: 'Time held at full level' },
  { key: 'punch', group: 'envelope', label: 'Punch', min: 0, max: 1, unit: '%', digits: 2, format: fmt.percent, help: 'Extra level at the start of the sustain' },
  { key: 'decay', group: 'envelope', label: 'Decay', min: 0, max: 3, curve: 'sq+', unit: 's', digits: 3, format: fmt.seconds, help: 'Time to fade out' },

  { key: 'slide', group: 'pitch', label: 'Slide', min: -24, max: 24, curve: 'sq', unit: 'oct/s', digits: 2,
    format: (v) => `${v > 0 ? '+' : ''}${trim(v, 2)} oct/s`, help: 'Pitch change; negative falls' },
  { key: 'deltaSlide', group: 'pitch', label: 'Slide change', min: -48, max: 48, curve: 'sq', unit: 'oct/s²', digits: 2,
    format: (v) => `${v > 0 ? '+' : ''}${trim(v, 2)} oct/s²`, help: 'How fast the slide itself changes' },
  { key: 'minFrequency', group: 'pitch', label: 'Cutoff pitch', min: 20, max: 8000, curve: 'log', unit: 'Hz', digits: 1,
    format: (v) => (v <= 20 ? 'off' : fmt.hz(v)), help: 'The sound stops when a falling slide reaches this pitch' },
  { key: 'repeat', group: 'pitch', label: 'Repeat', min: 0, max: 2, curve: 'sq+', unit: 's', digits: 3, off: 0,
    format: (v) => (v === 0 ? 'off' : `every ${fmt.seconds(v)}`), help: 'Restart the pitch effects every so often' },

  { key: 'vibratoDepth', group: 'vibrato', label: 'Vibrato depth', min: 0, max: 12, curve: 'sq+', unit: 'st', digits: 2, off: 0,
    format: (v) => (v === 0 ? 'off' : `${trim(v, 2)} st`), help: 'Vibrato amount, in semitones' },
  { key: 'vibratoSpeed', group: 'vibrato', label: 'Vibrato speed', min: 0, max: 40, curve: 'sq+', unit: 'Hz', digits: 2, format: (v) => `${trim(v, 1)} Hz`, help: 'Vibrato rate' },
  { key: 'arpeggio', group: 'vibrato', label: 'Arpeggio', min: -24, max: 24, unit: 'st', digits: 0, step: 1,
    format: (v) => `${v > 0 ? '+' : ''}${trim(v, 0)} st`, help: 'Pitch jump, in semitones' },
  { key: 'arpeggioTime', group: 'vibrato', label: 'Arpeggio time', min: 0, max: 2, curve: 'sq+', unit: 's', digits: 3, off: 0,
    format: (v) => (v === 0 ? 'off' : `at ${fmt.seconds(v)}`), help: 'When the jump happens' },

  { key: 'duty', group: 'duty', label: 'Duty', min: 0, max: 1, unit: '%', digits: 2, format: fmt.percent, help: 'Square-wave pulse width' },
  { key: 'dutySweep', group: 'duty', label: 'Duty sweep', min: -2, max: 2, curve: 'sq', unit: '/s', digits: 3,
    format: (v) => `${v > 0 ? '+' : ''}${trim(v * 100, 1)}%/s`, help: 'Change of duty per second' },

  { key: 'lowpass', group: 'filters', label: 'Low-pass', min: 0, max: 1, unit: '%', digits: 3, off: 1,
    format: formatLowpass, fromHz: (hz) => Math.log(hz / 100) / Math.log(200), help: 'Low-pass cutoff (100 Hz to 20 kHz); lower is darker' },
  { key: 'highpass', group: 'filters', label: 'High-pass', min: 0, max: 1, unit: '%', digits: 3, off: 0,
    format: formatHighpass, fromHz: (hz) => Math.log(hz / 10) / Math.log(500), help: 'High-pass cutoff (10 Hz to 5 kHz); higher is thinner' },

  { key: 'bitcrush', group: 'effects', label: 'Bitcrush', min: 0, max: 1, unit: '%', digits: 3, off: 0,
    format: (v) => (v <= 0 ? 'off' : fmt.percent(v)), help: 'Sample-rate and bit-depth reduction' },
];

export const PARAM = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

export const GROUPS = [
  { id: 'oscillator', label: 'Oscillator' },
  { id: 'envelope', label: 'Envelope' },
  { id: 'pitch', label: 'Pitch' },
  { id: 'vibrato', label: 'Vibrato and arpeggio' },
  { id: 'duty', label: 'Duty' },
  { id: 'filters', label: 'Filters' },
  { id: 'effects', label: 'Effects' },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Slider position (0..1) for a value. */
export function toPosition(p, v) {
  v = clamp(v, p.min, p.max);
  switch (p.curve) {
    case 'log': return Math.log(v / p.min) / Math.log(p.max / p.min);
    case 'sq+': return Math.sqrt((v - p.min) / (p.max - p.min));
    case 'sq': {
      const m = Math.max(-p.min, p.max);
      return 0.5 + 0.5 * Math.sign(v) * Math.sqrt(Math.abs(v) / m);
    }
    default: return (v - p.min) / (p.max - p.min);
  }
}

/** The value at a slider position (0..1), rounded to the parameter's precision. */
export function fromPosition(p, t) {
  t = clamp(t, 0, 1);
  let v;
  switch (p.curve) {
    case 'log': v = p.min * (p.max / p.min) ** t; break;
    case 'sq+': v = p.min + (p.max - p.min) * t * t; break;
    case 'sq': {
      const m = Math.max(-p.min, p.max);
      const s = (t - 0.5) * 2;
      v = Math.sign(s) * s * s * m;
      break;
    }
    default: v = p.min + (p.max - p.min) * t;
  }
  return roundParam(p, v);
}

export function roundParam(p, v) {
  if (p.step) v = Math.round(v / p.step) * p.step;
  const f = 10 ** (p.digits ?? 3);
  v = Math.round(v * f) / f;
  return clamp(Object.is(v, -0) ? 0 : v, p.min, p.max);
}

// ---------------------------------------------------------------------------
// Files

/** Known fields of decoded JSON, with defaults and range limits applied. */
export function normalizeSfx(data) {
  const out = {};
  const src = data && typeof data === 'object' ? data : {};
  out.wave = WAVES.includes(src.wave) ? src.wave : SFX_DEFAULTS.wave;
  for (const p of PARAMS) {
    const v = Number(src[p.key]);
    out[p.key] = Number.isFinite(v) && src[p.key] !== null && src[p.key] !== '' ? clamp(v, p.min, p.max) : SFX_DEFAULTS[p.key];
  }
  return orderSfx(out);
}

function orderSfx(params) {
  const out = {};
  for (const k of SFX_KEYS) out[k] = params[k];
  return out;
}

/** Fields of the file the tool doesn't know about (kept on save). */
export function extraFields(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const [k, v] of Object.entries(data)) {
    if (k !== 'format' && k !== 'version' && !(k in SFX_DEFAULTS)) out[k] = v;
  }
  return out;
}

/** Parse .sfx text: {params, extra}. Throws on invalid JSON. */
export function parseSfx(text) {
  const data = typeof text === 'string' && text.trim() ? JSON.parse(text) : {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('A sound effect file must hold a JSON object.');
  return { params: normalizeSfx(data), extra: extraFields(data), version: data.version };
}

export function sfxText(params, extra = {}, version = SFX_VERSION) {
  const obj = { format: SFX_FORMAT, version: Number.isInteger(version) ? version : SFX_VERSION, ...orderSfx(params), ...extra };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/** Length in seconds before any slide cutoff. */
export function sfxDuration(params) {
  return Math.max(0, params.attack) + Math.max(0, params.sustain) + Math.max(0, params.decay);
}

// ---------------------------------------------------------------------------
// Presets (in the style of sfxr, in physical units)

/** A seeded random number generator (mulberry32), for repeatable presets. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tools(rand) {
  return {
    range: (lo, hi) => lo + (hi - lo) * rand(),
    chance: (p) => rand() < p,
    pick: (list) => list[Math.floor(rand() * list.length)],
  };
}

function finish(params) {
  const out = {};
  out.wave = params.wave;
  for (const p of PARAMS) out[p.key] = roundParam(p, params[p.key]);
  return orderSfx(out);
}

export const PRESETS = [
  {
    id: 'pickup', label: 'Pickup / coin',
    make(rand) {
      const r = tools(rand);
      const p = { ...NEUTRAL, wave: r.pick(['square', 'square', 'sawtooth']), duty: r.range(0.3, 0.5) };
      p.frequency = r.range(700, 1500);
      p.sustain = r.range(0.02, 0.09);
      p.punch = r.range(0.3, 0.6);
      p.decay = r.range(0.12, 0.35);
      if (r.chance(0.6)) {
        p.arpeggio = r.pick([4, 5, 7, 12]);
        p.arpeggioTime = r.range(0.04, 0.09);
      }
      return finish(p);
    },
  },
  {
    id: 'laser', label: 'Laser / shoot',
    make(rand) {
      const r = tools(rand);
      const p = { ...NEUTRAL, wave: r.pick(['square', 'sawtooth', 'sine']) };
      p.frequency = r.range(600, 2400);
      p.minFrequency = r.range(40, Math.min(300, p.frequency / 4));
      p.slide = -r.range(6, 20);
      if (r.chance(0.3)) p.deltaSlide = r.range(0, 20);
      p.duty = r.range(0.15, 0.5);
      p.dutySweep = r.range(-0.5, 0.5);
      p.sustain = r.range(0.04, 0.16);
      p.decay = r.range(0.06, 0.25);
      p.punch = r.chance(0.5) ? r.range(0, 0.3) : 0;
      if (r.chance(0.3)) p.highpass = r.range(0.3, 0.5);
      return finish(p);
    },
  },
  {
    id: 'explosion', label: 'Explosion',
    make(rand) {
      const r = tools(rand);
      const p = { ...NEUTRAL, wave: 'noise' };
      p.frequency = r.range(60, 500);
      p.slide = r.chance(0.7) ? -r.range(0.3, 2) : r.range(0, 1);
      p.sustain = r.range(0.08, 0.35);
      p.decay = r.range(0.3, 0.9);
      p.punch = r.range(0.2, 0.7);
      if (r.chance(0.3)) p.repeat = r.range(0.12, 0.4);
      if (r.chance(0.3)) { p.vibratoDepth = r.range(0.5, 4); p.vibratoSpeed = r.range(4, 18); }
      if (r.chance(0.3)) p.bitcrush = r.range(0.1, 0.5);
      if (r.chance(0.4)) p.lowpass = r.range(0.4, 0.9);
      return finish(p);
    },
  },
  {
    id: 'powerup', label: 'Power-up',
    make(rand) {
      const r = tools(rand);
      const p = { ...NEUTRAL, wave: r.pick(['square', 'sawtooth']), duty: r.range(0.2, 0.5) };
      p.frequency = r.range(180, 600);
      p.slide = r.range(1.5, 6);
      if (r.chance(0.5)) { p.vibratoDepth = r.range(0.5, 2.5); p.vibratoSpeed = r.range(8, 20); }
      if (r.chance(0.5)) p.repeat = r.range(0.08, 0.2);
      p.sustain = r.range(0.12, 0.35);
      p.decay = r.range(0.15, 0.45);
      return finish(p);
    },
  },
  {
    id: 'hit', label: 'Hit / hurt',
    make(rand) {
      const r = tools(rand);
      const p = { ...NEUTRAL, wave: r.pick(['square', 'sawtooth', 'noise']), duty: r.range(0.2, 0.5) };
      p.frequency = r.range(150, 900);
      p.slide = -r.range(4, 14);
      p.sustain = r.range(0.01, 0.06);
      p.decay = r.range(0.06, 0.22);
      p.punch = r.range(0, 0.4);
      if (r.chance(0.5)) p.highpass = r.range(0.3, 0.55);
      return finish(p);
    },
  },
  {
    id: 'jump', label: 'Jump',
    make(rand) {
      const r = tools(rand);
      const p = { ...NEUTRAL, wave: 'square', duty: r.range(0.2, 0.6) };
      p.frequency = r.range(220, 560);
      p.slide = r.range(2, 6);
      p.sustain = r.range(0.05, 0.15);
      p.decay = r.range(0.08, 0.25);
      if (r.chance(0.5)) p.highpass = r.range(0.3, 0.5);
      if (r.chance(0.5)) p.lowpass = r.range(0.6, 1);
      return finish(p);
    },
  },
  {
    id: 'blip', label: 'Blip / select',
    make(rand) {
      const r = tools(rand);
      const p = { ...NEUTRAL, wave: r.pick(['square', 'square', 'sine']), duty: r.range(0.2, 0.5) };
      p.frequency = r.range(400, 1600);
      p.sustain = r.range(0.02, 0.07);
      p.decay = r.range(0.02, 0.1);
      if (r.chance(0.3)) p.highpass = 0.4;
      return finish(p);
    },
  },
  {
    id: 'random', label: 'Random',
    make(rand) {
      const r = tools(rand);
      const p = { ...NEUTRAL, wave: r.pick(WAVES) };
      p.frequency = 20 * (400 ** r.range(0.15, 0.85)); // log-uniform, about 50-3000 Hz
      p.slide = r.chance(0.6) ? r.range(-8, 8) : 0;
      p.deltaSlide = r.chance(0.25) ? r.range(-10, 10) : 0;
      p.minFrequency = p.slide < 0 && r.chance(0.5) ? r.range(20, p.frequency / 2) : 20;
      p.attack = r.chance(0.7) ? 0 : r.range(0, 0.2);
      p.sustain = r.range(0.03, 0.4);
      p.punch = r.chance(0.5) ? r.range(0, 0.7) : 0;
      p.decay = r.range(0.05, 0.6);
      if (r.chance(0.3)) { p.vibratoDepth = r.range(0.2, 4); p.vibratoSpeed = r.range(2, 25); }
      if (r.chance(0.3)) { p.arpeggio = Math.round(r.range(-12, 12)); p.arpeggioTime = r.range(0.03, 0.25); }
      p.duty = r.range(0.1, 0.9);
      p.dutySweep = r.chance(0.3) ? r.range(-1, 1) : 0;
      p.repeat = r.chance(0.2) ? r.range(0.05, 0.4) : 0;
      p.lowpass = r.chance(0.3) ? r.range(0.35, 1) : 1;
      p.highpass = r.chance(0.2) ? r.range(0.2, 0.6) : 0;
      p.bitcrush = r.chance(0.15) ? r.range(0, 0.6) : 0;
      return finish(p);
    },
  },
];

export const PRESET = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

/** Nudge most parameters a little (in slider space), keeping the wave. */
export function mutate(params, rand = Math.random, amount = 0.06) {
  const out = { ...params };
  for (const p of PARAMS) {
    if (p.key === 'volume' || rand() < 0.5) continue;
    // Leave effects that are off alone most of the time, so mutating doesn't
    // turn on everything at once.
    if (p.off !== undefined && params[p.key] === p.off && rand() < 0.8) continue;
    const t = toPosition(p, params[p.key]) + (rand() * 2 - 1) * amount;
    out[p.key] = fromPosition(p, t);
  }
  return out;
}

/** The params a new sound effect file starts with (a repeatable pickup sound). */
export function newSfxParams() {
  return PRESET.pickup.make(seededRandom(7));
}
