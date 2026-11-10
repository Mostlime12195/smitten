// The sprite editor (the Sprites workspace) in the built editor, in headless
// Chrome: how you find it, and strokes while the editor saves by itself (a
// save must not end the stroke that you draw).
//
//   node tools/editor-tests/paint.mjs [--shots dir]
//
// Needs a built dist/ (python3 build.py). It serves dist/ itself on PORT
// (default 8776). CHROME and CHROME_FLAGS are as in tools/stress/run.mjs.
// Prints PASS or FAIL for each check and exits with 1 if one failed.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../stress/run.mjs';
import { decodePNG } from '../../web/editor/tools/sprite/png.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT) || 8776;
const BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2);
const shots = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : null;

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail !== undefined ? `: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}` : ''}`);
  }
  return ok;
}

if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('dist/ has no editor: run python3 build.py first');
const server = spawn('python3', [join(root, 'serve.py'), String(PORT), '--dir', join(root, 'dist')], { stdio: 'ignore' });
let page = null;
const problems = [];

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  page = await launch();
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const until = async (expr, what, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.eval(`!!(${expr})`)) return true;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const shot = async (name) => {
    if (!shots) return;
    mkdirSync(shots, { recursive: true });
    await sleep(300);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`     ${join(shots, `${name}.png`)}`);
  };
  const click = (expr) => page.eval(`(${expr}).click()`);
  const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`;
  const menuItem = (text) => byText('.menu button, .menu [role=menuitem], .menu .menu-item', text);
  const spr = `document.querySelector('.workspace[data-ws="paint"] .spr:not([hidden])')`;
  const mouse = (type, x, y, buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1 });
  const rect = (expr) => page.eval(`(() => { const r = (${expr}).getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`).then(JSON.parse);
  // A project file, from the editor's IndexedDB, as base64 (or 'text:...', or null).
  const readFile = (path) => page.eval(`new Promise((resolve) => {
    const req = indexedDB.open('smitten');
    req.onsuccess = () => {
      const all = req.result.transaction('entries').objectStore('entries').getAll();
      all.onsuccess = () => {
        const e = all.result.find((x) => x.path === ${JSON.stringify(path)});
        if (!e) return resolve(null);
        const d = e.data;
        if (typeof d === 'string') return resolve('text:' + d);
        const u8 = d instanceof Uint8Array ? d : new Uint8Array(d);
        let s = '';
        for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
        resolve(btoa(s));
      };
      all.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  })`);

  // A new, empty project.
  await page.goto(`${BASE}/`);
  await until(byText('.card .card-title', 'Empty'), 'the home screen');
  await click(`${byText('.card .card-title', 'Empty')}.closest('.card')`);
  await until(`document.querySelector('dialog[open] input')`, 'the name dialog');
  await page.eval(`(() => { const i = document.querySelector('dialog[open] input'); i.value = 'Sprite test'; i.dispatchEvent(new Event('input')); })()`);
  await click(`document.querySelector('dialog[open] button[type=submit]')`);
  await until(`document.querySelector('.titlebar')`, 'the editor');
  await sleep(800);

  // How to find it: the workspace button, and New > Sprite in the Files panel.
  const wsButton = `document.querySelector('.workspace-switch button[data-ws="paint"]')`;
  const label = await page.eval(`${wsButton}.textContent.trim() + ' | ' + ${wsButton}.title`);
  check('the workspace is called Sprites and says it is the sprite editor', /^Sprites \|/.test(label) && /sprite editor/.test(label), label);
  await click(`${byText('button', 'New')}`);
  await until(menuItem('Sprite'), 'the New menu');
  check('New in the Files panel has Sprite', true);
  await click(menuItem('Sprite'));
  await until(`${spr}?.querySelector('.spr-canvas')`, 'the sprite editor');
  check('New > Sprite opens the sprite editor', await page.eval(`!document.querySelector('.workspace[data-ws="paint"]').hidden`));
  check('the new tab is a new sprite', await page.eval(`!!${byText('.workspace[data-ws="paint"] .doc-tab .doc-name', 'New sprite')}`));
  check('New > Sprite opens one tab', await page.eval(`document.querySelectorAll('.workspace[data-ws="paint"] .doc-tab').length`) === 1,
    await page.eval(`document.querySelectorAll('.workspace[data-ws="paint"] .doc-tab').length`));
  await sleep(600);

  // Two strokes, 0.6 seconds apart. The editor saves 0.9 seconds after the
  // first one, while the second one (2 seconds long) is still drawn.
  const [cl, ct, cw, chh] = await rect(`${spr}.querySelector('.spr-canvas')`);
  const zoom = parseFloat(await page.eval(`${spr}.querySelector('.spr-zoom-label').textContent`)) / 100;
  const cx = cl + cw / 2, cy = ct + chh / 2;
  const half = 100 * zoom; // the strokes go from 100 pixels left of the middle to 100 right of it
  const stroke = async (y, steps, pause) => {
    await mouse('mouseMoved', cx - half, y, 0);
    await mouse('mousePressed', cx - half, y);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', cx - half + (2 * half * i) / steps, y);
      await sleep(pause);
    }
    await mouse('mouseReleased', cx + half, y, 0);
  };
  await stroke(cy - 60 * zoom, 20, 10);
  await sleep(600);
  await stroke(cy + 60 * zoom, 50, 40);
  await sleep(2500);
  await shot('strokes');
  const saved = await page.eval(`document.querySelector('.workspace[data-ws="paint"] .doc-tab[aria-selected="true"]').title`);
  check('the sprite is saved as sprites/sprite.png', saved === 'sprites/sprite.png', saved);
  const b64 = await readFile(saved);
  if (check('the file is a PNG', b64 && !b64.startsWith('text:'))) {
    const img = await decodePNG(Buffer.from(b64, 'base64'));
    const row = (y) => {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3] > 128) { if (x0 < 0) x0 = x; x1 = x; }
      return [x0, x1];
    };
    const midX = img.width / 2;
    const [a0, a1] = row(Math.round(img.height / 2 - 60));
    const [b0, b1] = row(Math.round(img.height / 2 + 60));
    check('the first stroke is all there', a0 >= 0 && a0 <= midX - 95 && a1 >= midX + 95, `${a0}-${a1}`);
    check('the second stroke goes on after the save (it is all there)', b0 >= 0 && b0 <= midX - 95 && b1 >= midX + 95, `${b0}-${b1}`);
  }
  check('the tab is saved (no dot)', await page.eval(`!document.querySelector('.workspace[data-ws="paint"] .doc-tab[aria-selected="true"] .dirty-dot')`));

  // How much a stroke draws (counted by the editor, so this does not depend
  // on the speed of the machine): only the changed part of the image, never
  // all of it, and not the marks over it; nothing at all outside the image.
  const stats = () => page.eval(`JSON.stringify(${spr}.sprStats)`).then(JSON.parse);
  const key = async (k, code, vk, modifiers = 0) => {
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const frame = () => page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await page.eval(`${spr}.focus()`);
  await key('m', 'KeyM', 77);
  await mouse('mouseMoved', cx - 80 * zoom, cy - 80 * zoom, 0);
  await mouse('mousePressed', cx - 80 * zoom, cy - 80 * zoom);
  await mouse('mouseMoved', cx + 80 * zoom, cy + 80 * zoom);
  await mouse('mouseReleased', cx + 80 * zoom, cy + 80 * zoom, 0);
  await key('b', 'KeyB', 66);
  const counted = async (x0, y0, x1, y1) => {
    await mouse('mouseMoved', x0, y0, 0);
    await mouse('mousePressed', x0, y0);
    await frame();
    const a = await stats();
    for (let i = 1; i <= 30; i++) { await mouse('mouseMoved', x0 + ((x1 - x0) * i) / 30, y0 + ((y1 - y0) * i) / 30); await sleep(10); }
    await frame();
    const b = await stats();
    await mouse('mouseReleased', x1, y1, 0);
    return { full: b.fullDraws - a.fullDraws, part: b.partDraws - a.partDraws, marks: b.overlayDraws - a.overlayDraws };
  };
  const inSel = await counted(cx - 60 * zoom, cy, cx + 60 * zoom, cy + 20 * zoom);
  check('a stroke in a selection draws only the changed part', inSel.full === 0 && inSel.part > 0, inSel);
  check('a stroke in a selection does not draw the selection outline again', inSel.marks === 0, inSel);
  await page.eval(`${spr}.focus()`);
  await key('d', 'KeyD', 68, 2);
  const dot = `document.querySelector('.workspace[data-ws="paint"] .doc-tab[aria-selected="true"] .dirty-dot')`;
  await until(`!${dot}`, 'the save of the stroke before');
  const outside = await counted(cl + 10, ct + 10, cl + 200, ct + 14);
  check('a stroke outside the image draws nothing', outside.full === 0 && outside.part === 0 && outside.marks === 0, outside);
  await sleep(100);
  check('a stroke outside the image changes nothing (the tab stays saved)', await page.eval(`!${dot}`));

  // Moving a selection moves an element: nothing is drawn again. Panning
  // copies the kept image: the image is not drawn again either.
  await page.eval(`${spr}.focus()`);
  await key('m', 'KeyM', 77);
  await mouse('mouseMoved', cx - 50 * zoom, cy - 50 * zoom, 0);
  await mouse('mousePressed', cx - 50 * zoom, cy - 50 * zoom);
  await mouse('mouseMoved', cx + 50 * zoom, cy + 50 * zoom);
  await mouse('mouseReleased', cx + 50 * zoom, cy + 50 * zoom, 0);
  await frame();
  await mouse('mouseMoved', cx, cy, 0);
  await mouse('mousePressed', cx, cy);
  await mouse('mouseMoved', cx + 2, cy + 1);
  await frame();
  const m0 = await stats();
  for (let i = 1; i <= 20; i++) { await mouse('mouseMoved', cx + 2 + i * 3, cy + 1 + i * 2); await sleep(10); }
  await frame();
  const m1 = await stats();
  await mouse('mouseReleased', cx + 62, cy + 41, 0);
  const moveDraws = { full: m1.fullDraws - m0.fullDraws, part: m1.partDraws - m0.partDraws, image: m1.imageDraws - m0.imageDraws + m1.cacheDraws - m0.cacheDraws };
  check('moving a selection draws nothing again', moveDraws.full === 0 && moveDraws.part === 0 && moveDraws.image === 0, moveDraws);
  await page.eval(`${spr}.focus()`);
  await key('Escape', 'Escape', 27);
  await frame();
  const pan = async () => {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'middle', buttons: 4, clickCount: 1 });
    await frame();
    const a = await stats();
    for (let i = 1; i <= 20; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 4, y: cy + i * 2, button: 'middle', buttons: 4 }); await sleep(10); }
    await frame();
    const b = await stats();
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 80, y: cy + 40, button: 'middle', buttons: 0, clickCount: 1 });
    return { frames: b.fullDraws - a.fullDraws, image: b.imageDraws - a.imageDraws, cache: b.cacheDraws - a.cacheDraws };
  };
  // Zoomed out (below 100% the image is smoothed, which is slow to draw).
  await page.eval(`${spr}.focus()`);
  await key('-', 'Minus', 189);
  await frame();
  const panned = await pan();
  check('zoomed out, panning copies the kept image (the image is not drawn again)', panned.frames > 0 && panned.image === 0 && panned.cache === 0, panned);
  await key('0', 'Digit0', 48);

  // The menu of an image in the Files panel says where it opens.
  const row = (p) => `[...document.querySelectorAll('.tree-row')].find((r) => r.dataset.path === ${JSON.stringify(p)})`;
  if (!await page.eval(`!!${row(saved)}`)) await click(row('sprites'));
  await until(row(saved), 'the file in the Files panel');
  await page.eval(`(() => { const r = ${row(saved)}.getBoundingClientRect(); ${row(saved)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })); })()`);
  await until(`document.querySelector('.menu')`, 'the file menu');
  check('the menu of an image says "Open in the sprite editor"', await page.eval(`!!${menuItem('Open in the sprite editor')}`));
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });

  check('no errors in the page', problems.length === 0, problems.join('\n'));
} catch (e) {
  check('the test ran to the end', false, e.message || e);
  if (problems.length) console.log(problems.join('\n'));
} finally {
  page?.close();
  server.kill();
}
console.log(`DONE ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
