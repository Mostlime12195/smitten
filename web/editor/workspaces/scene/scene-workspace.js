// The Scene workspace: open scenes as tabs, a toolbar, and the scene view.
// Scenes save themselves shortly after each change.

import { h, icon, toast, modKey } from '../../ui.js';
import { SceneDoc } from '../../core/scene-doc.js';

const TOOLS = [
  { id: 'select', icon: 'pointer', label: 'Select', key: 'Q' },
  { id: 'move', icon: 'move', label: 'Move', key: 'W' },
  { id: 'rotate', icon: 'rotate', label: 'Rotate', key: 'E' },
  { id: 'scale', icon: 'scale', label: 'Scale', key: 'R' },
];

export class SceneWorkspace extends EventTarget {
  /** app: { project, panels: {tree, inspector}, playScene(path), setStatus(text), dock } */
  constructor(el, app) {
    super();
    this.el = el;
    this.app = app;
    this.project = app.project;
    this.docs = new Map(); // path -> SceneDoc
    this.order = [];
    this.active = null;
    this.view = null;
    this.tool = 'select';
    this.snap = localStorage.getItem('smitten-editor.snap') !== '0';
    this.saveTimers = new Map();

    this.tabs = h('div', { class: 'doc-tabs', role: 'tablist' });
    this.toolbar = this.buildToolbar();
    this.host = h('div', { class: 'viewport-host' });
    this.status = h('div', { class: 'ws-status' });
    this.selectionPanelHost = h('div', { class: 'selection-panel-host', hidden: true });
    this.emptyEl = h('div', { class: 'empty', hidden: true },
      h('h3', {}, 'No scene open'),
      h('p', {}, 'Scenes hold the pieces of your game: a level, a menu, a player. Open one from Files, or make a new one.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => app.newScene('level') }, 'New level'),
        h('button', { type: 'button', class: 'btn', onclick: () => app.newScene('ui') }, 'New menu')));
    el.append(this.tabs, this.toolbar, h('div', { style: 'flex: 1; position: relative; display: flex; flex-direction: column; min-height: 0' }, this.host, this.status, this.emptyEl), this.selectionPanelHost);

    this.host.addEventListener('viewport-status', (e) => { this.status.textContent = e.detail.text; });
    // A view's own Q/W/E/R keys: keep the toolbar in step.
    this.host.addEventListener('viewport-tool', (e) => {
      this.tool = e.detail.tool;
      for (const [id, b] of Object.entries(this.toolButtons)) b.setAttribute('aria-pressed', String(id === this.tool));
    });
    this.host.addEventListener('viewport-context', (e) => {
      const { node, x, y } = e.detail;
      if (node && !this.active.selection.has(node.id)) this.active.select([node]);
      app.panels.tree.menu(node, { x, y });
    });
    this.project.addEventListener('file', (e) => this.onFile(e.detail));
    this.render();
  }

  get doc() {
    return this.active;
  }

  buildToolbar() {
    const bar = h('div', { class: 'ws-toolbar' });
    this.toolButtons = {};
    for (const t of TOOLS) {
      const b = h('button', { type: 'button', class: 'tool-btn', title: `${t.label} (${t.key})`, 'aria-label': t.label, 'aria-pressed': String(t.id === this.tool) }, icon(t.icon, 16));
      b.addEventListener('click', () => this.setTool(t.id));
      this.toolButtons[t.id] = b;
      bar.append(b);
    }
    bar.append(h('span', { class: 'sep' }));
    this.snapBtn = h('button', { type: 'button', class: 'tool-btn', title: 'Snap to the grid (hold Ctrl to do the opposite)', 'aria-pressed': String(this.snap) }, icon('magnet', 15), 'Snap');
    this.snapBtn.addEventListener('click', () => this.setSnap(!this.snap));
    bar.append(this.snapBtn);
    this.collisionsBtn = h('button', { type: 'button', class: 'tool-btn', title: 'Show collision shapes', 'aria-pressed': 'true' }, icon('square', 15), 'Shapes');
    this.collisionsBtn.addEventListener('click', () => {
      const on = this.collisionsBtn.getAttribute('aria-pressed') !== 'true';
      this.collisionsBtn.setAttribute('aria-pressed', String(on));
      this.view?.setShowCollisions?.(on);
    });
    bar.append(this.collisionsBtn);
    const frame = h('button', { type: 'button', class: 'tool-btn', title: 'Frame the selection (F)' }, icon('focus', 15));
    frame.addEventListener('click', () => this.viewport()?.frameSelection());
    bar.append(frame);
    bar.append(h('span', { class: 'spacer' }));
    const play = h('button', { type: 'button', class: 'tool-btn', title: 'Play this scene (F6)' }, icon('play', 14), 'Play scene');
    play.addEventListener('click', () => this.active && this.app.playScene(this.active.path));
    bar.append(play);
    return bar;
  }

  setTool(t) {
    this.tool = t;
    for (const [id, b] of Object.entries(this.toolButtons)) b.setAttribute('aria-pressed', String(id === t));
    this.viewport()?.setTool(t);
  }

  setSnap(on) {
    this.snap = on;
    localStorage.setItem('smitten-editor.snap', on ? '1' : '0');
    this.snapBtn.setAttribute('aria-pressed', String(on));
    this.view?.setSnap(on);
  }

  viewport() {
    return this.view || null;
  }

  readScene(path) {
    const text = this.project.readText(path);
    return text ? JSON.parse(text) : null;
  }

  /** Opens a scene file in a tab (or switches to it). */
  async open(path) {
    let doc = this.docs.get(path);
    if (!doc) {
      const text = this.project.readText(path);
      if (text === undefined) {
        toast(`${path} doesn't exist`, { type: 'error' });
        return null;
      }
      try {
        doc = SceneDoc.fromText(path, text, { readScene: (p) => this.readScene(p) });
      } catch (e) {
        toast(`Can't open ${path}: ${e.message}`, { type: 'error' });
        return null;
      }
      doc.addEventListener('change', () => this.scheduleSave(doc));
      doc.addEventListener('select', () => this.updateSelectionPanel());
      this.docs.set(path, doc);
      this.order.push(path);
    }
    await this.activate(doc);
    return doc;
  }

  async activate(doc) {
    this.active = doc;
    this.app.panels.tree.setDoc(doc);
    this.app.panels.inspector.setDoc(doc);
    this.render();
    if (doc) await this.showView();
    else if (this.view) this.view.el.hidden = true;
    this.updateSelectionPanel();
    this.dispatchEvent(new Event('activate'));
  }

  /** The scene view, made the first time a scene opens. */
  async showView() {
    if (!this.view) {
      const el = h('div', { class: 'viewport' });
      this.host.append(el);
      let vp;
      try {
        const { Viewport2D } = await import('./viewport2d.js');
        vp = new Viewport2D(el, { doc: this.active, project: this.project, settings: { snap: this.snap, grid: 16, angleSnap: 15, showCollisions: this.collisionsBtn.getAttribute('aria-pressed') === 'true' } });
      } catch (e) {
        console.error(e);
        el.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'The scene view couldn\'t load'), h('p', {}, String(e.message || e))));
        vp = { setDoc() {}, setTool() {}, setSnap() {}, frameSelection() {}, resize() {}, dispose() {} };
      }
      vp.el = el;
      this.view = vp;
      vp.setTool(this.tool);
    }
    this.view.el.hidden = false;
    this.view.setDoc(this.active);
    this.view.resize();
  }

  /** The tile panel below the view while a Tiles piece is selected. */
  async updateSelectionPanel() {
    const sel = this.active?.selected() || [];
    const tilemap = sel.length === 1 && sel[0].type === 'Tiles' && !sel[0].readonly ? sel[0] : null;
    if (!tilemap) {
      this.selectionPanelHost.hidden = true;
      this.tilemapPanel?.setNode(null);
      if (this.tool === 'paint') this.setTool('select');
      return;
    }
    this.selectionPanelHost.hidden = false;
    if (!this.tilemapPanel) {
      try {
        const { TilesPanel } = await import('./tilemap-panel.js');
        this.tilemapPanel = new TilesPanel(this.selectionPanelHost, { doc: this.active, project: this.project, viewport: this.view });
      } catch (e) {
        this.selectionPanelHost.replaceChildren(h('p', { class: 'insp-hint' }, `The tile panel couldn't load: ${e.message}`));
        return;
      }
    }
    this.tilemapPanel.doc = this.active;
    this.tilemapPanel.viewport = this.view;
    this.tilemapPanel.setNode(tilemap);
    this.viewport()?.resize();
  }

  render() {
    this.tabs.replaceChildren();
    for (const path of this.order) {
      const doc = this.docs.get(path);
      const name = path.split('/').pop();
      const close = h('span', { class: 'doc-close', title: 'Close', role: 'button' }, icon('x', 12));
      const tab = h('button', { type: 'button', class: 'doc-tab', role: 'tab', 'aria-selected': String(doc === this.active), title: path },
        icon('scene', 13), h('span', { class: 'doc-name' }, name), close);
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.doc-close')) this.close(path);
        else this.activate(doc);
      });
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) this.close(path); });
      this.tabs.append(tab);
    }
    const add = h('button', { type: 'button', class: 'doc-new', title: 'New scene' }, icon('plus', 14));
    add.addEventListener('click', () => this.app.newScene());
    this.tabs.append(add);
    const has = !!this.active;
    this.emptyEl.hidden = has;
    this.host.hidden = !has;
    this.toolbar.hidden = !has;
    this.status.hidden = !has;
  }

  close(path) {
    const doc = this.docs.get(path);
    if (!doc) return;
    this.saveNow(doc);
    this.docs.delete(path);
    const i = this.order.indexOf(path);
    this.order.splice(i, 1);
    if (this.active === doc) {
      const next = this.order[Math.min(i, this.order.length - 1)];
      this.activate(next ? this.docs.get(next) : null);
    } else {
      this.render();
    }
    this.dispatchEvent(new Event('tabs'));
  }

  scheduleSave(doc) {
    clearTimeout(this.saveTimers.get(doc));
    this.saveTimers.set(doc, setTimeout(() => this.saveNow(doc), 350));
    this.render();
  }

  saveNow(doc) {
    clearTimeout(this.saveTimers.get(doc));
    if (!doc.dirty) return;
    doc.dirty = false;
    this.ownWrite = doc.path;
    this.project.write(doc.path, doc.toText());
    this.ownWrite = null;
  }

  saveAll() {
    for (const doc of this.docs.values()) this.saveNow(doc);
  }

  onFile({ path, kind, from }) {
    if (path === this.ownWrite) return;
    if (kind === 'rename' && this.docs.has(from)) {
      const doc = this.docs.get(from);
      doc.path = path;
      this.docs.delete(from);
      this.docs.set(path, doc);
      this.order[this.order.indexOf(from)] = path;
      this.render();
      return;
    }
    if (kind === 'delete' && this.docs.has(path)) {
      this.docs.get(path).dirty = false;
      this.close(path);
      return;
    }
    // Another scene (an instance) or a texture changed: the views redraw from
    // their own project listeners; an outside change to an open scene reloads it.
    const doc = this.docs.get(path);
    if (doc && kind === 'write' && !doc.dirty) {
      try {
        const fresh = SceneDoc.fromText(path, this.project.readText(path), doc.ctx);
        doc.root = fresh.root;
        doc.selection.clear();
        doc.dispatchEvent(new CustomEvent('change', { detail: { kind: 'tree' } }));
        doc.dirty = false;
      } catch { /* keep the open version */ }
    }
    if (/\.scene$/.test(path) && this.active && this.active.path !== path) {
      // Instances of it may need redrawing.
      this.active.dispatchEvent(new CustomEvent('change', { detail: { kind: 'tree' } }));
      this.active.dirty = false;
    }
  }

  handleKey(e) {
    const doc = this.active;
    if (!doc) return false;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (!mod && !e.altKey) {
      const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
      if (tool) { this.setTool(tool.id); return true; }
      if (k === 'f') { this.viewport()?.frameSelection(); return true; }
      if (k === 'delete' || k === 'backspace') { doc.remove(doc.selected()); return true; }
    }
    if (mod && k === 'd') { doc.select(doc.duplicate(doc.selected())); return true; }
    if (mod && k === 'a' && !e.shiftKey) { this.app.addNodeDialog(this.app.panels.tree.targetParent()); return true; }
    return false;
  }

  resize() {
    this.viewport()?.resize();
  }

  /** Paths of open scenes, to restore next time. */
  openPaths() {
    return [...this.order];
  }
}

