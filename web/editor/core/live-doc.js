// The running game's pieces, for live tweaking (DESIGN.md, section 8). It
// stands in for a SceneDoc in the Scene panel and the Inspector while a game
// runs: they show the live pieces and their current values, and edits go to
// the game (love/src/modules/engine/live.lua), never to the scene's file. When
// the game stops, the editor goes back to the scene as it was saved.

import { defaultOf } from './schema.js';

export class LiveDoc extends EventTarget {
  /** send(message): delivers a message to the running game. */
  constructor(send) {
    super();
    this.send = send;
    this.live = true;
    this.root = null;
    this.path = null;
    this.selection = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.nodes = new Map(); // live id -> node
    this.timers = [
      setInterval(() => this.send({ op: 'tree' }), 1000),
      setInterval(() => this.refresh(), 250),
    ];
    this.send({ op: 'tree' });
  }

  dispose() {
    for (const t of this.timers) clearInterval(t);
  }

  refresh() {
    const ids = this.selected().map((n) => n.liveId);
    if (ids.length) this.send({ op: 'get', ids });
  }

  /** An answer from the game. */
  receive(msg) {
    if (msg.op === 'tree') {
      this.path = msg.path || null;
      const old = this.nodes;
      this.nodes = new Map();
      const build = (t, parent) => {
        const prev = old.get(t.id);
        const n = {
          id: `live${t.id}`, liveId: t.id, name: t.name, type: t.type, script: t.script || null, parent,
          props: {}, values: prev?.values || { motion: t.motion }, tags: [], children: [], instance: null, live: true,
        };
        this.nodes.set(t.id, n);
        n.children = (t.children || []).map((c) => build(c, n));
        return n;
      };
      const before = this.signature;
      this.root = msg.root ? build(msg.root, null) : null;
      this.signature = JSON.stringify(msg.root);
      for (const id of [...this.selection]) if (!this.byId(id)) this.selection.delete(id);
      if (this.signature !== before) this.emit('tree');
    } else if (msg.op === 'props') {
      for (const [id, values] of Object.entries(msg.values || {})) {
        const n = this.nodes.get(Number(id));
        if (n) n.values = values;
      }
      this.emit('live');
    }
  }

  emit(kind) {
    this.dispatchEvent(new CustomEvent('change', { detail: { kind } }));
  }

  // The SceneDoc interface the panels use -------------------------------------

  get(node, key) {
    const v = node.values?.[key];
    return v === undefined ? defaultOf(node.type, key) : v;
  }

  scriptOf(node) {
    return node.script;
  }

  effectiveChildren(node) {
    return node.children;
  }

  walk(fn, node = this.root, depth = 0) {
    if (!node || fn(node, depth) === false) return;
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

  select(nodes, { add = false } = {}) {
    if (!add) this.selection.clear();
    for (const n of nodes) if (n) this.selection.add(n.id);
    this.dispatchEvent(new CustomEvent('select'));
    this.refresh();
  }

  toggleSelect(node) {
    if (this.selection.has(node.id)) this.selection.delete(node.id);
    else this.selection.add(node.id);
    this.dispatchEvent(new CustomEvent('select'));
    this.refresh();
  }

  selected() {
    const out = [];
    this.walk((n) => { if (this.selection.has(n.id)) out.push(n); });
    return out;
  }

  /** Changes go straight to the running game. */
  setProps(node, values) {
    for (const [k, v] of Object.entries(values)) {
      const value = v === undefined ? defaultOf(node.type, k) : v;
      node.values[k] = value;
      this.send({ op: 'set', id: node.liveId, key: k, value: value ?? null });
    }
  }

  setProp(node, key, value) {
    this.setProps(node, { [key]: value });
  }

  resetProp(node, key) {
    this.setProps(node, { [key]: defaultOf(node.type, key) });
  }

  remove(nodes) {
    for (const n of nodes) if (n !== this.root) this.send({ op: 'destroy', id: n.liveId });
  }

  // Changes to the scene's structure belong in the scene file, not the live game.
  rename() {}
  setTags() {}
  setScript() {}
  duplicate() { return []; }
  move() { return false; }
  add() { return null; }
  changeType() {}
  undo() { return false; }
  redo() { return false; }
}
