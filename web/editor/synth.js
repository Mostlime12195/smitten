// The synthesizer for the editor's sound previews (docs/reference.md,
// "Synthesizer in the editor"). synth.mjs is the engine's own synthesizer
// (love/src/modules/smitten/Synth.cpp) built on its own, so a sound renders
// to exactly the same samples here as in the game.
//
// Sound effects and songs are passed to it as flat arrays of doubles; the
// layout is described in love/src/modules/smitten/web/synth_web.cpp. Missing
// or invalid fields are sent as NaN and take the documented defaults in C++.

import createSynth from './synth.mjs';

const SAMPLE_RATE = 44100;

// Same order as Synth.h's Wave, SFX_FIELDS and INSTRUMENT_FIELDS.
const WAVES = ['square', 'sawtooth', 'triangle', 'sine', 'noise'];
const SFX_FIELDS = [
  'volume', 'attack', 'sustain', 'punch', 'decay', 'frequency', 'minFrequency',
  'slide', 'deltaSlide', 'vibratoDepth', 'vibratoSpeed', 'arpeggio',
  'arpeggioTime', 'duty', 'dutySweep', 'repeat', 'lowpass', 'highpass', 'bitcrush',
];
const INSTRUMENT_FIELDS = [
  'volume', 'attack', 'decay', 'sustain', 'release', 'duty', 'vibratoDepth',
  'vibratoSpeed', 'lowpass',
];

// The engine reads only numbers and booleans from its Lua tables; anything
// else counts as missing there too.
const num = (v) => (typeof v === 'number' ? v : NaN);
const bool = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : NaN);
const wave = (v) => {
  const i = WAVES.indexOf(v);
  return i >= 0 ? i : NaN;
};
const obj = (v) => (v !== null && typeof v === 'object' ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);

function encodeSfx(out, params) {
  const p = obj(params);
  out.push(wave(p.wave));
  for (const f of SFX_FIELDS) out.push(num(p[f]));
}

function encodeSong(song, readSfx) {
  const s = obj(song);
  const channels = list(s.channels).map(obj);
  const instruments = list(s.instruments).map(obj);
  const patterns = list(s.patterns).map(obj);
  const order = list(s.order);
  const out = [
    num(s.bpm), num(s.stepsPerBeat), num(s.patternLength), bool(s.loop), num(s.loopStart),
    channels.length, instruments.length, patterns.length, order.length,
  ];
  for (const c of channels) out.push(num(c.instrument), num(c.volume));
  for (const inst of instruments) {
    const isSfx = inst.type === 'sfx';
    out.push(isSfx ? 1 : 0, wave(inst.wave));
    for (const f of INSTRUMENT_FIELDS) out.push(num(inst[f]));
    let params;
    if (isSfx) {
      params = typeof inst.sfx === 'string' ? readSfx?.(inst.sfx) : inst.sfx;
      if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch { params = undefined; }
      }
      if (params === null || typeof params !== 'object') params = undefined;
    }
    out.push(bool(inst.pitched), params ? 1 : 0);
    encodeSfx(out, params);
  }
  for (const pattern of patterns) {
    const notes = list(pattern.notes).map(obj);
    out.push(notes.length);
    for (const n of notes) out.push(num(n.channel), num(n.step), num(n.length), num(n.note), num(n.volume));
  }
  for (const o of order) out.push(num(o));
  return out;
}

// FNV-1a over the samples' float32 bytes, as Synth.cpp's checksum.
function checksum(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

let audioContext = null;

function play(samples) {
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();
  const buffer = audioContext.createBuffer(1, Math.max(samples.length, 1), SAMPLE_RATE);
  buffer.copyToChannel(samples, 0);
  const node = audioContext.createBufferSource();
  node.buffer = buffer;
  node.connect(audioContext.destination);
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

export async function loadSynth() {
  const m = await createSynth();

  if (m._synth_sfx_size() !== 1 + SFX_FIELDS.length
      || m._synth_instrument_size() !== 4 + INSTRUMENT_FIELDS.length + 1 + SFX_FIELDS.length) {
    throw new Error('synth.mjs doesn\'t match synth.js; rebuild with build.py');
  }

  // Runs render(ptr, count) on `values` copied into the module's memory and
  // returns the rendered samples.
  function call(values, render) {
    const ptr = m._malloc(Math.max(values.length, 1) * 8);
    try {
      new Float64Array(m.HEAPU8.buffer, ptr, values.length).set(values);
      const n = render(ptr, values.length);
      if (n < 0) throw new Error('synth: bad encoding');
      const at = m._synth_samples();
      return new Float32Array(m.HEAPU8.buffer, at, n).slice();
    } finally {
      m._free(ptr);
    }
  }

  return {
    sampleRate: SAMPLE_RATE,

    // params: a decoded .sfx.json. -> Float32Array, 44100 Hz mono.
    renderSfx(params) {
      const values = [];
      encodeSfx(values, params);
      return call(values, (ptr, n) => m._synth_render_sfx(ptr, n));
    },

    // song: a decoded .song.json; readSfx(path) returns the params of a
    // sound-effect instrument's file (path as written in the song), or
    // undefined (the instrument is then silent). -> Float32Array: one pass
    // through `order`, then whatever still rings.
    renderSong(song, readSfx) {
      const values = encodeSong(song, readSfx);
      return call(values, (ptr, n) => m._synth_render_song(ptr, n, 0));
    },

    // Plays samples through WebAudio. -> {stop()}
    play,

    // Not in the reference: FNV-1a of samples, the same number the engine's
    // native synth functions return, for checking both render alike.
    checksum,
  };
}
