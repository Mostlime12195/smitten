// Tests web/editor/smitten-syntax.js: node tools/smitten-syntax/test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSmittenSyntax } from '../../web/editor/smitten-syntax.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
const show = (found) => found.map((f) => `${f.line}:${f.feature}`).join(' ');

function expect(name, code, want) {
  const got = show(findSmittenSyntax(code));
  if (got === want) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}\n  got  ${got}\n  want ${want}`); }
}

// compound assignment
expect('compound', 'x += 1\nt.a -= 2\nt[i] *= 3\na /= 4 b %= 5 c ^= 6\ns ..= "!"',
  '1:compound-assignment 2:compound-assignment 3:compound-assignment 4:compound-assignment ' +
  '4:compound-assignment 4:compound-assignment 5:compound-assignment');
expect('not compound', 'a = b + -c\na=-1\nb = a==-1\nx = 5 --= comment\nc = a ~= b\nd = a<=-b\ne = 1e-5', '');

// continue
expect('continue', 'for i = 1, 2 do\n  if i then continue end\nend', '2:continue');
expect('continue alone', 'while x do\n  continue\nend', '2:continue');
expect('continue before until', 'repeat\n  x()\n  continue\nuntil y', '3:continue');
expect('continue then ;', 'for i = 1, 2 do continue; end', '1:continue');
expect('continue at eof', 'continue', '1:continue');
expect('continue names', [
  'local continue = 1', 'continue = continue + 1', 'continue()', 't.continue = 2',
  'goto continue', '::continue::', 'function continue() end', 'x = t:continue()',
  'return continue', 'f(continue)', 'do local continue end', 'for continue = 1, 2 do end',
  'local a, continue', 'x = y.continue end',
].join('\n'), '');
expect('continue in if-expression', 'x = if a then continue else 1', '1:if-expression');

// string interpolation
expect('interpolation', 'print(`HP: {hp}/{max}`)\nlocal s = `plain`', '1:interpolation 2:interpolation');
expect('nested interpolation', 'x = `a{`b{c}`}d`', '1:interpolation 1:interpolation');
expect('interpolation with braces', 'x = `{ {1, 2} }{"}"}\\{` y += 1', '1:interpolation 1:compound-assignment');
expect('interpolation multi-line expression', 'x = `{f(\n  1)}` z += 1', '1:interpolation 2:compound-assignment');
expect('if inside interpolation', 'x = `{if a then 1 else 2}`', '1:interpolation 1:if-expression');

// if-expressions
expect('if-expression', 'local v = if a then 1 else 2\nf(if a then b elseif c then d else e)\nreturn if x then y else z',
  '1:if-expression 2:if-expression 3:if-expression');
expect('if statements', 'if a then b() end\nif a then\n  if b then c() end\nelseif d then\nelse\n  if e then end\nend', '');
expect('nested if-expressions', 'x = if a then if b then 1 else 2 else 3', '1:if-expression 1:if-expression');
expect('if after if-expression', 'x = if a then 1 else 2\nif b then c() end', '1:if-expression');
expect('if-expression in a then block', 'if a then\n  x = if b then 1 else 2\nelse\n  if c then end\nend', '2:if-expression');
expect('if-expression in a condition', 'if x == if a then b else c then\n  if y then end\nend', '1:if-expression');
expect('if-expression in a table', 't = { if a then 1 else 2; if b then 3 else 4, k = if c then 5 else 6 }',
  '1:if-expression 1:if-expression 1:if-expression');
expect('if after ; in a function in a table', 't = { function() x(); if a then end end }', '');
expect('if-expression operators', 'x = 1 + if a then 2 else 3\ny = not if a then b else c\nz = #if a then t else u',
  '1:if-expression 2:if-expression 3:if-expression');

// comments and strings are skipped
expect('comments', [
  '-- x += 1 `a` continue', '--[[ if a then b else c', 'x += 1 ]] y = 1', '--[==[ ]] `x` ]==] z = 1',
  '---[[ not long', 'w = 2',
].join('\n'), '');
expect('strings', [
  's = "x += 1 `a`"', "s = 'if a then continue end'", 's = [[`{x}`', 'continue]]', 's = [=[ ]] x += 1 ]=]',
  's = "esc \\" x += 1"', 's = "line \\', 'x += 1"',
].join('\n'), '');
expect('lines after long strings', 's = [[\n\n]]\nx += 1\n--[[\n\n]] y -= 1', '4:compound-assignment 7:compound-assignment');

// plain Lua in the repository has none
const luaFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'build' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.lua') && !e.name.startsWith('smitten-')) luaFiles.push(p);
  }
})(root);
const plain = luaFiles.filter((f) => findSmittenSyntax(readFileSync(f, 'utf8')).length);
if (plain.length) { failures++; console.log(`FAIL plain Lua files: ${plain.join(', ')}`); }
else console.log(`ok   ${luaFiles.length} plain Lua files have no Smitten syntax`);

// the JIT tests for each feature use it
for (const [file, feature] of [['compound', 'compound-assignment'], ['continue', 'continue'],
  ['interp', 'interpolation'], ['ifexp', 'if-expression']]) {
  const found = findSmittenSyntax(readFileSync(join(root, `tools/jit/tests/smitten-${file}.lua`), 'utf8'));
  if (found.some((f) => f.feature === feature)) console.log(`ok   smitten-${file}.lua uses ${feature}`);
  else { failures++; console.log(`FAIL smitten-${file}.lua: no ${feature}`); }
}

console.log(`${failures} failure(s)`);
process.exitCode = failures ? 1 : 0;
