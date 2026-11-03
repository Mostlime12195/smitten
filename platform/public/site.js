// Shared helpers for the gallery and the play page.

export const $ = (sel, root = document) => root.querySelector(sel);

/** h('a', {class: 'x', href}, child, 'text') */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  play: '<polygon points="7 4 19 12 7 20 7 4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  remix: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  eyeOff: '<path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};

export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

/** The editor's URL, which the server writes into <meta name="smitten-editor-url">. */
export function editorUrl() {
  return document.querySelector('meta[name="smitten-editor-url"]')?.content || 'http://localhost:8766/';
}

export function formatCount(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

export function plays(n) {
  return `${formatCount(n)} play${n === 1 ? '' : 's'}`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A game's thumbnail, or a placeholder with its first letter. */
export function thumbnail(game) {
  if (game.thumbnail) {
    return h('div', { class: 'thumb' }, h('img', { src: game.thumbnail, alt: '', loading: 'lazy', decoding: 'async' }));
  }
  let hash = 0;
  for (const c of game.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const letter = [...(game.title.match(/[\p{L}\p{N}]/u)?.[0] || '?')][0].toUpperCase();
  return h('div', { class: `thumb placeholder shade-${hash % 4}` }, h('span', {}, letter));
}

/** A game's card in a grid. */
export function card(game, { showOwner = true } = {}) {
  const meta = [icon('play', 13), plays(game.plays)];
  if (showOwner && game.owner) meta.unshift(h('span', { class: 'card-owner' }, game.owner.displayName), h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'));
  return h('a', { class: 'card', href: `/play/${game.id}` },
    thumbnail(game),
    h('div', { class: 'card-body' },
      h('h3', { class: 'card-title', title: game.title }, game.title),
      h('p', { class: 'card-meta' }, meta)));
}

export function skeletons(n) {
  return Array.from({ length: n }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'thumb' }),
    h('div', { class: 'card-body' }, h('div', { class: 'line wide' }), h('div', { class: 'line' }))));
}

let toastTimer = 0;
export function toast(message) {
  let el = $('#toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export async function api(path, options = {}) {
  const res = await fetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** JSON requests from the site's pages. */
export function send(path, body, method = 'POST') {
  return api(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let accountPromise = null;
/** /api/account: {user, recoveryCodesLeft} (user is null when signed out). */
export function accountDetails() {
  accountPromise ??= api('/api/account').catch(() => ({ user: null }));
  return accountPromise;
}
/** The signed-in account ({username, displayName, ...}) or null. */
export const account = () => accountDetails().then((d) => d.user);

let configPromise = null;
export function siteConfig() {
  configPromise ??= api('/api/config');
  return configPromise;
}

/** A local path from ?next= to go back to (never another site). */
export function nextPath(fallback = '/') {
  const next = new URLSearchParams(location.search).get('next') || '';
  return /^\/(?![/\\])\S*$/.test(next) ? next : fallback;
}

/** Shows an API error next to its field ([data-error-for="field"]), or in the form's general one. */
export function showError(form, err) {
  clearErrors(form);
  const field = err?.data?.field;
  const target = (field && form.querySelector(`[data-error-for="${field}"]`)) || form.querySelector('[data-error-for="form"]');
  if (target) target.textContent = err?.message || String(err);
  const input = field && form.querySelector(`[name="${field}"]`);
  if (input) input.focus();
}

export function clearErrors(form) {
  for (const el of form.querySelectorAll('[data-error-for]')) el.textContent = '';
}

/** Recovery codes, with Copy and Download. */
export function codesBlock(codes) {
  const text = `Smitten recovery codes for ${location.host}\nEach one resets your password once.\n\n${codes.join('\n')}\n`;
  const copy = h('button', { type: 'button', class: 'btn' }, 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.');
    } catch {
      toast("Couldn't copy. Select the codes and copy them yourself.");
    }
  });
  const download = h('a', { class: 'btn', download: 'smitten-recovery-codes.txt' }, 'Download');
  download.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  return h('div', { class: 'codes-block' },
    h('ol', { class: 'codes' }, codes.map((c) => h('li', {}, c))),
    h('div', { class: 'row-actions' }, copy, download));
}

// The header: "Make a game" opens the editor; Sign in, or the account.
for (const a of document.querySelectorAll('[data-editor-link]')) a.href = editorUrl();

const topbar = document.querySelector('.topbar-inner');
if (topbar && !('noAccountLink' in document.body.dataset)) {
  account().then((user) => {
    const link = user
      ? h('a', { class: 'btn ghost account-link', href: '/account', title: `Signed in as @${user.username}` }, icon('user'), h('span', {}, user.displayName))
      : h('a', { class: 'btn ghost account-link', href: `/signin?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Sign in');
    const make = topbar.querySelector('.make');
    if (make) make.before(link);
    else topbar.append(link);
  });
}
