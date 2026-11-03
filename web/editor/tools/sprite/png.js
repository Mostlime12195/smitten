// PNG encoding and decoding with exact RGBA values.
//
// The browser's canvas keeps premultiplied alpha, which rounds the color of
// semi-transparent pixels (and loses it entirely at alpha 0), so the sprite
// editor reads and writes PNGs itself: decode → straight RGBA bytes → encode.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  const n = bytes.length;
  for (let i = 0; i < n;) {
    const end = Math.min(i + 5552, n);
    for (; i < end; i++) { a += bytes[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

async function streamThrough(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** zlib data with stored (uncompressed) deflate blocks; synchronous. */
function zlibStored(data) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, data.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff; out[o++] = len >>> 8;
    out[o++] = ~len & 0xff; out[o++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(data);
  out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 0xff; out[o++] = (ad >>> 8) & 0xff; out[o++] = ad & 0xff;
  return out;
}

async function zlibCompress(data) {
  if (typeof CompressionStream === 'function') {
    try { return await streamThrough(data, new CompressionStream('deflate')); } catch { /* fall through */ }
  }
  return zlibStored(data);
}

// Filters each row with the filter that gives the smallest sum of absolute
// values (the usual heuristic), for RGBA8 pixels.
function filterRows(rgba, width, height) {
  const stride = width * 4;
  const out = new Uint8Array((stride + 1) * height);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const prev = row - stride;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = rgba[row + i];
        const a = i >= 4 ? rgba[row + i - 4] : 0;
        const b = y > 0 ? rgba[prev + i] : 0;
        const cc = y > 0 && i >= 4 ? rgba[prev + i - 4] : 0;
        let v;
        if (f === 0) v = x;
        else if (f === 1) v = x - a;
        else if (f === 2) v = x - b;
        else if (f === 3) v = x - ((a + b) >> 1);
        else {
          const p = a + b - cc;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
          v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc);
        }
        v &= 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    // Recompute the winner fully (the loop above may have stopped early).
    const o = y * (stride + 1);
    out[o] = best;
    for (let i = 0; i < stride; i++) {
      const x = rgba[row + i];
      const a = i >= 4 ? rgba[row + i - 4] : 0;
      const b = y > 0 ? rgba[prev + i] : 0;
      const cc = y > 0 && i >= 4 ? rgba[prev + i - 4] : 0;
      let v;
      if (best === 0) v = x;
      else if (best === 1) v = x - a;
      else if (best === 2) v = x - b;
      else if (best === 3) v = x - ((a + b) >> 1);
      else {
        const p = a + b - cc;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
        v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc);
      }
      out[o + 1 + i] = v & 0xff;
    }
  }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function assemble(width, height, zdata) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zdata), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Encode straight (non-premultiplied) RGBA8 pixels as a PNG. */
export async function encodePNG(rgba, width, height) {
  return assemble(width, height, await zlibCompress(filterRows(rgba, width, height)));
}

/** Synchronous, uncompressed variant (for small files made on the spot). */
export function encodePNGSync(rgba, width, height) {
  return assemble(width, height, zlibStored(filterRows(rgba, width, height)));
}

// ---------------------------------------------------------------------------
// Decoding

const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
];

/**
 * Decode a PNG into {width, height, data: Uint8ClampedArray RGBA8 (straight
 * alpha)}. Handles every standard color type, bit depth and interlacing.
 * Falls back to the browser's decoder for anything it can't read.
 */
export async function decodePNG(bytes) {
  try {
    return await decodeOwn(bytes);
  } catch (e) {
    try { return await decodeWithBrowser(bytes); } catch { throw e; }
  }
}

async function decodeOwn(bytes) {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
      height = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
      [depth, ctype] = [data[8], data[9]];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!width || !height) throw new Error('PNG has no image header');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`unsupported PNG color type ${ctype}`);
  const total = idat.reduce((n, d) => n + d.length, 0);
  const zdata = new Uint8Array(total);
  let o = 0;
  for (const d of idat) { zdata.set(d, o); o += d.length; }
  const raw = await streamThrough(zdata, new DecompressionStream('deflate'));

  const bpp = Math.max(1, (channels * depth) >> 3); // bytes per pixel for filtering
  const out = new Uint8ClampedArray(width * height * 4);
  let rp = 0;
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * channels * depth) / 8);
    let prev = new Uint8Array(stride);
    let cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[rp++];
      for (let i = 0; i < stride; i++) {
        const x = raw[rp++];
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v;
        switch (f) {
          case 0: v = x; break;
          case 1: v = x + a; break;
          case 2: v = x + b; break;
          case 3: v = x + ((a + b) >> 1); break;
          case 4: {
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            break;
          }
          default: throw new Error(`bad PNG filter ${f}`);
        }
        cur[i] = v & 0xff;
      }
      writeRow(cur, pw, y0 + y * dy, x0, dx);
      [prev, cur] = [cur, prev];
    }
  }
  if (rp > raw.length) throw new Error('PNG data is truncated');
  return { width, height, data: out };

  function sample(row, i) {
    // The i-th sample of a row, scaled to 8 bits.
    if (depth === 8) return row[i];
    if (depth === 16) return row[i * 2];
    const perByte = 8 / depth;
    const byte = row[Math.floor(i / perByte)];
    const shift = 8 - depth * ((i % perByte) + 1);
    const v = (byte >> shift) & ((1 << depth) - 1);
    return ctype === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  }
  function raw16(row, i) { return (row[i * 2] << 8) | row[i * 2 + 1]; }

  function writeRow(row, pw, y, x0, dx) {
    for (let px = 0; px < pw; px++) {
      const d = (y * width + x0 + px * dx) * 4;
      let r, g, b, al = 255;
      if (ctype === 0) {
        r = g = b = sample(row, px);
        if (trns && trns.length >= 2) {
          const t = (trns[0] << 8) | trns[1];
          const v = depth === 16 ? raw16(row, px) : depth === 8 ? row[px] : ((row[Math.floor(px / (8 / depth))] >> (8 - depth * ((px % (8 / depth)) + 1))) & ((1 << depth) - 1));
          if (v === t) al = 0;
        }
      } else if (ctype === 2) {
        r = sample(row, px * 3); g = sample(row, px * 3 + 1); b = sample(row, px * 3 + 2);
        if (trns && trns.length >= 6) {
          const tr = (trns[0] << 8) | trns[1], tg = (trns[2] << 8) | trns[3], tb = (trns[4] << 8) | trns[5];
          const vr = depth === 16 ? raw16(row, px * 3) : row[px * 3];
          const vg = depth === 16 ? raw16(row, px * 3 + 1) : row[px * 3 + 1];
          const vb = depth === 16 ? raw16(row, px * 3 + 2) : row[px * 3 + 2];
          if (vr === tr && vg === tg && vb === tb) al = 0;
        }
      } else if (ctype === 3) {
        const idx = sample(row, px);
        r = palette ? palette[idx * 3] : 0; g = palette ? palette[idx * 3 + 1] : 0; b = palette ? palette[idx * 3 + 2] : 0;
        if (trns && idx < trns.length) al = trns[idx];
      } else if (ctype === 4) {
        r = g = b = sample(row, px * 2); al = sample(row, px * 2 + 1);
      } else {
        r = sample(row, px * 4); g = sample(row, px * 4 + 1); b = sample(row, px * 4 + 2); al = sample(row, px * 4 + 3);
      }
      out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = al;
    }
  }
}

async function decodeWithBrowser(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return { width: canvas.width, height: canvas.height, data };
}
