// Keyframes: the maths of animations, as the engine does it
// (love/src/modules/scene/keyframes.lua), for the Animate panel's preview.
// Both copies are checked with the cases in
// tools/scene-tests/animation/keyframe-cases.json (written by
// tools/scene-tests/make-anim-fixture.mjs): keep the two in step.
//
// A key is { time, value, easing }. A key's easing shapes the change from
// the key before it to this key; "step" keeps the earlier value until this
// key's time. Numbers change smoothly, and so do lists of numbers of the
// same length (colors, points); other values step. Indices here count from
// 0, where the Lua copy's count from 1.

const { PI, sin, cos } = Math;

/** The engine's easings (love/src/modules/tween/init.lua), and "step". */
export const EASINGS = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => { t -= 1; return t * t * t + 1; },
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  inSine: (t) => 1 - cos(t * PI / 2),
  outSine: (t) => sin(t * PI / 2),
  inOutSine: (t) => -(cos(PI * t) - 1) / 2,
  inExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inBack: (t) => { const s = 1.70158; return t * t * ((s + 1) * t - s); },
  outBack: (t) => { const s = 1.70158; t -= 1; return t * t * ((s + 1) * t + s) + 1; },
  inOutBack: (t) => {
    const s = 1.70158 * 1.525;
    t *= 2;
    if (t < 1) return 0.5 * (t * t * ((s + 1) * t - s));
    t -= 2;
    return 0.5 * (t * t * ((s + 1) * t + s) + 2);
  },
  outBounce: (t) => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
    if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
    t -= 2.625 / 2.75;
    return 7.5625 * t * t + 0.984375;
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * sin((t * 10 - 0.75) * (2 * PI) / 3) + 1;
  },
  step: () => 0,
};

export const EASING_NAMES = Object.keys(EASINGS).sort();

/** A copy of a list of keys in time order; keys at the same time keep their order. */
export function sorted(keys) {
  return keys.map((k, i) => [k, i]).sort((a, b) => a[0].time - b[0].time || a[1] - b[1]).map(([k]) => k);
}

/** The index of the last key at or before t, or -1 if t is before the first key. */
export function find(keys, t) {
  const n = keys.length;
  if (!n || t < keys[0].time) return -1;
  if (t >= keys[n - 1].time) return n - 1;
  let lo = 0;
  let hi = n - 1; // keys[lo].time <= t < keys[hi].time
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].time <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

const numbers = (v, n) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number');

/** A track's value at time t (keys sorted). */
export function sample(keys, t) {
  const n = keys.length;
  if (!n) return undefined;
  const i = find(keys, t);
  if (i < 0) return keys[0].value;
  if (i === n - 1) return keys[n - 1].value;
  const a = keys[i];
  const b = keys[i + 1];
  if (b.easing === 'step') return a.value;
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  const e = (EASINGS[b.easing] || EASINGS.linear)((t - a.time) / span);
  const va = a.value;
  const vb = b.value;
  if (typeof va === 'number') return typeof vb === 'number' ? va + (vb - va) * e : va;
  if (Array.isArray(va) && va.length && numbers(va, va.length) && numbers(vb, va.length)) {
    return va.map((x, j) => x + (vb[j] - x) * e);
  }
  return va;
}

/**
 * The indices of the call keys (sorted) that time passes from `from` to
 * `to`, in the order they're called: forward, the keys after from up to and
 * including to; backward, the keys before from down to and including to.
 * inclusive counts a key at exactly `from` too.
 */
export function callsBetween(calls, from, to, inclusive = false) {
  const out = [];
  if (from <= to) {
    calls.forEach((c, i) => {
      if ((c.time > from || (inclusive && c.time === from)) && c.time <= to) out.push(i);
    });
  } else {
    for (let i = calls.length - 1; i >= 0; i--) {
      const t = calls[i].time;
      if ((t < from || (inclusive && t === from)) && t >= to) out.push(i);
    }
  }
  return out;
}

/** An animation's length: its own, else its last key's time. */
export function lengthOf(anim) {
  const own = Number(anim?.length);
  if (Number.isFinite(own) && own > 0) return own;
  let last = 0;
  for (const tr of anim?.tracks || []) for (const k of tr.keys || tr.calls || []) last = Math.max(last, Number(k.time) || 0);
  return last;
}
