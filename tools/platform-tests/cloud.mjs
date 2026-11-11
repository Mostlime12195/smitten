// Tests the games site's cloud saves (platform/src/cloud.js): the API that
// the play page uses for smitten.cloud, its limits, the account page's
// list, what deleting removes, and the database migration (on a database
// made by the schema before it, and with migrations merged in either order).
//
//   node tools/platform-tests/cloud.mjs
//
// It starts the server on CLOUD_PORT (8785) with an empty temporary data
// folder and small limits, and stops it at the end. cloud-e2e.mjs tests
// the same with the engine, the game's page and a browser.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { account, publish, startSite } from './rooms.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LIMITS = { CLOUD_VALUE_BYTES: '2048', CLOUD_GAME_BYTES: '4096', CLOUD_KEYS_PER_GAME: '3', CLOUD_WRITE_LIMIT_PER_HOUR: '25', CLOUD_READ_LIMIT_PER_HOUR: '30' };

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

/** A request as the site's pages send it: {status, data}. */
async function req(base, method, path, { session, token, body, origin = base, raw } = {}) {
  const headers = {};
  if (session) headers.Cookie = `smitten_session=${encodeURIComponent(session)}`;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}

const tinyGame = (name) => ({
  'smitten.json': JSON.stringify({ format: 'smitten.project', version: 3, name, main: 'main.scene' }),
  'main.scene': JSON.stringify({ format: 'smitten.scene', version: 3, root: { name: 'Main', type: 'Group' } }),
});

const migrationFiles = () => readdirSync(join(ROOT, 'platform/migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

/** A database as the site made it before cloud saves: migrations 1 to 5 and user_version 5, with some rows. */
function oldDatabase(file) {
  const old = new DatabaseSync(file);
  for (const f of ['0001_schema.sql', '0002_address_bans.sql', '0003_hackatime.sql', '0004_email.sql', '0005_boards.sql']) {
    old.exec(readFileSync(join(ROOT, 'platform/migrations', f), 'utf8'));
  }
  old.exec('PRAGMA user_version = 5');
  const now = Date.now();
  old.prepare("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES (7, 'oldtimer', 'Old Timer', ?, ?)").run(now, now);
  old.prepare("INSERT INTO games (id, owner_id, title, plays, created_at, updated_at) VALUES ('0ddba11000', 7, 'Old game', 41, ?, ?)").run(now, now);
  old.prepare("INSERT INTO boards (game_id, key, title, created_at, updated_at) VALUES ('0ddba11000', 'best', 'Best', ?, ?)").run(now, now);
  old.prepare("INSERT INTO scores (board_id, player, user_id, value, created_at) VALUES (1, 'u:7', 7, 99, ?)").run(now);
  old.close();
}

async function main() {
  const port = Number(process.env.CLOUD_PORT || 8785);
  const site = await startSite(port, { SIGNUP_LIMIT_PER_HOUR: '100', ...LIMITS });
  const { base } = site;
  const db = () => new DatabaseSync(join(site.dataDir, 'smitten.db'));
  try {
    const ada = await account(base, 'Ada');
    const bo = await account(base, 'Bo');
    const gameA = await publish(base, ada.token, tinyGame('Cloud A'), 'Cloud A');
    const gameB = await publish(base, ada.token, tinyGame('Cloud B'), 'Cloud B');
    const saves = (game, key = '') => `/api/games/${game}/saves${key ? `/${key}` : ''}`;

    console.log('\nSigned out, and from other places');
    await test('a guest gets 401 for every call (the game gets "signed-out")', async () => {
      for (const [method, path, body] of [['GET', saves(gameA)], ['GET', saves(gameA, 'slot1')], ['PUT', saves(gameA, 'slot1'), { data: '1' }], ['DELETE', saves(gameA, 'slot1')]]) {
        const r = await req(base, method, path, { body });
        assert.equal(r.status, 401, `${method} ${path}`);
        assert.equal(r.data.code, 'sign-in');
      }
      assert.equal((await req(base, 'GET', '/api/account/saves')).status, 401);
    });
    await test('only the site\'s own pages: another Origin or an editor token is refused', async () => {
      assert.equal((await req(base, 'PUT', saves(gameA, 'slot1'), { session: ada.session, body: { data: '1' }, origin: 'https://evil.example' })).status, 403);
      assert.equal((await req(base, 'GET', saves(gameA), { session: ada.session, origin: 'https://evil.example' })).status, 403);
      assert.equal((await req(base, 'GET', saves(gameA), { token: ada.token, origin: null })).status, 403);
    });

    console.log('\nSaving and loading');
    await test('save, load, list and remove', async () => {
      const data = JSON.stringify({ level: 3, name: 'Ada', items: [1, 2, 'é'] });
      const put = await req(base, 'PUT', saves(gameA, 'slot1'), { session: ada.session, body: { data } });
      assert.equal(put.status, 200, JSON.stringify(put.data));
      assert.equal(put.data.key, 'slot1');
      assert.equal(put.data.size, Buffer.byteLength(data));
      assert.ok(Math.abs(put.data.at - Date.now()) < 10000);
      const got = await req(base, 'GET', saves(gameA, 'slot1'), { session: ada.session });
      assert.equal(got.status, 200);
      assert.equal(got.data.data, data, 'the same text comes back');
      const list = await req(base, 'GET', saves(gameA), { session: ada.session });
      assert.deepEqual(list.data.saves.map((s) => [s.key, s.size]), [['slot1', Buffer.byteLength(data)]]);
      assert.deepEqual(list.data.limits, { valueBytes: 2048, gameBytes: 4096, keys: 3 });
      assert.deepEqual(list.data.used, { keys: 1, bytes: Buffer.byteLength(data) });
      const del = await req(base, 'DELETE', saves(gameA, 'slot1'), { session: ada.session });
      assert.deepEqual(del.data, { deleted: true });
      assert.deepEqual((await req(base, 'DELETE', saves(gameA, 'slot1'), { session: ada.session })).data, { deleted: false });
      const gone = await req(base, 'GET', saves(gameA, 'slot1'), { session: ada.session });
      assert.equal(gone.status, 404);
      assert.equal(gone.data.code, 'missing');
    });
    await test('saving again replaces the value', async () => {
      await req(base, 'PUT', saves(gameA, 'slot1'), { session: ada.session, body: { data: '"one"' } });
      await req(base, 'PUT', saves(gameA, 'slot1'), { session: ada.session, body: { data: '"two"' } });
      assert.equal((await req(base, 'GET', saves(gameA, 'slot1'), { session: ada.session })).data.data, '"two"');
      assert.equal((await req(base, 'GET', saves(gameA), { session: ada.session })).data.saves.length, 1);
    });
    await test('saves belong to one account and one game', async () => {
      assert.equal((await req(base, 'GET', saves(gameA, 'slot1'), { session: bo.session })).status, 404);
      assert.deepEqual((await req(base, 'GET', saves(gameA), { session: bo.session })).data.saves, []);
      assert.equal((await req(base, 'GET', saves(gameB, 'slot1'), { session: ada.session })).status, 404);
      await req(base, 'PUT', saves(gameA, 'slot1'), { session: bo.session, body: { data: '"bo"' } });
      assert.equal((await req(base, 'GET', saves(gameA, 'slot1'), { session: ada.session })).data.data, '"two"');
      assert.equal((await req(base, 'GET', saves(gameA, 'slot1'), { session: bo.session })).data.data, '"bo"');
    });
    await test('keys and data that are wrong are refused', async () => {
      for (const key of ['.hidden', '..', 'a b', 'x'.repeat(65), '%2e%2e']) {
        assert.equal((await req(base, 'GET', saves(gameA, key), { session: ada.session })).status, 404, key);
      }
      assert.equal((await req(base, 'GET', saves(gameA, 'A.b_c-1'), { session: ada.session })).data.code, 'missing');
      const notText = await req(base, 'PUT', saves(gameA, 'slot2'), { session: ada.session, body: { data: { level: 1 } } });
      assert.equal(notText.status, 422);
      assert.equal(notText.data.code, 'bad-value');
      const notJson = await req(base, 'PUT', saves(gameA, 'slot2'), { session: ada.session, body: { data: '{level' } });
      assert.equal(notJson.data.code, 'bad-value');
      assert.equal((await req(base, 'PUT', saves('0000000000', 'slot1'), { session: ada.session, body: { data: '1' } })).status, 404);
    });

    console.log('\nLimits');
    await test('a value over the limit is too-big', async () => {
      const r = await req(base, 'PUT', saves(gameB, 'big'), { session: ada.session, body: { data: JSON.stringify('x'.repeat(2047)) } });
      assert.equal(r.status, 413);
      assert.equal(r.data.code, 'too-big');
      const ok = await req(base, 'PUT', saves(gameB, 'big'), { session: ada.session, body: { data: JSON.stringify('x'.repeat(2046)) } });
      assert.equal(ok.status, 200, 'exactly the limit is good');
      assert.equal(ok.data.size, 2048);
    });
    await test('too many keys, or too many bytes for one game, is quota', async () => {
      await req(base, 'PUT', saves(gameB, 'b'), { session: ada.session, body: { data: JSON.stringify('y'.repeat(2046)) } });
      const third = await req(base, 'PUT', saves(gameB, 'c'), { session: ada.session, body: { data: '1' } });
      assert.equal(third.status, 409, 'bytes: 2048 + 2048 + 1 > 4096');
      assert.equal(third.data.code, 'quota');
      // Replacing a value counts the new size instead of the old one.
      assert.equal((await req(base, 'PUT', saves(gameB, 'b'), { session: ada.session, body: { data: JSON.stringify('y'.repeat(1)) } })).status, 200);
      assert.equal((await req(base, 'PUT', saves(gameB, 'c'), { session: ada.session, body: { data: '1' } })).status, 200);
      const fourth = await req(base, 'PUT', saves(gameB, 'd'), { session: ada.session, body: { data: '1' } });
      assert.equal(fourth.status, 409, 'keys: 3 at most');
      assert.equal(fourth.data.code, 'quota');
      assert.equal((await req(base, 'PUT', saves(gameB, 'c'), { session: ada.session, body: { data: '2' } })).status, 200, 'an old key is still good');
    });
    await test('writes and reads have limits per hour per account', async () => {
      const cy = await account(base, 'Cy');
      for (let i = 0; i < 25; i++) assert.equal((await req(base, 'PUT', saves(gameA, 'slot1'), { session: cy.session, body: { data: String(i) } })).status, 200, `write ${i}`);
      const r = await req(base, 'PUT', saves(gameA, 'slot1'), { session: cy.session, body: { data: '26' } });
      assert.equal(r.status, 429);
      assert.equal((await req(base, 'DELETE', saves(gameA, 'slot1'), { session: cy.session })).status, 429, 'remove counts as a write');
      assert.equal((await req(base, 'GET', saves(gameA, 'slot1'), { session: cy.session })).status, 200, 'reads have their own limit');
      for (let i = 1; i < 30; i++) await req(base, 'GET', saves(gameA), { session: cy.session });
      assert.equal((await req(base, 'GET', saves(gameA, 'slot1'), { session: cy.session })).status, 429);
      // Other accounts are not slowed down.
      assert.equal((await req(base, 'PUT', saves(gameA, 'slot3'), { session: bo.session, body: { data: '1' } })).status, 200);
    });

    console.log('\nThe account page, and deleting');
    await test('the account page lists the games with saves, and deletes one game\'s saves', async () => {
      const list = await req(base, 'GET', '/api/account/saves', { session: ada.session });
      assert.equal(list.status, 200);
      const byId = Object.fromEntries(list.data.games.map((g) => [g.id, g]));
      assert.equal(byId[gameA].title, 'Cloud A');
      assert.equal(byId[gameA].keys, 1);
      assert.equal(byId[gameB].keys, 3);
      assert.equal(byId[gameB].size, 2048 + 3 + 1);
      assert.equal((await req(base, 'DELETE', `/api/account/saves/${gameB}`, { session: ada.session })).data.deleted, 3);
      assert.deepEqual((await req(base, 'GET', '/api/account/saves', { session: ada.session })).data.games.map((g) => g.id), [gameA]);
      // Bo's saves are still there.
      assert.equal((await req(base, 'GET', '/api/account/saves', { session: bo.session })).data.games.length, 1);
      const page = await fetch(`${base}/account`).then((r) => r.text());
      assert.match(page, /id="saves"/);
    });
    await test('deleting a game deletes every account\'s saves for it', async () => {
      const gameC = await publish(base, ada.token, tinyGame('Cloud C'), 'Cloud C');
      await req(base, 'PUT', saves(gameC, 'slot1'), { session: ada.session, body: { data: '1' } });
      await req(base, 'PUT', saves(gameC, 'slot1'), { session: bo.session, body: { data: '1' } });
      const count = () => { const d = db(); const n = d.prepare('SELECT COUNT(*) AS n FROM cloud_saves WHERE game_id = ?').get(gameC).n; d.close(); return n; };
      assert.equal(count(), 2);
      assert.equal((await req(base, 'DELETE', `/api/games/${gameC}`, { token: ada.token, origin: null })).status, 200);
      assert.equal(count(), 0);
    });
    await test('deleting an account deletes its saves', async () => {
      const dee = await account(base, 'Dee');
      await req(base, 'PUT', saves(gameA, 'slot1'), { session: dee.session, body: { data: '1' } });
      const d = db();
      const user = d.prepare("SELECT user_id FROM cloud_saves WHERE data = '1' AND game_id = ? ORDER BY updated_at DESC LIMIT 1").get(gameA).user_id;
      d.close();
      const del = await req(base, 'DELETE', '/api/account', { session: dee.session, body: { password: 'correct horse battery' } });
      assert.equal(del.status, 200, JSON.stringify(del.data));
      const after = db();
      assert.equal(after.prepare('SELECT COUNT(*) AS n FROM cloud_saves WHERE user_id = ?').get(user).n, 0);
      after.close();
    });
  } finally {
    site.stop();
  }

  console.log('\nThe docs');
  await test('the host page in docs/host-interface.md is docs/host-example.html', () => {
    const doc = readFileSync(join(ROOT, 'docs/host-interface.md'), 'utf8');
    const block = /```html\n([\s\S]*?)```/.exec(doc.slice(doc.indexOf('## A host page to copy')));
    assert.ok(block, 'no html block');
    assert.equal(block[1], readFileSync(join(ROOT, 'docs/host-example.html'), 'utf8'));
  });

  console.log('\nThe migration');
  await test('a database from before cloud saves gets them on start, and keeps what it has', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smitten-cloud-old-'));
    oldDatabase(join(dir, 'smitten.db'));
    let child;
    try {
      const p = port + 1;
      const env = { PATH: process.env.PATH, ENV_FILE: join(dir, 'no.env'), PORT: String(p), HOST: '127.0.0.1', PUBLIC_URL: `http://127.0.0.1:${p}`, DATA_DIR: dir, SCRYPT_LOG_N: '10' };
      child = spawn(process.execPath, [join(ROOT, 'platform/src/server.js')], { env, stdio: ['ignore', 'ignore', 'inherit'] });
      for (let i = 0; ; i++) {
        try { await fetch(`http://127.0.0.1:${p}/api/config`); break; } catch { if (i > 100) throw new Error('no server'); await new Promise((r) => setTimeout(r, 100)); }
      }
      const g = await fetch(`http://127.0.0.1:${p}/api/games/0ddba11000`).then((r) => r.json());
      assert.equal(g.game.title, 'Old game');
      assert.equal(g.game.plays, 41);
      assert.equal(g.game.boards[0].key, 'best');
      child.kill();
      await new Promise((r) => child.once('exit', r));
      child = null;
      const d = new DatabaseSync(join(dir, 'smitten.db'));
      assert.deepEqual(d.prepare('SELECT name FROM migrations ORDER BY name').all().map((r) => r.name), migrationFiles());
      assert.equal(d.prepare('PRAGMA user_version').get().user_version, Math.max(...migrationFiles().map((f) => Number.parseInt(f, 10))));
      assert.equal(d.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 1);
      d.exec('PRAGMA foreign_keys = ON');
      const now = Date.now();
      d.prepare("INSERT INTO cloud_saves (user_id, game_id, key, data, size, created_at, updated_at) VALUES (7, '0ddba11000', 'slot1', '1', 1, ?, ?)").run(now, now);
      assert.throws(() => d.prepare("INSERT INTO cloud_saves (user_id, game_id, key, data, size, created_at, updated_at) VALUES (8, '0ddba11000', 'slot1', '1', 1, ?, ?)").run(now, now), /FOREIGN KEY/);
      d.prepare("DELETE FROM games WHERE id = '0ddba11000'").run();
      assert.equal(d.prepare('SELECT COUNT(*) AS n FROM cloud_saves').get().n, 0);
      d.close();
    } finally {
      child?.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('migrations that land in either order each run once', async () => {
    // A copy of the server's code and migrations, with one more migration
    // numbered before 0007 that comes later (another branch merged after).
    const dir = mkdtempSync(join(tmpdir(), 'smitten-cloud-order-'));
    try {
      cpSync(join(ROOT, 'platform/src'), join(dir, 'src'), { recursive: true });
      cpSync(join(ROOT, 'platform/migrations'), join(dir, 'migrations'), { recursive: true });
      cpSync(join(ROOT, 'platform/package.json'), join(dir, 'package.json'));
      const { openDb } = await import(pathToFileURL(join(dir, 'src/db.js')).href);
      const tables = (file) => { const d = new DatabaseSync(file); const t = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name); d.close(); return t; };

      // 1. This branch first: 0007 is applied, then 0006 arrives.
      const first = join(dir, 'first.db');
      oldDatabase(first);
      openDb(first).close();
      writeFileSync(join(dir, 'migrations/0006_other.sql'), 'CREATE TABLE other_feature (id INTEGER PRIMARY KEY);');
      openDb(first).close();
      assert.ok(tables(first).includes('other_feature'), '0006 ran after 0007');
      assert.ok(tables(first).includes('cloud_saves'));
      openDb(first).close();  // and nothing runs twice (CREATE TABLE would fail)

      // 2. The other branch first, with the runner before this one: user_version 6, no migrations table.
      const second = join(dir, 'second.db');
      oldDatabase(second);
      const d = new DatabaseSync(second);
      d.exec('CREATE TABLE other_feature (id INTEGER PRIMARY KEY); PRAGMA user_version = 6');
      d.close();
      openDb(second).close();
      assert.ok(tables(second).includes('cloud_saves'), '0007 ran');
      const after = new DatabaseSync(second);
      assert.equal(after.prepare('PRAGMA user_version').get().user_version, Math.max(...migrationFiles().map((f) => Number.parseInt(f, 10))));
      assert.equal(after.prepare("SELECT COUNT(*) AS n FROM migrations WHERE name = '0006_other.sql'").get().n, 1);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
