# Host interface

A game in the web player can run inside a **host page**. The host page
shows the player in a frame and gives the game **features**, for example
cloud saves. The page of a game on the games site is a host page. Any
other site can be a host page too: a school portal, a wrapper page on
itch.io, or your own site.

The host page and the player talk with **messages** (the `postMessage()`
function of the browser). This page tells which messages they send. It
also has a small host page that you can copy.

The game has no network access. The host page does all the work. The game
asks, and the host page answers.

## In a script

`smitten.host` tells a game which host page it runs in:

```lua
function ready()
  if smitten.host.name() == nil then
    Status.text = "No host page: saves stay on this computer."
  elseif smitten.host.has("cloudSaves") then
    Status.text = `Cloud saves on {smitten.host.name()}`
  end
end
```

| Where the game runs | `smitten.host.name()` | `smitten.host.has("cloudSaves")` |
| --- | --- | --- |
| Its page on the games site | `"smitten-games"` | `true` |
| A host page of another site | The name that the page gives | What the page gives |
| **Play** in the editor, an exported game alone, any other place | `nil` | `false` |

The engine knows the host page before the first `ready()`.

<!-- module:host -->
| Function | |
| --- | --- |
| `smitten.host.name()` | Returns the name of the page that hosts the game: "smitten-games" on the games site. Returns nil when no page hosts the game (in the editor, or an exported game alone). |
| `smitten.host.info()` | Returns { name, version, protocol, features } of the host (a new table each time), or nil when no page hosts the game. |
| `smitten.host.has(feature)` | Returns true if the host has a feature: smitten.host.has("cloudSaves"). The features are "cloudSaves", "boards" and "net". |
| `smitten.host.user()` | Returns the name of the player who is signed in on the host, or nil. |
<!-- end -->

## Features

| Feature | Module | What the host page does |
| --- | --- | --- |
| `"cloudSaves"` | `smitten.cloud` ([Saving](saving.md#saves-in-the-cloud)) | It keeps values for the game, for example on the account of the player |
| `"boards"` | `smitten.boards` ([Leaderboards](leaderboards.md)) | It keeps scores and gives the best scores |
| `"net"` | `smitten.net` ([Online rooms](online.md)) | It connects the game to a room on a server |

A host page gives only the features that it has. If a game calls a module
whose feature the host page does not have, the call gives `nil,
"unavailable"`. This is the same as when there is no host page.

## The messages

All messages go between the host page and the frame of the player. Both
must be on the same origin (the same scheme, domain and port). The player
ignores messages from other origins.

1. The host page shows the player in a frame, with `host=1` in the address
   of the frame: `index.html?host=1`.
2. The player sends `hello` to the host page.
3. The host page answers with its own `hello`.
4. The game sends `request` messages. The host page answers each one with
   a `reply`.

The player waits up to 0.4 seconds for the `hello` of the host page before
the game starts. If the host page answers later, the game gets the answer
then. Without `host=1`, the player sends nothing and listens to nothing.

### The envelope

The player sends this object with `postMessage()` to the host page:

```js
{ source: 'love-player', type: 'site', message: { /* the message */ } }
```

The host page sends this object to the frame of the player:

```js
{ type: 'site', message: { /* the message */ } }
```

The player sends other objects too, with `source: 'love-player'` and other
types (`ready`, `log`, `display`, ...). A host page can ignore them.

### Hello

The player sends:

```js
{ type: 'hello', protocol: 1 }
```

The host page answers:

```js
{ type: 'hello', protocol: 1, name: 'my-site', version: '1', features: ['cloudSaves'], user: { name: 'Ada' } }
```

| Field | |
| --- | --- |
| `protocol` | The version of these messages. This page tells version 1 |
| `name` | A short name for the host page, 64 characters at most. `smitten.host.name()` returns it |
| `version` | The version of the host page, as text, 32 characters at most |
| `features` | A list of the features that the host page has |
| `user` | Optional. `{ name }`: the name of the player who is signed in. `smitten.host.user()` returns it. Leave it out when nobody is signed in |

The host page can send `hello` again, for example after the player signs
in. The new `hello` replaces the old one.

Give the game only what it needs. A game is code that somebody else
wrote. Do not put an email address, an account id or a token in `user`.

### Requests and replies

A request from the game:

```js
{ type: 'request', id: 7, call: 'cloud.load', key: 'progress' }
```

The host page answers with the same `id`, with `ok: true` and a `result`
table:

```js
{ type: 'reply', id: 7, ok: true, result: { data: '{"level":3}' } }
```

Or it answers with `ok: false` and a `reason`, which the game gets as the
second value:

```js
{ type: 'reply', id: 7, ok: false, reason: 'signed-out' }
```

- The `id` is a number. Each request has a new one.
- If no reply comes in 10 seconds, the call gives `nil, "timeout"`.
- The game sends 16 requests at most at one time. More give `nil, "busy"`.
- A message from the host page to the player can be 160 KB at most, as
  JSON. The player ignores a longer message.

## Cloud saves

A host page with the `"cloudSaves"` feature answers four calls. `key` is 1
to 64 letters, digits, `_`, `.` or `-`, with a letter or a digit first.
`data` is the value of the game as JSON text, 64 KB (65,536 bytes) at
most. Keep `data` as it is: the engine makes it and reads it.

| `call` | Fields | `result` |
| --- | --- | --- |
| `"cloud.save"` | `key`, `data` | `{}` |
| `"cloud.load"` | `key` | `{ data }`, with `data: null` if there is no save with this key |
| `"cloud.list"` | none | A list of `{ key, size, time }`: `size` in bytes, `time` in seconds since 1970 (as `os.time()` gives it) |
| `"cloud.remove"` | `key` | `{}`, also if there was no save |

Each host page keeps the saves of each game apart. If it has accounts, it
also keeps the saves of each account apart. The host page knows which
game it shows: do not take that from the game.

Use these reasons in a `reply`, so that games can show a correct message:

| `reason` | When |
| --- | --- |
| `"signed-out"` | The host page keeps cloud saves only for a player who is signed in, and nobody is signed in |
| `"too-big"` | The value is longer than the host page accepts |
| `"quota"` | The game has too many saves, or too many bytes in its saves |
| `"too-many"` | The game saved or loaded too many times in a short time |
| `"offline"`, `"timeout"` | The host page did not get an answer from its server |
| `"error"` | Any other problem |

## Leaderboards and online rooms

The games site has the `"boards"` and `"net"` features. Another host page
can have them too:

- **boards**: requests with `call` set to `"submit"` (`key`, `value`,
  `name`), `"top"` and `"around"` (`key`, `count`), and `"list"`. The
  results are what [Leaderboards](leaderboards.md) tells.
- **net**: messages with `type: 'net'` in place of requests and replies,
  in both directions. The page of a game on the games site
  (`platform/public/play.js`) is the reference for these messages.

Hosts from before version 1 of these messages sent `boards: true` and
`net: true` in their `hello`, with no `features`. The engine still accepts
this.

## A host page to copy

This page hosts a web export of a game. It keeps cloud saves in the
browser (`localStorage`), so the saves stay on one computer. A real site
sends them to its server, and keeps them on the account of the player. The
same page is in the Smitten repository as `docs/host-example.html`.

1. Export the game: **Project › Export** › **Web game (zip)**.
2. Unzip the export.
3. Put this page in the folder of the export, next to `index.html`.
4. Change `name` in `HOST` to the name of your site.
5. Upload the folder to your site.
6. Open this page in place of `index.html`.

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My game</title>
<!--
  A host page for a Smitten web export (docs/host-interface.md).
  Put this file in the folder of the export, next to its index.html. This
  page shows the game in a frame, answers the hello of the game, and keeps
  the cloud saves of the game in this browser (localStorage). A real site
  sends the saves to its server instead.
-->
<style>
  html, body { margin: 0; height: 100%; background: #000; }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
</style>
<iframe id="game" src="index.html?host=1" title="Game" allow="autoplay; fullscreen; gamepad"></iframe>
<script>
const frame = document.getElementById('game');
const HOST = { name: 'my-site', version: '1', features: ['cloudSaves'] };
const PREFIX = 'my-site-cloud:';  // the localStorage names of the saves
const MAX_BYTES = 65536;          // the most data in one save

const bytes = (text) => new TextEncoder().encode(text).length;
const now = () => Math.floor(Date.now() / 1000);

// One cloud call: {result} or {reason}.
function cloud(msg) {
  if (msg.call === 'cloud.list') {
    const list = [];
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name.startsWith(PREFIX)) continue;
      const save = JSON.parse(localStorage.getItem(name));
      list.push({ key: name.slice(PREFIX.length), size: bytes(save.data), time: save.time });
    }
    return { result: list };
  }
  const name = PREFIX + msg.key;
  if (msg.call === 'cloud.save') {
    if (bytes(msg.data) > MAX_BYTES) return { reason: 'too-big' };
    try {
      localStorage.setItem(name, JSON.stringify({ data: msg.data, time: now() }));
    } catch {
      return { reason: 'quota' };
    }
    return { result: {} };
  }
  if (msg.call === 'cloud.load') {
    const save = JSON.parse(localStorage.getItem(name) || 'null');
    return { result: { data: save ? save.data : null } };
  }
  if (msg.call === 'cloud.remove') {
    localStorage.removeItem(name);
    return { result: {} };
  }
  return { reason: 'unknown-call' };
}

addEventListener('message', (e) => {
  // Only messages from the game's frame, on this page's own origin.
  if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
  if (e.data?.source !== 'love-player' || e.data.type !== 'site') return;
  const msg = e.data.message;
  const send = (message) => frame.contentWindow.postMessage({ type: 'site', message }, location.origin);
  if (msg.type === 'hello') {
    send({ type: 'hello', protocol: 1, ...HOST });
  } else if (msg.type === 'request') {
    const { result, reason } = String(msg.call).startsWith('cloud.') ? cloud(msg) : { reason: 'unavailable' };
    send(result ? { type: 'reply', id: msg.id, ok: true, result } : { type: 'reply', id: msg.id, ok: false, reason });
  }
});
</script>
</html>
```

If the site must open the game first (itch.io opens `index.html`), change
the names of the files:

1. Change the name of the `index.html` of the export to `player.html`.
2. Save this page as `index.html`.
3. In this page, change `src="index.html?host=1"` to
   `src="player.html?host=1"`.

## Rules for a host page

- Check each message. Use only messages whose `source` is the frame of
  the player and whose `origin` is your own origin.
- Send messages only to your own origin, as the example does. Do not use
  `'*'`.
- The host page chooses the game, the account and the address of its
  server. Never take these from a message of the game.
- Limit what a game can do: the size of each save, the number of saves,
  and the number of calls in one hour.
- Answer each request, also with `ok: false`. Otherwise the game waits 10
  seconds for each call.
