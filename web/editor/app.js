// The Smitten editor (DESIGN.md, section 8): Home, and a project's editor
// with workspaces (Scene, Script, Paint, Sound, Music), docked panels (Scene,
// Files, Inspector, Output), the game view, menus, shortcuts and the
// command palette.

import { h, icon, hydrateIcons, showMenu, toast, promptDialog, confirmDialog, openDialog, modKey, isMac } from './ui.js';
import { settings, applyTheme } from './settings.js';
import { openSettings } from './settings-dialog.js';
import * as store from './fs-store.js';
import { loadSchema, typeDef, isA, properties, methods, events } from './core/schema.js';
import { Project } from './core/project.js';
import { SceneDoc } from './core/scene-doc.js';
import { includedModules, detectModules } from './core/modules.js';
import { DockManager } from './shell/dock.js';
import { renderHome } from './shell/home.js';
import { nodeIcon } from './shell/node-icons.js';
import { SceneTreePanel } from './panels/scene-tree.js';
import { InspectorPanel } from './panels/inspector.js';
import { SceneWorkspace } from './workspaces/scene/scene-workspace.js';
import { ScriptWorkspace } from './workspaces/script-workspace.js';
import { ToolWorkspace } from './workspaces/tool-workspace.js';
import { addNodeDialog } from './dialogs/add-node.js';
import { projectSettingsDialog, inputActions } from './dialogs/project-settings.js';
import { exportDialog } from './dialogs/export.js';
import { FileTree } from './file-tree.js';
import { ConsolePanel } from './console.js';
import { Runner } from './runner.js';
import { classifyBytes, kindOf } from './file-types.js';
import { unzipToProjectFiles } from './exporter.js';

const app = document.getElementById('app');

const WORKSPACES = [
  { id: 'scene', label: 'Scene', icon: 'box' },
  { id: 'script', label: 'Script', icon: 'code' },
  { id: 'paint', label: 'Paint', icon: 'brush' },
  { id: 'sound', label: 'Sound', icon: 'wave' },
  { id: 'music', label: 'Music', icon: 'music' },
];

const DEFAULT_LAYOUTS = {
  scene: { left: [['scene'], ['files']], right: [['inspector']], bottom: [['output']], sizes: { left: 270, right: 320, bottom: 170 } },
  script: { left: [['files']], right: [], bottom: [['output']], sizes: { left: 250, right: 300, bottom: 170 } },
  paint: { left: [['files']], right: [], bottom: [], sizes: { left: 230, right: 300, bottom: 170 } },
  sound: { left: [['files']], right: [], bottom: [], sizes: { left: 230, right: 300, bottom: 170 } },
  music: { left: [['files']], right: [], bottom: [], sizes: { left: 230, right: 300, bottom: 170 } },
};
const LAYOUT_KEY = 'smitten-editor.layouts';

const TEXT_FILE = /\.(lua|json|md|txt|glsl|frag|vert|csv|xml|yaml|yml|toml|html|css|js)$/i;

let ed = null; // the open editor's state

// ---------------------------------------------------------------------------
// Boot and routing

async function boot() {
  applyTheme();
  try {
    await loadSchema();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'Smitten couldn\'t start'), h('p', {}, `The node list didn't load (${e.message}). Check your connection and reload.`)));
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const id = new URLSearchParams(location.hash.slice(1)).get('project');
  if (id && ed?.project.id === id) return;
  if (ed) closeEditor();
  if (id) openProject(id);
  else showHome();
}

function showHome() {
  document.title = 'Smitten';
  const root = h('div', { id: 'home-root', style: 'display: flex; flex: 1; min-height: 0' });
  app.replaceChildren(root);
  renderHome(root, {
    openProject: (id) => { location.hash = `project=${id}`; },
    importZip: async (file) => {
      const files = await unzipToProjectFiles(new Uint8Array(await file.arrayBuffer()));
      const name = file.name.replace(/\.(zip|love)$/i, '');
      const p = await store.createProject(name, files);
      location.hash = `project=${p.id}`;
    },
  });
}

function closeEditor() {
  saveAll();
  ed.runner?.destroy();
  ed = null;
}

// ---------------------------------------------------------------------------
// The editor

async function openProject(id) {
  let project;
  try {
    project = await Project.open(id);
  } catch (e) {
    toast(e.message, { type: 'error' });
    location.hash = '';
    return;
  }
  document.title = `${project.name} · Smitten`;
  ed = { project, workspaces: {}, ws: null, layouts: loadLayouts(), clipboard: [] };

  // Top bar
  const menus = h('div', { class: 'tb-left' },
    h('a', { class: 'brand', href: '#', title: 'Home: all your games' }, h('span', { class: 'brand-mark' }, icon('heart', 16)), h('span', {}, 'Smitten')),
    menuButton('Project', projectMenu), menuButton('Edit', editMenu), menuButton('View', viewMenu), menuButton('Help', helpMenu),
    ed.titleEl = h('span', { class: 'project-title', title: 'Project settings' }, project.name));
  ed.titleEl.addEventListener('click', () => openProjectSettings());
  const switcher = h('nav', { class: 'workspace-switch', 'aria-label': 'Workspaces' });
  WORKSPACES.forEach((w, i) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false', 'data-ws': w.id, title: `${w.label} (Alt+${i + 1})` }, icon(w.icon, 15), h('span', { class: 'ws-label' }, w.label));
    b.addEventListener('click', () => switchWorkspace(w.id));
    switcher.append(b);
  });
  ed.playBtn = h('button', { type: 'button', class: 'play-btn primary', title: 'Play the game from its main scene (F5)' }, icon('play', 14), 'Play');
  ed.playBtn.addEventListener('click', () => play());
  ed.stopBtn = h('button', { type: 'button', class: 'play-btn stop', title: 'Stop (F8)', disabled: true }, icon('stop', 13), 'Stop');
  ed.stopBtn.addEventListener('click', () => stop());
  const titlebar = h('header', { class: 'titlebar' }, menus, switcher, h('div', { class: 'tb-right' }, h('div', { class: 'play-group' }, ed.playBtn, ed.stopBtn)));

  // Center: workspaces and the game view
  const area = h('div', { class: 'workspace-area' });
  const center = h('div', { class: 'center' }, area);
  const shell = h('main', { class: 'shell' });
  ed.status = { left: h('span', {}, 'Saved'), modules: h('button', { type: 'button', title: 'Engine modules this game uses (Project settings › Modules)' }), right: h('span', {}) };
  ed.status.modules.addEventListener('click', () => openProjectSettings('modules'));
  const statusbar = h('footer', { class: 'statusbar' }, ed.status.left, h('span', { class: 'spacer' }), ed.status.right, ed.status.modules);
  app.replaceChildren(h('div', { id: 'editor' }, titlebar, shell, statusbar));

  // Panels
  const panelEl = () => h('div', { class: 'panel-host', style: 'position: absolute; inset: 0' });
  const panels = {
    scene: { id: 'scene', title: 'Scene', region: 'left', el: panelEl() },
    files: { id: 'files', title: 'Files', region: 'left', el: panelEl() },
    inspector: { id: 'inspector', title: 'Inspector', region: 'right', el: panelEl() },
    output: { id: 'output', title: 'Output', region: 'bottom', el: panelEl() },
  };
  ed.dock = new DockManager(shell, center, Object.values(panels));
  ed.dock.addEventListener('change', () => saveLayout());
  ed.dock.addEventListener('resize', () => ed.ws && ed.workspaces[ed.ws]?.resize());

  ed.panels = {};
  ed.panels.tree = new SceneTreePanel(panels.scene.el, {
    addNode: (parent) => addNodeTo(parent),
    instanceScene: (parent) => instanceScene(parent),
    attachScript: (node) => attachScript(node),
    openScript: (node) => openFile(sceneWs().doc.scriptOf(node)),
    openScene: (path) => openFile(path),
    saveBranchAsScene: (node) => saveBranchAsScene(node),
    copy: () => copyNodes(),
    paste: (parent) => pasteNodes(parent),
    changeType: (node) => changeType(node),
    dropFile: (path, target) => dropFileOnNode(path, target),
  });
  ed.panels.inspector = new InspectorPanel(panels.inspector.el, {
    project,
    inputActions: () => inputActions(project),
    openScript: (node) => openFile(sceneWs().doc.scriptOf(node)),
    attachScript: (node) => attachScript(node),
    openScene: (path) => openFile(path),
    openDocs: (type) => nodeDocs(type),
  });
  buildFilesPanel(panels.files.el);
  buildOutputPanel(panels.output.el);

  // Workspaces
  const wsApp = {
    project,
    panels: ed.panels,
    settings: settings.all(),
    playScene: (path) => play(path),
    newScene: (kind) => newScene(kind),
    newScript: () => newScript(),
    openFile: (path) => openFile(path),
    addNodeDialog: (parent) => addNodeTo(parent),
    setCursor: (text) => { ed.status.right.textContent = text; },
  };
  for (const w of WORKSPACES) {
    const el = h('section', { class: 'workspace', 'data-ws': w.id, hidden: true });
    area.append(el);
    if (w.id === 'scene') ed.workspaces.scene = new SceneWorkspace(el, wsApp);
    else if (w.id === 'script') ed.workspaces.script = new ScriptWorkspace(el, wsApp);
    else {
      const defs = {
        paint: { toolId: 'sprite', untitledBase: 'image', untitledLabel: 'New image', icon: 'image' },
        sound: { toolId: 'sfx', untitledBase: 'sound', untitledLabel: 'New sound', icon: 'wave' },
        music: { toolId: 'music', untitledBase: 'song', untitledLabel: 'New song', icon: 'music' },
      };
      ed.workspaces[w.id] = new ToolWorkspace(el, wsApp, { id: w.id, ...defs[w.id] });
    }
  }

  // The game view sits over the workspaces while a game runs.
  ed.gameTitle = h('span', { class: 'game-title' }, 'Game');
  const gameHost = h('div', { class: 'game-host' });
  const restart = h('button', { type: 'button', class: 'tool-btn', title: 'Restart (F5)' }, icon('restart', 14), 'Restart');
  restart.addEventListener('click', () => play(ed.lastRun));
  const back = h('button', { type: 'button', class: 'tool-btn', title: 'Stop and go back to editing (F8)' }, icon('stop', 13), 'Stop');
  back.addEventListener('click', () => stop());
  ed.gameView = h('div', { class: 'game-view', hidden: true }, h('div', { class: 'game-bar' }, ed.gameTitle, restart, back), gameHost);
  area.append(ed.gameView);
  ed.runner = new Runner(gameHost, {
    onState: (s) => runState(s),
    onLog: (level, text) => ed.console.log(level, text),
    onError: (text) => {
      ed.console.error(text);
      ed.dock.show('output');
    },
    onTitle: (t) => { ed.gameTitle.textContent = t || 'Game'; },
    onQuit: () => stop(),
    onShortcut: (e) => handleGlobalKey(e),
    onMissingModule: (name) => missingModule(name),
  });

  project.addEventListener('file', (e) => {
    ed.files.setEntries(entries());
    saving();
    if (e.detail.path === 'smitten.json') updateModulesStatus();
    if (e.detail.kind === 'rename') renameReferences(e.detail.from, e.detail.path);
  });
  project.addEventListener('settings', () => {
    ed.titleEl.textContent = project.name;
    document.title = `${project.name} · Smitten`;
    updateModulesStatus();
  });
  window.addEventListener('smitten-save-error', () => toast('Saving failed: your browser may be out of storage space.', { type: 'error', timeout: 8000 }));
  updateModulesStatus();

  // Where we left off: the open scenes and scripts, else the main scene.
  const saved = project.meta.editor || {};
  switchWorkspace(saved.workspace || 'scene', { focus: false });
  const main = project.settings().main;
  const scenes = (saved.scenes || []).filter((p) => project.has(p));
  if (!scenes.length && main && project.has(main)) scenes.push(main);
  if (!scenes.length) {
    const first = project.paths().find((p) => p.endsWith('.scene'));
    if (first) scenes.push(first);
  }
  for (const p of scenes) await ed.workspaces.scene.open(p);
  for (const p of (saved.scripts || []).filter((x) => project.has(x))) await ed.workspaces.script.open(p);
  if (!scenes.length && project.has('main.lua')) {
    await ed.workspaces.script.open('main.lua');
    if (!saved.workspace) switchWorkspace('script');
  }
  if (saved.workspace && saved.workspace !== ed.ws) switchWorkspace(saved.workspace);
  window.addEventListener('beforeunload', saveAll);
  hydrateIcons(app);
}

function sceneWs() {
  return ed.workspaces.scene;
}

function menuButton(label, items) {
  const b = h('button', { type: 'button', class: 'menubar-btn', 'aria-haspopup': 'menu' }, label);
  b.addEventListener('click', () => showMenu(b, items()));
  return b;
}

function switchWorkspace(id, { focus = true } = {}) {
  if (!ed || !ed.workspaces[id]) return;
  if (ed.ws && ed.ws !== id) ed.layouts[ed.ws] = ed.dock.getLayout();
  ed.ws = id;
  for (const el of app.querySelectorAll('.workspace')) el.hidden = el.dataset.ws !== id;
  for (const b of app.querySelectorAll('.workspace-switch button')) b.setAttribute('aria-pressed', String(b.dataset.ws === id));
  ed.dock.setLayout(ed.layouts[id] || DEFAULT_LAYOUTS[id]);
  const ws = ed.workspaces[id];
  ws.show?.();
  requestAnimationFrame(() => ws.resize());
  saveEditorState();
  if (focus) ws.el.querySelector('.viewport, .cm-content, canvas')?.focus?.();
}

function loadLayouts() {
  try {
    return { ...DEFAULT_LAYOUTS, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_LAYOUTS };
  }
}

function saveLayout() {
  if (!ed?.ws) return;
  ed.layouts[ed.ws] = ed.dock.getLayout();
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(ed.layouts));
}

function resetLayout() {
  ed.layouts = { ...DEFAULT_LAYOUTS };
  localStorage.removeItem(LAYOUT_KEY);
  ed.dock.setLayout(DEFAULT_LAYOUTS[ed.ws]);
}

function saveEditorState() {
  if (!ed) return;
  ed.project.saveEditorState({
    workspace: ed.ws,
    scenes: ed.workspaces.scene?.openPaths() || [],
    scripts: ed.workspaces.script?.openPaths() || [],
  });
}

function saveAll() {
  if (!ed) return;
  for (const ws of Object.values(ed.workspaces)) ws.saveAll?.();
  saveEditorState();
  return ed.project.flush();
}

let savingTimer = 0;
function saving() {
  ed.status.left.textContent = 'Saving…';
  clearTimeout(savingTimer);
  savingTimer = setTimeout(() => ed.project.saving.then(() => { if (ed) ed.status.left.textContent = 'Saved'; }), 700);
}

function updateModulesStatus() {
  const det = detectModules(ed.project);
  const names = Object.values(det).filter((m) => m.included).map((m) => m.name);
  ed.status.modules.textContent = names.length ? `Modules: ${names.join(', ')}` : 'Modules: core only';
}

// ---------------------------------------------------------------------------
// Files

function entries() {
  const out = [];
  for (const d of ed.project.dirs) out.push({ path: d, kind: 'dir' });
  for (const p of ed.project.paths()) out.push({ path: p, kind: 'file', data: ed.project.read(p) });
  return out;
}

function buildFilesPanel(el) {
  const newBtn = h('button', { type: 'button', class: 'btn small' }, icon('plus', 14), 'New');
  newBtn.addEventListener('click', () => showMenu(newBtn, newMenuItems('')));
  const importInput = h('input', { type: 'file', multiple: true, hidden: true });
  importInput.addEventListener('change', async () => {
    await importFiles([...importInput.files], '');
    importInput.value = '';
  });
  const importBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Import files (or drop them here)', 'aria-label': 'Import files' }, icon('upload', 15));
  importBtn.addEventListener('click', () => importInput.click());
  const treeEl = h('div', { id: 'file-tree', tabindex: '0', role: 'tree' });
  el.append(h('div', { class: 'panel' }, h('div', { class: 'panel-toolbar' }, newBtn, h('span', { style: 'flex: 1' }), importBtn, importInput), h('div', { class: 'panel-scroll' }, treeEl)));
  ed.files = new FileTree(treeEl, {
    onOpen: (path) => openFile(path),
    onContextMenu: (path, kind, at) => fileMenu(path, kind, at),
    onMove: (from, toDir) => {
      const to = toDir ? `${toDir}/${from.split('/').pop()}` : from.split('/').pop();
      if (to !== from) ed.project.rename(from, to);
    },
    onDropFiles: async (dt, toDir) => {
      const { readDataTransfer } = await import('./file-tree.js');
      const files = await readDataTransfer(dt);
      for (const [p, data] of Object.entries(files)) ed.project.write(toDir ? `${toDir}/${p}` : p, data);
      toast(`Imported ${Object.keys(files).length} file(s).`);
    },
    isDirty: () => false,
    onEmptyAction: () => {},
  });
  ed.files.setProject(ed.project.id);
  ed.files.setEntries(entries());
}

async function importFiles(files, dir) {
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const path = dir ? `${dir}/${f.name}` : f.name;
    ed.project.write(path, classifyBytes(path, bytes));
  }
  if (files.length) toast(`Imported ${files.length} file(s). Drag them into a scene to use them.`);
}

function newMenuItems(dir) {
  const inDir = (folder) => dir || folder;
  return [
    { label: 'Scene', icon: 'box', action: () => newScene(null, inDir('scenes')) },
    { label: 'Script', icon: 'code', action: () => newScript(null, inDir('scripts')) },
    { label: 'Image', icon: 'image', action: () => { switchWorkspace('paint'); ed.workspaces.paint.newUntitled(); } },
    { label: 'Sound effect', icon: 'wave', action: () => { switchWorkspace('sound'); ed.workspaces.sound.newUntitled(); } },
    { label: 'Song', icon: 'music', action: () => { switchWorkspace('music'); ed.workspaces.music.newUntitled(); } },
    '-',
    { label: 'Folder', icon: 'folderPlus', action: async () => {
      const name = await promptDialog({ title: 'New folder', label: 'Name', okLabel: 'Create' });
      if (name) ed.project.mkdir(dir ? `${dir}/${name}` : name);
      ed.files.setEntries(entries());
    } },
  ];
}

function fileMenu(path, kind, at) {
  const items = [];
  if (kind === 'file') {
    items.push({ label: 'Open', action: () => openFile(path) });
    if (path.endsWith('.scene')) {
      items.push({ label: 'Play this scene', icon: 'play', action: () => play(path) });
      items.push({ label: 'Make it the main scene', action: () => ed.project.updateSettings({ main: path }) });
    }
  }
  if (kind === 'dir' || kind === 'root') items.push({ label: 'New', icon: 'plus', action: () => showMenu(at, newMenuItems(kind === 'dir' ? path : '')) });
  if (path) {
    items.push('-', { label: 'Rename…', icon: 'pencil', action: async () => {
      const name = await promptDialog({ title: 'Rename', label: 'Name', value: path.split('/').pop(), okLabel: 'Rename', selectBase: true });
      if (name) ed.project.rename(path, path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/${name}` : name);
    } });
    if (kind === 'file') items.push({ label: 'Duplicate', icon: 'copy', action: () => {
      const dot = path.lastIndexOf('.');
      let copy = `${path.slice(0, dot)} copy${path.slice(dot)}`;
      for (let i = 2; ed.project.has(copy); i++) copy = `${path.slice(0, dot)} copy ${i}${path.slice(dot)}`;
      ed.project.write(copy, ed.project.read(path));
    } });
    items.push({ label: 'Copy path', action: () => navigator.clipboard?.writeText(path) });
    items.push('-', { label: 'Delete…', icon: 'trash', danger: true, action: async () => {
      if (await confirmDialog({ title: `Delete ${path.split('/').pop()}?`, message: kind === 'dir' ? 'The folder and everything in it will be deleted.' : 'The file will be deleted.', okLabel: 'Delete', danger: true })) ed.project.remove(path);
    } });
  }
  showMenu(at, items);
}

/** Opens a file in the workspace that edits it. */
async function openFile(path, opts = {}) {
  if (!path) return;
  if (path.endsWith('.scene')) {
    switchWorkspace('scene', { focus: false });
    await sceneWs().open(path);
  } else if (ed.workspaces.paint.canOpen(path)) {
    switchWorkspace('paint');
    ed.workspaces.paint.open(path);
  } else if (ed.workspaces.sound.canOpen(path)) {
    switchWorkspace('sound');
    ed.workspaces.sound.open(path);
  } else if (ed.workspaces.music.canOpen(path)) {
    switchWorkspace('music');
    ed.workspaces.music.open(path);
  } else if (TEXT_FILE.test(path) || typeof ed.project.read(path) === 'string') {
    switchWorkspace('script', { focus: false });
    await ed.workspaces.script.open(path, opts);
  } else {
    const kind = kindOf(path, ed.project.read(path));
    const hint = /\.(glb|gltf)$/i.test(path) ? 'Drag it into a 3D scene to use it.'
      : kind === 'audio' ? 'Drag it into a scene to make an AudioPlayer.'
        : kind === 'font' ? 'Pick it as the font of a Label or Text2D.' : 'Smitten has no editor for this kind of file.';
    toast(`${path.split('/').pop()}: ${hint}`);
  }
  saveEditorState();
}

/** Keeps paths in scenes and settings pointing at a file after it's renamed. */
function renameReferences(from, to) {
  for (const p of ed.project.paths()) {
    if (!p.endsWith('.scene') && p !== 'smitten.json') continue;
    const text = ed.project.readText(p);
    const quoted = JSON.stringify(from);
    if (text && text.includes(quoted)) ed.project.write(p, text.split(quoted).join(JSON.stringify(to)));
  }
}

// ---------------------------------------------------------------------------
// Making things

function uniquePath(dir, base, ext) {
  let p = `${dir ? dir + '/' : ''}${base}${ext}`;
  for (let i = 2; ed.project.has(p); i++) p = `${dir ? dir + '/' : ''}${base}${i}${ext}`;
  return p;
}

const fileName = (s) => s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');

async function newScene(kind, dir = 'scenes') {
  if (!kind) {
    kind = await openDialog({
      title: 'New scene',
      body: h('p', { class: 'insp-desc' }, 'What kind of scene? You can mix 2D, 3D and UI nodes in any scene; this picks its root node and its view.'),
      actions: [{ label: 'Cancel', value: null, ghost: true }, { label: 'Menu (UI)', value: 'ui' }, { label: '3D', value: '3d' }, { label: '2D', value: '2d', primary: true }],
    });
    if (!kind) return;
  }
  const name = await promptDialog({ title: 'New scene', label: 'Name', value: kind === 'ui' ? 'menu' : 'level', okLabel: 'Create' });
  if (!name) return;
  const path = uniquePath(dir, fileName(name), '.scene');
  const rootType = kind === '3d' ? 'Node3D' : kind === 'ui' ? 'Node' : 'Node2D';
  const doc = SceneDoc.empty(path, rootType, name.replace(/^\w/, (c) => c.toUpperCase()).replace(/\s+/g, ''));
  if (kind === '3d') {
    doc.root.children.push(
      { ...doc.createNode('Environment3D'), name: 'Environment', parent: doc.root },
      { ...doc.createNode('DirectionalLight3D', { rotationX: -0.9, rotationY: 0.5 }), name: 'Sun', parent: doc.root },
      { ...doc.createNode('Camera3D', { y: 2, z: 6, rotationX: -0.25 }), name: 'Camera', parent: doc.root },
    );
  } else if (kind === 'ui') {
    doc.root.children.push(
      { ...doc.createNode('Panel', { anchor: 'full', color: [0.08, 0.09, 0.12, 1], cornerRadius: 0, borderWidth: 0 }), name: 'Background', parent: doc.root },
      { ...doc.createNode('Label', { anchor: 'top', y: 80, width: 600, height: 60, text: name, size: 44, align: 'center' }), name: 'Title', parent: doc.root },
      { ...doc.createNode('Button', { anchor: 'center', width: 200, height: 48, text: 'Play' }), name: 'Play', parent: doc.root },
    );
  }
  ed.project.write(path, doc.toText());
  if (!ed.project.settings().main) ed.project.updateSettings({ main: path });
  await openFile(path);
}

const SCRIPT_TEMPLATE = (name, type) => {
  const cls = name.replace(/[^\w]/g, '').replace(/^\d+/, '').replace(/^\w/, (c) => c.toUpperCase()) || 'Script';
  const extra = isA(type || 'Node', 'CharacterBody2D') ? `
-- moveAndSlide() moves by vx, vy and stops at walls. (A Platformer or
-- TopDown child does this for you.)
` : isA(type || 'Node', 'Button') ? `
-- Called when the button is clicked.
function ${cls}:pressed()
end
` : isA(type || 'Node', 'Area2D') || isA(type || 'Node', 'Area3D') ? `
-- Called when a body or area comes in.
function ${cls}:entered(other)
end
` : '';
  return `-- ${cls}${type ? `: a script for a ${type}` : ''}.
local ${cls} = {}

-- Variables like this one appear in the Inspector, so each node can have its own value.
${cls}.speed = 200

-- Called once, when the node enters the scene.
function ${cls}:ready()
end

-- Called every frame. dt is the time since the last frame, in seconds.
function ${cls}:update(dt)
end
${extra}
return ${cls}
`;
};

async function newScript(node = null, dir = 'scripts') {
  const name = await promptDialog({ title: 'New script', label: 'Name', value: node ? node.name.toLowerCase() : 'script', okLabel: 'Create' });
  if (!name) return null;
  const path = uniquePath(dir, fileName(name), '.lua');
  ed.project.write(path, SCRIPT_TEMPLATE(name, node?.type));
  if (!node) await openFile(path);
  return path;
}

async function attachScript(node) {
  const doc = sceneWs().doc;
  const scripts = ed.project.paths().filter((p) => p.endsWith('.lua') && p !== 'main.lua' && p !== 'conf.lua');
  let choice = 'new';
  if (scripts.length) {
    const sel = h('select', { class: 'input' }, h('option', { value: 'new' }, 'A new script'), ...scripts.map((p) => h('option', { value: p }, p)));
    const ok = await openDialog({ title: `Attach a script to ${node.name}`, body: h('div', { class: 'settings-grid' }, h('label', {}, 'Script'), sel), actions: [{ label: 'Cancel', value: false, ghost: true }, { label: 'Attach', value: true, primary: true }] });
    if (!ok) return;
    choice = sel.value;
  }
  const path = choice === 'new' ? await newScript(node) : choice;
  if (!path) return;
  doc.setScript(node, path);
  if (choice === 'new') openFile(path);
}

/** Sensible starting properties and children for a new node. */
function populate(doc, node, parent) {
  const type = node.type;
  const settingsD = ed.project.settings().display || {};
  if (isA(type, 'Node2D') && parent === doc.root && isA(doc.root.type, 'Node2D') && !doc.root.children.length) {
    node.props.x = Math.round((settingsD.width || 1280) / 2);
    node.props.y = Math.round((settingsD.height || 720) / 2);
  }
  const shape2d = ['CharacterBody2D', 'StaticBody2D', 'Area2D', 'RigidBody2D'];
  const shape3d = ['CharacterBody3D', 'StaticBody3D', 'Area3D', 'RigidBody3D'];
  if (shape2d.includes(type)) node.children.push({ ...doc.createNode('CollisionShape2D'), name: 'Shape', parent: node });
  if (shape3d.includes(type)) {
    node.children.push({ ...doc.createNode('CollisionShape3D', type === 'CharacterBody3D' ? { shape: 'capsule', radius: 0.4, height: 1.8 } : {}), name: 'Shape', parent: node });
    if (type !== 'CharacterBody3D' && type !== 'Area3D') node.children.push({ ...doc.createNode('MeshInstance3D'), name: 'Mesh', parent: node });
  }
}

async function addNodeTo(parent) {
  const doc = sceneWs().doc;
  if (!doc) {
    toast('Open or make a scene first.');
    return;
  }
  const type = await addNodeDialog(parent?.type);
  if (!type) return;
  const node = doc.createNode(type, {}, type);
  populate(doc, node, parent || doc.root);
  doc.add(parent || doc.root, node, undefined, `Add ${type}`);
  doc.select([node]);
}

async function instanceScene(parent) {
  const doc = sceneWs().doc;
  const scenes = ed.project.paths().filter((p) => p.endsWith('.scene') && p !== doc.path && !doc.wouldLoop(p));
  if (!scenes.length) {
    toast('There are no other scenes to place. Make one with Files › New › Scene, or right-click a node › Save as a scene.');
    return;
  }
  const sel = h('select', { class: 'input', size: Math.min(8, scenes.length) }, ...scenes.map((p, i) => h('option', { value: p, selected: i === 0 }, p)));
  const ok = await openDialog({
    title: 'Place a scene', body: h('div', {}, h('p', { class: 'insp-desc', style: 'margin: 0 0 8px' }, 'The scene becomes one node here. Changing its file later changes every place it\'s used.'), sel),
    actions: [{ label: 'Cancel', value: false, ghost: true }, { label: 'Place', value: true, primary: true }],
  });
  if (!ok) return;
  const node = doc.createInstance(sel.value);
  doc.add(parent || doc.root, node);
  doc.select([node]);
}

async function saveBranchAsScene(node) {
  const doc = sceneWs().doc;
  const name = await promptDialog({ title: 'Save as a scene', label: 'Name', value: node.name.toLowerCase(), okLabel: 'Save' });
  if (!name) return;
  const path = uniquePath('scenes', fileName(name), '.scene');
  const tmp = SceneDoc.empty(path, node.type, node.name);
  tmp.root = doc.copyNode(node);
  tmp.root.parent = null;
  // The new scene's root sits at its own origin; its place stays on the instance.
  const keep = ['x', 'y', 'z', 'rotation', 'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ'];
  const placed = {};
  for (const k of keep) if (k in tmp.root.props) { placed[k] = tmp.root.props[k]; delete tmp.root.props[k]; }
  ed.project.write(path, tmp.toText());
  const parent = node.parent;
  const index = parent.children.indexOf(node);
  doc.remove([node], 'Save as a scene');
  const inst = doc.createInstance(path);
  inst.name = node.name;
  inst.props = placed;
  doc.add(parent, inst, index, 'Save as a scene');
  doc.select([inst]);
  toast(`Saved ${path}. Place it again anywhere with "Place a scene".`);
}

async function changeType(node) {
  const type = await addNodeDialog(node.parent?.type);
  if (type) sceneWs().doc.changeType(node, type);
}

function copyNodes() {
  const doc = sceneWs().doc;
  ed.clipboard = doc.selected().filter((n) => n !== doc.root && !n.readonly).map((n) => doc.copyNode(n));
}

function pasteNodes(parent) {
  const doc = sceneWs().doc;
  if (!doc || !ed.clipboard.length) return;
  const target = parent || doc.selected()[0] || doc.root;
  const added = ed.clipboard.map((n) => doc.add(target.readonly ? doc.root : target, doc.copyNode(n), undefined, 'Paste'));
  doc.select(added);
}

function dropFileOnNode(path, target) {
  const doc = sceneWs().doc;
  if (!doc) return;
  if (/\.lua$/.test(path)) {
    doc.setScript(target, path);
    return;
  }
  let node;
  if (path.endsWith('.scene')) node = doc.createInstance(path);
  else if (/\.(png|jpe?g|bmp|sprite)$/i.test(path)) node = doc.createNode(isA(target.type, 'Node3D') ? 'Sprite3D' : 'Sprite2D', { image: path }, path.split('/').pop().replace(/\..*$/, ''));
  else if (/\.(glb|gltf)$/i.test(path)) node = doc.createNode('Model3D', { model: path }, path.split('/').pop().replace(/\..*$/, ''));
  else if (/\.(wav|ogg|mp3|flac|sfx|song)$/i.test(path)) node = doc.createNode('AudioPlayer', { sound: path }, 'Sound');
  else if (/\.tileset$/i.test(path)) node = doc.createNode('TileMap', { tileset: path }, 'TileMap');
  if (!node) return;
  doc.add(target, node);
  doc.select([node]);
}

// ---------------------------------------------------------------------------
// Running

async function play(scenePath = null) {
  if (!ed) return;
  await saveAll();
  const project = ed.project;
  const files = project.snapshot();
  const main = project.settings().main;
  if (!scenePath && !main && !project.has('main.lua')) {
    const open = sceneWs().doc?.path;
    if (open) {
      if (await confirmDialog({ title: 'No main scene yet', message: `Make ${open} the main scene, the one the game starts with?`, okLabel: 'Make it the main scene' })) {
        project.updateSettings({ main: open });
      } else return;
    } else {
      toast('Make a scene first, or a main.lua.');
      return;
    }
  }
  if (scenePath) files['.smitten/start'] = scenePath;
  ed.lastRun = scenePath;
  if (settings.get('clearConsoleOnRun')) ed.console.clear();
  ed.console.separator?.(scenePath ? `Playing ${scenePath}` : 'Playing');
  ed.gameView.hidden = false;
  ed.gameTitle.textContent = project.name;
  ed.runner.run({ files, modules: includedModules(project) }, { focus: settings.get('focusGameOnRun'), query: { jit: settings.get('jit') ? '1' : '0' } });
}

function stop() {
  if (!ed) return;
  ed.runner.stop();
  ed.gameView.hidden = true;
  ed.workspaces[ed.ws]?.resize();
}

function runState(s) {
  const running = s === 'loading' || s === 'running' || s === 'paused';
  ed.stopBtn.disabled = !running;
  ed.playBtn.classList.toggle('primary', !running);
  ed.playBtn.lastChild.textContent = running ? 'Restart' : 'Play';
  if (!running && s !== 'crashed') ed.gameView.hidden = true;
}

function missingModule(name) {
  const project = ed.project;
  const modules = { ...(project.settings().modules || {}), [name]: 'always' };
  project.updateSettings({ modules });
  toast(`Your game uses the ${name} module in a way Smitten didn't spot, so it's now always included. Restarting…`, { timeout: 6000 });
  setTimeout(() => play(ed.lastRun), 300);
}

// ---------------------------------------------------------------------------
// Menus

function projectMenu() {
  return [
    { label: 'New scene…', icon: 'box', action: () => newScene() },
    { label: 'New script…', icon: 'code', action: () => newScript() },
    '-',
    { label: 'Project settings…', icon: 'settings', shortcut: `${modKey}+,`, action: () => openProjectSettings() },
    { label: 'Export…', icon: 'download', shortcut: `${modKey}+E`, action: () => exportDialog(ed.project) },
    '-',
    { label: 'All games', icon: 'home', action: () => { location.hash = ''; } },
  ];
}

function editMenu() {
  const doc = ed.ws === 'scene' ? sceneWs().doc : null;
  return [
    { label: 'Undo', icon: 'undo', shortcut: `${modKey}+Z`, disabled: !doc?.undoStack.length, action: () => doc.undo() },
    { label: 'Redo', icon: 'redo', shortcut: `${modKey}+Shift+Z`, disabled: !doc?.redoStack.length, action: () => doc.redo() },
    '-',
    { label: 'Add node…', icon: 'plus', shortcut: `${modKey}+A`, disabled: !doc, action: () => addNodeTo(ed.panels.tree.targetParent()) },
    { label: 'Duplicate', icon: 'copy', shortcut: `${modKey}+D`, disabled: !doc?.selection.size, action: () => doc.select(doc.duplicate(doc.selected())) },
    { label: 'Delete', icon: 'trash', shortcut: 'Delete', disabled: !doc?.selection.size, action: () => doc.remove(doc.selected()) },
    '-',
    { label: 'Command palette…', icon: 'command', shortcut: `${modKey}+K`, action: () => commandPalette() },
    { label: 'Editor settings…', icon: 'sliders', action: () => openSettings({}) },
  ];
}

function viewMenu() {
  const panelItem = (id, label) => ({ label: `${ed.dock.isVisible(id) ? '✓ ' : '   '}${label}`, action: () => ed.dock.toggle(id) });
  return [
    { heading: 'Panels' },
    panelItem('scene', 'Scene'), panelItem('files', 'Files'), panelItem('inspector', 'Inspector'), panelItem('output', 'Output'),
    '-',
    { label: 'Reset layout', icon: 'restart', action: () => resetLayout() },
    '-',
    { heading: 'Theme' },
    ...['system', 'light', 'dark'].map((t) => ({ label: `${settings.get('theme') === t ? '✓ ' : '   '}${t[0].toUpperCase()}${t.slice(1)}`, action: () => settings.set('theme', t) })),
  ];
}

function helpMenu() {
  return [
    { label: 'Keyboard shortcuts', icon: 'keyboard', action: () => shortcutsDialog() },
    { label: 'Node reference…', icon: 'book', action: () => nodeDocs(null) },
  ];
}

async function openProjectSettings(tab) {
  await projectSettingsDialog(ed.project, { tab });
}

// ---------------------------------------------------------------------------
// Help

function nodeDocs(type) {
  const body = h('div', { style: 'display: grid; grid-template-columns: 200px 1fr; gap: 12px; height: min(560px, 70vh)' });
  const list = h('div', { class: 'add-node-items' });
  const page = h('div', { class: 'add-node-help' });
  const showType = (t) => {
    const def = typeDef(t);
    for (const el of list.children) el.classList?.toggle('active', el.dataset.type === t);
    const ownMethods = methods(t);
    const ev = events(t);
    page.replaceChildren(
      h('h3', {}, nodeIcon(t, 20), t),
      h('p', {}, def.description),
      def.extends ? h('p', { class: 'module-note' }, `Also has everything a ${def.extends} has.`) : null,
      h('div', { class: 'add-node-group', style: 'padding: 0' }, 'Properties'),
      h('ul', {}, ...properties(t).filter((p) => !p.def.hidden).map((p) => h('li', {}, h('code', {}, p.name), ` — ${p.def.description}`))),
      Object.keys(ownMethods).length ? h('div', { class: 'add-node-group', style: 'padding: 0' }, 'Methods') : null,
      h('ul', {}, ...Object.entries(ownMethods).map(([m, d]) => h('li', {}, h('code', {}, `self:${m}(${d.args})`), ` — ${d.doc}`))),
      Object.keys(ev).length ? h('div', { class: 'add-node-group', style: 'padding: 0' }, 'Script functions') : null,
      h('ul', {}, ...Object.entries(ev).map(([m, d]) => h('li', {}, h('code', {}, `function Name:${m}(${d.args})`), ` — ${d.doc}`))),
    );
  };
  import('./core/schema.js').then(({ typesByGroup }) => {
    for (const g of typesByGroup()) {
      list.append(h('div', { class: 'add-node-group' }, g.name));
      for (const t of g.types) {
        const item = h('div', { class: 'add-node-item', 'data-type': t.name }, nodeIcon(t.name), t.name);
        item.addEventListener('click', () => showType(t.name));
        list.append(item);
      }
    }
    showType(type || 'Node');
  });
  body.append(list, page);
  openDialog({ title: 'Node reference', wide: true, body, actions: [{ label: 'Close', value: null, primary: true }] });
}

const SHORTCUTS = [
  ['Play the game', 'F5'], ['Play this scene', 'F6'], ['Stop', 'F8'],
  ['Command palette', `${modKey}+K`], ['Open a file', `${modKey}+P`], ['Save everything now', `${modKey}+S`],
  ['Undo / redo', `${modKey}+Z / ${modKey}+Shift+Z`], ['Add a node', `${modKey}+A`], ['Duplicate', `${modKey}+D`], ['Rename a node', 'F2'],
  ['Select / move / rotate / scale', 'Q / W / E / R'], ['Frame the selection', 'F'],
  ['Workspaces', 'Alt+1 … Alt+5'], ['Project settings', `${modKey}+,`], ['Export', `${modKey}+E`],
];

function shortcutsDialog() {
  openDialog({
    title: 'Keyboard shortcuts',
    body: h('div', { class: 'settings-grid' }, ...SHORTCUTS.flatMap(([a, k]) => [h('label', {}, a), h('kbd', {}, k)])),
    actions: [{ label: 'Close', value: null, primary: true }],
  });
}

// ---------------------------------------------------------------------------
// Command palette

function commands() {
  const doc = sceneWs()?.doc;
  const list = [
    { label: 'Play the game', hint: 'F5', run: () => play() },
    { label: 'Play this scene', hint: 'F6', run: () => doc && play(doc.path) },
    { label: 'Stop the game', hint: 'F8', run: () => stop() },
    { label: 'Add node…', hint: `${modKey}+A`, run: () => addNodeTo(ed.panels.tree.targetParent()) },
    { label: 'New scene…', run: () => newScene() },
    { label: 'New script…', run: () => newScript() },
    { label: 'Project settings', run: () => openProjectSettings() },
    { label: 'Input actions', run: () => openProjectSettings('input') },
    { label: 'Engine modules', run: () => openProjectSettings('modules') },
    { label: 'Export…', run: () => exportDialog(ed.project) },
    { label: 'Reset layout', run: () => resetLayout() },
    { label: 'Node reference', run: () => nodeDocs(null) },
    { label: 'Editor settings', run: () => openSettings({}) },
    { label: 'All games', run: () => { location.hash = ''; } },
  ];
  for (const w of WORKSPACES) list.push({ label: `Go to ${w.label}`, run: () => switchWorkspace(w.id) });
  for (const id of ['scene', 'files', 'inspector', 'output']) list.push({ label: `Show or hide the ${id} panel`, run: () => ed.dock.toggle(id) });
  return list;
}

function commandPalette(filesOnly = false) {
  const input = h('input', { class: 'input', placeholder: filesOnly ? 'Open a file…' : 'Type a command or a file name…', 'aria-label': 'Search' });
  const list = h('div', { class: 'add-node-items', style: 'height: 320px' });
  let items = [];
  let index = 0;
  const all = () => [
    ...(filesOnly ? [] : commands()),
    ...ed.project.paths().map((p) => ({ label: p, hint: 'file', run: () => openFile(p) })),
  ];
  const render = () => {
    const q = input.value.trim().toLowerCase();
    items = all().filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 60);
    index = Math.min(index, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((c, i) => {
      const el = h('div', { class: `add-node-item ${i === index ? 'active' : ''}` }, h('span', {}, c.label), c.hint ? h('span', { class: 'muted' }, c.hint) : null);
      el.addEventListener('click', () => { dlg.finish(null); c.run(); });
      return el;
    }));
  };
  let dlg;
  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      index = Math.max(0, Math.min(items.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
      render();
      list.children[index]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = items[index];
      dlg.finish(null);
      c?.run();
    }
  });
  openDialog({ title: filesOnly ? 'Open a file' : 'Command palette', body: h('div', { style: 'display: flex; flex-direction: column; gap: 8px' }, input, list), onOpen: (d) => { dlg = d; render(); input.focus(); } });
}

// ---------------------------------------------------------------------------
// Keyboard

function typing(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest?.('.cm-editor'));
}

function handleGlobalKey(e) {
  if (!ed) return false;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  if (e.key === 'F5') { play(e.shiftKey ? null : ed.lastRun ?? null); return true; }
  if (e.key === 'F6') { const d = sceneWs().doc; if (d) play(d.path); return true; }
  if (e.key === 'F8') { stop(); return true; }
  if (mod && (k === 'k' || (e.shiftKey && k === 'p'))) { commandPalette(); return true; }
  if (mod && k === 'p') { commandPalette(true); return true; }
  if (mod && k === 's') { saveAll(); toast('Saved.'); return true; }
  if (mod && k === ',') { openProjectSettings(); return true; }
  if (mod && k === 'e') { exportDialog(ed.project); return true; }
  if (e.altKey && /^[1-5]$/.test(e.key)) { switchWorkspace(WORKSPACES[Number(e.key) - 1].id); return true; }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (!ed) return;
  if (handleGlobalKey(e)) {
    e.preventDefault();
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  const ws = ed.workspaces[ed.ws];
  if (!typing(e) && ws?.handleKey(e)) {
    e.preventDefault();
    return;
  }
  // Undo and redo in the scene workspace (tools and the code editor have their own).
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (ed.ws === 'scene' && mod && !typing(e)) {
    const doc = sceneWs().doc;
    const k = e.key.toLowerCase();
    if (doc && k === 'z') { e.preventDefault(); if (e.shiftKey) doc.redo(); else doc.undo(); }
    else if (doc && k === 'y') { e.preventDefault(); doc.redo(); }
    else if (doc && k === 'c') { copyNodes(); }
    else if (doc && k === 'v') { e.preventDefault(); pasteNodes(); }
  }
});

function buildOutputPanel(el) {
  const filter = h('input', { class: 'input', type: 'search', placeholder: 'Filter output', 'aria-label': 'Filter output' });
  const clear = h('button', { type: 'button', class: 'icon-btn', title: 'Clear', 'aria-label': 'Clear' }, icon('clear', 15));
  const copy = h('button', { type: 'button', class: 'icon-btn', title: 'Copy everything', 'aria-label': 'Copy everything' }, icon('copy', 15));
  const badge = h('span', { class: 'badge danger', hidden: true });
  const out = h('div', { id: 'console-output', role: 'log' });
  el.append(h('div', { class: 'panel' }, h('div', { class: 'panel-toolbar' }, filter, copy, clear, badge), h('div', { class: 'panel-scroll', style: 'display: flex; flex-direction: column' }, out)));
  ed.console = new ConsolePanel(out, { filter, clear, copy, badge }, {
    fileExists: (p) => ed.project.has(p),
    onOpenLocation: (path, line) => {
      switchWorkspace('script');
      ed.workspaces.script.open(path, { line });
    },
  });
}

boot();
