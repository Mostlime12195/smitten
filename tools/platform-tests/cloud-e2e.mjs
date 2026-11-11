// Cloud saves from end to end: a real engine build, the real site and a
// headless Chromium that plays a game whose script uses smitten.cloud.
//
//   node tools/platform-tests/cloud-e2e.mjs [dist]
//
// dist is a build of Smitten (python3 build.py, or CI's "dist" artifact);
// ../../dist by default. The script copies the player from it into
// platform/public/player (that folder isn't in git), starts the site on
// CLOUD_E2E_PORT (8793) with an empty data folder, publishes the game, and
// plays it:
//
//   1. as a guest: the host is the games site, and every cloud call
//      answers "signed-out",
//   2. signed in: the game loads (nothing yet), saves, and loads its save,
//   3. signed in again, after a reload: the save is still there,
//   4. the account's list of cloud saves has the game.
//
// It prints what it saw and exits 1 if anything is off. CHROME and
// CHROME_FLAGS are as in tools/stress/run.mjs.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../stress/run.mjs';
import { account, publish, startSite } from './rooms.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.argv[2] || join(ROOT, 'dist'));
const PORT = Number(process.env.CLOUD_E2E_PORT || 8793);

const SCRIPT = `
local cloud = smitten.cloud

local function show(v, why)
  if type(v) == "table" then return "n=" .. tostring(v.n) end
  return tostring(v) .. " " .. tostring(why)
end

function ready()
  print("E2E host " .. tostring(smitten.host.name()) .. " cloud=" .. tostring(cloud.available()) .. " user=" .. tostring(smitten.host.user()))
  local before, why = cloud.load("slot1")
  print("E2E before " .. show(before, why))
  local ok, why2 = cloud.save("slot1", { n = (before and before.n or 0) + 1, at = os.time() })
  print("E2E save " .. show(ok, why2))
  local after, why3 = cloud.load("slot1")
  print("E2E after " .. show(after, why3))
  local list, why4 = cloud.list()
  print("E2E list " .. (list and (#list .. " " .. (list[1] and list[1].key or "")) or tostring(why4)))
  print("E2E done")
end
`;

const gameFiles = () => ({
  'smitten.json': JSON.stringify({ format: 'smitten.project', version: 3, name: 'Cloud e2e', main: 'main.scene' }),
  'main.scene': JSON.stringify({ format: 'smitten.scene', version: 3, root: { name: 'Main', type: 'Group', script: 'main.lua' } }),
  'main.lua': SCRIPT,
});

/** Collects what the game prints (lines starting "E2E ", errors). */
function collect(page) {
  const lines = [];
  page.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      for (const l of m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').split('\n')) {
        if (l.startsWith('E2E ') || /^Error: /.test(l)) lines.push(l);
      }
    } else if (m.method === 'Runtime.exceptionThrown') {
      lines.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    }
  });
  return lines;
}

/** Opens the game's page, presses Play, and gives back the lines of one run. */
async function play(page, lines, base, id) {
  lines.length = 0;
  await page.goto(`${base}/play/${id}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && !(await page.eval('Boolean(document.querySelector(".start-card"))').catch(() => false))) await sleep(200);
  await page.eval('document.querySelector(".start-card").click()');
  while (Date.now() - t0 < 40000 && !lines.includes('E2E done')) {
    const bad = lines.find((l) => /^(Error: |exception: )/.test(l));
    if (bad) throw new Error(bad);
    await sleep(100);
  }
  if (!lines.includes('E2E done')) throw new Error(`the game did not finish; it printed:\n  ${lines.join('\n  ')}`);
  return [...lines];
}

async function main() {
  console.log(execFileSync('sh', [join(ROOT, 'platform/scripts/copy-player.sh'), dist], { encoding: 'utf8' }).trim());
  const site = await startSite(PORT);
  const { base } = site;
  let browser = null;
  let failed = false;
  try {
    const { token, session } = await account(base, 'Ee Two');
    const id = await publish(base, token, gameFiles(), 'Cloud e2e');
    console.log(`Published ${base}/play/${id}`);
    browser = await launch();
    const lines = collect(browser);

    console.log('\n1. A guest');
    let seen = await play(browser, lines, base, id);
    console.log(`   ${seen.join(' | ')}`);
    assert.deepEqual(seen, [
      'E2E host smitten-games cloud=true user=nil',
      'E2E before nil signed-out',
      'E2E save nil signed-out',
      'E2E after nil signed-out',
      'E2E list signed-out',
      'E2E done',
    ]);

    console.log('\n2. Signed in: load, save, load');
    await browser.send('Network.setCookie', { name: 'smitten_session', value: encodeURIComponent(session), url: base, httpOnly: true, sameSite: 'Lax' });
    seen = await play(browser, lines, base, id);
    console.log(`   ${seen.join(' | ')}`);
    assert.deepEqual(seen, [
      'E2E host smitten-games cloud=true user=Ee Two',
      'E2E before nil missing',
      'E2E save true nil',
      'E2E after n=1',
      'E2E list 1 slot1',
      'E2E done',
    ]);

    console.log('\n3. Signed in, after a reload: the save is there');
    seen = await play(browser, lines, base, id);
    console.log(`   ${seen.join(' | ')}`);
    assert.equal(seen[1], 'E2E before n=1');
    assert.equal(seen[3], 'E2E after n=2');

    console.log('\n4. The account page lists the game');
    const res = await fetch(`${base}/api/account/saves`, { headers: { Cookie: `smitten_session=${encodeURIComponent(session)}`, Origin: base } });
    const { games } = await res.json();
    assert.equal(games.length, 1);
    assert.equal(games[0].id, id);
    assert.equal(games[0].keys, 1);
    console.log(`   ${games[0].title}: ${games[0].keys} save, ${games[0].size} bytes`);
    console.log('\nCloud saves work end to end.');
  } catch (e) {
    failed = true;
    console.error(`\nFAILED: ${e?.stack || e}`);
  } finally {
    browser?.close();
    site.stop();
  }
  process.exit(failed ? 1 : 0);
}

main();
