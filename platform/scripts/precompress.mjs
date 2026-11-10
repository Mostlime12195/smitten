// Writes .br and .gz files next to the static files worth compressing
// (.wasm, .js, .css, ...), which the server then sends instead of
// compressing them itself (src/compress.js). Run it after
// scripts/copy-player.sh; files that are already up to date are skipped.
//
//   node scripts/precompress.mjs public/player
//   node scripts/precompress.mjs <folder>...

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import zlib from 'node:zlib';

import { COMPRESSIBLE } from '../src/compress.js';

const MIN_BYTES = 1024;

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('Usage: node scripts/precompress.mjs <folder>...');
  process.exit(2);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

const upToDate = (path, mtimeMs) => {
  try {
    return statSync(path).mtimeMs >= mtimeMs;
  } catch {
    return false;
  }
};

let written = 0;
let skipped = 0;
let before = 0;
let after = 0;
for (const dir of dirs) {
  for (const file of walk(dir)) {
    if (!COMPRESSIBLE.has(extname(file).toLowerCase())) continue;
    const info = statSync(file);
    if (info.size <= MIN_BYTES) continue;
    if (upToDate(`${file}.br`, info.mtimeMs) && upToDate(`${file}.gz`, info.mtimeMs)) {
      skipped++;
      continue;
    }
    const data = readFileSync(file);
    const br = zlib.brotliCompressSync(data, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length },
    });
    writeFileSync(`${file}.br`, br);
    writeFileSync(`${file}.gz`, zlib.gzipSync(data, { level: 9 }));
    written++;
    before += data.length;
    after += br.length;
    console.log(`${file}: ${data.length} -> ${br.length} bytes (br)`);
  }
}
const saved = before ? `, ${Math.round((1 - after / before) * 100)}% smaller with Brotli` : '';
console.log(`Compressed ${written} file(s)${saved}; ${skipped} already up to date.`);
