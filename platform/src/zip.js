// Checks that an upload is a game the player can run: a plain zip (no
// encryption, no ZIP64, stored or deflated entries) with smitten.json at
// its root. Reads only the central directory; nothing is decompressed.

import { HttpError } from './http.js';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

// The player unpacks the game in memory, so the total uncompressed size is
// capped too (a small zip can expand to gigabytes).
export const MAX_UNCOMPRESSED = 256 * 1024 * 1024;
export const MAX_ENTRIES = 10000;

const bad = (message) => new HttpError(422, message, { field: 'game' });

function decodeName(bytes, utf8) {
  if (utf8) return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Without the UTF-8 flag names are CP437; ASCII is all that matters here.
  return String.fromCharCode(...bytes);
}

/** Returns {files, uncompressed} or throws a 422. */
export function inspectZip(bytes) {
  const notZip = "This isn't a zip file. A game upload is a zip of the game's files.";
  if (bytes.length < 22) throw bad(notZip);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== LOCAL && dv.getUint32(0, true) !== END) throw bad(notZip);

  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === END) { end = i; break; }
  }
  if (end < 0) throw bad(notZip);

  const count = dv.getUint16(end + 10, true);
  const cdSize = dv.getUint32(end + 12, true);
  const cdOffset = dv.getUint32(end + 16, true);
  if (dv.getUint16(end + 4, true) !== 0 || dv.getUint16(end + 6, true) !== 0) throw bad('Zips split over several files are not supported.');
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw bad('ZIP64 files are not supported. A game must be smaller than 25 MB anyway.');
  if (count === 0) throw bad('The zip is empty.');
  if (count > MAX_ENTRIES) throw bad(`The zip has more than ${MAX_ENTRIES} files.`);
  if (cdOffset + cdSize > end) throw bad('The zip is damaged (its directory is out of place).');

  const files = [];
  let uncompressed = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || dv.getUint32(p, true) !== CENTRAL) throw bad('The zip is damaged (bad directory entry).');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen > end) throw bad('The zip is damaged (bad file name).');
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), flags & 0x800);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 1) throw bad('The zip is encrypted. Games must be plain zips.');
    if (method !== 0 && method !== 8) throw bad(`"${name}" uses a compression method the player can't read (only stored and deflate work).`);
    if (localOffset + 30 > cdOffset || dv.getUint32(localOffset, true) !== LOCAL) throw bad(`The zip is damaged ("${name}" is missing).`);
    if (localOffset + 30 + csize > cdOffset) throw bad(`The zip is damaged ("${name}" is cut short).`);
    if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) {
      throw bad(`The zip has a file with a path that isn't allowed: "${name.slice(0, 80)}".`);
    }
    uncompressed += usize;
    if (uncompressed > MAX_UNCOMPRESSED) throw bad(`The game unpacks to more than ${MAX_UNCOMPRESSED / 1024 / 1024} MB.`);
    if (!name.endsWith('/')) files.push(name);
  }
  if (p > cdOffset + cdSize) throw bad('The zip is damaged (its directory is cut short).');

  if (!files.includes('smitten.json')) {
    throw bad('The game needs a smitten.json at the top of the zip (not inside a folder).');
  }
  return { files, uncompressed };
}
