// Leaderboards: optional score tables on a game. Its owner makes a board
// (on their account page), and the game's scripts send and read scores
// with smitten.boards, through the game's page (public/play.js).
//
// Scores come from the game running in the player's browser, so anyone who
// wants to can send a made-up one. The checks here keep that within bounds
// (a number, inside the board's range, a few per hour, a clean name); they
// can't tell a real score from a fake one. Boards are for fun: the owner
// can remove scores and reset a board.

import { HttpError, json, readJson } from './http.js';
import { db, hmac, rateLimit } from './db.js';
import { currentUser, ipHash, isAdmin, requireSameOrigin } from './auth.js';
import { checkAddress } from './bans.js';
import { ownedRow, visibleRow } from './games.js';
import { cleanBoardKey, cleanBoardTitle, cleanBoardUnit, cleanBound, cleanGuestName, cleanScore } from './validate.js';

const SORTS = ['high', 'low'];
const KEEPS = ['best', 'all'];
const FORMATS = ['number', 'time'];

// The most a score request's body can be: {"value": ..., "name": "..."}.
const SCORE_BODY = 1024;

// ---------------------------------------------------------------------------
// Rows

/** What the API shows of a board. */
function publicBoard(b, scores = undefined) {
  const out = {
    key: b.key,
    title: b.title,
    order: b.sort,
    keep: b.keep,
    format: b.format,
    unit: b.unit,
    min: b.min_value,
    max: b.max_value,
  };
  if (scores !== undefined) out.scores = scores;
  return out;
}

/** A game's boards, oldest first (games.js adds them to a game's details). */
export function boardsOf(gameId) {
  return db.all('SELECT * FROM boards WHERE game_id = ? ORDER BY id', gameId).map((b) => publicBoard(b));
}

function boardRow(gameId, key) {
  const board = typeof key === 'string' ? db.get('SELECT * FROM boards WHERE game_id = ? AND key = ?', gameId, key) : null;
  if (!board) throw new HttpError(404, 'This game has no leaderboard with that key.', { code: 'no-board' });
  return board;
}

/** The game, for its owner (web session or editor token) or a moderator. */
function managedGame(ctx, id) {
  if (isAdmin(ctx)) {
    const row = visibleRow(ctx, id);
    return { row, admin: true };
  }
  return { row: ownedRow(ctx, id).row, admin: false };
}

function logAdmin(admin, action, target, detail = '') {
  if (admin) db.run('INSERT INTO admin_log (at, action, target, detail) VALUES (?, ?, ?, ?)', Date.now(), action, target, String(detail).slice(0, 500));
}

// Scores of banned accounts aren't shown or counted.
const SHOWN = "(s.user_id IS NULL OR u.status = 'active')";
const FROM = 'FROM scores s LEFT JOIN users u ON u.id = s.user_id';
// Best first; of equal scores, the earlier one.
const ranking = (board) => `s.value ${board.sort === 'low' ? 'ASC' : 'DESC'}, s.created_at ASC, s.id ASC`;
const better = (board) => (board.sort === 'low' ? '<' : '>');

/** Who is asking, as scores remember players; null for a guest without a name. */
function playerKey(ctx, user, name) {
  if (user) return `u:${user.id}`;
  if (name == null) return null;
  // A guest is an address and a name, hashed with the server's secret.
  return `g:${hmac(ctx.config.secret, `board-guest|${ctx.ip}|${name.toLowerCase()}`).slice(0, 32)}`;
}

/** 1 + how many shown scores beat value. Equal scores share a rank. */
function rankOf(board, value) {
  return 1 + db.get(`SELECT COUNT(*) AS n ${FROM} WHERE s.board_id = ? AND ${SHOWN} AND s.value ${better(board)} ?`, board.id, value).n;
}

/** A player's best score on a board: {row, rank, position (rows before it)}, or null. */
function standing(board, player) {
  if (!player) return null;
  const row = db.get(`SELECT s.* ${FROM} WHERE s.board_id = ? AND s.player = ? AND ${SHOWN} ORDER BY ${ranking(board)} LIMIT 1`, board.id, player);
  if (!row) return null;
  const rank = rankOf(board, row.value);
  const tied = db.get(
    `SELECT COUNT(*) AS n ${FROM} WHERE s.board_id = ? AND ${SHOWN} AND s.value = ?
       AND (s.created_at < ? OR (s.created_at = ? AND s.id < ?))`,
    board.id, row.value, row.created_at, row.created_at, row.id).n;
  return { row, rank, position: rank - 1 + tied };
}

// ---------------------------------------------------------------------------
// Reading

/** GET /api/games/<id>/boards: the game's boards and how many scores each has. */
export function listBoards(ctx, id) {
  const row = visibleRow(ctx, id);
  const boards = db.all(
    `SELECT b.*, (SELECT COUNT(*) FROM scores s WHERE s.board_id = b.id) AS n
     FROM boards b WHERE b.game_id = ? ORDER BY b.id`, row.id);
  return json({ boards: boards.map((b) => publicBoard(b, b.n)), limit: ctx.config.boardsPerGame });
}

/**
 * GET /api/games/<id>/boards/<key>?limit=10&around=1&name=<guest name>:
 * the top scores, or with around=1 the ones around the asker's own (the
 * top when they have none). The asker is the signed-in account, or the
 * guest called name at this address.
 */
export function getBoard(ctx, id, key) {
  const game = visibleRow(ctx, id);
  const board = boardRow(game.id, key);
  const { searchParams } = ctx.url;
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit'), 10) || 10));
  let name = null;
  try {
    if (searchParams.get('name')) name = cleanGuestName(searchParams.get('name'));
  } catch { /* a name that can't be on the board marks nothing */ }
  const me = playerKey(ctx, currentUser(ctx), name);
  const mine = standing(board, me);

  let offset = 0;
  if (mine && searchParams.get('around') === '1') offset = Math.max(0, mine.position - Math.floor((limit - 1) / 2));
  const rows = db.all(
    `SELECT s.id, s.player, s.name, s.value, s.created_at, u.username, u.display_name
     ${FROM} WHERE s.board_id = ? AND ${SHOWN} ORDER BY ${ranking(board)} LIMIT ? OFFSET ?`, board.id, limit, offset);
  let rank = 0;
  let previous = null;
  const scores = rows.map((s, i) => {
    // The number of rows before a score that differs from the one before it
    // is the number of better scores.
    if (s.value !== previous) rank = i === 0 && offset > 0 ? rankOf(board, s.value) : offset + i + 1;
    previous = s.value;
    const out = { id: s.id, rank, name: s.username ? s.display_name : s.name, value: s.value, at: s.created_at };
    if (s.username) out.username = s.username;
    else out.guest = true;
    if (s.player === me) out.me = true;
    return out;
  });
  return json({
    board: publicBoard(board),
    scores,
    you: mine ? { rank: mine.rank, value: mine.row.value } : null,
  });
}

// ---------------------------------------------------------------------------
// Sending a score

/**
 * POST /api/games/<id>/boards/<key>/scores {value, name}: from the game's
 * page only. Signed in, the score is the account's; otherwise a guest's,
 * under the name the game gives. {value, rank, improved, kept}.
 */
export async function submitScore(ctx, id, key) {
  requireSameOrigin(ctx);
  const body = await readJson(ctx.request, SCORE_BODY);
  const game = visibleRow(ctx, id);
  if (game.status !== 'public') throw new HttpError(404, 'This game is hidden while a moderator reviews it.', { hidden: true, code: 'hidden' });
  const board = boardRow(game.id, key);
  checkAddress(ctx, 'send scores');

  const { config } = ctx;
  const user = currentUser(ctx);
  rateLimit(`score:ip:${ipHash(ctx)}`, config.scoreAddressLimit, 'sent scores');
  if (user) rateLimit(`score:u:${user.id}`, config.scoreLimit, 'sent scores');

  const value = cleanScore(body.value);
  if ((board.min_value != null && value < board.min_value) || (board.max_value != null && value > board.max_value)) {
    throw new HttpError(422, "That score is outside this leaderboard's range.", { field: 'value', code: 'out-of-range' });
  }
  const name = user ? '' : cleanGuestName(body.name);
  const player = playerKey(ctx, user, name);
  const now = Date.now();

  let improved = true;
  db.tx(() => {
    if (board.keep === 'best') {
      const old = db.get('SELECT id, value FROM scores WHERE board_id = ? AND player = ?', board.id, player);
      if (old) {
        improved = board.sort === 'low' ? value < old.value : value > old.value;
        // The guest's name as they wrote it this time ("ada" then "Ada").
        if (improved) db.run('UPDATE scores SET value = ?, created_at = ?, name = ? WHERE id = ?', value, now, name, old.id);
        return;
      }
    }
    db.run('INSERT INTO scores (board_id, player, user_id, name, value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      board.id, player, user ? user.id : null, name, value, now);
    // Only the best boardMaxScores are kept.
    db.run(
      `DELETE FROM scores WHERE id IN
         (SELECT s.id FROM scores s WHERE s.board_id = ? ORDER BY ${ranking(board)} LIMIT -1 OFFSET ?)`,
      board.id, config.boardMaxScores);
  });

  const mine = standing(board, player);
  return json({
    ok: true,
    // The player's best on this board, and where it stands. kept is false
    // when the board is full of better scores.
    value: mine ? mine.row.value : value,
    rank: mine ? mine.rank : null,
    improved: Boolean(mine) && improved,
    kept: Boolean(mine),
  }, 201);
}

// ---------------------------------------------------------------------------
// The owner's side (and moderators')

function boardFields(body, old = null) {
  const pick = (name, allowed, fallback) => {
    if (body[name] == null) return fallback;
    if (!allowed.includes(body[name])) throw new HttpError(422, `${name} must be ${allowed.map((a) => `"${a}"`).join(' or ')}.`, { field: name });
    return body[name];
  };
  const has = (name) => Object.hasOwn(body, name);
  const fields = {
    title: has('title') || !old ? cleanBoardTitle(body.title) : old.title,
    sort: pick('order', SORTS, old ? old.sort : 'high'),
    keep: pick('keep', KEEPS, old ? old.keep : 'best'),
    format: pick('format', FORMATS, old ? old.format : 'number'),
    unit: has('unit') || !old ? cleanBoardUnit(body.unit) : old.unit,
    min: has('min') || !old ? cleanBound('min', body.min) : old.min_value,
    max: has('max') || !old ? cleanBound('max', body.max) : old.max_value,
  };
  if (fields.min != null && fields.max != null && fields.min > fields.max) {
    throw new HttpError(422, 'min must not be more than max.', { field: 'min' });
  }
  return fields;
}

/** POST /api/games/<id>/boards {key, title, order, keep, format, unit, min, max}. */
export async function createBoard(ctx, id) {
  const { row, admin } = managedGame(ctx, id);
  const body = await readJson(ctx.request);
  const key = cleanBoardKey(body.key);
  const f = boardFields(body);
  const { boardsPerGame } = ctx.config;
  if (db.get('SELECT COUNT(*) AS n FROM boards WHERE game_id = ?', row.id).n >= boardsPerGame) {
    throw new HttpError(409, `A game can have ${boardsPerGame} leaderboard${boardsPerGame === 1 ? '' : 's'} at most.`, { code: 'too-many-boards' });
  }
  if (db.get('SELECT 1 FROM boards WHERE game_id = ? AND key = ?', row.id, key)) {
    throw new HttpError(409, `This game already has a leaderboard with the key "${key}".`, { field: 'key' });
  }
  const now = Date.now();
  db.run(
    `INSERT INTO boards (game_id, key, title, sort, keep, format, unit, min_value, max_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, key, f.title, f.sort, f.keep, f.format, f.unit, f.min, f.max, now, now);
  logAdmin(admin, 'board-create', `game:${row.id}`, key);
  return json({ board: publicBoard(boardRow(row.id, key), 0) }, 201);
}

/**
 * PATCH /api/games/<id>/boards/<key>: any of title, order, keep, format,
 * unit, min, max. The key stays (scripts use it). The order can only change
 * while the board is empty: kept scores were the best the other way round.
 */
export async function updateBoard(ctx, id, key) {
  const { row, admin } = managedGame(ctx, id);
  const board = boardRow(row.id, key);
  const f = boardFields(await readJson(ctx.request), board);
  const count = db.get('SELECT COUNT(*) AS n FROM scores WHERE board_id = ?', board.id).n;
  if (f.sort !== board.sort && count > 0) {
    throw new HttpError(409, 'Reset the leaderboard before changing which scores win.', { field: 'order', code: 'not-empty' });
  }
  db.tx(() => {
    db.run('UPDATE boards SET title = ?, sort = ?, keep = ?, format = ?, unit = ?, min_value = ?, max_value = ?, updated_at = ? WHERE id = ?',
      f.title, f.sort, f.keep, f.format, f.unit, f.min, f.max, Date.now(), board.id);
    if (f.keep === 'best' && board.keep !== 'best') {
      // From every score to one each: each player's best stays.
      db.run(
        `DELETE FROM scores WHERE board_id = ? AND id NOT IN
           (SELECT id FROM (SELECT s.id, ROW_NUMBER() OVER (PARTITION BY s.player ORDER BY ${ranking(board)}) AS place
                            FROM scores s WHERE s.board_id = ?) WHERE place = 1)`,
        board.id, board.id);
    }
  });
  logAdmin(admin, 'board-update', `game:${row.id}`, key);
  const scores = db.get('SELECT COUNT(*) AS n FROM scores WHERE board_id = ?', board.id).n;
  return json({ board: publicBoard(boardRow(row.id, key), scores) });
}

/** POST /api/games/<id>/boards/<key>/reset: removes every score. */
export function resetBoard(ctx, id, key) {
  const { row, admin } = managedGame(ctx, id);
  const board = boardRow(row.id, key);
  const removed = Number(db.run('DELETE FROM scores WHERE board_id = ?', board.id).changes);
  logAdmin(admin, 'board-reset', `game:${row.id}`, key);
  return json({ ok: true, removed });
}

/** DELETE /api/games/<id>/boards/<key>: the board and its scores. */
export function deleteBoard(ctx, id, key) {
  const { row, admin } = managedGame(ctx, id);
  const board = boardRow(row.id, key);
  db.tx(() => {
    db.run('DELETE FROM scores WHERE board_id = ?', board.id);
    db.run('DELETE FROM boards WHERE id = ?', board.id);
  });
  logAdmin(admin, 'board-delete', `game:${row.id}`, key);
  return json({ ok: true, deleted: true });
}

/** DELETE /api/games/<id>/boards/<key>/scores/<score id>: one score (a fake one, a rude name). */
export function deleteScore(ctx, id, key, scoreId) {
  const { row, admin } = managedGame(ctx, id);
  const board = boardRow(row.id, key);
  const res = db.run('DELETE FROM scores WHERE id = ? AND board_id = ?', Number(scoreId), board.id);
  if (!res.changes) throw new HttpError(404, 'No such score on this leaderboard.');
  logAdmin(admin, 'score-delete', `game:${row.id}`, `${key} #${scoreId}`);
  return json({ ok: true, deleted: true });
}

/** Removes a game's boards and their scores (games.js, when a game is deleted). */
export function removeBoards(gameId) {
  db.run('DELETE FROM scores WHERE board_id IN (SELECT id FROM boards WHERE game_id = ?)', gameId);
  db.run('DELETE FROM boards WHERE game_id = ?', gameId);
}
