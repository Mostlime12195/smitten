// The open project: its files in memory, saved to IndexedDB (fs-store.js)
// shortly after each change, and its settings (smitten.json).
//
// Events: 'file' {path, kind: 'write' | 'delete' | 'rename', from?},
// 'settings' and 'save' {ok} after each try at saving.

import * as store from '../fs-store.js';

export const ENGINE_VERSION = '0.2.0';

export const DEFAULT_SETTINGS = {
  format: 'smitten.project',
  version: 2,
  name: 'My game',
  main: '',
  display: { width: 1280, height: 720, stretch: 'expand' },
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class Project extends EventTarget {
  /** storage: where it's saved (fs-store.js, or a stand-in for tests). */
  constructor(meta, files, dirs, storage = store) {
    super();
    this.store = storage;
    this.id = meta.id;
    this.meta = meta;
    this.files = new Map(Object.entries(files));
    this.dirs = new Set(dirs);
    this.pending = new Map(); // path -> data | null (delete)
    this.timer = null;
    this.retryTimer = null;
    this.retryDelay = 0;
    this.saveFailed = false; // the last save didn't work (it's tried again)
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
    // A change that's still waiting must not bring a deleted file back.
    for (const p of removed) this.pending.delete(p);
    this.flushSoon();
    this.saving = this.saving.then(() => this.store.deleteEntry(this.id, path)).catch(reportError);
    for (const p of removed) this.dispatchEvent(new CustomEvent('file', { detail: { path: p, kind: 'delete' } }));
  }

  rename(from, to) {
    from = store.normalizePath(from);
    to = store.normalizePath(to);
    if (from === to) return;
    const leaf = to.split('/').pop();
    if (to.startsWith(from + '/')) throw new Error('A folder can\'t be moved into itself.');
    // Never onto something that's already there: it would be lost.
    if (this.files.has(to)) throw new Error(`There's already a file called "${leaf}" here.`);
    if (this.dirs.has(to) || this.paths().some((p) => p.startsWith(to + '/'))) throw new Error(`There's already a folder called "${leaf}" here.`);
    const moved = [];
    for (const [p, d] of [...this.files]) {
      if (p === from || p.startsWith(from + '/')) {
        const np = to + p.slice(from.length);
        this.files.delete(p);
        this.files.set(np, d);
        moved.push([p, np]);
        // A change that's still waiting is saved under the new name.
        if (this.pending.has(p)) {
          this.pending.set(np, this.pending.get(p));
          this.pending.delete(p);
        }
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
    this.saving = this.saving.then(() => this.store.renameEntry(this.id, from, to)).catch(reportError);
    for (const [p, np] of moved) this.dispatchEvent(new CustomEvent('file', { detail: { path: np, from: p, kind: 'rename' } }));
  }

  mkdir(path) {
    path = store.normalizePath(path);
    this.dirs.add(path);
    this.saving = this.saving.then(() => this.store.createDir(this.id, path)).catch(reportError);
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

  /** Saves every pending change now. A save that fails is tried again. */
  flush() {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    if (!this.pending.size) return this.saving;
    const batch = Object.fromEntries(this.pending);
    this.pending.clear();
    this.saving = this.saving.then(() => this.store.writeFiles(this.id, batch)).then(() => {
      this.retryDelay = 0;
      this.saveFailed = false;
      this.dispatchEvent(new CustomEvent('save', { detail: { ok: true } }));
    }, (e) => {
      // Back in the queue, unless the file has changed again or is gone.
      for (const [p, d] of Object.entries(batch)) {
        if (!this.pending.has(p) && this.files.has(p)) this.pending.set(p, d);
      }
      this.saveFailed = true;
      this.retryDelay = Math.min(30000, this.retryDelay ? this.retryDelay * 2 : 2000);
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.flush(), this.retryDelay);
      this.dispatchEvent(new CustomEvent('save', { detail: { ok: false, error: e } }));
      reportError(e);
    });
    return this.saving;
  }

  // ---------------------------------------------------------------------------
  // Settings (smitten.json)

  settings() {
    // A project without a smitten.json yet keeps the name it was made with.
    const defaults = { ...DEFAULT_SETTINGS, name: this.meta.name || DEFAULT_SETTINGS.name };
    try {
      return { ...defaults, ...(this.readJSON('smitten.json') || {}) };
    } catch {
      return defaults;
    }
  }

  updateSettings(patch) {
    const next = { ...this.settings(), ...patch };
    this.write('smitten.json', JSON.stringify(next, null, 2) + '\n');
    if (patch.name && patch.name !== this.meta.name) {
      this.meta.name = patch.name;
      this.store.updateProject(this.id, { name: patch.name }).catch(reportError);
    }
  }

  /** Remembers editor state (open tabs, layout) with the project. */
  saveEditorState(state) {
    this.meta.editor = state;
    this.store.updateProject(this.id, { editor: state }).catch(() => {});
  }
}

function reportError(e) {
  console.error('Saving failed:', e);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('smitten-save-error', { detail: e }));
}
