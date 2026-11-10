// The 2D scene viewport: draws a scene's 2D and UI nodes the way the engine
// does (love/src/modules/scene/nodes2d.lua, tilemap.lua, ui.lua, physics2d.lua),
// and edits them with the mouse: select, move, rotate, scale, resize, drop
// files from the Files panel, and paint tiles (with tilemap-panel.js).
//
// Every edit goes through the SceneDoc, so undo, the inspector and the Scene
// panel follow. Coordinates: "world" is the scene's 2D space (game pixels,
// y down); "screen" is CSS pixels in the canvas. screen = world * zoom + pan.

import { isA, defaultOf, equal, clone } from '../../core/schema.js';
import { decodeCells, cellBounds } from './cells.js';
import { parseRich, layoutRich } from '../../core/richtext.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 32;
const HANDLE_R = 5; // handle half-size, CSS px
const DRAG_START = 3; // px before a press becomes a drag
const ROTATE_SNAP = Math.PI / 12; // 15 degrees
const SCALE_SNAP = 0.1;
const TOOLS = ['select', 'move', 'rotate', 'scale', 'paint'];
const DEFAULT_FAMILY = '"Noto Sans", "Helvetica Neue", Arial, sans-serif';
const COLLISION_FILL = 'rgba(77, 179, 255, 0.35)';
const COLLISION_LINE = 'rgba(77, 179, 255, 0.85)';
const OCCLUDER_FILL = 'rgba(20, 20, 30, 0.35)';
const OCCLUDER_LINE = 'rgba(255, 196, 77, 0.9)';
const WALKABLE = [70, 200, 120]; // a Walkable's area; holes are drawn in WALKABLE_HOLE
const WALKABLE_HOLE = [235, 110, 85];
const ANCHORS = {
  topLeft: [0, 0], top: [0.5, 0], topRight: [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  bottomLeft: [0, 1], bottom: [0.5, 1], bottomRight: [1, 1],
};
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tga: 'image/x-tga' };
const AUDIO_EXT = new Set(['wav', 'ogg', 'mp3', 'flac', 'sfx', 'song']);
const FONT_EXT = new Set(['ttf', 'otf']);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// The built-in 5 x 7 pixel font (love/src/modules/assets/pixelfont.lua),
// ASCII 32..126: one base-32 digit per row, bit 4 = leftmost pixel.
const PIXEL_GLYPHS = '0000000 4444404 aaa0000 aavavaa 4fke5u4 op248j3 cik8lid 4480000 2488842 8422248 04lel40 044v440 00000cc48 000e000 00000cc 11248gg ehjlphe 4ck444v eh168gv u11e11u 26aiv22 vgu11he egguhhe v124444 ehhehhe ehhf11e 0cc0cc0 0cc0cc48 248g842 00v0v00 8421248 eh16404 ehnlngf ehhvhhh uhhuhhu ehggghe sihhhis vgguggv vgguggg ehgjhhf hhhvhhh v44444v 71111he hikokih ggggggv hrllhhh hhpljhh ehhhhhe uhhuggg ehhhlid uhhukih fgge11u v444444 hhhhhhe hhhhaa4 hhhllrh hha4ahh hha4444 v1248gv e88888e gg84211 e22222e 4ah0000 0000000v 8400000 00e1fhf gguhhhu 00eggge 11fhhhf 00ehvge 688u888 00fhhhf1e gguhhhh 40c444e 2062222ic ggikoki c44444e 00qlllh 00uhhhh 00ehhhe 00uhhhugg 00fhhhf11 00mpggg 00fge1u 88u8886 00hhhhf 00hhha4 00hhlla 00ha4ah 00hhhhf1e 00v248v 2448442 4444444 8442448 008l200'
  .split(' ').map((g) => [...g].map((c) => parseInt(c, 32)));
const PIXEL = { advance: 6, height: 9, spacing: 10, unit: 10 }; // font units; drawn at size / 10

let gestureSeq = 0;
let fontSeq = 0;

// ---------------------------------------------------------------------------
// Small helpers

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function rgba(c, a = 1) {
  const k = (v) => Math.round(clamp(num(v, 1), 0, 1) * 255);
  return `rgba(${k(c[0])}, ${k(c[1])}, ${k(c[2])}, ${clamp(num(c[3], 1) * a, 0, 1)})`;
}

function colorOf(v) {
  if (!Array.isArray(v)) return [1, 1, 1, 1];
  return [num(v[0], 1), num(v[1], 1), num(v[2], 1), num(v[3], 1)];
}

export function extOf(path) {
  const name = String(path).split('/').pop().toLowerCase();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1) : '';
}

/** A project path as the engine's assets.normalize makes it. */
export function normalizePath(path) {
  const p = String(path ?? '').replace(/\\/g, '/').replace(/^res:\/\//, '').replace(/^\.\//, '').replace(/^\/+/, '');
  const out = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/** assets.join: a path relative to a folder. */
export function joinPath(dir, rel) {
  rel = String(rel ?? '');
  if (rel.startsWith('/') || !dir) return normalizePath(rel);
  return normalizePath(`${dir}/${rel}`);
}

/** The path of target relative to the folder of the file `from`. */
export function relativePath(from, target) {
  const a = dirOf(from).split('/').filter(Boolean);
  const b = target.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

// 2D affine matrices [a, b, c, d, tx, ty]: x' = a x + c y + tx, y' = b x + d y + ty.
const IDENTITY = [1, 0, 0, 1, 0, 0];

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

function trs(x, y, r, sx, sy) {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
}

function roundTo(v, step) {
  const r = Math.round(v / step) * step;
  return Math.round(r * 1e6) / 1e6;
}

function roundRectPath(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (r <= 0) {
    g.rect(x, y, w, h);
    return;
  }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The box around a points list (x1, y1, x2, y2, ...) as [x, y, w, h], or null. */
function pointsBounds(p) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; p && i + 1 < p.length; i += 2) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]);
    y1 = Math.max(y1, p[i + 1]);
  }
  return x0 <= x1 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/**
 * Adds the outline Box2D collides with for a points list to the path: their
 * convex hull (a polygon shape has no dents), at most 8 corners like Box2D.
 */
function hullPath(g, p) {
  const pts = [];
  for (let i = 0; p && i + 1 < p.length && pts.length < 8; i += 2) pts.push([p[i], p[i + 1]]);
  if (pts.length < 3) return;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of pts.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  hull.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

function pointInPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length - 1; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The kind of drawing a piece type gets. */
function kindOf(type) {
  if (isA(type, 'Sprite')) return 'sprite';
  if (isA(type, 'Shape')) return 'shape';
  if (isA(type, 'Text')) return 'text';
  if (isA(type, 'Tiles')) return 'tilemap';
  if (isA(type, 'Particles')) return 'particles';
  if (isA(type, 'Hitbox')) return 'collision';
  if (isA(type, 'Camera')) return 'camera';
  if (isA(type, 'Zone')) return 'area';
  if (isA(type, 'Walkable')) return 'walkable';
  if (isA(type, 'Body')) return 'body';
  if (isA(type, 'Joint')) return 'joint';
  if (isA(type, 'Light')) return 'light';
  if (isA(type, 'Occluder')) return 'occluder';
  return 'node2d';
}

// ---------------------------------------------------------------------------
// Edits through the doc

/**
 * Sets properties of several nodes as one undoable step (doc.setProps for
 * one node; a command of the same shape through doc.apply for several).
 * entries: [[node, {key: value}]].
 */
export function setPropsMany(doc, entries, { merge = null, label = 'Change property' } = {}) {
  if (!entries.length) return;
  if (entries.length === 1) {
    doc.setProps(entries[0][0], entries[0][1], { merge, label });
    return;
  }
  const parts = entries.map(([node, values]) => {
    const before = {};
    const after = {};
    for (const k of Object.keys(values)) before[k] = k in node.props ? clone(node.props[k]) : undefined;
    for (const [k, v] of Object.entries(values)) after[k] = !node.instance && equal(v, defaultOf(node.type, k)) ? undefined : v;
    return { node, before, after };
  });
  const set = (node, vals) => {
    for (const [k, v] of Object.entries(vals)) {
      if (v === undefined) delete node.props[k];
      else node.props[k] = clone(v);
    }
  };
  doc.apply({
    label, node: entries[0][0], kind: 'props', merge: merge && `${merge}:many`,
    redo: () => { for (const p of parts) set(p.node, p.after); },
    undo: () => { for (const p of [...parts].reverse()) set(p.node, p.before); },
  });
}

/**
 * One drag or stroke = one undo step. SceneDoc merges edits with the same
 * merge key made within 1.5 s of each other, so while the button is held
 * the last values are applied again now and then to keep the step open.
 */
export class Gesture {
  constructor(doc, label) {
    this.doc = doc;
    this.label = label;
    this.merge = `gesture${++gestureSeq}`;
    this.last = null;
    this.time = 0;
    this.changed = false;
    this.timer = setInterval(() => {
      if (this.last && Date.now() - this.time > 900) this.set(this.last);
    }, 400);
  }

  set(entries) {
    this.last = entries;
    this.time = Date.now();
    this.changed = true;
    setPropsMany(this.doc, entries, { merge: this.merge, label: this.label });
  }

  /** Whether the doc's latest undo step is this gesture's. */
  isTop() {
    const top = this.doc.undoStack?.[this.doc.undoStack.length - 1];
    return !!top && typeof top.merge === 'string' && top.merge.startsWith(`${this.merge}:`);
  }

  end() {
    clearInterval(this.timer);
    this.timer = 0;
    this.last = null;
  }

  /** Ends the gesture and takes its edits back. */
  cancel() {
    this.end();
    if (this.changed && this.isTop()) this.doc.undo();
  }
}

// ---------------------------------------------------------------------------
// Assets: images, sprite sheets, tilesets and fonts from the project's files

export class AssetCache extends EventTarget {
  constructor(project) {
    super();
    this.project = project;
    this.images = new Map();
    this.jsons = new Map();
    this.fonts = new Map();
    this.tints = new Map();
    this.cells = new Map();
  }

  changed(path) {
    this.dispatchEvent(new CustomEvent('load', { detail: { path } }));
  }

  bytes(path) {
    try {
      return this.project?.readBytes?.(path);
    } catch {
      return undefined;
    }
  }

  /** {status: 'loading' | 'ready' | 'missing' | 'error', bitmap, w, h} or null. */
  image(path) {
    path = normalizePath(path);
    if (!path) return null;
    let e = this.images.get(path);
    if (e) return e;
    e = { path, status: 'loading', bitmap: null, w: 0, h: 0 };
    this.images.set(path, e);
    const bytes = this.bytes(path);
    if (!bytes) {
      e.status = 'missing';
      return e;
    }
    const type = IMAGE_MIME[extOf(path)] || (extOf(path) === 'svg' ? 'image/svg+xml' : 'application/octet-stream');
    createImageBitmap(new Blob([bytes], { type })).then((bmp) => {
      if (this.images.get(path) !== e) return;
      e.bitmap = bmp;
      e.w = bmp.width;
      e.h = bmp.height;
      e.status = 'ready';
      this.changed(path);
    }, () => {
      e.status = 'error';
      this.changed(path);
    });
    return e;
  }

  /** A JSON file's value, or null (cached until the file changes). */
  json(path) {
    path = normalizePath(path);
    if (!path) return null;
    if (this.jsons.has(path)) return this.jsons.get(path);
    let value = null;
    try {
      const text = this.project?.readText?.(path);
      value = text === undefined ? null : JSON.parse(text);
    } catch {
      value = null;
    }
    this.jsons.set(path, value);
    return value;
  }

  /** assets.sheet: a plain image cut into columns x rows. */
  sheet(path, hframes = 1, vframes = 1) {
    const img = this.image(path);
    if (!img) return null;
    hframes = Math.max(1, Math.floor(num(hframes, 1)));
    vframes = Math.max(1, Math.floor(num(vframes, 1)));
    const fw = Math.floor(img.w / hframes);
    const fh = Math.floor(img.h / vframes);
    return {
      img, frameWidth: fw, frameHeight: fh, columns: hframes, rows: vframes, frameCount: hframes * vframes,
      originX: fw / 2, originY: fh / 2, hasOrigin: false, animations: {}, defaultAnimation: null,
    };
  }

  /** assets.sprite: a .sprite file. */
  sprite(path) {
    path = normalizePath(path);
    const data = this.json(path);
    if (!data || typeof data !== 'object') return null;
    const img = this.image(joinPath(dirOf(path), data.image || path.replace(/\.sprite$/, '.png')));
    if (!img) return null;
    const fw = num(data.frameWidth, img.w) || img.w;
    const fh = num(data.frameHeight, img.h) || img.h;
    const columns = Math.max(1, Math.floor(img.w / (fw || 1)));
    const rows = Math.max(1, Math.floor(img.h / (fh || 1)));
    const animations = {};
    let first = null;
    for (const [name, a] of Object.entries(data.animations || {})) {
      animations[name] = { frames: Array.isArray(a?.frames) && a.frames.length ? a.frames : [0], fps: num(a?.fps, 8), loop: a?.loop !== false };
      if (!first || name === 'idle') first = name;
    }
    const o = Array.isArray(data.origin) ? data.origin : null;
    return {
      img, frameWidth: fw, frameHeight: fh, columns, rows, frameCount: columns * rows,
      originX: o ? num(o[0]) : fw / 2, originY: o ? num(o[1]) : fh / 2, hasOrigin: !!o, animations, defaultAnimation: first,
    };
  }

  /** assets.tileset: a .tileset file. tileWidth/Height are known before the image loads. */
  tileset(path) {
    path = normalizePath(path);
    const data = this.json(path);
    if (!data || typeof data !== 'object') return null;
    const tw = Math.max(1, num(data.tileWidth, 16));
    const th = Math.max(1, num(data.tileHeight, 16));
    const imagePath = data.image ? joinPath(dirOf(path), data.image) : '';
    const img = imagePath ? this.image(imagePath) : null;
    const columns = img?.w ? Math.max(1, Math.floor(img.w / tw)) : 0;
    const rows = img?.h ? Math.max(1, Math.floor(img.h / th)) : 0;
    const tiles = {};
    for (const [k, v] of Object.entries(data.tiles || {})) if (v && typeof v === 'object') tiles[Number(k)] = v;
    return { path, data, imagePath, img, tileWidth: tw, tileHeight: th, columns, rows, count: columns * rows, tiles };
  }

  /** A CSS font family for a font property ("" = the default font, "pixel" = the pixel font). */
  font(path) {
    if (!path) return DEFAULT_FAMILY;
    if (path === 'pixel') return 'pixel';
    path = normalizePath(path);
    let f = this.fonts.get(path);
    if (!f) {
      f = { family: `smitten-font-${++fontSeq}`, status: 'loading', face: null };
      this.fonts.set(path, f);
      const bytes = this.bytes(path);
      if (!bytes || typeof FontFace === 'undefined') f.status = 'missing';
      else {
        const face = new FontFace(f.family, bytes);
        face.load().then(() => {
          if (this.fonts.get(path) !== f) return;
          document.fonts.add(face);
          f.face = face;
          f.status = 'ready';
          this.changed(path);
        }, () => {
          f.status = 'error';
          this.changed(path);
        });
      }
    }
    return f.status === 'ready' ? `"${f.family}", ${DEFAULT_FAMILY}` : DEFAULT_FAMILY;
  }

  /** An image multiplied by a color (cached), for tints that aren't white. */
  tinted(img, c) {
    if (c[0] >= 0.999 && c[1] >= 0.999 && c[2] >= 0.999) return img.bitmap;
    const key = `${img.path}|${c[0].toFixed(3)},${c[1].toFixed(3)},${c[2].toFixed(3)}`;
    let canvas = this.tints.get(key);
    if (canvas) {
      this.tints.delete(key);
      this.tints.set(key, canvas);
      return canvas;
    }
    canvas = document.createElement('canvas');
    canvas.width = img.w;
    canvas.height = img.h;
    const g = canvas.getContext('2d');
    g.drawImage(img.bitmap, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = rgba([c[0], c[1], c[2], 1]);
    g.fillRect(0, 0, img.w, img.h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img.bitmap, 0, 0);
    this.tints.set(key, canvas);
    if (this.tints.size > 48) this.tints.delete(this.tints.keys().next().value);
    return canvas;
  }

  /** A TileMap's cells decoded: {list: [[cx, cy, tile]], grid, bounds}. */
  decoded(cells) {
    if (!cells || typeof cells !== 'object' || typeof cells.data !== 'string') return { list: [], grid: new Map(), bounds: null };
    const key = `${cells.x},${cells.y},${cells.w},${cells.data}`;
    let d = this.cells.get(key);
    if (d) return d;
    const grid = decodeCells(cells);
    const list = [];
    for (const [k, t] of grid) {
      const i = k.indexOf(',');
      list.push([Number(k.slice(0, i)), Number(k.slice(i + 1)), t]);
    }
    d = { list, grid, bounds: cellBounds(grid) };
    this.cells.set(key, d);
    if (this.cells.size > 24) this.cells.delete(this.cells.keys().next().value);
    return d;
  }

  /** Forgets a changed file. Returns true if it was used. */
  invalidate(path) {
    path = normalizePath(path);
    let used = false;
    if (this.images.has(path)) {
      this.images.get(path).bitmap?.close?.();
      this.images.delete(path);
      for (const k of [...this.tints.keys()]) if (k.startsWith(`${path}|`)) this.tints.delete(k);
      used = true;
    }
    if (this.jsons.has(path)) {
      this.jsons.delete(path);
      used = true;
    }
    const f = this.fonts.get(path);
    if (f) {
      if (f.face) document.fonts.delete(f.face);
      this.fonts.delete(path);
      used = true;
    }
    return used;
  }

  dispose() {
    for (const e of this.images.values()) e.bitmap?.close?.();
    for (const f of this.fonts.values()) if (f.face) document.fonts.delete(f.face);
    this.images.clear();
    this.jsons.clear();
    this.fonts.clear();
    this.tints.clear();
    this.cells.clear();
  }
}

// ---------------------------------------------------------------------------
// Text, as LÖVE lays it out

const metricsCache = new Map();
let measureCtx = null;

function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Font metrics in px: {height (font:getHeight), spacing (line to line), ascent}. */
function fontMetrics(family, size) {
  if (family === 'pixel') {
    const s = size / PIXEL.unit;
    return { pixel: true, s, height: PIXEL.height * s, spacing: PIXEL.spacing * s, ascent: 0 };
  }
  const key = `${size}px ${family}`;
  let m = metricsCache.get(key);
  if (m) return m;
  const g = measurer();
  g.font = key;
  const t = g.measureText('Mg');
  const ascent = num(t.fontBoundingBoxAscent, size * 0.8);
  const descent = num(t.fontBoundingBoxDescent, size * 0.25);
  m = { pixel: false, font: key, height: ascent + descent, spacing: ascent + descent, ascent };
  metricsCache.set(key, m);
  if (metricsCache.size > 200) metricsCache.delete(metricsCache.keys().next().value);
  return m;
}

function textWidth(m, text) {
  if (m.pixel) return text.length * PIXEL.advance * m.s;
  const g = measurer();
  g.font = m.font;
  return g.measureText(text).width;
}

/** Lines of text wrapped at `limit` px (0: only at newlines), like Font:getWrap. */
function wrapText(m, text, limit) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!(limit > 0)) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (textWidth(m, test) <= limit || !line) {
        line = test;
        // A word longer than the line is broken by characters.
        while (textWidth(m, line) > limit && line.length > 1) {
          let n = line.length - 1;
          while (n > 1 && textWidth(m, line.slice(0, n)) > limit) n--;
          out.push(line.slice(0, n));
          line = line.slice(n);
        }
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function drawTextLine(g, m, text, x, y) {
  if (!m.pixel) {
    g.font = m.font;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText(text, x, y + m.ascent);
    return;
  }
  const s = m.s;
  g.beginPath();
  for (let i = 0; i < text.length; i++) {
    const glyph = PIXEL_GLYPHS[text.charCodeAt(i) - 32];
    if (!glyph) continue;
    const left = x + i * PIXEL.advance * s;
    for (let row = 0; row < glyph.length; row++) {
      const bits = glyph[row];
      if (!bits) continue;
      for (let col = 0; col < 5; col++) if (bits & (16 >> col)) g.rect(left + col * s, y + row * s, s, s);
    }
  }
  g.fill();
}

/** One fragment of rich text (core/richtext.js) with its top-left at (x, y). */
function drawFragment(g, f, x, y, spacing) {
  const m = f.m;
  if (f.style.picture) {
    // A picture in the line: a square where it goes.
    g.fillRect(x + 1, y + 1, Math.max(1, m.base - 2), Math.max(1, m.base - 2));
    return;
  }
  if (spacing) {
    let cx = x;
    for (const c of f.text) {
      drawTextLine(g, m, c, cx, y);
      cx += textWidth(m, c) + spacing;
    }
  } else {
    drawTextLine(g, m, f.text, x, y);
    // The pixel font has no bold or italic of its own: bold is drawn twice.
    if (m.pixel && f.style.bold) drawTextLine(g, m, f.text, x + m.s, y);
  }
  const thick = Math.max(1, Math.round(m.size / 14));
  if (f.style.underline) g.fillRect(x, y + m.base + thick, f.width, thick);
  if (f.style.strike) g.fillRect(x, y + m.base - Math.round(m.base * 0.32), f.width, thick);
}

/** printf: lines in a box `limit` wide, aligned, from (x, y). */
function printf(g, m, lines, x, y, limit, align) {
  lines.forEach((line, i) => {
    const w = textWidth(m, line.replace(/\s+$/, ''));
    const lx = align === 'center' ? x + (limit - w) / 2 : align === 'right' ? x + limit - w : x;
    drawTextLine(g, m, line, lx, y + i * m.spacing);
  });
}

// ---------------------------------------------------------------------------
// Theme colors for the canvas, from the editor's CSS variables

/** A CSS variable's color as [r, g, b, a] (0..1), read through an element. */
export function cssVarColor(el, name, fallback) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = fallback;
  probe.style.color = `var(${name}, ${fallback})`;
  el.append(probe);
  const c = cssColorToRgba(getComputedStyle(probe).color, fallback);
  probe.remove();
  return c;
}

function cssColorToRgba(css, fallback) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillStyle = fallback;
  g.fillStyle = css;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
}

// ---------------------------------------------------------------------------

export class Viewport2D {
  /**
   * ctx = { doc, project, settings: { snap, grid, showCollisions } }
   * The settings object is kept, not copied: changes to it show on the next
   * redraw (setSnap / setGrid / setShowCollisions redraw at once).
   */
  constructor(container, ctx = {}) {
    this.container = container;
    this.ctx = ctx;
    this.project = ctx.project || null;
    this.settings = ctx.settings || {};
    if (this.settings.grid == null) this.settings.grid = 16;
    if (this.settings.snap == null) this.settings.snap = false;
    if (this.settings.showCollisions == null) this.settings.showCollisions = true;
    this.doc = null;
    this.tool = 'select';
    this.view = { x: 0, y: 0, zoom: 1 };
    this.views = new WeakMap(); // doc -> its view, kept when switching tabs
    this.framed = false;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.assets = new AssetCache(this.project);
    this.painter = null;
    this.scene = null;
    this.display = null;
    this.drag = null;
    this.hover = null;
    this.mouse = null; // last pointer position {sx, sy}
    this.spaceDown = false;
    this.altCycle = null;
    this.dropAt = null;
    this.raf = 0;
    this.cleanup = [];
    this.build();

    this.onDocChange = () => this.invalidate();
    this.onDocSelect = () => this.redraw();
    this.listen(this.project, 'file', (e) => this.onFile(e.detail || {}));
    this.listen(this.project, 'settings', () => {
      this.display = null;
      this.invalidate();
    });
    this.listen(this.assets, 'load', () => this.invalidate());
    this.setDoc(ctx.doc || null);
  }

  listen(target, type, fn, opts) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, opts);
    this.cleanup.push(() => target.removeEventListener(type, fn, opts));
  }

  build() {
    const root = document.createElement('div');
    root.className = 'v2d';
    root.tabIndex = 0;
    root.dataset.tool = this.tool;
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', '2D scene view');
    const canvas = document.createElement('canvas');
    canvas.className = 'v2d-canvas';
    const flash = document.createElement('div');
    flash.className = 'v2d-flash';
    flash.hidden = true;
    const probe = document.createElement('span');
    probe.className = 'v2d-probe';
    root.append(canvas, flash, probe);
    this.container.append(root);
    this.root = root;
    this.canvas = canvas;
    this.flashEl = flash;
    this.probe = probe;
    this.g = canvas.getContext('2d');
    this.readColors();

    this.listen(canvas, 'pointerdown', (e) => this.pointerDown(e));
    this.listen(canvas, 'pointermove', (e) => this.pointerMove(e));
    this.listen(canvas, 'pointerup', (e) => this.pointerUp(e));
    this.listen(canvas, 'pointercancel', (e) => this.pointerUp(e, true));
    this.listen(canvas, 'pointerleave', () => {
      if (!this.drag) {
        this.mouse = null;
        this.setHover(null);
        this.painter?.paintHover?.(null);
        this.redraw();
      }
    });
    this.listen(canvas, 'wheel', (e) => this.wheel(e), { passive: false });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(root, 'keydown', (e) => this.keyDown(e));
    this.listen(root, 'dragover', (e) => this.dragOver(e));
    this.listen(root, 'dragleave', () => {
      this.dropAt = null;
      this.redraw();
    });
    this.listen(root, 'drop', (e) => this.dropFile(e));
    this.listen(window, 'keydown', (e) => {
      if (e.code === 'Space' && !this.isTyping(e) && (this.mouse || document.activeElement === root)) {
        if (!this.spaceDown) {
          this.spaceDown = true;
          this.updateCursor();
        }
        if (document.activeElement === root || this.mouse) e.preventDefault();
      }
    });
    this.listen(window, 'keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.updateCursor();
      }
    });
    this.listen(window, 'blur', () => {
      this.spaceDown = false;
      this.updateCursor();
    });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(root);
      this.cleanup.push(() => ro.disconnect());
    }
    // Theme changes (data-theme / class on <html>, or the OS scheme).
    const mo = new MutationObserver(() => {
      this.readColors();
      this.redraw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    this.cleanup.push(() => mo.disconnect());
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (mq) this.listen(mq, 'change', () => {
      this.readColors();
      this.redraw();
    });
  }

  isTyping(e) {
    const t = e.target;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  readColors() {
    const read = (name, fallback) => {
      this.probe.style.color = fallback;
      this.probe.style.color = `var(${name}, ${fallback})`;
      return cssColorToRgba(getComputedStyle(this.probe).color, fallback);
    };
    this.colors = {
      accent: read('--accent', '#41a6f6'),
      fg: read('--fg', '#f4f4f4'),
      muted: read('--fg-muted', '#94b0c2'),
      bg: read('--bg', '#1a1c2c'),
      danger: read('--danger', '#e0606e'),
    };
  }

  // -------------------------------------------------------------------------
  // Public API

  setDoc(doc) {
    if (this.doc === doc) {
      // The same scene: settings may have changed; draw again.
      this.invalidate();
      return;
    }
    this.cancelDrag();
    if (this.doc) {
      this.doc.removeEventListener('change', this.onDocChange);
      this.doc.removeEventListener('select', this.onDocSelect);
      this.views.set(this.doc, { ...this.view });
    }
    this.doc = doc;
    this.scene = null;
    this.hover = null;
    if (doc) {
      doc.addEventListener('change', this.onDocChange);
      doc.addEventListener('select', this.onDocSelect);
      const saved = this.views.get(doc);
      if (saved) {
        this.view = { ...saved };
        this.framed = true;
      } else {
        this.framed = false;
        if (this.width) this.frameScreen();
      }
    }
    this.redraw();
  }

  setTool(name) {
    if (!TOOLS.includes(name)) return;
    if (name === this.tool) return;
    if (this.tool === 'paint') this.painter?.paintCancel?.();
    this.cancelDrag();
    this.tool = name;
    this.root.dataset.tool = name;
    this.updateCursor();
    this.redraw();
    this.root.dispatchEvent(new CustomEvent('viewport-tool', { bubbles: true, detail: { tool: name } }));
  }

  setSnap(on) {
    this.settings.snap = !!on;
    this.redraw();
  }

  setGrid(size) {
    const n = Number(size);
    if (Number.isFinite(n) && n > 0) this.settings.grid = n;
    this.redraw();
  }

  setShowCollisions(on) {
    this.settings.showCollisions = !!on;
    this.invalidate();
  }

  /** The TileMap panel registers itself here; see tilemap-panel.js. */
  setPainter(painter) {
    this.painter = painter;
    this.redraw();
  }

  frameSelection() {
    const sc = this.sceneData();
    if (!sc) return;
    const nodes = this.doc.selected();
    let box = null;
    const add = (pts) => {
      for (const [x, y] of pts) {
        if (!box) box = [x, y, x, y];
        else box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      }
    };
    if (nodes.length) {
      for (const n of nodes) {
        const e = sc.entries.get(n);
        if (e) add(this.worldCorners(e));
      }
    } else {
      for (const e of sc.items) add(this.worldCorners(e));
      for (const e of sc.ui) add(this.worldCorners(e));
      const d = this.displayInfo();
      add([[0, 0], [d.width, d.height]]);
    }
    if (!box) return;
    const pad = 48;
    const bw = Math.max(box[2] - box[0], 16);
    const bh = Math.max(box[3] - box[1], 16);
    const zoom = clamp(Math.min((this.width - pad * 2) / bw, (this.height - pad * 2) / bh), MIN_ZOOM, nodes.length ? 8 : MAX_ZOOM);
    this.view.zoom = zoom;
    this.view.x = this.width / 2 - ((box[0] + box[2]) / 2) * zoom;
    this.view.y = this.height / 2 - ((box[1] + box[3]) / 2) * zoom;
    this.framed = true;
    this.emitStatus();
    this.redraw();
  }

  /** Fits the game's screen rectangle in view. */
  frameScreen() {
    if (!this.width || !this.height) return;
    const d = this.displayInfo();
    const pad = 40;
    const zoom = clamp(Math.min((this.width - pad * 2) / d.width, (this.height - pad * 2) / d.height), MIN_ZOOM, MAX_ZOOM);
    this.view.zoom = zoom;
    this.view.x = this.width / 2 - (d.width / 2) * zoom;
    this.view.y = this.height / 2 - (d.height / 2) * zoom;
    this.framed = true;
    this.redraw();
  }

  resize() {
    const r = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(0, Math.round(r.width));
    const h = Math.max(0, Math.round(r.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    // Keep the center of the view where it was.
    if (this.width && this.height && this.framed) {
      this.view.x += (w - this.width) / 2;
      this.view.y += (h - this.height) / 2;
    }
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (!this.framed && w && h && this.doc) this.frameScreen();
    this.draw();
  }

  dispose() {
    this.cancelDrag();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.doc) {
      this.doc.removeEventListener('change', this.onDocChange);
      this.doc.removeEventListener('select', this.onDocSelect);
    }
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    clearTimeout(this.flashTimer);
    this.assets.dispose();
    this.root.remove();
    this.doc = null;
  }

  // -------------------------------------------------------------------------
  // State

  get(node, key) {
    const v = this.doc.get(node, key);
    return v === undefined ? defaultOf(node.type, key) : v;
  }

  invalidate() {
    this.scene = null;
    this.redraw();
  }

  redraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  onFile({ path, from }) {
    if (path === 'smitten.json') this.display = null;
    if (path) this.assets.invalidate(path);
    if (from) this.assets.invalidate(from);
    // Instances read their scene files again, so any change may show.
    this.invalidate();
  }

  displayInfo() {
    if (this.display) return this.display;
    let s = {};
    try {
      s = this.project?.settings ? this.project.settings() : JSON.parse(this.project?.readText?.('smitten.json') || '{}');
    } catch {
      s = {};
    }
    const d = (s && typeof s.display === 'object' && s.display) || {};
    const stretch = d.stretch || 'expand';
    const bg = Array.isArray(d.background) ? colorOf(d.background) : [0.11, 0.12, 0.15, 1];
    this.display = {
      width: Math.max(1, num(d.width, 1280)),
      height: Math.max(1, num(d.height, 720)),
      filter: d.filter || (stretch === 'pixel' ? 'pixel' : 'smooth'),
      background: bg,
    };
    // Editor lines are drawn in black or white, whichever shows on the background.
    const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
    this.display.ink = lum > 0.55 ? [0, 0, 0] : [1, 1, 1];
    this.display.halo = lum > 0.55 ? [1, 1, 1] : [0, 0, 0];
    return this.display;
  }

  /**
   * The tree as drawn: an entry per node (instances' read-only nodes too)
   * with its global matrix, tint and z (2D) or rectangle (UI). Rebuilt after
   * any change.
   */
  sceneData() {
    if (!this.doc?.root) return null;
    if (this.scene) return this.scene;
    const doc = this.doc;
    const entries = new Map();
    const build = (node, parent, depth) => {
      const type = node.type;
      const e = {
        node, parent, children: [], type,
        is2d: isA(type, 'Group'), isUI: isA(type, 'UI'), is3d: false,
      };
      e.kind = e.is2d ? kindOf(type) : null;
      entries.set(node, e);
      let kids = [];
      if (depth < 64) {
        try {
          kids = doc.effectiveChildren(node);
        } catch {
          kids = node.children || [];
        }
      }
      e.children = kids.map((c) => build(c, e, depth + 1));
      return e;
    };
    const root = build(doc.root, null, 0);

    // The 2D pass (nodes2d.lua collect): transforms pass through plain nodes,
    // stop at UI and 3D nodes; invisible nodes hide their subtree.
    const items = [];
    let order = 0;
    const collect = (e, m, tint, z) => {
      const n = e.node;
      if (e.is2d) {
        if (!this.get(n, 'visible')) return;
        e.pm = m;
        m = mul(m, trs(num(this.get(n, 'x')), num(this.get(n, 'y')), num(this.get(n, 'rotation')), num(this.get(n, 'scaleX'), 1), num(this.get(n, 'scaleY'), 1)));
        const t = colorOf(this.get(n, 'tint'));
        tint = [tint[0] * t[0], tint[1] * t[1], tint[2] * t[2], tint[3] * t[3]];
        z += Math.trunc(num(this.get(n, 'layer')));
        e.m = m;
        e.tint = tint;
        e.z = z;
        e.order = order++;
        items.push(e);
      } else if (e.is3d || e.isUI) {
        return;
      }
      for (const c of e.children) collect(c, m, tint, z);
    };
    collect(root, IDENTITY, [1, 1, 1, 1], 0);
    items.sort((p, q) => p.z - q.z || p.order - q.order);

    // The UI pass (ui.lua visit): controls lay out in their parent control,
    // or the screen.
    const ui = [];
    const disp = this.displayInfo();
    const visit = (e, px, py, pw, ph, alpha) => {
      const n = e.node;
      if (e.isUI) {
        if (!this.get(n, 'visible')) return;
        e.parentRect = [px, py, pw, ph];
        e.rect = this.layout(n, px, py, pw, ph);
        alpha *= num(this.get(n, 'opacity'), 1);
        e.alpha = alpha;
        ui.push(e);
        [px, py, pw, ph] = e.rect;
      } else if (e.is2d || e.is3d) {
        if (this.get(n, 'visible') === false) return;
      }
      for (const c of e.children) visit(c, px, py, pw, ph, alpha);
    };
    visit(root, 0, 0, disp.width, disp.height, 1);
    this.scene = { root, entries, items, ui };
    return this.scene;
  }

  layout(n, px, py, pw, ph) {
    const x = num(this.get(n, 'x'));
    const y = num(this.get(n, 'y'));
    const anchor = this.get(n, 'anchor');
    if (anchor === 'fill') return [px + x, py + y, Math.max(0, pw - 2 * x), Math.max(0, ph - 2 * y)];
    const a = ANCHORS[anchor] || ANCHORS.topLeft;
    const w = num(this.get(n, 'width'));
    const h = num(this.get(n, 'height'));
    return [px + a[0] * (pw - w) + (a[0] === 1 ? -x : x), py + a[1] * (ph - h) + (a[1] === 1 ? -y : y), w, h];
  }

  /** Layout offsets that put a control at rect [x, y, w, h] (the inverse of layout). */
  offsetsFor(e, rect) {
    const n = e.node;
    const [px, py, pw, ph] = e.parentRect;
    const anchor = this.get(n, 'anchor');
    if (anchor === 'fill') return { x: rect[0] - px, y: rect[1] - py };
    const a = ANCHORS[anchor] || ANCHORS.topLeft;
    const [x, y, w, h] = rect;
    return {
      x: (x - px - a[0] * (pw - w)) * (a[0] === 1 ? -1 : 1),
      y: (y - py - a[1] * (ph - h)) * (a[1] === 1 ? -1 : 1),
      width: w,
      height: h,
    };
  }

  entryOf(node) {
    return node ? this.sceneData()?.entries.get(node) || null : null;
  }

  /** The node a click on this entry selects: an instance's internals select the instance. */
  selectable(e) {
    let n = e.node;
    while (n.readonly && n.parent) n = n.parent;
    return n;
  }

  primary() {
    if (!this.doc) return null;
    const ids = [...this.doc.selection];
    for (let i = ids.length - 1; i >= 0; i--) {
      const n = this.doc.byId(ids[i]);
      if (n) return n;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Geometry of nodes

  sheetOf(n) {
    const path = this.get(n, 'image');
    if (!path) return null;
    if (/\.sprite$/i.test(path)) return this.assets.sprite(path);
    return this.assets.sheet(path, this.get(n, 'columns'), this.get(n, 'rows'));
  }

  spriteRect(n, sheet) {
    let ox = sheet.originX;
    let oy = sheet.originY;
    if (!sheet.hasOrigin) {
      const c = this.get(n, 'centered');
      ox = c ? sheet.frameWidth / 2 : 0;
      oy = c ? sheet.frameHeight / 2 : 0;
    }
    return [-ox, -oy, sheet.frameWidth, sheet.frameHeight];
  }

  /** True if a piece's text needs more than plain lines: tags, spacing, justify. */
  usesRichText(n) {
    return !!this.get(n, 'rich') || num(this.get(n, 'lineHeight'), 1) !== 1 || num(this.get(n, 'letterSpacing')) !== 0
      || this.get(n, 'align') === 'justify' || (this.get(n, 'wrapBy') ?? 'word') !== 'word';
  }

  /**
   * A piece's text laid out by core/richtext.js: { lines, width, height,
   * spacing, base (the piece's font) }. limit: the width lines wrap at (0: none).
   */
  richLayout(n, limit, align, blockAlign = false) {
    const family = this.assets.font(this.get(n, 'font'));
    const size = Math.max(1, num(this.get(n, 'size'), 16));
    const bold = this.get(n, 'fontBold');
    const italic = this.get(n, 'fontItalic');
    const made = new Map();
    const metrics = (st) => {
      let m = made.get(st);
      if (m) return m;
      const sz = Math.max(1, st.size ?? size + (st.sizeAdd || 0));
      let fam = family;
      let css = '';
      if (st.font) fam = this.assets.font(st.font);
      else if (st.bold && bold) fam = this.assets.font(bold);
      else if (st.italic && italic) fam = this.assets.font(italic);
      if (st.bold && !(bold && !st.font)) css = `bold ${css}`;
      if (st.italic && !(italic && !st.font && !(st.bold && bold))) css = `italic ${css}`;
      const f = fontMetrics(fam, sz);
      m = { ...f, size: sz, base: f.pixel ? 7 * f.s : f.ascent };
      if (!f.pixel && css) m.font = css + f.font;
      made.set(st, m);
      return m;
    };
    const spacing = num(this.get(n, 'letterSpacing'));
    const out = layoutRich(parseRich(this.get(n, 'text'), !!this.get(n, 'rich')), metrics, textWidth, {
      limit, align, blockAlign, lineHeight: num(this.get(n, 'lineHeight'), 1), letterSpacing: spacing, by: this.get(n, 'wrapBy') ?? 'word',
    });
    out.spacing = spacing;
    out.base = metrics({});
    return out;
  }

  /** Draws a richLayout() with its top-left at (x, y); color(style) gives each fragment's fill. */
  drawRich(g, t, x, y, color) {
    for (const l of t.lines) {
      for (const f of l.frags) {
        g.fillStyle = color(f.style);
        drawFragment(g, f, x + l.x + f.x, y + l.y + (l.base - f.m.base), t.spacing);
      }
    }
  }

  /**
   * A piece's outline and shadow settings around its text: calls paint(dx,
   * dy, color) for each copy behind the text (color: [r, g, b, a]).
   */
  textDecoration(n, paint) {
    if (this.get(n, 'shadow')) paint(num(this.get(n, 'shadowX'), 2), num(this.get(n, 'shadowY'), 2), colorOf(this.get(n, 'shadowColor') ?? [0, 0, 0, 0.5]));
    if (this.get(n, 'outline')) {
      const w = num(this.get(n, 'outlineWidth')) || 1;
      const c = colorOf(this.get(n, 'outlineColor') ?? [0, 0, 0, 0.8]);
      const d = w * 0.7071;
      const around = w > 1 ? [[-w, 0], [w, 0], [0, -w], [0, w], [-d, -d], [d, -d], [-d, d], [d, d]] : [[-w, 0], [w, 0], [0, -w], [0, w]];
      for (const [ox, oy] of around) paint(ox, oy, c);
    }
  }

  textLayout(n) {
    const family = this.assets.font(this.get(n, 'font'));
    const size = Math.max(1, num(this.get(n, 'size'), 16));
    const m = fontMetrics(family, size);
    const text = String(this.get(n, 'text') ?? '');
    const wrap = num(this.get(n, 'wrap'));
    const align = this.get(n, 'align');
    if (this.usesRichText(n)) {
      const rich = this.richLayout(n, wrap > 0 ? wrap : 0, align);
      const w = wrap > 0 ? wrap : rich.width;
      const ox = align === 'center' ? w / 2 : align === 'right' ? w : 0;
      return { m, rich, lines: [], x: -ox, y: wrap > 0 ? 0 : -m.height / 2, w, h: Math.max(m.height, rich.height), wrap, align };
    }
    if (wrap > 0) {
      const lines = wrapText(m, text, wrap);
      const ox = align === 'center' ? wrap / 2 : align === 'right' ? wrap : 0;
      return { m, lines, x: -ox, y: 0, w: wrap, h: lines.length * m.spacing, wrap, align };
    }
    const lines = text.split('\n');
    const w = Math.max(0, ...lines.map((l) => textWidth(m, l)));
    const ox = align === 'center' ? w / 2 : align === 'right' ? w : 0;
    return { m, lines, x: -ox, y: -m.height / 2, w, h: Math.max(m.height, (lines.length - 1) * m.spacing + m.height), wrap: 0, align };
  }

  /** A 2D node's own rectangle in its local coordinates [x, y, w, h], or null. */
  localRect(e) {
    if (e.rectCache !== undefined) return e.rectCache;
    const n = e.node;
    let r = null;
    switch (e.kind) {
      case 'sprite': {
        const sh = this.sheetOf(n);
        if (sh?.img.status === 'ready') r = this.spriteRect(n, sh);
        break;
      }
      case 'shape': {
        const shape = this.get(n, 'shape');
        if (shape === 'rectangle') {
          const w = num(this.get(n, 'width'));
          const h = num(this.get(n, 'height'));
          const c = this.get(n, 'centered');
          r = [c ? -w / 2 : 0, c ? -h / 2 : 0, w, h];
        } else if (shape === 'circle') {
          const rad = num(this.get(n, 'radius'));
          r = [-rad, -rad, rad * 2, rad * 2];
        } else {
          const p = this.get(n, 'points') || [];
          let x0 = Infinity;
          let y0 = Infinity;
          let x1 = -Infinity;
          let y1 = -Infinity;
          for (let i = 0; i + 1 < p.length; i += 2) {
            x0 = Math.min(x0, p[i]);
            x1 = Math.max(x1, p[i]);
            y0 = Math.min(y0, p[i + 1]);
            y1 = Math.max(y1, p[i + 1]);
          }
          if (x0 <= x1) r = [x0, y0, x1 - x0, y1 - y0];
        }
        break;
      }
      case 'text': {
        const t = this.textLayout(n);
        if (t.lines.some((l) => l.length)) r = [t.x, t.y, t.w, t.h];
        break;
      }
      case 'tilemap': {
        const ts = this.assets.tileset(this.get(n, 'tileset'));
        const b = this.assets.decoded(this.get(n, 'cells')).bounds;
        if (ts && b) r = [b.x0 * ts.tileWidth, b.y0 * ts.tileHeight, (b.x1 - b.x0 + 1) * ts.tileWidth, (b.y1 - b.y0 + 1) * ts.tileHeight];
        break;
      }
      case 'occluder': {
        const o = this.occluderShape(e);
        if (o && o.m === e.m) {
          const s = o.s;
          if (s.circle) r = [s.circle[0] - s.circle[2], s.circle[1] - s.circle[2], s.circle[2] * 2, s.circle[2] * 2];
          else if (s.points) r = pointsBounds(s.points);
          else r = s.rect.slice(0, 4);
        }
        break;
      }
      case 'walkable':
        r = pointsBounds(this.get(n, 'points'));
        break;
      case 'collision': {
        const shape = this.get(n, 'shape');
        if (shape === 'circle') {
          const rad = num(this.get(n, 'radius'));
          r = [-rad, -rad, rad * 2, rad * 2];
        } else if (shape === 'polygon') {
          r = pointsBounds(this.get(n, 'points'));
        } else {
          const w = num(this.get(n, 'width'));
          const h = num(this.get(n, 'height'));
          r = [-w / 2, -h / 2, w, h];
        }
        break;
      }
      default:
    }
    e.rectCache = r;
    return r;
  }

  /** The world-space corners of what an entry covers (its own rectangle, or its subtree's). */
  worldCorners(e) {
    if (e.isUI) {
      const [x, y, w, h] = e.rect || [0, 0, 0, 0];
      return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
    if (!e.m) return [];
    const r = this.localRect(e);
    if (r) {
      const [x, y, w, h] = r;
      return [apply(e.m, x, y), apply(e.m, x + w, y), apply(e.m, x + w, y + h), apply(e.m, x, y + h)];
    }
    const out = [];
    for (const c of e.children) out.push(...this.worldCorners(c));
    return out.length ? out : [[e.m[4], e.m[5]]];
  }

  /** Bounds in the node's local coordinates: its rectangle, or its subtree's. */
  localBounds(e) {
    if (e.boundsCache !== undefined) return e.boundsCache;
    let b = this.localRect(e);
    if (!b && e.m) {
      const inv = invert(e.m);
      const pts = [];
      for (const c of e.children) pts.push(...this.worldCorners(c));
      if (inv && pts.length) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of pts) {
          const [x, y] = apply(inv, p[0], p[1]);
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
        b = [x0, y0, x1 - x0, y1 - y0];
      }
    }
    e.boundsCache = b;
    return b;
  }

  // -------------------------------------------------------------------------
  // Coordinates

  toWorld(sx, sy) {
    return [(sx - this.view.x) / this.view.zoom, (sy - this.view.y) / this.view.zoom];
  }

  toScreen(wx, wy) {
    return [wx * this.view.zoom + this.view.x, wy * this.view.zoom + this.view.y];
  }

  eventPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Sets the canvas transform to draw in a matrix m (world units). */
  setWorld(g, m = IDENTITY) {
    const k = this.dpr * this.view.zoom;
    g.setTransform(k * m[0], k * m[1], k * m[2], k * m[3], this.dpr * (this.view.zoom * m[4] + this.view.x), this.dpr * (this.view.zoom * m[5] + this.view.y));
  }

  setScreen(g) {
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  snapOn(e) {
    return !!this.settings.snap !== !!(e && (e.ctrlKey || e.metaKey));
  }

  get grid() {
    return Math.max(1, num(Number(this.settings.grid), 16));
  }

  snapPoint(x, y) {
    const s = this.grid;
    return [Math.round(x / s) * s, Math.round(y / s) * s];
  }

  /** The step positions are rounded to when not snapping: whole pixels, finer when zoomed in. */
  get precision() {
    const z = this.view.zoom;
    return z <= 1 ? 1 : 1 / 2 ** Math.ceil(Math.log2(z));
  }

  // -------------------------------------------------------------------------
  // Drawing

  draw() {
    const g = this.g;
    if (!this.width || !this.height) return;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.dpr) {
      this.resize();
      return;
    }
    const disp = this.displayInfo();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = rgba(disp.background);
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sc = this.sceneData();
    if (!sc) return;
    this.drawGrid(g, disp);
    g.imageSmoothingEnabled = disp.filter !== 'pixel';
    g.imageSmoothingQuality = 'high';
    for (const e of sc.items) {
      g.save();
      try {
        this.drawItem(g, e);
      } catch (err) {
        console.warn('viewport2d: drawing', e.node.name, err);
      }
      g.restore();
    }
    for (const e of sc.ui) {
      g.save();
      try {
        this.drawControl(g, e);
      } catch (err) {
        console.warn('viewport2d: drawing', e.node.name, err);
      }
      g.restore();
    }
    g.imageSmoothingEnabled = true;
    this.drawScreenRect(g, disp);
    this.drawGizmos(g, sc, disp);
    if (this.paintActive()) this.drawPaintOverlay(g);
    this.drawSelection(g, sc, disp);
    this.drawDragOverlay(g, disp);
  }

  drawGrid(g, disp) {
    const z = this.view.zoom;
    const dpr = this.dpr;
    const ink = disp.ink;
    let step = this.grid;
    while (step * z < 8) step *= 2;
    const major = step * 4;
    const [wx0, wy0] = this.toWorld(0, 0);
    const [wx1, wy1] = this.toWorld(this.width, this.height);
    const fade = clamp((step * z - 8) / 24, 0, 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.lineWidth = 1;
    const lines = (spacing, alpha, skip) => {
      g.beginPath();
      for (let x = Math.ceil(wx0 / spacing) * spacing; x <= wx1; x += spacing) {
        if (skip && Math.abs(x / skip - Math.round(x / skip)) < 1e-6) continue;
        const sx = Math.round((x * z + this.view.x) * dpr) + 0.5;
        g.moveTo(sx, 0);
        g.lineTo(sx, this.canvas.height);
      }
      for (let y = Math.ceil(wy0 / spacing) * spacing; y <= wy1; y += spacing) {
        if (skip && Math.abs(y / skip - Math.round(y / skip)) < 1e-6) continue;
        const sy = Math.round((y * z + this.view.y) * dpr) + 0.5;
        g.moveTo(0, sy);
        g.lineTo(this.canvas.width, sy);
      }
      g.strokeStyle = rgba(ink, alpha);
      g.stroke();
    };
    lines(step, 0.035 + 0.035 * fade, major);
    lines(major, 0.09, 0);
    // Axes
    const [ox, oy] = this.toScreen(0, 0);
    g.beginPath();
    const ax = Math.round(ox * dpr) + 0.5;
    const ay = Math.round(oy * dpr) + 0.5;
    g.moveTo(ax, 0);
    g.lineTo(ax, this.canvas.height);
    g.moveTo(0, ay);
    g.lineTo(this.canvas.width, ay);
    g.strokeStyle = rgba(ink, 0.22);
    g.lineWidth = Math.max(1, Math.round(dpr));
    g.stroke();
  }

  drawScreenRect(g, disp) {
    const [x0, y0] = this.toScreen(0, 0);
    const [x1, y1] = this.toScreen(disp.width, disp.height);
    const dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.lineWidth = Math.max(1, Math.round(dpr));
    g.strokeStyle = rgba(disp.ink, 0.55);
    const r = (v) => Math.round(v * dpr) + 0.5;
    g.strokeRect(r(x0), r(y0), r(x1) - r(x0), r(y1) - r(y0));
  }

  drawItem(g, e) {
    switch (e.kind) {
      case 'sprite': return this.drawSprite(g, e);
      case 'shape': return this.drawShape(g, e);
      case 'text': return this.drawText2D(g, e);
      case 'tilemap': return this.drawTileMap(g, e);
      case 'particles': return this.drawParticles(g, e);
      case 'collision':
        if (!this.settings.showCollisions) return undefined;
        return this.drawCollision(g, e);
      case 'body': case 'area':
        if (!this.settings.showCollisions) return undefined;
        return this.drawOwnShape(g, e);
      case 'occluder':
        if (!this.settings.showCollisions) return undefined;
        return this.drawOccluder(g, e);
      case 'walkable': return this.drawWalkable(g, e);
      default:
        return undefined;
    }
  }

  /** A Walkable's polygon: green where things can walk, red for a hole. */
  drawWalkable(g, e) {
    const n = e.node;
    const p = this.get(n, 'points') || [];
    if (p.length < 6) return;
    const color = this.get(n, 'hole') ? WALKABLE_HOLE : WALKABLE;
    const active = this.get(n, 'active') !== false;
    this.setWorld(g, e.m);
    const k = Math.sqrt(Math.abs(e.m[0] * e.m[3] - e.m[1] * e.m[2])) * this.view.zoom || 1;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    for (let i = 2; i + 1 < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.closePath();
    g.fillStyle = `rgba(${color.join(', ')}, ${active ? 0.22 : 0.08})`;
    g.fill();
    g.lineWidth = 1.5 / k;
    g.strokeStyle = `rgba(${color.join(', ')}, 0.9)`;
    if (!active) g.setLineDash([4 / k, 3 / k]);
    g.stroke();
    g.setLineDash([]);
  }

  drawSprite(g, e) {
    const n = e.node;
    const sh = this.sheetOf(n);
    if (!sh || sh.img.status !== 'ready' || !sh.frameWidth || !sh.frameHeight) return;
    let frame = Math.trunc(num(this.get(n, 'frame')));
    const anims = sh.animations;
    if (Object.keys(anims).length) {
      const anim = anims[this.get(n, 'animation')] || anims[sh.defaultAnimation];
      if (anim) frame = Math.trunc(num(anim.frames[0]));
    }
    const count = sh.frameCount;
    const q = ((frame % count) + count) % count;
    const sx = (q % sh.columns) * sh.frameWidth;
    const sy = Math.floor(q / sh.columns) * sh.frameHeight;
    const [x, y, w, h] = this.spriteRect(n, sh);
    const fx = !!this.get(n, 'flipX');
    const fy = !!this.get(n, 'flipY');
    this.setWorld(g, e.m);
    g.translate(x + (fx ? w : 0), y + (fy ? h : 0));
    g.scale(fx ? -1 : 1, fy ? -1 : 1);
    g.globalAlpha = clamp(e.tint[3], 0, 1);
    g.drawImage(this.assets.tinted(sh.img, e.tint), sx, sy, sh.frameWidth, sh.frameHeight, 0, 0, sh.frameWidth, sh.frameHeight);
  }

  drawShape(g, e) {
    const n = e.node;
    const c = colorOf(this.get(n, 'color'));
    const t = e.tint;
    const color = rgba([c[0] * t[0], c[1] * t[1], c[2] * t[2], c[3] * t[3]]);
    const filled = !!this.get(n, 'filled');
    const shape = this.get(n, 'shape');
    this.setWorld(g, e.m);
    g.lineWidth = Math.max(0, num(this.get(n, 'lineWidth'), 2));
    g.lineJoin = 'miter';
    g.fillStyle = color;
    g.strokeStyle = color;
    g.beginPath();
    if (shape === 'rectangle') {
      const w = num(this.get(n, 'width'));
      const h = num(this.get(n, 'height'));
      const centered = this.get(n, 'centered');
      roundRectPath(g, centered ? -w / 2 : 0, centered ? -h / 2 : 0, w, h, num(this.get(n, 'cornerRadius')));
    } else if (shape === 'circle') {
      g.arc(0, 0, Math.max(0, num(this.get(n, 'radius'))), 0, Math.PI * 2);
    } else if (shape === 'polygon') {
      const p = this.get(n, 'points') || [];
      if (p.length < 6) return;
      g.moveTo(p[0], p[1]);
      for (let i = 2; i + 1 < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      g.closePath();
    } else if (shape === 'line') {
      const p = this.get(n, 'points') || [];
      if (p.length < 4) return;
      g.moveTo(p[0], p[1]);
      for (let i = 2; i + 1 < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      if (g.lineWidth > 0) g.stroke();
      return;
    }
    if (filled) g.fill();
    else if (g.lineWidth > 0) g.stroke();
  }

  drawText2D(g, e) {
    const n = e.node;
    const t = this.textLayout(n);
    const c = colorOf(this.get(n, 'color'));
    this.setWorld(g, e.m);
    const tinted = (k) => rgba([k[0] * e.tint[0], k[1] * e.tint[1], k[2] * e.tint[2], k[3] * e.tint[3]]);
    const paint = (dx, dy, fill) => {
      if (t.rich) return this.drawRich(g, t.rich, t.x + dx, t.y + dy, (st) => fill ?? tinted(st.color || c));
      g.fillStyle = fill ?? tinted(c);
      if (t.wrap > 0) printf(g, t.m, t.lines, t.x + dx, t.y + dy, t.wrap, t.align);
      else t.lines.forEach((line, i) => drawTextLine(g, t.m, line, t.x + dx, t.y + dy + i * t.m.spacing));
      return undefined;
    };
    this.textDecoration(n, (dx, dy, k) => paint(dx, dy, tinted(k)));
    paint(0, 0, null);
  }

  drawTileMap(g, e) {
    const n = e.node;
    const ts = this.assets.tileset(this.get(n, 'tileset'));
    if (!ts || ts.img?.status !== 'ready' || !ts.count) return;
    const cells = this.assets.decoded(this.get(n, 'cells'));
    if (!cells.list.length) return;
    const tw = ts.tileWidth;
    const th = ts.tileHeight;
    // Only the cells in view.
    const range = this.visibleCells(e, tw, th);
    this.setWorld(g, e.m);
    g.globalAlpha = clamp(e.tint[3], 0, 1);
    const src = this.assets.tinted(ts.img, e.tint);
    for (const [cx, cy, t] of cellsInRange(cells.list, range)) {
      if (t >= ts.count) continue;
      const tt = Math.floor(t);
      g.drawImage(src, (tt % ts.columns) * tw, Math.floor(tt / ts.columns) * th, tw, th, cx * tw, cy * th, tw, th);
    }
  }

  /** The cell range of a TileMap in view: {x0, y0, x1, y1}. */
  visibleCells(e, tw, th) {
    const inv = invert(e.m);
    if (!inv) return { x0: 0, y0: 0, x1: -1, y1: -1 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [this.width, 0], [this.width, this.height], [0, this.height]]) {
      const [wx, wy] = this.toWorld(sx, sy);
      const [lx, ly] = apply(inv, wx, wy);
      x0 = Math.min(x0, lx);
      y0 = Math.min(y0, ly);
      x1 = Math.max(x1, lx);
      y1 = Math.max(y1, ly);
    }
    return { x0: Math.floor(x0 / tw) - 1, y0: Math.floor(y0 / th) - 1, x1: Math.floor(x1 / tw) + 1, y1: Math.floor(y1 / th) + 1 };
  }

  drawParticles(g, e) {
    // A still preview: particles at evenly spread ages along the emission cone.
    const n = e.node;
    const local = !!this.get(n, 'localCoords');
    if (local) this.setWorld(g, e.m);
    else this.setWorld(g, [1, 0, 0, 1, e.m[4], e.m[5]]);
    const life = Math.max(0.01, num(this.get(n, 'lifetime'), 1));
    const speed = num(this.get(n, 'speed'), 100);
    const spr = clamp(num(this.get(n, 'speedRandom'), 0.5), 0, 1);
    const dir = num(this.get(n, 'direction'), -Math.PI / 2);
    const spread = num(this.get(n, 'spread'), 0.5);
    const gx = num(this.get(n, 'gravityX'));
    const gy = num(this.get(n, 'gravityY'));
    const s0 = num(this.get(n, 'sizeStart'), 8);
    const s1 = num(this.get(n, 'sizeEnd'), 2);
    const c0 = colorOf(this.get(n, 'colorStart'));
    const c1 = colorOf(this.get(n, 'colorEnd'));
    const img = this.get(n, 'image') ? this.assets.image(this.get(n, 'image')) : null;
    const count = 18;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const emitting = !!this.get(n, 'emitting');
    for (let i = 0; i < count; i++) {
      const age = (i + 0.5) / count;
      const tsec = age * life * 0.8 + rnd() * life * 0.2 * age;
      const a = dir + (rnd() * 2 - 1) * spread;
      const v = speed * (1 + (rnd() * 2 - 1) * spr);
      const x = Math.cos(a) * v * tsec + 0.5 * gx * tsec * tsec;
      const y = Math.sin(a) * v * tsec + 0.5 * gy * tsec * tsec;
      const size = s0 + (s1 - s0) * age;
      const c = c0.map((v0, k) => v0 + (c1[k] - v0) * age);
      const alpha = c[3] * e.tint[3] * (emitting ? 0.9 : 0.4);
      if (size <= 0 || alpha <= 0) continue;
      if (img?.status === 'ready') {
        g.globalAlpha = clamp(alpha, 0, 1);
        const k = size / img.w;
        g.drawImage(img.bitmap, x - (img.w * k) / 2, y - (img.h * k) / 2, img.w * k, img.h * k);
      } else {
        const col = [c[0] * e.tint[0], c[1] * e.tint[1], c[2] * e.tint[2]];
        const grad = g.createRadialGradient(x, y, 0, x, y, size / 2);
        grad.addColorStop(0, rgba(col, alpha));
        grad.addColorStop(0.5, rgba(col, alpha * 0.25));
        grad.addColorStop(1, rgba(col, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, size / 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  drawCollision(g, e) {
    const n = e.node;
    this.setWorld(g, e.m);
    const k = Math.sqrt(Math.abs(e.m[0] * e.m[3] - e.m[1] * e.m[2])) * this.view.zoom || 1;
    g.beginPath();
    const shape = this.get(n, 'shape');
    if (shape === 'circle') {
      g.arc(0, 0, Math.max(0, num(this.get(n, 'radius'))), 0, Math.PI * 2);
    } else if (shape === 'polygon') {
      hullPath(g, this.get(n, 'points'));
    } else {
      const w = num(this.get(n, 'width'));
      const h = num(this.get(n, 'height'));
      roundRectPath(g, -w / 2, -h / 2, w, h, shape === 'capsule' ? Math.min(w, h) / 2 : 0);
    }
    g.fillStyle = COLLISION_FILL;
    g.globalAlpha = this.get(n, 'off') ? 0.4 : 1;
    g.fill();
    g.lineWidth = 1 / k;
    g.strokeStyle = COLLISION_LINE;
    if (this.get(n, 'off')) g.setLineDash([4 / k, 3 / k]);
    g.stroke();
  }

  /**
   * A Body's or Zone's own shape, in its coordinates (it turns with it), as
   * physics2d.lua works it out: auto fits the Sprites and Shapes inside it
   * (a lone circle or polygon Shape gives that shape), or a set rectangle,
   * circle, capsule or polygon. null for none.
   */
  ownShape(e) {
    const n = e.node;
    const kind = this.get(n, 'shape');
    if (kind === 'rectangle' || kind === 'capsule') {
      const w = num(this.get(n, 'width'));
      const h = num(this.get(n, 'height'));
      return { rect: [-w / 2, -h / 2, w, h], round: kind === 'capsule' ? Math.min(w, h) / 2 : 0 };
    }
    if (kind === 'circle') return { circle: [0, 0, num(this.get(n, 'radius'))] };
    if (kind === 'polygon') return { points: this.get(n, 'points') || [] };
    if (kind !== 'auto') return null;
    let polygon = null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let circle = null;
    let count = 0;
    for (const c of e.children) {
      if (c.kind !== 'sprite' && c.kind !== 'shape') continue;
      if (!this.get(c.node, 'visible')) continue;
      const r = this.localRect(c);
      if (!r || !(r[2] > 0) || !(r[3] > 0)) continue;
      count++;
      const cx = num(this.get(c.node, 'x'));
      const cy = num(this.get(c.node, 'y'));
      const sx = num(this.get(c.node, 'scaleX'), 1);
      const sy = num(this.get(c.node, 'scaleY'), 1);
      const ax = cx + r[0] * sx;
      const bx = cx + (r[0] + r[2]) * sx;
      const ay = cy + r[1] * sy;
      const by = cy + (r[1] + r[3]) * sy;
      x0 = Math.min(x0, ax, bx);
      x1 = Math.max(x1, ax, bx);
      y0 = Math.min(y0, ay, by);
      y1 = Math.max(y1, ay, by);
      if (c.kind === 'shape' && this.get(c.node, 'shape') === 'circle') circle = { e: c, x: cx, y: cy, r: num(this.get(c.node, 'radius')) * Math.abs(sx) };
      if (c.kind === 'shape' && this.get(c.node, 'shape') === 'polygon') {
        // The polygon's points, through the Shape's own position, turn and scale.
        const rot = num(this.get(c.node, 'rotation'));
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const pts = this.get(c.node, 'points') || [];
        polygon = [];
        for (let i = 0; i + 1 < pts.length; i += 2) {
          const px = pts[i] * sx;
          const py = pts[i + 1] * sy;
          polygon.push(cx + px * cos - py * sin, cy + px * sin + py * cos);
        }
      }
    }
    if (!count) return null;
    if (count === 1 && circle) return { circle: [circle.x, circle.y, circle.r] };
    if (count === 1 && polygon) return { points: polygon };
    return { rect: [x0, y0, x1 - x0, y1 - y0] };
  }

  drawOwnShape(g, e) {
    const s = this.ownShape(e);
    if (!s) return;
    this.setWorld(g, e.m);
    const k = Math.sqrt(Math.abs(e.m[0] * e.m[3] - e.m[1] * e.m[2])) * this.view.zoom || 1;
    g.beginPath();
    if (s.circle) g.arc(s.circle[0], s.circle[1], Math.max(0, s.circle[2]), 0, Math.PI * 2);
    else if (s.points) hullPath(g, s.points);
    else roundRectPath(g, ...s.rect, s.round || 0);
    g.fillStyle = COLLISION_FILL;
    g.globalAlpha = e.kind === 'area' ? 0.6 : 1;
    g.fill();
    g.lineWidth = 1 / k;
    g.strokeStyle = COLLISION_LINE;
    if (e.kind === 'area') g.setLineDash([4 / k, 3 / k]);
    g.stroke();
  }

  /**
   * An Occluder's outline, as lights.lua works it out: its own rectangle,
   * circle or polygon; or (auto) fitted like a Body's shape to the Sprites
   * and Shapes inside it, else to the ones in the piece it is inside.
   * Returns { s: the shape, m: the matrix it is in }, or null.
   */
  occluderShape(e) {
    let s = this.ownShape(e);
    if (s) return { s, m: e.m };
    if (this.get(e.node, 'shape') !== 'auto' || !e.parent?.is2d) return null;
    s = this.ownShape({ node: e.node, children: e.parent.children });
    return s ? { s, m: e.parent.m } : null;
  }

  drawOccluder(g, e) {
    const o = this.occluderShape(e);
    if (!o) return;
    const { s, m } = o;
    this.setWorld(g, m);
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * this.view.zoom || 1;
    g.beginPath();
    if (s.circle) {
      g.arc(s.circle[0], s.circle[1], Math.max(0, s.circle[2]), 0, Math.PI * 2);
    } else if (s.points) {
      // The outline as given (an Occluder may have dents, unlike a Body).
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        if (i) g.lineTo(s.points[i], s.points[i + 1]);
        else g.moveTo(s.points[i], s.points[i + 1]);
      }
      g.closePath();
    } else {
      g.rect(...s.rect);
    }
    const off = !!this.get(e.node, 'off');
    g.globalAlpha = off ? 0.4 : 1;
    g.fillStyle = OCCLUDER_FILL;
    g.fill();
    g.lineWidth = 1.5 / k;
    g.strokeStyle = OCCLUDER_LINE;
    g.setLineDash(off ? [2 / k, 4 / k] : [5 / k, 3 / k]);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  // UI ----------------------------------------------------------------------

  drawControl(g, e) {
    const n = e.node;
    const [x, y, w, h] = e.rect;
    const alpha = e.alpha;
    this.setWorld(g);
    const fill = (c, a = alpha) => rgba(colorOf(c), a);
    const label = (font, size, text, bx, by, bw, bh, align, valign) => {
      const m = fontMetrics(this.assets.font(font), Math.max(1, num(size, 16)));
      const lines = wrapText(m, String(text ?? ''), bw);
      const th = lines.length * m.height;
      let ty = by;
      if (valign === 'middle') ty = by + (bh - th) / 2;
      else if (valign === 'bottom') ty = by + bh - th;
      return { m, lines, ty, bx, bw, align };
    };
    // Rich text (tags, spacing, justify) in a box, lined up top to bottom.
    const richIn = (bx, by, bw, bh, align, valign, color, a = alpha) => {
      const t = this.richLayout(n, bw, align);
      const ty = valign === 'middle' ? by + (bh - t.height) / 2 : valign === 'bottom' ? by + bh - t.height : by;
      const paint = (dx, dy, k) => this.drawRich(g, t, bx + dx, ty + dy, (st) => (k ? rgba(k, a) : rgba(st.color || colorOf(color), a)));
      this.textDecoration(n, paint);
      paint(0, 0, null);
    };
    switch (n.type) {
      case 'Label': {
        if (this.usesRichText(n)) {
          richIn(x, y, w, h, this.get(n, 'align'), this.get(n, 'valign'), this.get(n, 'color'));
          break;
        }
        const t = label(this.get(n, 'font'), this.get(n, 'size'), this.get(n, 'text'), x, y, w, h, this.get(n, 'align'), this.get(n, 'valign'));
        this.textDecoration(n, (dx, dy, k) => {
          g.fillStyle = rgba(k, alpha);
          printf(g, t.m, t.lines, x + dx, t.ty + dy, w, t.align);
        });
        g.fillStyle = fill(this.get(n, 'color'));
        printf(g, t.m, t.lines, x, t.ty, w, t.align);
        break;
      }
      case 'Button': {
        const c = colorOf(this.get(n, 'color'));
        const a = this.get(n, 'disabled') ? alpha * 0.5 : alpha;
        g.fillStyle = rgba(c, a);
        g.beginPath();
        roundRectPath(g, x, y, w, h, num(this.get(n, 'cornerRadius')));
        g.fill();
        if (this.get(n, 'rich')) {
          richIn(x + 4, y, w - 8, h, 'center', 'middle', this.get(n, 'textColor'), a);
          break;
        }
        const t = label(this.get(n, 'font'), this.get(n, 'size'), this.get(n, 'text'), x + 4, y, w - 8, h, 'center', 'middle');
        g.fillStyle = fill(this.get(n, 'textColor'), a);
        printf(g, t.m, t.lines, x + 4, t.ty, w - 8, 'center');
        break;
      }
      case 'Panel': {
        const r = num(this.get(n, 'cornerRadius'));
        g.fillStyle = fill(this.get(n, 'color'));
        g.beginPath();
        roundRectPath(g, x, y, w, h, r);
        g.fill();
        const bw = num(this.get(n, 'borderWidth'));
        if (bw > 0) {
          g.strokeStyle = fill(this.get(n, 'borderColor'));
          g.lineWidth = bw;
          g.beginPath();
          roundRectPath(g, x + bw / 2, y + bw / 2, w - bw, h - bw, r);
          g.stroke();
        }
        break;
      }
      case 'Picture': {
        const path = this.get(n, 'image');
        const img = path ? this.assets.image(path) : null;
        if (!img || img.status !== 'ready') break;
        const c = colorOf(this.get(n, 'color'));
        const src = this.assets.tinted(img, c);
        g.globalAlpha = clamp(c[3] * alpha, 0, 1);
        const iw = img.w;
        const ih = img.h;
        const fit = this.get(n, 'fit');
        if (fit === 'stretch') g.drawImage(src, x, y, w, h);
        else if (fit === 'contain' || fit === 'cover') {
          const s = (fit === 'contain' ? Math.min : Math.max)(w / iw, h / ih);
          if (fit === 'cover') {
            g.beginPath();
            g.rect(x, y, w, h);
            g.clip();
          }
          g.drawImage(src, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
        } else if (fit === 'center') g.drawImage(src, x + (w - iw) / 2, y + (h - ih) / 2);
        else if (fit === 'tile') {
          const pat = g.createPattern(src, 'repeat');
          if (pat) {
            g.translate(x, y);
            g.fillStyle = pat;
            g.fillRect(0, 0, w, h);
          }
        }
        break;
      }
      case 'Bar': {
        const r = num(this.get(n, 'cornerRadius'));
        g.fillStyle = fill(this.get(n, 'background'));
        g.beginPath();
        roundRectPath(g, x, y, w, h, r);
        g.fill();
        const min = num(this.get(n, 'min'));
        const max = num(this.get(n, 'max'), 100);
        const value = num(this.get(n, 'value'));
        const range = max - min;
        const t = range !== 0 ? clamp((value - min) / range, 0, 1) : 0;
        if (t > 0) {
          g.fillStyle = fill(this.get(n, 'color'));
          g.beginPath();
          roundRectPath(g, x, y, w * t, h, Math.min(r, (w * t) / 2));
          g.fill();
        }
        if (this.get(n, 'showValue')) {
          const lt = label('', Math.max(10, Math.floor(h * 0.6)), String(Math.trunc(value)), x, y, w, h, 'center', 'middle');
          g.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          printf(g, lt.m, lt.lines, x, lt.ty, w, 'center');
        }
        break;
      }
      // Touch pieces are drawn here whatever their "show" says: in the
      // game they may only appear on a touch screen.
      case 'TouchStick': {
        const r = Math.max(1, num(this.get(n, 'radius'), 60));
        const cx = x + w / 2;
        const cy = y + h / 2;
        const c = colorOf(this.get(n, 'color'));
        const base = this.get(n, 'image') ? this.assets.image(this.get(n, 'image')) : null;
        if (base && base.status === 'ready') {
          const k = (r * 2) / Math.max(base.w, base.h);
          g.globalAlpha = clamp(c[3] * alpha, 0, 1);
          g.drawImage(this.assets.tinted(base, c), cx - (base.w * k) / 2, cy - (base.h * k) / 2, base.w * k, base.h * k);
          g.globalAlpha = 1;
        } else {
          g.fillStyle = rgba(c, alpha);
          g.beginPath();
          g.arc(cx, cy, r, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = rgba(c, Math.min(1, alpha * 1.6));
          g.lineWidth = 2;
          g.stroke();
        }
        const kc = colorOf(this.get(n, 'knobColor'));
        const knob = this.get(n, 'knobImage') ? this.assets.image(this.get(n, 'knobImage')) : null;
        if (knob && knob.status === 'ready') {
          const k = (r * 0.9) / Math.max(knob.w, knob.h);
          g.globalAlpha = clamp(kc[3] * alpha, 0, 1);
          g.drawImage(this.assets.tinted(knob, kc), cx - (knob.w * k) / 2, cy - (knob.h * k) / 2, knob.w * k, knob.h * k);
          g.globalAlpha = 1;
        } else {
          g.fillStyle = rgba(kc, alpha);
          g.beginPath();
          g.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
          g.fill();
        }
        // A floating or following stick answers anywhere in its rectangle.
        if (this.get(n, 'mode') !== 'fixed') {
          g.strokeStyle = rgba(c, Math.min(1, alpha * 1.6));
          g.lineWidth = 1;
          g.setLineDash([6, 5]);
          g.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
          g.setLineDash([]);
        }
        break;
      }
      case 'TouchButton': {
        const c = colorOf(this.get(n, 'color'));
        const size = Math.min(w, h);
        g.fillStyle = rgba(c, alpha);
        g.beginPath();
        if (this.get(n, 'shape') === 'rectangle') roundRectPath(g, x, y, w, h, num(this.get(n, 'cornerRadius')));
        else g.arc(x + w / 2, y + h / 2, size / 2, 0, Math.PI * 2);
        g.fill();
        const img = this.get(n, 'image') ? this.assets.image(this.get(n, 'image')) : null;
        if (img && img.status === 'ready') {
          const k = (size * 0.7) / Math.max(img.w, img.h);
          g.globalAlpha = clamp(alpha, 0, 1);
          g.drawImage(this.assets.tinted(img, [1, 1, 1, 1]), x + (w - img.w * k) / 2, y + (h - img.h * k) / 2, img.w * k, img.h * k);
          g.globalAlpha = 1;
        }
        const words = String(this.get(n, 'text') ?? '');
        if (words) {
          const t = label(this.get(n, 'font'), this.get(n, 'size'), words, x, y, w, h, 'center', 'middle');
          g.fillStyle = fill(this.get(n, 'textColor'));
          printf(g, t.m, t.lines, x, t.ty, w, 'center');
        }
        break;
      }
      default:
    }
  }

  // Gizmos: editor-only marks for nodes that draw nothing ---------------------

  /** Screen-space marks: [{entry, sx, sy, r, icon}]. */
  gizmos() {
    const sc = this.sceneData();
    if (!sc) return [];
    const out = [];
    for (const e of sc.items) {
      if (e.node.readonly) continue;
      const n = e.node;
      let icon = null;
      switch (e.kind) {
        case 'body': {
          const motion = this.get(n, 'motion');
          icon = motion === 'still' ? 'static' : motion === 'physics' ? 'rigid' : 'character';
          break;
        }
        case 'area': case 'joint': case 'particles': case 'camera': case 'light':
          icon = e.kind;
          break;
        case 'occluder':
          // Its own outline is the mark, when it has one and Shapes is on.
          if (!this.settings.showCollisions || this.occluderShape(e)?.m !== e.m) icon = 'occluder';
          break;
        case 'sprite':
          if (!this.get(n, 'image')) icon = 'sprite';
          break;
        case 'tilemap':
          if (!this.get(n, 'tileset') || !this.assets.decoded(this.get(n, 'cells')).list.length) icon = 'tilemap';
          break;
        case 'text':
          if (!String(this.get(n, 'text') ?? '').length) icon = 'text';
          break;
        case 'node2d':
          if (e.type === 'Background') icon = 'background';
          else if (!e.children.length) icon = 'marker';
          break;
        default:
      }
      if (!icon) continue;
      const [sx, sy] = this.toScreen(e.m[4], e.m[5]);
      out.push({ entry: e, sx, sy, r: 9, icon });
    }
    return out;
  }

  drawGizmos(g, sc, disp) {
    this.setScreen(g);
    const ink = disp.ink;
    const halo = disp.halo;
    // Cameras: the area of the screen they show; particles: the emission cone.
    for (const e of sc.items) {
      if (e.kind === 'camera' && !e.node.readonly) {
        const zoom = Math.max(0.01, num(this.get(e.node, 'zoom'), 1));
        const hw = disp.width / 2 / zoom;
        const hh = disp.height / 2 / zoom;
        const [x0, y0] = this.toScreen(e.m[4] - hw, e.m[5] - hh);
        const [x1, y1] = this.toScreen(e.m[4] + hw, e.m[5] + hh);
        g.setLineDash([6, 4]);
        g.lineWidth = 1;
        g.strokeStyle = rgba(this.colors.accent, this.get(e.node, 'active') ? 0.8 : 0.4);
        g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
        g.setLineDash([]);
      } else if (e.kind === 'particles' && !e.node.readonly) {
        const n = e.node;
        const dir = num(this.get(n, 'direction'), -Math.PI / 2) + (this.get(n, 'localCoords') ? Math.atan2(e.m[1], e.m[0]) : 0);
        const spread = Math.min(Math.PI, Math.abs(num(this.get(n, 'spread'), 0.5)));
        const len = clamp(num(this.get(n, 'speed'), 100) * num(this.get(n, 'lifetime'), 1) * 0.5 * this.view.zoom, 28, 140);
        const [sx, sy] = this.toScreen(e.m[4], e.m[5]);
        g.beginPath();
        g.moveTo(sx, sy);
        g.arc(sx, sy, len, dir - spread, dir + spread);
        g.closePath();
        g.fillStyle = rgba(this.colors.accent, 0.08);
        g.fill();
        g.strokeStyle = rgba(this.colors.accent, 0.5);
        g.lineWidth = 1;
        g.stroke();
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + Math.cos(dir) * len, sy + Math.sin(dir) * len);
        g.setLineDash([3, 3]);
        g.stroke();
        g.setLineDash([]);
      } else if (e.kind === 'light' && !e.node.readonly) {
        this.drawLightGizmo(g, e);
      } else if (e.type === 'Background' && !e.node.readonly) {
        this.drawBackgroundGizmo(g, e, disp);
      }
    }
    this.drawTintSwatch(g, sc, disp);
    for (const gz of this.gizmos()) drawIcon(g, gz.icon, gz.sx, gz.sy, rgba(ink, 0.75), rgba(halo, 0.45));
  }

  /**
   * A Background: what's inside is shown where it was placed (where the game
   * shows it while the camera is on the scene's first screen). A badge says
   * how fast it scrolls, and an outline shows the size it repeats at, with
   * the start of the next copy beside it.
   */
  drawBackgroundGizmo(g, e, disp) {
    const n = e.node;
    const fmt = (v) => String(Math.round(num(v, 0) * 100) / 100);
    const sx = num(this.get(n, 'scrollX'), 0.5);
    const sy = num(this.get(n, 'scrollY'), 0.5);
    const rw = Math.max(0, num(this.get(n, 'repeatWidth'), 0));
    const rh = Math.max(0, num(this.get(n, 'repeatHeight'), 0));
    const accent = this.colors.accent;
    const at = (x, y) => this.toScreen(e.m[0] * x + e.m[2] * y + e.m[4], e.m[1] * x + e.m[3] * y + e.m[5]);
    if (rw > 0 || rh > 0) {
      // One copy: the repeat size, or the game's size where it doesn't repeat.
      const w = rw || disp.width;
      const hh = rh || disp.height;
      const quad = (x, y) => {
        const pts = [at(x, y), at(x + w, y), at(x + w, y + hh), at(x, y + hh)];
        g.beginPath();
        pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.closePath();
      };
      g.lineWidth = 1;
      g.setLineDash([2, 4]);
      g.strokeStyle = rgba(accent, 0.35);
      if (rw > 0) {
        quad(w, 0);
        g.stroke();
      }
      if (rh > 0) {
        quad(0, hh);
        g.stroke();
      }
      g.setLineDash([7, 4]);
      g.strokeStyle = rgba(accent, 0.85);
      quad(0, 0);
      g.stroke();
      g.setLineDash([]);
    }
    const [ox, oy] = at(0, 0);
    let text = sx === sy ? `scroll ${fmt(sx)}` : `scroll ${fmt(sx)}, ${fmt(sy)}`;
    if (rw > 0 || rh > 0) text += rw > 0 && rh > 0 ? ` · repeats every ${fmt(rw)} × ${fmt(rh)}` : rw > 0 ? ` · repeats every ${fmt(rw)}` : ` · repeats every ${fmt(rh)} down`;
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const tw = g.measureText(text).width;
    const bx = Math.round(ox) + 13.5;
    const by = Math.round(oy) - 8.5;
    g.fillStyle = rgba(disp.halo, 0.7);
    roundRectPath(g, bx, by, tw + 10, 17, 4);
    g.fill();
    g.fillStyle = rgba(disp.ink, 0.85);
    g.fillText(text, bx + 5, by + 9);
  }

  /** A Light: how far a point light reaches, or which way a sun shines. */
  drawLightGizmo(g, e) {
    const n = e.node;
    const c = colorOf(this.get(n, 'color'));
    const alpha = this.get(n, 'off') ? 0.3 : 0.85;
    const [sx, sy] = this.toScreen(e.m[4], e.m[5]);
    g.lineWidth = 1;
    g.strokeStyle = rgba(c, alpha);
    if (this.get(n, 'kind') === 'sun') {
      // Three arrows the way the light travels.
      const a = Math.atan2(e.m[1], e.m[0]);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      g.beginPath();
      for (const off of [-12, 0, 12]) {
        const x0 = sx - sin * off + cos * 14;
        const y0 = sy + cos * off + sin * 14;
        const x1 = x0 + cos * 34;
        const y1 = y0 + sin * 34;
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.moveTo(x1 - cos * 7 + sin * 4, y1 - sin * 7 - cos * 4);
        g.lineTo(x1, y1);
        g.lineTo(x1 - cos * 7 - sin * 4, y1 - sin * 7 + cos * 4);
      }
      g.stroke();
      return;
    }
    // The reach: a circle of the radius, through the piece's turn and scale.
    const r = Math.max(0, num(this.get(n, 'radius'), 200));
    const z = this.view.zoom;
    g.save();
    g.translate(sx, sy);
    g.transform(e.m[0] * z, e.m[1] * z, e.m[2] * z, e.m[3] * z, 0, 0);
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.restore();
    g.fillStyle = rgba(c, alpha * 0.06);
    g.fill();
    g.setLineDash([6, 4]);
    g.stroke();
    g.setLineDash([]);
  }

  /** The scene's Tint (the first one that's on): a swatch at the game's top left corner. */
  drawTintSwatch(g, sc, disp) {
    let tint = null;
    const find = (e) => {
      if (tint) return;
      if (e.type === 'Tint' && !this.get(e.node, 'off')) {
        tint = e;
        return;
      }
      if ((e.is2d || e.isUI) && this.get(e.node, 'visible') === false) return;
      for (const c of e.children) find(c);
    };
    find(sc.root);
    if (!tint) return;
    const [x, y] = this.toScreen(0, 0);
    const c = colorOf(this.get(tint.node, 'color'));
    const bx = Math.round(x) + 6.5;
    const by = Math.round(y) + 6.5;
    g.fillStyle = rgba([c[0], c[1], c[2]], 1);
    g.fillRect(bx, by, 14, 14);
    g.lineWidth = 1;
    g.strokeStyle = rgba(disp.ink, 0.7);
    g.strokeRect(bx, by, 14, 14);
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = rgba(disp.ink, 0.75);
    g.fillText('Tint', bx + 19, by + 7.5);
  }

  // Selection, hover and handles ---------------------------------------------

  drawSelection(g, sc, disp) {
    this.setScreen(g);
    const accent = this.colors.accent;
    const halo = disp.halo;
    const quad = (pts, color, width, dash) => {
      if (pts.length < 2) return;
      g.beginPath();
      pts.forEach(([x, y], i) => {
        const [sx, sy] = this.toScreen(x, y);
        if (i) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
      g.closePath();
      g.setLineDash(dash || []);
      g.lineWidth = width + 2;
      g.strokeStyle = rgba(halo, 0.35);
      g.stroke();
      g.lineWidth = width;
      g.strokeStyle = color;
      g.stroke();
      g.setLineDash([]);
    };
    const outline = (e, color, width) => {
      if (e.isUI) return quad(this.worldCorners(e), color, width);
      if (!e.m) return undefined;
      const b = this.localBounds(e);
      if (!b) return undefined;
      const [x, y, w, h] = b;
      return quad([apply(e.m, x, y), apply(e.m, x + w, y), apply(e.m, x + w, y + h), apply(e.m, x, y + h)], color, width, this.localRect(e) ? null : [4, 3]);
    };
    // Hover
    if (this.hover && !this.doc.selection.has(this.hover.id) && !this.drag) {
      const e = sc.entries.get(this.hover);
      if (e) outline(e, rgba(disp.ink, 0.5), 1);
    }
    const selected = this.doc.selected();
    for (const n of selected) {
      const e = sc.entries.get(n);
      if (!e) continue;
      outline(e, rgba(accent), 1.5);
      if (e.m) {
        const [sx, sy] = this.toScreen(e.m[4], e.m[5]);
        g.beginPath();
        g.arc(sx, sy, 3.5, 0, Math.PI * 2);
        g.fillStyle = rgba(accent);
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = rgba(halo, 0.6);
        g.stroke();
      }
    }
    // Handles for the primary node
    if (this.drag?.kind === 'box' || this.tool === 'paint') return;
    for (const h of this.handles()) {
      g.beginPath();
      if (h.kind === 'rotate') {
        const [px, py] = h.pivot;
        g.moveTo(px, py);
        g.lineTo(h.sx, h.sy);
        g.lineWidth = 1;
        g.strokeStyle = rgba(accent, 0.7);
        g.stroke();
        g.beginPath();
        g.arc(h.sx, h.sy, HANDLE_R + 1, 0, Math.PI * 2);
      } else if (h.kind === 'size' && h.round) {
        g.arc(h.sx, h.sy, HANDLE_R, 0, Math.PI * 2);
      } else if (h.kind === 'midpoint') {
        g.arc(h.sx, h.sy, HANDLE_R - 2, 0, Math.PI * 2);
      } else {
        g.rect(Math.round(h.sx - HANDLE_R) + 0.5, Math.round(h.sy - HANDLE_R) + 0.5, HANDLE_R * 2, HANDLE_R * 2);
      }
      g.fillStyle = h.kind === 'size' || h.kind === 'rotate' ? rgba(accent) : 'rgb(255, 255, 255)';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = rgba(accent);
      g.stroke();
    }
  }

  /** The drag handles of the primary selected node for the current tool, in screen space. */
  handles() {
    const sc = this.sceneData();
    const n = this.primary();
    if (!sc || !n || n.readonly) return [];
    const e = sc.entries.get(n);
    if (!e) return [];
    const out = [];
    const DIRS = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
    if (e.isUI) {
      if ((this.tool === 'select' || this.tool === 'scale') && this.get(n, 'anchor') !== 'full' && this.doc.selection.size === 1) {
        const [x, y, w, h] = e.rect;
        for (const [hx, hy] of DIRS) {
          const [sx, sy] = this.toScreen(x + ((hx + 1) / 2) * w, y + ((hy + 1) / 2) * h);
          out.push({ kind: 'resize', hx, hy, sx, sy, entry: e });
        }
      }
      return out;
    }
    if (!e.m) return out;
    if (this.tool === 'rotate') {
      const [px, py] = this.toScreen(e.m[4], e.m[5]);
      const a = Math.atan2(e.m[1], e.m[0]);
      out.push({ kind: 'rotate', sx: px + Math.cos(a) * 56, sy: py + Math.sin(a) * 56, pivot: [px, py], entry: e });
      return out;
    }
    if (this.tool === 'scale') {
      const b = this.localBounds(e);
      if (!b) return out;
      const [x, y, w, h] = b;
      for (const [hx, hy] of DIRS) {
        const lx = x + ((hx + 1) / 2) * w;
        const ly = y + ((hy + 1) / 2) * h;
        const [wx, wy] = apply(e.m, lx, ly);
        const [sx, sy] = this.toScreen(wx, wy);
        out.push({ kind: 'scale', hx, hy, lx, ly, sx, sy, entry: e });
      }
      return out;
    }
    if (this.tool === 'select' && this.doc.selection.size === 1) {
      // Size handles on shapes and collision shapes.
      const shape = this.get(n, 'shape');
      const push = (lx, ly, hx, hy, round = false) => {
        const [wx, wy] = apply(e.m, lx, ly);
        const [sx, sy] = this.toScreen(wx, wy);
        out.push({ kind: 'size', hx, hy, lx, ly, sx, sy, entry: e, round });
      };
      if ((e.kind === 'shape' || e.kind === 'collision') && shape === 'circle') {
        const r = num(this.get(n, 'radius'));
        push(r, 0, 1, 0, true);
        push(0, r, 0, 1, true);
      } else if ((e.kind === 'shape' && shape === 'rectangle') || (e.kind === 'collision' && shape !== 'circle' && shape !== 'polygon')) {
        const w = num(this.get(n, 'width'));
        const h = num(this.get(n, 'height'));
        const centered = e.kind === 'collision' || this.get(n, 'centered');
        for (const [hx, hy] of DIRS) {
          // A rectangle drawn from its corner only grows to the right and down.
          if (!centered && (hx < 0 || hy < 0)) continue;
          const lx = centered ? (hx * w) / 2 : hx === 0 ? w / 2 : w;
          const ly = centered ? (hy * h) / 2 : hy === 0 ? h / 2 : h;
          push(lx, ly, hx, hy);
        }
      }
      // Corner handles on polygons and lines: drag a corner to move it, drag
      // the small dot in the middle of an edge to add a corner there.
      const closed = e.kind === 'walkable' || (e.kind === 'shape' && shape === 'polygon');
      if (closed || (e.kind === 'shape' && shape === 'line')) {
        const p = this.get(n, 'points') || [];
        const count = Math.floor(p.length / 2);
        const at = (lx, ly) => this.toScreen(...apply(e.m, lx, ly));
        for (let i = 0; i < count; i++) {
          const [sx, sy] = at(p[i * 2], p[i * 2 + 1]);
          out.push({ kind: 'point', index: i, sx, sy, entry: e, closed });
        }
        for (let i = 0; i < count - (closed ? 0 : 1); i++) {
          const j = (i + 1) % count;
          const [ax, ay] = at(p[i * 2], p[i * 2 + 1]);
          const [bx, by] = at(p[j * 2], p[j * 2 + 1]);
          // Not where the corners' own handles would cover it.
          if (Math.hypot(bx - ax, by - ay) < HANDLE_R * 6) continue;
          out.push({ kind: 'midpoint', index: i, sx: (ax + bx) / 2, sy: (ay + by) / 2, entry: e, closed });
        }
      }
    }
    return out;
  }

  handleAt(sx, sy) {
    let best = null;
    let bestD = HANDLE_R + 4;
    for (const h of this.handles()) {
      const d = Math.max(Math.abs(h.sx - sx), Math.abs(h.sy - sy));
      if (d <= bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }

  drawDragOverlay(g, disp) {
    this.setScreen(g);
    const d = this.drag;
    if (d?.kind === 'box' && d.moved) {
      const [x0, y0] = this.toScreen(d.start[0], d.start[1]);
      const [x1, y1] = this.toScreen(d.cur[0], d.cur[1]);
      g.fillStyle = rgba(this.colors.accent, 0.1);
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.strokeStyle = rgba(this.colors.accent, 0.9);
      g.lineWidth = 1;
      g.strokeRect(Math.round(Math.min(x0, x1)) + 0.5, Math.round(Math.min(y0, y1)) + 0.5, Math.round(Math.abs(x1 - x0)), Math.round(Math.abs(y1 - y0)));
    }
    if (this.dropAt) {
      const [sx, sy] = this.toScreen(this.dropAt[0], this.dropAt[1]);
      g.strokeStyle = rgba(this.colors.accent);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx - 10, sy);
      g.lineTo(sx + 10, sy);
      g.moveTo(sx, sy - 10);
      g.lineTo(sx, sy + 10);
      g.stroke();
      g.beginPath();
      g.arc(sx, sy, 4, 0, Math.PI * 2);
      g.stroke();
    }
    if (d?.kind === 'rotate' && d.moved) {
      const [px, py] = this.toScreen(d.pivot[0], d.pivot[1]);
      g.strokeStyle = rgba(this.colors.accent, 0.6);
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(px, py);
      const [cx, cy] = this.toScreen(d.cur[0], d.cur[1]);
      g.lineTo(cx, cy);
      g.stroke();
      g.setLineDash([]);
      g.font = `11px ${DEFAULT_FAMILY}`;
      g.fillStyle = rgba(disp.ink, 0.85);
      g.fillText(`${Math.round((d.shown * 180) / Math.PI)}°`, cx + 10, cy - 10);
    }
  }

  // -------------------------------------------------------------------------
  // Hit testing

  hitItem(e, wx, wy) {
    const n = e.node;
    if (e.kind === 'camera') {
      if (e.node.readonly) return false;
      const disp = this.displayInfo();
      const zoom = Math.max(0.01, num(this.get(n, 'zoom'), 1));
      const hw = disp.width / 2 / zoom;
      const hh = disp.height / 2 / zoom;
      const tol = 4 / this.view.zoom;
      const dx = Math.abs(wx - e.m[4]);
      const dy = Math.abs(wy - e.m[5]);
      return (Math.abs(dx - hw) <= tol && dy <= hh + tol) || (Math.abs(dy - hh) <= tol && dx <= hw + tol);
    }
    if (e.kind === 'collision' && !this.settings.showCollisions) return false;
    const inv = invert(e.m);
    if (!inv) return false;
    const [lx, ly] = apply(inv, wx, wy);
    const scale = Math.sqrt(Math.abs(e.m[0] * e.m[3] - e.m[1] * e.m[2])) * this.view.zoom || 1;
    const tol = 4 / scale;
    switch (e.kind) {
      case 'shape': {
        const shape = this.get(n, 'shape');
        if (shape === 'circle') return Math.hypot(lx, ly) <= num(this.get(n, 'radius')) + (this.get(n, 'filled') ? 0 : tol);
        if (shape === 'polygon' || shape === 'line') {
          const p = this.get(n, 'points') || [];
          const lw = num(this.get(n, 'lineWidth'), 2) / 2 + tol;
          if (shape === 'polygon' && this.get(n, 'filled') && pointInPolygon(p, lx, ly)) return true;
          const closed = shape === 'polygon';
          for (let i = 0; i + 3 < p.length + (closed ? 2 : 0); i += 2) {
            const j = (i + 2) % p.length;
            if (segDist(lx, ly, p[i], p[i + 1], p[j], p[j + 1]) <= lw) return true;
          }
          return false;
        }
        break;
      }
      case 'walkable': {
        const p = this.get(n, 'points') || [];
        if (p.length < 6) return false;
        if (pointInPolygon(p, lx, ly)) return true;
        for (let i = 0; i + 1 < p.length; i += 2) {
          const j = (i + 2) % p.length;
          if (segDist(lx, ly, p[i], p[i + 1], p[j], p[j + 1]) <= tol) return true;
        }
        return false;
      }
      case 'collision':
        if (this.get(n, 'shape') === 'circle') return Math.hypot(lx, ly) <= num(this.get(n, 'radius'));
        break;
      case 'tilemap': {
        const ts = this.assets.tileset(this.get(n, 'tileset'));
        if (!ts) return false;
        const cells = this.assets.decoded(this.get(n, 'cells'));
        return cells.grid.has(`${Math.floor(lx / ts.tileWidth)},${Math.floor(ly / ts.tileHeight)}`);
      }
      default:
    }
    const r = this.localRect(e);
    if (!r) return false;
    const [x, y, w, h] = r;
    const x0 = Math.min(x, x + w);
    const y0 = Math.min(y, y + h);
    return lx >= x0 && ly >= y0 && lx <= x0 + Math.abs(w) && ly <= y0 + Math.abs(h);
  }

  /** Selectable nodes under a screen point, topmost first. */
  hitTest(sx, sy) {
    const sc = this.sceneData();
    if (!sc) return [];
    const [wx, wy] = this.toWorld(sx, sy);
    const hits = [];
    for (const gz of this.gizmos().reverse()) if (Math.hypot(gz.sx - sx, gz.sy - sy) <= gz.r) hits.push(gz.entry);
    for (let i = sc.ui.length - 1; i >= 0; i--) {
      const e = sc.ui[i];
      const [x, y, w, h] = e.rect;
      if (wx >= x && wy >= y && wx < x + w && wy < y + h) hits.push(e);
    }
    for (let i = sc.items.length - 1; i >= 0; i--) {
      const e = sc.items[i];
      if (this.hitItem(e, wx, wy)) hits.push(e);
    }
    const out = [];
    for (const e of hits) {
      const n = this.selectable(e);
      if (!out.includes(n)) out.push(n);
    }
    return out;
  }

  setHover(node) {
    if (this.hover === node) return;
    this.hover = node;
    this.redraw();
  }

  // -------------------------------------------------------------------------
  // Pointer

  pointerDown(e) {
    if (!this.doc) return;
    this.root.focus({ preventScroll: true });
    const [sx, sy] = this.eventPoint(e);
    this.mouse = { sx, sy };
    const world = this.toWorld(sx, sy);
    if (this.drag) return;
    // Pan: middle button, right button, or space + left.
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.capture(e);
      this.drag = { kind: 'pan', button: e.button, startS: [sx, sy], view0: { ...this.view }, moved: false, client: [e.clientX, e.clientY] };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;
    this.capture(e);

    if (this.paintActive()) {
      const info = this.cellInfo(world);
      if (info) {
        this.drag = { kind: 'paint' };
        this.painter.paintDown(info, e);
        this.redraw();
      }
      return;
    }

    const handle = this.handleAt(sx, sy);
    if (handle) {
      this.beginHandleDrag(handle, world, e);
      return;
    }

    const hits = this.hitTest(sx, sy);
    let target = hits[0] || null;
    if (e.altKey && hits.length) {
      const same = this.altCycle && Math.hypot(this.altCycle.sx - sx, this.altCycle.sy - sy) < 4 && this.altCycle.count === hits.length;
      const index = same ? (this.altCycle.index + 1) % hits.length : 0;
      this.altCycle = { sx, sy, index, count: hits.length };
      target = hits[index];
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const sel = this.doc.selection;
    let pending = null;
    if (target) {
      if (additive) pending = { kind: 'toggle', node: target };
      else if (!sel.has(target.id)) this.doc.select([target]);
      else if (e.altKey || sel.size > 1) pending = { kind: 'only', node: target };
    }
    const kind = this.tool === 'rotate' ? 'rotate' : this.tool === 'scale' ? 'scale' : 'move';
    if (target || ((this.tool === 'move' || this.tool === 'rotate' || this.tool === 'scale') && sel.size && !additive)) {
      this.drag = { kind: 'pending', next: kind, target, pending, start: world, startS: [sx, sy], moved: false, additive };
    } else {
      this.drag = { kind: 'box', start: world, cur: world, startS: [sx, sy], moved: false, add: additive };
    }
    this.redraw();
  }

  capture(e) {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // not a live pointer (synthetic events)
    }
  }

  pointerMove(e) {
    const [sx, sy] = this.eventPoint(e);
    this.mouse = { sx, sy };
    const world = this.toWorld(sx, sy);
    const d = this.drag;
    this.emitStatus(world);
    if (!d) {
      if (this.paintActive()) {
        this.painter.paintHover(this.cellInfo(world));
        this.setHover(null);
        this.redraw();
      } else {
        const hits = this.hitTest(sx, sy);
        this.setHover(hits[0] || null);
        this.updateCursor(sx, sy);
      }
      return;
    }
    if (d.kind === 'pan') {
      const dx = sx - d.startS[0];
      const dy = sy - d.startS[1];
      if (!d.moved && Math.hypot(dx, dy) < DRAG_START) return;
      d.moved = true;
      this.view.x = d.view0.x + dx;
      this.view.y = d.view0.y + dy;
      this.redraw();
      return;
    }
    if (d.kind === 'paint') {
      const info = this.cellInfo(world);
      if (info) this.painter?.paintMove(info, e);
      this.redraw();
      return;
    }
    if (!d.moved && Math.hypot(sx - d.startS[0], sy - d.startS[1]) < DRAG_START) return;
    if (!d.moved) {
      d.moved = true;
      if (d.kind === 'pending') this.beginEditDrag(d, e);
    }
    const cur = this.drag;
    if (!cur) return;
    cur.cur = world;
    switch (cur.kind) {
      case 'box': this.redraw(); break;
      case 'move': this.updateMove(cur, world, e); break;
      case 'rotate': this.updateRotate(cur, world, e); break;
      case 'scale': this.updateScale(cur, world, e); break;
      case 'size': this.updateSize(cur, world, e); break;
      case 'point': this.updatePoint(cur, world, e); break;
      case 'resize': this.updateResize(cur, world, e); break;
      default:
    }
  }

  pointerUp(e, cancelled = false) {
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const world = this.toWorld(...this.eventPoint(e));
    switch (d.kind) {
      case 'pan':
        if (!d.moved && d.button === 2 && !cancelled) this.contextMenu(e);
        break;
      case 'paint': {
        const info = this.cellInfo(world);
        if (cancelled) this.painter?.paintCancel?.();
        else this.painter?.paintUp(info, e);
        break;
      }
      case 'box':
        if (!cancelled) this.finishBox(d);
        break;
      case 'pending':
        if (!cancelled && d.pending) {
          if (d.pending.kind === 'toggle') this.doc.toggleSelect(d.pending.node);
          else this.doc.select([d.pending.node]);
        }
        break;
      case 'point':
        if (!cancelled) this.finishPoint(d);
        d.gesture?.end();
        break;
      default:
        d.gesture?.end();
    }
    this.updateCursor();
    this.redraw();
  }

  cancelDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'pan') {
      this.view = { ...d.view0 };
    } else if (d.kind === 'paint') {
      this.painter?.paintCancel?.();
    } else {
      d.gesture?.cancel();
    }
    this.redraw();
  }

  contextMenu(e) {
    const [sx, sy] = this.eventPoint(e);
    const node = this.hitTest(sx, sy)[0] || null;
    if (node && !this.doc.selection.has(node.id)) this.doc.select([node]);
    const [wx, wy] = this.toWorld(sx, sy);
    this.container.dispatchEvent(new CustomEvent('viewport-context', {
      bubbles: true, detail: { node, x: e.clientX, y: e.clientY, worldX: wx, worldY: wy },
    }));
  }

  finishBox(d) {
    if (!d.moved) {
      if (!d.add) this.doc.select([]);
      return;
    }
    const sc = this.sceneData();
    const x0 = Math.min(d.start[0], d.cur[0]);
    const y0 = Math.min(d.start[1], d.cur[1]);
    const x1 = Math.max(d.start[0], d.cur[0]);
    const y1 = Math.max(d.start[1], d.cur[1]);
    const inside = (x, y) => x >= x0 && y >= y0 && x <= x1 && y <= y1;
    const found = [];
    const take = (e) => {
      const n = e.node;
      if (n.readonly || n === this.doc.root || found.includes(n)) return;
      found.push(n);
    };
    for (const e of sc.items) {
      // A node is picked when its origin is in the box (as in Godot).
      if (inside(e.m[4], e.m[5])) take(e);
    }
    for (const e of sc.ui) {
      const [x, y, w, h] = e.rect;
      if (inside(x + w / 2, y + h / 2)) take(e);
    }
    this.doc.select(found, { add: d.add });
  }

  wheel(e) {
    e.preventDefault();
    const [sx, sy] = this.eventPoint(e);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 32;
    else if (e.deltaMode === 2) dy *= this.height;
    const k = Math.exp(-clamp(dy, -200, 200) * (e.ctrlKey ? 0.01 : 0.0018));
    this.zoomAt(this.view.zoom * k, sx, sy);
  }

  zoomAt(zoom, sx = this.width / 2, sy = this.height / 2) {
    zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const [wx, wy] = this.toWorld(sx, sy);
    this.view.zoom = zoom;
    this.view.x = sx - wx * zoom;
    this.view.y = sy - wy * zoom;
    this.framed = true;
    this.emitStatus(this.mouse ? this.toWorld(this.mouse.sx, this.mouse.sy) : null);
    this.redraw();
  }

  updateCursor(sx, sy) {
    let c = '';
    if (this.drag?.kind === 'pan') c = 'grabbing';
    else if (this.spaceDown) c = 'grab';
    else if (this.paintActive()) c = 'crosshair';
    else if (sx !== undefined) {
      const h = this.handleAt(sx, sy);
      if (h) {
        if (h.kind === 'rotate') c = 'grab';
        else if (h.kind === 'point' || h.kind === 'midpoint') c = 'crosshair';
        else {
          // The handle's direction on screen, from the node's center.
          const corners = this.worldCorners(h.entry);
          const cx = corners.reduce((sum, p) => sum + p[0], 0) / corners.length;
          const cy = corners.reduce((sum, p) => sum + p[1], 0) / corners.length;
          const [ccx, ccy] = this.toScreen(cx, cy);
          const a = Math.atan2(h.sy - ccy, h.sx - ccx);
          const deg = ((Math.round((a * 180) / Math.PI / 45) % 4) + 4) % 4;
          c = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][deg];
        }
      } else if (this.tool === 'move' && this.doc?.selection.size) c = 'move';
      else if (this.hover && this.doc?.selection.has(this.hover.id) && this.tool === 'select') c = 'move';
    }
    this.canvas.style.cursor = c;
  }

  // -------------------------------------------------------------------------
  // Edit drags

  /** Nodes that move with a drag: selected, editable, not inside another selected node. */
  editable(filter = () => true) {
    const sel = this.doc.selected().filter((n) => !n.readonly);
    return sel.filter((n) => !sel.some((m) => m !== n && this.doc.contains(m, n)) && filter(n));
  }

  beginEditDrag(d, e) {
    const kind = d.next;
    if (d.pending?.kind === 'toggle' && d.target && !this.doc.selection.has(d.target.id)) {
      this.doc.select([d.target], { add: true });
    }
    d.pending = null;
    const sc = this.sceneData();
    const nodes = this.editable();
    const items = [];
    for (const n of nodes) {
      const en = sc.entries.get(n);
      if (!en) continue;
      if (en.isUI) {
        if (kind === 'move' && this.get(n, 'anchor') !== 'full') items.push({ node: n, entry: en, ui: true, rect0: [...en.rect] });
      } else if (en.m) {
        items.push({
          node: n, entry: en, pinv: invert(en.pm) || IDENTITY, g0: [en.m[4], en.m[5]],
          x0: num(this.get(n, 'x')), y0: num(this.get(n, 'y')), rot0: num(this.get(n, 'rotation')),
          sx0: num(this.get(n, 'scaleX'), 1), sy0: num(this.get(n, 'scaleY'), 1),
          flip: Math.sign(en.pm[0] * en.pm[3] - en.pm[1] * en.pm[2]) || 1,
        });
      }
    }
    if (!items.length) {
      this.drag = null;
      return;
    }
    const primary = items.find((it) => it.node === d.target) || items[0];
    const label = { move: 'Move', rotate: 'Rotate', scale: 'Scale' }[kind];
    const next = { kind, items, primary, start: d.start, startS: d.startS, cur: d.start, moved: true, gesture: new Gesture(this.doc, items.length > 1 ? `${label} ${items.length} nodes` : `${label} ${primary.node.name}`) };
    if (kind === 'rotate' && !primary.ui) {
      next.items = items.filter((it) => !it.ui);
      next.pivot = primary.g0;
      next.a0 = Math.atan2(d.start[1] - primary.g0[1], d.start[0] - primary.g0[0]);
      next.shown = 0;
    } else if (kind === 'rotate') {
      this.drag = null;
      return;
    }
    if (kind === 'scale') {
      next.items = items.filter((it) => !it.ui);
      if (!next.items.length) {
        this.drag = null;
        return;
      }
      const p = next.items.includes(primary) ? primary : next.items[0];
      next.primary = p;
      next.frameInv = invert(mul(p.entry.pm, trs(p.x0, p.y0, p.rot0, 1, 1))) || IDENTITY;
      next.q0 = apply(next.frameInv, d.start[0], d.start[1]);
      next.free = true;
    }
    this.drag = next;
  }

  beginHandleDrag(h, world, e) {
    const n = h.entry.node;
    const en = h.entry;
    if (h.kind === 'rotate') {
      this.drag = { kind: 'pending', next: 'rotate', target: n, start: world, startS: [h.sx, h.sy], moved: false };
      this.beginEditDrag(this.drag, e);
      if (this.drag) this.drag.moved = true;
      return;
    }
    if (h.kind === 'resize' || h.kind === 'size') this.doc.select([n]);
    if (h.kind === 'point' || h.kind === 'midpoint') {
      this.doc.select([n]);
      const points = [...(this.get(n, 'points') || [])];
      let index = h.index;
      if (h.kind === 'midpoint') {
        // A new corner in the middle of the edge, which the drag then moves.
        const j = (index + 1) % (points.length / 2);
        points.splice(index * 2 + 2, 0, (points[index * 2] + points[j * 2]) / 2, (points[index * 2 + 1] + points[j * 2 + 1]) / 2);
        index += 1;
      }
      this.drag = {
        kind: 'point', entry: en, inv: invert(en.m) || IDENTITY, index, points, closed: h.closed, start: world, startS: [h.sx, h.sy],
        moved: true, gesture: new Gesture(this.doc, `Move a corner of ${n.name}`),
      };
      if (h.kind === 'midpoint') this.drag.gesture.set([[n, { points: [...points] }]]);
      return;
    }
    const gesture = h.kind === 'scale' ? null : new Gesture(this.doc, `Resize ${n.name}`);
    if (h.kind === 'resize') {
      this.drag = { kind: 'resize', h, entry: en, rect0: [...en.rect], start: world, startS: [h.sx, h.sy], moved: true, gesture };
      return;
    }
    if (h.kind === 'size') {
      const inv = invert(en.m) || IDENTITY;
      const q = apply(inv, world[0], world[1]);
      this.drag = {
        kind: 'size', h, entry: en, inv, offset: [h.lx - q[0], h.ly - q[1]], start: world, startS: [h.sx, h.sy], moved: true, gesture,
        w0: num(this.get(n, 'width')), h0: num(this.get(n, 'height')), r0: num(this.get(n, 'radius')),
      };
      return;
    }
    // Scale handle: scales the selection by the handle's movement in the primary's frame.
    this.drag = { kind: 'pending', next: 'scale', target: n, start: world, startS: [h.sx, h.sy], moved: false };
    this.beginEditDrag(this.drag, e);
    const d = this.drag;
    if (!d) return;
    d.moved = true;
    d.free = false;
    d.handle = h;
    const p = d.primary;
    // The handle's point in the primary's unscaled frame, and the press's offset from it.
    d.q0 = [h.lx * p.sx0, h.ly * p.sy0];
    const q = apply(d.frameInv, world[0], world[1]);
    d.offset = [d.q0[0] - q[0], d.q0[1] - q[1]];
  }

  updateMove(d, world, e) {
    let dx = world[0] - d.start[0];
    let dy = world[1] - d.start[1];
    const snap = this.snapOn(e);
    const p = d.primary;
    const base = p.ui ? [p.rect0[0], p.rect0[1]] : p.g0;
    if (snap) {
      const [tx, ty] = this.snapPoint(base[0] + dx, base[1] + dy);
      dx = tx - base[0];
      dy = ty - base[1];
    }
    if (e.shiftKey) {
      // Shift: along one axis.
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const step = snap ? 0.001 : this.precision;
    const entries = d.items.map((it) => {
      if (it.ui) {
        const o = this.offsetsFor(it.entry, [it.rect0[0] + dx, it.rect0[1] + dy, it.rect0[2], it.rect0[3]]);
        return [it.node, { x: roundTo(o.x, step), y: roundTo(o.y, step) }];
      }
      const [lx, ly] = apply(it.pinv, it.g0[0] + dx, it.g0[1] + dy);
      return [it.node, { x: roundTo(lx, step), y: roundTo(ly, step) }];
    });
    d.gesture.set(entries);
  }

  updateRotate(d, world, e) {
    const a = Math.atan2(world[1] - d.pivot[1], world[0] - d.pivot[0]);
    let delta = a - d.a0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // Keep turning past half a circle.
    if (d.lastDelta !== undefined) {
      while (delta - d.lastDelta > Math.PI) delta -= Math.PI * 2;
      while (delta - d.lastDelta < -Math.PI) delta += Math.PI * 2;
    }
    d.lastDelta = delta;
    const p = d.primary;
    let rot = p.rot0 + delta * p.flip;
    const step = num(Number(this.settings.angleSnap), 0) > 0 ? (Number(this.settings.angleSnap) * Math.PI) / 180 : ROTATE_SNAP;
    if (this.snapOn(e) || e.shiftKey) rot = Math.round(rot / step) * step;
    const applied = (rot - p.rot0) * p.flip;
    d.shown = rot;
    d.gesture.set(d.items.map((it) => [it.node, { rotation: roundTo(it.rot0 + applied * it.flip, 1e-6) }]));
  }

  updateScale(d, world, e) {
    const p = d.primary;
    const q = apply(d.frameInv, world[0], world[1]);
    let kx = 1;
    let ky = 1;
    if (d.free) {
      // Dragging the body: uniform, by the distance from the pivot.
      const l0 = Math.hypot(d.q0[0], d.q0[1]);
      if (l0 > 1e-6) kx = ky = Math.hypot(q[0], q[1]) / l0;
    } else {
      const h = d.handle;
      const qx = q[0] + d.offset[0];
      const qy = q[1] + d.offset[1];
      if (h.hx && Math.abs(d.q0[0]) > 1e-6) kx = qx / d.q0[0];
      if (h.hy && Math.abs(d.q0[1]) > 1e-6) ky = qy / d.q0[1];
      if (e.shiftKey) {
        if (h.hx && h.hy) {
          const k = (qx * d.q0[0] + qy * d.q0[1]) / (d.q0[0] ** 2 + d.q0[1] ** 2 || 1);
          kx = ky = k;
        } else if (h.hx) ky = kx;
        else kx = ky;
      }
    }
    const snap = this.snapOn(e);
    let sx = p.sx0 * kx;
    let sy = p.sy0 * ky;
    if (snap) {
      sx = roundTo(sx, SCALE_SNAP);
      sy = roundTo(sy, SCALE_SNAP);
    }
    const rx = p.sx0 ? sx / p.sx0 : 1;
    const ry = p.sy0 ? sy / p.sy0 : 1;
    d.gesture.set(d.items.map((it) => [it.node, { scaleX: roundTo(it.sx0 * rx, 1e-4), scaleY: roundTo(it.sy0 * ry, 1e-4) }]));
  }

  updateSize(d, world, e) {
    const n = d.entry.node;
    const h = d.h;
    const q = apply(d.inv, world[0], world[1]);
    const qx = q[0] + d.offset[0];
    const qy = q[1] + d.offset[1];
    const snap = this.snapOn(e);
    const step = snap ? this.grid : 1;
    const shape = this.get(n, 'shape');
    if (shape === 'circle') {
      const r = Math.max(0, roundTo(Math.hypot(qx, qy), snap ? this.grid / 2 : 1));
      d.gesture.set([[n, { radius: r }]]);
      return;
    }
    const centered = d.entry.kind === 'collision' || this.get(n, 'centered');
    let w = d.w0;
    let hh = d.h0;
    if (h.hx) w = Math.max(0, centered ? Math.abs(qx) * 2 : qx);
    if (h.hy) hh = Math.max(0, centered ? Math.abs(qy) * 2 : qy);
    if (e.shiftKey && d.w0 > 0 && d.h0 > 0) {
      const k = h.hx && h.hy ? Math.max(w / d.w0, hh / d.h0) : h.hx ? w / d.w0 : hh / d.h0;
      w = d.w0 * k;
      hh = d.h0 * k;
    }
    d.gesture.set([[n, { width: roundTo(w, step), height: roundTo(hh, step) }]]);
  }

  /** Moves one corner of a polygon or line to the pointer (whole pixels, or the grid when snapping). */
  updatePoint(d, world, e) {
    const q = apply(d.inv, world[0], world[1]);
    const step = this.snapOn(e) ? this.grid : 1;
    const points = [...d.points];
    points[d.index * 2] = roundTo(q[0], step);
    points[d.index * 2 + 1] = roundTo(q[1], step);
    d.gesture.set([[d.entry.node, { points }]]);
  }

  /**
   * A corner dropped onto the one before or after it is taken out (while a
   * polygon keeps 3 corners and a line 2).
   */
  finishPoint(d) {
    const n = d.entry.node;
    const p = this.get(n, 'points') || [];
    const count = Math.floor(p.length / 2);
    if (count <= (d.closed ? 3 : 2) || d.index >= count) return;
    const at = (i) => this.toScreen(...apply(d.entry.m, p[i * 2], p[i * 2 + 1]));
    const [sx, sy] = at(d.index);
    const near = [d.index - 1, d.index + 1]
      .filter((i) => d.closed || (i >= 0 && i < count))
      .map((i) => at((i + count) % count))
      .some(([x, y]) => Math.hypot(x - sx, y - sy) <= HANDLE_R + 1);
    if (!near) return;
    const points = [...p];
    points.splice(d.index * 2, 2);
    d.gesture.set([[n, { points }]]);
  }

  updateResize(d, world, e) {
    const h = d.h;
    const [x, y, w, hgt] = d.rect0;
    let left = x;
    let top = y;
    let right = x + w;
    let bottom = y + hgt;
    const dx = world[0] - d.start[0];
    const dy = world[1] - d.start[1];
    const snap = this.snapOn(e);
    const s = (v) => (snap ? Math.round(v / this.grid) * this.grid : Math.round(v));
    if (h.hx < 0) left = Math.min(s(x + dx), right);
    if (h.hx > 0) right = Math.max(s(x + w + dx), left);
    if (h.hy < 0) top = Math.min(s(y + dy), bottom);
    if (h.hy > 0) bottom = Math.max(s(y + hgt + dy), top);
    if (e.shiftKey && w > 0 && hgt > 0) {
      const k = h.hx && h.hy ? Math.max((right - left) / w, (bottom - top) / hgt) : h.hx ? (right - left) / w : (bottom - top) / hgt;
      const nw = w * k;
      const nh = hgt * k;
      if (h.hx < 0) left = right - nw;
      else if (h.hx > 0) right = left + nw;
      else {
        left = x + (w - nw) / 2;
        right = left + nw;
      }
      if (h.hy < 0) top = bottom - nh;
      else if (h.hy > 0) bottom = top + nh;
      else {
        top = y + (hgt - nh) / 2;
        bottom = top + nh;
      }
    }
    const o = this.offsetsFor(d.entry, [left, top, right - left, bottom - top]);
    d.gesture.set([[d.entry.node, { x: roundTo(o.x, 0.01), y: roundTo(o.y, 0.01), width: roundTo(o.width, 0.01), height: roundTo(o.height, 0.01) }]]);
  }

  // -------------------------------------------------------------------------
  // Keys

  keyDown(e) {
    if (!this.doc || this.isTyping(e)) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (this.painter?.paintKey && !mod && this.painter.paintKey(e, this.tool === 'paint')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    let used = true;
    if ((e.ctrlKey || e.metaKey) && key === 'd') {
      const nodes = this.editable((n) => n !== this.doc.root);
      if (nodes.length) {
        const copies = this.doc.duplicate(nodes);
        if (copies?.length) this.doc.select(copies);
      }
    } else if (e.ctrlKey || e.metaKey || e.altKey) {
      used = false;
    } else if (key === 'q' || key === 'w' || key === 'e' || key === 'r') {
      // Tool keys also go on to the workspace, so its toolbar follows.
      this.setTool({ q: 'select', w: 'move', e: 'rotate', r: 'scale' }[key]);
      used = false;
    } else if (key === 'f') this.frameSelection();
    else if (key === 'Escape') {
      if (this.drag) this.cancelDrag();
      else if (this.doc.selection.size) this.doc.select([]);
      else used = false;
    } else if (key === 'Delete' || key === 'Backspace') {
      const nodes = this.editable((n) => n !== this.doc.root);
      if (nodes.length) this.doc.remove(nodes);
    } else if (key.startsWith('Arrow')) {
      const step = e.shiftKey ? this.grid : 1;
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key] || [0, 0];
      this.nudge(dx, dy);
    } else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  nudge(dx, dy) {
    const sc = this.sceneData();
    if (!sc) return;
    const entries = [];
    for (const n of this.editable()) {
      const en = sc.entries.get(n);
      if (!en) continue;
      if (en.isUI) {
        if (this.get(n, 'anchor') === 'full') continue;
        const o = this.offsetsFor(en, [en.rect[0] + dx, en.rect[1] + dy, en.rect[2], en.rect[3]]);
        entries.push([n, { x: roundTo(o.x, 0.001), y: roundTo(o.y, 0.001) }]);
      } else if (en.m) {
        const inv = invert(en.pm) || IDENTITY;
        const [lx, ly] = apply(inv, en.m[4] + dx, en.m[5] + dy);
        entries.push([n, { x: roundTo(lx, 0.001), y: roundTo(ly, 0.001) }]);
      }
    }
    if (!entries.length) return;
    const ids = entries.map(([n]) => n.id).join(',');
    setPropsMany(this.doc, entries, { merge: `nudge:${ids}`, label: entries.length > 1 ? `Move ${entries.length} nodes` : `Move ${entries[0][0].name}` });
  }

  // -------------------------------------------------------------------------
  // Drop files from the Files panel

  dragOver(e) {
    if (!this.doc || !e.dataTransfer || ![...e.dataTransfer.types].includes('application/x-smitten-path')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const [sx, sy] = this.eventPoint(e);
    let p = this.toWorld(sx, sy);
    if (this.snapOn(e)) p = this.snapPoint(p[0], p[1]);
    this.dropAt = p;
    this.redraw();
  }

  dropFile(e) {
    const path = e.dataTransfer?.getData('application/x-smitten-path');
    this.dropAt = null;
    if (!path || !this.doc) {
      this.redraw();
      return;
    }
    e.preventDefault();
    const [sx, sy] = this.eventPoint(e);
    let [wx, wy] = this.toWorld(sx, sy);
    if (this.snapOn(e)) [wx, wy] = this.snapPoint(wx, wy);
    else [wx, wy] = [roundTo(wx, this.precision), roundTo(wy, this.precision)];
    this.placeFile(path, wx, wy);
    this.root.focus({ preventScroll: true });
  }

  /** Adds a node for a project file at a world point and selects it. Returns the node or null. */
  placeFile(path, wx, wy) {
    const doc = this.doc;
    const ext = extOf(path);
    const base = path.split('/').pop().replace(/\.[^.]*$/, '') || 'Piece';
    const name = base.replace(/^\w/, (c) => c.toUpperCase());
    // Local coordinates under the root.
    const sc = this.sceneData();
    const rootEntry = sc?.entries.get(doc.root);
    const inv = rootEntry?.m ? invert(rootEntry.m) : IDENTITY;
    let [lx, ly] = apply(inv || IDENTITY, wx, wy);
    lx = roundTo(lx, 0.001);
    ly = roundTo(ly, 0.001);
    let node = null;
    if (IMAGE_MIME[ext] || ext === 'sprite') node = doc.createNode('Sprite', { image: path, x: lx, y: ly }, name);
    else if (ext === 'tileset') node = doc.createNode('Tiles', { tileset: path, x: lx, y: ly }, name);
    else if (FONT_EXT.has(ext)) node = doc.createNode('Text', { font: path, x: lx, y: ly }, name);
    else if (AUDIO_EXT.has(ext)) node = doc.createNode('Sound', { sound: path }, name);
    else if (ext === 'scene') {
      if (doc.wouldLoop?.(path)) {
        this.flash(`${path} contains this scene, so it can't be placed inside it.`);
        return null;
      }
      node = doc.createInstance(path);
      if (isA(node.type, 'Group')) node.props = { ...node.props, x: lx, y: ly };
    } else {
      this.flash(`A .${ext || 'file'} file can't be placed in the scene.`);
      return null;
    }
    try {
      doc.add(doc.root, node);
    } catch (err) {
      this.flash(err.message || String(err));
      return null;
    }
    doc.select([node]);
    return node;
  }

  flash(text) {
    this.flashEl.textContent = text;
    this.flashEl.hidden = false;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashEl.hidden = true;
    }, 3000);
  }

  // -------------------------------------------------------------------------
  // Tile painting (the TileMap panel decides what a click does)

  /** The TileMap being painted, if painting is on: {entry, ts}. */
  paintTarget() {
    if (this.tool !== 'paint' || !this.painter?.node || !this.doc) return null;
    const e = this.entryOf(this.painter.node);
    if (!e?.m) return null;
    const ts = this.assets.tileset(this.get(e.node, 'tileset'));
    if (!ts) return null;
    return { entry: e, ts };
  }

  paintActive() {
    return !!this.paintTarget();
  }

  /** Where a world point falls in the painted TileMap. */
  cellInfo(world) {
    const t = this.paintTarget();
    if (!t) return null;
    const inv = invert(t.entry.m);
    if (!inv) return null;
    const [lx, ly] = apply(inv, world[0], world[1]);
    return {
      cx: Math.floor(lx / t.ts.tileWidth), cy: Math.floor(ly / t.ts.tileHeight), lx, ly, wx: world[0], wy: world[1],
      tileWidth: t.ts.tileWidth, tileHeight: t.ts.tileHeight, visible: this.visibleCells(t.entry, t.ts.tileWidth, t.ts.tileHeight),
    };
  }

  drawPaintOverlay(g) {
    const t = this.paintTarget();
    if (!t) return;
    const { entry, ts } = t;
    const tw = ts.tileWidth;
    const th = ts.tileHeight;
    const disp = this.displayInfo();
    // The map's cell grid around the view.
    const scale = Math.sqrt(Math.abs(entry.m[0] * entry.m[3] - entry.m[1] * entry.m[2])) * this.view.zoom || 1;
    if (Math.min(tw, th) * scale >= 6) {
      const r = this.visibleCells(entry, tw, th);
      if ((r.x1 - r.x0) * (r.y1 - r.y0) < 40000) {
        this.setWorld(g, entry.m);
        g.beginPath();
        for (let x = r.x0; x <= r.x1; x++) {
          g.moveTo(x * tw, r.y0 * th);
          g.lineTo(x * tw, r.y1 * th);
        }
        for (let y = r.y0; y <= r.y1; y++) {
          g.moveTo(r.x0 * tw, y * th);
          g.lineTo(r.x1 * tw, y * th);
        }
        g.lineWidth = 1 / scale;
        g.strokeStyle = rgba(disp.ink, 0.12);
        g.stroke();
      }
    }
    const api = {
      tileset: ts,
      colors: { accent: rgba(this.colors.accent), danger: rgba(this.colors.danger), dangerFill: rgba(this.colors.danger, 0.25), ink: rgba(disp.ink, 0.8) },
      tile: (cx, cy, tile, alpha = 0.6) => {
        if (!(tile >= 0) || tile >= ts.count || ts.img?.status !== 'ready') return;
        this.setWorld(g, entry.m);
        g.globalAlpha = alpha;
        g.drawImage(ts.img.bitmap, (tile % ts.columns) * tw, Math.floor(tile / ts.columns) * th, tw, th, cx * tw, cy * th, tw, th);
        g.globalAlpha = 1;
      },
      fill: (x0, y0, x1, y1, color) => {
        this.setWorld(g, entry.m);
        g.fillStyle = color;
        g.fillRect(Math.min(x0, x1) * tw, Math.min(y0, y1) * th, (Math.abs(x1 - x0) + 1) * tw, (Math.abs(y1 - y0) + 1) * th);
      },
      outline: (x0, y0, x1, y1, color = api.colors.accent) => {
        const pts = [
          [Math.min(x0, x1) * tw, Math.min(y0, y1) * th], [(Math.max(x0, x1) + 1) * tw, Math.min(y0, y1) * th],
          [(Math.max(x0, x1) + 1) * tw, (Math.max(y0, y1) + 1) * th], [Math.min(x0, x1) * tw, (Math.max(y0, y1) + 1) * th],
        ].map(([x, y]) => this.toScreen(...apply(entry.m, x, y)));
        this.setScreen(g);
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.lineWidth = 3;
        g.strokeStyle = rgba(disp.halo, 0.5);
        g.stroke();
        g.lineWidth = 1.5;
        g.strokeStyle = color;
        g.stroke();
      },
    };
    g.save();
    try {
      this.painter.paintOverlay?.(api);
    } finally {
      g.restore();
    }
  }

  // -------------------------------------------------------------------------

  emitStatus(world) {
    const pct = Math.round(this.view.zoom * 100);
    let text = `${pct}%`;
    if (world) {
      text = `x ${Math.round(world[0])}, y ${Math.round(world[1])} · ${pct}%`;
      const info = this.paintActive() ? this.cellInfo(world) : null;
      if (info) text = `x ${Math.round(world[0])}, y ${Math.round(world[1])} · cell ${info.cx}, ${info.cy} · ${pct}%`;
    }
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.container.dispatchEvent(new CustomEvent('viewport-status', { bubbles: true, detail: { text } }));
  }
}

function* cellsInRange(list, r) {
  for (const c of list) {
    if (c[0] < r.x0 || c[0] > r.x1 || c[1] < r.y0 || c[1] > r.y1) continue;
    yield c;
  }
}

// ---------------------------------------------------------------------------
// Gizmo icons, drawn in screen space around (x, y)

function drawIcon(g, icon, x, y, color, halo) {
  g.save();
  g.translate(Math.round(x) + 0.5, Math.round(y) + 0.5);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const path = () => {
    g.beginPath();
    switch (icon) {
      case 'area':
        g.rect(-6, -6, 12, 12);
        break;
      case 'character':
        roundRectPath(g, -4.5, -7, 9, 14, 4.5);
        break;
      case 'static':
        g.rect(-6, -6, 12, 12);
        g.moveTo(-6, 2);
        g.lineTo(2, -6);
        g.moveTo(-2, 6);
        g.lineTo(6, -2);
        break;
      case 'rigid':
        g.arc(0, 0, 6.5, 0, Math.PI * 2);
        g.moveTo(2, 0);
        g.arc(0, 0, 2, 0, Math.PI * 2);
        break;
      case 'joint':
        g.arc(-4, 0, 3, 0, Math.PI * 2);
        g.moveTo(7, 0);
        g.arc(4, 0, 3, 0, Math.PI * 2);
        g.moveTo(-1, 0);
        g.lineTo(1, 0);
        break;
      case 'particles':
        g.arc(0, 4, 1.8, 0, Math.PI * 2);
        g.moveTo(-3, -3);
        g.arc(-4, -3, 1.4, 0, Math.PI * 2);
        g.moveTo(1.4, -6);
        g.arc(0, -6, 1.4, 0, Math.PI * 2);
        g.moveTo(5.4, -3);
        g.arc(4, -3, 1.4, 0, Math.PI * 2);
        break;
      case 'light':
        g.arc(0, 0, 3, 0, Math.PI * 2);
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          g.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
          g.lineTo(Math.cos(a) * 7.5, Math.sin(a) * 7.5);
        }
        break;
      case 'occluder':
        g.rect(-6, -6, 12, 12);
        g.moveTo(-6, 6);
        g.lineTo(6, -6);
        break;
      case 'background':
        g.moveTo(-7.5, 6);
        g.lineTo(-2.5, -6);
        g.lineTo(0.5, 0);
        g.lineTo(3.5, -3);
        g.lineTo(7.5, 6);
        g.closePath();
        break;
      case 'camera':
        g.rect(-7, -4, 10, 8);
        g.moveTo(3, -1);
        g.lineTo(7, -4);
        g.lineTo(7, 4);
        g.lineTo(3, 1);
        break;
      case 'sprite':
        g.rect(-6, -6, 12, 12);
        g.moveTo(-6, 4);
        g.lineTo(-1, -1);
        g.lineTo(3, 3);
        g.moveTo(1, 1);
        g.lineTo(3, -1);
        g.lineTo(6, 2);
        break;
      case 'tilemap':
        g.rect(-6, -6, 12, 12);
        g.moveTo(0, -6);
        g.lineTo(0, 6);
        g.moveTo(-6, 0);
        g.lineTo(6, 0);
        break;
      case 'text':
        g.moveTo(-5, -6);
        g.lineTo(5, -6);
        g.moveTo(0, -6);
        g.lineTo(0, 6);
        break;
      default: // marker
        g.moveTo(-6, 0);
        g.lineTo(6, 0);
        g.moveTo(0, -6);
        g.lineTo(0, 6);
    }
  };
  path();
  g.lineWidth = 3.5;
  g.strokeStyle = halo;
  if (icon === 'area') g.setLineDash([3, 2]);
  g.stroke();
  g.lineWidth = 1.5;
  g.strokeStyle = color;
  g.stroke();
  g.restore();
}
