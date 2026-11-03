// Where the editor's "Connect with Hackatime" window ends up
// (/auth/hackatime?next=/hackatime-connected): the editor is checking in the
// background, so this only says what happened.

import { $, h } from './site.js';

const params = new URLSearchParams(location.search);
const panel = $('#panel');
const error = params.get('error');

const close = h('button', { type: 'button', class: 'btn' }, 'Close this window');
close.addEventListener('click', () => window.close());

panel.setAttribute('aria-busy', 'false');
if (error) {
  panel.replaceChildren(
    h('h1', {}, "Hackatime didn't connect"),
    h('p', { class: 'lead' }, error),
    h('p', { class: 'fine' }, 'Close this window and choose Connect with Hackatime in the editor to try again.'),
    close);
} else {
  panel.replaceChildren(
    h('h1', {}, 'Hackatime is connected'),
    h('p', { class: 'lead' }, 'You can close this window and go back to the editor. It picks up your Hackatime key by itself.'),
    h('p', { class: 'fine' }, 'Disconnect it any time in your account settings on this site.'),
    close);
}
