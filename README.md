# Smitten

A 2D game engine in your browser. Build scenes from pieces, give them life
with Lua scripts you own, paint pictures, make sound effects and music, and
share the game for anyone to play and remix, all in one tab with nothing to
install. The engine is built on a fork of [LÖVE](https://love2d.org) 12,
compiled to WebAssembly.

Smitten's engine and editor started from the code of
[Cupid](https://github.com/Mostlime12195/cupid), which brings LÖVE 12 to the
web with a Lua-to-WebAssembly JIT. Smitten is a separate project built on
that code: it runs Smitten projects, not LÖVE games (that's what Cupid is
for), and neither is affiliated with the LÖVE team.

## What you get

- **Scenes made of pieces**: a `Sprite` draws a picture, a `Body` is solid
  (still, moved by your script, or moved by physics) with a shape that fits
  what's inside it, a `Zone` notices things coming in, `Label`s and
  `Button`s are the UI. Scenes nest: the coin scene is placed twenty times
  in a level. Tags (`player`, `enemy`) decide what touches what. Every piece
  is in [docs/pieces.md](docs/pieces.md).
- **Scripts you own**: behavior is Lua. Ready-made scripts (platformer
  player, top-down player, patrol, chase, pickup, fly straight, spin, bob,
  drag) are copied into your project to read and change.
- **An editor** with a scene tree, an inspector, the scene view, a code
  editor and workspaces for painting, sound effects and music. Panels move
  between docks, every tool opens ready to use, and **live tweaking** lets
  you change the running game without touching your files.
- **One engine table**: `smitten` holds drawing, sound, input, files and
  Smitten's own modules (`smitten.scene`, `smitten.input`, ...), and
  scripts have a short API on top (`pressed("jump")`, `sfx("coin")`).
- **Only what a game uses**: physics (Box2D), video and the sound generator
  are separate downloads, included when a game uses them.
- **A friendlier Lua**: `score += 10`, `continue`, `` `HP: {hp}` `` and
  `if a then b else c` expressions (see "Smitten syntax").
- **Sharing**: a site to publish, play and remix games (a prototype in
  `platform/`), share links, and a web build ready for itch.io.

The docs start at [docs/reference.md](docs/reference.md): getting started,
scripts, scenes, input, sound, camera, tiles, UI, saving, drawing, project
settings, sharing, the script API, every piece and the file formats. The
sharing site serves them at `/docs`. [DESIGN.md](DESIGN.md) explains the
decisions behind Smitten.

```lua
-- scripts/coin.lua, attached to a Zone: a script is the piece's own code
worth = 10                -- shown in the inspector

function entered(other)
  if other:is("player") then
    sfx("coin")
    root():emit("scored", worth)
    destroy()
  end
end
```

## What's here

| Path | What it is |
| --- | --- |
| `dist/` | Build output: `index.html` (editor), `player.html`, `smitten.mjs` + `smitten.wasm` (the engine core), `modules/*.wasm` (optional engine modules), `synth.mjs` (the synthesizer, for the editor), `pieces.json` |
| `love/` | The engine: LÖVE (upstream commit `ef388d4`) with Cupid's web patches and Smitten's modules |
| `love/src/modules/scene/` | Scenes and every piece type; `pieces.json` describes them all |
| `love/src/modules/{engine,input,tween,assets,storage,display,json}/` | Smitten's modules, in Lua, embedded by `build.py` (`engine/live.lua` is live tweaking) |
| `love/src/modules/synth/` | The sound synthesizer (the `synth` module) |
| `deps/lua-5.1.5/` | PUC Lua 5.1.5 with LuaJIT's extensions, the JIT and Smitten's syntax |
| `deps/theora/` | libtheora 1.2.0 decoder, for video |
| `web/native/` | Web entry point (`web_main.cpp`) replacing LÖVE's blocking `main()` |
| `web/player/` | The player page (standalone and embeddable); loads the modules a game needs |
| `web/editor/` | The editor: `core/` (project, scene documents, schema, live tweaking), `shell/`, `panels/`, `workspaces/`, `dialogs/`, the tools in `tools/`, and the ready-made scripts in `scripts/` |
| `platform/` | The sharing site: a Node server with SQLite and game files on disk |
| `build.py` | Build script (reads source lists from `love/CMakeLists.txt`) |
| `serve.py` | Local dev server |
| `package.py` | Command-line web export for a project folder or zip |
| `tools/` | Tests (`editor-tests`, `scene-tests`, `platform-tests`, `stress`, `smitten-audio`, `video`, `luacompat`, `errorscreen`, `paths-tests`, `text-tests`, `ui-tests`, the JIT's suite) and generators (`gen-icons.mjs`, `gen-docs.mjs`) |

## Performance

Lua runs on PUC Lua 5.1 plus a JIT that compiles hot functions to
WebAssembly: 1.7–14× faster than the plain interpreter on Lua-heavy code
(see "The Lua JIT" below). Drawing, audio and image decoding are the
engine's C++ code, batched into WebGL 2, and physics is Box2D 3 in C, so
games that spend their frame drawing and simulating lose little to the
browser.

## Lua

Smitten runs PUC Lua 5.1.5 with the LuaJIT 2.1 language extensions that
libraries commonly use added back (`deps/lua-5.1.5`):

| Extension | Notes |
| --- | --- |
| `goto` and `::labels::` | Lua 5.2 rules: no jumping into a local's scope, labels are visible in nested blocks, `goto continue` to a label at the end of a loop works |
| `\xXX`, `\z` and `\u{XXXX}` string escapes | |
| `coroutine.yield` inside `pcall`/`xpcall` | Inside a coroutine the function runs in a child coroutine that passes yields through. `coroutine.running`/`status` report the parent; `xpcall` handlers run at the error, so `debug.traceback` shows the failing code. Outside coroutines `pcall` is the plain C function, at full speed |
| `load(string [, name [, mode [, env]]])`, `loadfile(name, mode, env)` | |
| `xpcall(f, handler, ...)` | Passes the extra arguments to `f` |
| `math.log(x, base)`, `string.rep(s, n, sep)` | |
| `string.format`: `%s` uses `__tostring` and accepts any value; `%a` | |
| `table.move`, `require("table.new")`, `require("table.clear")` | |
| `coroutine.isyieldable`, `package.searchpath`, `os.exit(true/false)` | |
| `bit` | LuaBitOp, as on LuaJIT |

There's no FFI and no `jit` library (the `jit` global is nil). 64-bit
literals (`1LL`) and imaginary literals (`2i`) are a syntax error that
says so. Yielding inside a metamethod, a `for ... in` iterator or a C
function such as `table.sort`'s comparator raises an error that says
yielding works inside `pcall` but not there.

### Smitten syntax

Smitten's parser also accepts four pieces of Luau syntax. Each compiles to
the bytecode Lua 5.1 already has (no new opcodes), so the JIT, debug hooks,
coroutines and error messages work as for any other code, and line numbers
are the source's. Every program that ran before still compiles to the same
bytecode.

| Syntax | Example | Notes |
| --- | --- | --- |
| Compound assignment | `score += 10`, `name ..= "!"`, also `-= *= /= %= ^=` | One variable (local, upvalue, global, field or index); in `t[f()] += 1`, `t` and `f()` are evaluated once |
| `continue` | `for i = 1, n do if skip(i) then continue end ... end` | Jumps to the end of the loop body (the condition in `repeat ... until`, which can't use a local the `continue` skipped). Like `break`, it ends its block. Only a keyword when it stands alone: `continue = 1`, `t.continue`, `::continue::` and `goto continue` still work |
| String interpolation | `` `HP: {hp}/{maxHp}` `` | Each `{expression}` is converted by the original `tostring` (replacing the global doesn't change it). `\{` writes a brace; the usual escapes work. A backtick string can't be a call's argument without parentheses (`` print(`x`) ``) |
| If-expressions | `local speed = if running then 200 else 100` | `elseif` allowed, `else` required; only the chosen branch is evaluated |

## The Lua JIT

`deps/lua-5.1.5/ljit.inc` compiles a Lua function to a small WebAssembly
module once it has been called, or has looped, 50 times. The browser then
compiles that to machine code like any other wasm.

- Lua values stay in the Lua stack, exactly where the interpreter keeps
  them, so compiled code can be entered and left at any instruction: after
  calls, when a coroutine resumes, from the middle of a hot loop, or to hand
  a frame back to the interpreter when a debug hook is set.
- Like V8's optimizing tiers, it speculates on what the interpreter has
  seen. Arithmetic and comparisons that have only seen numbers, and field
  reads whose result is used as a number, check their values once and
  keep them in wasm locals across instructions and loop iterations, with no
  more loads or type checks. When a check fails the function *deopts*: the
  interpreter carries on from that instruction, the site is noted, and the
  function is compiled again later without that guess (after five deopts,
  without guessing at all). The interpreter notes arithmetic and
  comparisons that go the slow way, so code that uses metamethods isn't
  compiled with guesses that would fail.
- The Lua stack is still written as the code goes, so leaving compiled code
  needs nothing written back, and after every helper call (which may run
  any Lua code, even `debug.setlocal` on our locals) the values kept in
  locals are reloaded and checked.
- Innermost loops become wasm loops, which V8 optimizes as loops.
- Moves, constants, tests, numeric `for` loops, reads of table fields
  (constant string keys hashed at compile time, following `__index` tables
  up to three levels: an object, its class, the class's base) and array
  slots, writes of existing fields and array slots and of new fields when
  their slot in the hash part is free (table constructors), and returns run
  inline. Everything else that can involve metatables, the GC, errors or
  calls goes to helpers that are copies of the interpreter's own code, so
  behavior (including error messages and their line numbers) is identical.
- Compiled functions call other compiled functions directly, up to 64 deep,
  setting up the callee's frame without going through `luaD_precall` when
  nothing unusual (varargs, hooks, a growing stack) is involved.
- Frames with a line or count hook are interpreted, so `debug.sethook`
  works unchanged.
- `?jit=0` on the player turns it off.

`tools/jit/bench.lua` (run by `node tools/jit/bench.mjs`, which prints
the median of several runs with the JIT on and off), on an Apple M5 with
Node 26:

| Benchmark | Interpreter | JIT | Speedup |
|---|---|---|---|
| `fib(27)` | 19.1 ms | 6.1 ms | 3.1× |
| tables + `table.sort` | 28.8 ms | 26.1 ms | 1.1× |
| strings | 20.7 ms | 18.7 ms | 1.1× |
| closures/OOP | 87.0 ms | 52.5 ms | 1.7× |
| mandelbrot 200 | 44.7 ms | 3.2 ms | 14× |
| particles update 10k | 19.5 ms | 3.3 ms | 5.9× |
| sieve 1e6 | 33.6 ms | 6.9 ms | 4.9× |
| entities update 5k (methods, inheritance) | 22.2 ms | 6.9 ms | 3.2× |
| vector math 100k (small tables) | 71.3 ms | 37.8 ms | 1.9× |
| collisions 300 (all pairs) | 12.2 ms | 1.8 ms | 6.8× |

It compiled 23 functions into 76 KiB of wasm in 2.7 ms (including the
browser's own compile of each module). Allocation-heavy code is still
bound by the C heap and Lua's GC, and sorting and string functions are C
code the JIT doesn't touch. Desktop LuaJIT remains much faster on
call-heavy code (`fib(27)` in about 1 ms).

`tools/jit/` builds the standalone interpreter for Node and runs a
differential test suite: every test must print exactly the same with the
JIT off, compiling everything immediately, and with a mix of compiled and
interpreted frames.

```bash
sh tools/jit/build-node.sh
```

```bash
bash tools/jit/test.sh
```

```bash
node tools/jit/bench.mjs
```

`node tools/jit/run.mjs --stats file.lua` prints how many functions were
compiled, the wasm's size, the time spent compiling and the deopts. The
`spec-*` tests make each speculation fail: types changing mid-loop,
metatables appearing later, `debug.setlocal` from a callee or on a
suspended coroutine, hooks set mid-loop, errors in speculated code.

## Building

Requires the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
(tested with 6.0.13) and Python 3.10+.

```bash
source /path/to/emsdk/emsdk_env.sh
```

```bash
python3 build.py
```

Builds are incremental (about 350 source files the first time). The engine is linked twice over: a core (`dist/smitten.wasm`, an
Emscripten main module) and side modules in `dist/modules/` that a game only
downloads when it uses them:

| Module | What's in it | Size |
| --- | --- | --- |
| core | Lua and the JIT, drawing, sound, input, files, scenes, pieces, UI | 6.73 MB |
| `physics2d` | Box2D 3: Bodies, Zones, Joints, `smitten.physics` queries | 0.34 MB |
| `video` | Theora, `smitten.video` | 0.13 MB |
| `synth` | the synthesizer, `.sfx` and `.song` files | 0.03 MB |

Everything is compiled as position-independent code so the two kinds can
link at run time; the core exports exactly the symbols the side modules
import, and the build fails if a module needs one it doesn't export. The
build also embeds Smitten's Lua modules (and `pieces.json`, as Lua) in the
engine, and compiles the synthesizer a second time, on its own, as
`dist/synth.mjs` for the editor's previews. Other options:

- `python3 build.py --debug` for assertions and no optimization
- `python3 build.py --web-only` to copy only the player, editor and examples into `dist/`
- `python3 build.py --profiling` to keep function names for size analysis (writes to `build/profiling/`)

Then serve `dist/`:

```bash
python3 serve.py
```

and open http://localhost:8766/ for the editor or
http://localhost:8766/player.html?game=path/to/game.zip for the player
(a zip of a project folder).

Tests:

- `node tools/editor-tests/test.mjs`: the piece schema (and that every
  method in it is defined in the engine, every event emitted, and the short
  script API matches `script.lua`), scene documents (reading, writing,
  undo, placed scenes), module detection, the templates, the ready-made
  scripts and script variables, and "Update this project" (old scenes and
  scripts in, new ones and the report out).
- `node web/editor/workspaces/scene/cells.test.mjs`: the tile format.
- `node web/editor/workspaces/scene/uilayout.test.mjs`: where the editor
  puts UI pieces (`uilayout.js`), against the cases in
  `tools/scene-tests/ui/layout-cases.json` that the engine's copy
  (`uilayout.lua`) is checked with too, and against rectangles worked out
  by hand.
- `node web/editor/workspaces/scene/terrain.test.mjs`: the terrain
  matcher (which tile fits a cell's neighbours), against the cases in
  `tools/scene-tests/levels/terrain-cases.json` that the engine's copy is
  checked with too (`node tools/scene-tests/make-levels-fixture.mjs` writes
  them).
- `tools/scene-tests/`: scenes run in the engine (`smoke` for pieces,
  bodies and zones, scripts and the whole script API: input, tiles,
  camera, sprites, particles, sound, saving, pausing, time scale, scene
  changes with values and transitions, UI focus; `rigid` for physics
  Bodies and tag filtering; `physics` for scene physics; `lights` for
  Lights, Occluders and the Tint, by reading pixels back; `paths` for
  `smitten.paths` in the engine; `levels` for terrains, animated tiles
  and Backgrounds, by reading tiles and pixels back; `text` for rich
  text, effects, revealing and measuring, and that plain text is drawn as
  it always was, by reading pixels back; `rules3` and `rules2`, the same
  project at version 3 and version 2, for the rules each plays by: degrees
  or radians, `clicked()` or `pressed()`, undeclared names, `gravityScale`
  or `gravity`. `smoke` stays a version 2 project). Open one in
  the player with the test server (below); every line it prints says what
  it checked.
- `lua5.1 tools/paths-tests/test.lua`: the pathfinders (`smitten.paths`)
  under plain Lua, against a plain Dijkstra search on random grids and
  graphs and the true shortest path on random rooms; add `time` for how
  long searches take.
- `lua5.1 tools/text-tests/test.lua`: the text engine's parser, layout and
  reveal (`smitten.text`) under plain Lua, with a made-up font.
- `lua5.1 tools/ui-tests/test.lua`: the UI pieces' own logic (the engine's
  `ui.lua`, `widgets.lua`, `textinput.lua` and `uilayout.lua`) under plain
  Lua with drawing stubbed out: where Rows, Columns, Grids and Scrolls put
  things, dragging a Slider, Checkbox groups, typing and selecting in a
  TextInput, and the keyboard focus.
- `node tools/scene-tests/run.mjs` runs the scene tests in a headless
  Chrome and fails if one goes wrong (`errors` and `lights` check themselves: what
  the engine says when a script is wrong, and what lights and shadows draw;
  `boards` and `boards-site` check `smitten.boards` without the games site
  and inside a page standing in for it); `python3 tools/serve_test.py` tests
  `serve.py`. CI (`.github/workflows/ci.yml`) runs all of these on every
  push and keeps the built `dist/` as an artifact.
- `python3 tools/stress/gen.py` and `node tools/stress/run.mjs` run stress
  projects and the scene tests in a headless Chrome (`physics-check`
  prints a digest to compare engine versions).
- `PLATFORM_PORT=8790 node tools/platform-tests/test.mjs`: the sharing site.
  `tools/platform-tests/boards-e2e.mjs` plays a game with a leaderboard on
  a local copy of the site, by hand (it needs a build).
- `tools/smitten-audio` (whose `check.mjs` confirms the engine and
  `synth.mjs` render identical samples), `tools/video` (playback, pausing
  and seeking), `tools/luacompat` (the Lua extensions) and
  `tools/errorscreen`.
- `node tools/gen-docs.mjs` regenerates `docs/pieces.md`, `docs/api.md`,
  `docs/engine.md`, the tables marked in the other pages, and the HTML docs
  in `platform/public/docs/`; run it after changing `pieces.json`,
  `web/editor/core/script-api.js` or `web/editor/smitten-docs.js`.
The test projects in `tools/` run with `python3 tools/test_server.py 8772`,
which zips them on request:
http://localhost:8772/player.html?game=tools/scene-tests/smoke.zip (or
`tools/video.zip&modules=video`, `tools/smitten-audio.zip&modules=synth`,
...).

## The editor

`dist/index.html`. Everything is stored in the browser (IndexedDB); nothing is
uploaded anywhere unless you share or publish.

- **Workspaces** across the top (Alt+1 to 5): **Scene**, **Script**,
  **Paint** (pictures and sprite sheets), **Sound** (sound effects) and
  **Music** (songs). Each has its own tabs and opens ready to use: Paint
  starts on a new picture, Sound on a new effect. New work becomes a file
  the first time you change it.
- **Panels**: Scene (the pieces), Files, Inspector and Output. Drag a
  panel's tab to another dock or an edge of the window to move it; hide and
  show panels from the View menu; each workspace keeps its own layout;
  View › Reset layout puts it back.
- **Scene panel**: add pieces (Ctrl+A) from a searchable list that explains
  each one, place other scenes inside this one, drag to reorder, rename
  with F2, duplicate with Ctrl+D, save part of a scene as its own scene.
  Pieces that are missing something (a Body with nothing to fit its shape
  to) say so.
- **Inspector**: properties grouped by section with typed editors (numbers
  you can drag, colors, file pickers that take files dropped from Files,
  tags, dropdowns), a reset arrow on changed values, the piece's script and
  its script variables, and its tags.
- **Attach a script**: a new one, a ready-made one (copied into your
  project), or one you already have.
- **Scene view**: pan, zoom, grid and snapping, move/rotate/scale handles,
  box selection, Body and Zone shapes, corner handles on polygons, lines
  and Walkable areas, files dropped in as pieces, and tile
  painting with a tileset panel when a Tiles piece is selected.
- **Play** (F5) runs the main scene and **Play scene** (F6) the open one.
  **Live tweaking**: while it runs, the Scene panel and Inspector show the
  running game's pieces and current values; change them and the game
  changes, and everything goes back when you stop (the Live switch in the
  game bar turns it off). Stop with F8.
- **Project settings**: name, main scene, resolution and how it fits the
  window, input actions, and engine modules.
- **Export**: a web zip for itch.io with only the modules the game uses, or
  a project zip; share links for small projects.
- Command palette (Ctrl+K), open a file (Ctrl+P), piece reference (Help),
  light and dark themes, icons from [Lucide](https://lucide.dev).
- The code editor is CodeMirror 6 with Lua and Smitten syntax, and
  completion for the short script API, the piece's own names and methods,
  script functions, `smitten.*` and file paths.

The editor loads CodeMirror from a CDN, so the first load needs an internet
connection; the code editor falls back to a plain text area if that fails.

## Publishing a game

Copy `player.html`, `player.js`, `player.css`, `smitten.mjs`,
`smitten.wasm` and the `modules/*.wasm` your game uses next to a zip of
your project (`game.zip`), and add this to `player.html`'s `<head>`:

```html
<meta name="smitten-game" content="game.zip">
<meta name="smitten-modules" content="physics2d">
```

The editor's **Export for web** does this for you, as does the command line:

```bash
python3 package.py path/to/project out/ --zip
```

Either produces a zip you can upload to itch.io as an HTML game. Serving `.wasm` as `application/wasm`
lets browsers compile the engine while it downloads; most hosts already do.

Player URL options:

| Option | Effect |
| --- | --- |
| `?game=url` | Load a game (a zip of a project) from a URL |
| `?modules=a,b` | Engine modules to load before the game (a game that uses a missing one reloads with it, if the server has it) |
| `?autoplay=1` | Skip the Play button (audio may stay muted until the first click) |
| `?scale=fit` (default) / `integer` / `none` | How a fixed-size window is scaled to the page |
| `?pixelated=1` | Nearest-neighbour upscaling (also implied by `scale=integer`) |
| `?embed=1` | Embedded mode, controlled with `postMessage` (see `web/player/player.js`) |

## Web-specific behavior

- Saves (`smitten.storage`) live in IndexedDB and are flushed every 2
  seconds, when the tab is hidden, and when the game quits.
- Text input goes through a hidden text field, so IME composition
  (Chinese, Japanese, Korean), emoji pickers, dictation and on-screen
  keyboards reach `smitten.input.typed()`. It's on by default, except on
  touch devices (no hover, coarse pointer), where a tap on the game brings
  up the on-screen keyboard (browsers only show it in response to a tap).
- `fullscreen(true)` resizes the game immediately; the browser enters real
  fullscreen on the next click or key press (browsers only allow
  fullscreen from a user gesture).
- `smitten.system.getOS()` returns `"Web"`.
- Not available: compute shaders (WebGL 2 has none) and WOFF2 fonts
  (FreeType is built without Brotli; TTF and OTF work).

## How it works

`web/native/web_main.cpp` replaces LÖVE's `main()`. On desktop LÖVE resumes
its boot coroutine in a `while` loop. `boot.lua` yields once per iteration of
`love.run`'s main loop, so on the web that coroutine is resumed once per
`requestAnimationFrame` instead.

The engine patches (`git diff dca79b4 -- love deps`) are kept small so they
can be rebased onto newer LÖVE commits:

- Add an `LOVE_EMSCRIPTEN` platform (`config.h`) and leave out LuaSocket,
  ENet and lua-https; with `LOVE_SMITTEN`, also `love.thread` and LÖVE's
  `love.physics` (Box2D 2.4).
- WebGL 2 differences: no texture swizzle (LA8 textures use
  `LUMINANCE_ALPHA`), no `GL_FRAMEBUFFER_SRGB` toggle.
- `love.timer` uses `emscripten_get_now`; sleeping doesn't block.
- A Lua-to-WebAssembly JIT (above), in `deps/lua-5.1.5/ljit.inc` with small hooks in `lvm.c`, `ldo.c` and `lfunc.c`.
- No threads: audio streaming refills from the frame loop and a timer
  instead of a pool thread, and recovers from underruns
  (`love/src/modules/thread/web/FrameTasks.cpp`).
- `love.video` decodes Theora from the frame loop too, instead of its worker
  thread. libtheora's decoder is built from source (`deps/theora`, without
  its x86/ARM assembly); libogg is Emscripten's port.
- A streaming Source seeked while paused or stopped no longer skips ahead
  when played again (this showed up as a video with audio jumping ahead).
- `boot.lua` is cut down: no `conf.lua`, `main.lua`, command line or
  no-game screen. A game is a project with a `smitten.json`; anything else
  gets an error screen that says why. `callbacks.lua`'s main loop runs only
  the engine (no `love.load`/`update`/`draw` callbacks), and events go to
  the engine's input handling.
- LuaBitOp (`deps/luabitop`) is loaded as the global `bit`, as on LuaJIT.
- SDL3 text input is started when the window is created (not on touch
  devices). Text from the page's hidden text field is pushed as SDL text
  events by `web/native/web_main.cpp`.
- File dialogs go to `library_love.js` instead of SDL
  (`love/src/modules/window/sdl/Window.cpp`).

### Smitten's additions

Smitten is a fork: its features are part of the engine, not a module on
top of it. DESIGN.md, section 9, summarizes what it changes.

- `love.cpp` names the engine table `smitten`, registers the embedded Lua
  modules (`build/gen/engine_lua.h`), gives `love.box2d` (the scenes'
  Box2D 3), `love.video` and `love.synth` loaders that `dlopen` the side
  module the player loaded (or explain which module to turn on), and
  exposes the live tweaking channel (`love._livePoll`, fed by
  `web_main.cpp`). The engine's own code still calls the table `love`
  internally; game code doesn't see that name (`love.engine` gives
  scripts and the files they `require` globals without it).
- `boot.lua` calls `love.engine.init` once the modules are loaded:
  Smitten's modules load on first use, helpers join the engine's modules,
  and `smitten.json` sets up the display, input actions and the main
  scene. `love.run` drives the scene tree through `love._engine`.
- `love/src/modules/scene/`: scenes and pieces. `pieces.json` describes every
  piece; `build.py` turns it into Lua for the runtime and copies it next to
  the editor for the inspector, the Add a piece dialog and completions.
- `Synth.cpp` renders sound effects and songs (no LÖVE dependencies, so the
  same code is built into `synth.mjs` for the editor), and `LoopDecoder.cpp`
  plays a rendered song with a seamless loop as a streaming Source.
- `deps/lua-5.1.5`: Smitten's syntax in `llex.c` and `lparser.c`, and the
  original `tostring` kept in the registry for interpolation.
- The player keeps save files under its own data folder
  (`XDG_DATA_HOME`), and the editor uses its own storage names, so
  Smitten never shares projects, settings or saves with Cupid or other
  players on the same site.

## Licenses

Smitten is under the zlib license (`LICENSE`), like LÖVE.
LÖVE is under the zlib license (`love/license.txt`); its bundled libraries
keep their own licenses. Lua 5.1 is MIT (`deps/lua-5.1.5/COPYRIGHT`), as is
LuaBitOp (`deps/luabitop/bit.c`). libtheora is BSD-style
(`deps/theora/COPYING`).
Changes to those projects are marked in the source and keep their licenses. The default palette is Sweetie 16 by GrafxKid.
