// Opens project files in Smitten's built-in tools (pixel editor, map editor,
// sound and music editors) instead of the code editor. Each open file gets
// its own tool instance; see docs/reference.md ("Editor tools").

import * as ui from './ui.js';
import { tools } from './tools/index.js';
import { parseManifest } from './project.js';

let synthPromise = null;
function loadSynth() {
  synthPromise ??= import('./synth.js').then((m) => m.loadSynth()).catch((e) => {
    synthPromise = null;
    throw e;
  });
  return synthPromise;
}

export class ToolHost {
  /**
   * container: element the tools' elements go into.
   * app: {entries(), write(path, data), setDirty(path, dirty), openFile(path), toast(message, opts)}
   */
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.open = new Map(); // path -> {tool, instance, dirty}
    this.active = null;
  }

  /** The tool that opens this path, or null. */
  toolFor(path) {
    return tools.find((t) => t.match(path)) || null;
  }

  has(path) { return this.open.has(path); }

  isDirty(path) { return !!this.open.get(path)?.dirty; }

  get newAssets() {
    return tools.flatMap((t) => (t.newAssets || []).map((a) => ({ ...a, tool: t.id })));
  }

  createHost(path) {
    const app = this.app;
    const entry = () => this.open.get(path);
    return {
      path,
      read: (p) => app.entries().get(p)?.data,
      write: (p, data) => app.write(p, data, path),
      exists: (p) => app.entries().get(p)?.kind === 'file',
      list: () => [...app.entries().values()].filter((e) => e.kind === 'file').map((e) => e.path),
      setDirty: (dirty) => {
        const e = entry();
        if (!e || e.dirty === !!dirty) return;
        e.dirty = !!dirty;
        app.setDirty(path, e.dirty);
      },
      project: () => parseManifest(app.entries().get('smitten.json')?.data),
      palette: () => parseManifest(app.entries().get('smitten.json')?.data).palette,
      synth: loadSynth,
      toast: (message, opts) => ui.toast(message, opts),
      openFile: (p) => app.openFile(p),
      ui,
    };
  }

  /** Show the tool for path (creating it if needed). Returns false if no tool opens it. */
  show(path) {
    let e = this.open.get(path);
    if (!e) {
      const tool = this.toolFor(path);
      if (!tool) return false;
      let instance;
      try {
        instance = tool.open(this.createHost(path));
      } catch (err) {
        console.error(err);
        ui.toast(`The ${tool.label.toLowerCase()} could not open ${path}: ${err.message}`, { type: 'error', timeout: 6000 });
        return false;
      }
      e = { tool, instance, dirty: false };
      instance.element.classList.add('tool-root');
      this.open.set(path, e);
      this.container.append(instance.element);
    }
    if (this.active && this.active !== path) this.hideTool(this.active);
    this.container.hidden = false;
    e.instance.element.hidden = false;
    this.active = path;
    e.instance.show?.();
    return true;
  }

  hideTool(path) {
    const e = this.open.get(path);
    if (!e) return;
    e.instance.element.hidden = true;
    e.instance.hide?.();
  }

  /** Hide every tool (a code file or preview is being shown). */
  hide() {
    if (this.active) this.hideTool(this.active);
    this.active = null;
    this.container.hidden = true;
  }

  focus(path) { this.open.get(path)?.instance.focus?.(); }

  async save(path) {
    const e = this.open.get(path);
    if (!e) return false;
    await e.instance.save();
    if (e.dirty) {
      e.dirty = false;
      this.app.setDirty(path, false);
    }
    return true;
  }

  close(path) {
    const e = this.open.get(path);
    if (!e) return;
    this.open.delete(path);
    if (this.active === path) this.hide();
    try { e.instance.destroy?.(); } catch (err) { console.error(err); }
    e.instance.element.remove();
  }

  closeAll() {
    for (const path of [...this.open.keys()]) this.close(path);
  }

  /** A project file changed (by the code editor, another tool, an import). */
  changed(path, source = null) {
    for (const [p, e] of this.open) {
      if (p !== source) {
        try { e.instance.reload?.(path); } catch (err) { console.error(err); }
      }
    }
  }
}
