// Account settings: display name, games, password, recovery codes, Hack
// Club, where you're signed in, and deleting the account.

import { $, h, api, send, accountDetails, siteConfig, showError, clearErrors, codesBlock, timeAgo, plays, toast } from './site.js';

const main = $('#main');
const params = new URLSearchParams(location.search);
let user = null;

function banner(text, kind = '') {
  const el = $('#banner');
  el.textContent = text;
  el.className = `banner ${kind}`;
  el.hidden = !text;
}

/** Runs an API call from a form, showing its errors there. */
function onSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await fn(form);
    } catch (err) {
      if (err.status === 401) location.replace('/signin?next=/account');
      showError(form, err);
    } finally {
      button.disabled = false;
    }
  });
}

function renderHead() {
  document.title = `${user.displayName} · Smitten`;
  $('#name').textContent = user.displayName;
  $('#meta').replaceChildren(
    h('a', { href: `/u/${user.username}` }, `@${user.username}`),
    h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
    h('span', {}, `Joined ${timeAgo(user.createdAt)}`));
}

async function loadGames() {
  const list = $('#games');
  try {
    const { games } = await api('/api/account/games');
    if (!games.length) {
      list.replaceChildren(h('p', { class: 'fine' }, 'Nothing yet. Make a game in the editor and choose Publish.'));
      return;
    }
    list.replaceChildren(...games.map((g) => {
      const remove = h('button', { type: 'button', class: 'btn ghost small' }, 'Delete');
      remove.addEventListener('click', async () => {
        if (!confirm(`Delete “${g.title}” from the site? Its link stops working. This can't be undone.`)) return;
        try {
          await send(`/api/games/${g.id}`, undefined, 'DELETE');
          toast('Deleted.');
          loadGames();
        } catch (err) {
          toast(err.message);
        }
      });
      return h('div', { class: 'list-row' },
        h('div', { class: 'grow' },
          h('a', { href: `/play/${g.id}` }, g.title),
          h('div', { class: 'fine' }, `${plays(g.plays)} · ${g.version > 1 ? 'updated' : 'published'} ${timeAgo(g.updatedAt)}`)),
        g.status !== 'public' ? h('span', { class: 'badge warn', title: 'Hidden while a moderator reviews it' }, 'Hidden') : null,
        remove);
    }));
  } catch (err) {
    list.replaceChildren(h('p', { class: 'field-error' }, err.message));
  }
}

function describeSession(s) {
  if (s.kind === 'editor') return `The editor at ${(s.origin || '').replace(/^https?:\/\//, '')}`;
  return s.current ? 'This browser' : 'A browser';
}

async function loadSessions() {
  const list = $('#sessions');
  try {
    const { sessions } = await api('/api/account/sessions');
    list.replaceChildren(...sessions.map((s) => {
      const revoke = h('button', { type: 'button', class: 'btn ghost small' }, 'Sign out');
      revoke.addEventListener('click', async () => {
        try {
          await send(`/api/account/sessions/${s.id}`, undefined, 'DELETE');
          loadSessions();
        } catch (err) {
          toast(err.message);
        }
      });
      return h('div', { class: 'list-row' },
        h('div', { class: 'grow' },
          h('div', {}, describeSession(s)),
          h('div', { class: 'fine' }, `Signed in ${timeAgo(s.createdAt)} · last used ${timeAgo(s.lastUsedAt)}`)),
        s.current ? h('span', { class: 'badge' }, 'Current') : revoke);
    }));
  } catch (err) {
    list.replaceChildren(h('p', { class: 'field-error' }, err.message));
  }
}

function renderPassword(codesLeft) {
  const has = user.hasPassword;
  $('#password-title').textContent = has ? 'Password' : 'Set a password';
  $('#current-field').hidden = !has;
  $('#password-form').querySelector('button').textContent = has ? 'Change password' : 'Set password';
  $('#codes-section').hidden = !has;
  if (has) {
    $('#codes-left').textContent = `You have ${codesLeft} unused recovery code${codesLeft === 1 ? '' : 's'}. Each resets your password once. Making new ones replaces them all.`;
  }
  const del = $('#delete-form');
  del.password.hidden = !has;
  del.confirm.hidden = has;
}

async function start() {
  const details = await accountDetails();
  user = details.user;
  if (!user) {
    location.replace('/signin?next=/account');
    return;
  }
  main.setAttribute('aria-busy', 'false');
  renderHead();
  renderPassword(details.recoveryCodesLeft || 0);
  if (params.get('error')) banner(params.get('error'), 'error');
  else if (params.get('connected') === 'hackclub') banner('Your Hack Club account is connected. You can sign in with it now.');
  if (params.has('error') || params.has('connected')) history.replaceState(null, '', '/account');

  $('#name-form').displayName.value = user.displayName;
  onSubmit($('#name-form'), async (form) => {
    const res = await send('/api/account', { displayName: form.displayName.value }, 'PATCH');
    user = res.user;
    renderHead();
    toast('Saved.');
  });

  onSubmit($('#password-form'), async (form) => {
    const res = await send('/api/account/password', { current: form.current.value, password: form.password.value });
    form.reset();
    const hadPassword = user.hasPassword;
    user.hasPassword = true;
    renderPassword(8);
    loadSessions();
    toast(hadPassword ? 'Password changed. Everywhere else is signed out.' : 'Password set.');
    if (res.recoveryCodes) $('#new-codes').replaceChildren(h('p', {}, 'Save these recovery codes: one of them gets you back in if you forget your password.'), codesBlock(res.recoveryCodes));
  });

  onSubmit($('#codes-form'), async (form) => {
    const res = await send('/api/account/recovery-codes', { password: form.password.value });
    form.reset();
    renderPassword(res.recoveryCodes.length);
    $('#new-codes').replaceChildren(h('p', {}, 'Your new codes. The old ones no longer work.'), codesBlock(res.recoveryCodes));
  });

  siteConfig().then((c) => {
    if (!c.accounts?.hackclub && !user.hackclub) return;
    $('#hackclub-section').hidden = false;
    $('#hackclub-status').textContent = user.hackclub
      ? 'Your Hack Club account is connected: you can sign in with it.'
      : 'Connect your Hack Club account to sign in with it.';
    $('#hackclub-connect').hidden = user.hackclub || !c.accounts?.hackclub;
  }).catch(() => {});

  $('#signout').addEventListener('click', async () => {
    await send('/api/auth/signout').catch(() => {});
    location.replace('/');
  });
  $('#signout-others').addEventListener('click', async () => {
    try {
      const res = await send('/api/account/sessions/revoke-others');
      toast(res.revoked ? `Signed out ${res.revoked} other place${res.revoked === 1 ? '' : 's'}.` : 'You weren’t signed in anywhere else.');
      loadSessions();
    } catch (err) {
      toast(err.message);
    }
  });

  onSubmit($('#delete-form'), async (form) => {
    if (!confirm('Delete your account and all your games? This can’t be undone.')) return;
    await send('/api/account', user.hasPassword ? { password: form.password.value } : { confirm: form.confirm.value }, 'DELETE');
    location.replace('/');
  });

  loadGames();
  loadSessions();
}

start();
