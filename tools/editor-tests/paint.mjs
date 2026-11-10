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
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../stress/run.mjs';
import { decodePNG, encodePNGSync } from '../../web/editor/tools/sprite/png.js';
import { nearestIndex } from '../../web/editor/tools/sprite/palette.js';
import { hexToRgba } from '../../web/editor/tools/sprite/draw.js';
import { tmpdir } from 'node:os';

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

  // A pen, with synthetic input only (no real tablet here): pressure, the
  // eraser end, the side button, palm rejection, and a pinch with two fingers.
  await click(`document.querySelector('.workspace[data-ws="paint"] .doc-new')`);
  await sleep(600);
  await page.eval(`${spr}.focus()`);
  await key('0', 'Digit0', 48);
  await frame();
  const z2 = parseFloat(await page.eval(`${spr}.querySelector('.spr-zoom-label').textContent`)) / 100;
  check('pen: a smooth brush has pressure on size by default', await page.eval(`${spr}.querySelector('.spr-pen-btn').dataset.mode`) === 'size');
  const pen = (type, x, y, force, button = 'left', buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : button, buttons, clickCount: 1, pointerType: 'pen', force, tiltX: 10, tiltY: -5 });
  const penStroke = async (y, force) => {
    await pen('mouseMoved', cx - 80 * z2, y, 0, 'none', 0);
    await pen('mousePressed', cx - 80 * z2, y, force);
    for (let i = 1; i <= 20; i++) { await pen('mouseMoved', cx - 80 * z2 + (160 * z2 * i) / 20, y, force); await sleep(10); }
    await pen('mouseReleased', cx + 80 * z2, y, 0, 'left', 0);
  };
  const mouseStroke = async (y) => {
    await mouse('mouseMoved', cx - 80 * z2, y, 0);
    await mouse('mousePressed', cx - 80 * z2, y);
    for (let i = 1; i <= 20; i++) { await mouse('mouseMoved', cx - 80 * z2 + (160 * z2 * i) / 20, y); await sleep(10); }
    await mouse('mouseReleased', cx + 80 * z2, y, 0);
  };
  await penStroke(cy - 60 * z2, 0.1);
  await penStroke(cy, 1);
  await mouseStroke(cy + 60 * z2);
  await frame();
  // The opaque runs down one column of the image (from the frame's thumbnail canvas).
  const runs = (x) => page.eval(`(() => {
    const c = ${spr}.querySelector('.spr-frame.current canvas');
    const d = c.getContext('2d').getImageData(${x}, 0, 1, c.height).data;
    const out = []; let start = -1;
    for (let y = 0; y <= c.height; y++) {
      const on = y < c.height && d[y * 4 + 3] > 128;
      if (on && start < 0) start = y;
      if (!on && start >= 0) { out.push([start, y - start]); start = -1; }
    }
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  const W2 = await page.eval(`${spr}.querySelector('.spr-frame.current canvas').width`);
  const col = await runs(Math.round(W2 / 2));
  check('pen: three lines', col.length === 3, col);
  if (col.length === 3) {
    const [light, heavy, mouseLine] = col.map((r) => r[1]);
    check('pen: a light touch draws a thinner line than full pressure', light < heavy && light <= 4, { light, heavy });
    check('pen: full pressure is the full brush size, the same as the mouse', Math.abs(heavy - mouseLine) <= 1, { heavy, mouseLine });
    check('mouse: the line has the full brush size (8 pixels)', mouseLine >= 7 && mouseLine <= 10, mouseLine);
  }
  // The eraser end of the pen (button 5, buttons 32), as synthetic pointer events.
  await page.eval(`(() => {
    const c = ${spr}.querySelector('.spr-canvas');
    const ev = (type, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'pen', isPrimary: true,
      button: type === 'pointermove' ? -1 : 5, buttons, pressure: buttons ? 1 : 0, clientX: ${cx + 40 * z2}, clientY: y }));
    ev('pointerdown', ${cy - 90 * z2}, 32);
    for (let i = 1; i <= 18; i++) ev('pointermove', ${cy - 90 * z2} + i * ${10 * z2}, 32);
    ev('pointerup', ${cy + 90 * z2}, 0);
  })()`);
  await frame();
  check('pen: the eraser end erases (with the brush tool picked)', (await runs(Math.round(W2 / 2 + 40))).length === 0, await runs(Math.round(W2 / 2 + 40)));
  // The side button picks the color under the pen.
  await page.eval(`(() => { const i = ${spr}.querySelector('.spr-hex'); i.value = '#ff0000'; i.dispatchEvent(new Event('change')); })()`);
  await pen('mouseMoved', cx - 40 * z2, cy, 0, 'none', 0);
  await pen('mousePressed', cx - 40 * z2, cy, 0.5, 'right', 2);
  await pen('mouseReleased', cx - 40 * z2, cy, 0, 'right', 0);
  check('pen: the side button picks the color under it', await page.eval(`${spr}.querySelector('.spr-hex').value`) === '#000000', await page.eval(`${spr}.querySelector('.spr-hex').value`));
  // The eraser (and the eraser end) follow the pen's pressure on size too,
  // with the one Pen setting of the brush mode.
  const setSize = (n) => page.eval(`(() => { const i = ${spr}.querySelector('input.spr-num-field[aria-label="Size"]'); i.value = '${n}'; i.dispatchEvent(new Event('change')); })()`);
  const rowAlpha = (y) => page.eval(`(() => { const c = ${spr}.querySelector('.spr-frame.current canvas'); const d = c.getContext('2d').getImageData(0, ${y}, c.width, 1).data; const a = []; for (let x = 0; x < c.width; x++) a.push(d[x * 4 + 3]); return JSON.stringify(a); })()`).then(JSON.parse);
  const imgY = Math.round(W2 / 2 + 90); // a row below the three lines
  await setSize(30);
  await mouseStroke(cy + 90 * z2);
  await setSize(16);
  const eraseEnd = (x, force) => page.eval(`(() => {
    const c = ${spr}.querySelector('.spr-canvas');
    const ev = (type, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 78, pointerType: 'pen', isPrimary: true,
      button: type === 'pointermove' ? -1 : 5, buttons, pressure: buttons ? ${force} : 0, clientX: ${cx} + ${x} * ${z2}, clientY: y }));
    ev('pointerdown', ${cy + 70 * z2}, 32);
    for (let i = 1; i <= 10; i++) ev('pointermove', ${cy + 70 * z2} + i * ${4 * z2}, 32);
    ev('pointerup', ${cy + 110 * z2}, 0);
  })()`);
  await eraseEnd(-50, 0.1);
  await eraseEnd(50, 1);
  await key('e', 'KeyE', 69);
  await pen('mouseMoved', cx, cy + 70 * z2, 0, 'none', 0);
  await pen('mousePressed', cx, cy + 70 * z2, 0.1);
  for (let i = 1; i <= 10; i++) { await pen('mouseMoved', cx, cy + 70 * z2 + i * 4 * z2, 0.1); await sleep(10); }
  await pen('mouseReleased', cx, cy + 110 * z2, 0, 'left', 0);
  await key('b', 'KeyB', 66);
  await frame();
  {
    const row = await rowAlpha(imgY);
    const gap = (x) => row.slice(x - 14, x + 15).filter((a) => a < 128).length;
    const mid = Math.round(W2 / 2);
    const light = gap(mid - 50), heavy = gap(mid + 50), tool = gap(mid);
    check('pen: the eraser end follows pressure on size', light > 0 && light < heavy && heavy >= 14, { light, heavy });
    check('pen: the eraser tool follows pressure on size', tool > 0 && tool < heavy, { tool, heavy });
  }
  // Pressure on opacity: a light stroke at 100% opacity is light, and
  // going back over it in the same stroke does not make it darker.
  await click(`${spr}.querySelector('.spr-pen-btn')`);
  await until(menuItem('Opacity'), 'the Pen menu');
  await click(menuItem('Opacity'));
  check('pen: pressure on opacity is set', await page.eval(`${spr}.querySelector('.spr-pen-btn').dataset.mode`) === 'opacity');
  const yLight = cy + 30 * z2, yBack = cy + 45 * z2;
  await penStroke(yLight, 0.2);
  // There and back, in one stroke.
  await pen('mouseMoved', cx - 80 * z2, yBack, 0, 'none', 0);
  await pen('mousePressed', cx - 80 * z2, yBack, 0.2);
  for (let i = 1; i <= 20; i++) { await pen('mouseMoved', cx - 80 * z2 + (160 * z2 * i) / 20, yBack, 0.2); await sleep(8); }
  for (let i = 19; i >= 0; i--) { await pen('mouseMoved', cx - 80 * z2 + (160 * z2 * i) / 20, yBack, 0.2); await sleep(8); }
  await pen('mouseReleased', cx - 80 * z2, yBack, 0, 'left', 0);
  await frame();
  {
    const one = Math.max(...(await rowAlpha(Math.round(W2 / 2 + 30))).slice(Math.round(W2 / 2) - 40, Math.round(W2 / 2) + 40));
    const twice = Math.max(...(await rowAlpha(Math.round(W2 / 2 + 45))).slice(Math.round(W2 / 2) - 40, Math.round(W2 / 2) + 40));
    check('pen: a light stroke at 100% opacity is light (alpha below full)', one > 20 && one < 128, one);
    check('pen: going back over it in the same stroke does not add up', Math.abs(twice - one) <= 2, { one, twice });
  }
  // The brush outline shows the size that the pressure gives, while the pen paints.
  await click(`${spr}.querySelector('.spr-pen-btn')`);
  await until(menuItem('Size'), 'the Pen menu');
  await click(menuItem('Size'));
  await setSize(40);
  await pen('mouseMoved', cx - 60 * z2, cy - 100 * z2, 0, 'none', 0);
  await pen('mousePressed', cx - 60 * z2, cy - 100 * z2, 0.2);
  await pen('mouseMoved', cx - 50 * z2, cy - 100 * z2, 0.2);
  await frame();
  const wLight = await page.eval(`${spr}.querySelector('.spr-brush-outline').getBoundingClientRect().width`);
  await pen('mouseMoved', cx - 40 * z2, cy - 100 * z2, 1);
  await frame();
  const wHeavy = await page.eval(`${spr}.querySelector('.spr-brush-outline').getBoundingClientRect().width`);
  await pen('mouseReleased', cx - 40 * z2, cy - 100 * z2, 0, 'left', 0);
  await key('z', 'KeyZ', 90, 2);
  await setSize(8);
  check('pen: the brush outline follows the pressure', wLight > 5 && wLight < wHeavy * 0.5 && Math.abs(wHeavy - 40 * z2) <= 3, { wLight, wHeavy });

  // Palm rejection: right after the pen was near, a finger does not paint.
  const linesBefore = JSON.stringify(await runs(Math.round(W2 / 2)));
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await pen('mouseMoved', cx, cy + 100 * z2, 0, 'none', 0);
  const touch = (type, points) => page.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[cx - 60 * z2, cy + 90 * z2]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[cx - 60 * z2 + i * 12 * z2, cy + 90 * z2]]); await sleep(10); }
  await touch('touchEnd', []);
  await frame();
  check('palm rejection: a finger next to the pen paints nothing', JSON.stringify(await runs(Math.round(W2 / 2))) === linesBefore, await runs(Math.round(W2 / 2)));
  // Two fingers, with no pen near: a pinch zooms in.
  await sleep(1200);
  const zBefore = parseFloat(await page.eval(`${spr}.querySelector('.spr-zoom-label').textContent`));
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[cx - 40 - i * 10, cy], [cx + 40 + i * 10, cy]]); await sleep(16); }
  await touch('touchEnd', []);
  await sleep(300);
  const zAfter = parseFloat(await page.eval(`${spr}.querySelector('.spr-zoom-label').textContent`));
  check('touch: a pinch with two fingers zooms in', zAfter > zBefore * 1.5, { zBefore, zAfter });
  check('touch: a pinch paints nothing', JSON.stringify(await runs(Math.round(W2 / 2))) === linesBefore, await runs(Math.round(W2 / 2)));
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.eval(`${spr}.focus()`);
  await key('0', 'Digit0', 48); // the pinch zoomed in: fit again
  await frame();
  // Pixel brushes keep no pressure by default.
  await click(`[...${spr}.querySelectorAll('.spr-seg button')].find((b) => b.textContent.trim() === 'Pixel')`);
  check('pen: a pixel brush has no pressure by default', await page.eval(`${spr}.querySelector('.spr-pen-btn').dataset.mode`) === 'off');
  // Pixel brushes: Size turned on with the brush picked works for the eraser end too (one setting).
  await click(`${spr}.querySelector('.spr-pen-btn')`);
  await until(menuItem('Size'), 'the Pen menu');
  await click(menuItem('Size'));
  await setSize(30);
  await mouseStroke(cy - 100 * z2);
  await setSize(16);
  const eraseEndAt = (x, force) => page.eval(`(() => {
    const c = ${spr}.querySelector('.spr-canvas');
    const ev = (type, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 79, pointerType: 'pen', isPrimary: true,
      button: type === 'pointermove' ? -1 : 5, buttons, pressure: buttons ? ${force} : 0, clientX: ${cx} + ${x} * ${z2}, clientY: y }));
    ev('pointerdown', ${cy - 120 * z2}, 32);
    for (let i = 1; i <= 10; i++) ev('pointermove', ${cy - 120 * z2} + i * ${4 * z2}, 32);
    ev('pointerup', ${cy - 80 * z2}, 0);
  })()`);
  await eraseEndAt(-50, 0.1);
  await eraseEndAt(50, 1);
  await frame();
  {
    const row = await rowAlpha(Math.round(W2 / 2 - 100));
    const gap = (x) => row.slice(x - 14, x + 15).filter((a) => a < 128).length;
    const mid = Math.round(W2 / 2);
    check('pen: with pixel brushes, Size set on the brush works for the eraser end', gap(mid - 50) > 0 && gap(mid - 50) < gap(mid + 50) && gap(mid + 50) === 16, { light: gap(mid - 50), heavy: gap(mid + 50) });
  }
  // Pixel brush, 1 pixel, 100% opacity, pressure on opacity (pixel art with a
  // pen): a light stroke gives crisp pixels with partial alpha, also for the
  // eraser end. No antialiasing: one pixel wide.
  await click(`${spr}.querySelector('.spr-pen-btn')`);
  await until(menuItem('Opacity'), 'the Pen menu');
  await click(menuItem('Opacity'));
  await setSize(1);
  await penStroke(cy + 120 * z2, 0.3);
  await penStroke(cy + 125 * z2, 1);
  await frame();
  {
    const rowL = await rowAlpha(Math.round(W2 / 2 + 120)), rowH = await rowAlpha(Math.round(W2 / 2 + 125));
    const light = rowL[Math.round(W2 / 2)], heavy = rowH[Math.round(W2 / 2)];
    const colL = await rowAlpha(Math.round(W2 / 2 + 119));
    check('pixel brush: a light stroke at 100% opacity has partial alpha', light > 60 && light < 140, light);
    check('pixel brush: full pressure is full alpha', heavy === 255, heavy);
    check('pixel brush: the light stroke is one crisp pixel wide (no soft edge)', colL[Math.round(W2 / 2)] === 0, colL[Math.round(W2 / 2)]);
  }
  await setSize(4);
  await click(`${spr}.querySelector('.spr-pen-btn')`);
  await until(menuItem('Nothing'), 'the Pen menu');
  await click(menuItem('Nothing'));
  await mouseStroke(cy + 110 * z2);
  await click(`${spr}.querySelector('.spr-pen-btn')`);
  await until(menuItem('Opacity'), 'the Pen menu');
  await click(menuItem('Opacity'));
  await page.eval(`(() => {
    const c = ${spr}.querySelector('.spr-canvas');
    const ev = (type, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 80, pointerType: 'pen', isPrimary: true,
      button: type === 'pointermove' ? -1 : 5, buttons, pressure: buttons ? 0.3 : 0, clientX: ${cx}, clientY: y }));
    ev('pointerdown', ${cy + 100 * z2}, 32);
    for (let i = 1; i <= 10; i++) ev('pointermove', ${cy + 100 * z2} + i * ${2 * z2}, 32);
    ev('pointerup', ${cy + 120 * z2}, 0);
  })()`);
  await frame();
  {
    const a = (await rowAlpha(Math.round(W2 / 2 + 110)))[Math.round(W2 / 2)];
    check('pixel brush: a light press of the eraser end erases part of the alpha', a > 100 && a < 220, a);
  }
  await click(`[...${spr}.querySelectorAll('.spr-seg button')].find((b) => b.textContent.trim() === 'Smooth')`);
  await shot('pen');

  // ---------------------------------------------------------------------
  // Mirror drawing, layers, moving and turning a selection, palette lock.
  await click(`document.querySelector('.workspace[data-ws="paint"] .doc-new')`);
  await sleep(600);
  await page.eval(`${spr}.focus()`);
  await key('0', 'Digit0', 48);
  await frame();
  const z3 = parseFloat(await page.eval(`${spr}.querySelector('.spr-zoom-label').textContent`)) / 100;
  // The image's top-left corner on the screen (the fit puts it in the middle).
  const [il, it] = JSON.parse(await page.eval(`JSON.stringify((() => { const r = ${spr}.querySelector('.spr-canvas').getBoundingClientRect(); return [r.left + Math.round((r.width - 256 * ${z3}) / 2), r.top + Math.round((r.height - 256 * ${z3}) / 2)]; })())`));
  const at = (x, y) => [il + (x + 0.5) * z3, it + (y + 0.5) * z3];
  const pixel = (x, y) => page.eval(`[...${spr}.querySelector('.spr-frame.current canvas').getContext('2d').getImageData(${x}, ${y}, 1, 1).data]`);
  const line = async (x0, y0, x1, y1) => {
    const [a, b] = at(x0, y0), [c, d] = at(x1, y1);
    await mouse('mouseMoved', a, b, 0);
    await mouse('mousePressed', a, b);
    for (let i = 1; i <= 16; i++) { await mouse('mouseMoved', a + ((c - a) * i) / 16, b + ((d - b) * i) / 16); await sleep(8); }
    await mouse('mouseReleased', c, d, 0);
    await frame();
  };
  const setHex = (hex) => page.eval(`(() => { const i = ${spr}.querySelector('.spr-hex'); i.value = '${hex}'; i.dispatchEvent(new Event('change')); })()`);
  await key('b', 'KeyB', 66);
  await click(`${spr}.querySelector('button[title^="Mirror left and right"]')`);
  await line(40, 40, 40, 100);
  check('mirror: a stroke on the left also paints on the right', (await pixel(40, 70))[3] > 200 && (await pixel(215, 70))[3] > 200, [await pixel(40, 70), await pixel(215, 70)]);
  // Drag the handle of the mirror line (above the image) to x = 100.
  {
    const [hx] = at(128, 0);
    const hy = it - 14;
    await mouse('mouseMoved', il + 128 * z3, hy, 0);
    await mouse('mousePressed', il + 128 * z3, hy);
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', il + 128 * z3 - (28 * z3 * i) / 8, hy); await sleep(10); }
    await mouse('mouseReleased', il + 100 * z3, hy, 0);
    void hx;
  }
  await line(60, 120, 60, 160);
  check('mirror: the line moved to x = 100 mirrors x = 60 onto x = 139', (await pixel(139, 140))[3] > 200 && (await pixel(195, 140))[3] === 0, [await pixel(139, 140), await pixel(195, 140)]);
  await click(`${spr}.querySelector('button[title^="Mirror left and right"]')`);
  await shot('mirror');

  // A second layer, its opacity, hiding it, and undo.
  await click(`${spr}.querySelector('button[title="New layer over this one"]')`);
  await frame();
  check('layers: a new layer', await page.eval(`${spr}.querySelectorAll('.spr-layer').length`) === 2);
  await setHex('#ff0000');
  await line(20, 200, 236, 200);
  check('layers: red on the new layer', (await pixel(128, 200)).join() === '255,0,0,255', await pixel(128, 200));
  await page.eval(`(() => { const r = ${spr}.querySelector('input[aria-label="Layer opacity"]'); r.value = '50'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  await frame();
  const halfPx = await pixel(128, 200);
  check('layers: at 50% opacity the layer shows half', Math.abs(halfPx[3] - 128) <= 2 && halfPx[0] > 240, halfPx);
  await click(`${spr}.querySelector('.spr-layer.selected .spr-layer-eye')`);
  await frame();
  check('layers: a hidden layer does not show', (await pixel(128, 200))[3] === 0, await pixel(128, 200));
  await page.eval(`${spr}.focus()`);
  await key('z', 'KeyZ', 90, 2);
  await frame();
  check('layers: undo shows it again', Math.abs((await pixel(128, 200))[3] - 128) <= 2, await pixel(128, 200));
  await shot('layers');

  // Move a selection of the red line down, then turn a selection.
  await key('m', 'KeyM', 77);
  await line(20, 190, 60, 210);
  await line(40, 200, 40, 230);
  await key('Enter', 'Enter', 13);
  await frame();
  check('selection: the moved pixels are in their new place', Math.abs((await pixel(40, 230))[3] - 128) <= 2 && (await pixel(40, 200))[3] === 0, [await pixel(40, 230), await pixel(40, 200)]);
  await key('Escape', 'Escape', 27);
  await line(100, 195, 139, 204);
  await key('r', 'KeyR', 82);
  await frame();
  const status = await page.eval(`${spr}.querySelector('.spr-status').textContent`);
  check('selection: R turns a 40×10 selection into 10×40', /10×40 selected/.test(status), status);
  await key('Escape', 'Escape', 27);
  await frame();
  check('selection: Escape puts the turned pixels down', Math.abs((await pixel(119, 180))[3] - 128) <= 2 && (await pixel(100, 200))[3] === 0, [await pixel(119, 180), await pixel(100, 200)]);
  await key('z', 'KeyZ', 90, 2);
  await frame();
  check('selection: one undo takes the turn back', Math.abs((await pixel(100, 200))[3] - 128) <= 2, await pixel(100, 200));

  // Locked to the PICO-8 palette, on the first layer: an off-palette color paints its nearest palette color.
  await click(`[...${spr}.querySelectorAll('.spr-layer')].find((r) => r.textContent.includes('Layer 1'))`);
  await page.eval(`(() => { const s = ${spr}.querySelector('select[aria-label="Palette"]'); s.value = 'pico8'; s.dispatchEvent(new Event('change')); })()`);
  await click(`${spr}.querySelector('button[title^="Lock to the palette"]')`);
  await setHex('#3a5f8c');
  await key('b', 'KeyB', 66);
  await line(20, 240, 236, 240);
  const pico8 = ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'].map(hexToRgba);
  const want = pico8[nearestIndex(pico8, 0x3a, 0x5f, 0x8c)];
  const locked = await pixel(128, 240);
  check('palette lock: the stroke is the nearest palette color', locked[0] === want[0] && locked[1] === want[1] && locked[2] === want[2] && locked[3] === 255, { locked, want });
  const edge = await pixel(128, 236);
  check('palette lock: the soft edge is a palette color or transparent', edge[3] === 0 || (edge[3] === 255 && pico8.some((c) => c[0] === edge[0] && c[1] === edge[1] && c[2] === edge[2])), edge);
  await click(`${spr}.querySelector('button[title^="Lock to the palette"]')`);
  await shot('palette-lock');

  // Saved: the PNG is the layers flattened, and the .sprite file keeps the layers.
  const dot3 = `document.querySelector('.workspace[data-ws="paint"] .doc-tab[aria-selected="true"] .dirty-dot')`;
  await until(`!${dot3} && !document.querySelector('.workspace[data-ws="paint"] .doc-tab[aria-selected="true"]').classList.contains('untitled')`, 'the save of the layers', 15000);
  const layersPng = await page.eval(`document.querySelector('.workspace[data-ws="paint"] .doc-tab[aria-selected="true"]').title`);
  const layersMeta = layersPng.replace(/\.png$/, '.sprite');
  const metaText = await readFile(layersMeta);
  let meta = null;
  try { meta = JSON.parse(metaText.slice(5)); } catch { /* checked below */ }
  check('save: the .sprite file has the two layers, bottom first', meta?.layers?.length === 2 && meta.layers[1].name === 'Layer 2' && meta.layers[1].opacity === 0.5 && meta.layers.every((l) => l.image.startsWith('data:image/png;base64,')), metaText?.slice(0, 300));
  // The saved file reaches IndexedDB a moment after the save: wait for the last stroke in it.
  let flatPng = null;
  const fp = (x, y) => [...flatPng.data.subarray((y * flatPng.width + x) * 4, (y * flatPng.width + x) * 4 + 4)];
  for (let i = 0; i < 40; i++) {
    const b64 = await readFile(layersPng);
    if (b64 && !b64.startsWith('text:')) {
      flatPng = await decodePNG(Buffer.from(b64, 'base64'));
      if (fp(128, 240)[3] === 255) break;
    }
    await sleep(250);
  }
  check('save: the PNG (what the game draws) is the layers flattened', Math.abs(fp(40, 230)[3] - 128) <= 2 && fp(40, 230)[0] > 240 && fp(128, 240)[0] === want[0], [fp(40, 230), fp(128, 240)]);

  // ---------------------------------------------------------------------
  // Import a sprite sheet: 4 cells of 16×16, a margin of 1 and spacing of 1,
  // the third cell empty.
  const sheetFile = join(mkdtempSync(join(tmpdir(), 'smitten-sheet-')), 'walk-sheet.png');
  {
    const W = 2 + 4 * 16 + 3, H = 18;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cx = Math.floor((x - 1) / 17), inCell = x >= 1 && y >= 1 && y < 17 && (x - 1) % 17 < 16 && cx < 4;
        const c = !inCell ? [90, 90, 90, 255] : cx === 2 ? [0, 0, 0, 0] : [60 * (cx + 1), 200, 40 * cx, 255];
        d.set(c, (y * W + x) * 4);
      }
    }
    writeFileSync(sheetFile, encodePNGSync(d, W, H));
  }
  await click(`document.querySelector('.workspace[data-ws="paint"] .doc-new')`);
  await sleep(600);
  await click(`${spr}.querySelector('button[title^="More:"]')`);
  await until(menuItem('Import sprite sheet…'), 'the More menu');
  await click(menuItem('Import sprite sheet…'));
  await until(`document.querySelector('dialog[open] .spr-sheet-preview')`, 'the import dialog');
  {
    const { root } = await page.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'dialog[open] .spr-sheet-file' });
    await page.send('DOM.setFileInputFiles', { nodeId, files: [sheetFile] });
  }
  await until(`/cells of/.test(document.querySelector('dialog[open] .spr-form-note:last-of-type')?.textContent || [...document.querySelectorAll('dialog[open] .spr-form-note')].map((n) => n.textContent).join(' '))`, 'the sheet in the dialog', 8000);
  const setField = (label, v) => page.eval(`(() => { const i = document.querySelector('dialog[open] input[aria-label="${label}"]'); i.value = '${v}'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await setField('Frame width', 16);
  await setField('Frame height', 16);
  await setField('Margin', 1);
  await setField('Spacing', 1);
  const noteText = await page.eval(`[...document.querySelectorAll('dialog[open] .spr-form-note')].map((n) => n.textContent).join(' ')`);
  check('sheet: cut into 4 cells of 16×16, the empty one left out', /4×1 cells of 16×16\. 3 chosen/.test(noteText), noteText);
  const shown = await page.eval(`(() => { const s = document.querySelector('dialog[open] select[aria-label="Sheet image"]'); return s.options[s.selectedIndex].textContent; })()`);
  check('sheet: the list shows the file from the computer', shown === 'walk-sheet.png (from your computer)', shown);
  await shot('sheet-dialog');
  await click(`document.querySelector('dialog[open] button[type=submit]')`);
  await until(`!document.querySelector('dialog[open]')`, 'the dialog to close');
  await frame();
  check('sheet: the image has the 3 frames', await page.eval(`${spr}.querySelectorAll('.spr-frame').length`) === 3);
  check('sheet: the frame size is 16 × 16', (await page.eval(`${spr}.querySelector('.spr-size-btn').textContent`)).replace(/\s/g, '') === '16×16');
  check('sheet: an animation "walk" with the 3 frames', /walk/.test(await page.eval(`${spr}.querySelector('.spr-anim-list').textContent`)) && /3 frames/.test(await page.eval(`${spr}.querySelector('.spr-anim-list').textContent`)));
  const f1 = await page.eval(`[...${spr}.querySelectorAll('.spr-frame canvas')][1].getContext('2d').getImageData(8, 8, 1, 1).data.join()`);
  check('sheet: frame 1 has the second cell (no margin or spacing in it)', f1 === '120,200,40,255', f1);
  const dot4 = dot3;
  await until(`!${dot4} && !document.querySelector('.workspace[data-ws="paint"] .doc-tab[aria-selected="true"]').classList.contains('untitled')`, 'the save of the sheet', 15000);
  const sheetPng = await page.eval(`document.querySelector('.workspace[data-ws="paint"] .doc-tab[aria-selected="true"]').title`);
  let sm = {};
  for (let i = 0; i < 40 && !sm.animations; i++) {
    sm = JSON.parse((await readFile(sheetPng.replace(/\.png$/, '.sprite')) || 'text:{}').slice(5));
    if (!sm.animations) await sleep(250);
  }
  check('sheet: a normal .sprite file with the animation', sm.frameWidth === 16 && sm.frameHeight === 16 && JSON.stringify(sm.animations?.walk?.frames) === '[0,1,2]' && !sm.layers, sm);
  await shot('sheet-imported');

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
