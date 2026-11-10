// node tools/scene-tests/make-levels-fixture.mjs
//
// Writes what the "levels" scene test and terrain.test.mjs share:
//
//   levels/art/tiles.png          96 flat-colored 8 x 8 tiles, 8 a row
//   levels/art/terrain.tileset    four terrains and two animated tiles on it
//   levels/terrain-cases.json     terrain painting cases: what to do, and the
//                                 tile every cell must hold afterwards
//
// The expected tiles come from terrain.js; terrain.test.mjs checks them again
// by another route and the scene test checks that the engine (terrain.lua
// through Tiles:setTerrain and friends) gives exactly the same. Run it again
// only when the cases change, and commit what it writes.

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as terrain from '../../web/editor/workspaces/scene/terrain.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'levels');
const { N, E, S, W } = terrain;

// --- The picture: tile i is one flat color (tileColor in the test's main.lua).
const COLUMNS = 8;
const ROWS = 12;
const SIZE = 8;
export const tileColor = (i) => [(i % COLUMNS) * 32 + 16, Math.floor(i / COLUMNS) * 20 + 16, 128];

function png(width, height, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const w = COLUMNS * SIZE;
const h = ROWS * SIZE;
const pixels = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const [r, g, b] = tileColor(Math.floor(y / SIZE) * COLUMNS + Math.floor(x / SIZE));
    pixels.set([r, g, b, 255], (y * w + x) * 4);
  }
}
writeFileSync(join(dir, 'art', 'tiles.png'), png(w, h, pixels));

// --- The tileset.
const layout = (id) => terrain.LAYOUTS.find((l) => l.id === id);
const tileset = {
  format: 'smitten.tileset',
  version: 1,
  image: 'tiles.png',
  tileWidth: SIZE,
  tileHeight: SIZE,
  tiles: { 0: { solid: true }, 88: { name: "lava", damage: 2 } },
  terrains: [
    // The 47 blob tiles: tiles 0 to 46.
    { name: 'grass', match: 'all', tiles: terrain.layoutTiles(layout('blob'), 0, COLUMNS, COLUMNS * ROWS) },
    // 16 side tiles: columns 0 to 3 of rows 6 to 9.
    { name: 'stone', match: 'sides', tiles: terrain.layoutTiles(layout('sides'), 48, COLUMNS, COLUMNS * ROWS) },
    // 16 corner tiles: columns 4 to 7 of rows 6 to 9.
    { name: 'water', match: 'corners', tiles: terrain.layoutTiles(layout('corners'), 52, COLUMNS, COLUMNS * ROWS) },
    // A set with variants and with tiles missing: three middles, two lone
    // tiles, a left end, a right end and a row middle; nothing else.
    { name: 'pebbles', match: 'sides', tiles: { 80: N | E | S | W, 81: N | E | S | W, 82: N | E | S | W, 83: 0, 84: 0, 85: E, 86: W, 87: E | W } },
  ],
  animations: {
    // Tile 88 shows tiles 88, 89, 90, 91 for a quarter of a second each.
    88: { frames: [88, 89, 90, 91], fps: 4 },
    // Tile 92: uneven times, and every cell starts somewhere else.
    92: { frames: [92, 93, 94], durations: [0.5, 0.25, 0.25], randomStart: true },
  },
};
writeFileSync(join(dir, 'art', 'terrain.tileset'), `${JSON.stringify(tileset, null, 2)}\n`);

// --- The cases. Steps:
//   ["set", column, row, terrain]      Tiles:setTerrain (terrain null: erase)
//   ["fill", column, row, columns, rows, terrain]   Tiles:fillTerrain
//   ["tile", column, row, tile]        Tiles:setTile (exact, fixes nothing)
// plain: every terrain cell ends with exactly the tile for its neighbours,
// whatever the order of the steps (terrain.test.mjs works those out again
// from the final cells alone).
const cases = [];
const add = (name, steps, plain = true) => cases.push({ name, steps, plain });
const block = (t, x0, y0, cw, ch) => {
  const out = [];
  for (let y = y0; y < y0 + ch; y++) for (let x = x0; x < x0 + cw; x++) out.push(['set', x, y, t]);
  return out;
};

add('blob: one cell', [['set', 2, 2, 'grass']]);
add('blob: two side by side', [['set', 0, 0, 'grass'], ['set', 1, 0, 'grass']]);
add('blob: two on a diagonal do not join', [['set', 0, 0, 'grass'], ['set', 1, 1, 'grass']]);
add('blob: 3 x 3, cell by cell', block('grass', 0, 0, 3, 3));
add('blob: 3 x 3, backwards', block('grass', 0, 0, 3, 3).reverse());
add('blob: a plus', [['set', 1, 0, 'grass'], ['set', 0, 1, 'grass'], ['set', 1, 1, 'grass'], ['set', 2, 1, 'grass'], ['set', 1, 2, 'grass']]);
add('blob: an L (one inside corner)', [...block('grass', 0, 0, 1, 3), ['set', 1, 2, 'grass'], ['set', 2, 2, 'grass']]);
add('blob: a ring (3 x 3 with the middle erased)', [...block('grass', 0, 0, 3, 3), ['set', 1, 1, null]]);
add('blob: 4 x 4 with a corner erased', [...block('grass', 0, 0, 4, 4), ['set', 0, 0, null]]);
add('blob: across the origin, negative cells', block('grass', -2, -2, 4, 4));
add('blob: far away cells', [['set', -70000, 123456, 'grass'], ['set', -69999, 123456, 'grass'], ['set', -69999, 123457, 'grass']]);
add('blob: fill a rectangle', [['fill', 1, 1, 5, 3, 'grass']]);
add('blob: fill, then erase a rectangle out of it', [['fill', 0, 0, 6, 5, 'grass'], ['fill', 2, 1, 2, 3, null]]);
add('blob: fill next to cells painted before', [['set', 0, 1, 'grass'], ['set', 4, 4, 'grass'], ['fill', 1, 1, 3, 3, 'grass']]);
add('blob: erase everything again', [...block('grass', 0, 0, 2, 2), ...block(null, 0, 0, 2, 2)]);
add('blob: painting a cell twice', [['set', 0, 0, 'grass'], ['set', 0, 0, 'grass'], ['set', 1, 0, 'grass'], ['set', 0, 0, 'grass']]);
add('sides: one cell', [['set', 0, 0, 'stone']]);
add('sides: a row of three', block('stone', 0, 0, 3, 1));
add('sides: a column of three', block('stone', 0, 0, 1, 3));
add('sides: 3 x 3', block('stone', 0, 0, 3, 3));
add('sides: a plus has no corners to care about', [['set', 1, 0, 'stone'], ['set', 0, 1, 'stone'], ['set', 1, 1, 'stone'], ['set', 2, 1, 'stone'], ['set', 1, 2, 'stone']]);
add('sides: fill and erase the middle', [['fill', -1, -1, 3, 3, 'stone'], ['set', 0, 0, null]]);
add('corners: one cell', [['set', 0, 0, 'water']]);
add('corners: 2 x 2', block('water', 0, 0, 2, 2));
add('corners: 3 x 3', block('water', 0, 0, 3, 3));
add('corners: an L', [...block('water', 0, 0, 1, 3), ...block('water', 1, 2, 2, 1), ['set', 1, 1, 'water']]);
add('corners: fill 4 x 3', [['fill', 0, 0, 4, 3, 'water']]);
add('two terrains side by side do not join', [...block('grass', 0, 0, 2, 2), ...block('stone', 2, 0, 2, 2)]);
add('painting one terrain over another', [['fill', 0, 0, 3, 3, 'grass'], ['set', 1, 1, 'stone'], ['set', 1, 0, 'water']]);
add('three terrains in one fill each', [['fill', 0, 0, 2, 4, 'grass'], ['fill', 2, 0, 2, 4, 'stone'], ['fill', 4, 0, 3, 4, 'water']]);
add('a plain tile is no terrain', [['tile', 1, 0, 47], ['set', 0, 0, 'grass'], ['set', 2, 0, 'grass']]);
add('erasing next to a plain tile leaves it', [['tile', 1, 0, 47], ['set', 0, 0, 'grass'], ['set', 0, 0, null]]);
// Not plain: the tile depends on more than the neighbours.
add('setTile is exact: neighbours stay as they are', [['set', 0, 0, 'grass'], ['tile', 1, 0, 46]], false);
add('setTile with the wrong shape is fixed by the next terrain step beside it', [['set', 0, 0, 'grass'], ['tile', 1, 0, 46], ['set', 2, 0, 'grass']], false);
add('a hand-set tile that fits is kept', [['tile', 0, 0, 84], ['set', 1, 0, 'stone']], false);
add('variants: one lone cell', [['set', 3, 7, 'pebbles']], false);
add('variants: lone cells here and there', [['set', 0, 0, 'pebbles'], ['set', 2, 0, 'pebbles'], ['set', 4, 0, 'pebbles'], ['set', 0, 2, 'pebbles'], ['set', -5, 9, 'pebbles'], ['set', 11, -3, 'pebbles'], ['set', 100, 100, 'pebbles']], false);
add('variants: a 6 x 6 fill', [['fill', 0, 0, 6, 6, 'pebbles']], false);
add('variants: the same 6 x 6, cell by cell', block('pebbles', 0, 0, 6, 6), false);
add('missing tiles: a column uses the nearest', block('pebbles', 0, 0, 1, 3), false);
add('missing tiles: a row is all there', block('pebbles', 0, 0, 3, 1), false);

const sets = terrain.compileAll(tileset.terrains);
for (const c of cases) {
  const grid = new Map();
  const get = (x, y) => grid.get(`${x},${y}`);
  const set = (x, y, t) => (t >= 0 ? grid.set(`${x},${y}`, t) : grid.delete(`${x},${y}`));
  for (const s of c.steps) {
    if (s[0] === 'set') terrain.place(get, set, sets.of, s[1], s[2], s[3] === null ? null : sets.byName.get(s[3]));
    else if (s[0] === 'fill') terrain.fill(get, set, sets.of, s[1], s[2], s[3], s[4], s[5] === null ? null : sets.byName.get(s[5]));
    else set(s[1], s[2], s[3]);
  }
  c.expect = Object.fromEntries([...grid].sort());
}
const text = `{\n  "tileset": "art/terrain.tileset",\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`;
writeFileSync(join(dir, 'terrain-cases.json'), text);
console.log(`${cases.length} cases`);
