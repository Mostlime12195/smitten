// The image being edited: layers of frames as straight RGBA buffers plus the
// .sprite fields (frame size, origin, animations, layers; docs/formats.md,
// "Sprites"), and reading and writing those files. A plain image is one frame
// on one layer and needs no .sprite file. Older projects named the file
// .sprite.json; it is still read, and saving writes .sprite.
//
// The game reads only the PNG: with more than one layer, the PNG is the
// layers flattened, and the .sprite file keeps each layer as a PNG of its
// own (a data: URL) for the editor.

import { decodePNG, encodePNG } from './png.js';
import { stamp, resample } from './draw.js';
import { newLayer, isPlain, flatten, sameImage, freeLayerName } from './layers.js';

export const FORMAT_VERSION = 1;
export const DEFAULT_FPS = 8;
export const META_EXT = '.sprite';
export const LEGACY_META_EXT = '.sprite.json';
// Sheets wider than this wrap onto more rows (GPUs limit texture sizes).
const MAX_SHEET_WIDTH = 8192;

/** sprites/hero.png -> sprites/hero; also for .sprite and .sprite.json. */
export function stemOf(path) {
  return path.replace(/\.sprite(\.json)?$/i, '').replace(/\.png$/i, '');
}

export function isMetaPath(path) {
  return /\.sprite(\.json)?$/i.test(path);
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
    // Bottom layer first; each has one Uint8ClampedArray(fw * fh * 4) per frame.
    this.layers = [newLayer('Layer 1', frames)];
    this.flat = null; // the flattened frames, when there is more than the one plain layer
    this.flatDirty = true;
    this.flatVersion = 0; // goes up each time all flattened frames are made again
    this.origin = null; // [x, y] or null
    this.animations = []; // [{name, frames: [], fps, loop, extra: {}}]
    this.meta = {}; // the .sprite file as read (unknown fields are kept)
    this.columns = 0; // sheet layout from the file (kept when saving if it still fits)
    this.rows = 0;
  }

  static blank(fw, fh, count = 1) {
    const frames = [];
    for (let i = 0; i < count; i++) frames.push(new Uint8ClampedArray(fw * fh * 4));
    return new SpriteDoc(fw, fh, frames);
  }

  get count() { return this.layers[0].cels.length; }

  /**
   * The frames as the game draws them. With one plain layer these are that
   * layer's buffers; else the flattened copies (made again after changed()).
   */
  get frames() {
    if (isPlain(this.layers)) return this.layers[0].cels;
    if (this.flatDirty || !this.flat) this.flattenAll();
    return this.flat;
  }

  /** True if the image has more than one plain layer (saving then keeps the layers). */
  get layered() { return !isPlain(this.layers); }

  /** Call after a change to the layers or the frames (not to pixels: see reflatten). */
  changed() { this.flatDirty = true; }

  flattenAll() {
    const { fw, fh } = this;
    const n = this.count, size = fw * fh * 4;
    const old = this.flat;
    const reuse = old && old.length === n && old.every((f) => f.length === size);
    this.flat = Array.from({ length: n }, (_, i) => flatten(reuse ? old[i] : new Uint8ClampedArray(size), this.layers, i, fw, fh));
    this.flatDirty = false;
    this.flatVersion++;
  }

  /** Flatten one frame again over box (all of it if null), after its pixels changed. */
  reflatten(frame, box = null) {
    if (isPlain(this.layers)) return;
    if (this.flatDirty || !this.flat) { this.flattenAll(); return; }
    flatten(this.flat[frame], this.layers, frame, this.fw, this.fh, box);
  }

  /** The buffer of one layer in one frame. */
  cel(layer, frame) { return this.layers[layer].cels[frame]; }

  blankFrame() { return new Uint8ClampedArray(this.fw * this.fh * 4); }

  // Layers. Indexes count from the bottom layer.

  addLayer(index, name = freeLayerName(this.layers)) {
    const layer = newLayer(name, this.layers[0].cels.map(() => this.blankFrame()));
    this.layers.splice(index, 0, layer);
    this.changed();
    return layer;
  }

  duplicateLayer(index) {
    const src = this.layers[index];
    const copy = newLayer(freeLayerName(this.layers, src.name.replace(/ \d+$/, '')), src.cels.map((c) => c.slice()),
      { opacity: src.opacity, hidden: src.hidden, extra: { ...src.extra } });
    this.layers.splice(index + 1, 0, copy);
    this.changed();
  }

  deleteLayer(index) {
    if (this.layers.length <= 1) return;
    this.layers.splice(index, 1);
    this.changed();
  }

  moveLayer(from, to) {
    if (from === to) return;
    this.layers.splice(to, 0, ...this.layers.splice(from, 1));
    this.changed();
  }

  /** Put a layer onto the layer below it (both as if shown), as one layer at full opacity. */
  mergeDown(index) {
    if (index < 1) return;
    const below = this.layers[index - 1], above = this.layers[index];
    const pair = [{ ...below, hidden: false }, { ...above, hidden: false }];
    below.cels = below.cels.map((_, f) => flatten(this.blankFrame(), pair, f, this.fw, this.fh));
    below.opacity = 1;
    below.hidden = false;
    this.layers.splice(index, 1);
    this.changed();
  }

  /** All layers flattened into one plain layer. */
  flattenLayers() {
    if (!this.layered) return;
    const cels = this.frames.map((f) => f.slice());
    this.layers = [newLayer(this.layers[0].name, cels)];
    this.changed();
  }

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
    const columns = keep ? this.columns : Math.max(1, Math.min(n, Math.floor(MAX_SHEET_WIDTH / this.fw)));
    return { columns, rows: Math.ceil(n / columns) };
  }

  /** The whole sheet as one RGBA image (the flattened frames, or the frames given). */
  toSheet(layout = this.layout(), frames = this.frames) {
    const { columns, rows } = layout;
    const width = columns * this.fw;
    const height = rows * this.fh;
    const data = new Uint8ClampedArray(width * height * 4);
    frames.forEach((f, i) => {
      const c = i % columns, r = Math.floor(i / columns);
      for (let y = 0; y < this.fh; y++) {
        data.set(f.subarray(y * this.fw * 4, (y + 1) * this.fw * 4), ((r * this.fh + y) * width + c * this.fw) * 4);
      }
    });
    return { data, width, height };
  }

  /** Whether the image needs a .sprite file (more than one frame, an origin, animations or layers). */
  needsMeta() {
    return this.count > 1 || !!this.origin || this.animations.length > 0 || this.layered;
  }

  /**
   * The .sprite file's text, keeping fields this editor doesn't know.
   * layerImages: one PNG data: URL per layer (encodeSprite makes them), or
   * null for an image without layers.
   */
  metaText(metaPath, pngPath, layerImages = null) {
    const known = ['format', 'version', 'image', 'frameWidth', 'frameHeight', 'origin', 'animations', 'layers'];
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
        // fps and loop that a file left out stay out while they keep their defaults.
        const entry = { frames: [...a.frames] };
        if (!a.omit?.fps || a.fps !== DEFAULT_FPS) entry.fps = a.fps;
        if (!a.omit?.loop || a.loop !== true) entry.loop = a.loop;
        out.animations[a.name] = { ...entry, ...a.extra };
      }
    }
    if (layerImages && this.layered) {
      out.layers = this.layers.map((l, i) => {
        const entry = { name: l.name };
        if (l.opacity < 1) entry.opacity = Math.round(l.opacity * 1000) / 1000;
        if (l.hidden) entry.hidden = true;
        return { ...entry, ...l.extra, image: layerImages[i] };
      });
    }
    for (const [k, v] of Object.entries(this.meta)) if (!known.includes(k)) out[k] = v;
    return `${stringify(out)}\n`;
  }

  /** Copy of the parts undo restores (frame buffers are shared, not copied). */
  snapshot() {
    return {
      fw: this.fw,
      fh: this.fh,
      layers: this.layers.map((l) => ({ ...l, cels: l.cels.slice(), extra: { ...l.extra } })),
      origin: this.origin ? [...this.origin] : null,
      animations: this.animations.map((a) => ({ ...a, frames: [...a.frames], extra: { ...a.extra } })),
      columns: this.columns,
      rows: this.rows,
    };
  }

  restore(s) {
    this.fw = s.fw;
    this.fh = s.fh;
    this.layers = s.layers.map((l) => ({ ...l, cels: l.cels.slice(), extra: { ...l.extra } }));
    this.changed();
    this.origin = s.origin ? [...s.origin] : null;
    this.animations = s.animations.map((a) => ({ ...a, frames: [...a.frames], extra: { ...a.extra } }));
    this.columns = s.columns;
    this.rows = s.rows;
  }

  /** Change the frame size, keeping the pixels where they are, moved by (dx, dy). */
  resizeCanvas(w, h, dx, dy) {
    const { fw, fh } = this;
    for (const l of this.layers) {
      l.cels = l.cels.map((f) => {
        const out = new Uint8ClampedArray(w * h * 4);
        stamp(out, w, h, f, dx, dy, fw, fh);
        return out;
      });
    }
    this.fw = w;
    this.fh = h;
    this.changed();
    if (this.origin) this.origin = [this.origin[0] + dx, this.origin[1] + dy];
  }

  /** Scale every frame to w×h, smoothly or by nearest pixel. */
  scale(w, h, smooth) {
    const { fw, fh } = this;
    for (const l of this.layers) l.cels = l.cels.map((f) => resample(f, fw, fh, w, h, smooth));
    this.fw = w;
    this.fh = h;
    this.changed();
    if (this.origin) this.origin = [Math.round((this.origin[0] * w) / fw), Math.round((this.origin[1] * h) / fh)];
  }

  /**
   * Cut every layer into frames of w×h again (the frames of each layer laid
   * out as a sheet first). Animation frames past the end are dropped.
   */
  split(w, h) {
    const layout = this.layout();
    let next = null;
    for (const l of this.layers) {
      const sheet = this.toSheet(layout, l.cels);
      next = SpriteDoc.fromSheet(sheet.data, sheet.width, sheet.height, w, h);
      l.cels = next.frames;
    }
    this.fw = w;
    this.fh = h;
    this.columns = next.columns;
    this.rows = next.rows;
    for (const a of this.animations) a.frames = a.frames.filter((f) => f < this.count);
    if (this.origin) this.origin = [Math.min(this.origin[0], w), Math.min(this.origin[1], h)];
    this.changed();
  }

  // Frame operations keep animation frame numbers pointing at the same frames.

  /** Insert a frame at index: cels has one buffer per layer (blank ones if not given). */
  insertFrame(index, cels = null) {
    this.layers.forEach((l, i) => l.cels.splice(index, 0, cels?.[i] || this.blankFrame()));
    for (const a of this.animations) a.frames = a.frames.map((f) => (f >= index ? f + 1 : f));
    this.changed();
  }

  /** The buffers of one frame, one per layer, copied. */
  copyFrame(index) {
    return this.layers.map((l) => l.cels[index].slice());
  }

  deleteFrame(index) {
    for (const l of this.layers) l.cels.splice(index, 1);
    for (const a of this.animations) a.frames = a.frames.filter((f) => f !== index).map((f) => (f > index ? f - 1 : f));
    this.changed();
  }

  moveFrame(from, to) {
    if (from === to) return;
    const order = this.layers[0].cels.map((_, i) => i);
    order.splice(to, 0, ...order.splice(from, 1));
    const newIndex = new Map(order.map((old, i) => [old, i]));
    for (const l of this.layers) l.cels = order.map((old) => l.cels[old]);
    for (const a of this.animations) a.frames = a.frames.map((f) => newIndex.get(f) ?? f);
    this.changed();
  }

  /**
   * Frames from a sprite sheet (sheet.js), for one layer. With replace, they
   * become all of the image: its frame size, one layer, no animations. Else
   * they go after the last frame (on the given layer; the other layers get
   * empty frames there). Returns the numbers of the new frames.
   */
  importFrames(frames, fw, fh, { replace = false, layer = 0 } = {}) {
    if (replace) {
      this.fw = fw;
      this.fh = fh;
      this.layers = [newLayer(this.layers[0]?.name || 'Layer 1', frames)];
      this.animations = [];
      this.columns = 0;
      this.rows = 0;
      if (this.origin) this.origin = [Math.min(this.origin[0], fw), Math.min(this.origin[1], fh)];
      this.changed();
      return frames.map((_, i) => i);
    }
    if (fw !== this.fw || fh !== this.fh) throw new Error(`the frames are ${fw}×${fh}, and this image has frames of ${this.fw}×${this.fh}`);
    const start = this.count;
    frames.forEach((f, k) => {
      this.layers.forEach((l, i) => l.cels.push(i === layer ? f : this.blankFrame()));
      return k;
    });
    this.changed();
    return frames.map((_, k) => start + k);
  }

  /** True if the image is one frame on one plain layer, with nothing drawn. */
  isBlank() {
    if (this.count !== 1 || this.layered) return false;
    const f = this.layers[0].cels[0];
    for (let i = 3; i < f.length; i += 4) if (f[i]) return false;
    return true;
  }
}

/**
 * A .sprite file's text without its layers (the game draws only the PNG):
 * for a game that nobody edits, such as a web export. Text without layers,
 * or that is not JSON, is returned as it is.
 */
export function withoutLayers(text) {
  if (typeof text !== 'string' || !text.includes('"layers"')) return text;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !('layers' in data)) return text;
    delete data.layers;
    return `${stringify(data)}\n`;
  } catch {
    return text;
  }
}

/** True if two snapshots (SpriteDoc.snapshot) are the same image. */
export function sameSnapshot(a, b) {
  if (a.fw !== b.fw || a.fh !== b.fh || a.columns !== b.columns || a.layers.length !== b.layers.length) return false;
  for (let i = 0; i < a.layers.length; i++) {
    const p = a.layers[i], q = b.layers[i];
    if (p.name !== q.name || p.opacity !== q.opacity || p.hidden !== q.hidden || p.cels.length !== q.cels.length) return false;
    if (!p.cels.every((c, k) => c === q.cels[k])) return false;
  }
  return JSON.stringify([a.origin, a.animations]) === JSON.stringify([b.origin, b.animations]);
}

// Layer images are PNGs inside the .sprite file, as data: URLs.
const DATA_URL = 'data:image/png;base64,';

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
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
 * Which files a path stands for. Opening the image or its .sprite edits
 * both. Returns {pngPath, metaPath, legacyPath, readPath}: metaPath is the
 * .sprite saving writes, legacyPath the old .sprite.json name, and readPath
 * the one to read (.sprite if it exists, else .sprite.json if it exists).
 */
export function spritePaths(host, path) {
  const stem = stemOf(path);
  const metaPath = `${stem}${META_EXT}`;
  const legacyPath = `${stem}${LEGACY_META_EXT}`;
  // The .sprite wins over an old .sprite.json next to it (saving wrote it).
  let readPath = metaPath;
  if (!host.exists(metaPath) && (path === legacyPath || host.exists(legacyPath))) readPath = legacyPath;
  let pngPath = isMetaPath(path) ? `${stem}.png` : path;
  if (isMetaPath(path)) {
    const text = host.read(readPath);
    if (typeof text === 'string') {
      try {
        const m = JSON.parse(text);
        if (m && typeof m.image === 'string' && m.image) pngPath = joinPath(readPath, m.image);
      } catch { /* reported by loadSprite */ }
    }
  }
  return { pngPath, metaPath, legacyPath, readPath };
}

/**
 * Read an image and its .sprite file (metaPath; may not exist). Returns
 * {doc, warnings}. Throws if the .sprite is from a newer version or isn't a
 * sprite file.
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

  let fw = meta && isSize(meta.frameWidth) ? meta.frameWidth : image ? image.width : 256;
  let fh = meta && isSize(meta.frameHeight) ? meta.frameHeight : image ? image.height : 256;
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
          omit: { fps: fps === undefined, loop: loop === undefined },
          extra,
        });
      }
    }
    if (Array.isArray(meta.layers) && meta.layers.length && image) {
      await loadLayers(doc, meta.layers, image, metaPath, pngPath, warnings);
    }
  }
  return { doc, warnings };
}

/**
 * The layers of a .sprite file ("layers": [{name, opacity, hidden, image}],
 * bottom first; each image is a data: URL of a PNG the size of the main
 * image). If the main image is not what the layers make (an older editor or
 * another program changed it), the main image becomes a new top layer and
 * the older layers are hidden, so nothing is lost and the image looks as
 * the game shows it.
 */
async function loadLayers(doc, entries, image, metaPath, pngPath, warnings) {
  const { fw, fh } = doc;
  const layers = [];
  for (const [i, entry] of entries.entries()) {
    const name = typeof entry?.name === 'string' && entry.name ? entry.name : `Layer ${i + 1}`;
    const src = typeof entry?.image === 'string' && entry.image.startsWith(DATA_URL) ? entry.image.slice(DATA_URL.length) : null;
    let img = null;
    try {
      if (src) img = await decodePNG(fromBase64(src));
    } catch { img = null; }
    if (!img || img.width !== image.width || img.height !== image.height) {
      warnings.push(`${metaPath}: the layer "${name}" could not be read (it must be a PNG of ${image.width}×${image.height}). The editor shows the image as one layer.`);
      return;
    }
    const { name: _n, opacity, hidden, image: _i, ...extra } = entry;
    layers.push(newLayer(name, SpriteDoc.fromSheet(img.data, img.width, img.height, fw, fh).frames, {
      opacity: typeof opacity === 'number' ? Math.min(1, Math.max(0, opacity)) : 1,
      hidden: hidden === true,
      extra,
    }));
  }
  const imageFrames = doc.layers[0].cels;
  doc.layers = layers;
  doc.changed();
  const flat = doc.frames;
  if (flat.every((f, i) => sameImage(f, imageFrames[i]))) return;
  for (const l of doc.layers) l.hidden = true;
  doc.layers.push(newLayer(freeLayerName(doc.layers, 'Changed outside'), imageFrames));
  doc.changed();
  warnings.push(`${pngPath} is not the same as its layers: a different program changed it. Its pixels are now the top layer, and the other layers are hidden.`);
}

/**
 * Encode the image's files: {png: Uint8Array, json: string | null} (json is
 * the .sprite file, if needed). It reads all pixels before its first await,
 * so the image can change again as soon as it returns its promise.
 */
export async function encodeSprite(doc, pngPath, metaPath, metaExists) {
  const layout = doc.layout();
  const sheet = doc.toSheet(layout);
  const layerSheets = doc.layered ? doc.layers.map((l) => doc.toSheet(layout, l.cels)) : null;
  // The .sprite text as the image is now; the layer images go in after they are encoded.
  const mark = (i) => `@@layer-image-${i}@@`;
  const needs = doc.needsMeta() || metaExists;
  let json = needs ? doc.metaText(metaPath, pngPath, layerSheets ? layerSheets.map((_, i) => mark(i)) : null) : null;
  const png = await encodePNG(sheet.data, sheet.width, sheet.height);
  if (layerSheets && json !== null) {
    for (const [i, ls] of layerSheets.entries()) {
      const url = DATA_URL + toBase64(await encodePNG(ls.data, ls.width, ls.height));
      json = json.replace(`"${mark(i)}"`, () => JSON.stringify(url));
    }
  }
  return { png, json };
}
