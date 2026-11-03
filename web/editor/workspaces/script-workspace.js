// The Script workspace: code and text files in tabs, in CodeMirror (or a
// plain text area if it can't load). Files save themselves as you type.

import { h, icon, toast } from '../ui.js';
import { createEditor } from '../code-editor.js';

export class ScriptWorkspace extends EventTarget {
  /** app: { project, settings, setCursor(text), newScript() } */
  constructor(el, app) {
    super();
    this.el = el;
    this.app = app;
    this.project = app.project;
    this.order = [];
    this.active = null;
    this.timers = new Map();
    this.tabs = h('div', { class: 'doc-tabs', role: 'tablist' });
    this.host = h('div', { class: 'viewport-host code-host' });
    this.emptyEl = h('div', { class: 'empty' },
      h('h3', {}, 'No script open'),
      h('p', {}, 'Scripts give pieces their behavior. Attach one from the Inspector, or open a .lua file from Files.'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => app.newScript() }, 'New script')));
    el.append(this.tabs, h('div', { style: 'flex: 1; position: relative; min-height: 0' }, this.host, this.emptyEl));
    this.ready = createEditor(this.host, {
      onChange: (path) => this.changed(path),
      onCursor: (line, col) => app.setCursor?.(`Ln ${line}, Col ${col}`),
    }).then((ed) => {
      this.editor = ed;
      ed.applySettings?.(app.settings || {});
      if (app.completions) ed.completionSource = app.completions(ed);
      return ed;
    });
    this.project.addEventListener('file', (e) => this.onFile(e.detail));
    this.render();
  }

  async open(path, { line } = {}) {
    const ed = await this.ready;
    const text = this.project.readText(path);
    if (text === undefined) {
      toast(`${path} doesn't exist`, { type: 'error' });
      return;
    }
    if (!this.order.includes(path)) this.order.push(path);
    this.active = path;
    ed.open(path, text);
    if (line) ed.gotoLine(line);
    this.render();
    requestAnimationFrame(() => ed.focus());
  }

  changed(path) {
    clearTimeout(this.timers.get(path));
    this.timers.set(path, setTimeout(() => this.save(path), 500));
  }

  save(path) {
    clearTimeout(this.timers.get(path));
    if (!this.editor?.has(path)) return;
    const text = this.editor.getText(path);
    if (text === this.project.readText(path)) return;
    this.ownWrite = path;
    this.project.write(path, text);
    this.ownWrite = null;
  }

  saveAll() {
    for (const p of this.order) this.save(p);
  }

  close(path) {
    this.save(path);
    this.editor?.close(path);
    const i = this.order.indexOf(path);
    this.order.splice(i, 1);
    if (this.active === path) {
      const next = this.order[Math.min(i, this.order.length - 1)];
      this.active = null;
      if (next) this.open(next);
      else this.editor?.hide();
    }
    this.render();
  }

  onFile({ path, kind, from }) {
    if (path === this.ownWrite || !this.editor) return;
    if (kind === 'rename' && this.order.includes(from)) {
      this.editor.rename(from, path);
      this.order[this.order.indexOf(from)] = path;
      if (this.active === from) this.active = path;
      this.render();
    } else if (kind === 'delete' && this.order.includes(path)) {
      this.editor.close(path);
      this.order.splice(this.order.indexOf(path), 1);
      if (this.active === path) this.active = null;
      if (!this.active) this.editor.hide();
      this.render();
    } else if (kind === 'write' && this.editor.has(path)) {
      const text = this.project.readText(path);
      if (text !== this.editor.getText(path)) this.editor.setText(path, text);
    }
  }

  showError(path, line, message) {
    this.open(path, { line }).then(() => this.editor?.setError(path, line, message));
  }

  render() {
    this.tabs.replaceChildren();
    for (const path of this.order) {
      const tab = h('button', { type: 'button', class: 'doc-tab', role: 'tab', 'aria-selected': String(path === this.active), title: path },
        icon('code', 13), h('span', { class: 'doc-name' }, path.split('/').pop()), h('span', { class: 'doc-close', title: 'Close' }, icon('x', 12)));
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.doc-close')) this.close(path);
        else this.open(path);
      });
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) this.close(path); });
      this.tabs.append(tab);
    }
    const add = h('button', { type: 'button', class: 'doc-new', title: 'New script' }, icon('plus', 14));
    add.addEventListener('click', () => this.app.newScript());
    this.tabs.append(add);
    this.emptyEl.hidden = !!this.active;
    this.host.hidden = !this.active;
  }

  handleKey() {
    return false;
  }

  resize() {
    this.editor?.remeasure?.();
  }

  openPaths() {
    return [...this.order];
  }
}
