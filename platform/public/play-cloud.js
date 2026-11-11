// Cloud saves on a game's page: the games site's side of smitten.cloud.
//
// The game's player passes on its calls ({type: 'request', id, call:
// 'cloud.save' | 'cloud.load' | 'cloud.list' | 'cloud.remove', key, data});
// play.js gives them to cloudCall(), which turns them into requests to the
// saves of this game on the signed-in account (src/cloud.js), and passes
// the answer back. The game never chooses the URL or the game: the page
// does. Messages and answers: docs/host-interface.md.

import { api } from './site.js';

const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** What the page tells the game in its hello (docs/host-interface.md). */
export const HOST = { name: 'smitten-games', version: '1' };

export const isCloudCall = (msg) => typeof msg.call === 'string' && msg.call.startsWith('cloud.');

function refusal(status, code) {
  const err = new Error(code);
  err.status = status;
  err.data = { code };
  return err;
}

/** One cloud call from the game of id: resolves with what its script gets back. */
export async function cloudCall(id, msg) {
  const signal = AbortSignal.timeout(8000);
  const base = `/api/games/${id}/saves`;
  if (msg.call === 'cloud.list') {
    const { saves } = await api(base, { signal });
    return saves.map((s) => ({ key: s.key, size: s.size, time: Math.floor(s.at / 1000) }));
  }
  if (typeof msg.key !== 'string' || !KEY.test(msg.key)) throw refusal(422, 'bad-key');
  const url = `${base}/${encodeURIComponent(msg.key)}`;
  if (msg.call === 'cloud.load') {
    try {
      const save = await api(url, { signal });
      return { data: save.data, time: Math.floor(save.at / 1000) };
    } catch (err) {
      if (err.status === 404 && err.data?.code === 'missing') return { data: null };
      throw err;
    }
  }
  if (msg.call === 'cloud.save') {
    if (typeof msg.data !== 'string') throw refusal(422, 'bad-value');
    const save = await api(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: msg.data }),
      signal,
    });
    return { size: save.size, time: Math.floor(save.at / 1000) };
  }
  if (msg.call === 'cloud.remove') {
    const res = await api(url, { method: 'DELETE', signal });
    return { removed: res.deleted };
  }
  throw refusal(400, 'unknown-call');
}
