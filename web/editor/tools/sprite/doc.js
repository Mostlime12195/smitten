// The sprite being edited: frames as straight RGBA buffers plus the
// .sprite.json fields (docs/reference.md, "Sprites"), and reading and
// writing those files.

import { decodePNG, encodePNG } from './png.js';

export const FORMAT_VERSION = 1;
export const DEFAULT_FPS = 8;

/** sprites/hero.png -> sprites/hero; also for .sprite.json. */
export function stemOf(path) {
  return path.replace(/\.sprite\.json$/i, '').replace(/\.png$/i, '');
}

function folderOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

function baseName(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Resolve a path relative to the file it's written in. */
export function joinPath(fromFile, rel) {
  if (rel.startsWith('/')) return rel.slice(1);
  const parts = [];
  for (const p of (folderOf(fromFile) + rel).split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

/** Path of `to` relative to the folder of `fromFile`. */
function relativePath(fromFile, to) {
  const from = folderOf(fromFile).split('/').filter(Boolean);
  const target = to.split('/');
  let i = 0;
  while (i < from.length && i < target.length - 1 && from[i] === target[i]) i++;
  return [...from.slice(i).map(() => '..'), ...target.slice(i)].join('/');
}

export class SpriteDoc {
  constructor(fw, fh, frames) {
    this.fw = fw;
    this.fh = fh;
    this.frames = frames; // Uint8ClampedArray(fw * fh * 4) each
    this.origin = null; // [x, y] or null
    this.animations = []; // [{name, frames: [], fps, loop, extra: {}}]
    this.meta = {}; // the .sprite.json as read (unknown fields are kept)
    this.columns = 0; // sheet layout from the file (kept when saving if it still fits)
    this.rows = 0;
  }

  static blank(fw, fh, count = 1) {
    const frames = [];
    for (let i = 0; i < count; i++) frames.push(new Uint8ClampedArray(fw * fh * 4));
    return new SpriteDoc(fw, fh, frames);
  }

  get count() { return this.frames.length; }

  /** Cut an RGBA sheet into frames. Pads with transparency if the sheet isn't a multiple of the frame size. */
  static fromSheet(data, width, height, fw, fh) {
    const columns = Math.max(1, Math.ceil(width / fw));
    const rows = Math.max(1, Math.ceil(height / fh));
    const frames = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const f = new Uint8ClampedArray(fw * fh * 4);
        for (let y = 0; y < fh; y++) {
          const sy = r * fh + y;
          if (sy >= height) break;
          const sx = c * fw;
          const w = Math.min(fw, width - sx);
          if (w <= 0) continue;
          f.set(data.subarray((sy * width + sx) * 4, (sy * width + sx + w) * 4), y * fw * 4);
        }
        frames.push(f);
      }
    }
    const doc = new SpriteDoc(fw, fh, frames);
    doc.columns = columns;
    doc.rows = rows;
    return doc;
  }

  /**
   * Layout used when saving: the file's columns if it had several frames and
   * they still fit a whole number of rows, else one row.
   */
  layout() {
    const n = this.count;
    const keep = this.columns > 0 && this.columns * this.rows > 1 && n >= this.columns && n % this.columns === 0;
    const columns = keep ? this.columns : n;
    return { columns, rows: Math.ceil(n / columns) };
  }

  /** The whole sheet as one RGBA image. */
  toSheet(layout = this.layout()) {
    const { columns, rows } = layout;
    const width = columns * this.fw;
    const height = rows * this.fh;
    const data = new Uint8ClampedArray(width * height * 4);
    this.frames.forEach((f, i) => {
      const c = i % columns, r = Math.floor(i / columns);
      for (let y = 0; y < this.fh; y++) {
        data.set(f.subarray(y * this.fw * 4, (y + 1) * this.fw * 4), ((r * this.fh + y) * width + c * this.fw) * 4);
      }
    });
    return { data, width, height };
  }

  /** Whether the sprite needs a .sprite.json (more than one frame, an origin or animations). */
  needsMeta() {
    return this.count > 1 || !!this.origin || this.animations.length > 0;
  }

  /** The .sprite.json text, keeping fields this editor doesn't know. */
  metaText(metaPath, pngPath) {
    const known = ['format', 'version', 'image', 'frameWidth', 'frameHeight', 'origin', 'animations'];
    const out = {
      format: 'smitten.sprite',
      version: FORMAT_VERSION,
      image: relativePath(metaPath, pngPath),
      frameWidth: this.fw,
      frameHeight: this.fh,
    };
    if (this.origin) out.origin = [this.origin[0], this.origin[1]];
    if (this.animations.length) {
      out.animations = {};
      for (const a of this.animations) {
        out.animations[a.name] = { frames: [...a.frames], fps: a.fps, loop: a.loop, ...a.extra };
      }
    }
    for (const [k, v] of Object.entries(this.meta)) if (!known.includes(k)) out[k] = v;
    return `${stringify(out)}\n`;
  }

  /** Copy of the parts undo restores (frame buffers are shared, not copied). */
  snapshot() {
    return {
      fw: this.fw,
      fh: this.fh,
      frames: this.frames.slice(),
      origin: this.origin ? [...this.origin] : null,
      animations: this.animations.map((a) => ({ ...a, frames: [...a.frames], extra: { ...a.extra } })),
      columns: this.columns,
      rows: this.rows,
    };
  }

  restore(s) {
    this.fw = s.fw;
    this.fh = s.fh;
    this.frames = s.frames.slice();
    this.origin = s.origin ? [...s.origin] : null;
    this.animations = s.animations.map((a) => ({ ...a, frames: [...a.frames], extra: { ...a.extra } }));
    this.columns = s.columns;
    this.rows = s.rows;
  }

  // Frame operations keep animation frame numbers pointing at the same frames.

  insertFrame(index, data) {
    this.frames.splice(index, 0, data);
    for (const a of this.animations) a.frames = a.frames.map((f) => (f >= index ? f + 1 : f));
  }

  deleteFrame(index) {
    this.frames.splice(index, 1);
    for (const a of this.animations) a.frames = a.frames.filter((f) => f !== index).map((f) => (f > index ? f - 1 : f));
  }

  moveFrame(from, to) {
    if (from === to) return;
    const order = this.frames.map((_, i) => i);
    order.splice(to, 0, ...order.splice(from, 1));
    const newIndex = new Map(order.map((old, i) => [old, i]));
    this.frames = order.map((old) => this.frames[old]);
    for (const a of this.animations) a.frames = a.frames.map((f) => newIndex.get(f) ?? f);
  }
}

/** JSON with 2-space indents, but arrays of numbers on one line. */
export function stringify(value, indent = '') {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'number')) return `[${value.join(', ')}]`;
    if (!value.length) return '[]';
    const inner = `${indent}  `;
    return `[\n${value.map((v) => inner + stringify(v, inner)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (!keys.length) return '{}';
    const inner = `${indent}  `;
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${stringify(value[k], inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function isSize(n) { return Number.isInteger(n) && n > 0; }

/**
 * Which files a path stands for: {pngPath, metaPath}. Opening either file of
 * a sprite edits both.
 */
export function spritePaths(host, path) {
  if (/\.sprite\.json$/i.test(path)) {
    let image = `${baseName(stemOf(path))}.png`;
    const text = host.read(path);
    if (typeof text === 'string') {
      try {
        const m = JSON.parse(text);
        if (m && typeof m.image === 'string' && m.image) image = m.image;
      } catch { /* reported by loadSprite */ }
    }
    return { pngPath: joinPath(path, image), metaPath: path };
  }
  return { pngPath: path, metaPath: `${stemOf(path)}.sprite.json` };
}

/**
 * Read a sprite's files. Returns {doc, warnings}. Throws if the
 * .sprite.json is from a newer version or isn't a sprite file.
 */
export async function loadSprite(host, pngPath, metaPath) {
  const warnings = [];
  let meta = null;
  const text = host.read(metaPath);
  if (typeof text === 'string' && text.trim()) {
    try {
      meta = JSON.parse(text);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('expected a JSON object');
    } catch (e) {
      warnings.push(`${metaPath} couldn't be read (${e.message}); saving will replace it.`);
      meta = null;
    }
  }
  if (meta) {
    if (meta.format !== undefined && meta.format !== 'smitten.sprite') {
      throw new Error(`${metaPath} isn't a sprite file (its format is "${meta.format}")`);
    }
    if (typeof meta.version === 'number' && meta.version > FORMAT_VERSION) {
      throw new Error(`${metaPath} was made by a newer version of Smitten (sprite format ${meta.version}; this editor reads up to ${FORMAT_VERSION})`);
    }
  }

  let image = null;
  const bytes = host.read(pngPath);
  if (bytes instanceof Uint8Array && bytes.length) {
    image = await decodePNG(bytes);
  } else if (typeof bytes === 'string') {
    throw new Error(`${pngPath} isn't a PNG image`);
  }

  let fw = meta && isSize(meta.frameWidth) ? meta.frameWidth : image ? image.width : 16;
  let fh = meta && isSize(meta.frameHeight) ? meta.frameHeight : image ? image.height : 16;
  let doc;
  if (image) {
    if (fw > image.width || fh > image.height) {
      warnings.push(`${metaPath}: the frame size (${fw}×${fh}) is bigger than the image (${image.width}×${image.height}); using the image size.`);
      fw = Math.min(fw, image.width);
      fh = Math.min(fh, image.height);
    } else if (image.width % fw || image.height % fh) {
      warnings.push(`${pngPath} (${image.width}×${image.height}) isn't a whole number of ${fw}×${fh} frames; the last row and column are padded.`);
    }
    doc = SpriteDoc.fromSheet(image.data, image.width, image.height, fw, fh);
  } else {
    if (meta) warnings.push(`${pngPath} doesn't exist yet; saving creates it.`);
    doc = SpriteDoc.blank(fw, fh, 1);
  }

  if (meta) {
    doc.meta = meta;
    if (Array.isArray(meta.origin) && meta.origin.length >= 2 && meta.origin.every((n) => typeof n === 'number')) {
      doc.origin = [meta.origin[0], meta.origin[1]];
    }
    if (meta.animations && typeof meta.animations === 'object') {
      for (const [name, def] of Object.entries(meta.animations)) {
        if (!def || typeof def !== 'object') continue;
        const { frames, fps, loop, ...extra } = def;
        doc.animations.push({
          name,
          frames: Array.isArray(frames) ? frames.filter((f) => Number.isInteger(f) && f >= 0) : doc.frames.map((_, i) => i),
          fps: typeof fps === 'number' && fps >= 0 ? fps : DEFAULT_FPS,
          loop: loop === undefined ? true : !!loop,
          extra,
        });
      }
    }
  }
  return { doc, warnings };
}

/** Encode the sprite's files: {png: Uint8Array, json: string | null}. */
export async function encodeSprite(doc, pngPath, metaPath, metaExists) {
  const sheet = doc.toSheet();
  const png = await encodePNG(sheet.data, sheet.width, sheet.height);
  const json = doc.needsMeta() || metaExists ? doc.metaText(metaPath, pngPath) : null;
  return { png, json };
}
