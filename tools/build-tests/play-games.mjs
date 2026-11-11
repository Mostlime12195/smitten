// Play builds of real games, end to end: each game goes through the editor's
// own exporter (in the browser, as "Export for the web" does) and through
// publishing (a local games site, as Publish does); then the source and the
// play build run in the player, side by side.
//
//   node --experimental-websocket tools/build-tests/play-games.mjs <dist> <game.zip>... [--measure] [--before <dist>]
//
// A game zip can be named <anything>.zip; modules are found as the editor
// finds them. It fails if a game stops with an error, if an image of the play
// build decodes to other pixels in the engine than the source's (probe
// "images"), or if a remix of the published game is not the source.
// --measure also prints download sizes (raw, gzip, Brotli), the time to the
// first frame (cold and warm cache), draw calls and the frame split, from
// the engine's probe (love/src/modules/engine/probe.lua), as JSON.
// --before <dist> adds the web export of an older build (sizes only).
//
// PORT (8782) is the first of two ports it uses. TMPDIR holds the browser's
// profile and the exports while it runs; they are deleted at the end.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { launch, sleep } from '../stress/run.mjs';
import { includedModules } from '../../web/editor/core/modules.js';
import { setSchema } from '../../web/editor/core/schema.js';
import { unzipToProjectFiles } from '../../web/editor/exporter.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const measure = args.includes('--measure');
if (measure) args.splice(args.indexOf('--measure'), 1);
const before = flag('--before');
const dist = resolve(args.shift() || join(root, 'dist'));
const games = args.map((p) => resolve(p));
const PORT = Number(process.env.PORT) || 8782;
const work = mkdtempSync(join(tmpdir(), 'smitten-play-'));
process.env.TMPDIR = work; // the browser's profile goes here too
let failures = 0;
const fail = (what) => { failures++; console.log(`FAIL ${what}`); };
const pass = (what) => console.log(`PASS ${what}`);
const children = [];

function serve(dir, port) {
  const p = spawn('python3', [join(root, 'serve.py'), String(port), '--dir', dir], { stdio: 'ignore' });
  children.push(p);
  return p;
}
const stop = (p) => { p.kill(); children.splice(children.indexOf(p), 1); };

const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const br = (b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
const sizes = (b) => ({ raw: b.length, gzip: gz(b), brotli: br(b) });

/** Opens the browser, runs fn(page), closes it. */
async function withBrowser(fn) {
  const page = await launch();
  try { return await fn(page); } finally { page.close(); await sleep(300); }
}

// includedModules() reads the piece types from the schema.
setSchema(JSON.parse(readFileSync(join(root, 'love', 'src', 'modules', 'scene', 'pieces.json'), 'utf8')));

/** The modules the editor includes for a game zip. */
async function modulesOf(zip) {
  const warn = console.warn;
  console.warn = () => {}; // Node cannot import fflate from its CDN; the built-in reader does the work
  const files = await unzipToProjectFiles(readFileSync(zip)).finally(() => { console.warn = warn; });
  return includedModules({
    paths: () => Object.keys(files),
    readText: (path) => (typeof files[path] === 'string' ? files[path] : ''),
    readJSON: (path) => JSON.parse(files[path]),
    settings: () => JSON.parse(files['smitten.json']),
  });
}

/** Builds the exports and the play zip of each game with the exporter of the build in dir. */
async function buildInBrowser(dir, port, zips, { playZip = true } = {}) {
  const server = serve(dir, port);
  await sleep(800);
  const staged = join(dir, '__play-games');
  mkdirSync(staged, { recursive: true });
  try {
    return await withBrowser(async (page) => {
      await page.goto(`http://127.0.0.1:${port}/pieces.json`);
      await sleep(1000);
      const out = [];
      for (const zip of zips) {
        cpSync(zip, join(staged, basename(zip)));
        const listed = await modulesOf(zip);
        const result = await page.eval(`(async () => {
          const ex = await import('/exporter.js');
          const bytes = new Uint8Array(await (await fetch('/__play-games/${basename(zip)}')).arrayBuffer());
          const files = await ex.unzipToProjectFiles(bytes);
          const listed = ${JSON.stringify(listed)};
          const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
          const off = { layers: false, tools: false, json: false, png: false };
          const t0 = performance.now();
          const web = await ex.buildWebExport(files, 'game', listed || []);
          const exportMs = performance.now() - t0;
          const r = { modules: listed, web: b64(web), exportMs };
          if (${playZip}) {
            const t1 = performance.now();
            const play = await ex.buildPlayZip(files);
            r.playMs = performance.now() - t1;
            r.play = b64(play.zip);
            r.report = play.report;
            r.source = b64(await ex.buildGameZip(files));
            r.webSource = b64(await ex.buildWebExport(files, 'game', listed || [], { passes: off }));
          }
          return r;
        })()`);
        const buf = (s) => (s ? Buffer.from(s, 'base64') : null);
        out.push({ ...result, web: buf(result.web), play: buf(result.play), source: buf(result.source), webSource: buf(result.webSource) });
      }
      return out;
    });
  } finally {
    stop(server);
    rmSync(staged, { recursive: true, force: true });
  }
}

/** Unzips a zip (fflate is not here: Python's zipfile does it). */
function unzipTo(bytes, dir) {
  mkdirSync(dir, { recursive: true });
  const zipPath = join(work, `x-${Math.random().toString(36).slice(2)}.zip`);
  writeFileSync(zipPath, bytes);
  const r = spawn('python3', ['-I', '-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, dir], { stdio: 'inherit' });
  return new Promise((res, rej) => r.on('exit', (c) => { rmSync(zipPath, { force: true }); c ? rej(new Error('unzip failed')) : res(); }));
}

const LAMPLIGHT_KEYS = [...[['z', 'KeyZ', 90], [' ', 'Space', 32], ['z', 'KeyZ', 90], ['ArrowRight', 'ArrowRight', 39], ['z', 'KeyZ', 90]].map((k) => [...k, 1200]),
  ...Array.from({ length: 14 }, () => ['z', 'KeyZ', 90, 700])];

/**
 * Runs a game page and collects what the probe says: {lines, probe, errors, shot}.
 * keys: presses after the game starts (into Lamplight's first room).
 */
async function play(page, url, { keys = [], frames = 2, wait = 6000 } = {}) {
  const lines = [];
  const off = page.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') lines.push({ t: m.params.timestamp, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    else if (m.method === 'Runtime.exceptionThrown') lines.push({ t: Date.now(), text: `Error: exception ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}` });
  });
  const t0 = Date.now();
  await page.goto(url);
  await sleep(wait);
  for (const [key, code, vk, after] of keys) {
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
    await sleep(120);
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    await sleep(after);
  }
  // Frames in the scene the keys led to.
  const mark = lines.length;
  for (let i = 0; i < 60; i++) {
    if (lines.slice(mark).filter((l) => l.text.startsWith('\x01probe {"ev":"frames"')).length >= frames + 1) break;
    await sleep(500);
  }
  const shot = Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  const res = await page.eval(`performance.getEntriesByType('resource').map((r) => ({ name: r.name.split('?')[0].split('/').slice(3).join('/'), transfer: r.transferSize, body: r.encodedBodySize, decoded: r.decodedBodySize }))`);
  await page.goto('about:blank');
  await sleep(300);
  const probe = lines.filter((l) => l.text.startsWith('\x01probe ')).map((l) => ({ t: l.t - t0, ...JSON.parse(l.text.slice(7)) }));
  const errors = lines.map((l) => l.text).filter((t) => /^Error: |Could not load|crashed/.test(t));
  const at = (ev) => probe.find((p) => p.ev === ev)?.t ?? null;
  const allFrames = probe.filter((p) => p.ev === 'frames');
  return {
    errors,
    shot,
    resources: res,
    firstFrameMs: at('first'),
    initMs: at('init'),
    firstSceneMs: at('scene'),
    frames: allFrames.slice(-frames),
    parse: probe.find((p) => p.ev === 'parse') || null,
    images: probe.find((p) => p.ev === 'images')?.images || null,
  };
}

function compareImages(a, b, what) {
  if (!a || !b) { fail(`${what}: the probe sent no image hashes`); return; }
  const names = Object.keys(a);
  const diff = names.filter((n) => a[n] !== b[n]);
  if (diff.length || names.length !== Object.keys(b).length) fail(`${what}: ${diff.length} of ${names.length} images differ (${diff.slice(0, 3).join(', ')})`);
  else pass(`${what}: all ${names.length} images decode to the same pixels`);
}

/** A local games site with the build's player; publishes source + play and returns their URLs. */
async function publishLocally(builds, zips) {
  const dataDir = join(work, 'site');
  mkdirSync(dataDir, { recursive: true });
  const site = join(work, 'site-root');
  cpSync(join(root, 'platform'), site, { recursive: true, filter: (p) => !p.includes(`${join(root, 'platform', 'public', 'player')}`) });
  await new Promise((res, rej) => spawn('sh', [join(site, 'scripts', 'copy-player.sh'), dist], { stdio: 'ignore' }).on('exit', (c) => (c ? rej(new Error('copy-player failed')) : res())));
  const port = PORT + 1;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn('node', [join(site, 'src', 'server.js')], {
    stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_URL: base, EDITOR_URL: 'http://127.0.0.1:1/', EDITOR_ORIGINS: 'http://127.0.0.1:1' },
  });
  children.push(server);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/api/config`)).ok) break; } catch { /* not up */ } await sleep(200); }
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  const res = await post('/api/auth/signup', { username: 'playbuild', password: 'play build test password', displayName: 'Play build' });
  if (!res.ok) throw new Error(`sign-up failed: ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const out = [];
  for (let i = 0; i < builds.length; i++) {
    const b = builds[i];
    const form = new FormData();
    form.append('meta', JSON.stringify({ title: basename(zips[i], '.zip'), description: '', modules: b.modules || [], engineVersion: '0.3.0' }));
    form.append('game', new Blob([b.source], { type: 'application/zip' }), 'game.zip');
    form.append('play', new Blob([b.play], { type: 'application/zip' }), 'play.zip');
    const r = await fetch(`${base}/api/games`, { method: 'POST', headers: { Cookie: cookie, Origin: base }, body: form });
    const j = await r.json();
    if (!r.ok) throw new Error(`publish failed: ${JSON.stringify(j)}`);
    const remix = Buffer.from(await (await fetch(j.game.gameUrl)).arrayBuffer());
    if (Buffer.compare(remix, b.source) === 0) pass(`${basename(zips[i])}: a remix gets the source`);
    else fail(`${basename(zips[i])}: a remix does not get the source`);
    const served = Buffer.from(await (await fetch(`${base}/api/games/${j.id}/play/x.zip`)).arrayBuffer());
    if (Buffer.compare(served, b.play) === 0) pass(`${basename(zips[i])}: the play page gets the play build`);
    else fail(`${basename(zips[i])}: the play page does not get the play build`);
    out.push(`${base}/player/player.html?game=${encodeURIComponent(`/api/games/${j.id}/play/game.zip`)}&modules=${(b.modules || []).join(',')}`);
  }
  return { urls: out, stop: () => stop(server) };
}

const result = { games: [] };
try {
  const builds = await buildInBrowser(dist, PORT, games);
  const older = before ? await buildInBrowser(resolve(before), PORT, games, { playZip: false }) : null;
  const exportsDir = join(work, 'exports');
  for (let i = 0; i < games.length; i++) {
    const b = builds[i];
    const name = basename(games[i]);
    await unzipTo(b.web, join(exportsDir, `${i}-play`));
    await unzipTo(b.webSource, join(exportsDir, `${i}-source`));
    if (older) await unzipTo(older[i].web, join(exportsDir, `${i}-before`));
    const g = { game: name, modules: b.modules, exportMs: Math.round(b.exportMs), playBuildMs: Math.round(b.playMs), report: b.report };
    g.sizes = {
      sourceZip: sizes(b.source), playZip: sizes(b.play), webExport: b.web.length, webExportSource: b.webSource.length,
      webExportBefore: older ? older[i].web.length : undefined,
    };
    result.games.push(g);
  }

  // EXPORTS=<dir>: only make the web exports (<n>-play, <n>-source and,
  // with --before, <n>-before) in that folder, for measuring by hand.
  if (process.env.EXPORTS) {
    cpSync(exportsDir, process.env.EXPORTS, { recursive: true });
    throw Object.assign(new Error('exports written'), { done: true });
  }

  // The web exports, source and play build.
  const server = serve(exportsDir, PORT);
  await sleep(800);
  const isLamp = (i) => /lamplight|jvdm653zd6/i.test(basename(games[i]));
  const what = process.env.PROBE || (measure ? 'frames,images,parse' : 'images');
  await withBrowser(async (page) => {
    for (let i = 0; i < games.length; i++) {
      const g = result.games[i];
      const runs = {};
      for (const kind of ['source', 'play']) {
        const url = `http://127.0.0.1:${PORT}/${i}-${kind}/index.html?autoplay=1&probe=${what}`;
        const opts = { keys: isLamp(i) ? LAMPLIGHT_KEYS : [], frames: measure ? 2 : 0, wait: 6000 };
        // Cold (a new cache for this export's files... the engine is shared
        // per path, so each folder starts cold), then warm.
        const cold = await play(page, url, opts);
        const warm = measure ? await play(page, url, { ...opts, keys: [], frames: 0, wait: 5000 }) : null;
        runs[kind] = { cold, warm };
        if (cold.errors.length) fail(`${g.game} (web export, ${kind}): ${cold.errors.slice(0, 3).join(' | ')}`);
        else pass(`${g.game} (web export, ${kind}) plays with no error`);
        writeFileSync(join(process.env.SHOTS || work, `play-${i}-${kind}.png`), cold.shot);
      }
      compareImages(runs.source.cold.images, runs.play.cold.images, `${g.game} (web export)`);
      g.sourceImages = runs.source.cold.images;
      if (measure) {
        for (const kind of ['source', 'play']) {
          const { cold, warm } = runs[kind];
          g[kind] = {
            firstFrameMs: { cold: cold.firstFrameMs, warm: warm.firstFrameMs },
            initMs: { cold: cold.initMs, warm: warm.initMs },
            downloadKB: Math.round(cold.resources.reduce((n, r) => n + (r.transfer || 0), 0) / 1024),
            parts: Object.fromEntries(cold.resources.filter((r) => r.decoded > 4096).map((r) => [r.name.replace(/^\d+-\w+\//, ''), { transfer: r.transfer, decoded: r.decoded }])),
            frames: cold.frames,
            parse: cold.parse,
          };
        }
      }
    }
  });
  stop(server);

  // Publishing: a local games site, the play page's player.
  const site = await publishLocally(builds, games);
  await withBrowser(async (page) => {
    for (let i = 0; i < games.length; i++) {
      const run = await play(page, `${site.urls[i]}&autoplay=1&probe=images`, { keys: isLamp(i) ? LAMPLIGHT_KEYS.slice(0, 6) : [], wait: 6000 });
      if (run.errors.length) fail(`${basename(games[i])} (published): ${run.errors.slice(0, 3).join(' | ')}`);
      else pass(`${basename(games[i])} (published) plays with no error`);
      compareImages(result.games[i].sourceImages, run.images, `${basename(games[i])} (published)`);
      delete result.games[i].sourceImages;
    }
  });
  site.stop();
} catch (e) {
  if (!e.done) fail(`the run stopped: ${e.stack || e}`);
} finally {
  for (const c of [...children]) c.kill();
  await sleep(300);
  rmSync(work, { recursive: true, force: true });
}
if (measure) console.log(JSON.stringify(result, null, 1));
console.log(`DONE ${failures ? 'with failures' : 'ok'}`);
process.exit(failures ? 1 : 0);
