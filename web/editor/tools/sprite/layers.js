// Layers of an image: each layer has one image (a "cel") for each frame,
// bottom layer first, the way they are drawn. The game draws the flattened
// result: the visible layers composited at their opacity, which the editor
// saves as the PNG. See docs/formats.md ("Sprites").

/** A layer: {name, opacity (0-1), hidden, cels: [Uint8ClampedArray per frame], extra (unknown file fields)}. */
export function newLayer(name, cels, { opacity = 1, hidden = false, extra = {} } = {}) {
  return { name, opacity, hidden, cels, extra };
}

/** True if the layers draw exactly the first layer's pixels (one visible layer at full opacity). */
export function isPlain(layers) {
  return layers.length === 1 && !layers[0].hidden && layers[0].opacity >= 1;
}

/** "Layer 3": the first such name not in use. */
export function freeLayerName(layers, base = 'Layer') {
  const names = new Set(layers.map((l) => l.name));
  for (let n = layers.length + 1; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * Composite the visible layers of one frame into dst (w×h, straight RGBA),
 * over box {x0, y0, x1, y1} (all of it if null). Each layer goes over the
 * ones below it ("normal" blending) at its opacity. Fully transparent
 * results are 0, 0, 0, 0.
 */
export function flatten(dst, layers, frame, w, h, box = null) {
  const x0 = box ? Math.max(0, box.x0) : 0, y0 = box ? Math.max(0, box.y0) : 0;
  const x1 = box ? Math.min(w, box.x1) : w, y1 = box ? Math.min(h, box.y1) : h;
  const shown = [], alphas = [];
  for (const l of layers) {
    if (l.hidden || !(l.opacity > 0) || !l.cels[frame]) continue;
    shown.push(l.cels[frame]);
    alphas.push(Math.min(1, l.opacity) / 255);
  }
  const n = shown.length;
  for (let y = y0; y < y1; y++) {
    for (let x = x0, j = (y * w + x0) * 4; x < x1; x++, j += 4) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < n; k++) {
        const s = shown[k];
        const sa = s[j + 3] * alphas[k];
        if (sa <= 0) continue;
        if (sa >= 1) { r = s[j]; g = s[j + 1]; b = s[j + 2]; a = 1; continue; }
        const da = a * (1 - sa);
        const na = sa + da;
        const ws = sa / na, wd = da / na;
        r = s[j] * ws + r * wd;
        g = s[j + 1] * ws + g * wd;
        b = s[j + 2] * ws + b * wd;
        a = na;
      }
      if (a * 255 < 0.5) { dst[j] = 0; dst[j + 1] = 0; dst[j + 2] = 0; dst[j + 3] = 0; continue; }
      dst[j] = r; dst[j + 1] = g; dst[j + 2] = b; dst[j + 3] = a * 255;
    }
  }
  return dst;
}

/** A frame of the layers flattened into a new buffer. */
export function flattenFrame(layers, frame, w, h) {
  return flatten(new Uint8ClampedArray(w * h * 4), layers, frame, w, h);
}

/**
 * True if two RGBA buffers show the same image: each channel within
 * `tolerance`, and every fully transparent pixel the same as any other.
 */
export function sameImage(a, b, tolerance = 1) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    if (Math.abs(a[i] - b[i]) > tolerance || Math.abs(a[i + 1] - b[i + 1]) > tolerance
      || Math.abs(a[i + 2] - b[i + 2]) > tolerance || Math.abs(a[i + 3] - b[i + 3]) > tolerance) return false;
  }
  return true;
}
