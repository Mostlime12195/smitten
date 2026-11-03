// The node schema (love/src/modules/scene/nodes.json, copied next to the
// editor by build.py): every node type, its properties, methods and events.
// The inspector, the Add node dialog, the viewports, completions and module
// detection all read it, so they always agree with the engine.

let schema = null;

export async function loadSchema() {
  if (schema) return schema;
  const res = await fetch(new URL('../nodes.json', import.meta.url));
  if (!res.ok) throw new Error(`nodes.json: ${res.status}`);
  schema = await res.json();
  return schema;
}

/** For tests and tools that already have the JSON. */
export function setSchema(s) {
  schema = s;
}

export function getSchema() {
  if (!schema) throw new Error('schema not loaded');
  return schema;
}

export function typeDef(type) {
  return getSchema().types[type] || null;
}

export function typeNames({ includeAbstract = false } = {}) {
  return Object.keys(getSchema().types).filter((t) => includeAbstract || !getSchema().types[t].abstract);
}

/** Type and its ancestors, base first: ['Node', 'Node2D', 'Sprite2D']. */
export function lineage(type) {
  const out = [];
  let t = type;
  while (t && getSchema().types[t]) {
    out.unshift(t);
    t = getSchema().types[t].extends;
  }
  return out;
}

export function isA(type, base) {
  return lineage(type).includes(base);
}

/**
 * Every property of a type, own and inherited, in inspector order:
 * [{ name, def, owner }], base types first.
 */
export function properties(type) {
  const out = [];
  const seen = new Set();
  for (const t of lineage(type)) {
    for (const [name, def] of Object.entries(getSchema().types[t].properties || {})) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, def, owner: t });
    }
  }
  return out;
}

export function propertyDef(type, name) {
  for (const t of lineage(type).reverse()) {
    const p = getSchema().types[t].properties?.[name];
    if (p) return p;
  }
  return null;
}

export function defaultOf(type, name) {
  const p = propertyDef(type, name);
  return p ? clone(p.default) : undefined;
}

export function methods(type) {
  const out = {};
  for (const t of lineage(type)) Object.assign(out, getSchema().types[t].methods || {});
  return out;
}

export function events(type) {
  const out = {};
  for (const t of lineage(type)) Object.assign(out, getSchema().types[t].events || {});
  return out;
}

/** '2d', '3d', 'ui' or 'other' (behaviors, sound, timers). */
export function space(type) {
  const l = lineage(type);
  if (l.includes('Node2D')) return '2d';
  if (l.includes('Node3D')) return '3d';
  if (l.includes('Control')) return 'ui';
  return 'other';
}

/** The optional engine module a type needs, or null. */
export function moduleOf(type) {
  for (const t of lineage(type).reverse()) {
    const m = getSchema().types[t].module;
    if (m) return m;
  }
  return null;
}

/** Groups with their (non-abstract) types, in schema order. */
export function typesByGroup() {
  const s = getSchema();
  return s.groups.map((g) => ({
    ...g,
    types: Object.entries(s.types).filter(([, d]) => d.group === g.id && !d.abstract).map(([name, d]) => ({ name, ...d })),
  }));
}

/** Whether a property is shown, given the node's other values ("when"). */
export function isShown(def, get) {
  if (def.hidden) return false;
  if (!def.when) return true;
  return Object.entries(def.when).every(([k, allowed]) => allowed.includes(get(k)));
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
