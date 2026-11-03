// Scene, map and tileset files (docs/reference.md, "Tilesets" and "Maps";
// docs/objects-and-scenes.md, "Scenes"): paths, parsing with defaults,
// saving, and a tiny PNG encoder for new tilesets. A scene file is a map file
// with "format": "smitten.scene", so both go through parseMap/mapText.

export const MAP_FORMAT = 'smitten.map';
export const SCENE_FORMAT = 'smitten.scene';
export const TILESET_FORMAT = 'smitten.tileset';

export const isScenePath = (path) => /\.scene\.json$/i.test(path);

// ---------------------------------------------------------------------------
// Paths (project paths have no leading slash; folders end without one)

export function dirname(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Resolve `rel` against the folder of the file `base` ("maps/a.map.json" + "../tiles/t.json"). */
export function joinPath(base, rel) {
  if (rel.startsWith('/')) return rel.slice(1);
  const parts = [];
  for (const part of `${dirname(base)}/${rel}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/** The path of `target` relative to the folder of the file `from`. */
export function relativePath(from, target) {
  const a = dirname(from).split('/').filter(Boolean);
  const b = target.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** "tiles/terrain.tileset.json" -> "terrain" */
export function assetName(path) {
  return basename(path).replace(/\.(map|scene|tileset|sprite)\.json$/i, '').replace(/\.[^.]+$/, '');
}

// ---------------------------------------------------------------------------
// PNG

/** Width and height from a PNG's header, or null. */
export function pngSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A fully transparent PNG (1-bit indexed with a transparent palette entry),
 * encoded synchronously: newAssets' files() can't wait for canvas.toBlob.
 */
export function transparentPng(width, height) {
  const rowBytes = 1 + Math.ceil(width / 8);
  const raw = new Uint8Array(rowBytes * height); // filter 0, all pixels index 0
  // zlib stream with stored (uncompressed) deflate blocks.
  const blocks = [];
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const part = raw.subarray(i, i + 65535);
    const last = i + 65535 >= raw.length;
    const header = new Uint8Array([last ? 1 : 0, part.length & 0xff, part.length >> 8, ~part.length & 0xff, (~part.length >> 8) & 0xff]);
    blocks.push(header, part);
  }
  let a = 1, b = 0;
  for (const v of raw) { a = (a + v) % 65521; b = (b + a) % 65521; }
  const adler = new Uint8Array([b >> 8, b & 0xff, a >> 8, a & 0xff]);
  const zlib = concat([new Uint8Array([0x78, 0x01]), ...blocks, adler]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([1, 3, 0, 0, 0], 8); // bit depth 1, indexed color
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', new Uint8Array([0, 0, 0])),
    chunk('tRNS', new Uint8Array([0])),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing

const posInt = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

function parseJson(text, path, format) {
  if (typeof text !== 'string') throw new Error(`${path} doesn't exist`);
  let data;
  try { data = text.trim() ? JSON.parse(text) : {}; } catch (e) { throw new Error(`${path} isn't valid JSON (${e.message})`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path} should hold a JSON object`);
  const formats = Array.isArray(format) ? format : [format];
  if (data.format != null && !formats.includes(data.format)) throw new Error(`${path} is a "${data.format}" file, not a ${formats[0]} file`);
  if (data.version != null && (typeof data.version !== 'number' || data.version > 1)) {
    throw new Error(`${path} was made by a newer version of Smitten (version ${data.version}); update Smitten to edit it`);
  }
  return data;
}

/** Parse a .tileset.json's text. Unknown fields are kept in `extra`. */
export function parseTileset(text, path) {
  const data = parseJson(text, path, TILESET_FORMAT);
  const { format, version, image, tileWidth, tileHeight, tiles, ...extra } = data;
  const props = new Map();
  if (tiles && typeof tiles === 'object') {
    for (const [k, v] of Object.entries(tiles)) {
      const n = Number(k);
      if (Number.isInteger(n) && n >= 0 && v && typeof v === 'object') props.set(n, { ...v });
    }
  }
  return {
    image: typeof image === 'string' ? image : '',
    tileWidth: posInt(tileWidth, 16),
    tileHeight: posInt(tileHeight, 16),
    tiles: props,
    extra,
  };
}

export function tilesetText(ts) {
  const tiles = {};
  for (const n of [...ts.tiles.keys()].sort((a, b) => a - b)) {
    const p = ts.tiles.get(n);
    if (p && Object.keys(p).length) tiles[String(n)] = p;
  }
  return `${JSON.stringify({
    format: TILESET_FORMAT, version: 1, ...ts.extra, image: ts.image, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, tiles,
  }, null, 2)}\n`;
}

/**
 * Parse a .map.json's or .scene.json's text into the editor's model (tile
 * data as Int32Arrays). The format is kept as it was, or chosen from the
 * extension for files without one.
 */
export function parseMap(text, path) {
  const preferred = isScenePath(path) ? SCENE_FORMAT : MAP_FORMAT;
  const data = parseJson(text, path, [preferred, preferred === MAP_FORMAT ? SCENE_FORMAT : MAP_FORMAT]);
  const { format, version, width, height, tileWidth, tileHeight, tilesets, background, layers, properties, ...extra } = data;
  const map = {
    format: format || preferred,
    width: posInt(width, 20),
    height: posInt(height, 12),
    tileWidth: posInt(tileWidth, 16),
    tileHeight: posInt(tileHeight, 16),
    tilesets: Array.isArray(tilesets) ? tilesets.filter((t) => typeof t === 'string') : [],
    background: typeof background === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(background) ? background.toLowerCase() : null,
    properties: properties && typeof properties === 'object' && !Array.isArray(properties) ? { ...properties } : {},
    layers: [],
    extra,
  };
  const cells = map.width * map.height;
  let nextId = 1;
  for (const l of Array.isArray(layers) ? layers : []) {
    if (!l || typeof l !== 'object') continue;
    const { name, type, visible, data: tiles, objects, ...rest } = l;
    const layer = { name: typeof name === 'string' ? name : `Layer ${map.layers.length + 1}`, type, visible: visible !== false, extra: rest };
    if (type === 'objects') {
      layer.objects = (Array.isArray(objects) ? objects : []).filter((o) => o && typeof o === 'object').map((o) => ({
        ...o,
        id: Number.isInteger(o.id) ? o.id : 0,
        type: typeof o.type === 'string' ? o.type : '',
        x: Number(o.x) || 0,
        y: Number(o.y) || 0,
        // Objects of a type with an object file may leave the size out (it
        // then comes from the type); others always have one.
        ...(o.width != null || o.height != null || !o.type ? { width: Number(o.width) || 0, height: Number(o.height) || 0 } : {}),
        properties: o.properties && typeof o.properties === 'object' && !Array.isArray(o.properties) ? { ...o.properties } : {},
      }));
      for (const o of layer.objects) nextId = Math.max(nextId, o.id + 1);
    } else {
      layer.type = 'tiles';
      layer.data = new Int32Array(cells).fill(-1);
      if (Array.isArray(tiles)) {
        for (let i = 0; i < cells && i < tiles.length; i++) layer.data[i] = Number.isInteger(tiles[i]) && tiles[i] >= 0 ? tiles[i] : -1;
      }
    }
    map.layers.push(layer);
  }
  // Objects without ids get new ones.
  for (const l of map.layers) for (const o of l.objects || []) if (!o.id) o.id = nextId++;
  map.nextId = nextId;
  return map;
}

/** The map as .map.json text, with each row of tile data on its own line. */
export function mapText(map) {
  const rows = [];
  const out = {
    format: map.format || MAP_FORMAT,
    version: 1,
    ...map.extra,
    width: map.width,
    height: map.height,
    tileWidth: map.tileWidth,
    tileHeight: map.tileHeight,
    tilesets: map.tilesets,
    ...(map.background ? { background: map.background } : {}),
    layers: map.layers.map((l) => {
      if (l.type === 'objects') {
        return { ...l.extra, name: l.name, type: 'objects', visible: l.visible, objects: l.objects };
      }
      const marker = `@@ROWS${rows.length}@@`;
      const lines = [];
      for (let y = 0; y < map.height; y++) lines.push(Array.from(l.data.subarray(y * map.width, (y + 1) * map.width)).join(', '));
      rows.push(lines);
      return { ...l.extra, name: l.name, type: 'tiles', visible: l.visible, data: marker };
    }),
    properties: map.properties,
  };
  let text = JSON.stringify(out, null, 2);
  text = text.replace(/^( *)"data": "@@ROWS(\d+)@@"/gm, (_, indent, i) => {
    const pad = `${indent}  `;
    const lines = rows[Number(i)];
    return `${indent}"data": [\n${lines.map((r, j) => `${pad}${r}${j < lines.length - 1 ? ',' : ''}`).join('\n')}\n${indent}]`;
  });
  return `${text}\n`;
}

/** A new map's or scene's file text. */
export function newMapText({ width, height, tileWidth = 16, tileHeight = 16, tilesets = [], format = MAP_FORMAT }) {
  return mapText({
    format, width, height, tileWidth, tileHeight, tilesets, background: null, properties: {}, extra: {},
    layers: [
      { name: 'ground', type: 'tiles', visible: true, data: new Int32Array(width * height).fill(-1), extra: {} },
      { name: 'objects', type: 'objects', visible: true, objects: [], extra: {} },
    ],
  });
}

export function newTilesetText(image, tileWidth = 16, tileHeight = 16) {
  return tilesetText({ image, tileWidth, tileHeight, tiles: new Map(), extra: {} });
}

// ---------------------------------------------------------------------------
// Property values typed in the side panels

/** "true"/"false" -> boolean, numbers -> number, anything else stays text. */
export function parseValue(text) {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return Number(t);
  return text;
}

export function formatValue(v) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
