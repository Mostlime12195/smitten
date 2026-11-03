// A stand-alone page for the image editor: mounts the tool the way
// tool-host.js does (one instance per open file, a host object per file),
// on an in-memory file map with a few sample files. Serve web/ and open
// /editor/tools/sprite/harness.html (?open=<path> picks the first file).
//
// For scripted checks, window.harness has the file map and open/save/reopen.

import * as ui from '../../ui.js';
import { parseManifest } from '../../project.js';
import tool from './index.js';
import { encodePNGSync, decodePNG } from './png.js';

const files = new Map(); // path -> Uint8Array (binary) or string (text)
const open = new Map(); // path -> {instance, dirty}
let active = null;
const container = document.getElementById('tools');
const logEl = document.getElementById('log');

function log(msg) {
  logEl.textContent = `${msg}\n${logEl.textContent}`.slice(0, 4000);
}

// ---------------------------------------------------------------------------
// Sample files

function image(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      if (c) data.set(c, (y * w + x) * 4);
    }
  }
  return data;
}

/** A sheet of `count` 32×32 frames: a ball bouncing across. */
function heroSheet(count) {
  const fw = 32, fh = 32;
  return image(fw * count, fh, (x, y) => {
    const f = Math.floor(x / fw), lx = x % fw;
    const cx = 16, cy = 10 + Math.abs(Math.sin((f / count) * Math.PI)) * -6 + f * 3;
    const d = Math.hypot(lx + 0.5 - cx, y + 0.5 - cy);
    if (d < 7) return [233, 92, 70, 255];
    if (y >= 28) return [70, 90, 120, 255];
    return null;
  });
}

function seed() {
  files.set('smitten.json', `${JSON.stringify({ format: 'smitten.project', version: 1, name: 'Harness', display: { width: 1280, height: 720 } }, null, 2)}\n`);
  // A new image, as the editor's "New sprite" makes it.
  for (const [p, data] of Object.entries(tool.newAssets[0].files('sprites/new'))) files.set(p, data);
  // A sprite sheet with a .sprite file.
  files.set('sprites/hero.png', encodePNGSync(heroSheet(4), 128, 32));
  files.set('sprites/hero.sprite', `${JSON.stringify({
    format: 'smitten.sprite', version: 1, image: 'hero.png', frameWidth: 32, frameHeight: 32, origin: [16, 32],
    animations: { idle: { frames: [0, 1], fps: 4, loop: true }, bounce: { frames: [0, 1, 2, 3], fps: 8 } },
  }, null, 2)}\n`);
  // An older sprite whose sidecar is still called .sprite.json.
  files.set('sprites/old.png', encodePNGSync(image(32, 16, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [56, 183, 100, 255] : null), 32, 16));
  files.set('sprites/old.sprite.json', `${JSON.stringify({ format: 'smitten.sprite', version: 1, image: 'old.png', frameWidth: 16, frameHeight: 16, animations: { blink: { frames: [0, 1], fps: 2 } } }, null, 2)}\n`);
  // A smooth, larger picture.
  files.set('art/sky.png', encodePNGSync(image(640, 360, (x, y) => [40 + (y * 120) / 360, 80 + (y * 100) / 360, 160 + (x * 60) / 640, 255]), 640, 360));
}

// ---------------------------------------------------------------------------
// Tool hosting (the same host object tool-host.js builds)

function createHost(path) {
  return {
    path,
    read: (p) => files.get(p),
    write: async (p, data) => {
      files.set(p, data);
      log(`wrote ${p} (${data.length} ${typeof data === 'string' ? 'chars' : 'bytes'})`);
      renderFiles();
      for (const [q, e] of open) {
        if (q !== path) try { e.instance.reload?.(p); } catch (err) { console.error(err); }
      }
    },
    exists: (p) => files.has(p),
    list: () => [...files.keys()],
    setDirty: (dirty) => {
      const e = open.get(path);
      if (!e || e.dirty === !!dirty) return;
      e.dirty = !!dirty;
      renderFiles();
    },
    project: () => parseManifest(files.get('smitten.json')),
    palette: () => parseManifest(files.get('smitten.json')).palette,
    synth: async () => null,
    toast: (message, opts) => ui.toast(message, opts),
    openFile: (p) => show(p),
    ui,
  };
}

function show(path) {
  let e = open.get(path);
  if (!e) {
    if (!tool.match(path)) { log(`no tool opens ${path}`); return false; }
    const instance = tool.open(createHost(path));
    e = { instance, dirty: false };
    instance.element.classList.add('tool-root');
    open.set(path, e);
    container.append(instance.element);
  }
  for (const [p, other] of open) {
    if (p !== path && !other.instance.element.hidden) { other.instance.element.hidden = true; other.instance.hide?.(); }
  }
  e.instance.element.hidden = false;
  active = path;
  e.instance.show?.();
  e.instance.focus?.();
  renderFiles();
  return true;
}

function close(path) {
  const e = open.get(path);
  if (!e) return;
  open.delete(path);
  e.instance.destroy?.();
  e.instance.element.remove();
  if (active === path) active = null;
}

async function save(path = active) {
  const e = open.get(path);
  if (!e) return false;
  await e.instance.save();
  e.dirty = false;
  renderFiles();
  log(`saved ${path}`);
  return true;
}

/** Close the active file and open it again from the file map (what a fresh session would see). */
async function reopen(path = active) {
  if (!path) return null;
  close(path);
  show(path);
  await open.get(path).instance.ready;
  return open.get(path).instance;
}

function renderFiles() {
  const list = document.getElementById('files');
  list.replaceChildren(...[...files.keys()].sort().map((p) => {
    const data = files.get(p);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${p === active ? 'active' : ''} ${open.get(p)?.dirty ? 'dirty' : ''}`;
    const name = document.createElement('span');
    name.textContent = p;
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = `${data.length}`;
    b.append(name, size);
    b.addEventListener('click', () => show(p));
    li.append(b);
    return li;
  }));
}

document.getElementById('save').addEventListener('click', () => save());
document.getElementById('reopen').addEventListener('click', () => reopen());
document.getElementById('theme').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

seed();
renderFiles();
show(new URLSearchParams(location.search).get('open') || 'sprites/new.png');

window.harness = {
  files, open, show, save, reopen, close, decodePNG,
  get active() { return active; },
  get editor() { return open.get(active)?.instance; },
};
