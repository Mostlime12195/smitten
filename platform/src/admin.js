// Moderation endpoints, behind the ADMIN_TOKEN secret
// (Authorization: Bearer <ADMIN_TOKEN>).

import { HttpError, json } from './http.js';
import { ensureSchema } from './db.js';
import { isAdmin, publicGame, removeGame } from './games.js';

async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, 'Admin endpoints are off: set the ADMIN_TOKEN secret (locally, in .dev.vars).');
  if (!(await isAdmin(request, env))) throw new HttpError(401, 'This needs the admin token (Authorization: Bearer <ADMIN_TOKEN>).');
  await ensureSchema(env);
}

async function requireGame(env, id) {
  const row = await env.DB.prepare('SELECT * FROM games WHERE id = ?1').bind(id).first();
  if (!row) throw new HttpError(404, 'No game with that id.');
  return row;
}

/** Games that are hidden or have open reports, with their reports, most reported first. */
export async function adminReports(request, env, origin) {
  await requireAdmin(request, env);
  const { results: games } = await env.DB.prepare(
    `SELECT g.*, COUNT(r.id) AS open_reports, MAX(r.created_at) AS last_report
     FROM games g LEFT JOIN reports r ON r.game_id = g.id AND r.resolved = 0
     GROUP BY g.id
     HAVING g.status != 'public' OR open_reports > 0
     ORDER BY open_reports DESC, last_report DESC
     LIMIT 200`,
  ).all();
  const out = [];
  for (const g of games) {
    const { results: reports } = await env.DB.prepare(
      'SELECT reason, note, ip_hash, created_at FROM reports WHERE game_id = ?1 AND resolved = 0 ORDER BY created_at DESC LIMIT 50',
    ).bind(g.id).all();
    out.push({
      ...publicGame(g, origin),
      status: g.status,
      hiddenBy: g.hidden_by,
      openReports: g.open_reports,
      reports: reports.map((r) => ({ reason: r.reason, note: r.note, reporter: r.ip_hash.slice(0, 8), createdAt: r.created_at })),
    });
  }
  return json({ games: out });
}

export async function adminHide(request, env, origin, id) {
  await requireAdmin(request, env);
  await requireGame(env, id);
  await env.DB.prepare("UPDATE games SET status = 'hidden', hidden_by = 'admin' WHERE id = ?1").bind(id).run();
  return json({ id, status: 'hidden' });
}

/** Makes a game public again and closes its open reports. */
export async function adminRestore(request, env, origin, id) {
  await requireAdmin(request, env);
  await requireGame(env, id);
  await env.DB.batch([
    env.DB.prepare("UPDATE games SET status = 'public', hidden_by = NULL WHERE id = ?1").bind(id),
    env.DB.prepare('UPDATE reports SET resolved = 1 WHERE game_id = ?1 AND resolved = 0').bind(id),
  ]);
  return json({ id, status: 'public' });
}

export async function adminDelete(request, env, origin, id) {
  await requireAdmin(request, env);
  await requireGame(env, id);
  await removeGame(env, id);
  return json({ id, deleted: true });
}
