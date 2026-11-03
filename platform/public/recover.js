// Resetting a forgotten password with a recovery code, or with a reset link
// from a moderator (/recover#reset=<token>; the token stays out of server
// logs and Referer headers because it's in the fragment).

import { $, send, showError, clearErrors } from './site.js';

const form = $('#form');
const resetToken = new URLSearchParams(location.hash.slice(1)).get('reset');

if (resetToken) {
  $('#heading').textContent = 'Choose a new password';
  $('#lead').textContent = 'A moderator sent you this link. It works once, for a day.';
  for (const el of document.querySelectorAll('[data-code-only]')) el.remove();
  // Keep the token out of the address bar and history.
  history.replaceState(null, '', '/recover');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const res = await send('/api/auth/recover', resetToken
      ? { resetToken, password: form.password.value }
      : { username: form.username.value, code: form.code.value, password: form.password.value });
    $('#recover').hidden = true;
    $('#done').hidden = false;
    if (res.codesLeft != null && res.codesLeft <= 2) {
      $('#done-text').append(` You have ${res.codesLeft} recovery code${res.codesLeft === 1 ? '' : 's'} left: make new ones in your account settings.`);
    }
  } catch (err) {
    showError(form, err);
    button.disabled = false;
  }
});

(form.username || form.password).focus();
