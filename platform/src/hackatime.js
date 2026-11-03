// "Connect Hackatime": links a Smitten account to Hackatime
// (https://hackatime.hackclub.com), Hack Club's time tracker, through its
// OAuth. On when HACKATIME_CLIENT_ID and HACKATIME_CLIENT_SECRET are set;
// register the app in Hackatime with the redirect URI
// <PUBLIC_URL>/auth/hackatime/callback.
//
// What it's for:
//   - The editor gets the person's Hackatime API key with one click
//     (GET /api/account/hackatime-key) instead of copying it by hand, and
//     sends heartbeats with it (web/editor/hackatime.js).
//   - A game's page shows how long it took to make: the hours Hackatime
//     tracked for the editor's project the game was published from.
//
// The authorization code flow with state and PKCE, like hackclub.js:
// /auth/hackatime (signed in on the site) sends the browser to Hackatime,
// which sends it back to /auth/hackatime/callback with a code; the server
// swaps the code for an access token (with the client secret) and asks
// /api/v1/authenticated/me who it is. Kept: the Hackatime user id and the
// access token, encrypted (AES-256-GCM, with a key derived from SECRET).
// The token is never logged and never sent to browsers; the API key is
// fetched from Hackatime each time the editor asks and isn't kept.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { HttpError, cookie, json, readCookie, redirect } from './http.js';
import { db, rateLimit } from './db.js';
import { auth, requireSameOrigin, requireUser } from './auth.js';
import { safeNext } from './hackclub.js';

const FLOW_COOKIE = 'smitten_hackatime_flow';
const FLOW_PATH = '/auth/hackatime';
const HOUR = 3600_000;
const TIMEOUT = 10_000;

const turnedOff = () => new HttpError(404, 'Hackatime is turned off on this site.', { code: 'hackatime-off' });
const notConnected = () => new HttpError(404, "Your account isn't connected to Hackatime.", { code: 'not-connected' });

// ---------------------------------------------------------------------------
// The access token, encrypted at rest: v1.<iv>.<ciphertext>.<tag> (base64url),
// AES-256-GCM with a key derived from SECRET, and the user's id as associated
// data, so a token copied to another row doesn't decrypt.

const keys = new Map();
function keyFor(secret) {
  let key = keys.get(secret);
  if (!key) {
    key = createHmac('sha256', secret).update('smitten|hackatime-token|v1').digest();
    keys.set(secret, key);
  }
  return key;
}

export function encryptToken(config, userId, token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(config.secret), iv);
  cipher.setAAD(Buffer.from(`hackatime|${userId}`));
  const data = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return ['v1', iv, data, cipher.getAuthTag()].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

/** The token, or null if it doesn't decrypt (SECRET changed, or it was tampered with). */
export function decryptToken(config, userId, stored) {
  const [version, iv, data, tag] = String(stored || '').split('.');
  if (version !== 'v1' || !iv || !data || !tag) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(config.secret), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`hackatime|${userId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Talking to Hackatime

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`the token endpoint answered ${res.status}${data?.error ? ` (${String(data.error).slice(0, 60)})` : ''}`);
  return data;
}

/** GET from Hackatime's API with the access token: {status, data}. */
async function getApi(config, path, token) {
  const res = await fetch(`${config.hackatime.url}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Hackatime says the token no longer works (revoked there, or expired).
const revokedStatus = (status) => status === 401 || status === 403;

/** Revokes a token at Hackatime. Best effort: failures are only logged. */
async function revokeAt(config, token) {
  if (!config.hackatime || !token) return;
  try {
    const res = await fetch(`${config.hackatime.url}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ token, client_id: config.hackatime.clientId, client_secret: config.hackatime.clientSecret }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`Hackatime: revoking a token answered ${res.status}`);
  } catch (e) {
    console.error('Hackatime: revoking a token failed:', e.name === 'TimeoutError' ? 'timed out' : e.message);
  }
}

/** Forgets a user's Hackatime link and the hours cached on their games. */
function clearLink(userId) {
  db.tx(() => {
    db.run('UPDATE users SET hackatime_id = NULL, hackatime_token = NULL, hackatime_connected_at = NULL, updated_at = ? WHERE id = ?', Date.now(), userId);
    db.run('UPDATE games SET hackatime_seconds = NULL, hackatime_checked_at = NULL WHERE owner_id = ?', userId);
  });
}

/** The user's access token, or null (not connected; or it doesn't decrypt, and then the link is cleared). */
function storedToken(config, user) {
  if (!user.hackatime_id || !user.hackatime_token) return null;
  const token = decryptToken(config, user.id, user.hackatime_token);
  if (!token) {
    console.error(`Hackatime: user ${user.id}'s token didn't decrypt (was SECRET changed?); unlinking.`);
    clearLink(user.id);
  }
  return token;
}

/** Account deletion: revokes the user's token at Hackatime (best effort). */
export async function forgetUser(config, user) {
  if (!config.hackatime || !user?.hackatime_token) return;
  const token = decryptToken(config, user.id, user.hackatime_token);
  if (token) await revokeAt(config, token);
}

// ---------------------------------------------------------------------------
// Connecting: /auth/hackatime → Hackatime → /auth/hackatime/callback

/** next with ?<key>=<value> added (next is a local path from safeNext). */
function withParam(next, key, value) {
  const url = new URL(next, 'http://x');
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}

const clearFlowCookie = (ctx) => cookie(ctx.config, FLOW_COOKIE, '', { maxAge: 0, path: FLOW_PATH });

function failed(ctx, next, message) {
  return redirect(withParam(next, 'error', message), 302, { 'Set-Cookie': clearFlowCookie(ctx) });
}

/**
 * GET /auth/hackatime?next=<path>: off to Hackatime. Needs a session on the
 * site (otherwise sign in first, and come back). next is where to go after:
 * /account by default; the editor uses /hackatime-connected.
 */
export function start(ctx) {
  const ht = ctx.config.hackatime;
  if (!ht) throw turnedOff();
  const next = safeNext(ctx.url.searchParams.get('next'), '/account');
  const a = auth(ctx);
  if (a?.via !== 'web') {
    return redirect(`/signin?next=${encodeURIComponent(`/auth/hackatime?next=${encodeURIComponent(next)}`)}`);
  }
  const state = randomBytes(18).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const flow = [state, verifier, String(a.user.id), Buffer.from(next).toString('base64url')].join('.');
  const p = new URLSearchParams({
    client_id: ht.clientId,
    redirect_uri: `${ctx.origin}/auth/hackatime/callback`,
    response_type: 'code',
    scope: ht.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return redirect(`${ht.url}/oauth/authorize?${p}`, 302, {
    'Set-Cookie': cookie(ctx.config, FLOW_COOKIE, flow, { maxAge: 600, path: FLOW_PATH }),
  });
}

/** GET /auth/hackatime/callback?code=&state= */
export async function callback(ctx) {
  const { config } = ctx;
  const ht = config.hackatime;
  if (!ht) throw turnedOff();
  const [state, verifier, userId, nextB64] = (readCookie(ctx.request, FLOW_COOKIE) || '').split('.');
  const next = safeNext(Buffer.from(nextB64 || '', 'base64url').toString(), '/account');
  const params = ctx.url.searchParams;
  if (params.get('error')) return failed(ctx, next, 'Connecting Hackatime was cancelled.');
  if (!state || params.get('state') !== state || !params.get('code')) {
    return failed(ctx, next, 'That Hackatime connection expired or came from somewhere else. Please try again.');
  }
  const a = auth(ctx);
  const user = a?.via === 'web' ? a.user : null;
  if (!user || String(user.id) !== userId) {
    return failed(ctx, '/account', 'Sign in on this site first, then connect Hackatime from your account settings.');
  }

  let accessToken;
  let hackatimeId;
  try {
    const tokens = await postForm(`${ht.url}/oauth/token`, {
      grant_type: 'authorization_code',
      code: params.get('code'),
      redirect_uri: `${ctx.origin}/auth/hackatime/callback`,
      client_id: ht.clientId,
      client_secret: ht.clientSecret,
      code_verifier: verifier,
    });
    accessToken = tokens.access_token;
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('the token endpoint gave no access token');
    const me = await getApi(config, '/api/v1/authenticated/me', accessToken);
    const id = me.data?.id;
    if (me.status !== 200 || (typeof id !== 'number' && typeof id !== 'string') || id === '') throw new Error(`/me answered ${me.status}`);
    hackatimeId = String(id).slice(0, 100);
  } catch (e) {
    console.error('Hackatime: connecting failed:', e.name === 'TimeoutError' ? 'timed out' : e.message);
    if (accessToken) revokeAt(config, accessToken);
    return failed(ctx, next, "Hackatime didn't answer just now. Please try again.");
  }

  // A Hackatime account is connected to one Smitten account at a time:
  // connecting it here moves it (the OAuth just proved it's theirs).
  const previous = db.all('SELECT id, hackatime_token FROM users WHERE hackatime_id = ? AND id != ?', hackatimeId, user.id);
  const old = user.hackatime_token ? decryptToken(config, user.id, user.hackatime_token) : null;
  for (const row of previous) {
    const token = decryptToken(config, row.id, row.hackatime_token);
    clearLink(row.id);
    if (token) revokeAt(config, token);
  }
  db.tx(() => {
    db.run('UPDATE users SET hackatime_id = ?, hackatime_token = ?, hackatime_connected_at = ?, updated_at = ? WHERE id = ?',
      hackatimeId, encryptToken(config, user.id, accessToken), Date.now(), Date.now(), user.id);
    // Hours from another Hackatime account don't carry over.
    db.run('UPDATE games SET hackatime_seconds = NULL, hackatime_checked_at = NULL WHERE owner_id = ?', user.id);
  });
  if (old && old !== accessToken) revokeAt(config, old);
  refreshUserGames(config, user.id);
  return redirect(withParam(next, 'connected', 'hackatime'), 302, { 'Set-Cookie': clearFlowCookie(ctx) });
}

// ---------------------------------------------------------------------------
// The API

/** DELETE /api/account/hackatime (session or editor): disconnects, and revokes the token at Hackatime. */
export async function disconnect(ctx) {
  const user = requireUser(ctx, { editor: true });
  const token = user.hackatime_token ? decryptToken(ctx.config, user.id, user.hackatime_token) : null;
  const was = Boolean(user.hackatime_id);
  clearLink(user.id);
  if (token) await revokeAt(ctx.config, token);
  return json({ ok: true, disconnected: was });
}

/**
 * GET /api/account/hackatime-key (editor or session): the person's Hackatime
 * API key, for the editor's heartbeats, fetched from Hackatime each time.
 * 404 {code: 'not-connected'} when the account isn't connected (or Hackatime
 * says the token was revoked, which clears the link).
 */
export async function getKey(ctx) {
  const { config } = ctx;
  if (!config.hackatime) throw turnedOff();
  const user = requireUser(ctx, { editor: true });
  if (auth(ctx).via === 'web') requireSameOrigin(ctx);
  const token = storedToken(config, user);
  if (!token) throw notConnected();
  rateLimit(`hackatime-key:u:${user.id}`, 60, 'asked for your Hackatime key');
  let r;
  try {
    r = await getApi(config, '/api/v1/authenticated/api_keys', token);
  } catch (e) {
    console.error('Hackatime: fetching an API key failed:', e.name === 'TimeoutError' ? 'timed out' : e.message);
    throw new HttpError(502, "Hackatime didn't answer just now. Please try again.");
  }
  if (revokedStatus(r.status)) {
    clearLink(user.id);
    throw notConnected();
  }
  const key = r.data?.token;
  if (r.status !== 200 || typeof key !== 'string' || !key) {
    console.error(`Hackatime: fetching an API key answered ${r.status}`);
    throw new HttpError(502, "Hackatime didn't answer just now. Please try again.");
  }
  return json({ key }, 200, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
}

// ---------------------------------------------------------------------------
// Game hours: the time Hackatime tracked for the game's project, cached on
// the game (hackatime_seconds, hackatime_checked_at) and refreshed in the
// background, at most once an hour per game (and right after publishing).

const refreshing = new Set();
const lastFailure = new Map();

/**
 * Refreshes a game's hours from Hackatime, in the background: never throws,
 * never blocks. force: right after publishing or connecting.
 */
export function refreshGameHours(config, gameId, { force = false } = {}) {
  if (!config.hackatime || refreshing.has(gameId)) return null;
  const row = db.get(`SELECT g.id, g.hackatime_project, g.hackatime_checked_at, u.id AS user_id, u.hackatime_id, u.hackatime_token
    FROM games g JOIN users u ON u.id = g.owner_id WHERE g.id = ?`, gameId);
  if (!row?.hackatime_project || !row.hackatime_id) return null;
  const now = Date.now();
  if (!force && (now - (row.hackatime_checked_at || 0) < HOUR || now - (lastFailure.get(gameId) || 0) < HOUR)) return null;
  refreshing.add(gameId);
  const job = (async () => {
    try {
      const token = storedToken(config, { id: row.user_id, hackatime_id: row.hackatime_id, hackatime_token: row.hackatime_token });
      if (!token) return;
      const r = await getApi(config, `/api/v1/authenticated/projects?${new URLSearchParams({ projects: row.hackatime_project })}`, token);
      if (revokedStatus(r.status)) {
        clearLink(row.user_id);
        return;
      }
      if (r.status !== 200 || !Array.isArray(r.data?.projects)) throw new Error(`projects answered ${r.status}`);
      const name = row.hackatime_project;
      const project = r.data.projects.find((p) => p?.name === name)
        ?? r.data.projects.find((p) => String(p?.name || '').toLowerCase() === name.toLowerCase());
      const seconds = Math.max(0, Math.round(Number(project?.total_seconds) || 0));
      // Only if the game still has that project and owner (it may have changed meanwhile).
      db.run(`UPDATE games SET hackatime_seconds = ?, hackatime_checked_at = ?
              WHERE id = ? AND hackatime_project = ? AND owner_id = ?`, seconds, Date.now(), gameId, name, row.user_id);
      lastFailure.delete(gameId);
    } catch (e) {
      lastFailure.set(gameId, Date.now());
      if (lastFailure.size > 10_000) lastFailure.clear();
      console.error(`Hackatime: refreshing game ${gameId}'s hours failed:`, e.name === 'TimeoutError' ? 'timed out' : e.message);
    } finally {
      refreshing.delete(gameId);
    }
  })();
  return job;
}

/** Refreshes every game of a user that has a project (after connecting). */
function refreshUserGames(config, userId) {
  const games = db.all('SELECT id FROM games WHERE owner_id = ? AND hackatime_project IS NOT NULL ORDER BY updated_at DESC LIMIT 100', userId);
  (async () => {
    for (const { id } of games) await refreshGameHours(config, id, { force: true });
  })().catch(() => {});
}

/** What a game's public view shows: {seconds, checkedAt}, or null. */
export function gameHours(row) {
  if (!row.owner_hackatime || !(row.hackatime_seconds > 0)) return null;
  return { seconds: row.hackatime_seconds, checkedAt: row.hackatime_checked_at };
}
