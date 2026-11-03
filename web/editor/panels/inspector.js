// The Inspector: the selected node's properties, grouped by section, with an
// editor for each kind of value (numbers you can drag, colors, asset pickers,
// dropdowns), a reset arrow on changed values, the node's script and its
// script variables, and its groups. Every edit goes through the SceneDoc, so
// it can be undone.

import { h, icon, showMenu } from '../ui.js';
import { nodeIcon } from '../shell/node-icons.js';
import { properties, typeDef, isShown, moduleOf, equal } from '../core/schema.js';
import { scriptVariables } from '../core/script-vars.js';

const RESOURCE_EXT = {
  image: /\.(png|jpe?g|bmp|tga)$/i,
  sprite: /\.sprite$/i,
  tileset: /\.tileset$/i,
  font: /\.(ttf|otf)$/i,
  audio: /\.(wav|ogg|mp3|flac|sfx|song)$/i,
  model: /\.(glb|gltf)$/i,
  scene: /\.scene$/i,
};

const MODULE_NAMES = { physics2d: '2D physics', '3d': '3D', physics3d: '3D physics', video: 'video', synth: 'sound generator' };

export class InspectorPanel {
  /** ctx: { project, inputActions(), openScript(node), attachScript(node), openScene(path), openDocs(type) } */
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx;
    this.doc = null;
    this.collapsedSections = new Set(JSON.parse(localStorage.getItem('smitten-editor.inspector-collapsed') || '[]'));
    this.body = h('div', { class: 'panel-scroll inspector' });
    el.append(h('div', { class: 'panel' }, this.body));
    this.onSelect = () => this.render();
    this.onChange = (e) => {
      // Re-render unless the change came from this panel's own input.
      if (this.editing) return;
      this.render();
    };
    ctx.project?.addEventListener?.('file', (e) => {
      if (/\.(lua|sprite)$/.test(e.detail.path)) this.render();
    });
  }

  setDoc(doc) {
    if (this.doc) {
      this.doc.removeEventListener('select', this.onSelect);
      this.doc.removeEventListener('change', this.onChange);
    }
    this.doc = doc;
    if (doc) {
      doc.addEventListener('select', this.onSelect);
      doc.addEventListener('change', this.onChange);
    }
    this.render();
  }

  render() {
    const doc = this.doc;
    const scroll = this.body.scrollTop;
    this.body.replaceChildren();
    if (!doc) {
      this.body.append(h('div', { class: 'empty' }, h('h3', {}, 'Nothing selected'), h('p', {}, 'Open a scene and select a node to see and change its properties here.')));
      return;
    }
    const sel = doc.selected();
    if (!sel.length) {
      this.body.append(h('div', { class: 'empty' },
        h('h3', {}, 'Select a node'),
        h('p', {}, 'Click a node in the Scene panel or the view to change its properties.')));
      return;
    }
    if (sel.length > 1) {
      this.body.append(h('div', { class: 'empty' },
        h('h3', {}, `${sel.length} nodes selected`),
        h('p', {}, 'Move, duplicate or delete them together. Select one to change its properties.')));
      return;
    }
    const node = sel[0];
    this.body.append(this.header(node));
    if (node.readonly) {
      this.body.append(h('p', { class: 'insp-hint' }, 'This node comes from the scene the instance uses. Open that scene to change it.'));
    }
    this.body.append(...this.sections(node));
    this.body.scrollTop = scroll;
  }

  header(node) {
    const doc = this.doc;
    const def = typeDef(node.type) || {};
    const name = h('input', { class: 'input name-input', value: node.name, spellcheck: 'false', 'aria-label': 'Node name', disabled: node.readonly });
    name.addEventListener('change', () => doc.rename(node, name.value));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); });
    const help = h('a', { title: `What a ${node.type} can do` }, 'Docs');
    help.addEventListener('click', () => this.ctx.openDocs?.(node.type));
    const parts = [
      h('div', { class: 'insp-title' }, nodeIcon(node.type, 18), name),
      h('div', { class: 'insp-type' }, node.type, h('span', {}, '·'), help),
      h('p', { class: 'insp-desc' }, def.description || ''),
    ];
    const mod = moduleOf(node.type);
    if (mod) parts.push(h('p', { class: 'insp-desc' }, `Uses the ${MODULE_NAMES[mod] || mod} module, which is added to the game automatically.`));
    if (node.instance) {
      const open = h('button', { type: 'button', class: 'btn small' }, 'Open');
      open.addEventListener('click', () => this.ctx.openScene(node.instance));
      parts.push(h('div', { class: 'insp-type' }, icon('link', 13), `Uses ${node.instance}`, open));
    }
    return h('div', { class: 'insp-head' }, ...parts);
  }

  section(id, title, rows) {
    const d = h('details', { class: 'insp-section', open: !this.collapsedSections.has(id) },
      h('summary', {}, h('span', { class: 'chev' }, icon('chevronRight', 12)), title),
      h('div', { class: 'insp-rows' }, ...rows));
    d.addEventListener('toggle', () => {
      if (d.open) this.collapsedSections.delete(id); else this.collapsedSections.add(id);
      localStorage.setItem('smitten-editor.inspector-collapsed', JSON.stringify([...this.collapsedSections]));
    });
    return d;
  }

  sections(node) {
    const doc = this.doc;
    const out = [];
    const groups = new Map();
    const get = (k) => doc.get(node, k);
    for (const p of properties(node.type)) {
      if (!isShown(p.def, get)) continue;
      const g = p.def.group || p.owner;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    for (const [g, props] of groups) {
      out.push(this.section(`${node.type}:${g}`, g, props.flatMap((p) => this.row(node, p.name, p.def))));
    }

    // Script and its variables.
    const script = doc.scriptOf(node);
    const scriptRow = h('div', { class: 'insp-script-row' });
    if (script) {
      const open = h('button', { type: 'button', class: 'btn small' }, 'Open');
      open.addEventListener('click', () => this.ctx.openScript(node));
      scriptRow.append(icon('code', 14), h('span', { class: 'script-path', title: script }, script), open);
      if (node.script && !node.readonly) {
        const detach = h('button', { type: 'button', class: 'icon-btn', title: 'Detach the script', 'aria-label': 'Detach the script' }, icon('x', 14));
        detach.addEventListener('click', () => doc.setScript(node, null));
        scriptRow.append(detach);
      }
    } else if (!node.readonly) {
      const attach = h('button', { type: 'button', class: 'btn small' }, icon('plus', 14), 'Attach a script');
      attach.addEventListener('click', () => this.ctx.attachScript(node));
      scriptRow.append(h('span', { class: 'script-path', style: 'color: var(--fg-muted)' }, 'No script'), attach);
    }
    const scriptSection = h('details', { class: 'insp-section', open: true },
      h('summary', {}, h('span', { class: 'chev' }, icon('chevronRight', 12)), 'Script'), scriptRow);
    out.push(scriptSection);
    if (script) {
      const vars = scriptVariables(this.ctx.project.readText(script));
      if (vars.length) {
        out.push(this.section(`script:${script}`, 'Script variables', vars.flatMap((v) => {
          const def = { type: v.type, default: v.value, description: v.description || `Set in ${script}; change it here for this node only.` };
          return this.row(node, v.name, def, v.value);
        })));
      } else {
        scriptSection.append(h('p', { class: 'insp-hint' }, 'Tip: fields like `Player.speed = 140` at the top of the script appear here, so each node can use its own value.'));
      }
    }

    // Groups.
    if (!node.readonly) {
      const chips = h('div', { class: 'groups-input' });
      for (const g of node.groups) {
        const x = h('button', { type: 'button', title: `Remove from ${g}`, 'aria-label': `Remove from ${g}` }, '×');
        x.addEventListener('click', () => doc.setGroups(node, node.groups.filter((k) => k !== g)));
        chips.append(h('span', { class: 'group-chip' }, g, x));
      }
      const input = h('input', { class: 'input', placeholder: 'Add a group (enemies, coins…)', style: 'flex: 1; min-width: 120px; height: 24px' });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && input.value.trim()) {
          const g = input.value.trim();
          if (!node.groups.includes(g)) doc.setGroups(node, [...node.groups, g]);
        }
      });
      chips.append(input);
      out.push(this.section('groups', 'Groups', [h('div', { style: 'grid-column: 1 / -1' }, chips,
        h('p', { class: 'insp-desc', style: 'margin-top: 6px' }, 'Scripts find nodes by group: smitten.scene.group("enemies"), other:inGroup("coins").'))]));
    }
    return out;
  }

  /** A label + editor pair for one property. scriptDefault is set for script variables. */
  row(node, key, def, scriptDefault) {
    const doc = this.doc;
    const own = Object.prototype.hasOwnProperty.call(node.props, key);
    const value = scriptDefault !== undefined ? (own ? node.props[key] : scriptDefault) : doc.get(node, key);
    const changed = own && (scriptDefault === undefined || !equal(node.props[key], scriptDefault));
    const label = h('label', { class: `insp-label ${changed ? 'changed' : ''}`, title: def.description || '' }, h('span', {}, prettyName(key)));
    if (changed && !node.readonly) {
      const reset = h('button', { type: 'button', class: 'insp-reset', title: 'Reset to the default', 'aria-label': `Reset ${key}` }, icon('restart', 12));
      reset.addEventListener('click', () => doc.resetProp(node, key));
      label.append(reset);
    }
    const set = (v, opts = {}) => {
      this.editing = !!opts.live;
      if (scriptDefault !== undefined) {
        // Script variables aren't in the schema, so keep them even when equal to the default.
        doc.setProps(node, { [key]: equal(v, scriptDefault) ? undefined : v }, { merge: opts.live ? `edit:${key}` : null, label: `Change ${key}` });
      } else {
        doc.setProps(node, { [key]: v }, { merge: opts.live ? `edit:${key}` : null, label: `Change ${key}` });
      }
      this.editing = false;
      if (!opts.live) this.render();
    };
    const editor = this.editor(node, key, def, value, set);
    if (node.readonly) editor.querySelectorAll('input, select, textarea, button').forEach((e) => { e.disabled = true; });
    return [label, h('div', { class: 'insp-value' }, editor)];
  }

  editor(node, key, def, value, set) {
    switch (def.type) {
      case 'number': case 'int': return numberEditor(value, def, set);
      case 'angle': return numberEditor(value, { ...def, unit: '°', step: 1 }, set, (v) => v * 180 / Math.PI, (v) => v * Math.PI / 180);
      case 'bool': {
        const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!value), 'aria-label': key });
        sw.addEventListener('click', () => set(!value));
        return sw;
      }
      case 'string': case 'text': case 'points': {
        const multiline = def.type === 'text' && String(value ?? '').length > 30;
        const isPoints = def.type === 'points';
        const shown = isPoints ? (value || []).join(', ') : String(value ?? '');
        const el = multiline ? h('textarea', { class: 'input', rows: 3 }, shown) : h('input', { class: 'input', value: shown, spellcheck: 'false' });
        el.addEventListener('change', () => {
          if (isPoints) set(el.value.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)));
          else set(el.value);
        });
        el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !multiline) el.blur(); });
        return el;
      }
      case 'enum': case 'action': case 'animation': case 'nodepath': {
        let options = def.options || [];
        if (def.type === 'action') options = this.ctx.inputActions();
        if (def.type === 'animation') options = ['', ...this.animationsOf(node)];
        if (def.type === 'nodepath') options = ['', ...this.nodePaths(node)];
        if (value && !options.includes(value)) options = [...options, value];
        const sel = h('select', { class: 'input' }, ...options.map((o) => h('option', { value: o, selected: o === value }, o === '' ? (def.type === 'nodepath' ? '(automatic)' : '(none)') : prettyOption(o))));
        sel.addEventListener('change', () => set(sel.value));
        return sel;
      }
      case 'color': return colorEditor(value || [1, 1, 1, 1], set);
      case 'layers': {
        const wrap = h('div', { class: 'layers-input', role: 'group', 'aria-label': key });
        for (let i = 0; i < 8; i++) {
          const bit = 1 << i;
          const on = ((value || 0) & bit) !== 0;
          const b = h('button', { type: 'button', 'aria-pressed': String(on), title: `Layer ${i + 1}` }, String(i + 1));
          b.addEventListener('click', () => set((value || 0) ^ bit));
          wrap.append(b);
        }
        return wrap;
      }
      case 'resource': return this.resourceEditor(def, value, set);
      default: return h('span', { class: 'insp-desc' }, JSON.stringify(value));
    }
  }

  resourceEditor(def, value, set) {
    const kinds = def.kinds || [];
    const files = this.ctx.project.paths().filter((p) => kinds.some((k) => RESOURCE_EXT[k]?.test(p)));
    const extra = kinds.includes('font') ? ['pixel'] : [];
    const options = ['', ...extra, ...files];
    if (value && !options.includes(value)) options.push(value);
    const sel = h('select', { class: 'input', title: 'Pick a file, or drag one here from Files' },
      ...options.map((o) => h('option', { value: o, selected: o === (value || '') }, o === '' ? '(none)' : o === 'pixel' ? 'Pixel font (built in)' : o)));
    sel.addEventListener('change', () => set(sel.value));
    sel.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-smitten-path')) e.preventDefault(); });
    sel.addEventListener('drop', (e) => {
      const p = e.dataTransfer.getData('application/x-smitten-path');
      if (!p) return;
      e.preventDefault();
      if (kinds.some((k) => RESOURCE_EXT[k]?.test(p))) set(p);
    });
    if (!files.length && !extra.length) {
      return h('div', { style: 'display: flex; flex-direction: column; gap: 2px; width: 100%' }, sel,
        h('span', { class: 'num-unit' }, `No ${kinds.join(' or ')} files yet: drop one into Files.`));
    }
    return sel;
  }

  animationsOf(node) {
    const img = this.doc.get(node, 'image');
    if (!img || !/\.sprite$/.test(img)) return [];
    try {
      return Object.keys(this.ctx.project.readJSON(img)?.animations || {});
    } catch {
      return [];
    }
  }

  nodePaths(node) {
    const out = [];
    this.doc.walk((n) => { if (n !== node && n !== this.doc.root) out.push(this.doc.pathOf(n)); });
    return out;
  }
}

function prettyName(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (m) => m.toLowerCase())
    .replace(/^Vx$/, 'Velocity x').replace(/^Vy$/, 'Velocity y').replace(/^Vz$/, 'Velocity z');
}

function prettyOption(o) {
  return String(o).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** A number field you can type in or drag sideways (Shift: faster, Alt: finer). */
function numberEditor(value, def, set, toView = (v) => v, fromView = (v) => v) {
  const isEmpty = value === null || value === undefined;
  const step = def.step ?? (def.type === 'int' ? 1 : 1);
  const fmt = (v) => (def.type === 'int' ? String(Math.round(v)) : String(Math.round(v * 1000) / 1000));
  const input = h('input', { class: 'input num-input', inputmode: 'decimal', value: isEmpty ? '' : fmt(toView(value)), placeholder: isEmpty ? 'none' : '', spellcheck: 'false' });
  const clamp = (v) => {
    if (def.min !== undefined) v = Math.max(def.min, v);
    if (def.max !== undefined) v = Math.min(def.max, v);
    return def.type === 'int' ? Math.round(v) : v;
  };
  const commit = (live) => {
    const text = input.value.trim();
    if (text === '' && def.default === null) return set(null, { live });
    let v;
    try {
      // Simple arithmetic is allowed: 16*4, 360/8.
      v = /^[-+*/().\d\s]+$/.test(text) ? Function(`"use strict"; return (${text})`)() : Number(text);
    } catch {
      v = NaN;
    }
    if (!Number.isFinite(v)) {
      input.value = isEmpty ? '' : fmt(toView(value));
      return;
    }
    set(clamp(fromView(v)), { live });
  };
  input.addEventListener('change', () => commit(false));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = Number(input.value) || 0;
      input.value = fmt(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
      commit(false);
    }
  });
  // Drag to scrub.
  let drag = null;
  input.addEventListener('pointerdown', (e) => {
    if (document.activeElement === input) return;
    drag = { x: e.clientX, start: Number(input.value) || 0, moved: false };
    input.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  input.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    input.value = fmt(drag.start + Math.round(dx / 2) * step * k);
    commit(true);
  });
  input.addEventListener('pointerup', () => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) commit(false);
    else {
      input.focus();
      input.select();
    }
  });
  const unit = def.unit ? h('span', { class: 'num-unit' }, def.unit) : null;
  return h('div', { style: 'display: flex; align-items: center; gap: 4px; width: 100%' }, input, unit);
}

function toHex(c) {
  return '#' + c.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}

function colorEditor(value, set) {
  const picker = h('input', { type: 'color', value: toHex(value), 'aria-label': 'Color' });
  const swatch = h('span', { class: 'color-swatch', style: `background: rgba(${value.slice(0, 3).map((x) => Math.round(x * 255)).join(',')}, ${value[3] ?? 1})` }, picker);
  const hex = h('input', { class: 'input', value: toHex(value), spellcheck: 'false', style: 'font-family: var(--font-mono)' });
  const alpha = h('input', { class: 'input num-input', value: String(Math.round((value[3] ?? 1) * 100)), title: 'Opacity (%)', style: 'width: 52px; flex: none' });
  const fromHex = (s) => {
    const m = s.trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  };
  picker.addEventListener('input', () => {
    const rgb = fromHex(picker.value);
    swatch.style.background = picker.value;
    set([...rgb, value[3] ?? 1], { live: true });
  });
  picker.addEventListener('change', () => set([...fromHex(picker.value), value[3] ?? 1]));
  hex.addEventListener('change', () => {
    const rgb = fromHex(hex.value);
    if (rgb) set([...rgb, value[3] ?? 1]);
  });
  alpha.addEventListener('change', () => {
    const a = Math.max(0, Math.min(100, Number(alpha.value) || 0)) / 100;
    set([value[0], value[1], value[2], a]);
  });
  for (const el of [hex, alpha]) el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); });
  return h('div', { class: 'color-input' }, swatch, hex, alpha, h('span', { class: 'num-unit' }, '%'));
}
