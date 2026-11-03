// Tests the game-sharing site (platform/): its pages, the API, accounts,
// sessions, the editor's sign-in, ownership, claiming old games, moderation,
// banning, and connecting Hackatime.
//
//   node tools/platform-tests/test.mjs
//
// It starts the server itself on port 8788 (PLATFORM_PORT changes it) with
// an empty data folder, an admin token, and stand-ins for Hack Club Auth and
// Hackatime, and stops it at the end (plus, briefly, a second server on the
// next port without Hackatime). To test a server that's already running
// instead, set PLATFORM_URL (and ADMIN_TOKEN for the admin checks); tests
// that need the server's database or the stand-ins are skipped then. That
// server must run with TRUST_PROXY=1 and PUBLIC_URL set to PLATFORM_URL:
// the tests act as many different people by sending X-Forwarded-For.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EDITOR_ORIGIN = 'http://localhost:8766';
const external = Boolean(process.env.PLATFORM_URL);
const PORT = Number(process.env.PLATFORM_PORT || 8788);
const BASE = (process.env.PLATFORM_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
const ADMIN = external ? process.env.ADMIN_TOKEN || null : randomBytes(24).toString('base64url');
const HC = { clientId: 'smitten-test', clientSecret: randomBytes(16).toString('hex') };
const HT = { clientId: 'smitten-hackatime-test', clientSecret: randomBytes(16).toString('hex') };

// ---------------------------------------------------------------------------
// A tiny test runner

let passed = 0;
let failed = 0;
let skipped = 0;
const cleanup = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(e?.stack || e).split('\n').slice(0, 6).join('\n       ')}`);
  }
}

function skip(name, why) {
  skipped++;
  console.log(`  skip ${name} (${why})`);
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Requests. Every request comes from a made-up address unless a test picks
// one, so rate limits don't get in the way.

const run = Math.floor(Math.random() * 200) + 20;
let ipCounter = 0;
const freshIp = () => `10.${run}.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

/**
 * call(method, path, options): {status, headers, data, cookies}.
 * token: Authorization: Bearer; session: the site's session cookie (and
 * Origin: the site, as its pages send); cookies: more cookies.
 */
async function call(method, path, { body, headers = {}, ip = freshIp(), token, session, cookies = {}, site = Boolean(session) } = {}) {
  const h = { 'X-Forwarded-For': ip, ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const jar = { ...cookies };
  if (session) jar.smitten_session = session;
  if (Object.keys(jar).length) h.Cookie = Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  if (site && !('Origin' in h)) h.Origin = BASE;
  if (body && !(body instanceof FormData) && typeof body !== 'string' && !(body instanceof Uint8Array)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body, redirect: 'manual' });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  const set = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    set[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return { status: res.status, headers: res.headers, data, cookies: set, setCookie: res.headers.getSetCookie() };
}

// ---------------------------------------------------------------------------
// Accounts

const PASSWORD = 'correct horse battery';
let userCounter = 0;
const uniqueName = (prefix = 'tester') => `${prefix}${run}${(++userCounter).toString(36)}${Date.now().toString(36).slice(-4)}`.slice(0, 20);

/** Signs up someone new: {username, session, recoveryCodes, user}. */
async function signUp({ username = uniqueName(), password = PASSWORD, displayName } = {}) {
  const r = await call('POST', '/api/auth/signup', { body: { username, password, displayName }, site: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { username, password, session: r.cookies.smitten_session, recoveryCodes: r.data.recoveryCodes, user: r.data.user };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** The editor's sign-in, as web/editor/account.js does it: a code from the site, swapped for a token. */
async function editorToken(session, { origin = EDITOR_ORIGIN } = {}) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const code = await call('POST', '/api/auth/editor/code', { body: { origin, challenge }, session });
  assert.equal(code.status, 200, JSON.stringify(code.data));
  const r = await call('POST', '/api/auth/editor/token', { body: { code: code.data.code, verifier }, headers: { Origin: origin } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}

/** Someone with an account and a signed-in editor. */
async function person(opts) {
  const p = await signUp(opts);
  p.token = await editorToken(p.session);
  return p;
}

// ---------------------------------------------------------------------------
// Zips and PNGs

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A stored (uncompressed) zip of {path: string | Uint8Array}. flags: extra general-purpose bits. */
function zip(files, { flags = 0 } = {}) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800 | flags, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800 | flags, 8);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

function png(width = 2, height = 2) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const tag = `t${run}${Date.now().toString(36)}`;
const smokeFiles = () => {
  const dir = `${ROOT}tools/scene-tests/smoke/`;
  return {
    'smitten.json': readFileSync(`${dir}smitten.json`, 'utf8'),
    'scenes/main.scene': readFileSync(`${dir}scenes/main.scene`, 'utf8'),
    'scenes/main.lua': readFileSync(`${dir}scenes/main.lua`, 'utf8'),
  };
};
const mainLuaGame = (text = 'function love.draw() love.graphics.print("hi", 10, 10) end') => zip({ 'main.lua': text });

function form(meta, game, thumbnail) {
  const f = new FormData();
  f.append('meta', typeof meta === 'string' ? meta : JSON.stringify(meta));
  if (game) f.append('game', new Blob([game], { type: 'application/zip' }), 'game.love');
  if (thumbnail) f.append('thumbnail', new Blob([thumbnail], { type: 'image/png' }), 'thumbnail.png');
  return f;
}

// Publishing is limited per account and hour, so games without a chosen
// publisher go out from a series of accounts.
let publisher = null;
let publisherCount = 0;
async function defaultPublisher() {
  if (!publisher || publisherCount >= 8) {
    publisher = await person();
    publisherCount = 0;
  }
  publisherCount++;
  return publisher;
}

async function publish(meta, game = mainLuaGame(), thumbnail = null, opts = {}) {
  const token = opts.token ?? (await defaultPublisher()).token;
  const res = await call('POST', '/api/games', { body: form({ description: '', ...meta }, game, thumbnail), ...opts, token });
  if (res.status === 201) cleanup.push({ id: res.data.id, token });
  return res;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const ID = /^[0-9a-hjkmnp-tv-z]{10}$/;

// ---------------------------------------------------------------------------
// The server, a stand-in for Hack Club Auth, and the server's database

let server = null;
let dataDir = null;
let db = null;

/** Hack Club Auth's OIDC endpoints, as https://auth.hackclub.com/docs/oidc-guide describes them. */
const fakeHackclub = {
  nextSub: null,
  codes: new Map(),
  tokens: new Map(),
  lastAuthorize: null,
  server: null,
  url: null,
  async start() {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const send = (status, data, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(data ? JSON.stringify(data) : undefined);
      };
      if (url.pathname === '/oauth/authorize') {
        const p = Object.fromEntries(url.searchParams);
        this.lastAuthorize = p;
        if (p.client_id !== HC.clientId || p.response_type !== 'code') return send(400, { error: 'invalid_request' });
        const code = randomBytes(12).toString('hex');
        this.codes.set(code, { sub: this.nextSub, challenge: p.code_challenge, redirect: p.redirect_uri });
        return send(302, null, { Location: `${p.redirect_uri}?code=${code}&state=${encodeURIComponent(p.state)}` });
      }
      if (url.pathname === '/oauth/token' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const p = Object.fromEntries(new URLSearchParams(body));
        const grant = this.codes.get(p.code);
        this.codes.delete(p.code);
        const challenge = b64url(createHash('sha256').update(p.code_verifier || '').digest());
        if (!grant || p.client_secret !== HC.clientSecret || p.client_id !== HC.clientId || p.redirect_uri !== grant.redirect || challenge !== grant.challenge) {
          return send(400, { error: 'invalid_grant' });
        }
        const access = randomBytes(12).toString('hex');
        this.tokens.set(access, grant.sub);
        return send(200, { access_token: access, token_type: 'Bearer', id_token: 'unused' });
      }
      if (url.pathname === '/oauth/userinfo') {
        const sub = this.tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
        return sub ? send(200, { sub }) : send(401, { error: 'invalid_token' });
      }
      return send(404, { error: 'not found' });
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${this.server.address().port}`;
  },
};

/**
 * Hackatime's OAuth and the API endpoints the site uses, as its docs and
 * OpenAPI describe them. users: access token → the Hackatime user
 * {id, apiKey, projects: {name: seconds}}.
 */
const fakeHackatime = {
  nextUser: null,
  codes: new Map(),
  tokens: new Map(),
  issued: [],
  revoked: [],
  projectCalls: 0,
  keyCalls: 0,
  lastAuthorize: null,
  server: null,
  url: null,
  async start() {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const send = (status, data, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(data ? JSON.stringify(data) : undefined);
      };
      const form = async () => {
        let body = '';
        for await (const chunk of req) body += chunk;
        return Object.fromEntries(new URLSearchParams(body));
      };
      const who = () => this.tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      if (url.pathname === '/oauth/authorize') {
        const p = Object.fromEntries(url.searchParams);
        this.lastAuthorize = p;
        if (p.client_id !== HT.clientId || p.response_type !== 'code' || p.code_challenge_method !== 'S256') return send(400, { error: 'invalid_request' });
        const code = randomBytes(12).toString('hex');
        this.codes.set(code, { user: this.nextUser, challenge: p.code_challenge, redirect: p.redirect_uri });
        return send(302, null, { Location: `${p.redirect_uri}?code=${code}&state=${encodeURIComponent(p.state)}` });
      }
      if (url.pathname === '/oauth/token' && req.method === 'POST') {
        const p = await form();
        const grant = this.codes.get(p.code);
        this.codes.delete(p.code);
        const challenge = b64url(createHash('sha256').update(p.code_verifier || '').digest());
        if (!grant || p.grant_type !== 'authorization_code' || p.client_secret !== HT.clientSecret || p.client_id !== HT.clientId
          || p.redirect_uri !== grant.redirect || challenge !== grant.challenge) {
          return send(400, { error: 'invalid_grant' });
        }
        const access = `htat_${randomBytes(16).toString('hex')}`;
        this.tokens.set(access, grant.user);
        this.issued.push(access);
        return send(200, { access_token: access, token_type: 'Bearer', expires_in: 504921600, scope: 'profile read', created_at: Math.floor(Date.now() / 1000) });
      }
      if (url.pathname === '/oauth/revoke' && req.method === 'POST') {
        const p = await form();
        if (p.client_id !== HT.clientId || p.client_secret !== HT.clientSecret) return send(401, { error: 'invalid_client' });
        this.revoked.push(p.token);
        this.tokens.delete(p.token);
        return send(200, {});
      }
      if (this.failing) return send(500, { error: 'Internal Server Error' });
      const user = who();
      if (url.pathname.startsWith('/api/v1/authenticated/') && !user) return send(401, { error: 'Unauthorized' });
      if (url.pathname === '/api/v1/authenticated/me') {
        return send(200, { id: user.id, emails: [`person${user.id}@example.com`], slack_id: 'U0SECRET', github_username: 'someone', trust_factor: { trust_level: 'blue' } });
      }
      if (url.pathname === '/api/v1/authenticated/api_keys') {
        this.keyCalls++;
        return send(200, { token: user.apiKey });
      }
      if (url.pathname === '/api/v1/authenticated/projects') {
        this.projectCalls++;
        const wanted = (url.searchParams.get('projects') || '').split(',').filter(Boolean);
        const projects = Object.entries(user.projects)
          .filter(([name]) => !wanted.length || wanted.includes(name))
          .map(([name, seconds]) => ({ name, total_seconds: seconds, most_recent_heartbeat: new Date().toISOString(), languages: ['Lua'], archived: false }));
        return send(200, { projects });
      }
      return send(404, { error: 'not found' });
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${this.server.address().port}`;
  },
};

/** Starts the site with env on port; resolves with the child process once it answers. */
async function spawnServer(port, dir, env) {
  const child = spawn(process.execPath, [`${ROOT}platform/src/server.js`], {
    env: {
      PATH: process.env.PATH,
      ENV_FILE: join(dir, 'no.env'),
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      DATA_DIR: dir,
      TRUST_PROXY: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.output = () => output;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/config`);
      return child;
    } catch {
      if (child.exitCode != null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  child.kill();
  throw new Error(`The server didn't start:\n${output}`);
}

async function startServer() {
  dataDir = mkdtempSync(join(tmpdir(), 'smitten-platform-test-'));
  await fakeHackclub.start();
  await fakeHackatime.start();
  server = await spawnServer(PORT, dataDir, {
    PUBLIC_URL: BASE,
    ADMIN_TOKEN: ADMIN,
    HACKCLUB_CLIENT_ID: HC.clientId,
    HACKCLUB_CLIENT_SECRET: HC.clientSecret,
    HACKCLUB_AUTH_URL: fakeHackclub.url,
    HACKATIME_CLIENT_ID: HT.clientId,
    HACKATIME_CLIENT_SECRET: HT.clientSecret,
    HACKATIME_URL: fakeHackatime.url,
  });
  db = new DatabaseSync(join(dataDir, 'smitten.db'));
  db.exec('PRAGMA busy_timeout = 5000');
}

function stopServer() {
  db?.close();
  server?.kill();
  fakeHackclub.server?.close();
  fakeHackatime.server?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

/** Waits until check() returns something truthy (polling every 50 ms), or fails after ms. */
async function eventually(check, what, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A game published the old way (before accounts), with an edit token, written straight into the database. */
function legacyGame(title) {
  const id = Array.from(randomBytes(10), (b) => '0123456789abcdefghjkmnpqrstvwxyz'[b & 31]).join('');
  const token = randomBytes(32).toString('base64url');
  const love = mainLuaGame();
  mkdirSync(join(dataDir, 'games', id), { recursive: true });
  writeFileSync(join(dataDir, 'games', id, 'game.love'), love);
  const now = Date.now();
  db.prepare(`INSERT INTO games (id, token_hash, title, description, modules, game_size, created_at, updated_at)
              VALUES (?, ?, ?, '', '[]', ?, ?, ?)`).run(id, createHash('sha256').update(token).digest('hex'), title, love.length, now, now);
  return { id, token };
}

// ---------------------------------------------------------------------------

async function main() {
  if (!external) await startServer();
  try {
    await fetch(`${BASE}/api/config`);
  } catch {
    console.error(`Nothing answers at ${BASE}.`);
    process.exit(2);
  }
  console.log(`Testing ${BASE}${ADMIN ? '' : ' (no ADMIN_TOKEN: admin checks are skipped)'}`);

  section('Pages and headers');
  await test('config lists report reasons, modules, limits and sign-in options', async () => {
    const r = await call('GET', '/api/config');
    assert.equal(r.status, 200);
    assert.ok(r.data.reportReasons.length >= 3);
    assert.ok(r.data.modules.includes('physics2d'));
    assert.equal(r.data.limits.gameBytes, 25 * 1024 * 1024);
    assert.equal(r.data.limits.thumbnailBytes, 1024 * 1024);
    assert.ok(r.data.editorUrl);
    assert.ok(r.data.editorOrigins.includes(EDITOR_ORIGIN));
    assert.equal(typeof r.data.accounts.hackclub, 'boolean');
    assert.equal(typeof r.data.accounts.hackatime, 'boolean');
  });
  await test('the gallery is HTML with a CSP, nosniff and no framing', async () => {
    const r = await call('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/html/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.match(new TextDecoder().decode(r.data), /<meta name="smitten-editor-url" content="http/);
  });
  await test('account pages are served, and the sign-in pages keep window.opener (no COOP)', async () => {
    for (const path of ['/signin', '/signup', '/recover', '/editor-auth']) {
      const r = await call('GET', path);
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(r.headers.get('cross-origin-opener-policy'), null, path);
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    }
    assert.equal((await call('GET', '/account')).status, 200);
    assert.equal((await call('GET', '/u/someone')).status, 200);
    assert.equal((await call('GET', '/signin.html')).status, 404, 'pages are only served at their paths');
  });
  await test('static files have content types and ETags', async () => {
    const r = await call('GET', '/site.css');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/css/);
    const again = await call('GET', '/site.css', { headers: { 'If-None-Match': r.headers.get('etag') } });
    assert.equal(again.status, 304);
    assert.equal((await call('GET', '/../package.json')).status, 404);
    assert.equal((await call('GET', '/%2e%2e/package.json')).status, 404);
  });
  await test('API responses are JSON with nosniff and a sandboxing CSP', async () => {
    const r = await call('GET', '/api/games');
    assert.match(r.headers.get('content-type'), /^application\/json/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'.*sandbox/);
  });
  await test('unknown pages are 404s, unknown API paths JSON 404s', async () => {
    assert.equal((await call('GET', '/no-such-page')).status, 404);
    const r = await call('GET', '/api/nope');
    assert.equal(r.status, 404);
    assert.ok(r.data.error);
  });
  await test('wrong methods get 405 with Allow', async () => {
    const r = await call('PATCH', '/api/games/abcdefghjk');
    assert.equal(r.status, 405);
    assert.match(r.headers.get('allow'), /GET/);
  });

  const player = await call('GET', '/player/player.html');
  if (player.status === 503) {
    skip('player page headers', 'the player isn\'t copied: run platform/scripts/copy-player.sh');
  } else {
    await test('the player page allows WebAssembly and is only framed by the site', async () => {
      assert.equal(player.status, 200);
      const csp = player.headers.get('content-security-policy');
      assert.match(csp, /'wasm-unsafe-eval'/);
      assert.match(csp, /frame-ancestors 'self'/);
      assert.match(csp, /connect-src 'self'/);
      assert.match(player.headers.get('permissions-policy'), /microphone=\(\)/);
    });
    await test('the player only runs games from this site, with known modules', async () => {
      assert.equal((await call('GET', `/player/player.html?game=${encodeURIComponent('https://evil.example/x.love')}`)).status, 400);
      assert.equal((await call('GET', `/player/player.html?game=${encodeURIComponent('/api/games/abcdefghjk/x.love')}&modules=evil`)).status, 400);
      assert.equal((await call('GET', `/player/player.html?game=${encodeURIComponent('/api/games/abcdefghjk/My%20game.love')}&modules=physics2d`)).status, 200);
    });
    await test('engine files have the right content types', async () => {
      const r = await fetch(`${BASE}/player/smitten.wasm`, { method: 'HEAD' });
      assert.equal(r.headers.get('content-type'), 'application/wasm');
      const js = await fetch(`${BASE}/player/player.js`, { method: 'HEAD' });
      assert.match(js.headers.get('content-type'), /javascript/);
    });
  }

  section('CORS');
  await test('the editor\'s origin may publish (preflight)', async () => {
    const r = await call('OPTIONS', '/api/games', { headers: { Origin: EDITOR_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
    assert.match(r.headers.get('access-control-allow-methods'), /PUT/);
    assert.match(r.headers.get('access-control-allow-headers'), /Authorization/i);
    assert.equal(r.headers.get('access-control-allow-credentials'), null, 'never with cookies');
  });
  await test('other origins get no CORS headers', async () => {
    const pre = await call('OPTIONS', '/api/games', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 403);
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
    const get = await call('GET', '/api/games', { headers: { Origin: 'https://evil.example' } });
    assert.equal(get.headers.get('access-control-allow-origin'), null);
    assert.match(get.headers.get('vary'), /Origin/);
  });
  await test('remix reads carry CORS headers for the editor', async () => {
    const r = await call('GET', '/api/games', { headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
  });
  await test('admin endpoints never answer preflights', async () => {
    const r = await call('OPTIONS', '/api/admin/reports', { headers: { Origin: EDITOR_ORIGIN, 'Access-Control-Request-Method': 'GET' } });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });

  // -------------------------------------------------------------------------
  section('Signing up');
  let alice;
  await test('sign up: a session cookie, eight recovery codes, no email asked', async () => {
    const username = uniqueName('alice');
    const r = await call('POST', '/api/auth/signup', { body: { username: username.toUpperCase(), password: PASSWORD, displayName: '  Alice  W. ' }, site: true });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.deepEqual(Object.keys(r.data.user).sort(), ['createdAt', 'displayName', 'hackatime', 'hackclub', 'hasPassword', 'username']);
    assert.equal(r.data.user.username, username, 'usernames are lower case');
    assert.equal(r.data.user.displayName, 'Alice W.');
    assert.equal(r.data.recoveryCodes.length, 8);
    assert.equal(new Set(r.data.recoveryCodes).size, 8);
    const cookie = r.setCookie.find((c) => c.startsWith('smitten_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=\d+/);
    alice = { username, password: PASSWORD, session: r.cookies.smitten_session, recoveryCodes: r.data.recoveryCodes };
  });
  if (!alice) throw new Error('Signing up failed; the remaining tests depend on it.');
  await test('the session says who\'s signed in', async () => {
    const r = await call('GET', '/api/account', { session: alice.session });
    assert.equal(r.data.user.username, alice.username);
    assert.equal(r.data.via, 'web');
    assert.equal(r.data.recoveryCodesLeft, 8);
    const nobody = await call('GET', '/api/account');
    assert.equal(nobody.status, 200);
    assert.equal(nobody.data.user, null);
  });
  await test('usernames: rules, reserved names, the word filter, and taken (any case)', async () => {
    const bad = async (username, why) => {
      const r = await call('POST', '/api/auth/signup', { body: { username, password: PASSWORD }, site: true });
      assert.equal(r.status, why === 'taken' ? 409 : 422, `${username}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.field, 'username');
    };
    await bad('ab');
    await bad('has space');
    await bad('_leading');
    await bad('x'.repeat(21));
    await bad('admin');
    await bad('moderator');
    await bad('sh1t_lord');
    await bad('fuckface99');
    await bad(alice.username.toUpperCase(), 'taken');
  });
  await test('passwords: long enough, not common, not the username', async () => {
    const bad = async (password, username = uniqueName()) => {
      const r = await call('POST', '/api/auth/signup', { body: { username, password }, site: true });
      assert.equal(r.status, 422, JSON.stringify(r.data));
      assert.equal(r.data.field, 'password');
    };
    await bad('short');
    await bad('password123');
    await bad('aaaaaaaaaaaa');
    const name = uniqueName();
    await bad(`${name}!!`, name);
  });
  await test('display names go through the word filter', async () => {
    const r = await call('POST', '/api/auth/signup', { body: { username: uniqueName(), password: PASSWORD, displayName: 'B1tch' }, site: true });
    assert.equal(r.status, 422);
    assert.equal(r.data.field, 'displayName');
  });
  await test('signing up only works from the site itself', async () => {
    const body = { username: uniqueName(), password: PASSWORD };
    assert.equal((await call('POST', '/api/auth/signup', { body })).status, 403);
    assert.equal((await call('POST', '/api/auth/signup', { body, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call('POST', '/api/auth/signup', { body, headers: { Origin: EDITOR_ORIGIN } })).status, 403);
  });
  await test('sign-ups are limited per address', async () => {
    const ip = freshIp();
    let last;
    for (let i = 0; i < 6; i++) last = await call('POST', '/api/auth/signup', { body: { username: uniqueName(), password: PASSWORD }, site: true, ip });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
  });

  section('Signing in and out');
  await test('the right password signs in; a wrong one or an unknown name gets the same answer', async () => {
    const ok = await call('POST', '/api/auth/signin', { body: { username: alice.username, password: PASSWORD }, site: true });
    assert.equal(ok.status, 200);
    assert.ok(ok.cookies.smitten_session);
    assert.notEqual(ok.cookies.smitten_session, alice.session, 'each sign-in is a new session');
    const wrong = await call('POST', '/api/auth/signin', { body: { username: alice.username, password: 'not it at all' }, site: true });
    const unknown = await call('POST', '/api/auth/signin', { body: { username: uniqueName(), password: 'not it at all' }, site: true });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.error, unknown.data.error);
  });
  await test('signing out ends the session', async () => {
    const s = await call('POST', '/api/auth/signin', { body: { username: alice.username, password: PASSWORD }, site: true });
    const session = s.cookies.smitten_session;
    const out = await call('POST', '/api/auth/signout', { session });
    assert.equal(out.status, 200);
    assert.match(out.setCookie.join(), /smitten_session=;.*Max-Age=0/);
    assert.equal((await call('GET', '/api/account', { session })).data.user, null);
  });
  await test('ten failed sign-ins lock an account for the hour, from any address', async () => {
    const bob = await signUp();
    for (let i = 0; i < 10; i++) {
      const r = await call('POST', '/api/auth/signin', { body: { username: bob.username, password: `wrong ${i}` }, site: true });
      assert.equal(r.status, 401);
    }
    const r = await call('POST', '/api/auth/signin', { body: { username: bob.username, password: PASSWORD }, site: true });
    assert.equal(r.status, 429);
    assert.match(r.data.error, /try again/);
  });
  await test('sign-in attempts are limited per address', async () => {
    const ip = freshIp();
    let last;
    for (let i = 0; i < 31; i++) last = await call('POST', '/api/auth/signin', { body: { username: uniqueName(), password: 'whatever it is' }, site: true, ip });
    assert.equal(last.status, 429);
  });

  section('Account settings');
  await test('change the display name', async () => {
    const r = await call('PATCH', '/api/account', { body: { displayName: 'Alice the Great' }, session: alice.session });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.displayName, 'Alice the Great');
    assert.equal((await call('PATCH', '/api/account', { body: { displayName: 'sh!t' }, session: alice.session })).status, 422);
  });
  await test('cookie requests that change things must come from the site (CSRF)', async () => {
    const body = { displayName: 'Hacked' };
    assert.equal((await call('PATCH', '/api/account', { body, session: alice.session, site: false })).status, 403);
    assert.equal((await call('PATCH', '/api/account', { body, session: alice.session, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call('PATCH', '/api/account', { body, session: alice.session, headers: { Origin: EDITOR_ORIGIN } })).status, 403);
    assert.equal((await call('PATCH', '/api/account', { body, session: alice.session, site: false, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
    await call('PATCH', '/api/account', { body: { displayName: 'Alice the Great' }, session: alice.session });
  });
  await test('changing the password needs the current one and signs out everywhere else', async () => {
    const carol = await person();
    const other = (await call('POST', '/api/auth/signin', { body: { username: carol.username, password: PASSWORD }, site: true })).cookies.smitten_session;
    const wrong = await call('POST', '/api/account/password', { body: { current: 'nope nope nope', password: 'a brand new secret' }, session: carol.session });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.data.field, 'current');
    const r = await call('POST', '/api/account/password', { body: { current: PASSWORD, password: 'a brand new secret' }, session: carol.session });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await call('GET', '/api/account', { session: carol.session })).data.user.username, carol.username, 'this session stays');
    assert.equal((await call('GET', '/api/account', { session: other })).data.user, null, 'other sessions end');
    const editor = await call('GET', '/api/account', { token: carol.token });
    assert.equal(editor.status, 401, 'editors are signed out');
    assert.equal(editor.data.code, 'signed-out');
    assert.equal((await call('POST', '/api/auth/signin', { body: { username: carol.username, password: 'a brand new secret' }, site: true })).status, 200);
  });
  await test('new recovery codes need the password, and replace the old ones', async () => {
    const dave = await signUp();
    assert.equal((await call('POST', '/api/account/recovery-codes', { body: { password: 'wrong wrong' }, session: dave.session })).status, 403);
    const r = await call('POST', '/api/account/recovery-codes', { body: { password: PASSWORD }, session: dave.session });
    assert.equal(r.status, 200);
    assert.equal(r.data.recoveryCodes.length, 8);
    const old = await call('POST', '/api/auth/recover', { body: { username: dave.username, code: dave.recoveryCodes[0], password: 'my new password is here' }, site: true });
    assert.equal(old.status, 400);
  });

  section('Recovery');
  await test('a recovery code resets the password once, and signs out everywhere', async () => {
    const erin = await person();
    const code = erin.recoveryCodes[3];
    const wrong = await call('POST', '/api/auth/recover', { body: { username: erin.username, code: 'aaaa-bbbb-cccc', password: 'a fresh new password' }, site: true });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.field, 'code');
    const weak = await call('POST', '/api/auth/recover', { body: { username: erin.username, code, password: 'short' }, site: true });
    assert.equal(weak.status, 422, 'a weak password doesn\'t use up the code');
    const r = await call('POST', '/api/auth/recover', { body: { username: erin.username, code: code.toUpperCase().replace(/-/g, ' '), password: 'a fresh new password' }, site: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.codesLeft, 7);
    assert.ok(r.cookies.smitten_session, 'and signs in');
    assert.equal((await call('GET', '/api/account', { session: erin.session })).data.user, null);
    assert.equal((await call('GET', '/api/account', { token: erin.token })).status, 401);
    const again = await call('POST', '/api/auth/recover', { body: { username: erin.username, code, password: 'another new password' }, site: true });
    assert.equal(again.status, 400, 'each code works once');
    assert.equal((await call('POST', '/api/auth/signin', { body: { username: erin.username, password: 'a fresh new password' }, site: true })).status, 200);
  });

  // -------------------------------------------------------------------------
  section('The editor\'s sign-in');
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  await test('a code needs a session on the site, and an allowed editor', async () => {
    assert.equal((await call('POST', '/api/auth/editor/code', { body: { origin: EDITOR_ORIGIN, challenge }, site: true })).status, 401);
    const evil = await call('POST', '/api/auth/editor/code', { body: { origin: 'https://evil.example', challenge }, session: alice.session });
    assert.equal(evil.status, 422);
    assert.equal(evil.data.field, 'origin');
    assert.equal((await call('POST', '/api/auth/editor/code', { body: { origin: EDITOR_ORIGIN, challenge: 'short' }, session: alice.session })).status, 422);
    assert.equal((await call('POST', '/api/auth/editor/code', { body: { origin: EDITOR_ORIGIN, challenge }, session: alice.session, headers: { Origin: EDITOR_ORIGIN } })).status, 403, 'only the site\'s own page asks');
  });
  await test('the token endpoint answers the editor\'s preflight', async () => {
    const r = await call('OPTIONS', '/api/auth/editor/token', { headers: { Origin: EDITOR_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
  });
  await test('a code works once, with the verifier, from the editor it was made for', async () => {
    const newCode = async () => (await call('POST', '/api/auth/editor/code', { body: { origin: EDITOR_ORIGIN, challenge }, session: alice.session })).data.code;
    const swap = (code, v, origin = EDITOR_ORIGIN) => call('POST', '/api/auth/editor/token', { body: { code, verifier: v }, headers: { Origin: origin } });
    assert.equal((await swap(await newCode(), b64url(randomBytes(32)))).status, 400, 'wrong verifier');
    assert.equal((await swap(await newCode(), verifier, 'http://localhost:9999')).status, 400, 'another origin');
    const code = await newCode();
    const r = await swap(code, verifier);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.token.length >= 40);
    assert.equal(r.data.user.username, alice.username);
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
    assert.equal((await swap(code, verifier)).status, 400, 'used up');
    alice.token = r.data.token;
  });
  await test('an editor token says who\'s signed in, but can\'t change the account', async () => {
    const r = await call('GET', '/api/account', { token: alice.token, headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.data.user.username, alice.username);
    assert.equal(r.data.via, 'editor');
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
    assert.equal((await call('PATCH', '/api/account', { body: { displayName: 'x' }, token: alice.token })).status, 403);
    assert.equal((await call('POST', '/api/account/password', { body: { current: PASSWORD, password: 'something else entirely' }, token: alice.token })).status, 403);
    assert.equal((await call('DELETE', '/api/account', { body: { password: PASSWORD }, token: alice.token })).status, 403);
    assert.equal((await call('POST', '/api/auth/editor/code', { body: { origin: EDITOR_ORIGIN, challenge }, token: alice.token })).status, 403);
    assert.equal((await call('GET', '/api/account/sessions', { token: alice.token })).status, 403);
  });
  await test('signed-in editors are listed in settings, and can be revoked there', async () => {
    const token = await editorToken(alice.session);
    const list = await call('GET', '/api/account/sessions', { session: alice.session });
    assert.equal(list.status, 200);
    const editors = list.data.sessions.filter((s) => s.kind === 'editor');
    assert.ok(editors.length >= 2);
    assert.ok(editors.every((s) => s.origin === EDITOR_ORIGIN));
    assert.equal(list.data.sessions.filter((s) => s.current).length, 1);
    assert.ok(!JSON.stringify(list.data).includes(token), 'tokens are never shown');
    const newest = editors.sort((a, b) => b.createdAt - a.createdAt)[0];
    assert.equal((await call('DELETE', `/api/account/sessions/${newest.id}`, { session: alice.session })).status, 200);
    const r = await call('GET', '/api/account', { token });
    assert.equal(r.status, 401);
    assert.equal(r.data.code, 'signed-out');
    assert.equal((await call('DELETE', `/api/account/sessions/${newest.id}`, { session: alice.session })).status, 404);
  });
  await test('the editor can sign itself out', async () => {
    const token = await editorToken(alice.session);
    assert.equal((await call('DELETE', '/api/auth/editor/token', { token, headers: { Origin: EDITOR_ORIGIN } })).status, 200);
    assert.equal((await call('GET', '/api/account', { token })).status, 401);
  });
  await test('sign out everywhere else', async () => {
    const frank = await person();
    const other = (await call('POST', '/api/auth/signin', { body: { username: frank.username, password: PASSWORD }, site: true })).cookies.smitten_session;
    const r = await call('POST', '/api/account/sessions/revoke-others', { session: frank.session });
    assert.equal(r.data.revoked, 2);
    assert.equal((await call('GET', '/api/account', { session: other })).data.user, null);
    assert.equal((await call('GET', '/api/account', { token: frank.token })).status, 401);
    assert.equal((await call('GET', '/api/account', { session: frank.session })).data.user.username, frank.username);
  });

  // -------------------------------------------------------------------------
  section('Publishing');
  await test('publishing needs an account', async () => {
    const r = await call('POST', '/api/games', { body: form({ title: 'Anonymous' }, mainLuaGame()) });
    assert.equal(r.status, 401);
    assert.equal(r.data.code, 'sign-in');
    const bad = await call('POST', '/api/games', { body: form({ title: 'Bad token' }, mainLuaGame()), token: 'not-a-real-token' });
    assert.equal(bad.status, 401);
    assert.equal(bad.data.code, 'signed-out');
  });
  const files = smokeFiles();
  const love = zip(files);
  const thumb = png(16, 9);
  let game;
  await test('publish a game with a thumbnail, from the editor', async () => {
    const r = await publish({ title: `Smoke ${tag}`, description: 'Walks right\r\nand picks up a coin.', modules: ['physics2d'], engineVersion: '0.2.0' }, love, thumb, { token: alice.token, headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.id, ID);
    assert.equal(r.data.token, undefined, 'no edit tokens anymore');
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
    game = { id: r.data.id };
    assert.equal(r.data.game.title, `Smoke ${tag}`);
    assert.equal(r.data.game.description, 'Walks right\nand picks up a coin.');
    assert.deepEqual(r.data.game.modules, ['physics2d']);
    assert.equal(r.data.game.version, 1);
    assert.deepEqual(r.data.game.owner, { username: alice.username, displayName: 'Alice the Great' });
    assert.equal(r.data.game.playUrl, `${BASE}/play/${game.id}`);
  });
  if (!game) throw new Error('Publishing failed; the remaining tests depend on it.');

  await test('a web session can publish too', async () => {
    const r = await publish({ title: `From the site ${tag}` }, mainLuaGame(), null, { token: '', session: alice.session });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  });
  await test('get its metadata', async () => {
    const r = await call('GET', `/api/games/${game.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.game.id, game.id);
    assert.equal(r.data.game.engineVersion, '0.2.0');
    assert.equal(r.data.game.size, love.length);
    assert.match(r.data.game.thumbnail, /\/thumbnail\.png\?v=1$/);
    assert.equal(r.data.game.remixOf, null);
    assert.equal(r.data.game.remixes, 0);
    assert.equal(r.data.game.owner.username, alice.username);
    assert.equal(r.data.game.yours, undefined);
    assert.equal((await call('GET', `/api/games/${game.id}`, { token: alice.token })).data.game.yours, true);
  });
  let etag;
  await test('download game.love: a zip, as an attachment, byte for byte', async () => {
    const r = await call('GET', `/api/games/${game.id}/game.love`, { headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="smoke-/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
    assert.ok(same(r.data, love));
    etag = r.headers.get('etag');
    assert.ok(etag);
  });
  await test('any <name>.love is the same file (the player shows that name)', async () => {
    const r = await call('GET', `/api/games/${game.id}/${encodeURIComponent('Smoke test')}.love`);
    assert.equal(r.status, 200);
    assert.ok(same(r.data, love));
  });
  await test('a matching If-None-Match gets 304', async () => {
    const r = await call('GET', `/api/games/${game.id}/game.love`, { headers: { 'If-None-Match': etag } });
    assert.equal(r.status, 304);
  });
  await test('the thumbnail is served as image/png', async () => {
    const r = await call('GET', `/api/games/${game.id}/thumbnail.png`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.ok(same(r.data, thumb));
  });
  await test('the play page names the game for link previews', async () => {
    const r = await call('GET', `/play/${game.id}`);
    assert.equal(r.status, 200);
    const html = new TextDecoder().decode(r.data);
    assert.match(html, new RegExp(`<title>Smoke ${tag} · Smitten</title>`));
    assert.match(html, /og:image/);
  });
  await test('titles are escaped in the play page', async () => {
    const r = await publish({ title: `<script>x</script> "${tag}"` });
    assert.equal(r.status, 201);
    const html = new TextDecoder().decode((await call('GET', `/play/${r.data.id}`)).data);
    assert.ok(!html.includes('<script>x'));
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt; &quot;/);
  });

  section('Listing, search and profiles');
  await test('the newest list starts with it', async () => {
    const r = await call('GET', '/api/games?sort=new&limit=5');
    assert.equal(r.status, 200);
    assert.ok(r.data.games.some((g) => g.id === game.id));
  });
  await test('search finds it by title, and nothing for nonsense', async () => {
    const r = await call('GET', `/api/games?q=${encodeURIComponent(`smoke ${tag}`.toUpperCase())}`);
    assert.deepEqual(r.data.games.map((g) => g.id), [game.id]);
    const none = await call('GET', `/api/games?q=${encodeURIComponent(`zz${tag}%_`)}`);
    assert.equal(none.data.games.length, 0);
  });
  await test('pagination with limit and cursor', async () => {
    await publish({ title: `Second ${tag}` });
    const first = await call('GET', `/api/games?q=${tag}&limit=1`);
    assert.equal(first.data.games.length, 1);
    assert.ok(first.data.next);
    const second = await call('GET', `/api/games?q=${tag}&limit=1&cursor=${first.data.next}`);
    assert.equal(second.data.games.length, 1);
    assert.notEqual(second.data.games[0].id, first.data.games[0].id);
  });
  await test('a profile: the name and the games, nothing private', async () => {
    const r = await call('GET', `/api/users/${alice.username.toUpperCase()}`);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.data.user).sort(), ['createdAt', 'displayName', 'games', 'username']);
    assert.equal(r.data.user.games, 2);
    const games = await call('GET', `/api/games?user=${alice.username}`);
    assert.deepEqual(new Set(games.data.games.map((g) => g.owner.username)), new Set([alice.username]));
    assert.equal(games.data.games.length, 2);
    assert.equal((await call('GET', '/api/users/nobody-here-at-all')).status, 404);
  });
  await test('your own games, from the editor', async () => {
    const r = await call('GET', '/api/account/games', { token: alice.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.games.length, 2);
    assert.ok(r.data.games.every((g) => g.status === 'public'));
  });

  section('Plays');
  await test('a play counts once per person per day', async () => {
    const ip = freshIp();
    const a = await call('POST', `/api/games/${game.id}/play`, { ip });
    assert.equal(a.status, 200);
    assert.equal(a.data.plays, 1);
    assert.equal(a.data.counted, true);
    const b = await call('POST', `/api/games/${game.id}/play`, { ip });
    assert.equal(b.data.plays, 1);
    assert.equal(b.data.counted, false);
    const c = await call('POST', `/api/games/${game.id}/play`);
    assert.equal(c.data.plays, 2);
  });
  await test('signed in, a play counts once per account (from any address)', async () => {
    const a = await call('POST', `/api/games/${game.id}/play`, { session: alice.session });
    assert.equal(a.data.counted, true);
    const b = await call('POST', `/api/games/${game.id}/play`, { session: alice.session });
    assert.equal(b.data.counted, false);
  });
  await test('most played sorts by plays', async () => {
    const r = await call('GET', `/api/games?sort=popular&q=${tag}`);
    assert.equal(r.data.games[0].id, game.id);
    assert.ok(r.data.games[0].plays >= r.data.games.at(-1).plays);
  });

  section('Updating and ownership');
  const love2 = zip({ ...files, 'scenes/main.lua': files['scenes/main.lua'].replace('60 * dt', '90 * dt') });
  const mallory = await person();
  await test('updating without signing in is refused (401)', async () => {
    const r = await call('PUT', `/api/games/${game.id}`, { body: form({ title: 'Nope' }, love2) });
    assert.equal(r.status, 401);
  });
  await test('someone else can\'t update or delete it (403)', async () => {
    assert.equal((await call('PUT', `/api/games/${game.id}`, { body: form({ title: 'Nope' }, love2), token: mallory.token })).status, 403);
    assert.equal((await call('DELETE', `/api/games/${game.id}`, { token: mallory.token })).status, 403);
    assert.equal((await call('DELETE', `/api/games/${game.id}`, { session: mallory.session })).status, 403);
  });
  await test('the owner updates it: same id, new version and files', async () => {
    const r = await call('PUT', `/api/games/${game.id}`, { body: form({ title: `Smoke ${tag} v2`, description: 'Faster.', modules: [] }, love2), token: alice.token, headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.id, game.id);
    assert.equal(r.data.game.version, 2);
    assert.equal(r.data.game.title, `Smoke ${tag} v2`);
    assert.equal(r.data.game.thumbnail, null, 'an update without a thumbnail removes it');
    assert.equal(r.data.game.plays, 3, 'plays are kept');
    const file = await call('GET', `/api/games/${game.id}/game.love`);
    assert.ok(same(file.data, love2));
    assert.equal((await call('GET', `/api/games/${game.id}/thumbnail.png`)).status, 404);
  });

  section('Validation');
  const expect422 = async (meta, gameBytes, field, thumbnail) => {
    const r = await publish({ title: `Valid ${tag}`, ...meta }, gameBytes, thumbnail);
    assert.equal(r.status, 422, JSON.stringify(r.data));
    if (field) assert.equal(r.data.field, field);
    assert.ok(r.data.error);
    return r;
  };
  await test('a title is required, 60 characters at most', async () => {
    await expect422({ title: '   ' }, love, 'title');
    await expect422({ title: 'x'.repeat(61) }, love, 'title');
    await expect422({ title: '!!!' }, love, 'title');
  });
  await test('descriptions are 1000 characters at most', async () => {
    await expect422({ description: 'y'.repeat(1001) }, love, 'description');
  });
  await test('the word filter blocks titles and descriptions, including look-alikes', async () => {
    await expect422({ title: 'Sh1t game' }, love, 'title');
    await expect422({ title: 'f.u.c.k' }, love, 'title');
    await expect422({ description: 'please kill  yourself' }, love, 'description');
  });
  await test('the word filter leaves ordinary words alone', async () => {
    const r = await publish({ title: `Scunthorpe grass hit ${tag}`, description: 'Assassins, a cockpit, a classic.' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  });
  await test('control and invisible characters are removed from titles', async () => {
    const r = await publish({ title: `Zero\u200bWidth\u0007 ${tag}` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.game.title, `ZeroWidth ${tag}`);
  });
  await test('the game must be a zip', async () => {
    await expect422({}, new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'game');
  });
  await test('the zip needs main.lua or smitten.json at its root', async () => {
    await expect422({}, zip({ 'readme.txt': 'hi', 'game/main.lua': 'x' }), 'game');
    const r = await publish({ title: `Manifest only ${tag}` }, zip({ 'smitten.json': '{}' }));
    assert.equal(r.status, 201);
  });
  await test('zips with unsafe paths or encryption are refused', async () => {
    await expect422({}, zip({ 'main.lua': 'x', '../escape.lua': 'x' }), 'game');
    await expect422({}, zip({ 'main.lua': 'x' }, { flags: 1 }), 'game');
  });
  await test('a game over 25 MB is refused (413)', async () => {
    const big = zip({ 'main.lua': 'x', 'big.bin': new Uint8Array(25 * 1024 * 1024 + 1) });
    const r = await publish({ title: `Big ${tag}` }, big);
    assert.equal(r.status, 413);
    assert.equal(r.data.field, 'game');
  });
  await test('an upload body past the limit is cut off, even without Content-Length', async () => {
    const big = new Uint8Array(27 * 1024 * 1024);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('--x\r\nContent-Disposition: form-data; name="game"; filename="g.love"\r\n\r\n'));
        c.enqueue(big);
        c.close();
      },
    });
    const { token } = await defaultPublisher();
    const res = await fetch(`${BASE}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x', Authorization: `Bearer ${token}`, 'X-Forwarded-For': freshIp() },
      body: stream,
      duplex: 'half',
    }).catch((e) => ({ status: 'closed', e }));
    assert.ok(res.status === 413 || res.status === 'closed', `got ${res.status}`);
  });
  await test('thumbnails must be PNGs of at most 1 MB', async () => {
    await expect422({}, love, 'thumbnail', new TextEncoder().encode('GIF89a not a png at all, really'));
    const huge = new Uint8Array(1024 * 1024 + 1);
    huge.set(png());
    const r = await publish({ title: `Huge thumb ${tag}` }, love, huge);
    assert.equal(r.status, 413);
    assert.equal(r.data.field, 'thumbnail');
  });
  await test('modules must be known engine modules', async () => {
    await expect422({ modules: ['physics2d', 'bitcoin-miner'] }, love, 'modules');
  });
  await test('uploads must be multipart with JSON meta and a game', async () => {
    const { token } = await defaultPublisher();
    assert.equal((await call('POST', '/api/games', { body: { title: 'json' }, token })).status, 415);
    assert.equal((await call('POST', '/api/games', { body: form('{not json', love), token })).status, 400);
    const r = await call('POST', '/api/games', { body: form({ title: 'No game' }), token });
    assert.equal(r.status, 422);
    assert.equal(r.data.field, 'game');
  });

  section('Remixes');
  let remix;
  await test('publishing with remixOf records the original', async () => {
    const r = await publish({ title: `Remix ${tag}`, remixOf: game.id }, love2, null, { token: mallory.token });
    assert.equal(r.status, 201);
    remix = r.data;
    assert.equal(r.data.game.remixOf, game.id);
    const g = await call('GET', `/api/games/${remix.id}`);
    assert.deepEqual(g.data.game.remixOf, { id: game.id, title: `Smoke ${tag} v2`, playUrl: `${BASE}/play/${game.id}` });
    const original = await call('GET', `/api/games/${game.id}`);
    assert.equal(original.data.game.remixes, 1);
  });
  await test('remixOf must be a game id', async () => {
    await expect422({ remixOf: 'not an id!' }, love, 'remixOf');
  });
  await test('a remix of a game that no longer exists is just a game', async () => {
    const r = await publish({ title: `Orphan ${tag}`, remixOf: 'zzzzzzzzzz' });
    assert.equal(r.status, 201);
    assert.equal(r.data.game.remixOf, null);
  });

  // -------------------------------------------------------------------------
  section('Claiming games published before accounts');
  if (external) {
    skip('claiming', 'needs the server\'s database (PLATFORM_URL is set)');
  } else {
    const old = legacyGame(`Old game ${tag}`);
    const old2 = legacyGame(`Old game two ${tag}`);
    await test('an old game has no owner, and can\'t be updated or deleted with its edit token', async () => {
      const r = await call('GET', `/api/games/${old.id}`);
      assert.equal(r.status, 200);
      assert.equal(r.data.game.owner, null);
      assert.equal((await call('PUT', `/api/games/${old.id}`, { body: form({ title: 'x' }, love), token: old.token })).status, 401);
      const signedIn = await call('PUT', `/api/games/${old.id}`, { body: form({ title: 'x' }, love), token: alice.token });
      assert.equal(signedIn.status, 403);
      assert.match(signedIn.data.error, /before accounts/);
    });
    await test('claiming needs the right edit token', async () => {
      const r = await call('POST', '/api/account/claim', { body: { games: [{ id: old.id, token: old2.token }, { id: 'zzzzzzzzzz', token: 'x' }] }, token: mallory.token });
      assert.equal(r.status, 200);
      assert.deepEqual(r.data.claimed, []);
      assert.deepEqual(r.data.failed.map((f) => f.reason).sort(), ['missing', 'token']);
    });
    await test('the editor claims its old games for the signed-in account', async () => {
      const r = await call('POST', '/api/account/claim', { body: { games: [old, old2, { id: game.id, token: 'whatever' }] }, token: alice.token, headers: { Origin: EDITOR_ORIGIN } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.deepEqual(r.data.claimed.sort(), [old.id, old2.id].sort());
      assert.deepEqual(r.data.owned, [game.id]);
      assert.equal((await call('GET', `/api/games/${old.id}`)).data.game.owner.username, alice.username);
      const upd = await call('PUT', `/api/games/${old.id}`, { body: form({ title: `Old game ${tag} v2` }, love), token: alice.token });
      assert.equal(upd.status, 200);
    });
    await test('a claimed game can\'t be claimed again, and its edit token stops working', async () => {
      const r = await call('POST', '/api/account/claim', { body: { games: [old] }, token: mallory.token });
      assert.deepEqual(r.data.failed, [{ id: old.id, reason: 'owned' }]);
    });
    await test('claims are lists of at most 100', async () => {
      const r = await call('POST', '/api/account/claim', { body: { games: Array.from({ length: 101 }, () => old) }, token: alice.token });
      assert.equal(r.status, 422);
    });
    cleanup.push({ id: old.id, token: alice.token }, { id: old2.id, token: alice.token });
  }

  // -------------------------------------------------------------------------
  section('Reports and moderation');
  await test('reports need JSON and a known reason', async () => {
    assert.equal((await call('POST', `/api/games/${game.id}/report`, { body: 'reason=spam', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
    const r = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'boring' } });
    assert.equal(r.status, 422);
    assert.equal(r.data.field, 'reason');
    const long = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'other', note: 'n'.repeat(501) } });
    assert.equal(long.status, 422);
  });
  const reporterA = freshIp();
  await test('one person reporting twice counts once', async () => {
    const a = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'scam', note: 'test' }, ip: reporterA });
    assert.equal(a.status, 200);
    assert.equal(a.data.hidden, false);
    const again = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'scam' }, ip: reporterA });
    assert.equal(again.data.alreadyReported, true);
    assert.equal((await call('GET', `/api/games/${game.id}`)).status, 200);
  });
  await test('a signed-in reporter counts once, from any address', async () => {
    const a = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'hate' }, session: mallory.session });
    assert.equal(a.data.hidden, false);
    const again = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'hate' }, session: mallory.session });
    assert.equal(again.data.alreadyReported, true);
  });
  await test('three reporters hide the game everywhere', async () => {
    const c = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'other', note: 'third' } });
    assert.equal(c.data.hidden, true);
    const meta = await call('GET', `/api/games/${game.id}`);
    assert.equal(meta.status, 404);
    assert.equal(meta.data.hidden, true);
    assert.equal((await call('GET', `/api/games/${game.id}/game.love`)).status, 404);
    assert.equal((await call('POST', `/api/games/${game.id}/play`)).status, 404);
    const list = await call('GET', `/api/games?q=${tag}&limit=48`);
    assert.ok(!list.data.games.some((g) => g.id === game.id));
    assert.equal((await call('GET', `/api/users/${alice.username}`)).data.user.games, external ? 1 : 3);
  });
  await test('the owner can still see a hidden game, and update it (it stays hidden)', async () => {
    const r = await call('GET', `/api/games/${game.id}`, { token: alice.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.game.status, 'hidden');
    const upd = await call('PUT', `/api/games/${game.id}`, { body: form({ title: `Smoke ${tag} v3` }, love2), token: alice.token });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.game.status, 'hidden');
    const mine = await call('GET', '/api/account/games', { session: alice.session });
    assert.equal(mine.data.games.find((g) => g.id === game.id).status, 'hidden');
  });

  if (!ADMIN) {
    skip('admin endpoints', 'no ADMIN_TOKEN');
  } else {
    await test('admin endpoints need the admin token', async () => {
      assert.equal((await call('GET', '/api/admin/reports')).status, 401);
      assert.equal((await call('GET', '/api/admin/reports', { token: 'wrong' })).status, 401);
      assert.equal((await call('GET', '/api/admin/reports', { token: alice.token })).status, 401);
      assert.equal((await call('GET', '/api/admin/reports', { session: alice.session })).status, 401);
    });
    await test('admins list reported games with their reports and owners', async () => {
      const r = await call('GET', '/api/admin/reports', { token: ADMIN });
      assert.equal(r.status, 200);
      const g = r.data.games.find((x) => x.id === game.id);
      assert.ok(g, 'the reported game is listed');
      assert.equal(g.status, 'hidden');
      assert.equal(g.hiddenBy, 'reports');
      assert.equal(g.openReports, 3);
      assert.equal(g.owner.username, alice.username);
      assert.ok(g.reports.some((x) => x.note === 'third'));
      assert.ok(g.reports.every((x) => /^(u:\d+|ip:[0-9a-f]{8})$/.test(x.reporter)), 'reporters are accounts or hashes, not addresses');
    });
    await test('admins can download a hidden game to review it', async () => {
      const r = await call('GET', `/api/games/${game.id}/game.love`, { token: ADMIN });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
    });
    await test('restoring makes it public again and closes its reports', async () => {
      const r = await call('POST', `/api/admin/games/${game.id}/restore`, { token: ADMIN });
      assert.equal(r.status, 200);
      assert.equal((await call('GET', `/api/games/${game.id}`)).status, 200);
      const list = await call('GET', '/api/admin/reports', { token: ADMIN });
      assert.ok(!list.data.games.some((x) => x.id === game.id));
      // The same people can report it again later; old reports don't count.
      const again = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'scam' }, ip: reporterA });
      assert.equal(again.data.hidden, false);
      assert.notEqual(again.data.alreadyReported, true);
    });
    await test('admins can hide and delete games', async () => {
      const hide = await call('POST', `/api/admin/games/${remix.id}/hide`, { token: ADMIN });
      assert.equal(hide.status, 200);
      assert.equal((await call('GET', `/api/games/${remix.id}`)).status, 404);
      const del = await call('DELETE', `/api/admin/games/${remix.id}`, { token: ADMIN });
      assert.equal(del.status, 200);
      assert.equal((await call('GET', `/api/games/${remix.id}`, { token: ADMIN })).status, 404);
      assert.equal((await call('POST', `/api/admin/games/${remix.id}/restore`, { token: ADMIN })).status, 404);
    });

    section('Banning');
    const villain = await person();
    const kept = await publish({ title: `Villain one ${tag}` }, mainLuaGame(), null, { token: villain.token });
    const hiddenFirst = await publish({ title: `Villain two ${tag}` }, mainLuaGame(), null, { token: villain.token });
    await call('POST', `/api/admin/games/${hiddenFirst.data.id}/hide`, { token: ADMIN });
    await test('admins look up an account', async () => {
      const r = await call('GET', `/api/admin/users/${villain.username}`, { token: ADMIN });
      assert.equal(r.status, 200);
      assert.equal(r.data.user.status, 'active');
      assert.equal(r.data.games.length, 2);
      assert.equal((await call('GET', '/api/admin/users/nobody-at-all-here', { token: ADMIN })).status, 404);
      assert.equal((await call('GET', `/api/admin/users/${villain.username}`, { token: villain.token })).status, 401);
    });
    await test('a ban signs the account out everywhere, hides its games and profile', async () => {
      const r = await call('POST', `/api/admin/users/${villain.username}/ban`, { body: { reason: 'test ban' }, token: ADMIN });
      assert.equal(r.status, 200);
      assert.equal((await call('GET', '/api/account', { session: villain.session })).data.user, null);
      assert.equal((await call('GET', '/api/account', { token: villain.token })).status, 401);
      assert.equal((await call('GET', `/api/games/${kept.data.id}`)).status, 404);
      assert.equal((await call('GET', `/api/users/${villain.username}`)).status, 404);
      assert.equal((await call('GET', `/api/games?user=${villain.username}`)).data.games.length, 0);
    });
    await test('a banned account can\'t sign in, publish or recover', async () => {
      const r = await call('POST', '/api/auth/signin', { body: { username: villain.username, password: PASSWORD }, site: true });
      assert.equal(r.status, 403);
      assert.equal(r.data.code, 'banned');
      const rec = await call('POST', '/api/auth/recover', { body: { username: villain.username, code: villain.recoveryCodes[0], password: 'some new password' }, site: true });
      assert.equal(rec.status, 403);
      assert.equal((await call('POST', '/api/games', { body: form({ title: 'x' }, love), token: villain.token })).status, 401);
    });
    await test('lifting the ban brings back the games the ban hid, not the others', async () => {
      const r = await call('POST', `/api/admin/users/${villain.username}/unban`, { token: ADMIN });
      assert.equal(r.status, 200);
      assert.equal((await call('GET', `/api/games/${kept.data.id}`)).status, 200);
      assert.equal((await call('GET', `/api/games/${hiddenFirst.data.id}`)).status, 404);
      assert.equal((await call('POST', '/api/auth/signin', { body: { username: villain.username, password: PASSWORD }, site: true })).status, 200);
    });
    await test('a moderator\'s reset link sets a new password once', async () => {
      const r = await call('POST', `/api/admin/users/${villain.username}/reset-password`, { token: ADMIN });
      assert.equal(r.status, 200);
      assert.match(r.data.url, new RegExp(`^${BASE}/recover#reset=`));
      const resetToken = r.data.url.split('#reset=')[1];
      const ok = await call('POST', '/api/auth/recover', { body: { resetToken, password: 'reset by a moderator' }, site: true });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal((await call('POST', '/api/auth/recover', { body: { resetToken, password: 'and once more please' }, site: true })).status, 400);
      assert.equal((await call('POST', '/api/auth/signin', { body: { username: villain.username, password: 'reset by a moderator' }, site: true })).status, 200);
    });
    await test('admins can delete an account with its games', async () => {
      const r = await call('DELETE', `/api/admin/users/${villain.username}`, { token: ADMIN });
      assert.equal(r.status, 200);
      assert.equal((await call('GET', `/api/games/${kept.data.id}`, { token: ADMIN })).status, 404);
      assert.equal((await call('GET', `/api/admin/users/${villain.username}`, { token: ADMIN })).status, 404);
    });
    await test('admins can see which client address the server uses', async () => {
      const r = await call('GET', '/api/admin/request', { token: ADMIN, ip: '203.0.113.7' });
      assert.equal(r.status, 200);
      assert.equal(r.data.clientIp, '203.0.113.7');
      assert.equal((await call('GET', '/api/admin/request')).status, 401);
    });
    section('Address bans');
    const network = '198.51.100.20';
    const someone = await person();
    const theirGame = await publish({ title: `On a banned network ${tag}` }, mainLuaGame(), null, { token: someone.token });
    await test('a banned address can\'t make accounts, publish or report, but can still play', async () => {
      const r = await call('POST', '/api/admin/addresses/ban', { body: { ip: network, reason: 'test' }, token: ADMIN });
      assert.equal(r.status, 200);
      assert.equal(r.data.banned, 1);
      assert.equal(r.data.days, 30);
      const signup = await call('POST', '/api/auth/signup', { body: { username: uniqueName(), password: PASSWORD }, site: true, ip: network });
      assert.equal(signup.status, 403);
      assert.equal(signup.data.code, 'address-banned');
      assert.match(signup.data.error, /still play/);
      const pub = await call('POST', '/api/games', { body: form({ title: 'nope' }, love), token: someone.token, ip: network });
      assert.equal(pub.status, 403);
      const rep = await call('POST', `/api/games/${theirGame.data.id}/report`, { body: { reason: 'scam' }, ip: network });
      assert.equal(rep.status, 403);
      assert.equal((await call('GET', `/api/games/${theirGame.data.id}`, { ip: network })).status, 200);
      assert.equal((await call('POST', '/api/auth/signup', { body: { username: uniqueName(), password: PASSWORD }, site: true })).status, 201);
    });
    await test('address bans are listed as hashes and can be lifted', async () => {
      const list = await call('GET', '/api/admin/addresses', { token: ADMIN });
      assert.ok(list.data.bans.length >= 1);
      assert.ok(!JSON.stringify(list.data).includes(network), 'no raw addresses');
      assert.ok(list.data.bans.every((b) => b.expiresAt > Date.now()));
      const r = await call('POST', '/api/admin/addresses/unban', { body: { ip: network }, token: ADMIN });
      assert.equal(r.data.unbanned, 1);
      assert.equal((await call('POST', '/api/auth/signup', { body: { username: uniqueName(), password: PASSWORD }, site: true, ip: network })).status, 201);
    });
    await test('banning an account can ban the addresses it used', async () => {
      const home = '198.51.100.33';
      const signin = await call('POST', '/api/auth/signin', { body: { username: someone.username, password: PASSWORD }, site: true, ip: home });
      assert.equal(signin.status, 200);
      const r = await call('POST', `/api/admin/users/${someone.username}/ban`, { body: { reason: 'keeps coming back', addresses: true, days: 7 }, token: ADMIN });
      assert.equal(r.status, 200);
      assert.ok(r.data.addressesBanned >= 1);
      const again = await call('POST', '/api/auth/signup', { body: { username: uniqueName(), password: PASSWORD }, site: true, ip: home });
      assert.equal(again.status, 403);
      assert.equal((await call('POST', '/api/admin/addresses/unban', { body: { username: someone.username }, token: ADMIN })).status, 200);
      assert.equal((await call('POST', '/api/admin/addresses/ban', { body: { ip: home, days: -1 }, token: ADMIN })).status, 422);
    });
    await test('what moderators do is logged', async () => {
      const r = await call('GET', '/api/admin/log', { token: ADMIN });
      const actions = r.data.log.map((l) => `${l.action} ${l.target}`);
      for (const a of ['ban', 'unban', 'reset-link', 'delete-user']) assert.ok(actions.includes(`${a} user:${villain.username}`), a);
      assert.ok(actions.includes(`restore game:${game.id}`));
    });
  }

  // -------------------------------------------------------------------------
  section('Sign in with Hack Club');
  if (external) {
    skip('Hack Club sign-in', 'the stand-in for Hack Club Auth only runs with the test\'s own server');
  } else {
    /** Follows the flow: /auth/hackclub → (stand-in) → /auth/hackclub/callback. Returns the callback's response. */
    const hackclubFlow = async (sub, { next = '/', link = false, session } = {}) => {
      fakeHackclub.nextSub = sub;
      const start = await call('GET', `/auth/hackclub?next=${encodeURIComponent(next)}${link ? '&link=1' : ''}`, { session, site: false });
      assert.equal(start.status, 302);
      const authorize = new URL(start.headers.get('location'));
      assert.equal(authorize.origin + authorize.pathname, `${fakeHackclub.url}/oauth/authorize`);
      assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(authorize.searchParams.get('redirect_uri'), `${BASE}/auth/hackclub/callback`);
      const back = await fetch(authorize, { redirect: 'manual' });
      const callback = new URL(back.headers.get('location'));
      return call('GET', callback.pathname + callback.search, { cookies: { smitten_hackclub_flow: start.cookies.smitten_hackclub_flow }, session, site: false });
    };
    const sub = `ident!${randomBytes(4).toString('hex')}`;
    let hcSession;
    await test('someone new picks a username, with no password', async () => {
      const r = await hackclubFlow(sub, { next: '/editor-auth?x=1' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), `/signup?via=hackclub&next=${encodeURIComponent('/editor-auth?x=1')}`);
      const pending = r.cookies.smitten_hackclub;
      assert.ok(pending);
      const username = uniqueName('hc');
      const s = await call('POST', '/api/auth/signup', { body: { via: 'hackclub', username }, cookies: { smitten_hackclub: pending }, site: true });
      assert.equal(s.status, 201, JSON.stringify(s.data));
      assert.equal(s.data.user.hackclub, true);
      assert.equal(s.data.user.hasPassword, false);
      assert.equal(s.data.recoveryCodes, null);
      hcSession = s.cookies.smitten_session;
      const forged = await call('POST', '/api/auth/signup', { body: { via: 'hackclub', username: uniqueName('hc') }, cookies: { smitten_hackclub: pending.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) }, site: true });
      assert.equal(forged.status, 400, 'the pending cookie is signed');
    });
    await test('next time, Hack Club signs them straight in', async () => {
      const r = await hackclubFlow(sub, { next: '/account' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), '/account');
      assert.ok(r.cookies.smitten_session);
      const me = await call('GET', '/api/account', { session: r.cookies.smitten_session });
      assert.equal(me.data.user.hackclub, true);
    });
    await test('only local paths are followed after signing in', async () => {
      const r = await hackclubFlow(sub, { next: '//evil.example/x' });
      assert.equal(r.headers.get('location'), '/');
    });
    await test('a callback with the wrong state is refused', async () => {
      fakeHackclub.nextSub = sub;
      const start = await call('GET', '/auth/hackclub');
      const r = await call('GET', '/auth/hackclub/callback?code=abc&state=wrong', { cookies: { smitten_hackclub_flow: start.cookies.smitten_hackclub_flow } });
      assert.equal(r.status, 302);
      assert.match(r.headers.get('location'), /^\/signin\?error=/);
      assert.equal(r.cookies.smitten_session, undefined);
    });
    await test('a password account can connect Hack Club, then sign in with it', async () => {
      const gina = await signUp();
      const sub2 = `ident!${randomBytes(4).toString('hex')}`;
      const r = await hackclubFlow(sub2, { link: true, session: gina.session });
      assert.equal(r.headers.get('location'), '/account?connected=hackclub');
      assert.equal((await call('GET', '/api/account', { session: gina.session })).data.user.hackclub, true);
      const again = await hackclubFlow(sub2);
      const me = await call('GET', '/api/account', { session: again.cookies.smitten_session });
      assert.equal(me.data.user.username, gina.username);
      const taken = await hackclubFlow(sub, { link: true, session: gina.session });
      assert.match(taken.headers.get('location'), /^\/account\?error=/);
    });
    await test('a Hack Club account without a password signs in with Hack Club, and deletes itself by typing its name', async () => {
      const me = (await call('GET', '/api/account', { session: hcSession })).data.user;
      const pw = await call('POST', '/api/auth/signin', { body: { username: me.username, password: 'anything at all' }, site: true });
      assert.equal(pw.status, 401);
      assert.equal(pw.data.code, 'use-hackclub');
      assert.equal((await call('DELETE', '/api/account', { body: { confirm: 'someone-else' }, session: hcSession })).status, 422);
      assert.equal((await call('DELETE', '/api/account', { body: { confirm: me.username }, session: hcSession })).status, 200);
    });
  }


  // -------------------------------------------------------------------------
  section('Hackatime');
  if (external) {
    skip('Hackatime', 'the stand-in for Hackatime only runs with the test\'s own server');
  } else {
    /** Follows the flow: /auth/hackatime → (stand-in) → /auth/hackatime/callback. Returns the callback's response. */
    const hackatimeFlow = async (session, htUser, { next } = {}) => {
      fakeHackatime.nextUser = htUser;
      const start = await call('GET', `/auth/hackatime${next ? `?next=${encodeURIComponent(next)}` : ''}`, { session, site: false });
      assert.equal(start.status, 302, JSON.stringify(start.data));
      const authorize = new URL(start.headers.get('location'));
      assert.equal(authorize.origin + authorize.pathname, `${fakeHackatime.url}/oauth/authorize`);
      assert.equal(authorize.searchParams.get('client_id'), HT.clientId);
      assert.equal(authorize.searchParams.get('scope'), 'profile read');
      assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(authorize.searchParams.get('redirect_uri'), `${BASE}/auth/hackatime/callback`);
      assert.ok(start.cookies.smitten_hackatime_flow);
      const back = await fetch(authorize, { redirect: 'manual' });
      const callback = new URL(back.headers.get('location'));
      return call('GET', callback.pathname + callback.search, { cookies: { smitten_hackatime_flow: start.cookies.smitten_hackatime_flow }, session, site: false });
    };
    const htUser = (projects = {}) => ({ id: 70000 + Math.floor(Math.random() * 20000), apiKey: `waka_${randomBytes(16).toString('hex')}`, projects });
    const userRow = (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const gameHours = async (id) => (await call('GET', `/api/games/${id}`)).data.game.hackatime;

    const ivy = await person();
    const ivyHt = htUser({ 'Space Ivy': 45_000, Other: 120 });

    await test('connecting needs a session on the site: otherwise it goes to sign-in and back', async () => {
      const r = await call('GET', '/auth/hackatime?next=/hackatime-connected');
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), `/signin?next=${encodeURIComponent('/auth/hackatime?next=%2Fhackatime-connected')}`);
      const editor = await call('GET', '/auth/hackatime', { token: ivy.token });
      assert.match(editor.headers.get('location'), /^\/signin\?/, 'an editor token is not a session');
    });
    await test('before connecting: not-connected, and the account says hackatime: false', async () => {
      const r = await call('GET', '/api/account/hackatime-key', { token: ivy.token });
      assert.equal(r.status, 404);
      assert.equal(r.data.code, 'not-connected');
      assert.equal((await call('GET', '/api/account', { token: ivy.token })).data.user.hackatime, false);
      assert.equal(fakeHackatime.keyCalls, 0, "Hackatime isn't asked for accounts that aren't connected");
    });
    await test('connect: state and PKCE, the code swapped with the secret, then back to the account', async () => {
      const r = await hackatimeFlow(ivy.session, ivyHt);
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), '/account?connected=hackatime');
      assert.ok(r.setCookie.some((c) => c.startsWith('smitten_hackatime_flow=;') && /Max-Age=0/.test(c)), 'the flow cookie is cleared');
      assert.equal((await call('GET', '/api/account', { session: ivy.session })).data.user.hackatime, true);
      assert.equal((await call('GET', '/api/account', { token: ivy.token })).data.user.hackatime, true);
    });
    await test('the editor gets the Hackatime API key (no-store), with its token or a session', async () => {
      const r = await call('GET', '/api/account/hackatime-key', { token: ivy.token, headers: { Origin: EDITOR_ORIGIN } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.deepEqual(r.data, { key: ivyHt.apiKey });
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
      const s = await call('GET', '/api/account/hackatime-key', { session: ivy.session });
      assert.equal(s.data.key, ivyHt.apiKey);
      const other = await call('GET', '/api/account/hackatime-key', { session: ivy.session, site: false, headers: { Origin: 'https://evil.example' } });
      assert.equal(other.status, 403, "other sites can't use the session for it");
      assert.equal((await call('GET', '/api/account/hackatime-key')).status, 401);
    });
    await test('only the Hackatime id and an encrypted token are stored, never the token or key in plain text', async () => {
      const row = userRow(ivy.username);
      assert.equal(row.hackatime_id, String(ivyHt.id));
      assert.match(row.hackatime_token, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
      const access = fakeHackatime.issued.at(-1);
      assert.ok(!row.hackatime_token.includes(access));
      db.exec('PRAGMA wal_checkpoint(PASSIVE)');
      for (const file of ['smitten.db', 'smitten.db-wal']) {
        let bytes = '';
        try { bytes = readFileSync(join(dataDir, file), 'latin1'); } catch { continue; }
        assert.ok(!bytes.includes(access), `the access token isn't in ${file}`);
        assert.ok(!bytes.includes(ivyHt.apiKey), `the API key isn't in ${file}`);
        assert.ok(!bytes.includes('U0SECRET') && !bytes.includes(`person${ivyHt.id}@example.com`), `nothing else from /me is in ${file}`);
      }
    });
    await test('a token moved to another account row does not decrypt there', async () => {
      const other = await person();
      const stolen = userRow(ivy.username).hackatime_token;
      db.prepare('UPDATE users SET hackatime_id = ?, hackatime_token = ? WHERE username = ?').run('copied-id', stolen, other.username);
      const r = await call('GET', '/api/account/hackatime-key', { token: other.token });
      assert.equal(r.status, 404);
      assert.equal(r.data.code, 'not-connected');
      assert.equal(userRow(other.username).hackatime_id, null, 'the broken link is cleared');
    });

    let ivyGame;
    await test("a game published with hackatimeProject shows its owner's tracked time, refreshed in the background", async () => {
      const calls = fakeHackatime.projectCalls;
      const r = await call('POST', '/api/games', { body: form({ title: `Space Ivy ${run}`, description: '', hackatimeProject: 'Space Ivy' }, mainLuaGame()), token: ivy.token });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      ivyGame = r.data.id;
      cleanup.push({ id: ivyGame, token: ivy.token });
      const hours = await eventually(() => gameHours(ivyGame), 'the hours');
      assert.equal(hours.seconds, 45_000);
      assert.ok(hours.checkedAt > Date.now() - 60_000);
      assert.equal(fakeHackatime.projectCalls, calls + 1);
      assert.equal(db.prepare('SELECT hackatime_project FROM games WHERE id = ?').get(ivyGame).hackatime_project, 'Space Ivy');
      const list = await call('GET', `/api/games?user=${ivy.username}`);
      assert.equal(list.data.games[0].hackatime.seconds, 45_000);
      assert.equal(list.data.games[0].hackatimeProject, undefined, "the project's name isn't shown");
    });
    await test('the hours are cached: at most one refresh an hour per game', async () => {
      const calls = fakeHackatime.projectCalls;
      ivyHt.projects['Space Ivy'] = 50_000;
      for (let i = 0; i < 3; i++) assert.equal((await gameHours(ivyGame)).seconds, 45_000);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(fakeHackatime.projectCalls, calls, 'no new requests within the hour');
      db.prepare('UPDATE games SET hackatime_checked_at = ? WHERE id = ?').run(Date.now() - 2 * 3600_000, ivyGame);
      assert.equal((await gameHours(ivyGame)).seconds, 45_000, 'the page gets the cached value right away');
      await eventually(async () => (await gameHours(ivyGame)).seconds === 50_000, 'the refreshed hours');
      assert.equal(fakeHackatime.projectCalls, calls + 1);
    });
    await test('an update refreshes right away, and a new project starts over', async () => {
      ivyHt.projects['Space Ivy'] = 51_000;
      const r = await call('PUT', `/api/games/${ivyGame}`, { body: form({ title: `Space Ivy ${run}`, description: '' }, mainLuaGame()), token: ivy.token });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      await eventually(async () => (await gameHours(ivyGame))?.seconds === 51_000, 'the hours after an update');
      assert.equal(db.prepare('SELECT hackatime_project FROM games WHERE id = ?').get(ivyGame).hackatime_project, 'Space Ivy', 'an update without hackatimeProject keeps it');
      const renamed = await call('PUT', `/api/games/${ivyGame}`, { body: form({ title: `Space Ivy ${run}`, description: '', hackatimeProject: 'Other' }, mainLuaGame()), token: ivy.token });
      assert.equal(renamed.status, 200);
      await eventually(async () => (await gameHours(ivyGame))?.seconds === 120, "the other project's hours");
      const back = await call('PUT', `/api/games/${ivyGame}`, { body: form({ title: `Space Ivy ${run}`, description: '', hackatimeProject: 'Space Ivy' }, mainLuaGame()), token: ivy.token });
      assert.equal(back.status, 200);
      await eventually(async () => (await gameHours(ivyGame))?.seconds === 51_000, 'the hours again');
    });
    await test("games without a project, or whose project Hackatime doesn't know, show no hours", async () => {
      const plain = await call('POST', '/api/games', { body: form({ title: `No project ${run}`, description: '' }, mainLuaGame()), token: ivy.token });
      cleanup.push({ id: plain.data.id, token: ivy.token });
      const unknown = await call('POST', '/api/games', { body: form({ title: `Unknown ${run}`, description: '', hackatimeProject: 'Never tracked' }, mainLuaGame()), token: ivy.token });
      cleanup.push({ id: unknown.data.id, token: ivy.token });
      await eventually(() => db.prepare('SELECT hackatime_checked_at FROM games WHERE id = ?').get(unknown.data.id).hackatime_checked_at, 'the check');
      assert.equal(await gameHours(plain.data.id), undefined);
      assert.equal(await gameHours(unknown.data.id), undefined);
      const bad = await call('POST', '/api/games', { body: form({ title: `Bad ${run}`, description: '', hackatimeProject: 42 }, mainLuaGame()), token: ivy.token });
      assert.equal(bad.status, 422);
    });
    await test('when Hackatime fails, the page still works', async () => {
      fakeHackatime.failing = true;
      const r = await call('POST', '/api/games', { body: form({ title: `Broken ${run}`, description: '', hackatimeProject: 'Space Ivy' }, mainLuaGame()), token: ivy.token });
      cleanup.push({ id: r.data.id, token: ivy.token });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const g = await call('GET', `/api/games/${r.data.id}`);
      assert.equal(g.status, 200);
      assert.equal(g.data.game.hackatime, undefined);
      fakeHackatime.failing = false;
    });

    await test('connecting from the editor ends on /hackatime-connected', async () => {
      const jo = await signUp();
      const r = await hackatimeFlow(jo.session, htUser(), { next: '/hackatime-connected' });
      assert.equal(r.headers.get('location'), '/hackatime-connected?connected=hackatime');
      const page = await call('GET', '/hackatime-connected?connected=hackatime');
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type'), /^text\/html/);
      assert.equal(page.headers.get('cross-origin-opener-policy'), null);
    });
    await test('a callback with the wrong state, or for another account, is refused', async () => {
      const kim = await signUp();
      fakeHackatime.nextUser = htUser();
      const start = await call('GET', '/auth/hackatime', { session: kim.session, site: false });
      const r = await call('GET', '/auth/hackatime/callback?code=abc&state=wrong', { cookies: { smitten_hackatime_flow: start.cookies.smitten_hackatime_flow }, session: kim.session, site: false });
      assert.equal(r.status, 302);
      assert.match(r.headers.get('location'), /^\/account\?error=/);
      const lee = await signUp();
      const authorize = new URL(start.headers.get('location'));
      const back = new URL((await fetch(authorize, { redirect: 'manual' })).headers.get('location'));
      const swapped = await call('GET', back.pathname + back.search, { cookies: { smitten_hackatime_flow: start.cookies.smitten_hackatime_flow }, session: lee.session, site: false });
      assert.match(swapped.headers.get('location'), /^\/account\?error=/);
      assert.equal(userRow(kim.username).hackatime_id, null);
      assert.equal(userRow(lee.username).hackatime_id, null);
      const cancelled = await call('GET', `/auth/hackatime/callback?error=access_denied&state=x`, { cookies: { smitten_hackatime_flow: start.cookies.smitten_hackatime_flow }, session: kim.session, site: false });
      assert.match(cancelled.headers.get('location'), /^\/account\?error=/);
    });
    await test('a Hackatime account connected again elsewhere moves there', async () => {
      const mo = await signUp();
      const moHt = htUser();
      await hackatimeFlow(mo.session, moHt);
      const nia = await signUp();
      const before = fakeHackatime.revoked.length;
      await hackatimeFlow(nia.session, moHt);
      assert.equal(userRow(nia.username).hackatime_id, String(moHt.id));
      assert.equal(userRow(mo.username).hackatime_id, null);
      // Revoked in the background.
      await eventually(() => fakeHackatime.revoked.length === before + 1, "the old account's token to be revoked");
    });
    await test('a token revoked at Hackatime clears the link', async () => {
      const pat = await person();
      const patHt = htUser({ Pat: 7200 });
      await hackatimeFlow(pat.session, patHt);
      const g = await call('POST', '/api/games', { body: form({ title: `Pat ${run}`, description: '', hackatimeProject: 'Pat' }, mainLuaGame()), token: pat.token });
      cleanup.push({ id: g.data.id, token: pat.token });
      await eventually(() => gameHours(g.data.id), "Pat's hours");
      fakeHackatime.tokens.delete(fakeHackatime.issued.at(-1));
      const r = await call('GET', '/api/account/hackatime-key', { token: pat.token });
      assert.equal(r.status, 404);
      assert.equal(r.data.code, 'not-connected');
      assert.equal((await call('GET', '/api/account', { token: pat.token })).data.user.hackatime, false);
      assert.equal(userRow(pat.username).hackatime_token, null);
      assert.equal(await gameHours(g.data.id), undefined, 'no hours without a connection');
    });
    await test('disconnect (editor token or session): revoked at Hackatime and forgotten', async () => {
      const access = (() => {
        // Ivy's current token is the one the stand-in gave for ivyHt.
        for (const [token, user] of fakeHackatime.tokens) if (user === ivyHt) return token;
        return null;
      })();
      assert.ok(access);
      const r = await call('DELETE', '/api/account/hackatime', { token: ivy.token, headers: { Origin: EDITOR_ORIGIN } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.ok(fakeHackatime.revoked.includes(access));
      const row = userRow(ivy.username);
      assert.equal(row.hackatime_id, null);
      assert.equal(row.hackatime_token, null);
      assert.equal((await call('GET', '/api/account/hackatime-key', { token: ivy.token })).data.code, 'not-connected');
      assert.equal(await gameHours(ivyGame), undefined);
      // With a session, from the site's pages only.
      const qu = await signUp();
      await hackatimeFlow(qu.session, htUser());
      assert.equal((await call('DELETE', '/api/account/hackatime', { session: qu.session, site: false, headers: { Origin: 'https://evil.example' } })).status, 403);
      assert.equal((await call('DELETE', '/api/account/hackatime', { session: qu.session })).status, 200);
      assert.equal((await call('GET', '/api/account', { session: qu.session })).data.user.hackatime, false);
    });
    await test('deleting an account revokes its Hackatime token', async () => {
      const ro = await signUp();
      await hackatimeFlow(ro.session, htUser());
      const access = fakeHackatime.issued.at(-1);
      assert.equal((await call('DELETE', '/api/account', { body: { password: PASSWORD }, session: ro.session })).status, 200);
      assert.ok(fakeHackatime.revoked.includes(access));
    });
    await test('without HACKATIME_CLIENT_ID and _SECRET, Hackatime is off', async () => {
      const port = PORT + 1;
      const dir = mkdtempSync(join(tmpdir(), 'smitten-platform-test-off-'));
      let child;
      try {
        child = await spawnServer(port, dir, {});
        const at = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init });
        const config = await (await at('/api/config')).json();
        assert.equal(config.accounts.hackatime, false);
        assert.equal((await at('/auth/hackatime')).status, 404);
        assert.equal((await at('/auth/hackatime/callback?code=x&state=y')).status, 404);
        const key = await at('/api/account/hackatime-key');
        assert.equal(key.status, 404);
        assert.equal((await key.json()).code, 'hackatime-off');
      } finally {
        child?.kill();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  // -------------------------------------------------------------------------
  section('Deleting');
  await test('deleting a game needs its owner', async () => {
    assert.equal((await call('DELETE', `/api/games/${game.id}`)).status, 401);
    assert.equal((await call('DELETE', `/api/games/${game.id}`, { token: 'not-the-token' })).status, 401);
    assert.equal((await call('DELETE', `/api/games/${game.id}`, { token: mallory.token })).status, 403);
  });
  await test('the owner deletes it with its files', async () => {
    const r = await call('DELETE', `/api/games/${game.id}`, { token: alice.token, headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
    assert.equal((await call('GET', `/api/games/${game.id}`)).status, 404);
    assert.equal((await call('GET', `/api/games/${game.id}/game.love`)).status, 404);
    assert.equal((await call('PUT', `/api/games/${game.id}`, { body: form({ title: 'x' }, love), token: alice.token })).status, 404);
  });
  await test('deleting an account needs the password, and takes its games with it', async () => {
    const henry = await person();
    const g = await publish({ title: `Henry ${tag}` }, mainLuaGame(), null, { token: henry.token });
    assert.equal((await call('DELETE', '/api/account', { body: { password: 'wrong wrong' }, session: henry.session })).status, 403);
    const r = await call('DELETE', '/api/account', { body: { password: PASSWORD }, session: henry.session });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', `/api/games/${g.data.id}`)).status, 404);
    assert.equal((await call('GET', `/api/users/${henry.username}`)).status, 404);
    assert.equal((await call('GET', '/api/account', { token: henry.token })).status, 401);
    assert.equal((await call('POST', '/api/auth/signin', { body: { username: henry.username, password: PASSWORD }, site: true })).status, 401);
  });

  section('Rate limits');
  await test('publishing is limited per account (429 with Retry-After)', async () => {
    const p = await person();
    for (let i = 0; i < 10; i++) {
      const r = await call('POST', '/api/games', { body: 'x', headers: { 'Content-Type': 'text/plain' }, token: p.token });
      assert.equal(r.status, 415, `attempt ${i + 1}`);
    }
    const r = await call('POST', '/api/games', { body: 'x', headers: { 'Content-Type': 'text/plain' }, token: p.token });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.match(r.data.error, /try again/);
    // Someone else isn't affected.
    const other = await person();
    assert.equal((await call('POST', '/api/games', { body: 'x', headers: { 'Content-Type': 'text/plain' }, token: other.token })).status, 415);
  });
  await test('reporting is limited per address', async () => {
    const ip = freshIp();
    const target = (await publish({ title: `Report target ${tag}` })).data;
    let last;
    for (let i = 0; i < 21; i++) last = await call('POST', `/api/games/${target.id}/report`, { body: { reason: 'other' }, ip });
    assert.equal(last.status, 429);
  });

  // Remove everything this run published.
  for (const g of cleanup) await call('DELETE', `/api/games/${g.id}`, { token: g.token });

  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    if (!external) stopServer();
    process.exit(failed ? 1 : 0);
  });
