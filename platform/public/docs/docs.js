// Smitten docs: search and the contents menu on small screens.
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
  const words = q.split(/\s+/);
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
