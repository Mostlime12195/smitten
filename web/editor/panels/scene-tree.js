// The Scene panel: the open scene's pieces as a tree. Click to select, F2 or
// double-click to rename, drag to move into another piece or reorder,
// right-click for more. A placed scene shows the pieces it brings (in
// italics, read-only).

import { h, icon, showMenu, modKey } from '../ui.js';
import { nodeIcon } from '../shell/node-icons.js';
import { isA, typeDef } from '../core/schema.js';

export class SceneTreePanel {
  /** actions: { addNode(parent), instanceScene(parent), attachScript(node), openScript(node), openScene(path), saveBranchAsScene(node), copy(), paste(), changeType(node) } */
  constructor(el, actions) {
    this.el = el;
    this.actions = actions;
    this.doc = null;
    this.collapsed = new Set();
    this.openInstances = new Set(); // placed scenes start closed
    this.filter = '';
    // Rows by node id, {el, sig}, kept between renders: a row is only made
    // again when what it shows (its signature) changes.
    this.rows = new Map();

    const add = h('button', { type: 'button', class: 'icon-btn', title: `Add a piece (${modKey}+A)`, 'aria-label': 'Add a piece' }, icon('plus', 16));
    add.addEventListener('click', () => this.doc && actions.addNode(this.targetParent()));
    const inst = h('button', { type: 'button', class: 'icon-btn', title: 'Place a scene in this one', 'aria-label': 'Place a scene' }, icon('link', 15));
    inst.addEventListener('click', () => this.doc && actions.instanceScene(this.targetParent()));
    this.search = h('input', { class: 'input', type: 'search', placeholder: 'Filter pieces', 'aria-label': 'Filter pieces' });
    this.search.addEventListener('input', () => {
      this.filter = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.list = h('div', { class: 'scene-tree', tabindex: '0', role: 'tree', 'aria-label': 'Scene tree' });
    this.liveBanner = h('div', { class: 'live-banner', hidden: true }, icon('live', 14),
      h('span', {}, 'The running game, live. It goes back to the saved scene when you stop.'));
    this.empty = h('div', { class: 'empty' },
      h('h3', {}, 'No scene open'),
      h('p', {}, 'Open a scene from Files, or make one. A scene is a level, a menu or a character, made of pieces.'));
    el.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-toolbar' }, add, inst, this.search),
      this.liveBanner,
      h('div', { class: 'panel-scroll' }, this.list, this.empty)));

    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.node-row')) return;
      e.preventDefault();
      if (this.doc) this.menu(null, { x: e.clientX, y: e.clientY });
    });
    this.onChange = () => this.render();
    this.onSelect = () => this.updateSelection();
  }

  setDoc(doc) {
    if (this.doc) {
      this.doc.removeEventListener('change', this.onChange);
      this.doc.removeEventListener('select', this.onSelect);
    }
    this.doc = doc;
    if (doc) {
      doc.addEventListener('change', this.onChange);
      doc.addEventListener('select', this.onSelect);
    }
    this.rows.clear();
    this.render();
  }

  /** Where Add node puts things: under the selected node (or the root). */
  targetParent() {
    const sel = this.doc.selected();
    const n = sel[sel.length - 1];
    if (!n || n.readonly) return this.doc.root;
    return n;
  }

  render() {
    const doc = this.doc;
    this.liveBanner.hidden = !doc?.live;
    this.empty.hidden = !!doc;
    this.list.hidden = !doc;
    if (!doc) {
      this.list.replaceChildren();
      this.rows.clear();
      return;
    }
    const matches = (n) => !this.filter || n.name.toLowerCase().includes(this.filter) || n.type.toLowerCase().includes(this.filter);
    const anyMatch = (n) => matches(n) || doc.effectiveChildren(n).some(anyMatch);
    const rows = [];
    const kept = new Map();
    const visit = (n, depth) => {
      if (this.filter && !anyMatch(n)) return;
      const kids = doc.effectiveChildren(n);
      const sig = this.signature(n, depth, kids);
      let r = this.rows.get(n.id);
      if (r && r.sig === sig) r.el.node = n;
      else r = { el: this.row(n, depth), sig };
      kept.set(n.id, r);
      rows.push(r.el);
      if (kids.length && (this.filter || this.isOpen(n))) for (const c of kids) visit(c, depth + 1);
    };
    // A live game's tree arrives a moment after it starts.
    if (doc.root) visit(doc.root, 0);
    this.rows = kept;
    // Touch the DOM only if the rows changed.
    const now = this.list.children;
    if (now.length !== rows.length || rows.some((el, i) => now[i] !== el)) this.list.replaceChildren(...rows);
    this.updateSelection();
  }

  /** Everything a row shows but its selection, as a string. */
  signature(n, depth, kids) {
    const doc = this.doc;
    const visible = !n.readonly && (isA(n.type, 'Group') || isA(n.type, 'UI')) ? doc.get(n, 'visible') !== false : null;
    return JSON.stringify([depth, n.name, n.type, n.type === 'Body' ? doc.get(n, 'motion') : null, kids.length > 0, this.isOpen(n),
      doc.scriptOf(n), n.instance, this.warning(n), visible, !!n.readonly, n === doc.root,
      n.readonly ? this.instanceOwner(n)?.instance : null]);
  }

  /** Marks the selected rows (selecting doesn't change anything else). */
  updateSelection() {
    const sel = this.doc?.selection;
    for (const [id, r] of this.rows) {
      const on = !!sel?.has(id);
      if (r.el.classList.contains('selected') !== on) r.el.classList.toggle('selected', on);
    }
  }

  isOpen(n) {
    return n.instance ? this.openInstances.has(n.id) : !this.collapsed.has(n.id);
  }

  setOpen(n, open) {
    const set = n.instance ? this.openInstances : this.collapsed;
    if (open === !!n.instance) set.add(n.id); else set.delete(n.id);
    this.render();
  }

  row(node, depth) {
    const doc = this.doc;
    const kids = doc.effectiveChildren(node);
    const open = this.isOpen(node);
    let row = null;
    const n = node;
    const cur = () => row.node; // the node this row shows now (rows are reused)
    const twisty = h('span', { class: `twisty ${kids.length ? '' : 'leaf'}` }, icon(open ? 'chevronDown' : 'chevronRight', 14));
    twisty.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setOpen(cur(), !open);
    });
    const badges = h('span', { class: 'node-badges' });
    const script = doc.scriptOf(n);
    if (script) {
      const b = h('button', { type: 'button', class: 'node-badge', title: `Script: ${script} (click to open)` }, icon('code', 14));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.actions.openScript(cur()); });
      badges.append(b);
    }
    if (n.instance) {
      const b = h('button', { type: 'button', class: 'node-badge', title: `Uses ${n.instance} (click to open it)` }, icon('link', 13));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.actions.openScene(cur().instance); });
      badges.append(b);
    }
    const warn = this.warning(n);
    if (warn) badges.append(h('span', { class: 'node-badge', title: warn, style: 'color: var(--warning)' }, icon('alert', 14)));
    if (!n.readonly && (isA(n.type, 'Group') || isA(n.type, 'UI'))) {
      const visible = doc.get(n, 'visible') !== false;
      const b = h('button', { type: 'button', class: `node-badge ${visible ? '' : 'off'}`, title: visible ? 'Hide' : 'Show' }, icon(visible ? 'eye' : 'eyeOff', 14));
      b.addEventListener('click', (e) => { e.stopPropagation(); doc.setProp(cur(), 'visible', !visible, { label: visible ? 'Hide' : 'Show' }); });
      badges.append(b);
    }
    row = h('div', {
      class: `node-row ${doc.selection.has(n.id) ? 'selected' : ''} ${n.readonly ? 'readonly' : ''}`,
      role: 'treeitem', 'data-id': n.id, draggable: n.readonly || n === doc.root ? 'false' : 'true',
      style: `padding-left: ${4 + depth * 16}px`, title: n.readonly ? `Part of ${this.instanceOwner(n)?.instance || 'an instance'}` : typeDef(n.type)?.description || '',
    }, twisty, nodeIcon(n.type, 16, n.type === 'Body' ? doc.get(n, 'motion') : null), h('span', { class: 'node-name' }, n.name), badges);
    row.node = node;
    row.addEventListener('click', (e) => this.click(cur(), e));
    row.addEventListener('dblclick', () => !n.readonly && this.rename(cur()));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!doc.selection.has(n.id)) doc.select([cur()]);
      this.menu(cur(), { x: e.clientX, y: e.clientY });
    });
    this.dragAndDrop(row);
    return row;
  }

  instanceOwner(n) {
    let p = n.parent;
    while (p && p.readonly) p = p.parent;
    return p;
  }

  /** Common mistakes, explained. */
  warning(n) {
    const doc = this.doc;
    const kids = doc.effectiveChildren(n);
    if (n.type === 'Body' || n.type === 'Zone') {
      const shape = doc.get(n, 'shape');
      const hasHitbox = kids.some((c) => c.type === 'Hitbox');
      const hasVisual = kids.some((c) => c.type === 'Sprite' || c.type === 'Shape');
      if ((shape === 'auto' && !hasVisual && !hasHitbox) || (shape === 'none' && !hasHitbox)) {
        return `It has no shape yet, so nothing touches it: put a Sprite or Shape inside it, or set its shape to rectangle or circle.`;
      }
    }
    const def = typeDef(n.type);
    if (def?.parent && n.parent && !def.parent.some((t) => isA(n.parent.type, t))) {
      return `A ${n.type} goes inside a ${def.parent.join(' or ')}.`;
    }
    return null;
  }

  click(n, e) {
    const doc = this.doc;
    if (n.readonly) n = this.instanceOwner(n) || n;
    if (e.shiftKey && this.anchor) {
      const ids = [...this.list.querySelectorAll('.node-row')].map((r) => r.dataset.id);
      const a = ids.indexOf(this.anchor);
      const b = ids.indexOf(n.id);
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1).map((id) => doc.byId(id)).filter(Boolean);
      doc.select(range);
    } else if (e.ctrlKey || e.metaKey) {
      doc.toggleSelect(n);
      this.anchor = n.id;
    } else {
      doc.select([n]);
      this.anchor = n.id;
    }
    this.list.focus({ preventScroll: true });
  }

  rename(n) {
    const row = this.list.querySelector(`.node-row[data-id="${n.id}"]`);
    if (!row) return;
    this.rows.delete(n.id); // the row gets an input: make it again next time
    const label = row.querySelector('.node-name');
    const input = h('input', { class: 'rename', value: n.name, spellcheck: 'false', 'aria-label': 'Name' });
    label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) this.doc.rename(n, input.value);
      else this.render();
      this.list.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  renameSelected() {
    const n = this.doc?.selected()[0];
    if (n && !n.readonly) this.rename(n);
  }

  onKey(e) {
    const doc = this.doc;
    if (!doc) return;
    const sel = doc.selected();
    const rows = [...this.list.querySelectorAll('.node-row')];
    const i = rows.findIndex((r) => r.dataset.id === sel[sel.length - 1]?.id);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      const n = next && doc.byId(next.dataset.id);
      if (n) doc.select([n]);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const n = sel[0];
      if (!n) return;
      e.preventDefault();
      this.setOpen(n, e.key === 'ArrowRight');
    } else if (e.key === 'F2') {
      e.preventDefault();
      this.renameSelected();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      doc.remove(sel);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      doc.select(doc.duplicate(sel));
    }
  }

  menu(n, at) {
    const doc = this.doc;
    const a = this.actions;
    const items = [];
    const parent = n && !n.readonly ? n : doc.root;
    items.push({ label: 'Add a piece…', icon: 'plus', shortcut: `${modKey}+A`, action: () => a.addNode(parent) });
    items.push({ label: 'Place a scene…', icon: 'link', action: () => a.instanceScene(parent) });
    if (n && !n.readonly) {
      items.push('-');
      items.push({ label: 'Rename', icon: 'pencil', shortcut: 'F2', action: () => this.rename(n) });
      if (n !== doc.root) items.push({ label: 'Duplicate', icon: 'copy', shortcut: `${modKey}+D`, action: () => doc.select(doc.duplicate(doc.selected())) });
      items.push({ label: 'Copy', shortcut: `${modKey}+C`, action: () => a.copy() });
      items.push({ label: 'Paste inside', shortcut: `${modKey}+V`, action: () => a.paste(n) });
      items.push('-');
      const script = doc.scriptOf(n);
      items.push(script
        ? { label: 'Open script', icon: 'code', action: () => a.openScript(n) }
        : { label: 'Attach a script…', icon: 'code', action: () => a.attachScript(n) });
      if (n.script) items.push({ label: 'Detach script', action: () => doc.setScript(n, null) });
      if (!n.instance) items.push({ label: 'Change type…', action: () => a.changeType(n) });
      if (n !== doc.root && !n.instance) items.push({ label: 'Save as its own scene…', icon: 'save', action: () => a.saveBranchAsScene(n) });
      if (n.instance) items.push({ label: `Open ${n.instance.split('/').pop()}`, icon: 'link', action: () => a.openScene(n.instance) });
      if (n !== doc.root) {
        items.push('-');
        items.push({ label: 'Delete', icon: 'trash', shortcut: 'Delete', danger: true, action: () => doc.remove(doc.selected()) });
      }
    }
    showMenu(at, items);
  }

  dragAndDrop(row) {
    const doc = this.doc;
    row.addEventListener('dragstart', (e) => {
      const n = row.node;
      if (!doc.selection.has(n.id)) doc.select([n]);
      e.dataTransfer.setData('application/x-smitten-node', n.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    const zone = (e) => {
      const n = row.node;
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      if (n === doc.root) return 'inside';
      return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    };
    row.addEventListener('dragover', (e) => {
      const n = row.node;
      const types = e.dataTransfer.types;
      if (!types.includes('application/x-smitten-node') && !types.includes('application/x-smitten-path')) return;
      if (n.readonly) return;
      e.preventDefault();
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      row.classList.add(`drop-${types.includes('application/x-smitten-path') ? 'inside' : zone(e)}`);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    row.addEventListener('drop', (e) => {
      const n = row.node;
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      if (n.readonly) return;
      const path = e.dataTransfer.getData('application/x-smitten-path');
      if (path) {
        e.preventDefault();
        this.actions.dropFile?.(path, n);
        return;
      }
      const id = e.dataTransfer.getData('application/x-smitten-node');
      if (!id) return;
      e.preventDefault();
      const z = zone(e);
      const moving = doc.selected().filter((m) => m !== doc.root && !m.readonly);
      for (const m of moving) {
        if (z === 'inside') doc.move(m, n, n.children.length);
        else doc.move(m, n.parent, n.parent.children.indexOf(n) + (z === 'after' ? 1 : 0));
      }
    });
  }
}
