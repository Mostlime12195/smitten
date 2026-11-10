// Runs the scene tests in a headless Chrome and fails if one goes wrong.
//
//   node tools/scene-tests/run.mjs              # all of them
//   node tools/scene-tests/run.mjs errors smoke
//   VERBOSE=1 node tools/scene-tests/run.mjs lights   # every line it printed
//
// Needs a built dist/ (python3 build.py). It starts tools/test_server.py
// itself; CHROME and CHROME_FLAGS are as in tools/stress/run.mjs.
//
//   errors, lights,   print PASS or FAIL for each check, then DONE
//   paths, levels,
//   players
//   smoke, rigid,     run for a few seconds: no error may happen (what they
//   physics           print is for reading; see each test's main.lua)
//   boards,           smitten.boards without the games site, and inside
//   boards-site       boards-site.html, which stands in for it (PASS, FAIL, DONE)
//   errorscreen       errors on purpose: the error must come out in plain
//                     form, without the engine's own frames

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../stress/run.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT) || 8772;
const BASE = `http://127.0.0.1:${PORT}`;

const CASES = {
  errors: { game: 'tools/scene-tests/errors.zip', until: /^DONE /, check: selfChecking },
  lights: { game: 'tools/scene-tests/lights.zip', until: /^DONE /, check: selfChecking },
  levels: { game: 'tools/scene-tests/levels.zip', until: /^DONE /, check: selfChecking },
  text: { game: 'tools/scene-tests/text.zip', until: /^DONE /, modules: '', check: selfChecking },
  smoke: { game: 'tools/scene-tests/smoke.zip', seconds: 6, check: (lines) => noErrors(lines) || (lines.some((l) => /^ready/.test(l)) ? null : 'it never printed "ready"') },
  rigid: { game: 'tools/scene-tests/rigid.zip', seconds: 5, check: noErrors },
  physics: { game: 'tools/scene-tests/physics.zip', seconds: 5, check: noErrors },
  paths: { game: 'tools/scene-tests/paths.zip', until: /^DONE /, check: selfChecking },
  // smitten.boards without the games site (the editor, an exported game),
  // and inside a page that stands in for a game's page there.
  boards: { game: 'tools/scene-tests/boards.zip', until: /^DONE /, modules: '', check: (lines) => mode(lines, 'unavailable') || selfChecking(lines) },
  'boards-site': { url: '/tools/scene-tests/boards-site.html', until: /^DONE /, check: (lines) => mode(lines, 'site') || selfChecking(lines) },
  // Players' input and the touch pieces: its own checks, then real touches
  // from the browser on the stick, a button and the game behind them.
  players: { game: 'tools/scene-tests/players.zip', until: /^DONE /, check: selfChecking, touch: true, after: realTouches },
  errorscreen: { game: 'tools/errorscreen.zip', until: /^Error: /, modules: '', check: plainError },
};

function noErrors(lines) {
  const bad = lines.find((l) => /^Error: |^exception: /.test(l));
  return bad ? `it stopped with: ${bad}` : null;
}

function mode(lines, want) {
  const line = lines.find((l) => /^MODE /.test(l));
  return line === `MODE ${want}` ? null : noErrors(lines) || `expected "MODE ${want}", got ${line ? `"${line}"` : 'nothing'}`;
}

function selfChecking(lines) {
  const failed = lines.filter((l) => /^FAIL /.test(l));
  if (failed.length) return failed.join('\n');
  const done = lines.find((l) => /^DONE /.test(l));
  if (!done) return noErrors(lines) || 'it never printed DONE';
  return /^DONE [1-9]\d* passed, 0 failed/.test(done) ? null : done;
}

// Real fingers, through the browser, on the players test once its own checks
// are done (it prints a LIVE line whenever what its controls read changes):
// a thumb on the stick, a second finger on the jump button, a third on the
// game behind them (the mouse), then a tap on the game alone.
async function realTouches(page, lines) {
  const rect = JSON.parse(await page.eval(`(() => { const r = document.querySelector('#canvas').getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`));
  const [left, top, w, h] = rect;
  // The test is 640×360, fitted into the canvas.
  const s = Math.min(w / 640, h / 360);
  const at = (x, y, id) => ({ x: Math.round(left + (w - 640 * s) / 2 + x * s), y: Math.round(top + (h - 360 * s) / 2 + y * s), id });
  const step = async (what, type, touchPoints, want) => {
    const from = lines.length;
    await page.send('Input.dispatchTouchEvent', { type, touchPoints });
    if (!want) return null;
    for (let i = 0; i < 50; i++) {
      if (lines.slice(from).some((l) => l.startsWith('LIVE') && l.includes(want))) return null;
      await sleep(100);
    }
    return `real touches: ${what}: wanted "${want}", the last was "${lines.filter((l) => l.startsWith('LIVE')).pop()}"`;
  };
  const stick = at(80, 280, 1);
  const pushed = at(105, 280, 1);
  const button = at(440, 280, 2);
  return await step('a thumb on the stick', 'touchStart', [stick])
    || await step('the stick pushed halfway', 'touchMove', [pushed], 'axis=0.50 jump=false mouse=false')
    || await step('a second finger on the button', 'touchStart', [pushed, button], 'axis=0.50 jump=true mouse=false')
    || await step('a third finger on the game', 'touchStart', [pushed, button, at(200, 100, 3)], 'axis=0.50 jump=true mouse=true')
    || await step('all fingers up', 'touchEnd', [], 'axis=0.00 jump=false mouse=false')
    || await step('a tap on the game', 'touchStart', [at(200, 100, 4)], 'axis=0.00 jump=false mouse=true')
    || await step('the tap ends', 'touchEnd', [], 'mouse=false');
}

function plainError(lines) {
  const at = lines.findIndex((l) => /^Error: /.test(l));
  if (at < 0) return 'the deliberate error never came';
  if (!/^Error: main\.lua:\d+: deliberate error/.test(lines[at])) return `unexpected error: ${lines[at]}`;
  const engine = lines.slice(at).find((l) => /\[love "|\[smitten "|\[C\]/.test(l));
  return engine ? `the traceback shows the engine's own frames: ${engine}` : null;
}

async function runCase(name) {
  const c = CASES[name];
  const page = await launch();
  const lines = [];
  page.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      for (const l of m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').split('\n')) lines.push(l);
    } else if (m.method === 'Runtime.exceptionThrown') {
      lines.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  });
  const modules = c.modules ?? 'physics2d';
  // A touch screen for the page, so the browser sends touch events.
  if (c.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.goto(c.url ? `${BASE}${c.url}` : `${BASE}/player.html?game=${c.game}&autoplay=1${modules ? `&modules=${modules}` : ''}`);
  const t0 = Date.now();
  if (c.until) {
    while (!lines.some((l) => c.until.test(l)) && Date.now() - t0 < 40000) await sleep(100);
    await sleep(500);
  } else {
    // Once the game has started (its first line, or a while with none), let it run.
    while (!lines.length && Date.now() - t0 < 20000) await sleep(100);
    await sleep(c.seconds * 1000);
  }
  let problem = c.check(lines);
  if (!problem && c.after) problem = await c.after(page, lines).catch((e) => `the runner's own step stopped: ${e.message || e}`);
  page.close();
  return { problem, lines };
}

async function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);
  for (const n of names) if (!CASES[n]) throw new Error(`no scene test called ${n} (there's ${Object.keys(CASES).join(', ')})`);
  if (!existsSync(join(root, 'dist', 'smitten.wasm'))) throw new Error('dist/ has no engine: run python3 build.py first');
  const server = spawn('python3', [join(root, 'tools', 'test_server.py'), String(PORT)], { stdio: 'ignore' });
  let failed = 0;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`${BASE}/player.html`)).ok) break; } catch { /* not up yet */ }
      await sleep(100);
    }
    for (const name of names) {
      const { problem, lines } = await runCase(name);
      if (problem) {
        failed++;
        console.log(`FAIL ${name}\n${problem}`);
        console.log(lines.filter((l) => !l.startsWith('\x01')).map((l) => `    ${l}`).join('\n'));
      } else {
        const passes = lines.filter((l) => /^PASS /.test(l)).length;
        console.log(`ok   ${name}${passes ? ` (${passes} checks)` : ''}`);
        if (process.env.VERBOSE) console.log(lines.filter((l) => !l.startsWith('\x01')).map((l) => `    ${l}`).join('\n'));
      }
    }
  } finally {
    server.kill();
  }
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
