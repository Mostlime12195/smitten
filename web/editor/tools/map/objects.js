// The project's object types (docs/objects-and-scenes.md, "Objects"), as the
// scene editor needs them: each objects/<type>.lua file's sprite, behaviors
// and definition defaults, read from the file's `smitten.object { ... }`
// table without running it, and the sprite resolved the way smitten.sprite
// resolves it (love/src/modules/smitten/lua/sprite.lua).

import { joinPath } from './model.js';

/** Fields the built-in behaviors read, with their defaults (docs/objects-and-scenes.md, "Behaviors"). */
export const BEHAVIOR_FIELDS = {
  platformer: { speed: 90, acceleration: 900, jumpSpeed: 260, gravity: 760, maxFall: 420 },
  topdown: { speed: 80 },
  mover: { bounce: false },
};

/** Definition fields that aren't per-object values (shown elsewhere, or tables). */
const STRUCTURAL = new Set(['sprite', 'behaviors', 'width', 'height']);

const OBJECT_FILE = /^objects\/([^/]+)\.lua$/;

/** The object type an objects/*.lua path defines, or null. */
export function objectTypeOf(path) {
  const m = OBJECT_FILE.exec(path);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// A small Lua tokenizer, enough to read a table constructor.

const BLOCK_OPEN = new Set(['function', 'if', 'do', 'repeat']);

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  const longBracket = (at) => /^\[(=*)\[/.exec(src.slice(at, at + 64));
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    if (c === '-' && src[i + 1] === '-') {
      const m = longBracket(i + 2);
      if (m) {
        const end = src.indexOf(`]${m[1]}]`, i + 2 + m[0].length);
        i = end < 0 ? n : end + m[1].length + 2;
      } else {
        const end = src.indexOf('\n', i);
        i = end < 0 ? n : end + 1;
      }
      continue;
    }
    const start = i;
    if (c === '"' || c === "'") {
      let v = '';
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) {
          const e = src[i + 1];
          v += { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" }[e] ?? e;
          i += 2;
        } else v += src[i++];
      }
      i++;
      toks.push({ t: 'str', v, start, end: i });
      continue;
    }
    if (c === '[') {
      const m = longBracket(i);
      if (m) {
        const close = `]${m[1]}]`;
        const end = src.indexOf(close, i + m[0].length);
        const v = src.slice(i + m[0].length, end < 0 ? n : end).replace(/^\r?\n/, '');
        i = end < 0 ? n : end + close.length;
        toks.push({ t: 'str', v, start, end: i });
        continue;
      }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(src.slice(i, i + 64));
      i += m ? m[0].length : 1;
      toks.push({ t: 'num', v: Number(m ? m[0] : c), start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 256));
      i += m[0].length;
      toks.push({ t: 'name', v: m[0], start, end: i });
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    const p = three === '...' ? three : ['==', '~=', '<=', '>=', '..', '::', '//', '<<', '>>'].includes(two) ? two : c;
    i += p.length;
    toks.push({ t: 'op', v: p, start, end: i });
  }
  return toks;
}

/**
 * The fields of the table passed to `smitten.object`, or null if the file
 * has no such call. Values: numbers, strings, booleans and lists of strings
 * as themselves; anything else as {expr: 'source text'}.
 */
export function parseObjectDefinition(src) {
  if (typeof src !== 'string') return null;
  const toks = tokenize(src);
  let k = -1;
  for (let i = 0; i + 2 < toks.length; i++) {
    if (toks[i].v === 'smitten' && toks[i + 1].v === '.' && toks[i + 2].v === 'object') {
      let j = i + 3;
      if (toks[j]?.v === '(') j++;
      if (toks[j]?.v === '{') { k = j; break; }
    }
  }
  if (k < 0) return null;
  const fields = {};
  k++;
  while (k < toks.length && toks[k].v !== '}') {
    let key = null;
    if (toks[k].t === 'name' && toks[k + 1]?.v === '=' && toks[k + 2]?.v !== '=') {
      key = toks[k].v;
      k += 2;
    }
    const from = k;
    let depth = 0;
    while (k < toks.length) {
      const v = toks[k].v;
      const op = toks[k].t === 'op';
      if (op && depth === 0 && (v === ',' || v === ';' || v === '}')) break;
      // Brackets and block keywords (a function value may hold commas).
      if (op ? (v === '(' || v === '{' || v === '[') : (toks[k].t === 'name' && BLOCK_OPEN.has(v))) depth++;
      else if (op ? (v === ')' || v === '}' || v === ']') : (toks[k].t === 'name' && (v === 'end' || v === 'until'))) depth--;
      k++;
    }
    if (key) fields[key] = literal(toks.slice(from, k), src);
    if (toks[k]?.v === ',' || toks[k]?.v === ';') k++;
  }
  return fields;
}

function literal(ts, src) {
  if (!ts.length) return { expr: '' };
  if (ts.length === 1) {
    const t = ts[0];
    if (t.t === 'str' || t.t === 'num') return t.v;
    if (t.v === 'true') return true;
    if (t.v === 'false') return false;
    if (t.v === 'nil') return null;
  }
  if (ts.length === 2 && ts[0].v === '-' && ts[1].t === 'num') return -ts[1].v;
  if (ts[0].v === '{' && ts[ts.length - 1].v === '}') {
    const inner = ts.slice(1, -1).filter((t) => !(t.t === 'op' && (t.v === ',' || t.v === ';')));
    if (inner.every((t) => t.t === 'str')) return inner.map((t) => t.v);
  }
  return { expr: src.slice(ts[0].start, ts[ts.length - 1].end) };
}

// ---------------------------------------------------------------------------
// Sprites

function parseJsonObject(text) {
  if (typeof text !== 'string') return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function pngSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes[1] !== 0x50) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/**
 * Resolve a sprite reference ("sprites/coin", "sprites/coin.png" or
 * "sprites/coin.sprite.json") like smitten.sprite: an exact .sprite.json or
 * .png first, then the reference plus .sprite.json, then plus .png; a PNG's
 * sibling .sprite.json describes it. Returns {imagePath, metaPath, frameWidth,
 * frameHeight, columns, originX, originY, animations, deps, error}.
 */
export function resolveSprite(host, ref, startAnimation) {
  const path = String(ref).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const out = { ref, imagePath: null, metaPath: null, deps: new Set(), error: null, frame: 0 };
  const exists = (p) => { out.deps.add(p); return host.exists(p); };
  let resolved = null;
  for (const ext of ['.sprite.json', '.png']) {
    if (path.toLowerCase().endsWith(ext) && exists(path)) { resolved = path; break; }
  }
  if (!resolved) for (const ext of ['.sprite.json', '.png']) if (exists(path + ext)) { resolved = path + ext; break; }
  if (!resolved) {
    out.error = `Can't find the sprite "${ref}" (looked for ${path}.png)`;
    return out;
  }
  let meta = null;
  if (/\.sprite\.json$/i.test(resolved)) out.metaPath = resolved;
  else {
    out.imagePath = resolved;
    const sibling = `${resolved.slice(0, -4)}.sprite.json`;
    if (exists(sibling)) out.metaPath = sibling;
  }
  if (out.metaPath) {
    meta = parseJsonObject(host.read(out.metaPath)) || {};
    if (typeof meta.image === 'string' && meta.image) out.imagePath = joinPath(out.metaPath, meta.image);
    else if (!out.imagePath) out.imagePath = out.metaPath.replace(/\.sprite\.json$/i, '.png');
  }
  out.deps.add(out.imagePath);
  const bytes = host.read(out.imagePath);
  const size = pngSize(bytes);
  if (!size) {
    out.error = bytes === undefined ? `The sprite's image ${out.imagePath} doesn't exist` : `${out.imagePath} isn't a PNG`;
    return out;
  }
  out.bytes = bytes;
  const posInt = (v, d) => (Number.isInteger(v) && v > 0 ? Math.min(v, d) : d);
  out.frameWidth = posInt(meta?.frameWidth, size.width);
  out.frameHeight = posInt(meta?.frameHeight, size.height);
  out.columns = Math.max(1, Math.floor(size.width / out.frameWidth));
  const frameCount = out.columns * Math.max(1, Math.floor(size.height / out.frameHeight));
  const origin = Array.isArray(meta?.origin) ? meta.origin : [0, 0];
  out.originX = Number(origin[0]) || 0;
  out.originY = Number(origin[1]) || 0;
  const anims = meta?.animations && typeof meta.animations === 'object' ? meta.animations : {};
  const names = Object.keys(anims).sort(); // smitten.sprite's animationNames() order
  out.animations = names;
  // The starting animation (docs/objects-and-scenes.md): the definition's
  // `animation`, else "idle", else the first; its first frame is drawn.
  const name = startAnimation && anims[startAnimation] ? startAnimation : anims.idle ? 'idle' : names[0];
  const frames = name && Array.isArray(anims[name]?.frames) ? anims[name].frames : null;
  const f = frames?.length ? frames[0] : 0;
  out.animation = name || null;
  out.frame = Number.isInteger(f) && f >= 0 && f < frameCount ? f : 0;
  return out;
}

// ---------------------------------------------------------------------------
// The registry

export class ObjectTypes {
  /** image(path, bytes) returns the editor's decoded-image record ({bitmap}) for a PNG. */
  constructor(host, image) {
    this.host = host;
    this.image = image;
    this.types = new Map();
    this.deps = new Set();
    this.scan();
  }

  scan() {
    this.types = new Map();
    this.deps = new Set();
    for (const path of this.host.list().sort()) {
      const type = objectTypeOf(path);
      if (!type) continue;
      const def = parseObjectDefinition(this.host.read(path)) || {};
      const entry = {
        type,
        path,
        def,
        behaviors: Array.isArray(def.behaviors) ? def.behaviors.filter((b) => typeof b === 'string') : [],
        sprite: null,
      };
      if (typeof def.sprite === 'string' && def.sprite) {
        entry.sprite = resolveSprite(this.host, def.sprite, typeof def.animation === 'string' ? def.animation : null);
        for (const d of entry.sprite.deps) this.deps.add(d);
        if (!entry.sprite.error) entry.sprite.img = this.image(entry.sprite.imagePath, entry.sprite.bytes);
      }
      this.types.set(type, entry);
    }
  }

  get(type) { return this.types.get(type) || null; }

  list() { return [...this.types.values()]; }

  /** Whether a change to this file can change the types. */
  affects(path) {
    return path === undefined || objectTypeOf(path) !== null || this.deps.has(path);
  }

  /**
   * The per-object values a type offers, with their defaults: its definition's
   * fields (except sprite, behaviors and size), then its behaviors' fields.
   * [{key, value, from}] where from is 'definition' or a behavior name.
   */
  fields(entry) {
    const out = [];
    const seen = new Set();
    for (const [key, value] of Object.entries(entry.def)) {
      if (STRUCTURAL.has(key) || value === null) continue;
      seen.add(key);
      out.push({ key, value, from: 'definition' });
    }
    for (const b of entry.behaviors) {
      for (const [key, value] of Object.entries(BEHAVIOR_FIELDS[b] || {})) {
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, value, from: b });
      }
    }
    return out;
  }

  /** The type's default hitbox size: the definition's width/height, else the sprite's frame size, else 16×16. */
  defaultSize(entry) {
    const num = (v) => (typeof v === 'number' && v > 0 ? v : null);
    return {
      width: num(entry.def.width) ?? (entry.sprite && !entry.sprite.error ? entry.sprite.frameWidth : 16),
      height: num(entry.def.height) ?? (entry.sprite && !entry.sprite.error ? entry.sprite.frameHeight : 16),
    };
  }
}

/** Draw a type's sprite frame into a canvas of size × size CSS pixels (letterboxed, whole-number scale when it fits). */
export function drawThumbnail(canvas, entry, size) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const s = entry?.sprite;
  const bmp = s?.img?.bitmap;
  if (!bmp) return false;
  const fw = s.frameWidth;
  const fh = s.frameHeight;
  let scale = (size * dpr) / Math.max(fw, fh);
  if (scale >= 1) scale = Math.floor(scale);
  const w = fw * scale;
  const h = fh * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, (s.frame % s.columns) * fw, Math.floor(s.frame / s.columns) * fh, fw, fh,
    Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
  return true;
}
