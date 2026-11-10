// Content-Encoding (br or gzip) for static files and pages, with node:zlib.
// The engine is several megabytes of WebAssembly and the proxies this runs
// behind don't compress, so the server does:
//
//   1. <file>.br / <file>.gz next to the file (scripts/precompress.mjs), if
//      it's there and not older than the file;
//   2. otherwise compressed here and kept in memory. Small files are
//      compressed with Brotli while the request waits. For big ones that
//      takes seconds, so the request gets gzip and Brotli is made in the
//      background, for later requests.

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** File types worth compressing (not images, fonts or zips, which already are). */
export const COMPRESSIBLE = new Set(['.wasm', '.mjs', '.js', '.css', '.html', '.json', '.svg', '.txt', '.md', '.map']);

const SIBLING = { br: '.br', gzip: '.gz' };
// Up to here Brotli runs while the request waits (tens of milliseconds).
const INLINE_BROTLI_BYTES = 256 * 1024;
// Bigger files are only served from precompressed siblings: compressing
// needs the whole file in memory.
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

/** Which of br and gzip an Accept-Encoding header allows. */
export function acceptedEncodings(header) {
  const out = { br: false, gzip: false };
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim());
    if (!(name in out)) continue;
    const q = params.map((p) => /^q\s*=\s*([\d.]+)$/.exec(p)).find(Boolean);
    out[name] = !q || Number(q[1]) > 0;
  }
  return out;
}

// path + encoding → {mtimeMs, size, buf}, oldest first. buf is null when
// compressing didn't make the file smaller. A changed file replaces its entry.
const cache = new Map();
let cacheBytes = 0;
// Compressions under way, so that concurrent requests share one.
const running = new Map();
// Background Brotli runs one file at a time: quality 11 takes about 70 MB
// and 10 seconds for the engine.
let background = Promise.resolve();

function cached(file, info, encoding) {
  const key = `${file}\0${encoding}`;
  const hit = cache.get(key);
  if (!hit || hit.mtimeMs !== info.mtimeMs || hit.size !== info.size) return null;
  cache.delete(key);
  cache.set(key, hit); // most recently used last
  return hit;
}

function remember(file, info, encoding, buf) {
  const key = `${file}\0${encoding}`;
  cacheBytes -= cache.get(key)?.buf?.length || 0;
  cache.delete(key);
  cache.set(key, { mtimeMs: info.mtimeMs, size: info.size, buf });
  cacheBytes += buf?.length || 0;
  for (const [oldest, entry] of cache) {
    if (cacheBytes <= MAX_CACHE_BYTES || oldest === key) break;
    cache.delete(oldest);
    cacheBytes -= entry.buf?.length || 0;
  }
}

async function compressFile(file, info, encoding, quality) {
  const data = await readFile(file);
  const out = encoding === 'br'
    ? await brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
    : await gzip(data, { level: 9 });
  const buf = out.length < data.length ? out : null;
  // If the file changed after stat(), this isn't what info describes.
  if (data.length === info.size) remember(file, info, encoding, buf);
  return buf;
}

/** The file compressed (a Buffer, or null if that's no smaller), from the cache or made now. */
function compressed(file, info, encoding, { later = false } = {}) {
  const hit = cached(file, info, encoding);
  if (hit) return Promise.resolve(hit.buf);
  const key = `${file}\0${encoding}\0${info.mtimeMs}\0${info.size}`;
  let job = running.get(key);
  if (!job) {
    const run = () => compressFile(file, info, encoding, later ? 11 : 9).finally(() => running.delete(key));
    if (later) {
      job = background.then(run);
      background = job.catch((e) => console.error(`Couldn't compress ${file}: ${e?.message || e}`));
    } else {
      job = run();
    }
    running.set(key, job);
  }
  return job;
}

async function precompressed(file, info, encoding) {
  const path = file + SIBLING[encoding];
  try {
    const s = await stat(path);
    if (!s.isFile() || s.size === 0 || s.mtimeMs < info.mtimeMs) return null;
    return { encoding, size: s.size, body: () => Readable.toWeb(createReadStream(path)) };
  } catch {
    return null;
  }
}

const fromBuffer = (encoding, buf) => (buf ? { encoding, size: buf.length, body: () => buf } : null);

/**
 * A file (info: its stat) in the best encoding the request accepts that's
 * ready: {encoding, size, body()}, or null to send it as it is.
 */
export async function encodedFile(file, info, acceptEncoding) {
  const accept = acceptedEncodings(acceptEncoding);
  const small = info.size <= INLINE_BROTLI_BYTES;
  const fits = info.size <= MAX_FILE_BYTES;
  try {
    if (accept.br) {
      const pre = await precompressed(file, info, 'br');
      if (pre) return pre;
      const hit = fits && cached(file, info, 'br');
      if (hit) return fromBuffer('br', hit.buf);
      if (small) return fromBuffer('br', await compressed(file, info, 'br'));
      // Never make a request wait for this: gzip now, Brotli next time.
      if (fits) compressed(file, info, 'br', { later: true }).catch(() => {});
    }
    if (accept.gzip) {
      const pre = await precompressed(file, info, 'gzip');
      if (pre) return pre;
      if (fits) return fromBuffer('gzip', await compressed(file, info, 'gzip'));
    }
  } catch (e) {
    console.error(`Couldn't compress ${file}: ${e?.message || e}`);
  }
  return null;
}

/** A page made for this request, compressed quickly: {encoding, body}, or null. */
export async function encodedText(text, acceptEncoding) {
  const accept = acceptedEncodings(acceptEncoding);
  const data = Buffer.from(text);
  if (data.length < 1024 || (!accept.br && !accept.gzip)) return null;
  const body = accept.br
    ? await brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
    : await gzip(data, { level: 6 });
  return { encoding: accept.br ? 'br' : 'gzip', body };
}

/** Resolves when the background compressions queued so far are done (for tests). */
export const backgroundIdle = () => background;
