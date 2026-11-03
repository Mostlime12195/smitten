// The public API for games: publishing, updating, deleting, listing,
// playing, remixing and reporting. Handlers take a request context
// (server.js) and the path's parameters.

import { HttpError, json } from './http.js';
import { db, newId, rateLimit, ID_PATTERN } from './db.js';
import { actorKey, currentUser, ipHash, isAdmin, requireUser } from './auth.js';
import { GAME_FILE, THUMBNAIL_FILE, readGameFile, removeGameFiles, storeGameFiles } from './storage.js';
import { inspectZip } from './zip.js';
import { checkAddress, noteAddress } from './bans.js';
import {
  LIMITS, MODULES, REPORT_REASONS, USERNAME_RULES,
  cleanTitle, cleanDescription, cleanNote, cleanModules, cleanEngineVersion, inspectPng,
} from './validate.js';

const ID_RE = new RegExp(`^${ID_PATTERN}$`);
const mb = (n) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

export function limits(config) {
  return {
    gameBytes: config.maxGameBytes,
    thumbnailBytes: config.maxThumbnailBytes,
    title: LIMITS.title,
    description: LIMITS.description,
    note: LIMITS.note,
  };
}

/** The most an upload's body can be (server.js cuts off longer ones). */
export const uploadLimit = (config) => config.maxGameBytes + config.maxThumbnailBytes + 64 * 1024;

// ---------------------------------------------------------------------------
// Rows and what the API shows of them

const SELECT_GAME = `SELECT g.*, u.username AS owner_username, u.display_name AS owner_name, u.status AS owner_status
  FROM games g LEFT JOIN users u ON u.id = g.owner_id`;

export function getRow(id) {
  if (!ID_RE.test(id)) return null;
  return db.get(`${SELECT_GAME} WHERE g.id = ?`, id);
}

/** The public view of a game. URLs are absolute so the editor can use them. */
export function publicGame(row, origin) {
  const base = `${origin}/api/games/${row.id}`;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    owner: row.owner_username && row.owner_status === 'active' ? { username: row.owner_username, displayName: row.owner_name } : null,
    modules: JSON.parse(row.modules || '[]'),
    engineVersion: row.engine_version,
    version: row.version,
    plays: row.plays,
    size: row.game_size,
    remixOf: row.remix_of || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbnail: row.has_thumbnail ? `${base}/thumbnail.png?v=${row.version}` : null,
    gameUrl: `${base}/game.love`,
    playUrl: `${origin}/play/${row.id}`,
  };
}

const isOwner = (ctx, row) => {
  const user = currentUser(ctx);
  return Boolean(user && row.owner_id === user.id);
};

/** The row, if the game exists and this request may see it (hidden games: only the owner and admins). */
function visibleRow(ctx, id) {
  const row = getRow(id);
  if (!row) throw new HttpError(404, "This game doesn't exist, or it was deleted.");
  if (row.status !== 'public' && !isOwner(ctx, row) && !isAdmin(ctx)) {
    throw new HttpError(404, 'This game is hidden while a moderator reviews it.', { hidden: true });
  }
  return row;
}

/** The row, if the signed-in user owns the game. */
function ownedRow(ctx, id) {
  const user = requireUser(ctx, { editor: true });
  const row = getRow(id);
  if (!row) throw new HttpError(404, "This game doesn't exist, or it was deleted.");
  if (row.owner_id !== user.id) {
    throw new HttpError(403, row.owner_id
      ? 'This game belongs to another account.'
      : 'This game was published before accounts. Sign in from the browser you published it from to add it to your account.');
  }
  return { user, row };
}

// ---------------------------------------------------------------------------
// Reading an upload: multipart/form-data with
//   meta       JSON {title, description, modules, engineVersion, remixOf}
//   game       the .love (a zip), at most MAX_GAME_BYTES
//   thumbnail  optional PNG, at most MAX_THUMBNAIL_BYTES

async function readUpload(ctx) {
  const { request, config } = ctx;
  const lim = limits(config);
  const maxBody = uploadLimit(config);
  const tooBig = () => new HttpError(413, `The upload is too big. A game can be at most ${mb(lim.gameBytes)}.`, { field: 'game' });
  if (Number(request.headers.get('Content-Length') || 0) > maxBody) throw tooBig();
  if (!/^multipart\/form-data/i.test(request.headers.get('Content-Type') || '')) {
    throw new HttpError(415, 'Send the game as multipart/form-data with "meta" and "game" parts.');
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    if (ctx.bodyTooBig) throw tooBig();
    throw new HttpError(400, "The upload couldn't be read. Send multipart/form-data with \"meta\" and \"game\" parts.");
  }

  let meta;
  try {
    const part = form.get('meta');
    meta = JSON.parse(typeof part === 'string' ? part : await part?.text() ?? '');
  } catch {
    throw new HttpError(400, 'The "meta" part must be JSON: {"title": ..., "description": ...}.');
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new HttpError(400, 'The "meta" part must be a JSON object.');

  const fields = {
    title: cleanTitle(meta.title),
    description: cleanDescription(meta.description),
    modules: cleanModules(meta.modules),
    engineVersion: cleanEngineVersion(meta.engineVersion),
    remixOf: null,
  };
  if (meta.remixOf != null && meta.remixOf !== '') {
    if (typeof meta.remixOf !== 'string' || !ID_RE.test(meta.remixOf)) throw new HttpError(422, 'remixOf must be a game id.', { field: 'remixOf' });
    // A remix of a game that has since been deleted is just a game.
    if (getRow(meta.remixOf)) fields.remixOf = meta.remixOf;
  }

  const game = form.get('game');
  if (!game || typeof game === 'string') throw new HttpError(422, 'The upload has no game file (a "game" part with the .love).', { field: 'game' });
  if (game.size > lim.gameBytes) throw new HttpError(413, `The game is ${mb(game.size)}; the limit is ${mb(lim.gameBytes)}.`, { field: 'game' });
  const gameBytes = new Uint8Array(await game.arrayBuffer());
  inspectZip(gameBytes);

  let thumbnail = null;
  const thumb = form.get('thumbnail');
  if (thumb && typeof thumb !== 'string' && thumb.size > 0) {
    if (thumb.size > lim.thumbnailBytes) throw new HttpError(413, `The thumbnail is ${mb(thumb.size)}; the limit is ${mb(lim.thumbnailBytes)}.`, { field: 'thumbnail' });
    thumbnail = new Uint8Array(await thumb.arrayBuffer());
    inspectPng(thumbnail);
  }
  return { fields, gameBytes, thumbnail };
}

// ---------------------------------------------------------------------------
// Handlers

export function getConfig(ctx) {
  const { config } = ctx;
  return json({
    editorUrl: config.editorUrl,
    editorOrigins: config.editorOrigins,
    reportReasons: REPORT_REASONS,
    modules: MODULES,
    limits: limits(config),
    accounts: { hackclub: Boolean(config.hackclub), usernameRules: USERNAME_RULES },
  });
}

export async function publishGame(ctx) {
  const user = requireUser(ctx, { editor: true });
  checkAddress(ctx, 'publish games');
  rateLimit(`publish:u:${user.id}`, ctx.config.publishLimit, 'published');
  noteAddress(ctx, user.id);
  const { fields, gameBytes, thumbnail } = await readUpload(ctx);

  const id = newId();
  const now = Date.now();
  await storeGameFiles(id, gameBytes, thumbnail);
  try {
    db.run(
      `INSERT INTO games (id, owner_id, title, description, modules, engine_version, remix_of,
         has_thumbnail, game_size, version, plays, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'public', ?, ?)`,
      id, user.id, fields.title, fields.description, JSON.stringify(fields.modules), fields.engineVersion,
      fields.remixOf, thumbnail ? 1 : 0, gameBytes.length, now, now);
  } catch (e) {
    await removeGameFiles(id);
    throw e;
  }
  return json({ id, game: publicGame(getRow(id), ctx.origin) }, 201);
}

export async function updateGame(ctx, id) {
  const { user, row } = ownedRow(ctx, id);
  checkAddress(ctx, 'publish games');
  rateLimit(`publish:u:${user.id}`, ctx.config.publishLimit, 'published');
  noteAddress(ctx, user.id);
  const { fields, gameBytes, thumbnail } = await readUpload(ctx);

  const version = row.version + 1;
  await storeGameFiles(id, gameBytes, thumbnail);
  // remixOf is fixed when a game is first published. A hidden game stays
  // hidden until a moderator restores it.
  db.run(
    `UPDATE games SET title = ?, description = ?, modules = ?, engine_version = ?,
       has_thumbnail = ?, game_size = ?, version = ?, updated_at = ?
     WHERE id = ?`,
    fields.title, fields.description, JSON.stringify(fields.modules), fields.engineVersion,
    thumbnail ? 1 : 0, gameBytes.length, version, Date.now(), id);
  const updated = getRow(id);
  return json({ id, game: { ...publicGame(updated, ctx.origin), status: updated.status } });
}

export async function deleteGame(ctx, id) {
  ownedRow(ctx, id);
  await removeGame(id);
  return json({ id, deleted: true });
}

export async function removeGame(id) {
  db.tx(() => {
    db.run('DELETE FROM games WHERE id = ?', id);
    db.run('DELETE FROM reports WHERE game_id = ?', id);
    db.run('DELETE FROM plays WHERE game_id = ?', id);
  });
  await removeGameFiles(id);
}

export function listGames(ctx) {
  const { url } = ctx;
  const sort = url.searchParams.get('sort') === 'popular' ? 'popular' : 'new';
  const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const username = (url.searchParams.get('user') || '').trim().slice(0, 40);
  const limit = Math.min(48, Math.max(1, Number.parseInt(url.searchParams.get('limit'), 10) || 24));
  const offset = Math.min(10000, Math.max(0, Number.parseInt(url.searchParams.get('cursor'), 10) || 0));

  const where = ["g.status = 'public'"];
  const binds = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(g.title LIKE ? ESCAPE '\\' OR g.description LIKE ? ESCAPE '\\')");
    binds.push(like, like);
  }
  if (username) {
    where.push("u.username = ? AND u.status = 'active'");
    binds.push(username);
  }
  const order = sort === 'popular' ? 'g.plays DESC, g.created_at DESC' : 'g.created_at DESC';
  const results = db.all(`${SELECT_GAME} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...binds, limit + 1, offset);
  const more = results.length > limit;
  return json({
    sort,
    q,
    games: results.slice(0, limit).map((r) => publicGame(r, ctx.origin)),
    next: more ? String(offset + limit) : null,
  });
}

export function getGame(ctx, id) {
  const row = visibleRow(ctx, id);
  const game = publicGame(row, ctx.origin);
  if (row.remix_of) {
    const original = getRow(row.remix_of);
    game.remixOf = original && original.status === 'public'
      ? { id: original.id, title: original.title, playUrl: `${ctx.origin}/play/${original.id}` }
      : null;
  }
  game.remixes = db.get("SELECT COUNT(*) AS n FROM games WHERE remix_of = ? AND status = 'public'", id).n;
  if (row.status !== 'public') game.status = row.status;
  if (isOwner(ctx, row)) game.yours = true;
  return json({ game });
}

function slug(title) {
  return (title || 'game').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'game';
}

async function fileResponse(ctx, row, name, headers) {
  const file = await readGameFile(row.id, name, ctx.request);
  if (!file) return null;
  const h = new Headers({ ...headers, ETag: file.etag });
  if (file.notModified) return new Response(null, { status: 304, headers: h });
  h.set('Content-Length', String(file.size));
  return new Response(file.body, { headers: h });
}

/** The .love, at /api/games/<id>/game.love (or /<any name>.love: the player shows that name). */
export async function getGameFile(ctx, id) {
  const row = visibleRow(ctx, id);
  const res = await fileResponse(ctx, row, GAME_FILE, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${slug(row.title)}.love"`,
    'Cache-Control': row.status === 'public' ? 'public, max-age=0, must-revalidate' : 'private, no-store',
  });
  if (!res) throw new HttpError(404, "This game's file is missing.");
  return res;
}

export async function getThumbnail(ctx, id) {
  const row = visibleRow(ctx, id);
  const res = row.has_thumbnail ? await fileResponse(ctx, row, THUMBNAIL_FILE, {
    'Content-Type': 'image/png',
    'Cache-Control': row.status === 'public' ? 'public, max-age=86400' : 'private, no-store',
  }) : null;
  if (!res) throw new HttpError(404, 'This game has no thumbnail.');
  return res;
}

/** Counts a play: one per person (account, or IP address) per game per day. */
export function countPlay(ctx, id) {
  const row = getRow(id);
  if (!row || row.status !== 'public') throw new HttpError(404, "This game doesn't exist, or it was deleted.");
  const day = Math.floor(Date.now() / 86400_000);
  const inserted = db.run('INSERT OR IGNORE INTO plays (game_id, viewer, day) VALUES (?, ?, ?)', id, actorKey(ctx), day);
  let plays = row.plays;
  if (inserted.changes > 0) {
    plays = db.get('UPDATE games SET plays = plays + 1 WHERE id = ? RETURNING plays', id).plays;
    // Only today's rows are needed for de-duplication.
    if (Math.random() < 0.02) db.run('DELETE FROM plays WHERE day < ?', day - 1);
  }
  return json({ id, plays, counted: inserted.changes > 0 });
}

/**
 * Reports a game. Each reporter (an account, or an IP address for people
 * who aren't signed in) has one open report per game; REPORT_THRESHOLD open
 * reports from different reporters hide the game until a moderator restores it.
 */
export async function reportGame(ctx, id) {
  const { request, config } = ctx;
  if (!/^application\/json/i.test(request.headers.get('Content-Type') || '')) {
    throw new HttpError(415, 'Send the report as JSON: {"reason": ..., "note": ...}.');
  }
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    throw new HttpError(400, 'The report must be JSON: {"reason": ..., "note": ...}.');
  }
  const reason = REPORT_REASONS.find((r) => r.id === body?.reason);
  if (!reason) throw new HttpError(422, `Pick a reason: ${REPORT_REASONS.map((r) => r.id).join(', ')}.`, { field: 'reason' });
  const note = cleanNote(body.note);

  const row = getRow(id);
  if (!row) throw new HttpError(404, "This game doesn't exist, or it was deleted.");
  if (row.status !== 'public') return json({ ok: true, hidden: true });

  const who = actorKey(ctx);
  checkAddress(ctx, 'report games');
  // Signed-in or not, each address has the same hourly limit.
  rateLimit(`report:ip:${ipHash(ctx)}`, config.reportLimit, 'sent reports');
  if (who.startsWith('u:')) rateLimit(`report:${who}`, config.reportLimit, 'sent reports');
  if (db.get('SELECT id FROM reports WHERE game_id = ? AND reporter = ? AND resolved = 0', id, who)) {
    return json({ ok: true, hidden: false, alreadyReported: true });
  }

  db.run('INSERT INTO reports (game_id, reason, note, reporter, created_at) VALUES (?, ?, ?, ?, ?)', id, reason.id, note, who, Date.now());
  const open = db.get('SELECT COUNT(DISTINCT reporter) AS n FROM reports WHERE game_id = ? AND resolved = 0', id).n;
  let hidden = false;
  if (open >= config.reportThreshold) {
    db.run("UPDATE games SET status = 'hidden', hidden_by = 'reports' WHERE id = ? AND status = 'public'", id);
    hidden = true;
  }
  return json({ ok: true, hidden });
}
