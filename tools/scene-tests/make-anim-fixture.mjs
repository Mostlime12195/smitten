// Writes tools/scene-tests/animation/keyframe-cases.json: tracks and call
// keys with what the editor's keyframes.js gives for them. The engine's copy
// (love/src/modules/scene/keyframes.lua) is checked against the same file by
// tools/animation-tests/test.lua and the "animation" scene test, and
// web/editor/workspaces/scene/keyframes.test.mjs checks keyframes.js against
// it and against values worked out by hand.
//
//   node tools/scene-tests/make-anim-fixture.mjs
//
// Run it after changing the rules, and change keyframes.lua with them.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sample, sorted, callsBetween, EASING_NAMES } from '../../web/editor/workspaces/scene/keyframes.js';

const here = dirname(fileURLToPath(import.meta.url));
const TIMES = [-1, 0, 0.1, 0.25, 0.5, 0.75, 0.9, 1, 1.5, 2, 3];

const tracks = [
  { name: 'one key', keys: [{ time: 0.5, value: 7 }] },
  { name: 'linear numbers', keys: [{ time: 0, value: 0 }, { time: 1, value: 10 }, { time: 2, value: -10 }] },
  { name: 'keys out of order', keys: [{ time: 2, value: 4 }, { time: 0, value: 0 }, { time: 1, value: 2 }] },
  { name: 'two keys at one time', keys: [{ time: 0, value: 0 }, { time: 1, value: 5 }, { time: 1, value: 9 }, { time: 2, value: 1 }] },
  { name: 'step easing', keys: [{ time: 0, value: 1 }, { time: 1, value: 3, easing: 'step' }, { time: 2, value: 5 }] },
  { name: 'booleans step', keys: [{ time: 0, value: false }, { time: 0.5, value: true }, { time: 1.5, value: false }] },
  { name: 'strings step', keys: [{ time: 0, value: 'idle' }, { time: 1, value: 'walk', easing: 'outQuad' }] },
  { name: 'colors', keys: [{ time: 0, value: [1, 0, 0, 1] }, { time: 1, value: [0, 0, 1, 0.5] }, { time: 2, value: [0, 1, 0, 1], easing: 'inQuad' }] },
  { name: 'lists of other lengths step', keys: [{ time: 0, value: [0, 0] }, { time: 1, value: [10, 10, 10] }] },
  { name: 'a number then a word steps', keys: [{ time: 0, value: 3 }, { time: 1, value: 'x' }] },
  { name: 'unknown easing is linear', keys: [{ time: 0, value: 0 }, { time: 1, value: 10, easing: 'wobbly' }] },
  ...EASING_NAMES.filter((e) => e !== 'step').map((e) => ({ name: `easing ${e}`, keys: [{ time: 0, value: 0 }, { time: 1, value: 100, easing: e }] })),
].map((t) => ({ ...t, times: TIMES, expect: TIMES.map((x) => sample(sorted(t.keys), x)) }));

const calls = [
  {
    name: 'calls',
    calls: [{ time: 0, id: 'a' }, { time: 0.25, id: 'b' }, { time: 0.5, id: 'c' }, { time: 0.5, id: 'd' }, { time: 1, id: 'e' }],
    ranges: [[0, 0.1, true], [0, 0.1, false], [0.1, 0.5, false], [0.25, 0.5, false], [0.25, 0.5, true], [0.5, 1, false], [0, 1, true], [1, 1, false], [1, 1, true],
      [1, 0, false], [1, 0, true], [0.5, 0.25, false], [0.5, 0.25, true], [0.3, 0, false], [2, 3, false], [-1, -0.5, false]],
  },
  { name: 'no calls', calls: [], ranges: [[0, 1, true], [1, 0, true]] },
  { name: 'calls out of order', calls: [{ time: 0.75, id: 'late' }, { time: 0.25, id: 'early' }, { time: 0.25, id: 'early2' }], ranges: [[0, 1, false], [1, 0, false]] },
].map((c) => {
  const list = sorted(c.calls);
  return { ...c, expect: c.ranges.map(([from, to, inc]) => callsBetween(list, from, to, inc).map((i) => list[i].id)) };
});

const file = join(here, 'animation', 'keyframe-cases.json');
// One case a line; numbers to 12 places (the tests allow 1e-9).
const line = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 1e12) / 1e12 : x));
const json = `{\n"tracks": [\n${tracks.map(line).join(',\n')}\n],\n"calls": [\n${calls.map(line).join(',\n')}\n]\n}\n`;
JSON.parse(json);
writeFileSync(file, json);
console.log(`wrote ${file}: ${tracks.length} tracks, ${calls.length} call lists`);
