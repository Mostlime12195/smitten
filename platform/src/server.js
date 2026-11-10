// Smitten's game-sharing site: a plain Node server (no dependencies) with
// SQLite (node:sqlite) and game files on disk.
//
//   /                       the gallery (public/index.html)
//   /play/<id>              a game's page, running it in Smitten's player
//   /u/<username>           someone's games
//   /signin /signup /recover /account
//   /verify-email           where a link to confirm an email address goes
//   /editor-auth            the editor's sign-in popup
//   /auth/hackclub[/callback]  "Sign in with Hack Club" (when configured)
//   /auth/hackatime[/callback] "Connect Hackatime" (when configured)
//   /hackatime-connected    where the editor's Hackatime popup ends up
//   /docs/[page]            the docs (public/docs/, made by tools/gen-docs.mjs)
//   /player/player.html     the player (copied by scripts/copy-player.sh)
//   /api/...                the API (README.md lists every endpoint)
//
//   node src/server.js      (settings: deploy/env.example)

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { openDb, db, ID_PATTERN } from './db.js';
import { initStorage } from './storage.js';
import { HttpError, decodePart, errorResponse, json, preflight, redirect, withCors, withSecurityHeaders } from './http.js';
import { COMPRESSIBLE, encodedFile, encodedText } from './compress.js';
import {
  getConfig, listGames, publishGame, getGame, updateGame, deleteGame,
  getGameFile, getThumbnail, countPlay, reportGame, uploadLimit,
} from './games.js';
import { listBoards, getBoard, submitScore, createBoard, updateBoard, resetBoard, deleteBoard, deleteScore } from './boards.js';
import {
  signUp, signIn, signOut, recover, me, updateAccount, changePassword, regenerateRecoveryCodes, deleteAccount,
  listSessions, revokeSession, revokeOtherSessions, myGames, claimGames, getProfile,
  editorCode, editorToken, revokeEditorToken,
} from './account.js';
import * as hackclub from './hackclub.js';
import * as hackatime from './hackatime.js';
import { cancelPendingEmail, removeEmail, requestReset, resendVerification, setEmail, verifyEmail } from './email.js';
import { startMailWorker, stopMailWorker } from './mail.js';
import {
  adminReports, adminHide, adminRestore, adminDelete,
  adminUser, adminBan, adminUnban, adminResetLink, adminDeleteUser, adminLog, adminRequestInfo,
  adminBanAddress, adminUnbanAddress, adminAddressBans,
} from './admin.js';
import { MODULES } from './validate.js';

const ID = `(${ID_PATTERN})`;
const NAME = '([^/]{1,60})';
const SESSION = '([0-9a-z]{16})';
const BOARD = '([a-z0-9][a-z0-9_-]{0,23})';

// [method, path pattern, handler(ctx, ...params)]
const API = [
  ['GET', /^\/api\/config$/, getConfig],
  ['GET', /^\/api\/games$/, listGames],
  ['POST', /^\/api\/games$/, publishGame],
  ['GET', new RegExp(`^/api/games/${ID}$`), getGame],
  ['PUT', new RegExp(`^/api/games/${ID}$`), updateGame],
  ['DELETE', new RegExp(`^/api/games/${ID}$`), deleteGame],
  ['GET', new RegExp(`^/api/games/${ID}/[^/]+\\.(?:zip|love)$`), getGameFile],
  ['GET', new RegExp(`^/api/games/${ID}/thumbnail\\.png$`), getThumbnail],
  ['POST', new RegExp(`^/api/games/${ID}/play$`), countPlay],
  ['POST', new RegExp(`^/api/games/${ID}/report$`), reportGame],
  ['GET', new RegExp(`^/api/games/${ID}/boards$`), listBoards],
  ['POST', new RegExp(`^/api/games/${ID}/boards$`), createBoard],
  ['GET', new RegExp(`^/api/games/${ID}/boards/${BOARD}$`), getBoard],
  ['PATCH', new RegExp(`^/api/games/${ID}/boards/${BOARD}$`), updateBoard],
  ['DELETE', new RegExp(`^/api/games/${ID}/boards/${BOARD}$`), deleteBoard],
  ['POST', new RegExp(`^/api/games/${ID}/boards/${BOARD}/reset$`), resetBoard],
  ['POST', new RegExp(`^/api/games/${ID}/boards/${BOARD}/scores$`), submitScore],
  ['DELETE', new RegExp(`^/api/games/${ID}/boards/${BOARD}/scores/(\\d{1,15})$`), deleteScore],
  ['GET', new RegExp(`^/api/users/${NAME}$`), getProfile],

  ['POST', /^\/api\/auth\/signup$/, signUp],
  ['POST', /^\/api\/auth\/signin$/, signIn],
  ['POST', /^\/api\/auth\/signout$/, signOut],
  ['POST', /^\/api\/auth\/recover$/, recover],
  ['POST', /^\/api\/auth\/recover\/email$/, requestReset],
  ['POST', /^\/api\/auth\/verify-email$/, verifyEmail],
  ['POST', /^\/api\/auth\/editor\/code$/, editorCode],
  ['POST', /^\/api\/auth\/editor\/token$/, editorToken],
  ['DELETE', /^\/api\/auth\/editor\/token$/, revokeEditorToken],

  ['GET', /^\/api\/account$/, me],
  ['PATCH', /^\/api\/account$/, updateAccount],
  ['DELETE', /^\/api\/account$/, deleteAccount],
  ['POST', /^\/api\/account\/password$/, changePassword],
  ['POST', /^\/api\/account\/recovery-codes$/, regenerateRecoveryCodes],
  ['GET', /^\/api\/account\/sessions$/, listSessions],
  ['POST', /^\/api\/account\/sessions\/revoke-others$/, revokeOtherSessions],
  ['DELETE', new RegExp(`^/api/account/sessions/${SESSION}$`), revokeSession],
  ['GET', /^\/api\/account\/games$/, myGames],
  ['POST', /^\/api\/account\/claim$/, claimGames],
  ['POST', /^\/api\/account\/email$/, setEmail],
  ['DELETE', /^\/api\/account\/email$/, removeEmail],
  ['POST', /^\/api\/account\/email\/resend$/, resendVerification],
  ['POST', /^\/api\/account\/email\/cancel$/, cancelPendingEmail],
  ['DELETE', /^\/api\/account\/hackclub$/, hackclub.disconnect],
  ['GET', /^\/api\/account\/hackatime-key$/, hackatime.getKey],
  ['DELETE', /^\/api\/account\/hackatime$/, hackatime.disconnect],

  ['GET', /^\/api\/admin\/reports$/, adminReports],
  ['GET', /^\/api\/admin\/log$/, adminLog],
  ['GET', /^\/api\/admin\/request$/, adminRequestInfo],
  ['GET', /^\/api\/admin\/addresses$/, adminAddressBans],
  ['POST', /^\/api\/admin\/addresses\/ban$/, adminBanAddress],
  ['POST', /^\/api\/admin\/addresses\/unban$/, adminUnbanAddress],
  ['POST', new RegExp(`^/api/admin/games/${ID}/hide$`), adminHide],
  ['POST', new RegExp(`^/api/admin/games/${ID}/restore$`), adminRestore],
  ['DELETE', new RegExp(`^/api/admin/games/${ID}$`), adminDelete],
  ['GET', new RegExp(`^/api/admin/users/${NAME}$`), adminUser],
  ['POST', new RegExp(`^/api/admin/users/${NAME}/ban$`), adminBan],
  ['POST', new RegExp(`^/api/admin/users/${NAME}/unban$`), adminUnban],
  ['POST', new RegExp(`^/api/admin/users/${NAME}/reset-password$`), adminResetLink],
  ['DELETE', new RegExp(`^/api/admin/users/${NAME}$`), adminDeleteUser],
];

async function handleApi(ctx) {
  const { request, url, config } = ctx;
  const isAdminPath = url.pathname.startsWith('/api/admin/');
  // CORS for the editor (EDITOR_ORIGINS); never for admin endpoints.
  if (request.method === 'OPTIONS') return isAdminPath ? new Response(null, { status: 403 }) : preflight(request, config);

  let res;
  try {
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const matches = API.filter(([, re]) => re.test(url.pathname));
    if (!matches.length) throw new HttpError(404, 'No such API endpoint.');
    const route = matches.find(([m]) => m === method);
    if (!route) throw new HttpError(405, 'Method not allowed.', { allow: [...new Set(matches.map(([m]) => m))].join(', ') });
    const params = url.pathname.match(route[1]).slice(1);
    res = await route[2](ctx, ...params);
  } catch (e) {
    res = errorResponse(e);
  }
  return isAdminPath ? res : withCors(res, request, config);
}

// ---------------------------------------------------------------------------
// Pages and static files

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * A file under public/, with an ETag and 304s, compressed if the request
 * accepts that (compress.js); null if there's none.
 */
async function staticFile(ctx, path) {
  const root = ctx.config.publicDir;
  const decoded = decodePart(path);
  if (decoded === null) return null;
  const file = normalize(join(root, decoded));
  if (!file.startsWith(root + sep)) return null;
  let info;
  try {
    info = await stat(file);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  const ext = extname(file).toLowerCase();
  const compressible = COMPRESSIBLE.has(ext);
  // A Range would count bytes of the file itself, so it gets the file as it is.
  const encoded = compressible && !ctx.request.headers.has('Range')
    ? await encodedFile(file, info, ctx.request.headers.get('Accept-Encoding'))
    : null;
  // Each encoding is a different body, so it has its own ETag.
  const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}${encoded ? `-${encoded.encoding}` : ''}"`;
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    ETag: etag,
    // The player asks for the engine's files with ?v=<hash of the build>:
    // that URL never changes its content. Pages are always checked.
    'Cache-Control': ctx.url.searchParams.get('v') && ext !== '.html' ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (compressible) headers.Vary = 'Accept-Encoding';
  if (encoded) headers['Content-Encoding'] = encoded.encoding;
  if ((ctx.request.headers.get('If-None-Match') || '').split(',').map((s) => s.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers['Content-Length'] = String(encoded ? encoded.size : info.size);
  if (ctx.request.method === 'HEAD') return new Response(null, { headers });
  return new Response(encoded ? encoded.body() : Readable.toWeb(createReadStream(file)), { headers });
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One of the site's pages, with the editor's URL (for "Make a game" and
 * "Remix") filled in, and on a game's page its title and description, for
 * link previews.
 */
async function page(ctx, name, { status = 200, meta = null } = {}) {
  let html = await readFile(join(ctx.config.publicDir, name), 'utf8');
  // The replacements are functions: in a replacement string, a title like
  // "$& and $'" would paste parts of the page into itself.
  html = html.replace(/<meta name="smitten-editor-url" content="[^"]*">/, () => `<meta name="smitten-editor-url" content="${escapeAttr(ctx.config.editorUrl)}">`);
  if (meta) {
    html = html
      .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeText(meta.title)} · Smitten</title>`)
      .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*(">)/g, (_, open, close) => `${open}${escapeAttr(meta.description)}${close}`)
      .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_, open, close) => `${open}${escapeAttr(meta.title)}${close}`);
    if (meta.image) html = html.replace('</head>', () => `<meta property="og:image" content="${escapeAttr(meta.image)}">\n</head>`);
  }
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
  const encoded = await encodedText(html, ctx.request.headers.get('Accept-Encoding'));
  if (encoded) headers['Content-Encoding'] = encoded.encoding;
  return new Response(ctx.request.method === 'HEAD' ? null : encoded ? encoded.body : html, { status, headers });
}

function playMeta(ctx, id) {
  if (!new RegExp(`^${ID_PATTERN}$`).test(id)) return null;
  const game = db.get("SELECT id, title, description, has_thumbnail, version FROM games WHERE id = ? AND status = 'public'", id);
  if (!game) return null;
  return {
    title: game.title,
    description: game.description ? game.description.slice(0, 200) : 'A game made with Smitten. Play it in your browser.',
    image: game.has_thumbnail ? `${ctx.origin}/api/games/${id}/thumbnail.png?v=${game.version}` : null,
  };
}

// The player only runs games from this site: ?game= must be one of our
// /api/games/<id>/<name>.zip URLs, and ?modules= known engine modules.
function checkPlayerParams(url) {
  const game = url.searchParams.get('game');
  if (game !== null && !new RegExp(`^/api/games/${ID_PATTERN}/[^/?#]+\\.(?:zip|love)$`).test(game)) {
    return 'The player only runs games published on this site.';
  }
  const modules = url.searchParams.get('modules');
  if (modules && modules.split(',').some((m) => !MODULES.includes(m.trim()))) return 'Unknown engine module.';
  return null;
}

const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

// Pages served at their own paths, and their kind (security headers).
const PAGES = {
  '/signin': ['signin.html', 'auth'],
  '/signup': ['signup.html', 'auth'],
  '/recover': ['recover.html', 'auth'],
  '/verify-email': ['verify-email.html', 'auth'],
  '/editor-auth': ['editor-auth.html', 'auth'],
  '/account': ['account.html', 'site'],
  '/hackatime-connected': ['hackatime-connected.html', 'auth'],
};

// The docs (public/docs/, made by tools/gen-docs.mjs): /docs/ and
// /docs/<page>. Their CSS, JS and search index are ordinary static files.
function docsPage(ctx, path) {
  if (path === '/docs') return Promise.resolve(redirect('/docs/', 301));
  const m = /^\/docs\/([a-z0-9-]*)$/.exec(path);
  if (!m) return null;
  return staticFile(ctx, `/docs/${m[1] || 'index'}.html`).then((res) => res || page(ctx, '404.html', { status: 404 }));
}

async function route(ctx) {
  const { request, url, config } = ctx;
  const path = url.pathname;

  if (path.startsWith('/api/')) return withSecurityHeaders(await handleApi(ctx), 'file', config);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withSecurityHeaders(json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' }), 'file', config);
  }

  try {
    if (path === '/' || path === '/index.html') return withSecurityHeaders(await page(ctx, 'index.html'), 'site', config);
    const play = /^\/play\/([^/]+)\/?$/.exec(path);
    if (play) return withSecurityHeaders(await page(ctx, 'play.html', { meta: playMeta(ctx, play[1]) }), 'site', config);
    if (/^\/u\/[^/]+\/?$/.test(path)) return withSecurityHeaders(await page(ctx, 'profile.html'), 'site', config);
    const known = PAGES[path.replace(/\/$/, '')];
    if (known) return withSecurityHeaders(await page(ctx, known[0]), known[1], config);
    const docs = docsPage(ctx, path);
    if (docs) return withSecurityHeaders(await docs, 'site', config);
    if (path === '/auth/hackclub') return withSecurityHeaders(hackclub.start(ctx), 'auth', config);
    if (path === '/auth/hackclub/callback') return withSecurityHeaders(await hackclub.callback(ctx), 'auth', config);
    if (path === '/auth/hackatime') return withSecurityHeaders(hackatime.start(ctx), 'auth', config);
    if (path === '/auth/hackatime/callback') return withSecurityHeaders(await hackatime.callback(ctx), 'auth', config);
  } catch (e) {
    if (e instanceof HttpError) return withSecurityHeaders(text(e.message, e.status), 'file', config);
    throw e;
  }

  if (path.startsWith('/player/')) {
    if (path === '/player/player.html' || path === '/player/') {
      const problem = checkPlayerParams(url);
      if (problem) return withSecurityHeaders(text(problem, 400), 'file', config);
      const res = await staticFile(ctx, '/player/player.html');
      if (!res) return withSecurityHeaders(text('The player is missing. Run scripts/copy-player.sh (see README.md).', 503), 'file', config);
      return withSecurityHeaders(res, 'player', config);
    }
    const res = await staticFile(ctx, path);
    if (res) return withSecurityHeaders(res, 'file', config);
  } else if (!path.endsWith('.html')) {
    // Pages are only served at their own paths, above.
    const res = await staticFile(ctx, path);
    if (res) return withSecurityHeaders(res, 'site', config);
  }
  return withSecurityHeaders(await page(ctx, '404.html', { status: 404 }), 'site', config);
}

// ---------------------------------------------------------------------------
// Node's http <-> Request and Response

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

/** Whether a connection comes from the reverse proxy (TRUST_PROXY). */
function fromProxy(peer, config) {
  if (!config.trustProxy) return false;
  if (config.trustProxy === true) return PRIVATE.test(peer);
  return config.trustProxy.some((p) => (p.endsWith('*') ? peer.startsWith(p.slice(0, -1)) : peer === p));
}

/**
 * The client's address. Behind the proxy, it's the last address in
 * X-Forwarded-For (the one the proxy saw; earlier ones the client can make
 * up). A direct connection (Nest containers have a public IPv6 address)
 * can't pretend to be someone else.
 */
function clientIp(req, config) {
  const peer = (req.socket.remoteAddress || '0.0.0.0').replace(/^::ffff:/, '');
  if (!fromProxy(peer, config)) return { ip: peer, peer };
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { ip: (forwarded.at(-1) || peer).replace(/^::ffff:/, ''), peer };
}

/** Cuts a request body off past max bytes, setting ctx.bodyTooBig. */
function limitedBody(req, ctx, max) {
  let seen = 0;
  return Readable.toWeb(req).pipeThrough(new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max) {
        ctx.bodyTooBig = true;
        controller.error(new Error('The request body is too big.'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

export function createApp(config) {
  return async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', config.publicOrigin);
    } catch {
      // "GET //[" isn't a URL. Thrown from here, it would end the process.
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
      res.end('Bad request.');
      return;
    }
    const ctx = { config, url, origin: config.publicOrigin, ...clientIp(req, config), bodyTooBig: false };
    const headers = new Headers();
    for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    // Publishing and updating a game; everything else is small JSON.
    const isUpload = (req.method === 'POST' && url.pathname === '/api/games') || (req.method === 'PUT' && /^\/api\/games\/[^/]+$/.test(url.pathname));
    ctx.request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? limitedBody(req, ctx, isUpload ? uploadLimit(config) : 64 * 1024) : undefined,
      duplex: 'half',
    });

    let response;
    try {
      response = await route(ctx);
    } catch (e) {
      response = withSecurityHeaders(errorResponse(e), 'file', config);
    }

    // A small request answered before its body was read (refused, or not
    // needed): read the rest first. Answering and closing while the client
    // is still sending resets the connection, and the client may never see
    // the answer. A big upload isn't worth waiting for; it gets "close".
    if (hasBody && !req.complete && !ctx.bodyTooBig && !ctx.request.bodyUsed && ctx.request.body
      && Number(req.headers['content-length']) <= 1024 * 1024) {
      try {
        for await (const chunk of ctx.request.body) void chunk;
      } catch { /* the client went away */ }
    }

    const out = {};
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') out[key] = value; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    // An unread body (refused early, or cut off) can't be followed by another request on this connection.
    if (hasBody && (ctx.bodyTooBig || !req.complete)) out.connection = 'close';
    res.writeHead(response.status, out);
    if (!response.body || req.method === 'HEAD') {
      response.body?.cancel().catch(() => {});
      res.end();
      return;
    }
    try {
      await pipeline(Readable.fromWeb(response.body), res);
    } catch { /* the client went away */ }
  };
}

export function startServer(config = loadConfig()) {
  openDb(config.dbFile);
  initStorage(config);
  startMailWorker(config);
  const server = createServer(createApp(config));
  server.listen(config.port, config.host, () => {
    console.log(`Smitten games on ${config.publicOrigin} (listening on ${config.host}:${config.port}, data in ${config.dataDir})`);
    if (!config.adminToken) console.log('ADMIN_TOKEN is not set: the admin endpoints are off.');
    console.log(config.email ? `Email: on (${config.email.transport}, from ${config.email.fromAddress})` : 'Email: off (EMAIL_TRANSPORT is not set)');
  });
  const stop = () => {
    stopMailWorker();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
