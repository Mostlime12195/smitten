// WAV files and the edits the sound file editor makes to them: decoding and
// encoding, trimming, volume, normalizing, speed and finding where a
// recording's sound is. Plain functions on Float32Arrays (one per channel),
// with no DOM, so node tests them (wav.test.mjs).
//
// Integer samples become floats by dividing by 32768 (16-bit) or 128
// (8-bit, unsigned), the same as the engine does when a sample instrument
// reads a SoundData (love/src/modules/synth/wrap_Synth.cpp, readSample), so
// a song sounds the same in the editor and in the game.

/** Recordings are saved mono at this rate: clear speech and effects, half the size of 44100 Hz. */
export const RECORD_RATE = 22050;

/**
 * The longest recording, in seconds. 10 seconds of 16-bit mono at 22050 Hz
 * is 441 KB: under the 512 KB above which the engine streams a sound from
 * disk (assets.audio), so a recording plays from memory and can overlap
 * itself.
 */
export const MAX_RECORD_SECONDS = 10;

/** Normalize makes the loudest sample this level (a little under full scale). */
export const NORMALIZE_PEAK = 0.98;

/** Seconds of fade where a trim cuts into the sound, so it does not click. */
export const CUT_FADE = 0.004;

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

const ascii = (v, at) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

/**
 * Decode a WAV file. bytes: Uint8Array or ArrayBuffer.
 * -> {sampleRate, channels: Float32Array[] (-1 to 1), bits, float}
 * Throws an Error with a plain message for files it cannot read.
 */
export function decodeWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 12 || ascii(v, 0) !== 'RIFF' || ascii(v, 8) !== 'WAVE') {
    throw new Error('This is not a WAV file.');
  }
  let fmt = null;
  let data = null;
  for (let at = 12; at + 8 <= u8.length;) {
    const id = ascii(v, at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    // A file cut short (or written while streaming) can say more than it has.
    const len = Math.min(size, u8.length - body);
    if (id === 'fmt ' && len >= 16) {
      let format = v.getUint16(body, true);
      if (format === FORMAT_EXTENSIBLE && len >= 26) format = v.getUint16(body + 24, true);
      fmt = {
        format,
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        bits: v.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      data = { at: body, len };
    }
    at = body + size + (size & 1);
  }
  if (!fmt) throw new Error('The WAV file has no format chunk.');
  if (!data) throw new Error('The WAV file has no sound data.');
  const { format, channels: nch, sampleRate, bits } = fmt;
  const float = format === FORMAT_FLOAT;
  if (format !== FORMAT_PCM && !float) {
    throw new Error(`The WAV file uses a compressed format (code ${format}) that the editor cannot read. Save it as 16-bit PCM WAV.`);
  }
  if (!nch || !sampleRate) throw new Error('The WAV file says it has no channels or no sample rate.');
  const width = bits / 8;
  if (float ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) {
    throw new Error(`The WAV file has ${bits}-bit samples, which the editor cannot read.`);
  }
  const frames = Math.floor(data.len / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  let p = data.at;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      let s;
      if (float) s = bits === 32 ? v.getFloat32(p, true) : v.getFloat64(p, true);
      else if (bits === 8) s = (v.getUint8(p) - 128) / 128;
      else if (bits === 16) s = v.getInt16(p, true) / 32768;
      else if (bits === 24) s = ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16))) / 8388608;
      else s = v.getInt32(p, true) / 2147483648;
      channels[c][i] = s;
      p += width;
    }
  }
  return { sampleRate, channels, bits, float };
}

/** 16-bit PCM WAV bytes (Uint8Array) of one or more channels of float samples. */
export function encodeWav(channels, sampleRate) {
  const list = Array.isArray(channels) ? channels : [channels];
  const nch = list.length;
  const frames = nch ? list[0].length : 0;
  const bytes = frames * nch * 2;
  const out = new Uint8Array(44 + bytes);
  const v = new DataView(out.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, FORMAT_PCM, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, bytes, true);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const s = list[c][i] || 0;
      v.setInt16(p, Math.max(-32768, Math.min(32767, Math.round(s * 32768))), true);
      p += 2;
    }
  }
  return out;
}

/** The channels mixed to one (their average). */
export function toMono(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/** The loudest sample (absolute value) of all channels from start to end. */
export function peak(channels, start = 0, end = Infinity) {
  let m = 0;
  for (const ch of channels) {
    const b = Math.min(end, ch.length);
    for (let i = Math.max(0, start); i < b; i++) {
      const a = Math.abs(ch[i]);
      if (a > m) m = a;
    }
  }
  return m;
}

/** The volume that makes a sound whose loudest sample is `level` reach NORMALIZE_PEAK (1 for silence). */
export function normalizeVolume(level, target = NORMALIZE_PEAK) {
  return level > 1e-6 ? target / level : 1;
}

/**
 * Samples played `speed` times as fast (2: half as long and one octave
 * higher), by linear interpolation. Also changes a sample rate: from rate a
 * to rate b is speed a / b.
 */
export function resample(samples, speed) {
  const n = samples.length;
  if (!(speed > 0) || speed === 1 || n < 2) return Float32Array.from(samples);
  const len = Math.max(1, Math.floor((n - 1) / speed) + 1);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * speed;
    const k = Math.floor(pos);
    const f = pos - k;
    const a = samples[k];
    const b = k + 1 < n ? samples[k + 1] : a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

/**
 * Where the sound is in a recording: the first and last samples louder than
 * `threshold` (a fraction of the loudest sample), with `margin` seconds
 * around them. -> {start, end} (end exclusive); all of it if it is silent.
 */
export function findSound(samples, sampleRate, { threshold = 0.1, margin = 0.05 } = {}) {
  const n = samples.length;
  const level = peak([samples]) * threshold;
  if (!(level > 1e-4)) return { start: 0, end: n };
  let first = 0;
  while (first < n && Math.abs(samples[first]) < level) first++;
  let last = n - 1;
  while (last > first && Math.abs(samples[last]) < level) last--;
  const pad = Math.round(margin * sampleRate);
  return { start: Math.max(0, first - pad), end: Math.min(n, last + 1 + pad) };
}

/**
 * The edited sound: the part from `start` to `end` (sample indices of the
 * source, end exclusive), `speed` times as fast, times `volume`, with short
 * fades where the trim cuts into the sound, and clipped to -1..1.
 * source: {sampleRate, channels}. -> {sampleRate, channels, clipped}
 * (clipped: how many samples were louder than full scale).
 */
export function renderClip(source, { start = 0, end = Infinity, volume = 1, speed = 1 } = {}) {
  const n = source.channels[0]?.length ?? 0;
  const a = Math.max(0, Math.min(n, Math.round(start)));
  const b = Math.max(a, Math.min(n, Math.round(end)));
  let clipped = 0;
  const fade = Math.round(CUT_FADE * source.sampleRate / Math.max(speed, 1e-3));
  const channels = source.channels.map((ch) => {
    const out = resample(ch.subarray(a, b), speed);
    const len = out.length;
    const fadeIn = a > 0 ? Math.min(fade, len) : 0;
    const fadeOut = b < n ? Math.min(fade, len) : 0;
    for (let i = 0; i < len; i++) {
      let g = volume;
      if (i < fadeIn) g *= i / fadeIn;
      if (len - 1 - i < fadeOut) g *= (len - 1 - i) / fadeOut;
      let s = out[i] * g;
      if (s > 1) { s = 1; clipped++; } else if (s < -1) { s = -1; clipped++; }
      out[i] = s;
    }
    return out;
  });
  return { sampleRate: source.sampleRate, channels, clipped };
}

/** Bytes of a 16-bit WAV file with this many frames and channels. */
export function wavSize(frames, channels = 1) {
  return 44 + frames * channels * 2;
}
