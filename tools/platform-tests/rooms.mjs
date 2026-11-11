// Tests the games site's online rooms (platform/src/rooms.js): the relay
// that smitten.net uses, through a WebSocket client of its own (so the tests
// can set Origin, the address and cookies, and send broken frames).
//
//   node tools/platform-tests/rooms.mjs
//
// It starts the server on ROOMS_PORT (8786) with an empty temporary data
// folder and small limits (so that the limits and timers can be tested in
// seconds), and stops it at the end. rooms-e2e.mjs tests the same with the
// engine, the game's page and a browser.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EDITOR_ORIGIN = 'http://localhost:8766';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Things rooms-e2e.mjs uses too: a server, an account, a game.

/** A stored (uncompressed) zip of {path: text}. */
export function zip(files) {
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(central.reduce((n, b) => n + b.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

/** Starts the site: {base, stop(), output()} (output: what it printed). */
export async function startSite(port, env = {}) {
  const base = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'smitten-rooms-'));
  let printed = '';
  const server = spawn(process.execPath, [join(ROOT, 'platform/src/server.js')], {
    env: { PATH: process.env.PATH, ENV_FILE: join(dataDir, 'no.env'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: base, DATA_DIR: dataDir, SCRYPT_LOG_N: '10', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { printed += d; });
  server.stderr.on('data', (d) => { printed += d; process.stderr.write(d); });
  for (let i = 0; ; i++) {
    try {
      await fetch(`${base}/api/config`);
      break;
    } catch {
      if (i > 100 || server.exitCode !== null) throw new Error(`The site did not start:\n${printed}`);
      await sleep(100);
    }
  }
  return {
    base,
    output: () => printed,
    stop() {
      server.kill();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function call(base, method, path, { body, token, session, origin, ip } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (session) headers.Cookie = `smitten_session=${encodeURIComponent(session)}`;
  if (origin || session) headers.Origin = origin || base;
  if (ip) headers['X-Forwarded-For'] = ip;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  const cookie = res.headers.getSetCookie().map((c) => /^smitten_session=([^;]+)/.exec(c)?.[1]).find(Boolean);
  return { data, session: cookie ? decodeURIComponent(cookie) : null };
}

/** Signs up: {session, token (an editor token)}. */
export async function account(base, displayName = 'Ee Two') {
  const signup = await call(base, 'POST', '/api/auth/signup', { body: { username: `r${randomBytes(4).toString('hex')}`, password: 'correct horse battery', displayName }, origin: base });
  const session = signup.session;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const { code } = (await call(base, 'POST', '/api/auth/editor/code', { body: { origin: EDITOR_ORIGIN, challenge }, session })).data;
  const { token } = (await call(base, 'POST', '/api/auth/editor/token', { body: { code, verifier }, origin: EDITOR_ORIGIN })).data;
  return { session, token };
}

/** Publishes a game of {path: text}; returns its id. */
export async function publish(base, token, files, title = 'Rooms test') {
  const form = new FormData();
  form.append('meta', JSON.stringify({ title, description: 'Tests online rooms.' }));
  form.append('game', new Blob([zip(files)], { type: 'application/zip' }), 'game.zip');
  return (await call(base, 'POST', '/api/games', { body: form, token })).data.id;
}

const tinyGame = () => ({
  'smitten.json': JSON.stringify({ format: 'smitten.project', version: 3, name: 'Rooms', main: 'main.scene' }),
  'main.scene': JSON.stringify({ format: 'smitten.scene', version: 3, root: { name: 'Main', type: 'Group' } }),
});

// ---------------------------------------------------------------------------
// A WebSocket client

let ipCounter = 0;
const freshIp = () => `10.77.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

function frame(op, payload, { mask = true, fin = true } = {}) {
  const data = Buffer.from(payload);
  const n = data.length;
  const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, (mask ? 0x80 : 0) | n])
    : n < 65536 ? Buffer.from([(fin ? 0x80 : 0) | op, (mask ? 0x80 : 0) | 126, n >> 8, n & 255])
      : Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | op, (mask ? 0x80 : 0) | 127, 0, 0, 0, 0]), Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])]);
  if (!mask) return Buffer.concat([head, data]);
  const key = randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < n; i++) masked[i] ^= key[i & 3];
  return Buffer.concat([head, key, masked]);
}

/**
 * Opens /api/games/<game>/rooms/<room>. Resolves to a client once the
 * server answers: {status, body} for a refusal, or for 101 a client with
 * messages (parsed), next(test, ms), send(obj), sendText(text),
 * raw(buffer), close(code), drop() (the connection ends with no close
 * frame), and closed (a promise of {code, reason}).
 */
function connect(base, game, room, { query = {}, origin = base, ip = freshIp(), cookie, pong = true, key = randomBytes(16).toString('base64') } = {}) {
  const url = new URL(base);
  const q = new URLSearchParams(query).toString();
  const path = `/api/games/${game}/rooms/${encodeURIComponent(room)}${q ? `?${q}` : ''}`;
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port), url.hostname);
    let buffer = Buffer.alloc(0);
    let open = false;
    let closeInfo = null;
    let onClosed;
    const closed = new Promise((r) => { onClosed = r; });
    const waiters = [];
    const client = {
      messages: [],
      pings: 0,
      closed,
      send: (obj) => socket.write(frame(1, JSON.stringify(obj))),
      sendText: (text) => socket.write(frame(1, text)),
      raw: (buf) => socket.write(buf),
      close: (code = 1000) => {
        const p = Buffer.alloc(2);
        p.writeUInt16BE(code, 0);
        socket.write(frame(8, p));
      },
      drop: () => socket.destroy(),
      /** The next message (after the ones taken) that passes test, within ms. */
      next(test = () => true, ms = 2000) {
        const i = client.messages.findIndex(test);
        if (i >= 0) return Promise.resolve(client.messages.splice(i, 1)[0]);
        return new Promise((res, rej) => {
          const w = { test, res, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(`no message like ${test} in ${ms} ms; got ${JSON.stringify(client.messages)}`)); }, ms) };
          waiters.push(w);
        });
      },
      /** True if no message that passes test comes within ms. */
      async none(test = () => true, ms = 300) {
        await sleep(ms);
        return !client.messages.some(test);
      },
    };
    const take = (msg) => {
      const w = waiters.find((x) => x.test(msg));
      if (w) {
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.res(msg);
      } else {
        client.messages.push(msg);
      }
    };
    const finish = () => {
      if (!closeInfo) closeInfo = { code: 1006, reason: '' };
      onClosed(closeInfo);
    };
    socket.on('error', (e) => { if (!open) reject(e); });
    socket.on('close', finish);
    socket.on('data', (d) => {
      buffer = Buffer.concat([buffer, d]);
      if (!open) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString();
        const status = Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1]);
        buffer = buffer.subarray(end + 4);
        if (status !== 101) {
          socket.on('end', () => resolve({ status, body: buffer.toString() }));
          return;
        }
        open = true;
        resolve(client);
      }
      while (buffer.length >= 2) {
        const op = buffer[0] & 0x0f;
        let n = buffer[1] & 0x7f;
        let at = 2;
        if (n === 126) { if (buffer.length < 4) return; n = buffer.readUInt16BE(2); at = 4; }
        else if (n === 127) { if (buffer.length < 10) return; n = buffer.readUInt32BE(6); at = 10; }
        if (buffer.length < at + n) return;
        const payload = buffer.subarray(at, at + n);
        buffer = buffer.subarray(at + n);
        if (op === 1) take(JSON.parse(payload.toString()));
        else if (op === 8) {
          closeInfo = { code: payload.length >= 2 ? payload.readUInt16BE(0) : 1005, reason: payload.subarray(2).toString() };
        } else if (op === 9) {
          client.pings++;
          if (pong) socket.write(frame(10, payload));
        }
      }
    });
    const lines = [`GET ${path} HTTP/1.1`, `Host: ${url.host}`, 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', `X-Forwarded-For: ${ip}`];
    if (origin) lines.push(`Origin: ${origin}`);
    if (cookie) lines.push(`Cookie: ${cookie}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  });
}

// ---------------------------------------------------------------------------
// The tests

let passed = 0;
let failed = 0;

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

let roomCounter = 0;
const freshRoom = () => `room ${++roomCounter}`;

async function main() {
  const port = Number(process.env.ROOMS_PORT || 8786);
  const ADMIN = randomBytes(24).toString('base64url');
  const site = await startSite(port, {
    TRUST_PROXY: '1', ADMIN_TOKEN: ADMIN,
    ROOM_MAX_PLAYERS: '4', ROOMS_PER_GAME: '6', ROOM_CONNECTIONS_PER_ADDRESS: '3', ROOM_MESSAGE_BYTES: '1000',
    ROOM_MESSAGES_PER_SECOND: '10', ROOM_GRACE_SECONDS: '1', ROOM_IDLE_SECONDS: '6', ROOM_PING_SECONDS: '0.5',
  });
  const base = site.base;
  const open = [];
  const join = async (game, room, opts) => {
    const c = await connect(base, game, room, opts);
    if (c.messages) open.push(c);
    return c;
  };
  const welcomed = async (game, room, opts) => {
    const c = await join(game, room, opts);
    assert.ok(c.messages, `refused: ${c.status} ${c.body}`);
    c.welcome = await c.next((m) => m.t === 'welcome');
    return c;
  };
  const refused = async (game, room, opts) => {
    const c = await join(game, room, opts);
    assert.ok(c.messages, `refused at the HTTP level: ${c.status}`);
    return c.closed;
  };

  try {
    const owner = await account(base, 'Owner Person');
    const game = await publish(base, owner.token, tinyGame());
    const other = await publish(base, owner.token, tinyGame(), 'Another game');
    const SECRET = `secret-${randomBytes(6).toString('hex')}`;

    console.log('\nConnecting');
    await test('only WebSocket upgrades from the site itself', async () => {
      let r = await connect(base, game, 'a', { origin: 'https://evil.example' });
      assert.equal(r.status, 403);
      r = await connect(base, game, 'a', { origin: null });
      assert.equal(r.status, 403);
      r = await connect(base, game, 'a', { key: '' });
      assert.equal(r.status, 400);
      const res = await fetch(`${base}/api/games/${game}/rooms/a`);
      assert.equal(res.status, 404, 'a plain request is not a room');
    });
    await test('an upgrade to another address is refused', async () => {
      const r = await new Promise((resolve) => {
        const s = net.connect(port, '127.0.0.1');
        let text = '';
        s.on('data', (d) => { text += d; });
        s.on('close', () => resolve(text));
        s.write(`GET /api/config HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${base}\r\n\r\n`);
      });
      assert.match(r, /^HTTP\/1\.1 404/);
    });
    await test('an unknown or hidden game: no-game', async () => {
      assert.deepEqual(await refused('nosuchgame1', 'a'), { code: 4000, reason: 'no-game' });
      const hidden = await publish(base, owner.token, tinyGame(), 'Hidden');
      await call(base, 'POST', `/api/admin/games/${hidden}/hide`, { token: ADMIN, body: {} });
      assert.deepEqual(await refused(hidden, 'a'), { code: 4000, reason: 'no-game' });
    });
    await test('bad room names: bad-room', async () => {
      for (const name of ['a/b', ' ', 'x'.repeat(33), 'semi;colon', 'tab\there', 'emoji 🎮']) {
        assert.deepEqual(await refused(game, name), { code: 4000, reason: 'bad-room' }, name);
      }
      const c = await welcomed(game, 'Ünïcode 1.2_ok-'.padEnd(32, 'x'));
      assert.equal(c.welcome.room, 'Ünïcode 1.2_ok-'.padEnd(32, 'x'));
    });
    await test('bad guest names: bad-name', async () => {
      assert.deepEqual(await refused(game, freshRoom(), { query: { name: '<script>' } }), { code: 4000, reason: 'bad-name' });
      assert.deepEqual(await refused(game, freshRoom(), { query: { name: 'x'.repeat(13) } }), { code: 4000, reason: 'bad-name' });
    });

    console.log('\nJoining, peers and the host');
    let a, b, c;
    const room = freshRoom();
    await test('the first player makes the room and is its host', async () => {
      a = await welcomed(game, room, { query: { name: 'Ada' } });
      const w = a.welcome;
      assert.equal(w.me, 1);
      assert.equal(w.host, 1);
      assert.equal(w.max, 4, '8 by default, but this server allows 4 at most');
      assert.equal(w.room, room);
      assert.ok(typeof w.token === 'string' && w.token.length >= 20);
      assert.deepEqual(w.peers, [{ id: 1, name: 'Ada', guest: true }]);
    });
    await test('the next player gets everyone; the others get joined', async () => {
      b = await welcomed(game, room.toUpperCase());
      assert.equal(b.welcome.me, 2);
      assert.equal(b.welcome.host, 1);
      assert.deepEqual(b.welcome.peers, [{ id: 1, name: 'Ada', guest: true }, { id: 2, name: 'Guest 2', guest: true }]);
      assert.deepEqual(await a.next((m) => m.t === 'joined'), { t: 'joined', peer: { id: 2, name: 'Guest 2', guest: true } });
      assert.ok(await b.none((m) => m.t === 'joined'), 'no joined for yourself');
    });
    await test('a signed-in player has the account\'s name', async () => {
      const me = await account(base, 'Ee Two');
      c = await welcomed(game, room, { cookie: `smitten_session=${encodeURIComponent(me.session)}` });
      assert.deepEqual(c.welcome.peers.at(-1), { id: 3, name: 'Ee Two' });
      await a.next((m) => m.t === 'joined' && m.peer.id === 3);
      await b.next((m) => m.t === 'joined' && m.peer.id === 3);
    });

    console.log('\nMessages');
    await test('send: to one peer, from whom', async () => {
      a.send({ t: 'to', to: 2, d: { x: 10, y: [1, 2], s: SECRET } });
      assert.deepEqual(await b.next((m) => m.t === 'msg'), { t: 'msg', from: 1, d: { x: 10, y: [1, 2], s: SECRET } });
      assert.ok(await c.none((m) => m.t === 'msg'), 'only the one it is for');
      b.send({ t: 'to', to: 1, d: 'back' });
      assert.deepEqual(await a.next((m) => m.t === 'msg'), { t: 'msg', from: 2, d: 'back' });
    });
    await test('broadcast: to everyone else, in order', async () => {
      for (let i = 0; i < 5; i++) c.send({ t: 'all', d: i });
      for (const p of [a, b]) {
        for (let i = 0; i < 5; i++) assert.deepEqual(await p.next((m) => m.t === 'msg'), { t: 'msg', from: 3, d: i });
      }
      assert.ok(await c.none((m) => m.t === 'msg'), 'not to the one who sent it');
    });
    await test('no data is fine', async () => {
      a.send({ t: 'all' });
      assert.deepEqual(await b.next((m) => m.t === 'msg'), { t: 'msg', from: 1 });
      await c.next((m) => m.t === 'msg');
    });
    await test('a message to nobody: warn no-peer', async () => {
      a.send({ t: 'to', to: 99, d: 1 });
      assert.deepEqual(await a.next((m) => m.t === 'warn'), { t: 'warn', reason: 'no-peer' });
      await sleep(1100);
      a.send({ t: 'to', to: 1, d: 1 });
      assert.deepEqual(await a.next((m) => m.t === 'warn'), { t: 'warn', reason: 'no-peer' }, 'not to yourself');
      a.send({ t: 'to', to: '2', d: 1 });
      assert.ok(await b.none((m) => m.t === 'msg'), 'ids are numbers');
    });
    await test('messages that are not right: warn bad-message', async () => {
      b.sendText('not json');
      assert.deepEqual(await b.next((m) => m.t === 'warn'), { t: 'warn', reason: 'bad-message' });
      await sleep(1100);
      b.send({ t: 'shout', d: 1 });
      assert.deepEqual(await b.next((m) => m.t === 'warn'), { t: 'warn', reason: 'bad-message' });
      assert.ok(await a.none((m) => m.t === 'msg'));
    });
    await test('a message over ROOM_MESSAGE_BYTES: warn too-big, and the connection stays', async () => {
      c.send({ t: 'all', d: 'x'.repeat(1100) });
      assert.deepEqual(await c.next((m) => m.t === 'warn'), { t: 'warn', reason: 'too-big' });
      assert.ok(await a.none((m) => m.t === 'msg'));
      c.send({ t: 'all', d: 'x'.repeat(900) });
      assert.equal((await a.next((m) => m.t === 'msg')).d.length, 900);
      await b.next((m) => m.t === 'msg');
    });
    await test('messages in pieces (fragments) are one message', async () => {
      const text = JSON.stringify({ t: 'to', to: 2, d: 'joined up' });
      a.raw(Buffer.concat([frame(1, text.slice(0, 10), { fin: false }), frame(0, text.slice(10, 20), { fin: false }), frame(9, 'ping in the middle'), frame(0, text.slice(20))]));
      assert.deepEqual(await b.next((m) => m.t === 'msg'), { t: 'msg', from: 1, d: 'joined up' });
    });
    await test('too many messages per second: dropped, with warn too-fast', async () => {
      await sleep(1100);
      for (let i = 0; i < 30; i++) a.send({ t: 'to', to: 2, d: i });
      assert.deepEqual(await a.next((m) => m.t === 'warn'), { t: 'warn', reason: 'too-fast' });
      await sleep(400);
      const got = b.messages.filter((m) => m.t === 'msg').length;
      b.messages.length = 0;
      assert.ok(got >= 10 && got <= 13, `${got} arrived (10 a second, at once)`);
      await sleep(1100);
      a.send({ t: 'to', to: 2, d: 'later' });
      assert.equal((await b.next((m) => m.t === 'msg')).d, 'later', 'and later ones arrive');
    });
    await test('nothing the games send goes to the server\'s output', async () => {
      assert.ok(!site.output().includes(SECRET));
    });

    console.log('\nLeaving, the host, dropping and coming back');
    await test('close: the others get left at once, with the host', async () => {
      a.close(1000);
      assert.deepEqual(await a.closed, { code: 1000, reason: '' });
      assert.deepEqual(await b.next((m) => m.t === 'left'), { t: 'left', id: 1, host: 2 });
      assert.deepEqual(await c.next((m) => m.t === 'left'), { t: 'left', id: 1, host: 2 }, 'the next one in is the host');
    });
    await test('a dropped connection keeps its place for the grace time', async () => {
      c.drop();
      assert.ok(await b.none((m) => m.t === 'left', 600), 'not gone yet');
      assert.deepEqual(await b.next((m) => m.t === 'left', 2000), { t: 'left', id: 3, host: 2 });
    });
    await test('back within the grace time with the token: the same peer, and nobody notices', async () => {
      const d = await welcomed(game, room);
      await b.next((m) => m.t === 'joined');
      d.drop();
      await sleep(300);
      const again = await welcomed(game, room, { query: { resume: d.welcome.token } });
      assert.equal(again.welcome.me, d.welcome.me);
      assert.deepEqual(again.welcome.peers.map((p) => p.id), [2, d.welcome.me]);
      await sleep(1300);
      assert.ok(!b.messages.some((m) => m.t === 'left'), 'no left');
      again.send({ t: 'to', to: 2, d: 'still here' });
      assert.equal((await b.next((m) => m.t === 'msg')).d, 'still here');
      // A token while the old connection is still open: the new one takes over.
      const third = await welcomed(game, room, { query: { resume: d.welcome.token } });
      assert.deepEqual(await again.closed, { code: 1006, reason: '' });
      third.send({ t: 'to', to: 2, d: 'taken over' });
      assert.equal((await b.next((m) => m.t === 'msg')).d, 'taken over');
      third.close();
      await b.next((m) => m.t === 'left');
    });
    await test('a token after the grace time, or for another room: expired', async () => {
      const d = await welcomed(game, room);
      await b.next((m) => m.t === 'joined');
      assert.deepEqual(await refused(game, freshRoom(), { query: { resume: d.welcome.token } }), { code: 4000, reason: 'expired' });
      d.drop();
      await b.next((m) => m.t === 'left', 3000);
      assert.deepEqual(await refused(game, room, { query: { resume: d.welcome.token } }), { code: 4000, reason: 'expired' });
      assert.deepEqual(await refused(game, room, { query: { resume: 'made-up' } }), { code: 4000, reason: 'expired' });
    });
    await test('a page that stops answering pings is dropped, then leaves', async () => {
      const quiet = await welcomed(game, room, { pong: false });
      const id = quiet.welcome.me;
      await b.next((m) => m.t === 'joined');
      const t0 = Date.now();
      assert.deepEqual(await b.next((m) => m.t === 'left', 6000), { t: 'left', id, host: 2 });
      assert.ok(quiet.pings >= 1, 'the server pinged');
      assert.ok(Date.now() - t0 > 1000, 'not at once');
      assert.ok(b.pings >= 2, 'and pings the others too, who answer and stay');
    });
    await test('the last player out: the room is gone (a new one starts at 1)', async () => {
      b.close();
      await b.closed;
      await sleep(100);
      const n = await welcomed(game, room);
      assert.equal(n.welcome.me, 1);
      assert.equal(n.welcome.host, 1);
      n.close();
    });

    console.log('\nLimits and scope');
    await test('max players: the first player chooses (2 at least, ROOM_MAX_PLAYERS at most); then full', async () => {
      const r = freshRoom();
      const p1 = await welcomed(game, r, { query: { max: '2' } });
      assert.equal(p1.welcome.max, 2);
      const p2 = await welcomed(game, r, { query: { max: '4' } });
      assert.equal(p2.welcome.max, 2, 'later players do not change it');
      assert.deepEqual(await refused(game, r), { code: 4000, reason: 'full' });
      assert.equal((await welcomed(game, freshRoom(), { query: { max: '1' } })).welcome.max, 2);
      assert.equal((await welcomed(game, freshRoom(), { query: { max: 'lots' } })).welcome.max, 4);
    });
    await test('a room name is the game\'s own', async () => {
      const r = freshRoom();
      const p1 = await welcomed(game, r);
      const p2 = await welcomed(other, r);
      assert.equal(p2.welcome.me, 1, 'another game\'s room of that name is another room');
      assert.ok(await p1.none((m) => m.t === 'joined'));
      p2.send({ t: 'all', d: 'hello?' });
      assert.ok(await p1.none((m) => m.t === 'msg'));
    });
    await test('connections from one address: ROOM_CONNECTIONS_PER_ADDRESS, then busy', async () => {
      const ip = freshIp();
      const r = freshRoom();
      const mine = [];
      for (let i = 0; i < 3; i++) mine.push(await welcomed(game, r, { ip }));
      assert.deepEqual(await refused(game, r, { ip }), { code: 4000, reason: 'busy' });
      mine[0].close();
      await mine[0].closed;
      await sleep(100);
      await welcomed(game, r, { ip });
    });
    for (const c2 of open) c2.drop();
    open.length = 0;
    await sleep(1500);
    await test('rooms a game can have: ROOMS_PER_GAME, then too-many-rooms', async () => {
      const g = await publish(base, owner.token, tinyGame(), 'Many rooms');
      for (let i = 0; i < 6; i++) await welcomed(g, `r${i}`);
      assert.deepEqual(await refused(g, 'r6'), { code: 4000, reason: 'too-many-rooms' });
      await welcomed(g, 'r0');
    });
    await test('a room with no message for ROOM_IDLE_SECONDS closes: idle', async () => {
      const r = freshRoom();
      const p1 = await welcomed(game, r);
      const p2 = await welcomed(game, r);
      const t0 = Date.now();
      assert.deepEqual(await p1.closed, { code: 4000, reason: 'idle' });
      assert.deepEqual(await p2.closed, { code: 4000, reason: 'idle' });
      assert.ok(Date.now() - t0 > 5000, `after ${Date.now() - t0} ms`);
    });

    console.log('\nBroken frames');
    await test('a binary frame ends the connection (1003)', async () => {
      const p = await welcomed(game, freshRoom());
      p.raw(frame(2, 'bytes'));
      assert.equal((await p.closed).code, 1003);
    });
    await test('an unmasked frame ends the connection (1002)', async () => {
      const p = await welcomed(game, freshRoom());
      p.raw(frame(1, '{}', { mask: false }));
      assert.equal((await p.closed).code, 1002);
    });
    await test('a frame over 64 KB ends the connection (1009)', async () => {
      const p = await welcomed(game, freshRoom());
      p.raw(frame(1, 'x'.repeat(70000)));
      assert.equal((await p.closed).code, 1009);
    });
    await test('text that is not UTF-8 ends the connection (1007)', async () => {
      const p = await welcomed(game, freshRoom());
      p.raw(frame(1, Buffer.from([0x22, 0xff, 0xfe, 0x22])));
      assert.equal((await p.closed).code, 1007);
    });

    console.log('\nThe game\'s page');
    await test('the play page may connect to the site\'s WebSocket address', async () => {
      const res = await fetch(`${base}/play/${game}`);
      assert.match(res.headers.get('content-security-policy'), new RegExp(`connect-src 'self' ${base.replace(/^http/, 'ws').replace(/\./g, '\\.')}`));
    });
  } finally {
    for (const c of open) c.drop();
    site.stop();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
