// node web/editor/tools/wav/wav.test.mjs
//
// wav.js: WAV decoding and encoding, trimming, volume, normalizing, speed
// and finding the sound in a recording. Also the song model's sample
// instruments (../music/song.js).

import assert from 'node:assert/strict';
import {
  decodeWav, encodeWav, toMono, peak, normalizeVolume, resample, findSound, renderClip, wavSize,
  RECORD_RATE, MAX_RECORD_SECONDS, NORMALIZE_PEAK,
} from './wav.js';
import { normalizeInstrument, normalizeSong, SAMPLE_DEFAULTS } from '../music/song.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

/** A WAV file by hand: fmt fields and raw data bytes, with extra chunks around them. */
function wavBytes({ format = 1, channels = 1, rate = 8000, bits = 16, data, extensible = false, junk = false, oddChunk = false }) {
  const parts = [];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const chunk = (id, body) => {
    parts.push(...[...id].map((c) => c.charCodeAt(0)), ...u32(body.length), ...body);
    if (body.length & 1) parts.push(0);
  };
  const block = channels * bits / 8;
  let fmt = [...u16(extensible ? 0xfffe : format), ...u16(channels), ...u32(rate), ...u32(rate * block), ...u16(block), ...u16(bits)];
  if (extensible) fmt = [...fmt, ...u16(22), ...u16(bits), ...u32(0), ...u16(format), 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71];
  if (junk) chunk('JUNK', [1, 2, 3]);
  chunk('fmt ', fmt);
  if (oddChunk) chunk('LIST', [9, 9, 9, 9, 9]);
  chunk('data', [...data]);
  const body = [...'WAVE'].map((c) => c.charCodeAt(0)).concat(parts);
  return new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat(u32(body.length), body));
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sine = (n, rate, hz, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / rate));

test('16-bit mono: decode', () => {
  const d = decodeWav(wavBytes({ data: [0, 0, 0, 0x40, 0, 0xc0, 0xff, 0x7f, 0, 0x80] }));
  assert.equal(d.sampleRate, 8000);
  assert.equal(d.channels.length, 1);
  assert.deepEqual([...d.channels[0]], [0, 0.5, -0.5, 32767 / 32768, -1]);
});

test('8-bit, 24-bit, 32-bit and float samples', () => {
  assert.deepEqual([...decodeWav(wavBytes({ bits: 8, data: [128, 192, 64, 0] })).channels[0]], [0, 0.5, -0.5, -1]);
  assert.deepEqual([...decodeWav(wavBytes({ bits: 24, data: [0, 0, 0x40, 0, 0, 0xc0] })).channels[0]], [0.5, -0.5]);
  assert.deepEqual([...decodeWav(wavBytes({ bits: 32, data: [0, 0, 0, 0x40, 0, 0, 0, 0xc0] })).channels[0]], [0.5, -0.5]);
  const f = new Uint8Array(new Float32Array([0.25, -0.75]).buffer);
  const d = decodeWav(wavBytes({ format: 3, bits: 32, data: f }));
  assert.ok(d.float);
  assert.deepEqual([...d.channels[0]], [0.25, -0.75]);
});

test('stereo, extensible format, extra and odd-sized chunks', () => {
  const d = decodeWav(wavBytes({ channels: 2, extensible: true, junk: true, oddChunk: true, data: [0, 0x40, 0, 0xc0, 0, 0x20, 0, 0] }));
  assert.equal(d.channels.length, 2);
  assert.deepEqual([...d.channels[0]], [0.5, 0.25]);
  assert.deepEqual([...d.channels[1]], [-0.5, 0]);
  assert.deepEqual([...toMono(d.channels)], [0, 0.125]);
});

test('a data chunk longer than the file is read up to the end', () => {
  const bytes = wavBytes({ data: [0, 0x40, 0, 0x40] });
  new DataView(bytes.buffer).setUint32(bytes.length - 8, 0xffffffff, true);
  assert.deepEqual([...decodeWav(bytes).channels[0]], [0.5, 0.5]);
});

test('files it cannot read say why', () => {
  assert.throws(() => decodeWav(new Uint8Array([1, 2, 3])), /not a WAV file/);
  assert.throws(() => decodeWav(wavBytes({ format: 2, bits: 4, data: [0, 0] })), /compressed format \(code 2\)/);
  assert.throws(() => decodeWav(wavBytes({ bits: 12, data: [0, 0] })), /12-bit/);
  const noData = wavBytes({ data: [] });
  noData.set([...'xxxx'].map((c) => c.charCodeAt(0)), noData.length - 8);
  assert.throws(() => decodeWav(noData), /no sound data/);
});

test('encode: 16-bit PCM header and samples; decode gives them back', () => {
  const left = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]);
  const bytes = encodeWav([left], 22050);
  assert.equal(bytes.length, wavSize(7));
  const v = new DataView(bytes.buffer);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 22050);
  assert.equal(v.getUint32(28, true), 44100);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 14);
  const d = decodeWav(bytes);
  assert.equal(d.sampleRate, 22050);
  assert.deepEqual([...d.channels[0]], [0, 0.5, -0.5, 32767 / 32768, -1, 32767 / 32768, -1]);
  // Values that 16 bits can hold come back exactly.
  const exact = Float32Array.from({ length: 200 }, (_, i) => (i * 327 - 32768) / 32768);
  assert.deepEqual([...decodeWav(encodeWav([exact], 8000)).channels[0]], [...exact]);
  // Stereo is interleaved.
  const st = decodeWav(encodeWav([Float32Array.from([0.5, 0]), Float32Array.from([-0.5, 0.25])], 8000));
  assert.deepEqual(st.channels.map((c) => [...c]), [[0.5, 0], [-0.5, 0.25]]);
});

test('peak and normalize', () => {
  const ch = [Float32Array.from([0.1, -0.4, 0.2]), Float32Array.from([0, 0.3, -0.25])];
  assert.ok(near(peak(ch), 0.4));
  assert.ok(near(peak(ch, 2), 0.25));
  assert.ok(near(normalizeVolume(0.4), NORMALIZE_PEAK / 0.4));
  assert.equal(normalizeVolume(0), 1);
});

test('resample: speed 2 is half as long, speed 0.5 twice as long, and the pitch moves', () => {
  const rate = 8000;
  const s = sine(8000, rate, 100);
  const fast = resample(s, 2);
  assert.equal(fast.length, 4000);
  const slow = resample(s, 0.5);
  assert.equal(slow.length, 15999);
  const crossings = (x) => { let n = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++; return n; };
  assert.ok(Math.abs(crossings(fast) / (fast.length / rate) - 200) < 3);
  assert.ok(Math.abs(crossings(slow) / (slow.length / rate) - 50) < 3);
  assert.deepEqual([...resample(Float32Array.from([0, 1]), 0.5)], [0, 0.5, 1]);
  assert.deepEqual([...resample(Float32Array.from([1, 2, 3]), 1)], [1, 2, 3]);
});

test('findSound: the loud part with a margin; all of a silent recording', () => {
  const rate = 1000;
  const s = new Float32Array(1000);
  for (let i = 400; i < 600; i++) s[i] = 0.5;
  s[10] = 0.01; // noise under the threshold
  assert.deepEqual(findSound(s, rate), { start: 350, end: 650 });
  assert.deepEqual(findSound(s, rate, { margin: 0 }), { start: 400, end: 600 });
  assert.deepEqual(findSound(new Float32Array(50), rate), { start: 0, end: 50 });
});

test('renderClip: trim, volume, speed, fades only at cuts, clipping counted', () => {
  const src = { sampleRate: 1000, channels: [new Float32Array(1000).fill(0.5)] };
  const all = renderClip(src);
  assert.equal(all.channels[0].length, 1000);
  assert.equal(all.channels[0][0], 0.5);
  assert.equal(all.channels[0][999], 0.5);
  const cut = renderClip(src, { start: 100, end: 300, volume: 1.5 });
  const c = cut.channels[0];
  assert.equal(c.length, 200);
  assert.equal(c[0], 0); // faded in at the cut
  assert.equal(c[199], 0); // and out
  assert.ok(near(c[100], 0.75));
  assert.equal(cut.clipped, 0);
  const loud = renderClip(src, { volume: 3 });
  assert.equal(loud.channels[0][500], 1);
  assert.equal(loud.clipped, 1000);
  const fast = renderClip(src, { start: 0, end: 1000, speed: 2 });
  assert.equal(fast.channels[0].length, 500);
  // The source is not changed.
  assert.equal(src.channels[0][150], 0.5);
});

test('a recording at the longest fits in memory (not streamed)', () => {
  assert.ok(wavSize(RECORD_RATE * MAX_RECORD_SECONDS) < 512 * 1024);
});

test('song: sample instruments keep their fields and get defaults', () => {
  const ins = normalizeInstrument({ type: 'sample', sample: '../sounds/bap.wav' });
  assert.equal(ins.type, 'sample');
  assert.equal(ins.sample, '../sounds/bap.wav');
  assert.equal(ins.baseNote, 60);
  assert.equal(ins.pitched, true);
  assert.equal(ins.playToEnd, true);
  for (const [k, v] of Object.entries(SAMPLE_DEFAULTS)) assert.equal(ins[k], v, k);
  const kept = normalizeInstrument({ type: 'sample', sample: 7, baseNote: 200, pitched: false, playToEnd: false, release: 0.5, extra: 'x' });
  assert.equal(kept.sample, '');
  assert.equal(kept.baseNote, 127);
  assert.equal(kept.pitched, false);
  assert.equal(kept.playToEnd, false);
  assert.equal(kept.release, 0.5);
  assert.equal(kept.extra, 'x');
  // Old songs are unchanged.
  const old = normalizeSong({ instruments: [{ name: 'Kick', type: 'sfx', sfx: 'k.sfx' }, { name: 'Lead', wave: 'sine' }] });
  assert.deepEqual(Object.keys(old.instruments[0]), ['name', 'type', 'sfx', 'pitched']);
  assert.equal(old.instruments[1].type, 'synth');
  assert.ok(!('baseNote' in old.instruments[1]));
});

console.log(`wav.js: ${passed} tests passed`);
