// Cloud saves on the account page: which games keep saves on this account
// (smitten.cloud, src/cloud.js), how much, and deleting a game's saves.

import { $, h, api, send, timeAgo, formatBytes, toast } from './site.js';

export async function loadSaves() {
  const list = $('#saves');
  try {
    const { games } = await api('/api/account/saves');
    if (!games.length) {
      list.replaceChildren(h('p', { class: 'fine' }, 'No game has saved anything to your account yet.'));
      return;
    }
    list.replaceChildren(...games.map((g) => {
      const remove = h('button', { type: 'button', class: 'btn ghost small' }, 'Delete saves');
      remove.addEventListener('click', async () => {
        if (!confirm(`Delete your cloud saves for “${g.title}”? The game starts again from nothing on other computers. This can't be undone.`)) return;
        try {
          await send(`/api/account/saves/${g.id}`, undefined, 'DELETE');
          toast('Deleted.');
          loadSaves();
        } catch (err) {
          toast(err.message);
        }
      });
      return h('div', { class: 'list-row save-row' },
        h('div', { class: 'grow' },
          h('a', { href: `/play/${g.id}` }, g.title),
          h('div', { class: 'fine' }, `${g.keys} save${g.keys === 1 ? '' : 's'} · ${formatBytes(g.size)} · saved ${timeAgo(g.at)}`)),
        remove);
    }));
  } catch (err) {
    list.replaceChildren(h('p', { class: 'field-error' }, err.message));
  }
}
