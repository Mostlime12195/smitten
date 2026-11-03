// Settings, from environment variables. `platform/.env` is read too when it
// exists (deploy/env.example lists every setting); variables already set in
// the environment win.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const list = (value) => String(value || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const flag = (value) => /^(1|true|yes|on)$/i.test(String(value || ''));

/** Reads the configuration. env defaults to process.env (plus platform/.env). */
export function loadConfig(env = null) {
  if (!env) {
    const file = process.env.ENV_FILE || join(ROOT, '.env');
    if (existsSync(file)) process.loadEnvFile(file);
    env = process.env;
  }
  const port = int(env.PORT, 8787);
  const publicUrl = new URL(env.PUBLIC_URL || `http://localhost:${port}`);
  const dataDir = resolve(ROOT, env.DATA_DIR || 'data');
  mkdirSync(join(dataDir, 'games'), { recursive: true });

  const config = {
    port,
    host: env.HOST || '127.0.0.1',
    // The address people use, behind any proxy: links, cookies (Secure when
    // https) and the CSRF check use it.
    publicOrigin: publicUrl.origin,
    secureCookies: publicUrl.protocol === 'https:',
    dataDir,
    dbFile: join(dataDir, 'smitten.db'),
    gamesDir: join(dataDir, 'games'),
    publicDir: join(ROOT, 'public'),

    editorUrl: env.EDITOR_URL || 'http://localhost:8766/',
    // Editors that may publish for a signed-in person (CORS, and where the
    // sign-in popup may send its code).
    editorOrigins: list(env.EDITOR_ORIGINS ?? 'http://localhost:8766,http://127.0.0.1:8766,http://localhost:8796,http://127.0.0.1:8796'),

    // Behind a reverse proxy (Nest's, or Caddy), the client's address is the
    // last one in X-Forwarded-For, believed only from the proxy: "1" trusts
    // connections from loopback and private addresses; or list the proxy's
    // addresses (a trailing * matches a prefix, e.g. "10.0.*,fd00:*").
    trustProxy: /^(0|false|no|off)?$/i.test(String(env.TRUST_PROXY || '')) ? false
      : flag(env.TRUST_PROXY) ? true : list(env.TRUST_PROXY),

    adminToken: env.ADMIN_TOKEN || '',
    secret: env.SECRET || readOrCreateSecret(dataDir),

    reportThreshold: Math.max(1, int(env.REPORT_THRESHOLD, 3)),
    maxGameBytes: int(env.MAX_GAME_BYTES, 25 * 1024 * 1024),
    maxThumbnailBytes: int(env.MAX_THUMBNAIL_BYTES, 1024 * 1024),
    publishLimit: int(env.PUBLISH_LIMIT_PER_HOUR, 10),
    reportLimit: int(env.REPORT_LIMIT_PER_HOUR, 20),
    signupLimit: int(env.SIGNUP_LIMIT_PER_HOUR, 5),
    signinLimit: int(env.SIGNIN_LIMIT_PER_HOUR, 30),
    gameNetwork: env.GAME_NETWORK === 'https' ? 'https' : 'self',

    // "Sign in with Hack Club" (https://auth.hackclub.com/docs/oidc-guide).
    // On when both the client id and secret are set.
    hackclub: env.HACKCLUB_CLIENT_ID && env.HACKCLUB_CLIENT_SECRET ? {
      clientId: env.HACKCLUB_CLIENT_ID,
      clientSecret: env.HACKCLUB_CLIENT_SECRET,
      url: (env.HACKCLUB_AUTH_URL || 'https://auth.hackclub.com').replace(/\/+$/, ''),
      scope: env.HACKCLUB_SCOPE || 'openid',
    } : null,

    // "Connect Hackatime" (src/hackatime.js): the editor gets the API key
    // with one click, and game pages show tracked hours. On when both the
    // client id and secret are set.
    hackatime: env.HACKATIME_CLIENT_ID && env.HACKATIME_CLIENT_SECRET ? {
      clientId: env.HACKATIME_CLIENT_ID,
      clientSecret: env.HACKATIME_CLIENT_SECRET,
      url: (env.HACKATIME_URL || 'https://hackatime.hackclub.com').replace(/\/+$/, ''),
      scope: 'profile read',
    } : null,

    // Email on accounts (src/email.js, src/mail.js): off unless
    // EMAIL_TRANSPORT is smtp, resend or log.
    email: emailConfig(env, publicUrl),

    // scrypt's cost (2^n). 15 takes ~50 ms and 32 MB per hash.
    scryptLogN: Math.min(20, Math.max(10, int(env.SCRYPT_LOG_N, 15))),
  };
  return config;
}

// An address mail can go to or come from: plain ASCII, no spaces or line
// breaks, one @, a dot in the domain.
export const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** EMAIL_FROM: "Name <address>" or "address" → {header, address}, or null. */
export function parseFrom(value) {
  const text = String(value || '').trim();
  const m = /^(?:"?([^"<>\r\n]*?)"?\s*)?<([^<>\s]+)>$/.exec(text) || /^()([^<>\s]+)$/.exec(text);
  if (!m || !EMAIL_PATTERN.test(m[2]) || m[2].includes('..')) return null;
  const name = m[1].trim();
  if (!name) return { header: m[2], address: m[2] };
  if (!/^[\x20-\x7e]*$/.test(name)) {
    return { header: `=?UTF-8?B?${Buffer.from(name).toString('base64')}?= <${m[2]}>`, address: m[2] };
  }
  const quoted = /^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~-]+$/.test(name) ? name : `"${name.replace(/[\\"]/g, '\\$&')}"`;
  return { header: `${quoted} <${m[2]}>`, address: m[2] };
}

function emailConfig(env, publicUrl) {
  const transport = String(env.EMAIL_TRANSPORT || '').trim().toLowerCase();
  if (!transport || /^(off|none|0|false|no)$/.test(transport)) return null;
  const problem = (message) => new Error(`Email settings: ${message} (see deploy/env.example), or leave EMAIL_TRANSPORT unset for no email.`);
  if (!['smtp', 'resend', 'log'].includes(transport)) throw problem(`EMAIL_TRANSPORT must be smtp, resend or log, not "${transport}"`);
  const host = publicUrl.hostname;
  const logDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && /[a-z]/i.test(host) ? host : 'localhost.localdomain';
  const from = parseFrom(env.EMAIL_FROM || (transport === 'log' ? `Smitten <no-reply@${logDomain}>` : ''));
  if (!from) throw problem('set EMAIL_FROM to the sender, like "Smitten <no-reply@games.example.com>"');
  const email = {
    transport,
    from: from.header,
    fromAddress: from.address,
    timeoutMs: Math.max(1, int(env.EMAIL_TIMEOUT_SECONDS, 20)) * 1000,
    // The first retry's delay; each one after waits four times as long.
    retryBaseMs: Math.max(10, int(env.EMAIL_RETRY_BASE_MS, 30_000)),
  };
  if (transport === 'smtp') {
    if (!env.SMTP_HOST) throw problem('set SMTP_HOST');
    const port = int(env.SMTP_PORT, 587);
    const secure = String(env.SMTP_SECURE || (port === 465 ? 'tls' : 'starttls')).toLowerCase();
    if (!['tls', 'starttls', 'none'].includes(secure)) throw problem('SMTP_SECURE must be tls (port 465), starttls (port 587) or none');
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) throw problem('set both SMTP_USER and SMTP_PASS, or neither');
    email.smtp = {
      host: env.SMTP_HOST,
      port,
      secure,
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      helo: env.SMTP_HELO || (/^[\d.]+$/.test(host) ? `[${host}]` : host.includes(':') ? `[IPv6:${host.replace(/^\[|\]$/g, '')}]` : host),
      timeoutMs: email.timeoutMs,
    };
  } else if (transport === 'resend') {
    if (!env.RESEND_API_KEY) throw problem('set RESEND_API_KEY');
    email.resend = { apiKey: env.RESEND_API_KEY, url: (env.RESEND_API_URL || 'https://api.resend.com').replace(/\/+$/, '') };
  } else {
    email.logFile = env.EMAIL_LOG_FILE ? resolve(ROOT, env.EMAIL_LOG_FILE) : null;
  }
  return email;
}

// A random secret kept in the data folder, so a fresh install works without
// setting SECRET. It salts IP hashes and signs recovery codes and cookies.
function readOrCreateSecret(dataDir) {
  const file = join(dataDir, 'secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('base64url');
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}
