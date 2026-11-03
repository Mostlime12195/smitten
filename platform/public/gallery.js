// The gallery: newest or most played games, and search.

import { $, h, icon, plays, thumbnail, api } from './site.js';

const PAGE = 24;
const grid = $('#grid');
const empty = $('#empty');
const more = $('#more');
const search = $('#search');
const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];

const params = new URLSearchParams(location.search);
const state = {
  sort: params.get('sort') === 'popular' ? 'popular' : 'new',
  q: (params.get('q') || '').trim(),
  next: null,
  request: 0,
};
search.value = state.q;

function card(game) {
  return h('a', { class: 'card', href: `/play/${game.id}` },
    thumbnail(game),
    h('div', { class: 'card-body' },
      h('h3', { class: 'card-title', title: game.title }, game.title),
      h('p', { class: 'card-meta' }, icon('play', 13), plays(game.plays))));
}

function skeletons(n) {
  return Array.from({ length: n }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'thumb' }),
    h('div', { class: 'card-body' }, h('div', { class: 'line wide' }), h('div', { class: 'line' }))));
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'new') p.set('sort', state.sort);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `/?${qs}` : '/');
}

function renderChrome() {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.sort === state.sort));
  $('#intro').hidden = Boolean(state.q);
  const title = $('#results-title');
  title.hidden = !state.q;
  title.textContent = state.q ? `Results for “${state.q}”` : '';
  document.title = state.q ? `“${state.q}” · Smitten games` : 'Smitten games';
}

async function load({ append = false } = {}) {
  const id = ++state.request;
  renderChrome();
  if (!append) {
    grid.replaceChildren(...skeletons(8));
    empty.hidden = true;
  }
  more.hidden = true;
  grid.setAttribute('aria-busy', 'true');
  const p = new URLSearchParams({ sort: state.sort, limit: String(PAGE) });
  if (state.q) p.set('q', state.q);
  if (append && state.next) p.set('cursor', state.next);
  try {
    const data = await api(`/api/games?${p}`);
    if (id !== state.request) return;
    const cards = data.games.map(card);
    if (append) grid.append(...cards);
    else grid.replaceChildren(...cards);
    state.next = data.next;
    more.hidden = !data.next;
    if (!append && !data.games.length) {
      empty.hidden = false;
      empty.replaceChildren(state.q
        ? h('p', {}, `No games match “${state.q}”. Try another word.`)
        : h('p', {}, 'No games yet. Make one in the editor and choose Publish to put it here.'));
    }
  } catch (e) {
    if (id !== state.request) return;
    grid.replaceChildren();
    empty.hidden = false;
    empty.replaceChildren(h('p', {}, `The games couldn't be loaded: ${e.message}`),
      h('button', { type: 'button', class: 'btn', onclick: () => load() }, 'Try again'));
  } finally {
    if (id === state.request) grid.setAttribute('aria-busy', 'false');
  }
}

for (const t of tabs) {
  t.addEventListener('click', () => {
    if (state.sort === t.dataset.sort) return;
    state.sort = t.dataset.sort;
    syncUrl();
    load();
  });
}

let timer = 0;
search.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const q = search.value.trim();
    if (q === state.q) return;
    state.q = q;
    syncUrl();
    load();
  }, 250);
});
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(timer);
  state.q = search.value.trim();
  syncUrl();
  load();
});
more.addEventListener('click', () => load({ append: true }));

load();
