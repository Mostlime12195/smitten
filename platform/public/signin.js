// Sign in, then back to ?next= (e.g. the editor's sign-in popup).

import { $, account, nextPath, send, showError, clearErrors, siteConfig } from './site.js';

const next = nextPath();
const form = $('#form');
const params = new URLSearchParams(location.search);

if (params.get('error')) {
  const banner = $('#banner');
  banner.textContent = params.get('error');
  banner.hidden = false;
}

$('#signup-link').href = `/signup?next=${encodeURIComponent(next)}`;
$('#hackclub-link').href = `/auth/hackclub?next=${encodeURIComponent(next)}`;
siteConfig().then((c) => { $('#hackclub').hidden = !c.accounts?.hackclub; }).catch(() => {});

// Already signed in: carry on.
account().then((user) => { if (user && !params.get('error')) location.replace(next); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await send('/api/auth/signin', { username: form.username.value, password: form.password.value });
    location.replace(next);
  } catch (err) {
    showError(form, err);
    if (err.data?.code === 'use-hackclub') $('#hackclub').hidden = false;
    button.disabled = false;
  }
});

form.username.focus();
