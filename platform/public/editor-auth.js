// The editor's sign-in popup: /editor-auth?origin=<editor>&state=<random>&challenge=<sha256 of its verifier>.
//
// After the person signs in here (if they aren't) and allows it, the site
// gives this page a one-time code bound to their account, the editor's
// origin and the challenge. The page posts {state, code} to the window that
// opened it, addressed to that origin only, so no other site can receive
// it. The editor swaps the code, with its verifier, for an editor token.
// If the popup lost its opener (some sign-in pages cut it off), the code is
// shown to paste into the editor instead.

import { $, h, account, siteConfig, send, toast } from './site.js';

const params = new URLSearchParams(location.search);
const origin = params.get('origin') || '';
const state = params.get('state') || '';
const challenge = params.get('challenge') || '';
const panel = $('#panel');
const MESSAGE = 'smitten-sign-in';

function show(...children) {
  panel.setAttribute('aria-busy', 'false');
  panel.replaceChildren(...children);
}

function problem(text) {
  show(h('h1', {}, "This sign-in didn't work"), h('p', { class: 'lead' }, text),
    h('p', { class: 'fine' }, 'Close this window and choose Sign in in the editor again.'));
}

const host = (o) => o.replace(/^https?:\/\//, '');

function tellEditor(message) {
  if (!window.opener) return false;
  try {
    window.opener.postMessage({ type: MESSAGE, state, ...message }, origin);
    return true;
  } catch {
    return false;
  }
}

function showCode(code) {
  const box = h('input', { class: 'input mono code-box', readonly: true, value: code, 'aria-label': 'Sign-in code' });
  const copy = h('button', { type: 'button', class: 'btn' }, 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Copied. Paste it in the editor.');
    } catch {
      box.select();
    }
  });
  show(
    h('h1', {}, 'Paste this code in the editor'),
    h('p', { class: 'lead' }, `This window lost track of the editor, so copy this code into the editor at ${host(origin)}, where it's waiting for you. It works once, for 5 minutes.`),
    h('div', { class: 'row-actions' }, box, copy),
    h('p', { class: 'fine' }, "Only paste it into the Smitten editor you opened this from. Never give it to anyone."));
  box.select();
}

async function allow(button) {
  button.disabled = true;
  try {
    const { code } = await send('/api/auth/editor/code', { origin, challenge });
    if (tellEditor({ code })) {
      show(h('h1', {}, "You're signed in"), h('p', { class: 'lead' }, 'Go back to the editor. You can close this window.'));
      window.close();
    } else {
      showCode(code);
    }
  } catch (err) {
    if (err.status === 401) location.reload();
    else problem(err.message);
  }
}

function cancel() {
  tellEditor({ error: 'cancelled' });
  window.close();
  show(h('h1', {}, 'Cancelled'), h('p', { class: 'lead' }, 'The editor is not signed in. You can close this window.'));
}

async function main() {
  let config;
  try {
    config = await siteConfig();
  } catch (e) {
    problem(`The site couldn't be reached: ${e.message}`);
    return;
  }
  if (!config.editorOrigins.includes(origin) || !/^[A-Za-z0-9_-]{8,100}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    problem("It didn't come from a Smitten editor this site works with.");
    return;
  }
  const user = await account();
  if (!user) {
    location.replace(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }

  const allowButton = h('button', { type: 'button', class: 'btn primary' }, 'Allow');
  allowButton.addEventListener('click', () => allow(allowButton));
  const cancelButton = h('button', { type: 'button', class: 'btn ghost' }, 'Cancel');
  cancelButton.addEventListener('click', cancel);
  const switchUser = h('a', { href: '#' }, 'Use another account');
  switchUser.addEventListener('click', async (e) => {
    e.preventDefault();
    await send('/api/auth/signout').catch(() => {});
    location.reload();
  });

  show(
    h('h1', {}, 'Sign in the editor?'),
    h('p', { class: 'lead' }, 'The Smitten editor at ', h('strong', {}, host(origin)), ' wants to publish games for ',
      h('strong', {}, user.displayName), ` (@${user.username}).`),
    h('ul', { class: 'facts' },
      h('li', {}, 'It can publish, update and remove your games.'),
      h('li', {}, "It can't change your password or your account."),
      h('li', {}, 'You can sign it out any time in your account settings.')),
    h('p', { class: 'fine' }, 'Only allow this if you just chose Sign in in the editor yourself. ', switchUser),
    h('div', { class: 'row-actions end' }, cancelButton, allowButton));
  allowButton.focus();
}

main();
