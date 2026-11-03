// Who's asking: passwords, sessions, editor tokens, and the checks handlers
// use (requireUser, requireSameOrigin).
//
// A request is signed in one of two ways:
//   - a web session: the smitten_session cookie (HttpOnly, SameSite=Lax),
//     set by signing in on the site. Requests that change something must
//     also come from the site itself (Origin), so other sites can't act
//     with the cookie (CSRF).
//   - an editor token: Authorization: Bearer <token>, which the editor gets
//     through the sign-in popup (account.js). It can publish, update and
//     delete the account's games and claim old ones, but not change the
//     account itself.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpError, readCookie } from './http.js';
import { checkLimit, countHit, db, hmac, newToken, randomCode, safeEqual, sha256 } from './db.js';

export const SESSION_COOKIE = 'smitten_session';
const DAY = 86400_000;
export const SESSION_DAYS = { web: 30, editor: 90 };
const MAX_EDITOR_TOKENS = 20;

// ---------------------------------------------------------------------------
// Passwords: scrypt with a random salt, stored as
// scrypt$<logN>$<r>$<p>$<salt>$<hash>.

function scryptAsync(password, salt, logN, r, p) {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 256 * N * r }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password, config) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, config.scryptLogN, 8, 1);
  return `scrypt$${config.scryptLogN}$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

let dummyHash = null;

/** Checks a password against a stored hash. With no hash it still spends the time, so timing doesn't tell whether a username exists. */
export async function verifyPassword(password, stored, config) {
  if (!stored) {
    dummyHash ??= await hashPassword('not a real password', config);
    await verifyPassword(String(password || ''), dummyHash, config);
    return false;
  }
  const [scheme, logN, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const key = await scryptAsync(String(password || ''), Buffer.from(salt, 'base64url'), Number(logN), Number(r), Number(p));
  const expected = Buffer.from(hash, 'base64url');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Failed sign-ins (or recovery attempts) per username and hour.
export const FAILED_PER_USER = 10;

/** Checks the signed-in user's current password for a sensitive change (403 if wrong; counts as a failed sign-in). */
export async function confirmPassword(ctx, user, password) {
  const key = `signin-failed:${user.username}`;
  checkLimit(key, FAILED_PER_USER, 'tried to sign in to this account');
  if (!(await verifyPassword(password, user.password_hash, ctx.config))) {
    countHit(key);
    throw new HttpError(403, "That isn't your current password.", { field: 'current' });
  }
}

// ---------------------------------------------------------------------------
// Recovery codes: eight per account, shown once, each good for one password
// reset. Stored as an HMAC with the server's secret.

const normalizeCode = (code) => String(code || '').toLowerCase().replace(/[^0-9a-z]/g, '');

export function newRecoveryCodes(userId, config) {
  const codes = Array.from({ length: 8 }, () => randomCode(12).replace(/(.{4})(?=.)/g, '$1-'));
  db.run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
  for (const code of codes) {
    db.run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', userId, hmac(config.secret, `recovery|${normalizeCode(code)}`));
  }
  return codes;
}

/** Uses up one of a user's recovery codes; false if it isn't one (or was used). */
export function useRecoveryCode(userId, code, config) {
  const hash = hmac(config.secret, `recovery|${normalizeCode(code)}`);
  const res = db.run('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', Date.now(), userId, hash);
  return res.changes > 0;
}

export function recoveryCodesLeft(userId) {
  return db.get('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', userId).n;
}

// ---------------------------------------------------------------------------
// Sessions

/** Starts a session; returns {id, token}. Only the token's SHA-256 is stored. */
export function createSession(userId, kind, origin = null) {
  const id = randomCode(16);
  const token = newToken();
  const now = Date.now();
  db.run(`INSERT INTO sessions (id, token_hash, user_id, kind, origin, created_at, last_used_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, sha256(token), userId, kind, origin, now, now, now + SESSION_DAYS[kind] * DAY);
  if (kind === 'editor') {
    // Old editor sign-ins past the limit are signed out.
    db.run(`DELETE FROM sessions WHERE user_id = ? AND kind = 'editor' AND id NOT IN
            (SELECT id FROM sessions WHERE user_id = ? AND kind = 'editor' ORDER BY last_used_at DESC LIMIT ?)`, userId, userId, MAX_EDITOR_TOKENS);
  }
  if (Math.random() < 0.05) db.run('DELETE FROM sessions WHERE expires_at < ?', now);
  return { id, token };
}

/** The session and its (active) user for a token, extending it as it's used; or null. */
function lookupSession(token, kind) {
  if (!token || token.length > 200) return null;
  const row = db.get(
    `SELECT s.id AS session_id, s.kind, s.origin, s.last_used_at, s.expires_at, u.*
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.kind = ?`, sha256(token), kind);
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now || row.status !== 'active') {
    db.run('DELETE FROM sessions WHERE id = ?', row.session_id);
    return null;
  }
  // Sliding expiry, written at most once an hour.
  if (now - row.last_used_at > 3600_000) {
    db.run('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?', now, now + SESSION_DAYS[kind] * DAY, row.session_id);
  }
  const { session_id: sessionId, kind: k, origin, last_used_at: lastUsed, expires_at: expires, ...user } = row;
  return { user, session: { id: sessionId, kind: k, origin } };
}

export function bearer(request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  return m ? m[1] : null;
}

export function isAdmin(ctx) {
  const token = bearer(ctx.request);
  return Boolean(token && ctx.config.adminToken && safeEqual(token, ctx.config.adminToken));
}

/**
 * Who's signed in: {user, session, via: 'web' | 'editor'}, or null.
 * badToken is true when a bearer token was sent that isn't a valid editor
 * token (signed out, expired or revoked) or the admin token.
 */
export function auth(ctx) {
  if (ctx.auth !== undefined) return ctx.auth;
  ctx.badToken = false;
  const token = bearer(ctx.request);
  let found = null;
  if (token) {
    if (!isAdmin(ctx)) {
      found = lookupSession(token, 'editor');
      if (found) found.via = 'editor';
      else ctx.badToken = true;
    }
  } else {
    found = lookupSession(readCookie(ctx.request, SESSION_COOKIE), 'web');
    if (found) found.via = 'web';
  }
  ctx.auth = found;
  return found;
}

export const currentUser = (ctx) => auth(ctx)?.user || null;

/** Requests from the site's own pages: the Origin header (or Sec-Fetch-Site) must say so. */
export function requireSameOrigin(ctx) {
  const origin = ctx.request.headers.get('Origin');
  const site = ctx.request.headers.get('Sec-Fetch-Site');
  if (origin ? origin === ctx.config.publicOrigin : site === 'same-origin') return;
  throw new HttpError(403, 'This can only be done from the site itself.');
}

/**
 * The signed-in user, or a 401. editor: whether an editor token is enough
 * (otherwise it takes a web session, signed in on the site).
 */
export function requireUser(ctx, { editor = false } = {}) {
  const a = auth(ctx);
  if (!a) {
    if (ctx.badToken) throw new HttpError(401, "You've been signed out of the site. Sign in again to carry on.", { code: 'signed-out' });
    throw new HttpError(401, 'You need to sign in first.', { code: 'sign-in' });
  }
  if (a.via === 'editor' && !editor) throw new HttpError(403, 'Do this on the site, in your account settings.');
  if (a.via === 'web' && ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') requireSameOrigin(ctx);
  return a.user;
}

export function publicUser(u) {
  return { username: u.username, displayName: u.display_name };
}

export function accountView(u) {
  return {
    username: u.username,
    displayName: u.display_name,
    hasPassword: Boolean(u.password_hash),
    hackclub: Boolean(u.hackclub_id),
    hackatime: Boolean(u.hackatime_id),
    createdAt: u.created_at,
  };
}

/** A salted hash of the client's address (rate limits, report and play de-duplication). */
export function ipHash(ctx) {
  return ipHashOf(ctx.config, ctx.ip);
}

/** The same hash for any address (a moderator banning one by hand). */
export function ipHashOf(config, ip) {
  return hmac(config.secret, `ip|${ip}`).slice(0, 32);
}

/** Who to count a report or play for: the account if signed in, else the address. */
export function actorKey(ctx) {
  const user = currentUser(ctx);
  return user ? `u:${user.id}` : `ip:${ipHash(ctx)}`;
}
