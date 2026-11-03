// D1 helpers: the schema, rate limits, ids, tokens and hashing.

import schema from '../migrations/0001_init.sql';
import { HttpError } from './http.js';

// Creates the tables on first use in each isolate, so `wrangler dev` works
// without running the migration first. Every statement is IF NOT EXISTS.
let schemaReady = null;

export function ensureSchema(env) {
  if (!schemaReady) {
    const statements = schema.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
    schemaReady = env.DB.batch(statements.map((s) => env.DB.prepare(s))).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

// ---------------------------------------------------------------------------
// Hashing and random values

const encoder = new TextEncoder();

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two strings (via their SHA-256 digests). */
export async function safeEqual(a, b) {
  const [da, db] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(String(s)))));
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(da, db);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Game ids: 10 characters of lower-case Crockford base32 (no i, l, o, u),
// about 50 bits, short enough for links and hard to guess.
const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const ID_PATTERN = '[0-9a-hjkmnp-tv-z]{10}';

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => ID_ALPHABET[b & 31]).join('');
}

/** An edit token: 32 random bytes, base64url. Only its SHA-256 is stored. */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Client identity. There are no accounts yet, so rate limits, report
// de-duplication and play counts go by IP address, stored only as a salted
// hash. On Cloudflare, CF-Connecting-IP is set by the edge.

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

export async function ipHash(request, env) {
  return (await sha256Hex(`${env.IP_SALT || 'smitten-dev-salt'}|${clientIp(request)}`)).slice(0, 32);
}

// ---------------------------------------------------------------------------
// Rate limits: a counter per key and fixed window (an hour by default). A
// burst can reach twice the limit across a window boundary, which is fine
// for this purpose.

export async function rateLimit(env, key, limit, what, windowMs = 3600_000) {
  if (!(limit > 0)) return;
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  ).bind(key, windowStart).first();
  // Old windows are cleaned up now and then.
  if (Math.random() < 0.05) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(windowStart - windowMs).run();
  }
  if (row.count > limit) {
    const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
    const minutes = Math.max(1, Math.round(retryAfter / 60));
    throw new HttpError(429, `You've ${what} a lot in the last hour. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, { retryAfter });
  }
}

export function intVar(env, name, fallback) {
  const n = Number.parseInt(env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}
