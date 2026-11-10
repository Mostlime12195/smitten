// An Animator's animations, as the editor changes them (the Animate panel,
// workspaces/scene/animate-panel.js). Every change is one undoable edit of
// the Animator's `animations` property through the SceneDoc; the data is
// what love/src/modules/scene/animator.lua plays:
//
//   animations = { open: { length: 1, loop: false, tracks: [
//     { piece: 'Door', property: 'y', keys: [{ time: 0, value: 0 }, { time: 1, value: -64, easing: 'outQuad' }] },
//     { piece: 'Creak', calls: [{ time: 0, method: 'play' }] } ] } }
//
// A track's piece is a path from the Animator's parent: '.' is the parent
// itself. Angles are degrees, as everywhere in the editor.

import { clone, properties, isA, typeDef } from './schema.js';
import { sorted, sample, lengthOf } from '../workspaces/scene/keyframes.js';

/** Keys closer than this in time are the same key. */
export const SAME_TIME = 1e-6;

const round = (t) => Math.round(t * 1e6) / 1e6;

/** The Animator's animations (never null). */
export function animationsOf(doc, animator) {
  const v = doc.get(animator, 'animations');
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function animationNames(doc, animator) {
  return Object.keys(animationsOf(doc, animator));
}

/** Changes the animations as one undo step: fn(draft) changes a copy. */
export function editAnimations(doc, animator, label, fn, { merge = null } = {}) {
  const draft = clone(animationsOf(doc, animator));
  if (fn(draft) === false) return false;
  doc.setProps(animator, { animations: draft }, { label, merge });
  return true;
}

/** A name not taken yet: base, base2, base3... */
export function uniqueAnimationName(doc, animator, base = 'animation') {
  const taken = new Set(animationNames(doc, animator));
  base = String(base).trim() || 'animation';
  if (!taken.has(base)) return base;
  const stem = base.replace(/\d+$/, '');
  for (let i = 2; ; i++) if (!taken.has(stem + i)) return stem + i;
}

/**
 * Adds an empty animation (one second long). The first animation of an
 * Animator with no autoplay also becomes its autoplay, in the same step,
 * so pressing Play shows it.
 */
export function addAnimation(doc, animator, name) {
  name = uniqueAnimationName(doc, animator, name);
  const first = !animationNames(doc, animator).length && !doc.get(animator, 'autoplay');
  const anims = clone(animationsOf(doc, animator));
  anims[name] = { length: 1, loop: false, tracks: [] };
  doc.setProps(animator, first ? { animations: anims, autoplay: name } : { animations: anims }, { label: `Add the animation ${name}` });
  return name;
}

export function renameAnimation(doc, animator, from, to) {
  to = String(to).trim();
  const anims = animationsOf(doc, animator);
  if (!to || to === from || !anims[from] || anims[to]) return false;
  const out = {};
  for (const [k, v] of Object.entries(anims)) out[k === from ? to : k] = clone(v);
  const values = { animations: out };
  if (doc.get(animator, 'autoplay') === from) values.autoplay = to;
  doc.setProps(animator, values, { label: `Rename the animation ${from}` });
  return true;
}

export function deleteAnimation(doc, animator, name) {
  const anims = clone(animationsOf(doc, animator));
  if (!anims[name]) return false;
  delete anims[name];
  const values = { animations: anims };
  if (doc.get(animator, 'autoplay') === name) values.autoplay = '';
  doc.setProps(animator, values, { label: `Delete the animation ${name}` });
  return true;
}

/** Sets an animation's length and loop: { length, loop }. */
export function setAnimation(doc, animator, name, values, opts = {}) {
  return editAnimations(doc, animator, opts.label || 'Change the animation', (a) => {
    const anim = a[name];
    if (!anim) return false;
    if (values.length !== undefined) anim.length = Math.max(0.01, round(Number(values.length) || 0));
    if (values.loop !== undefined) anim.loop = !!values.loop;
  }, opts);
}

/** The keys of a track: its keys, or its call keys. */
export const keysOf = (track) => track.calls || track.keys || [];

/** Adds a track for a property (or call keys, with property null); returns its index. */
export function addTrack(doc, animator, name, piece, property) {
  let index = -1;
  editAnimations(doc, animator, property ? `Add a track for ${piece}.${property}` : `Add call keys for ${piece}`, (a) => {
    const anim = a[name];
    if (!anim) return false;
    anim.tracks = anim.tracks || [];
    const found = anim.tracks.findIndex((t) => t.piece === piece && (property ? t.property === property : !!t.calls));
    if (found >= 0) {
      index = found;
      return false;
    }
    anim.tracks.push(property ? { piece, property, keys: [] } : { piece, calls: [] });
    index = anim.tracks.length - 1;
  });
  return index;
}

export function removeTrack(doc, animator, name, index) {
  return editAnimations(doc, animator, 'Delete a track', (a) => {
    const anim = a[name];
    if (!anim?.tracks?.[index]) return false;
    anim.tracks.splice(index, 1);
  });
}

/**
 * Puts a key in a property track at a time (changing the key that is there,
 * if there's one). Returns the key's index.
 */
export function setKey(doc, animator, name, trackIndex, time, value, { easing, merge = null, label = 'Set a key' } = {}) {
  let index = -1;
  editAnimations(doc, animator, label, (a) => {
    const track = a[name]?.tracks?.[trackIndex];
    if (!track?.keys) return false;
    index = putKey(track, round(time), value, easing);
  }, { merge });
  return index;
}

function putKey(track, time, value, easing) {
  const keys = track.keys;
  let i = keys.findIndex((k) => Math.abs(k.time - time) < SAME_TIME);
  if (i >= 0) {
    keys[i].value = clone(value);
    if (easing !== undefined) setEasing(keys[i], easing);
    return i;
  }
  const key = { time, value: clone(value) };
  if (easing) setEasing(key, easing);
  i = keys.findIndex((k) => k.time > time);
  if (i < 0) i = keys.length;
  keys.splice(i, 0, key);
  return i;
}

function setEasing(key, easing) {
  if (!easing || easing === 'linear') delete key.easing;
  else key.easing = easing;
}

/** Adds a call key; returns its index. */
export function addCall(doc, animator, name, trackIndex, time, method, args = []) {
  let index = -1;
  editAnimations(doc, animator, 'Add a call key', (a) => {
    const track = a[name]?.tracks?.[trackIndex];
    if (!track?.calls) return false;
    const call = { time: round(time), method };
    if (args.length) call.args = clone(args);
    index = track.calls.findIndex((k) => k.time > call.time);
    if (index < 0) index = track.calls.length;
    track.calls.splice(index, 0, call);
  });
  return index;
}

/**
 * Changes one key: { time, value, easing } for a property key, { time,
 * method, args } for a call key.
 */
export function changeKey(doc, animator, name, ref, values, { merge = null } = {}) {
  return editAnimations(doc, animator, 'Change a key', (a) => {
    const track = a[name]?.tracks?.[ref.track];
    const key = track && keysOf(track)[ref.index];
    if (!key) return false;
    if (values.time !== undefined) key.time = Math.max(0, round(Number(values.time) || 0));
    if (values.value !== undefined) key.value = clone(values.value);
    if (values.easing !== undefined) setEasing(key, values.easing);
    if (values.method !== undefined) key.method = String(values.method);
    if (values.args !== undefined) {
      if (values.args?.length) key.args = clone(values.args);
      else delete key.args;
    }
  }, { merge });
}

/**
 * Moves keys in time: refs [{track, index}], to their times in `from` (the
 * times when the drag started) plus dt. snap rounds the times. Keys stay
 * where they are in their lists, so refs stay good during a drag; put them
 * in order with sortKeys() at the end.
 */
export function moveKeys(doc, animator, name, refs, from, dt, { snap = 0, merge = null } = {}) {
  return editAnimations(doc, animator, refs.length === 1 ? 'Move a key' : `Move ${refs.length} keys`, (a) => {
    const anim = a[name];
    if (!anim) return false;
    refs.forEach((r, i) => {
      const key = keysOf(anim.tracks?.[r.track] || {})[r.index];
      if (!key) return;
      let t = Math.max(0, from[i] + dt);
      if (snap > 0) t = Math.round(t / snap) * snap;
      key.time = round(t);
    });
  }, { merge });
}

/**
 * Puts every track's keys in time order (keys at one time keep their
 * order). Returns where each ref is now, for the selection.
 */
export function sortKeys(doc, animator, name, refs = [], { merge = null } = {}) {
  let out = refs;
  editAnimations(doc, animator, 'Move keys', (a) => {
    const anim = a[name];
    if (!anim) return false;
    const moved = new Map();
    let changed = false;
    (anim.tracks || []).forEach((tr, ti) => {
      const list = keysOf(tr);
      const order = sorted(list.map((k, i) => ({ time: k.time, i })));
      if (order.every((o, j) => o.i === j)) return;
      changed = true;
      const next = order.map((o) => list[o.i]);
      if (tr.calls) tr.calls = next;
      else tr.keys = next;
      order.forEach((o, j) => moved.set(`${ti}:${o.i}`, j));
    });
    if (!changed) return false;
    out = refs.map((r) => ({ track: r.track, index: moved.get(`${r.track}:${r.index}`) ?? r.index }));
  }, { merge });
  return out;
}

export function deleteKeys(doc, animator, name, refs) {
  if (!refs.length) return false;
  return editAnimations(doc, animator, refs.length === 1 ? 'Delete a key' : `Delete ${refs.length} keys`, (a) => {
    const anim = a[name];
    if (!anim) return false;
    const byTrack = new Map();
    for (const r of refs) {
      if (!byTrack.has(r.track)) byTrack.set(r.track, []);
      byTrack.get(r.track).push(r.index);
    }
    for (const [ti, list] of byTrack) {
      const keys = keysOf(anim.tracks?.[ti] || {});
      for (const i of [...new Set(list)].sort((x, y) => y - x)) keys.splice(i, 1);
    }
  });
}

// ---------------------------------------------------------------------------
// Pieces and paths

/** Where tracks' paths start: the Animator's parent (or itself, at the root). */
export function baseOf(animator) {
  return animator.parent || animator;
}

/** The pieces a track can name, with their paths: [{ node, path }], the parent first. */
export function targetsOf(doc, animator) {
  const out = [];
  const base = baseOf(animator);
  const walk = (n, path) => {
    out.push({ node: n, path });
    for (const c of doc.effectiveChildren(n)) walk(c, path === '.' ? c.name : `${path}/${c.name}`);
  };
  walk(base, '.');
  return out;
}

/** The piece a track names, or null. */
export function resolve(doc, animator, path) {
  let n = baseOf(animator);
  for (const part of String(path ?? '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') n = n.parent;
    else n = doc.effectiveChildren(n).find((c) => c.name === part) || null;
    if (!n) return null;
  }
  return n;
}

/** The path of a piece from the Animator's parent, or null if it isn't there. */
export function pathTo(doc, animator, node) {
  const base = baseOf(animator);
  const parts = [];
  for (let n = node; n; n = n.parent) {
    if (n === base) return parts.length ? parts.join('/') : '.';
    parts.unshift(n.name);
  }
  return null;
}

/** The properties a track can change on a piece type: [{ name, def }]. */
export function animatable(type) {
  return properties(type).filter(({ def }) => !def.hidden && def.type !== 'animations' && def.type !== 'cells');
}

/** Whether a property's keys change smoothly (else they step). */
export function smooth(type, property) {
  const def = properties(type).find((p) => p.name === property)?.def;
  return !!def && ['number', 'int', 'angle', 'color', 'points'].includes(def.type);
}

/** The methods a call key can call on a type, sorted ("play" first for a Sound). */
export function callable(type) {
  const out = [];
  let t = type;
  const seen = new Set();
  while (t && typeDef(t)) {
    for (const m of Object.keys(typeDef(t).methods || {})) if (!seen.has(m)) { seen.add(m); out.push(m); }
    t = typeDef(t).extends;
  }
  return out.sort();
}

/** A new call key's method and args for a piece: play() on a Sound, else emit(event). */
export function defaultCall(type, event = 'key') {
  if (isA(type, 'Sound')) return { method: 'play', args: [] };
  return { method: 'emit', args: [event] };
}

// ---------------------------------------------------------------------------
// Recording and preview

/**
 * Record: properties set on pieces (from the Inspector or the scene view)
 * become keys at a time instead. entries: [[node, {key: value}]]. A track
 * made by recording at a time after 0 also gets a key at 0 with the value
 * the piece had, so the animation starts from where the piece was. All in
 * one undo step (merged while a drag goes on). Returns the entries (or the
 * parts of them) that aren't recorded: pieces outside the Animator's parent,
 * the Animator itself, and properties no track can have.
 */
export function record(doc, animator, name, time, entries, { merge = null, label = 'Record keys' } = {}) {
  const rest = [];
  const todo = [];
  for (const [node, values] of entries) {
    const path = node === animator || node.readonly ? null : pathTo(doc, animator, node);
    const keep = {};
    for (const [k, v] of Object.entries(values)) {
      const ok = path !== null && v !== undefined && animatable(node.type).some((p) => p.name === k);
      if (ok) todo.push({ node, path, property: k, value: v });
      else keep[k] = v;
    }
    if (Object.keys(keep).length) rest.push([node, keep]);
  }
  if (!todo.length) return rest;
  time = round(time);
  editAnimations(doc, animator, label, (a) => {
    const anim = a[name];
    if (!anim) return false;
    anim.tracks = anim.tracks || [];
    for (const r of todo) {
      let track = anim.tracks.find((t) => t.piece === r.path && t.property === r.property);
      if (!track) {
        track = { piece: r.path, property: r.property, keys: [] };
        anim.tracks.push(track);
        if (time > SAME_TIME) putKey(track, 0, doc.get(r.node, r.property));
      }
      putKey(track, time, r.value);
    }
  }, { merge: merge && `record:${merge}` });
  return rest;
}

/**
 * What the scene looks like at a time of an animation: { nodes: Map(node ->
 * {key: value}), paths: Map(path from the scene root -> {key: value}) } for
 * SceneDoc.setPreview(). Pieces from placed scenes are new objects each time
 * the scene view asks for them, so they're found by path.
 */
export function previewAt(doc, animator, name, time) {
  const anim = animationsOf(doc, animator)[name];
  const out = { nodes: new Map(), paths: new Map() };
  if (!anim) return out;
  for (const tr of anim.tracks || []) {
    if (!tr.keys?.length || !tr.property) continue;
    const node = resolve(doc, animator, tr.piece);
    if (!node) continue;
    const value = sample(sorted(tr.keys), time);
    if (value === undefined) continue;
    const map = node.readonly ? out.paths : out.nodes;
    const id = node.readonly ? doc.pathOf(node) : node;
    if (!map.has(id)) map.set(id, {});
    map.get(id)[tr.property] = value;
  }
  return out;
}

/** A call key's values as typed: "opened", 2, true -> ['opened', 2, true]; a word without quotes is a word. */
export function parseArgs(text) {
  const out = [];
  for (const raw of String(text).split(',')) {
    const s = raw.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      out.push(s.replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

export { lengthOf };
