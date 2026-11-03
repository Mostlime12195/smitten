// Resetting a forgotten password: a link by email (when the site sends
// mail), a recovery code, or a reset link (/recover#reset=<token>, sent by
// email or made by a moderator; the token stays out of server logs and
// Referer headers because it's in the fragment).

import { $, send, showError, clearErrors, siteConfig } from './site.js';

const form = $('#form');
const resetToken = new URLSearchParams(location.hash.slice(1)).get('reset');

if (resetToken) {
  $('#heading').textContent = 'Choose a new password';
  $('#lead').textContent = 'Choose a new password for your account. This link works once.';
  for (const el of document.querySelectorAll('[data-code-only]')) el.remove();
  $('#by-email').remove();
  // Keep the token out of the address bar and history.
  history.replaceState(null, '', '/recover');
} else {
  siteConfig().then((c) => {
    if (!c.accounts?.email) return;
    $('#by-email').hidden = false;
    $('#lead').hidden = true;
    $('#no-codes').firstChild.textContent = 'No email on your account, and no codes? If you signed up with Hack Club, ';
    $('#email-form').email.focus();
  }).catch(() => {});

  const emailForm = $('#email-form');
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(emailForm);
    const button = emailForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await send('/api/auth/recover/email', { email: emailForm.email.value });
      const sent = $('#email-sent');
      sent.textContent = `If ${emailForm.email.value.trim()} is confirmed on a Smitten account, we've sent it a link. It works for an hour. If nothing comes in a few minutes, check your spam folder.`;
      sent.hidden = false;
    } catch (err) {
      showError(emailForm, err);
    } finally {
      button.disabled = false;
    }
  });
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
