// Share links: small projects packed into the URL hash.
// Format: #share=<base64url(deflate-raw(JSON {v: 2, name, files, binary}))>
// files holds text files; binary holds base64 for the rest (pixel art PNGs are
// tiny, so small games with art still fit). Version 1 links had no binary.

export const SHARE_LIMIT = 32 * 1024; // compressed bytes

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Returns {url, size} or throws an Error with a user-facing message.
 * files: {path: string | Uint8Array}
 */
export async function createShareLink(name, files) {
  const text = {};
  const binary = {};
  for (const [p, d] of Object.entries(files)) {
    if (typeof d === 'string') text[p] = d;
    else binary[p] = toBase64(d);
  }
  const json = JSON.stringify({ v: 2, name, files: text, binary });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  if (packed.length > SHARE_LIMIT) {
    throw new Error(`This project is too big for a link (${Math.round(packed.length / 1024)} KB compressed, the limit is ${SHARE_LIMIT / 1024} KB). Export it for the web or as a project zip instead.`);
  }
  const url = new URL(location.href);
  url.search = '';
  url.hash = `share=${toBase64Url(packed)}`;
  return { url: url.toString(), size: packed.length };
}

/** Parse location.hash; returns {name, files, id} or null. Throws on corrupt data. */
export async function readShareHash(hash = location.hash) {
  const m = /^#share=([\w-]+)$/.exec(hash);
  if (!m) return null;
  const json = new TextDecoder().decode(await pipe(fromBase64Url(m[1]), new DecompressionStream('deflate-raw')));
  const data = JSON.parse(json);
  if (!data || typeof data.files !== 'object') throw new Error('The share link is not valid.');
  const files = {};
  for (const [p, t] of Object.entries(data.files)) if (typeof t === 'string') files[p] = t;
  for (const [p, b] of Object.entries(data.binary || {})) if (typeof b === 'string') files[p] = fromBase64Url(b.replace(/=+$/, ''));
  return { name: String(data.name || 'Shared project').slice(0, 80), files, id: shareId(m[1]) };
}

/** A short fingerprint of a share link's payload, to spot the same link opened twice. */
export function shareId(payload) {
  // Two 32-bit FNV-1a hashes (crypto.subtle needs https, and this needs no secrecy).
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) + a | 0;
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(a)}${hex(b)}-${payload.length.toString(16)}`;
}

/** name, or "name (2)", "name (3)"... if a project is already called that. */
export function uniqueName(name, taken) {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  let i = 2;
  while (used.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}
