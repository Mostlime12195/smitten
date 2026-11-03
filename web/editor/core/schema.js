// The piece schema (love/src/modules/scene/pieces.json, copied next to the
// editor by build.py): every piece type, its properties, methods and events.
// The inspector, the Add piece dialog, the scene view, completions and module
// detection all read it, so they always agree with the engine.

let schema = null;

export async function loadSchema() {
  if (schema) return schema;
  const res = await fetch(new URL('../pieces.json', import.meta.url));
  if (!res.ok) throw new Error(`pieces.json: ${res.status}`);
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

/** Type and its ancestors, base first: ['Piece', 'Group', 'Sprite']. */
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

/** 'world' (has a position in the scene), 'ui' (on the screen) or 'other' (timers, sounds). */
export function space(type) {
  const l = lineage(type);
  if (l.includes('Group')) return 'world';
  if (l.includes('UI')) return 'ui';
  return 'other';
}

/** The optional engine module a piece needs (a Body moved by physics needs physics2d), or null. */
export function moduleOfPiece(type, props = {}) {
  if (type === 'Body' && props.motion === 'physics') return 'physics2d';
  return moduleOf(type);
}

/** The optional engine module a type always needs, or null. */
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
