// Smitten's docs, from one source:
//
//   node tools/gen-docs.mjs
//
// - docs/pieces.md, docs/api.md and docs/engine.md are written whole, from
//   the piece catalogue (love/src/modules/scene/pieces.json), the short API
//   (web/editor/core/script-api.js) and smitten.* (web/editor/smitten-docs.js).
// - In the hand-written pages (docs/*.md), the tables between markers are
//   filled in from the same sources:
//     <!-- api:Input --> ... <!-- end -->       a group of the short API
//     <!-- piece:Camera --> ... <!-- end -->    a piece's properties, methods, events
//     <!-- module:input --> ... <!-- end -->    smitten.input's functions
// - platform/public/docs/ gets the HTML site the sharing site serves at
//   /docs: one page per Markdown page, a sidebar, search (search.json) and
//   the site's look (site.css, docs.css).
//
// docs/physics.md is written separately (by hand); until it exists, the site
// shows a placeholder page for it.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(root, 'docs');
// node tools/gen-docs.mjs [--out dir --local]: --local writes a copy for the
// editor's built-in docs panel (dist/docs): plain .html links, its own
// stylesheet, no links back to the site.
const argv = process.argv.slice(2);
const LOCAL = argv.includes('--local');
const outDir = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]) : join(root, 'platform', 'public', 'docs');
const schema = JSON.parse(readFileSync(join(root, 'love/src/modules/scene/pieces.json'), 'utf8'));
const { SCRIPT_API_GROUPS, SCRIPT_CALLBACKS } = await import(pathToFileURL(join(root, 'web/editor/core/script-api.js')).href);
const { SMITTEN_MODULES, MODULE_HELPERS, NET_EVENTS } = await import(pathToFileURL(join(root, 'web/editor/smitten-docs.js')).href);

// The site's pages, in sidebar order. A page whose file is missing gets a
// placeholder (physics, written by hand later).
const NAV = [
  { title: 'Start', pages: [['reference', 'Overview'], ['getting-started', 'Getting started']] },
  {
    title: 'Making games',
    pages: [['scripts', 'Scripts'], ['scenes', 'Scenes and pieces'], ['input', 'Input'], ['sound', 'Sound and music'], ['sprite-editor', 'Sprite editor'],
      ['camera', 'Camera'], ['backgrounds', 'Backgrounds'], ['tiles', 'Tiles'], ['lights', 'Lights'], ['text', 'Text'], ['ui', 'UI'], ['animation', 'Animation'], ['physics', 'Physics'], ['pathfinding', 'Pathfinding'], ['random', 'Random and noise'], ['saving', 'Saving'], ['drawing', 'Drawing']],
  },
  { title: 'Project', pages: [['settings', 'Project settings'], ['sharing', 'Sharing and publishing'], ['clips', 'Clips'], ['leaderboards', 'Leaderboards'], ['online', 'Online rooms'], ['older-projects', 'Older projects']] },
  {
    title: 'Reference',
    pages: [['api', 'Script API'], ['pieces', 'Pieces'], ['engine', 'The engine table'], ['formats', 'File formats'], ['editor-tools', 'Editor tools']],
  },
];
const TITLES = Object.fromEntries(NAV.flatMap((s) => s.pages));

const cell = (s) => String(s).replace(/\|/g, '\\|');

// ---------------------------------------------------------------------------
// Generated Markdown

const fmt = (v, p) => {
  if (v === null || v === undefined) return 'none';
  // pieces.json keeps angles in degrees, as scripts of version 3 see them.
  if (p.type === 'angle') return `${v}°`;
  if (Array.isArray(v)) return `{${v.join(', ')}}`;
  if (typeof v === 'string') return v === '' ? '""' : `"${v}"`;
  return String(v);
};

/** A piece's tables: properties, methods, events (own only; base types link). */
function pieceTables(name) {
  const def = schema.types[name];
  if (!def) throw new Error(`no piece type ${name}`);
  const out = [];
  const props = Object.entries(def.properties || {}).filter(([, p]) => !p.hidden);
  if (props.length) {
    out.push('| Property | Type | Default | |', '| --- | --- | --- | --- |');
    for (const [p, d] of props) out.push(`| \`${p}\` | ${d.type}${d.unit ? ` (${d.unit})` : ''} | ${cell(fmt(d.default, d))} | ${cell(d.description)} |`);
    out.push('');
  }
  for (const [f, doc] of Object.entries(def.fields || {})) out.push(`\`${f}\`: ${doc}`, '');
  const methods = Object.entries(def.methods || {});
  if (methods.length) {
    out.push('| Method | |', '| --- | --- |');
    for (const [m, d] of methods) out.push(`| \`${m}(${d.args})\` | ${cell(d.doc)} |`);
    out.push('');
  }
  const events = Object.entries(def.events || {});
  if (events.length) {
    out.push('| Event (a function in its script) | |', '| --- | --- |');
    for (const [e, d] of events) out.push(`| \`function ${e}(${d.args})\` | ${cell(d.doc)} |`);
    out.push('');
  }
  return out;
}

function apiTable(group) {
  const g = SCRIPT_API_GROUPS.find((x) => x.name === group);
  if (!g) throw new Error(`no API group ${group}`);
  return ['| Call | |', '| --- | --- |', ...g.items.map(([, sig, doc]) => `| \`${sig}\` | ${cell(doc)} |`), ''];
}

function moduleTable(mod) {
  const members = SMITTEN_MODULES[mod] || MODULE_HELPERS[mod];
  if (!members) throw new Error(`no module ${mod}`);
  const fns = Object.entries(members).filter(([, d]) => d);
  const fields = Object.entries(members).filter(([, d]) => !d).map(([n]) => `\`${n}\``);
  const out = ['| Function | |', '| --- | --- |', ...fns.map(([n, [args, doc]]) => `| \`smitten.${mod}.${n}(${args})\` | ${cell(doc)} |`), ''];
  if (fields.length) out.push(`Fields: ${fields.join(', ')}.`, '');
  return out;
}

const MODULE_NOTES = {
  physics2d: 'physics2d (Box2D)',
};

function piecesPage() {
  const out = [
    '# Pieces',
    '',
    'Each piece has its own properties and the properties of its base type. In the',
    'script of the piece, use the names directly: `x = 10`, `move()`,',
    '`function clicked() end`. For a different piece, use the piece: `other.x`,',
    '`other:move()`, `other:on("clicked", fn)`. Angles are in degrees, in code and',
    'in the Inspector.',
    '',
  ];
  for (const g of schema.groups) {
    out.push(`## ${g.name}`, '');
    for (const [name, def] of Object.entries(schema.types).filter(([, d]) => d.group === g.id)) {
      out.push(`### ${name}`, '', def.description, '');
      const notes = [];
      if (def.extends) notes.push(`Extends [${def.extends}](#${def.extends.toLowerCase()}).`);
      if (def.abstract) notes.push('A base for other piece types. You do not add it to a scene yourself.');
      if (def.parent) notes.push(`Put it inside a ${def.parent.join(' or ')}.`);
      if (def.module) notes.push(`Uses the ${MODULE_NOTES[def.module] || def.module} module.`);
      if (notes.length) out.push(notes.join(' '), '');
      out.push(...pieceTables(name));
    }
  }
  return out.join('\n');
}

function apiPage() {
  const out = [
    '# Script API',
    '',
    'A script can use these names without `smitten.`. [Scripts](scripts.md#how-names-are-found) tells',
    'how the engine finds a name.',
    '',
  ];
  for (const g of SCRIPT_API_GROUPS) {
    out.push(`## ${g.name}`, '', `See [${TITLES[g.page]}](${g.page}.md).`, '', ...apiTable(g.name));
  }
  out.push('## Script functions', '', 'The engine calls these functions when a script has them.', '');
  const events = new Map();
  for (const [type, def] of Object.entries(schema.types)) {
    for (const [e, d] of Object.entries(def.events || {})) {
      if (!events.has(e)) events.set(e, { args: d.args, docs: [], types: [] });
      events.get(e).types.push(type);
      events.get(e).docs.push(`${type}: ${d.doc}`);
    }
  }
  out.push('| Function | Pieces | |', '| --- | --- | --- |');
  for (const name of SCRIPT_CALLBACKS) {
    const e = events.get(name);
    if (e) out.push(`| \`function ${name}(${e.args})\` | ${e.types.join(', ')} | ${cell(e.types.length > 1 ? e.docs.join(' ') : e.docs[0].replace(/^\w+: /, ''))} |`);
    else if (NET_EVENTS[name]) out.push(`| \`function ${name}(${NET_EVENTS[name][0]})\` | any piece, with smitten.net ([Online rooms](online.md)) | ${cell(NET_EVENTS[name][1])} |`);
  }
  out.push('');
  return out.join('\n');
}

function enginePage() {
  const out = [
    '# The engine table',
    '',
    '`smitten` holds the engine. It has drawing (`smitten.graphics`), sound',
    '(`smitten.audio`, `smitten.sound`), input devices (`smitten.keyboard`, `smitten.mouse`,',
    '`smitten.joystick`, `smitten.touch`) and files (`smitten.filesystem`). It also has',
    '`smitten.math`, `smitten.timer`, `smitten.window`, the other modules, and Smitten\'s own',
    'modules. This page gives Smitten\'s own modules, and the helpers that Smitten adds to',
    'the other modules.',
    '',
    '## Smitten\'s modules',
    '',
  ];
  const intro = {
    scene: 'See [Scenes and pieces](scenes.md).',
    input: 'See [Input](input.md).',
    tween: '`smitten.tween(target, seconds, values, easing)`. The easings are in [Scripts](scripts.md#waiting).',
    assets: 'Loads files and keeps them in memory. Paths are relative to the project folder.',
    storage: 'See [Saving](saving.md).',
    display: 'See [Project settings](settings.md).',
    boards: 'Leaderboards on the games site. See [Leaderboards](leaderboards.md).',
    net: 'Online rooms on the games site. See [Online rooms](online.md).',
    json: 'Changes JSON text to Lua values, and Lua values to JSON text.',
    physics: 'Queries about the physics of the scene that runs. See [Physics](physics.md).',
    paths: 'Finds a way from one place to another. See [Pathfinding](pathfinding.md).',
    text: 'Rich text, text measurement and text effects. See [Text](text.md).',
    synth: 'See [Sound and music](sound.md).',
  };
  for (const mod of Object.keys(SMITTEN_MODULES)) {
    out.push(`### smitten.${mod}`, '', intro[mod] || '', '', ...moduleTable(mod));
  }
  out.push('## Helpers in the engine\'s modules', '');
  for (const mod of Object.keys(MODULE_HELPERS)) out.push(`### smitten.${mod}`, '', ...moduleTable(mod));
  return out.join('\n');
}

// Fills the marked tables in a hand-written page.
function fillMarkers(text, file) {
  return text.replace(/<!-- (api|piece|module):([\w-]+) -->[\s\S]*?<!-- end -->/g, (_, kind, name) => {
    try {
      const body = kind === 'api' ? apiTable(name) : kind === 'piece' ? pieceTables(name) : moduleTable(name);
      return `<!-- ${kind}:${name} -->\n${body.join('\n').trimEnd()}\n<!-- end -->`;
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  });
}

const GENERATED = { pieces: piecesPage(), api: apiPage(), engine: enginePage() };
for (const [name, text] of Object.entries(GENERATED)) writeFileSync(join(docsDir, `${name}.md`), `${text.trimEnd()}\n`);
for (const f of readdirSync(docsDir).filter((f) => f.endsWith('.md'))) {
  if (GENERATED[f.slice(0, -3)]) continue;
  const path = join(docsDir, f);
  const text = readFileSync(path, 'utf8');
  const filled = fillMarkers(text, f);
  if (filled !== text) writeFileSync(path, filled);
}

// ---------------------------------------------------------------------------
// Markdown to HTML (the subset the docs use: headings, paragraphs, lists
// whose items can hold more blocks, tables, fenced code at any indent,
// images with captions, tips (> **Tip:**), inline code, links, bold, italics)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.toLowerCase().replace(/`/g, '').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// docs links: "camera.md#follow" -> "camera#follow"; "reference.md" -> "./".
function href(h) {
  const m = /^([\w-]+)\.md(#.*)?$/.exec(h);
  if (m) return `${pageHref(m[1])}${m[2] || ''}`;
  return h;
}

// Lua in code blocks: comments, strings, numbers and keywords.
const LUA_KEYWORDS = new Set('and break continue do else elseif end false for function if in local nil not or repeat return then true until while'.split(' '));
function highlightLua(code) {
  let out = '';
  const re = /(--\[\[[\s\S]*?\]\]|--[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)\b/g;
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-n">${esc(m[3])}</span>`;
    else if (LUA_KEYWORDS.has(m[4])) out += `<span class="tk-k">${m[4]}</span>`;
    else if (code[m.index + m[0].length] === '(') out += `<span class="tk-f">${m[4]}</span>`;
    else out += m[4];
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

function inline(s) {
  const codes = [];
  const keep = (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; };
  s = s.replace(/``\s?(.+?)\s?``/g, keep).replace(/`([^`]+)`/g, keep);
  s = esc(s).replace(/\\\|/g, '|');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${esc(src)}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => {
    const ext = /^https?:/.test(h);
    return `<a href="${esc(href(h))}"${ext ? ' rel="noopener"' : ''}>${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i].replace(/\\\|/g, '|'))}</code>`);
}

// Splits a table row on | outside code spans (\| is a literal bar).
function cells(row) {
  const out = [];
  let cur = '';
  let code = false;
  const s = row.trim().replace(/^\||\|$/g, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

const BLOCK = /^(#{1,4} |\s*```|\||\s*[-*] |\d+\. |> |<!--|---+\s*$|!\[)/;

function render(md) {
  const lines = md.split('\n');
  const html = [];
  const headings = [];
  let title = '';
  let i = 0;
  const used = new Set();
  const uniqueId = (text) => {
    let id = slug(text) || 'section';
    let n = 2;
    while (used.has(id)) id = `${slug(text)}-${n++}`;
    used.add(id);
    return id;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const indent = /^\s*/.exec(line)[0].length;
      const lang = line.trim().slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++].slice(Math.min(indent, /^\s*/.exec(lines[i - 1])[0].length)));
      i++;
      const body = lang === 'lua' ? highlightLua(code.join('\n')) : esc(code.join('\n'));
      html.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${body}</code></pre>`);
    } else if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) {
      // An image on its own line: a figure, captioned by its alt text.
      const [, alt, src] = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(line);
      html.push(`<figure><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">${alt ? `<figcaption>${inline(alt)}</figcaption>` : ''}</figure>`);
      i++;
    } else if (/^<!--/.test(line)) {
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
    } else if (/^#{1,4} /.test(line)) {
      const level = line.indexOf(' ');
      const text = line.slice(level + 1).trim();
      if (level === 1) {
        title = text.replace(/`/g, '');
        html.push(`<h1>${inline(text)}</h1>`);
      } else {
        const id = uniqueId(text);
        headings.push({ level, text: text.replace(/`/g, ''), id });
        html.push(`<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inline(text)}</h${level}>`);
      }
      i++;
    } else if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      html.push('<div class="table"><table>',
        `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`,
        `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('\n')}</tbody>`,
        '</table></div>');
    } else if (/^\s*[-*] /.test(line) || /^\d+\. /.test(line)) {
      // Items hold everything indented under them (more paragraphs, code,
      // images), rendered as blocks of their own.
      const ordered = /^\d+\. /.test(line);
      const marker = ordered ? /^\d+\. / : /^\s*[-*] /;
      const items = [];
      let width = 2; // how far an item's own lines are indented: under its text
      while (i < lines.length) {
        const l = lines[i];
        if (marker.test(l)) {
          width = /^\s*(?:[-*]|\d+\.) /.exec(l)[0].length;
          items.push([l.slice(width)]);
        } else if (items.length && /^\s{2,}\S/.test(l)) {
          items[items.length - 1].push(l.slice(Math.min(width, /^\s*/.exec(l)[0].length)));
        } else if (items.length && !l.trim() && i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
          items[items.length - 1].push('');
        } else if (items.length && !l.trim() && i + 1 < lines.length && marker.test(lines[i + 1])) {
          // A blank line between two items: the list goes on.
        } else break;
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      const li = (it) => {
        if (it.length === 1 || !it.slice(1).some((x) => x.trim())) return `<li>${inline(it.join(' ').trim())}</li>`;
        const inner = render(it.join('\n')).html.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
        return `<li>${inner}</li>`;
      };
      const first = ordered ? parseInt(line, 10) : 1;
      html.push(`<${tag}${first !== 1 ? ` start="${first}"` : ''}>${items.map(li).join('')}</${tag}>`);
    } else if (/^> /.test(line)) {
      const q = [];
      while (i < lines.length && /^> ?/.test(lines[i]) && lines[i].trim()) q.push(lines[i++].replace(/^> ?/, ''));
      const text = q.join(' ');
      const tip = /^\*\*(Tip|Note|Careful):\*\*\s*/.exec(text);
      if (tip) html.push(`<div class="callout ${tip[1].toLowerCase()}"><strong>${tip[1]}</strong><p>${inline(text.slice(tip[0].length))}</p></div>`);
      else html.push(`<blockquote><p>${inline(text)}</p></blockquote>`);
    } else if (/^---+\s*$/.test(line)) {
      html.push('<hr>');
      i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const p = [];
      while (i < lines.length && lines[i].trim() && !BLOCK.test(lines[i])) p.push(lines[i++].trim());
      html.push(`<p>${inline(p.join(' '))}</p>`);
    }
  }
  return { title, html: html.join('\n'), headings };
}

// Plain text of a section, for search.
const plain = (md) => md.replace(/```[\s\S]*?```/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/^\s*[-*] /gm, '').replace(/[`*|#>]/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/-{3,}/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// The site

const HEART = '<svg class="heart" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
const SEARCH_ICON = '<svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

function pageHref(name) {
  if (LOCAL) return name === 'reference' ? 'index.html' : `${name}.html`;
  return name === 'reference' ? './' : name;
}

function sidebar(current, headings) {
  return NAV.map((s) => `<div class="nav-section"><div class="nav-title">${esc(s.title)}</div><ul>${s.pages.map(([name, title]) => {
    const active = name === current;
    const sub = active && headings.length
      ? `<ul class="nav-sub">${headings.filter((h) => h.level === 2).map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul>`
      : '';
    return `<li><a href="${pageHref(name)}"${active ? ' aria-current="page"' : ''}>${esc(title)}</a>${sub}</li>`;
  }).join('')}</ul></div>`).join('');
}

function pageHtml(name, { title, html, headings }) {
  const pages = NAV.flatMap((s) => s.pages);
  const at = pages.findIndex(([n]) => n === name);
  const prev = pages[at - 1];
  const next = pages[at + 1];
  const pager = `<nav class="pager" aria-label="Pages">${prev ? `<a class="prev" href="${pageHref(prev[0])}"><span>Previous</span>${esc(prev[1])}</a>` : '<span></span>'}${next ? `<a class="next" href="${pageHref(next[0])}"><span>Next</span>${esc(next[1])}</a>` : ''}</nav>`;
  const docTitle = name === 'reference' ? 'Smitten docs' : `${title} · Smitten docs`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}</title>
<meta name="description" content="Smitten's documentation: ${esc(title)}.">
<meta name="color-scheme" content="light dark">
${LOCAL ? '' : '<link rel="icon" href="../favicon.svg" type="image/svg+xml">\n'}<link rel="stylesheet" href="${LOCAL ? 'site.css' : '../site.css'}">
<link rel="stylesheet" href="docs.css">
<script type="module" src="docs.js"></script>
</head>
<body class="docs">
<header class="topbar">
  <div class="topbar-inner">
    <button type="button" class="btn ghost nav-toggle" id="nav-toggle" aria-controls="docs-nav" aria-expanded="false" aria-label="Contents"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
    ${LOCAL ? `<a class="brand" href="index.html" aria-label="Smitten docs">${HEART}<span>Docs</span></a>` : `<a class="brand" href="../" aria-label="Smitten games">${HEART}<span>Smitten</span></a>
    <a class="docs-home" href="./">Docs</a>`}
    <form class="search" role="search" id="docs-search" action="${LOCAL ? 'index.html' : './'}">
      ${SEARCH_ICON}
      <input type="search" id="docs-q" placeholder="Search the docs" aria-label="Search the docs" autocomplete="off">
      <div class="search-results" id="docs-results" role="listbox" hidden></div>
    </form>
  </div>
</header>
<div class="docs-layout">
  <nav class="docs-nav" id="docs-nav" aria-label="Docs">${sidebar(name, headings)}</nav>
  <main class="docs-main" id="main">
    <article class="prose">
${html}
    </article>
    ${pager}
  </main>
</div>
</body>
</html>
`;
}

const CSS = `/* Smitten docs: the sharing site's look (site.css) with a sidebar. */

.docs .topbar-inner { max-width: none; }
.docs .search { max-width: 360px; }
.docs-home { color: var(--fg-muted); font-weight: 500; }
.nav-toggle { display: none; width: 36px; padding: 0; }

.docs-layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
  flex: 1;
}

.docs-nav {
  position: sticky;
  top: 60px;
  align-self: start;
  height: calc(100vh - 60px);
  overflow-y: auto;
  padding: 20px 12px 40px 24px;
  border-right: 1px solid var(--border);
  font-size: 14px;
}
.nav-section + .nav-section { margin-top: 18px; }
.nav-title { padding: 0 8px 6px; color: var(--fg-subtle); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.docs-nav ul { list-style: none; margin: 0; padding: 0; }
.docs-nav a { display: block; padding: 5px 8px; border-radius: 6px; color: var(--fg-muted); }
.docs-nav a:hover { background: var(--surface-2); color: var(--fg); text-decoration: none; }
.docs-nav a[aria-current="page"] { background: var(--accent-soft); color: var(--fg); font-weight: 600; }
.nav-sub { margin: 2px 0 6px 10px !important; padding-left: 8px !important; border-left: 1px solid var(--border); }
.nav-sub a { padding: 3px 8px; font-size: 13px; }

.docs-main { min-width: 0; padding: 28px 40px 64px; }

.prose { max-width: 760px; font-size: 15.5px; line-height: 1.65; }
.prose h1 { margin: 0 0 16px; font-size: 32px; line-height: 1.2; letter-spacing: -0.02em; }
.prose h2 { margin: 40px 0 12px; padding-top: 8px; font-size: 22px; letter-spacing: -0.01em; border-top: 1px solid var(--border); }
.prose h3 { margin: 28px 0 8px; font-size: 17px; }
.prose h4 { margin: 20px 0 6px; font-size: 15px; }
.prose h2, .prose h3, .prose h4 { position: relative; scroll-margin-top: 76px; }
.prose .anchor { position: absolute; left: -18px; color: var(--fg-subtle); opacity: 0; font-weight: 400; }
.prose h2:hover .anchor, .prose h3:hover .anchor, .prose h4:hover .anchor { opacity: 1; text-decoration: none; }
.prose p, .prose ul, .prose ol { margin: 0 0 14px; }
.prose ul, .prose ol { padding-left: 22px; }
.prose li { margin: 4px 0; }
.prose code { padding: 1px 5px; border-radius: 5px; background: var(--surface-2); font: 0.88em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.prose pre { margin: 0 0 16px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow-x: auto; }
.prose pre code { padding: 0; background: none; font-size: 13.5px; line-height: 1.55; overflow-wrap: normal; white-space: pre; }
.prose blockquote { margin: 0 0 16px; padding: 10px 14px; border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; background: var(--surface); color: var(--fg-muted); }
.prose blockquote p { margin: 0; }
.prose li > p { margin: 6px 0; }
.prose li > pre, .prose li > figure { margin: 10px 0 14px; }
.prose figure { margin: 20px 0 24px; }
.prose figure img { display: block; max-width: 100%; height: auto; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18); }
.prose figcaption { margin-top: 8px; color: var(--fg-muted); font-size: 13.5px; }
.prose p img { max-width: 100%; vertical-align: middle; border-radius: 6px; }
.callout { margin: 0 0 16px; padding: 12px 14px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); }
.callout strong { display: block; margin-bottom: 2px; font-size: 13px; }
.callout p { margin: 0; color: var(--fg-muted); }
.callout.tip strong { color: var(--accent); }
.callout.careful strong { color: #e5a03c; }
.tk-c { color: var(--fg-muted); font-style: italic; }
.tk-s { color: #4fae74; }
.tk-n { color: #c98a3a; }
.tk-k { color: #a476e0; }
.tk-f { color: #4f8ae8; }
@media (prefers-color-scheme: dark) { .tk-s { color: #8bd5a2; } .tk-n { color: #f2b56b; } .tk-k { color: #c8a2ff; } .tk-f { color: #82b0ff; } }
.prose hr { margin: 28px 0; border: 0; border-top: 1px solid var(--border); }
.prose .table { margin: 0 0 18px; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.prose table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.5; }
.prose th { text-align: left; font-weight: 600; background: var(--surface-2); }
.prose th, .prose td { padding: 7px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
.prose tr:last-child td { border-bottom: 0; }
.prose td:first-child { white-space: nowrap; }
.prose td:first-child code { overflow-wrap: normal; }

.pager { display: flex; justify-content: space-between; gap: 12px; max-width: 760px; margin-top: 48px; }
.pager a { flex: 0 1 50%; padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--fg); font-weight: 600; }
.pager a:hover { border-color: var(--accent); text-decoration: none; }
.pager span { display: block; color: var(--fg-subtle); font-size: 12px; font-weight: 500; }
.pager .next { text-align: right; margin-left: auto; }

.search-results {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: min(420px, 70vh);
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
.search-results a { display: block; padding: 8px 10px; border-radius: 6px; color: var(--fg); }
.search-results a:hover, .search-results a[aria-selected="true"] { background: var(--surface-2); text-decoration: none; }
.search-results .where { display: block; color: var(--fg-subtle); font-size: 12px; }
.search-results .snippet { display: block; color: var(--fg-muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-results .none { padding: 10px; color: var(--fg-muted); font-size: 14px; }

@media (max-width: 860px) {
  .docs-layout { grid-template-columns: minmax(0, 1fr); }
  .nav-toggle { display: inline-flex; }
  .docs-home { display: none; }
  .docs .topbar-inner { gap: 10px; padding: 0 16px; }
  .docs-nav {
    position: fixed;
    top: 60px;
    left: 0;
    z-index: 15;
    width: min(300px, 85vw);
    background: var(--surface);
    transform: translateX(-105%);
    transition: transform 0.18s ease;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.2);
  }
  .docs-nav.open { transform: none; }
  .docs-main { padding: 20px 16px 48px; }
  .prose h1 { font-size: 26px; }
  .prose .anchor { display: none; }
  .prose td:first-child { white-space: normal; }
}

@media (max-width: 640px) {
  .docs .topbar-inner { flex-wrap: nowrap; height: 60px; padding-top: 0; padding-bottom: 0; }
  .docs .search { order: 0; flex: 1 1 auto; min-width: 0; }
  .docs .brand span { display: none; }
}
`;

const JS = `// Smitten docs: search and the contents menu on small screens.
const input = document.getElementById('docs-q');
const results = document.getElementById('docs-results');
const form = document.getElementById('docs-search');
let index = null;
let shown = [];
let selected = -1;

async function load() {
  if (!index) index = await fetch('search.json').then((r) => r.json()).catch(() => []);
  return index;
}

function score(entry, words) {
  const title = entry.t.toLowerCase();
  const text = entry.x.toLowerCase();
  let s = 0;
  for (const w of words) {
    if (title === w) s += 12;
    else if (title.startsWith(w)) s += 8;
    else if (title.includes(w)) s += 5;
    else if (text.includes(w)) s += 1;
    else return 0;
  }
  return s + (entry.k === 'api' ? 1 : 0);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function search() {
  const q = input.value.trim().toLowerCase();
  if (!q) { results.hidden = true; return; }
  const words = q.split(/\\s+/);
  shown = (await load()).map((e) => [score(e, words), e]).filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0]).slice(0, 12).map(([, e]) => e);
  selected = shown.length ? 0 : -1;
  results.replaceChildren(...(shown.length ? shown.map((e, i) => {
    const a = el('a');
    a.href = e.u;
    a.setAttribute('role', 'option');
    if (i === selected) a.setAttribute('aria-selected', 'true');
    a.append(el('span', 'where', e.p), el('strong', '', e.t), el('span', 'snippet', e.x));
    return a;
  }) : [el('div', 'none', 'Nothing found.')]));
  results.hidden = false;
}

function select(i) {
  const links = results.querySelectorAll('a');
  if (!links.length) return;
  selected = (i + links.length) % links.length;
  links.forEach((a, j) => a.setAttribute('aria-selected', String(j === selected)));
  links[selected].scrollIntoView({ block: 'nearest' });
}

input.addEventListener('input', search);
input.addEventListener('focus', () => { if (input.value.trim()) search(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); select(selected + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); select(selected - 1); }
  else if (e.key === 'Escape') { results.hidden = true; input.blur(); }
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (shown[selected]) location.href = shown[selected].u;
});
document.addEventListener('click', (e) => { if (!form.contains(e.target)) results.hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
});

const toggle = document.getElementById('nav-toggle');
const nav = document.getElementById('docs-nav');
toggle.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
});
nav.addEventListener('click', (e) => {
  if (e.target.closest('a')) { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
});
`;

const PLACEHOLDER = {
  physics: '# Physics\n\nSee [Pieces](pieces.md#bodies-and-zones) for Body, Zone, Hitbox and Joint.\n',
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const search = [];
let count = 0;
for (const [name, navTitle] of NAV.flatMap((s) => s.pages)) {
  const file = join(docsDir, `${name}.md`);
  const md = existsSync(file) ? readFileSync(file, 'utf8') : PLACEHOLDER[name];
  if (md === undefined) throw new Error(`docs/${name}.md is missing`);
  const page = render(md);
  writeFileSync(join(outDir, `${name === 'reference' ? 'index' : name}.html`), pageHtml(name, page));
  count++;
  // Search: each section, and each name in the API and piece tables.
  const url = pageHref(name);
  const sections = md.split(/\n(?=#{2,4} )/);
  const ids = [...page.headings];
  for (const sec of sections) {
    const head = /^(#{1,4}) (.*)/.exec(sec);
    const h = head && head[1].length > 1 ? ids.shift() : null;
    const t = h ? h.text : page.title;
    search.push({ k: 'page', p: navTitle, t, u: h ? `${url}#${h.id}` : url, x: plain(sec.replace(/^#.*\n/, '')).slice(0, 160) });
    for (const row of sec.matchAll(/^\| `.*\|$/gm)) {
      const c = cells(row[0]);
      const sig = c[0].replace(/^`|`$/g, '');
      search.push({ k: 'api', p: `${navTitle}${h ? ` › ${h.text}` : ''}`, t: sig, u: h ? `${url}#${h.id}` : url, x: plain(c[c.length - 1]).slice(0, 160) });
    }
  }
}
// Screenshots and other images (docs/images, made by tools/docs-shots.mjs).
const imagesDir = join(docsDir, 'images');
if (existsSync(imagesDir)) {
  mkdirSync(join(outDir, 'images'), { recursive: true });
  for (const f of readdirSync(imagesDir)) writeFileSync(join(outDir, 'images', f), readFileSync(join(imagesDir, f)));
}
writeFileSync(join(outDir, 'search.json'), JSON.stringify(search));
writeFileSync(join(outDir, 'docs.css'), CSS);
writeFileSync(join(outDir, 'docs.js'), JS);
if (LOCAL) writeFileSync(join(outDir, 'site.css'), readFileSync(join(root, 'platform/public/site.css')));
console.log(`docs: ${count} pages in platform/public/docs, ${search.length} search entries; docs/pieces.md, api.md, engine.md written`);
