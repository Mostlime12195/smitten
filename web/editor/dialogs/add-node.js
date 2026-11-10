// The Add a piece dialog: every piece type, searchable, grouped as in
// DESIGN.md section 4, with what each one does and what it can do.

import { h, openDialog } from '../ui.js';
import { nodeIcon } from '../shell/node-icons.js';
import { typesByGroup, typeDef, methods, events, properties, moduleOf, isA } from '../core/schema.js';

const MODULE_NAMES = { physics2d: 'physics (Box2D)', video: 'video', synth: 'sound generator' };
const RECENT_KEY = 'smitten-editor.recent-nodes';

/** Suggestions for what to add, from what the parent is. */
function suggestionsFor(parentType) {
  if (parentType === 'Body' || parentType === 'Zone') return ['Sprite', 'Shape', 'Camera', 'Hitbox', 'Particles'];
  if (parentType && isA(parentType, 'UI')) return ['Label', 'Button', 'Slider', 'Checkbox', 'TextInput', 'Row', 'Column', 'Panel', 'Picture', 'Bar'];
  return ['Sprite', 'Body', 'Zone', 'Shape', 'Tiles', 'Label', 'Camera'];
}

/** Resolves to a type name, or null. */
export function addNodeDialog(parentType) {
  const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search pieces (picture, wall, button, sound…)', 'aria-label': 'Search pieces' });
  const items = h('div', { class: 'add-node-items', role: 'listbox' });
  const help = h('div', { class: 'add-node-help' });
  let active = null;
  let flat = [];

  const show = (type) => {
    active = type;
    for (const el of items.querySelectorAll('.add-node-item')) el.classList.toggle('active', el.dataset.type === type);
    const def = typeDef(type);
    help.replaceChildren();
    if (!def) return;
    const ev = Object.keys(events(type)).filter((e) => !['ready', 'update', 'physicsUpdate', 'draw', 'removed'].includes(e));
    const own = Object.keys(def.properties || {});
    const mod = moduleOf(type);
    help.append(...[
      h('h3', {}, nodeIcon(type, 20), type),
      h('p', {}, def.description),
      def.parent ? h('p', { class: 'module-note' }, `Put it inside a ${def.parent.join(' or ')}.`) : null,
      own.length ? h('div', {}, h('div', { class: 'add-node-group', style: 'padding: 0 0 4px' }, 'Properties'), h('ul', {}, ...own.slice(0, 8).map((p) => h('li', {}, p)))) : null,
      ev.length ? h('div', {}, h('div', { class: 'add-node-group', style: 'padding: 0 0 4px' }, 'Script functions it calls'), h('ul', {}, ...ev.map((e) => h('li', {}, `${e}(${events(type)[e].args})`)))) : null,
      mod ? h('p', { class: 'module-note' }, `Uses the ${MODULE_NAMES[mod] || mod} module, added to your game automatically.`) : null,
      def.extends ? h('p', { class: 'module-note' }, `A kind of ${def.extends}: it has everything a ${def.extends} has.`) : null,
    ].filter(Boolean));
  };

  const item = (type, extra) => {
    const def = typeDef(type);
    const el = h('div', { class: 'add-node-item', role: 'option', 'data-type': type, title: def.description }, nodeIcon(type), h('span', {}, type), extra ? h('span', { class: 'muted' }, extra) : null);
    el.addEventListener('click', () => show(type));
    el.addEventListener('dblclick', () => dlg.finish(type));
    return el;
  };

  const render = () => {
    const q = search.value.trim().toLowerCase();
    items.replaceChildren();
    flat = [];
    const matches = (name) => {
      if (!q) return true;
      const def = typeDef(name);
      return name.toLowerCase().includes(q) || def.description.toLowerCase().includes(q) || def.group.includes(q);
    };
    if (!q) {
      const sugg = [...new Set([...recent.filter((t) => typeDef(t)), ...suggestionsFor(parentType)])].slice(0, 6);
      items.append(h('div', { class: 'add-node-group' }, 'Suggested'));
      for (const t of sugg) {
        items.append(item(t, recent.includes(t) ? 'recent' : ''));
        flat.push(t);
      }
    }
    for (const g of typesByGroup()) {
      const types = g.types.filter((t) => matches(t.name));
      if (!types.length) continue;
      items.append(h('div', { class: 'add-node-group' }, g.name));
      for (const t of types) {
        items.append(item(t.name));
        if (!flat.includes(t.name)) flat.push(t.name);
      }
    }
    if (!flat.length) items.append(h('p', { class: 'insp-hint' }, 'No piece matches.'));
    show(flat.includes(active) && q === '' ? active : flat[0]);
  };

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = flat.indexOf(active);
      show(flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]);
      items.querySelector('.add-node-item.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) dlg.finish(active);
    }
  });

  let dlg;
  const p = openDialog({
    title: `Add a piece${parentType ? ` inside the ${parentType}` : ''}`,
    wide: true,
    body: h('div', { class: 'add-node' }, h('div', { class: 'add-node-list' }, search, items), help),
    actions: [
      { label: 'Cancel', value: null, ghost: true },
      { label: 'Add', value: '__add', primary: true },
    ],
    onOpen: (d) => {
      dlg = d;
      render();
      search.focus();
    },
  }).then((v) => {
    const type = v === '__add' ? active : v;
    if (type) localStorage.setItem(RECENT_KEY, JSON.stringify([type, ...recent.filter((t) => t !== type)].slice(0, 4)));
    return type || null;
  });
  return p;
}

export { properties, methods };
