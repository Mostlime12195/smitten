// Accounts: signing up, in and out, recovery, settings, public profiles,
// claiming games published before accounts, and the editor's sign-in.

import { createHash } from 'node:crypto';
import { HttpError, cookie, json, readCookie, readJson } from './http.js';
import { checkLimit, countHit, db, hmac, rateLimit, randomCode, safeEqual, sha256, ID_PATTERN } from './db.js';
import {
  SESSION_COOKIE, SESSION_DAYS, accountView, auth, createSession, hashPassword, ipHash, newRecoveryCodes,
  publicUser, recoveryCodesLeft, requireSameOrigin, requireUser, useRecoveryCode, verifyPassword,
} from './auth.js';
import { checkPassword, cleanDisplayName, cleanUsername } from './validate.js';
import { publicGame, removeGame } from './games.js';
import { checkAddress, noteAddress } from './bans.js';

const DAY = 86400_000;
const EDITOR_CODE_MS = 5 * 60_000;
// Failed sign-ins (or recovery attempts) per username and hour.
const FAILED_PER_USER = 10;

const sessionCookie = (ctx, token) => cookie(ctx.config, SESSION_COOKIE, token, { maxAge: SESSION_DAYS.web * 86400 });
const clearSessionCookie = (ctx) => cookie(ctx.config, SESSION_COOKIE, '', { maxAge: 0 });

function findUser(username) {
  if (typeof username !== 'string' || !username.trim() || username.length > 40) return null;
  return db.get('SELECT * FROM users WHERE username = ?', username.trim().toLowerCase());
}

const banned = () => new HttpError(403, 'This account has been suspended by a moderator.', { code: 'banned' });

/** Signs a browser in: a new web session and its cookie. */
function signedIn(ctx, user, body = {}, status = 200) {
  noteAddress(ctx, user.id);
  const { token } = createSession(user.id, 'web');
  return json({ user: accountView(user), ...body }, status, { 'Set-Cookie': sessionCookie(ctx, token) });
}

// ---------------------------------------------------------------------------
// Hack Club sign-in hands over to sign-up with a short-lived signed cookie
// naming the Hack Club account (hackclub.js).

export const PENDING_COOKIE = 'smitten_hackclub';

export function pendingHackclubCookie(ctx, sub) {
  const value = `${Buffer.from(sub).toString('base64url')}.${Date.now() + 30 * 60_000}`;
  return cookie(ctx.config, PENDING_COOKIE, `${value}.${hmac(ctx.config.secret, `pending|${value}`)}`, { maxAge: 1800 });
}

export function pendingHackclubId(ctx) {
  const raw = readCookie(ctx.request, PENDING_COOKIE);
  const [sub, expires, mac] = (raw || '').split('.');
  if (!sub || !mac || !safeEqual(mac, hmac(ctx.config.secret, `pending|${sub}.${expires}`)) || Number(expires) < Date.now()) return null;
  return Buffer.from(sub, 'base64url').toString();
}

// ---------------------------------------------------------------------------
// Signing up, in and out

export async function signUp(ctx) {
  requireSameOrigin(ctx);
  const body = await readJson(ctx.request);
  const viaHackclub = body.via === 'hackclub';
  const hackclubId = viaHackclub ? pendingHackclubId(ctx) : null;
  if (viaHackclub && !hackclubId) throw new HttpError(400, 'Your Hack Club sign-in has expired. Start again with "Sign in with Hack Club".');

  const username = cleanUsername(body.username);
  const displayName = cleanDisplayName(body.displayName, username);
  const password = viaHackclub ? null : checkPassword(body.password, username);
  if (findUser(username)) throw new HttpError(409, 'That username is taken. Try another one.', { field: 'username' });
  if (hackclubId && db.get('SELECT id FROM users WHERE hackclub_id = ?', hackclubId)) {
    throw new HttpError(409, 'That Hack Club account already has a Smitten account. Sign in with Hack Club instead.');
  }
  rateLimit(`signup:ip:${ipHash(ctx)}`, ctx.config.signupLimit, 'made accounts');
  checkAddress(ctx, 'make accounts');

  const passwordHash = password ? await hashPassword(password, ctx.config) : null;
  const now = Date.now();
  let user;
  let recoveryCodes = null;
  try {
    user = db.tx(() => {
      const row = db.get(
        `INSERT INTO users (username, display_name, password_hash, hackclub_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`, username, displayName, passwordHash, hackclubId, now, now);
      if (passwordHash) recoveryCodes = newRecoveryCodes(row.id, ctx.config);
      return row;
    });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'That username is taken. Try another one.', { field: 'username' });
    throw e;
  }
  const res = signedIn(ctx, user, { recoveryCodes }, 201);
  if (viaHackclub) res.headers.append('Set-Cookie', cookie(ctx.config, PENDING_COOKIE, '', { maxAge: 0 }));
  return res;
}

export async function signIn(ctx) {
  requireSameOrigin(ctx);
  const body = await readJson(ctx.request);
  const ipKey = `signin:ip:${ipHash(ctx)}`;
  rateLimit(ipKey, ctx.config.signinLimit, 'tried to sign in');
  const name = String(body.username || '').trim().toLowerCase().slice(0, 40);
  const userKey = `signin-failed:${name}`;
  checkLimit(userKey, FAILED_PER_USER, 'tried to sign in to this account');

  const user = findUser(name);
  const ok = await verifyPassword(body.password, user?.password_hash, ctx.config);
  if (!user || !ok) {
    countHit(userKey);
    if (user && !user.password_hash && user.hackclub_id) {
      throw new HttpError(401, 'This account signs in with Hack Club. Use "Sign in with Hack Club".', { code: 'use-hackclub' });
    }
    throw new HttpError(401, "That username and password don't match.", { field: 'password' });
  }
  if (user.status !== 'active') throw banned();
  return signedIn(ctx, user);
}

export function signOut(ctx) {
  const a = auth(ctx);
  if (a?.via === 'web') {
    requireSameOrigin(ctx);
    db.run('DELETE FROM sessions WHERE id = ?', a.session.id);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(ctx) });
}

/**
 * Resets a forgotten password, with {username, code} (a recovery code) or
 * {resetToken} (a link from a moderator), and {password}. Signs out
 * everywhere else.
 */
export async function recover(ctx) {
  requireSameOrigin(ctx);
  const body = await readJson(ctx.request);
  rateLimit(`recover:ip:${ipHash(ctx)}`, 20, 'tried to reset a password');
  let user;
  let usedCode = false;
  if (body.resetToken) {
    const row = db.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(String(body.resetToken)));
    if (!row || row.expires_at < Date.now()) throw new HttpError(400, "That reset link doesn't work anymore. Ask a moderator for a new one.", { field: 'resetToken' });
    user = db.get('SELECT * FROM users WHERE id = ?', row.user_id);
  } else {
    const name = String(body.username || '').trim().toLowerCase().slice(0, 40);
    const userKey = `signin-failed:${name}`;
    checkLimit(userKey, FAILED_PER_USER, 'tried to recover this account');
    user = findUser(name);
    const fail = () => {
      countHit(userKey);
      return new HttpError(400, "That username and recovery code don't match. Each code works only once.", { field: 'code' });
    };
    if (!user) throw fail();
    if (user.status !== 'active') throw banned();
    // Check the new password before using up a code.
    checkPassword(body.password, user.username);
    if (!useRecoveryCode(user.id, body.code, ctx.config)) throw fail();
    usedCode = true;
  }
  if (!user) throw new HttpError(400, "That account doesn't exist anymore.");
  if (user.status !== 'active') throw banned();
  checkPassword(body.password, user.username);
  const hash = await hashPassword(body.password, ctx.config);
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hash, Date.now(), user.id);
    db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    db.run('DELETE FROM password_resets WHERE user_id = ?', user.id);
  });
  return signedIn(ctx, { ...user, password_hash: hash }, { codesLeft: usedCode ? recoveryCodesLeft(user.id) : undefined });
}

// ---------------------------------------------------------------------------
// The signed-in account

/** {user} or {user: null}. An editor token that no longer works is a 401, so the editor knows to sign in again. */
export function me(ctx) {
  const a = auth(ctx);
  if (!a && ctx.badToken) requireUser(ctx, { editor: true });
  if (!a) return json({ user: null });
  const out = { user: accountView(a.user), via: a.via };
  if (a.via === 'web') out.recoveryCodesLeft = a.user.password_hash ? recoveryCodesLeft(a.user.id) : 0;
  return json(out);
}

export async function updateAccount(ctx) {
  const user = requireUser(ctx);
  const body = await readJson(ctx.request);
  const displayName = cleanDisplayName(body.displayName, user.username);
  db.run('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?', displayName, Date.now(), user.id);
  return json({ user: accountView({ ...user, display_name: displayName }) });
}

async function confirmPassword(ctx, user, password) {
  const key = `signin-failed:${user.username}`;
  checkLimit(key, FAILED_PER_USER, 'tried to sign in to this account');
  if (!(await verifyPassword(password, user.password_hash, ctx.config))) {
    countHit(key);
    throw new HttpError(403, "That isn't your current password.", { field: 'current' });
  }
}

/** Changes (or, for Hack Club accounts, sets) the password, and signs out everywhere else. */
export async function changePassword(ctx) {
  const user = requireUser(ctx);
  const body = await readJson(ctx.request);
  if (user.password_hash) await confirmPassword(ctx, user, body.current);
  checkPassword(body.password, user.username);
  const hash = await hashPassword(body.password, ctx.config);
  const session = auth(ctx).session;
  let recoveryCodes = null;
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hash, Date.now(), user.id);
    db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, session.id);
    if (!user.password_hash) recoveryCodes = newRecoveryCodes(user.id, ctx.config);
  });
  return json({ ok: true, recoveryCodes });
}

export async function regenerateRecoveryCodes(ctx) {
  const user = requireUser(ctx);
  if (!user.password_hash) throw new HttpError(400, 'Recovery codes are for resetting a password. Set a password first.');
  const body = await readJson(ctx.request);
  await confirmPassword(ctx, user, body.password);
  return json({ recoveryCodes: newRecoveryCodes(user.id, ctx.config) });
}

/** Deletes the account and all its games. Takes the password, or the username for Hack Club accounts without one. */
export async function deleteAccount(ctx) {
  const user = requireUser(ctx);
  const body = await readJson(ctx.request);
  if (user.password_hash) await confirmPassword(ctx, user, body.password);
  else if (String(body.confirm || '').toLowerCase() !== user.username) {
    throw new HttpError(422, 'Type your username to confirm.', { field: 'confirm' });
  }
  await deleteUser(user.id);
  return json({ deleted: true }, 200, { 'Set-Cookie': clearSessionCookie(ctx) });
}

/** Removes a user, their games and files, sessions and codes. */
export async function deleteUser(userId) {
  for (const { id } of db.all('SELECT id FROM games WHERE owner_id = ?', userId)) await removeGame(id);
  db.run('DELETE FROM users WHERE id = ?', userId);
}

export function listSessions(ctx) {
  const user = requireUser(ctx);
  const current = auth(ctx).session.id;
  const rows = db.all('SELECT id, kind, origin, created_at, last_used_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_used_at DESC', user.id, Date.now());
  return json({
    sessions: rows.map((s) => ({ id: s.id, kind: s.kind, origin: s.origin, createdAt: s.created_at, lastUsedAt: s.last_used_at, current: s.id === current })),
  });
}

export function revokeSession(ctx, id) {
  const user = requireUser(ctx);
  const res = db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', id, user.id);
  if (!res.changes) throw new HttpError(404, 'No such sign-in.');
  return json({ ok: true });
}

/** Signs out everywhere except here. */
export function revokeOtherSessions(ctx) {
  const user = requireUser(ctx);
  const res = db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, auth(ctx).session.id);
  return json({ ok: true, revoked: res.changes });
}

/** The account's games, hidden ones included (with their status). */
export function myGames(ctx) {
  const user = requireUser(ctx, { editor: true });
  const rows = db.all(`SELECT g.*, u.username AS owner_username, u.display_name AS owner_name, u.status AS owner_status
    FROM games g JOIN users u ON u.id = g.owner_id WHERE g.owner_id = ? ORDER BY g.created_at DESC LIMIT 500`, user.id);
  return json({ games: rows.map((r) => ({ ...publicGame(r, ctx.origin), status: r.status })) });
}

/**
 * Claims games published before accounts: {games: [{id, token}]}, the edit
 * tokens this browser kept. A game is claimed when its token matches and
 * it has no owner yet; its token stops working.
 */
export async function claimGames(ctx) {
  const user = requireUser(ctx, { editor: true });
  const body = await readJson(ctx.request);
  if (!Array.isArray(body.games) || body.games.length > 100) throw new HttpError(422, 'games must be a list of at most 100 {id, token}.');
  rateLimit(`claim:u:${user.id}`, 30, 'claimed games');
  const idRe = new RegExp(`^${ID_PATTERN}$`);
  const out = { claimed: [], owned: [], failed: [] };
  for (const item of body.games) {
    const id = String(item?.id || '');
    const row = idRe.test(id) ? db.get('SELECT id, owner_id, token_hash FROM games WHERE id = ?', id) : null;
    if (!row) out.failed.push({ id, reason: 'missing' });
    else if (row.owner_id === user.id) out.owned.push(id);
    else if (row.owner_id) out.failed.push({ id, reason: 'owned' });
    else if (!row.token_hash || typeof item.token !== 'string' || !safeEqual(sha256(item.token), row.token_hash)) out.failed.push({ id, reason: 'token' });
    else {
      db.run('UPDATE games SET owner_id = ?, token_hash = NULL WHERE id = ? AND owner_id IS NULL', user.id, id);
      out.claimed.push(id);
    }
  }
  return json(out);
}

/** A public profile: {user: {username, displayName, createdAt, games}}. Its games come from /api/games?user=. */
export function getProfile(ctx, username) {
  const user = findUser(decodeURIComponent(username));
  if (!user || user.status !== 'active') throw new HttpError(404, "There's no one here with that name.");
  const games = db.get("SELECT COUNT(*) AS n FROM games WHERE owner_id = ? AND status = 'public'", user.id).n;
  return json({ user: { ...publicUser(user), createdAt: user.created_at, games } });
}

// ---------------------------------------------------------------------------
// The editor's sign-in (web/editor/account.js)
//
// 1. The editor (on an origin in EDITOR_ORIGINS) makes a random verifier,
//    and opens /editor-auth?origin=<its origin>&state=<random>&challenge=<SHA-256 of the verifier>
//    in a popup.
// 2. There, the person signs in to the site if they aren't, sees which
//    editor is asking, and allows it. The page asks for a one-time code
//    (editorCode, below: a web session and same-origin request), bound to
//    the account, the editor's origin and the challenge, good for 5 minutes.
// 3. The page posts {state, code} to window.opener, addressed to the
//    editor's origin only, and closes.
// 4. The editor sends {code, verifier} here (editorToken), from its origin,
//    and gets an editor token: a bearer token for the API, listed and
//    revocable in account settings, valid for 90 days after its last use.

const base64url = (buf) => Buffer.from(buf).toString('base64url');

export async function editorCode(ctx) {
  const user = requireUser(ctx);
  const body = await readJson(ctx.request);
  const origin = String(body.origin || '');
  if (!ctx.config.editorOrigins.includes(origin)) throw new HttpError(422, "That editor isn't one this site works with.", { field: 'origin' });
  if (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) throw new HttpError(422, 'The challenge must be a base64url SHA-256.', { field: 'challenge' });
  rateLimit(`editor-code:u:${user.id}`, 30, 'signed in editors');
  const code = randomCode(24);
  db.run('DELETE FROM editor_codes WHERE expires_at < ?', Date.now());
  db.run('INSERT INTO editor_codes (code_hash, user_id, origin, challenge, expires_at) VALUES (?, ?, ?, ?, ?)',
    sha256(code), user.id, origin, body.challenge, Date.now() + EDITOR_CODE_MS);
  return json({ code, expiresIn: EDITOR_CODE_MS / 1000 });
}

export async function editorToken(ctx) {
  const body = await readJson(ctx.request);
  rateLimit(`editor-token:ip:${ipHash(ctx)}`, 60, 'tried to sign in the editor');
  const code = String(body.code || '').toLowerCase().replace(/[^0-9a-z]/g, '');
  const row = code ? db.get('SELECT * FROM editor_codes WHERE code_hash = ?', sha256(code)) : null;
  // A code is used once, whatever happens.
  if (row) db.run('DELETE FROM editor_codes WHERE code_hash = ?', row.code_hash);
  const invalid = new HttpError(400, "That sign-in code doesn't work. Sign in again from the editor.", { code: 'bad-code' });
  if (!row || row.expires_at < Date.now()) throw invalid;
  const challenge = base64url(createHash('sha256').update(String(body.verifier || '')).digest());
  if (!safeEqual(challenge, row.challenge)) throw invalid;
  // The code only works from the editor it was made for.
  if (ctx.request.headers.get('Origin') !== row.origin) throw invalid;
  const user = db.get("SELECT * FROM users WHERE id = ? AND status = 'active'", row.user_id);
  if (!user) throw invalid;
  const { token } = createSession(user.id, 'editor', row.origin);
  return json({ token, user: accountView(user), expiresInDays: SESSION_DAYS.editor });
}

/** Signs the editor out: revokes the token it sends. */
export function revokeEditorToken(ctx) {
  const a = auth(ctx);
  if (a?.via === 'editor') db.run('DELETE FROM sessions WHERE id = ?', a.session.id);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Moderators' reset links (admin.js)

export function createResetLink(ctx, userId) {
  const token = randomCode(32);
  db.run('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?', userId, Date.now());
  db.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + DAY);
  return `${ctx.origin}/recover#reset=${token}`;
}
