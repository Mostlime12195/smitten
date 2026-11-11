// SQLite (node:sqlite), the schema, ids, tokens, hashing and rate limits.

import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { HttpError } from './http.js';

/** The open database: db.get/all/run(sql, ...params) and db.tx(fn). */
export let db = null;

export function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(raw);
  const statements = new Map();
  const stmt = (sql) => {
    let s = statements.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      statements.set(sql, s);
    }
    return s;
  };
  db = {
    raw,
    get: (sql, ...params) => stmt(sql).get(...params) ?? null,
    all: (sql, ...params) => stmt(sql).all(...params),
    run: (sql, ...params) => stmt(sql).run(...params),
    /** Runs fn in a transaction (fn must be synchronous). */
    tx(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => raw.close(),
  };
  return db;
}

// migrations/NNNN_name.sql, applied in order, once each. The table
// migrations keeps the name of each one applied, so a file that lands
// after one with a higher number (two branches merged in either order)
// still runs. Before that table, PRAGMA user_version was the number of the
// last one applied: when the table is made, every file up to that number
// counts as applied. user_version stays the highest number applied.
function migrate(raw) {
  const dir = join(ROOT, 'migrations');
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  let version = raw.prepare('PRAGMA user_version').get().user_version;
  if (!raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migrations'").get()) {
    raw.exec('BEGIN');
    raw.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const mark = raw.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)');
    for (const file of files) if (Number.parseInt(file, 10) <= version) mark.run(file, Date.now());
    raw.exec('COMMIT');
  }
  const applied = new Set(raw.prepare('SELECT name FROM migrations').all().map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const n = Number.parseInt(file, 10);
    raw.exec('BEGIN');
    try {
      raw.exec(readFileSync(join(dir, file), 'utf8'));
      raw.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
      if (n > version) {
        raw.exec(`PRAGMA user_version = ${n}`);
        version = n;
      }
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Hashing and random values

export const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex');
export const hmac = (secret, text) => createHmac('sha256', secret).update(String(text)).digest('hex');

/** Constant-time comparison of two strings. */
export function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

// Ids: lower-case Crockford base32 (no i, l, o, u). Game ids are 10
// characters, about 50 bits: short enough for links, hard to guess.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const ID_PATTERN = '[0-9a-hjkmnp-tv-z]{10}';

export function randomCode(length) {
  return [...randomBytes(length)].map((b) => ALPHABET[b & 31]).join('');
}

export const newId = () => randomCode(10);

/** A secret token: 32 random bytes, base64url. Only its SHA-256 is stored. */
export const newToken = () => randomBytes(32).toString('base64url');

// ---------------------------------------------------------------------------
// Rate limits: a counter per key and fixed window (an hour by default). A
// burst can reach twice the limit across a window boundary, which is fine
// for this purpose.

function windowOf(windowMs) {
  const now = Date.now();
  return { now, start: now - (now % windowMs) };
}

function tooMany(what, retryAfter) {
  const minutes = Math.max(1, Math.round(retryAfter / 60));
  return new HttpError(429, `You've ${what} a lot in the last hour. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, { retryAfter });
}

/** Counts one more for key, and throws a 429 once the count passes limit. */
export function rateLimit(key, limit, what, windowMs = 3600_000) {
  if (!(limit > 0)) return;
  const { now, start } = windowOf(windowMs);
  const row = db.get(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`, key, start);
  if (Math.random() < 0.02) db.run('DELETE FROM rate_limits WHERE window_start < ?', start - windowMs);
  if (row.count > limit) throw tooMany(what, Math.ceil((start + windowMs - now) / 1000));
}

/** Throws a 429 if key has already reached limit, without counting. */
export function checkLimit(key, limit, what, windowMs = 3600_000) {
  if (!(limit > 0)) return;
  const { now, start } = windowOf(windowMs);
  const row = db.get('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?', key, start);
  if (row && row.count >= limit) throw tooMany(what, Math.ceil((start + windowMs - now) / 1000));
}

/** Counts one more for key without checking (e.g. a failed sign-in). */
export function countHit(key, windowMs = 3600_000) {
  const { start } = windowOf(windowMs);
  db.run(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
          ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1`, key, start);
}
