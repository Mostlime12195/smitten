// Cloud saves: a few values per account and game that a game's scripts
// keep with smitten.cloud, through the game's page (public/play-cloud.js).
//
// Only a signed-in person has cloud saves: a guest's calls answer 401
// (the game gets "signed-out"). A value is the game's JSON text, kept as
// it is. The limits (config.cloud): valueBytes for one value, gameBytes
// and keys for all the values of one game on one account, and writeLimit
// and readLimit calls per hour per account. Deleting the account or the
// game deletes its saves (foreign keys, migrations/0007_cloud_saves.sql);
// the account page lists them by game and deletes them.

import { HttpError, json, readJson } from './http.js';
import { db, rateLimit } from './db.js';
import { requireSameOrigin, requireUser } from './auth.js';
import { visibleRow } from './games.js';

// The same rule as the engine's (love/src/modules/cloud): a key never is "." or ".." in a URL.
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** The signed-in person, asking from the site's own pages. */
function player(ctx) {
  requireSameOrigin(ctx);
  return requireUser(ctx);
}

function cleanKey(key) {
  if (!KEY.test(key)) throw new HttpError(422, 'A save key is 1 to 64 letters, digits, _, . or -, and starts with a letter or a digit.', { code: 'bad-key', field: 'key' });
  return key;
}

function limits(config) {
  const { valueBytes, gameBytes, keys } = config.cloud;
  return { valueBytes, gameBytes, keys };
}

const publicSave = (s) => ({ key: s.key, size: s.size, at: s.updated_at });

function usage(userId, gameId) {
  return db.get('SELECT COUNT(*) AS keys, COALESCE(SUM(size), 0) AS bytes FROM cloud_saves WHERE user_id = ? AND game_id = ?', userId, gameId);
}

/** GET /api/games/<id>/saves: the keys the signed-in person has for the game, with sizes and times. */
export function listSaves(ctx, id) {
  const user = player(ctx);
  const game = visibleRow(ctx, id);
  rateLimit(`cloud:r:${user.id}`, ctx.config.cloud.readLimit, 'loaded cloud saves');
  const saves = db.all('SELECT key, size, updated_at FROM cloud_saves WHERE user_id = ? AND game_id = ? ORDER BY key', user.id, game.id);
  const used = usage(user.id, game.id);
  return json({ saves: saves.map(publicSave), used: { keys: used.keys, bytes: used.bytes }, limits: limits(ctx.config) });
}

/** GET /api/games/<id>/saves/<key>: {key, data, size, at}, or 404 {code: 'missing'}. */
export function getSave(ctx, id, key) {
  const user = player(ctx);
  const game = visibleRow(ctx, id);
  const k = cleanKey(key);
  rateLimit(`cloud:r:${user.id}`, ctx.config.cloud.readLimit, 'loaded cloud saves');
  const save = db.get('SELECT * FROM cloud_saves WHERE user_id = ? AND game_id = ? AND key = ?', user.id, game.id, k);
  if (!save) throw new HttpError(404, 'There is no cloud save with this key.', { code: 'missing' });
  return json({ ...publicSave(save), data: save.data });
}

/**
 * PUT /api/games/<id>/saves/<key> {data}: data is JSON text. 413 too-big
 * past valueBytes; 409 quota past gameBytes or keys. {key, size, at}.
 */
export async function putSave(ctx, id, key) {
  const user = player(ctx);
  const { config } = ctx;
  // The JSON text inside a JSON body: escaped, it can be about twice as long.
  const body = await readJson(ctx.request, 2 * config.cloud.valueBytes + 1024);
  const game = visibleRow(ctx, id);
  const k = cleanKey(key);
  rateLimit(`cloud:w:${user.id}`, config.cloud.writeLimit, 'saved to the cloud');

  if (typeof body.data !== 'string') throw new HttpError(422, 'data must be JSON text.', { code: 'bad-value', field: 'data' });
  const size = Buffer.byteLength(body.data);
  if (size > config.cloud.valueBytes) {
    throw new HttpError(413, `A cloud save can be ${config.cloud.valueBytes} bytes at most.`, { code: 'too-big' });
  }
  try {
    JSON.parse(body.data);
  } catch {
    throw new HttpError(422, 'data must be JSON text.', { code: 'bad-value', field: 'data' });
  }

  const now = Date.now();
  db.tx(() => {
    const old = db.get('SELECT size FROM cloud_saves WHERE user_id = ? AND game_id = ? AND key = ?', user.id, game.id, k);
    const used = usage(user.id, game.id);
    if (!old && used.keys >= config.cloud.keys) {
      throw new HttpError(409, `A game can keep ${config.cloud.keys} cloud saves at most. Remove one first.`, { code: 'quota' });
    }
    if (used.bytes - (old ? old.size : 0) + size > config.cloud.gameBytes) {
      throw new HttpError(409, `The cloud saves of a game can be ${config.cloud.gameBytes} bytes at most together.`, { code: 'quota' });
    }
    db.run(
      `INSERT INTO cloud_saves (user_id, game_id, key, data, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, game_id, key) DO UPDATE SET data = excluded.data, size = excluded.size, updated_at = excluded.updated_at`,
      user.id, game.id, k, body.data, size, now, now);
  });
  return json({ key: k, size, at: now });
}

/** DELETE /api/games/<id>/saves/<key>: {deleted} (false when there was none). */
export function deleteSave(ctx, id, key) {
  const user = player(ctx);
  const game = visibleRow(ctx, id);
  const k = cleanKey(key);
  rateLimit(`cloud:w:${user.id}`, ctx.config.cloud.writeLimit, 'saved to the cloud');
  const res = db.run('DELETE FROM cloud_saves WHERE user_id = ? AND game_id = ? AND key = ?', user.id, game.id, k);
  return json({ deleted: res.changes > 0 });
}

/** GET /api/account/saves: the games the person has cloud saves for, newest first. */
export function accountSaves(ctx) {
  const user = player(ctx);
  const rows = db.all(
    `SELECT s.game_id, g.title, COUNT(*) AS keys, SUM(s.size) AS bytes, MAX(s.updated_at) AS at
     FROM cloud_saves s JOIN games g ON g.id = s.game_id
     WHERE s.user_id = ? GROUP BY s.game_id ORDER BY at DESC LIMIT 500`, user.id);
  return json({
    games: rows.map((r) => ({ id: r.game_id, title: r.title, keys: r.keys, size: r.bytes, at: r.at })),
    limits: limits(ctx.config),
  });
}

/** DELETE /api/account/saves/<game id>: every cloud save of that game on this account. */
export function deleteAccountSaves(ctx, id) {
  const user = player(ctx);
  const res = db.run('DELETE FROM cloud_saves WHERE user_id = ? AND game_id = ?', user.id, id);
  return json({ deleted: Number(res.changes) });
}
