// Paint, Sound and Music: workspaces around the built-in tools (tools/*),
// with their files in tabs. A workspace never waits for you to make a file
// first (DESIGN.md, section 8): with nothing open it shows a new, untitled
// document, which becomes a real file the first time you change it.

import { h, icon, toast } from '../ui.js';
import { ToolHost } from '../tool-host.js';
import { tools } from '../tools/index.js';

export class ToolWorkspace extends EventTarget {
  /** def: { id, toolId, label, untitledLabel }; app: { project } */
  constructor(el, app, def) {
    super();
    this.el = el;
    this.app = app;
    this.def = def;
    this.project = app.project;
    this.tool = tools.find((t) => t.id === def.toolId) || tools.find((t) => t.newAssets?.[0]?.extension && def.match?.test(t.newAssets[0].extension));
    this.virtual = new Map(); // untitled path -> data, not saved until changed
    this.order = [];
    this.active = null;
    this.timers = new Map();

    this.tabs = h('div', { class: 'doc-tabs', role: 'tablist' });
    const area = h('div', { class: 'tool-host' });
    el.append(this.tabs, h('div', { style: 'flex: 1; position: relative; min-height: 0' }, area));
    const entries = () => {
      const m = new Map();
      for (const p of this.project.paths()) m.set(p, { path: p, kind: 'file', data: this.project.read(p) });
      for (const [p, d] of this.virtual) m.set(p, { path: p, kind: 'file', data: d });
      return m;
    };
    this.host = new ToolHost(area, {
      entries,
      write: (path, data) => {
        this.ownWrite = path;
        const wasVirtual = this.virtual.delete(path);
        this.project.write(path, data);
        this.ownWrite = null;
        if (wasVirtual) {
          toast(`Saved as ${path}. Rename it in Files whenever you like.`);
          this.render();
        }
      },
      setDirty: (path, dirty) => {
        if (dirty) this.scheduleSave(path);
        this.render();
      },
      openFile: (path) => this.app.openFile(path),
      toast: (m, o) => toast(m, o),
    });
    this.project.addEventListener('file', (e) => this.onFile(e.detail));
  }

  canOpen(path) {
    return !!this.tool?.match(path);
  }

  /** Called when the workspace is shown: opens an untitled document if nothing is open. */
  show() {
    if (!this.order.length) this.newUntitled();
    else this.open(this.active || this.order[0]);
  }

  newUntitled() {
    const asset = this.tool?.newAssets?.[0];
    if (!asset) return;
    const folder = asset.folder || '';
    const base = this.def.untitledBase;
    let i = 1;
    let name;
    const exists = (b) => Object.keys(asset.files(b)).some((p) => this.project.has(`${folder ? folder + '/' : ''}${p.split('/').pop()}`) || this.virtual.has(`${folder ? folder + '/' : ''}${p.split('/').pop()}`));
    do {
      name = i === 1 ? base : `${base}-${i}`;
      i++;
    } while (exists(name));
    let main = null;
    for (const [p, data] of Object.entries(asset.files(name))) {
      const path = `${folder ? folder + '/' : ''}${p.split('/').pop()}`;
      this.virtual.set(path, data);
      if (!main && this.tool.match(path)) main = path;
    }
    if (main) this.open(main);
  }

  open(path) {
    if (!this.order.includes(path)) this.order.push(path);
    this.active = path;
    this.host.show(path);
    this.render();
  }

  scheduleSave(path) {
    clearTimeout(this.timers.get(path));
    this.timers.set(path, setTimeout(() => this.host.save(path), 900));
  }

  /** Saving takes a moment (images are encoded): the promise says when it's done. */
  saveAll() {
    return Promise.all(this.order.filter((p) => this.host.isDirty(p)).map((p) => this.host.save(p)));
  }

  close(path) {
    if (this.host.isDirty(path)) this.host.save(path);
    this.host.close(path);
    this.virtual.delete(path);
    const i = this.order.indexOf(path);
    this.order.splice(i, 1);
    if (this.active === path) {
      this.active = this.order[Math.min(i, this.order.length - 1)] || null;
      if (this.active) this.host.show(this.active);
      else this.newUntitled();
    }
    this.render();
  }

  onFile({ path, kind, from }) {
    if (path === this.ownWrite) return;
    if (kind === 'rename' && this.order.includes(from)) {
      this.host.close(from);
      this.order[this.order.indexOf(from)] = path;
      if (this.active === from) {
        this.active = path;
        this.host.show(path);
      }
      this.render();
    } else if (kind === 'delete' && this.order.includes(path)) {
      this.close(path);
    } else if (kind === 'write' && this.host.has?.(path)) {
      this.host.changed?.(path);
    }
  }

  render() {
    this.tabs.replaceChildren();
    for (const path of this.order) {
      const untitled = this.virtual.has(path);
      const dirty = this.host.isDirty(path);
      const tab = h('button', { type: 'button', class: `doc-tab ${untitled ? 'untitled' : ''}`, role: 'tab', 'aria-selected': String(path === this.active), title: untitled ? `New (saved as ${path} once you change it)` : path },
        icon(this.def.icon, 13), h('span', { class: 'doc-name' }, untitled ? this.def.untitledLabel : path.split('/').pop()),
        dirty ? h('span', { class: 'dirty-dot', title: 'Saving…' }) : null,
        h('span', { class: 'doc-close', title: 'Close' }, icon('x', 12)));
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.doc-close')) this.close(path);
        else this.open(path);
      });
      this.tabs.append(tab);
    }
    const add = h('button', { type: 'button', class: 'doc-new', title: `New ${this.def.untitledLabel.toLowerCase()}` }, icon('plus', 14));
    add.addEventListener('click', () => this.newUntitled());
    this.tabs.append(add);
  }

  handleKey(e) {
    return this.host.handleKey?.(e) || false;
  }

  resize() {}

  openPaths() {
    return this.order.filter((p) => !this.virtual.has(p));
  }
}
