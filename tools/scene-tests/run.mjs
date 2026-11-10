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
//   paths
//   smoke, rigid,     run for a few seconds: no error may happen (what they
//   physics           print is for reading; see each test's main.lua)
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
  smoke: { game: 'tools/scene-tests/smoke.zip', seconds: 6, check: (lines) => noErrors(lines) || (lines.some((l) => /^ready/.test(l)) ? null : 'it never printed "ready"') },
  rigid: { game: 'tools/scene-tests/rigid.zip', seconds: 5, check: noErrors },
  physics: { game: 'tools/scene-tests/physics.zip', seconds: 5, check: noErrors },
  paths: { game: 'tools/scene-tests/paths.zip', until: /^DONE /, check: selfChecking },
  errorscreen: { game: 'tools/errorscreen.zip', until: /^Error: /, modules: '', check: plainError },
};

function noErrors(lines) {
  const bad = lines.find((l) => /^Error: |^exception: /.test(l));
  return bad ? `it stopped with: ${bad}` : null;
}

function selfChecking(lines) {
  const failed = lines.filter((l) => /^FAIL /.test(l));
  if (failed.length) return failed.join('\n');
  const done = lines.find((l) => /^DONE /.test(l));
  if (!done) return noErrors(lines) || 'it never printed DONE';
  return /^DONE [1-9]\d* passed, 0 failed/.test(done) ? null : done;
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
  await page.goto(`${BASE}/player.html?game=${c.game}&autoplay=1${modules ? `&modules=${modules}` : ''}`);
  const t0 = Date.now();
  if (c.until) {
    while (!lines.some((l) => c.until.test(l)) && Date.now() - t0 < 40000) await sleep(100);
    await sleep(500);
  } else {
    // Once the game has started (its first line, or a while with none), let it run.
    while (!lines.length && Date.now() - t0 < 20000) await sleep(100);
    await sleep(c.seconds * 1000);
  }
  page.close();
  return { problem: c.check(lines), lines };
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
