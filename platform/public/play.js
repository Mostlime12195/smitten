// A game's page: the game in Smitten's player, its details, Remix and Report.

import { $, h, icon, plays, timeAgo, formatBytes, editorUrl, api, send, toast } from './site.js';

const MODULE_NAMES = {
  physics2d: 'physics',
  video: 'video',
  synth: 'the sound generator',
};

const id = decodeURIComponent(location.pathname.split('/')[2] || '');
const stage = $('#stage');
let game = null;

function showNotice(kind, text) {
  stage.hidden = true;
  $('#details').hidden = true;
  const notice = $('#notice');
  notice.hidden = false;
  notice.replaceChildren(
    icon(kind === 'hidden' ? 'eyeOff' : 'alert', 28),
    h('p', {}, text),
    h('a', { class: 'btn', href: '/' }, 'Back to all games'));
}

/** The player, in an iframe from this site. The sandbox keeps games from opening pop-ups or navigating the page. */
function mountPlayer() {
  const gameUrl = `/api/games/${game.id}/${encodeURIComponent(game.title)}.zip`;
  const p = new URLSearchParams({ game: gameUrl });
  if (game.modules.length) p.set('modules', game.modules.join(','));
  p.set('title', game.title);
  // The bridge to the site's leaderboards and online rooms (below).
  p.set('site', '1');
  const frame = h('iframe', {
    id: 'player',
    src: `/player/player.html?${p}`,
    title: `${game.title} (game)`,
    allow: 'fullscreen; gamepad; autoplay',
    sandbox: 'allow-scripts allow-same-origin allow-pointer-lock allow-downloads',
    referrerpolicy: 'same-origin',
  });
  stage.replaceChildren(frame);
  frame.focus();
}

/** The site's own start screen: the game's picture, name and maker, and Play. The game only downloads once it's pressed. */
function showStartCard() {
  const play = h('button', { type: 'button', class: 'start-play', 'aria-label': `Play ${game.title}` }, icon('play', 30));
  const by = game.owner?.displayName || (game.owner?.username ? `@${game.owner.username}` : '');
  const card = h('div', { class: 'start-card' },
    game.thumbnail ? h('img', { class: 'start-shot', src: game.thumbnail, alt: '' }) : null,
    play,
    h('div', { class: 'start-info' },
      h('strong', {}, game.title),
      by ? h('span', {}, `by ${by}`) : null));
  // Anywhere on the card starts the game, not only the button.
  card.addEventListener('click', () => {
    card.classList.add('starting');
    setTimeout(() => {
      mountPlayer();
      countPlay();
    }, 160);
  }, { once: true });
  stage.replaceChildren(card);
}

// Once the game starts, the player tells us its resolution: the stage takes
// the game's shape (a phone game stands up), within reason.
window.addEventListener('message', (e) => {
  const frame = $('#player');
  const msg = e.data;
  if (!frame || e.source !== frame.contentWindow || msg?.source !== 'love-player') return;
  if (msg.type === 'site') {
    if (e.origin === location.origin) fromGame(frame, msg.message);
    return;
  }
  if (msg.type !== 'display') return;
  const w = Number(msg.width);
  const hgt = Number(msg.height);
  if (!(w > 0 && hgt > 0)) return;
  const aspect = Math.min(21 / 9, Math.max(9 / 16, w / hgt));
  document.documentElement.style.setProperty('--game-aspect', String(aspect));
});

/** 45000 → "12 h 30 min". */
function duration(seconds) {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${Math.max(1, minutes)} min`;
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

function renderMeta() {
  const parts = [];
  if (game.owner) parts.push(h('span', {}, 'by ', h('a', { href: `/u/${game.owner.username}` }, game.owner.displayName)));
  if (game.remixOf) parts.push(h('span', {}, 'Remix of ', h('a', { href: `/play/${game.remixOf.id}` }, game.remixOf.title)));
  parts.push(h('span', { id: 'plays' }, plays(game.plays)));
  if (game.remixes) parts.push(h('span', {}, `${game.remixes} remix${game.remixes === 1 ? '' : 'es'}`));
  parts.push(h('span', {}, game.version > 1 ? `Updated ${timeAgo(game.updatedAt)}` : `Published ${timeAgo(game.createdAt)}`));
  if (game.hackatime?.seconds >= 60) {
    parts.push(h('span', { title: game.hackatime.checkedAt ? `Checked ${timeAgo(game.hackatime.checkedAt)}` : null },
      `Made in ${duration(game.hackatime.seconds)} · tracked by `,
      h('a', { href: 'https://hackatime.hackclub.com', target: '_blank', rel: 'noopener' }, 'Hackatime')));
  }
  const meta = $('#meta');
  meta.replaceChildren();
  parts.forEach((part, i) => {
    if (i) meta.append(h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'));
    meta.append(part);
  });
}

function render() {
  document.title = `${game.title} · Smitten`;
  $('#details').hidden = false;
  $('#title').textContent = game.title;
  renderMeta();
  const description = $('#description');
  description.textContent = game.description;
  description.hidden = !game.description;

  const remix = $('#remix');
  remix.href = `${editorUrl()}#remix=${game.id}`;
  remix.prepend(icon('remix'));
  remix.title = 'Open a copy of this game in the editor';

  $('#fullscreen').prepend(icon('expand'));
  $('#report').prepend(icon('flag'));

  const used = game.modules.map((m) => MODULE_NAMES[m] || m);
  $('#fineprint').textContent = [
    `Made with Smitten${game.engineVersion ? ` ${game.engineVersion}` : ''}`,
    used.length ? `uses ${used.join(', ')}` : null,
    formatBytes(game.size),
  ].filter(Boolean).join(' · ');

  if (reported().includes(game.id)) markReported();
  renderBoards();
}

// ---------------------------------------------------------------------------
// Leaderboards: the game's boards under it, and the bridge that lets the
// game's scripts (smitten.boards) send and read scores.
//
// The game has no network access. Its player passes on small messages
// ({type: 'request', id, call, key, ...}); this page, and only this page,
// turns them into requests to this game's leaderboard endpoints and passes
// the answer back. The game never chooses a URL and never sees a cookie, a
// header or anything but the rows.

const BOARD_KEY = /^[a-z0-9][a-z0-9_-]{0,23}$/;
let shownBoard = null;
// The name the game last sent a guest's score under, to mark "me" in lists.
let guestName = null;
let inFlight = 0;

const two = (n) => String(n).padStart(2, '0');

/** 83.5 on a "time" board → "1:23.50"; 1200 with unit "points" → "1,200 points". */
function formatScore(board, value) {
  if (board.format === 'time') {
    const cs = Math.round(Math.abs(value) * 100);
    return `${value < 0 ? '-' : ''}${Math.floor(cs / 6000)}:${two(Math.floor((cs % 6000) / 100))}.${two(cs % 100)}`;
  }
  const text = Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return board.unit ? `${text} ${board.unit}` : text;
}

const boardUrl = (key, query = '') => `/api/games/${game.id}/boards/${encodeURIComponent(key)}${query}`;

function scoreRow(board, s) {
  const name = s.username
    ? h('a', { class: 'score-name', href: `/u/${s.username}` }, s.name)
    : h('span', { class: 'score-name guest', title: 'Not signed in' }, s.name);
  const row = h('li', { class: s.me ? 'score me' : 'score' },
    h('span', { class: 'score-rank' }, `${s.rank}.`),
    name,
    h('span', { class: 'score-value' }, formatScore(board, s.value)));
  if (game.yours) {
    // The owner takes down a fake score or a rude name.
    const remove = h('button', { type: 'button', class: 'btn ghost small', title: 'Remove this score' }, 'Remove');
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove ${s.name}'s score from the leaderboard?`)) return;
      try {
        await send(`${boardUrl(board.key)}/scores/${s.id}`, undefined, 'DELETE');
        showBoard(board.key);
      } catch (err) {
        toast(err.message);
      }
    });
    row.append(remove);
  }
  return row;
}

async function showBoard(key) {
  shownBoard = key;
  for (const tab of $('#board-tabs').children) tab.setAttribute('aria-selected', String(tab.dataset.key === key));
  const list = $('#scores');
  try {
    const query = new URLSearchParams({ limit: '10' });
    if (guestName) query.set('name', guestName);
    const { board, scores, you } = await api(boardUrl(key, `?${query}`));
    if (shownBoard !== key) return;
    if (!scores.length) {
      list.replaceChildren(h('li', { class: 'score empty' }, 'No scores yet. Play to set the first one.'));
      return;
    }
    const rows = scores.map((s) => scoreRow(board, s));
    // Your own place, when it's below the ones shown.
    if (you && !scores.some((s) => s.me)) {
      rows.push(h('li', { class: 'score me' },
        h('span', { class: 'score-rank' }, `${you.rank}.`),
        h('span', { class: 'score-name' }, 'You'),
        h('span', { class: 'score-value' }, formatScore(board, you.value))));
    }
    list.replaceChildren(...rows);
  } catch (err) {
    if (shownBoard === key) list.replaceChildren(h('li', { class: 'score empty' }, `The scores couldn't be loaded: ${err.message}`));
  }
}

function renderBoards() {
  const boards = game.boards || [];
  $('#boards').hidden = !boards.length;
  if (!boards.length) return;
  const tabs = $('#board-tabs');
  tabs.replaceChildren(...boards.map((b) => {
    const tab = h('button', { type: 'button', role: 'tab', 'data-key': b.key }, b.title);
    tab.addEventListener('click', () => showBoard(b.key));
    return tab;
  }));
  // One board needs no tabs: its title is enough.
  tabs.classList.toggle('single', boards.length === 1);
  showBoard(boards[0].key);
}

/** Why a request failed, as one word for the game's script. */
function reasonOf(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  if (!err?.status) return 'offline';
  if (err.status === 429) return 'too-many';
  if (err.data?.hidden) return 'hidden';
  return err.data?.code || 'error';
}

const gameRow = (s) => {
  const row = { rank: s.rank, name: s.name, value: s.value };
  if (s.me) row.me = true;
  if (s.guest) row.guest = true;
  return row;
};

/** One call from the game: resolves with what its script gets back. */
async function boardCall(msg) {
  const signal = AbortSignal.timeout(8000);
  if (msg.call === 'list') {
    const { boards } = await api(`/api/games/${game.id}/boards`, { signal });
    return boards.map((b) => ({ key: b.key, title: b.title, order: b.order, format: b.format, unit: b.unit, scores: b.scores }));
  }
  if (typeof msg.key !== 'string' || !BOARD_KEY.test(msg.key)) {
    const err = new Error('No such board.');
    err.status = 404;
    err.data = { code: 'no-board' };
    throw err;
  }
  if (msg.call === 'submit') {
    const name = typeof msg.name === 'string' ? msg.name.slice(0, 200) : undefined;
    const res = await api(`${boardUrl(msg.key)}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: msg.value, name }),
      signal,
    });
    if (name) guestName = name;
    if (shownBoard === msg.key) showBoard(msg.key);
    const result = { value: res.value, improved: res.improved };
    if (res.rank != null) result.rank = res.rank;
    return result;
  }
  if (msg.call === 'top' || msg.call === 'around') {
    const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Math.floor(Number(msg.count)) || 10))) });
    if (msg.call === 'around') query.set('around', '1');
    if (guestName) query.set('name', guestName);
    const { scores } = await api(boardUrl(msg.key, `?${query}`), { signal });
    return scores.map(gameRow);
  }
  throw new Error('Unknown call.');
}

/** A message from the game, through its player (web/player/player.js). */
function fromGame(frame, msg) {
  if (!game || !msg || typeof msg !== 'object') return;
  const reply = (message) => frame.contentWindow?.postMessage({ type: 'site', message }, location.origin);
  if (msg.type === 'hello') {
    // A new player (the first, or the game started again): nothing it had is open.
    netEnd(null);
    reply({ type: 'hello', boards: (game.boards || []).length > 0, net: true });
    return;
  }
  if (msg.type === 'net') {
    fromGameNet(msg);
    return;
  }
  if (msg.type !== 'request' || !Number.isSafeInteger(msg.id)) return;
  if (!game.boards?.length) {
    reply({ type: 'reply', id: msg.id, ok: false, reason: 'unavailable' });
    return;
  }
  // A game that asks faster than answers come back waits its turn.
  if (inFlight >= 4) {
    reply({ type: 'reply', id: msg.id, ok: false, reason: 'busy' });
    return;
  }
  inFlight++;
  boardCall(msg)
    .then((result) => reply({ type: 'reply', id: msg.id, ok: true, result }))
    .catch((err) => reply({ type: 'reply', id: msg.id, ok: false, reason: reasonOf(err) }))
    .finally(() => { inFlight--; });
}

// ---------------------------------------------------------------------------
// Online rooms: the bridge between the game's smitten.net and the site's
// relay (platform/src/rooms.js).
//
// This page holds the WebSocket, as it makes the leaderboard requests: the
// game only passes small messages through its player ({type: 'net', call:
// 'join' | 'leave' | 'to' | 'all', ...}) and gets the relay's messages back
// ({type: 'net', t: 'welcome' | 'joined' | 'left' | 'msg' | 'warn' |
// 'closed', ...}). The game never chooses a URL, and one bridge serves
// both. If the connection drops, the page tries again with the room's
// token for a few seconds (the relay keeps the player's place that long).
//
// Messages to the game go at most NET_PER_FRAME in each frame: the engine
// takes 256 queued messages a frame. While the tab is hidden the game
// doesn't run; then messages wait, and past NET_WAITING the game's own
// messages are dropped (never joins and leaves).

const NET_RETRIES = [300, 1000, 2000, 3000, 3000];
const NET_PER_FRAME = 48;
const NET_WAITING = 1000;
let net = null; // { s (the game's number for this join), socket, room, max, name, token, joined, tries, timer }
const netInbox = [];
let netSent = 0;
let netFrame = 0;

function toGameNet(message) {
  if (!netInbox.length && netSent < NET_PER_FRAME) {
    $('#player')?.contentWindow?.postMessage({ type: 'site', message }, location.origin);
    netSent++;
  } else if (message.t !== 'msg' || netInbox.length < NET_WAITING) {
    netInbox.push(message);
  }
  if (!netFrame) netFrame = requestAnimationFrame(netPump);
}

function netPump() {
  netFrame = 0;
  netSent = 0;
  const target = $('#player')?.contentWindow;
  for (const message of netInbox.splice(0, NET_PER_FRAME)) {
    target?.postMessage({ type: 'site', message }, location.origin);
    netSent++;
  }
  if (netInbox.length || netSent) netFrame = requestAnimationFrame(netPump);
}

/** Closes the room's connection; reason (if any) goes to the game. */
function netEnd(reason) {
  const n = net;
  if (!n) return;
  const { socket, timer } = n;
  net = null;
  clearTimeout(timer);
  if (socket) {
    socket.onclose = socket.onmessage = null;
    socket.close(1000, 'leave');
  }
  if (reason) toGameNet({ type: 'net', t: 'closed', reason, s: n.s });
}

function netConnect() {
  const n = net;
  const q = new URLSearchParams();
  if (n.max) q.set('max', String(n.max));
  if (n.name) q.set('name', n.name);
  if (n.token) q.set('resume', n.token);
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/games/${encodeURIComponent(game.id)}/rooms/${encodeURIComponent(n.room)}?${q}`);
  n.socket = socket;
  socket.onmessage = (e) => {
    if (net !== n) return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') {
      n.joined = true;
      n.token = m.token;
      n.tries = 0;
      delete m.token;
    }
    toGameNet({ ...m, type: 'net', s: n.s });
  };
  socket.onclose = (e) => {
    if (net !== n) return;
    n.socket = null;
    // The relay's own reasons are final; "expired" is a place it no longer keeps.
    if (e.code === 4000) return netEnd(e.reason === 'expired' ? 'lost' : e.reason || 'error');
    if (!n.joined) return netEnd('offline');
    if (n.tries >= NET_RETRIES.length) return netEnd('lost');
    n.timer = setTimeout(netConnect, NET_RETRIES[n.tries++]);
  };
}

// Leaving the page is leaving the room, now (a connection that only drops
// keeps its place for a while).
window.addEventListener('pagehide', () => netEnd(null));

/** A message from the game's smitten.net. */
function fromGameNet(msg) {
  if (msg.call === 'join') {
    netEnd(null);
    if (typeof msg.room !== 'string' || msg.room.length > 200) return toGameNet({ type: 'net', t: 'closed', reason: 'bad-room', s: msg.s });
    net = {
      s: msg.s,
      room: msg.room,
      max: Number.isInteger(msg.max) ? msg.max : null,
      name: typeof msg.name === 'string' ? msg.name.slice(0, 200) : null,
      token: null, joined: false, tries: 0, timer: 0, socket: null,
    };
    netConnect();
  } else if (msg.call === 'leave') {
    netEnd(null);
  } else if (msg.call === 'to' || msg.call === 'all') {
    const socket = net?.joined ? net.socket : null;
    // While it reconnects, and when the network can't keep up, messages are lost.
    if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 256 * 1024) return;
    socket.send(JSON.stringify(msg.call === 'to' ? { t: 'to', to: msg.to, d: msg.d } : { t: 'all', d: msg.d }));
  }
}

async function countPlay() {
  try {
    const res = await api(`/api/games/${game.id}/play`, { method: 'POST' });
    game.plays = res.plays;
    renderMeta();
  } catch { /* counting is best effort */ }
}

$('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.().then(() => $('#player')?.focus()).catch(() => {});
});

// ---------------------------------------------------------------------------
// Reporting

const dialog = $('#report-dialog');
const form = $('#report-form');
const errorEl = $('#report-error');
let reasons = null;

function reported() {
  try {
    return JSON.parse(localStorage.getItem('smitten-site.reported') || '[]');
  } catch {
    return [];
  }
}

function markReported() {
  const btn = $('#report');
  btn.disabled = true;
  btn.replaceChildren(icon('check'), 'Reported');
}

async function openReport() {
  errorEl.textContent = '';
  if (!reasons) {
    try {
      reasons = (await api('/api/config')).reportReasons;
    } catch (e) {
      toast(`Reporting isn't available right now: ${e.message}`);
      return;
    }
    $('#reasons').append(...reasons.map((r) => h('label', { class: 'reason' },
      h('input', { type: 'radio', name: 'reason', value: r.id, required: true }),
      h('span', {}, r.label))));
  }
  form.reset();
  dialog.showModal();
}

$('#report').addEventListener('click', openReport);
$('#report-cancel').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = form.querySelector('input[name="reason"]:checked')?.value;
  if (!reason) {
    errorEl.textContent = 'Pick what is wrong with the game.';
    return;
  }
  const send = $('#report-send');
  send.disabled = true;
  errorEl.textContent = '';
  try {
    await api(`/api/games/${game.id}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, note: $('#report-note').value }),
    });
    try {
      localStorage.setItem('smitten-site.reported', JSON.stringify([...reported(), game.id].slice(-200)));
    } catch { /* private mode */ }
    dialog.close();
    markReported();
    toast('Thanks for telling us. A moderator will take a look.');
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    send.disabled = false;
  }
});

// ---------------------------------------------------------------------------

async function main() {
  if (!id) {
    showNotice('missing', "This game doesn't exist, or it was deleted.");
    return;
  }
  try {
    ({ game } = await api(`/api/games/${encodeURIComponent(id)}`));
  } catch (e) {
    showNotice(e.data?.hidden ? 'hidden' : 'missing', e.status === 404 ? e.message : `The game couldn't be loaded: ${e.message}`);
    return;
  }
  render();
  showStartCard();
}

main();
