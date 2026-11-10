// Tests for clips (web/player/clips.js, gif.js, webm.js) under Node, without
// a browser: the GIF encoder (decoded again here), WebM reading, joining,
// cutting and writing, and the ring of recordings with a made-up clock and
// recorder that writes WebM the way Chrome's MediaRecorder does.
//
//   node tools/clip-tests/test.mjs

import { GifEncoder, lzwEncode, makePalette } from '../../web/player/gif.js';
import { readWebm, writeWebm, joinSegments, webmDuration, trackSignature, VIDEO, AUDIO, _internal } from '../../web/player/webm.js';
import { ClipBuffer, gifRegion, videoRegion, clipName, clampSeconds, segmentMs, decoderColorSpace } from '../../web/player/clips.js';
import { decodeGif, lzwDecode } from './gif-decode.mjs';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}
function section(name, fn) {
  try {
    fn();
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.stack || e}`);
  }
}
async function sectionAsync(name, fn) {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.stack || e}`);
  }
}

// ---------------------------------------------------------------------------
// GIF

section('lzw', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const cases = {
    one: Uint8Array.of(5),
    two: Uint8Array.of(5, 5),
    flat: new Uint8Array(20000).fill(3),
    random: Uint8Array.from({ length: 30000 }, () => Math.floor(rnd() * 256)),
    few: Uint8Array.from({ length: 50000 }, () => Math.floor(rnd() * 4)),
    stripes: Uint8Array.from({ length: 40000 }, (_, i) => (i >> 5) & 15),
    empty: new Uint8Array(0),
  };
  for (const [name, data] of Object.entries(cases)) {
    const back = lzwDecode(lzwEncode(data, 8), 8);
    check(`lzw round trip: ${name}`, back.length === data.length && back.every((v, i) => v === data[i]), `${back.length} of ${data.length}`);
  }
  check('lzw: a flat run compresses', lzwEncode(cases.flat, 8).length < 400, `${lzwEncode(cases.flat, 8).length} bytes`);
});

function rgbaOf(w, h, colorAt) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = colorAt(x, y);
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
  return px;
}

section('gif: frames, palette and pixels', () => {
  const W = 40, H = 24;
  const bg = [26, 28, 44], fg = [255, 205, 117], red = [229, 72, 77];
  const frame = (bx) => rgbaOf(W, H, (x, y) => (x >= bx && x < bx + 6 && y >= 8 && y < 14 ? fg : y === 0 ? red : bg));
  const gif = new GifEncoder(W, H);
  gif.addFrame(frame(2), 100);
  gif.addFrame(frame(5), 100);
  gif.addFrame(frame(5), 100);  // the same: shows 200 ms
  gif.addFrame(frame(9), 50);
  const bytes = gif.finish();
  const d = decodeGif(bytes);
  check('gif: header', d.sig === 'GIF89a' && d.width === W && d.height === H, `${d.sig} ${d.width}x${d.height}`);
  check('gif: loops', d.loop === 0);
  check('gif: a palette of 256', d.palette.length === 256);
  check('gif: the exact colors are in the palette', [bg, fg, red].every((c) => d.palette.some((p) => p.join() === c.join())));
  check('gif: a frame that does not change joins the one before', d.frames.length === 3, `${d.frames.length} frames`);
  check('gif: delays', d.frames.map((f) => f.delay).join() === '10,20,5', d.frames.map((f) => f.delay).join());
  check('gif: frames keep what is under them', d.frames.every((f) => f.disposal === 1));
  const want = [frame(2), frame(5), frame(9)];
  for (let k = 0; k < 3; k++) {
    let bad = 0;
    for (let i = 0; i < W * H; i++) {
      const c = d.frames[k].pixels[i];
      if (!c || c[0] !== want[k][i * 4] || c[1] !== want[k][i * 4 + 1] || c[2] !== want[k][i * 4 + 2]) bad++;
    }
    check(`gif: frame ${k + 1} shows exactly the pixels it was given`, bad === 0, `${bad} pixels differ`);
  }
  // Only the changed rectangle is stored after the first frame.
  check('gif: later frames store only what changed', d.frames[1].w < W && d.frames[1].h <= 6 && d.frames[1].y === 8, `${d.frames[1].x},${d.frames[1].y} ${d.frames[1].w}x${d.frames[1].h}`);
  check('gif: unchanged pixels inside the rectangle are transparent', d.frames[1].transparent === 255);
});

section('gif: many colors', () => {
  const W = 64, H = 64;
  const px = rgbaOf(W, H, (x, y) => [x * 4, y * 4, (x * y) & 255]);
  const gif = new GifEncoder(W, H);
  gif.addFrame(px, 100);
  const d = decodeGif(gif.finish());
  const used = new Set(d.frames[0].pixels.map((c) => c.join()));
  check('gif: median cut keeps at most 255 colors', used.size <= 255 && used.size > 100, `${used.size}`);
  let err = 0;
  for (let i = 0; i < W * H; i++) {
    const c = d.frames[0].pixels[i];
    err += Math.abs(c[0] - px[i * 4]) + Math.abs(c[1] - px[i * 4 + 1]) + Math.abs(c[2] - px[i * 4 + 2]);
  }
  const avg = err / (W * H * 3);
  check('gif: median cut colors are near', avg < 12, `average error ${avg.toFixed(1)}`);
});

section('gif: delays add up and noise does not change pixels', () => {
  const W = 8, H = 8;
  const gif = new GifEncoder(W, H);
  for (let i = 0; i < 15; i++) gif.addFrame(rgbaOf(W, H, (x) => (x < i % 8 ? [200, 50, 50] : [10, 10, 10])), 1000 / 15);
  const d = decodeGif(gif.finish());
  const total = d.frames.reduce((s, f) => s + f.delay, 0);
  check('gif: 15 frames of 1/15 second take 100 hundredths', total === 100, `${total}`);
  check('gif: rounded delays are 6 or 7', d.frames.every((f) => f.delay === 6 || f.delay === 7 || f.delay === 13 || f.delay === 14), d.frames.map((f) => f.delay).join());

  const noisy = new GifEncoder(W, H);
  noisy.addFrame(rgbaOf(W, H, () => [100, 100, 100]), 100);
  noisy.addFrame(rgbaOf(W, H, (x, y) => [100 + ((x + y) % 3) * 3, 100, 98]), 100);
  noisy.addFrame(rgbaOf(W, H, (x) => (x === 3 ? [250, 250, 250] : [101, 100, 100])), 100);
  const n = decodeGif(noisy.finish());
  check('gif: a step of noise is not a change', n.frames.length === 2 && n.frames[0].delay === 20, `${n.frames.length} frames, ${n.frames.map((f) => f.delay)}`);
  check('gif: a real change still shows', n.frames[1].w === 1 && n.frames[1].x === 3, `${n.frames[1].x} ${n.frames[1].w}`);
});

section('gif: snap (pixel art from a video)', () => {
  const W = 32, H = 16;
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const jitter = (c) => c.map((v) => Math.max(0, Math.min(255, v + Math.round((rnd() - 0.5) * 8))));
  const frame = (bx) => rgbaOf(W, H, (x, y) => jitter(x >= bx && x < bx + 4 && y >= 4 && y < 8 ? [255, 204, 77] : [26, 28, 43]));
  const gif = new GifEncoder(W, H, { snap: 30 });
  gif.addFrame(frame(2), 100);
  gif.addFrame(frame(2), 100);
  gif.addFrame(frame(10), 100);
  const d = decodeGif(gif.finish());
  const colors = new Set();
  for (const f of d.frames) for (const c of f.pixels) colors.add(c.join());
  check('gif: snap leaves the real colors only', colors.size === 2, [...colors].join(' '));
  check('gif: snap colors are near the real ones', [...colors].every((c) => [[255, 204, 77], [26, 28, 43]].some((r) => c.split(',').every((v, i) => Math.abs(v - r[i]) <= 2))), [...colors].join(' '));
  check('gif: noise alone is no change', d.frames.length === 2 && d.frames[0].delay === 20, `${d.frames.length} frames`);
  check('gif: only the box changes', d.frames[1].w <= 12 && d.frames[1].h === 4, `${d.frames[1].w}x${d.frames[1].h}`);
});

section('gif: palette of few colors is exact', () => {
  const count = new Float64Array(32768), sums = new Float64Array(32768 * 3);
  const add = (r, g, b, n) => { const c = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); count[c] += n; sums[c * 3] += r * n; sums[c * 3 + 1] += g * n; sums[c * 3 + 2] += b * n; };
  add(1, 2, 3, 10);
  add(255, 255, 255, 5);
  const { palette } = makePalette(count, sums);
  check('gif: makePalette keeps real colors', palette.length === 2 && palette[0].join() === '1,2,3' && palette[1].join() === '255,255,255', JSON.stringify(palette));
});

section('gif: bad sizes', () => {
  let threw = false;
  try { new GifEncoder(0, 10); } catch { threw = true; }
  check('gif: a size of 0 is an error', threw);
  threw = false;
  try { new GifEncoder(4, 4).finish(); } catch { threw = true; }
  check('gif: no frames is an error', threw);
});

// ---------------------------------------------------------------------------
// WebM: recordings made the way Chrome's MediaRecorder makes them

const { element, uintElement, stringElement, floatElement, simpleBlock, ID } = _internal;
const UNKNOWN = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
const cat = (parts) => {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const idOf = (id) => { const out = []; for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff); return Uint8Array.from(out); };

const HEADER = element(ID.EBML, [uintElement(0x4286, 1), uintElement(0x42f7, 1), uintElement(0x42f2, 4), uintElement(0x42f3, 8), stringElement(0x4282, 'webm'), uintElement(0x4287, 4), uintElement(0x4285, 2)]);
function tracksElement({ width = 640, height = 360, audio = true, opusHead = [1, 2, 3] } = {}) {
  const entries = [element(ID.TrackEntry, [uintElement(ID.TrackNumber, 1), uintElement(ID.TrackType, VIDEO), stringElement(ID.CodecID, 'V_VP8'),
    element(ID.Video, [uintElement(ID.PixelWidth, width), uintElement(ID.PixelHeight, height)])])];
  if (audio) {
    entries.push(element(ID.TrackEntry, [uintElement(ID.TrackNumber, 2), uintElement(ID.TrackType, AUDIO), stringElement(ID.CodecID, 'A_OPUS'),
      element(ID.CodecPrivate, Uint8Array.from(opusHead)), element(ID.Audio, [floatElement(ID.SamplingFrequency, 48000), uintElement(ID.Channels, 2)])]));
  }
  return element(ID.Tracks, entries);
}

/** blocks: [{track, time (ms from this recording's start), keyframe, data}] as Chrome writes them: sizes unknown, a cluster per second. */
function chromeWebm(blocks, tracksOptions) {
  const parts = [HEADER, idOf(ID.Segment), UNKNOWN, element(ID.Info, [uintElement(ID.TimecodeScale, 1e6), stringElement(ID.MuxingApp, 'Chrome')]), tracksElement(tracksOptions)];
  let cluster = null;
  for (const b of blocks) {
    if (cluster === null || b.time - cluster >= 1000 && b.track === 1 && b.keyframe || b.time - cluster >= 1000) {
      cluster = Math.floor(b.time);
      parts.push(idOf(ID.Cluster), UNKNOWN, uintElement(ID.Timecode, cluster));
    }
    parts.push(simpleBlock({ ...b, flags: 0 }, cluster));
  }
  return cat(parts);
}

const payload = (track, t) => new TextEncoder().encode(`${track}@${t.toFixed(1)}`);

section('webm: read what a recorder writes', () => {
  const blocks = [];
  for (let i = 0; i < 90; i++) blocks.push({ track: 1, time: i * 33.3, keyframe: i % 30 === 0, data: payload(1, i * 33.3) });
  for (let i = 0; i < 150; i++) blocks.push({ track: 2, time: i * 20, keyframe: true, data: payload(2, i * 20) });
  blocks.sort((a, b) => a.time - b.time);
  const bytes = chromeWebm(blocks);
  const r = readWebm(bytes);
  check('webm: tracks', r.tracks.length === 2 && r.tracks[0].codecId === 'V_VP8' && r.tracks[0].width === 640 && r.tracks[1].sampleRate === 48000 && r.tracks[1].channels === 2);
  check('webm: every block', r.blocks.length === blocks.length, `${r.blocks.length} of ${blocks.length}`);
  check('webm: block times (whole ms)', r.blocks.every((b, i) => Math.abs(b.time - Math.round(blocks[i].time)) <= 1));
  check('webm: keyframes', r.blocks.filter((b) => b.keyframe && b.track === 1).length === 3);
  // Cut off in the middle of a block: the blocks before it are still there.
  const cut = readWebm(bytes.subarray(0, bytes.length - 7));
  check('webm: a file cut off at the end', cut.blocks.length === blocks.length - 1, `${cut.blocks.length}`);
  let threw = false;
  try { readWebm(new Uint8Array(40)); } catch { threw = true; }
  check('webm: not a WebM file is an error', threw);

  // A BlockGroup (with a ReferenceBlock: not a keyframe).
  const group = cat([HEADER, idOf(ID.Segment), UNKNOWN, tracksElement({ audio: false }), idOf(ID.Cluster), UNKNOWN, uintElement(ID.Timecode, 500),
    simpleBlock({ track: 1, time: 500, keyframe: true, flags: 0, data: Uint8Array.of(1) }, 500),
    element(ID.BlockGroup, [element(ID.Block, Uint8Array.of(0x81, 0, 40, 0, 9)), element(ID.ReferenceBlock, Uint8Array.of(0xd8))])]);
  const g = readWebm(group);
  check('webm: block groups', g.blocks.length === 2 && g.blocks[1].time === 540 && !g.blocks[1].keyframe && g.blocks[1].data[0] === 9);
});

section('webm: write, then read again', () => {
  const blocks = [];
  for (let i = 0; i < 300; i++) blocks.push({ track: 1, time: i * 33, keyframe: i % 100 === 0, flags: 0, data: payload(1, i) });
  for (let i = 0; i < 500; i++) blocks.push({ track: 2, time: i * 20, keyframe: true, flags: 0, data: payload(2, i) });
  blocks.sort((a, b) => a.time - b.time);
  const tracks = readWebm(chromeWebm(blocks.slice(0, 1))).tracks;
  const file = writeWebm({ header: HEADER, tracks, tracksRaw: tracksElement(), blocks, duration: 9933 });
  const r = readWebm(file);
  check('webm: all blocks back', r.blocks.length === blocks.length);
  check('webm: same times, tracks, keyframes and data', r.blocks.every((b, i) => b.time === blocks[i].time && b.track === blocks[i].track && b.keyframe === blocks[i].keyframe && new TextDecoder().decode(b.data) === new TextDecoder().decode(blocks[i].data)));
  check('webm: duration', Math.abs(webmDuration(file) - 9933) < 0.01, `${webmDuration(file)}`);
  // The seek head points at the Info, Tracks and Cues.
  const segStart = HEADER.length + 4 + 8;
  const want = [ID.Info, ID.Tracks, ID.Cues];
  let p = segStart;
  // SeekHead: id (4) + size (1 or 2) ...
  const findSeeks = () => {
    const out = [];
    for (let i = segStart; i < segStart + 200; i++) {
      if (file[i] === 0x53 && file[i + 1] === 0xac && file[i + 2] === 0x88) {
        let v = 0;
        for (let k = 0; k < 8; k++) v = v * 256 + file[i + 3 + k];
        out.push(v);
      }
    }
    return out;
  };
  const seeks = findSeeks();
  const idAt = (pos) => { let v = 0; for (let k = 0; k < 4; k++) v = v * 256 + file[segStart + pos + k]; return v; };
  check('webm: seek positions', seeks.length === 3 && seeks.every((pos, i) => idAt(pos) === want[i] || (want[i] < 0x1000000 && idAt(pos) >>> 8 === want[i])), seeks.map((s) => idAt(s).toString(16)).join());
  void p;
  // A cue for each keyframe cluster: 3 (at 0, 3300 and 6600 ms).
  let cues = 0;
  for (let i = 0; i < file.length - 1; i++) if (file[i] === 0xbb && file[i - 1] !== 0x53 && file[i + 2] === 0xb3) cues++;
  check('webm: cues', cues === 3, `${cues}`);
  check('webm: signature ignores the picture size', trackSignature(readWebm(chromeWebm(blocks.slice(0, 1), { width: 10 })).tracks) === trackSignature(tracks));
  check('webm: signature sees other sound', trackSignature(readWebm(chromeWebm(blocks.slice(0, 1), { opusHead: [9] })).tracks) !== trackSignature(tracks));
});

// ---------------------------------------------------------------------------
// The ring of recordings, on a made-up clock

/** A made-up MediaRecorder: frames at 30 per second (a keyframe every 100), sound every 20 ms, from when it starts until it stops. */
function fakeRecorders(clock, made, { keyEvery = 100, audio = true, tracksAt = () => ({}) } = {}) {
  return () => {
    const start = clock.t;
    const rec = { start, stopAt: null, disposed: false, options: tracksAt(start) };
    made.push(rec);
    return {
      stop() { if (rec.stopAt === null) rec.stopAt = clock.t; },
      async bytes() {
        const until = rec.stopAt ?? clock.t;
        const blocks = [];
        // The first frame comes a little after the start.
        for (let i = 0, t = 5; t <= until - start; i++, t += 1000 / 30) blocks.push({ track: 1, time: t, keyframe: i % keyEvery === 0, data: payload(1, start + t) });
        if (audio) for (let t = 0; t <= until - start; t += 20) blocks.push({ track: 2, time: t, keyframe: true, data: payload(2, start + t) });
        blocks.sort((a, b) => a.time - b.time);
        return chromeWebm(blocks, { audio, ...rec.options });
      },
      dispose() { rec.disposed = true; },
    };
  };
}

const timesOf = (clip, track) => clip.blocks.filter((b) => b.track === track).map((b) => Number(new TextDecoder().decode(b.data).split('@')[1]));

await sectionAsync('clip buffer', async () => {
  check('segmentMs', segmentMs(10) === 3333 && segmentMs(1) === 1000 && segmentMs(60) === 4000);
  check('clampSeconds', clampSeconds(10) === 10 && clampSeconds('7') === 7 && clampSeconds(0) === 10 && clampSeconds(500) === 60 && clampSeconds(NaN) === 10);

  const clock = { t: 1000 };
  const made = [];
  const buffer = new ClipBuffer({ seconds: 10, record: fakeRecorders(clock, made), now: () => clock.t });
  check('clip buffer: off until started', !buffer.recording && (await buffer.clip()) === null);
  buffer.start();
  // Three seconds: shorter than asked for, all of it.
  for (let i = 0; i < 12; i++) { clock.t += 250; buffer.tick(); }
  let clip = await buffer.clip();
  check('clip buffer: a short clip has all of it', clip && clip.duration > 2900 && clip.duration < 3100, `${clip?.duration}`);
  check('clip buffer: starts on a keyframe', clip.blocks.find((b) => b.track === 1).keyframe);

  // 40 seconds in all.
  for (let i = 0; i < 148; i++) { clock.t += 250; buffer.tick(); }
  check('clip buffer: keeps only the recordings it needs', buffer.segments.length <= 5, `${buffer.segments.length}`);
  check('clip buffer: stops and frees the old ones', made.slice(0, -5).every((r) => r.stopAt !== null && r.disposed));
  check('clip buffer: at most two record at once', made.filter((r) => r.stopAt === null).length <= 2);
  clip = await buffer.clip();
  check('clip buffer: about the last 10 seconds', clip.duration >= 10000 && clip.duration <= 10000 + segmentMs(10) + 100, `${clip.duration}`);
  const video = timesOf(clip, 1);
  const audio = timesOf(clip, 2);
  const gaps = (list) => list.slice(1).map((t, i) => t - list[i]);
  check('clip buffer: video frames in order, none twice', gaps(video).every((g) => g > 0), gaps(video).filter((g) => g <= 0).join());
  check('clip buffer: no video frame lost where recordings meet', gaps(video).every((g) => g < 1000 / 30 * 1.6), `${Math.max(...gaps(video)).toFixed(1)} ms`);
  check('clip buffer: sound in order, none lost', gaps(audio).every((g) => g > 0 && g <= 25), `${Math.min(...gaps(audio))}..${Math.max(...gaps(audio))}`);
  check('clip buffer: ends now', clock.t - video[video.length - 1] < 40, `${clock.t - video[video.length - 1]}`);
  check('clip buffer: times from 0', clip.blocks[0].time === 0);
  // The joined clip is a file a player reads.
  const file = writeWebm(clip);
  const back = readWebm(file);
  check('clip buffer: the file has all of it', back.blocks.length === clip.blocks.length && Math.abs(webmDuration(file) - clip.duration) < 1);

  buffer.stop();
  check('clip buffer: stop ends every recording', !buffer.recording && made.every((r) => r.stopAt !== null && r.disposed));
});

await sectionAsync('clip buffer: keyframes inside a recording', async () => {
  // A keyframe every 10 frames: the cut can be close to 10 seconds.
  const clock = { t: 0 };
  const made = [];
  const buffer = new ClipBuffer({ seconds: 5, record: fakeRecorders(clock, made, { keyEvery: 10, audio: false }), now: () => clock.t });
  buffer.start();
  for (let i = 0; i < 80; i++) { clock.t += 250; buffer.tick(); }
  const clip = await buffer.clip();
  check('clip buffer: cut at a keyframe near the start', clip.duration >= 5000 && clip.duration < 5000 + 10 * 1000 / 30 + 40, `${clip.duration}`);
  check('clip buffer: no sound track, no sound', clip.blocks.every((b) => b.track === 1));
});

await sectionAsync('clip buffer: tracks that change', async () => {
  // The sound starts working (or the tracks change) part way: only the
  // recordings with the newest tracks join.
  const clock = { t: 0 };
  const made = [];
  const buffer = new ClipBuffer({ seconds: 10, record: fakeRecorders(clock, made, { tracksAt: (t) => (t < 6000 ? { opusHead: [1] } : { opusHead: [2] }) }), now: () => clock.t });
  buffer.start();
  for (let i = 0; i < 40; i++) { clock.t += 250; buffer.tick(); }
  const clip = await buffer.clip();
  const first = timesOf(clip, 1)[0];
  check('clip buffer: older tracks are left out', first >= 6000, `starts at ${first}`);
});

section('colors', () => {
  const tracks = element(ID.Tracks, [element(ID.TrackEntry, [uintElement(ID.TrackNumber, 1), uintElement(ID.TrackType, VIDEO), stringElement(ID.CodecID, 'V_VP8'),
    element(ID.Video, [uintElement(ID.PixelWidth, 8), uintElement(ID.PixelHeight, 8),
      element(0x55b0, [uintElement(0x55b1, 1), uintElement(0x55b9, 2), uintElement(0x55ba, 13), uintElement(0x55bb, 1)])])])]);
  const file = cat([HEADER, idOf(ID.Segment), UNKNOWN, tracks]);
  const t = readWebm(file).tracks[0];
  check('webm: the Colour element', t.colour && t.colour.range === 2 && t.colour.matrix === 1 && t.colour.transfer === 13, JSON.stringify(t.colour));
  const cs = decoderColorSpace(t.colour);
  check('decoderColorSpace: full range, BT.709, sRGB', cs.fullRange === true && cs.matrix === 'bt709' && cs.primaries === 'bt709' && cs.transfer === 'iec61966-2-1', JSON.stringify(cs));
  check('decoderColorSpace: nothing known, nothing set', decoderColorSpace(null) === null && decoderColorSpace({ matrix: 99 }) === null);
});

section('joinSegments', () => {
  const rec = (start, from, to, key = () => false) => {
    const blocks = [];
    for (let t = from, i = 0; t < to; t += 40, i++) blocks.push({ track: 1, time: t, keyframe: i === 0 || key(i), data: payload(1, start + t) });
    return { start, data: readWebm(chromeWebm(blocks, { audio: false })) };
  };
  const clip = joinSegments([rec(0, 0, 2000), rec(1600, 0, 2000)], Infinity);
  const times = timesOf(clip, 1);
  check('joinSegments: the overlap is used once', times.every((t, i) => !i || t > times[i - 1]) && times[0] === 0 && times[times.length - 1] === 3560, `${times[0]}..${times[times.length - 1]}`);
  check('joinSegments: nothing to join', joinSegments([], 1000) === null && joinSegments([{ start: 0, data: null }], 1000) === null);
  // The older recording's last frame on the same millisecond as the newer one's first.
  const a = { start: 0, data: readWebm(chromeWebm([{ track: 1, time: 0, keyframe: true, data: payload(1, 0) }, { track: 1, time: 1000, keyframe: false, data: payload(1, 1000) }], { audio: false })) };
  a.data.blocks[1].time = 999.6;
  const b = { start: 1000, data: readWebm(chromeWebm([{ track: 1, time: 0, keyframe: true, data: payload(1, 1000.1) }, { track: 1, time: 40, keyframe: false, data: payload(1, 1040) }], { audio: false })) };
  const j = joinSegments([a, b], Infinity);
  const ms = j.blocks.map((x) => Math.round(x.time));
  check('joinSegments: no two blocks of a track on one millisecond', ms.join() === '0,1000,1040' && j.blocks[1].keyframe, `${ms.join()} ${j.blocks.map((x) => x.keyframe).join()}`);
});

// ---------------------------------------------------------------------------
// GIF size and file names

section('gifRegion', () => {
  // A 160x90 pixel-art game drawn at 8 times in a 1400x813 window.
  let r = gifRegion(1400, 813, { width: 160, height: 90, stretch: 'pixel' });
  check('gifRegion: pixel art crops the bars', r.sw === 1280 && r.sh === 720 && r.sx === 60 && r.sy === 46, JSON.stringify(r));
  check('gifRegion: pixel art at whole times', r.pixel && r.width === 640 && r.height === 360, JSON.stringify(r));
  r = gifRegion(640, 360, { width: 320, height: 180, stretch: 'pixel' });
  check('gifRegion: never bigger than on the screen', r.width === 640 && r.height === 360);
  r = gifRegion(1400, 813, { width: 1280, height: 720, stretch: 'pixel' });
  check('gifRegion: a big pixel-art game is made smaller', r.pixel && r.width === 640 && r.height === 360, JSON.stringify(r));
  r = gifRegion(1400, 813, { width: 1280, height: 720, stretch: 'expand' });
  check('gifRegion: smooth games fit in 480', !r.pixel && r.sx === 0 && r.sw === 1400 && r.width === 480 && r.height === 278, JSON.stringify(r));
  r = gifRegion(1000, 1000, { width: 1280, height: 720, stretch: 'fit' });
  check('gifRegion: fit crops the bars', r.sy === 218 && r.sh === 563 && r.width === 480 && r.height === 270, JSON.stringify(r));
  r = gifRegion(300, 200, null);
  check('gifRegion: small stays the same', r.width === 300 && r.height === 200);
  // A scale of 6 on the screen: 4 would make squares of 1 and 2 pixels, so 3.
  r = gifRegion(960, 540, { width: 160, height: 90, stretch: 'pixel' });
  check('gifRegion: the GIF scale divides the one on the screen', r.width === 480 && r.height === 270, JSON.stringify(r));
});

section('videoRegion', () => {
  let r = videoRegion(1400, 813, { width: 160, height: 90, stretch: 'pixel' });
  check('videoRegion: pixel art, the game alone at a whole scale', r.pixel && r.sx === 60 && r.sw === 1280 && r.width === 640 && r.height === 360, JSON.stringify(r));
  r = videoRegion(1920, 1080, { width: 320, height: 180, stretch: 'pixel' });
  check('videoRegion: pixel art at 3 of 6', r.width === 960 && r.height === 540, JSON.stringify(r));
  r = videoRegion(1920, 1080, { width: 1280, height: 720, stretch: 'expand' });
  check('videoRegion: big smooth canvases are made smaller', r.width === 960 && r.height === 540 && r.sw === 1920, JSON.stringify(r));
  r = videoRegion(800, 500, { width: 1280, height: 720, stretch: 'expand' });
  check('videoRegion: small canvases stay as they are', r.width === 800 && r.height === 500, JSON.stringify(r));
  r = videoRegion(1000, 2000, null);
  check('videoRegion: tall canvases fit too', r.height === 960 && r.width === 480, JSON.stringify(r));
});

section('clipName', () => {
  const d = new Date(2026, 10, 10, 9, 3, 5);
  check('clipName', clipName('Lamplight', d, 'webm') === 'Lamplight 2026-11-10 09-03-05.webm', clipName('Lamplight', d, 'webm'));
  check('clipName: no slashes or colons', clipName('a/b: c?', d, 'gif') === 'a b c 2026-11-10 09-03-05.gif', clipName('a/b: c?', d, 'gif'));
  check('clipName: a name when there is none', clipName('  ', d, 'gif').startsWith('Smitten game '));
});

console.log(`DONE ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
