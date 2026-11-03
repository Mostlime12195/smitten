// The open project: its files in memory, saved to IndexedDB (fs-store.js)
// shortly after each change, and its settings (smitten.json).
//
// Events: 'file' {path, kind: 'write' | 'delete' | 'rename', from?} and
// 'settings'.

import * as store from '../fs-store.js';

export const ENGINE_VERSION = '0.2.0';

export const DEFAULT_SETTINGS = {
  format: 'smitten.project',
  version: 2,
  name: 'My game',
  main: '',
  display: { width: 1280, height: 720, stretch: 'fit', filter: 'smooth' },
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class Project extends EventTarget {
  constructor(meta, files, dirs) {
    super();
    this.id = meta.id;
    this.meta = meta;
    this.files = new Map(Object.entries(files));
    this.dirs = new Set(dirs);
    this.pending = new Map(); // path -> data | null (delete)
    this.timer = null;
    this.saving = Promise.resolve();
  }

  static async open(id) {
    const meta = await store.getProject(id);
    if (!meta) throw new Error('That project no longer exists.');
    const files = {};
    const dirs = [];
    for (const e of await store.listEntries(id)) {
      if (e.kind === 'dir') dirs.push(e.path);
      else files[e.path] = e.data;
    }
    return new Project(meta, files, dirs);
  }

  get name() {
    return this.settings().name || this.meta.name;
  }

  has(path) {
    return this.files.has(path);
  }

  read(path) {
    return this.files.get(path);
  }

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

  /** Every file path, sorted. */
  paths() {
    return [...this.files.keys()].sort();
  }

  /** Every file as {path: data}, for running and exporting. */
  snapshot() {
    return Object.fromEntries(this.files);
  }

  write(path, data, { silent = false } = {}) {
    path = store.normalizePath(path);
    const same = this.files.get(path) === data;
    this.files.set(path, data);
    for (let d = path; d.includes('/');) {
      d = d.slice(0, d.lastIndexOf('/'));
      this.dirs.add(d);
    }
    this.schedule(path, data);
    if (!silent && !same) this.dispatchEvent(new CustomEvent('file', { detail: { path, kind: 'write' } }));
    if (path === 'smitten.json') this.dispatchEvent(new CustomEvent('settings'));
  }

  remove(path) {
    path = store.normalizePath(path);
    const removed = [];
    for (const p of [...this.files.keys()]) {
      if (p === path || p.startsWith(path + '/')) {
        this.files.delete(p);
        removed.push(p);
      }
    }
    for (const d of [...this.dirs]) if (d === path || d.startsWith(path + '/')) this.dirs.delete(d);
    this.flushSoon();
    this.saving = this.saving.then(() => store.deleteEntry(this.id, path)).catch(reportError);
    for (const p of removed) this.dispatchEvent(new CustomEvent('file', { detail: { path: p, kind: 'delete' } }));
  }

  rename(from, to) {
    from = store.normalizePath(from);
    to = store.normalizePath(to);
    if (from === to) return;
    const moved = [];
    for (const [p, d] of [...this.files]) {
      if (p === from || p.startsWith(from + '/')) {
        const np = to + p.slice(from.length);
        this.files.delete(p);
        this.files.set(np, d);
        moved.push([p, np]);
      }
    }
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(from + '/')) {
        this.dirs.delete(d);
        this.dirs.add(to + d.slice(from.length));
      }
    }
    if (!moved.length && this.dirs.has(to)) {
      // An empty folder.
    }
    this.flushSoon();
    this.saving = this.saving.then(() => store.renameEntry(this.id, from, to)).catch(reportError);
    for (const [p, np] of moved) this.dispatchEvent(new CustomEvent('file', { detail: { path: np, from: p, kind: 'rename' } }));
  }

  mkdir(path) {
    path = store.normalizePath(path);
    this.dirs.add(path);
    this.saving = this.saving.then(() => store.createDir(this.id, path)).catch(reportError);
    this.dispatchEvent(new CustomEvent('file', { detail: { path, kind: 'mkdir' } }));
  }

  schedule(path, data) {
    this.pending.set(path, data);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flushSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 0);
  }

  /** Saves every pending change now. */
  flush() {
    clearTimeout(this.timer);
    if (!this.pending.size) return this.saving;
    const batch = Object.fromEntries(this.pending);
    this.pending.clear();
    this.saving = this.saving.then(() => store.writeFiles(this.id, batch)).catch(reportError);
    return this.saving;
  }

  // ---------------------------------------------------------------------------
  // Settings (smitten.json)

  settings() {
    try {
      return { ...DEFAULT_SETTINGS, ...(this.readJSON('smitten.json') || {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  updateSettings(patch) {
    const next = { ...this.settings(), ...patch };
    this.write('smitten.json', JSON.stringify(next, null, 2) + '\n');
    if (patch.name && patch.name !== this.meta.name) {
      this.meta.name = patch.name;
      store.updateProject(this.id, { name: patch.name }).catch(reportError);
    }
  }

  /** Remembers editor state (open tabs, layout) with the project. */
  saveEditorState(state) {
    this.meta.editor = state;
    store.updateProject(this.id, { editor: state }).catch(() => {});
  }
}

function reportError(e) {
  console.error('Saving failed:', e);
  window.dispatchEvent(new CustomEvent('smitten-save-error', { detail: e }));
}
