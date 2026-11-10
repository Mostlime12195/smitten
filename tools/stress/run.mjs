// Runs stress pages in a headless Chrome and prints what measure.js and
// stats.lua saw. No dependencies: it speaks the DevTools protocol itself.
//
//   node tools/stress/run.mjs sprites bodies          # player cases, 10 s each
//   node tools/stress/run.mjs --seconds 30 spawn
//   node tools/stress/run.mjs --profile bodies        # the 25 functions with the most self time
//   node tools/stress/run.mjs --shots /tmp/shots test-smoke test-rigid   # screenshots
//   node tools/stress/run.mjs --url 'http://localhost:8770/index.html' --eval file.js
//
// CHROME=/path/to/chrome picks the browser (default: Playwright's Chromium,
// then Google Chrome, then a Chrome or Chromium on the PATH). BASE=http://localhost:8770 is where serve.py runs.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:8770';
// Optional engine modules each case needs: physics2d for anything with Bodies, Zones or Joints.
const NO_MODULES = new Set(['sprites', 'draws', 'ui']);
const modulesFor = (name) => (NO_MODULES.has(name) ? '' : 'physics2d');

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const pw = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const p = join(pw, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (existsSync(p)) return p;
    }
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  // Linux: whichever Chrome or Chromium is on the PATH.
  for (const dir of (process.env.PATH || '').split(':')) {
    for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
      if (dir && existsSync(join(dir, name))) return join(dir, name);
    }
  }
  return mac;
}

export async function launch({ headless = true, flags = [] } = {}, attempt = 1) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(findChrome(), [
    ...(headless ? ['--headless=new'] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'smitten-stress-'))}`,
    '--no-first-run', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    // CHROME_FLAGS: extra flags, e.g. "--no-sandbox --enable-unsafe-swiftshader" on a CI machine with no GPU.
    ...(process.env.CHROME_FLAGS || '').split(' ').filter(Boolean), ...flags, 'about:blank',
  ], { stdio: 'ignore' });
  // A busy machine (a CI runner) can take a while to bring the browser up.
  let list = [];
  for (let i = 0; i < 400; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((t) => t.type === 'page')) break;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  const target = list.find((t) => t.type === 'page');
  if (!target) {
    proc.kill();
    if (attempt < 2) return launch({ headless, flags }, attempt + 1);
    throw new Error('the browser did not start (set CHROME to its path)');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    } else if (m.method) {
      for (const l of listeners) l(m);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const page = {
    send,
    on: (fn) => listeners.push(fn),
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url) {
      await send('Page.navigate', { url });
    },
    close() {
      ws.close();
      proc.kill();
    },
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(join(here, 'measure.js'), 'utf8') });
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Self time per function, the 25 biggest, from a CPU profile (with where
// each is defined when withPlace is set).
export function topFunctions(prof, withPlace = false) {
  const self = new Map();
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const counts = new Map();
  for (const s of prof.samples) counts.set(s, (counts.get(s) || 0) + 1);
  let total = 0;
  for (const [id, c] of counts) {
    const n = byId.get(id);
    const place = `${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    const key = n.callFrame.functionName ? (withPlace && n.callFrame.url ? `${n.callFrame.functionName} ${place}` : n.callFrame.functionName) : `(${place})`;
    self.set(key, (self.get(key) || 0) + c);
    total += c;
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, c]) => `${(c / total * 100).toFixed(1)}% ${k}`);
}

let profile = false;
let shots = null;

async function runCase(name, seconds) {
  const page = await launch();
  const lines = [];
  page.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (/stress|check|error|Error/.test(text) || name.startsWith('test-')) lines.push(text);
    } else if (m.method === 'Runtime.exceptionThrown') {
      lines.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  });
  const mod = modulesFor(name) ? `&modules=${modulesFor(name)}` : '';
  const t0 = Date.now();
  await page.goto(`${BASE}/player.html?game=stress/${name}.love&autoplay=1${mod}`);
  // Wait for the first stats line (the scene is running), then sample.
  const ready = name.startsWith('test-') ? /^ready/ : /stress .*pieces, loaded/;
  const limit = name.startsWith("test-") ? 4000 : 60000;
  while (!lines.some((l) => ready.test(l)) && Date.now() - t0 < limit) await sleep(100);
  const loadMs = Date.now() - t0;
  await sleep(1500);
  await page.eval('__stress.reset()');
  if (profile) {
    await page.send('Profiler.enable');
    await page.send('Profiler.setSamplingInterval', { interval: 200 });
    await page.send('Profiler.start');
  }
  await sleep(seconds * 1000);
  const report = await page.eval('__stress.report()');
  if (shots) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
  }
  if (profile) {
    const { profile: prof } = await page.send('Profiler.stop');
    report.top = topFunctions(prof);
  }
  const wasm = await page.eval(`(() => { const m = window.Module || window.smitten || null; const b = m?.HEAP8?.buffer || m?.wasmMemory?.buffer; return b ? Math.round(b.byteLength / 1048576) : null; })()`).catch(() => null);
  page.close();
  return { name, loadMs, ...report, wasmMB: wasm, log: lines };
}

async function main() {
  const args = process.argv.slice(2);
  let seconds = 10;
  const names = [];
  let url = null;
  let evalFile = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seconds') seconds = Number(args[++i]);
    else if (args[i] === '--url') url = args[++i];
    else if (args[i] === '--eval') evalFile = args[++i];
    else if (args[i] === '--profile') profile = true;
    else if (args[i] === '--shots') shots = args[++i];
    else names.push(args[i]);
  }
  if (url) {
    const page = await launch();
    page.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled') console.log('console:', m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    });
    await page.goto(url);
    await sleep(3000);
    if (evalFile) console.log(JSON.stringify(await page.eval(readFileSync(evalFile, 'utf8')), null, 2));
    page.close();
    return;
  }
  for (const name of names) {
    const r = await runCase(name, seconds);
    const { log, top, ...rest } = r;
    console.log(JSON.stringify(rest));
    if (top) console.log(top.join('\n'));
    const stats = log.filter((l) => /^stress /.test(l));
    for (const l of log.filter((l) => !/^stress /.test(l) || stats.slice(-4).includes(l))) console.log('   ', l);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
