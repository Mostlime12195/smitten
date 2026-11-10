// Palettes: the nearest palette color to a color, painting locked to a
// palette, and the colors of an image (to make a palette from it).

import { hexToRgba, rgbaToHex } from './draw.js';

/** sRGB (0-255) to OKLab [L, a, b], a color space where distance matches how different colors look. */
export function oklab(r, g, b) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** How different two colors look: squared distance in OKLab. */
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const p = oklab(r1, g1, b1), q = oklab(r2, g2, b2);
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
}

/** Index of the palette color ([[r, g, b], ...]) nearest to r, g, b; the first one on a tie. */
export function nearestIndex(colors, r, g, b) {
  const p = oklab(r, g, b);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    const q = c.lab || oklab(c[0], c[1], c[2]);
    const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * A palette to snap to, from '#rrggbb' strings: {colors, nearest(r, g, b) ->
 * [r, g, b]}. It remembers the answers, so a stroke of one color is fast.
 * Returns null for an empty palette.
 */
export function makeSnapper(hexes) {
  const colors = hexes.map((h) => hexToRgba(h)).filter(Boolean).map((c) => {
    const rgb = [c[0], c[1], c[2]];
    rgb.lab = oklab(c[0], c[1], c[2]); // worked out once
    return rgb;
  });
  if (!colors.length) return null;
  const cache = new Map();
  return {
    colors,
    nearest(r, g, b) {
      const key = (r << 16) | (g << 8) | b;
      let c = cache.get(key);
      if (!c) {
        c = colors[nearestIndex(colors, r, g, b)];
        if (cache.size > 65536) cache.clear();
        cache.set(key, c);
      }
      return c;
    },
  };
}

/** A color [r, g, b, a] on the palette: the nearest color, fully opaque (transparent stays transparent). */
export function snapColor(snapper, color) {
  if (!snapper || color[3] === 0) return color.slice();
  const [r, g, b] = snapper.nearest(color[0], color[1], color[2]);
  return [r, g, b, 255];
}

/**
 * Put every pixel of a w-wide buffer in box on the palette: alpha under 128
 * becomes fully transparent, the rest fully opaque in the nearest palette
 * color. With a mask (a draw.Mask), only the pixels it covers change.
 */
export function snapPixels(buf, w, box, snapper, mask = null) {
  const md = mask ? mask.data : null;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0, p = y * w + box.x0; x < box.x1; x++, p++) {
      if (md && !md[p]) continue;
      const j = p * 4;
      if (buf[j + 3] < 128) { buf[j] = 0; buf[j + 1] = 0; buf[j + 2] = 0; buf[j + 3] = 0; continue; }
      const c = snapper.nearest(buf[j], buf[j + 1], buf[j + 2]);
      buf[j] = c[0]; buf[j + 1] = c[1]; buf[j + 2] = c[2]; buf[j + 3] = 255;
    }
  }
}

/**
 * The colors of an image ('#rrggbb', ignoring alpha) of the pixels that are
 * at least half opaque, the most used first, at most `max`. Returns
 * {colors, total}: total is the number of different colors found.
 */
export function imageColors(data, max = 64) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const colors = sorted.slice(0, max).map(([k]) => rgbaToHex([(k >> 16) & 255, (k >> 8) & 255, k & 255, 255]));
  return { colors, total: counts.size };
}
