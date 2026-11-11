// Lossless PNG optimisation for play builds (build/index.js).
//
//   optimizePNG(bytes, { deflate, keepColorChunks }) -> Uint8Array | null
//
// Decodes the image to exact RGBA, then writes the smallest of: a palette
// image (256 colours or fewer, at 1, 2, 4 or 8 bits per pixel), grey, grey
// with alpha, RGB or RGBA, each with a few row filters. The engine decodes
// the result to the same pixels: the new file is decoded again and compared
// before it is used. Returns null when the image cannot be made smaller, or
// is a kind this does not handle (16 bits per channel, damaged files).
//
// deflate(bytes, level) -> Promise<Uint8Array> makes a zlib stream at a
// level from 1 (fast) to 9 (small): fflate in the editor, node:zlib in
// tests, or the browser's CompressionStream, which has one level only.
// keepColorChunks keeps gAMA, cHRM, sRGB and iCCP: the engine ignores them,
// but a browser uses them to show the image (the player's splash).

import { decodePNG } from '../../tools/sprite/png.js';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const COLOR_CHUNKS = new Set(['gAMA', 'cHRM', 'sRGB', 'iCCP']);

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
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The chunks of a PNG as [{type, data}], or null if it is not a PNG. */
export function readChunks(bytes) {
  if (bytes.length < 8) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = dv.getUint32(pos);
    if (pos + 12 + len > bytes.length) return null;
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    chunks.push({ type, data: bytes.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks.length && chunks[0].type === 'IHDR' ? chunks : null;
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

/** What the image needs: its colours (up to 257), and whether it is grey or opaque. */
function analyse(rgba) {
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >> 2);
  const colours = new Map();
  let grey = true;
  let opaque = true;
  for (let i = 0, p = 0; i < u32.length; i++, p += 4) {
    const v = u32[i];
    if (colours.size <= 256 && !colours.has(v)) colours.set(v, p);
    if (grey && (rgba[p] !== rgba[p + 1] || rgba[p] !== rgba[p + 2])) grey = false;
    if (opaque && rgba[p + 3] !== 255) opaque = false;
  }
  return { colours, grey, opaque };
}

/** Raw rows (before filtering) for one colour type: {ctype, depth, bpp, stride, rows, plte, trns}. */
function layout(rgba, width, height, kind, info) {
  if (kind === 'palette') {
    // Entries with alpha < 255 first, so tRNS can stop early.
    const entries = [...info.colours.entries()].map(([v, p]) => [v, rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]]);
    entries.sort((a, b) => (a[4] === 255) - (b[4] === 255));
    const n = entries.length;
    const depth = n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8;
    const index = new Map(entries.map((e, i) => [e[0], i]));
    const plte = new Uint8Array(n * 3);
    let transparent = 0;
    entries.forEach((e, i) => { plte.set([e[1], e[2], e[3]], i * 3); if (e[4] !== 255) transparent = i + 1; });
    const trns = transparent ? Uint8Array.from(entries.slice(0, transparent), (e) => e[4]) : null;
    const stride = Math.ceil((width * depth) / 8);
    const rows = new Uint8Array(stride * height);
    const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >> 2);
    const perByte = 8 / depth;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = index.get(u32[y * width + x]);
        const byte = y * stride + Math.floor(x / perByte);
        rows[byte] |= idx << (8 - depth * ((x % perByte) + 1));
      }
    }
    return { ctype: 3, depth, bpp: 1, stride, rows, plte, trns };
  }
  const channels = { grey: 1, greyAlpha: 2, rgb: 3, rgba: 4 }[kind];
  const ctype = { grey: 0, greyAlpha: 4, rgb: 2, rgba: 6 }[kind];
  const stride = width * channels;
  const rows = new Uint8Array(stride * height);
  for (let i = 0, o = 0; i < rgba.length; i += 4) {
    if (kind === 'grey') rows[o++] = rgba[i];
    else if (kind === 'greyAlpha') { rows[o++] = rgba[i]; rows[o++] = rgba[i + 3]; }
    else if (kind === 'rgb') { rows[o++] = rgba[i]; rows[o++] = rgba[i + 1]; rows[o++] = rgba[i + 2]; }
    else { rows[o++] = rgba[i]; rows[o++] = rgba[i + 1]; rows[o++] = rgba[i + 2]; rows[o++] = rgba[i + 3]; }
  }
  return { ctype, depth: 8, bpp: channels, stride, rows, plte: null, trns: null };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function filterRow(type, row, prev, bpp, out, o) {
  out[o] = type;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= bpp ? prev[i - bpp] : 0;
    const x = row[i];
    out[o + 1 + i] = (type === 0 ? x : type === 1 ? x - a : type === 2 ? x - b : type === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c)) & 0xff;
  }
}

/** Filtered image data. strategy: 0-4 (one filter for every row) or 'adaptive' (per row, the smallest sum). */
function filterImage(l, height, strategy) {
  const { stride, rows, bpp } = l;
  const out = new Uint8Array((stride + 1) * height);
  const trial = strategy === 'adaptive' ? new Uint8Array(stride + 1) : null;
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rows.subarray((y - 1) * stride, y * stride) : null;
    const o = y * (stride + 1);
    if (!trial) { filterRow(strategy, row, prev, bpp, out, o); continue; }
    let best = Infinity;
    for (let f = 0; f < 5; f++) {
      filterRow(f, row, prev, bpp, trial, 0);
      let sum = 0;
      for (let i = 1; i < trial.length; i++) sum += trial[i] < 128 ? trial[i] : 256 - trial[i];
      if (sum < best) { best = sum; out.set(trial, o); }
    }
  }
  return out;
}

function ihdr(width, height, depth, ctype) {
  const d = new Uint8Array(13);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  d[8] = depth;
  d[9] = ctype;
  return d; // compression 0, filter 0, no interlace
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function optimizePNG(bytes, { deflate, keepColorChunks = false } = {}) {
  const chunks = readChunks(bytes);
  if (!chunks) return null;
  const head = chunks[0].data;
  const depth = head[8];
  if (depth === 16) return null; // the engine keeps 16 bits; this writes 8
  let image;
  try {
    image = await decodePNG(bytes);
  } catch {
    return null;
  }
  const { width, height } = image;
  const rgba = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const info = analyse(rgba);

  const kinds = [];
  if (info.colours.size <= 256) kinds.push('palette');
  if (info.grey) kinds.push(info.opaque ? 'grey' : 'greyAlpha');
  else kinds.push(info.opaque ? 'rgb' : 'rgba');

  // More filters for small images; for big ones, the two that usually win.
  const big = width * height > 1 << 20;
  const extra = keepColorChunks ? chunks.filter((c) => COLOR_CHUNKS.has(c.type)).map((c) => chunk(c.type, c.data)) : [];
  // Each layout and filter is tried at a fast level; the best one is then
  // compressed at the best level.
  let best = null;
  for (const kind of kinds) {
    const l = layout(rgba, width, height, kind, info);
    const strategies = l.ctype === 3 && l.depth < 8 ? [0, 'adaptive'] : big ? [0, 'adaptive'] : [0, 1, 2, 4, 'adaptive'];
    for (const s of strategies) {
      const filtered = filterImage(l, height, s);
      const z = await deflate(filtered, 1);
      const overhead = (l.plte ? l.plte.length + 12 : 0) + (l.trns ? l.trns.length + 12 : 0);
      if (!best || z.length + overhead < best.score) best = { score: z.length + overhead, l, filtered };
    }
  }
  const { l } = best;
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr(width, height, l.depth, l.ctype)), ...extra];
  if (l.plte) parts.push(chunk('PLTE', l.plte));
  if (l.trns) parts.push(chunk('tRNS', l.trns));
  parts.push(chunk('IDAT', await deflate(best.filtered, 9)), chunk('IEND', new Uint8Array(0)));
  const out = concat(parts);
  if (out.length >= bytes.length) return null;
  // The new file must decode to the same pixels, or it is not used.
  try {
    const check = await decodePNG(out);
    if (check.width !== width || check.height !== height) return null;
    if (!sameBytes(new Uint8Array(check.data.buffer, check.data.byteOffset, check.data.byteLength), rgba)) return null;
  } catch {
    return null;
  }
  return out;
}
