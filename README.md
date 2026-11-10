# Smitten

Smitten is a 2D game engine in your browser. You make scenes from pieces.
You give the pieces behavior with Lua scripts that are yours. You paint
images, and you make sound effects and music. Then you share the game,
and anyone can play it and remix it. All of this is in one browser tab,
and you do not install anything. The engine uses a fork of
[LÖVE](https://love2d.org) 12, compiled to WebAssembly.

The engine and editor of Smitten started from the code of
[Cupid](https://github.com/Mostlime12195/cupid). Cupid brings LÖVE 12 to
the web with a Lua-to-WebAssembly JIT. Smitten is a different project that
uses that code. It runs Smitten projects, not LÖVE games (Cupid runs LÖVE
games). Smitten and Cupid are not affiliated with the LÖVE team.

## What you get

- **Scenes made of pieces**:
  - A `Sprite` draws an image.
  - A `Body` is solid. It does not move, or your script moves it, or
    physics moves it. Its shape fits the pieces in it.
  - A `Zone` finds things that come into it.
  - `Label` and `Button` pieces are the UI.

  You can put scenes in scenes: a level can have the coin scene in it
  twenty times. Tags (`player`, `enemy`) set what touches what.
  [docs/pieces.md](docs/pieces.md) shows all the pieces.
- **Scripts that are yours**: behavior is Lua. There are ready-made scripts
  (platformer player, top-down player, patrol, chase, pickup, fly straight,
  spin, bob, drag). Smitten copies them into your project, so that you can
  read them and change them.
- **An editor** with a scene tree, an Inspector, the scene view, a code
  editor, and workspaces for painting, sound effects and music.
  - You can move panels between docks.
  - Each tool opens ready to use.
  - **Live tweaking** lets you change the game while it runs, and it does
    not change your files.
- **One engine table**: `smitten` has drawing, sound, input, files and the
  modules of Smitten (`smitten.scene`, `smitten.input`, ...). Scripts also
  have a short API (`pressed("jump")`, `sfx("coin")`).
- **Only what a game uses**: physics (Box2D), video and the sound generator
  are separate downloads. A game includes them only when it uses them.
- **A friendlier Lua**: `score += 10`, `continue`, `` `HP: {hp}` `` and
  `if a then b else c` expressions (see "Smitten syntax").
- **Sharing**: a site to publish, play and remix games (a prototype in
  `platform/`), share links, and a web build that you can put on itch.io.

The docs start at [docs/reference.md](docs/reference.md). They tell about
getting started, scripts, scenes, input, sound, camera, tiles, UI, animation, saving,
drawing, project settings and sharing. They also have the script API, all
the pieces and the file formats. The games site shows the docs at `/docs`.
[DESIGN.md](DESIGN.md) gives the reasons for the decisions in Smitten.

```lua
-- scripts/coin.lua, on a Zone: a script is the code of the piece
worth = 10                -- the Inspector shows this value

function entered(other)
  if other:is("player") then
    sfx("coin")
    root():emit("scored", worth)
    destroy()
  end
end
```

## What is here

| Path | What it is |
| --- | --- |
| `dist/` | The build output: `index.html` (the editor), `player.html`, `smitten.mjs` + `smitten.wasm` (the engine core), `modules/*.wasm` (optional engine modules), `synth.mjs` (the synthesizer, for the editor), `pieces.json` |
| `love/` | The engine: LÖVE (upstream commit `ef388d4`) with the web patches of Cupid and the modules of Smitten |
| `love/src/modules/scene/` | Scenes and all the piece types. `pieces.json` describes all of them |
| `love/src/modules/{engine,input,tween,assets,storage,display,json}/` | The modules of Smitten, in Lua. `build.py` embeds them. `engine/live.lua` is live tweaking |
| `love/src/modules/synth/` | The sound synthesizer (the `synth` module) |
| `deps/lua-5.1.5/` | PUC Lua 5.1.5 with the extensions of LuaJIT, the JIT and the syntax of Smitten |
| `deps/theora/` | The libtheora 1.2.0 decoder, for video |
| `web/native/` | The web entry point (`web_main.cpp`). It replaces the blocking `main()` of LÖVE |
| `web/player/` | The web player page (standalone and embeddable). It loads the modules that a game needs |
| `web/editor/` | The editor: `core/` (project, scene documents, schema, live tweaking), `shell/`, `panels/`, `workspaces/`, `dialogs/`, the tools in `tools/`, and the ready-made scripts in `scripts/` |
| `platform/` | The games site: a Node server with SQLite, and game files on disk |
| `build.py` | The build script. It reads the lists of source files from `love/CMakeLists.txt` |
| `serve.py` | A local development server |
| `package.py` | A command-line web export for a project folder or a zip |
| `tools/` | Tests (`editor-tests`, `scene-tests`, `platform-tests`, `clip-tests`, `stress`, `smitten-audio`, `video`, `luacompat`, `errorscreen`, `paths-tests`, `text-tests`, `ui-tests`, `animation-tests`, the test suite of the JIT) and generators (`gen-icons.mjs`, `gen-docs.mjs`) |

## Performance

Lua runs on PUC Lua 5.1, with a JIT that compiles hot functions to
WebAssembly. On code that uses much Lua, it is 1.7 to 14 times faster than
the plain interpreter (see "The Lua JIT" below). Drawing, audio and image
decoding are C++ code in the engine, batched into WebGL 2. Physics is
Box2D 3 in C. Because of this, if a game uses most of its frame time to draw and
simulate, the browser makes it only a little slower.

## Lua

Smitten runs PUC Lua 5.1.5. It adds back the LuaJIT 2.1 language
extensions that libraries frequently use (`deps/lua-5.1.5`):

| Extension | Notes |
| --- | --- |
| `goto` and `::labels::` | Lua 5.2 rules: you cannot jump into the scope of a local. Labels are visible in nested blocks. `goto continue` to a label at the end of a loop works |
| `\xXX`, `\z` and `\u{XXXX}` string escapes | |
| `coroutine.yield` inside `pcall`/`xpcall` | In a coroutine, the function runs in a child coroutine that passes yields through. `coroutine.running`/`status` report the parent. `xpcall` handlers run at the error, so `debug.traceback` shows the code that failed. Outside coroutines, `pcall` is the plain C function, at full speed |
| `load(string [, name [, mode [, env]]])`, `loadfile(name, mode, env)` | |
| `xpcall(f, handler, ...)` | Gives the extra arguments to `f` |
| `math.log(x, base)`, `string.rep(s, n, sep)` | |
| `string.format`: `%s` uses `__tostring` and accepts all values; `%a` | |
| `table.move`, `require("table.new")`, `require("table.clear")` | |
| `coroutine.isyieldable`, `package.searchpath`, `os.exit(true/false)` | |
| `bit` | LuaBitOp, as on LuaJIT |

There is no FFI and no `jit` library (the `jit` global is nil). 64-bit
literals (`1LL`) and imaginary literals (`2i`) cause a syntax error. The
error tells you that Smitten does not have them. If code yields inside a metamethod, a `for ... in`
iterator or a C function (for example, the comparator of `table.sort`),
Lua raises an error. The error tells you that yields work inside `pcall`,
but not in that position.

### Smitten syntax

The parser of Smitten also accepts four parts of Luau syntax. Each one
compiles to the bytecode that Lua 5.1 already has (no new opcodes). Because of this,
the JIT, debug hooks, coroutines and error messages work as for all other
code. The line numbers are the line numbers of the source. All
programs that ran before compile to the same bytecode as before.

| Syntax | Example | Notes |
| --- | --- | --- |
| Compound assignment | `score += 10`, `name ..= "!"`, also `-= *= /= %= ^=` | One variable (local, upvalue, global, field or index). In `t[f()] += 1`, Lua evaluates `t` and `f()` one time |
| `continue` | `for i = 1, n do if skip(i) then continue end ... end` | Jumps to the end of the loop body (to the condition in `repeat ... until`; the condition cannot use a local that the `continue` skipped). As `break` does, it ends its block. It is a keyword only when it is alone: `continue = 1`, `t.continue`, `::continue::` and `goto continue` continue to work |
| String interpolation | `` `HP: {hp}/{maxHp}` `` | The original `tostring` converts each `{expression}` (if you replace the global, this does not change). `\{` writes a brace. The usual escapes work. A backtick string cannot be the argument of a call without parentheses (`` print(`x`) ``) |
| If-expressions | `local speed = if running then 200 else 100` | You can use `elseif`, and you must use `else`. Lua evaluates only the branch that it chooses |
## The Lua JIT

`deps/lua-5.1.5/ljit.inc` compiles a Lua function to a small WebAssembly
module after the function has run (or has looped) 50 times. Then the
browser compiles this module to machine code, as it does for all wasm.

- Lua values stay in the Lua stack, in the same positions where the
  interpreter keeps them. Because of this, the JIT can go into and out of compiled
  code at any instruction:
  - after calls.
  - when a coroutine resumes.
  - from the middle of a hot loop.
  - to give a frame back to the interpreter when a script sets a debug hook.
- As the optimizing tiers of V8 do, the JIT speculates on what the
  interpreter has seen. Some operations have seen only numbers:
  arithmetic, comparisons, and field reads whose result the code uses as
  a number. These operations check their values one time. Then they keep
  the values in wasm locals across instructions and loop iterations,
  without more loads or type checks.
- When a check fails, the function *deopts*. The interpreter continues
  from that instruction, and the JIT records the site. Later, the JIT
  compiles the function again without that guess. After five deopts, it
  compiles the function without guesses. The interpreter records
  arithmetic and comparisons that go the slow way. Because of this, the JIT does not
  compile code that uses metamethods with guesses that fail.
- The code continues to write the Lua stack while it runs. Because of this, when the
  code leaves compiled code, it does not have to write values back. A
  helper call can run any Lua code, also `debug.setlocal` on our locals.
  After each helper call, the code loads the values in locals again and
  checks them.
- The innermost loops become wasm loops, which V8 optimizes as loops.
- These operations run inline:
  - moves, constants, tests and numeric `for` loops.
  - reads of table fields and array slots. For constant string keys, the
    JIT calculates the hash at compile time. It follows `__index` tables
    up to three levels: an object, its class and the base of the class.
  - writes of fields that exist, and of array slots.
  - writes of new fields when their slot in the hash part is free (table
    constructors).
  - returns.

  All other operations that can involve metatables, the GC, errors or
  calls go to helpers. The helpers are copies of the code of the
  interpreter. Because of this, the behavior is the same, also the error messages
  and their line numbers.
- Compiled functions call other compiled functions directly, up to 64
  levels deep. If there is nothing unusual (varargs, hooks, a stack that
  grows), the JIT sets up the frame of the callee without
  `luaD_precall`.
- The interpreter runs frames that have a line hook or a count hook. Because of this,
  `debug.sethook` works with no change.
- `?jit=0` on the web player turns the JIT off.

`node tools/jit/bench.mjs` runs `tools/jit/bench.lua` several times with
the JIT on and off, and prints the median. These are the results on an
Apple M5 with Node 26:

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

The JIT compiled 23 functions into 76 KiB of wasm in 2.7 ms (this includes
the time that the browser used to compile each module). Code that
allocates much memory is still limited by the C heap and the GC of Lua.
Sorting and string functions are C code, and the JIT does not change them.
Desktop LuaJIT is still much faster on code with many calls (`fib(27)` in
approximately 1 ms).

`tools/jit/` builds the standalone interpreter for Node, and runs a
differential test suite. Each test must print the same output in these
three modes:

- with the JIT off.
- with the JIT compiling all functions immediately.
- with a mix of compiled and interpreted frames.

```bash
sh tools/jit/build-node.sh
```

```bash
bash tools/jit/test.sh
```

```bash
node tools/jit/bench.mjs
```

`node tools/jit/run.mjs --stats file.lua` prints the number of compiled
functions, the size of the wasm, the time to compile and the deopts. The
`spec-*` tests make each speculation fail:

- types that change in the middle of a loop.
- metatables that come later.
- `debug.setlocal` from a callee or on a suspended coroutine.
- hooks that a script sets in the middle of a loop.
- errors in speculated code.

## Building

You must have the
[Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
(tested with 6.0.13) and Python 3.10 or later.

```bash
source /path/to/emsdk/emsdk_env.sh
```

```bash
python3 build.py
```

Builds are incremental (approximately 350 source files the first time).
The build links the engine two times:

- a core (`dist/smitten.wasm`, an Emscripten main module).
- side modules in `dist/modules/`. A game downloads a side module only
  when it uses it.

| Module | Contents | Size |
| --- | --- | --- |
| core | Lua and the JIT, drawing, sound, input, files, scenes, pieces, UI | 6.73 MB |
| `physics2d` | Box2D 3: Bodies, Zones, Joints, `smitten.physics` queries | 0.34 MB |
| `video` | Theora, `smitten.video` | 0.13 MB |
| `synth` | the synthesizer, `.sfx` and `.song` files | 0.03 MB |

The build compiles all code as position-independent code. Because of this, the two
types of module can link at run time. The core exports exactly the
symbols that the side modules import. If a module needs a symbol that the
core does not export, the build fails. The build also embeds the Lua
modules of Smitten (and `pieces.json`, as Lua) in the engine. It compiles
the synthesizer a second time, separately, as `dist/synth.mjs`, for the
previews in the editor. Other options:

- `python3 build.py --debug` for assertions and no optimization.
- `python3 build.py --web-only` to copy only the web player, the editor and the examples into `dist/`.
- `python3 build.py --profiling` to keep function names for size analysis (it writes to `build/profiling/`).

Then serve `dist/`:

```bash
python3 serve.py
```

Then open http://localhost:8766/ for the editor, or
http://localhost:8766/player.html?game=path/to/game.zip for the web player
(the game is a zip of a project folder).

Tests:

- `node tools/editor-tests/test.mjs` tests these parts:
  - the piece schema. It also checks these things: the engine defines
    each method in the schema, and the engine sends each event. The short
    script API is the same as in `script.lua`.
  - scene documents (reading, writing, undo, placed scenes).
  - module detection, the templates, the ready-made scripts and script
    variables.
  - "Update this project" (old scenes and scripts go in, new scenes and
    scripts and the report come out).
- `node web/editor/workspaces/scene/cells.test.mjs`: the tile format.
- `node web/editor/workspaces/scene/uilayout.test.mjs`: where the editor
  puts UI pieces (`uilayout.js`). It uses the cases in
  `tools/scene-tests/ui/layout-cases.json`, which also check the copy in
  the engine (`uilayout.lua`), and rectangles that a person calculated.
- `node web/editor/workspaces/scene/terrain.test.mjs`: the terrain
  matcher (which tile fits the neighbours of a cell). It uses the cases in
  `tools/scene-tests/levels/terrain-cases.json`, which also check the copy
  in the engine. `node tools/scene-tests/make-levels-fixture.mjs` writes
  these cases.
- `node web/editor/workspaces/scene/keyframes.test.mjs`: the values of
  animation keys for the preview of the Animate panel (`keyframes.js`). It
  uses the cases in `tools/scene-tests/animation/keyframe-cases.json`,
  which also check the copy in the engine (`keyframes.lua`).
  `node tools/scene-tests/make-anim-fixture.mjs` writes these cases.
- `node web/editor/tools/sprite/draw.test.mjs`: the drawing helpers of the
  sprite editor (flood fill and pixel lines).
- `node web/editor/tools/wav/wav.test.mjs`: WAV files and the changes
  that the sound file editor makes (trim, volume, normalize, speed), and
  sample instruments in the song model.
- `node tools/editor-tests/record.mjs`: the sound file editor in the built
  editor, with a fake microphone in a headless Chrome. It records, trims
  and saves a sound, and checks the WAV file. Then it uses the recording
  in a song. It also checks the messages for a blocked microphone and for
  a page that is not secure.
- `node tools/editor-tests/paint.mjs`: the sprite editor in the built
  editor, in a headless Chrome. It finds the **Sprites** workspace and
  **New** > **Sprite**. It draws two strokes while the editor saves, and
  checks that the saved PNG has all of each stroke. It also counts how much
  the editor draws. A stroke in a selection draws only the changed part. A
  stroke outside the image draws nothing.
- `node tools/clip-tests/test.mjs`: clips (`web/player/clips.js`). It
  tests the GIF encoder (it decodes each GIF again), the reading, joining,
  cutting and writing of WebM files, and the ring of recordings, with a
  clock and a recorder that the test makes.
- `tools/scene-tests/`: scenes that run in the engine.
  - `smoke`: pieces, bodies and zones, scripts and all of the script API.
    The script API includes input, tiles, camera, sprites, particles,
    sound, saving, pausing, time scale, scene changes with values and
    transitions, and UI focus. `smoke` stays a version 2 project.
  - `rigid`: physics Bodies and tag filtering.
  - `physics`: scene physics.
  - `lights`: Lights, Occluders and the Tint. It reads pixels back.
  - `paths`: `smitten.paths` in the engine.
  - `levels`: terrains, animated tiles and Backgrounds. It reads tiles and
    pixels back.
  - `text`: rich text, effects, revealing and measuring. It also checks
    that plain text draws the same as before. It reads pixels back.
  - `sounds`: volume and pitch for `sfx()` and the Sound piece, and songs
    with sample instruments. It measures the length and the pitch of each
    note. Then it makes sure that the editor makes the same samples.
  - `rules3` and `rules2`: the same project at version 3 and at version 2.
    They test the rules of each version: degrees or radians, `clicked()`
    or `pressed()`, undeclared names, `gravityScale` or `gravity`.
  - `animation`: Animators. It checks values between keys, step keys,
    colors, degrees, loops, `seek()`, `speed`, call keys, `animate()` in a
    task and an Animator in a placed scene. Then it checks that a scene
    with no Animator runs as before.

  You can open a scene test in the web player with the test server (see
  below). Each line that it prints tells what it checked.
- `lua5.1 tools/paths-tests/test.lua`: the pathfinders (`smitten.paths`)
  under plain Lua. It compares them with a plain Dijkstra search on random
  grids and graphs, and with the true shortest path in random rooms. Add
  `time` to see how long searches take.
- `lua5.1 tools/text-tests/test.lua`: the parser, layout and reveal of the
  text engine (`smitten.text`) under plain Lua, with a test font.
- `lua5.1 tools/ui-tests/test.lua`: the logic of the UI pieces (`ui.lua`,
  `widgets.lua`, `textinput.lua` and `uilayout.lua` in the engine) under
  plain Lua, with stubs for drawing. It tests where Rows, Columns, Grids
  and Scrolls put pieces, Slider drags, Checkbox groups, typing and
  selection in a TextInput, and the keyboard focus.
- `lua5.1 tools/animation-tests/test.lua`: keys and the Animator piece
  (`keyframes.lua` and `animator.lua` in the engine) under plain Lua, with
  the cases of `keyframe-cases.json`.
- `node tools/scene-tests/run.mjs` runs the scene tests in a headless
  Chrome. It fails if a test fails. `errors` and `lights` check
  themselves. `errors` checks what the engine tells you when a script has
  a mistake. `lights` checks what lights and shadows draw. `boards`
  and `boards-site` check `smitten.boards` without the games site, and in
  a page that acts as the games site. `clips` clicks **Record** in the web
  player, saves a video and a GIF, and checks the downloaded files.
- `python3 tools/serve_test.py` tests `serve.py`. CI
  (`.github/workflows/ci.yml`) runs all of these tests on each push, and
  keeps the built `dist/` as an artifact.
- `python3 tools/stress/gen.py` and `node tools/stress/run.mjs` run stress
  projects and the scene tests in a headless Chrome. `physics-check`
  prints a digest, to compare engine versions.
- `PLATFORM_PORT=8790 node tools/platform-tests/test.mjs`: the games site.
  `tools/platform-tests/boards-e2e.mjs` plays a game with a leaderboard on
  a local copy of the site. You run it yourself (it needs a build).
- `tools/smitten-audio` (its `check.mjs` makes sure that the engine and
  `synth.mjs` make the same samples), `tools/video` (playback, pausing and
  seeking), `tools/luacompat` (the Lua extensions) and
  `tools/errorscreen`.
- `node tools/gen-docs.mjs` makes `docs/pieces.md`, `docs/api.md`,
  `docs/engine.md`, the marked tables in the other pages, and the HTML
  docs in `platform/public/docs/` again. Run it after you change
  `pieces.json`, `web/editor/core/script-api.js` or
  `web/editor/smitten-docs.js`.

The test projects in `tools/` run with `python3 tools/test_server.py 8772`.
This server makes a zip of a project when the browser asks for it:
http://localhost:8772/player.html?game=tools/scene-tests/smoke.zip (or
`tools/video.zip&modules=video`, `tools/smitten-audio.zip&modules=synth`,
...).
## The editor

The editor is `dist/index.html`. It keeps all files in the browser
(IndexedDB). It does not upload anything, until you share or publish.

- **Workspaces** across the top (Alt+1 to 5): **Scene**, **Script**,
  **Sprites** (the sprite editor: images and sprite sheets), **Sound** (sound effects and
  recordings) and **Music** (songs). Each workspace has its own tabs, and it opens ready
  to use. For example, Sprites starts on a new sprite, and Sound starts on
  a new sound effect. New work becomes a file the first time that you change it.
- **Panels**: the Scene panel (the pieces), the Files panel, the Inspector
  and Output.
  - To move a panel, drag its tab to a different dock or to an edge of the
    window.
  - To hide or show panels, use the **View** menu.
  - Each workspace keeps its own layout.
  - **View › Reset layout** puts the layout back to the default.
- **Scene panel**:
  - Add pieces (Ctrl+A) from a list that you can search. The list tells
    about each piece type.
  - Put other scenes in this scene.
  - Drag pieces to change their order.
  - Rename with F2. Duplicate with Ctrl+D.
  - Save a part of a scene as a new scene.
  - A piece that does not have something that it needs tells you. (For
    example, a Body with nothing to fit its shape to.)
- **Inspector**:
  - properties in sections, with an editor for each type of property.
    For example: numbers that you can drag, colors, file pickers, tags and
    dropdowns. You can drop files from the Files panel on a file picker.
  - a reset arrow on changed values.
  - the script of the piece and its script variables.
  - the tags of the piece.
- **Attach a script**: a new script, a ready-made script (Smitten copies it
  into your project), or a script that you already have.
- **Scene view**:
  - pan, zoom, grid and snapping.
  - handles to move, turn and scale.
  - box selection.
  - the shapes of Bodies and Zones.
  - corner handles on polygons, lines and Walkable areas.

  You can drop files into the scene view to make pieces. When you select a
  Tiles piece, you can paint tiles with a tileset panel.
- **Play** (F5) runs the main scene. **Play scene** (F6) runs the open
  scene. To stop, press F8.
- **Live tweaking**: while the game runs, the Scene panel and the
  Inspector show the pieces of the game and their current values. When
  you change them, the game changes. When you stop, all values go back.
  The **Live** switch in the game bar turns live tweaking off.
- **Project settings**: the name, the main scene, the resolution and how
  the game fits the window, input actions, and engine modules.
- **Export**: a web zip for itch.io, with only the modules that the game
  uses, or a project zip. Also share links for small projects.
- The command palette (Ctrl+K), open a file (Ctrl+P), the piece reference
  (**Help**), light and dark themes, and icons from
  [Lucide](https://lucide.dev).
- The code editor is CodeMirror 6, with Lua and Smitten syntax. It
  completes the short script API, the names and methods of the piece,
  script functions, `smitten.*` and file paths.

The editor loads CodeMirror from a CDN. Because of this, the first load needs an
internet connection. If this load fails, the code editor uses a plain text
area.

## Publishing a game

1. Put a zip of your project (`game.zip`) in a folder.
2. Copy these files next to it: `player.html`, `player.js`, `player.css`,
   `smitten.mjs`, `smitten.wasm` and the `modules/*.wasm` files that your
   game uses.
3. Add this to the `<head>` of `player.html`:

   ```html
   <meta name="smitten-game" content="game.zip">
   <meta name="smitten-modules" content="physics2d">
   ```

**Export for web** in the editor does these steps for you. The command
line can also do them:

```bash
python3 package.py path/to/project out/ --zip
```

Both make a zip that you can upload to itch.io as an HTML game. If the
server sends `.wasm` files as `application/wasm`, browsers can compile the
engine while it downloads. Most hosts already do this.

Web player URL options:

| Option | Effect |
| --- | --- |
| `?game=url` | Loads a game (a zip of a project) from a URL |
| `?modules=a,b` | Engine modules to load before the game. If a game uses a module that is not loaded, the page loads again with it, if the server has it |
| `?autoplay=1` | Skips the Play button (audio can stay muted until the first click) |
| `?scale=fit` (default) / `integer` / `none` | How the web player scales a window of fixed size to the page |
| `?pixelated=1` | Nearest-neighbour upscaling (`scale=integer` also does this) |
| `?embed=1` | Embedded mode. The page controls it with `postMessage` (see `web/player/player.js`) |

## Web-specific behavior

- Saves (`smitten.storage`) are in IndexedDB. The engine writes them to
  IndexedDB every 2 seconds, when the tab becomes hidden, and when the
  game stops.
- Text input goes through a hidden text field. Because of this, these all get to
  `smitten.input.typed()`: IME composition (Chinese, Japanese, Korean),
  emoji pickers, dictation and on-screen keyboards. Text input is on by
  default, but not on touch devices (no hover, coarse pointer). On touch
  devices, a tap on the game shows the on-screen keyboard. (Browsers show
  it only after a tap.)
- `fullscreen(true)` changes the size of the game immediately. The browser
  goes into real fullscreen on the next click or key press. (Browsers
  allow fullscreen only after a click or a key press from a person.)
- `smitten.system.getOS()` gives `"Web"`.
- These are not available:
  - compute shaders (WebGL 2 does not have them).
  - WOFF2 fonts (the build of FreeType does not have Brotli). TTF and OTF
    fonts work.

## How it works

`web/native/web_main.cpp` replaces the `main()` of LÖVE. On desktop, LÖVE
resumes its boot coroutine in a `while` loop. `boot.lua` yields one time
in each iteration of the main loop of `love.run`. Because of this, on the web, the
code resumes that coroutine one time in each `requestAnimationFrame`.

The engine patches (`git diff dca79b4 -- love deps`) are small, so that we
can rebase them onto newer LÖVE commits:

- An `LOVE_EMSCRIPTEN` platform (`config.h`). The build does not include
  LuaSocket, ENet and lua-https. With `LOVE_SMITTEN`, it also does not
  include `love.thread` and the `love.physics` of LÖVE (Box2D 2.4).
- WebGL 2 differences: no texture swizzle (LA8 textures use
  `LUMINANCE_ALPHA`), and no `GL_FRAMEBUFFER_SRGB` toggle.
- `love.timer` uses `emscripten_get_now`. Sleep does not block.
- A Lua-to-WebAssembly JIT (see above), in `deps/lua-5.1.5/ljit.inc`, with
  small hooks in `lvm.c`, `ldo.c` and `lfunc.c`.
- No threads: audio streaming fills its buffers again from the frame loop
  and a timer, not from a pool thread. It also recovers from underruns
  (`love/src/modules/thread/web/FrameTasks.cpp`).
- `love.video` also decodes Theora from the frame loop, not from its
  worker thread. The build compiles the libtheora decoder from source
  (`deps/theora`, without its x86/ARM assembly). libogg is the port of
  Emscripten.
- If you seek a streaming Source while it is in pause or stopped, it does
  not skip ahead when it plays again. (Before this change, a video with
  audio jumped ahead.)
- `boot.lua` is shorter: no `conf.lua`, no `main.lua`, no command line and
  no no-game screen. A game is a project with a `smitten.json`. For all
  other folders, an error screen tells why. The main loop of
  `callbacks.lua` runs only the engine (no `love.load`/`update`/`draw`
  callbacks). Events go to the input handling of the engine.
- The engine loads LuaBitOp (`deps/luabitop`) as the global `bit`, as on
  LuaJIT.
- SDL3 text input starts when the engine makes the window (but not on
  touch devices). `web/native/web_main.cpp` pushes text from the hidden
  text field of the page as SDL text events.
- File dialogs go to `library_love.js`, not to SDL
  (`love/src/modules/window/sdl/Window.cpp`).

### Smitten's additions

Smitten is a fork: its features are part of the engine, not a module on
top of it. DESIGN.md, section 9, gives a summary of what it changes.

- `love.cpp`:
  - gives the engine table the name `smitten`.
  - registers the embedded Lua modules (`build/gen/engine_lua.h`).
  - gives loaders to `love.box2d` (the Box2D 3 of the scenes),
    `love.video` and `love.synth`. These loaders use `dlopen` on the side
    module that the web player loaded (or tell you which module to turn
    on).
  - exposes the live tweaking channel (`love._livePoll`, which
    `web_main.cpp` feeds).

  The code of the engine still calls the table `love` internally. Game
  code does not see that name. (`love.engine` gives scripts, and the
  files that they `require`, globals without it.)
- `boot.lua` calls `love.engine.init` after the modules load:
  - The modules of Smitten load when a game uses them the first time.
  - Helpers join the modules of the engine.
  - `smitten.json` sets up the display, the input actions and the main
    scene.

  `love.run` drives the scene tree through `love._engine`.
- `love/src/modules/scene/`: scenes and pieces. `pieces.json` describes
  each piece type. `build.py` changes it into Lua for the runtime. It also
  copies it next to the editor, for the Inspector, the Add a piece dialog
  and completions.
- `Synth.cpp` renders sound effects and songs. It has no LÖVE
  dependencies, so the build also puts the same code into `synth.mjs` for
  the editor. `LoopDecoder.cpp` plays a rendered song with a seamless loop
  as a streaming Source.
- `deps/lua-5.1.5`: the syntax of Smitten in `llex.c` and `lparser.c`. The
  registry keeps the original `tostring`, for interpolation.
- The web player keeps save files in its own data folder
  (`XDG_DATA_HOME`). The editor uses its own storage names. Because of this, Smitten
  never shares projects, settings or saves with Cupid or with other
  players on the same site.

## Licenses

Smitten has the zlib license (`LICENSE`), as LÖVE does. LÖVE has the zlib
license (`love/license.txt`). The libraries that come with LÖVE keep their
own licenses. Lua 5.1 has the MIT license (`deps/lua-5.1.5/COPYRIGHT`), and
LuaBitOp also has it (`deps/luabitop/bit.c`). libtheora has a BSD-style
license (`deps/theora/COPYING`). The source marks the changes to those
projects, and the changes keep the licenses of those projects. The default
palette is Sweetie 16 by GrafxKid.
