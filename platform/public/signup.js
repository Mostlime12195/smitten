// Make an account, with a password or (?via=hackclub, after Hack Club's
// sign-in) without one, and an optional email when the site sends mail.
// Password accounts get their recovery codes next.

import { $, nextPath, send, showError, clearErrors, siteConfig, codesBlock } from './site.js';

const next = nextPath();
const viaHackclub = new URLSearchParams(location.search).get('via') === 'hackclub';
const form = $('#form');

$('#signin-link').href = `/signin?next=${encodeURIComponent(next)}`;
$('#hackclub-link').href = `/auth/hackclub?next=${encodeURIComponent(next)}`;

if (viaHackclub) {
  $('#heading').textContent = 'Pick a username';
  $('#lead').textContent = "You're signed in with Hack Club. Choose the name people will see on your games.";
  $('#password-field').remove();
  $('#signin-alt').hidden = true;
}
siteConfig().then((c) => {
  if (!viaHackclub) {
    $('#hackclub').hidden = !c.accounts?.hackclub;
    $('#link-hint').hidden = !c.accounts?.hackclub;
  }
  if (c.accounts?.email) {
    $('#email-field').hidden = false;
    $('#privacy').textContent = "Your username and display name are public; your email isn't. We don't want your real name, school or anything else about you.";
  }
}).catch(() => {});

function showCodes(codes, pendingEmail) {
  $('#signup').hidden = true;
  $('#codes').hidden = false;
  if (pendingEmail) {
    $('#codes-lead').textContent = "If you forget your password, you can reset it by email once you've confirmed your address, or use one of these codes. Each works once. Keep them somewhere safe, like a note on your phone or a piece of paper.";
    const sent = $('#email-sent');
    sent.textContent = `We sent a link to ${pendingEmail}. Open it within 24 hours to confirm your email.`;
    sent.hidden = false;
  }
  $('#codes-list').replaceChildren(codesBlock(codes));
  const go = $('#continue');
  go.href = next;
  go.addEventListener('click', (e) => {
    if (!$('#saved').checked) {
      e.preventDefault();
      $('#saved').focus();
    }
  });
  $('#saved').addEventListener('change', () => go.setAttribute('aria-disabled', String(!$('#saved').checked)));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  const button = $('#submit');
  button.disabled = true;
  try {
    const res = await send('/api/auth/signup', {
      username: form.username.value,
      displayName: form.displayName.value,
      password: viaHackclub ? undefined : form.password.value,
      via: viaHackclub ? 'hackclub' : undefined,
      email: $('#email-field').hidden ? undefined : form.email.value,
    });
    if (res.recoveryCodes) showCodes(res.recoveryCodes, res.pendingEmail);
    else location.replace(next);
  } catch (err) {
    showError(form, err);
    button.disabled = false;
  }
});

form.username.addEventListener('input', () => {
  const v = form.username.value;
  if (v !== v.toLowerCase()) form.username.value = v.toLowerCase();
});
form.username.focus();
