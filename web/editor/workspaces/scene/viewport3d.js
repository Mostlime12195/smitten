// The 3D scene viewport: draws a SceneDoc's effective node tree with three.js
// (loaded on first use, see three-loader.js), with an orbit/pan/fly editor
// camera, picking, box selection, move/rotate/scale handles that edit through
// the doc, and drag and drop from the Files panel.
//
// Conventions match the engine (DESIGN.md §6): meters, y up, right-handed,
// -Z forward; Node3D rotation is Euler rotationX/Y/Z in radians applied in YXZ
// order (yaw, then pitch, then roll); parents' transforms apply to children.
// Built-in shapes are the engine's own (graphics3d/primitives.lua), lights
// and ambient use its units (energy 1 lights a white surface facing the light
// at full brightness), and colors are sRGB like in the engine.
//
//   const vp = new Viewport3D(container, { doc, project, settings })
//   vp.setDoc(doc); vp.setTool('move'); vp.setSnap(true); vp.frameSelection();
//   vp.resize(); vp.dispose();
//
// Events on container: 'viewport-status' {text}, 'viewport-context'
// {node, x, y} (right click; node is null on empty space), and
// 'viewport-tool' {tool} when Q/W/E/R change the tool from the keyboard.

import { loadThree } from './three-loader.js';
import { isA, defaultOf, equal, clone } from '../../core/schema.js';

const PI = Math.PI;
const PATH_MIME = 'application/x-smitten-path';
const PROJECT_HOST = 'project.smitten.invalid';
const TRANSFORM_KEYS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ'];
const LIGHT_TYPES = new Set(['DirectionalLight3D', 'PointLight3D', 'SpotLight3D']);
const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
const TOOL_MODES = { move: 'translate', rotate: 'rotate', scale: 'scale' };
const TOOL_LABELS = { move: 'Move', rotate: 'Rotate', scale: 'Scale' };
const ORTHO_BACK = 1000;
const ICON_PX = 24;

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;
const MODEL_RE = /\.(glb|gltf)$/i;
const AUDIO_RE = /\.(wav|ogg|mp3|flac|sfx|song)$/i;
const SCENE_RE = /\.scene$/i;

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml', ktx2: 'image/ktx2',
  bin: 'application/octet-stream', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
};

const COLORS = {
  collision: 0x5fd38d,
  collisionOff: 0x8a94a6,
  camera: 0xc9b6ff,
  light: 0xffd166,
  grid: 0x8f99ab,
  axisX: 0xe5484d,
  axisY: 0x46a758,
  axisZ: 0x3e7bfa,
};

const ICON_COLORS = {
  sun: '#ffd166', bulb: '#ffd166', spot: '#ffd166', camera: '#c9b6ff',
  sound: '#7fdbca', model: '#b8c2d6', image: '#b8c2d6',
};

// Aligned views: yaw and pitch of the editor camera (Godot's names).
const VIEWS = {
  top: { yaw: 0, pitch: -PI / 2, label: 'Top' },
  bottom: { yaw: 0, pitch: PI / 2, label: 'Bottom' },
  front: { yaw: 0, pitch: 0, label: 'Front' },
  back: { yaw: PI, pitch: 0, label: 'Back' },
  right: { yaw: PI / 2, pitch: 0, label: 'Right' },
  left: { yaw: -PI / 2, pitch: 0, label: 'Left' },
};

// ---------------------------------------------------------------------------
// Small helpers

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function round6(v) {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

function nearestAngle(a, ref) {
  return a + Math.round((ref - a) / (2 * PI)) * 2 * PI;
}

/** Of the two YXZ Euler triples for a rotation, the one closest to ref. */
function closestEuler(x, y, z, ref) {
  const a = [nearestAngle(x, ref[0]), nearestAngle(y, ref[1]), nearestAngle(z, ref[2])];
  const b = [nearestAngle(PI - x, ref[0]), nearestAngle(y + PI, ref[1]), nearestAngle(z + PI, ref[2])];
  const dist = (t) => Math.abs(t[0] - ref[0]) + Math.abs(t[1] - ref[1]) + Math.abs(t[2] - ref[2]);
  return dist(b) + 1e-9 < dist(a) ? b : a;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function ext(path) {
  const m = /\.([^./]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

function mimeOf(path) {
  return MIME[ext(path)] || 'application/octet-stream';
}

function nameFor(path) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, ' ').trim() || 'Node';
  return base.replace(/^\w/, (c) => c.toUpperCase());
}

function toArrayBuffer(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer;
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

let stylesAdded = false;
function ensureStyles() {
  if (stylesAdded || typeof document === 'undefined') return;
  stylesAdded = true;
  const href = new URL('./viewport3d.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function readAccent(root) {
  const probe = el('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--accent, #41a6f6)';
  root.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c || '#41a6f6';
}

// ---------------------------------------------------------------------------
// The engine's built-in shapes (graphics3d/primitives.lua), so textures wrap
// the same way as in the game. The engine's uv (0, 0) is the image's top left;
// three's is the bottom left (textures are flipped on upload), so v is flipped.

function geometry(T, positions, normals, uvs, indices) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs.map((v, i) => (i % 2 ? 1 - v : v)), 2));
  g.setIndex(indices);
  return g;
}

const BOX_FACES = [
  [1, 0, 0, 0, 0, -1, 0, 1, 0],
  [-1, 0, 0, 0, 0, 1, 0, 1, 0],
  [0, 1, 0, 1, 0, 0, 0, 0, -1],
  [0, -1, 0, 1, 0, 0, 0, 0, 1],
  [0, 0, 1, 1, 0, 0, 0, 1, 0],
  [0, 0, -1, -1, 0, 0, 0, 1, 0],
];
const BOX_CORNERS = [-1, -1, 0, 1, 1, -1, 1, 1, 1, 1, 1, 0, -1, 1, 0, 0];

function boxGeometry(T, w, h, d) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const pos = [], nor = [], uv = [], idx = [];
  BOX_FACES.forEach(([nx, ny, nz, ux, uy, uz, vx, vy, vz], f) => {
    const base = f * 4;
    for (let c = 0; c < 4; c++) {
      const su = BOX_CORNERS[c * 4], sv = BOX_CORNERS[c * 4 + 1];
      pos.push((nx + ux * su + vx * sv) * hx, (ny + uy * su + vy * sv) * hy, (nz + uz * su + vz * sv) * hz);
      nor.push(nx, ny, nz);
      uv.push(BOX_CORNERS[c * 4 + 2], BOX_CORNERS[c * 4 + 3]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return geometry(T, pos, nor, uv, idx);
}

// rows: [y, radius, normalY, normalOut, v], top first.
function lathe(rows, segments) {
  const pos = [], nor = [], uv = [], idx = [];
  for (const [y, r, ny, nr, v] of rows) {
    for (let j = 0; j <= segments; j++) {
      const t = (2 * PI * j) / segments;
      let s = Math.sin(t), c = Math.cos(t);
      if (j === segments) { s = 0; c = 1; }
      pos.push(r * s, y, r * c);
      nor.push(nr * s, ny, nr * c);
      uv.push(j / segments, v);
    }
  }
  const cols = segments + 1;
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j, b = a + cols, c = b + 1, d = a + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  return { pos, nor, uv, idx };
}

function sphereGeometry(T, radius, segments = 24) {
  const rings = Math.max(2, Math.floor(segments / 2));
  const rows = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (PI * i) / rings;
    let ny = Math.cos(phi), nr = Math.sin(phi);
    if (i === 0) { ny = 1; nr = 0; } else if (i === rings) { ny = -1; nr = 0; }
    rows.push([radius * ny, radius * nr, ny, nr, i / rings]);
  }
  const { pos, nor, uv, idx } = lathe(rows, segments);
  return geometry(T, pos, nor, uv, idx);
}

function cylinderGeometry(T, radius, height, segments = 24) {
  const hh = height / 2;
  const { pos, nor, uv, idx } = lathe([[hh, radius, 0, 1, 0], [-hh, radius, 0, 1, 1]], segments);
  for (const cap of [1, 2]) {
    const y = cap === 1 ? hh : -hh;
    const ny = cap === 1 ? 1 : -1;
    const center = pos.length / 3;
    pos.push(0, y, 0);
    nor.push(0, ny, 0);
    uv.push(0.5, 0.5);
    for (let j = 0; j < segments; j++) {
      const t = (2 * PI * j) / segments;
      const s = Math.sin(t), c = Math.cos(t);
      pos.push(radius * s, y, radius * c);
      nor.push(0, ny, 0);
      uv.push(0.5 + 0.5 * s, 0.5 + 0.5 * c * ny);
    }
    for (let j = 0; j < segments; j++) {
      const a = center + 1 + j, b = center + 1 + ((j + 1) % segments);
      if (cap === 1) idx.push(center, a, b);
      else idx.push(center, b, a);
    }
  }
  return geometry(T, pos, nor, uv, idx);
}

function capsuleGeometry(T, radius, height, segments = 16) {
  if (height < radius * 2) height = radius * 2;
  const hc = (height - radius * 2) / 2;
  const rings = Math.max(2, Math.floor(segments / 4));
  const rows = [];
  for (let half = 0; half <= 1; half++) {
    for (let i = 0; i <= rings; i++) {
      const phi = (PI / 2) * (i / rings + half);
      let ny = Math.cos(phi), nr = Math.sin(phi);
      if (half === 0 && i === 0) { ny = 1; nr = 0; }
      if (half === 1 && i === rings) { ny = -1; nr = 0; }
      if ((half === 0 && i === rings) || (half === 1 && i === 0)) { ny = 0; nr = 1; }
      const y = radius * ny + (half === 0 ? hc : -hc);
      rows.push([y, radius * nr, ny, nr, height > 0 ? (height / 2 - y) / height : 0]);
    }
  }
  const { pos, nor, uv, idx } = lathe(rows, segments);
  return geometry(T, pos, nor, uv, idx);
}

function planeGeometry(T, w, d) {
  const hw = w / 2, hd = d / 2;
  return geometry(
    T,
    [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [3, 2, 1, 3, 1, 0],
  );
}

// Line helpers: arrays of segment end points [x, y, z, x, y, z, ...].
function arc(out, c, u, v, r, a0, a1, segs) {
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + ((a1 - a0) * i) / segs, t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    for (const t of [t0, t1]) {
      const cs = Math.cos(t) * r, sn = Math.sin(t) * r;
      out.push(c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn);
    }
  }
}
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

function boxLines(out, hx, hy, hz) {
  const p = (sx, sy, sz) => [sx * hx, sy * hy, sz * hz];
  const edges = [
    [p(-1, -1, -1), p(1, -1, -1)], [p(-1, 1, -1), p(1, 1, -1)], [p(-1, -1, 1), p(1, -1, 1)], [p(-1, 1, 1), p(1, 1, 1)],
    [p(-1, -1, -1), p(-1, 1, -1)], [p(1, -1, -1), p(1, 1, -1)], [p(-1, -1, 1), p(-1, 1, 1)], [p(1, -1, 1), p(1, 1, 1)],
    [p(-1, -1, -1), p(-1, -1, 1)], [p(1, -1, -1), p(1, -1, 1)], [p(-1, 1, -1), p(-1, 1, 1)], [p(1, 1, -1), p(1, 1, 1)],
  ];
  for (const [a, b] of edges) out.push(...a, ...b);
}

// ---------------------------------------------------------------------------
// Icons for nodes without a visible shape (lights, cameras, sounds, ...).

function drawIcon(kind, selected, accent) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(32, 32, 28, 0, 2 * PI);
  g.fillStyle = 'rgba(16, 18, 28, 0.82)';
  g.fill();
  g.lineWidth = selected ? 4 : 2;
  g.strokeStyle = selected ? accent : 'rgba(255, 255, 255, 0.3)';
  g.stroke();
  const col = ICON_COLORS[kind] || '#ffffff';
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  switch (kind) {
    case 'sun':
      g.arc(32, 32, 7, 0, 2 * PI);
      g.fill();
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * PI) / 4;
        g.moveTo(32 + Math.cos(a) * 12, 32 + Math.sin(a) * 12);
        g.lineTo(32 + Math.cos(a) * 17, 32 + Math.sin(a) * 17);
      }
      g.stroke();
      break;
    case 'bulb':
      g.arc(32, 28, 9, 0, 2 * PI);
      g.fill();
      g.fillRect(27, 39, 10, 3);
      g.fillRect(28.5, 44, 7, 3);
      break;
    case 'spot':
      g.moveTo(32, 16);
      g.lineTo(20, 42);
      g.moveTo(32, 16);
      g.lineTo(44, 42);
      g.stroke();
      g.beginPath();
      g.ellipse(32, 42, 12, 4, 0, 0, 2 * PI);
      g.stroke();
      g.beginPath();
      g.arc(32, 16, 3.5, 0, 2 * PI);
      g.fill();
      break;
    case 'camera':
      g.roundRect(15, 24, 23, 17, 3);
      g.fill();
      g.beginPath();
      g.moveTo(39, 32.5);
      g.lineTo(49, 25);
      g.lineTo(49, 40);
      g.closePath();
      g.fill();
      break;
    case 'sound':
      g.moveTo(17, 28);
      g.lineTo(23, 28);
      g.lineTo(31, 21);
      g.lineTo(31, 43);
      g.lineTo(23, 36);
      g.lineTo(17, 36);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(31, 32, 7, -0.8, 0.8);
      g.stroke();
      g.beginPath();
      g.arc(31, 32, 13, -0.8, 0.8);
      g.stroke();
      break;
    case 'model':
      g.moveTo(32, 17);
      g.lineTo(45, 24);
      g.lineTo(32, 31);
      g.lineTo(19, 24);
      g.closePath();
      g.moveTo(19, 24);
      g.lineTo(19, 39);
      g.lineTo(32, 46);
      g.lineTo(45, 39);
      g.lineTo(45, 24);
      g.moveTo(32, 31);
      g.lineTo(32, 46);
      g.stroke();
      break;
    case 'image':
      g.strokeRect(18, 20, 28, 24);
      g.beginPath();
      g.moveTo(20, 42);
      g.lineTo(28, 32);
      g.lineTo(34, 38);
      g.lineTo(38, 34);
      g.lineTo(44, 42);
      g.stroke();
      g.beginPath();
      g.arc(38, 27, 3, 0, 2 * PI);
      g.fill();
      break;
    default:
      g.arc(32, 32, 6, 0, 2 * PI);
      g.fill();
  }
  return c;
}

// ---------------------------------------------------------------------------

export class Viewport3D {
  constructor(container, ctx = {}) {
    ensureStyles();
    this.container = container;
    this.project = ctx.project || null;
    this.settings = ctx.settings || { snap: false, snapStep: 0.25, angleSnap: 15 };
    this.tool = 'select';
    this.space = 'world';
    this.doc = null;
    this.pendingDoc = ctx.doc || null;
    this.pendingFrame = false;
    this.disposed = false;
    this.lib = null;
    this.entries = new Map(); // node id -> entry
    this.billboards = new Set();
    this.dirLights = new Set();
    this.textures = new Map(); // path -> { tex, w, h, ready }
    this.models = new Map(); // path -> { promise, deps, gltf }
    this.iconMaterials = new Map();
    this.camStates = new WeakMap(); // doc -> camera state, so tabs keep their views
    this.keys = new Set();
    this.ctrlHeld = false;
    this.shiftHeld = false;
    this.gesture = null;
    this.flying = false;
    this.dragging = false;
    this.anim = null;
    this.needsRender = true;
    this.statusText = '';
    this.lightNote = '';
    this.width = 0;
    this.height = 0;

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.root = el('div', 'vp3d');
    this.root.tabIndex = 0;
    this.message = el('div', 'vp3d-message');
    this.message.append(el('div', null, 'Loading the 3D view…'));
    this.root.append(this.message);
    container.append(this.root);

    /** Resolves once three.js is loaded and the view is ready (or failed). */
    this.loaded = loadThree().then(
      (lib) => { if (!this.disposed) this.init(lib); },
      (err) => { if (!this.disposed) this.fail(err); },
    );
  }

  /** The current status line (also sent as 'viewport-status'). */
  get status() {
    return this.statusText;
  }

  // ---------------------------------------------------------------------------
  // Public API

  setDoc(doc) {
    if (!this.lib) {
      this.pendingDoc = doc;
      return;
    }
    if (doc === this.doc) return;
    this.cancelGesture();
    if (this.doc) {
      this.doc.removeEventListener('change', this.onDocChange);
      this.doc.removeEventListener('select', this.onDocSelect);
      this.camStates.set(this.doc, this.cam);
    }
    this.doc = doc || null;
    const saved = doc && this.camStates.get(doc);
    this.cam = saved || this.newCamState();
    this.tc.camera = this.activeCamera();
    this.updateProjectionButtons();
    if (doc) {
      doc.addEventListener('change', this.onDocChange);
      doc.addEventListener('select', this.onDocSelect);
    }
    this.rebuild();
    if (doc && !saved) this.frameEntries(null, false);
    this.updateStatus(true);
  }

  setTool(name) {
    if (!['select', 'move', 'rotate', 'scale'].includes(name)) return;
    this.tool = name;
    if (this.lib) this.syncGizmo();
  }

  setSnap(on) {
    this.settings.snap = !!on;
    if (this.lib) this.applySnap();
  }

  frameSelection() {
    if (!this.lib) {
      this.pendingFrame = true;
      return;
    }
    const sel = this.doc ? this.doc.selected().map((n) => this.entries.get(n.id)).filter(Boolean) : [];
    this.frameEntries(sel.length ? sel : null, true);
  }

  resize() {
    if (!this.renderer || this.disposed) return;
    const w = Math.max(1, this.root.clientWidth);
    const h = Math.max(1, this.root.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.render();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.toastTimer);
    if (this.doc) {
      this.doc.removeEventListener('change', this.onDocChange);
      this.doc.removeEventListener('select', this.onDocSelect);
    }
    if (this.project) {
      this.project.removeEventListener('file', this.onFile);
      this.project.removeEventListener('settings', this.onSettings);
    }
    window.removeEventListener('keydown', this.onWindowKey, true);
    window.removeEventListener('keyup', this.onWindowKey, true);
    window.removeEventListener('blur', this.onBlur);
    this.resizeObserver?.disconnect();
    if (this.lib) {
      this.tc.detach();
      this.tc.dispose();
      this.clearEntries();
      for (const t of this.textures.values()) t.tex?.dispose();
      for (const m of this.models.values()) if (m.gltf) this.disposeObject(m.gltf.scene);
      for (const m of this.iconMaterials.values()) {
        m.map.dispose();
        m.dispose();
      }
      this.disposeObject(this.scene);
      this.envMap?.dispose();
      this.pmrem?.dispose();
      this.renderer.dispose();
    }
    this.textures.clear();
    this.models.clear();
    this.root.remove();
  }

  // ---------------------------------------------------------------------------
  // Setup

  fail(err) {
    console.error(err);
    this.message.classList.add('is-error');
    this.message.firstChild.textContent = err.message || String(err);
    this.updateStatus(true, '3D view unavailable: three.js could not be loaded');
  }

  init(lib) {
    this.lib = lib;
    const T = (this.THREE = lib.THREE);
    this.message.remove();
    this.accent = readAccent(this.root);

    const renderer = (this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.canvas = renderer.domElement;
    this.canvas.className = 'vp3d-canvas';
    this.root.prepend(this.canvas);

    this.scene = new T.Scene();
    this.world = new T.Group();
    this.lightsRoot = new T.Group();
    this.helpers = new T.Group();
    this.iconLayer = new T.Group();
    this.scene.add(this.world, this.lightsRoot, this.helpers, this.iconLayer);

    this.persp = new T.PerspectiveCamera(50, 1, 0.05, 2000);
    this.ortho = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, ORTHO_BACK * 3);
    this.cam = this.newCamState();
    this.raycaster = new T.Raycaster();
    this.tmp = {
      v: new T.Vector3(), v2: new T.Vector3(), v3: new T.Vector3(),
      q: new T.Quaternion(), q2: new T.Quaternion(), e: new T.Euler(), m: new T.Matrix4(),
      box: new T.Box3(), box2: new T.Box3(),
    };

    this.buildSky();
    this.buildGrid();
    this.buildDefaultLights();
    this.selectionBoxes = [];

    // Transform handles. They move a proxy object; drags are turned into doc
    // edits (gizmoChanged), so the doc stays the only source of truth.
    this.proxy = new T.Object3D();
    this.scene.add(this.proxy);
    this.tc = new lib.TransformControls(this.persp, this.canvas);
    this.tc.setSize(0.9);
    const helper = this.tc.getHelper();
    helper.traverse((o) => { o.renderOrder = 1000; });
    this.scene.add(helper);
    this.tc.addEventListener('change', () => this.requestRender());
    this.tc.addEventListener('mouseDown', () => this.beginGizmoDrag());
    this.tc.addEventListener('objectChange', () => this.gizmoChanged());
    this.tc.addEventListener('mouseUp', () => this.endGizmoDrag());

    this.buildOverlay();
    this.bindInput();

    if (this.project) {
      this.project.addEventListener('file', this.onFile);
      this.project.addEventListener('settings', this.onSettings);
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.resize();

    const doc = this.pendingDoc;
    this.pendingDoc = null;
    if (doc) this.setDoc(doc);
    else this.updateStatus(true);
    this.syncGizmo();
    if (this.pendingFrame) {
      this.pendingFrame = false;
      this.frameSelection();
    }

    let last = performance.now();
    const loop = (now) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let moving = false;
      if (this.anim) moving = this.stepAnim(now) || moving;
      if (this.flying) moving = this.flyStep(dt) || moving;
      if (this.needsRender || moving) {
        this.needsRender = false;
        this.render();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  newCamState() {
    const T = this.THREE;
    return {
      target: new T.Vector3(0, 0, 0),
      yaw: 0.65,
      pitch: -0.5,
      distance: 12,
      ortho: false,
      orthoAuto: false,
      orthoHeight: 10,
      view: null,
      flySpeed: 1,
    };
  }

  buildSky() {
    const T = this.THREE;
    this.skyUniforms = {
      uTop: { value: new T.Color() },
      uHorizon: { value: new T.Color() },
      uBottom: { value: new T.Color() },
      uInvProj: { value: new T.Matrix4() },
      uCamWorld: { value: new T.Matrix4() },
      uOrtho: { value: 0 },
    };
    // The engine's sky (graphics3d/shaders.lua g3d_sky), drawn as a
    // full-screen quad from each pixel's view direction.
    const mat = new T.ShaderMaterial({
      uniforms: this.skyUniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform mat4 uInvProj;
        uniform mat4 uCamWorld;
        uniform float uOrtho;
        varying vec3 vDir;
        void main() {
          vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
          vec3 d = uOrtho > 0.5 ? vec3(0.0, 0.0, -1.0) : v.xyz / v.w;
          vDir = mat3(uCamWorld) * d;
          gl_Position = vec4(position.xy, 0.999999, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        varying vec3 vDir;
        void main() {
          float y = clamp(normalize(vDir).y, -1.0, 1.0);
          vec3 c = y >= 0.0
            ? mix(uHorizon, uTop, 1.0 - pow(1.0 - y, 3.0))
            : mix(uHorizon, uBottom, 1.0 - pow(1.0 + y, 12.0));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);
  }

  buildGrid() {
    const T = this.THREE;
    this.gridUniforms = {
      uPlane: { value: 0 },
      uCell: { value: 1 },
      uLod: { value: 0 },
      uCenter: { value: new T.Vector2() },
      uFade: { value: 50 },
      uPx: { value: 1 },
      uColor: { value: new T.Color(COLORS.grid) },
      uAxisA: { value: new T.Color(COLORS.axisX) },
      uAxisB: { value: new T.Color(COLORS.axisZ) },
    };
    // An anti-aliased grid computed per pixel on a large plane that follows
    // the camera: minor lines fade into the next power of ten as you zoom out,
    // and everything fades with distance, so it looks infinite.
    const mat = new T.ShaderMaterial({
      uniforms: this.gridUniforms,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uPlane;
        uniform float uCell;
        uniform float uLod;
        uniform vec2 uCenter;
        uniform float uFade;
        uniform float uPx;
        uniform vec3 uColor;
        uniform vec3 uAxisA;
        uniform vec3 uAxisB;
        varying vec3 vWorld;
        float grid(vec2 p, float cell) {
          vec2 c = p / cell;
          vec2 w = fwidth(c) * uPx; // lines about one CSS pixel wide
          vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, vec2(1e-6));
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          return line * (1.0 - smoothstep(0.2, 0.5, max(w.x, w.y)));
        }
        void main() {
          vec2 p = uPlane < 0.5 ? vWorld.xz : (uPlane < 1.5 ? vWorld.xy : vWorld.zy);
          float a = max(grid(p, uCell) * (1.0 - uLod) * 0.3, grid(p, uCell * 10.0) * 0.55);
          vec3 col = uColor;
          vec2 w = max(fwidth(p) * uPx, vec2(1e-6));
          float ax = 1.0 - min(abs(p.y) / w.y / 1.4, 1.0);
          float bx = 1.0 - min(abs(p.x) / w.x / 1.4, 1.0);
          if (ax > 0.0) { col = mix(col, uAxisA, ax); a = max(a, ax * 0.9); }
          if (bx > 0.0) { col = mix(col, uAxisB, bx); a = max(a, bx * 0.9); }
          a *= 1.0 - smoothstep(uFade * 0.35, uFade, length(p - uCenter));
          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.grid = new T.Mesh(new T.PlaneGeometry(1, 1), mat);
    this.grid.frustumCulled = false;
    this.grid.renderOrder = -1;
    this.helpers.add(this.grid);
  }

  buildDefaultLights() {
    const T = this.THREE;
    // Ambient: a hemisphere for sky backgrounds, a flat ambient otherwise.
    this.hemi = new T.HemisphereLight(0xffffff, 0x444444, 0);
    this.ambient = new T.AmbientLight(0xffffff, 0);
    this.lightsRoot.add(this.hemi, this.ambient);
    // Shown only while the scene has no lights of its own.
    this.defaultLight = new T.DirectionalLight(0xffffff, 0.9 * PI);
    this.defaultLight.userData.dir = new T.Vector3(-0.45, -1, -0.6).normalize();
    this.lightsRoot.add(this.defaultLight, this.defaultLight.target);
    this.envFog = null;
  }

  buildOverlay() {
    const nav = el('div', 'vp3d-nav');
    this.axesCanvas = el('canvas', 'vp3d-axes');
    this.axesCanvas.title = 'Click an axis to look along it';
    this.axesCanvas.addEventListener('pointermove', (e) => this.axesHover(e));
    this.axesCanvas.addEventListener('pointerleave', () => { this.axesHot = null; this.drawAxes(); });
    this.axesCanvas.addEventListener('click', (e) => this.axesClick(e));
    const views = el('div', 'vp3d-views');
    const button = (label, title, fn) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', (e) => { e.preventDefault(); fn(e); this.root.focus({ preventScroll: true }); });
      views.append(b);
      return b;
    };
    this.projButton = button('Persp', 'Perspective or orthographic (Numpad 5)', () => this.setOrtho(!this.cam.ortho));
    views.append(el('span', 'vp3d-sep'));
    this.viewButtons = {
      top: button('Top', 'Top view (Numpad 7; Ctrl for bottom)', (e) => this.setView(e.ctrlKey || e.metaKey ? 'bottom' : 'top')),
      front: button('Front', 'Front view (Numpad 1; Ctrl for back)', (e) => this.setView(e.ctrlKey || e.metaKey ? 'back' : 'front')),
      right: button('Side', 'Side view (Numpad 3; Ctrl for the other side)', (e) => this.setView(e.ctrlKey || e.metaKey ? 'left' : 'right')),
    };
    nav.append(this.axesCanvas, views);
    this.hint = el('div', 'vp3d-hint', 'Flying: W A S D move · Q E down and up · Shift faster · wheel changes speed');
    this.toastEl = el('div', 'vp3d-toast');
    this.marquee = el('div', 'vp3d-marquee');
    this.marquee.hidden = true;
    this.root.append(nav, this.hint, this.toastEl, this.marquee);
  }

  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerTrack, true); // before the handles read snapping
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('lostpointercapture', this.onPointerUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('keydown', this.onKeyDown);
    this.root.addEventListener('dragover', this.onDragOver);
    this.root.addEventListener('dragleave', () => this.root.classList.remove('is-drop'));
    this.root.addEventListener('drop', this.onDrop);
    window.addEventListener('keydown', this.onWindowKey, true);
    window.addEventListener('keyup', this.onWindowKey, true);
    window.addEventListener('blur', this.onBlur);
  }

  // ---------------------------------------------------------------------------
  // Building the three.js scene from the doc

  rebuild() {
    this.clearEntries();
    if (this.doc) this.buildEntry(this.doc.root, this.world);
    this.refreshScene();
    this.updateSelectionVisuals();
    this.syncGizmo();
    this.requestRender();
  }

  clearEntries() {
    for (const e of this.entries.values()) {
      e.dead = true;
      this.disposeContent(e);
    }
    this.entries.clear();
    this.world.clear();
  }

  buildEntry(node, parent) {
    const T = this.THREE;
    const group = new T.Group();
    group.name = node.name;
    const entry = {
      node,
      group,
      content: null,
      key: '',
      icon: null,
      disposables: [],
      deps: new Set(),
      light: null,
      billboard: null,
      is3d: isA(node.type, 'Node3D'),
      dead: false,
    };
    group.userData.entry = entry;
    this.entries.set(node.id, entry);
    parent.add(group);
    this.applyTransform(entry);
    this.buildContent(entry);
    for (const child of this.doc.effectiveChildren(node)) this.buildEntry(child, group);
    return entry;
  }

  applyTransform(entry) {
    if (!entry.is3d) return;
    const { node, group } = entry;
    const get = (k, d) => num(this.doc.get(node, k), d);
    const nz = (v) => (v === 0 ? 1e-6 : v); // a zero scale can't be inverted
    group.position.set(get('x', 0), get('y', 0), get('z', 0));
    group.rotation.set(get('rotationX', 0), get('rotationY', 0), get('rotationZ', 0), 'YXZ');
    group.scale.set(nz(get('scaleX', 1)), nz(get('scaleY', 1)), nz(get('scaleZ', 1)));
    group.visible = this.doc.get(node, 'visible') !== false;
  }

  contentKey(entry) {
    const props = this.doc.allProps(entry.node);
    for (const k of TRANSFORM_KEYS) delete props[k];
    delete props.visible;
    return `${entry.node.type}|${JSON.stringify(props)}`;
  }

  buildContent(entry) {
    const T = this.THREE;
    entry.key = this.contentKey(entry);
    const content = (entry.content = new T.Group());
    entry.group.add(content);
    switch (entry.node.type) {
      case 'MeshInstance3D': this.buildMesh(entry, content); break;
      case 'Model3D': this.buildModel(entry, content); break;
      case 'Sprite3D': this.buildSprite(entry, content); break;
      case 'Camera3D': this.buildCamera(entry, content); break;
      case 'DirectionalLight3D':
      case 'PointLight3D':
      case 'SpotLight3D': this.buildLight(entry, content); break;
      case 'CollisionShape3D': this.buildCollision(entry, content); break;
      case 'AudioPlayer3D': this.addIcon(entry, 'sound'); break;
      default: break;
    }
  }

  disposeContent(entry) {
    if (entry.content) entry.group.remove(entry.content);
    entry.content = null;
    for (const d of entry.disposables) d.dispose();
    entry.disposables = [];
    if (entry.icon) this.iconLayer.remove(entry.icon);
    entry.icon = null;
    if (entry.light) {
      if (entry.light.isDirectionalLight) this.lightsRoot.remove(entry.light, entry.light.target);
      entry.light.dispose();
    }
    entry.light = null;
    entry.billboard = null;
    this.billboards.delete(entry);
    this.dirLights.delete(entry);
    entry.deps.clear();
  }

  rebuildContent(entry) {
    this.disposeContent(entry);
    this.buildContent(entry);
  }

  /** Re-reads one node after a property edit: its transform, and its look if that changed. */
  updateEntry(entry) {
    this.applyTransform(entry);
    if (this.contentKey(entry) !== entry.key) this.rebuildContent(entry);
  }

  lines(entry, points, color, { depthTest = true, opacity = 1 } = {}) {
    const T = this.THREE;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    const mat = new T.LineBasicMaterial({ color, transparent: true, opacity, depthTest, depthWrite: depthTest, fog: false, toneMapped: false });
    const ls = new T.LineSegments(geo, mat);
    if (!depthTest) ls.renderOrder = 900;
    entry.disposables.push(geo, mat);
    return ls;
  }

  material(entry, { color, texture, roughness = 0.6, metallic = 0, emission = null, unshaded = false, side = null }) {
    const T = this.THREE;
    const c = Array.isArray(color) ? color : [1, 1, 1, 1];
    const alpha = clamp(num(c[3], 1), 0, 1);
    const base = new T.Color().setRGB(num(c[0], 1), num(c[1], 1), num(c[2], 1), T.SRGBColorSpace);
    const params = { color: base, transparent: alpha < 1, opacity: alpha, depthWrite: alpha >= 1 };
    let mat;
    if (unshaded) {
      // The engine adds emission to unshaded colors too.
      if (Array.isArray(emission)) base.r += toLinear(num(emission[0])), base.g += toLinear(num(emission[1])), base.b += toLinear(num(emission[2]));
      mat = new T.MeshBasicMaterial(params);
    } else {
      mat = new T.MeshStandardMaterial({
        ...params,
        roughness: clamp(num(roughness, 0.6), 0.03, 1),
        metalness: clamp(num(metallic, 0), 0, 1),
      });
      if (Array.isArray(emission)) mat.emissive.setRGB(num(emission[0]), num(emission[1]), num(emission[2]), T.SRGBColorSpace);
      this.applyEnv(mat);
    }
    if (side != null) mat.side = side;
    entry.disposables.push(mat);
    if (texture) {
      const info = this.texture(texture, entry);
      const apply = () => {
        if (entry.dead || !entry.disposables.includes(mat)) return;
        mat.map = info.tex;
        mat.needsUpdate = true;
        this.requestRender();
      };
      if (info.loaded) apply();
      else info.ready.then(apply, () => {});
    }
    return mat;
  }

  buildMesh(entry, content) {
    const T = this.THREE;
    const get = (k, d) => this.doc.get(entry.node, k) ?? d;
    const size = (k, d) => Math.max(0, num(get(k, d), d));
    let geo;
    switch (get('mesh', 'box')) {
      case 'sphere': geo = sphereGeometry(T, size('radius', 0.5)); break;
      case 'cylinder': geo = cylinderGeometry(T, size('radius', 0.5), size('height', 1)); break;
      case 'capsule': geo = capsuleGeometry(T, size('radius', 0.5), size('height', 1)); break;
      case 'plane': geo = planeGeometry(T, size('width', 1), size('depth', 1)); break;
      default: geo = boxGeometry(T, size('width', 1), size('height', 1), size('depth', 1));
    }
    entry.disposables.push(geo);
    const mat = this.material(entry, {
      color: get('color'),
      texture: get('texture', ''),
      roughness: get('roughness', 0.6),
      metallic: get('metallic', 0),
      emission: get('emission'),
      unshaded: get('unshaded', false) === true,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.castShadow = get('castShadows', true) !== false;
    mesh.receiveShadow = true;
    content.add(mesh);
  }

  buildModel(entry, content) {
    const path = this.doc.get(entry.node, 'model');
    if (!path) {
      this.addIcon(entry, 'model');
      return;
    }
    entry.deps.add(path);
    const cast = this.doc.get(entry.node, 'castShadows') !== false;
    const model = this.loadModel(path);
    for (const d of model.deps) entry.deps.add(d);
    model.promise.then(
      ({ gltf }) => {
        for (const d of model.deps) entry.deps.add(d);
        if (entry.dead || entry.content !== content) return;
        const obj = this.lib.SkeletonUtils.clone(gltf.scene);
        obj.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = cast;
            o.receiveShadow = true;
            for (const mat of Array.isArray(o.material) ? o.material : [o.material]) this.applyEnv(mat);
          }
        });
        content.add(obj);
        this.updateSelectionVisuals();
        this.requestRender();
      },
      (err) => {
        for (const d of model.deps) entry.deps.add(d);
        if (entry.dead || entry.content !== content) return;
        this.addIcon(entry, 'model');
        this.toast(`Couldn't load ${path}: ${err.message || err}`);
        this.requestRender();
      },
    );
  }

  buildSprite(entry, content) {
    const T = this.THREE;
    const get = (k, d) => this.doc.get(entry.node, k) ?? d;
    const path = get('image', '');
    if (!path) {
      this.addIcon(entry, 'image');
      return;
    }
    const info = this.texture(path, entry);
    const geo = new T.PlaneGeometry(1, 1);
    entry.disposables.push(geo);
    const mat = this.material(entry, { color: get('color'), unshaded: get('unshaded', true) !== false, roughness: 1, side: T.DoubleSide });
    mat.transparent = true;
    mat.alphaTest = 0.01;
    const mesh = new T.Mesh(geo, mat);
    mesh.visible = false;
    content.add(mesh);
    if (get('billboard', true) !== false) {
      entry.billboard = mesh;
      this.billboards.add(entry);
    }
    const px = Math.max(1e-6, num(get('pixelSize', 0.01), 0.01));
    info.ready.then(
      () => {
        if (entry.dead || entry.content !== content) return;
        mat.map = info.tex;
        mat.needsUpdate = true;
        mesh.scale.set(info.w * px, info.h * px, 1);
        mesh.visible = true;
        this.updateSelectionVisuals();
        this.requestRender();
      },
      () => {
        if (entry.dead || entry.content !== content) return;
        this.addIcon(entry, 'image');
        this.requestRender();
      },
    );
  }

  gameAspect() {
    try {
      const d = this.project?.settings?.()?.display;
      if (d && d.width > 0 && d.height > 0) return d.width / d.height;
    } catch {
      // A project without settings.
    }
    return 16 / 9;
  }

  buildCamera(entry, content) {
    const get = (k, d) => this.doc.get(entry.node, k) ?? d;
    const aspect = this.gameAspect();
    const pts = [];
    const L = 1.2;
    let hw, hh;
    if (get('projection', 'perspective') === 'orthographic') {
      hh = Math.max(0.01, num(get('size', 10), 10)) / 2;
      hw = hh * aspect;
      const r = (z) => [-hw, -hh, z, hw, -hh, z, hw, -hh, z, hw, hh, z, hw, hh, z, -hw, hh, z, -hw, hh, z, -hw, -hh, z];
      pts.push(...r(0), ...r(-L * 2));
      for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) pts.push(x, y, 0, x, y, -L * 2);
    } else {
      const fov = (clamp(num(get('fov', 70), 70), 1, 179) * PI) / 180;
      hh = Math.tan(fov / 2) * L;
      hw = hh * aspect;
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      for (const [x, y] of corners) pts.push(0, 0, 0, x, y, -L);
      for (let i = 0; i < 4; i++) pts.push(...corners[i], -L, ...corners[(i + 1) % 4], -L);
    }
    // A triangle above the frame shows which way is up.
    const z = get('projection', 'perspective') === 'orthographic' ? 0 : -L;
    const t = hh * 1.1, s = Math.min(hw, hh) * 0.35;
    pts.push(-s, t, z, 0, t + s, z, 0, t + s, z, s, t, z, s, t, z, -s, t, z);
    content.add(this.lines(entry, pts, COLORS.camera, { opacity: 0.9 }));
    this.addIcon(entry, 'camera');
  }

  buildLight(entry, content) {
    const T = this.THREE;
    const get = (k, d) => this.doc.get(entry.node, k) ?? d;
    const c = get('color', [1, 1, 1, 1]);
    const color = new T.Color().setRGB(num(c[0], 1), num(c[1], 1), num(c[2], 1), T.SRGBColorSpace);
    // The engine's lights don't divide by pi; three's physical lights do.
    const intensity = Math.max(0, num(get('energy', 1), 1)) * PI;
    const type = entry.node.type;
    if (type === 'DirectionalLight3D') {
      const light = new T.DirectionalLight(color, intensity);
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.03;
      this.lightsRoot.add(light, light.target);
      entry.light = light;
      this.dirLights.add(entry);
      const pts = [0, 0, 0, 0, 0, -1.6];
      for (const [x, y] of [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]]) pts.push(0, 0, -1.6, x, y, -1.35);
      content.add(this.lines(entry, pts, COLORS.light, { opacity: 0.9 }));
      this.addIcon(entry, 'sun');
    } else if (type === 'PointLight3D') {
      const range = num(get('range', 8), 8);
      const light = new T.PointLight(color, range > 0 ? intensity : 0, Math.max(range, 1e-3), 0);
      content.add(light);
      entry.light = light;
      this.addIcon(entry, 'bulb');
    } else {
      const range = num(get('range', 12), 12);
      const angle = clamp(num(get('angle', 0.5236), 0.5236), 0.001, PI / 2 - 0.001);
      // The engine's soft edge: smoothstep from cos(angle) to a quarter of the way to 1.
      const inner = Math.acos(Math.min(1, Math.cos(angle) + 0.25 * (1 - Math.cos(angle))));
      const light = new T.SpotLight(color, range > 0 ? intensity : 0, Math.max(range, 1e-3), angle, clamp(1 - inner / angle, 0, 1), 0);
      light.target.position.set(0, 0, -1);
      content.add(light, light.target);
      entry.light = light;
      const L = Math.min(range, 1.5);
      const r = Math.tan(angle) * L;
      const pts = [];
      for (const [x, y] of [[r, 0], [-r, 0], [0, r], [0, -r]]) pts.push(0, 0, 0, x, y, -L);
      arc(pts, [0, 0, -L], X, Y, r, 0, 2 * PI, 32);
      content.add(this.lines(entry, pts, COLORS.light, { opacity: 0.9 }));
      this.addIcon(entry, 'spot');
    }
  }

  buildCollision(entry, content) {
    const get = (k, d) => this.doc.get(entry.node, k) ?? d;
    const size = (k, d) => Math.max(0, num(get(k, d), d));
    const pts = [];
    switch (get('shape', 'box')) {
      case 'sphere': {
        const r = size('radius', 0.5);
        arc(pts, [0, 0, 0], X, Y, r, 0, 2 * PI, 48);
        arc(pts, [0, 0, 0], Z, Y, r, 0, 2 * PI, 48);
        arc(pts, [0, 0, 0], X, Z, r, 0, 2 * PI, 48);
        break;
      }
      case 'cylinder': {
        const r = size('radius', 0.5), hh = size('height', 1) / 2;
        arc(pts, [0, hh, 0], X, Z, r, 0, 2 * PI, 48);
        arc(pts, [0, -hh, 0], X, Z, r, 0, 2 * PI, 48);
        for (const [x, z] of [[r, 0], [-r, 0], [0, r], [0, -r]]) pts.push(x, hh, z, x, -hh, z);
        break;
      }
      case 'capsule': {
        const r = size('radius', 0.5);
        const hc = Math.max(0, size('height', 1) - 2 * r) / 2;
        arc(pts, [0, hc, 0], X, Z, r, 0, 2 * PI, 48);
        arc(pts, [0, -hc, 0], X, Z, r, 0, 2 * PI, 48);
        for (const [x, z] of [[r, 0], [-r, 0], [0, r], [0, -r]]) pts.push(x, hc, z, x, -hc, z);
        for (const u of [X, Z]) {
          arc(pts, [0, hc, 0], u, Y, r, 0, PI, 24);
          arc(pts, [0, -hc, 0], u, Y, r, PI, 2 * PI, 24);
        }
        break;
      }
      case 'mesh':
        return; // uses the parent's mesh; nothing of its own to draw
      default:
        boxLines(pts, size('width', 1) / 2, size('height', 1) / 2, size('depth', 1) / 2);
    }
    const off = get('disabled', false) === true;
    content.add(this.lines(entry, pts, off ? COLORS.collisionOff : COLORS.collision, { depthTest: false, opacity: off ? 0.4 : 0.85 }));
  }

  addIcon(entry, kind) {
    if (entry.icon) return;
    const T = this.THREE;
    const sprite = new T.Sprite(this.iconMaterial(kind, this.isSelected(entry)));
    sprite.renderOrder = 500;
    sprite.userData.entry = entry;
    sprite.userData.kind = kind;
    entry.icon = sprite;
    this.iconLayer.add(sprite);
  }

  iconMaterial(kind, selected) {
    const key = `${kind}:${selected ? 1 : 0}`;
    let m = this.iconMaterials.get(key);
    if (!m) {
      const T = this.THREE;
      const tex = new T.CanvasTexture(drawIcon(kind, selected, this.accent));
      tex.colorSpace = T.SRGBColorSpace;
      m = new T.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true, fog: false, toneMapped: false });
      this.iconMaterials.set(key, m);
    }
    return m;
  }

  /** Scene-wide state: environment, default light, shadows, status. */
  refreshScene() {
    const T = this.THREE;
    let env = null;
    let lightCount = 0;
    let visibleLights = 0;
    let shadowTaken = false;
    for (const e of this.entries.values()) {
      const type = e.node.type;
      if (type === 'Environment3D' && !env) env = e.node;
      if (LIGHT_TYPES.has(type)) {
        lightCount++;
        const vis = this.effectiveVisible(e.group);
        if (vis) visibleLights++;
        if (e.light?.isDirectionalLight) {
          const cast = vis && !shadowTaken && this.doc.get(e.node, 'shadows') !== false;
          e.light.castShadow = cast;
          if (cast) shadowTaken = true;
        }
      }
    }
    this.defaultLight.visible = visibleLights === 0;
    this.lightNote = !lightCount
      ? 'No lights in the scene: showing it with default light'
      : !visibleLights ? 'Every light is hidden: showing the scene with default light' : '';

    // Environment3D, or its defaults when the scene has none.
    const get = (k) => (env ? this.doc.get(env, k) : defaultOf('Environment3D', k));
    const srgb = (c, d = [1, 1, 1]) => new T.Color().setRGB(num(c?.[0], d[0]), num(c?.[1], d[1]), num(c?.[2], d[2]), T.SRGBColorSpace);
    const sky = get('background') !== 'color';
    const energy = Math.max(0, num(get('ambientEnergy'), 0.4));
    const tint = srgb(get('ambient'));
    if (sky) {
      const top = srgb(get('skyTop')), hor = srgb(get('skyHorizon')), bot = srgb(get('skyBottom'));
      this.skyUniforms.uTop.value.copy(top);
      this.skyUniforms.uHorizon.value.copy(hor);
      this.skyUniforms.uBottom.value.copy(bot);
      this.sky.visible = true;
      this.scene.background = null;
      // Like the engine: the sky above and the ground below, tinted by ambient.
      this.hemi.color.copy(hor).add(top).multiplyScalar(0.5).multiply(tint);
      this.hemi.groundColor.copy(hor).add(bot).multiplyScalar(0.5).multiply(tint);
      this.hemi.intensity = energy * PI;
      this.ambient.intensity = 0;
    } else {
      this.sky.visible = false;
      this.scene.background = srgb(get('color'));
      this.ambient.color.copy(tint);
      this.ambient.intensity = energy * PI;
      this.hemi.intensity = 0;
    }
    this.updateEnvMap(sky, sky ? [this.skyUniforms.uTop.value, this.skyUniforms.uHorizon.value, this.skyUniforms.uBottom.value] : [tint], energy);
    if (env && get('fog') === true) {
      const start = Math.max(0, num(get('fogStart'), 20));
      this.envFog = new T.Fog(srgb(get('fogColor')), start, Math.max(start + 0.01, num(get('fogEnd'), 120)));
    } else {
      this.envFog = null;
    }
    this.updateStatus();
  }

  /**
   * Metals reflect the sky in the engine (or the ambient color without a sky),
   * scaled by ambientEnergy. three.js needs an environment map for that; it's
   * only given to metallic materials, so the ambient light isn't counted twice.
   */
  updateEnvMap(sky, colors, energy) {
    const T = this.THREE;
    this.envEnergy = energy;
    const key = `${sky}|${colors.map((c) => c.getHexString()).join(',')}`;
    if (key !== this.envKey) {
      this.envKey = key;
      this.pmrem ||= new T.PMREMGenerator(this.renderer);
      const envScene = new T.Scene();
      if (sky) {
        const [top, hor, bot] = colors;
        const mat = new T.ShaderMaterial({
          side: T.BackSide,
          uniforms: { uTop: { value: top.clone() }, uHorizon: { value: hor.clone() }, uBottom: { value: bot.clone() } },
          vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: /* glsl */ `
            uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; varying vec3 vDir;
            void main() {
              float y = clamp(normalize(vDir).y, -1.0, 1.0);
              vec3 c = y >= 0.0 ? mix(uHorizon, uTop, 1.0 - pow(1.0 - y, 3.0)) : mix(uHorizon, uBottom, 1.0 - pow(1.0 + y, 12.0));
              gl_FragColor = vec4(c, 1.0);
            }`,
        });
        envScene.add(new T.Mesh(new T.SphereGeometry(10, 48, 24), mat));
      } else {
        envScene.background = colors[0].clone();
      }
      const rt = this.pmrem.fromScene(envScene, 0, 0.1, 100);
      envScene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.envMap?.dispose();
      this.envMap = rt;
    }
    this.world.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) this.applyEnv(m);
    });
  }

  applyEnv(mat) {
    if (!mat.isMeshStandardMaterial || !this.envMap) return;
    const want = mat.metalness > 0 ? this.envMap.texture : null;
    if (mat.envMap !== want) {
      mat.envMap = want;
      mat.needsUpdate = true;
    }
    mat.envMapIntensity = this.envEnergy ?? 1;
  }

  // ---------------------------------------------------------------------------
  // Textures and models, cached per project path

  texture(path, entry) {
    entry?.deps.add(path);
    let info = this.textures.get(path);
    if (info) return info;
    const T = this.THREE;
    info = { tex: null, w: 0, h: 0, loaded: false, ready: null };
    const bytes = this.project?.readBytes?.(path);
    if (!bytes) {
      info.ready = Promise.reject(new Error(`${path} isn't in the project`));
    } else {
      const tex = (info.tex = new T.Texture());
      tex.colorSpace = T.SRGBColorSpace;
      this.applyFilter(tex);
      info.ready = new Promise((resolve, reject) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          tex.image = img;
          tex.needsUpdate = true;
          info.w = img.naturalWidth;
          info.h = img.naturalHeight;
          info.loaded = true;
          resolve(info);
          this.requestRender();
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error(`${path} isn't an image the browser can read`));
        };
        img.src = url;
      });
    }
    info.ready.catch(() => {});
    this.textures.set(path, info);
    return info;
  }

  applyFilter(tex) {
    const T = this.THREE;
    let pixel = false;
    try {
      pixel = this.project?.settings?.()?.display?.filter === 'pixel';
    } catch {
      // No settings.
    }
    tex.magFilter = pixel ? T.NearestFilter : T.LinearFilter;
    tex.minFilter = pixel ? T.NearestMipmapNearestFilter : T.LinearMipmapLinearFilter;
    tex.anisotropy = pixel ? 1 : 4;
  }

  /**
   * A model file, parsed once per path: { promise -> {gltf}, deps }. deps are
   * the project files it was made from (a .gltf's .bin and images too), so a
   * change to any of them reloads it.
   */
  loadModel(path) {
    let m = this.models.get(path);
    if (m) return m;
    const T = this.THREE;
    const project = this.project;
    m = { deps: new Set([path]), gltf: null, promise: null };
    m.promise = new Promise((resolve, reject) => {
      const bytes = project?.readBytes?.(path);
      if (!bytes) throw new Error(`${path} isn't in the project`);
      const blobs = [];
      const manager = new T.LoadingManager();
      // Relative URIs inside the file resolve against a fake origin; they're
      // served from the project's files as blob URLs.
      manager.setURLModifier((url) => {
        let u;
        try {
          u = new URL(url);
        } catch {
          return url;
        }
        if (u.host !== PROJECT_HOST) return url;
        const p = decodeURIComponent(u.pathname.slice(1));
        m.deps.add(p);
        const b = project.readBytes(p);
        if (!b) return url;
        const blob = URL.createObjectURL(new Blob([b], { type: mimeOf(p) }));
        blobs.push(blob);
        return blob;
      });
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      const base = `https://${PROJECT_HOST}/${dir.split('/').map(encodeURIComponent).join('/')}`;
      const loader = new this.lib.GLTFLoader(manager);
      const done = () => blobs.forEach((b) => URL.revokeObjectURL(b));
      loader.parse(
        toArrayBuffer(bytes),
        base,
        (gltf) => {
          done();
          m.gltf = gltf;
          resolve({ gltf });
        },
        (err) => {
          done();
          reject(err instanceof Error ? err : new Error(String(err?.message || err)));
        },
      );
    });
    m.promise.catch(() => {});
    this.models.set(path, m);
    return m;
  }

  disposeObject(obj) {
    obj.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v?.isTexture) v.dispose();
        mat.dispose();
      }
    });
  }

  onFile = (e) => {
    if (!this.lib) return;
    const { path, from } = e.detail || {};
    const touched = [path, from].filter(Boolean);
    if (!touched.length) return;
    for (const p of touched) {
      const t = this.textures.get(p);
      if (t) {
        t.tex?.dispose();
        this.textures.delete(p);
      }
    }
    const stale = [];
    for (const [mp, m] of this.models) {
      if (touched.some((p) => m.deps.has(p))) {
        this.models.delete(mp);
        stale.push(m);
      }
    }
    if (this.doc && touched.some((p) => SCENE_RE.test(p) && p !== this.doc.path) && this.hasInstances()) {
      this.rebuild();
    } else {
      for (const entry of [...this.entries.values()]) {
        if (!entry.dead && touched.some((p) => entry.deps.has(p))) this.rebuildContent(entry);
      }
      this.refreshScene();
      this.updateSelectionVisuals();
    }
    for (const m of stale) if (m.gltf) this.disposeObject(m.gltf.scene);
    this.requestRender();
  };

  onSettings = () => {
    if (!this.lib) return;
    for (const t of this.textures.values()) {
      if (!t.tex) continue;
      this.applyFilter(t.tex);
      t.tex.needsUpdate = true;
    }
    for (const entry of this.entries.values()) if (entry.node.type === 'Camera3D') this.rebuildContent(entry);
    this.requestRender();
  };

  hasInstances() {
    for (const e of this.entries.values()) if (e.node.instance) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Doc events

  onDocChange = (e) => {
    if (!this.lib) return;
    const { kind, node } = e.detail || {};
    const entry = node && this.entries.get(node.id);
    if (kind === 'props' && entry && entry.node === node) {
      this.updateEntry(entry);
      // A multi-node handle drag changes every selected node in one edit.
      if (this.dragging) {
        for (const id of this.doc.selection) {
          const other = this.entries.get(id);
          if (other && other !== entry) this.updateEntry(other);
        }
      }
      this.refreshScene();
      this.updateSelectionVisuals();
      this.syncGizmo();
      this.requestRender();
    } else {
      this.rebuild();
    }
  };

  onDocSelect = () => {
    if (!this.lib) return;
    this.updateSelectionVisuals();
    this.syncGizmo();
    this.requestRender();
  };

  isSelected(entry) {
    return !!this.doc && this.doc.selection.has(entry.node.id);
  }

  /** Icon highlight and the gizmos only shown for selected nodes. */
  updateSelectionVisuals() {
    if (!this.lib) return;
    for (const s of this.iconLayer.children) {
      s.material = this.iconMaterial(s.userData.kind, this.isSelected(s.userData.entry));
    }
    for (const x of this.extras || []) {
      x.parent?.remove(x);
      x.geometry.dispose();
      x.material.dispose();
    }
    this.extras = [];
    if (!this.doc) return;
    for (const id of this.doc.selection) {
      const entry = this.entries.get(id);
      if (!entry?.content) continue;
      const type = entry.node.type;
      const pts = [];
      if (type === 'PointLight3D') {
        const r = Math.max(0, num(this.doc.get(entry.node, 'range'), 8));
        arc(pts, [0, 0, 0], X, Y, r, 0, 2 * PI, 64);
        arc(pts, [0, 0, 0], Z, Y, r, 0, 2 * PI, 64);
        arc(pts, [0, 0, 0], X, Z, r, 0, 2 * PI, 64);
      } else if (type === 'SpotLight3D') {
        const L = Math.max(0, num(this.doc.get(entry.node, 'range'), 12));
        const a = clamp(num(this.doc.get(entry.node, 'angle'), 0.5236), 0.001, PI / 2 - 0.001);
        const r = Math.tan(a) * L;
        for (const [x, y] of [[r, 0], [-r, 0], [0, r], [0, -r]]) pts.push(0, 0, 0, x, y, -L);
        arc(pts, [0, 0, -L], X, Y, r, 0, 2 * PI, 64);
      } else {
        continue;
      }
      const T = this.THREE;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      const ls = new T.LineSegments(geo, new T.LineBasicMaterial({ color: COLORS.light, transparent: true, opacity: 0.55, fog: false, toneMapped: false }));
      ls.userData.noBounds = true;
      ls.userData.noPick = true;
      entry.content.add(ls);
      this.extras.push(ls);
    }
  }

  // ---------------------------------------------------------------------------
  // Transform handles

  /** Selected nodes the handles move: 3D ones, without those whose parent moves them already. */
  editableSelection() {
    if (!this.doc) return [];
    const sel = this.doc.selection;
    const underSelected = (n) => {
      for (let p = n.parent; p; p = p.parent) if (sel.has(p.id)) return true;
      return false;
    };
    return this.doc.selected().filter((n) => !n.readonly && isA(n.type, 'Node3D') && this.entries.has(n.id) && !underSelected(n));
  }

  syncGizmo() {
    if (!this.tc || this.dragging) return;
    const nodes = this.tool === 'select' ? [] : this.editableSelection();
    if (!nodes.length) {
      if (this.tc.object) this.tc.detach();
      this.requestRender();
      return;
    }
    this.tc.setMode(TOOL_MODES[this.tool]);
    this.tc.setSpace(this.space);
    this.placeProxy(nodes);
    if (this.tc.object !== this.proxy) this.tc.attach(this.proxy);
    this.applySnap();
    this.requestRender();
  }

  placeProxy(nodes) {
    const { v, v2 } = this.tmp;
    this.scene.updateMatrixWorld();
    if (nodes.length === 1) {
      this.entries.get(nodes[0].id).group.matrixWorld.decompose(this.proxy.position, this.proxy.quaternion, v);
    } else {
      v2.set(0, 0, 0);
      for (const n of nodes) v2.add(this.entries.get(n.id).group.getWorldPosition(v));
      this.proxy.position.copy(v2.multiplyScalar(1 / nodes.length));
      this.proxy.quaternion.identity();
    }
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld(true);
  }

  snapActive() {
    return !!this.settings.snap !== this.ctrlHeld;
  }

  applySnap() {
    if (!this.tc) return;
    const on = this.snapActive();
    const step = num(this.settings.snapStep, 0.25) || 0.25;
    const angle = num(this.settings.angleSnap, 15) || 15;
    if (this.tc.translationSnap !== (on ? step : null)) this.tc.setTranslationSnap(on ? step : null);
    if (this.tc.rotationSnap !== (on ? (angle * PI) / 180 : null)) this.tc.setRotationSnap(on ? (angle * PI) / 180 : null);
    if (this.tc.scaleSnap !== (on ? 0.1 : null)) this.tc.setScaleSnap(on ? 0.1 : null);
  }

  beginGizmoDrag() {
    const T = this.THREE;
    this.scene.updateMatrixWorld();
    const nodes = this.editableSelection();
    this.dragging = true;
    this.drag = {
      tool: this.tool,
      p0: this.proxy.position.clone(),
      q0: this.proxy.quaternion.clone(),
      items: nodes.map((node) => {
        const e = this.entries.get(node.id);
        const parent = e.group.parent;
        return {
          node,
          wpos: e.group.getWorldPosition(new T.Vector3()),
          wquat: e.group.getWorldQuaternion(new T.Quaternion()),
          scale: [num(this.doc.get(node, 'scaleX'), 1), num(this.doc.get(node, 'scaleY'), 1), num(this.doc.get(node, 'scaleZ'), 1)],
          rot: [num(this.doc.get(node, 'rotationX')), num(this.doc.get(node, 'rotationY')), num(this.doc.get(node, 'rotationZ'))],
          parentInv: parent.matrixWorld.clone().invert(),
          parentQuatInv: parent.getWorldQuaternion(new T.Quaternion()).invert(),
        };
      }),
    };
  }

  gizmoChanged() {
    const d = this.drag;
    if (!d || !d.items.length) return;
    const T = this.THREE;
    const p1 = this.proxy.position, q1 = this.proxy.quaternion, s1 = this.proxy.scale;
    const many = d.items.length > 1;
    const dq = q1.clone().multiply(d.q0.clone().invert());
    const q0inv = d.q0.clone().invert();
    const changes = [];
    const local = (w, it) => w.applyMatrix4(it.parentInv);
    for (const it of d.items) {
      const values = {};
      const setPos = (w) => {
        const l = local(w, it);
        values.x = round6(l.x);
        values.y = round6(l.y);
        values.z = round6(l.z);
      };
      if (d.tool === 'move') {
        setPos(it.wpos.clone().add(new T.Vector3().subVectors(p1, d.p0)));
      } else if (d.tool === 'rotate') {
        const lq = it.parentQuatInv.clone().multiply(dq.clone().multiply(it.wquat));
        const e = new T.Euler().setFromQuaternion(lq, 'YXZ');
        const [rx, ry, rz] = closestEuler(e.x, e.y, e.z, it.rot);
        values.rotationX = round6(rx);
        values.rotationY = round6(ry);
        values.rotationZ = round6(rz);
        if (many) setPos(it.wpos.clone().sub(d.p0).applyQuaternion(dq).add(d.p0));
      } else if (d.tool === 'scale') {
        values.scaleX = round6(it.scale[0] * s1.x);
        values.scaleY = round6(it.scale[1] * s1.y);
        values.scaleZ = round6(it.scale[2] * s1.z);
        if (many) setPos(it.wpos.clone().sub(d.p0).applyQuaternion(q0inv).multiply(s1).applyQuaternion(d.q0).add(d.p0));
      }
      changes.push({ node: it.node, values });
    }
    this.commit(changes, TOOL_LABELS[d.tool] || 'Transform');
  }

  /** One undoable edit; continuous drags merge into one undo step. */
  commit(changes, label) {
    const doc = this.doc;
    if (changes.length === 1) {
      const { node, values } = changes[0];
      doc.setProps(node, values, { merge: 'gizmo', label: `${label} ${node.name}` });
      return;
    }
    // Several nodes: one compound edit (like setProps, values equal to the
    // default are removed, except on instances, which keep overrides).
    const before = changes.map(({ node, values }) => {
      const b = {};
      for (const k of Object.keys(values)) b[k] = k in node.props ? clone(node.props[k]) : undefined;
      return b;
    });
    const after = changes.map(({ node, values }) => {
      const a = {};
      for (const [k, v] of Object.entries(values)) a[k] = !node.instance && equal(v, defaultOf(node.type, k)) ? undefined : v;
      return a;
    });
    const set = (node, vals) => {
      for (const [k, v] of Object.entries(vals)) {
        if (v === undefined) delete node.props[k];
        else node.props[k] = clone(v);
      }
    };
    doc.apply({
      label: `${label} ${changes.length} nodes`,
      node: changes[0].node,
      kind: 'props',
      merge: `gizmo:${changes.map((c) => c.node.id).join(',')}`,
      redo: () => changes.forEach((c, i) => set(c.node, after[i])),
      undo: () => changes.forEach((c, i) => set(c.node, before[i])),
    });
  }

  endGizmoDrag() {
    this.dragging = false;
    this.drag = null;
    this.syncGizmo();
  }

  // ---------------------------------------------------------------------------
  // Editor camera

  activeCamera() {
    return this.cam.ortho ? this.ortho : this.persp;
  }

  camQuat(out = this.tmp.q) {
    return out.setFromEuler(this.tmp.e.set(this.cam.pitch, this.cam.yaw, 0, 'YXZ'));
  }

  forward(out = this.tmp.v) {
    return out.set(0, 0, -1).applyQuaternion(this.camQuat(this.tmp.q2));
  }

  camPosition(out) {
    return out.copy(this.cam.target).addScaledVector(this.forward(this.tmp.v3), -this.cam.distance);
  }

  updateCameras() {
    const c = this.cam;
    const aspect = this.width / Math.max(1, this.height) || 1;
    const q = this.camQuat();
    const fwd = this.forward();
    const p = this.persp;
    p.quaternion.copy(q);
    p.position.copy(c.target).addScaledVector(fwd, -c.distance);
    p.aspect = aspect;
    p.near = clamp(c.distance * 0.002, 0.005, 1);
    p.far = Math.max(1000, c.distance * 100);
    p.updateProjectionMatrix();
    p.updateMatrixWorld();
    const o = this.ortho;
    const hh = c.orthoHeight / 2;
    o.left = -hh * aspect;
    o.right = hh * aspect;
    o.top = hh;
    o.bottom = -hh;
    o.quaternion.copy(q);
    o.position.copy(c.target).addScaledVector(fwd, -ORTHO_BACK);
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
  }

  /** World units per screen pixel at the orbit target's depth. */
  worldPerPixel() {
    const c = this.cam;
    const h = c.ortho ? c.orthoHeight : 2 * c.distance * Math.tan((this.persp.fov * PI) / 360);
    return h / Math.max(1, this.height);
  }

  setRay(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new this.THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.updateCameras();
    this.raycaster.setFromCamera(ndc, this.activeCamera());
    return this.raycaster.ray;
  }

  orbit(dx, dy) {
    const c = this.cam;
    this.anim = null;
    if (c.ortho && c.orthoAuto) this.setOrtho(false);
    if (c.view) {
      c.view = null;
      this.updateStatus();
    }
    c.yaw -= dx * 0.008;
    c.pitch = clamp(c.pitch - dy * 0.008, -PI / 2, PI / 2);
    this.requestRender();
  }

  pan(dx, dy) {
    const T = this.THREE;
    const c = this.cam;
    this.anim = null;
    const k = this.worldPerPixel();
    const q = this.camQuat();
    c.target.addScaledVector(new T.Vector3(1, 0, 0).applyQuaternion(q), -dx * k);
    c.target.addScaledVector(new T.Vector3(0, 1, 0).applyQuaternion(q), dy * k);
    this.requestRender();
  }

  zoomAt(clientX, clientY, factor) {
    const T = this.THREE;
    const c = this.cam;
    this.anim = null;
    const ray = this.setRay(clientX, clientY);
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(this.forward(new T.Vector3()), c.target);
    const P = ray.intersectPlane(plane, new T.Vector3());
    if (c.ortho) {
      const h = clamp(c.orthoHeight * factor, 0.01, 1e5);
      factor = h / c.orthoHeight;
      c.orthoHeight = h;
    } else {
      const d = clamp(c.distance * factor, 0.05, 1e5);
      factor = d / c.distance;
      c.distance = d;
    }
    if (P) c.target.sub(P).multiplyScalar(factor).add(P);
    this.requestRender();
  }

  setOrtho(on, auto = false) {
    const c = this.cam;
    if (c.ortho === on) return;
    const tanH = Math.tan((this.persp.fov * PI) / 360);
    if (on) c.orthoHeight = 2 * c.distance * tanH;
    else c.distance = c.orthoHeight / (2 * tanH);
    c.ortho = on;
    c.orthoAuto = on && auto;
    this.tc.camera = this.activeCamera();
    this.updateProjectionButtons();
    this.updateStatus();
    this.requestRender();
  }

  updateProjectionButtons() {
    if (!this.projButton) return;
    this.projButton.textContent = this.cam.ortho ? 'Ortho' : 'Persp';
    this.projButton.classList.toggle('is-on', this.cam.ortho);
    for (const [name, b] of Object.entries(this.viewButtons)) {
      const v = this.cam.view;
      b.classList.toggle('is-on', v === name || (name === 'top' && v === 'bottom') || (name === 'front' && v === 'back') || (name === 'right' && v === 'left'));
    }
  }

  setView(name) {
    const v = VIEWS[name];
    if (!v) return;
    const c = this.cam;
    if (!c.ortho) this.setOrtho(true, true);
    c.view = name;
    this.animateTo({ yaw: nearestAngle(v.yaw, c.yaw), pitch: v.pitch });
    this.updateProjectionButtons();
    this.updateStatus();
  }

  animateTo(to, animate = true) {
    const c = this.cam;
    const from = { target: c.target.clone(), yaw: c.yaw, pitch: c.pitch, distance: c.distance, orthoHeight: c.orthoHeight };
    // A move started while another is running keeps that one's goal for what it doesn't change.
    const base = this.anim ? this.anim.to : from;
    const goal = { ...base, ...to, target: (to.target || base.target).clone() };
    if (!animate) {
      this.anim = null;
      Object.assign(c, { yaw: goal.yaw, pitch: goal.pitch, distance: goal.distance, orthoHeight: goal.orthoHeight });
      c.target.copy(goal.target);
      this.requestRender();
      return;
    }
    this.anim = { from, to: goal, t0: performance.now(), dur: 240 };
    this.requestRender();
  }

  stepAnim(now) {
    const { from, to, t0, dur } = this.anim;
    const t = clamp((now - t0) / dur, 0, 1);
    const k = 1 - (1 - t) ** 3;
    const c = this.cam;
    const lerp = (a, b) => a + (b - a) * k;
    const logLerp = (a, b) => Math.exp(lerp(Math.log(Math.max(a, 1e-6)), Math.log(Math.max(b, 1e-6))));
    c.target.lerpVectors(from.target, to.target, k);
    c.yaw = lerp(from.yaw, to.yaw);
    c.pitch = lerp(from.pitch, to.pitch);
    c.distance = logLerp(from.distance, to.distance);
    c.orthoHeight = logLerp(from.orthoHeight, to.orthoHeight);
    if (t >= 1) this.anim = null;
    return true;
  }

  /** Frames entries (or everything when list is null). */
  frameEntries(list, animate) {
    const T = this.THREE;
    this.scene.updateMatrixWorld();
    const box = new T.Box3();
    const add = (entry, deep) => {
      if (!this.effectiveVisible(entry.group)) return;
      const b = this.boundsOf(deep ? entry.group : entry.content, new T.Box3());
      if (!b.isEmpty()) box.union(b);
      else if (entry.is3d) box.expandByPoint(entry.group.getWorldPosition(new T.Vector3()));
    };
    if (list) for (const e of list) add(e, true);
    else for (const e of this.entries.values()) if (e.content) add(e, false);
    if (box.isEmpty()) box.setFromCenterAndSize(new T.Vector3(), new T.Vector3(3, 3, 3));
    const min = list ? 0.3 : 4; // a whole scene is shown with some ground around it
    const size = box.getSize(new T.Vector3());
    box.expandByVector(size.set(Math.max(0, min - size.x), Math.max(0, min - size.y), Math.max(0, min - size.z)).multiplyScalar(0.5));
    const center = box.getCenter(new T.Vector3());
    // Fit the box's corners in the view, as seen from the current direction.
    const aspect = this.width / Math.max(1, this.height) || 1;
    const tanV = Math.tan((this.persp.fov * PI) / 360);
    const tanH = tanV * aspect;
    const goal = this.anim ? this.anim.to : this.cam;
    const q = new T.Quaternion().setFromEuler(new T.Euler(goal.pitch, goal.yaw, 0, 'YXZ'));
    const right = new T.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new T.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(q);
    let distance = 0, halfH = 0;
    const r = new T.Vector3();
    for (let i = 0; i < 8; i++) {
      r.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const x = Math.abs(r.dot(right)), y = Math.abs(r.dot(up)), z = r.dot(fwd);
      distance = Math.max(distance, x / tanH - z, y / tanV - z);
      halfH = Math.max(halfH, y, x / aspect);
    }
    this.animateTo({ target: center, distance: Math.max(distance * 1.25, 0.5), orthoHeight: Math.max(halfH * 2 * 1.25, 0.5) }, animate);
  }

  boundsOf(obj, box) {
    if (!obj) return box;
    const tmp = this.tmp.box2;
    obj.traverseVisible((o) => {
      if (o.userData.noBounds || !(o.isMesh || o.isLine) || !o.geometry) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox.isEmpty()) return;
      box.union(tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
    });
    return box;
  }

  startFly() {
    if (this.flying) return;
    this.flying = true;
    this.anim = null;
    if (this.cam.ortho) this.setOrtho(false);
    this.cam.view = null;
    this.root.classList.add('is-flying');
    this.root.classList.remove('is-pan');
    this.updateStatus();
  }

  stopFly() {
    if (!this.flying) return;
    this.flying = false;
    this.root.classList.remove('is-flying');
    this.updateStatus();
  }

  look(dx, dy) {
    const T = this.THREE;
    const c = this.cam;
    const pos = this.camPosition(new T.Vector3());
    c.yaw -= dx * 0.004;
    c.pitch = clamp(c.pitch - dy * 0.004, -PI / 2 + 0.01, PI / 2 - 0.01);
    c.target.copy(pos).addScaledVector(this.forward(new T.Vector3()), c.distance);
    this.requestRender();
  }

  flySpeed() {
    return Math.max(this.cam.distance, 1) * this.cam.flySpeed;
  }

  flyStep(dt) {
    const k = this.keys;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (!f && !r && !u) return false;
    const T = this.THREE;
    const q = this.camQuat();
    const move = new T.Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(f);
    move.addScaledVector(new T.Vector3(1, 0, 0).applyQuaternion(q), r);
    move.y += u;
    move.normalize().multiplyScalar(this.flySpeed() * (this.shiftHeld ? 3 : 1) * dt);
    this.cam.target.add(move);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Rendering

  requestRender() {
    this.needsRender = true;
  }

  effectiveVisible(obj) {
    for (let o = obj; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  render() {
    if (!this.renderer || this.disposed || !this.width) return;
    this.updateCameras();
    const cam = this.activeCamera();
    this.scene.fog = this.cam.ortho ? null : this.envFog;
    this.scene.updateMatrixWorld();
    this.updateFrame(cam);
    this.renderer.render(this.scene, cam);
    this.drawAxes();
  }

  /** Per-frame state that follows the camera. */
  updateFrame(cam) {
    const T = this.THREE;
    const c = this.cam;
    const { v, q } = this.tmp;

    // Sky.
    this.skyUniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    this.skyUniforms.uCamWorld.value.copy(cam.matrixWorld);
    this.skyUniforms.uOrtho.value = c.ortho ? 1 : 0;

    // Grid: on XZ, or on the plane facing an aligned orthographic view.
    const fwd = this.forward(new T.Vector3());
    let plane = 0;
    if (c.ortho && Math.abs(fwd.z) > 0.9999) plane = 1;
    else if (c.ortho && Math.abs(fwd.x) > 0.9999) plane = 2;
    const g = this.grid;
    g.rotation.set(plane === 0 ? -PI / 2 : 0, plane === 2 ? PI / 2 : 0, 0);
    const ref = c.ortho ? c.orthoHeight : Math.max(c.distance, Math.abs(cam.position.y) * 1.5);
    const fade = c.ortho ? c.orthoHeight * Math.max(1, this.width / Math.max(1, this.height)) * 1.5 : Math.max(ref * 8, 30);
    const center = plane === 0 ? new T.Vector3(cam.position.x, 0, cam.position.z) : c.target.clone();
    if (plane === 0 && c.ortho) center.set(c.target.x, 0, c.target.z);
    if (plane === 1) center.z = 0;
    if (plane === 2) center.x = 0;
    g.position.copy(center);
    g.scale.setScalar(fade * 2.2);
    const u = this.gridUniforms;
    u.uPlane.value = plane;
    u.uCenter.value.set(plane === 0 ? center.x : plane === 1 ? center.x : center.z, plane === 0 ? center.z : center.y);
    u.uFade.value = fade;
    u.uPx.value = this.renderer.getPixelRatio();
    const L = Math.log10(Math.max(ref / 10, 1e-4));
    u.uCell.value = 10 ** Math.floor(L);
    u.uLod.value = L - Math.floor(L);
    u.uAxisA.value.setHex(plane === 2 ? COLORS.axisZ : COLORS.axisX);
    u.uAxisB.value.setHex(plane === 0 ? COLORS.axisZ : COLORS.axisY);

    // Directional lights shine along their node's -Z; their three.js lights
    // sit around the camera's focus so shadows cover what's being looked at.
    const R = clamp((c.ortho ? c.orthoHeight : c.distance) * 1.5, 8, 250);
    const placeSun = (light, dir) => {
      light.target.position.copy(c.target);
      light.position.copy(c.target).addScaledVector(dir, -R * 1.5);
      light.target.updateMatrixWorld();
      light.updateMatrixWorld();
      if (light.castShadow) {
        const sc = light.shadow.camera;
        if (sc.right !== R) {
          sc.left = -R;
          sc.right = R;
          sc.top = R;
          sc.bottom = -R;
          sc.near = 0.1;
          sc.far = R * 3.5;
          sc.updateProjectionMatrix();
        }
      }
    };
    for (const e of this.dirLights) {
      const vis = this.effectiveVisible(e.group);
      e.light.visible = vis;
      if (vis) placeSun(e.light, v.set(0, 0, -1).applyQuaternion(e.group.getWorldQuaternion(q)));
    }
    if (this.defaultLight.visible) placeSun(this.defaultLight, this.defaultLight.userData.dir);

    // Billboard sprites face the camera.
    for (const e of this.billboards) {
      const mesh = e.billboard;
      mesh.parent.getWorldQuaternion(q);
      mesh.quaternion.copy(q.invert()).multiply(cam.quaternion);
      mesh.updateMatrixWorld();
    }

    // Icons keep a constant size on screen.
    const px = c.ortho ? c.orthoHeight / this.height : (2 * Math.tan((this.persp.fov * PI) / 360)) / this.height;
    const s = ICON_PX * px;
    for (const sprite of this.iconLayer.children) {
      const e = sprite.userData.entry;
      sprite.visible = !e.dead && this.effectiveVisible(e.group);
      if (!sprite.visible) continue;
      sprite.position.setFromMatrixPosition(e.group.matrixWorld);
      sprite.scale.set(s, s, 1);
      sprite.updateMatrixWorld();
    }

    this.updateSelectionBoxes();
  }

  /**
   * Corner brackets around each selected node's bounds. GL lines are one
   * device pixel wide, too thin to read, so each segment is a camera-facing
   * quad 2 CSS pixels wide.
   */
  updateSelectionBoxes() {
    const T = this.THREE;
    const sel = this.doc ? [...this.doc.selection].map((id) => this.entries.get(id)).filter(Boolean) : [];
    const SEGS = 24;
    while (this.selectionBoxes.length < sel.length) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(SEGS * 4 * 3), 3));
      const index = [];
      for (let i = 0; i < SEGS; i++) index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      geo.setIndex(index);
      const mat = new T.MeshBasicMaterial({ color: new T.Color(this.accent), side: T.DoubleSide, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false });
      const mesh = new T.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 950;
      this.helpers.add(mesh);
      this.selectionBoxes.push(mesh);
    }
    const cam = this.activeCamera();
    const camPos = cam.position;
    const fwd = this.forward(new T.Vector3());
    const tanV = Math.tan((this.persp.fov * PI) / 360);
    const half = 1 / Math.max(1, this.height); // 2 CSS px wide: 1 px either side
    const box = this.tmp.box;
    const a = new T.Vector3(), b = new T.Vector3(), d = new T.Vector3(), view = new T.Vector3(), side = new T.Vector3();
    const widthAt = (p) => (this.cam.ortho ? this.cam.orthoHeight : 2 * Math.max(0.001, view.copy(p).sub(camPos).dot(fwd)) * tanV) * half;
    this.selectionBoxes.forEach((mesh, i) => {
      const e = sel[i];
      mesh.visible = !!e;
      if (!e) return;
      box.makeEmpty();
      this.boundsOf(e.group, box);
      if (box.isEmpty()) box.setFromCenterAndSize(e.group.getWorldPosition(this.tmp.v), this.tmp.v2.setScalar(0.3));
      box.expandByScalar(Math.max(box.getSize(this.tmp.v2).length() * 0.02, 0.02));
      const { min, max } = box;
      const size = box.getSize(this.tmp.v2);
      const lx = size.x * 0.25, ly = size.y * 0.25, lz = size.z * 0.25;
      const arr = mesh.geometry.attributes.position.array;
      let k = 0;
      const put = (p, s, sign) => {
        arr[k++] = p.x + s.x * sign;
        arr[k++] = p.y + s.y * sign;
        arr[k++] = p.z + s.z * sign;
      };
      const seg = (x, y, z, dx, dy, dz) => {
        a.set(x, y, z);
        b.set(x + dx, y + dy, z + dz);
        d.subVectors(b, a);
        if (this.cam.ortho) view.copy(fwd);
        else view.subVectors(a, camPos);
        side.crossVectors(d, view).normalize();
        if (side.lengthSq() === 0) side.set(0, 0, 0);
        const wa = widthAt(a), wb = widthAt(b);
        // Extend each end by half the width so corners meet cleanly.
        const ext = d.clone().normalize();
        a.addScaledVector(ext, -wa);
        put(a, side, wa);
        put(a, side, -wa);
        put(b, side, -wb);
        put(b, side, wb);
      };
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            seg(x, y, z, x === min.x ? lx : -lx, 0, 0);
            seg(x, y, z, 0, y === min.y ? ly : -ly, 0);
            seg(x, y, z, 0, 0, z === min.z ? lz : -lz);
          }
        }
      }
      mesh.geometry.attributes.position.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------------------
  // Axis gizmo (top right): shows the camera's orientation; click to align.

  drawAxes() {
    const cv = this.axesCanvas;
    if (!cv) return;
    const T = this.THREE;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = 76;
    if (cv.width !== S * dpr) {
      cv.width = S * dpr;
      cv.height = S * dpr;
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const inv = this.camQuat(new T.Quaternion()).invert();
    const R = 26;
    const axes = [
      { d: [1, 0, 0], color: '#e5484d', label: 'X', view: 'right' },
      { d: [-1, 0, 0], color: '#e5484d', view: 'left' },
      { d: [0, 1, 0], color: '#46a758', label: 'Y', view: 'top' },
      { d: [0, -1, 0], color: '#46a758', view: 'bottom' },
      { d: [0, 0, 1], color: '#3e7bfa', label: 'Z', view: 'front' },
      { d: [0, 0, -1], color: '#3e7bfa', view: 'back' },
    ].map((a) => {
      const v = new T.Vector3(...a.d).applyQuaternion(inv);
      return { ...a, x: S / 2 + v.x * R, y: S / 2 - v.y * R, z: v.z };
    });
    axes.sort((a, b) => a.z - b.z);
    this.axesHits = axes;
    for (const a of axes) {
      if (a.label) {
        g.strokeStyle = a.color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(S / 2, S / 2);
        g.lineTo(a.x, a.y);
        g.stroke();
      }
      g.beginPath();
      g.arc(a.x, a.y, a.label ? 8 : 6, 0, 2 * PI);
      g.globalAlpha = a.label ? 1 : 0.45;
      g.fillStyle = a.color;
      g.fill();
      g.globalAlpha = 1;
      if (this.axesHot === a.view) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.5;
        g.stroke();
      }
      if (a.label) {
        g.fillStyle = '#10121c';
        g.font = '600 10px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(a.label, a.x, a.y + 0.5);
      }
    }
  }

  axesAt(e) {
    const r = this.axesCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null;
    for (const a of this.axesHits || []) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d <= 10 && (!best || a.z > best.z)) best = a;
    }
    return best;
  }

  axesHover(e) {
    const hot = this.axesAt(e)?.view || null;
    if (hot !== this.axesHot) {
      this.axesHot = hot;
      this.drawAxes();
    }
  }

  axesClick(e) {
    const a = this.axesAt(e);
    if (a) this.setView(a.view);
  }

  // ---------------------------------------------------------------------------
  // Picking and selection

  entryOf(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData.entry) return o.userData.entry;
    return null;
  }

  /** The node to select for an entry: instanced (read-only) nodes select their instance. */
  selectable(node) {
    let n = node;
    while (n && n.readonly) n = n.parent;
    return n || null;
  }

  pickEntry(clientX, clientY) {
    this.setRay(clientX, clientY);
    this.scene.updateMatrixWorld();
    const icons = this.iconLayer.children.filter((s) => s.visible);
    const iconHits = this.raycaster.intersectObjects(icons, false);
    if (iconHits.length) return iconHits[0].object.userData.entry;
    this.raycaster.params.Line.threshold = this.worldPerPixel() * 5;
    for (const h of this.raycaster.intersectObject(this.world, true)) {
      const o = h.object;
      if (o.userData.noPick || !this.effectiveVisible(o)) continue;
      if (o.material && o.material.opacity === 0) continue;
      const e = this.entryOf(o);
      if (e) return e;
    }
    return null;
  }

  clickSelect(e) {
    if (!this.doc) return;
    const entry = this.pickEntry(e.clientX, e.clientY);
    const node = entry ? this.selectable(entry.node) : null;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!node) {
      if (!additive && this.doc.selection.size) this.doc.select([]);
      return;
    }
    if (additive) {
      if (this.doc.selection.has(node.id)) this.doc.toggleSelect(node);
      else this.doc.select([node], { add: true });
    } else {
      this.doc.select([node]);
    }
  }

  contextMenu(e) {
    if (!this.doc) return;
    const entry = this.pickEntry(e.clientX, e.clientY);
    const node = entry ? this.selectable(entry.node) : null;
    if (node && !this.doc.selection.has(node.id)) this.doc.select([node]);
    this.container.dispatchEvent(new CustomEvent('viewport-context', { detail: { node, x: e.clientX, y: e.clientY } }));
  }

  showMarquee(g) {
    const r = this.root.getBoundingClientRect();
    const x0 = Math.min(g.x0, g.x) - r.left, y0 = Math.min(g.y0, g.y) - r.top;
    Object.assign(this.marquee.style, {
      left: `${x0}px`,
      top: `${y0}px`,
      width: `${Math.abs(g.x - g.x0)}px`,
      height: `${Math.abs(g.y - g.y0)}px`,
    });
    this.marquee.hidden = false;
  }

  finishMarquee(g, e) {
    this.marquee.hidden = true;
    if (!this.doc) return;
    const T = this.THREE;
    const r = this.canvas.getBoundingClientRect();
    const minX = Math.min(g.x0, g.x), maxX = Math.max(g.x0, g.x);
    const minY = Math.min(g.y0, g.y), maxY = Math.max(g.y0, g.y);
    this.updateCameras();
    const cam = this.activeCamera();
    this.scene.updateMatrixWorld();
    const picked = [];
    const seen = new Set();
    const p = new T.Vector3();
    for (const entry of this.entries.values()) {
      if (!entry.is3d || entry.node === this.doc.root || !this.effectiveVisible(entry.group)) continue;
      p.setFromMatrixPosition(entry.group.matrixWorld).project(cam);
      if (p.z < -1 || p.z > 1) continue;
      const sx = r.left + ((p.x + 1) / 2) * r.width, sy = r.top + ((1 - p.y) / 2) * r.height;
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
      const node = this.selectable(entry.node);
      if (node && node !== this.doc.root && !seen.has(node.id)) {
        seen.add(node.id);
        picked.push(node);
      }
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (picked.length || !additive) this.doc.select(picked, { add: additive });
  }

  // ---------------------------------------------------------------------------
  // Input

  onPointerTrack = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl !== this.ctrlHeld) {
      this.ctrlHeld = ctrl;
      this.applySnap();
    }
    this.shiftHeld = e.shiftKey;
  };

  onPointerDown = (e) => {
    this.root.focus({ preventScroll: true });
    if (!this.doc) return;
    if (this.gesture) {
      e.preventDefault();
      return;
    }
    if (this.tc.dragging) {
      this.gesture = { type: 'gizmo', id: e.pointerId };
      return;
    }
    let type = null;
    if (e.button === 1) type = e.shiftKey ? 'pan' : 'orbit';
    else if (e.button === 0 && e.altKey) type = e.shiftKey ? 'pan' : 'orbit';
    else if (e.button === 0) type = 'click';
    else if (e.button === 2) type = 'right';
    if (!type) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no capturable pointer.
    }
    this.gesture = { type, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    if (type === 'orbit') this.root.classList.add('is-orbit');
    if (type === 'pan') this.root.classList.add('is-pan');
    if (type === 'right' && [...this.keys].some((k) => FLY_KEYS.has(k))) this.startFly();
  };

  onPointerMove = (e) => {
    const g = this.gesture;
    if (!g || g.type === 'gizmo' || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.x = e.clientX;
    g.y = e.clientY;
    if (!g.moved && Math.hypot(g.x - g.x0, g.y - g.y0) > 4) g.moved = true;
    switch (g.type) {
      case 'orbit':
        this.orbit(dx, dy);
        break;
      case 'pan':
        this.pan(dx, dy);
        break;
      case 'right':
        if (this.flying) this.look(dx, dy);
        else if (g.moved) {
          this.root.classList.add('is-pan');
          this.pan(dx, dy);
        }
        break;
      case 'click':
        if (g.moved) {
          g.type = 'marquee';
          this.showMarquee(g);
        }
        break;
      case 'marquee':
        this.showMarquee(g);
        break;
      default:
        break;
    }
  };

  onPointerUp = (e) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.gesture = null;
    this.root.classList.remove('is-orbit', 'is-pan');
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
    if (e.type !== 'pointerup') {
      this.marquee.hidden = true;
      if (g.type === 'right') this.stopFly();
      return;
    }
    if (g.type === 'click' && !g.moved) this.clickSelect(e);
    else if (g.type === 'marquee') this.finishMarquee(g, e);
    else if (g.type === 'right') {
      if (this.flying) this.stopFly();
      else if (!g.moved) this.contextMenu(e);
    }
  };

  cancelGesture() {
    this.gesture = null;
    this.stopFly();
    if (this.marquee) this.marquee.hidden = true;
    this.root.classList.remove('is-orbit', 'is-pan');
  }

  onWheel = (e) => {
    e.preventDefault();
    if (!this.doc) return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= this.height;
    if (this.flying) {
      this.cam.flySpeed = clamp(this.cam.flySpeed * (dy < 0 ? 1.2 : 1 / 1.2), 0.02, 50);
      this.updateStatus();
      return;
    }
    const k = e.ctrlKey ? 0.01 : 0.0015; // trackpad pinches arrive as small ctrl+wheel deltas
    this.zoomAt(e.clientX, e.clientY, Math.exp(clamp(dy * k, -1, 1)));
  };

  onKeyDown = (e) => {
    const t = e.target;
    if (t !== this.root && t.closest?.('input, textarea, select, [contenteditable]')) return;
    const code = e.code;
    if (FLY_KEYS.has(code)) {
      this.keys.add(code);
      if (this.gesture?.type === 'right') {
        e.preventDefault();
        this.startFly();
        return;
      }
    }
    if (this.flying || !this.doc) return;
    const mod = e.ctrlKey || e.metaKey;
    const numpad = { Numpad7: mod ? 'bottom' : 'top', Numpad1: mod ? 'back' : 'front', Numpad3: mod ? 'left' : 'right' };
    if (numpad[code]) this.setView(numpad[code]);
    else if (code === 'Numpad5') this.setOrtho(!this.cam.ortho);
    else if (mod || e.altKey) return;
    else if (code === 'KeyQ') this.setToolFromKey('select');
    else if (code === 'KeyW') this.setToolFromKey('move');
    else if (code === 'KeyE') this.setToolFromKey('rotate');
    else if (code === 'KeyR') this.setToolFromKey('scale');
    else if (code === 'KeyF') this.frameSelection();
    else if (code === 'KeyT') {
      this.space = this.space === 'world' ? 'local' : 'world';
      this.syncGizmo();
      this.toast(this.space === 'local' ? 'Handles follow the node’s own axes (T)' : 'Handles follow the world axes (T)');
    } else return;
    e.preventDefault();
  };

  setToolFromKey(tool) {
    this.setTool(tool);
    this.container.dispatchEvent(new CustomEvent('viewport-tool', { detail: { tool } }));
  }

  onWindowKey = (e) => {
    const down = e.type === 'keydown';
    if (e.key === 'Control' || e.key === 'Meta') {
      if (this.ctrlHeld !== down) {
        this.ctrlHeld = down;
        this.applySnap();
      }
    }
    if (e.key === 'Shift') this.shiftHeld = down;
    if (!down && FLY_KEYS.has(e.code)) this.keys.delete(e.code);
  };

  onBlur = () => {
    this.keys.clear();
    this.ctrlHeld = false;
    this.shiftHeld = false;
    this.applySnap();
    this.stopFly();
  };

  // ---------------------------------------------------------------------------
  // Drag and drop from the Files panel

  onDragOver = (e) => {
    if (!this.doc || !this.lib || ![...(e.dataTransfer?.types || [])].includes(PATH_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.root.classList.add('is-drop');
  };

  onDrop = (e) => {
    this.root.classList.remove('is-drop');
    const path = e.dataTransfer?.getData(PATH_MIME);
    if (!path || !this.doc || !this.lib) return;
    e.preventDefault();
    this.dropPath(path, e.clientX, e.clientY);
  };

  /** Places a project file at the point on the ground under the cursor. */
  dropPath(path, clientX, clientY) {
    const doc = this.doc;
    let node;
    if (MODEL_RE.test(path)) node = doc.createNode('Model3D', { model: path }, nameFor(path));
    else if (IMAGE_RE.test(path)) node = doc.createNode('Sprite3D', { image: path }, nameFor(path));
    else if (AUDIO_RE.test(path)) node = doc.createNode('AudioPlayer3D', { sound: path }, nameFor(path));
    else if (SCENE_RE.test(path)) {
      if (path === doc.path) {
        this.toast('A scene can’t be placed inside itself.');
        return null;
      }
      node = doc.createInstance(path);
    } else {
      this.toast(`${path.split('/').pop()} can’t be placed in a 3D scene.`);
      return null;
    }
    const T = this.THREE;
    const ray = this.setRay(clientX, clientY);
    let p = ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3());
    if (!p || p.distanceTo(ray.origin) > 5000) p = new T.Vector3(this.cam.target.x, 0, this.cam.target.z);
    if (this.snapActive()) {
      const step = num(this.settings.snapStep, 0.25) || 0.25;
      p.x = Math.round(p.x / step) * step;
      p.z = Math.round(p.z / step) * step;
    }
    // Into the root's own coordinates (it's usually at the origin).
    this.scene.updateMatrixWorld();
    const rootEntry = this.entries.get(doc.root.id);
    if (rootEntry?.is3d) p.applyMatrix4(this.tmp.m.copy(rootEntry.group.matrixWorld).invert());
    for (const k of ['x', 'y', 'z']) if (round6(p[k]) !== 0) node.props[k] = round6(p[k]);
    try {
      doc.add(doc.root, node);
    } catch (err) {
      this.toast(err.message || String(err));
      return null;
    }
    doc.select([node]);
    this.root.focus({ preventScroll: true });
    return node;
  }

  // ---------------------------------------------------------------------------
  // Status and messages

  updateStatus(force = false, override = null) {
    let text = override;
    if (text == null) {
      if (!this.doc) text = 'No scene open';
      else {
        const c = this.cam;
        const parts = [];
        if (this.flying) parts.push(`Fly · ${this.flySpeed().toFixed(1)} m/s`);
        else {
          parts.push(c.ortho ? 'Orthographic' : 'Perspective');
          if (c.view) parts.push(VIEWS[c.view].label);
        }
        const n = this.entries.size;
        parts.push(`${n} ${n === 1 ? 'node' : 'nodes'}`);
        if (this.lightNote) parts.push(this.lightNote);
        text = parts.join(' · ');
      }
    }
    this.updateProjectionButtons();
    if (text === this.statusText && !force) return;
    this.statusText = text;
    this.container.dispatchEvent(new CustomEvent('viewport-status', { detail: { text } }));
  }

  toast(text) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-shown');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('is-shown'), 3500);
  }
}
