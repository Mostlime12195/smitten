// Writes docs/nodes.md from the node schema (love/src/modules/scene/nodes.json):
//   node tools/gen-node-docs.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'love/src/modules/scene/nodes.json'), 'utf8'));
const MODULES = { physics2d: 'physics2d (Box2D)', '3d': '3d', physics3d: 'physics3d (Jolt)' };

const fmt = (v, p) => {
  if (v === null || v === undefined) return 'none';
  if (p.type === 'angle') return `${Math.round(v * 180 / Math.PI * 100) / 100}°`;
  if (p.type === 'color') return `{${v.join(', ')}}`;
  if (Array.isArray(v)) return `{${v.join(', ')}}`;
  if (typeof v === 'string') return v === '' ? '""' : `"${v}"`;
  return String(v);
};

const out = [
  '# Nodes',
  '',
  'Every node type, generated from `love/src/modules/scene/nodes.json` by',
  '`tools/gen-node-docs.mjs`. A node has its own properties and everything its',
  'parent type has ("extends"). Properties are fields: `self.x = 10`. Angles',
  'are radians in code and degrees in the inspector.',
  '',
];
for (const g of schema.groups) {
  out.push(`## ${g.name}`, '');
  for (const [name, def] of Object.entries(schema.types).filter(([, d]) => d.group === g.id)) {
    out.push(`### ${name}`, '');
    out.push(def.description, '');
    const notes = [];
    if (def.extends) notes.push(`Extends ${def.extends}.`);
    if (def.abstract) notes.push('A base for other types; not added itself.');
    if (def.parent) notes.push(`Goes inside a ${def.parent.join(' or ')}.`);
    if (def.module) notes.push(`Uses the ${MODULES[def.module] || def.module} module.`);
    if (notes.length) out.push(notes.join(' '), '');
    const props = Object.entries(def.properties || {}).filter(([, p]) => !p.hidden);
    if (props.length) {
      out.push('| Property | Type | Default | |', '| --- | --- | --- | --- |');
      for (const [p, d] of props) out.push(`| \`${p}\` | ${d.type}${d.unit ? ` (${d.unit})` : ''} | ${fmt(d.default, d)} | ${d.description} |`);
      out.push('');
    }
    const methods = Object.entries(def.methods || {});
    if (methods.length) {
      out.push('Methods:', '');
      for (const [m, d] of methods) out.push(`- \`self:${m}(${d.args})\`: ${d.doc}`);
      out.push('');
    }
    const events = Object.entries(def.events || {});
    if (events.length) {
      out.push('Script functions it calls:', '');
      for (const [e, d] of events) out.push(`- \`function Script:${e}(${d.args})\`: ${d.doc}`);
      out.push('');
    }
  }
}
writeFileSync(join(root, 'docs/nodes.md'), out.join('\n'));
console.log(`docs/nodes.md: ${Object.keys(schema.types).length} node types`);
