// Pixel drawing on straight RGBA buffers. Colors are [r, g, b, a] and
// replace pixels (no blending), as pixel editors do.

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

/** Rectangle between two corners (inclusive). */
export function rect(x0, y0, x1, y1, filled, plot) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  if (filled) {
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) plot(x, y);
    return;
  }
  for (let x = ax; x <= bx; x++) { plot(x, ay); if (by !== ay) plot(x, by); }
  for (let y = ay + 1; y < by; y++) { plot(ax, y); if (bx !== ax) plot(bx, y); }
}

/**
 * Ellipse inscribed in the rectangle between two corners (inclusive), after
 * Alois Zingl's "plotEllipseRect", which handles even and odd sizes exactly.
 */
export function ellipse(x0, y0, x1, y1, filled, plot) {
  const spans = new Map(); // y -> [minX, maxX]
  const put = (x, y) => {
    const s = spans.get(y);
    if (!s) spans.set(y, [x, x]);
    else { if (x < s[0]) s[0] = x; if (x > s[1]) s[1] = x; }
    if (!filled) plot(x, y);
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
    put(x1, y0); put(x0, y0); put(x0, y1); put(x1, y1);
    e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
  } while (x0 <= x1);
  while (y0 - y1 <= b) {
    put(x0 - 1, y0); put(x1 + 1, y0++); put(x0 - 1, y1); put(x1 + 1, y1--);
  }
  if (filled) for (const [y, [mn, mx]] of spans) for (let x = mn; x <= mx; x++) plot(x, y);
}

/**
 * Flood fill from (x, y) with color: the contiguous area (4-way) of pixels
 * exactly equal to the start pixel, or, if global, every such pixel.
 * inside(x, y) limits where it may paint. Returns whether anything changed.
 */
export function fill(buf, w, h, x, y, color, global, inside = () => true) {
  if (x < 0 || y < 0 || x >= w || y >= h || !inside(x, y)) return false;
  const i0 = (y * w + x) * 4;
  const t0 = buf[i0], t1 = buf[i0 + 1], t2 = buf[i0 + 2], t3 = buf[i0 + 3];
  const [c0, c1, c2, c3] = color;
  // Fully transparent pixels count as equal whatever their RGB.
  const match = (i) => (t3 === 0 ? buf[i + 3] === 0 : buf[i] === t0 && buf[i + 1] === t1 && buf[i + 2] === t2 && buf[i + 3] === t3);
  if (t3 === c3 && (c3 === 0 || (t0 === c0 && t1 === c1 && t2 === c2))) return false;
  const set = (i) => { buf[i] = c0; buf[i + 1] = c1; buf[i + 2] = c2; buf[i + 3] = c3; };
  if (global) {
    let changed = false;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        if (match(i) && inside(px, py)) { set(i); changed = true; }
      }
    }
    return changed;
  }
  const seen = new Uint8Array(w * h);
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop(), px = stack.pop();
    if (seen[py * w + px]) continue;
    let lx = px;
    while (lx > 0 && !seen[py * w + lx - 1] && match((py * w + lx - 1) * 4) && inside(lx - 1, py)) lx--;
    let rx = px;
    while (rx < w - 1 && !seen[py * w + rx + 1] && match((py * w + rx + 1) * 4) && inside(rx + 1, py)) rx++;
    for (let cx = lx; cx <= rx; cx++) {
      seen[py * w + cx] = 1;
      set((py * w + cx) * 4);
    }
    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inRun = false;
      for (let cx = lx; cx <= rx; cx++) {
        const ok = !seen[ny * w + cx] && match((ny * w + cx) * 4) && inside(cx, ny);
        if (ok && !inRun) { stack.push(cx, ny); inRun = true; } else if (!ok) inRun = false;
      }
    }
  }
  return true;
}

/** Copy a w×h region of src (width sw) at (x, y) into a new buffer; out-of-range pixels are transparent. */
export function extract(src, sw, sh, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= sh) continue;
    for (let col = 0; col < w; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= sw) continue;
      const si = (sy * sw + sx) * 4, di = (row * w + col) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
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
    for (let col = 0; col < w; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= dw) continue;
      const si = (row * w + col) * 4;
      if (skipTransparent && src[si + 3] === 0) continue;
      const di = (dy * dw + dx) * 4;
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

export function equalBuffers(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function hexToRgba(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
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
