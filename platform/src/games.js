// The public API: publishing, updating, deleting, listing, playing,
// remixing and reporting games.

import { HttpError, json } from './http.js';
import { ensureSchema, sha256Hex, safeEqual, newId, newToken, ipHash, rateLimit, intVar, ID_PATTERN } from './db.js';
import { inspectZip } from './zip.js';
import {
  LIMITS, MODULES, REPORT_REASONS,
  cleanTitle, cleanDescription, cleanNote, cleanModules, cleanEngineVersion, inspectPng,
} from './validate.js';

const ID_RE = new RegExp(`^${ID_PATTERN}$`);
const gameKey = (id) => `games/${id}/game.love`;
const thumbKey = (id) => `games/${id}/thumbnail.png`;

export function limits(env) {
  return {
    gameBytes: intVar(env, 'MAX_GAME_BYTES', 25 * 1024 * 1024),
    thumbnailBytes: intVar(env, 'MAX_THUMBNAIL_BYTES', 1024 * 1024),
    title: LIMITS.title,
    description: LIMITS.description,
    note: LIMITS.note,
  };
}

const mb = (n) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

// ---------------------------------------------------------------------------
// Rows and what the API shows of them

async function getRow(env, id) {
  if (!ID_RE.test(id)) return null;
  return env.DB.prepare('SELECT * FROM games WHERE id = ?1').bind(id).first();
}

/** The public view of a game. URLs are absolute so the editor can use them. */
export function publicGame(row, origin) {
  const base = `${origin}/api/games/${row.id}`;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
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

function bearer(request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  return m ? m[1] : null;
}

export async function isAdmin(request, env) {
  const token = bearer(request);
  return Boolean(token && env.ADMIN_TOKEN && await safeEqual(token, env.ADMIN_TOKEN));
}

async function isOwner(request, row) {
  const token = bearer(request);
  return Boolean(token && await safeEqual(await sha256Hex(token), row.token_hash));
}

/** The row, if the game exists and this request may see it (hidden games: only the owner and admins). */
async function visibleRow(request, env, id) {
  const row = await getRow(env, id);
  if (!row) throw new HttpError(404, "This game doesn't exist, or it was deleted.");
  if (row.status !== 'public' && !(await isOwner(request, row)) && !(await isAdmin(request, env))) {
    throw new HttpError(404, 'This game is hidden while a moderator reviews it.', { hidden: true });
  }
  return row;
}

/** The row, if the request carries the game's edit token. */
async function ownedRow(request, env, id) {
  const row = await getRow(env, id);
  if (!row) throw new HttpError(404, "This game doesn't exist, or it was deleted.");
  if (!bearer(request)) throw new HttpError(401, 'Updating or deleting a game needs its edit token (Authorization: Bearer <token>).');
  if (!(await isOwner(request, row))) throw new HttpError(403, "That edit token isn't for this game.");
  return row;
}

// ---------------------------------------------------------------------------
// Reading an upload: multipart/form-data with
//   meta       JSON {title, description, modules, engineVersion, remixOf}
//   game       the .love (a zip), at most MAX_GAME_BYTES
//   thumbnail  optional PNG, at most MAX_THUMBNAIL_BYTES

async function readUpload(request, env) {
  const lim = limits(env);
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > lim.gameBytes + lim.thumbnailBytes + 64 * 1024) {
    throw new HttpError(413, `The upload is too big. A game can be at most ${mb(lim.gameBytes)}.`, { field: 'game' });
  }
  if (!/^multipart\/form-data/i.test(request.headers.get('Content-Type') || '')) {
    throw new HttpError(415, 'Send the game as multipart/form-data with "meta" and "game" parts.');
  }
  let form;
  try {
    form = await request.formData();
  } catch {
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
    if (await getRow(env, meta.remixOf)) fields.remixOf = meta.remixOf;
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

async function storeFiles(env, id, gameBytes, thumbnail, version) {
  await env.GAMES.put(gameKey(id), gameBytes, {
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: { version: String(version) },
  });
  if (thumbnail) {
    await env.GAMES.put(thumbKey(id), thumbnail, { httpMetadata: { contentType: 'image/png' } });
  } else {
    await env.GAMES.delete(thumbKey(id));
  }
}

// ---------------------------------------------------------------------------
// Handlers

export async function getConfig(request, env) {
  return json({
    editorUrl: env.EDITOR_URL || 'http://localhost:8766/',
    reportReasons: REPORT_REASONS,
    modules: MODULES,
    limits: limits(env),
  });
}

export async function publishGame(request, env, origin) {
  await ensureSchema(env);
  await rateLimit(env, `publish:${await ipHash(request, env)}`, intVar(env, 'PUBLISH_LIMIT_PER_HOUR', 10), 'published');
  const { fields, gameBytes, thumbnail } = await readUpload(request, env);

  const id = newId();
  const token = newToken();
  const now = Date.now();
  await storeFiles(env, id, gameBytes, thumbnail, 1);
  try {
    await env.DB.prepare(
      `INSERT INTO games (id, title, description, modules, engine_version, remix_of, token_hash,
         has_thumbnail, game_size, version, plays, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 0, 'public', ?10, ?10)`,
    ).bind(id, fields.title, fields.description, JSON.stringify(fields.modules), fields.engineVersion,
      fields.remixOf, await sha256Hex(token), thumbnail ? 1 : 0, gameBytes.length, now).run();
  } catch (e) {
    await env.GAMES.delete([gameKey(id), thumbKey(id)]);
    throw e;
  }
  const row = await getRow(env, id);
  return json({ id, token, game: publicGame(row, origin) }, 201);
}

export async function updateGame(request, env, origin, id) {
  await ensureSchema(env);
  const row = await ownedRow(request, env, id);
  await rateLimit(env, `publish:${await ipHash(request, env)}`, intVar(env, 'PUBLISH_LIMIT_PER_HOUR', 10), 'published');
  const { fields, gameBytes, thumbnail } = await readUpload(request, env);

  const version = row.version + 1;
  await storeFiles(env, id, gameBytes, thumbnail, version);
  // remixOf is fixed when a game is first published. A hidden game stays
  // hidden until a moderator restores it.
  await env.DB.prepare(
    `UPDATE games SET title = ?2, description = ?3, modules = ?4, engine_version = ?5,
       has_thumbnail = ?6, game_size = ?7, version = ?8, updated_at = ?9
     WHERE id = ?1`,
  ).bind(id, fields.title, fields.description, JSON.stringify(fields.modules), fields.engineVersion,
    thumbnail ? 1 : 0, gameBytes.length, version, Date.now()).run();
  const updated = await getRow(env, id);
  return json({ id, game: { ...publicGame(updated, origin), status: updated.status } });
}

export async function deleteGame(request, env, origin, id) {
  await ensureSchema(env);
  await ownedRow(request, env, id);
  await removeGame(env, id);
  return json({ id, deleted: true });
}

export async function removeGame(env, id) {
  await env.GAMES.delete([gameKey(id), thumbKey(id)]);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM games WHERE id = ?1').bind(id),
    env.DB.prepare('DELETE FROM reports WHERE game_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM plays WHERE game_id = ?1').bind(id),
  ]);
}

export async function listGames(request, env, origin) {
  await ensureSchema(env);
  const url = new URL(request.url);
  const sort = url.searchParams.get('sort') === 'popular' ? 'popular' : 'new';
  const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const limit = Math.min(48, Math.max(1, Number.parseInt(url.searchParams.get('limit'), 10) || 24));
  const offset = Math.min(10000, Math.max(0, Number.parseInt(url.searchParams.get('cursor'), 10) || 0));

  const where = ["status = 'public'"];
  const binds = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    binds.push(like);
    where.push(`(title LIKE ?${binds.length} ESCAPE '\\' OR description LIKE ?${binds.length} ESCAPE '\\')`);
  }
  const order = sort === 'popular' ? 'plays DESC, created_at DESC' : 'created_at DESC';
  binds.push(limit + 1, offset);
  const { results } = await env.DB.prepare(
    `SELECT * FROM games WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?${binds.length - 1} OFFSET ?${binds.length}`,
  ).bind(...binds).all();
  const more = results.length > limit;
  return json({
    sort,
    q,
    games: results.slice(0, limit).map((r) => publicGame(r, origin)),
    next: more ? String(offset + limit) : null,
  });
}

export async function getGame(request, env, origin, id) {
  await ensureSchema(env);
  const row = await visibleRow(request, env, id);
  const game = publicGame(row, origin);
  if (row.remix_of) {
    const original = await getRow(env, row.remix_of);
    game.remixOf = original && original.status === 'public'
      ? { id: original.id, title: original.title, playUrl: `${origin}/play/${original.id}` }
      : null;
  }
  const remixes = await env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE remix_of = ?1 AND status = 'public'").bind(id).first();
  game.remixes = remixes?.n || 0;
  if (row.status !== 'public') game.status = row.status;
  return json({ game });
}

function slug(title) {
  return (title || 'game').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'game';
}

/** The .love, at /api/games/<id>/game.love (or /<any name>.love: the player shows that name). */
export async function getGameFile(request, env, origin, id) {
  await ensureSchema(env);
  const row = await visibleRow(request, env, id);
  const object = await env.GAMES.get(gameKey(id), { onlyIf: request.headers });
  if (!object) throw new HttpError(404, "This game's file is missing.");
  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${slug(row.title)}.love"`,
    ETag: object.httpEtag,
    'Cache-Control': row.status === 'public' ? 'public, max-age=0, must-revalidate' : 'private, no-store',
  });
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export async function getThumbnail(request, env, origin, id) {
  await ensureSchema(env);
  const row = await visibleRow(request, env, id);
  const object = row.has_thumbnail ? await env.GAMES.get(thumbKey(id), { onlyIf: request.headers }) : null;
  if (!object) throw new HttpError(404, 'This game has no thumbnail.');
  const headers = new Headers({
    'Content-Type': 'image/png',
    ETag: object.httpEtag,
    'Cache-Control': row.status === 'public' ? 'public, max-age=86400' : 'private, no-store',
  });
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

/** Counts a play: one per person (IP address) per game per day. */
export async function countPlay(request, env, origin, id) {
  await ensureSchema(env);
  const row = await getRow(env, id);
  if (!row || row.status !== 'public') throw new HttpError(404, "This game doesn't exist, or it was deleted.");
  const day = Math.floor(Date.now() / 86400_000);
  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO plays (game_id, ip_hash, day) VALUES (?1, ?2, ?3)')
    .bind(id, await ipHash(request, env), day).run();
  let plays = row.plays;
  if (inserted.meta.changes > 0) {
    const updated = await env.DB.prepare('UPDATE games SET plays = plays + 1 WHERE id = ?1 RETURNING plays').bind(id).first();
    plays = updated.plays;
    // Only today's rows are needed for de-duplication.
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM plays WHERE day < ?1').bind(day - 1).run();
  }
  return json({ id, plays, counted: inserted.meta.changes > 0 });
}

/**
 * Reports a game. Each person (IP address) has one open report per game;
 * REPORT_THRESHOLD open reports from different people hide the game until a
 * moderator restores it.
 */
export async function reportGame(request, env, origin, id) {
  await ensureSchema(env);
  if (!/^application\/json/i.test(request.headers.get('Content-Type') || '')) {
    throw new HttpError(415, 'Send the report as JSON: {"reason": ..., "note": ...}.');
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'The report must be JSON: {"reason": ..., "note": ...}.');
  }
  const reason = REPORT_REASONS.find((r) => r.id === body?.reason);
  if (!reason) throw new HttpError(422, `Pick a reason: ${REPORT_REASONS.map((r) => r.id).join(', ')}.`, { field: 'reason' });
  const note = cleanNote(body.note);

  const row = await getRow(env, id);
  if (!row) throw new HttpError(404, "This game doesn't exist, or it was deleted.");
  if (row.status !== 'public') return json({ ok: true, hidden: true });

  const who = await ipHash(request, env);
  await rateLimit(env, `report:${who}`, intVar(env, 'REPORT_LIMIT_PER_HOUR', 20), 'sent reports');
  const existing = await env.DB.prepare('SELECT id FROM reports WHERE game_id = ?1 AND ip_hash = ?2 AND resolved = 0')
    .bind(id, who).first();
  if (existing) return json({ ok: true, hidden: false, alreadyReported: true });

  await env.DB.prepare('INSERT INTO reports (game_id, reason, note, ip_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, reason.id, note, who, Date.now()).run();
  const open = await env.DB.prepare('SELECT COUNT(DISTINCT ip_hash) AS n FROM reports WHERE game_id = ?1 AND resolved = 0')
    .bind(id).first();
  const threshold = Math.max(1, intVar(env, 'REPORT_THRESHOLD', 3));
  let hidden = false;
  if (open.n >= threshold) {
    await env.DB.prepare("UPDATE games SET status = 'hidden', hidden_by = 'reports' WHERE id = ?1 AND status = 'public'").bind(id).run();
    hidden = true;
  }
  return json({ ok: true, hidden });
}
