// node web/editor/workspaces/scene/uilayout.test.mjs
//
// uilayout.js (how the editor places UI pieces) against the cases the
// engine is checked with too (tools/scene-tests/ui/layout-cases.json, made
// by tools/scene-tests/make-ui-fixture.mjs; tools/ui-tests/test.lua and the
// "ui" scene test run them through the engine), and against rectangles
// worked out by hand.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure, arrange, anchorRect, layoutTree, CONTAINERS } from './uilayout.js';
import { solve, treeApi } from '../../../../tools/scene-tests/make-ui-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const fixture = JSON.parse(readFileSync(join(root, 'tools/scene-tests/ui/layout-cases.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(root, 'love/src/modules/scene/pieces.json'), 'utf8'));

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

// The file is what the layout gives now (run make-ui-fixture.mjs after
// changing the rules, and change uilayout.lua with them).
for (const c of fixture.cases) {
  test(`fixture: ${c.name}`, () => assert.deepEqual(solve(c.pieces, schema.types, fixture.screen), c.expect));
}
test('fixture: every container is in a case', () => {
  const used = new Set();
  const walk = (n) => {
    used.add(n.type);
    (n.children || []).forEach(walk);
  };
  fixture.cases.forEach((c) => c.pieces.forEach(walk));
  for (const t of CONTAINERS) assert.ok(used.has(t), t);
});

// By hand ------------------------------------------------------------------

const byName = (name) => fixture.cases.find((c) => c.name.startsWith(name)).expect;

test('by hand: a row', () => {
  // 60 + 8 + 80 + 8 + 40 wide, as tall as the tallest (40); each piece in
  // the middle of that height.
  assert.deepEqual(byName('row: pieces left to right'), {
    Row: [10, 20, 196, 40], A: [10, 25, 60, 30], B: [78, 20, 80, 40], C: [166, 30, 40, 20],
  });
});
test('by hand: grow', () => {
  // 300 wide; 60 + 20 + 20 and two gaps of 8 leave 184: a third (61⅓) to
  // B and two thirds to C, on whole pixels.
  assert.deepEqual(byName('row: grow shares'), {
    Row: [0, 0, 300, 40], A: [0, 5, 60, 30], B: [68, 5, 81, 30], C: [157, 5, 143, 30],
  });
});
test('by hand: thirds', () => {
  const e = byName('row: thirds');
  assert.deepEqual([e.A, e.B, e.C].map((r) => [r[0], r[2]]), [[0, 33], [33, 34], [67, 33]]);
});
test('by hand: a column stretches', () => {
  assert.deepEqual(byName('column: stretches'), {
    Column: [5, 5, 120, 106], A: [5, 5, 120, 30], B: [5, 43, 120, 40], C: [5, 91, 120, 20],
  });
});
test('by hand: a grid with a width', () => {
  // 300 wide, 5 of padding, a gap of 10: two columns of 140.
  assert.deepEqual(byName('grid: a set width'), {
    Grid: [0, 0, 300, 100], A: [5, 5, 140, 30], B: [155, 5, 140, 30], C: [5, 45, 140, 50],
  });
});
test('by hand: a scroll at its end', () => {
  // Five pieces of 30 with gaps of 2 and 6 of padding are 170 high in a
  // window of 100: it scrolls 70 at most.
  const e = byName('scroll: never further');
  assert.deepEqual(e.A, [26, 20 + 6 - 70, 188, 30]);
  assert.deepEqual(e.E, [26, 84, 188, 30]);
});
test('by hand: anchors', () => {
  const e = byName('anchors alone');
  assert.deepEqual(e.TopLeft, [10, 20, 160, 40]);
  assert.deepEqual(e.Center, [275, 150, 100, 50]);
  assert.deepEqual(e.BottomRight, [640 - 16 - 160, 360 - 16 - 40, 160, 40]);
  assert.deepEqual(e.Fill, [30, 40, 580, 280]);
  assert.deepEqual(e.Inner, [30 + (580 - 160) / 2, 48, 160, 40]);
  // grow means nothing outside a Row or Column.
  assert.deepEqual(e.Grown, [30 + 580 - 160 - 2, 40 + (280 - 40) / 2, 160, 40]);
});

// The parts ------------------------------------------------------------------

test('measure: empty containers are their padding', () => {
  for (const kind of ['row', 'column', 'grid']) assert.deepEqual(measure({ kind, gap: 8, padding: 5, columns: 3 }, []), [10, 10]);
});
test('arrange: nothing to place', () => {
  for (const kind of ['row', 'column', 'grid']) assert.deepEqual(arrange({ kind, gap: 8, padding: 5, columns: 3 }, [], 100, 100), []);
});
test('arrange: a column is a row turned', () => {
  const items = [{ w: 30, h: 10, grow: 1 }, { w: 20, h: 40 }, { w: 50, h: 25, grow: 2 }];
  const turned = items.map((it) => ({ w: it.h, h: it.w, grow: it.grow }));
  for (const align of ['start', 'center', 'end', 'stretch']) {
    for (const justify of ['start', 'center', 'end', 'spaceBetween']) {
      for (const [w, h] of [[300, 80], [40, 20], [123, 77]]) {
        const row = arrange({ kind: 'row', gap: 7, padding: 3, align, justify }, items, w, h);
        const column = arrange({ kind: 'column', gap: 7, padding: 3, align, justify }, turned, h, w);
        assert.deepEqual(column.map((r) => [r[1], r[0], r[3], r[2]]), row, `${align} ${justify} ${w}x${h}`);
      }
    }
  }
});
test('arrange: a grid of one column is a stretched column', () => {
  const items = [{ w: 30, h: 10 }, { w: 20, h: 40 }, { w: 50, h: 25 }];
  for (const justify of ['start', 'center', 'end', 'spaceBetween']) {
    assert.deepEqual(arrange({ kind: 'grid', columns: 1, gap: 4, padding: 2, align: 'stretch', justify }, items, 90, 200),
      arrange({ kind: 'column', gap: 4, padding: 2, align: 'stretch', justify }, items, 90, 200));
  }
});
test('arrange: pieces never overlap and stay in order', () => {
  let seed = 7;
  const rnd = (n) => (seed = (seed * 48271) % 2147483647) % n;
  for (let i = 0; i < 300; i++) {
    const items = Array.from({ length: 1 + rnd(6) }, () => ({ w: rnd(80), h: rnd(40), grow: rnd(3) === 0 ? 1 + rnd(3) : 0 }));
    const o = { kind: 'row', gap: rnd(10), padding: rnd(10), align: ['start', 'center', 'end', 'stretch'][rnd(4)], justify: ['start', 'center', 'end', 'spaceBetween'][rnd(4)] };
    const out = arrange(o, items, 50 + rnd(400), 10 + rnd(80));
    for (let k = 1; k < out.length; k++) assert.ok(out[k][0] >= out[k - 1][0] + out[k - 1][2], JSON.stringify([o, items, out]));
    for (const r of out) assert.ok(r.every(Number.isInteger) && r[2] >= 0 && r[3] >= 0);
  }
});
test('anchorRect: fill', () => assert.deepEqual(anchorRect('fill', 10, 20, 0, 0, 100, 100, 300, 200), [110, 120, 280, 160]));
test('layoutTree: tells what a Scroll clips and holds', () => {
  const seen = {};
  const P = (name, type, props, children = []) => ({ name, type, props, children });
  const top = P('Screen', 'Group', {}, [P('S', 'Scroll', { x: 10, y: 10, width: 100, height: 50 }, [P('A', 'Panel', { height: 80 }, [P('In', 'Label', {})])])]);
  layoutTree(top, treeApi(schema.types), 640, 360, (n, r, parent, info) => { seen[n.name] = info; });
  assert.deepEqual(seen.S.content, [100, 80]);
  assert.equal(seen.S.clip, null);
  assert.deepEqual(seen.A.clip, [10, 10, 100, 50]);
  assert.deepEqual(seen.In.clip, [10, 10, 100, 50]);
  assert.ok(seen.A.slotted && !seen.In.slotted && !seen.S.slotted);
});

console.log(`uilayout tests: ${passed} passed`);
