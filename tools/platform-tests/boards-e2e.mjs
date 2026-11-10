// Leaderboards from end to end, by hand: a real engine build, the real site
// and a real browser. Not part of CI (it needs a build and Chromium).
//
//   node --experimental-websocket tools/platform-tests/boards-e2e.mjs [dist]
//
// dist is a build of Smitten (python3 build.py, or CI's "dist" artifact);
// ../../dist by default. The script:
//
//   1. copies the player from it into platform/public/player
//      (platform/scripts/copy-player.sh; that folder isn't in git),
//   2. starts the site on E2E_PORT (8785) with an empty temporary data folder,
//   3. signs up, publishes a small game whose script sends a score and
//      prints the board, and gives the game a board called "best",
//   4. opens the game's page in headless Chromium, presses Play, and waits
//      for the game to print what it got back,
//   5. checks the score through the API and in the list under the game,
//   6. does it again signed in, and checks the score is the account's.
//
// It prints what it saw and exits 1 if anything is off. CHROME and
// CHROME_FLAGS are as in tools/stress/run.mjs.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../stress/run.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.argv[2] || join(ROOT, 'dist'));
const PORT = Number(process.env.E2E_PORT || 8785);
const BASE = `http://127.0.0.1:${PORT}`;
const EDITOR_ORIGIN = 'http://localhost:8766';

// The game: a root Group whose script uses smitten.boards.
const SCRIPT = `
function ready()
  print("E2E available " .. tostring(smitten.boards.available()))
  local result, why = smitten.boards.submit("best", SCORE, { name = "Eetoo" })
  if result then
    print("E2E submit rank=" .. tostring(result.rank) .. " value=" .. tostring(result.value) .. " improved=" .. tostring(result.improved))
  else
    print("E2E submit failed: " .. tostring(why))
  end
  local rows, reason = smitten.boards.top("best", 5)
  if rows then
    for _, row in ipairs(rows) do
      print("E2E row " .. row.rank .. " " .. row.name .. " " .. row.value .. (row.me and " me" or "") .. (row.guest and " guest" or ""))
    end
  else
    print("E2E top failed: " .. tostring(reason))
  end
  local _, missing = smitten.boards.top("nope")
  print("E2E unknown board: " .. tostring(missing))
  smitten.boards.list(function(list, w)
    print("E2E list " .. (list and (#list .. " " .. list[1].key .. " " .. list[1].title) or tostring(w)))
    print("E2E done")
  end)
end
`;

const gameFiles = (score) => ({
  'smitten.json': JSON.stringify({ format: 'smitten.project', version: 2, name: 'Boards e2e', main: 'main.scene' }),
  'main.scene': JSON.stringify({ format: 'smitten.scene', version: 2, root: { name: 'Main', type: 'Group', script: 'main.lua' } }),
  'main.lua': SCRIPT.replace('SCORE', String(score)),
});

// A stored (uncompressed) zip.
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
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

async function call(method, path, { body, token, session, origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (session) headers.Cookie = `smitten_session=${encodeURIComponent(session)}`;
  if (origin || session) headers.Origin = origin || BASE;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  const cookie = res.headers.getSetCookie().map((c) => /^smitten_session=([^;]+)/.exec(c)?.[1]).find(Boolean);
  return { data, session: cookie ? decodeURIComponent(cookie) : null };
}

async function publish(token, files, id = null) {
  const form = new FormData();
  form.append('meta', JSON.stringify({ title: 'Boards e2e', description: 'Sends a score and reads the board.' }));
  form.append('game', new Blob([zip(files)], { type: 'application/zip' }), 'game.zip');
  return (await call(id ? 'PUT' : 'POST', id ? `/api/games/${id}` : '/api/games', { body: form, token })).data;
}

/** Opens the game's page, presses Play and returns what the game printed (lines starting "E2E "). */
async function play(page, lines, id) {
  lines.length = 0;
  await page.goto(`${BASE}/play/${id}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && !(await page.eval('Boolean(document.querySelector(".start-card"))').catch(() => false))) await sleep(200);
  await page.eval('document.querySelector(".start-card").click()');
  while (Date.now() - t0 < 90000 && !lines.some((l) => l === 'E2E done' || /^Error: /.test(l))) await sleep(200);
  await sleep(800);
  return lines.filter((l) => l.startsWith('E2E ') || /^Error: |^exception: /.test(l));
}

const boardText = (page) => page.eval('document.querySelector("#boards").hidden ? "(hidden)" : [...document.querySelectorAll("#scores .score")].map((li) => li.textContent.replace(/Remove$/, "")).join(" | ")');

async function main() {
  console.log(execFileSync('sh', [join(ROOT, 'platform/scripts/copy-player.sh'), dist], { encoding: 'utf8' }).trim());
  const dataDir = mkdtempSync(join(tmpdir(), 'smitten-boards-e2e-'));
  const server = spawn(process.execPath, [join(ROOT, 'platform/src/server.js')], {
    env: { PATH: process.env.PATH, ENV_FILE: join(dataDir, 'no.env'), PORT: String(PORT), HOST: '127.0.0.1', PUBLIC_URL: BASE, DATA_DIR: dataDir, SCRYPT_LOG_N: '10' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let page = null;
  let failed = false;
  try {
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${BASE}/api/config`); break; } catch { await sleep(100); }
    }

    // An account, its editor token, a game, and a board on it.
    const signup = await call('POST', '/api/auth/signup', { body: { username: `e2e${randomBytes(3).toString('hex')}`, password: 'correct horse battery', displayName: 'Ee Two' }, origin: BASE });
    const session = signup.session;
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const { code } = (await call('POST', '/api/auth/editor/code', { body: { origin: EDITOR_ORIGIN, challenge }, session })).data;
    const { token } = (await call('POST', '/api/auth/editor/token', { body: { code, verifier }, origin: EDITOR_ORIGIN })).data;
    const { id } = await publish(token, gameFiles(1234));
    console.log(`Published ${BASE}/play/${id}`);

    page = await launch();
    const lines = [];
    page.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled') {
        for (const l of m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').split('\n')) lines.push(l);
      } else if (m.method === 'Runtime.exceptionThrown') {
        lines.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
      }
    });

    console.log('\n1. Before the game has a board: the game works, without leaderboards');
    let out = await play(page, lines, id);
    console.log(out.map((l) => `   ${l}`).join('\n'));
    assert.ok(out.includes('E2E available false'), 'available() should be false');
    assert.ok(out.includes('E2E submit failed: unavailable'));
    assert.ok(out.includes('E2E list unavailable'));
    assert.equal(await boardText(page), '(hidden)');

    await call('POST', `/api/games/${id}/boards`, { body: { key: 'best', title: 'Best scores', unit: 'points' }, token });

    console.log('\n2. As a guest: the score goes up under the name the game gave');
    out = await play(page, lines, id);
    console.log(out.map((l) => `   ${l}`).join('\n'));
    assert.ok(out.includes('E2E available true'), 'available() should be true');
    assert.ok(out.includes('E2E submit rank=1 value=1234 improved=true'));
    assert.ok(out.includes('E2E row 1 Eetoo 1234 me guest'));
    assert.ok(out.includes('E2E unknown board: no-board'));
    assert.ok(out.includes('E2E list 1 best Best scores'));
    let board = (await call('GET', `/api/games/${id}/boards/best`)).data;
    console.log(`   API: ${JSON.stringify(board.scores.map((s) => [s.rank, s.name, s.value, s.guest ? 'guest' : s.username]))}`);
    assert.deepEqual(board.scores.map((s) => [s.rank, s.name, s.value, s.guest]), [[1, 'Eetoo', 1234, true]]);
    let shown = await boardText(page);
    console.log(`   Page: ${shown}`);
    assert.match(shown, /1\.\s*Eetoo\s*1,234 points/);

    console.log('\n3. Signed in: the score is the account\'s, and the owner gets Remove buttons');
    await publish(token, gameFiles(2000), id);
    await page.send('Network.setCookie', { name: 'smitten_session', value: encodeURIComponent(session), url: BASE, httpOnly: true, sameSite: 'Lax' });
    out = await play(page, lines, id);
    console.log(out.map((l) => `   ${l}`).join('\n'));
    assert.ok(out.includes('E2E submit rank=1 value=2000 improved=true'));
    assert.ok(out.includes('E2E row 1 Ee Two 2000 me'));
    assert.ok(out.includes('E2E row 2 Eetoo 1234 guest'));
    board = (await call('GET', `/api/games/${id}/boards/best`)).data;
    console.log(`   API: ${JSON.stringify(board.scores.map((s) => [s.rank, s.name, s.value, s.guest ? 'guest' : s.username]))}`);
    assert.deepEqual(board.scores.map((s) => [s.rank, s.name, s.value]), [[1, 'Ee Two', 2000], [2, 'Eetoo', 1234]]);
    shown = await boardText(page);
    console.log(`   Page: ${shown}`);
    assert.match(shown, /1\.\s*Ee Two\s*2,000 points \| 2\.\s*Eetoo\s*1,234 points/);
    assert.equal(await page.eval('document.querySelectorAll("#scores .score button").length'), 2);
    assert.equal(await page.eval('document.querySelectorAll("#scores .score.me").length'), 1);

    console.log('\nLeaderboards work end to end.');
  } catch (e) {
    failed = true;
    console.error(`\nFAILED: ${e?.stack || e}`);
  } finally {
    page?.close();
    server.kill();
    rmSync(dataDir, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
