# Smitten games

A site where people publish games from Smitten's editor and anyone can play
them in the browser, in the spirit of Scratch's or Roblox's game pages. It's
a plain Node server with no dependencies: SQLite (`node:sqlite`) holds
accounts and metadata, game files sit on disk, and the gallery, the game
pages and Smitten's player are static files it serves. It's made to run on
[Hack Club Nest](https://guides.hackclub.app/), Hack Club's free hosting for
teenagers, and anywhere else Node 24 runs.

| Gallery | A game's page |
| --- | --- |
| ![The gallery: newest games as cards with thumbnails and play counts](docs/gallery.png) | ![A game's page: the game running in the player, with Remix, Fullscreen and Report](docs/play.png) |

- **Accounts**: a username, a display name and a password (or Hack Club's
  sign-in). No email, no real names. Recovery codes instead of email resets.
- **Publish** from the editor (`web/editor/publish.js`): signed in, with a
  title, a description and an optional thumbnail. Games belong to the
  account, so they can be updated from any computer.
- **Gallery** (`/`): newest or most played games, and search.
- **Play** (`/play/<id>`): the game in Smitten's player, who made it,
  **Remix** (opens the editor with a copy) and **Report**.
- **Profiles** (`/u/<username>`): someone's public games.
- **Account settings** (`/account`): display name, password, recovery
  codes, Hack Club, where you're signed in (browsers and editors, each can
  be signed out), your games, deleting the account.
- **Moderation**: reports hide a game after three people report it;
  moderators hide, restore and delete games, and ban accounts.

## Running it locally

You need Node 24 or newer and a build of Smitten (`python3 build.py` in the
repository root, which writes `dist/`).

```bash
cd platform
sh scripts/copy-player.sh          # copies the player from ../dist (or pass a dist folder)
ADMIN_TOKEN=dev-admin node src/server.js
```

Open http://localhost:8787. Data goes to `platform/data/` (the database,
game files, and a generated secret); `PORT`, `DATA_DIR` and the other
settings in [`deploy/env.example`](deploy/env.example) can go in the
environment or in `platform/.env`. To fill the gallery with the editor's
templates, published by an account called "templates":

```bash
node scripts/seed.mjs http://localhost:8787
```

### Publishing from the editor, locally

The editor (http://localhost:8766) is one of the default `EDITOR_ORIGINS`,
and its **Settings › Publishing** says where the site is
(http://localhost:8787 by default). Project › Publish asks you to sign in
first. `dev/publish-harness.html` stands in for the editor, with buttons to
sign in and out: serve the repository root on port 8796 (also allowed) with
`python3 -m http.server 8796 --bind 127.0.0.1` and open
http://localhost:8796/platform/dev/publish-harness.html.

### Tests

```bash
node tools/platform-tests/test.mjs       # from the repository root
```

It starts the server on port 8788 (`PLATFORM_PORT`) with an empty data
folder, an admin token and a stand-in for Hack Club Auth, and runs 108
checks: pages and headers, CORS, signing up, in and out, passwords and
their rate limits, CSRF, recovery codes and reset links, account settings,
the editor's sign-in and its tokens, publishing, ownership, listing, search
and profiles, plays, validation and the word filter, remixes, claiming old
games, reports, moderation, banning, Hack Club sign-in, deleting games and
accounts, and rate limits. `PLATFORM_URL` tests a running server instead
(it needs `TRUST_PROXY=1` and `PUBLIC_URL` set to that address; tests that
need the database or the Hack Club stand-in are skipped).

## How it works

```
platform/
  src/server.js            Node's http server: routing, pages, static files, the player's URL check
  src/config.js            settings (deploy/env.example)
  src/db.js                SQLite, migrations, ids, tokens, rate limits
  src/auth.js              passwords (scrypt), sessions, editor tokens, CSRF and sign-in checks
  src/account.js           sign up/in/out, recovery, settings, profiles, claiming, the editor's sign-in
  src/hackclub.js          Sign in with Hack Club (OpenID Connect)
  src/games.js             publishing, playing, listing, reporting
  src/admin.js             moderation
  src/storage.js           game files on disk
  src/validate.js          titles, descriptions, usernames, passwords, the word filter, PNGs, modules
  src/zip.js               .love checks
  src/http.js              JSON, cookies, security headers, CORS
  migrations/              the schema, applied in order on start
  config/blocked-words.json the word filter's list
  public/                  the pages and their scripts, site.css
  public/player/           Smitten's player (copied, not in git)
  scripts/                 copy-player.sh, seed.mjs, admin.mjs, backup.mjs
  deploy/                  env.example, systemd units, an optional Caddyfile
  dev/publish-harness.html stand-in for the editor
```

- **Storage.** `<DATA_DIR>/smitten.db` (SQLite in WAL mode) has `users`,
  `sessions`, `editor_codes`, `recovery_codes`, `password_resets`, `games`,
  `reports`, `plays`, `rate_limits` and `admin_log`.
  `<DATA_DIR>/games/<id>/game.love` and `thumbnail.png` are the files,
  written to a temporary file and renamed so a download never sees half of
  one. Migrations (`migrations/NNNN_*.sql`) run on start; `PRAGMA
  user_version` says which have.
- **Playing.** `/play/<id>` is `play.html` with the title and description
  filled in for link previews. `play.js` puts the player in a sandboxed
  iframe: `/player/player.html?game=/api/games/<id>/<title>.love&modules=physics2d`.
  The server refuses a `?game=` that isn't one of this site's games, so the
  player can't run games from elsewhere. The sandbox has no `allow-popups`
  or `allow-top-navigation`.
- **Plays** count once per person per game per day: per account when signed
  in, otherwise per address.
- **Updates** replace the game, its metadata and its thumbnail and bump
  `version`; the id, plays and `remixOf` stay. A hidden game stays hidden.

## Accounts

- **Signing up** takes a username (3 to 20 characters: lower-case letters,
  numbers, `-` and `_`; not reserved names like "admin"; through the word
  filter, look-alike letters included), an optional display name (40
  characters, word filter) and a password (8 to 200 characters; not a
  common one, not containing the username). No email, no age, no real
  name; the sign-up page says to use a nickname. Five sign-ups per address
  and hour.
- **Passwords** are hashed with scrypt (N = 2^15, r = 8, p = 1, a 16-byte
  salt), about 50 ms each. Ten failed sign-ins lock an account for the rest
  of the hour, from any address; each address gets 30 sign-in attempts an
  hour. A sign-in with an unknown username takes as long as a real one.
- **Sessions** are a cookie, `smitten_session`: a random 256-bit token
  (only its SHA-256 is stored), `HttpOnly`, `SameSite=Lax`, `Secure` on
  https, 30 days after last use. Requests that change anything with the
  cookie must come from the site's own pages (`Origin`, or
  `Sec-Fetch-Site: same-origin`), so other sites can't use it (CSRF).
  Changing the password or resetting it signs out everywhere else.
- **Recovery.** Nest blocks outgoing mail on port 25 and has no mail
  service ([FAQ](https://guides.hackclub.app/index.php/Frequently_Asked_Questions)),
  and collecting emails from teenagers is data we'd rather not hold. So
  instead: eight **recovery codes** shown once at sign-up (copy or
  download, and a checkbox before continuing), each resetting the password
  once, renewable in settings; and a moderator can make a one-time **reset
  link** valid for a day (`node scripts/admin.mjs reset-link <username>`)
  for someone who lost both. Accounts made with Hack Club recover through
  Hack Club.
- **Sign in with Hack Club**, through [Hack Club Auth's OpenID
  Connect](https://auth.hackclub.com/docs/oidc-guide), when
  `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` are set: the
  authorization code flow with `state` and PKCE, the code swapped with the
  client secret, and the `sub` from the userinfo endpoint. Only `sub` is
  kept (scope `openid`, so no name or email is even asked for). Someone new
  picks a username next; an existing account can connect Hack Club in its
  settings. Register the app at https://auth.hackclub.com/developer/apps
  with the redirect URI `<PUBLIC_URL>/auth/hackclub/callback`.
- **Games belong to accounts.** Publishing, updating and deleting need the
  owner's session or editor token. Games published before accounts (with
  an edit token) have no owner until claimed.
- **Claiming.** The editor keeps the edit tokens of games it published
  before accounts. When someone signs in, it sends them
  (`POST /api/account/claim`), and the games whose token matches and that
  have no owner yet become theirs; their tokens stop working.
- **Profiles** show the display name, username, join date and public games.
  Nothing else is public.
- **Deleting an account** (password, or typing the username for Hack Club
  accounts without one) deletes its games and their files right away.

### The editor's sign-in

The editor runs on another origin, so it never sees the password or the
site's cookie. It gets an **editor token** instead:

1. The editor makes a random `verifier` and `state` and opens a popup at
   `/editor-auth?origin=<its origin>&state=<state>&challenge=<base64url SHA-256 of the verifier>`.
   It opens the popup right in the click, before anything asynchronous,
   so browsers don't block it.
2. If the person isn't signed in on the site, the popup takes them through
   sign-in or sign-up and back. It then shows which editor is asking and
   for which account, and what it can do. Only origins in `EDITOR_ORIGINS`
   are accepted.
3. On **Allow**, the page asks the site for a one-time code
   (`POST /api/auth/editor/code`: needs the session cookie, same-origin)
   bound to the account, the editor's origin and the challenge, good for
   five minutes, and posts `{state, code}` to `window.opener` with
   `targetOrigin` set to that origin, so no other window can receive it.
   The sign-in pages are served without `Cross-Origin-Opener-Policy` so the
   popup keeps its opener.
4. The editor checks the message came from the site's origin with its
   `state`, and swaps the code and the verifier for a token
   (`POST /api/auth/editor/token`, CORS). The site checks the verifier
   against the challenge, that the request's `Origin` is the one the code
   was made for, and uses the code up whatever happens.

If the popup loses track of the editor (some sign-in pages cut a popup off
from its opener), it shows the code to paste into the editor's waiting
dialog instead; without the editor's verifier the code is useless to
anyone else. Editor tokens are 256-bit bearer tokens (stored as SHA-256),
valid for 90 days after their last use, at most 20 per account. They can
publish, update and delete the account's games, list them, and claim old
ones, but not change the password, the display name or delete the account;
account settings list them ("The editor at …") with **Sign out**, and
changing the password revokes them. CORS headers go only to
`EDITOR_ORIGINS`, never with credentials.

## The editor's side

`web/editor/account.js`:

```js
import { account, signIn, signOut, onChange, accountEvents } from './account.js';

account();                      // {username, displayName, hasPassword, hackclub, createdAt} or null
await signIn();                 // from a click: opens the popup; the user, or null if cancelled
await signOut();                // revokes the editor's token on the site
const off = onChange((user, platformUrl) => { /* update the account button */ });
```

Each takes an optional platform URL (`signIn({platformUrl})`), defaulting
to the editor's `platformUrl` setting; accounts are kept per site in
localStorage (`smitten-editor.account`). `onChange` also fires for changes
in other tabs and when the `platformUrl` setting changes. It also exports
`refreshAccount()` (asks the site, e.g. after a revoked token),
`accountToken()` and `clearAccount()`. It uses only `ui.js` and
`settings.js`, and existing classes, so it needs no CSS of its own.

`web/editor/publish.js`:

```js
import { publishDialog, fetchRemix, rememberRemix } from './publish.js';

await publishDialog(project, { files: project.snapshot(), modules: includedModules(project), platformUrl });
const { name, files, remixOf } = await fetchRemix(platformUrl, id);   // <editor>#remix=<id>
```

- `publishDialog` asks you to sign in when you aren't (or the site signed
  the editor out), shows **Publishing as <name> (@username)** with Switch
  account and Sign out, and resolves with `{id, url, version}`,
  `{deleted: id}` or `null`.
- Which game each project was published as is in localStorage under
  `smitten-editor.published` (`{[gameId]: {projectId, owner, title, url, ...}}`).
  Publishing a project that's in there updates its game, if it's yours.
- On sign-in it claims this browser's old games (`claimLocalGames()`) and
  says how many it added.
- `fetchRemix` names the copy "<title> (remix)"; `rememberRemix(projectId,
  gameId)` makes its first publish record `remixOf`.

## API

All responses are JSON, except the game file, the thumbnail and the
`/auth/hackclub` redirects. Errors are `{"error": "a sentence for people",
"field": "title"}` with a 4xx status, and `code` where the editor needs to
tell cases apart (`sign-in`, `signed-out`, `banned`, `use-hackclub`,
`bad-code`). "Session" means the cookie from a page on this site; "editor"
means `Authorization: Bearer <editor token>`.

| Endpoint | Who | What it does |
| --- | --- | --- |
| `GET /api/config` | anyone | Editor URL and origins, report reasons, modules, limits, `accounts.hackclub` |
| `GET /api/games?sort=new\|popular&q=&user=&limit=24&cursor=` | anyone | Public games, newest or most played; `q` searches titles and descriptions, `user` filters by username |
| `POST /api/games` | session or editor | Publish: `multipart/form-data` with `meta` (JSON: `title`, `description`, `modules`, `engineVersion`, `remixOf`), `game` (the `.love`), optionally `thumbnail` (PNG). `201 {id, game}` |
| `GET /api/games/<id>` | anyone | A game, with `owner`, `remixOf: {id, title}` and `remixes`; `yours: true` for its owner |
| `PUT /api/games/<id>` | owner | Publish an update (the same form) |
| `DELETE /api/games/<id>` | owner | Delete the game and its files |
| `GET /api/games/<id>/<name>.love` | anyone | The game (`application/zip`, as an attachment; ETag and 304s) |
| `GET /api/games/<id>/thumbnail.png` | anyone | The thumbnail |
| `POST /api/games/<id>/play` | anyone | Count a play |
| `POST /api/games/<id>/report` | anyone | Report: `{reason, note}` |
| `GET /api/users/<username>` | anyone | A profile: `{username, displayName, createdAt, games}` |
| `POST /api/auth/signup` | the site's pages | `{username, displayName, password}` (or `{via: "hackclub", username}` after Hack Club). Sets the session; `201 {user, recoveryCodes}` |
| `POST /api/auth/signin` | the site's pages | `{username, password}`. Sets the session |
| `POST /api/auth/signout` | session | Ends it |
| `POST /api/auth/recover` | the site's pages | `{username, code, password}` or `{resetToken, password}`. Signs out everywhere, then in here |
| `POST /api/auth/editor/code` | session | `{origin, challenge}`: a one-time code for the editor's popup |
| `POST /api/auth/editor/token` | editor origin | `{code, verifier}`: `{token, user}` |
| `DELETE /api/auth/editor/token` | editor | Sign the editor out |
| `GET /api/account` | session or editor | `{user, via}` or `{user: null}` (401 for an editor token that no longer works) |
| `PATCH /api/account` | session | `{displayName}` |
| `DELETE /api/account` | session | `{password}` or `{confirm: username}`: delete the account and its games |
| `POST /api/account/password` | session | `{current, password}`: change (or set) it; signs out everywhere else |
| `POST /api/account/recovery-codes` | session | `{password}`: eight new codes |
| `GET /api/account/sessions` | session | Where you're signed in |
| `DELETE /api/account/sessions/<id>` | session | Sign one out |
| `POST /api/account/sessions/revoke-others` | session | Sign out everywhere else |
| `GET /api/account/games` | session or editor | Your games, hidden ones too, with `status` |
| `POST /api/account/claim` | session or editor | `{games: [{id, token}]}`: claim games published with edit tokens |
| `GET /auth/hackclub?next=&link=1` | anyone | Off to Hack Club's sign-in (when configured) |
| `GET /auth/hackclub/callback` | Hack Club | Back from it |

Moderation, with `Authorization: Bearer <ADMIN_TOKEN>` (or
`node scripts/admin.mjs`, which calls them on the same machine):

| Endpoint | What it does |
| --- | --- |
| `GET /api/admin/reports` | Hidden and reported games, with owners and open reports |
| `POST /api/admin/games/<id>/hide` | Hide a game |
| `POST /api/admin/games/<id>/restore` | Make it public again and close its reports |
| `DELETE /api/admin/games/<id>` | Delete it |
| `GET /api/admin/users/<username>` | An account: status, how it signs in, its games |
| `POST /api/admin/users/<username>/ban` | `{reason}`: sign it out everywhere, hide its public games and profile, block sign-in |
| `POST /api/admin/users/<username>/unban` | Lift the ban; games the ban hid come back |
| `POST /api/admin/users/<username>/reset-password` | A one-time reset link, valid a day |
| `DELETE /api/admin/users/<username>` | Delete the account and its games |
| `GET /api/admin/log` | What moderators did |
| `GET /api/admin/request` | The client address the server sees (to check `TRUST_PROXY`) |

Hidden games return 404 with `"hidden": true` to everyone except their
owner and admins.

## Safety

The audience is teenagers:

- **Little personal data.** Accounts are a username, a display name and a
  password hash (or a Hack Club id). No email, no real name, no age, no
  profile pictures, no comments or messages: people can't contact each
  other through the site. IP addresses are only stored as salted hashes,
  in rate limits and anonymous reports and plays.
- **Reports.** Every game page has Report, with reasons and an optional
  note. Each reporter (account, or address when signed out) counts once per
  game. When `REPORT_THRESHOLD` (3) different reporters have open reports,
  the game is hidden from the gallery, search, profiles and its page, and
  its files stop being served, until a moderator restores it (closing the
  reports) or deletes it.
- **Bans** sign an account out everywhere, block signing in and recovery,
  hide its profile and public games, and are logged.
- **Limits.** Games up to 25 MB (256 MB unpacked, 10,000 files);
  thumbnails 1 MB and 4096×4096; titles 60 characters, descriptions 1000,
  report notes 500, display names 40. Request bodies past the limit are
  cut off as they arrive. Publishing: 10 an hour per account. Reports: 20
  an hour per address and per account.
- **Zip checks.** A plain zip (no encryption, ZIP64 or unusual
  compression) with `main.lua` or `smitten.json` at its root, no absolute
  or `..` paths. Thumbnails must be real PNGs.
- **Word filter** on titles, descriptions, usernames and display names
  (`config/blocked-words.json`): whole words with endings, look-alike
  characters, spaced or dotted letters, stretched letters, some strings
  inside words, and phrases. Control and invisible characters are removed.
- **Headers.** `nosniff`, a `Content-Security-Policy` (pages: only the
  site's own scripts, never framed; the player: framed only by the site,
  `connect-src` limited by `GAME_NETWORK`; files and JSON: `sandbox`), a
  `Referrer-Policy` (`no-referrer` on sign-in pages), a
  `Permissions-Policy` without camera, microphone or location, and HSTS on
  https.

## Configuration

Every setting is an environment variable, also read from `platform/.env`
(or the file in `ENV_FILE`). [`deploy/env.example`](deploy/env.example)
lists them all with their defaults; the ones to set when deploying are
`PUBLIC_URL`, `PORT`, `HOST`, `TRUST_PROXY`, `DATA_DIR`, `EDITOR_URL`,
`EDITOR_ORIGINS` and `ADMIN_TOKEN`, plus `HACKCLUB_CLIENT_ID` and
`HACKCLUB_CLIENT_SECRET` for Hack Club's sign-in. `SECRET` is generated
into `DATA_DIR/secret` if not set.

## Deploying on Hack Club Nest

What Nest gives you, from its guides:

- A Linux container (Debian or Ubuntu) with 2 cores, 2 GB of memory and
  16 GB of storage by default, more on request; no public IPv4, but a
  reverse proxy for http(s)
  ([Limitations](https://guides.hackclub.app/index.php/Limitations),
  [FAQ](https://guides.hackclub.app/index.php/Frequently_Asked_Questions),
  [Docker](https://guides.hackclub.app/index.php/Docker)).
- Domains from the dashboard's **Domains** tab: your program listens on all
  addresses on a port, and the dashboard sends a domain to it, for
  example `games.<you>.hackclub.app`, or your own domain with a CNAME to
  `<you>.hackclub.app`
  ([Dashboard](https://guides.hackclub.app/index.php/Dashboard)).
- systemd services, which come back after a restart
  ([Systemd](https://guides.hackclub.app/index.php/Systemd)).
- Automatic daily backups of the container at 9 pm UTC, restorable from
  the dashboard ([Dashboard](https://guides.hackclub.app/index.php/Dashboard)).
- No database service and no email: port 25 is blocked
  ([FAQ](https://guides.hackclub.app/index.php/Frequently_Asked_Questions)).
  Hence SQLite in a file, and recovery codes rather than email resets.

Older guides describe Nest as a shared server with a personal Caddyfile and
`nest` commands; today's guides describe the container and the dashboard.
`deploy/Caddyfile` is there in case you run Caddy yourself.

### Steps

Apply at the [dashboard](https://dashboard.hackclub.app) (see the
[Quickstart](https://guides.hackclub.app/index.php/Quickstart)), then
`ssh <you>@hackclub.app`, as root in your container:

```bash
# Node 24 or newer (node:sqlite), from NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs git
node --version

# The code, and a user to run it
git clone <your Smitten repository> /opt/smitten
useradd --system --home /var/lib/smitten --shell /usr/sbin/nologin smitten

# Settings
mkdir -p /etc/smitten
cp /opt/smitten/platform/deploy/env.example /etc/smitten/env
nano /etc/smitten/env          # PUBLIC_URL, EDITOR_URL, EDITOR_ORIGINS, ADMIN_TOKEN, …
chown root:smitten /etc/smitten/env && chmod 640 /etc/smitten/env

# The service, and daily database backups
cp /opt/smitten/platform/deploy/smitten.service /opt/smitten/platform/deploy/smitten-backup.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now smitten smitten-backup.timer
systemctl status smitten
```

The player is built from the engine (Emscripten), so build it on your own
computer (`python3 build.py`, `sh platform/scripts/copy-player.sh`) and
copy it up:

```bash
rsync -a platform/public/player/ <you>@hackclub.app:/opt/smitten/platform/public/player/
```

In the dashboard's **Domains** tab, add your domain (e.g.
`games.<you>.hackclub.app`) with target port `8787` (the `PORT` in
`/etc/smitten/env`), and set `PUBLIC_URL` to `https://` that domain.

Then check that the server sees real client addresses through Nest's proxy
(Nest's guides don't say whether it sets `X-Forwarded-For`):

```bash
cd /opt/smitten/platform
ENV_FILE=/etc/smitten/env node scripts/admin.mjs request
curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://games.<you>.hackclub.app/api/admin/request
```

From your own computer, the second should show your address as
`clientIp`. `peer` is the address the connection came from (Nest's proxy).
`X-Forwarded-For` is only believed from loopback and private addresses with
`TRUST_PROXY=1`, because a Nest container also has a public IPv6 address
that anyone could connect to directly; if the proxy's `peer` is a public
address, list it in `TRUST_PROXY` instead. If there's no `X-Forwarded-For`
at all, rate limits for signed-out people are shared by everyone (account
limits still work).

Finally, point the editor at it: `EDITOR_ORIGINS` must list the editor's
origin, and in the editor, **Settings › Publishing** is the site's URL.

- **Updating:** `cd /opt/smitten && git pull && systemctl restart smitten`.
  New migrations run on start.
- **Logs:** `journalctl -eu smitten`.
- **Backups:** Nest backs up the container daily; `smitten-backup.timer`
  writes a consistent copy of the database to `/var/lib/smitten/backups`
  half an hour before (14 kept), since copying a database file while it's
  being written can catch it half-done. To restore one:
  `systemctl stop smitten`, copy it over `/var/lib/smitten/smitten.db`
  (and delete `smitten.db-wal` and `smitten.db-shm`), `systemctl start smitten`.
  Game files are only ever replaced whole, so the container backup (or
  `rsync -a /var/lib/smitten/games/ …`) covers them.
- **Moderating:** `node scripts/admin.mjs reports | ban <username> |
  reset-link <username> | …` (with `ENV_FILE=/etc/smitten/env`).

## Limits of this version

- **Moderation is a command line.** No dashboard and no notifications when
  a game is hidden; the admin log is there, but there's one shared admin
  token rather than moderator accounts.
- **A banned person can make a new account** (sign-ups are limited per
  address, which a school network shares). Requiring Hack Club's sign-in,
  or its `verification_status`, would make bans stick.
- **Anonymous reports and plays go by address**: a whole school behind one
  address counts as one reporter. Signed-in reports count per account.
- **The player shares the site's origin**, as before: the iframe sandbox
  needs `allow-same-origin` for save files. A separate origin for the
  player and game files is the robust setup.
- **One server process**, which is plenty on Nest. Search is `LIKE`,
  pagination is by offset, updates overwrite the previous version.

## Next steps

- A moderation page behind moderator accounts (an `is_moderator` flag),
  with the report queue, the game running next to its reports, bans and
  the log, and a Slack alert when a game is hidden.
- Optionally require Hack Club's sign-in for publishing (verified
  teenagers, and bans that stick), or show a badge for Hack Club accounts.
- Likes, favorites and a "Featured" row.
- Versions: keep `v<n>.love`, roll back, remix an exact version.
