// Online rooms from end to end: a real engine build, the real site and two
// pages of one headless Chromium that play the same game in the same room.
//
//   node tools/platform-tests/rooms-e2e.mjs [dist]
//
// dist is a build of Smitten (python3 build.py, or CI's "dist" artifact);
// ../../dist by default. The script copies the player from it into
// platform/public/player (that folder isn't in git), starts the site on
// E2E_PORT (8790) with an empty data folder, publishes a game whose script
// uses smitten.net, and opens its page twice. Then:
//
//   1. both join the room "e2e"; each gets peerJoined for the other and
//      sends it a message (send), and answers one with a broadcast,
//   2. the second page goes away: the first gets peerLeft and is the host,
//   3. the site stops: the first gets disconnected("lost").
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
const PORT = Number(process.env.E2E_PORT || 8790);

const SCRIPT = `
local net = smitten.net

function ready()
  print("E2E available " .. tostring(net.available()))
  local me, why = net.join("e2e", { maxPlayers = 2 })
  if not me then
    print("E2E join failed " .. tostring(why))
    return
  end
  print("E2E joined " .. me.name .. " host=" .. tostring(net.isHost()) .. " peers=" .. #net.peers())
end

function peerJoined(peer)
  print("E2E peerJoined " .. peer.name)
  net.send(peer, { hello = net.me().name, list = { 1, 2, 3 } })
end

function message(from, data)
  if data.hello then
    print("E2E hello from " .. from.name .. " " .. data.hello .. " " .. #data.list)
    net.broadcast({ thanks = net.me().name })
  elseif data.thanks then
    print("E2E thanks from " .. from.name)
  end
end

function peerLeft(peer)
  print("E2E peerLeft " .. peer.name .. " host=" .. tostring(net.isHost()) .. " peers=" .. #net.peers())
end

function disconnected(reason)
  print("E2E disconnected " .. reason .. " room=" .. tostring(net.room()))
end
`;

const gameFiles = () => ({
  'smitten.json': JSON.stringify({ format: 'smitten.project', version: 3, name: 'Rooms e2e', main: 'main.scene' }),
  'main.scene': JSON.stringify({ format: 'smitten.scene', version: 3, root: { name: 'Main', type: 'Group', script: 'main.lua' } }),
  'main.lua': SCRIPT,
});

/** A tab that collects what the game prints (lines starting "E2E ", errors). */
async function tab(page) {
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
  return {
    page,
    lines,
    async until(line, ms = 30000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (lines.includes(line)) return;
        const bad = lines.find((l) => /^(Error: |exception: )/.test(l));
        if (bad) throw new Error(bad);
        await sleep(100);
      }
      throw new Error(`no "${line}" in ${ms} ms; it printed:\n  ${lines.join('\n  ')}`);
    },
  };
}

async function play(t, base, id) {
  await t.page.goto(`${base}/play/${id}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && !(await t.page.eval('Boolean(document.querySelector(".start-card"))').catch(() => false))) await sleep(200);
  await t.page.eval('document.querySelector(".start-card").click()');
}

async function main() {
  console.log(execFileSync('sh', [join(ROOT, 'platform/scripts/copy-player.sh'), dist], { encoding: 'utf8' }).trim());
  let site = await startSite(PORT);
  const base = site.base;
  let browser = null;
  let failed = false;
  try {
    const { token, session } = await account(base);
    const id = await publish(base, token, gameFiles(), 'Rooms e2e');
    console.log(`Published ${base}/play/${id}`);

    browser = await launch();
    const one = await tab(browser);
    const two = await tab(await browser.newPage());

    console.log('\n1. Two pages join one room and send messages both ways');
    await play(one, base, id);
    await one.until('E2E joined Guest 1 host=true peers=1');
    // The second page is signed in: its peer has the account's name.
    await two.page.send('Network.setCookie', { name: 'smitten_session', value: encodeURIComponent(session), url: base, httpOnly: true, sameSite: 'Lax' });
    await play(two, base, id);
    await two.until('E2E joined Ee Two host=false peers=2');
    await one.until('E2E peerJoined Ee Two');
    await two.until('E2E peerJoined Guest 1');
    await one.until('E2E hello from Ee Two Ee Two 3');
    await two.until('E2E hello from Guest 1 Guest 1 3');
    await one.until('E2E thanks from Ee Two');
    await two.until('E2E thanks from Guest 1');
    assert.ok(one.lines.includes('E2E available true'));
    console.log(`   one: ${one.lines.join(' | ')}\n   two: ${two.lines.join(' | ')}`);

    console.log('\n2. The second page goes away');
    await two.page.goto('about:blank');
    // At once, not after the 10 seconds that a dropped connection keeps its place.
    await one.until('E2E peerLeft Ee Two host=true peers=1', 6000);
    console.log(`   one: ${one.lines.at(-1)}`);

    console.log('\n3. The site stops');
    site.stop();
    site = null;
    await one.until('E2E disconnected lost room=nil', 20000);
    console.log(`   one: ${one.lines.at(-1)}`);

    const errors = [...one.lines, ...two.lines].filter((l) => /^(Error: |exception: )/.test(l));
    assert.deepEqual(errors, []);
    console.log('\nOnline rooms work end to end.');
  } catch (e) {
    failed = true;
    console.error(`\nFAILED: ${e?.stack || e}`);
  } finally {
    browser?.close();
    site?.stop();
  }
  process.exit(failed ? 1 : 0);
}

main();
