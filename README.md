# Smitten

A 2D game engine in your browser. Build scenes from pieces, give them life
with Lua scripts you own, paint pictures, make sound effects and music, and
share the game for anyone to play and remix, all in one tab with nothing to
install. Underneath it's a fork of [LÖVE](https://love2d.org) 12 compiled to
WebAssembly, so everything LÖVE can do, a Smitten game can do too.

Smitten's engine and editor started from the code of
[Cupid](https://github.com/Mostlime12195/cupid), which brings LÖVE 12 to the
web with a Lua-to-WebAssembly JIT. Smitten is a separate project built on
that code, and neither is affiliated with the LÖVE team.

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
- **One engine table**: `smitten` and `love` are the same, so LÖVE games,
  tutorials and libraries work as they are.
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
decisions behind Smitten, including what it changes from LÖVE.

```lua
-- scripts/coin.lua, attached to a Zone: a script is the piece's own code
points = 10               -- shown in the inspector

function entered(other)
  if other:is("player") then
    sfx("coin")
    root():emit("scored", points)
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
| `deps/theora/` | libtheora 1.2.0 decoder, for `love.video` |
| `web/native/` | Web entry point (`web_main.cpp`) replacing LÖVE's blocking `main()` |
| `web/player/` | The player page (standalone and embeddable); loads the modules a game needs |
| `web/editor/` | The editor: `core/` (project, scene documents, schema, live tweaking), `shell/`, `panels/`, `workspaces/`, `dialogs/`, the tools in `tools/`, and the ready-made scripts in `scripts/` |
| `platform/` | The sharing site prototype (Cloudflare Worker, R2, D1) |
| `build.py` | Build script (reads source lists from `love/CMakeLists.txt`) |
| `serve.py` | Local dev server |
| `package.py` | Command-line web export for a game folder or `.love` |
| `tools/` | Tests (`editor-tests`, `scene-tests`, `smitten-audio`, the JIT's suite, Cupid's test games) and generators (`gen-icons.mjs`, `gen-docs.mjs`) |

## Performance

Lua runs on PUC Lua 5.1 plus a JIT that compiles hot functions to
WebAssembly: 1.7–14× faster than the plain interpreter on Lua-heavy code
(see "The Lua JIT" below). Drawing, physics, audio and
image decoding are LÖVE's own C++ code, batched into WebGL 2. Compared with
desktop LÖVE on LuaJIT, pure-Lua code is slower and engine-side work is
about the same, so games that spend their frame drawing lose little.

## Threads without SharedArrayBuffer

Browsers can't block the main thread, and real threads need cross-origin
isolation headers that many hosts don't send. Instead, each `love.thread`
Thread gets its own Lua state and runs as a coroutine on the main thread
(`love/src/modules/thread/web/GreenThreads.cpp`):

- Threads are preempted by an instruction-count hook (Lua 5.1 can yield from
  hooks), so even `while true do ... end` worker loops don't freeze the page.
- `Channel:demand`, `Channel:supply`, `Thread:wait` and `love.timer.sleep`
  yield the thread until they can complete.
- When the main thread blocks (for example `channel:demand()` in
  `love.load`), other threads run until it can continue. A real deadlock
  raises an error instead of hanging the tab.
- Threads get whatever time is left in each 60 Hz frame after the game's
  update and draw (2 to 12 ms).

The trade-off: threads share one CPU core with the game, so they make
blocking-style code work but don't add parallel speed.

## Lua compatibility

Desktop LÖVE runs LuaJIT, which is Lua 5.1 plus extensions. Smitten runs PUC
Lua 5.1.5 with the LuaJIT 2.1 extensions that games and libraries commonly
use added back (`deps/lua-5.1.5`), so code written for desktop LÖVE loads
and behaves the same:

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

What can't work in a browser fails with a message that says why, instead of
a generic error:

- `require("ffi")`, `require("jit")`, `jit.*` modules and `string.buffer`:
  "isn't available on the web: it's part of LuaJIT ...". The `jit` global is
  nil, so libraries that check `if jit then` take their plain-Lua path.
- `require("socket")`, `"enet"` and LuaSocket's other modules: browsers have
  no raw sockets; use `require("https")`.
- 64-bit literals (`1LL`, `1ULL`) and imaginary literals (`2i`): a syntax
  error that names LuaJIT's FFI.
- Yielding inside a metamethod, a `for ... in` iterator or a C function such
  as `table.sort`'s comparator: the error says that yielding works inside
  `pcall` but not there. (LuaJIT allows the first two.)

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

Code that uses them won't run on desktop LÖVE. `findSmittenSyntax` in
`web/editor/smitten-syntax.js` lists where a file uses each of them
(`node tools/smitten-syntax/test.mjs` tests it).

### Compatibility check

The editor checks a project's Lua files each time it plays, and `package.py`
does the same when packaging. Problems appear in the Output panel (or on
stderr) with the file and line: LuaJIT-only and networking modules required
without `pcall`, 64-bit literals, compute shaders, `io.popen` and
`os.execute`, unguarded `jit.*` calls, plus notes about
`love.system.getOS()` returning `"Web"` and threads sharing one core. The
rules are in `web/editor/compat-rules.json`.

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
- Frames with a line or count hook are interpreted, so `debug.sethook` and
  `love.thread`'s scheduler work unchanged.
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

Builds are incremental (about 450 source files the first time). The engine is linked twice over: a core (`dist/smitten.wasm`, an
Emscripten main module) and side modules in `dist/modules/` that a game only
downloads when it uses them:

| Module | What's in it | Size |
| --- | --- | --- |
| core | Lua and the JIT, LÖVE's modules, scenes, pieces, UI | 6.91 MB |
| `physics2d` | Box2D 3: Bodies, Zones, Joints, `smitten.physics` queries | 0.33 MB |
| `lovephysics` | LÖVE's `love.physics` (Box2D 2.4) | 0.23 MB |
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
http://localhost:8766/player.html?game=path/to/game.love for the player.

Tests:

- `node tools/editor-tests/test.mjs`: the piece schema (and that every
  method in it is defined in the engine, every event emitted, and the short
  script API matches `script.lua`), scene documents (reading, writing,
  undo, placed scenes), module detection, the templates, the ready-made
  scripts and script variables.
- `node web/editor/workspaces/scene/cells.test.mjs`: the tile format.
- `tools/scene-tests/`: scenes run in the engine (`smoke` for pieces,
  bodies and zones, scripts and the whole script API: input, tiles,
  camera, sprites, particles, sound, saving, pausing, time scale, scene
  changes with values and transitions, UI focus; `rigid` for physics
  Bodies and tag filtering). Zip one and open it in the player
  (`player.html?game=tools/scene-tests/smoke.love` with the test server);
  every line it prints says what it checked.
- `tools/smitten-audio` (whose `check.mjs` confirms the engine and
  `synth.mjs` render identical samples).
- `node tools/gen-docs.mjs` regenerates `docs/pieces.md`, `docs/api.md`,
  `docs/engine.md`, the tables marked in the other pages, and the HTML docs
  in `platform/public/docs/`; run it after changing `pieces.json`,
  `web/editor/core/script-api.js` or `web/editor/smitten-docs.js`.
The test games in `tools/` run with `python3 tools/test_server.py 8772`,
which zips them on request and adds the routes the `https` test needs:
http://localhost:8772/player.html?game=tools/https.love (or `smoke`,
`filedialog`, `textinput`, ...).

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
  box selection, Body and Zone shapes, files dropped in as pieces, and tile
  painting with a tileset panel when a Tiles piece is selected.
- **Play** (F5) runs the main scene and **Play scene** (F6) the open one.
  **Live tweaking**: while it runs, the Scene panel and Inspector show the
  running game's pieces and current values; change them and the game
  changes, and everything goes back when you stop (the Live switch in the
  game bar turns it off). Stop with F8.
- **Project settings**: name, main scene, resolution and how it fits the
  window, input actions, and engine modules.
- **Export**: a web zip for itch.io with only the modules the game uses, a
  project zip, or a `.love`; share links for small projects.
- Command palette (Ctrl+K), open a file (Ctrl+P), piece reference (Help),
  light and dark themes, icons from [Lucide](https://lucide.dev).
- The code editor is CodeMirror 6 with Lua and Smitten syntax, and
  completion for LÖVE 12, Smitten's modules, piece methods after `self:`,
  script functions, the short script API and file paths.

The editor loads CodeMirror from a CDN, so the first load needs an internet
connection; the code editor falls back to a plain text area if that fails.

## Publishing a game

Copy `player.html`, `player.js`, `player.css`, `smitten.mjs`,
`smitten.wasm` and the `modules/*.wasm` your game uses next to your
`game.love`, and add this to `player.html`'s `<head>`:

```html
<meta name="love-game" content="game.love">
<meta name="smitten-modules" content="physics2d">
```

The editor's **Export for web** does this for you, as does the command line:

```bash
python3 package.py path/to/game out/ --zip
```

Either produces a zip you can upload to itch.io as an HTML game. Serving `.wasm` as `application/wasm`
lets browsers compile the engine while it downloads; most hosts already do.

Player URL options:

| Option | Effect |
| --- | --- |
| `?game=url` | Load a `.love` from a URL |
| `?modules=a,b` | Engine modules to load before the game (a game that uses a missing one reloads with it, if the server has it) |
| `?autoplay=1` | Skip the Play button (audio may stay muted until the first click) |
| `?scale=fit` (default) / `integer` / `none` | How a fixed-size window is scaled to the page |
| `?pixelated=1` | Nearest-neighbour upscaling (also implied by `scale=integer`) |
| `?embed=1` | Embedded mode, controlled with `postMessage` (see `web/player/player.js`) |

## Web-specific behavior

- `love.system.getOS()` returns `"Web"`.
- Save files live in IndexedDB and are flushed every 2 seconds, when the tab
  is hidden, and when the game quits.
- `love.timer.sleep` on the main thread doesn't block (it lets threads run instead).
- Text input is enabled by default, as on desktop, except on touch devices
  (no hover, coarse pointer), where it starts off as on Android and iOS.
  While it's on, a hidden text field has keyboard focus instead of the
  canvas, so IME composition (Chinese, Japanese, Korean), emoji pickers,
  dictation and on-screen keyboards reach `love.textinput` (composition in
  progress is reported to `love.textedited`). `love.keypressed` works as
  before; keys that belong to an IME composition don't produce key presses.
  Pasting into the field is ignored, as on desktop: use
  `love.system.getClipboardText`.
- On touch devices, tap the game while text input is on to bring up the
  on-screen keyboard (browsers only show it in response to a tap).
  `love.keyboard.setTextInput(true, x, y, w, h)` moves the hidden field over
  that rectangle, which is where IME candidate windows appear.
- `require("https")` (lua-https) works, using a synchronous `XMLHttpRequest`:
  it blocks like on desktop. Browser rules apply: other sites must allow
  cross-origin requests (CORS), an `https` page can't request `http` URLs,
  and some request headers (`User-Agent`, `Content-Length`, ...) are set by
  the browser. Network errors, including refused CORS requests, return
  status `0` with an error message as the body (like lua-https on macOS).
  Response header names are lower case. Relative URLs are resolved against
  the page, so a game can request files hosted next to it.
- `love.window.showFileDialog` uses the browser's file picker.
  - `openfile` and `openfolder` copy what was picked into the in-memory file
    system (`/picked/<n>/...`) and return those paths; read them as on
    desktop with `love.filesystem.openNativeFile`, `mountFullPath` or
    `io.open`. Filters become the picker's `accept` list; browsers can't
    show a title or button labels.
  - `savefile` returns `/picked/<n>/<defaultname>`. When the game has
    written and closed that file, the browser downloads it under that name
    (again on every later save to it).
  - Cancelling returns an empty list, as on desktop.
  - Browsers only open pickers in response to a click or key press. If the
    game calls `showFileDialog` from `love.keypressed` or
    `love.mousepressed`, the picker opens directly (in browsers that report
    `navigator.userActivation`). Otherwise, and always for `savefile`, the
    player shows a small bar with a "Choose file…" / "Save" button and
    Cancel; the picker opens when it's clicked.
- Games with `t.window.resizable = true` fill the page and get `love.resize`.
- `love.window.setFullscreen` resizes the game immediately; the browser
  enters real fullscreen on the next click or key press (browsers only allow
  fullscreen from a user gesture).

## Not supported

- Networking modules: `socket` (LuaSocket) and `enet` (browsers have no raw
  sockets). `https` works, see above.
- WOFF2 fonts (FreeType is built without Brotli); TTF and OTF work.
- LuaJIT itself and its `ffi` library (Lua runs on PUC Lua 5.1 with LuaJIT's
  language extensions and this project's own JIT; see "Lua compatibility").
- Compute shaders (WebGL 2 has none).

## How it works

`web/native/web_main.cpp` replaces LÖVE's `main()`. On desktop LÖVE resumes
its boot coroutine in a `while` loop. `boot.lua` yields once per iteration of
`love.run`'s main loop, so on the web that coroutine is resumed once per
`requestAnimationFrame` instead. LÖVE's own Lua code changes only where
noted below.

The engine patches (`git diff dca79b4 -- love deps`) are kept small so they
can be rebased onto newer LÖVE commits:

- Add an `LOVE_EMSCRIPTEN` platform (`config.h`) and leave out LuaSocket
  and ENet.
- lua-https gets a browser backend
  (`love/src/libraries/luahttps/src/emscripten`, requests made in
  `web/native/library_love.js`).
- WebGL 2 differences: no texture swizzle (LA8 textures use
  `LUMINANCE_ALPHA`), no `GL_FRAMEBUFFER_SRGB` toggle.
- `love.timer` uses `emscripten_get_now`; sleeping doesn't block.
- A Lua-to-WebAssembly JIT (above), in `deps/lua-5.1.5/ljit.inc` with small hooks in `lvm.c`, `ldo.c` and `lfunc.c`.
- Green threads for `love.thread` (above); audio streaming refills from the
  frame loop and a timer instead of a pool thread, and recovers from underruns.
- `love.video` decodes Theora from the frame loop too, instead of its worker
  thread. libtheora's decoder is built from source (`deps/theora`, without
  its x86/ARM assembly); libogg is Emscripten's port.
- A streaming Source seeked while paused or stopped no longer skips ahead
  when played again (this showed up as a video with audio jumping ahead).
- `boot.lua` skips modules the build doesn't include.
- LuaBitOp (`deps/luabitop`) is loaded as the global `bit`, as on LuaJIT.
- SDL3 text input is started when the window is created (not on touch
  devices). Text from the page's hidden text field is pushed as SDL text
  events by `web/native/web_main.cpp`.
- `love.window.showFileDialog` hands the dialog to `library_love.js`
  instead of SDL (`love/src/modules/window/sdl/Window.cpp`).

### Smitten's additions

Smitten is a fork: its features are part of the engine, not a module on
top of it. DESIGN.md, section 9, summarizes what it changes from LÖVE.

- `love.cpp` makes the engine table both `love` and `smitten`, registers
  the embedded Lua modules (`build/gen/engine_lua.h`), gives `love.box2d`
  (the scenes' Box2D 3), `love.lovephysics` (LÖVE's `love.physics`),
  `love.video` and `love.synth` loaders that `dlopen` the side module the
  player loaded (or explain which module to turn on), and exposes the live
  tweaking channel (`love._livePoll`, fed by `web_main.cpp`).
- `boot.lua` calls `love.engine.init` once LÖVE's modules are loaded:
  Smitten's modules load on first use, helpers join LÖVE's modules, and
  `smitten.json` sets up the display, input actions and the main scene.
  `love.run` drives the scene tree through `love._engine`; a game without
  scenes runs exactly as in LÖVE.
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
  LÖVE players on the same site.

## Licenses

LÖVE is under the zlib license (`love/license.txt`); its bundled libraries
keep their own licenses. Lua 5.1 is MIT (`deps/lua-5.1.5/COPYRIGHT`), as is
LuaBitOp (`deps/luabitop/bit.c`). libtheora is BSD-style
(`deps/theora/COPYING`).
Changes in this repository are marked in the source and follow the same
licenses. The default palette is Sweetie 16 by GrafxKid.
