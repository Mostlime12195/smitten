// Tests the game-sharing site's API (platform/) against a running local
// Worker:
//
//   cd platform && npx wrangler dev          (http://127.0.0.1:8787)
//   node tools/platform-tests/test.mjs
//
// PLATFORM_URL changes the address, ADMIN_TOKEN the admin token (otherwise
// it's read from platform/.dev.vars; without one the admin checks are
// skipped). Locally, wrangler dev passes the CF-Connecting-IP header
// through, so the tests act as many different people by setting it (on
// Cloudflare the edge sets it, and clients can't).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.PLATFORM_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const EDITOR_ORIGIN = 'http://localhost:8766';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function adminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  try {
    const vars = readFileSync(`${ROOT}platform/.dev.vars`, 'utf8');
    return /^ADMIN_TOKEN\s*=\s*"?([^"\n]+)"?/m.exec(vars)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}
const ADMIN = adminToken();

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
    console.log(`  FAIL ${name}\n       ${String(e?.message || e).split('\n').join('\n       ')}`);
  }
}

function skip(name, why) {
  skipped++;
  console.log(`  skip ${name} (${why})`);
}

function section(title) {
  console.log(`\n${title}`);
}

// Every request comes from a made-up address unless a test picks one, so
// rate limits from earlier runs or other tests don't get in the way.
const run = Math.floor(Math.random() * 200) + 20;
let ipCounter = 0;
const freshIp = () => `10.${run}.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

async function call(method, path, { body, headers = {}, ip = freshIp(), token } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData) && typeof body !== 'string' && !(body instanceof Uint8Array)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body, redirect: 'manual' });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, data };
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

async function publish(meta, game = mainLuaGame(), thumbnail = null, opts = {}) {
  const res = await call('POST', '/api/games', { body: form({ description: '', ...meta }, game, thumbnail), ...opts });
  if (res.status === 201) cleanup.push({ id: res.data.id, token: res.data.token });
  return res;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const ID = /^[0-9a-hjkmnp-tv-z]{10}$/;

// ---------------------------------------------------------------------------

async function main() {
  try {
    await fetch(`${BASE}/api/config`);
  } catch {
    console.error(`Nothing answers at ${BASE}. Start the site first: cd platform && npx wrangler dev`);
    process.exit(2);
  }
  console.log(`Testing ${BASE}${ADMIN ? '' : ' (no ADMIN_TOKEN: admin checks are skipped)'}`);

  section('Pages and headers');
  await test('config lists report reasons, modules and limits', async () => {
    const r = await call('GET', '/api/config');
    assert.equal(r.status, 200);
    assert.ok(r.data.reportReasons.length >= 3);
    assert.ok(r.data.modules.includes('physics2d'));
    assert.equal(r.data.limits.gameBytes, 25 * 1024 * 1024);
    assert.equal(r.data.limits.thumbnailBytes, 1024 * 1024);
    assert.ok(r.data.editorUrl);
  });
  await test('the gallery is HTML with a CSP, nosniff and no framing', async () => {
    const r = await call('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/html/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(new TextDecoder().decode(r.data), /<meta name="smitten-editor-url" content="http/);
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

  section('Publishing');
  const files = smokeFiles();
  const love = zip(files);
  const thumb = png(16, 9);
  let game;
  await test('publish a game with a thumbnail', async () => {
    const r = await publish({ title: `Smoke ${tag}`, description: 'Walks right\r\nand picks up a coin.', modules: ['physics2d'], engineVersion: '0.2.0' }, love, thumb, { headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.id, ID);
    assert.ok(r.data.token.length >= 40);
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
    game = { id: r.data.id, token: r.data.token };
    assert.equal(r.data.game.title, `Smoke ${tag}`);
    assert.equal(r.data.game.description, 'Walks right\nand picks up a coin.');
    assert.deepEqual(r.data.game.modules, ['physics2d']);
    assert.equal(r.data.game.version, 1);
    assert.equal(r.data.game.playUrl, `${BASE}/play/${game.id}`);
  });
  if (!game) throw new Error('Publishing failed; the remaining tests depend on it.');

  await test('get its metadata', async () => {
    const r = await call('GET', `/api/games/${game.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.game.id, game.id);
    assert.equal(r.data.game.engineVersion, '0.2.0');
    assert.equal(r.data.game.size, love.length);
    assert.match(r.data.game.thumbnail, /\/thumbnail\.png\?v=1$/);
    assert.equal(r.data.game.remixOf, null);
    assert.equal(r.data.game.remixes, 0);
    assert.equal(r.data.game.token, undefined);
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

  section('Listing and search');
  await test('the newest list starts with it', async () => {
    const r = await call('GET', '/api/games?sort=new&limit=5');
    assert.equal(r.status, 200);
    assert.equal(r.data.games[0].id, game.id);
  });
  await test('search finds it by title, and nothing for nonsense', async () => {
    const r = await call('GET', `/api/games?q=${encodeURIComponent(tag.toUpperCase())}`);
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
  await test('most played sorts by plays', async () => {
    const r = await call('GET', `/api/games?sort=popular&q=${tag}`);
    assert.equal(r.data.games[0].id, game.id);
    assert.ok(r.data.games[0].plays >= r.data.games.at(-1).plays);
  });

  section('Updating');
  const love2 = zip({ ...files, 'scenes/main.lua': files['scenes/main.lua'].replace('60 * dt', '90 * dt') });
  await test('updating without a token is refused (401)', async () => {
    const r = await call('PUT', `/api/games/${game.id}`, { body: form({ title: 'Nope' }, love2) });
    assert.equal(r.status, 401);
  });
  await test('updating with another game\'s token is refused (403)', async () => {
    const other = cleanup.find((g) => g.id !== game.id);
    const r = await call('PUT', `/api/games/${game.id}`, { body: form({ title: 'Nope' }, love2), token: other.token });
    assert.equal(r.status, 403);
  });
  await test('updating with the token: same id, new version and files', async () => {
    const r = await call('PUT', `/api/games/${game.id}`, { body: form({ title: `Smoke ${tag} v2`, description: 'Faster.', modules: [] }, love2), token: game.token, headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.id, game.id);
    assert.equal(r.data.game.version, 2);
    assert.equal(r.data.game.title, `Smoke ${tag} v2`);
    assert.equal(r.data.game.thumbnail, null, 'an update without a thumbnail removes it');
    assert.equal(r.data.game.plays, 2, 'plays are kept');
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
    const r = await publish({ title: `Zero​Width\u0007 ${tag}` });
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
    assert.equal((await call('POST', '/api/games', { body: { title: 'json' } })).status, 415);
    assert.equal((await call('POST', '/api/games', { body: form('{not json', love) })).status, 400);
    const r = await call('POST', '/api/games', { body: form({ title: 'No game' }) });
    assert.equal(r.status, 422);
    assert.equal(r.data.field, 'game');
  });

  section('Remixes');
  let remix;
  await test('publishing with remixOf records the original', async () => {
    const r = await publish({ title: `Remix ${tag}`, remixOf: game.id }, love2);
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
  await test('three people reporting hides the game everywhere', async () => {
    const b = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'hate' } });
    assert.equal(b.data.hidden, false);
    const c = await call('POST', `/api/games/${game.id}/report`, { body: { reason: 'other', note: 'third' } });
    assert.equal(c.data.hidden, true);
    const meta = await call('GET', `/api/games/${game.id}`);
    assert.equal(meta.status, 404);
    assert.equal(meta.data.hidden, true);
    assert.equal((await call('GET', `/api/games/${game.id}/game.love`)).status, 404);
    assert.equal((await call('POST', `/api/games/${game.id}/play`)).status, 404);
    const list = await call('GET', `/api/games?q=${tag}&limit=48`);
    assert.ok(!list.data.games.some((g) => g.id === game.id));
  });
  await test('the owner can still see a hidden game', async () => {
    const r = await call('GET', `/api/games/${game.id}`, { token: game.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.game.status, 'hidden');
  });

  if (!ADMIN) {
    skip('admin endpoints', 'no ADMIN_TOKEN');
  } else {
    await test('admin endpoints need the admin token', async () => {
      assert.equal((await call('GET', '/api/admin/reports')).status, 401);
      assert.equal((await call('GET', '/api/admin/reports', { token: 'wrong' })).status, 401);
      assert.equal((await call('GET', '/api/admin/reports', { token: game.token })).status, 401);
    });
    await test('admins list reported games with their reports', async () => {
      const r = await call('GET', '/api/admin/reports', { token: ADMIN });
      assert.equal(r.status, 200);
      const g = r.data.games.find((x) => x.id === game.id);
      assert.ok(g, 'the reported game is listed');
      assert.equal(g.status, 'hidden');
      assert.equal(g.hiddenBy, 'reports');
      assert.equal(g.openReports, 3);
      assert.ok(g.reports.some((x) => x.note === 'third'));
      assert.ok(g.reports.every((x) => x.reporter.length === 8), 'reporters are hashes, not addresses');
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
  }

  section('Rate limits');
  await test('publishing is limited per address (429 with Retry-After)', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const r = await call('POST', '/api/games', { body: 'x', headers: { 'Content-Type': 'text/plain' }, ip });
      assert.equal(r.status, 415, `attempt ${i + 1}`);
    }
    const r = await call('POST', '/api/games', { body: 'x', headers: { 'Content-Type': 'text/plain' }, ip });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.match(r.data.error, /try again/);
    // Someone else isn't affected.
    assert.equal((await call('POST', '/api/games', { body: 'x', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  });
  await test('reporting is limited per address', async () => {
    const ip = freshIp();
    const target = cleanup.find((g) => g.id !== game.id && g.id !== remix?.id);
    let last;
    for (let i = 0; i < 21; i++) last = await call('POST', `/api/games/${target.id}/report`, { body: { reason: 'other' }, ip });
    assert.equal(last.status, 429);
  });

  section('Deleting');
  await test('deleting needs the game\'s token', async () => {
    assert.equal((await call('DELETE', `/api/games/${game.id}`)).status, 401);
    assert.equal((await call('DELETE', `/api/games/${game.id}`, { token: 'not-the-token' })).status, 403);
  });
  await test('deleting with the token removes the game and its files', async () => {
    const r = await call('DELETE', `/api/games/${game.id}`, { token: game.token, headers: { Origin: EDITOR_ORIGIN } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR_ORIGIN);
    assert.equal((await call('GET', `/api/games/${game.id}`)).status, 404);
    assert.equal((await call('GET', `/api/games/${game.id}/game.love`)).status, 404);
    assert.equal((await call('PUT', `/api/games/${game.id}`, { body: form({ title: 'x' }, love), token: game.token })).status, 404);
  });

  // Remove everything this run published.
  for (const g of cleanup) await call('DELETE', `/api/games/${g.id}`, { token: g.token });

  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
