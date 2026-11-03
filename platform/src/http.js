// Responses, errors, security headers and CORS.

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

// ---------------------------------------------------------------------------
// Security headers

// The gallery and play pages: only this site's own scripts, styles and
// images; the game runs in the player, in an iframe from this site.
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
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
function playerCsp(env) {
  const connect = env.GAME_NETWORK === 'https' ? "'self' https:" : "'self'";
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

/** Adds the headers every response gets. kind: 'site' | 'player' | 'file'. */
export function withSecurityHeaders(res, kind, env) {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', PERMISSIONS);
  if (kind === 'player') {
    h.set('Content-Security-Policy', playerCsp(env));
    h.set('X-Frame-Options', 'SAMEORIGIN');
  } else if (kind === 'site') {
    h.set('Content-Security-Policy', SITE_CSP);
    h.set('X-Frame-Options', 'DENY');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
  } else {
    h.set('Content-Security-Policy', FILE_CSP);
    h.set('X-Frame-Options', 'DENY');
  }
  return out;
}

// ---------------------------------------------------------------------------
// CORS: the editor runs on another origin and publishes, updates, deletes
// and remixes games. Only the origins in ALLOWED_ORIGINS get CORS headers.

export function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin) || allowed.includes('*') ? origin : null;
}

export function withCors(res, request, env) {
  const origin = allowedOrigin(request, env);
  const out = new Response(res.body, res);
  out.headers.append('Vary', 'Origin');
  if (origin) {
    out.headers.set('Access-Control-Allow-Origin', origin);
    out.headers.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  return out;
}

export function preflight(request, env) {
  const origin = allowedOrigin(request, env);
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
