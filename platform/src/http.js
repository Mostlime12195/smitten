// Responses, errors, cookies, security headers and CORS. Handlers work with
// the web's Request and Response (as Node's fetch does); server.js converts
// to and from Node's http module.

/** An error with an HTTP status and a message that's safe to show people. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function redirect(location, status = 302, headers = {}) {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
}

export function errorResponse(e) {
  if (e instanceof HttpError) {
    const headers = {};
    if (e.extra.retryAfter) headers['Retry-After'] = String(e.extra.retryAfter);
    if (e.extra.allow) headers.Allow = e.extra.allow;
    const { retryAfter, allow, ...rest } = e.extra;
    return json({ error: e.message, ...rest }, e.status, headers);
  }
  console.error(e?.stack || e);
  return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
}

/** The request's JSON body (at most 16 KB, or max bytes), or a 4xx. */
export async function readJson(request, max = 16 * 1024) {
  if (!/^application\/json/i.test(request.headers.get('Content-Type') || '')) {
    throw new HttpError(415, 'Send JSON (Content-Type: application/json).');
  }
  if (Number(request.headers.get('Content-Length') || 0) > max) throw new HttpError(413, 'That request is too big.');
  let text;
  try {
    text = await request.text();
  } catch {
    throw new HttpError(400, "The request couldn't be read.");
  }
  if (text.length > max) throw new HttpError(413, 'That request is too big.');
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch { /* below */ }
  throw new HttpError(400, 'The request must be a JSON object.');
}

/** decodeURIComponent, or null for malformed percent-encoding (/%E0) instead of throwing. */
export function decodePart(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookies

export function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0 || part.slice(0, i).trim() !== name) continue;
    // A value that isn't valid percent-encoding counts as no cookie:
    // throwing would fail every request from that browser.
    const value = decodePart(part.slice(i + 1).trim());
    if (value !== null) return value;
  }
  return null;
}

/** A Set-Cookie value: HttpOnly, SameSite=Lax, Secure on https. maxAge in seconds (0 deletes it). */
export function cookie(config, name, value, { maxAge, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Security headers

// The gallery and play pages: only this site's own scripts, styles and
// images; the game runs in the player, in an iframe from this site. A
// game's page connects to the site's online rooms (src/rooms.js): 'self'
// covers ws: and wss: in today's browsers, the origin is for older ones.
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' WS_ORIGIN",
  "frame-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// The player runs the engine (WebAssembly, plus the JIT compiling Lua to
// WebAssembly at run time, hence 'wasm-unsafe-eval'). player.html has one
// inline handler (oncontextmenu="event.preventDefault()"), allowed by hash.
// connect-src limits what a game can reach with require("https").
function playerCsp(config) {
  const connect = config.gameNetwork === 'https' ? "'self' https:" : "'self'";
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-hashes' 'sha256-cwPror8N/Ds4hiaerviPOQ1rJd1zjNrEPnNZvr5x7Z8='",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

// JSON, game files and thumbnails are never documents.
const FILE_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

// Games get no camera, microphone or location (LÖVE's audio recording would
// ask for the microphone).
const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), display-capture=()';

/**
 * Adds the headers every response gets. kind: 'site' | 'auth' | 'player' | 'file'.
 * 'auth' pages (sign-in, the editor's sign-in popup) are like 'site' pages
 * but without Cross-Origin-Opener-Policy, which would cut the popup off from
 * the editor that opened it.
 */
export function withSecurityHeaders(res, kind, config) {
  const h = res.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', kind === 'auth' ? 'no-referrer' : 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', PERMISSIONS);
  if (kind === 'player') {
    h.set('Content-Security-Policy', playerCsp(config));
    h.set('X-Frame-Options', 'SAMEORIGIN');
  } else if (kind === 'site' || kind === 'auth') {
    h.set('Content-Security-Policy', SITE_CSP.replace('WS_ORIGIN', config.publicOrigin.replace(/^http/, 'ws')));
    h.set('X-Frame-Options', 'DENY');
    if (kind === 'site') h.set('Cross-Origin-Opener-Policy', 'same-origin');
  } else {
    h.set('Content-Security-Policy', FILE_CSP);
    h.set('X-Frame-Options', 'DENY');
  }
  if (config.secureCookies) h.set('Strict-Transport-Security', 'max-age=31536000');
  return res;
}

// ---------------------------------------------------------------------------
// CORS: the editor runs on another origin and publishes, updates, deletes
// and remixes games with an editor token (never cookies: no
// Access-Control-Allow-Credentials). Only EDITOR_ORIGINS get CORS headers.

export function allowedOrigin(request, config) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return config.editorOrigins.includes(origin) || config.editorOrigins.includes('*') ? origin : null;
}

export function withCors(res, request, config) {
  const origin = allowedOrigin(request, config);
  res.headers.append('Vary', 'Origin');
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  return res;
}

export function preflight(request, config) {
  const origin = allowedOrigin(request, config);
  if (!origin) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  });
}
