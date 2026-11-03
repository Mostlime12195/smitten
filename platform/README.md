# Smitten games (prototype)

A site where people publish games from Smitten's editor and anyone can play
them in the browser, in the spirit of Scratch's or Roblox's game pages. It's
one Cloudflare Worker: R2 holds the games, D1 (SQLite) holds everything else,
and the gallery, the game pages and Smitten's player are static files the
Worker serves.

| Gallery | A game's page |
| --- | --- |
| ![The gallery: newest games as cards with thumbnails and play counts](docs/gallery.png) | ![A game's page: the game running in the player, with Remix, Fullscreen and Report](docs/play.png) |

- **Publish** from the editor (`web/editor/publish.js`): a title, a
  description and an optional thumbnail (a PNG from the project). The game is
  uploaded as a `.love`. The site answers with the game's id and an *edit
  token*, which the editor keeps so the same project can publish updates
  (same link) or remove the game.
- **Gallery** (`/`): newest or most played games, and search.
- **Play** (`/play/<id>`): the game in Smitten's player, with the engine
  modules it needs; title, description, plays, **Remix** (opens the editor
  with a copy) and **Report**.
- **Remix**: the editor downloads a game's files to start a new project; when
  that project is published, its page says "Remix of …".
- **Safety**: no accounts, profiles, comments or messages; reports hide a
  game after three people report it, until a moderator reviews it; size,
  content and rate limits; strict headers. See "Safety" below.

## Running it locally

You need Node 20 or newer and a build of Smitten (`python3 build.py` in the
repository root, which writes `dist/`).

```bash
cd platform
npm install
sh scripts/copy-player.sh          # copies the player from ../dist (or pass a dist folder)
cp .dev.vars.example .dev.vars     # local secrets: the admin token and the IP salt
npx wrangler dev
```

Open http://localhost:8787. `wrangler dev` simulates R2 and D1 locally (in
`.wrangler/state`), and the Worker creates its tables on first use, so
there's no migration step. To fill the gallery with the editor's
templates (platformer, top-down, physics toy, pixel art):

```bash
node scripts/seed.mjs
```

### Publishing from the editor, locally

The editor runs on another origin (http://localhost:8766), which
`ALLOWED_ORIGINS` in `wrangler.toml` lets publish and remix. Until
`publish.js` is wired into the editor's menus, `dev/publish-harness.html`
stands in for it: it builds a fake project from `tools/scene-tests` and calls
`publishDialog` and `fetchRemix` exactly as the editor will. Serve the
repository root on port 8796 (also in `ALLOWED_ORIGINS`):

```bash
python3 -m http.server 8796 --bind 127.0.0.1     # in the repository root
```

and open http://localhost:8796/platform/dev/publish-harness.html.

### Tests

With `wrangler dev` running:

```bash
node tools/platform-tests/test.mjs       # from the repository root
```

It exercises the whole API (publishing, listing, search, updates and deletes
with and without the token, remixes, plays, reports and moderation, size and
zip checks, the word filter, rate limits, CORS and security headers) and
removes what it published. `PLATFORM_URL` points it elsewhere; the admin
token comes from `.dev.vars` or `ADMIN_TOKEN`.

Locally, `wrangler dev` passes a `CF-Connecting-IP` header sent by the
client through, so the tests (and `scripts/seed.mjs`, if you edit it) can act
as different people. On Cloudflare the edge sets that header and clients
can't.

## How it works

```
platform/
  wrangler.toml            bindings (R2, D1, assets), settings
  migrations/0001_init.sql the schema (games, reports, plays, rate_limits)
  config/blocked-words.json the word filter's list
  src/index.js             routing, pages, the player's URL check
  src/games.js             the public API
  src/admin.js             moderation endpoints
  src/validate.js          titles, descriptions, word filter, PNGs, modules, report reasons
  src/zip.js               .love checks
  src/db.js                schema setup, ids, tokens, IP hashing, rate limits
  src/http.js              JSON responses, security headers, CORS
  public/                  gallery (index.html, gallery.js), game page (play.html, play.js), site.css
  public/player/           Smitten's player (copied, not in git)
  scripts/                 copy-player.sh, seed.mjs
  dev/publish-harness.html stand-in for the editor
```

- **Storage.** `games/<id>/game.love` and `games/<id>/thumbnail.png` in R2.
  In D1: a `games` row per game (title, description, engine modules, Smitten
  version, `remix_of`, the SHA-256 of the edit token, version, plays,
  status), `reports`, `plays` (for counting each person once a day) and
  `rate_limits`. Ids are 10 characters of Crockford base32; tokens are 32
  random bytes, stored only as a hash.
- **Playing.** `/play/<id>` is `play.html` (the Worker fills in the title and
  description for link previews). `play.js` loads the game's metadata and
  puts the player in an iframe:
  `/player/player.html?game=/api/games/<id>/<title>.love&modules=physics2d`.
  The player downloads the `.love` (any `<name>.love` under the game's path
  is the same file; the player shows the name on its Play screen) and loads
  the modules before the game starts. The Worker refuses a `?game=` that
  isn't one of this site's games, so the player can't be used to run games
  from elsewhere. The iframe is sandboxed without `allow-popups` or
  `allow-top-navigation`, so a game can't open pop-ups (which is what
  `love.system.openURL` does on the web) or navigate the page.
- **Plays** are counted when a game's page is opened, once per person (IP
  address) per game per day.
- **Updates** replace the game, its metadata and its thumbnail (an update
  without a thumbnail removes it) and bump `version`; the id, plays and
  `remixOf` stay. A hidden game stays hidden when updated.

## API

All responses are JSON, except the game file and the thumbnail. Errors are
`{"error": "a sentence for people", "field": "title"}` with a 4xx status.
CORS headers go to the origins in `ALLOWED_ORIGINS`, for every endpoint
except the admin ones.

| Endpoint | What it does |
| --- | --- |
| `GET /api/config` | The editor URL, report reasons, engine modules and limits |
| `GET /api/games?sort=new\|popular&q=&limit=24&cursor=` | Public games, newest or most played first; `q` searches titles and descriptions; `next` is the cursor for more |
| `POST /api/games` | Publish. `multipart/form-data` with `meta` (JSON: `title`, `description`, `modules`, `engineVersion`, `remixOf`), `game` (the `.love`) and optionally `thumbnail` (PNG). Returns `201 {id, token, game}` |
| `GET /api/games/<id>` | A game's metadata, with `remixOf: {id, title}` and the number of `remixes` |
| `PUT /api/games/<id>` | Publish an update: the same form, with `Authorization: Bearer <token>`. 401 without a token, 403 with the wrong one |
| `DELETE /api/games/<id>` | Delete the game and its files, with the token |
| `GET /api/games/<id>/game.love` | The game (`application/zip`, as an attachment; ETag and 304s). For the player and for remixing |
| `GET /api/games/<id>/thumbnail.png` | The thumbnail |
| `POST /api/games/<id>/play` | Count a play |
| `POST /api/games/<id>/report` | Report: JSON `{reason, note}`; reasons are in `/api/config` |
| `GET /api/admin/reports` | Hidden and reported games, with their open reports |
| `POST /api/admin/games/<id>/hide` | Hide a game |
| `POST /api/admin/games/<id>/restore` | Make it public again and close its reports |
| `DELETE /api/admin/games/<id>` | Delete it |

Admin endpoints need `Authorization: Bearer <ADMIN_TOKEN>`, for example:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/api/admin/reports
```

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/api/admin/games/<id>/restore
```

Hidden games return 404 with `"hidden": true` to everyone except their owner
(with the edit token) and admins, who can still download them to review
them.

## The editor's side: `web/editor/publish.js`

```js
import { publishDialog, fetchRemix, rememberRemix } from './publish.js';

// Project › Publish…
await publishDialog(project, { files: project.snapshot(), modules: includedModules(project), platformUrl });

// <editor>#remix=<id>
const { name, files, remixOf } = await fetchRemix(platformUrl, id);
const p = await store.createProject(name, files);
rememberRemix(p.id, remixOf);
```

- `publishDialog` resolves with `{id, url, version}`, `{deleted: id}` or
  `null` (cancelled). It shows upload progress, the site's errors next to the
  field they're about, and a link to the game when it's done.
- Edit tokens are in localStorage under `smitten-editor.published`:
  `{[gameId]: {projectId, token, title, url, platformUrl, thumbnail, version, ...}}`.
  Publishing a project that's in there updates its game; the dialog also has
  **Remove from site**. If the game is gone from the site, it publishes a new
  one.
- `fetchRemix` names the copy "<title> (remix)" (also in its
  `smitten.json`). `rememberRemix(projectId, gameId)` (key
  `smitten-editor.remixes`) makes its first publish record `remixOf`. Without
  that call, a project created within ten minutes of `fetchRemix` under the
  returned name is recognized as the remix. `publishDialog` also takes
  `{remixOf}` and `{engineVersion}` options.
- It imports `./ui.js` and `./exporter.js` (the editor's own modules, at
  `web/editor/`) and nothing else.

## Safety

The audience is teenagers, so even the prototype is careful:

- **No accounts, profiles, comments or messages.** Edit tokens are the only
  identity; people can't contact each other through the site.
- **Reports.** Every game page has Report, with a list of reasons and an
  optional note. Each person (IP address) counts once per game. When
  `REPORT_THRESHOLD` (3) different people have open reports on a game, it's
  hidden from the gallery, search and its own page, and its files stop being
  served, until an admin restores it (which closes the reports) or deletes
  it.
- **Limits.** Games up to 25 MB (and 256 MB unpacked, 10,000 files),
  thumbnails up to 1 MB and 4096×4096, titles 60 characters, descriptions
  1000, report notes 500.
- **Zip checks.** A game must be a plain zip (no encryption, ZIP64 or
  unusual compression) with `main.lua` or `smitten.json` at its root, and no
  absolute or `..` paths. Thumbnails must be real PNGs.
- **Word filter** on titles and descriptions (`config/blocked-words.json`):
  whole words with common endings, look-alike characters (`sh1t`), spaced or
  dotted letters (`f.u.c.k`), stretched letters, a few strings blocked inside
  words and a few phrases. Control and invisible characters are stripped.
- **Rate limits** per IP address and hour: `PUBLISH_LIMIT_PER_HOUR` (10,
  updates included) and `REPORT_LIMIT_PER_HOUR` (20). IP addresses are only
  ever stored as salted hashes.
- **Headers.** Every response has `X-Content-Type-Options: nosniff`, a
  `Content-Security-Policy`, a `Referrer-Policy` and a `Permissions-Policy`
  that turns off the camera, microphone and location. The site's pages allow
  only their own scripts and can't be framed; the player can only be framed
  by the site and may only connect back to it (`GAME_NETWORK`); game files,
  thumbnails and JSON are served with `sandbox` and as attachments, never as
  pages. Games only ever run inside the player.

## Configuration

`[vars]` in `wrangler.toml`:

| Name | Default | |
| --- | --- | --- |
| `EDITOR_URL` | `http://localhost:8766/` | Where Make a game and Remix go (`#remix=<id>`) |
| `ALLOWED_ORIGINS` | the editor and the harness, locally | Comma-separated origins that get CORS headers |
| `REPORT_THRESHOLD` | `3` | Different people's open reports that hide a game |
| `MAX_GAME_BYTES`, `MAX_THUMBNAIL_BYTES` | 25 MB, 1 MB | |
| `PUBLISH_LIMIT_PER_HOUR`, `REPORT_LIMIT_PER_HOUR` | `10`, `20` | Per IP address |
| `GAME_NETWORK` | `self` | `self`: games can only reach this site with `require("https")`; `https`: any https site that allows CORS |

Secrets (`.dev.vars` locally, `wrangler secret put` when deployed):
`ADMIN_TOKEN` (admin endpoints are off without it) and `IP_SALT`.

## Deploying

With a Cloudflare account (Workers, R2 and D1 all have free tiers):

```bash
cd platform
npx wrangler login
npx wrangler d1 create smitten-games          # put the database_id it prints into wrangler.toml
npx wrangler r2 bucket create smitten-games
npx wrangler d1 migrations apply smitten-games --remote
npx wrangler secret put ADMIN_TOKEN            # a long random string
npx wrangler secret put IP_SALT                # another one
```

Set `EDITOR_URL` and `ALLOWED_ORIGINS` in `wrangler.toml` to the editor's
real address, copy the player from a fresh build (`sh scripts/copy-player.sh`),
then:

```bash
npx wrangler deploy
```

It's served at `smitten-platform.<account>.workers.dev`; add a custom domain
under the Worker's settings in the Cloudflare dashboard. Future schema
changes go in new files in `migrations/`, applied with
`wrangler d1 migrations apply smitten-games --remote` before deploying.

## What's prototype-only

- **Identity is an IP address.** A whole school behind one address shares the
  rate limits, counts as one reporter and one play a day. Accounts fix this.
- **Edit tokens live in one browser.** Clearing site data or switching
  computers means you can't update or remove your game (an admin still can).
- **Moderation is curl.** No dashboard, no notifications when a game is
  hidden, no audit log of admin actions.
- **The player shares the site's origin.** The iframe sandbox needs
  `allow-same-origin` for save files (IndexedDB), so the browser warns that
  the sandbox can be escaped; the player is the site's own code, but a
  separate origin for the player and game files (e.g. a `*.usercontent`
  domain) is the robust setup.
- **Every request runs the Worker** (`run_worker_first`), including the 7 MB
  engine, so security headers apply everywhere. Static assets could skip it
  with a narrower `run_worker_first` list and a `_headers` file.
- **Simple data access.** Search is `LIKE`, pagination is by offset, updates
  overwrite the previous version, plays are page views, the word filter is
  English only, thumbnails aren't resized, and the zip check reads only the
  zip's directory.

## Next steps

- **Hack Club sign-in.** Accounts through Hack Club's sign-in (OAuth), so
  games belong to a person rather than a browser. Tokens in localStorage
  can be claimed by the account on first sign-in; rate limits and reports
  then count per account, and a minimum age or a teacher/club-leader role can
  gate publishing.
- **Moderation dashboard.** A page behind admin sign-in: the report queue
  with the game running next to its reports, hide/restore/delete, bans by
  account, an audit log, and alerts (e.g. to a Slack channel) when a game is
  hidden.
- **Likes and favorites**, per account, and a "Featured" row picked by
  moderators.
- **Versions.** Keep `games/<id>/v<n>.love` in R2, show a changelog, roll
  back, and let a remix point at the exact version it came from.
- **CDN caching.** Serve the engine and modules with long `max-age`
  (their URLs already carry a build hash), game files under versioned URLs
  marked immutable, and cache the gallery's JSON for a few seconds at the
  edge.
- **Costs at small scale.** Storage is the main cost and R2 charges nothing
  for downloads. At the prices published in 2025: 1,000 games of 2 MB is
  2 GB, inside R2's free 10 GB; D1's free tier (5 GB, 5 million row reads a
  day) is far more than this needs; Workers' free tier is 100,000 requests a
  day, and a game page is about a dozen requests while the player's files go
  through the Worker, so roughly 8,000 game pages a day. Beyond that, the
  $5/month Workers Paid plan includes 10 million requests a month. Check Cloudflare's current pricing before relying on
  these numbers.
