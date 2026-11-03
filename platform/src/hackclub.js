// "Sign in with Hack Club", through Hack Club Auth's OpenID Connect
// (https://auth.hackclub.com/docs/oidc-guide). On when HACKCLUB_CLIENT_ID
// and HACKCLUB_CLIENT_SECRET are set; register the app at
// https://auth.hackclub.com/developer/apps with the redirect URI
// <PUBLIC_URL>/auth/hackclub/callback.
//
// The authorization code flow, with state and PKCE: /auth/hackclub sends the
// browser to Hack Club, which sends it back to /auth/hackclub/callback with
// a code; the server swaps the code for an access token (with the client
// secret) and asks the userinfo endpoint who it is. Only the "sub" (a
// stable id) is kept. Someone new picks a username next (/signup?via=hackclub).

import { createHash, randomBytes } from 'node:crypto';
import { HttpError, cookie, readCookie, redirect } from './http.js';
import { db } from './db.js';
import { SESSION_COOKIE, SESSION_DAYS, auth, createSession } from './auth.js';
import { pendingHackclubCookie } from './account.js';

const FLOW_COOKIE = 'smitten_hackclub_flow';

/** A local path to go back to after signing in (never another site). */
export function safeNext(value, fallback = '/') {
  const next = String(value || '');
  return /^\/(?![/\\])[^\s]*$/.test(next) ? next : fallback;
}

function failed(ctx, message) {
  return redirect(`/signin?error=${encodeURIComponent(message)}`, 302, {
    'Set-Cookie': cookie(ctx.config, FLOW_COOKIE, '', { maxAge: 0, path: '/auth/hackclub' }),
  });
}

/** GET /auth/hackclub?next=<path>[&link=1]: off to Hack Club. link=1 connects it to the signed-in account. */
export function start(ctx) {
  const hc = ctx.config.hackclub;
  if (!hc) throw new HttpError(404, 'Signing in with Hack Club is turned off on this site.');
  const state = randomBytes(18).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const link = ctx.url.searchParams.get('link') === '1' ? '1' : '0';
  const next = safeNext(ctx.url.searchParams.get('next'), link === '1' ? '/account' : '/');
  const flow = [state, verifier, link, Buffer.from(next).toString('base64url')].join('.');
  const p = new URLSearchParams({
    client_id: hc.clientId,
    redirect_uri: `${ctx.origin}/auth/hackclub/callback`,
    response_type: 'code',
    scope: hc.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return redirect(`${hc.url}/oauth/authorize?${p}`, 302, {
    'Set-Cookie': cookie(ctx.config, FLOW_COOKIE, flow, { maxAge: 600, path: '/auth/hackclub' }),
  });
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`token endpoint answered ${res.status}: ${data?.error || ''}`);
  return data;
}

/** GET /auth/hackclub/callback?code=&state= */
export async function callback(ctx) {
  const hc = ctx.config.hackclub;
  if (!hc) throw new HttpError(404, 'Signing in with Hack Club is turned off on this site.');
  const [state, verifier, link, nextB64] = (readCookie(ctx.request, FLOW_COOKIE) || '').split('.');
  const params = ctx.url.searchParams;
  if (params.get('error')) return failed(ctx, 'Hack Club sign-in was cancelled.');
  if (!state || params.get('state') !== state || !params.get('code')) {
    return failed(ctx, 'That Hack Club sign-in expired or came from somewhere else. Please try again.');
  }
  const next = safeNext(Buffer.from(nextB64 || '', 'base64url').toString());

  let sub;
  try {
    const tokens = await postForm(`${hc.url}/oauth/token`, {
      grant_type: 'authorization_code',
      code: params.get('code'),
      redirect_uri: `${ctx.origin}/auth/hackclub/callback`,
      client_id: hc.clientId,
      client_secret: hc.clientSecret,
      code_verifier: verifier,
    });
    const res = await fetch(`${hc.url}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const info = await res.json().catch(() => null);
    if (!res.ok || typeof info?.sub !== 'string' || !info.sub) throw new Error(`userinfo answered ${res.status}`);
    sub = info.sub.slice(0, 200);
  } catch (e) {
    console.error('Hack Club sign-in failed:', e.message);
    return failed(ctx, "Hack Club's sign-in didn't work just now. Please try again.");
  }

  const clearFlow = cookie(ctx.config, FLOW_COOKIE, '', { maxAge: 0, path: '/auth/hackclub' });
  const existing = db.get('SELECT * FROM users WHERE hackclub_id = ?', sub);

  if (link === '1') {
    const current = auth(ctx)?.via === 'web' ? auth(ctx).user : null;
    if (!current) return failed(ctx, 'Sign in first, then connect your Hack Club account from your account settings.');
    if (existing && existing.id !== current.id) {
      return redirect(`/account?error=${encodeURIComponent('That Hack Club account is already connected to another Smitten account.')}`, 302, { 'Set-Cookie': clearFlow });
    }
    db.run('UPDATE users SET hackclub_id = ?, updated_at = ? WHERE id = ?', sub, Date.now(), current.id);
    return redirect('/account?connected=hackclub', 302, { 'Set-Cookie': clearFlow });
  }

  if (existing) {
    if (existing.status !== 'active') return failed(ctx, 'This account has been suspended by a moderator.');
    const { token } = createSession(existing.id, 'web');
    const res = redirect(next, 302, { 'Set-Cookie': clearFlow });
    res.headers.append('Set-Cookie', cookie(ctx.config, SESSION_COOKIE, token, { maxAge: SESSION_DAYS.web * 86400 }));
    return res;
  }
  // Someone new: pick a username.
  const res = redirect(`/signup?via=hackclub&next=${encodeURIComponent(next)}`, 302, { 'Set-Cookie': clearFlow });
  res.headers.append('Set-Cookie', pendingHackclubCookie(ctx, sub));
  return res;
}
