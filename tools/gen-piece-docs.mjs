// Writes docs/pieces.md from the piece schema (love/src/modules/scene/pieces.json):
//   node tools/gen-piece-docs.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'love/src/modules/scene/pieces.json'), 'utf8'));
const MODULES = { physics2d: 'physics2d (Box2D)' };

const fmt = (v, p) => {
  if (v === null || v === undefined) return 'none';
  if (p.type === 'angle') return `${Math.round(v * 180 / Math.PI * 100) / 100}°`;
  if (p.type === 'color') return `{${v.join(', ')}}`;
  if (Array.isArray(v)) return `{${v.join(', ')}}`;
  if (typeof v === 'string') return v === '' ? '""' : `"${v}"`;
  return String(v);
};

const out = [
  '# Pieces',
  '',
  'Every piece type, generated from `love/src/modules/scene/pieces.json` by',
  '`tools/gen-piece-docs.mjs`. A piece has its own properties and everything its',
  'base type has ("extends"). Properties are fields: `self.x = 10`. Angles',
  'are radians in code and degrees in the inspector. A Body whose motion is',
  '"physics" uses the physics2d module (Box2D).',
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
writeFileSync(join(root, 'docs/pieces.md'), out.join('\n'));
console.log(`docs/pieces.md: ${Object.keys(schema.types).length} piece types`);
