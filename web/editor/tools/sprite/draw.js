// Drawing on straight (non-premultiplied) RGBA8 buffers.
//
// Painting tools draw coverage into a Mask (one byte per pixel, combined with
// max() so a stroke never builds up where it crosses itself), then
// composite() blends the color through the mask, at the brush opacity, over
// the frame as it was when the stroke started. Smooth tools give antialiased
// coverage; pixel tools give only 0 or 255, so at full opacity they put the
// exact color, as pixel editors do.
//
// Rectangles ("boxes") are {x0, y0, x1, y1} with x1 and y1 exclusive.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** The part of a box inside a w×h image and the clip box (if any), or null. */
export function clipBox(x0, y0, x1, y1, w, h, clip) {
  x0 = Math.max(x0, 0, clip ? clip.x0 : 0);
  y0 = Math.max(y0, 0, clip ? clip.y0 : 0);
  x1 = Math.min(x1, w, clip ? clip.x1 : w);
  y1 = Math.min(y1, h, clip ? clip.y1 : h);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export class Mask {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
    this.box = null; // what has been drawn since the last clear
  }

  clear() {
    const b = this.box;
    if (!b) return;
    for (let y = b.y0; y < b.y1; y++) this.data.fill(0, y * this.w + b.x0, y * this.w + b.x1);
    this.box = null;
  }

  mark(box) {
    if (box) this.box = union(this.box, box);
    return box;
  }
}

// ---------------------------------------------------------------------------
// Smooth (antialiased) coverage

/**
 * A round brush dragged from (ax, ay) to (bx, by), in image coordinates
 * (pixel centers are at +0.5). hardness 1 gives a solid disc with a one-pixel
 * antialiased edge; lower values fade out from radius * hardness.
 */
export function capsule(mask, ax, ay, bx, by, radius, hardness, clip) {
  const { w, h, data } = mask;
  const R = Math.max(0.5, radius);
  const hard = hardness >= 1;
  const inner = R * clamp(hardness, 0, 1);
  const soft = Math.max(1, R + 0.5 - inner);
  const reach = hard ? R + 0.5 : Math.max(R + 0.5, inner + soft);
  const box = clipBox(Math.floor(Math.min(ax, bx) - reach), Math.floor(Math.min(ay, by) - reach),
    Math.ceil(Math.max(ax, bx) + reach), Math.ceil(Math.max(ay, by) + reach), w, h, clip);
  if (!box) return null;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const reach2 = reach * reach;
  for (let y = box.y0; y < box.y1; y++) {
    const py = y + 0.5 - ay;
    let i = y * w + box.x0;
    for (let x = box.x0; x < box.x1; x++, i++) {
      const px = x + 0.5 - ax;
      let t = len2 ? (px * dx + py * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - t * dx, qy = py - t * dy;
      const d2 = qx * qx + qy * qy;
      if (d2 >= reach2) continue;
      const d = Math.sqrt(d2);
      let c;
      if (hard) c = R + 0.5 - d;
      else {
        const u = (d - inner) / soft;
        c = u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
      }
      if (c <= 0) continue;
      const v = c >= 1 ? 255 : Math.round(c * 255);
      if (v > data[i]) data[i] = v;
    }
  }
  return mask.mark(box);
}

/** Length of the overlap of [a0, a1] and [b0, b1]. */
function overlap(a0, a1, b0, b1) {
  const v = Math.min(a1, b1) - Math.max(a0, b0);
  return v > 0 ? v : 0;
}

/**
 * A rectangle covering [L, R] × [T, B] (exact area coverage, so whole-number
 * bounds give hard edges), filled or as an outline `width` thick inside it.
 */
export function rectShape(mask, L, T, R, B, width, filled, clip) {
  const { w, h, data } = mask;
  const box = clipBox(Math.floor(L), Math.floor(T), Math.ceil(R), Math.ceil(B), w, h, clip);
  if (!box) return null;
  const hollow = !filled && L + width < R - width && T + width < B - width;
  const iL = L + width, iR = R - width, iT = T + width, iB = B - width;
  for (let y = box.y0; y < box.y1; y++) {
    const oy = overlap(y, y + 1, T, B);
    const iy = hollow ? overlap(y, y + 1, iT, iB) : 0;
    let i = y * w + box.x0;
    for (let x = box.x0; x < box.x1; x++, i++) {
      let c = overlap(x, x + 1, L, R) * oy;
      if (hollow) c -= overlap(x, x + 1, iL, iR) * iy;
      if (c <= 0) continue;
      const v = c >= 1 ? 255 : Math.round(c * 255);
      if (v > data[i]) data[i] = v;
    }
  }
  return mask.mark(box);
}

/** Coverage (0-1) of the pixel centered at (dx, dy) from an ellipse's center, antialiased. */
function ellipseCoverage(dx, dy, a, b) {
  const a2 = a * a, b2 = b * b;
  const F = (dx * dx) / a2 + (dy * dy) / b2 - 1;
  const gx = (2 * dx) / a2, gy = (2 * dy) / b2;
  const g = Math.sqrt(gx * gx + gy * gy);
  if (g < 1e-9) return F < 0 ? 1 : 0;
  const c = 0.5 - F / g; // F / |grad F| approximates the signed distance near the edge
  return c <= 0 ? 0 : c >= 1 ? 1 : c;
}

/** An antialiased ellipse inscribed in [L, R] × [T, B], filled or as an outline `width` thick inside it. */
export function ellipseShape(mask, L, T, R, B, width, filled, clip) {
  const { w, h, data } = mask;
  const box = clipBox(Math.floor(L) - 1, Math.floor(T) - 1, Math.ceil(R) + 1, Math.ceil(B) + 1, w, h, clip);
  if (!box) return null;
  const cx = (L + R) / 2, cy = (T + B) / 2;
  const a = Math.max(0.5, (R - L) / 2), b = Math.max(0.5, (B - T) / 2);
  const ia = a - width, ib = b - width;
  const hollow = !filled && ia > 0.25 && ib > 0.25;
  for (let y = box.y0; y < box.y1; y++) {
    const dy = y + 0.5 - cy;
    let i = y * w + box.x0;
    for (let x = box.x0; x < box.x1; x++, i++) {
      const dx = x + 0.5 - cx;
      let c = ellipseCoverage(dx, dy, a, b);
      if (c <= 0) continue;
      if (hollow) c -= ellipseCoverage(dx, dy, ia, ib);
      if (c <= 0) continue;
      const v = c >= 1 ? 255 : Math.round(c * 255);
      if (v > data[i]) data[i] = v;
    }
  }
  return mask.mark(box);
}

// ---------------------------------------------------------------------------
// Pixel (hard, no antialiasing) coverage

/** Bresenham line from (x0, y0) to (x1, y1), calling plot(x, y) for each pixel. */
export function line(x0, y0, x1, y1, plot) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** A size×size square of pixels around (cx, cy) (the extra pixel of an even size goes right and down). */
export function square(mask, cx, cy, size, clip) {
  const off = Math.floor((size - 1) / 2);
  const box = clipBox(cx - off, cy - off, cx - off + size, cy - off + size, mask.w, mask.h, clip);
  if (!box) return null;
  for (let y = box.y0; y < box.y1; y++) mask.data.fill(255, y * mask.w + box.x0, y * mask.w + box.x1);
  return mask.mark(box);
}

/**
 * A line of squares from pixel (x0, y0) to pixel (x1, y1) (Bresenham, so a
 * fast stroke has no gaps). Returns the box of the line (null if it is all
 * outside the image or the clip), without making objects for each pixel.
 */
export function pixelLine(mask, x0, y0, x1, y1, size, clip) {
  const off = Math.floor((size - 1) / 2);
  const area = clipBox(Math.min(x0, x1) - off, Math.min(y0, y1) - off, Math.max(x0, x1) - off + size, Math.max(y0, y1) - off + size, mask.w, mask.h, clip);
  if (!area) return null;
  const { data, w } = mask;
  line(x0, y0, x1, y1, (x, y) => {
    const ax0 = Math.max(x - off, area.x0), ax1 = Math.min(x - off + size, area.x1);
    if (ax1 <= ax0) return;
    const ye = Math.min(y - off + size, area.y1);
    for (let yy = Math.max(y - off, area.y0); yy < ye; yy++) data.fill(255, yy * w + ax0, yy * w + ax1);
  });
  return mask.mark(area);
}

function fillSpan(mask, y, xa, xb, clip, acc) {
  const box = clipBox(xa, y, xb + 1, y + 1, mask.w, mask.h, clip);
  if (!box) return acc;
  mask.data.fill(255, y * mask.w + box.x0, y * mask.w + box.x1);
  return union(acc, box);
}

/**
 * Pixels of the ellipse inscribed in the pixels (x0, y0)-(x1, y1) (inclusive),
 * after Alois Zingl's "plotEllipseRect", which handles even and odd sizes
 * exactly. Calls put(x, y) for each outline pixel; returns the filled spans
 * as a Map y -> [minX, maxX].
 */
export function ellipsePixels(x0, y0, x1, y1, put = () => {}) {
  const spans = new Map();
  const add = (x, y) => {
    const s = spans.get(y);
    if (!s) spans.set(y, [x, x]);
    else { if (x < s[0]) s[0] = x; if (x > s[1]) s[1] = x; }
    put(x, y);
  };
  let a = Math.abs(x1 - x0), b = Math.abs(y1 - y0), b1 = b & 1;
  let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a, e2;
  if (x0 > x1) { x0 = x1; x1 += a; }
  if (y0 > y1) y0 = y1;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a *= 8 * a;
  b1 = 8 * b * b;
  do {
    add(x1, y0); add(x0, y0); add(x0, y1); add(x1, y1);
    e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
  } while (x0 <= x1);
  while (y0 - y1 <= b) {
    add(x0 - 1, y0); add(x1 + 1, y0++); add(x0 - 1, y1); add(x1 + 1, y1--);
  }
  return spans;
}

/** A hard-edged ellipse in the pixels (x0, y0)-(x1, y1), filled or as an outline `width` pixels thick. */
export function pixelEllipse(mask, x0, y0, x1, y1, width, filled, clip) {
  let box = null;
  if (!filled && width <= 1) {
    ellipsePixels(x0, y0, x1, y1, (x, y) => { box = fillSpan(mask, y, x, x, clip, box); });
    return mask.mark(box);
  }
  const outer = ellipsePixels(x0, y0, x1, y1);
  const hollow = !filled && x1 - x0 > 2 * width && y1 - y0 > 2 * width;
  const inner = hollow ? ellipsePixels(x0 + width, y0 + width, x1 - width, y1 - width) : new Map();
  for (const [y, [a, b]] of outer) {
    const s = inner.get(y);
    if (!s) box = fillSpan(mask, y, a, b, clip, box);
    else {
      if (s[0] > a) box = fillSpan(mask, y, a, s[0] - 1, clip, box);
      if (s[1] < b) box = fillSpan(mask, y, s[1] + 1, b, clip, box);
    }
  }
  return mask.mark(box);
}

// ---------------------------------------------------------------------------
// Fill

// Shared by all fills (a fill is never in two places at once).
let fillBuffer = null;
const fillStack = [];
function fillScratch(n) {
  if (!fillBuffer || fillBuffer.length < n) fillBuffer = new Uint8Array(n);
  return fillBuffer;
}

/**
 * Flood fill coverage from pixel (x, y) of buf: the pixels whose color is
 * within `tolerance` (0-255, per channel, on premultiplied colors so every
 * fully transparent pixel matches every other) of the start pixel's;
 * touching ones (4-way) only if contiguous. Returns the box filled.
 */
export function floodMask(mask, buf, w, h, x, y, tolerance, contiguous, clip) {
  const area = clipBox(0, 0, w, h, w, h, clip);
  if (!area || x < area.x0 || y < area.y0 || x >= area.x1 || y >= area.y1) return null;
  const data = mask.data;
  const i0 = (y * w + x) * 4;
  const sa = buf[i0 + 3];
  const sr = (buf[i0] * sa) / 255, sg = (buf[i0 + 1] * sa) / 255, sb = (buf[i0 + 2] * sa) / 255;
  const t = tolerance + 0.5; // exact matches at 0 despite rounding
  let match = (p) => {
    const i = p * 4;
    const a = buf[i + 3];
    if (Math.abs(a - sa) > t) return false;
    return Math.abs((buf[i] * a) / 255 - sr) <= t && Math.abs((buf[i + 1] * a) / 255 - sg) <= t && Math.abs((buf[i + 2] * a) / 255 - sb) <= t;
  };
  // Tolerance 0: compare whole pixels as 32-bit numbers (every transparent pixel matches every other).
  const u32 = tolerance === 0 ? words(buf) : null;
  if (u32) {
    const target = u32[y * w + x];
    match = sa === 0 ? (p) => buf[p * 4 + 3] === 0 : (p) => u32[p] === target;
  }
  let bx0 = x, by0 = y, bx1 = x, by1 = y;
  if (!contiguous) {
    for (let py = area.y0; py < area.y1; py++) {
      for (let px = area.x0; px < area.x1; px++) {
        const p = py * w + px;
        if (!match(p)) continue;
        data[p] = 255;
        if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
        if (py < by0) by0 = py; if (py > by1) by1 = py;
      }
    }
    return mask.mark({ x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 });
  }
  if (data[y * w + x]) return null; // filled already (a mirror of this fill)
  // Pass 1: which pixels of the area match and are not filled yet, in one
  // byte buffer that all fills share. Pass 2: a scanline fill over it.
  const ok = fillScratch(w * h);
  const target = u32 ? u32[y * w + x] : 0;
  for (let py = area.y0; py < area.y1; py++) {
    let p = py * w + area.x0;
    const end = py * w + area.x1;
    if (u32 && sa !== 0) for (; p < end; p++) ok[p] = !data[p] && u32[p] === target ? 1 : 0;
    else if (u32) for (; p < end; p++) ok[p] = !data[p] && buf[p * 4 + 3] === 0 ? 1 : 0;
    else for (; p < end; p++) ok[p] = !data[p] && match(p) ? 1 : 0;
  }
  const stack = fillStack;
  stack.length = 0;
  stack.push(x, y);
  while (stack.length) {
    const py = stack.pop(), px = stack.pop();
    const row = py * w;
    if (!ok[row + px]) continue;
    let lx = px;
    while (lx > area.x0 && ok[row + lx - 1]) lx--;
    let rx = px;
    while (rx < area.x1 - 1 && ok[row + rx + 1]) rx++;
    data.fill(255, row + lx, row + rx + 1);
    ok.fill(0, row + lx, row + rx + 1);
    if (lx < bx0) bx0 = lx; if (rx > bx1) bx1 = rx;
    if (py < by0) by0 = py; if (py > by1) by1 = py;
    for (let ny = py - 1; ny <= py + 1; ny += 2) {
      if (ny < area.y0 || ny >= area.y1) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let cx = lx; cx <= rx; cx++) {
        if (ok[nrow + cx]) { if (!inRun) { stack.push(cx, ny); inRun = true; } } else inRun = false;
      }
    }
  }
  return mask.mark({ x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 });
}

// ---------------------------------------------------------------------------
// Compositing

/**
 * dst = base with color painted through the mask, over the box. opacity is
 * 0-1. erase lowers alpha instead (fully erased pixels become 0, 0, 0, 0).
 * Pixels the mask doesn't cover get base back, so this can be repeated over
 * any box as the mask changes.
 */
export function composite(dst, base, mask, w, box, color, opacity, erase) {
  const md = mask.data;
  const [cr, cg, cb, ca] = color;
  const k = (opacity * (erase ? 1 : ca / 255)) / 255;
  // Full coverage of an opaque color (or a full erase) puts the color as it is.
  const solid = k * 255 >= 1;
  for (let y = box.y0; y < box.y1; y++) {
    let p = y * w + box.x0;
    for (let x = box.x0; x < box.x1; x++, p++) {
      const j = p * 4;
      const m = md[p];
      if (m === 255 && solid) {
        if (erase) { dst[j] = 0; dst[j + 1] = 0; dst[j + 2] = 0; dst[j + 3] = 0; } else { dst[j] = cr; dst[j + 1] = cg; dst[j + 2] = cb; dst[j + 3] = 255; }
        continue;
      }
      const br = base[j], bg = base[j + 1], bb = base[j + 2], ba = base[j + 3];
      const sa = m * k;
      if (sa <= 0) {
        dst[j] = br; dst[j + 1] = bg; dst[j + 2] = bb; dst[j + 3] = ba;
        continue;
      }
      if (erase) {
        const na = ba * (1 - sa);
        if (na < 0.5) { dst[j] = 0; dst[j + 1] = 0; dst[j + 2] = 0; dst[j + 3] = 0; } else { dst[j] = br; dst[j + 1] = bg; dst[j + 2] = bb; dst[j + 3] = na; }
        continue;
      }
      const bA = (ba / 255) * (1 - sa);
      const oa = sa + bA;
      const ws = sa / oa, wb = bA / oa;
      dst[j] = cr * ws + br * wb;
      dst[j + 1] = cg * ws + bg * wb;
      dst[j + 2] = cb * ws + bb * wb;
      dst[j + 3] = oa * 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Whole-buffer helpers

/** Copy a w×h region of src (width sw) at (x, y) into a new buffer; out-of-range pixels are transparent. */
export function extract(src, sw, sh, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= sh) continue;
    const c0 = Math.max(0, -x), c1 = Math.min(w, sw - x);
    if (c1 <= c0) continue;
    out.set(src.subarray((sy * sw + x + c0) * 4, (sy * sw + x + c1) * 4), (row * w + c0) * 4);
  }
  return out;
}

/**
 * Put a w×h buffer onto dst (dw×dh) at (x, y). With skipTransparent,
 * fully transparent source pixels leave the destination alone.
 */
export function stamp(dst, dw, dh, src, x, y, w, h, skipTransparent = false) {
  for (let row = 0; row < h; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= dh) continue;
    const c0 = Math.max(0, -x), c1 = Math.min(w, dw - x);
    if (c1 <= c0) continue;
    if (!skipTransparent) {
      dst.set(src.subarray((row * w + c0) * 4, (row * w + c1) * 4), (dy * dw + x + c0) * 4);
      continue;
    }
    for (let col = c0; col < c1; col++) {
      const si = (row * w + col) * 4;
      if (src[si + 3] === 0) continue;
      const di = (dy * dw + x + col) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
}

/** Mirror a w×h buffer in place horizontally or vertically. */
export function flip(buf, w, h, horizontal) {
  const out = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = horizontal ? w - 1 - x : x, sy = horizontal ? y : h - 1 - y;
      out.set(buf.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  buf.set(out);
}

function words(a) {
  return a.byteOffset % 4 === 0 ? new Uint32Array(a.buffer, a.byteOffset, a.length >> 2) : null;
}

/** The smallest {x, y, w, h} holding every pixel that differs between two w×h buffers, or null. */
export function diffRect(a, b, w, h) {
  const A = words(a), B = words(b);
  const differs = A && B ? (p) => A[p] !== B[p] : (p) => a[p * 4] !== b[p * 4] || a[p * 4 + 1] !== b[p * 4 + 1] || a[p * 4 + 2] !== b[p * 4 + 2] || a[p * 4 + 3] !== b[p * 4 + 3];
  let x0 = w, y0 = -1, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let first = -1;
    for (let x = 0; x < w; x++) if (differs(row + x)) { first = x; break; }
    if (first < 0) continue;
    let last = first;
    for (let x = w - 1; x > first; x--) if (differs(row + x)) { last = x; break; }
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
    if (y0 < 0) y0 = y;
    y1 = y;
  }
  return y0 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function equalBuffers(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Tent-filter weights taking sn samples to dn (an area average when shrinking). */
function filterWeights(sn, dn) {
  const scale = dn / sn;
  const r = scale < 1 ? 1 / scale : 1;
  const out = [];
  for (let o = 0; o < dn; o++) {
    const c = (o + 0.5) / scale - 0.5;
    const idx = [], wts = [];
    let sum = 0;
    for (let i = Math.ceil(c - r); i <= Math.floor(c + r); i++) {
      const wt = 1 - Math.abs(i - c) / r;
      if (wt <= 0) continue;
      idx.push(clamp(i, 0, sn - 1));
      wts.push(wt);
      sum += wt;
    }
    if (!sum) { idx.push(clamp(Math.round(c), 0, sn - 1)); wts.push(1); sum = 1; }
    out.push({ idx, wts: wts.map((v) => v / sum), lo: Math.min(...idx) });
  }
  return out;
}

/**
 * Scale an sw×sh image to dw×dh: smooth (filtered, on premultiplied colors)
 * or by nearest pixel (keeps hard pixel edges and exact colors).
 */
export function resample(src, sw, sh, dw, dh, smooth) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  if (!smooth) {
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
        const si = (sy * sw + sx) * 4, di = (y * dw + x) * 4;
        out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
      }
    }
    return out;
  }
  const wx = filterWeights(sw, dw), wy = filterWeights(sh, dh);
  // Source rows scaled horizontally, kept while output rows still need them.
  const rows = new Map();
  const row = (sy) => {
    let r = rows.get(sy);
    if (r) return r;
    r = new Float32Array(dw * 4);
    const base = sy * sw * 4;
    for (let x = 0; x < dw; x++) {
      const { idx, wts } = wx[x];
      let R = 0, G = 0, B = 0, A = 0;
      for (let k = 0; k < idx.length; k++) {
        const i = base + idx[k] * 4;
        const a = (src[i + 3] / 255) * wts[k];
        R += src[i] * a; G += src[i + 1] * a; B += src[i + 2] * a; A += a;
      }
      r[x * 4] = R; r[x * 4 + 1] = G; r[x * 4 + 2] = B; r[x * 4 + 3] = A;
    }
    rows.set(sy, r);
    return r;
  };
  const acc = new Float32Array(dw * 4);
  for (let y = 0; y < dh; y++) {
    const { idx, wts, lo } = wy[y];
    for (const k of rows.keys()) if (k < lo) rows.delete(k);
    acc.fill(0);
    for (let k = 0; k < idx.length; k++) {
      const r = row(idx[k]);
      const wt = wts[k];
      for (let i = 0; i < acc.length; i++) acc[i] += r[i] * wt;
    }
    for (let x = 0; x < dw; x++) {
      const a = acc[x * 4 + 3];
      const di = (y * dw + x) * 4;
      if (a * 255 < 0.5) continue;
      out[di] = acc[x * 4] / a; out[di + 1] = acc[x * 4 + 1] / a; out[di + 2] = acc[x * 4 + 2] / a; out[di + 3] = a * 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colors: [r, g, b, a] with 0-255 channels

export function hexToRgba(hex) {
  let s = String(hex).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = [...s].map((c) => c + c).join('');
  const m = /^([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}

export function rgbaToHex([r, g, b, a]) {
  const hx = (v) => v.toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}${a === 255 ? '' : hx(a)}`;
}

export function cssColor([r, g, b, a]) {
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

/** h 0-360, s and v 0-1 -> [r, g, b] 0-255 */
export function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return [f(5), f(3), f(1)];
}

/** [r, g, b] 0-255 -> [h 0-360, s 0-1, v 0-1] */
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
