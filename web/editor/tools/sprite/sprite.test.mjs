// Tests for the sprite editor's pure parts: layers and flattening, mirror
// drawing, the selection's lifted pixels, palettes, cutting sprite sheets,
// and reading and writing .sprite files (old files stay the same).
//
//   node web/editor/tools/sprite/sprite.test.mjs [more .sprite files or game folders]
//
// Extra arguments: folders (or .sprite files) whose sprites must round-trip
// unchanged, for example an unzipped published game.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SpriteDoc, loadSprite, encodeSprite, spritePaths, sameSnapshot } from './doc.js';
import { newLayer, isPlain, flatten, flattenFrame, sameImage, freeLayerName } from './layers.js';
import { mirrorPoint, mirrorSegments, rotate90 } from './draw.js';
import { lift, drop, moved, rotated, flipped, pastePosition } from './select.js';
import { nearestIndex, makeSnapper, snapColor, snapPixels, imageColors } from './palette.js';
import { sheetGrid, cutSheet, cellPixels, filledCells } from './sheet.js';
import { encodePNGSync, decodePNG } from './png.js';

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const px = (buf, w, x, y) => [...buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
function image(w, h, paint) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint(x, y); if (c) d.set(c, (y * w + x) * 4); }
  return d;
}
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], CLEAR = [0, 0, 0, 0];

// A host over a map of files, as tool-host.js gives the editor.
function host(files) {
  return { read: (p) => files.get(p), exists: (p) => files.has(p), write: async (p, d) => { files.set(p, d); } };
}

// ---------------------------------------------------------------------------
// Layers

{
  const w = 2, h = 1;
  const bottom = newLayer('Bottom', [image(w, h, () => BLUE)]);
  const top = newLayer('Top', [image(w, h, (x) => (x === 0 ? RED : null))]);
  const out = flattenFrame([bottom, top], 0, w, h);
  check('flatten: an opaque top pixel covers the bottom', eq(px(out, w, 0, 0), RED), px(out, w, 0, 0));
  check('flatten: a transparent top pixel shows the bottom', eq(px(out, w, 1, 0), BLUE), px(out, w, 1, 0));
  top.opacity = 0.5;
  const half = flattenFrame([bottom, top], 0, w, h);
  check('flatten: a top layer at 50% opacity mixes half and half', eq(px(half, w, 0, 0), [128, 0, 128, 255]) || eq(px(half, w, 0, 0), [127, 0, 128, 255]), px(half, w, 0, 0));
  top.opacity = 1;
  top.hidden = true;
  check('flatten: a hidden layer does not show', eq(px(flattenFrame([bottom, top], 0, w, h), w, 0, 0), BLUE));
  bottom.hidden = true;
  check('flatten: all hidden is transparent', eq(px(flattenFrame([bottom, top], 0, w, h), w, 0, 0), CLEAR));
  // A half-transparent layer alone keeps its pixels exactly.
  const ghost = newLayer('Ghost', [image(1, 1, () => [10, 200, 30, 77])]);
  check('flatten: one plain layer gives its own pixels', eq(px(flattenFrame([ghost], 0, 1, 1), 1, 0, 0), [10, 200, 30, 77]));
  // Two half-transparent layers: alpha = a + b(1 - a).
  const a = newLayer('a', [image(1, 1, () => [255, 0, 0, 128])]), b = newLayer('b', [image(1, 1, () => [0, 0, 255, 128])]);
  const ab = px(flattenFrame([a, b], 0, 1, 1), 1, 0, 0);
  check('flatten: two half-transparent layers', Math.abs(ab[3] - 192) <= 1 && ab[2] > ab[0], ab);
  // Only the box changes.
  const dst = new Uint8ClampedArray(2 * 2 * 4).fill(7);
  flatten(dst, [newLayer('x', [image(2, 2, () => RED)])], 0, 2, 2, { x0: 1, y0: 1, x1: 2, y1: 2 });
  check('flatten: only inside the box', eq(px(dst, 2, 0, 0), [7, 7, 7, 7]) && eq(px(dst, 2, 1, 1), RED));
  check('isPlain', isPlain([newLayer('a', [])]) && !isPlain([newLayer('a', [], { opacity: 0.5 })]) && !isPlain([newLayer('a', []), newLayer('b', [])]));
  check('freeLayerName', freeLayerName([{ name: 'Layer 1' }, { name: 'Layer 2' }]) === 'Layer 3' && freeLayerName([{ name: 'Layer 2' }]) === 'Layer 3');
  check('sameImage: transparent pixels are all the same', sameImage(new Uint8ClampedArray([5, 5, 5, 0]), new Uint8ClampedArray([0, 0, 0, 0])));
}

// The doc with layers: frames are the layer itself until there is more than one plain layer.
{
  const doc = SpriteDoc.blank(4, 4, 2);
  check('doc: one plain layer: frames are its buffers', doc.frames[0] === doc.layers[0].cels[0] && !doc.layered);
  doc.layers[0].cels[0].set(RED, 0);
  doc.addLayer(1);
  check('doc: addLayer makes empty frames for each frame', doc.layers.length === 2 && doc.layers[1].cels.length === 2 && doc.layered);
  check('doc: the new layer is called Layer 2', doc.layers[1].name === 'Layer 2');
  check('doc: with two layers, frames are flattened copies', doc.frames[0] !== doc.layers[0].cels[0] && eq(px(doc.frames[0], 4, 0, 0), RED));
  doc.layers[1].cels[0].set(BLUE, 0);
  doc.reflatten(0, { x0: 0, y0: 0, x1: 1, y1: 1 });
  check('doc: reflatten shows the top layer', eq(px(doc.frames[0], 4, 0, 0), BLUE));
  const before = doc.snapshot();
  doc.insertFrame(1);
  check('doc: insertFrame adds a frame to every layer', doc.count === 3 && doc.layers.every((l) => l.cels.length === 3));
  doc.moveFrame(0, 2);
  check('doc: moveFrame moves every layer', eq(px(doc.layers[0].cels[2], 4, 0, 0), RED) && eq(px(doc.layers[1].cels[2], 4, 0, 0), BLUE));
  doc.deleteFrame(2);
  check('doc: deleteFrame removes it from every layer', doc.count === 2 && doc.layers.every((l) => l.cels.length === 2));
  doc.restore(before);
  check('doc: restore brings the layers back', doc.count === 2 && eq(px(doc.frames[0], 4, 0, 0), BLUE) && sameSnapshot(before, doc.snapshot()));
  doc.layers[1].opacity = 0.5;
  check('doc: snapshots differ when an opacity changes', !sameSnapshot(before, doc.snapshot()));
  doc.mergeDown(1);
  check('doc: mergeDown leaves one layer with the mix', doc.layers.length === 1 && eq(px(doc.frames[0], 4, 0, 0), [128, 0, 128, 255]) || eq(px(doc.frames[0], 4, 0, 0), [127, 0, 128, 255]), px(doc.frames[0], 4, 0, 0));
  doc.addLayer(0, 'Under');
  doc.moveLayer(0, 1);
  check('doc: moveLayer', doc.layers[1].name === 'Under');
  doc.duplicateLayer(1);
  check('doc: duplicateLayer copies the pixels', doc.layers.length === 3 && doc.layers[2].cels[0] !== doc.layers[1].cels[0]);
  doc.deleteLayer(2);
  doc.deleteLayer(1);
  check('doc: deleteLayer', doc.layers.length === 1 && !doc.layered);
  doc.deleteLayer(0);
  check('doc: the last layer stays', doc.layers.length === 1);
  doc.resizeCanvas(6, 6, 1, 1);
  check('doc: resizeCanvas changes every frame', doc.fw === 6 && eq(px(doc.frames[0], 6, 1, 1), px(before.layers[0].cels[0], 4, 0, 0)) || doc.fw === 6);
}

// Importing frames, and a blank image
{
  const doc = SpriteDoc.blank(8, 8, 1);
  check('isBlank: a new image', doc.isBlank());
  const frames = [image(4, 4, () => RED), image(4, 4, () => BLUE)];
  const added = doc.importFrames(frames, 4, 4, { replace: true });
  check('importFrames replace: the frame size and frames of the sheet', doc.fw === 4 && doc.count === 2 && eq(added, [0, 1]) && !doc.isBlank());
  const more = doc.importFrames([image(4, 4, () => RED)], 4, 4);
  check('importFrames add: after the last frame', eq(more, [2]) && doc.count === 3);
  doc.addLayer(1);
  doc.importFrames([image(4, 4, () => BLUE)], 4, 4, { layer: 1 });
  check('importFrames add on a layer: the other layers get empty frames', doc.layers[0].cels.length === 4 && eq(px(doc.layers[0].cels[3], 4, 0, 0), CLEAR) && eq(px(doc.layers[1].cels[3], 4, 0, 0), BLUE));
  let threw = false;
  try { doc.importFrames([image(2, 2, () => RED)], 2, 2); } catch { threw = true; }
  check('importFrames add: other sizes are refused', threw);
}

// ---------------------------------------------------------------------------
// Mirror drawing

{
  const p = { x: 1, y: 2, fx: 1.5, fy: 2.25 };
  check('mirror: left and right across the middle of 8', eq(mirrorPoint(p, 4, 4, true, false), { x: 6, y: 2, fx: 6.5, fy: 2.25 }));
  check('mirror: top and bottom across the middle of 8', eq(mirrorPoint(p, 4, 4, false, true), { x: 1, y: 5, fx: 1.5, fy: 5.75 }));
  check('mirror: an odd width mirrors the middle pixel onto itself', mirrorPoint({ x: 3, y: 0, fx: 3.5, fy: 0.5 }, 3.5, 0, true, false).x === 3);
  check('mirror: a moved line at 2', mirrorPoint(p, 2, 0, true, false).x === 2);
  const segs = mirrorSegments(p, { x: 2, y: 2, fx: 2.5, fy: 2.5 }, 4, 4, true, true);
  check('mirror: both lines give 4 strokes', segs.length === 4 && eq(segs[3][0], { x: 6, y: 5, fx: 6.5, fy: 5.75 }));
  check('mirror: off gives the stroke only', mirrorSegments(p, p, 4, 4, false, false).length === 1);
}

// ---------------------------------------------------------------------------
// Selection: lift, move, drop, copy and paste, turn, flip

{
  const w = 4, h = 4;
  const frame = image(w, h, (x, y) => (x === 0 && y === 0 ? RED : x === 1 && y === 0 ? BLUE : null));
  const f = lift(frame, w, h, { x: 0, y: 0, w: 2, h: 1 });
  check('lift: takes the pixels and leaves transparency', eq(px(f.data, 2, 0, 0), RED) && eq(px(frame, w, 0, 0), CLEAR));
  drop(frame, w, h, moved(f, 1, 2));
  check('move: the pixels land 1 right and 2 down', eq(px(frame, w, 1, 2), RED) && eq(px(frame, w, 2, 2), BLUE) && eq(px(frame, w, 0, 0), CLEAR));
  const copy = lift(frame, w, h, { x: 1, y: 2, w: 2, h: 1 }, true);
  check('lift with copy: the pixels stay', eq(px(frame, w, 1, 2), RED) && eq(px(copy.data, 2, 1, 0), BLUE));
  // Paste on another frame (the clipboard is the lifted pixels).
  const other = new Uint8ClampedArray(w * h * 4);
  const at = pastePosition(copy.x, copy.y, copy.w, copy.h, w, h);
  drop(other, w, h, { ...copy, ...at });
  check('paste: same place on another frame', eq(px(other, w, 1, 2), RED) && eq(px(other, w, 2, 2), BLUE));
  check('paste: too big for the place goes to the corner', eq(pastePosition(3, 3, 2, 2, 4, 4), { x: 0, y: 0 }));
  const r = rotated(copy, true);
  check('rotate: 2×1 becomes 1×2 around its middle', r.w === 1 && r.h === 2 && eq(px(r.data, 1, 0, 0), RED) && eq(px(r.data, 1, 0, 1), BLUE), r);
  const back = rotated(rotated(rotated(r, true), true), true);
  check('rotate: four quarter turns give the start', eq([...back.data], [...copy.data]) && back.w === copy.w);
  check('rotate90 counterclockwise', eq(px(rotate90(copy.data, 2, 1, false), 1, 0, 0), BLUE));
  check('flip: left and right', eq(px(flipped(copy, true).data, 2, 0, 0), BLUE));
  // A drop keeps what is under transparent pixels.
  const base = image(2, 1, () => BLUE);
  drop(base, 2, 1, { x: 0, y: 0, w: 2, h: 1, data: image(2, 1, (x) => (x ? RED : null)) });
  check('drop: transparent pixels keep what is below', eq(px(base, 2, 0, 0), BLUE) && eq(px(base, 2, 1, 0), RED));
}

// ---------------------------------------------------------------------------
// Palettes

{
  const pal = [[0, 0, 0], [255, 255, 255], [255, 0, 0]];
  check('nearest: dark red is red', nearestIndex(pal, 200, 20, 10) === 2);
  check('nearest: light grey is white', nearestIndex(pal, 200, 200, 200) === 1);
  check('nearest: dark grey is black', nearestIndex(pal, 40, 40, 40) === 0);
  const snap = makeSnapper(['#000000', '#ffffff', '#ff0000']);
  check('snapColor: on the palette and opaque', eq(snapColor(snap, [250, 10, 10, 100]), [255, 0, 0, 255]));
  check('snapColor: transparent stays transparent', eq(snapColor(snap, [250, 10, 10, 0]), [250, 10, 10, 0]));
  check('makeSnapper: an empty palette is null', makeSnapper([]) === null);
  const buf = new Uint8ClampedArray([250, 10, 10, 200, 90, 90, 90, 60, 230, 230, 230, 255]);
  snapPixels(buf, 3, { x0: 0, y0: 0, x1: 3, y1: 1 }, snap);
  check('snapPixels: each pixel goes on the palette; faint ones become transparent', eq([...buf], [255, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]), [...buf]);
  const buf2 = new Uint8ClampedArray([250, 10, 10, 255, 250, 10, 10, 255]);
  const mask = { data: new Uint8Array([0, 255]) };
  snapPixels(buf2, 2, { x0: 0, y0: 0, x1: 2, y1: 1 }, snap, mask);
  check('snapPixels: with a mask, only those pixels', eq([...buf2], [250, 10, 10, 255, 255, 0, 0, 255]));
  const img = image(10, 1, (x) => (x < 6 ? RED : x < 9 ? BLUE : [0, 255, 0, 50]));
  const { colors, total } = imageColors(img, 64);
  check('imageColors: most used first, faint pixels left out', eq(colors, ['#ff0000', '#0000ff']) && total === 2, colors);
  const many = image(20, 20, (x, y) => [x * 12, y * 12, 0, 255]);
  check('imageColors: at most max colors', imageColors(many, 16).colors.length === 16 && imageColors(many, 16).total === 400);
}

// ---------------------------------------------------------------------------
// Cutting sprite sheets

{
  // A 2-pixel margin, 1-pixel spacing, 3 columns × 2 rows of 4×5 frames.
  const fw = 4, fh = 5, m = 2, sp = 1, cols = 3, rows = 2;
  const W = 2 * m + cols * fw + (cols - 1) * sp, H = 2 * m + rows * fh + (rows - 1) * sp;
  const sheet = image(W, H, (x, y) => {
    const cx = Math.floor((x - m) / (fw + sp)), cy = Math.floor((y - m) / (fh + sp));
    const inCell = x >= m && y >= m && (x - m) % (fw + sp) < fw && (y - m) % (fh + sp) < fh && cx < cols && cy < rows;
    return inCell ? [cy * cols + cx + 1, 0, 0, 255] : [9, 9, 9, 255]; // the frame number in red; grey lines between
  });
  const bySize = sheetGrid(W, H, { by: 'size', frameWidth: fw, frameHeight: fh, margin: m, spacing: sp });
  check('sheetGrid by size: columns and rows', bySize.columns === cols && bySize.rows === rows && bySize.cells.length === 6, bySize);
  check('sheetGrid by size: where the cells are', eq(bySize.cells[4], { x: m + fw + sp, y: m + fh + sp }));
  const byGrid = sheetGrid(W, H, { by: 'grid', columns: cols, rows, margin: m, spacing: sp });
  check('sheetGrid by columns and rows: the frame size', byGrid.fw === fw && byGrid.fh === fh, byGrid);
  const frames = cutSheet(sheet, W, H, byGrid);
  const clean = frames.every((f, i) => { for (let k = 0; k < f.length; k += 4) if (f[k] !== i + 1 || f[k + 3] !== 255) return false; return true; });
  check('cutSheet: each frame has only its own pixels (no margin or spacing)', clean);
  check('cutSheet: chosen cells, in the order given', eq(cutSheet(sheet, W, H, byGrid, [5, 0]).map((f) => f[0]), [6, 1]));
  check('sheetGrid: no margin, no spacing', eq(sheetGrid(64, 32, { by: 'size', frameWidth: 16, frameHeight: 16 }).cells.length, 8));
  check('sheetGrid: a size that is not a whole number of frames leaves out the rest', sheetGrid(70, 16, { by: 'size', frameWidth: 16, frameHeight: 16 }).columns === 4);
  check('sheetGrid: a frame bigger than the image is an error', !!sheetGrid(8, 8, { by: 'size', frameWidth: 16, frameHeight: 16 }).error);
  check('sheetGrid: zero columns is an error', !!sheetGrid(8, 8, { by: 'grid', columns: 0, rows: 1 }).error);
  check('sheetGrid: too many columns is an error', !!sheetGrid(8, 8, { by: 'grid', columns: 9, rows: 1 }).error);
  const sparse = image(32, 16, (x) => (x < 16 ? RED : null));
  const g = sheetGrid(32, 16, { by: 'size', frameWidth: 16, frameHeight: 16 });
  check('filledCells: empty cells are left out', eq(filledCells(sparse, 32, 16, g), [0]));
  check('cellPixels: a cell past the edge is padded', cellPixels(sparse, 32, 16, { fw: 16, fh: 16, cells: [{ x: 24, y: 0 }] }, 0).length === 16 * 16 * 4);
}

// ---------------------------------------------------------------------------
// .sprite files

async function roundTrip(files, pngPath, label) {
  const h = host(files);
  const { metaPath, readPath } = spritePaths(h, pngPath);
  const { doc, warnings } = await loadSprite(h, pngPath, readPath);
  const { png, json } = await encodeSprite(doc, pngPath, metaPath, h.exists(metaPath) || h.exists(readPath));
  const a = await decodePNG(files.get(pngPath)), b = await decodePNG(png);
  check(`${label}: the image is the same`, a.width === b.width && a.height === b.height && sameImage(a.data, b.data, 0), `${a.width}x${a.height} -> ${b.width}x${b.height}`);
  const before = files.get(readPath);
  if (typeof before === 'string') {
    const same = eq(JSON.parse(before), JSON.parse(json));
    check(`${label}: the .sprite file says the same`, same, same ? '' : `${before}\n->\n${json}`);
  } else {
    check(`${label}: no .sprite file is made`, json === null, json);
  }
  return { doc, warnings, png, json, metaPath };
}

const oldFiles = () => new Map([
  ['sprites/hero.png', encodePNGSync(image(128, 32, (x, y) => ((x >> 3) + y) % 5 ? [x * 2, y * 7, 99, 255] : null), 128, 32)],
  ['sprites/hero.sprite', `${JSON.stringify({
    format: 'smitten.sprite', version: 1, image: 'hero.png', frameWidth: 32, frameHeight: 32, origin: [16, 32],
    animations: { idle: { frames: [0, 1], fps: 4, loop: true }, bounce: { frames: [0, 1, 2, 3], fps: 8, loop: false, events: { 2: 'step' } } },
    author: 'someone', custom: { keep: [1, 2, 3] },
  }, null, 2)}\n`],
  ['sprites/old.png', encodePNGSync(image(32, 16, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [56, 183, 100, 255] : [1, 2, 3, 40]), 32, 16)],
  ['sprites/old.sprite.json', `${JSON.stringify({ format: 'smitten.sprite', version: 1, image: 'old.png', frameWidth: 16, frameHeight: 16, animations: { blink: { frames: [0, 1], fps: 2 } } })}\n`],
  ['art/sheet.png', encodePNGSync(image(48, 32, (x, y) => [x * 5, y * 8, 200, (x * 7 + y) % 256]), 48, 32)],
  ['art/sheet.sprite', `${JSON.stringify({ format: 'smitten.sprite', version: 1, image: 'sheet.png', frameWidth: 16, frameHeight: 16 }, null, 2)}\n`],
  ['tiles/plain.png', encodePNGSync(image(16, 16, (x) => (x % 2 ? RED : BLUE)), 16, 16)],
]);

{
  const files = oldFiles();
  await roundTrip(files, 'sprites/hero.png', 'old sprite with animations and unknown fields');
  await roundTrip(files, 'sprites/old.png', 'older .sprite.json');
  const { doc: sheetDoc } = await roundTrip(files, 'art/sheet.png', 'a 3×2 sheet');
  check('a 3×2 sheet keeps its layout', eq(sheetDoc.layout(), { columns: 3, rows: 2 }));
  await roundTrip(files, 'tiles/plain.png', 'a plain image (a tileset image) without a .sprite file');
}

// An image with layers: saved, read again, and the same.
{
  const files = oldFiles();
  const h = host(files);
  const { doc } = await loadSprite(h, 'sprites/hero.png', 'sprites/hero.sprite');
  const under = doc.addLayer(0, 'Sky');
  under.cels.forEach((c) => c.fill(255));
  doc.layers[1].opacity = 0.75;
  const top = doc.addLayer(2, 'Hat');
  top.cels[1].set(RED, 0);
  top.hidden = true;
  doc.changed();
  const flatBefore = doc.frames.map((f) => f.slice());
  const { png, json } = await encodeSprite(doc, 'sprites/hero.png', 'sprites/hero.sprite', true);
  const meta = JSON.parse(json);
  check('layers: saved bottom first, with opacity and hidden', eq(meta.layers.map((l) => [l.name, l.opacity ?? 1, !!l.hidden]), [['Sky', 1, false], ['Layer 1', 0.75, false], ['Hat', 1, true]]), meta.layers.map((l) => l.name));
  check('layers: each one is a PNG data: URL', meta.layers.every((l) => l.image.startsWith('data:image/png;base64,')));
  check('layers: the other fields are kept', meta.author === 'someone' && eq(meta.custom, { keep: [1, 2, 3] }) && eq(meta.animations.bounce.events, { 2: 'step' }));
  const flatPng = await decodePNG(png);
  const expected = new SpriteDoc(32, 32, flatBefore).toSheet({ columns: 4, rows: 1 });
  check('layers: the PNG is the flattened image', sameImage(flatPng.data, expected.data, 0));
  files.set('sprites/hero.png', png);
  files.set('sprites/hero.sprite', json);
  const { doc: again, warnings } = await loadSprite(h, 'sprites/hero.png', 'sprites/hero.sprite');
  check('layers: read again without warnings', warnings.length === 0, warnings);
  check('layers: read again, the same layers', eq(again.layers.map((l) => [l.name, l.opacity, l.hidden]), [['Sky', 1, false], ['Layer 1', 0.75, false], ['Hat', 1, true]]));
  check('layers: read again, the same pixels', again.layers.every((l, i) => l.cels.every((c, k) => sameImage(c, doc.layers[i].cels[k], 0))));
  const { json: json2 } = await encodeSprite(again, 'sprites/hero.png', 'sprites/hero.sprite', true);
  check('layers: saving again gives the same file', json2 === json);

  // The PNG changed elsewhere (an older editor, another program): it becomes a new top layer.
  const changed = await decodePNG(png);
  changed.data.set([0, 255, 0, 255], 0);
  files.set('sprites/hero.png', encodePNGSync(changed.data, changed.width, changed.height));
  const { doc: stale, warnings: w2 } = await loadSprite(h, 'sprites/hero.png', 'sprites/hero.sprite');
  check('changed outside: a warning', w2.length === 1 && /top layer/.test(w2[0]), w2);
  check('changed outside: the image is the new top layer, the others hidden', stale.layers.length === 4 && stale.layers.slice(0, 3).every((l) => l.hidden) && !stale.layers[3].hidden);
  check('changed outside: it looks like the PNG', eq(px(stale.frames[0], 32, 0, 0), [0, 255, 0, 255]));

  // Flatten: back to one layer, and the file has no layers again.
  again.flattenLayers();
  const { json: json3 } = await encodeSprite(again, 'sprites/hero.png', 'sprites/hero.sprite', true);
  check('flattenLayers: no layers in the file', !('layers' in JSON.parse(json3)));

  // A layer image that is broken: a warning, and the main image as one layer.
  const bad = JSON.parse(json);
  bad.layers[0].image = 'data:image/png;base64,AAAA';
  files.set('sprites/hero.png', png);
  files.set('sprites/hero.sprite', JSON.stringify(bad));
  const { doc: broken, warnings: w3 } = await loadSprite(h, 'sprites/hero.png', 'sprites/hero.sprite');
  check('a broken layer image: a warning and one layer', w3.length === 1 && broken.layers.length === 1 && sameImage(broken.frames[0], again.frames[0], 0), w3);
}

// A plain image with layers needs a .sprite file next to it.
{
  const files = new Map([['art/bg.png', encodePNGSync(image(8, 8, () => BLUE), 8, 8)]]);
  const h = host(files);
  const { doc } = await loadSprite(h, 'art/bg.png', 'art/bg.sprite');
  check('plain image: no .sprite needed', !doc.needsMeta());
  doc.addLayer(1);
  check('plain image with two layers: a .sprite is needed', doc.needsMeta());
  const { json } = await encodeSprite(doc, 'art/bg.png', 'art/bg.sprite', false);
  check('plain image with two layers: the .sprite has the layers', JSON.parse(json).layers.length === 2);
}

// A web export (exporter.js) leaves the layers out; the rest stays.
{
  const { gameFiles } = await import('../../exporter.js');
  const files = oldFiles();
  const h = host(files);
  const { doc } = await loadSprite(h, 'sprites/hero.png', 'sprites/hero.sprite');
  doc.addLayer(1);
  const { json } = await encodeSprite(doc, 'sprites/hero.png', 'sprites/hero.sprite', true);
  files.set('sprites/hero.sprite', json);
  const before = Object.fromEntries(files);
  before['art/bytes.sprite'] = new TextEncoder().encode(json);
  const out = gameFiles(before);
  const stripped = JSON.parse(out['sprites/hero.sprite']);
  check('web export: the layers are left out', !('layers' in stripped) && 'layers' in JSON.parse(json));
  check('web export: the rest of the .sprite file stays', eq(stripped.animations, JSON.parse(json).animations) && stripped.author === 'someone' && stripped.frameWidth === 32);
  check('web export: a .sprite file stored as bytes is stripped too', !('layers' in JSON.parse(out['art/bytes.sprite'])));
  check('web export: other files are the same objects', out['sprites/hero.png'] === before['sprites/hero.png'] && out['sprites/old.sprite.json'] === before['sprites/old.sprite.json'] && out['art/sheet.sprite'] === before['art/sheet.sprite']);
  check('web export: the PNG keeps the layers flattened', out['sprites/hero.png'] === files.get('sprites/hero.png'));
}

// Sprites of real projects (arguments): each must round-trip unchanged.
function spriteFiles(path, out = []) {
  if (statSync(path).isDirectory()) for (const f of readdirSync(path)) spriteFiles(join(path, f), out);
  else if (/\.sprite(\.json)?$/i.test(path)) out.push(path);
  return out;
}
for (const arg of process.argv.slice(2)) {
  const rootDir = statSync(arg).isDirectory() ? arg : join(arg, '..');
  const files = new Map();
  const load = (p) => {
    if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) load(join(p, f)); return; }
    const rel = relative(rootDir, p).split('\\').join('/');
    files.set(rel, /\.(png)$/i.test(p) ? new Uint8Array(readFileSync(p)) : readFileSync(p, 'utf8'));
  };
  load(rootDir);
  for (const sp of spriteFiles(arg)) {
    const rel = relative(rootDir, sp).split('\\').join('/');
    const { pngPath } = spritePaths(host(files), rel);
    if (!files.has(pngPath)) continue;
    await roundTrip(files, pngPath, rel);
  }
}

console.log(`sprite editor: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
