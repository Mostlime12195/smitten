// Smitten's game-sharing site, as a Cloudflare Worker.
//
//   /                     the gallery (public/index.html)
//   /play/<id>            a game's page, running it in Smitten's player
//   /player/player.html   the player (copied by scripts/copy-player.sh)
//   /api/...              the API (README.md lists every endpoint)
//
// R2 (env.GAMES) holds game files, D1 (env.DB) everything else.

import { HttpError, errorResponse, json, preflight, withCors, withSecurityHeaders } from './http.js';
import { ID_PATTERN, ensureSchema } from './db.js';
import {
  getConfig, listGames, publishGame, getGame, updateGame, deleteGame,
  getGameFile, getThumbnail, countPlay, reportGame,
} from './games.js';
import { adminReports, adminHide, adminRestore, adminDelete } from './admin.js';
import { MODULES } from './validate.js';

const ID = `(${ID_PATTERN})`;

// [method, path pattern, handler(request, env, origin, ...params)]
const API = [
  ['GET', /^\/api\/config$/, getConfig],
  ['GET', /^\/api\/games$/, listGames],
  ['POST', /^\/api\/games$/, publishGame],
  ['GET', new RegExp(`^/api/games/${ID}$`), getGame],
  ['PUT', new RegExp(`^/api/games/${ID}$`), updateGame],
  ['DELETE', new RegExp(`^/api/games/${ID}$`), deleteGame],
  ['GET', new RegExp(`^/api/games/${ID}/[^/]+\\.love$`), getGameFile],
  ['GET', new RegExp(`^/api/games/${ID}/thumbnail\\.png$`), getThumbnail],
  ['POST', new RegExp(`^/api/games/${ID}/play$`), countPlay],
  ['POST', new RegExp(`^/api/games/${ID}/report$`), reportGame],
  ['GET', /^\/api\/admin\/reports$/, adminReports],
  ['POST', new RegExp(`^/api/admin/games/${ID}/hide$`), adminHide],
  ['POST', new RegExp(`^/api/admin/games/${ID}/restore$`), adminRestore],
  ['DELETE', new RegExp(`^/api/admin/games/${ID}$`), adminDelete],
];

async function handleApi(request, env, url) {
  const isAdminPath = url.pathname.startsWith('/api/admin/');
  // CORS for the editor (ALLOWED_ORIGINS); never for admin endpoints.
  if (request.method === 'OPTIONS') return isAdminPath ? new Response(null, { status: 403 }) : preflight(request, env);

  let res;
  try {
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const matches = API.filter(([, re]) => re.test(url.pathname));
    if (!matches.length) throw new HttpError(404, 'No such API endpoint.');
    const route = matches.find(([m]) => m === method);
    if (!route) throw new HttpError(405, 'Method not allowed.', { allow: [...new Set(matches.map(([m]) => m))].join(', ') });
    const params = url.pathname.match(route[1]).slice(1);
    res = await route[2](request, env, url.origin, ...params);
  } catch (e) {
    res = errorResponse(e);
  }
  return isAdminPath ? res : withCors(res, request, env);
}

// ---------------------------------------------------------------------------
// Pages and static files

// A static file under another path. Pages that are rewritten are fetched
// without the browser's conditional headers, since their content varies.
async function asset(env, request, path, { conditional = false } = {}) {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = '';
  return env.ASSETS.fetch(new Request(url, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: conditional ? request.headers : {},
  }));
}

// Puts the editor's URL (for "Make a game" and "Remix") into a page, and on a
// game's page its title and description, for link previews.
function rewritePage(res, env, game) {
  let rewriter = new HTMLRewriter().on('meta[name="smitten-editor-url"]', {
    element(el) { el.setAttribute('content', env.EDITOR_URL || 'http://localhost:8766/'); },
  });
  if (game) {
    const description = game.description ? game.description.slice(0, 200) : 'A game made with Smitten. Play it in your browser.';
    rewriter = rewriter
      .on('title', { element(el) { el.setInnerContent(`${game.title} · Smitten`); } })
      .on('meta[name="description"], meta[property="og:description"]', { element(el) { el.setAttribute('content', description); } })
      .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', game.title); } });
    if (game.thumbnail) {
      rewriter = rewriter.on('head', { element(el) { el.append(`<meta property="og:image" content="${game.thumbnail.replace(/"/g, '&quot;')}">`, { html: true }); } });
    }
  }
  const out = new Response(res.body, res);
  out.headers.delete('ETag');
  out.headers.delete('Content-Length');
  out.headers.set('Cache-Control', 'no-cache');
  return rewriter.transform(out);
}

async function playPage(request, env, url, id) {
  const res = await asset(env, request, '/play.html');
  let game = null;
  if (new RegExp(`^${ID_PATTERN}$`).test(id)) {
    try {
      await ensureSchema(env);
      game = await env.DB.prepare("SELECT id, title, description, has_thumbnail, version FROM games WHERE id = ?1 AND status = 'public'").bind(id).first();
      if (game) game.thumbnail = game.has_thumbnail ? `${url.origin}/api/games/${id}/thumbnail.png?v=${game.version}` : null;
    } catch (e) {
      console.error(e);
    }
  }
  return rewritePage(res, env, game);
}

// The player only runs games from this site: ?game= must be one of our
// /api/games/<id>/<name>.love URLs, and ?modules= known engine modules.
function checkPlayerParams(url) {
  const game = url.searchParams.get('game');
  if (game !== null && !new RegExp(`^/api/games/${ID_PATTERN}/[^/?#]+\\.love$`).test(game)) {
    return 'The player only runs games published on this site.';
  }
  const modules = url.searchParams.get('modules');
  if (modules && modules.split(',').some((m) => !MODULES.includes(m.trim()))) return 'Unknown engine module.';
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      return withSecurityHeaders(await handleApi(request, env, url), 'file', env);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withSecurityHeaders(json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' }), 'file', env);
    }

    if (path === '/' || path === '/index.html') {
      return withSecurityHeaders(rewritePage(await asset(env, request, '/index.html'), env, null), 'site', env);
    }
    const play = /^\/play\/([^/]+)\/?$/.exec(path);
    if (play) return withSecurityHeaders(await playPage(request, env, url, play[1]), 'site', env);
    if (path === '/play.html') return Response.redirect(`${url.origin}/`, 302);

    if (path.startsWith('/player/')) {
      if (path === '/player/player.html' || path === '/player/') {
        const problem = checkPlayerParams(url);
        if (problem) return withSecurityHeaders(new Response(problem, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }), 'file', env);
        const res = await asset(env, request, '/player/player.html', { conditional: true });
        if (res.status === 404) {
          return withSecurityHeaders(new Response('The player is missing. Run scripts/copy-player.sh (see README.md).', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }), 'file', env);
        }
        return withSecurityHeaders(res, 'player', env);
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request), 'file', env);
    }

    const res = await env.ASSETS.fetch(request);
    if (res.status === 404) {
      const notFound = await asset(env, request, '/404.html');
      return withSecurityHeaders(new Response(notFound.body, { status: 404, headers: notFound.headers }), 'site', env);
    }
    return withSecurityHeaders(res, 'site', env);
  },
};
