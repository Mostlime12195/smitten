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

    // scrypt's cost (2^n). 15 takes ~50 ms and 32 MB per hash.
    scryptLogN: Math.min(20, Math.max(10, int(env.SCRYPT_LOG_N, 15))),
  };
  return config;
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
