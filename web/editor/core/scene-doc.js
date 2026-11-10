// An open .scene file: its node tree, edits with undo, selection, and the
// scenes it places inside itself (instances).
//
// A node here is a plain object:
//   { id, name, type, props, script, tags, children, instance, parent }
// props holds only what differs from the default (for an instance: what it
// overrides). get(node, key) gives the value in effect.

import { defaultOf, properties, equal, clone, typeDef, getSchema } from './schema.js';
import { isOldScene, upgradeScene } from './update-project.js';

let nextId = 1;

// Old scenes placed in others, converted: parsed JSON -> its version 3 form.
const upgraded = new WeakMap();

export class SceneDoc extends EventTarget {
  /**
   * ctx.readScene(path) -> parsed JSON of another .scene file (or null), for
   * instances. It's read again whenever instanceTree() is asked, so edits to
   * the other scene show up.
   */
  constructor(path, data, ctx = {}) {
    super();
    this.path = path;
    this.ctx = ctx;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = new Set();
    this.dirty = false;
    // A scene saved with the old rules (radians, a Body's gravity) is worked
    // on with the new ones, and saved as version 3 once it's edited.
    if (isOldScene(data)) {
      data = clone(data);
      upgradeScene(data, getSchema(), (p) => this.rawScene(p));
    }
    this.root = this.fromEntry(data.root, null);
    this.extra = {};
    for (const [k, v] of Object.entries(data)) {
      if (!['format', 'version', 'root'].includes(k)) this.extra[k] = v;
    }
  }

  static fromText(path, text, ctx) {
    const data = JSON.parse(text);
    if (data.format !== 'smitten.scene') throw new Error(`${path} isn't a scene file`);
    if (!data.root) throw new Error(`${path} has no root node`);
    return new SceneDoc(path, data, ctx);
  }

  static empty(path, rootType = 'Group', name = 'Root', ctx) {
    return new SceneDoc(path, { format: 'smitten.scene', version: 3, root: { name, type: rootType } }, ctx);
  }

  // ---------------------------------------------------------------------------
  // Reading

  fromEntry(e, parent) {
    const n = {
      id: `n${nextId++}`,
      name: e.name || e.type || 'Group',
      type: e.type || 'Group',
      props: clone(e.properties || {}),
      script: e.script || null,
      tags: [...(e.tags || [])],
      children: [],
      instance: e.scene || null,
      parent,
    };
    if (n.instance) n.type = this.instanceRootType(n.instance) || 'Group';
    n.children = (e.children || []).map((c) => this.fromEntry(c, n));
    return n;
  }

  /** Another scene's parsed JSON as it's saved, or null. */
  rawScene(path) {
    try {
      return this.ctx.readScene ? this.ctx.readScene(path) : null;
    } catch {
      return null;
    }
  }

  /** Another scene's parsed JSON, in the new rules (see the constructor). */
  instanceData(path) {
    const data = this.rawScene(path);
    if (!data || !isOldScene(data) || !data.root) return data;
    // Converted once for each parsed copy.
    let done = upgraded.get(data);
    if (!done) {
      done = clone(data);
      upgradeScene(done, getSchema(), (p) => this.rawScene(p));
      upgraded.set(data, done);
    }
    return done;
  }

  instanceRootType(path, seen = new Set()) {
    if (seen.has(path)) return null;
    seen.add(path);
    const data = this.instanceData(path);
    if (!data?.root) return null;
    if (data.root.scene) return this.instanceRootType(data.root.scene, seen);
    return data.root.type || 'Group';
  }

  /**
   * The value of a property in effect: a preview's (setPreview), else own,
   * else the instanced scene's, else the default.
   */
  get(node, key) {
    const preview = this.preview;
    if (preview) {
      const o = preview.nodes.get(node) || (node.readonly && preview.paths.size ? preview.paths.get(this.pathOf(node)) : null);
      if (o && key in o) return o[key];
    }
    if (Object.prototype.hasOwnProperty.call(node.props, key)) {
      const v = node.props[key];
      return v === null ? defaultOf(node.type, key) : v;
    }
    if (node.instance) {
      const base = this.instanceBaseProps(node.instance);
      if (base && key in base) return base[key];
    }
    return defaultOf(node.type, key);
  }

  /** All properties in effect, defaults included. */
  allProps(node) {
    const out = {};
    for (const { name } of properties(node.type)) out[name] = this.get(node, name);
    return out;
  }

  instanceBaseProps(path, seen = new Set()) {
    if (seen.has(path)) return {};
    seen.add(path);
    const data = this.instanceData(path);
    if (!data?.root) return {};
    const own = data.root.properties || {};
    if (data.root.scene) return { ...this.instanceBaseProps(data.root.scene, seen), ...own };
    return { ...own };
  }

  /** The script in effect: own, else the instanced scene's root's. */
  scriptOf(node) {
    if (node.script) return node.script;
    if (node.instance) return this.instanceData(node.instance)?.root?.script || null;
    return null;
  }

  /**
   * The read-only nodes an instance brings with it (its scene's children), as
   * nodes like this document's, marked readonly. Nested instances are
   * resolved too. Fresh objects each call.
   */
  instanceChildren(node, seen = new Set([this.path])) {
    if (!node.instance || seen.has(node.instance)) return [];
    const data = this.instanceData(node.instance);
    if (!data?.root) return [];
    const next = new Set(seen).add(node.instance);
    const build = (e, parent) => {
      const n = this.fromEntry({ ...e, children: [] }, parent);
      n.readonly = true;
      n.children = (e.children || []).map((c) => build(c, n));
      if (n.instance) n.children = [...this.instanceChildren(n, next), ...n.children];
      return n;
    };
    const kids = (data.root.children || []).map((c) => build(c, node));
    if (data.root.scene) {
      const inner = { ...node, instance: data.root.scene };
      return [...this.instanceChildren(inner, next), ...kids];
    }
    return kids;
  }

  /** Children to show and draw: an instance's own, then the ones added here. */
  effectiveChildren(node) {
    return node.instance ? [...this.instanceChildren(node), ...node.children] : node.children;
  }

  walk(fn, node = this.root, depth = 0) {
    if (fn(node, depth) === false) return;
    for (const c of node.children) this.walk(fn, c, depth + 1);
  }

  byId(id) {
    let found = null;
    this.walk((n) => {
      if (n.id === id) {
        found = n;
        return false;
      }
    });
    return found;
  }

  pathOf(node) {
    const parts = [];
    for (let n = node; n && n !== this.root; n = n.parent) parts.unshift(n.name);
    return parts.join('/');
  }

  /** Every .scene file this scene places, directly. */
  instancedScenes() {
    const out = new Set();
    this.walk((n) => { if (n.instance) out.add(n.instance); });
    return [...out];
  }

  // ---------------------------------------------------------------------------
  // Writing

  toJSON() {
    const ser = (n) => {
      const e = { name: n.name };
      if (n.instance) e.scene = n.instance;
      else e.type = n.type;
      if (n.script) e.script = n.script;
      const props = {};
      for (const [k, v] of Object.entries(n.props)) {
        if (n.instance || !equal(v, defaultOf(n.type, k))) props[k] = v;
      }
      if (Object.keys(props).length) e.properties = props;
      if (n.tags.length) e.tags = [...n.tags];
      if (n.children.length) e.children = n.children.map(ser);
      return e;
    };
    return { format: 'smitten.scene', version: 3, ...this.extra, root: ser(this.root) };
  }

  toText() {
    return JSON.stringify(this.toJSON(), null, 2) + '\n';
  }

  // ---------------------------------------------------------------------------
  // Edits (all undoable)

  emit(kind, detail = {}) {
    this.dirty = true;
    this.dispatchEvent(new CustomEvent('change', { detail: { kind, ...detail } }));
  }

  /** Runs an edit: {label, redo(), undo(), merge?}. */
  apply(cmd) {
    cmd.redo();
    const last = this.undoStack[this.undoStack.length - 1];
    if (cmd.merge && last?.merge === cmd.merge && Date.now() - last.time < 1500) {
      last.redo = cmd.redo;
      last.time = Date.now();
    } else {
      cmd.time = Date.now();
      this.undoStack.push(cmd);
      if (this.undoStack.length > 300) this.undoStack.shift();
    }
    this.redoStack = [];
    this.emit(cmd.kind || 'edit', { label: cmd.label, node: cmd.node });
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emit('undo', { label: cmd.label });
    return true;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.redo();
    this.undoStack.push(cmd);
    this.emit('redo', { label: cmd.label });
    return true;
  }

  /**
   * Shows other values for some properties without changing the scene: the
   * Animate panel's preview of an animation at a time. preview: { nodes:
   * Map(node -> {key: value}), paths: Map(path -> {key: value}) } (paths for
   * pieces of placed scenes), or null to show the scene as it is. get()
   * gives these values; saving, undo and dirty don't see them. Listeners
   * hear a 'preview' event.
   */
  setPreview(preview) {
    if (!preview && !this.preview) return;
    this.preview = preview && (preview.nodes.size || preview.paths.size) ? preview : null;
    this.dispatchEvent(new CustomEvent('preview'));
  }

  /** Sets properties of one node; values equal to the default are removed. */
  setProps(node, values, { merge = null, label = 'Change property' } = {}) {
    // While the Animate panel records, it turns what it can into keys.
    if (this.recorder) {
      const rest = this.recorder([[node, values]], { merge, label });
      if (!rest.length) return;
      values = rest[0][1];
    }
    const before = {};
    for (const k of Object.keys(values)) before[k] = k in node.props ? clone(node.props[k]) : undefined;
    const set = (vals) => {
      for (const [k, v] of Object.entries(vals)) {
        if (v === undefined) delete node.props[k];
        else node.props[k] = clone(v);
      }
    };
    const after = {};
    for (const [k, v] of Object.entries(values)) {
      after[k] = !node.instance && equal(v, defaultOf(node.type, k)) ? undefined : v;
    }
    this.apply({ label, node, merge: merge && `${merge}:${node.id}`, kind: 'props', redo: () => set(after), undo: () => set(before) });
  }

  setProp(node, key, value, opts) {
    this.setProps(node, { [key]: value }, opts);
  }

  /** Puts a property back to its default (or the instanced scene's value). */
  resetProp(node, key) {
    if (!(key in node.props)) return;
    const before = clone(node.props[key]);
    this.apply({ label: 'Reset property', node, kind: 'props', redo: () => { delete node.props[key]; }, undo: () => { node.props[key] = before; } });
  }

  uniqueName(parent, name, except = null) {
    const taken = new Set(this.effectiveChildren(parent).filter((c) => c !== except).map((c) => c.name));
    if (!taken.has(name)) return name;
    const base = name.replace(/\d+$/, '');
    for (let i = 2; ; i++) if (!taken.has(base + i)) return base + i;
  }

  createNode(type, props = {}, name = type) {
    return { id: `n${nextId++}`, name, type, props: clone(props), script: null, tags: [], children: [], instance: null, parent: null };
  }

  createInstance(path) {
    const type = this.instanceRootType(path) || 'Group';
    const name = path.split('/').pop().replace(/\.scene$/, '').replace(/^\w/, (c) => c.toUpperCase());
    return { id: `n${nextId++}`, name, type, props: {}, script: null, tags: [], children: [], instance: path, parent: null };
  }

  /** Adds a node (and its subtree) under parent at index (default: last). */
  add(parent, node, index = parent.children.length, label = `Add ${node.name}`) {
    if (node.instance && this.wouldLoop(node.instance)) {
      throw new Error(`${node.instance} contains this scene, so it can't be placed inside it`);
    }
    node.name = this.uniqueName(parent, node.name);
    this.apply({
      label, node, kind: 'tree',
      redo: () => {
        node.parent = parent;
        parent.children.splice(Math.min(index, parent.children.length), 0, node);
      },
      undo: () => {
        parent.children.splice(parent.children.indexOf(node), 1);
        node.parent = null;
        this.selection.delete(node.id);
      },
    });
    return node;
  }

  remove(nodes, label) {
    nodes = nodes.filter((n) => n !== this.root && !n.readonly && !nodes.some((m) => m !== n && this.contains(m, n)));
    if (!nodes.length) return;
    const places = nodes.map((n) => ({ n, parent: n.parent, index: n.parent.children.indexOf(n) }));
    this.apply({
      label: label || (nodes.length === 1 ? `Delete ${nodes[0].name}` : `Delete ${nodes.length} nodes`), kind: 'tree',
      redo: () => {
        for (const p of places) {
          p.parent.children.splice(p.parent.children.indexOf(p.n), 1);
          this.selection.delete(p.n.id);
        }
      },
      undo: () => {
        for (const p of [...places].reverse()) p.parent.children.splice(p.index, 0, p.n);
      },
    });
  }

  contains(ancestor, node) {
    for (let n = node.parent; n; n = n.parent) if (n === ancestor) return true;
    return false;
  }

  move(node, newParent, index) {
    if (node === this.root || node === newParent || this.contains(node, newParent) || node.readonly) return false;
    const oldParent = node.parent;
    const oldIndex = oldParent.children.indexOf(node);
    if (oldParent === newParent && oldIndex < index) index--;
    const oldName = node.name;
    const newName = oldParent === newParent ? node.name : this.uniqueName(newParent, node.name, node);
    this.apply({
      label: `Move ${node.name}`, node, kind: 'tree',
      redo: () => {
        oldParent.children.splice(oldParent.children.indexOf(node), 1);
        newParent.children.splice(Math.min(index, newParent.children.length), 0, node);
        node.parent = newParent;
        node.name = newName;
      },
      undo: () => {
        newParent.children.splice(newParent.children.indexOf(node), 1);
        oldParent.children.splice(oldIndex, 0, node);
        node.parent = oldParent;
        node.name = oldName;
      },
    });
    return true;
  }

  rename(node, name) {
    name = name.trim().replace(/\//g, '-');
    if (!name || name === node.name) return;
    const old = node.name;
    const next = node.parent ? this.uniqueName(node.parent, name, node) : name;
    this.apply({ label: 'Rename', node, kind: 'tree', redo: () => { node.name = next; }, undo: () => { node.name = old; } });
  }

  setScript(node, path) {
    const old = node.script;
    this.apply({ label: path ? 'Attach script' : 'Detach script', node, kind: 'props', redo: () => { node.script = path; }, undo: () => { node.script = old; } });
  }

  setTags(node, tags) {
    const old = [...node.tags];
    this.apply({ label: 'Change tags', node, kind: 'props', redo: () => { node.tags = [...tags]; }, undo: () => { node.tags = old; } });
  }

  /** Changes a node's type, keeping the properties the new type also has. */
  changeType(node, type) {
    if (node.instance || node.type === type || !typeDef(type)) return;
    const oldType = node.type;
    const oldProps = clone(node.props);
    const kept = {};
    const names = new Set(properties(type).map((p) => p.name));
    for (const [k, v] of Object.entries(node.props)) if (names.has(k)) kept[k] = v;
    this.apply({
      label: `Change type to ${type}`, node, kind: 'tree',
      redo: () => { node.type = type; node.props = clone(kept); },
      undo: () => { node.type = oldType; node.props = clone(oldProps); },
    });
  }

  /** A deep copy of a node with fresh ids (for duplicate, copy and paste). */
  copyNode(node, parent = null) {
    const c = { ...node, id: `n${nextId++}`, props: clone(node.props), tags: [...node.tags], parent, readonly: false };
    c.children = node.children.map((k) => this.copyNode(k, c));
    return c;
  }

  duplicate(nodes) {
    const out = [];
    for (const n of nodes) {
      if (n === this.root || n.readonly) continue;
      const c = this.copyNode(n);
      this.add(n.parent, c, n.parent.children.indexOf(n) + 1, `Duplicate ${n.name}`);
      out.push(c);
    }
    return out;
  }

  /** Whether placing a scene here would put this scene inside itself. */
  wouldLoop(path, seen = new Set()) {
    if (path === this.path) return true;
    if (seen.has(path)) return false;
    seen.add(path);
    const data = this.instanceData(path);
    if (!data?.root) return false;
    const check = (e) => (e.scene && this.wouldLoop(e.scene, seen)) || (e.children || []).some(check);
    return check(data.root);
  }

  // ---------------------------------------------------------------------------
  // Selection

  select(nodes, { add = false } = {}) {
    if (!add) this.selection.clear();
    for (const n of nodes) if (n) this.selection.add(n.id);
    this.dispatchEvent(new CustomEvent('select'));
  }

  toggleSelect(node) {
    if (this.selection.has(node.id)) this.selection.delete(node.id);
    else this.selection.add(node.id);
    this.dispatchEvent(new CustomEvent('select'));
  }

  selected() {
    const out = [];
    this.walk((n) => { if (this.selection.has(n.id)) out.push(n); });
    return out;
  }

}
