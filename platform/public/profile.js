// Someone's page: /u/<username>, their name and their public games.

import { $, h, icon, api, card, skeletons, timeAgo, account } from './site.js';

const username = decodeURIComponent(location.pathname.split('/')[2] || '');
const grid = $('#grid');
const more = $('#more');
let next = null;

function notFound(text) {
  $('#intro').hidden = true;
  grid.hidden = true;
  const notice = $('#notice');
  notice.hidden = false;
  notice.replaceChildren(icon('alert', 28), h('p', {}, text), h('a', { class: 'btn', href: '/' }, 'Back to all games'));
}

async function loadGames(append = false) {
  if (!append) grid.replaceChildren(...skeletons(4));
  more.hidden = true;
  grid.setAttribute('aria-busy', 'true');
  const p = new URLSearchParams({ user: username, sort: 'new', limit: '24' });
  if (append && next) p.set('cursor', next);
  try {
    const data = await api(`/api/games?${p}`);
    const cards = data.games.map((g) => card(g, { showOwner: false }));
    if (append) grid.append(...cards);
    else grid.replaceChildren(...cards);
    next = data.next;
    more.hidden = !next;
    if (!append && !data.games.length) {
      $('#empty').hidden = false;
      $('#empty').replaceChildren(h('p', {}, 'No games here yet.'));
    }
  } catch (e) {
    grid.replaceChildren();
    $('#empty').hidden = false;
    $('#empty').replaceChildren(h('p', {}, `The games couldn't be loaded: ${e.message}`));
  } finally {
    grid.setAttribute('aria-busy', 'false');
  }
}

async function main() {
  let user;
  try {
    ({ user } = await api(`/api/users/${encodeURIComponent(username)}`));
  } catch (e) {
    notFound(e.status === 404 ? "There's no one here with that name." : `This page couldn't be loaded: ${e.message}`);
    return;
  }
  document.title = `${user.displayName} · Smitten`;
  $('#name').textContent = user.displayName;
  const parts = [`@${user.username}`, `${user.games} game${user.games === 1 ? '' : 's'}`, `joined ${timeAgo(user.createdAt)}`];
  $('#meta').textContent = parts.join(' · ');
  account().then((me) => {
    if (me?.username === user.username) $('#meta').append(' · ', h('a', { href: '/account' }, 'Your account'));
  });
  loadGames();
}

more.addEventListener('click', () => loadGames(true));
main();
