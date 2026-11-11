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
//   sprites           (sprites: made in the sprite editor; layers, a sheet)
//   paths, levels,
//   players, text, ui, forces,
//   animation
//   rules3, rules2    the same checks in a project of version 3 (the new
//                     rules: degrees, clicked(), undeclared names are
//                     errors, gravityScale) and of version 2 (the old ones)
//   smoke, rigid,     run for a few seconds: no error may happen (what they
//   physics           print is for reading; see each test's main.lua)
//   sounds            sfx() and the Sound piece with a volume and a pitch,
//                     songs with sample instruments (PASS, FAIL, DONE), and
//                     the same song from the editor's synthesizer
//   boards,           smitten.boards without the games site, and inside
//   boards-site       boards-site.html, which stands in for it (PASS, FAIL, DONE)
//   net               smitten.net without the games site (PASS, FAIL, DONE)
//   cloud,            smitten.host and smitten.cloud without a host, and in
//   cloud-host        docs/host-example.html, the docs' host page (cloud-host.html)
//   errorscreen       errors on purpose: the error must come out in plain
//                     form, without the engine's own frames
//   clips             Record in the player's toolbar, then F9 (a video) and
//                     Shift+F9 (a GIF): the downloaded files are checked
//                     (SHOTS=dir also keeps screenshots and the files)
//   example-lights,   the example projects of the home screen
//   example-...       (web/editor/core/examples.js), made as the editor makes
//                     them, with the checks in examples/<id>.lua. No error
//                     and no warning may come (SHOTS=dir keeps a screenshot)
//   ready-made        the ready-made scripts health, spawner, moving-platform
//                     and countdown, in a scene that this file makes
//   playbuild         a project (made here: images of each kind, sprites
//                     with layers, JSON, a tool file) from its source, then
//                     from its play build (web/editor/core/build/): the
//                     images must decode and draw the same pixels (HASH lines)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from '../stress/run.mjs';
import { readWebm, webmDuration } from '../../web/player/webm.js';
import { gifRegion, segmentMs } from '../../web/player/clips.js';
import { decodeGif } from '../clip-tests/gif-decode.mjs';
import { EXAMPLES } from '../../web/editor/core/examples.js';
import { libraryScript } from '../../web/editor/core/templates.js';
import { includedModules } from '../../web/editor/core/modules.js';
import { setSchema } from '../../web/editor/core/schema.js';
import { buildGameZip } from '../../web/editor/exporter.js';
import { buildPlay } from '../../web/editor/core/build/index.js';
import { encodePNGSync } from '../../web/editor/tools/sprite/png.js';
import zlib from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT) || 8772;
const BASE = `http://127.0.0.1:${PORT}`;

const CASES = {
  errors: { game: 'tools/scene-tests/errors.zip', until: /^DONE /, check: selfChecking },
  lights: { game: 'tools/scene-tests/lights.zip', until: /^DONE /, check: selfChecking },
  // Sprites made in the sprite editor (make-sprites-fixture.mjs): layers draw
  // flattened, and a walk cycle cut from a sheet has its frames and plays.
  sprites: { game: 'tools/scene-tests/sprites.zip', until: /^DONE /, modules: '', check: selfChecking },
  levels: { game: 'tools/scene-tests/levels.zip', until: /^DONE /, check: selfChecking },
  animation: { game: 'tools/scene-tests/animation.zip', until: /^DONE /, modules: '', check: selfChecking },
  text: { game: 'tools/scene-tests/text.zip', until: /^DONE /, modules: '', check: selfChecking },
  smoke: { game: 'tools/scene-tests/smoke.zip', seconds: 6, check: (lines) => noErrors(lines) || (lines.some((l) => /^ready/.test(l)) ? null : 'it never printed "ready"') },
  rigid: { game: 'tools/scene-tests/rigid.zip', seconds: 5, check: noErrors },
  physics: { game: 'tools/scene-tests/physics.zip', seconds: 5, check: noErrors },
  paths: { game: 'tools/scene-tests/paths.zip', until: /^DONE /, check: selfChecking },
  // Forces in zones (gravity, drag, push), seeds, generators and noise.
  forces: { game: 'tools/scene-tests/forces.zip', until: /^DONE /, check: selfChecking },
  // smitten.boards without the games site (the editor, an exported game),
  // and inside a page that stands in for a game's page there.
  boards: { game: 'tools/scene-tests/boards.zip', until: /^DONE /, modules: '', check: (lines) => mode(lines, 'unavailable') || selfChecking(lines) },
  'boards-site': { url: '/tools/scene-tests/boards-site.html', until: /^DONE /, check: (lines) => mode(lines, 'site') || selfChecking(lines) },
  // smitten.net without the games site: every call answers "unavailable"
  // at once (platform-tests/rooms-e2e.mjs tests it on the site).
  net: { game: 'tools/scene-tests/net.zip', until: /^DONE /, modules: '', check: selfChecking },
  // smitten.host and smitten.cloud without a host (every call answers
  // "unavailable" at once), and inside the host page that the docs show.
  cloud: { game: 'tools/scene-tests/cloud.zip', until: /^DONE /, modules: '', check: (lines) => mode(lines, 'unavailable') || selfChecking(lines) },
  'cloud-host': { url: '/tools/scene-tests/cloud-host.html', until: /^DONE /, check: (lines) => mode(lines, 'host') || selfChecking(lines) },
  // Players' input and the touch pieces: its own checks, then real touches
  // from the browser on the stick, a button and the game behind them.
  players: { game: 'tools/scene-tests/players.zip', until: /^DONE /, check: selfChecking, touch: true, after: realTouches },
  // The rules a project plays by: its smitten.json's version (the two
  // projects are the same apart from it).
  rules3: {
    game: 'tools/scene-tests/rules3.zip', until: /^DONE /,
    check: (lines) => selfChecking(lines) || rules(lines, 'new')
      || (lines.some((l) => /^Warning: scripts\/oldbutton\.lua:4: a Button's event is clicked\(\)/.test(l)) ? null : 'no warning for function pressed() in a Button\'s script')
      || (lines.some((l) => /^Warning: a Button's event is "clicked"/.test(l)) ? null : 'no warning for on("pressed") on a Button'),
  },
  rules2: {
    game: 'tools/scene-tests/rules2.zip', until: /^DONE /,
    check: (lines) => selfChecking(lines) || rules(lines, 'old')
      || (lines.some((l) => /^Warning: /.test(l)) ? `an old project got a warning: ${lines.find((l) => /^Warning: /.test(l))}` : null),
  },
  // The UI pieces that are worked and that lay others out: its own checks,
  // then a real mouse and keyboard from the browser on a TextInput, a
  // Slider and a Checkbox.
  ui: { game: 'tools/scene-tests/ui.zip', until: /^DONE /, modules: '', check: selfChecking, after: realUI },
  errorscreen: { game: 'tools/errorscreen.zip', until: /^Error: /, modules: '', check: plainError },
  // Volume and pitch for sfx() and the Sound piece, and songs with sample
  // instruments: its own checks, then its song's checksum against the
  // editor's synthesizer (dist/synth.js), so previews sound like the game.
  sounds: { game: 'tools/scene-tests/sounds.zip', until: /^DONE /, modules: 'synth', check: selfChecking, after: sameAsEditor },
  // Clips (web/player/clips.js): a pixel-art game with a tone, recorded
  // through the toolbar, saved as a video and a GIF of the last 3 seconds.
  // Headless Chrome says it has no mouse (hover: none), which hides the
  // player's toolbar as on a phone: the flag gives it one.
  clips: {
    game: 'tools/scene-tests/clips.zip', query: '&clipSeconds=3', until: /^ready/, modules: '', check: noErrors, after: realClips,
    flags: ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'],
  },
};

// The example projects, and a project with the ready-made scripts that are
// building blocks. run.mjs makes their zips into dist/examples-test/ (the
// test server serves dist/), and deletes them at the end.
const checks = join(root, 'tools', 'scene-tests', 'examples');
// includedModules() reads the piece types from the schema.
setSchema(JSON.parse(readFileSync(join(root, 'love', 'src', 'modules', 'scene', 'pieces.json'), 'utf8')));
for (const ex of EXAMPLES) {
  CASES[`example-${ex.id}`] = { project: () => withChecks(ex.build(`${ex.name} example`), ex.id), until: /^DONE /, check: exampleCheck };
}
CASES['ready-made'] = { project: () => withChecks(readyMade(), 'ready-made'), until: /^DONE /, check: exampleCheck };
CASES.playbuild = { project: playBuildProject, until: /^DONE /, modules: '', check: playBuildCheck('make-art.mjs,other.mjs'), after: samePlayBuild };

// The play build test's project: the sprites with layers of the sprites
// test, images of each kind a PNG can be (palette, grey, RGB, RGBA), JSON
// with spaces, and a tool file that the play build leaves out.
function playBuildProject() {
  const art = join(root, 'tools', 'scene-tests', 'sprites', 'art');
  const files = {};
  for (const f of readdirSync(art)) files[`art/${f}`] = /\.png$/.test(f) ? new Uint8Array(readFileSync(join(art, f))) : readFileSync(join(art, f), 'utf8');
  let seed = 7;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) % n; };
  const png = (w, h, pixel) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(pixel(x, y), (y * w + x) * 4);
    return encodePNGSync(px, w, h);
  };
  const colours = Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, (i * 40) % 256, i < 3 ? i * 60 : 255]);
  files['art/palette.png'] = png(40, 24, () => colours[rnd(16)]);
  files['art/two.png'] = png(50, 50, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  files['art/grey.png'] = png(30, 20, (x, y) => [x * 8, x * 8, x * 8, 255]);
  files['art/gradient.png'] = png(64, 64, (x, y) => [x * 4, y * 4, (x * y) % 256, (x + y) * 2]);
  files['art/noise.png'] = png(32, 32, () => [rnd(256), rnd(256), rnd(256), 255]);
  files['art/clear.png'] = png(16, 16, (x) => (x < 8 ? [255, 0, 0, 0] : [0, 0, 255, 0]));
  const images = Object.keys(files).filter((p) => p.endsWith('.png')).sort();
  files['data/images.json'] = `${JSON.stringify({ images }, null, 2)}\n`;
  files['data/info.json'] = JSON.stringify({ title: 'Play  build', list: [1, 2, 3], nested: { deep: true }, text: 'a "quoted" word' }, null, 4);
  files['tools/make-art.mjs'] = '// Writes the art (an example of a tool file).\nconsole.log("art");\n';
  files['tools/other.mjs'] = 'console.log("a tool that no script names");\n';
  files['smitten.json'] = JSON.stringify({ format: 'smitten.project', version: 3, name: 'Play build test', main: 'scenes/main.scene', display: { width: 160, height: 90 } }, null, 2);
  files['scenes/main.scene'] = JSON.stringify({ format: 'smitten.scene', version: 3, root: { name: 'Main', type: 'Group', script: 'scripts/check.lua', children: [{ name: 'Stage', type: 'Group' }] } }, null, 2);
  files['scripts/check.lua'] = readFileSync(join(root, 'tools', 'scene-tests', 'playbuild', 'check.lua'), 'utf8');
  return files;
}

function playBuildCheck(tool) {
  return (lines) => selfChecking(lines) || (lines.includes(`TOOL ${tool}`) ? null : `wanted "TOOL ${tool}" (the tool files in the game), got "${lines.find((l) => l.startsWith('TOOL '))}"`);
}

// The same project's play build, in the same page: every HASH line must be the same.
async function samePlayBuild(page, lines) {
  const source = lines.filter((l) => l.startsWith('HASH '));
  const deflate = async (bytes, level) => new Uint8Array(zlib.deflateSync(bytes, { level, memLevel: 9 }));
  const { files, report } = await buildPlay(playBuildProject(), { deflate });
  if (!report.png?.files || !report.json?.files || !report.layers?.files || !report.tools?.files) return `a pass did nothing: ${JSON.stringify(report)}`;
  const { game } = await exampleZip('playbuild-play', files);
  const mark = lines.length;
  await page.goto(`${BASE}/player.html?game=${game}&autoplay=1`);
  const t0 = Date.now();
  while (!lines.slice(mark).some((l) => /^DONE /.test(l)) && Date.now() - t0 < 40000) await sleep(100);
  const after = lines.slice(mark);
  const problem = playBuildCheck('make-art.mjs')(after);
  if (problem) return `the play build: ${problem}`;
  const played = after.filter((l) => l.startsWith('HASH '));
  const differ = source.filter((l, i) => played[i] !== l);
  if (!source.length || played.length !== source.length || differ.length) {
    return `the play build differs from the source in ${differ.length} of ${source.length} lines: ${differ.slice(0, 3).join(' | ')}`;
  }
  return null;
}

// The checks go on a Group at the start of the main scene, so that they
// update before all the other pieces (a press() then counts in that frame).
function withChecks(files, id) {
  const settings = JSON.parse(files['smitten.json']);
  const main = JSON.parse(files[settings.main]);
  main.root.children = [{ name: 'Checks', type: 'Group', script: 'checks/check.lua' }, ...(main.root.children || [])];
  return {
    ...files,
    [settings.main]: JSON.stringify(main, null, 2),
    'checks/check.lua': readFileSync(join(checks, '_check.lua'), 'utf8') + readFileSync(join(checks, `${id}.lua`), 'utf8'),
  };
}

function readyMade() {
  const scene = (root) => JSON.stringify({ format: 'smitten.scene', version: 3, root });
  const box = { name: 'Look', type: 'Shape', properties: { width: 20, height: 20 } };
  return {
    'smitten.json': JSON.stringify({ format: 'smitten.project', version: 3, name: 'Ready-made scripts', main: 'scenes/main.scene', display: { width: 640, height: 360 } }),
    'scenes/thing.scene': scene({ name: 'Thing', type: 'Group', tags: ['thing'], children: [box] }),
    'scenes/main.scene': scene({
      name: 'Main', type: 'Group', children: [
        { name: 'Hero', type: 'Body', script: 'scripts/health.lua', properties: { x: 100, y: 100, invincibleTime: 0.5 }, children: [box] },
        { name: 'Spawner', type: 'Group', script: 'scripts/spawner.lua', properties: { x: 300, y: 100, sceneFile: 'scenes/thing.scene', interval: 0.2, maxAlive: 3 } },
        { name: 'Lift', type: 'Body', script: 'scripts/moving-platform.lua', properties: { x: 500, y: 300, motion: 'still', route: '100, 0', speed: 400, stopTime: 0.1 }, children: [box] },
        { name: 'Clock', type: 'Label', script: 'scripts/countdown.lua', properties: { duration: 1, showTenths: true } },
      ],
    }),
    ...Object.fromEntries(['health', 'spawner', 'moving-platform', 'countdown'].map((id) => [`scripts/${id}.lua`, libraryScript(id)])),
  };
}

// The checks pass, and nothing printed an error or a warning.
function exampleCheck(lines) {
  const bad = lines.find((l) => /^(Error|Warning): |^exception: /.test(l));
  return bad ? `it printed: ${bad}` : selfChecking(lines);
}

// As the editor gives it to the player: a zip of the files, with the modules that it needs.
async function exampleZip(name, files) {
  const project = {
    paths: () => Object.keys(files),
    readText: (path) => (typeof files[path] === 'string' ? files[path] : ''),
    readJSON: (path) => JSON.parse(files[path]),
    settings: () => JSON.parse(files['smitten.json']),
  };
  // Node cannot import fflate from its CDN: the editor's own zip writer
  // takes its place, and says so.
  const warn = console.warn;
  console.warn = () => {};
  const zip = await buildGameZip(files).finally(() => { console.warn = warn; });
  mkdirSync(join(root, 'dist', 'examples-test'), { recursive: true });
  writeFileSync(join(root, 'dist', 'examples-test', `${name}.zip`), zip);
  return { game: `examples-test/${name}.zip`, modules: includedModules(project).join(',') };
}

// The editor renders the sounds test's song (with its WAV file read by the
// editor's own decoder) to the same samples as the engine did.
async function sameAsEditor(page, lines) {
  const line = lines.find((l) => /^CHECKSUM /.test(l));
  if (!line) return 'the game printed no CHECKSUM line';
  const engine = Number(line.split(' ')[1]);
  const dir = join(root, 'tools', 'scene-tests', 'sounds');
  const { loadSynth } = await import(pathToFileURL(join(root, 'dist', 'synth.js')).href);
  const { decodeWav, toMono } = await import(pathToFileURL(join(root, 'web', 'editor', 'tools', 'wav', 'wav.js')).href);
  const synth = await loadSynth();
  const song = JSON.parse(readFileSync(join(dir, 'music', 'samples.song'), 'utf8'));
  const wav = decodeWav(readFileSync(join(dir, 'sounds', 'tone.wav')));
  const samples = synth.renderSong(song, () => undefined, () => ({ samples: toMono(wav.channels), sampleRate: wav.sampleRate }));
  const editor = synth.checksum(samples);
  return editor === engine ? null : `the editor renders the song differently: checksum ${editor} (${samples.length} samples), the game ${engine}`;
}

function noErrors(lines) {
  const bad = lines.find((l) => /^Error: |^exception: /.test(l));
  return bad ? `it stopped with: ${bad}` : null;
}

function mode(lines, want) {
  const line = lines.find((l) => /^MODE /.test(l));
  return line === `MODE ${want}` ? null : noErrors(lines) || `expected "MODE ${want}", got ${line ? `"${line}"` : 'nothing'}`;
}

function rules(lines, want) {
  const line = lines.find((l) => /^RULES /.test(l));
  return line === `RULES ${want}` ? null : `expected "RULES ${want}", got ${line ? `"${line}"` : 'nothing'}`;
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

// A real mouse and keyboard, through the browser, on the ui test once its
// own checks are done (it prints a LIVE line whenever its TextInput, Slider
// or Checkbox changes): a click into the box, typing through the page's
// hidden text field, Backspace, a paste, a drag of the slider and a click
// on the checkbox.
async function realUI(page, lines) {
  const [left, top, w, h] = JSON.parse(await page.eval(`(() => { const r = document.querySelector('#canvas').getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`));
  // The test is 640×360, fitted into the canvas.
  const s = Math.min(w / 640, h / 360);
  const at = (x, y) => ({ x: Math.round(left + (w - 640 * s) / 2 + x * s), y: Math.round(top + (h - 360 * s) / 2 + y * s) });
  const step = async (what, act, want) => {
    const from = lines.length;
    await act();
    for (let i = 0; i < 50; i++) {
      if (lines.slice(from).some((l) => l.startsWith('LIVE') && (typeof want === 'string' ? l.includes(want) : want.test(l)))) return null;
      await sleep(100);
    }
    return `real input: ${what}: wanted ${want}, the last was "${lines.filter((l) => l.startsWith('LIVE')).pop()}"`;
  };
  const mouse = (type, p, buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1 });
  const click = async (p) => {
    await mouse('mouseMoved', p, 0);
    await mouse('mousePressed', p);
    await sleep(60);
    await mouse('mouseReleased', p, 0);
  };
  const keyTap = async (key, code, vk) => {
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(60);
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  const field = () => page.eval(`document.activeElement && document.activeElement.className`);
  const paste = (text) => page.eval(`(() => {
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(text)});
    document.querySelector('.love-text-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
  const box = at(120, 38);
  // The slider's knob runs from x = 32 to 208.
  const half = at(120, 92);
  const beyond = at(260, 120);
  return await step('a click into the box', () => click(box), 'focus=LiveText')
    || ((await field()) === 'love-text-input' ? null : `real input: typing goes to "${await field()}", not the page's hidden text field`)
    || await step('typing', () => page.send('Input.insertText', { text: 'Cat' }), 'text=[Cat]')
    || await step('Backspace', () => keyTap('Backspace', 'Backspace', 8), 'text=[Ca]')
    || await step('a paste', () => paste('ts\r\nup'), 'text=[Catsup]')
    || await step('a press on the slider', async () => { await mouse('mouseMoved', half, 0); await mouse('mousePressed', half); }, /slider=(49|50|51) .*focus=LiveSlider/)
    || await step('a drag past its end', () => mouse('mouseMoved', beyond), 'slider=100')
    || await step('a click on the checkbox', async () => { await mouse('mouseReleased', beyond, 0); await click(at(30, 144)); }, 'check=true');
}

// The clips test: a real click on Record, real F9 and Shift+F9 presses,
// and the files the browser downloads, checked here and in the page.
async function realClips(page) {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'smitten-clips-'));
  try {
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })
      .catch(() => page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }));
    const center = async (sel) => JSON.parse(await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]); })()`));
    const mouse = (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    const click = async (sel) => {
      const [x, y] = await center(sel);
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y);
      await sleep(50);
      await mouse('mouseReleased', x, y);
    };
    const key = async (shift) => {
      const k = { key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, nativeVirtualKeyCode: 120, modifiers: shift ? 8 : 0 };
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
      await sleep(50);
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    };
    const shot = async (name) => {
      if (!process.env.SHOTS) return;
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.SHOTS, name), Buffer.from(data, 'base64'));
    };
    const download = async (ext, seconds) => {
      for (let i = 0; i < seconds * 10; i++) {
        const name = readdirSync(dir).find((f) => f.endsWith(`.${ext}`));
        if (name) {
          await sleep(300);
          return { name, bytes: new Uint8Array(readFileSync(join(dir, name))) };
        }
        await sleep(100);
      }
      return null;
    };
    const status = () => page.eval(`document.querySelector('#clip-status').textContent`);

    if (await page.eval(`document.querySelector('#btn-record').hidden`)) return 'clips: the Record button is hidden (the browser cannot record?)';
    if (!(await page.eval(`document.querySelector('#btn-clip').hidden`))) return 'clips: Save clip shows before Record is pressed';
    const pressed = async (want) => {
      for (let i = 0; i < 50; i++) {
        if (await page.eval(`document.querySelector('#btn-record').getAttribute('aria-pressed')`) === want) return true;
        await sleep(100);
      }
      return false;
    };
    await click('#btn-record');
    // The first press loads clips.js.
    if (!(await pressed('true'))) return `clips: Record did not start: ${await status()}`;
    if (await page.eval(`document.querySelector('#btn-clip').hidden`)) return 'clips: no Save clip button while recording';
    await shot('clips-toolbar.png');
    // More than 3 seconds, so the clip is cut to the last 3.
    await sleep(5500);
    await click('#btn-clip');
    await sleep(200);
    await shot('clips-menu.png');
    await click('#btn-clip');
    await key(false);
    const video = await download('webm', 30);
    if (!video) return `clips: F9 saved no video: ${await status()}`;
    await key(true);
    const gif = await download('gif', 90);
    if (!gif) return `clips: Shift+F9 saved no GIF: ${await status()}`;
    await shot('clips-saved.png');
    if (process.env.SHOTS) {
      writeFileSync(join(process.env.SHOTS, 'clips.webm'), video.bytes);
      writeFileSync(join(process.env.SHOTS, 'clips.gif'), gif.bytes);
    }

    // The video: about the last 3 seconds, VP8 and Opus, from a keyframe.
    if (!/^Clips test \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\.webm$/.test(video.name)) return `clips: the video's name is "${video.name}"`;
    const webm = readWebm(video.bytes);
    const duration = webmDuration(video.bytes);
    const frames = webm.blocks.filter((b) => b.track === webm.tracks.find((t) => t.codecId === 'V_VP8')?.number);
    const sound = webm.tracks.find((t) => t.codecId === 'A_OPUS');
    const fps = frames.length / (duration / 1000);
    console.log(`clips: video ${video.bytes.length} bytes, ${(duration / 1000).toFixed(2)} s, ${frames.length} frames (${fps.toFixed(1)} per second), ${sound ? 'with' : 'without'} sound`);
    if (!(duration >= 2900 && duration <= 3000 + segmentMs(3) + 300)) return `clips: the video is ${duration} ms long, not about 3 seconds`;
    if (!frames.length || !frames[0].keyframe) return 'clips: the video does not start on a keyframe';
    if (fps < 5) return `clips: only ${fps.toFixed(1)} frames per second in the video`;
    if (!sound || !webm.blocks.some((b) => b.track === sound.number)) return 'clips: the video has no sound';
    // The browser plays it, knows its length and can seek in it.
    const b64 = Buffer.from(video.bytes).toString('base64');
    const played = JSON.parse(await page.eval(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
      const v = document.createElement('video');
      v.muted = true;
      v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
      await new Promise((ok, no) => {
        v.onloadedmetadata = ok;
        v.onerror = () => no(new Error('the video does not load'));
        setTimeout(() => no(new Error('the video did not load in 10 seconds')), 10000);
      });
      const duration = v.duration;
      v.currentTime = duration / 2;
      await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 5000); });
      return JSON.stringify({ duration, at: v.currentTime, width: v.videoWidth, height: v.videoHeight });
    })()`));
    if (!(Math.abs(played.duration * 1000 - duration) < 150)) return `clips: the browser says the video is ${played.duration} s, the file ${duration} ms`;
    if (!(Math.abs(played.at - played.duration / 2) < 0.3)) return `clips: seeking to the middle went to ${played.at} s`;

    // The GIF: the game's pixels, each a 4x4 square, about 3 seconds long.
    const [cw, ch] = JSON.parse(await page.eval(`JSON.stringify([document.querySelector('#canvas').width, document.querySelector('#canvas').height])`));
    const want = gifRegion(played.width || cw, played.height || ch, { width: 160, height: 90, stretch: 'pixel' });
    const g = decodeGif(gif.bytes);
    const gifMs = g.frames.reduce((s, f) => s + f.delay * 10, 0);
    console.log(`clips: GIF ${gif.bytes.length} bytes, ${g.width}x${g.height}, ${g.frames.length} frames, ${(gifMs / 1000).toFixed(2)} s`);
    if (g.sig !== 'GIF89a' || g.width !== want.width || g.height !== want.height) return `clips: the GIF is ${g.sig} ${g.width}x${g.height}, not ${want.width}x${want.height}`;
    if (!(gifMs >= 2800 && gifMs <= 3000 + segmentMs(3) + 400)) return `clips: the GIF is ${gifMs} ms long`;
    if (g.frames.length > Math.ceil(gifMs / 1000 * 15) + 2) return `clips: ${g.frames.length} frames is more than 15 per second`;
    if (g.frames.length < Math.min(15, fps) * gifMs / 1000 * 0.5) return `clips: only ${g.frames.length} frames in the GIF`;
    const times = want.width / 160;
    // Near the game's own colors (not darker: the video is full range).
    const near = (c, ref) => c && Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) + Math.abs(c[2] - ref[2]) < 24;
    const bg = [26, 28, 43], box = [255, 204, 77];
    for (const [i, f] of g.frames.entries()) {
      let other = 0, boxes = 0, mixed = 0;
      for (const c of f.pixels) {
        if (near(c, box)) boxes++;
        else if (!near(c, bg)) other++;
      }
      // Each game pixel is a square of the same GIF pixels.
      for (let y = 0; y < g.height; y += times) {
        for (let x = 0; x < g.width; x += times) {
          const first = f.pixels[y * g.width + x];
          for (let k = 0; k < times * times; k++) {
            if (f.pixels[(y + Math.floor(k / times)) * g.width + x + (k % times)] !== first) { mixed++; break; }
          }
        }
      }
      if (other > f.pixels.length * 0.002) return `clips: GIF frame ${i}: ${other} pixels are neither the background nor the box`;
      if (boxes < 144 * times * times * 0.8) return `clips: GIF frame ${i}: the box has ${boxes} pixels, not about ${144 * times * times}`;
      if (mixed > 160 * 90 * 0.002) return `clips: GIF frame ${i}: ${mixed} game pixels are not sharp squares`;
    }
    // The browser's own GIF decoder agrees.
    const decoded = await page.eval(`(async () => {
      if (typeof ImageDecoder === 'undefined') return -1;
      const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(gif.bytes).toString('base64'))}), (c) => c.charCodeAt(0));
      const d = new ImageDecoder({ data: bytes, type: 'image/gif' });
      const late = new Promise((ok) => setTimeout(() => ok(-2), 10000));
      return Promise.race([late, (async () => {
        await d.tracks.ready;
        const n = d.tracks.selectedTrack.frameCount;
        await d.decode({ frameIndex: n - 1 });
        return n;
      })()]);
    })()`);
    if (decoded === -2) return 'clips: the browser did not decode the GIF in 10 seconds';
    if (decoded !== -1 && decoded !== g.frames.length) return `clips: the browser finds ${decoded} frames in the GIF, not ${g.frames.length}`;
    // Record again: it stops, and Save clip goes away.
    await click('#btn-record');
    if (!(await pressed('false'))) return 'clips: pressing Record again did not stop it';
    if (!(await page.eval(`document.querySelector('#btn-clip').hidden`))) return 'clips: Save clip stays after recording stops';
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function plainError(lines) {
  const at = lines.findIndex((l) => /^Error: /.test(l));
  if (at < 0) return 'the deliberate error never came';
  if (!/^Error: main\.lua:\d+: deliberate error/.test(lines[at])) return `unexpected error: ${lines[at]}`;
  const engine = lines.slice(at).find((l) => /\[love "|\[smitten "|\[C\]/.test(l));
  return engine ? `the traceback shows the engine's own frames: ${engine}` : null;
}

async function runCase(name) {
  let c = CASES[name];
  if (c.project) c = { ...c, ...(await exampleZip(name, await c.project())) };
  const page = await launch({ flags: c.flags || [] });
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
  await page.goto(c.url ? `${BASE}${c.url}` : `${BASE}/player.html?game=${c.game}&autoplay=1${modules ? `&modules=${modules}` : ''}${c.query || ''}`);
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
  if (c.project && process.env.SHOTS) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  }
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
    rmSync(join(root, 'dist', 'examples-test'), { recursive: true, force: true });
  }
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
