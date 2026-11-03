// Screenshots for the docs (docs/images/*.webp), taken from the real
// editor in headless Chrome so they can be taken again whenever the UI
// changes:
//
//   python3 serve.py            (the editor on http://localhost:8766)
//   node tools/docs-shots.mjs [--base http://localhost:8766]
//   node tools/gen-docs.mjs     (copies them into the docs site)
//
// Each shot is a step of docs/getting-started.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './stress/run.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs/images');
const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:8766';
const W = 1280;
const H = 800;

mkdirSync(out, { recursive: true });
const page = await launch();
await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

const until = async (expr, what, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.eval(`!!(${expr})`)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** A rectangle of the page (CSS pixels), or the whole window. */
const rectOf = (selectorExpr, pad = 0) => page.eval(`(() => {
  const r = (${selectorExpr}).getBoundingClientRect();
  return { x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top - ${pad}), width: Math.min(${W}, r.width + ${pad * 2}), height: Math.min(${H}, r.height + ${pad * 2}) };
})()`);

async function shot(name, clip = null) {
  await sleep(450); // let animations settle
  const params = { format: 'webp', quality: 86, captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: 1 };
  const { data } = await page.send('Page.captureScreenshot', params);
  writeFileSync(join(out, `${name}.webp`), Buffer.from(data, 'base64'));
  console.log(`docs/images/${name}.webp`);
}

const click = (expr) => page.eval(`(${expr}).click()`);
const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`;
const key = async (k, code, keyCode, modifiers = 0) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode, modifiers });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode, modifiers });
};

try {
  // 1. Home, then a new Platformer game.
  // Fresh editor settings, pointed at the real sharing site.
  await page.goto(`${BASE}/`);
  await page.eval(`localStorage.setItem('smitten-editor.settings', JSON.stringify({ platformUrl: 'https://games.mostlime.hackclub.app' }))`);
  await page.goto(`${BASE}/`);
  await until(`${byText('.card .card-title', 'Platformer')}`, 'the home screen');
  await shot('home');
  await click(`${byText('.card .card-title', 'Platformer')}.closest('.card')`);
  await until(`document.querySelector('dialog[open] input')`, 'the name dialog');
  await page.eval(`(() => { const i = document.querySelector('dialog[open] input'); i.value = 'Coin Rush'; i.dispatchEvent(new Event('input')); })()`);
  await click(`document.querySelector('dialog[open] button[type=submit]')`);
  await until(`document.querySelector('.titlebar') && document.querySelector('.v2d-canvas')`, 'the editor');
  await sleep(1500);

  // The tour: numbered labels on the five areas.
  await page.eval(`(() => {
    const stackOf = (title) => [...document.querySelectorAll('.dock-tab')].find((t) => t.textContent.trim().startsWith(title))?.closest('.dock-stack');
    const areas = [stackOf('Scene'), document.querySelector('.workspace-area'), stackOf('Inspector'), stackOf('Files'), stackOf('Output')];
    areas.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const b = document.createElement('div');
      b.className = 'docs-badge';
      b.textContent = String(i + 1);
      Object.assign(b.style, {
        position: 'fixed', left: (r.right - 52) + 'px', top: (r.top + 44) + 'px', zIndex: 9999,
        width: '36px', height: '36px', borderRadius: '50%', background: '#e5487a', color: '#fff',
        font: '700 18px system-ui', display: 'grid', placeItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,.45)', border: '2px solid #fff',
      });
      document.body.append(b);
    });
  })()`);
  await shot('editor-tour');
  await page.eval(`document.querySelectorAll('.docs-badge').forEach((b) => b.remove())`);

  // 2. Playing.
  await click(`document.querySelector('.play-btn.primary')`);
  await until(`!document.querySelector('.game-view')?.hidden`, 'the game view');
  await sleep(4500);
  await shot('playing', await rectOf(`document.querySelector('.workspace-area')`));
  await click(`document.querySelector('.play-btn.stop')`);
  await sleep(800);

  // 3. The player's script variables.
  await click(`${byText('.node-row .node-name', 'Player')}`);
  await sleep(500);
  await page.eval(`(() => {
    const s = [...document.querySelectorAll('.insp-section > summary')].find((x) => /script variables/i.test(x.textContent));
    if (s) { s.parentElement.open = true; s.scrollIntoView({ block: 'start' }); }
  })()`);
  await shot('inspector', await rectOf(`[...document.querySelectorAll('.dock-tab')].find((t) => t.textContent.trim().startsWith('Inspector')).closest('.dock-stack')`, 6));

  // 5. The enemy's script, with the tutorial's addition.
  await click(`${byText('.workspace-switch button', 'Script')}`);
  await sleep(600);
  await page.eval(`(() => {
    const row = [...document.querySelectorAll('.tree-row')].find((r) => r.textContent.trim() === 'scripts');
    if (row && !row.nextElementSibling?.textContent.includes('patrol.lua')) row.click();
  })()`);
  await sleep(400);
  await click(`[...document.querySelectorAll('.tree-row')].find((r) => r.textContent.trim().startsWith('patrol.lua'))`);
  await until(`document.querySelector('.cm-content')`, 'the code editor');
  await page.eval(`document.querySelector('.cm-content').focus()`);
  await key('End', 'End', 35, process.platform === 'darwin' ? 4 : 2); // to the end of the file
  await page.send('Input.insertText', { text: '\n\nfunction ready()\n  root():on("collected", function()\n    speed += 20\n  end)\nend\n' });
  await sleep(600);
  await shot('script', await rectOf(`document.querySelector('.workspace-area')`));

  // 6. Publishing.
  await click(`document.querySelector('.publish-btn')`);
  await until(`document.querySelector('dialog[open]')`, 'the publish dialog');
  await shot('publish', await rectOf(`document.querySelector('dialog[open]')`, 16));
} finally {
  page.close();
}
