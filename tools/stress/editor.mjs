// Times the editor with a big project, in a headless Chrome: opening it,
// selecting in the Scene panel, scrolling it, dragging in the scene view,
// changing a number in the Inspector, painting tiles, typing in a long
// script and running the game with live tweaking on.
//
//   python3 serve.py 8770 & python3 tools/stress/gen.py editor-big
//   node tools/stress/editor.mjs [scenario ...]
//
// Each interaction is real input (the DevTools protocol's mouse and keys).
// "ms" is main-thread time per interaction (Chrome's TaskDuration: script,
// style, layout and paint), so it doesn't depend on the display's refresh.

import { launch, sleep, topFunctions } from './run.mjs';

const BASE = process.env.BASE || 'http://localhost:8770';
const GAME = process.env.GAME || 'editor-big';

async function metrics(page) {
  const { metrics: m } = await page.send('Performance.getMetrics');
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
}

// Main-thread ms per call of fn, over n calls with a pause after each.
async function perInteraction(page, n, fn, pause = 40) {
  const m0 = await metrics(page);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await fn(i);
    await sleep(pause);
  }
  const m1 = await metrics(page);
  const wall = Date.now() - t0;
  return {
    ms: round((m1.TaskDuration - m0.TaskDuration) * 1000 / n),
    scriptMs: round((m1.ScriptDuration - m0.ScriptDuration) * 1000 / n),
    layoutMs: round(((m1.LayoutDuration - m0.LayoutDuration) + (m1.RecalcStyleDuration - m0.RecalcStyleDuration)) * 1000 / n),
    busy: `${Math.round((m1.TaskDuration - m0.TaskDuration) * 100000 / wall)}%`,
  };
}

const round = (v) => Math.round(v * 10) / 10;

function mouse(page) {
  const ev = (type, x, y, extra = {}) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  return {
    click: async (x, y) => {
      await ev('mouseMoved', x, y, { button: 'none' });
      await ev('mousePressed', x, y);
      await ev('mouseReleased', x, y);
    },
    down: (x, y) => ev('mousePressed', x, y),
    move: (x, y) => ev('mouseMoved', x, y, { buttons: 1 }),
    up: (x, y) => ev('mouseReleased', x, y),
    wheel: (x, y, dy) => page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy }),
  };
}

async function key(page, k, code, keyCode, text) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode, text });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode });
}

async function rect(page, selector, index = 0) {
  return page.eval(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
}

// The length of the saved Tiles map's cells, to see that painting did something.
function mapCells(page) {
  return page.eval(`(async () => {
    const store = await import('./fs-store.js');
    const id = new URLSearchParams(location.hash.slice(1)).get('project');
    const text = await store.readFile(id, 'scenes/main.scene');
    const scene = JSON.parse(typeof text === 'string' ? text : new TextDecoder().decode(text));
    return scene.root.children.find((c) => c.name === 'Map').properties.cells.data.length;
  })()`);
}

// The Scene panel's rows that are on screen: [{x, cy}].
function visibleRows(page) {
  return page.eval(`(() => {
    const box = document.querySelector('.scene-tree').parentElement.getBoundingClientRect();
    return [...document.querySelectorAll('.node-row')].map((el) => el.getBoundingClientRect())
      .filter((r) => r.top >= box.top && r.bottom <= box.bottom).map((r) => ({ x: r.x, cy: r.y + r.height / 2 }));
  })()`);
}

async function waitFor(page, expr, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.eval(expr).catch(() => false)) return Date.now() - t0;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${expr}`);
}

async function openProject(page) {
  await page.send('Performance.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${BASE}/index.html`);
  await waitFor(page, `document.readyState === 'complete'`);
  await sleep(500);
  const id = await page.eval(`(async () => {
    const store = await import('./fs-store.js');
    const { unzipToProjectFiles } = await import('./exporter.js');
    const bytes = new Uint8Array(await (await fetch('/stress/${GAME}.love')).arrayBuffer());
    const p = await store.createProject('${GAME}', await unzipToProjectFiles(bytes));
    return p.id;
  })()`);
  const m0 = await metrics(page);
  const t0 = Date.now();
  await page.eval(`location.hash = 'project=${id}'`);
  await waitFor(page, `document.querySelectorAll('.node-row').length > 100`, 60000);
  const openMs = Date.now() - t0;
  await sleep(1000);
  const m1 = await metrics(page);
  const rows = await page.eval(`document.querySelectorAll('.node-row').length`);
  return { openMs, openTaskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000), rows, heapMB: round(m1.JSHeapUsedSize / 1048576) };
}

const scenarios = {
  async dump(page) {
    return page.eval(`({ trees: document.querySelectorAll('.scene-tree').length, rows: document.querySelectorAll('.node-row').length, hash: location.hash, active: document.activeElement?.className, ws: [...document.querySelectorAll('.workspace')].map((w) => w.dataset.ws + (w.hidden ? '-' : '+')).join(' '), toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ') })`);
  },

  async idle(page) {
    return perInteraction(page, 1, () => sleep(3000), 0);
  },

  async select(page) {
    const m = mouse(page);
    const rows = (await visibleRows(page)).slice(1);
    return perInteraction(page, rows.length, (i) => m.click(rows[i].x + 60, rows[i].cy), 350);
  },

  async scrollTree(page) {
    const m = mouse(page);
    const r = await rect(page, '.scene-tree');
    return perInteraction(page, 20, (i) => m.wheel(r.cx, r.y + 100, i < 10 ? 400 : -400), 60);
  },

  async dragView(page) {
    // Select a Sprite, frame it (F) so it's in the middle of the view, and drag it.
    const m = mouse(page);
    const idx = await page.eval(`[...document.querySelectorAll('.node-row')].findIndex((r) => r.textContent.trim().startsWith('Sprite'))`);
    const row = await rect(page, '.node-row', idx);
    await m.click(row.x + 60, row.cy);
    await sleep(300);
    const c = await rect(page, '.workspace:not([hidden]) canvas');
    await page.eval(`document.querySelector('.workspace:not([hidden]) canvas').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))`);
    await sleep(500);
    const before = await page.eval(`document.querySelector('.inspector .num-input')?.value`);
    await m.down(c.cx, c.cy);
    const r = await perInteraction(page, 30, (i) => m.move(c.cx + i * 4, c.cy - i * 2), 20);
    await m.up(c.cx + 120, c.cy - 60);
    await sleep(300);
    r.x = `${before} -> ${await page.eval(`document.querySelector('.inspector .num-input')?.value`)}`;
    return r;
  },

  async inspectorKeys(page) {
    // Type a new x into the Inspector and press Enter, 20 times.
    const m = mouse(page);
    const rows = await visibleRows(page);
    await m.click(rows[4].x + 60, rows[4].cy);
    await sleep(300);
    const r = await perInteraction(page, 20, async (i) => {
      const input = await rect(page, '.inspector .num-input');
      await m.click(input.cx, input.cy);
      await page.send('Input.insertText', { text: String(100 + i) });
      await key(page, 'Enter', 'Enter', 13, '\r');
    }, 100);
    r.x = await page.eval(`document.querySelector('.inspector .num-input')?.value`);
    return r;
  },

  async paintTiles(page) {
    const m = mouse(page);
    // Select the Tiles piece, frame it, pick a tile and paint across the map.
    const idx = await page.eval(`[...document.querySelectorAll('.node-row')].findIndex((r) => r.textContent.trim() === 'Map')`);
    const row = await rect(page, '.node-row', idx);
    await m.click(row.x + 60, row.cy);
    await sleep(500);
    const c = await rect(page, '.workspace:not([hidden]) canvas');
    await m.click(c.cx, c.y + 5); // focus the view (empty space at the top)
    await m.click(row.x + 60, row.cy);
    await sleep(300);
    await page.eval(`document.querySelector('.workspace:not([hidden]) canvas').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))`);
    await sleep(500);
    // Pick the first tile in the tile panel and the Paint tool.
    const palette = await rect(page, '.tmp-palette');
    if (!palette) return { error: 'no tile panel', html: await page.eval(`(document.querySelector('.tmp')?.outerHTML || document.querySelector('.selection-panel, [class*=selection]')?.outerHTML || 'none').slice(0, 300)`) };
    await m.click(palette.x + 8, palette.y + 8);
    await page.eval(`document.querySelector('.tmp-tool[aria-label="Paint"]').click()`);
    await sleep(300);
    const x0 = c.x + c.w * 0.2;
    const y0 = c.y + c.h * 0.4;
    const before = await mapCells(page);
    await m.down(x0, y0);
    const r = await perInteraction(page, 30, (i) => m.move(x0 + i * 12, y0 + (i % 5) * 8), 20);
    await m.up(x0 + 360, y0);
    await sleep(2500); // autosave
    r.cells = `${before} -> ${await mapCells(page)}`;
    return r;
  },

  async typeScript(page) {
    const m = mouse(page);
    // Open scripts/long.lua from the Files panel.
    await page.eval(`document.querySelector('.tree-row[data-path="scripts"]')?.click()`);
    await sleep(300);
    const opened = await page.eval(`(() => { const el = document.querySelector('.tree-row[data-path="scripts/long.lua"]'); el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return !!el; })()`);
    await sleep(1500);
    const cm = await rect(page, '.cm-content');
    if (!opened || !cm) return { error: 'could not open the script' };
    await m.click(cm.x + 40, cm.y + 40);
    await sleep(200);
    const text = 'local x = 1 + 2  -- typing';
    return perInteraction(page, text.length, (i) => page.send('Input.insertText', { text: text[i] }), 30);
  },

  async live(page) {
    // Play, then measure the editor's frames while the game runs with Live on.
    await page.eval(`document.querySelector('.play-btn.primary').click()`);
    await waitFor(page, `document.querySelectorAll('.node-row').length > 100 && !!document.querySelector('.live-banner:not([hidden])')`, 60000);
    await sleep(3000);
    const idle = await perInteraction(page, 1, () => sleep(5000), 0);
    const m = mouse(page);
    const rows = (await visibleRows(page)).slice(1);
    const select = await perInteraction(page, rows.length, (i) => m.click(rows[i].x + 60, rows[i].cy), 100);
    return { idle, select };
  },
};

async function main() {
  const args = process.argv.slice(2);
  const profile = args.includes('--profile');
  const names = args.filter((a) => !a.startsWith('--'));
  const page = await launch();
  const errors = [];
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  try {
    console.log('open', JSON.stringify(await openProject(page)));
    if (profile) await page.send('Profiler.enable');
    for (const name of names.length ? names : Object.keys(scenarios).filter((n) => n !== 'dump')) {
      try {
        if (profile) await page.send('Profiler.start');
        console.log(name, JSON.stringify(await scenarios[name](page)));
        if (profile) console.log(topFunctions((await page.send('Profiler.stop')).profile, true).join('\n'));
      } catch (e) {
        console.log(name, 'failed:', e.message);
      }
    }
  } finally {
    for (const e of errors.slice(0, 10)) console.log('page error:', e.split('\n').slice(0, 3).join(' | '));
    page.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
