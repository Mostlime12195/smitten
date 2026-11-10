// node web/editor/workspaces/scene/terrain.test.mjs
//
// terrain.js against the cases the engine is checked with too
// (tools/scene-tests/levels/terrain-cases.json, made by
// tools/scene-tests/make-levels-fixture.mjs; the "levels" scene test runs
// them through Tiles:setTerrain and friends), and against tiles worked out
// by hand.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as terrain from './terrain.js';

const { N, NE, E, SE, S, SW, W, NW } = terrain;
const here = dirname(fileURLToPath(import.meta.url));
const levels = join(here, '..', '..', '..', '..', 'tools', 'scene-tests', 'levels');
const fixture = JSON.parse(readFileSync(join(levels, 'terrain-cases.json'), 'utf8'));
const tileset = JSON.parse(readFileSync(join(levels, fixture.tileset), 'utf8'));
const sets = terrain.compileAll(tileset.terrains);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function run(steps) {
  const grid = new Map();
  const get = (x, y) => grid.get(`${x},${y}`);
  const set = (x, y, t) => (t >= 0 ? grid.set(`${x},${y}`, t) : grid.delete(`${x},${y}`));
  for (const s of steps) {
    if (s[0] === 'set') terrain.place(get, set, sets.of, s[1], s[2], s[3] === null ? null : sets.byName.get(s[3]));
    else if (s[0] === 'fill') terrain.fill(get, set, sets.of, s[1], s[2], s[3], s[4], s[5] === null ? null : sets.byName.get(s[5]));
    else if (s[0] === 'tile') set(s[1], s[2], s[3]);
    else throw new Error(`unknown step ${s[0]}`);
  }
  return grid;
}

// Another route to the same answer, for sets with one tile for every mask:
// from the finished cells alone, each terrain cell must hold the tile whose
// mask is the neighbours it has, by the rules written out here in full.
function byHand(grid) {
  const out = {};
  for (const [key, tile] of grid) {
    const t = sets.of.get(tile);
    if (!t) {
      out[key] = tile;
      continue;
    }
    const [cx, cy] = key.split(',').map(Number);
    const inT = (dx, dy) => sets.of.get(grid.get(`${cx + dx},${cy + dy}`)) === t;
    const n = inT(0, -1);
    const e = inT(1, 0);
    const s = inT(0, 1);
    const w = inT(-1, 0);
    let mask = 0;
    if (t.match !== 'corners') mask += (n ? 1 : 0) + (e ? 4 : 0) + (s ? 16 : 0) + (w ? 64 : 0);
    if (t.match !== 'sides') {
      if (n && e && inT(1, -1)) mask += 2;
      if (s && e && inT(1, 1)) mask += 8;
      if (s && w && inT(-1, 1)) mask += 32;
      if (n && w && inT(-1, -1)) mask += 128;
    }
    const tiles = Object.entries(tileset.terrains.find((d) => d.name === t.name).tiles).filter(([, m]) => m === mask).map(([k]) => Number(k));
    assert.equal(tiles.length, 1, `${t.name} has ${tiles.length} tiles for mask ${mask}`);
    out[key] = tiles[0];
  }
  return out;
}

const sorted = (obj) => Object.fromEntries(Object.entries(obj).sort());

for (const c of fixture.cases) {
  test(c.name, () => {
    const grid = run(c.steps);
    assert.deepEqual(sorted(Object.fromEntries(grid)), sorted(c.expect));
    if (c.plain) assert.deepEqual(sorted(byHand(grid)), sorted(c.expect));
  });
}

const expectOf = (name) => fixture.cases.find((c) => c.name === name).expect;
const tileOf = (terrainName, mask) => {
  const tiles = Object.entries(tileset.terrains.find((d) => d.name === terrainName).tiles).filter(([, m]) => m === mask);
  assert.equal(tiles.length, 1);
  return Number(tiles[0][0]);
};

test('the fixture covers what it should', () => {
  assert.ok(fixture.cases.length >= 40);
  for (const word of ['blob', 'sides', 'corners', 'variants', 'erase', 'negative', 'missing']) {
    assert.ok(fixture.cases.some((c) => c.name.includes(word)), `no case about ${word}`);
  }
  assert.deepEqual(sets.list.map((t) => [t.name, t.match, t.tiles.size]), [['grass', 'all', 47], ['stone', 'sides', 16], ['water', 'corners', 16], ['pebbles', 'sides', 8]]);
});

test('by hand: blob 3 x 3', () => {
  // Corners of the block have two sides and the corner between them; edges
  // three sides and two corners; the middle everything.
  assert.deepEqual(expectOf('blob: 3 x 3, cell by cell'), {
    '0,0': tileOf('grass', E | SE | S), '1,0': tileOf('grass', E | SE | S | SW | W), '2,0': tileOf('grass', S | SW | W),
    '0,1': tileOf('grass', N | NE | E | SE | S), '1,1': tileOf('grass', 255), '2,1': tileOf('grass', N | S | SW | W | NW),
    '0,2': tileOf('grass', N | NE | E), '1,2': tileOf('grass', N | NE | E | W | NW), '2,2': tileOf('grass', N | W | NW),
  });
  assert.equal(tileOf('grass', 255), 46);
  assert.equal(tileOf('grass', 0), 0);
});

test('by hand: blob plus and ring', () => {
  // The middle of a plus has four sides and no corner.
  assert.equal(expectOf('blob: a plus')['1,1'], tileOf('grass', N | E | S | W));
  assert.equal(expectOf('blob: a plus')['1,0'], tileOf('grass', S));
  // A ring: its corners keep two sides but lose the corner between them.
  const ring = expectOf('blob: a ring (3 x 3 with the middle erased)');
  assert.equal(ring['0,0'], tileOf('grass', E | S));
  assert.equal(ring['1,0'], tileOf('grass', E | W));
  assert.equal(ring['1,1'], undefined);
});

test('by hand: sides and corners', () => {
  // The 4 x 4 sides sheet starts at tile 48: its bottom row is lone, left end, middle, right end.
  assert.deepEqual(expectOf('sides: a row of three'), { '0,0': 73, '1,0': 74, '2,0': 75 });
  assert.deepEqual(expectOf('sides: a column of three'), { '0,0': 48, '0,1': 56, '0,2': 64 });
  assert.deepEqual(expectOf('sides: one cell'), { '0,0': 72 });
  assert.equal(expectOf('sides: 3 x 3')['1,1'], 58);
  // The corners sheet starts at tile 52 and counts up-right 1, down-right 2, down-left 4, up-left 8.
  // Number n sits in column n % 4 of row n / 4 of the block, and the sheet has 8 tiles a row.
  const corner = (n) => 52 + (n % 4) + 8 * Math.floor(n / 4);
  assert.deepEqual(expectOf('corners: one cell'), { '0,0': corner(0) });
  assert.deepEqual(expectOf('corners: 2 x 2'), { '0,0': corner(2), '1,0': corner(4), '0,1': corner(1), '1,1': corner(8) });
  assert.equal(expectOf('corners: 3 x 3')['1,1'], corner(15));
});

test('by hand: terrains keep to themselves', () => {
  const e = expectOf('two terrains side by side do not join');
  assert.equal(e['1,0'], tileOf('grass', S | SW | W));
  assert.equal(e['2,0'], tileOf('stone', E | S));
  assert.deepEqual(expectOf('a plain tile is no terrain'), { '0,0': 0, '1,0': 47, '2,0': 0 });
  assert.deepEqual(expectOf('erasing next to a plain tile leaves it'), { '1,0': 47 });
  assert.deepEqual(expectOf('blob: erase everything again'), {});
});

test('by hand: setTile is exact', () => {
  assert.deepEqual(expectOf('setTile is exact: neighbours stay as they are'), { '0,0': 0, '1,0': 46 });
  assert.deepEqual(expectOf('setTile with the wrong shape is fixed by the next terrain step beside it'), { '0,0': 0, '1,0': tileOf('grass', E | W), '2,0': tileOf('grass', W) });
});

test('variants', () => {
  const lone = expectOf('variants: lone cells here and there');
  const used = new Set(Object.values(lone));
  assert.deepEqual([...used].sort(), [83, 84], 'both lone variants show up');
  const filled = expectOf('variants: a 6 x 6 fill');
  assert.deepEqual(filled, expectOf('variants: the same 6 x 6, cell by cell'), 'a cell gets the same variant however it was painted');
  const middles = new Set();
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) middles.add(filled[`${x},${y}`]);
  assert.deepEqual([...middles].sort(), [80, 81, 82], 'all three middles show up');
  // The same cell always gets the same one.
  for (let i = 0; i < 50; i++) assert.equal(terrain.hash(i - 20, i * 7), terrain.hash(i - 20, i * 7));
  assert.equal(terrain.hash(0, 0), (((12345 * 12345) % 1000003) * 48271) % 2147483647);
  assert.equal(terrain.hash(-1, 0), terrain.hash(65535, 0));
});

test('missing tiles use the nearest mask', () => {
  // pebbles has no tile with only "down": the lone tiles (one side away) are
  // nearer than the middle (three sides away).
  const col = expectOf('missing tiles: a column uses the nearest');
  assert.ok([83, 84].includes(col['0,0']));
  assert.ok([83, 84].includes(col['0,1']));
  assert.deepEqual(Object.values(expectOf('missing tiles: a row is all there')), [85, 87, 86]);
  const empty = terrain.compile({ name: 'none', tiles: {} });
  assert.equal(terrain.pick(empty, 0, 0, 0), null);
  const grid = new Map();
  terrain.place((x, y) => grid.get(`${x},${y}`), (x, y, t) => grid.set(`${x},${y}`, t), new Map(), 0, 0, empty);
  assert.equal(grid.size, 0, 'a terrain without tiles paints nothing');
});

test('reduce', () => {
  assert.equal(terrain.reduce(255, 'all'), 255);
  assert.equal(terrain.reduce(255, 'sides'), N | E | S | W);
  assert.equal(terrain.reduce(255, 'corners'), NE | SE | SW | NW);
  assert.equal(terrain.reduce(NE | SE | SW | NW, 'all'), 0, 'corners alone are nothing');
  assert.equal(terrain.reduce(N | NE, 'all'), N);
  assert.equal(terrain.reduce(N | NE | E, 'all'), N | NE | E);
  assert.equal(terrain.reduce(N | NE | E, 'corners'), NE);
  assert.equal(terrain.reduce(NE, 'corners'), 0, 'a cell needs all three neighbours for a corner');
  assert.equal(terrain.reduce(NE, 'corners', true), NE, 'a tile keeps its corners as painted');
  assert.equal(terrain.reduce(N | NE, 'corners', true), NE);
  assert.equal(terrain.reduce('7', 'all'), 7);
  assert.equal(terrain.reduce(null, 'all'), 0);
  assert.equal(terrain.blobMasks().length, 47);
});

test('compile', () => {
  const t = terrain.compile({ name: 'x', match: 'nonsense', tiles: { 5: 1, 3: 1, bad: 2, '-1': 3, 2.5: 4, 9: 'no', 7: N | NE } });
  assert.equal(t.match, 'all');
  assert.deepEqual([...t.tiles], [[3, 1], [5, 1], [7, 1]]);
  assert.equal(t.first, 3);
  assert.deepEqual(t.masks, [1]);
  const all = terrain.compileAll([{ name: 'a', tiles: { 1: 0 } }, null, { name: 'b', tiles: { 1: 0, 2: 0 } }, { name: 'a', tiles: { 3: 0 } }]);
  assert.deepEqual(all.list.map((x) => x.name), ['a', 'b']);
  assert.equal(all.of.get(1).name, 'a', 'a tile in two terrains belongs to the first');
  assert.equal(all.of.get(2).name, 'b');
  assert.equal(all.of.has(3), false);
  assert.deepEqual(terrain.compileAll(undefined).list, []);
  assert.equal(terrain.compile({}, 4).name, 'terrain4');
});

test('layouts', () => {
  for (const l of terrain.LAYOUTS) {
    const masks = l.rows.flat().filter((m) => m !== null);
    assert.equal(new Set(masks).size, masks.length, `${l.id}: every mask once`);
    for (const m of masks) assert.equal(terrain.reduce(m, l.match, true), m, `${l.id}: mask ${m} fits its match mode`);
    assert.equal(masks.length, l.id === 'blob' ? 47 : 16);
  }
  const sides = terrain.LAYOUTS.find((l) => l.id === 'sides');
  assert.equal(terrain.layoutTiles(sides, 6, 8, 96), null, 'too near the right edge');
  assert.equal(terrain.layoutTiles(sides, 88, 8, 96), null, 'too near the bottom');
  assert.deepEqual(Object.keys(terrain.layoutTiles(sides, 1, 5, 96)).map(Number), [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19]);
});

console.log(`${passed} passed`);
