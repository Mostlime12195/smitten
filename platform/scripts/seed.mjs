// Publishes the editor's new-game templates (web/editor/core/templates.js) to
// a local site, so the gallery has something in it:
//
//   node scripts/seed.mjs [http://127.0.0.1:8787]
//
// Prints each game's link and edit token.

import { deflateRawSync } from 'node:zlib';
import { TEMPLATES } from '../../web/editor/core/templates.js';

const base = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '');

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A deflated zip of {path: Buffer}. */
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [path, data] of Object.entries(files)) {
    const name = Buffer.from(path);
    const packed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc32(data), 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

// A simpler version of the editor's detection (web/editor/core/modules.js):
// Bodies moved by physics, or the APIs in code.
const MODULES = [
  ['physics2d', /"motion": "physics"|\b(?:smitten|love)\.physics\./],
  ['video', /\b(?:smitten|love)\.video\b|\bnewVideo\s*\(/],
  ['synth', /\b(?:smitten|love)\.synth\b/],
];

for (const ex of TEMPLATES.filter((t) => t.id !== 'empty')) {
  const files = Object.fromEntries(Object.entries(ex.build(ex.name)).map(([f, text]) => [f, Buffer.from(text)]));
  const code = Object.values(files).map(String).join('\n');
  const modules = MODULES.filter(([, re]) => re.test(code)).map(([id]) => id);
  const form = new FormData();
  form.append('meta', JSON.stringify({ title: ex.name, description: ex.description, modules, engineVersion: '0.2.0' }));
  form.append('game', new Blob([zip(files)], { type: 'application/zip' }), 'game.love');
  const res = await fetch(`${base}/api/games`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) {
    console.error(`${ex.name}: ${res.status} ${data.error}`);
    if (res.status === 429) break;
    continue;
  }
  console.log(`${ex.name.padEnd(22)} ${data.game.playUrl}  token ${data.token}`);
}
