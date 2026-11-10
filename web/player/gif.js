// A small animated GIF encoder, for clips (web/player/clips.js).
//
//   const gif = new GifEncoder(width, height);
//   gif.addFrame(rgba, 66);          // RGBA pixels (width * height * 4), shown for 66 ms
//   const bytes = gif.finish();      // Uint8Array: a GIF89a that loops
//
// Frames are kept as 15-bit colors (5 bits for each of red, green and blue),
// so ten seconds of 480x270 at 15 frames per second take about 40 MB, and a
// histogram of those colors gives one palette for the whole clip: the exact
// colors when there are 255 or fewer (pixel art), else a median cut. Index
// 255 stays free for "unchanged": each frame stores only the rectangle that
// changed since the frame before, with the unchanged pixels in it
// transparent, which is what keeps GIFs of games small. Frames that do not
// change at all add their time to the frame before them.
//
// No dithering: dithered noise changes in every frame and costs much more
// than it gains at these sizes.

const BINS = 32768;
const TRANSPARENT = 255;

/** RGBA -> 15-bit color, 0bRRRRRGGGGGBBBBB. */
function pack15(r, g, b) {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

export class GifEncoder {
  /**
   * noise: how far (in 15-bit steps, 0 to 31) a pixel can move from what the
   * GIF shows before the GIF changes it. 1 keeps video noise (decoded clips
   * flicker by a step or two) from making every pixel change in every frame.
   */
  /*
   * snap: for pixel art from a video, the colors within this distance (the
   * sum of the red, green and blue differences, 0 to 765) of a more common
   * color become that color, so video noise does not add colors or make
   * still pixels change. 0 (the default) keeps every color.
   */
  constructor(width, height, { noise = 1, loop = 0, snap = 0 } = {}) {
    if (!(width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error(`a GIF must be 1 to 65535 pixels wide and high, not ${width}x${height}`);
    this.width = width | 0;
    this.height = height | 0;
    this.noise = noise;
    this.loop = loop;
    this.snap = snap;
    this.frames = [];
    this.count = new Float64Array(BINS);
    this.sums = new Float64Array(BINS * 3);
  }

  /** rgba: width * height * 4 bytes; delayMs: how long it shows. */
  addFrame(rgba, delayMs) {
    const n = this.width * this.height;
    if (rgba.length < n * 4) throw new Error(`a frame needs ${n * 4} bytes of RGBA, it has ${rgba.length}`);
    const px = new Uint16Array(n);
    const { count, sums } = this;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
      const c = pack15(r, g, b);
      px[i] = c;
      count[c]++;
      sums[c * 3] += r;
      sums[c * 3 + 1] += g;
      sums[c * 3 + 2] += b;
    }
    this.frames.push({ px, delayMs: Math.max(0, delayMs) });
  }

  /** The GIF file. */
  finish() {
    if (!this.frames.length) throw new Error('a GIF needs at least one frame');
    const alias = this.snap > 0 ? snapColors(this.count, this.sums, this.snap) : null;
    const { palette, lookup } = makePalette(this.count, this.sums, 255);
    if (alias) for (let c = 0; c < BINS; c++) if (alias[c] !== c) lookup[c] = lookup[alias[c]];
    const out = new ByteWriter(1 << 16);
    const { width: w, height: h } = this;

    // Header, logical screen and the global palette (256 entries; 255 is
    // the transparent one).
    out.ascii('GIF89a');
    out.u16(w);
    out.u16(h);
    out.byte(0xf7);          // global table, 8 bits of color resolution, 256 entries
    out.byte(0);             // background color index
    out.byte(0);             // no aspect ratio
    for (let i = 0; i < 256; i++) {
      const c = palette[i] || [0, 0, 0];
      out.byte(c[0]);
      out.byte(c[1]);
      out.byte(c[2]);
    }
    // Loop forever (NETSCAPE2.0).
    out.bytes([0x21, 0xff, 0x0b]);
    out.ascii('NETSCAPE2.0');
    out.bytes([0x03, 0x01]);
    out.u16(this.loop);
    out.byte(0);

    // What the GIF shows now (15-bit colors, or palette indices with snap),
    // to compare each frame with.
    const shown = new Int32Array(w * h).fill(-1);
    const noise = this.noise;
    const key = alias ? (c) => lookup[c] : (c) => c;
    const near = alias ? (a, b) => a === b : (a, b) => b >= 0
      && Math.abs((a >> 10) - (b >> 10)) <= noise
      && Math.abs(((a >> 5) & 31) - ((b >> 5) & 31)) <= noise
      && Math.abs((a & 31) - (b & 31)) <= noise;

    // Frames, with their delays in hundredths of a second: rounded so the
    // total stays right (66.7 ms frames become 7, 7, 6, ...).
    const pending = [];
    let timeMs = 0;
    let doneCs = 0;
    for (const frame of this.frames) {
      const { px } = frame;
      // The rectangle that changed.
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i++) {
          if (!near(key(px[i]), shown[i])) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          }
        }
      }
      timeMs += frame.delayMs;
      if (x1 < 0 && pending.length) {
        // Nothing changed: the frame before shows for longer.
        pending[pending.length - 1].endMs = timeMs;
        continue;
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
      const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
      const indices = new Uint8Array(rw * rh);
      let transparent = false;
      for (let y = 0, k = 0; y < rh; y++) {
        let i = (y0 + y) * w + x0;
        for (let x = 0; x < rw; x++, i++, k++) {
          const c = key(px[i]);
          if (near(c, shown[i])) {
            indices[k] = TRANSPARENT;
            transparent = true;
          } else {
            indices[k] = lookup[px[i]];
            shown[i] = c;
          }
        }
      }
      pending.push({ x0, y0, rw, rh, indices, transparent, endMs: timeMs });
    }
    for (const f of pending) {
      const endCs = Math.round(f.endMs / 10);
      const delay = Math.max(0, Math.min(65535, endCs - doneCs));
      doneCs += delay;
      // Graphics control: keep the frame under the next one (disposal 1),
      // the delay, and index 255 transparent where it is used.
      out.bytes([0x21, 0xf9, 0x04, (1 << 2) | (f.transparent ? 1 : 0)]);
      out.u16(delay);
      out.byte(f.transparent ? TRANSPARENT : 0);
      out.byte(0);
      // Image descriptor: the rectangle, no palette of its own.
      out.byte(0x2c);
      out.u16(f.x0);
      out.u16(f.y0);
      out.u16(f.rw);
      out.u16(f.rh);
      out.byte(0);
      out.byte(8);  // LZW minimum code size
      const data = lzwEncode(f.indices, 8);
      for (let at = 0; at < data.length; at += 255) {
        const n = Math.min(255, data.length - at);
        out.byte(n);
        out.bytes(data.subarray(at, at + n));
      }
      out.byte(0);
    }
    out.byte(0x3b);
    return out.result();
  }
}

// ---------------------------------------------------------------------------
// The palette

/**
 * Moves each color into a more common one within `distance` (see snap),
 * in the histogram. Returns alias: for each 15-bit color, the one it became.
 */
export function snapColors(count, sums, distance) {
  const alias = new Int32Array(BINS);
  for (let c = 0; c < BINS; c++) alias[c] = c;
  const used = [];
  for (let c = 0; c < BINS; c++) if (count[c] > 0) used.push(c);
  used.sort((a, b) => count[b] - count[a]);
  const keep = [];  // [bin, r, g, b]
  for (const c of used) {
    const n = count[c];
    const r = sums[c * 3] / n, g = sums[c * 3 + 1] / n, b = sums[c * 3 + 2] / n;
    let to = -1;
    for (const k of keep) {
      if (Math.abs(k[1] - r) + Math.abs(k[2] - g) + Math.abs(k[3] - b) <= distance) { to = k[0]; break; }
    }
    if (to < 0) {
      // Not pixel art after all (too many colors): keep the rest as they are.
      if (keep.length < 1024) keep.push([c, r, g, b]);
      continue;
    }
    alias[c] = to;
    count[to] += n;
    for (let k = 0; k < 3; k++) sums[to * 3 + k] += sums[c * 3 + k];
    count[c] = 0;
    sums[c * 3] = sums[c * 3 + 1] = sums[c * 3 + 2] = 0;
  }
  return alias;
}

/**
 * count/sums: a histogram of 15-bit colors and the sums of their real RGB.
 * Returns {palette: [[r, g, b]...] (at most maxColors), lookup: Uint8Array
 * from 15-bit color to palette index}.
 */
export function makePalette(count, sums, maxColors = 255) {
  const used = [];
  for (let c = 0; c < BINS; c++) if (count[c] > 0) used.push(c);
  const lookup = new Uint8Array(BINS);
  const palette = [];
  const mean = (bins) => {
    let n = 0, r = 0, g = 0, b = 0;
    for (const c of bins) {
      n += count[c];
      r += sums[c * 3];
      g += sums[c * 3 + 1];
      b += sums[c * 3 + 2];
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };
  if (used.length <= maxColors) {
    // Few colors (pixel art): each keeps its own entry, at its real color.
    for (const c of used) {
      lookup[c] = palette.length;
      palette.push(mean([c]));
    }
    return { palette, lookup };
  }
  // Median cut: split the box with the most pixels times its widest side at
  // the pixel-weighted median of that side, until there are enough boxes.
  const channel = (c, k) => (k === 0 ? c >> 10 : k === 1 ? (c >> 5) & 31 : c & 31);
  const describe = (bins) => {
    let n = 0;
    const lo = [31, 31, 31], hi = [0, 0, 0];
    for (const c of bins) {
      n += count[c];
      for (let k = 0; k < 3; k++) {
        const v = channel(c, k);
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    const sides = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    // Green counts a little more: eyes see its steps best.
    const k = sides[1] * 1.2 >= sides[0] && sides[1] * 1.2 >= sides[2] ? 1 : sides[0] >= sides[2] ? 0 : 2;
    return { bins, n, k, score: bins.length > 1 ? n * (sides[k] + 1) : -1 };
  };
  const boxes = [describe(used)];
  while (boxes.length < maxColors) {
    let best = 0;
    for (let i = 1; i < boxes.length; i++) if (boxes[i].score > boxes[best].score) best = i;
    const box = boxes[best];
    if (box.score < 0) break;
    const { k } = box;
    const bins = box.bins.slice().sort((a, b) => channel(a, k) - channel(b, k));
    let half = box.n / 2, at = 0, acc = 0;
    while (at < bins.length - 1 && acc + count[bins[at]] <= half) acc += count[bins[at++]];
    if (at === 0) at = 1;
    // Do not split one value of the side between two boxes.
    const v = channel(bins[at], k);
    let cut = at;
    while (cut > 0 && channel(bins[cut - 1], k) === v) cut--;
    if (cut === 0) {
      cut = at;
      while (cut < bins.length && channel(bins[cut], k) === v) cut++;
    }
    boxes.splice(best, 1, describe(bins.slice(0, cut)), describe(bins.slice(cut)));
  }
  for (const box of boxes) {
    for (const c of box.bins) lookup[c] = palette.length;
    palette.push(mean(box.bins));
  }
  return { palette, lookup };
}

// ---------------------------------------------------------------------------
// LZW, as GIF uses it: variable-width codes (minCodeSize + 1 up to 12 bits),
// packed from the lowest bit, with a clear code when the table is full.

// The table: an entry for (prefix code, next index) when stamp holds the
// current generation, so a clear costs nothing.
let tableCodes = null;
let tableStamps = null;
let generation = 0;

/** indices: Uint8Array of palette indices. Returns the code bytes (before they are cut into sub-blocks). */
export function lzwEncode(indices, minCodeSize = 8) {
  if (!tableCodes) {
    tableCodes = new Uint16Array(1 << 20);
    tableStamps = new Uint32Array(1 << 20);
  }
  const codes = tableCodes, stamps = tableStamps;
  const clear = 1 << minCodeSize, end = clear + 1;
  const out = new ByteWriter(Math.max(64, indices.length >> 1));
  let bits = 0, nbits = 0;
  let size = minCodeSize + 1;
  let next = end + 1;
  const emit = (code) => {
    bits |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      out.byte(bits & 0xff);
      bits >>>= 8;
      nbits -= 8;
    }
  };
  const reset = () => {
    generation = (generation + 1) >>> 0;
    if (generation === 0) {
      stamps.fill(0);
      generation = 1;
    }
    size = minCodeSize + 1;
    next = end + 1;
  };
  reset();
  emit(clear);
  if (indices.length) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      if (stamps[key] === generation) {
        prefix = codes[key];
        continue;
      }
      emit(prefix);
      if (next < 4096) {
        codes[key] = next;
        stamps[key] = generation;
        next++;
        // The decoder adds each entry one code later than this, so it
        // widens its codes when the table reaches 2^size + 1 here.
        if (next > (1 << size) && size < 12) size++;
      } else {
        emit(clear);
        reset();
      }
      prefix = k;
    }
    emit(prefix);
  }
  emit(end);
  if (nbits > 0) out.byte(bits & 0xff);
  return out.result();
}

class ByteWriter {
  constructor(capacity) {
    this.buf = new Uint8Array(capacity);
    this.length = 0;
  }
  grow(n) {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(v) {
    if (this.length === this.buf.length) this.grow(1);
    this.buf[this.length++] = v;
  }
  bytes(list) {
    this.grow(list.length);
    this.buf.set(list, this.length);
    this.length += list.length;
  }
  u16(v) {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }
  ascii(s) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  result() {
    return this.buf.slice(0, this.length);
  }
}
