# Smitten design

Status: draft, 2026-11-02. Decisions recorded in section 0; smaller open
questions in section 11.

Smitten is a purpose-built game engine for the browser, based on LÖVE and
Lua. You write code, draw sprites, paint tilemaps, make sound effects and
music, and publish a game, all in one tab and without installing anything.

Its engine and editor start from the code of
[Cupid](https://github.com/Mostlime12195/cupid), the real LÖVE 12 engine
compiled to WebAssembly with a Lua-to-WebAssembly JIT. Smitten is not built
*on* Cupid: it takes Cupid's code as its starting point, becomes its own
engine, and Cupid stays a separate product with no part in Smitten.

## 0. Decisions

| Question | Decision | Section |
| --- | --- | --- |
| Who it's for | Teenage beginners and game jams first (e.g. Hack Club members); experienced LÖVE developers a close second, with things that are clearly for them | 1 |
| Relationship to Cupid | Borrow Cupid's code as the starting point; Cupid isn't a dependency, a component or a brand inside Smitten | 2 |
| How far to fork LÖVE | Extend LÖVE, don't change it: keep `love.*` as in LÖVE 12, add Smitten's features as a new engine module | 3 |
| Language | Luau-like syntax built into Smitten's Lua parser, compiling to the same bytecode, so Cupid's JIT runs it natively. No transpiling, no VM swap | 4 |
| Aesthetic | Pixel-first defaults (tools, templates, sounds) with no enforced limits; no cartridge mode | 7 |
| Hosting | Its own domain, not a path next to Cupid on `mostlime12195.github.io` | 2 |

The language, aesthetic and hosting decisions came from the project owner. The
project owner left the fork-depth decision to this design (section 3 has
the reasoning) and can overturn it.

## 1. Scope and target users

### What Smitten is

- An all-in-one editor: code, pixel art, tilemaps, sound effects, music and
  assets in one browser app, working on the same project files.
- An engine: LÖVE 12 (the full `love.*` API) plus a `smitten` module that
  loads and plays what the tools make (`smitten.sprite("hero")`,
  `smitten.map("level1")`, `smitten.sfx("jump"):play()`) and a friendlier
  Lua (section 4).
- Code-first. The tools make assets; games are written in Lua.

### What it isn't

- Not a visual-scripting or no-code tool.
- Not a 3D engine.
- Not a fantasy console: no enforced resolution, palette or size limits.

### Users

1. **Primary: teenagers and beginners making their first games, and jam
   teams** (e.g. Hack Club members, game jams, classrooms). They're often
   on Chromebooks or locked-down school laptops, can't install LÖVE plus an
   editor, an art program and a sound tool, and need sharing to be easy.
   This group decides defaults, templates, wording and what goes in the
   MVP.
2. **Secondary: experienced LÖVE developers.** Not equal priority, but
   always something for them:
   - The complete `love.*` API, unchanged, so their knowledge, tutorials
     and libraries (bump, hump, anim8, ...) carry over.
   - Plain Lua and LuaJIT-dialect code runs as is; Smitten's syntax is
     optional.
   - `.love` export for projects that don't use Smitten-only features
     (section 8).
   - A keyboard-driven editor (command palette, shortcuts), and later
     Aseprite and Tiled import, local folders and git.

Out of scope: large teams, 3D, consoles, mobile app stores.

Positioning: *PICO-8's all-in-one workflow, with real LÖVE underneath and
no ceiling.*

## 2. Starting from Cupid's code

### What Smitten takes

Cupid is the most complete LÖVE-on-the-web codebase, and Smitten starts
from all of it:

| Cupid code | In Smitten |
| --- | --- |
| `love/` (LÖVE 12 at upstream `ef388d4`, with web patches) | The engine. Kept as LÖVE; Smitten adds a module (section 3) |
| `deps/lua-5.1.5/` (PUC Lua with LuaJIT extensions and the JIT, `ljit.inc`) | The VM. Smitten's syntax goes into its parser (section 4) |
| `deps/theora/`, `deps/luabitop/` | Unchanged |
| `web/native/` (`web_main.cpp`, `library_love.js`, `library_ljit.js`) | The web entry point; grows the editor ↔ game bridge |
| `web/player/` | Smitten's player, for the editor and published games |
| `web/editor/` (code editor, completions, console, file tree, storage, exporter, compatibility check, settings, command palette) | The base of Smitten's editor, which adds the tools in section 5 |
| `build.py`, `serve.py`, `package.py`, `.github/workflows/pages.yml` | Build, dev server, command-line export, deployment |
| `tools/` (JIT differential tests, smoke and feature test games, benchmarks) | Kept; Smitten's own tests are added next to them |

Everything user-facing is renamed to Smitten. The README credits Cupid as
the origin of the engine code and keeps LÖVE's, Lua's and the libraries'
licenses (zlib, MIT, BSD), as they require. Like Cupid, Smitten says it's
not affiliated with the LÖVE team.

### How: import Cupid's history, then diverge

Options:

| | How | Getting later Cupid fixes (JIT, web patches, LÖVE updates) |
| --- | --- | --- |
| **Import history** | Merge Cupid's `main` into this repository once (`git merge --allow-unrelated-histories`), then change it | `git fetch cupid && git merge cupid/main`: a real three-way merge; conflicts only where both changed the same code |
| Copy files | Copy the tree at a Cupid commit in one commit | By hand or by porting patches |
| Git submodule | Pin Cupid and build from it | Clean, but makes Cupid a component of Smitten, which isn't the intent |

**Decision: import history.** The engine directories (`love/`, `deps/`,
`web/native/`) keep Cupid's layout, so engine fixes merge cleanly; the
editor diverges and will conflict more, which is expected. Cupid is fetched
as a read-only remote; Smitten never pushes to it.

### Hosting and storage names

Decision: **Smitten is hosted on its own domain** (name to be chosen). It
can still be deployed with GitHub Pages, using a custom domain, or with any
static host that serves `.wasm` as `application/wasm`. Its own domain gives
it its own origin, so in production it shares no IndexedDB, localStorage or
storage quota with Cupid at `mostlime12195.github.io`.

Storage names still have to change, though. Smitten starts as a copy of
Cupid, so it starts with Cupid's names, and both dev servers default to
`http://localhost:8765`, the same origin. Running both locally (or Cupid
ever moving to a domain of its own) would otherwise mix their projects.
So, before the first deploy, and with Smitten's `serve.py` defaulting to a
different port (8766):

- Projects: Cupid's IndexedDB database is `love-web-studio`
  (`web/editor/fs-store.js`). Smitten's is `smitten`.
- Settings: Cupid stores `cupid.settings` and still migrates from
  `smitten.settings` (Cupid was briefly named Smitten). Smitten must use
  neither: its keys start with `smitten-editor.`, and its copy drops the
  migration. The theme key in `index.html` (`lws.theme`) changes too.
- Game save files: check the IndexedDB name the player's save filesystem
  (IDBFS) uses, and make it Smitten's own.

Also, GitHub currently redirects `github.com/Mostlime12195/smitten` to
Cupid (its old name); a new Smitten repository there replaces that
redirect.

## 3. The engine: extend LÖVE, don't change it

The project owner wants an easy, purpose-built engine that Smitten can
extend, and left the choice between C++ engine modules and a full LÖVE
fork open. Options:

1. **Lua library only**: no engine changes. Not enough: the language
   features (section 4) and a background-safe audio synthesizer need
   engine changes anyway.
2. **Extend**: Smitten owns its copy of LÖVE, keeps the `love.*` API and
   its behavior exactly as in LÖVE 12, and adds new things beside it: a
   `smitten` engine module (C++ and embedded Lua), syntax in the Lua
   parser, editor hooks in the web entry point.
3. **Change LÖVE**: rework `love.*` to suit Smitten (different callbacks,
   renamed functions, changed defaults).

**Decision: 2.** Reasons:

- LÖVE's tutorials, wiki, forum answers and libraries are the biggest
  learning resource Smitten's users will have. Changing `love.*` breaks
  all of them, and beginners can't tell which answer applies to which
  engine.
- Merging upstream LÖVE and Cupid fixes stays cheap when Smitten's changes
  are additions in new files.
- Nothing on the roadmap needs `love.*` changed. Ease of use comes from the
  `smitten` module, the tools, templates and the language sugar.

Rules that follow from it:

- `love.*` behaves as in LÖVE 12, except for web limits Cupid already
  documents.
- Patches to LÖVE's own code are for platform needs and bug fixes only,
  kept small and marked, as in Cupid.
- New engine features go in `love/src/modules/smitten/`, exposed as the
  global `smitten` (like `love`) and as `require("smitten")`.
- If something truly can't be done without changing LÖVE's behavior,
  record it here with the reason before doing it.

### The `smitten` module

Mostly Lua, embedded in the engine the way LÖVE embeds its own scripts
(`love/src/scripts/auto.lua` turns `.lua` files into `.lua.h` headers).
Projects don't carry a copy; `smitten.json` records the engine version they
were made with.

| Part | Language | Why |
| --- | --- | --- |
| Sprites and animation | Lua | Thin layer over `Image`, `Quad`, `SpriteBatch` |
| Tilemaps | Lua (`SpriteBatch` per layer and chunk) | C++ only if measurements say so |
| Scenes, entities, collision helpers, input actions | Lua | |
| Pixel-perfect scaling | Lua (`Canvas` with integer scaling) | |
| **Sound synthesizer and music mixer** | **C++** | See below |

**Why the synthesizer is C++.** Sound effects and songs are stored as
synth parameters and note data, and must sound the same in the editor and
the game. Mixing in Lua would run from `love.update`, which stops when the
tab is hidden (browsers pause `requestAnimationFrame`), so music would cut
out in background tabs. In C++ the mixer can run from the audio refill
timer Cupid already uses to keep streams playing in background tabs, and the same code renders previews in the editor
(through a hidden engine instance). Exposed as `smitten.sfx(...)`,
`smitten.song(...)` and lower-level `smitten.synth.render(params)` →
`SoundData`.

### Editor ↔ game bridge

Live asset reload, picking an entity in the running game, and tweaking
values while it runs need a channel between the editor and the game.
Smitten owns its player and web entry point, so it adds:

1. `writeFile`: replace a file in the running game's filesystem, after
   which the `smitten` module reloads the asset in place.
2. Messages both ways: a `love.event` pushed from JavaScript
   (`web_main.cpp`), and `smitten.editor.send(...)` from Lua.

Until then (MVP milestones 1–3), every run is a fresh engine instance, as
in Cupid, which takes well under a second.

## 4. Language: Luau-like syntax, native to the VM

Decision: Smitten's Lua gets Luau-style syntax **in the parser itself**.
Each feature compiles to the bytecode Lua 5.1 already has: no new opcodes,
no transpiler, no second VM. So:

- Cupid's JIT compiles it like any other Lua; debug hooks, coroutines,
  green threads and error messages work unchanged.
- Line numbers are the source's own, so errors point at the right line
  (no source maps).
- It's a superset: every program that runs in Cupid (Lua 5.1 with LuaJIT's
  extensions, `goto` included) still runs, so LÖVE libraries work as they
  are.

Luau itself (replacing the VM) was ruled out: Cupid's JIT works on PUC
Lua's VM and Luau's code generator doesn't target WebAssembly; Luau has no
`goto`, loads code differently, and replaces `debug.sethook`, which green
threads depend on; LÖVE's C++ bindings would need porting.

### Language v1 (in the MVP)

| Feature | Example | Compiles to |
| --- | --- | --- |
| Compound assignment | `score += 10`, `name ..= "!"`, also `-= *= /= %= ^=` | `score = score + 10`, with table and key expressions evaluated once (`t[f()] += 1` calls `f` once), as in Luau |
| `continue` | `for i = 1, n do if skip(i) then continue end ... end` | A jump to the end of the loop body, built on Cupid's `goto` support. A contextual keyword, as in Luau: `::continue::` labels and `goto continue` in existing code still work. In `repeat ... until`, Luau's rule applies (can't skip a local used in `until`) |
| String interpolation | `` `HP: {hp}/{maxHp}` `` | `OP_CONCAT` of the parts, each value converted as by `tostring` (the original one, even if the global is replaced) |
| If-expressions | `local speed = if running then 200 else 100` | Conditional jumps into one register; `elseif` allowed; only the chosen branch is evaluated |

### Later

- **Type annotations** (phase 2), with Luau syntax: `local x: number = 0`,
  `function hit(e: Enemy, dmg: number): boolean`, `type Point = {x: number,
  y: number}`, `x :: number` casts. Parsed and discarded: no runtime cost.
  Two details to handle: `type` stays usable as a function (`type(x)`), so
  it's a keyword only in `type Name =`; and `::` starts a label at the
  beginning of a statement but is a cast after an expression.
- **Type checking in the editor** (phase 3). Options to evaluate then:
  Luau's analysis library compiled to WebAssembly (it's C++ with no
  platform dependencies), which would need Smitten's syntax to stay within what Luau parses
  (it doesn't parse `goto`); or a simpler checker of our own.
- Maybe: `//` floor division (needs either a library call or a new opcode
  with JIT support, so it waits for a clear need); Luau-style generalized
  iteration (`for k, v in t do`) is ruled out because it changes the VM's
  iteration opcode.

### Tooling that has to follow the syntax

The editor's Lua highlighting (CodeMirror grammar), go-to-function, the
compatibility check (which also learns to say "this file uses Smitten
syntax, so it won't run in plain LÖVE"), and the JIT's differential test
suite (`tools/jit/test.sh`), which gets tests for every new construct
with the JIT off, on and mixed.

## 5. Built-in tools

All tools edit ordinary files in the project, which code loads by name.
Formats are JSON plus standard media files, so projects diff well in git
and other programs can open the media.

### Project manifest

`smitten.json` at the project root: format version, engine version, game
resolution and scaling, the project palette.

### Sprite and pixel editor

- Files: `sprites/hero.png` (sprite sheet, a normal PNG) and
  `sprites/hero.sprite.json` (frame size, origin, animations; hitboxes
  later).
- Tools: pencil, eraser, fill, line, rectangle, ellipse, select and move,
  color picker; mirror drawing; zoom and pan; pixel grid; undo/redo.
- Frames and animations: frame strip, named animations with fps and loop,
  onion skin, live preview.
- Palette: the project palette (Lospec `.hex` import), free colors allowed.
- Shortcuts follow Aseprite where they overlap (B, E, G, L, M, ...).
- Later: layers (kept in a separate source file, flattened into the PNG),
  Aseprite import.

### Tilemap editor

- Files: `maps/level1.map.json` (layers, tile data, object layer),
  referencing tilesets (a sprite sheet plus `.tileset.json` with per-tile
  properties such as `solid`).
- Tile layers, painting, rectangle and bucket fill, eraser, autotiling
  (later), an object layer for placing entities with properties.
- Runtime: `smitten.map("level1")`, drawn per layer and chunk, tile
  property queries for collision, iteration over placed objects.
- Later: Tiled JSON (`.tmj`) import and export.

### Sound effect generator

- Files: `sfx/jump.sfx.json`, synth parameters in the style of sfxr
  (wave, envelope, frequency slide, vibrato, arpeggio, duty, filters).
- Presets (pickup, jump, explosion, laser, hit, blip), randomize, mutate,
  and an editor for every parameter.
- Rendered by the C++ synthesizer (section 3), in the game and in previews.

### Music tool

- Files: `music/theme.song.json`: instruments (synth patches, or samples),
  patterns, and an order list.
- A piano roll per channel plus a pattern order list, because it's easier
  for beginners than a tracker; a tracker view later if users want one.
- 4 channels by default, more allowed.
- Mixed by the C++ mixer, so music keeps playing in background tabs.

### Asset browser

- The file tree with thumbnails, kind icons and previews, "New sprite /
  map / sound / song" actions, and drag-to-code (dropping a sprite into the
  code editor inserts `smitten.sprite("sprites/hero")`).
- Rename-aware: renaming an asset offers to update references in code.

### Scenes and entities

Kept small and code-first:

- Entities are Lua classes the user writes (`entities/player.lua`), with
  `new`, `update` and `draw`.
- Maps place entities by type name and properties on their object layer;
  `smitten.map("level1"):spawn(entities)` creates them.
- A scene stack (`smitten.scene.push("title")`) for title, game and pause
  screens.
- No ECS framework and no inspector in the MVP. Later, the editor ↔ game
  bridge allows selecting and inspecting entities in the running game.

## 6. Editor

- Cupid's editor renamed and extended. Plain ES modules with no build
  step, as in Cupid. Tools open as tabs beside code: `hero.png` opens the
  pixel editor, `level1.map.json` the map editor.
- Canvas 2D for the art tools. Audio previews play through a hidden engine
  instance, so they match the game.
- Same keyboard model, command palette and settings as Cupid's editor,
  with Smitten's own visual identity (which can be playful and
  pixel-styled; section 7).

## 7. Aesthetic

Decision: **pixel-first defaults, no enforced limits, no cartridge mode.**

- The tools are pixel tools: grid, palettes, nearest-neighbor scaling,
  chip-style sounds.
- Templates and examples are low-resolution with integer scaling.
- Any PNG, resolution, font or audio file still works, and the `smitten`
  module never assumes pixel art (filtering is per sprite, scaling is a
  setting).

Options considered:

| Option | Why not chosen |
| --- | --- |
| Neutral, no house style | Bland, and tools that must also handle high-resolution painting are a bigger job for no gain for the target users |
| Pixel-first plus an optional enforced "cartridge" mode | Rejected by the project owner |
| Fantasy console, always constrained | Competes head-on with PICO-8, TIC-80 and Picotron, and gives up LÖVE's lack of a ceiling |

The editor's own look is a separate choice from what games may look like.

## 8. Storage, sharing and export

### Storage

- Local-first, in IndexedDB (database `smitten`), as in Cupid. Nothing is
  uploaded unless the user shares.
- Request `navigator.storage.persist()` so browsers don't evict projects,
  and prompt users to download backups.
- Later: open a real folder on disk with the File System Access API
  (Chromium), so projects can live in git; other browsers keep IndexedDB
  plus zip import and export.

### Sharing

| Option | Notes |
| --- | --- |
| Share links (URL hash) | Cupid's format holds text-only projects up to 32 KB compressed. Smitten's also allows small binary files (pixel art PNGs are tiny), so small games fit in a link. No server |
| itch.io | Through web export; the usual home of jam games |
| GitHub Gists | No Smitten server, but beginners need GitHub accounts |
| Smitten hosting and gallery | Best for beginners (one click, a play link, remixing), but needs a backend, accounts, abuse handling and moderation, which matters for a teenage audience |

MVP: share links and export. Hosting is decided after the MVP (section 11).

### Export

- **Web** (the main path): a zip with Smitten's player and engine, ready
  for itch.io (from Cupid's exporter and `package.py`).
- **Project zip**: the project as files, to back up or re-import.
- **`.love`**, for projects that don't use Smitten syntax or the `smitten`
  module (the compatibility check knows); runs on desktop LÖVE 12. For
  experienced developers.
- **Desktop executables**: phase 3 (section 11).

## 9. Repository layout

The engine keeps Cupid's layout so Cupid fixes merge cleanly:

```
smitten/
  DESIGN.md
  README.md
  build.py, serve.py, package.py
  love/                        LÖVE 12 with web patches (from Cupid)
    src/modules/smitten/       Smitten's engine module (C++ and embedded Lua)
  deps/lua-5.1.5/              Lua VM, LuaJIT extensions, JIT, Smitten syntax
  deps/theora/, deps/luabitop/
  web/native/                  web entry point and JS libraries
  web/player/                  player
  web/editor/                  Smitten editor (tools in web/editor/tools/...)
  web/examples/                examples and templates
  tools/                       tests and benchmarks (Cupid's plus Smitten's)
  .github/workflows/           build and deploy
```

## 10. Roadmap

### MVP

A beginner can make a small platformer entirely in the browser: draw the
player and tiles, paint a level, make jump and coin sounds, write the code
with Smitten's friendlier Lua, and upload the game to itch.io. That's
milestones 1–6. Music is phase 2.

### Milestone 1: Smitten's own engine and editor

Goal: Smitten builds, deploys and runs as its own product, with Cupid's
features intact, an empty `smitten` engine module, and no interference with
Cupid.

1. **Import Cupid.** In this repository:
   ```bash
   git remote add cupid https://github.com/Mostlime12195/cupid.git
   git fetch cupid
   git merge --allow-unrelated-histories cupid/main
   ```
   The repository now holds Cupid's tree (as of `95aa459` or later) plus
   this file. Never push to the `cupid` remote.
2. **Rename.** Smitten in the editor, player, page titles, `README.md`,
   `package.py` and export file names. The README describes Smitten,
   credits Cupid, and keeps the license section.
3. **Separate storage** (section 2): IndexedDB `smitten`;
   settings and theme keys under `smitten-editor.`; no migration from
   Cupid's keys; the game save filesystem's IndexedDB name made Smitten's
   own. `serve.py` defaults to port 8766.
4. **`smitten` module skeleton.** `love/src/modules/smitten/` with a C++
   module that registers the embedded `smitten.lua` (turned into a header
   by `love/src/scripts/auto.lua`, like `nogame.lua`); a `love_smitten`
   target in `love/CMakeLists.txt` (which `build.py` reads, and which keeps
   desktop builds possible); loaded at boot as the global `smitten` and as
   `require("smitten")`. Contents for now: `smitten.version`.
5. **Template.** The blank project's `main.lua` shows
   `"Smitten " .. smitten.version` and gets a `smitten.json`.
6. **Deploy.** Cupid's Pages workflow, renamed, building the engine with
   Emscripten 6.0.13 and caching it, published on Smitten's own domain
   (a `CNAME` file in `dist/` for GitHub Pages). Until the domain is
   chosen, the workflow can deploy to the repository's default Pages URL
   for testing.
7. **Tests.** Cupid's suites still pass: `tools/jit/test.sh`, and the
   `smoke`, `threads`, `video` and `textinput` games. A new `tools/smitten`
   game checks that `smitten` loads, as a global and through `require`.

Done when:

- [ ] `python3 build.py` from a clean clone builds `dist/`, and CI deploys
      it.
- [ ] The editor opens as Smitten; every example runs; the JIT tests pass.
- [ ] A new project shows the Smitten version when run.
- [ ] In one browser profile with both served from the same origin
      (e.g. Cupid's and Smitten's `dist/` under one local server),
      Smitten and Cupid each keep their own projects, settings and save
      files.
- [ ] Merging a later Cupid commit (`git merge cupid/main`) works without
      conflicts in `love/`, `deps/` and `web/native/` (try it once on a
      throwaway branch).
- [ ] The Cupid repository is unchanged.

### Milestone 2: sprites

- **Runtime:**
  ```lua
  local hero = smitten.sprite("sprites/hero") -- hero.png + hero.sprite.json
  local anim = hero:animation("run")          -- independent playback state
  function love.update(dt) anim:update(dt) end
  function love.draw() anim:draw(x, y, r, sx, sy) end  -- same arguments as love.graphics.draw
  ```
  Also `hero:draw(frame, x, y, ...)`, `hero.width`, `hero.height`,
  `hero.origin`, `anim:play(name)`, `anim:pause()`, `anim.finished`.
  Nearest filtering per image. Clear errors for missing files and
  animations. In the editor's completions.
- **Format v1**, `sprites/hero.sprite.json`:
  ```json
  {
    "format": "smitten.sprite",
    "version": 1,
    "image": "hero.png",
    "frameWidth": 16,
    "frameHeight": 16,
    "origin": [8, 16],
    "animations": {
      "idle": { "frames": [0, 1], "fps": 4, "loop": true },
      "run": { "frames": [2, 3, 4, 5], "fps": 10, "loop": true }
    }
  }
  ```
  Frames are numbered left to right, top to bottom. A PNG without a
  `.sprite.json` is one frame.
- **Pixel editor v0:** pencil, eraser, fill, line, rectangle, color
  picker; zoom (1–32×) and pan; grid; undo/redo; project palette plus free
  colors; frames (add, duplicate, delete, reorder); named animations with
  fps and loop; onion skin; preview. Up to 256×256 per frame. Opens any PNG
  in the project.
- **Template:** a 16×16 example sprite with idle and run animations, drawn
  at integer scale.
- **Done when** a new frame drawn in the editor appears on the next run,
  and the runtime tests in `tools/smitten` cover loading, quads and
  animation timing.

### Milestone 3: language v1

Compound assignment, `continue`, string interpolation and if-expressions
(section 4) in `deps/lua-5.1.5`'s lexer and parser; tests in
`tools/jit/tests` passing with the JIT off, on and mixed; editor
highlighting and the compatibility check updated; templates and examples
use the new syntax where it reads better.

### Milestone 4: sound effects

C++ synthesizer in the `smitten` module, `.sfx.json` format,
`smitten.sfx("jump"):play()`, the sound effect editor with presets, previews
through a hidden engine instance.

### Milestone 5: tilemaps and entities

Tileset and map formats, the map editor with tile and object layers,
runtime drawing and tile queries, entity spawning, the scene stack, AABB
collision helpers, and a platformer template using all of it.

### Milestone 6: asset browser and polish (completes the MVP)

Thumbnails, new-asset actions, drag-to-code, rename-aware references,
share links with small binary files, `navigator.storage.persist()`, a
tutorial project.

### Phase 2

- Music tool and C++ mixer
- Editor ↔ game bridge and live asset reload (section 3)
- Type annotations, parsed and discarded (section 4)
- File System Access folders
- Pixel editor layers; Aseprite and Tiled import

### Phase 3

- Type checking in the editor
- Hosted sharing and a gallery, if chosen
- Desktop executables

## 11. Smaller open questions

1. **The domain name** (section 2). Not needed to start milestone 1; the
   deploy can use the repository's default Pages URL until then.
2. **Desktop export** (phase 3): build Smitten's engine natively (LÖVE
   builds on desktop; Smitten's Lua runs there without Cupid's JIT, which
   is WebAssembly-only, so pure-Lua code is slower than on LuaJIT), or wrap
   the web build in a native shell.
3. **Hosting and a gallery** (after the MVP): whether to run a service,
   given accounts and moderation for a teenage audience.
4. **Default palette and resolution** for templates (e.g. a 16- or
   32-color Lospec palette and 320×180), chosen while building
   milestone 2.
5. **Language v1's exact list**: section 4 proposes four features; add or
   drop before milestone 3.
