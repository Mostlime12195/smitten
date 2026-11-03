// A game's page: the game in Smitten's player, its details, Remix and Report.

import { $, h, icon, plays, timeAgo, formatBytes, editorUrl, api, toast } from './site.js';

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
  const loveUrl = `/api/games/${game.id}/${encodeURIComponent(game.title)}.love`;
  const p = new URLSearchParams({ game: loveUrl });
  if (game.modules.length) p.set('modules', game.modules.join(','));
  const frame = h('iframe', {
    id: 'player',
    src: `/player/player.html?${p}`,
    title: `${game.title} (game)`,
    allow: 'fullscreen; gamepad; autoplay',
    sandbox: 'allow-scripts allow-same-origin allow-pointer-lock allow-downloads',
    referrerpolicy: 'same-origin',
  });
  stage.replaceChildren(frame);
}

// Once the game starts, the player tells us its resolution: the stage takes
// the game's shape (a phone game stands up), within reason.
window.addEventListener('message', (e) => {
  const frame = $('#player');
  const msg = e.data;
  if (!frame || e.source !== frame.contentWindow || msg?.source !== 'love-player' || msg.type !== 'display') return;
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
  mountPlayer();
  countPlay();
}

main();
