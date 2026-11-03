// Publishing to Smitten's game-sharing site (platform/ in this repository),
// and remixing games from it.
//
//   publishDialog(project, { files, modules, platformUrl })
//     The Publish dialog: title, description and an optional thumbnail (a PNG
//     from the project), then uploads the game as a .love. Games belong to
//     accounts on the site, so it asks you to sign in first (account.js)
//     and says who's publishing. Which game a project was published as is
//     kept in localStorage under "smitten-editor.published"
//     ({[gameId]: {projectId, owner, ...}}), so publishing the same project
//     again updates the game (same link), and the dialog can remove it from
//     the site. Resolves with {id, url, version}, {deleted: id}, or null if
//     cancelled.
//
//   claimLocalGames(platformUrl)
//     Games published from this browser before accounts have an edit token
//     in "smitten-editor.published". Signing in claims them for the account
//     (it runs on its own whenever the account changes).
//
//   fetchRemix(platformUrl, gameId) -> {name, files, remixOf}
//     A published game's files, to open as a new project (for
//     <editor>#remix=<id>). When that project is published, the game records
//     it as a remix: call rememberRemix(newProjectId, gameId) after creating
//     the project (or pass {remixOf} to publishDialog). Without either, a
//     project created right after fetchRemix with the returned name is
//     recognized as the remix.

import { h, openDialog, confirmDialog, toast, formatBytes } from './ui.js';
import { buildLove, unzipToProjectFiles } from './exporter.js';
import { account, accountToken, clearAccount, onChange, refreshAccount, signIn, signOut } from './account.js';

const PUBLISHED_KEY = 'smitten-editor.published';
const REMIXES_KEY = 'smitten-editor.remixes';
const PENDING_REMIX_KEY = 'smitten-editor.remix-pending';

export const DEFAULT_PLATFORM_URL = 'http://localhost:8787';
// Smitten's version (web/editor/core/project.js, ENGINE_VERSION), sent with
// each game; publishDialog's engineVersion option overrides it.
const SMITTEN_VERSION = '0.2.0';

// The site's limits (it checks them too: platform/wrangler.toml).
const MAX_GAME_BYTES = 25 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 1024 * 1024;
const MAX_TITLE = 60;
const MAX_DESCRIPTION = 1000;

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// localStorage

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Couldn't save ${key}:`, e);
  }
}

const baseUrl = (url) => String(url || DEFAULT_PLATFORM_URL).replace(/\/+$/, '');

/** Every game published from this browser: {[gameId]: {projectId, owner, title, url, platformUrl, ...}}. */
export function publishedGames() {
  return readJSON(PUBLISHED_KEY, {});
}

/** The game a project was published as on this site: {id, ...entry} or null. */
export function publishedGameFor(projectId, platformUrl = DEFAULT_PLATFORM_URL) {
  const base = baseUrl(platformUrl);
  for (const [id, entry] of Object.entries(publishedGames())) {
    if (entry.projectId === projectId && baseUrl(entry.platformUrl) === base) return { id, ...entry };
  }
  return null;
}

function savePublished(id, entry) {
  writeJSON(PUBLISHED_KEY, { ...publishedGames(), [id]: entry });
}

function forgetPublished(id) {
  const all = publishedGames();
  delete all[id];
  writeJSON(PUBLISHED_KEY, all);
}

/**
 * Claims the games this browser published before accounts (the ones it has
 * edit tokens for) for the signed-in account. Resolves with the number
 * claimed.
 */
const claiming = new Map();

export function claimLocalGames(platformUrl = DEFAULT_PLATFORM_URL) {
  const base = baseUrl(platformUrl);
  if (!claiming.has(base)) claiming.set(base, claim(base).finally(() => claiming.delete(base)));
  return claiming.get(base);
}

async function claim(base) {
  const user = account(base);
  const token = accountToken(base);
  const all = publishedGames();
  const games = Object.entries(all)
    .filter(([, e]) => e.token && !e.claimFailed && baseUrl(e.platformUrl) === base)
    .map(([id, e]) => ({ id, token: e.token }));
  if (!user || !token || !games.length) return 0;
  let res;
  try {
    res = await request(`${base}/api/account/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: games.slice(0, 100) }),
    });
  } catch (e) {
    if (e.status === 401) clearAccount(base);
    return 0;
  }
  const now = publishedGames();
  for (const id of [...res.claimed, ...res.owned]) {
    if (!now[id]) continue;
    const { token: _, ...rest } = now[id];
    now[id] = { ...rest, owner: user.username };
  }
  for (const { id, reason } of res.failed) {
    if (!now[id]) continue;
    if (reason === 'missing') delete now[id];
    else now[id] = { ...now[id], claimFailed: reason };
  }
  writeJSON(PUBLISHED_KEY, now);
  return res.claimed.length;
}

// Signing in claims this browser's old games.
onChange((user, platformUrl) => {
  if (!user) return;
  claimLocalGames(platformUrl).then((n) => {
    if (n) toast(`Added ${n} game${n === 1 ? '' : 's'} you published from this browser to your account.`, { type: 'success', timeout: 5000 });
  });
});

/** Records that a project is a remix of a published game. */
export function rememberRemix(projectId, gameId) {
  writeJSON(REMIXES_KEY, { ...readJSON(REMIXES_KEY, {}), [projectId]: gameId });
}

function remixOriginOf(project) {
  const known = readJSON(REMIXES_KEY, {})[project.id];
  if (known) return known;
  // A project created within a few minutes after fetchRemix, under the name
  // it returned, is that remix.
  const pending = readJSON(PENDING_REMIX_KEY, null);
  const created = project.meta?.created;
  if (pending && created && created >= pending.at - 5000 && created - pending.at < 10 * 60_000
    && (project.meta?.name === pending.name || project.name === pending.name)) {
    rememberRemix(project.id, pending.gameId);
    localStorage.removeItem(PENDING_REMIX_KEY);
    return pending.gameId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Talking to the site

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(`Couldn't reach ${new URL(url).host}. Check your connection, or whether the site is running.`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || `The site answered ${res.status}.`), { status: res.status, data });
  return data;
}

let activeUpload = null;

/** Uploads with progress (fetch can't report upload progress). */
function upload(method, url, body, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeUpload = xhr;
    xhr.onloadend = () => { if (activeUpload === xhr) activeUpload = null; };
    xhr.open(method, url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(data?.error || `The site answered ${xhr.status}.`), { status: xhr.status, data }));
    };
    xhr.onerror = () => reject(new Error(`Couldn't reach ${new URL(url).host}. Check your connection, or whether the site is running.`));
    xhr.onabort = () => reject(Object.assign(new Error('Cancelled.'), { aborted: true }));
    xhr.send(body);
  });
}

const byteLength = (data) => (typeof data === 'string' ? encoder.encode(data).length : data?.byteLength || 0);
const asBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

function isPng(bytes) {
  return bytes?.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

// ---------------------------------------------------------------------------
// The Publish dialog

/**
 * Asks the person to sign in before publishing. Resolves with the user, or
 * null if they'd rather not.
 */
async function askToSignIn(base, host, reason) {
  let pending = null;
  await openDialog({
    title: 'Sign in to publish',
    body: h('div', {},
      reason ? h('p', { class: 'dialog-message', style: { margin: '0 0 12px' } }, reason) : null,
      h('p', { class: 'dialog-message', style: { margin: '0 0 12px' } },
        `Games on ${host} belong to accounts, so you can update them from any computer. Sign in, or make an account: it takes a minute and doesn't need an email.`)),
    actions: [
      { label: 'Cancel', value: null, ghost: true },
      // The popup opens inside the click (browsers block popups otherwise).
      { label: 'Sign in', value: 'sign-in', primary: true, submit: true, validate: () => { pending = signIn({ platformUrl: base }); return true; } },
    ],
  });
  if (!pending) return null;
  try {
    return await pending;
  } catch (e) {
    toast(e.message, { type: 'error' });
    return null;
  }
}

export async function publishDialog(project, { files, modules = [], platformUrl = DEFAULT_PLATFORM_URL, engineVersion, remixOf } = {}) {
  files = files || project.snapshot();
  const base = baseUrl(platformUrl);
  const host = new URL(base).host;

  // Signed in? (The site may have signed this editor out since.)
  const hadAccount = Boolean(account(base));
  let user = hadAccount ? await refreshAccount(base) : null;
  if (!user) {
    user = await askToSignIn(base, host, hadAccount ? `${host} signed this editor out (a new password, or signed out from its settings).` : null);
    if (!user) return null;
  }
  await claimLocalGames(base);
  const auth = () => ({ Authorization: `Bearer ${accountToken(base)}` });

  let existing = publishedGameFor(project.id, base);
  let notice = null;
  if (existing && existing.owner && existing.owner !== user.username) {
    notice = `This project was published by @${existing.owner}. You're signed in as @${user.username}, so publishing makes a new game.`;
    existing = null;
  } else if (existing && !existing.owner && existing.claimFailed) {
    notice = existing.claimFailed === 'owned'
      ? 'The game this project was published as belongs to another account now, so publishing makes a new game.'
      : "The game this project was published as couldn't be added to your account, so publishing makes a new game.";
    existing = null;
  }

  // What the site has now (the title and description may have been changed
  // from another browser), or whether the game is gone.
  let current = null;
  if (existing) {
    try {
      current = (await request(`${base}/api/games/${existing.id}`, { headers: auth() })).game;
    } catch (e) {
      if (e.status === 404) {
        forgetPublished(existing.id);
        existing = null;
        notice = "The game you published from this project isn't on the site anymore, so this publishes it as a new game.";
      }
      // Otherwise (offline, server error), carry on with what's saved here.
    }
    if (current?.status && current.status !== 'public') {
      notice = 'This game is hidden while a moderator reviews it. You can still publish updates; it comes back once they have.';
    }
  }

  const settings = typeof project.settings === 'function' ? project.settings() : {};
  const origin = remixOf ?? project.meta?.remixOf ?? settings.remixOf ?? remixOriginOf(project);
  const version = engineVersion || settings.engine || SMITTEN_VERSION;

  // Fields
  const titleInput = h('input', {
    type: 'text', class: 'input', maxlength: String(MAX_TITLE), spellcheck: 'true', autocomplete: 'off', 'aria-label': 'Title',
    value: current?.title || existing?.title || project.name || '',
  });
  const descInput = h('textarea', {
    class: 'input', rows: '4', maxlength: String(MAX_DESCRIPTION), 'aria-label': 'Description',
    placeholder: 'How to play, the controls, what it’s about…',
    style: { height: 'auto', minHeight: '88px', padding: '8px 10px', resize: 'vertical', font: 'inherit', lineHeight: '1.45' },
  });
  descInput.value = current?.description ?? existing?.description ?? '';

  const pngs = Object.keys(files).filter((p) => /\.png$/i.test(p)).sort();
  const guess = existing?.thumbnail && pngs.includes(existing.thumbnail) ? existing.thumbnail
    : existing ? '' : pngs.find((p) => /(^|\/)(thumbnail|cover|icon|title)\.png$/i.test(p)) || '';
  const thumbSelect = h('select', { class: 'select input', 'aria-label': 'Thumbnail', style: { width: '100%', height: '34px' } },
    h('option', { value: '' }, 'None (the gallery draws a placeholder)'),
    pngs.map((p) => h('option', { value: p, selected: p === guess }, p)));
  const preview = h('div', {
    style: {
      aspectRatio: '16 / 9', width: '160px', flex: 'none', borderRadius: '6px', overflow: 'hidden',
      background: 'var(--panel-2)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center',
      color: 'var(--fg-subtle)', fontSize: '12px',
    },
  });
  let previewUrl = null;
  const thumbError = h('div', { class: 'field-error' });
  const showPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    thumbError.textContent = '';
    const path = thumbSelect.value;
    if (!path) {
      preview.replaceChildren('No thumbnail');
      return;
    }
    const bytes = asBytes(files[path]);
    if (!isPng(bytes)) thumbError.textContent = "That file isn't a PNG image.";
    else if (bytes.length > MAX_THUMBNAIL_BYTES) thumbError.textContent = `That image is ${formatBytes(bytes.length)}; thumbnails can be at most 1 MB.`;
    previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    preview.replaceChildren(h('img', { src: previewUrl, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }));
  };
  thumbSelect.addEventListener('change', showPreview);
  showPreview();

  const titleError = h('div', { class: 'field-error' });
  const descError = h('div', { class: 'field-error' });
  const status = h('div', { class: 'field-error', role: 'alert', style: { minHeight: '0' } });
  const bar = h('div', { style: { height: '100%', width: '0%', background: 'var(--accent)', transition: 'width .15s' } });
  const progress = h('div', { hidden: true, style: { height: '4px', borderRadius: '2px', background: 'var(--panel-2)', overflow: 'hidden', marginTop: '12px' } }, bar);
  const progressLabel = h('div', { class: 'insp-desc', hidden: true, style: { marginTop: '6px', fontSize: '12px', color: 'var(--fg-muted)' } });

  const totalBytes = Object.values(files).reduce((n, d) => n + byteLength(d), 0);
  const p = (...children) => h('p', { class: 'dialog-message', style: { margin: '0 0 12px' } }, ...children);
  const intro = existing
    ? p('This project is published at ', h('a', { href: existing.url, target: '_blank', rel: 'noopener' }, existing.url.replace(/^https?:\/\//, '')),
      '. Publishing again updates that game: the link stays the same.')
    : p(`Your game goes on ${host}, where anyone can play it and remix it into their own game.`);
  const field = (label, input, error, extra) => h('div', { class: 'field', style: { marginBottom: '10px' } }, h('label', {}, label), input, extra, error);

  // Remixes say what they remix (only new games: it's fixed once published).
  const remixNote = origin && !existing ? p(`It's a remix, so its page will link to the game it came from (${origin}).`) : null;
  if (remixNote) {
    request(`${base}/api/games/${origin}`).then(({ game }) => {
      remixNote.textContent = `It's a remix of “${game.title}”, so its page will link to that game.`;
    }).catch(() => {});
  }

  // Who's publishing, and a way to switch.
  const who = h('strong', {});
  const showWho = () => { who.textContent = `${user.displayName} (@${user.username})`; };
  showWho();
  const switchAccount = h('a', { href: '#' }, 'Switch account');
  switchAccount.addEventListener('click', async (e) => {
    e.preventDefault();
    if (busy) return;
    const next = await signIn({ platformUrl: base }).catch((err) => { status.textContent = err.message; return null; });
    if (!next) return;
    if (next.username !== user.username && existing) {
      // The game belongs to the other account.
      finishDialog(null);
      publishDialog(project, { files, modules, platformUrl, engineVersion, remixOf });
      return;
    }
    user = next;
    showWho();
  });
  const signOutLink = h('a', { href: '#' }, 'Sign out');
  signOutLink.addEventListener('click', async (e) => {
    e.preventDefault();
    if (busy) return;
    await signOut({ platformUrl: base });
    toast(`Signed out of ${host}.`);
    finishDialog(null);
  });
  const whoLine = h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 12px', padding: '8px 10px',
      borderRadius: '6px', background: 'var(--panel-2)', fontSize: '12px', color: 'var(--fg-muted)',
    },
  }, h('span', { style: { flex: '1', minWidth: '0' } }, 'Publishing as ', who), switchAccount, h('span', { 'aria-hidden': 'true' }, '·'), signOutLink);

  const form = h('div', {},
    whoLine,
    notice ? p(notice) : null,
    intro,
    remixNote,
    field('Title', titleInput, titleError),
    field('Description', descInput, descError),
    h('div', { class: 'field', style: { marginBottom: '10px' } },
      h('label', {}, 'Thumbnail'),
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
        preview,
        h('div', { style: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '6px' } },
          thumbSelect,
          h('div', { style: { fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.45' } },
            pngs.length ? 'A PNG from your project, up to 1 MB. 16:9 looks best.' : 'Add a PNG to the project to use it as the thumbnail.'))),
      thumbError),
    h('p', { style: { margin: '6px 0 0', fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.5' } },
      'Keep personal information out of your game, its title and description: no full names, school, address or photos of yourself. ',
      `About ${formatBytes(totalBytes)} before compression; the limit is 25 MB.`),
    progress, progressLabel, status);

  let busy = false;
  let dialog = null;
  let finishDialog = null;
  let result = null;

  const setBusy = (on) => {
    busy = on;
    for (const el of [titleInput, descInput, thumbSelect]) el.disabled = on;
    for (const b of dialog.querySelectorAll('.dialog-footer .btn')) if (!b.dataset.cancel) b.disabled = on;
  };
  const showProgress = (label, fraction = null) => {
    progress.hidden = false;
    progressLabel.hidden = false;
    progressLabel.textContent = label;
    bar.style.width = fraction == null ? '15%' : `${Math.round(fraction * 100)}%`;
  };
  const hideProgress = () => { progress.hidden = true; progressLabel.hidden = true; };

  function check() {
    titleError.textContent = '';
    descError.textContent = '';
    status.textContent = '';
    const title = titleInput.value.replace(/\s+/g, ' ').trim();
    if (!title) titleError.textContent = 'Give your game a title.';
    else if ([...title].length > MAX_TITLE) titleError.textContent = `${MAX_TITLE} characters at most.`;
    if ([...descInput.value.trim()].length > MAX_DESCRIPTION) descError.textContent = `${MAX_DESCRIPTION} characters at most.`;
    return !titleError.textContent && !descError.textContent && !thumbError.textContent ? title : null;
  }

  async function publish() {
    if (busy) return;
    const title = check();
    if (!title) return;
    setBusy(true);
    try {
      showProgress('Packing the game…');
      const love = await buildLove(files);
      if (love.length > MAX_GAME_BYTES) {
        throw new Error(`The game is ${formatBytes(love.length)} packed; the limit is 25 MB. Remove files it doesn't use, or make images and sounds smaller.`);
      }
      const thumbPath = thumbSelect.value || null;
      const body = new FormData();
      body.append('meta', JSON.stringify({
        title,
        description: descInput.value.trim(),
        modules,
        engineVersion: version,
        remixOf: existing ? undefined : origin || undefined,
      }));
      body.append('game', new Blob([love], { type: 'application/zip' }), 'game.love');
      if (thumbPath) body.append('thumbnail', new Blob([asBytes(files[thumbPath])], { type: 'image/png' }), 'thumbnail.png');

      const onProgress = (f) => showProgress(f < 1 ? `Uploading… ${Math.round(f * 100)}%` : 'Saving…', f);
      showProgress('Uploading…', 0);
      let res;
      if (existing) {
        try {
          res = await upload('PUT', `${base}/api/games/${existing.id}`, body, accountToken(base), onProgress);
        } catch (e) {
          if (e.status !== 404 && e.status !== 403) throw e;
          // Deleted from the site, or it belongs to another account.
          forgetPublished(existing.id);
          existing = null;
          throw new Error(e.status === 404
            ? "That game isn't on the site anymore. Press Publish to publish it as a new game."
            : `That game belongs to another account. Press Publish to publish it as a new game for @${user.username}.`);
        }
      } else {
        res = await upload('POST', `${base}/api/games`, body, accountToken(base), onProgress);
      }

      const game = res.game;
      const now = Date.now();
      const id = res.id;
      const previous = publishedGames()[id];
      savePublished(id, {
        projectId: project.id,
        owner: user.username,
        title: game.title,
        description: game.description,
        url: game.playUrl,
        platformUrl: base,
        thumbnail: thumbPath,
        version: game.version,
        publishedAt: previous?.publishedAt || now,
        updatedAt: now,
      });
      result = { id, url: game.playUrl, version: game.version };
      showDone(game, Boolean(existing));
    } catch (e) {
      hideProgress();
      if (e.status === 401) {
        // Signed out on the site (a new password, or signed out in its settings).
        clearAccount(base);
        status.replaceChildren(`${e.message} `, signInAgainLink());
        setBusy(false);
        return;
      }
      if (!e.aborted) {
        const field = e.data?.field;
        (field === 'title' ? titleError : field === 'description' ? descError : field === 'thumbnail' ? thumbError : status).textContent = e.message;
      }
      setBusy(false);
      if (!existing) {
        const primary = dialog.querySelector('.dialog-footer .btn.primary');
        if (primary) primary.textContent = 'Publish';
        dialog.querySelector('.dialog-footer .btn.danger')?.remove();
        dialog.querySelector('.dialog-header h2').textContent = 'Publish to Smitten';
      }
    }
  }

  function showDone(game, updated) {
    busy = false;
    const link = h('input', { type: 'text', class: 'input', readonly: true, value: game.playUrl, style: { flex: '1', fontFamily: 'var(--font-mono)', fontSize: '12px' } });
    const hidden = game.status && game.status !== 'public';
    dialog.querySelector('.dialog-header h2').textContent = updated ? 'Game updated' : 'Your game is published';
    dialog.querySelector('.dialog-body').replaceChildren(h('div', {},
      p(hidden
        ? 'The update is saved, but the game is hidden while a moderator reviews it. It comes back once they have.'
        : updated
          ? `Everyone playing ${game.title} now gets this version. The link stays the same:`
          : `${game.title} is live. Share this link, or find it in the gallery:`),
      h('div', { class: 'share-box', style: { display: 'flex', gap: '8px' } }, link),
      h('p', { style: { margin: '12px 0 0', fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.5' } },
        `It's in your account, @${user.username}. Publish again from this project to update it; you can also remove it from your account page on ${host}.`)));
    const copy = h('button', { type: 'button', class: 'btn' }, 'Copy link');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(game.playUrl);
        toast('Link copied.', { type: 'success' });
      } catch {
        link.select();
      }
    });
    const open = h('a', { class: 'btn primary', href: game.playUrl, target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, 'Open game');
    const done = h('button', { type: 'button', class: 'btn ghost' }, 'Done');
    done.addEventListener('click', () => finishDialog('done'));
    dialog.querySelector('.dialog-footer').replaceChildren(done, copy, open);
    open.focus();
  }

  async function remove() {
    if (busy || !existing) return;
    const ok = await confirmDialog({
      title: 'Remove from the site?',
      message: `“${existing.title}” will be deleted from ${host}: its link stops working and it leaves the gallery. Your project stays here.`,
      okLabel: 'Remove game',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    status.textContent = '';
    try {
      await request(`${base}/api/games/${existing.id}`, { method: 'DELETE', headers: auth() });
      forgetPublished(existing.id);
      result = { deleted: existing.id };
      toast('Removed from the site.', { type: 'success' });
      finishDialog('deleted');
    } catch (e) {
      if (e.status === 404) {
        forgetPublished(existing.id);
        result = { deleted: existing.id };
        finishDialog('deleted');
        return;
      }
      if (e.status === 401) {
        clearAccount(base);
        status.replaceChildren(`${e.message} `, signInAgainLink());
      } else {
        status.textContent = e.message;
      }
      setBusy(false);
    }
  }

  function signInAgainLink() {
    const link = h('a', { href: '#' }, 'Sign in again');
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const next = await signIn({ platformUrl: base }).catch(() => null);
      if (!next) return;
      status.textContent = next.username === user.username ? 'Signed in. Press Publish again.' : `Signed in as @${next.username}.`;
      if (next.username !== user.username && existing) {
        finishDialog(null);
        publishDialog(project, { files, modules, platformUrl, engineVersion, remixOf });
        return;
      }
      user = next;
      showWho();
    });
    return link;
  }

  const actions = [
    existing ? { label: 'Remove from site', value: 'remove', danger: true, left: true, validate: () => { remove(); return false; } } : null,
    { label: 'Cancel', value: null, ghost: true },
    { label: existing ? 'Publish update' : 'Publish', value: 'publish', primary: true, submit: true, validate: () => { publish(); return false; } },
  ].filter(Boolean);

  await openDialog({
    title: existing ? 'Publish an update' : 'Publish to Smitten',
    body: form,
    actions,
    onOpen: (dlg, finish) => {
      dialog = dlg;
      finishDialog = finish;
      const cancel = [...dlg.querySelectorAll('.dialog-footer .btn')].find((b) => b.textContent === 'Cancel');
      if (cancel) cancel.dataset.cancel = '1';
      dlg.addEventListener('close', () => { if (busy) activeUpload?.abort(); });
      titleInput.focus();
      titleInput.select();
    },
  });
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  return result;
}

// ---------------------------------------------------------------------------
// Remixing

/** A published game's files, to open as a new project: {name, files, remixOf}. */
export async function fetchRemix(platformUrl, gameId) {
  const base = baseUrl(platformUrl);
  if (!/^[0-9a-z]{6,20}$/.test(String(gameId))) throw new Error("That isn't a game id.");
  const { game } = await request(`${base}/api/games/${gameId}`);
  let res;
  try {
    res = await fetch(game.gameUrl || `${base}/api/games/${gameId}/game.love`);
  } catch {
    throw new Error(`Couldn't reach ${new URL(base).host} to download the game.`);
  }
  if (!res.ok) throw new Error(`The game couldn't be downloaded (${res.status}).`);
  const files = await unzipToProjectFiles(new Uint8Array(await res.arrayBuffer()));

  const name = `${game.title} (remix)`.slice(0, 80);
  // The project's name lives in smitten.json when there is one.
  if (typeof files['smitten.json'] === 'string') {
    try {
      const manifest = JSON.parse(files['smitten.json']);
      if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
        manifest.name = name;
        files['smitten.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
      }
    } catch { /* leave it as it is */ }
  }
  writeJSON(PENDING_REMIX_KEY, { gameId: game.id, name, at: Date.now() });
  return { name, files, remixOf: game.id, title: game.title };
}
