// Tests for the sprite editor's drawing helpers (draw.js) that the fast
// paths depend on: flood fill and pixel lines.
//
//   node web/editor/tools/sprite/draw.test.mjs

import * as d from './draw.js';

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else { failed++; console.log(`FAIL ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); }
}
const count = (m) => m.data.reduce((n, v) => n + (v ? 1 : 0), 0);

// A 6×4 image with a red wall at x = 3.
const w = 6, h = 4;
const buf = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) buf.set([255, 0, 0, 255], (y * w + 3) * 4);

{
  const m = new d.Mask(w, h);
  const box = d.floodMask(m, buf, w, h, 0, 0, 0, true, null);
  check('fill: stops at the wall', count(m) === 12 && JSON.stringify(box) === '{"x0":0,"y0":0,"x1":3,"y1":4}', box);
  check('fill: a start pixel that is filled already does nothing', d.floodMask(m, buf, w, h, 1, 1, 0, true, null) === null && count(m) === 12);
  const g = new d.Mask(w, h);
  d.floodMask(g, buf, w, h, 5, 0, 0, false, null);
  check('fill: not contiguous fills all the matching pixels', count(g) === 20);
  const c = new d.Mask(w, h);
  d.floodMask(c, buf, w, h, 0, 0, 0, true, { x0: 0, y0: 0, x1: 2, y1: 2 });
  check('fill: stays in the selection', count(c) === 4);
  const big = new d.Mask(512, 512);
  const empty = new Uint8ClampedArray(512 * 512 * 4);
  d.floodMask(big, empty, 512, 512, 100, 100, 0, true, null);
  check('fill: a 512×512 image fills all of it', count(big) === 512 * 512);
}

{
  const m = new d.Mask(w, h);
  const box = d.pixelLine(m, 0, 0, 5, 3, 1, null);
  check('pixel line: one pixel for each step, no gaps', count(m) === 6 && m.data[0] && m.data[3 * w + 5], count(m));
  check('pixel line: its box', JSON.stringify(box) === '{"x0":0,"y0":0,"x1":6,"y1":4}', box);
  const s = new d.Mask(w, h);
  d.pixelLine(s, 2, 2, 2, 2, 3, null);
  check('pixel line: a 3-pixel brush is a 3×3 square', count(s) === 9 && s.data[1 * w + 1] && s.data[3 * w + 3]);
  const out = new d.Mask(w, h);
  check('pixel line: all outside the image does nothing', d.pixelLine(out, -10, -10, -5, -3, 2, null) === null && count(out) === 0);
  const clipped = new d.Mask(w, h);
  d.pixelLine(clipped, 0, 1, 5, 1, 1, { x0: 2, y0: 0, x1: 4, y1: 4 });
  check('pixel line: stays in the selection', count(clipped) === 2 && clipped.data[w + 2] && clipped.data[w + 3]);
  const sq = new d.Mask(w, h);
  d.square(sq, 2, 2, 2, null);
  check('pixel line: the same pixels as the square of the brush outline', count(sq) === 4 && sq.data[2 * w + 2] && sq.data[3 * w + 3]);
  const even = new d.Mask(w, h);
  d.pixelLine(even, 2, 2, 2, 2, 2, null);
  check('pixel line: an even brush puts the extra pixel right and down, as the square', even.data.every((v, i) => v === sq.data[i]));
}

// The fast paths: exact colors compared as 32-bit numbers, and full coverage written directly.
{
  const img = new Uint8ClampedArray(4 * 1 * 4);
  img.set([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 31, 255, 10, 20, 30, 255]);
  const m = new d.Mask(4, 1);
  d.floodMask(m, img, 4, 1, 0, 0, 0, true, null);
  check('fill, tolerance 0: stops at a color one step away', count(m) === 2, [...m.data]);
  const g = new d.Mask(4, 1);
  d.floodMask(g, img, 4, 1, 0, 0, 0, false, null);
  check('fill, tolerance 0, not contiguous: all the exact matches', count(g) === 3, [...g.data]);
  const t = new d.Mask(4, 1);
  d.floodMask(t, img, 4, 1, 0, 0, 2, true, null);
  check('fill, a small tolerance: goes over the near color', count(t) === 4, [...t.data]);
  const clear = new Uint8ClampedArray([1, 2, 3, 0, 9, 9, 9, 0, 5, 5, 5, 255]);
  const c = new d.Mask(3, 1);
  d.floodMask(c, clear, 3, 1, 0, 0, 0, true, null);
  check('fill, tolerance 0: every transparent pixel matches every other', count(c) === 2, [...c.data]);

  const base = new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 255, 255]);
  const dst = new Uint8ClampedArray(8);
  const mk = new d.Mask(2, 1);
  mk.data.set([255, 128]);
  d.composite(dst, base, mk, 2, { x0: 0, y0: 0, x1: 2, y1: 1 }, [255, 0, 0, 255], 1, false);
  check('composite: full coverage puts the exact color', [...dst.subarray(0, 4)].join() === '255,0,0,255', [...dst]);
  check('composite: half coverage mixes', dst[4] > 100 && dst[4] < 160 && dst[6] > 100 && dst[7] === 255, [...dst]);
  d.composite(dst, base, mk, 2, { x0: 0, y0: 0, x1: 2, y1: 1 }, [0, 0, 0, 0], 1, true);
  check('composite: a full erase makes the pixel transparent', [...dst.subarray(0, 4)].join() === '0,0,0,0' && dst[7] > 0 && dst[7] < 255, [...dst]);
  d.composite(dst, base, mk, 2, { x0: 0, y0: 0, x1: 2, y1: 1 }, [255, 0, 0, 255], 0.5, false);
  check('composite: at 50% opacity, full coverage still mixes', dst[0] > 100 && dst[0] < 160, [...dst]);
}

// Pen pressure: how much of the brush a pressure gives, and partial coverage.
{
  check('pressureScale: no pressure gives the lightest part', d.pressureScale(0, 0.25) === 0.25);
  check('pressureScale: full pressure gives all of it', d.pressureScale(1, 0.25) === 1);
  check('pressureScale: half way', Math.abs(d.pressureScale(0.5, 0.2) - 0.6) < 1e-9);
  check('pressureScale: out of range is clamped', d.pressureScale(2, 0) === 1 && d.pressureScale(-1, 0.5) === 0.5);
  const m = new d.Mask(8, 8);
  d.capsule(m, 4, 4, 4, 4, 3, 1, null, 0.5);
  check('capsule with strength 0.5: half coverage in the middle', m.data[4 * 8 + 4] === 128, m.data[4 * 8 + 4]);
  d.capsule(m, 4, 4, 4, 4, 3, 1, null, 1);
  check('capsule: a stronger dab over it wins (the most coverage stays)', m.data[4 * 8 + 4] === 255);
  const p = new d.Mask(8, 8);
  d.pixelLine(p, 1, 1, 5, 1, 1, null, 0.5);
  d.pixelLine(p, 3, 1, 3, 1, 1, null, 0.25);
  check('pixel line with strength: partial coverage, a weaker dab does not lower it', p.data[9] === 128 && p.data[11] === 128, [...p.data.subarray(8, 16)]);
}

console.log(`draw.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
