// Account settings: display name, games, password, email, recovery codes,
// Hack Club, Hackatime, where you're signed in, and deleting the account.

import { $, h, api, send, accountDetails, siteConfig, showError, clearErrors, codesBlock, timeAgo, plays, toast } from './site.js';

const main = $('#main');
const params = new URLSearchParams(location.search);
let user = null;
let config = {};
// {email, pendingEmail: {address, expiresAt}} from /api/account.
let email = { email: null, pendingEmail: null };

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

// ---------------------------------------------------------------------------
// Leaderboards, per game: make, rename, reset and delete boards. Scripts
// use a board by its key: smitten.boards.submit("best", score).

async function loadBoards(game, panel) {
  const url = `/api/games/${game.id}/boards`;
  const act = async (fn) => {
    try {
      await fn();
      await loadBoards(game, panel);
    } catch (err) {
      toast(err.message);
    }
  };
  let data;
  try {
    data = await api(url);
  } catch (err) {
    panel.replaceChildren(h('p', { class: 'field-error' }, err.message));
    return;
  }
  const rows = data.boards.map((b) => {
    const button = (label, fn) => {
      const el = h('button', { type: 'button', class: 'btn ghost small' }, label);
      el.addEventListener('click', fn);
      return el;
    };
    const facts = [
      `key "${b.key}"`,
      b.order === 'low' ? 'lowest wins' : 'highest wins',
      b.format === 'time' ? 'times' : null,
      b.keep === 'all' ? 'every score kept' : null,
      `${b.scores} score${b.scores === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ');
    return h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('strong', {}, b.title), h('div', { class: 'fine' }, facts)),
      button('Rename', () => {
        const title = prompt('The leaderboard’s title:', b.title);
        if (title && title.trim() && title !== b.title) act(() => send(`${url}/${b.key}`, { title }, 'PATCH'));
      }),
      button('Reset', () => {
        if (confirm(`Remove all ${b.scores} scores from “${b.title}”? This can’t be undone.`)) act(() => send(`${url}/${b.key}/reset`));
      }),
      button('Delete', () => {
        if (confirm(`Delete the leaderboard “${b.title}” and its scores? The game’s scripts using "${b.key}" get nothing back.`)) act(() => send(`${url}/${b.key}`, undefined, 'DELETE'));
      }));
  });

  const form = h('form', { class: 'board-form' },
    h('input', { class: 'input', name: 'title', placeholder: 'Title (High scores)', maxlength: '40', required: true, 'aria-label': 'Title' }),
    h('input', { class: 'input', name: 'key', placeholder: 'key (best)', maxlength: '24', required: true, pattern: '[a-z0-9][a-z0-9_\\-]*', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Key for scripts' }),
    h('select', { class: 'input', name: 'kind', 'aria-label': 'What wins' },
      h('option', { value: 'high' }, 'Highest score wins'),
      h('option', { value: 'low' }, 'Lowest score wins'),
      h('option', { value: 'time' }, 'Fastest time wins')),
    h('button', { type: 'submit', class: 'btn small' }, 'Add leaderboard'),
    h('p', { class: 'field-error', 'data-error-for': 'form', role: 'alert' }));
  onSubmit(form, async () => {
    const kind = form.elements.kind.value;
    await send(url, {
      title: form.elements.title.value,
      key: form.elements.key.value.trim(),
      order: kind === 'high' ? 'high' : 'low',
      format: kind === 'time' ? 'time' : 'number',
    });
    await loadBoards(game, panel);
  });

  panel.replaceChildren(
    ...rows,
    data.boards.length >= data.limit ? h('p', { class: 'fine' }, `A game can have ${data.limit} leaderboards.`) : form,
    h('p', { class: 'fine' },
      'The game sends scores with smitten.boards.submit("key", score) and they show under the game. Scores come from players’ browsers, so they can be faked: remove one from the game’s page, or reset the board. ',
      h('a', { href: '/docs/leaderboards' }, 'How leaderboards work')));
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
      const panel = h('div', { class: 'board-manager', hidden: true });
      const boards = h('button', { type: 'button', class: 'btn ghost small', 'aria-expanded': 'false' }, 'Leaderboards');
      boards.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        boards.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) loadBoards(g, panel);
      });
      return [h('div', { class: 'list-row' },
        h('div', { class: 'grow' },
          h('a', { href: `/play/${g.id}` }, g.title),
          h('div', { class: 'fine' }, `${plays(g.plays)} · ${g.version > 1 ? 'updated' : 'published'} ${timeAgo(g.updatedAt)}`)),
        g.status !== 'public' ? h('span', { class: 'badge warn', title: 'Hidden while a moderator reviews it' }, 'Hidden') : null,
        boards,
        remove), panel];
    }).flat());
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
  renderEmail();
  renderHackclub();
}

function renderEmail() {
  const on = Boolean(config.accounts?.email);
  // Shown when the site sends mail, or when there's an address to remove.
  $('#email-section').hidden = !on && !email.email && !email.pendingEmail;
  $('#email-current').hidden = !email.email;
  $('#email-address').textContent = email.email || '';
  const pending = email.pendingEmail;
  $('#email-pending').hidden = !pending;
  if (pending) {
    $('#email-pending-text').textContent = `We sent a link to ${pending.address}. Open it to confirm ${email.email ? 'your new address' : 'your email'}. It works for 24 hours.`;
    $('#email-resend').hidden = !on;
  }
  const form = $('#email-form');
  form.hidden = !on && !email.email;
  form.email.closest('.field').hidden = !on;
  $('#email-label').textContent = email.email ? 'New email' : 'Email';
  $('#email-submit').textContent = email.email ? 'Change email' : 'Add email';
  $('#email-submit').hidden = !on;
  $('#email-remove').hidden = !email.email;
  $('#email-password-field').hidden = !user.hasPassword;
}

function renderHackclub() {
  const on = Boolean(config.accounts?.hackclub);
  $('#hackclub-section').hidden = !on && !user.hackclub;
  $('#hackclub-badge').hidden = !user.hackclub;
  $('#hackclub-connect').hidden = user.hackclub || !on;
  $('#hackclub-disconnect-form').hidden = !user.hackclub || !user.hasPassword;
  if (user.hackclub) {
    $('#hackclub-status').textContent = user.hasPassword
      ? 'You can sign in with Hack Club or with your password.'
      : 'You sign in with Hack Club.';
    $('#hackclub-fine').textContent = user.hasPassword
      ? 'Disconnecting means signing in with your username and password only. You can connect again any time.'
      : 'To disconnect Hack Club, set a password first (above), so you can still sign in.';
  } else {
    $('#hackclub-status').textContent = 'Connect your Hack Club account to sign in with it, without typing a password.';
    $('#hackclub-fine').textContent = 'This site only keeps an id for your Hack Club account: no name, no email.';
  }
}

function renderHackatime(c) {
  const on = Boolean(c.accounts?.hackatime);
  $('#hackatime-section').hidden = !on && !user.hackatime;
  $('#hackatime-status').textContent = user.hackatime
    ? 'Connected: the editor can get your Hackatime key, and your games show the time you spent on them.'
    : 'Connect Hackatime, Hack Club’s time tracker, to track time in the editor and show it on your games.';
  $('#hackatime-connect').hidden = user.hackatime || !on;
  $('#hackatime-disconnect').hidden = !user.hackatime;
}

async function start() {
  const details = await accountDetails();
  user = details.user;
  email = { email: details.email || null, pendingEmail: details.pendingEmail || null };
  if (!user) {
    location.replace('/signin?next=/account');
    return;
  }
  main.setAttribute('aria-busy', 'false');
  renderHead();
  renderPassword(details.recoveryCodesLeft || 0);
  if (params.get('error')) banner(params.get('error'), 'error');
  else if (params.get('connected') === 'hackclub') banner('Your Hack Club account is connected. You can sign in with it now.');
  else if (params.get('verified') === '1') banner('Your email is confirmed.');
  else if (params.get('connected') === 'hackatime') banner('Hackatime is connected. In the editor, Settings › Hackatime › Connect with Hackatime sets up time tracking.');
  if (params.has('error') || params.has('connected') || params.has('verified')) history.replaceState(null, '', '/account');

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
    config = c;
    renderHackatime(c);
    renderEmail();
    renderHackclub();
  }).catch(() => {});

  onSubmit($('#email-form'), async (form) => {
    email = await send('/api/account/email', { email: form.email.value, password: form.password.value });
    form.reset();
    renderEmail();
    toast(`Check ${email.pendingEmail?.address || 'your inbox'} for a link to confirm it.`);
  });
  $('#email-remove').addEventListener('click', async () => {
    const form = $('#email-form');
    clearErrors(form);
    if (user.hasPassword && !form.password.value) {
      showError(form, Object.assign(new Error('Type your password to remove your email.'), { data: { field: 'current' } }));
      return;
    }
    if (!confirm('Remove your email? You won’t be able to reset your password by email.')) return;
    try {
      email = await send('/api/account/email', { password: form.password.value }, 'DELETE');
      form.reset();
      renderEmail();
      toast('Your email is removed.');
    } catch (err) {
      showError(form, err);
    }
  });
  $('#email-resend').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      email = await send('/api/account/email/resend');
      renderEmail();
      toast('Sent. Check your inbox, and your spam folder.');
    } catch (err) {
      toast(err.message);
    } finally {
      e.target.disabled = false;
    }
  });
  $('#email-cancel').addEventListener('click', async () => {
    try {
      email = await send('/api/account/email/cancel');
      renderEmail();
    } catch (err) {
      toast(err.message);
    }
  });

  onSubmit($('#hackclub-disconnect-form'), async (form) => {
    if (!confirm('Disconnect Hack Club? You’ll sign in with your username and password.')) return;
    const res = await send('/api/account/hackclub', { password: form.password.value }, 'DELETE');
    form.reset();
    user = res.user;
    renderHackclub();
    toast('Hack Club is disconnected.');
  });
  $('#hackatime-disconnect').addEventListener('click', async (e) => {
    if (!confirm('Disconnect Hackatime? Your games stop showing their hours, and the editor keeps the key it has until you remove it there.')) return;
    e.target.disabled = true;
    try {
      await send('/api/account/hackatime', undefined, 'DELETE');
      user.hackatime = false;
      renderHackatime(await siteConfig());
      toast('Hackatime is disconnected.');
    } catch (err) {
      toast(err.message);
    } finally {
      e.target.disabled = false;
    }
  });

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
