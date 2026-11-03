// Make an account, with a password or (?via=hackclub, after Hack Club's
// sign-in) without one. Password accounts get their recovery codes next.

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
} else {
  siteConfig().then((c) => { $('#hackclub').hidden = !c.accounts?.hackclub; }).catch(() => {});
}

function showCodes(codes) {
  $('#signup').hidden = true;
  $('#codes').hidden = false;
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
    });
    if (res.recoveryCodes) showCodes(res.recoveryCodes);
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
