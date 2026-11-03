// node web/editor/workspaces/scene/cells.test.mjs
//
// cells.js against hand-made examples in tilemap.lua's format: what
// decodeCells (tilemap.lua's local decodeCells) and TileMap.encodeCells give
// for them, worked out by hand from the Lua code.

import assert from 'node:assert/strict';
import { decodeCells, encodeCells, cellsValue, cellBounds } from './cells.js';

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

const entries = (map) => [...map].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const grid = (obj) => new Map(Object.entries(obj));

test('nothing', () => {
  assert.equal(decodeCells(null).size, 0);
  assert.equal(decodeCells(undefined).size, 0);
  assert.equal(decodeCells({}).size, 0);
  assert.equal(decodeCells({ x: 0, y: 0, w: 3, h: 1, data: 5 }).size, 0);
  assert.deepEqual(encodeCells(new Map()), { x: 0, y: 0, w: 0, h: 0, data: '' });
  assert.equal(cellsValue(new Map()), null);
});

test('one row', () => {
  const m = decodeCells({ x: 0, y: 0, w: 4, h: 1, data: '1,2,-1,3' });
  assert.deepEqual(entries(m), [['0,0', 1], ['1,0', 2], ['3,0', 3]]);
});

test('runs and rows', () => {
  // 3 wide: row 0 = 0 0 0, row 1 = -1 7 -1, row 2 = 2 2 -1
  const cells = { x: 0, y: 0, w: 3, h: 3, data: '0*3,-1,7,-1,2*2,-1' };
  const m = decodeCells(cells);
  assert.deepEqual(entries(m), [['0,0', 0], ['0,2', 2], ['1,0', 0], ['1,1', 7], ['1,2', 2], ['2,0', 0]]);
  assert.deepEqual(encodeCells(m), cells);
});

test('negative origin', () => {
  const m = decodeCells({ x: -2, y: -1, w: 2, h: 2, data: '4,-1,-1,5' });
  assert.deepEqual(entries(m), [['-1,0', 5], ['-2,-1', 4]]);
  // Written back, the two empty cells become a run.
  assert.deepEqual(encodeCells(m), { x: -2, y: -1, w: 2, h: 2, data: '4,-1*2,5' });
});

test('encode: bounds are the used cells, runs cross rows', () => {
  const m = grid({ '5,3': 1, '6,3': 1, '5,4': 1, '7,5': 9 });
  // x 5..7, y 3..5: [1 1 -1] [1 -1 -1] [-1 -1 9]
  assert.deepEqual(encodeCells(m), { x: 5, y: 3, w: 3, h: 3, data: '1*2,-1,1,-1*4,9' });
});

test('encode: a single tile', () => {
  assert.deepEqual(encodeCells(grid({ '10,-4': 0 })), { x: 10, y: -4, w: 1, h: 1, data: '0' });
});

test('encode: the README example shape', () => {
  // 130 empty cells then five 3s: w = 135 (one row), as written in tilemap.lua's header.
  const m = new Map();
  for (let x = 130; x < 135; x++) m.set(`${x},0`, 3);
  m.set('0,0', -1); // negative values count as empty
  const c = encodeCells(m);
  assert.deepEqual(c, { x: 130, y: 0, w: 5, h: 1, data: '3*5' });
  const d = decodeCells({ x: 0, y: 0, w: 135, h: 1, data: '-1*130,3*5' });
  assert.equal(d.size, 5);
  assert.equal(d.get('130,0'), 3);
  assert.equal(d.get('134,0'), 3);
});

test('decode: tolerant like Lua', () => {
  // Empty tokens are skipped (gmatch "[^,]+"); a token Lua's tonumber can't
  // read still takes a cell; "n*k" with spaces isn't a run.
  const m = decodeCells({ x: 0, y: 0, w: 2, data: '1,,x,2, 3 ,4*2 ' });
  // tokens: 1 | x | 2 | " 3 " | "4*2 " (tonumber fails -> skipped, one cell)
  assert.deepEqual(entries(m), [['0,0', 1], ['0,1', 2], ['1,1', 3]]);
  // w missing or 0: nothing is placed.
  assert.equal(decodeCells({ x: 0, y: 0, data: '1,2,3' }).size, 0);
  // x and y default to 0.
  assert.deepEqual(entries(decodeCells({ w: 1, data: '8' })), [['0,0', 8]]);
  // Overlong data keeps going down the rows.
  assert.deepEqual(entries(decodeCells({ x: 0, y: 0, w: 1, h: 1, data: '1,2' })), [['0,0', 1], ['0,1', 2]]);
});

test('round trip', () => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let n = 0; n < 200; n++) {
    const m = new Map();
    const count = Math.floor(rnd() * 60);
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(rnd() * 20) - 10;
      const cy = Math.floor(rnd() * 12) - 6;
      m.set(`${cx},${cy}`, rnd() < 0.5 ? 3 : Math.floor(rnd() * 40));
    }
    const enc = encodeCells(m);
    assert.deepEqual(entries(decodeCells(enc)), entries(m));
    assert.deepEqual(encodeCells(decodeCells(enc)), enc);
    if (m.size) {
      const b = cellBounds(m);
      assert.deepEqual([enc.x, enc.y, enc.w, enc.h], [b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1]);
    }
  }
});

console.log(`cells.js: ${passed} tests passed`);
