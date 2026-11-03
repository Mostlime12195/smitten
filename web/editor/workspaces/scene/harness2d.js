// Test page for the 2D viewport and the TileMap panel: a fake project in
// memory (generated images, a tileset, a sprite, a font, two scenes) and a
// scene using every 2D and UI node type. Serve the repo root and open
// /web/editor/workspaces/scene/harness2d.html. window.H has everything for
// scripted checks.

import { setSchema, isA } from '../../core/schema.js';
import { SceneDoc } from '../../core/scene-doc.js';
import { Viewport2D } from './viewport2d.js';
import { TilesPanel } from './tilemap-panel.js';
import { decodeCells, encodeCells } from './cells.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class FakeProject extends EventTarget {
  constructor(files) {
    super();
    this.files = new Map(Object.entries(files));
  }

  has(path) { return this.files.has(path); }

  read(path) { return this.files.get(path); }

  readText(path) {
    const d = this.files.get(path);
    if (d === undefined) return undefined;
    return typeof d === 'string' ? d : decoder.decode(d);
  }

  readBytes(path) {
    const d = this.files.get(path);
    if (d === undefined) return undefined;
    return typeof d === 'string' ? encoder.encode(d) : d;
  }

  readJSON(path) {
    const t = this.readText(path);
    return t === undefined ? undefined : JSON.parse(t);
  }

  paths() { return [...this.files.keys()].sort(); }

  write(path, data) {
    const same = this.files.get(path) === data;
    this.files.set(path, data);
    if (!same) this.dispatchEvent(new CustomEvent('file', { detail: { path, kind: 'write' } }));
    if (path === 'smitten.json') this.dispatchEvent(new CustomEvent('settings'));
  }

  settings() {
    const base = { format: 'smitten.project', version: 2, name: 'My game', main: '', display: { width: 1280, height: 720, stretch: 'fit', filter: 'smooth' } };
    try {
      return { ...base, ...(this.readJSON('smitten.json') || {}) };
    } catch {
      return base;
    }
  }
}

async function png(w, h, paint) {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  paint(g, w, h);
  const blob = await c.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

function person(g, x, y, body, skin = '#f3c89b') {
  g.fillStyle = body;
  g.fillRect(x + 9, y + 12, 14, 14);
  g.fillStyle = skin;
  g.fillRect(x + 10, y + 2, 12, 10);
  g.fillStyle = '#222';
  g.fillRect(x + 13, y + 6, 2, 2);
  g.fillRect(x + 18, y + 6, 2, 2);
  g.fillStyle = '#3a3a5a';
  g.fillRect(x + 10, y + 26, 5, 6);
  g.fillRect(x + 17, y + 26, 5, 6);
}

async function makeFiles() {
  const files = {};
  files['smitten.json'] = JSON.stringify({ format: 'smitten.project', version: 2, name: 'Harness', main: 'levels/level1.scene', display: { width: 640, height: 360, stretch: 'fit', filter: 'pixel' } }, null, 2);
  files['art/hero.png'] = await png(32, 32, (g) => person(g, 0, 0, '#d9534f'));
  files['art/hero-sheet.png'] = await png(128, 32, (g) => {
    ['#5b8def', '#4cae4c', '#f0ad4e', '#9b59b6'].forEach((c, i) => person(g, i * 32, 0, c));
  });
  files['art/hero.sprite'] = JSON.stringify({
    format: 'smitten.sprite', image: 'hero-sheet.png', frameWidth: 32, frameHeight: 32, origin: [16, 32],
    animations: { run: { frames: [0, 1, 2, 3], fps: 10 }, idle: { frames: [2, 3], fps: 4 } },
  }, null, 2);
  const tileColors = ['#7a5230', '#5e8c31', '#8a8a8a', '#c0392b', '#2980b9', '#f1c40f', '#8e44ad', '#16a085'];
  files['art/tiles.png'] = await png(128, 64, (g) => {
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 8; i++) {
        const x = i * 16;
        const y = j * 16;
        g.fillStyle = tileColors[(i + j) % 8];
        g.globalAlpha = 1 - j * 0.18;
        g.fillRect(x, y, 16, 16);
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x, y, 16, 2);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(x, y + 14, 16, 2);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        for (let k = 0; k <= i; k++) g.fillRect(x + 2 + (k % 4) * 3, y + 5 + Math.floor(k / 4) * 4, 2, 2);
      }
    }
  });
  files['art/tiles.tileset'] = JSON.stringify({ format: 'smitten.tileset', version: 1, image: 'tiles.png', tileWidth: 16, tileHeight: 16, tiles: { 3: { solid: true }, 8: { solid: true, oneWay: true, name: 'ledge' } } }, null, 2);
  files['art/props.png'] = await png(64, 32, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `hsl(${i * 45}, 60%, 55%)`;
      g.beginPath();
      g.arc((i % 4) * 16 + 8, Math.floor(i / 4) * 16 + 8, 6, 0, Math.PI * 2);
      g.fill();
    }
  });
  files['art/coin.png'] = await png(16, 16, (g) => {
    g.fillStyle = '#f5c518';
    g.beginPath();
    g.arc(8, 8, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff3a0';
    g.fillRect(6, 4, 2, 7);
  });
  files['ui/icon.png'] = await png(24, 24, (g) => {
    g.fillStyle = '#e74c3c';
    g.beginPath();
    g.moveTo(12, 21);
    g.bezierCurveTo(-4, 10, 6, -2, 12, 6);
    g.bezierCurveTo(18, -2, 28, 10, 12, 21);
    g.fill();
  });
  files['art/bricks.png'] = await png(16, 16, (g) => {
    g.fillStyle = '#9c4a33';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#c7b299';
    g.fillRect(0, 7, 16, 1);
    g.fillRect(0, 15, 16, 1);
    g.fillRect(7, 0, 1, 7);
    g.fillRect(15, 8, 1, 7);
  });
  try {
    const res = await fetch('/love/testing/resources/font.ttf');
    if (res.ok) files['fonts/test.ttf'] = new Uint8Array(await res.arrayBuffer());
  } catch {
    // no font: Text2D falls back to the default font
  }
  files['sfx/jump.sfx'] = JSON.stringify({ format: 'smitten.sfx', wave: 'square' });
  files['scenes/coin.scene'] = JSON.stringify({
    format: 'smitten.scene', version: 2,
    root: {
      name: 'Coin', type: 'Area2D', groups: ['coins'],
      children: [
        { name: 'Sprite', type: 'Sprite2D', properties: { image: 'art/coin.png' } },
        { name: 'Shape', type: 'CollisionShape2D', properties: { shape: 'circle', radius: 7 } },
      ],
    },
  }, null, 2);

  // The ground: a floor, a platform and a wall of tiles.
  const grid = new Map();
  for (let x = 0; x < 40; x++) {
    grid.set(`${x},20`, 1);
    grid.set(`${x},21`, 0);
    grid.set(`${x},22`, 0);
  }
  for (let x = 10; x < 16; x++) grid.set(`${x},15`, 8);
  for (let y = 12; y < 20; y++) grid.set(`36,${y}`, 3);

  const scene = {
    format: 'smitten.scene', version: 2,
    root: {
      name: 'Level1', type: 'Node2D',
      children: [
        { name: 'Ground', type: 'TileMap', properties: { tileset: 'art/tiles.tileset', cells: encodeCells(grid) } },
        { name: 'Empty map', type: 'TileMap', properties: { x: 400, y: 40 } },
        {
          name: 'Player', type: 'CharacterBody2D', properties: { x: 96, y: 320 },
          children: [
            { name: 'Body', type: 'Sprite2D', properties: { image: 'art/hero.sprite' } },
            { name: 'Shape', type: 'CollisionShape2D', properties: { shape: 'capsule', width: 20, height: 30, y: -16 } },
            { name: 'Platformer', type: 'Platformer' },
          ],
        },
        { name: 'Statue', type: 'Sprite2D', properties: { image: 'art/hero.png', x: 470, y: 250, rotation: 0.3, scaleX: 2, scaleY: 2, flipX: true, tint: [1, 0.6, 0.6, 1] } },
        { name: 'Frames', type: 'Sprite2D', properties: { x: 560, y: 120, image: 'art/hero-sheet.png', hframes: 4, frame: 1, centered: false } },
        { name: 'Box', type: 'Shape2D', properties: { x: 300, y: 90, width: 80, height: 40, cornerRadius: 8 } },
        { name: 'Ball', type: 'Shape2D', properties: { x: 390, y: 90, shape: 'circle', radius: 20, filled: false, lineWidth: 3, color: [1, 0.6, 0.2, 1] } },
        { name: 'Tri', type: 'Shape2D', properties: { x: 450, y: 90, shape: 'polygon', points: [0, -20, 22, 18, -22, 18], color: [0.4, 0.85, 0.5, 1] } },
        { name: 'Wire', type: 'Shape2D', properties: { x: 490, y: 80, shape: 'line', points: [0, 0, 20, 20, 40, 0, 60, 20], lineWidth: 2, color: [1, 1, 1, 1] } },
        { name: 'Title', type: 'Text2D', properties: { x: 320, y: 36, text: 'Smitten 2D', size: 28, font: 'fonts/test.ttf' } },
        { name: 'Pixel text', type: 'Text2D', properties: { x: 300, y: 140, text: 'Pixel font 123!', size: 20, font: 'pixel', color: [1, 0.9, 0.4, 1], align: 'left' } },
        { name: 'Wrapped', type: 'Text2D', properties: { x: 560, y: 180, text: 'Text that wraps inside a box eighty wide', size: 12, wrap: 80, align: 'center' } },
        {
          name: 'Group', type: 'Node2D', properties: { x: 220, y: 170, rotation: 0.5, scaleX: 1.5, scaleY: 1.5, tint: [0.6, 0.8, 1, 1] },
          children: [
            { name: 'Inner', type: 'Shape2D', properties: { x: 20, width: 30, height: 20, color: [1, 1, 1, 1] } },
            { name: 'Coin in group', scene: 'scenes/coin.scene', properties: { x: -20 } },
          ],
        },
        { name: 'Camera', type: 'Camera2D', properties: { x: 320, y: 180, zoom: 1.5 } },
        { name: 'Sparks', type: 'Particles2D', properties: { x: 600, y: 300, spread: 0.6 } },
        {
          name: 'Wall', type: 'StaticBody2D', properties: { x: 30, y: 250 },
          children: [{ name: 'Shape', type: 'CollisionShape2D', properties: { width: 16, height: 80 } }],
        },
        {
          name: 'Zone', type: 'Area2D', properties: { x: 60, y: 120 },
          children: [{ name: 'Shape', type: 'CollisionShape2D', properties: { shape: 'circle', radius: 24 } }],
        },
        {
          name: 'Crate', type: 'RigidBody2D', properties: { x: 520, y: 230 },
          children: [
            { name: 'Look', type: 'Shape2D', properties: { width: 24, height: 24, color: [0.6, 0.4, 0.2, 1] } },
            { name: 'Shape', type: 'CollisionShape2D', properties: { width: 24, height: 24 } },
          ],
        },
        { name: 'Hinge', type: 'Joint2D', properties: { x: 520, y: 190 } },
        { name: 'No image', type: 'Sprite2D', properties: { x: 600, y: 60 } },
        { name: 'Spawn', type: 'Node2D', properties: { x: 40, y: 300 } },
        { name: 'Coin', scene: 'scenes/coin.scene', properties: { x: 260, y: 300 } },
        { name: 'Coin2', scene: 'scenes/coin.scene', properties: { x: 290, y: 300 } },
        { name: 'Timer', type: 'Timer' },
        { name: 'Music', type: 'AudioPlayer' },
        {
          name: 'UI', type: 'Node',
          children: [
            {
              name: 'HUD', type: 'Panel', properties: { x: 10, y: 10, width: 200, height: 64 },
              children: [
                { name: 'Score', type: 'Label', properties: { anchor: 'full', x: 10, y: 8, text: 'Score: 120', size: 16 } },
                { name: 'Health', type: 'ProgressBar', properties: { anchor: 'bottom', y: 8, width: 180, height: 14, value: 70, showValue: true } },
              ],
            },
            { name: 'Pause', type: 'Button', properties: { anchor: 'topRight', x: 10, y: 10, width: 90, height: 32, text: 'Pause' } },
            { name: 'Lives', type: 'ImageRect', properties: { anchor: 'bottomLeft', x: 10, y: 10, width: 48, height: 48, image: 'ui/icon.png' } },
            { name: 'Bricks', type: 'ImageRect', properties: { anchor: 'bottomRight', x: 10, y: 10, width: 70, height: 40, image: 'art/bricks.png', fit: 'tile' } },
            { name: 'Hint', type: 'Label', properties: { anchor: 'bottom', y: 12, width: 300, height: 24, text: 'Press space to jump', align: 'center', valign: 'middle', outline: true, size: 16 } },
          ],
        },
      ],
    },
  };
  files['levels/level1.scene'] = JSON.stringify(scene, null, 2);
  return files;
}

function describe(doc, n) {
  const p = {};
  for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'width', 'height', 'radius']) {
    if (k in n.props) p[k] = n.props[k];
  }
  return `${n.name} (${n.type}${n.instance ? `, ${n.instance}` : ''}) ${JSON.stringify(p)}`;
}

async function main() {
  const schema = await (await fetch('/love/src/modules/scene/nodes.json')).json();
  setSchema(schema);
  const project = new FakeProject(await makeFiles());
  const readScene = (path) => {
    const t = project.readText(path);
    return t === undefined ? null : JSON.parse(t);
  };
  const doc = SceneDoc.fromText('levels/level1.scene', project.readText('levels/level1.scene'), { readScene });
  const settings = { snap: false, grid: 16, showCollisions: true };
  const viewEl = document.getElementById('view');
  const tilesEl = document.getElementById('tiles');
  const viewport = new Viewport2D(viewEl, { doc, project, settings });
  const panel = new TilesPanel(tilesEl, { doc, project, viewport });

  // Toolbar
  const toolButtons = [...document.querySelectorAll('[data-tool]')];
  const syncTools = () => {
    for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === viewport.tool));
  };
  for (const b of toolButtons) b.addEventListener('click', () => viewport.setTool(b.dataset.tool));
  viewEl.addEventListener('viewport-tool', syncTools);
  syncTools();
  const snap = document.getElementById('snap');
  snap.addEventListener('change', () => viewport.setSnap(snap.checked));
  const gridIn = document.getElementById('grid');
  gridIn.addEventListener('change', () => viewport.setGrid(Number(gridIn.value)));
  const col = document.getElementById('collisions');
  col.addEventListener('change', () => viewport.setShowCollisions(col.checked));
  document.getElementById('undo').addEventListener('click', () => doc.undo());
  document.getElementById('redo').addEventListener('click', () => doc.redo());
  document.getElementById('frame').addEventListener('click', () => viewport.frameSelection());
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doc.redo();
      else doc.undo();
    }
  });

  // Status, selection, edits
  const statusEl = document.getElementById('status');
  viewEl.addEventListener('viewport-status', (e) => { statusEl.textContent = e.detail.text; });
  const contexts = [];
  viewEl.addEventListener('viewport-context', (e) => {
    contexts.push({ node: e.detail.node?.name ?? null, x: e.detail.x, y: e.detail.y });
    log(`context menu on ${e.detail.node?.name ?? 'nothing'} at ${e.detail.x}, ${e.detail.y}`);
  });
  const selEl = document.getElementById('sel');
  const logEl = document.getElementById('log');
  const lines = [];
  const log = (text) => {
    lines.unshift(text);
    lines.length = Math.min(lines.length, 14);
    logEl.textContent = lines.join('\n');
  };
  const showSelection = () => {
    const sel = doc.selected();
    selEl.textContent = sel.map((n) => describe(doc, n)).join('\n') || '(nothing)';
    const one = sel.length === 1 && isA(sel[0].type, 'TileMap') ? sel[0] : null;
    tilesEl.hidden = !one;
    panel.setNode(one);
    viewport.resize();
  };
  doc.addEventListener('select', showSelection);
  doc.addEventListener('change', (e) => {
    log(`${e.detail.kind}: ${e.detail.label || ''} (undo ${doc.undoStack.length})`);
    showSelection();
  });
  showSelection();

  // Files to drag in
  const filesEl = document.getElementById('files');
  for (const p of project.paths()) {
    if (p === 'smitten.json' || p === doc.path) continue;
    const d = document.createElement('div');
    d.textContent = p;
    d.draggable = true;
    d.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-smitten-path', p);
      e.dataTransfer.effectAllowed = 'copy';
    });
    filesEl.append(d);
  }

  /** A synthetic drop of a project file at a point of the view (client coordinates). */
  const drop = (path, clientX, clientY, opts = {}) => {
    const dt = new DataTransfer();
    dt.setData('application/x-smitten-path', path);
    const target = viewport.canvas;
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX, clientY, bubbles: true, cancelable: true, ...opts }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX, clientY, bubbles: true, cancelable: true, ...opts }));
  };

  window.H = { doc, project, viewport, panel, settings, decodeCells, encodeCells, drop, contexts, find: (name) => {
    let found = null;
    doc.walk((n) => {
      if (!found && n.name === name) found = n;
    });
    return found;
  } };
  document.title = '2D viewport harness (ready)';
}

main().catch((e) => {
  console.error(e);
  document.body.prepend(Object.assign(document.createElement('pre'), { textContent: String(e.stack || e) }));
});
