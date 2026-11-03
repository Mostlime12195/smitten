// Test harness for viewport3d.js: a fake in-memory project with generated
// textures and glTF models, a 3D scene with every 3D node type, and buttons
// for the tools, undo/redo, drops and file changes. Serve the repository root
// and open /web/editor/workspaces/scene/harness3d.html.

import { setSchema } from '../../core/schema.js';
import { SceneDoc } from '../../core/scene-doc.js';
import { Viewport3D } from './viewport3d.js';

const schema = await (await fetch(new URL('../../../../love/src/modules/scene/nodes.json', import.meta.url))).json();
setSchema(schema);

// ---------------------------------------------------------------------------
// A Project-like object over a Map.

const decoder = new TextDecoder();
const encoder = new TextEncoder();

class FakeProject extends EventTarget {
  constructor() {
    super();
    this.files = new Map();
  }
  has(p) { return this.files.has(p); }
  read(p) { return this.files.get(p); }
  readText(p) {
    const d = this.files.get(p);
    return d === undefined ? undefined : typeof d === 'string' ? d : decoder.decode(d);
  }
  readBytes(p) {
    const d = this.files.get(p);
    return d === undefined ? undefined : typeof d === 'string' ? encoder.encode(d) : d;
  }
  write(p, data) {
    this.files.set(p, data);
    this.dispatchEvent(new CustomEvent('file', { detail: { path: p, kind: 'write' } }));
  }
  settings() {
    return { display: { width: 1280, height: 720, filter: 'smooth' } };
  }
}

// ---------------------------------------------------------------------------
// Generated assets

async function canvasPng(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

const checker = (a, b) => (g, w, h) => {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? a : b;
      g.fillRect((x * w) / 8, (y * h) / 8, w / 8, h / 8);
    }
  }
  g.fillStyle = '#e5484d';
  g.fillRect(0, 0, w / 8, h / 8); // marks the image's top left
};

const tree = (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#6b4a2b';
  g.fillRect(w * 0.42, h * 0.62, w * 0.16, h * 0.38);
  g.fillStyle = '#2f9e44';
  g.beginPath();
  g.moveTo(w / 2, 0);
  g.lineTo(w, h * 0.68);
  g.lineTo(0, h * 0.68);
  g.closePath();
  g.fill();
};

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** A pyramid (1 m base, 1 m tall) as glTF JSON + its binary buffer. */
function pyramid(color, { texture = null } = {}) {
  const apex = [0, 1, 0];
  const b = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]];
  const tris = [];
  for (let i = 0; i < 4; i++) tris.push([b[(i + 1) % 4], b[i], apex]);
  tris.push([b[0], b[1], b[2]], [b[0], b[2], b[3]]);
  const pos = [], nor = [], uv = [];
  for (const [p0, p1, p2] of tris) {
    const u = p1.map((v, i) => v - p0[i]), v = p2.map((x, i) => x - p0[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n);
    for (const p of [p0, p1, p2]) {
      pos.push(...p);
      nor.push(...n.map((x) => x / len));
      uv.push(p[0] + 0.5, p[2] + 0.5 - p[1] * 0.5);
    }
  }
  const P = new Float32Array(pos), N = new Float32Array(nor), U = new Float32Array(uv);
  const bin = new Uint8Array(P.byteLength + N.byteLength + U.byteLength);
  bin.set(new Uint8Array(P.buffer), 0);
  bin.set(new Uint8Array(N.buffer), P.byteLength);
  bin.set(new Uint8Array(U.buffer), P.byteLength + N.byteLength);
  const count = pos.length / 3;
  const json = {
    asset: { version: '2.0', generator: 'smitten harness' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Pyramid', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.7, ...(texture ? { baseColorTexture: { index: 0 } } : {}) } }],
    ...(texture ? { textures: [{ source: 0 }], images: [{ uri: texture }] } : {}),
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: P.byteLength },
      { buffer: 0, byteOffset: P.byteLength, byteLength: N.byteLength },
      { buffer: 0, byteOffset: P.byteLength + N.byteLength, byteLength: U.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
    ],
  };
  return { json, bin };
}

function glb(json, bin) {
  const pad = (n) => (4 - (n % 4)) % 4;
  json = { ...json, buffers: [{ byteLength: bin.byteLength }] };
  let jsonBytes = encoder.encode(JSON.stringify(json));
  jsonBytes = Uint8Array.from([...jsonBytes, ...new Array(pad(jsonBytes.length)).fill(0x20)]);
  const binPadded = new Uint8Array(bin.byteLength + pad(bin.byteLength));
  binPadded.set(bin);
  const total = 12 + 8 + jsonBytes.length + 8 + binPadded.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const o = 20 + jsonBytes.length;
  dv.setUint32(o, binPadded.length, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(binPadded, o + 8);
  return out;
}

const project = new FakeProject();
project.files.set('textures/checker.png', await canvasPng(64, 64, checker('#d9dee8', '#5b6578')));
project.files.set('textures/tree.png', await canvasPng(64, 96, tree));
{
  // Embedded buffer (data URI).
  const { json, bin } = pyramid([0.95, 0.55, 0.2, 1]);
  json.buffers[0].uri = `data:application/octet-stream;base64,${b64(bin)}`;
  project.files.set('models/pyramid.gltf', JSON.stringify(json));
}
{
  // External buffer and texture, resolved from the project's files.
  const { json, bin } = pyramid([1, 1, 1, 1], { texture: '../textures/checker.png' });
  json.buffers[0].uri = 'crystal.bin';
  project.files.set('models/crystal.gltf', JSON.stringify(json));
  project.files.set('models/crystal.bin', bin);
}
{
  const { json, bin } = pyramid([0.55, 0.6, 0.68, 1]);
  project.files.set('models/rock.glb', glb(json, bin));
}
project.files.set('scenes/crate.scene', JSON.stringify({
  format: 'smitten.scene',
  version: 2,
  root: {
    name: 'Crate',
    type: 'StaticBody3D',
    children: [
      { name: 'Mesh', type: 'MeshInstance3D', properties: { y: 0.5, color: [0.85, 0.62, 0.38, 1], texture: 'textures/checker.png' } },
      { name: 'Shape', type: 'CollisionShape3D', properties: { y: 0.5 } },
    ],
  },
}));

// ---------------------------------------------------------------------------
// The scene: every 3D node type.

const ctx = { readScene: (p) => (project.has(p) ? JSON.parse(project.readText(p)) : null) };
const n = (name, type, properties = {}, children = []) => ({ name, type, properties, children });
const mainData = {
  format: 'smitten.scene',
  version: 2,
  root: n('Level', 'Node3D', {}, [
    n('Environment', 'Environment3D', {}),
    n('Sun', 'DirectionalLight3D', { rotationX: -0.9, rotationY: 0.6, energy: 1.1 }),
    n('Lamp', 'PointLight3D', { x: 2.5, y: 1.4, z: 1.5, color: [1, 0.6, 0.3, 1], energy: 2, range: 5 }),
    n('Spot', 'SpotLight3D', { x: -3, y: 3.5, z: 2, rotationX: -1.1, color: [0.5, 0.7, 1, 1], energy: 4, range: 8 }),
    n('Ground', 'MeshInstance3D', { mesh: 'plane', width: 16, depth: 16, color: [0.42, 0.45, 0.4, 1] }),
    n('Box', 'MeshInstance3D', { y: 0.5, texture: 'textures/checker.png' }),
    n('Ball', 'MeshInstance3D', { x: 1.6, y: 0.5, z: -1, mesh: 'sphere', color: [0.85, 0.85, 0.9, 1], metallic: 1, roughness: 0.25 }),
    n('Pillar', 'MeshInstance3D', { x: -1.6, y: 1, z: -1, mesh: 'cylinder', radius: 0.35, height: 2, color: [0.4, 0.55, 0.9, 1] }),
    n('Pill', 'MeshInstance3D', { x: -0.2, y: 0.75, z: -2.4, mesh: 'capsule', radius: 0.3, height: 1.5, color: [0.2, 0.2, 0.25, 1], emission: [0.9, 0.2, 0.5, 1] }),
    n('Glass', 'MeshInstance3D', { x: 1.6, y: 0.5, z: 1.4, color: [0.5, 0.85, 1, 0.35], roughness: 0.1 }),
    n('Flat', 'MeshInstance3D', { x: -1.6, y: 0.4, z: 1.4, width: 0.8, height: 0.8, depth: 0.8, color: [1, 0.85, 0.3, 1], unshaded: true }),
    n('Pyramid', 'Model3D', { x: 3.4, z: -2 }),
    n('Crystal', 'Model3D', { x: 3.4, z: 0.4, rotationY: 0.5 }),
    n('Tree', 'Sprite3D', { x: -3.5, y: 0.48, z: -2.5, image: 'textures/tree.png' }),
    n('Sign', 'Sprite3D', { x: -3.5, y: 0.48, z: 0, image: 'textures/tree.png', billboard: false, rotationY: 0.8 }),
    n('Camera', 'Camera3D', { x: 0, y: 2.2, z: 6.5, rotationX: -0.25 }),
    n('Tilted', 'Node3D', { x: 0, y: 2.6, z: -3.5, rotationY: 0.785, rotationZ: 0.35, scaleX: 1.5 }, [
      n('Child', 'MeshInstance3D', { x: 0.8, width: 0.5, height: 0.5, depth: 0.5, color: [0.9, 0.35, 0.35, 1] }),
    ]),
    n('Player', 'CharacterBody3D', { x: 0, z: 2.5 }, [
      n('Body', 'MeshInstance3D', { y: 0.9, mesh: 'capsule', radius: 0.35, height: 1.8, color: [0.35, 0.75, 0.55, 1] }),
      n('Shape', 'CollisionShape3D', { y: 0.9, shape: 'capsule', radius: 0.4, height: 1.8 }),
    ]),
    n('Floor', 'StaticBody3D', { y: -0.05 }, [
      n('Shape', 'CollisionShape3D', { width: 16, height: 0.1, depth: 16 }),
    ]),
    n('Trigger', 'Area3D', { x: 4.5, y: 0.75, z: 2.5 }, [n('Shape', 'CollisionShape3D', { shape: 'sphere', radius: 0.75 })]),
    n('Barrel', 'RigidBody3D', { x: 2.5, y: 0.45, z: 3.2 }, [
      n('Mesh', 'MeshInstance3D', { mesh: 'cylinder', radius: 0.3, height: 0.9, color: [0.6, 0.3, 0.2, 1] }),
      n('Shape', 'CollisionShape3D', { shape: 'cylinder', radius: 0.3, height: 0.9 }),
    ]),
    n('Music', 'AudioPlayer3D', { x: -4.5, y: 1, z: 3 }),
    { name: 'Crate', scene: 'scenes/crate.scene', properties: { x: -4.2, z: -4.5 } },
  ]),
};
mainData.root.children.find((c) => c.name === 'Pyramid').properties.model = 'models/pyramid.gltf';
mainData.root.children.find((c) => c.name === 'Crystal').properties.model = 'models/crystal.gltf';
project.files.set('scenes/main.scene', JSON.stringify(mainData));

const doc = new SceneDoc('scenes/main.scene', mainData, ctx);
const other = new SceneDoc('scenes/empty.scene', {
  format: 'smitten.scene',
  version: 2,
  root: n('Empty', 'Node3D', {}, [n('Cube', 'MeshInstance3D', { y: 0.5, color: [0.36, 0.55, 0.95, 1] })]),
}, ctx);

// ---------------------------------------------------------------------------
// Mount the viewport.

const settings = { snap: false, snapStep: 0.25, angleSnap: 15 };
const host = document.getElementById('vp');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const events = [];
const log = (s) => {
  events.push(s);
  logEl.textContent = s;
  console.log('[harness]', s);
};

host.addEventListener('viewport-status', (e) => {
  statusEl.textContent = e.detail.text;
  log(`status: ${e.detail.text}`);
});
host.addEventListener('viewport-context', (e) => log(`context: ${e.detail.node ? e.detail.node.name : '(empty)'} at ${Math.round(e.detail.x)},${Math.round(e.detail.y)}`));
host.addEventListener('viewport-tool', (e) => showTool(e.detail.tool));

const vp = new Viewport3D(host, { doc, project, settings });
let current = doc;
const watch = (d) => {
  d.addEventListener('change', (e) => log(`change: ${e.detail.kind}${e.detail.label ? ` (${e.detail.label})` : ''}`));
  d.addEventListener('select', () => log(`select: ${d.selected().map((x) => x.name).join(', ') || '(none)'}`));
};
watch(doc);
watch(other);

function showTool(tool) {
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('is-on', b.dataset.tool === tool);
}
for (const b of document.querySelectorAll('[data-tool]')) {
  b.addEventListener('click', () => {
    vp.setTool(b.dataset.tool);
    showTool(b.dataset.tool);
  });
}
showTool('select');
document.getElementById('snap').addEventListener('change', (e) => vp.setSnap(e.target.checked));
document.getElementById('undo').addEventListener('click', () => current.undo());
document.getElementById('redo').addEventListener('click', () => current.redo());
document.getElementById('frame').addEventListener('click', () => vp.frameSelection());

/** A synthetic drop, as if a file were dragged from the Files panel. */
function drop(path, fx = 0.5, fy = 0.6) {
  const target = host.querySelector('.vp3d');
  const r = target.getBoundingClientRect();
  const clientX = r.left + r.width * fx, clientY = r.top + r.height * fy;
  const dataTransfer = new DataTransfer();
  dataTransfer.setData('application/x-smitten-path', path);
  const over = new DragEvent('dragover', { dataTransfer, clientX, clientY, bubbles: true, cancelable: true });
  target.dispatchEvent(over);
  target.dispatchEvent(new DragEvent('drop', { dataTransfer, clientX, clientY, bubbles: true, cancelable: true }));
  return over.defaultPrevented;
}
document.getElementById('drop-model').addEventListener('click', () => drop('models/rock.glb', 0.3, 0.7));
document.getElementById('drop-image').addEventListener('click', () => drop('textures/tree.png', 0.7, 0.7));
document.getElementById('drop-scene').addEventListener('click', () => drop('scenes/crate.scene', 0.5, 0.8));
document.getElementById('switch').addEventListener('click', () => {
  current = current === doc ? other : doc;
  vp.setDoc(current);
});
document.getElementById('repaint').addEventListener('click', async () => {
  const hue = Math.floor(Math.random() * 360);
  project.write('textures/checker.png', await canvasPng(64, 64, checker(`hsl(${hue} 70% 75%)`, `hsl(${hue} 50% 35%)`)));
});
document.getElementById('lights').addEventListener('click', () => {
  for (const name of ['Sun', 'Lamp', 'Spot']) {
    const node = doc.root.children.find((c) => c.name === name);
    doc.setProp(node, 'visible', !doc.get(node, 'visible'));
  }
});

window.addEventListener('resize', () => vp.resize());
Object.assign(window, { vp, doc, other, project, drop, events, settings, harnessReady: vp.loaded });
await vp.loaded;
log('ready');
