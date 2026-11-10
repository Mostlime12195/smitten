// Writes the sprites of tools/scene-tests/sprites/ with the sprite editor's
// own code (web/editor/tools/sprite): a sprite with layers (one at 50%
// opacity, one hidden) and a line drawn with the mirror, and a walk cycle
// cut from a sprite sheet with a margin and spacing. It also writes
// expected.json: what the game must draw (the layers flattened, on white).
// The "sprites" scene test checks the engine against it.
//
//   node tools/scene-tests/make-sprites-fixture.mjs
//
// Run it again after changing how the editor flattens layers or cuts sheets.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpriteDoc, encodeSprite } from '../../web/editor/tools/sprite/doc.js';
import { newLayer } from '../../web/editor/tools/sprite/layers.js';
import { Mask, pixelLine, composite, mirrorSegments } from '../../web/editor/tools/sprite/draw.js';
import { sheetGrid, cutSheet } from '../../web/editor/tools/sprite/sheet.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'sprites');
mkdirSync(join(dir, 'art'), { recursive: true });

const fill = (w, h, f) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y); if (c) d.set(c, (y * w + x) * 4); }
  return d;
};

async function save(doc, name) {
  const { png, json } = await encodeSprite(doc, `art/${name}.png`, `art/${name}.sprite`, true);
  writeFileSync(join(dir, 'art', `${name}.png`), png);
  writeFileSync(join(dir, 'art', `${name}.sprite`), json);
}

// What a pixel looks like drawn on white (the test clears its canvas to white).
const onWhite = ([r, g, b, a]) => [r, g, b].map((v) => Math.round((v * a + 255 * (255 - a)) / 255));

// hero: 8×8, two frames, three layers (bottom first).
const W = 8, H = 8;
const hero = new SpriteDoc(W, H, [fill(W, H, () => [0, 0, 255, 255]), fill(W, H, () => [0, 200, 0, 255])]);
hero.layers[0].name = 'Body';
// A black line at x = 1 (rows 5 to 7), drawn with the mirror on: it is also at x = 6.
{
  const m = new Mask(W, H);
  for (const [s, t] of mirrorSegments({ x: 1, y: 5, fx: 1.5, fy: 5.5 }, { x: 1, y: 7, fx: 1.5, fy: 7.5 }, W / 2, H / 2, true, false)) pixelLine(m, s.x, s.y, t.x, t.y, 1, null);
  const base = hero.layers[0].cels[0].slice();
  composite(hero.layers[0].cels[0], base, m, W, { x0: 0, y0: 0, x1: W, y1: H }, [0, 0, 0, 255], 1, false);
}
hero.layers.push(newLayer('Shade', [fill(W, H, (x) => (x < 4 ? [255, 0, 0, 255] : null)), fill(W, H, () => null)], { opacity: 0.5 }));
hero.layers.push(newLayer('Hidden', [fill(W, H, () => [255, 255, 255, 255]), fill(W, H, () => [255, 255, 255, 255])], { hidden: true }));
hero.changed();
hero.animations.push({ name: 'idle', frames: [0, 1], fps: 4, loop: true, extra: {} });
await save(hero, 'hero');

const points = [[2, 1], [6, 1], [1, 6], [6, 6], [3, 3]];
const expected = { hero: hero.frames.map((f) => points.map(([x, y]) => ({ x, y, rgb: onWhite([...f.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]) }))) };

// walk: a sheet of 3 cells of 6×6, a margin of 2 and spacing of 1, cut into frames.
{
  const fw = 6, fh = 6, m = 2, sp = 1, n = 3;
  const SW = 2 * m + n * fw + (n - 1) * sp, SH = 2 * m + fh;
  const colors = [[250, 60, 60, 255], [60, 250, 60, 255], [60, 60, 250, 255]];
  const sheet = fill(SW, SH, (x, y) => {
    const c = Math.floor((x - m) / (fw + sp));
    const inCell = x >= m && y >= m && y < m + fh && (x - m) % (fw + sp) < fw && c < n;
    return inCell ? colors[c] : [40, 40, 40, 255];
  });
  const grid = sheetGrid(SW, SH, { by: 'size', frameWidth: fw, frameHeight: fh, margin: m, spacing: sp });
  const walk = SpriteDoc.blank(16, 16, 1);
  const added = walk.importFrames(cutSheet(sheet, SW, SH, grid), grid.fw, grid.fh, { replace: true });
  walk.animations.push({ name: 'walk', frames: added, fps: 10, loop: true, extra: {} });
  await save(walk, 'walk');
  expected.walk = colors.map((c) => ({ x: 0, y: 0, rgb: c.slice(0, 3) }));
}

writeFileSync(join(dir, 'expected.json'), `${JSON.stringify(expected, null, 1)}\n`);
console.log('wrote', join(dir, 'art'), 'and expected.json');
