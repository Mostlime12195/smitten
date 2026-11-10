// A small GIF decoder for the clip tests (test.mjs and the "clips" scene
// test): every frame as it shows, with its rectangle, delay and disposal.

export function lzwDecode(data, minCodeSize, expected) {
  const clear = 1 << minCodeSize, end = clear + 1;
  let size = minCodeSize + 1, next = end + 1;
  let dict = [];
  const resetDict = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    size = minCodeSize + 1;
    next = end + 1;
  };
  resetDict();
  const out = [];
  let bit = 0, prev = null;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++, bit++) {
      if ((bit >> 3) >= data.length) return -1;
      v |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    }
    return v;
  };
  for (;;) {
    const code = read();
    if (code < 0) throw new Error('the codes ran out before the end code');
    if (code === clear) { resetDict(); prev = null; continue; }
    if (code === end) break;
    let entry;
    if (prev === null) {
      entry = dict[code];
      if (!entry) throw new Error(`code ${code} right after a clear`);
    } else {
      if (code < next) entry = dict[code];
      else if (code === next) entry = [...dict[prev], dict[prev][0]];
      else throw new Error(`code ${code} is past the table (${next})`);
      if (next < 4096) dict[next++] = [...dict[prev], entry[0]];
    }
    for (const v of entry) out.push(v);
    prev = code;
    if (next === (1 << size) && size < 12) size++;
  }
  if (expected !== undefined && out.length !== expected) throw new Error(`decoded ${out.length} indices, wanted ${expected}`);
  return out;
}

/** {sig, width, height, palette, loop, frames: [{x, y, w, h, delay, disposal, transparent, pixels: [[r, g, b] | null]}]} */
export function decodeGif(bytes) {
  let p = 0;
  const ascii = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p++]); return s; };
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const sig = ascii(6);
  const width = u16(), height = u16();
  const packed = bytes[p++];
  p += 2;
  const palette = [];
  if (packed & 0x80) {
    const n = 2 << (packed & 7);
    for (let i = 0; i < n; i++) palette.push([bytes[p++], bytes[p++], bytes[p++]]);
  }
  const frames = [];
  let gce = null, loop = null;
  const canvas = new Array(width * height).fill(null);
  for (;;) {
    if (p >= bytes.length) throw new Error('the GIF has no end');
    const b = bytes[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p++];
      const blocks = [];
      for (let n = bytes[p++]; n; n = bytes[p++]) { blocks.push(bytes.slice(p, p + n)); p += n; }
      if (label === 0xf9) gce = { disposal: (blocks[0][0] >> 2) & 7, transparent: blocks[0][0] & 1 ? blocks[0][3] : -1, delay: blocks[0][1] | (blocks[0][2] << 8) };
      if (label === 0xff && String.fromCharCode(...blocks[0]) === 'NETSCAPE2.0') loop = blocks[1][1] | (blocks[1][2] << 8);
    } else if (b === 0x2c) {
      const x = u16(), y = u16(), w = u16(), h = u16();
      const local = bytes[p++];
      if (local & 0x80) throw new Error('a local palette (the encoder does not write them)');
      const min = bytes[p++];
      const parts = [];
      for (let n = bytes[p++]; n; n = bytes[p++]) { for (let i = 0; i < n; i++) parts.push(bytes[p + i]); p += n; }
      const indices = lzwDecode(Uint8Array.from(parts), min, w * h);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const idx = indices[j * w + i];
          if (gce && idx === gce.transparent) continue;
          canvas[(y + j) * width + x + i] = palette[idx];
        }
      }
      frames.push({ x, y, w, h, delay: gce?.delay ?? 0, disposal: gce?.disposal, transparent: gce?.transparent, pixels: canvas.slice() });
      gce = null;
    } else {
      throw new Error(`unknown block 0x${b.toString(16)} at ${p - 1}`);
    }
  }
  return { sig, width, height, palette, frames, loop };
}
