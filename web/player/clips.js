// Clips: the last seconds of a running game, saved as a WebM video (with the
// game's sound) or a GIF. The player (player.js) loads this module the
// first time someone presses Record, so a game that nobody records pays
// nothing for it.
//
// How it records: canvas.captureStream() and a MediaRecorder (the browser
// encodes in its own threads), with the game's sound taken from where the
// engine's WebAudio meets the speakers. A MediaRecorder only makes whole
// files from its start, so ClipBuffer starts a new recording every few
// seconds and drops the old ones it no longer needs; saving joins the ones
// left and cuts the result to the last seconds, on a keyframe (webm.js).
// A GIF is made from that video: the browser's own VP8 decoder
// (WebCodecs) gives the frames, and gif.js turns them into a GIF, smaller
// and with fewer frames per second, with sharp pixels for pixel-art games.

import { readWebm, joinSegments, writeWebm, VIDEO } from './webm.js';
import { GifEncoder } from './gif.js';

export const DEFAULT_SECONDS = 10;
export const MAX_SECONDS = 60;
// How long the recordings overlap when a new one takes over, so no frame is lost.
const OVERLAP_MS = 400;

/** How long each recording runs before the next one starts (ms). */
export function segmentMs(seconds) {
  return Math.round(Math.min(4, Math.max(1, seconds / 3)) * 1000);
}

export function clampSeconds(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_SECONDS, Math.max(1, Math.round(n))) : DEFAULT_SECONDS;
}

/**
 * The recordings for the last `seconds`. record() starts a recording and
 * returns {stop(), bytes()}: stop() ends it, bytes() resolves with what it
 * has recorded so far (a WebM file, maybe cut off at the end). tick() runs
 * a few times per second while recording.
 */
export class ClipBuffer {
  constructor({ seconds = DEFAULT_SECONDS, record, now = () => performance.now() }) {
    this.keepMs = clampSeconds(seconds) * 1000;
    this.segmentMs = segmentMs(this.keepMs / 1000);
    this.record = record;
    this.now = now;
    this.segments = [];
  }

  get recording() {
    return this.segments.length > 0;
  }

  start() {
    this.stop();
    this.segments.push({ start: this.now(), rec: this.record() });
  }

  tick() {
    if (!this.segments.length) return;
    const t = this.now();
    const current = this.segments[this.segments.length - 1];
    if (t - current.start >= this.segmentMs) {
      current.stopAt = t + OVERLAP_MS;
      this.segments.push({ start: t, rec: this.record() });
    }
    for (const s of this.segments) {
      if (s.stopAt !== undefined && t >= s.stopAt && !s.stopped) {
        s.stopped = true;
        s.rec.stop();
      }
    }
    // The second oldest already covers the last seconds: the oldest can go.
    while (this.segments.length >= 2 && t - this.segments[1].start >= this.keepMs) {
      const old = this.segments.shift();
      if (!old.stopped) old.rec.stop();
      old.rec.dispose?.();
    }
  }

  /** The last seconds, joined (what writeWebm takes), or null if nothing is recorded yet. */
  async clip() {
    const parts = await Promise.all(this.segments.map(async (s) => {
      const bytes = await s.rec.bytes();
      let data = null;
      try { data = bytes && bytes.length ? readWebm(bytes) : null; } catch { /* not enough of it yet */ }
      return { start: s.start, data };
    }));
    return joinSegments(parts, this.keepMs);
  }

  stop() {
    for (const s of this.segments) {
      if (!s.stopped) s.rec.stop();
      s.rec.dispose?.();
    }
    this.segments = [];
  }
}

// ---------------------------------------------------------------------------
// In the browser

/** The WebM type this browser records, or null if it records none. */
export function recordingType(withAudio) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  const types = withAudio
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

export function canRecord(canvas) {
  return !!canvas?.captureStream && !!recordingType(false);
}

/** One MediaRecorder on the stream, as ClipBuffer wants it. */
function mediaRecording(stream, options) {
  const rec = new MediaRecorder(stream, options);
  const chunks = [];
  let waiting = [];
  const wake = () => { for (const fn of waiting.splice(0)) fn(); };
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
    wake();
  };
  let ended = false;
  rec.onstop = () => {
    ended = true;
    wake();
  };
  // A chunk each second, so saving only has to ask for the last bit.
  rec.start(1000);
  const wait = (ms) => new Promise((resolve) => {
    waiting.push(resolve);
    setTimeout(resolve, ms);
  });
  return {
    stop() {
      if (rec.state !== 'inactive') rec.stop();
    },
    async bytes() {
      if (rec.state === 'recording') {
        const data = wait(1500);
        try { rec.requestData(); } catch { wake(); }
        await data;
      } else if (!ended) {
        // Stopped, but its last data is not here yet.
        await wait(1500);
      }
      return new Uint8Array(await new Blob(chunks).arrayBuffer());
    },
    dispose() {
      chunks.length = 0;
      waiting = [];
    },
  };
}

/**
 * Records a canvas and, when it can, the engine's sound.
 *   audio:   () => {context, outputs} or null: the AudioContext the engine
 *            plays in and the nodes it connects to the speakers.
 *   display: () => the game's {width, height, stretch}, or null.
 *   onFrame: (fn) => stop: calls fn right after each frame the engine
 *            draws, until stop() (the player hooks requestAnimationFrame).
 * With onFrame, a big canvas is recorded through a smaller copy (at most
 * 960 pixels wide and 960x540 in all; for pixel art, the game alone at a
 * whole scale): encoding a full-size canvas can take more of a slow
 * computer than the game does.
 */
export class ClipRecorder {
  constructor({ canvas, audio = () => null, display = () => null, onFrame = null, seconds = DEFAULT_SECONDS }) {
    this.canvas = canvas;
    this.audio = audio;
    this.display = display;
    this.onFrame = onFrame;
    this.seconds = clampSeconds(seconds);
    this.buffer = null;
    this.timer = 0;
    this.stream = null;
    this.tap = null;
    this.stopFrames = null;
    this.withSound = false;
    this.recorded = null;
  }

  get recording() {
    return !!this.buffer?.recording;
  }

  start() {
    if (this.recording) return;
    if (!canRecord(this.canvas)) throw new Error('This browser cannot record the game. Try Chrome, Edge or Firefox.');
    const display = this.display();
    const { canvas } = this;
    const region = videoRegion(canvas.width, canvas.height, display);
    let video;
    if (this.onFrame && (region.width !== canvas.width || region.height !== canvas.height)) {
      const copy = document.createElement('canvas');
      copy.width = region.width;
      copy.height = region.height;
      const ctx = copy.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = !region.pixel;
      [video] = copy.captureStream(0).getVideoTracks();
      let last = -Infinity;
      let crop = region, cropFor = `${canvas.width}x${canvas.height}`;
      // A copy is a GPU copy on most computers (well under a millisecond),
      // but without a GPU the browser reads the picture back, which can
      // take 30 ms. Copies stay near a fifth of the time: 30 frames per
      // second when they are fast, down to 10 when they are slow.
      let cost = null;
      let interval = 1000 / 30;
      this.stopFrames = this.onFrame(() => {
        const now = performance.now();
        if (now - last < interval - 4) return;
        last = now;
        // The same part of the game if the canvas changes size.
        const size = `${canvas.width}x${canvas.height}`;
        if (size !== cropFor) {
          crop = videoRegion(canvas.width, canvas.height, display);
          cropFor = size;
        }
        ctx.drawImage(canvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, copy.width, copy.height);
        video.requestFrame?.();
        const took = performance.now() - now;
        cost = cost === null ? took : cost * 0.8 + took * 0.2;
        interval = Math.min(100, Math.max(1000 / 30, cost * 5));
      });
    } else {
      [video] = canvas.captureStream(30).getVideoTracks();
    }
    // The GIF finds the game in the video the same way (a cut-off video is
    // the game alone, at a whole scale for pixel art).
    this.recorded = display;
    const tracks = [video];
    const audio = this.audio();
    this.withSound = false;
    if (audio?.context && recordingType(true) && audio.context.createMediaStreamDestination) {
      try {
        this.tap = audio.context.createMediaStreamDestination();
        for (const node of audio.outputs) this.listen(node);
        tracks.push(...this.tap.stream.getAudioTracks());
        this.withSound = true;
      } catch {
        this.tap = null;
      }
    }
    this.stream = new MediaStream(tracks);
    // About 0.15 bits per pixel per frame, and 2 Mbit per second at least:
    // sharp edges need it, and the flat colors of most games take less, so
    // files stay small (the encoder uses less when it can).
    const options = {
      mimeType: recordingType(this.withSound),
      videoBitsPerSecond: Math.round(Math.min(8e6, Math.max(2e6, region.width * region.height * 30 * 0.15))),
      audioBitsPerSecond: 128000,
    };
    this.buffer = new ClipBuffer({ seconds: this.seconds, record: () => mediaRecording(this.stream, options) });
    this.buffer.start();
    this.timer = setInterval(() => this.buffer?.tick(), 250);
  }

  /** A node the engine connected to the speakers (also after start()). */
  listen(node) {
    if (!this.tap || node.context !== this.tap.context) return;
    try { node.connect(this.tap); } catch { /* from another context */ }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.stopFrames?.();
    this.stopFrames = null;
    this.buffer?.stop();
    this.buffer = null;
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.stream = null;
    if (this.tap) {
      const outputs = this.audio()?.outputs || [];
      for (const node of outputs) {
        try { node.disconnect(this.tap); } catch { /* not connected */ }
      }
      this.tap = null;
    }
  }

  async clip() {
    const clip = this.buffer ? await this.buffer.clip() : null;
    if (!clip || !clip.blocks.some((b) => b.keyframe)) throw new Error('Nothing is recorded yet. Play for a moment, then try again.');
    return clip;
  }

  /** The last seconds as a WebM video (Blob). */
  async video() {
    return new Blob([writeWebm(await this.clip())], { type: 'video/webm' });
  }

  /** The last seconds as a GIF (Blob). */
  async gif(options) {
    return new Blob([await gifFromClip(await this.clip(), { display: this.recorded, ...options })], { type: 'image/gif' });
  }
}

// ---------------------------------------------------------------------------
// What a clip shows

/**
 * The part of a frameW x frameH frame that a clip shows, and the size it
 * has there. display: {width, height, stretch} of the game. In "pixel"
 * stretch the bars are cut off and each game pixel becomes a square of
 * whole pixels (a scale that divides the one on the screen, so every
 * square is the same; nearest, never blurred); in "fit" the bars are cut
 * off too. Returns {sx, sy, sw, sh, width, height, pixel}.
 */
export function clipRegion(frameW, frameH, display, { maxSide = 480, maxPixelSide = maxSide, maxArea = Infinity } = {}) {
  let sx = 0, sy = 0, sw = frameW, sh = frameH, pixel = false, scale = 1;
  const gw = Number(display?.width), gh = Number(display?.height);
  if (gw > 0 && gh > 0 && (display.stretch === 'pixel' || display.stretch === 'fit')) {
    scale = Math.min(frameW / gw, frameH / gh);
    if (display.stretch === 'pixel' && scale >= 1) {
      scale = Math.floor(scale);
      pixel = true;
    }
    sw = Math.max(1, Math.round(gw * scale));
    sh = Math.max(1, Math.round(gh * scale));
    sx = Math.max(0, Math.floor((frameW - sw) / 2));
    sy = Math.max(0, Math.floor((frameH - sh) / 2));
  }
  if (pixel) {
    for (let t = scale; t >= 1; t--) {
      if (scale % t === 0 && gw * t <= maxPixelSide && gh * t <= maxPixelSide && gw * gh * t * t <= maxArea) {
        return { sx, sy, sw, sh, width: gw * t, height: gh * t, pixel };
      }
    }
    // A pixel-art game bigger than a clip may be: smaller, still nearest.
    const k = Math.max(Math.ceil(Math.max(gw, gh) / maxPixelSide), Math.ceil(Math.sqrt(gw * gh / maxArea)));
    return { sx, sy, sw, sh, width: Math.max(1, Math.round(gw / k)), height: Math.max(1, Math.round(gh / k)), pixel };
  }
  const k = Math.min(1, maxSide / Math.max(sw, sh), Math.sqrt(maxArea / (sw * sh)));
  // Even sizes: video encoders want them.
  return { sx, sy, sw, sh, width: Math.max(2, Math.round(sw * k / 2) * 2), height: Math.max(2, Math.round(sh * k / 2) * 2), pixel };
}

/** What a recording shows: at most 960 pixels wide or high, 960x540 in all. */
export function videoRegion(frameW, frameH, display) {
  return clipRegion(frameW, frameH, display, { maxSide: 960, maxArea: 960 * 540 });
}

/** What a GIF shows: at most 480 pixels wide or high (640 for pixel art). */
export function gifRegion(frameW, frameH, display) {
  return clipRegion(frameW, frameH, display, { maxSide: 480, maxPixelSide: 640 });
}

const DECODER_CODECS = { V_VP8: 'vp8', V_VP9: 'vp09.00.10.08', V_AV1: 'av01.0.04M.08' };

/** A WebM Colour element's numbers (ISO/IEC 23091-4) as WebCodecs' VideoColorSpaceInit, or null. */
export function decoderColorSpace(colour) {
  if (!colour) return null;
  const MATRIX = { 0: 'rgb', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020-ncl' };
  const PRIMARIES = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020' };
  const TRANSFER = { 1: 'bt709', 6: 'smpte170m', 8: 'linear', 13: 'iec61966-2-1' };
  const out = {};
  if (colour.range === 1 || colour.range === 2) out.fullRange = colour.range === 2;
  if (MATRIX[colour.matrix]) out.matrix = MATRIX[colour.matrix];
  if (PRIMARIES[colour.primaries]) out.primaries = PRIMARIES[colour.primaries];
  if (TRANSFER[colour.transfer]) out.transfer = TRANSFER[colour.transfer];
  return Object.keys(out).length ? out : null;
}

/**
 * A joined clip (ClipBuffer.clip()) as GIF bytes, at most `fps` frames per
 * second. Decodes the video with WebCodecs; onProgress(0..1) while it works.
 */
export async function gifFromClip(clip, { display = null, fps = 15, onProgress } = {}) {
  const track = clip.tracks.find((t) => t.type === VIDEO);
  const codec = track && DECODER_CODECS[track.codecId];
  const unsupported = 'This browser cannot make GIFs. Save a video instead.';
  if (!codec || typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error(unsupported);
  // VP8 does not say how its colors are stored; the WebM file does, and
  // without it the decoder takes Chrome's full-range colors for
  // limited-range ones (a darker GIF).
  const config = { codec };
  const colorSpace = decoderColorSpace(track.colour);
  if (colorSpace) config.colorSpace = colorSpace;
  if (!(await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }))).supported) throw new Error(unsupported);

  const blocks = clip.blocks.filter((b) => b.track === track.number);
  const times = blocks.map((b) => b.time);
  const steps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const sourceStep = steps.length ? steps[steps.length >> 1] : 1000 / 30;
  const step = Math.max(1000 / fps, sourceStep);

  let encoder = null, region = null, ctx = null, small = null;
  let held = null;       // the frame taken last, waiting to know how long it shows
  let next = 0;
  let failure = null;
  const take = (frame, time) => {
    const w = frame.displayWidth, h = frame.displayHeight;
    if (!encoder) {
      region = { ...gifRegion(w, h, display), frameW: w, frameH: h };
      // Pixel art has few colors: the video's noise goes back into them.
      encoder = new GifEncoder(region.width, region.height, { snap: region.pixel ? 48 : 0 });
      ctx = new OffscreenCanvas(region.width, region.height).getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = !region.pixel;
      ctx.imageSmoothingQuality = 'high';
      // Pixel art: one sample from the middle of each game pixel first, so
      // the video's soft edges do not get into the GIF's squares.
      if (region.pixel && display.width < region.width) {
        small = new OffscreenCanvas(display.width, display.height).getContext('2d');
        small.imageSmoothingEnabled = false;
      }
    }
    // The same part of every frame, at the first frame's GIF size, even if
    // the game's window changed size.
    const r = w === region.frameW && h === region.frameH ? region : gifRegion(w, h, display);
    if (small) {
      small.drawImage(frame, r.sx, r.sy, r.sw, r.sh, 0, 0, display.width, display.height);
      ctx.drawImage(small.canvas, 0, 0, region.width, region.height);
    } else {
      ctx.drawImage(frame, r.sx, r.sy, r.sw, r.sh, 0, 0, region.width, region.height);
    }
    const pixels = ctx.getImageData(0, 0, region.width, region.height).data;
    if (held) encoder.addFrame(held.pixels, time - held.time);
    held = { pixels, time };
  };
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        const time = frame.timestamp / 1000;
        if (!failure && time >= next - sourceStep / 2) {
          take(frame, time);
          while (next <= time + sourceStep / 2) next += step;
        }
      } catch (e) {
        failure = e;
      } finally {
        frame.close();
      }
    },
    error: (e) => { failure = e; },
  });
  decoder.configure(config);
  for (let i = 0; i < blocks.length && !failure; i++) {
    const b = blocks[i];
    decoder.decode(new EncodedVideoChunk({ type: b.keyframe ? 'key' : 'delta', timestamp: Math.round(b.time * 1000), data: b.data }));
    // Do not queue more than the decoder can hold.
    while (decoder.decodeQueueSize > 8 && !failure) await new Promise((r) => setTimeout(r, 4));
    if (i % 30 === 0) onProgress?.(i / blocks.length * 0.8);
  }
  if (!failure) await decoder.flush().catch((e) => { failure = e; });
  decoder.close();
  if (failure) throw new Error(`The GIF could not be made: ${failure.message || failure}`);
  if (!held) throw new Error('Nothing is recorded yet. Play for a moment, then try again.');
  encoder.addFrame(held.pixels, Math.max(step, clip.duration - held.time));
  onProgress?.(0.9);
  // Let the page show the progress before the encoder takes the thread.
  await new Promise((r) => setTimeout(r, 0));
  return encoder.finish();
}

// ---------------------------------------------------------------------------

/** "Lamplight 2026-11-10 14-03-05.webm": the game's title and when. */
export function clipName(title, date, ext) {
  const safe = String(title || '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim() || 'Smitten game';
  const two = (n) => String(n).padStart(2, '0');
  const when = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`;
  return `${safe} ${when}.${ext}`;
}

/** Downloads a Blob as a file. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
