// Confirming an email address: the link in the email is
// /verify-email#token=<token> (in the fragment, so it stays out of server
// logs and Referer headers). It works from any browser, signed in or not.

import { $, send } from './site.js';

const token = new URLSearchParams(location.hash.slice(1)).get('token');
// Keep the token out of the address bar and history.
history.replaceState(null, '', '/verify-email');

function show(heading, lead) {
  $('#heading').textContent = heading;
  $('#lead').textContent = lead;
  $('#go').hidden = false;
  $('#panel').setAttribute('aria-busy', 'false');
}

if (!token) {
  show("That link isn't complete", 'Open the link from the email again, or copy all of it into the address bar.');
} else {
  send('/api/auth/verify-email', { token })
    .then((res) => show('Your email is confirmed', `It's on your account, @${res.username}, now. If you ever forget your password, you can reset it by email.`))
    .catch((err) => show("That didn't work", err.message));
}
