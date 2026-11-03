// Moderation endpoints, behind ADMIN_TOKEN (Authorization: Bearer <ADMIN_TOKEN>).
// Everything a moderator does is written to admin_log.

import { HttpError, json, readJson } from './http.js';
import { db } from './db.js';
import { ipHashOf, isAdmin, publicUser } from './auth.js';
import { DEFAULT_BAN_DAYS, addressesOf, banAddresses, listAddressBans, unbanAddresses } from './bans.js';
import { getRow, publicGame, removeGame } from './games.js';
import { createResetLink, deleteUser } from './account.js';

function requireAdmin(ctx) {
  if (!ctx.config.adminToken) throw new HttpError(503, 'Admin endpoints are off: set ADMIN_TOKEN (see deploy/env.example).');
  if (!isAdmin(ctx)) throw new HttpError(401, 'This needs the admin token (Authorization: Bearer <ADMIN_TOKEN>).');
}

function requireGame(id) {
  const row = getRow(id);
  if (!row) throw new HttpError(404, 'No game with that id.');
  return row;
}

function requireAccount(username) {
  const user = db.get('SELECT * FROM users WHERE username = ?', decodeURIComponent(username).toLowerCase());
  if (!user) throw new HttpError(404, 'No account with that username.');
  return user;
}

function log(action, target, detail = '') {
  db.run('INSERT INTO admin_log (at, action, target, detail) VALUES (?, ?, ?, ?)', Date.now(), action, target, String(detail).slice(0, 500));
}

/** Games that are hidden or have open reports, with their reports, most reported first. */
export function adminReports(ctx) {
  requireAdmin(ctx);
  const games = db.all(
    `SELECT g.*, u.username AS owner_username, u.display_name AS owner_name, u.status AS owner_status,
       COUNT(r.id) AS open_reports, MAX(r.created_at) AS last_report
     FROM games g
     LEFT JOIN users u ON u.id = g.owner_id
     LEFT JOIN reports r ON r.game_id = g.id AND r.resolved = 0
     GROUP BY g.id
     HAVING g.status != 'public' OR open_reports > 0
     ORDER BY open_reports DESC, last_report DESC
     LIMIT 200`);
  return json({
    games: games.map((g) => ({
      ...publicGame(g, ctx.origin),
      owner: g.owner_username ? { username: g.owner_username, displayName: g.owner_name, status: g.owner_status } : null,
      status: g.status,
      hiddenBy: g.hidden_by,
      openReports: g.open_reports,
      reports: db.all('SELECT reason, note, reporter, created_at FROM reports WHERE game_id = ? AND resolved = 0 ORDER BY created_at DESC LIMIT 50', g.id)
        .map((r) => ({ reason: r.reason, note: r.note, reporter: r.reporter.startsWith('u:') ? r.reporter : r.reporter.slice(0, 11), createdAt: r.created_at })),
    })),
  });
}

export function adminHide(ctx, id) {
  requireAdmin(ctx);
  requireGame(id);
  db.run("UPDATE games SET status = 'hidden', hidden_by = 'admin' WHERE id = ?", id);
  log('hide', `game:${id}`);
  return json({ id, status: 'hidden' });
}

/** Makes a game public again and closes its open reports. */
export function adminRestore(ctx, id) {
  requireAdmin(ctx);
  requireGame(id);
  db.tx(() => {
    db.run("UPDATE games SET status = 'public', hidden_by = NULL WHERE id = ?", id);
    db.run('UPDATE reports SET resolved = 1 WHERE game_id = ? AND resolved = 0', id);
  });
  log('restore', `game:${id}`);
  return json({ id, status: 'public' });
}

export async function adminDelete(ctx, id) {
  requireAdmin(ctx);
  const row = requireGame(id);
  await removeGame(id);
  log('delete', `game:${id}`, row.title);
  return json({ id, deleted: true });
}

// ---------------------------------------------------------------------------
// Accounts

/** An account, for moderators: status, how it signs in, its games (hidden ones too). */
export function adminUser(ctx, username) {
  requireAdmin(ctx);
  const user = requireAccount(username);
  const games = db.all(`SELECT g.*, ? AS owner_username, ? AS owner_name, ? AS owner_status FROM games g WHERE owner_id = ? ORDER BY created_at DESC`,
    user.username, user.display_name, user.status, user.id);
  return json({
    user: {
      ...publicUser(user),
      status: user.status,
      banReason: user.ban_reason,
      hasPassword: Boolean(user.password_hash),
      hackclub: Boolean(user.hackclub_id),
      createdAt: user.created_at,
      sessions: db.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', user.id).n,
    },
    games: games.map((g) => ({ ...publicGame(g, ctx.origin), status: g.status, hiddenBy: g.hidden_by })),
  });
}

/**
 * Bans an account: {reason, addresses, days}. It's signed out everywhere and
 * can't sign in, its profile is gone and its public games are hidden
 * (hidden_by 'ban'). With addresses: true, the addresses it was used from
 * lately are banned too (bans.js), for days (default 30; 0 until lifted).
 */
export async function adminBan(ctx, username) {
  requireAdmin(ctx);
  const user = requireAccount(username);
  const body = ctx.request.headers.get('Content-Type') ? await readJson(ctx.request) : {};
  const reason = String(body.reason || '').slice(0, 500);
  db.tx(() => {
    db.run("UPDATE users SET status = 'banned', ban_reason = ?, updated_at = ? WHERE id = ?", reason, Date.now(), user.id);
    db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    db.run("UPDATE games SET status = 'hidden', hidden_by = 'ban' WHERE owner_id = ? AND status = 'public'", user.id);
  });
  let addresses = 0;
  if (body.addresses) addresses = banAddresses(addressesOf(user.id), reason || `account ${user.username}`, banDays(body.days));
  log('ban', `user:${user.username}`, addresses ? `${reason} (+${addresses} addresses)` : reason);
  return json({ username: user.username, status: 'banned', addressesBanned: addresses });
}

/** Lifts a ban; games hidden by the ban come back (others stay as they are). */
export function adminUnban(ctx, username) {
  requireAdmin(ctx);
  const user = requireAccount(username);
  db.tx(() => {
    db.run("UPDATE users SET status = 'active', ban_reason = NULL, updated_at = ? WHERE id = ?", Date.now(), user.id);
    db.run("UPDATE games SET status = 'public', hidden_by = NULL WHERE owner_id = ? AND hidden_by = 'ban'", user.id);
  });
  log('unban', `user:${user.username}`);
  return json({ username: user.username, status: 'active' });
}

function banDays(days) {
  const n = days === undefined || days === null || days === '' ? DEFAULT_BAN_DAYS : Number(days);
  if (!Number.isFinite(n) || n < 0 || n > 3650) throw new HttpError(422, 'days must be between 0 (until lifted) and 3650.');
  return Math.round(n);
}

/** The hashes a ban request names: {ip} (an address), {hash}, or {username} (its recent addresses). */
function addressTargets(ctx, body) {
  if (body.ip) return [ipHashOf(ctx.config, String(body.ip).trim())];
  if (body.hash) return [String(body.hash).trim()];
  if (body.username) return addressesOf(requireAccount(body.username).id);
  throw new HttpError(422, 'Name an ip, a hash or a username.');
}

/** Bans addresses: {ip | hash | username, reason, days}. */
export async function adminBanAddress(ctx) {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const hashes = addressTargets(ctx, body);
  const reason = String(body.reason || '').slice(0, 500);
  const days = banDays(body.days);
  const n = banAddresses(hashes, reason, days);
  log('ban-address', body.username ? `user:${body.username}` : body.hash ? `hash:${body.hash}` : 'ip', `${n} address(es), ${days ? `${days} days` : 'until lifted'}${reason ? `: ${reason}` : ''}`);
  return json({ banned: n, days });
}

/** Lifts address bans: {ip | hash | username}. */
export async function adminUnbanAddress(ctx) {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const n = unbanAddresses(addressTargets(ctx, body));
  log('unban-address', body.username ? `user:${body.username}` : body.hash ? `hash:${body.hash}` : 'ip', `${n} address(es)`);
  return json({ unbanned: n });
}

export function adminAddressBans(ctx) {
  requireAdmin(ctx);
  return json({ bans: listAddressBans() });
}

/** A one-time link (24 hours) to set a new password, for someone who lost theirs and their recovery codes. */
export function adminResetLink(ctx, username) {
  requireAdmin(ctx);
  const user = requireAccount(username);
  const url = createResetLink(ctx, user.id);
  log('reset-link', `user:${user.username}`);
  return json({ username: user.username, url, expiresInHours: 24 });
}

export async function adminDeleteUser(ctx, username) {
  requireAdmin(ctx);
  const user = requireAccount(username);
  await deleteUser(user.id, ctx.config);
  log('delete-user', `user:${user.username}`);
  return json({ username: user.username, deleted: true });
}

export function adminLog(ctx) {
  requireAdmin(ctx);
  return json({ log: db.all('SELECT at, action, target, detail FROM admin_log ORDER BY id DESC LIMIT 200') });
}

/**
 * What the server sees of this request: the client address it uses for rate
 * limits, and the forwarding headers. For checking a reverse proxy setup
 * (TRUST_PROXY) after deploying.
 */
export function adminRequestInfo(ctx) {
  requireAdmin(ctx);
  const h = ctx.request.headers;
  return json({
    clientIp: ctx.ip,
    peer: ctx.peer,
    trustProxy: ctx.config.trustProxy,
    xForwardedFor: h.get('X-Forwarded-For'),
    xForwardedProto: h.get('X-Forwarded-Proto'),
    host: h.get('Host'),
    publicOrigin: ctx.config.publicOrigin,
  });
}
