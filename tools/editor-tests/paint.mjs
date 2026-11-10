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
  await click(`[...${spr}.querySelectorAll('.spr-seg button')].find((b) => b.textContent.trim() === 'Smooth')`);
  await shot('pen');

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
