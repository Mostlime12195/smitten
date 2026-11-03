// The editor's account on Smitten's game-sharing site (platform/), for
// publishing. The site runs on another origin, so the editor never sees
// the person's password or the site's cookie: it gets an editor token.
//
//   account(platformUrl?)       the signed-in user {username, displayName, ...} or null
//   signIn({platformUrl}?)      opens the site's sign-in popup; resolves with the user, or null.
//                               Call it from a click (or key press): browsers only allow
//                               popups then.
//   signOut({platformUrl}?)     signs the editor out (and revokes its token on the site)
//   onChange(fn)                fn(user, platformUrl) after any change, in this tab or
//                               another; returns an unsubscribe function
//   accountEvents               the EventTarget behind onChange ('change' events,
//                               event.detail = {user, platformUrl})
//   refreshAccount(platformUrl?) asks the site who's signed in (a changed display
//                               name, or a token revoked in the site's settings)
//   accountToken(platformUrl?)  the bearer token for the site's API (publish.js)
//   clearAccount(platformUrl?)  forgets the account (the site said the token is gone)
//
// platformUrl defaults to the editor's "platformUrl" setting. Accounts are
// kept per site in localStorage under "smitten-editor.account".
//
// How signing in works (platform/src/account.js has the site's side):
//   1. The editor makes a random verifier and state, and opens
//      <site>/editor-auth?origin=<this origin>&state=…&challenge=<SHA-256 of the verifier>.
//   2. There, the person signs in to the site if needed, sees which editor
//      is asking and allows it. The site makes a one-time code bound to the
//      account, this origin and the challenge.
//   3. The popup posts {state, code} to this window, addressed to this
//      origin only. If the popup lost track of this window, it shows the
//      code instead, to paste into the waiting dialog here.
//   4. The editor swaps the code and the verifier for a token (POST
//      /api/auth/editor/token). Without the verifier, a code is useless.

import { h, openDialog } from './ui.js';
import { settings } from './settings.js';

const KEY = 'smitten-editor.account';
const MESSAGE = 'smitten-sign-in';

export const accountEvents = new EventTarget();

const baseUrl = (url) => String(url || settings.get('platformUrl') || '').replace(/\/+$/, '');
const hostOf = (base) => {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
};

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("Couldn't save the account:", e);
  }
}

function emit(platformUrl) {
  const base = baseUrl(platformUrl);
  accountEvents.dispatchEvent(new CustomEvent('change', { detail: { user: account(base), platformUrl: base } }));
}

function save(base, entry) {
  const all = readAll();
  const before = JSON.stringify(all[base] ?? null);
  if (entry) all[base] = entry;
  else delete all[base];
  writeAll(all);
  if (JSON.stringify(entry ?? null) !== before) emit(base);
}

/** The signed-in user on the site ({username, displayName, hasPassword, hackclub, createdAt}), or null. */
export function account(platformUrl) {
  return readAll()[baseUrl(platformUrl)]?.user || null;
}

export function accountToken(platformUrl) {
  return readAll()[baseUrl(platformUrl)]?.token || null;
}

/** Forgets the account without asking the site (it already said the token doesn't work). */
export function clearAccount(platformUrl) {
  save(baseUrl(platformUrl), null);
}

/** fn(user, platformUrl) after every change. Returns an unsubscribe function. */
export function onChange(fn) {
  const listener = (e) => fn(e.detail.user, e.detail.platformUrl);
  accountEvents.addEventListener('change', listener);
  return () => accountEvents.removeEventListener('change', listener);
}

// Other tabs, and switching sites in Settings.
addEventListener('storage', (e) => { if (e.key === KEY) emit(); });
settings.onChange((key) => { if (key === 'platformUrl') emit(); });

async function api(base, path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error(`Couldn't reach ${hostOf(base)}. Check your connection, or whether the site is running.`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || `The site answered ${res.status}.`), { status: res.status, data });
  return data;
}

/** Asks the site who's signed in, and updates (or clears) the account. Offline, it keeps what it has. */
export async function refreshAccount(platformUrl) {
  const base = baseUrl(platformUrl);
  const entry = readAll()[base];
  if (!entry) return null;
  try {
    const { user } = await api(base, '/api/account', { token: entry.token });
    if (!user) throw Object.assign(new Error('Signed out.'), { status: 401 });
    save(base, { ...entry, user });
    return user;
  } catch (e) {
    if (e.status === 401) {
      save(base, null);
      return null;
    }
    return entry.user;
  }
}

export async function signOut({ platformUrl } = {}) {
  const base = baseUrl(platformUrl);
  const token = accountToken(base);
  save(base, null);
  if (token) await api(base, '/api/auth/editor/token', { method: 'DELETE', token }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Signing in

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function openPopup(url) {
  const w = 480;
  const hgt = 700;
  const left = Math.max(0, Math.round((screenX || 0) + ((outerWidth || w) - w) / 2));
  const top = Math.max(0, Math.round((screenY || 0) + ((outerHeight || hgt) - hgt) / 3));
  return window.open(url, 'smitten-sign-in', `popup=yes,width=${w},height=${hgt},left=${left},top=${top}`);
}

let pendingSignIn = null;

/**
 * Opens the site's sign-in popup and a dialog that waits for it. Resolves
 * with the user, or null if cancelled. Call it from a click: the popup is
 * opened before anything else happens.
 */
export function signIn({ platformUrl } = {}) {
  if (pendingSignIn) {
    pendingSignIn.popup?.focus();
    return pendingSignIn.promise;
  }
  const base = baseUrl(platformUrl);
  const host = hostOf(base);
  let siteOrigin;
  try {
    siteOrigin = new URL(base).origin;
  } catch {
    return Promise.reject(new Error(`"${base}" isn't a web address. Check Settings › Publishing.`));
  }
  const state = randomString(18);
  const verifier = randomString(32);
  // Opened right away, while the click still counts; its address comes once the challenge is ready.
  let popup = openPopup('about:blank');
  let authUrl = null;
  const urlReady = crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then((digest) => {
    const p = new URLSearchParams({ origin: location.origin, state, challenge: b64url(digest) });
    authUrl = `${base}/editor-auth?${p}`;
    if (popup && !popup.closed) popup.location.href = authUrl;
    return authUrl;
  });

  const pending = { popup };
  pendingSignIn = pending;
  pending.promise = new Promise((resolve) => {
    let finishDialog = null;
    let done = false;
    let timer = 0;

    const status = h('div', { class: 'field-error', role: 'alert' });
    const message = h('p', { class: 'dialog-message', style: { margin: '0 0 12px' } });
    const setMessage = () => {
      message.textContent = popup
        ? `Finish signing in to ${host} in the window that opened. You can make an account there too: it takes a minute and doesn't need an email.`
        : `Your browser blocked the sign-in window. Open it here to sign in to ${host}.`;
    };
    setMessage();
    const reopen = h('button', { type: 'button', class: 'btn' }, 'Open the sign-in window');
    reopen.addEventListener('click', async () => {
      popup = openPopup(authUrl || 'about:blank');
      pending.popup = popup;
      if (!authUrl) await urlReady;
      setMessage();
    });
    const codeInput = h('input', {
      type: 'text', class: 'input', autocomplete: 'off', spellcheck: 'false', placeholder: 'Code', 'aria-label': 'Sign-in code',
      style: { flex: '1', fontFamily: 'var(--font-mono)' },
    });
    const useCode = h('button', { type: 'button', class: 'btn' }, 'Use code');

    const finish = (user) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      removeEventListener('message', onMessage);
      if (pendingSignIn === pending) pendingSignIn = null;
      try { if (popup && !popup.closed) popup.close(); } catch { /* cross-origin */ }
      resolve(user);
      finishDialog?.(user ? 'signed-in' : null);
    };

    async function exchange(code) {
      status.textContent = '';
      useCode.disabled = true;
      try {
        const old = accountToken(base);
        const res = await api(base, '/api/auth/editor/token', { method: 'POST', body: { code, verifier } });
        save(base, { token: res.token, user: res.user, signedInAt: Date.now() });
        // Switching accounts: the previous token is no longer needed.
        if (old && old !== res.token) api(base, '/api/auth/editor/token', { method: 'DELETE', token: old }).catch(() => {});
        finish(res.user);
      } catch (e) {
        status.textContent = e.data?.code === 'bad-code'
          ? "That code didn't work: it may have expired. Open the sign-in window and try again."
          : e.message;
        useCode.disabled = false;
      }
    }

    function onMessage(e) {
      if (e.origin !== siteOrigin || e.data?.type !== MESSAGE || e.data.state !== state) return;
      if (e.data.error) finish(null);
      else if (typeof e.data.code === 'string') exchange(e.data.code);
    }
    addEventListener('message', onMessage);

    useCode.addEventListener('click', () => {
      const code = codeInput.value.trim();
      if (code) exchange(code);
    });
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        useCode.click();
      }
    });

    // A closed popup might only look closed (some sign-in pages cut it off
    // from this window), so it doesn't cancel; the dialog says what to do.
    timer = setInterval(() => {
      if (popup && popup.closed && !done) {
        popup = null;
        message.textContent = `The sign-in window closed. If it showed you a code, paste it below. Otherwise, open it again.`;
      }
    }, 600);

    openDialog({
      title: `Sign in to ${host}`,
      body: h('div', {},
        message,
        h('div', { style: { display: 'flex', gap: '8px', marginBottom: '14px' } }, reopen),
        h('div', { class: 'field', style: { marginBottom: '4px' } },
          h('label', {}, 'Got a code instead?'),
          h('div', { style: { display: 'flex', gap: '8px' } }, codeInput, useCode)),
        status),
      actions: [{ label: 'Cancel', value: null, ghost: true }],
      onOpen: (dlg, fin) => { finishDialog = fin; },
    }).then(() => finish(null));
    urlReady.catch((e) => { status.textContent = e.message; });
  });
  return pending.promise;
}
