// Writes the glTF test models for the graphics3d demo and tests:
//
//   demo/models/house.gltf  .gltf with an embedded base64 buffer and a PNG
//                           data URI: a node tree (TRS, a matrix), u16 indices,
//                           a non-indexed primitive, float vertex colors.
//   demo/models/tower.glb   .glb: an interleaved vertex buffer with u16
//                           normalized uvs, u32 and u8 indices, a primitive
//                           without normals, u8 colors, a PNG with alpha in the
//                           binary chunk, MASK/BLEND/emissive materials, and a
//                           skin and an animation the loader must ignore.
//
// Run: node tools/graphics3d/make_models.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, 'demo', 'models');
fs.mkdirSync(OUT, { recursive: true });

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Bricks: rows of offset bricks with mortar.
const bricks = png(64, 64, (x, y) => {
  const row = Math.floor(y / 8);
  const bx = (x + (row % 2) * 8) % 16;
  const mortar = y % 8 === 0 || bx === 0;
  if (mortar) return [200, 196, 186, 255];
  const n = ((x * 7 + y * 13) % 5) * 6;
  return [150 + n, 70 + n / 2, 55, 255];
});
// A fence: wooden slats with transparent gaps.
const fence = png(32, 32, (x, y) => {
  const slat = x % 8 < 6;
  const rail = (y >= 6 && y < 10) || (y >= 22 && y < 26);
  if (slat || rail) return [170, 120, 70, 255];
  return [0, 0, 0, 0];
});

// --- Buffer builder -----------------------------------------------------------

class Builder {
  constructor() {
    this.parts = []; this.length = 0;
    this.gltf = { asset: { version: '2.0', generator: 'graphics3d make_models.js' }, buffers: [], bufferViews: [], accessors: [] };
  }
  align(n) {
    const pad = (n - (this.length % n)) % n;
    if (pad) { this.parts.push(Buffer.alloc(pad)); this.length += pad; }
  }
  view(buf, extra = {}) {
    this.align(4);
    const v = { buffer: 0, byteOffset: this.length, byteLength: buf.length, ...extra };
    this.parts.push(buf); this.length += buf.length;
    this.gltf.bufferViews.push(v);
    return this.gltf.bufferViews.length - 1;
  }
  accessor(acc) {
    this.gltf.accessors.push(acc);
    return this.gltf.accessors.length - 1;
  }
  floats(values, type, { minmax = false } = {}) {
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const buf = Buffer.from(new Float32Array(values).buffer);
    const acc = { bufferView: this.view(buf), componentType: 5126, count: values.length / n, type };
    if (minmax) {
      acc.min = []; acc.max = [];
      for (let k = 0; k < n; k++) {
        let lo = Infinity, hi = -Infinity;
        for (let i = k; i < values.length; i += n) { lo = Math.min(lo, values[i]); hi = Math.max(hi, values[i]); }
        acc.min.push(lo); acc.max.push(hi);
      }
    }
    return this.accessor(acc);
  }
  indices(values, componentType) {
    const Arr = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[componentType];
    const buf = Buffer.from(new Arr(values).buffer);
    return this.accessor({ bufferView: this.view(buf), componentType, count: values.length, type: 'SCALAR' });
  }
  bytes() { this.align(4); return Buffer.concat(this.parts); }
}

// Flat-shaded box: 24 vertices, CCW from outside, uv (0,0) top left.
function box(w, h, d) {
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const corners = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
  const pos = [], nrm = [], uv = [], idx = [];
  const half = [w / 2, h / 2, d / 2];
  faces.forEach(([n, u, v], f) => {
    for (const [su, sv, tu, tv] of corners) {
      for (let k = 0; k < 3; k++) pos.push((n[k] + u[k] * su + v[k] * sv) * half[k]);
      nrm.push(...n);
      uv.push(tu * w, tv * h); // repeat the texture once per meter
    }
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { pos, nrm, uv, idx };
}

// --- house.gltf -----------------------------------------------------------------

{
  const B = new Builder();
  const g = B.gltf;
  const base = box(2, 1.5, 2);
  const basePrim = {
    attributes: {
      POSITION: B.floats(base.pos, 'VEC3', { minmax: true }),
      NORMAL: B.floats(base.nrm, 'VEC3'),
      TEXCOORD_0: B.floats(base.uv, 'VEC2'),
    },
    indices: B.indices(base.idx, 5123),
    material: 0,
  };
  // Roof: a pyramid, 4 flat triangles, not indexed.
  const s = 1.25, h = 0.9;
  const apex = [0, h, 0];
  const ring = [[-s, 0, s], [s, 0, s], [s, 0, -s], [-s, 0, -s]];
  const rpos = [], rnrm = [];
  for (let i = 0; i < 4; i++) {
    const a = ring[i], b = ring[(i + 1) % 4];
    const e1 = b.map((v, k) => v - a[k]), e2 = apex.map((v, k) => v - a[k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    rpos.push(...a, ...b, ...apex);
    for (let k = 0; k < 3; k++) rnrm.push(...n.map((v) => v / len));
  }
  const roofPrim = {
    attributes: { POSITION: B.floats(rpos, 'VEC3', { minmax: true }), NORMAL: B.floats(rnrm, 'VEC3') },
    material: 1,
  };
  // Door: a quad with float rgba vertex colors (linear), facing +z.
  const dpos = [-0.3, 0, 0, 0.3, 0, 0, 0.3, 1, 0, -0.3, 1, 0];
  const dcol = [0.2, 0.1, 0.05, 1, 0.2, 0.1, 0.05, 1, 0.6, 0.3, 0.1, 1, 0.6, 0.3, 0.1, 1];
  const doorPrim = {
    attributes: {
      POSITION: B.floats(dpos, 'VEC3', { minmax: true }),
      NORMAL: B.floats([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 'VEC3'),
      COLOR_0: B.floats(dcol, 'VEC4'),
    },
    indices: B.indices([0, 1, 2, 0, 2, 3], 5123),
    material: 2,
  };
  g.meshes = [
    { name: 'BaseMesh', primitives: [basePrim] },
    { name: 'RoofMesh', primitives: [roofPrim] },
    { name: 'DoorMesh', primitives: [doorPrim] },
  ];
  g.materials = [
    { name: 'Walls', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 } },
    { name: 'Roof', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.06, 0.04, 1], metallicFactor: 0, roughnessFactor: 0.5 } },
    { name: 'Door', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.7 }, doubleSided: true },
  ];
  g.images = [{ uri: 'data:image/png;base64,' + bricks.toString('base64') }];
  g.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  g.textures = [{ source: 0, sampler: 0 }];
  // The door node uses a matrix: translate (0, 0, 1.01).
  g.nodes = [
    { name: 'House', children: [1, 2, 3], translation: [0, 0, 0] },
    { name: 'Base', mesh: 0, translation: [0, 0.75, 0] },
    { name: 'Roof', mesh: 1, translation: [0, 1.5, 0], rotation: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)], scale: [1, 1.2, 1] },
    { name: 'Door', mesh: 2, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1.01, 1] },
  ];
  g.scenes = [{ name: 'Scene', nodes: [0] }];
  g.scene = 0;
  const bin = B.bytes();
  g.buffers = [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }];
  fs.writeFileSync(path.join(OUT, 'house.gltf'), JSON.stringify(g, null, 1));
}

// --- tower.glb ------------------------------------------------------------------

{
  const B = new Builder();
  const g = B.gltf;

  // Tower body: an 8-sided prism, interleaved [pos f32x3][normal f32x3][uv u16x2 normalized].
  const N = 8, R = 0.6, H = 3;
  const verts = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2, sx = Math.sin(t), cz = Math.cos(t);
    verts.push([R * sx, H, R * cz, sx, 0, cz, i / N, 0]);
    verts.push([R * sx, 0, R * cz, sx, 0, cz, i / N, 1]);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = a + 3, d = a + 2;
    idx.push(a, b, c, a, c, d);
  }
  const stride = 28;
  const ib = Buffer.alloc(verts.length * stride);
  verts.forEach((v, i) => {
    for (let k = 0; k < 6; k++) ib.writeFloatLE(v[k], i * stride + k * 4);
    ib.writeUInt16LE(Math.round(v[6] * 65535), i * stride + 24);
    ib.writeUInt16LE(Math.round(v[7] * 65535), i * stride + 26);
  });
  const iv = B.view(ib, { byteStride: stride, target: 34962 });
  const count = verts.length;
  const pos = B.accessor({ bufferView: iv, byteOffset: 0, componentType: 5126, count, type: 'VEC3', min: [-R, 0, -R], max: [R, H, R] });
  const nrm = B.accessor({ bufferView: iv, byteOffset: 12, componentType: 5126, count, type: 'VEC3' });
  const uv = B.accessor({ bufferView: iv, byteOffset: 24, componentType: 5123, normalized: true, count, type: 'VEC2' });
  const bodyPrim = { attributes: { POSITION: pos, NORMAL: nrm, TEXCOORD_0: uv }, indices: B.indices(idx, 5125), material: 0 };

  // Flag: no normals (the loader computes them), u8 rgba colors, u8 indices,
  // POSITION without min/max, and skinning attributes to ignore.
  const fpos = [0, 0, 0, 1.2, 0, 0, 1.2, 0.7, 0, 0, 0.7, 0];
  const fcol = Buffer.from([255, 40, 40, 255, 255, 220, 40, 255, 255, 220, 40, 255, 255, 40, 40, 255]);
  const fcolAcc = B.accessor({ bufferView: B.view(fcol), componentType: 5121, normalized: true, count: 4, type: 'VEC4' });
  const joints = B.accessor({ bufferView: B.view(Buffer.alloc(16)), componentType: 5121, count: 4, type: 'VEC4' });
  const weights = B.floats([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 'VEC4');
  const flagPrim = {
    attributes: { POSITION: B.floats(fpos, 'VEC3'), COLOR_0: fcolAcc, JOINTS_0: joints, WEIGHTS_0: weights },
    indices: B.indices([0, 1, 2, 0, 2, 3], 5121),
    material: 1,
  };

  // Fence: textured quad with alpha holes (MASK), image stored in the binary chunk.
  const fenceView = B.view(fence);
  const fencePrim = {
    attributes: {
      POSITION: B.floats([-1, 0, 0, 1, 0, 0, 1, 0.8, 0, -1, 0.8, 0], 'VEC3', { minmax: true }),
      NORMAL: B.floats([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 'VEC3'),
      TEXCOORD_0: B.floats([0, 1, 2, 1, 2, 0, 0, 0], 'VEC2'),
    },
    indices: B.indices([0, 1, 2, 0, 2, 3], 5123),
    material: 2,
  };

  // Crystal: an emissive octahedron (flat faces, non-indexed).
  const oct = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]];
  const cpos = [], cnrm = [];
  for (const [ty, sgn] of [[1, 1], [-1, -1]]) {
    for (let i = 0; i < 4; i++) {
      let a = oct[i], b = oct[(i + 1) % 4];
      if (sgn < 0) [a, b] = [b, a];
      const tip = [0, ty * 1.4, 0];
      const e1 = b.map((v, k) => v - a[k]), e2 = tip.map((v, k) => v - a[k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(...n);
      cpos.push(...a.map((v) => v * 0.35), ...b.map((v) => v * 0.35), ...tip.map((v) => v * 0.35));
      for (let k = 0; k < 3; k++) cnrm.push(...n.map((v) => v / len));
    }
  }
  const crystalPrim = {
    attributes: { POSITION: B.floats(cpos, 'VEC3', { minmax: true }), NORMAL: B.floats(cnrm, 'VEC3') },
    material: 3,
  };

  // An animation (time → rotation) the loader must skip.
  const times = B.floats([0, 1], 'SCALAR', { minmax: true });
  const rots = B.floats([0, 0, 0, 1, 0, 0.7071, 0, 0.7071], 'VEC4');

  g.meshes = [
    { name: 'Body', primitives: [bodyPrim] },
    { name: 'Flag', primitives: [flagPrim] },
    { name: 'Fence', primitives: [fencePrim] },
    { name: 'Crystal', primitives: [crystalPrim] },
  ];
  g.materials = [
    { name: 'Stone', pbrMetallicRoughness: { baseColorFactor: [0.45, 0.45, 0.5, 1], metallicFactor: 0.1, roughnessFactor: 0.8 } },
    { name: 'Cloth', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.85], metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'BLEND', doubleSided: true },
    { name: 'Fence', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 }, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true },
    {
      name: 'Crystal', pbrMetallicRoughness: { baseColorFactor: [0.1, 0.5, 1, 1], metallicFactor: 0, roughnessFactor: 0.1 },
      emissiveFactor: [0.1, 0.4, 1], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } },
    },
  ];
  g.extensionsUsed = ['KHR_materials_emissive_strength'];
  g.images = [{ bufferView: fenceView, mimeType: 'image/png' }];
  g.samplers = [{ magFilter: 9728, minFilter: 9728 }];
  g.textures = [{ source: 0, sampler: 0 }];
  g.nodes = [
    { name: 'Tower', children: [1, 3], mesh: 0 },
    { name: 'Pole', children: [2, 4], translation: [0, 3, 0] },
    { name: 'Crystal', mesh: 3, translation: [0, 0.5, 0] },
    { name: 'Fence', mesh: 2, translation: [0, 0, 1.4] },
    // A matrix with a rotation of 90° about y and a translation.
    { name: 'Flag', mesh: 1, matrix: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0.05, 0.4, 0, 1] },
  ];
  g.skins = [{ joints: [4] }];
  g.animations = [{ name: 'Spin', channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }], samplers: [{ input: times, output: rots }] }];
  g.scenes = [{ nodes: [0] }];
  g.scene = 0;

  const bin = B.bytes();
  g.buffers = [{ byteLength: bin.length }];
  let json = Buffer.from(JSON.stringify(g), 'utf8');
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + json.length + 8 + bin.length;
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(path.join(OUT, 'tower.glb'), Buffer.concat([header, jh, json, bh, bin]));
}

console.log('wrote', fs.readdirSync(OUT).join(', '));
