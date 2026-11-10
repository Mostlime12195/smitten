// node web/editor/workspaces/scene/keyframes.test.mjs
//
// keyframes.js (the Animate panel's preview) against the cases the engine
// is checked with too (tools/scene-tests/animation/keyframe-cases.json, made
// by tools/scene-tests/make-anim-fixture.mjs; tools/animation-tests/test.lua
// and the "animation" scene test run them through the engine's
// keyframes.lua), and against values worked out by hand.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sample, sorted, find, callsBetween, lengthOf, EASINGS, EASING_NAMES } from './keyframes.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const fixture = JSON.parse(readFileSync(join(root, 'tools/scene-tests/animation/keyframe-cases.json'), 'utf8'));
const tween = readFileSync(join(root, 'love/src/modules/tween/init.lua'), 'utf8');

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

const close = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => close(x, b[i]));
  return a === b;
};

// The file is what keyframes.js gives now.
for (const c of fixture.tracks) {
  test(`fixture: ${c.name}`, () => {
    const keys = sorted(c.keys);
    c.times.forEach((t, i) => assert.ok(close(sample(keys, t), c.expect[i]), `at ${t}: ${JSON.stringify(sample(keys, t))} vs ${JSON.stringify(c.expect[i])}`));
  });
}
for (const c of fixture.calls) {
  test(`fixture: ${c.name}`, () => {
    const list = sorted(c.calls);
    c.ranges.forEach(([from, to, inc], i) => assert.deepEqual(callsBetween(list, from, to, inc).map((k) => list[k].id), c.expect[i]));
  });
}
test('fixture: every easing is in a case', () => {
  for (const e of EASING_NAMES) if (e !== 'step') assert.ok(fixture.tracks.some((c) => c.name === `easing ${e}`), e);
});
test('the engine has the same easings', () => {
  const names = [...tween.matchAll(/^\t(\w+) = function\(t\)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(names, EASING_NAMES.filter((e) => e !== 'step'));
});

// By hand ------------------------------------------------------------------

const keys = (...pairs) => pairs.map(([time, value, easing]) => ({ time, value, easing }));

test('by hand: linear halfway', () => assert.equal(sample(keys([0, 0], [2, 10]), 1), 5));
test('by hand: the easing of the later key', () => {
  // outQuad(0.5) = 0.75: 75 of the 100.
  assert.equal(sample(keys([0, 0, 'inQuad'], [1, 100, 'outQuad']), 0.5), 75);
});
test('by hand: before the first and after the last key', () => {
  const k = keys([1, 3], [2, 6]);
  assert.equal(sample(k, 0), 3);
  assert.equal(sample(k, 9), 6);
});
test('by hand: step', () => {
  const k = keys([0, 1], [1, 2, 'step']);
  assert.equal(sample(k, 0.99), 1);
  assert.equal(sample(k, 1), 2);
});
test('by hand: a color halfway', () => assert.deepEqual(sample(keys([0, [1, 0, 0, 1]], [1, [0, 0, 1, 0]]), 0.5), [0.5, 0, 0.5, 0.5]));
test('by hand: true until the next key', () => {
  const k = keys([0, true], [1, false]);
  assert.equal(sample(k, 0.5), true);
  assert.equal(sample(k, 1), false);
});
test('by hand: find', () => {
  const k = keys([0, 0], [1, 1], [1, 2], [3, 3]);
  assert.equal(find(k, -1), -1);
  assert.equal(find(k, 0.5), 0);
  assert.equal(find(k, 1), 2);
  assert.equal(find(k, 5), 3);
});
test('by hand: calls in a pass', () => {
  const c = [{ time: 0 }, { time: 0.5 }, { time: 1 }];
  assert.deepEqual(callsBetween(c, 0, 0.5, true), [0, 1]);
  assert.deepEqual(callsBetween(c, 0, 0.5), [1]);
  assert.deepEqual(callsBetween(c, 1, 0.5), [1]);
});
test('by hand: easings start at 0 and end at 1', () => {
  for (const [name, fn] of Object.entries(EASINGS)) {
    if (name === 'step') continue;
    assert.ok(Math.abs(fn(0)) < 1e-9 && Math.abs(fn(1) - 1) < 1e-9, name);
  }
});
test('by hand: length', () => {
  assert.equal(lengthOf({ length: 2, tracks: [] }), 2);
  assert.equal(lengthOf({ tracks: [{ keys: [{ time: 0.5 }] }, { calls: [{ time: 1.5 }] }] }), 1.5);
  assert.equal(lengthOf({}), 0);
});

console.log(`keyframes: ${passed} passed`);
