// Updates a project folder to the newest rules, the way the editor's
// "Update this project" does (web/editor/core/update-project.js), and
// prints what to look at by hand. For the test projects in tools/.
//
//   node tools/update-project.mjs tools/scene-tests/physics [--declare] [--dry]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateProject, reportText } from '../web/editor/core/update-project.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'love/src/modules/scene/pieces.json'), 'utf8'));
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: node tools/update-project.mjs <project folder> [--declare] [--dry]');
  process.exit(1);
}
const files = {};
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(scene|lua|json)$/.test(name)) files[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
  }
};
walk(dir);
const { files: out, report } = updateProject(files, schema, { declare: args.includes('--declare') });
// Files keep the indentation they had (the editor writes two spaces), and
// smitten.json only gets its new version, so a diff shows what changed.
const reindent = (path, text) => {
  const was = files[path];
  if (path === 'smitten.json' && /"version"\s*:\s*\d+/.test(was || '')) return was.replace(/("version"\s*:\s*)\d+/, '$13');
  if (!path.endsWith('.scene') || !was) return text;
  const indent = /\n([ \t]+)"/.exec(was)?.[1] ?? '  ';
  return `${JSON.stringify(JSON.parse(text), null, indent)}\n`;
};
if (!args.includes('--dry')) for (const [path, text] of Object.entries(out)) writeFileSync(join(dir, path), reindent(path, text));
console.log(reportText(report));
