# Smitten design

Status: third design, 2026-11-03. The project owner reversed the second
design's 3D support and asked that Smitten stop looking like a copy of
Godot; earlier designs are in git history.

Smitten is a 2D game engine and editor that runs in the browser, for
teenagers and game jams. Games are built from scenes of pieces, given life
by Lua scripts the game's maker owns, and shared on a site where anyone can
play and remix them. Underneath it's a fork of LÖVE 12 compiled to
WebAssembly, with a Lua-to-WebAssembly JIT.

## 0. Decisions

| Question | Decision | Section |
| --- | --- | --- |
| Who it's for | Teenagers and game jams first (e.g. Hack Club members); experienced LÖVE developers a close second | 1 |
| Engine | A full fork of LÖVE with one table: `smitten` and `love` are the same, so LÖVE games and tutorials still work | 2, 9 |
| Dimensions | 2D only | 4 |
| Identity | Smitten's own model and words, not Godot's: pieces, Bodies with built-in shapes, Zones, tags | 4 |
| Behavior | Scripts that are the piece's own code (no boilerplate, a short API like Pico-8's). Ready-made ones (platformer, patrol, pickup...) are copied into the project as ordinary Lua files to read and change; nothing is a hidden engine behavior | 5 |
| Packaging | A game ships only the engine modules it uses (physics, video, sound generator) | 3 |
| Editor | Flexible, modular and understandable; every tool opens ready to use; live tweaking while the game runs | 6 |
| Sharing | A site to publish, play and remix games in the browser (prototype: Cloudflare Workers, R2, D1) | 7 |
| Language | Luau-like syntax in the parser, compiled to the Lua 5.1 bytecode the JIT runs | 8 |
| Looks | General, not retro: pixel art is a template and a setting. Neutral editor theme; icons from Lucide | 6 |

## 1. Who it's for

1. **Teenagers making their first games, and jam teams.** Often on
   Chromebooks or school laptops. They decide the defaults, the words and
   what's on screen.
2. **Experienced LÖVE developers.** The whole LÖVE 12 API is there, plain
   Lua runs as is, and a `main.lua` game runs without a single scene.

## 2. One engine

- `smitten` is the engine table, with LÖVE's modules (`smitten.graphics`,
  `smitten.audio`, `smitten.physics`, ...) and Smitten's next to them
  (`smitten.scene`, `smitten.input`, `smitten.tween`, `smitten.assets`,
  `smitten.storage`, `smitten.display`, `smitten.synth`). `love` is the same
  table.
- Helpers join the module they belong to: `smitten.math.chance/pick/clamp/
  lerp/approach`, `smitten.timer.after/every`, `smitten.mouse.pressed`,
  `smitten.mouse.x/y/worldX/worldY`, `smitten.keyboard.pressed`.
- `love.run` runs the scene tree when there is one: input, the game's own
  `smitten.update`, scripts and physics, then the world, the game's
  `smitten.draw`, and UI on top. A project whose `smitten.json` names a main
  scene needs no `main.lua`.

## 3. Modules: a game ships only what it uses

| Module | What's in it | When a game gets it |
| --- | --- | --- |
| core (`smitten.wasm`, 6.9 MB) | Lua and the JIT, LÖVE's modules, the scene tree, pieces, collisions, UI | Always |
| `physics2d` (0.33 MB) | Box2D 3 (our fork, `deps/box2d3`): the scenes' physics, `smitten.physics` queries | A Body, Zone or Joint, or code using `smitten.physics.raycast` and the other queries |
| `lovephysics` (0.23 MB) | LÖVE's `love.physics` (Box2D 2.4) | Code using `love.physics.newWorld` and the rest of LÖVE's API |
| `video` (0.13 MB) | Theora, `smitten.video` | Code using `smitten.video` |
| `synth` (0.03 MB) | The sound generator | `.sfx` or `.song` files, or `smitten.synth` |

Each optional module is an Emscripten side module that the player loads
before `main` runs. The editor works out which a project needs from its
scenes and scripts; `smitten.json` can override that (`"always"`,
`"never"`), and Project settings › Modules shows each one, why it's
included and its size. Using one that wasn't loaded raises one clear error
naming the setting; when play-testing, the editor turns it on and restarts.

## 4. Scenes and pieces

Five words, used the same way everywhere:

- **Project**: a folder of files with a `smitten.json`.
- **Scene**: pieces in a tree, saved as a `.scene` file. A level, a menu, a
  player and a coin are all scenes.
- **Piece**: one thing in a scene. Pieces nest: a piece's children move
  with it.
- **Script**: a Lua file attached to a piece (one per piece) that gives it
  behavior.
- **Tag**: a word on a piece (`player`, `enemy`, `coin`) that scripts find
  pieces by and that decides what touches what.

A scene can be placed inside another scene (a *placed scene*): the coin
scene twenty times in a level. Changing `coin.scene` changes every coin; a
placed scene can override its root's properties and script variables.

### The pieces

All piece types, their properties, methods and events are described once in
`love/src/modules/scene/pieces.json`, which the runtime, the inspector, the
Add a piece dialog, completions and [docs/pieces.md](docs/pieces.md) read.

| Group | Pieces |
| --- | --- |
| Basic | `Group` (a position; holds other pieces or runs a script), `Timer` |
| Things you see | `Sprite`, `Shape`, `Text`, `Tiles`, `Camera`, `Particles` |
| Bodies and zones | `Body`, `Zone`, `Hitbox`, `Joint` |
| On-screen UI | `Label`, `Button`, `Panel`, `Picture`, `Bar` |
| Sound | `Sound` |

What makes these Smitten's own rather than another engine's:

- **One Body, three motions.** A Body is solid; its `motion` is a setting:
  *still* (walls and moving platforms), *scripted* (players and enemies the
  script moves with `self:move()`), or *physics* (crates that fall and
  tumble, on Box2D). Changing how something moves is a dropdown, not a
  different type.
- **Shapes fit themselves.** A Body's or Zone's `shape` is `auto` by
  default: it fits the Sprites and Shapes inside it (a lone circle gives a
  circle). No separate collision-shape piece to forget; a `Hitbox` adds
  extra shapes when auto isn't enough.
- **Tags decide what touches what.** `passThrough = "ghost, pickup"` on a
  Body, `detects = "player"` on a Zone. No layer and mask numbers.
- **Plain words.** `Group`, `Tiles`, `Zone`, `Picture`, `Bar`, `tick()`,
  `hit()`, `self:onGround()`, `smitten.scene.go()`, `spawn()`, `tagged()`.

### The scene file

```json
{
  "format": "smitten.scene",
  "version": 2,
  "root": {
    "name": "Level", "type": "Group", "script": "scripts/level.lua",
    "children": [
      { "name": "Player", "scene": "scenes/player.scene", "properties": { "x": 120, "y": 560 } },
      { "name": "Ground", "type": "Body", "properties": { "motion": "still", "x": 900, "y": 620 },
        "children": [ { "name": "Look", "type": "Shape", "properties": { "width": 1800, "height": 32 } } ] },
      { "name": "Coin", "scene": "scenes/coin.scene", "tags": ["bonus"] }
    ]
  }
}
```

Properties equal to their defaults are left out. Scenes saved with the
second design's names are converted when a project opens
(`web/editor/core/migrate.js`).

### Scripts

A script is the piece's own code, as simple as Pico-8 and Godot make it:
no table to make and return, no `self.` and no `smitten.` for everyday
things.

```lua
-- scripts/player.lua, attached to a Body whose motion is "scripted"
speed = 220          -- script variables: shown in the inspector,
jumpHeight = 96      -- changeable per piece
gravity = 1800

function physicsUpdate(dt)
  vx = axis("left", "right") * speed
  vy += gravity * dt
  if onGround() and pressed("jump") then vy = -jumpSpeed(jumpHeight) end
  move()
end

function hit(other)            -- bumped into another body
  if other:is("enemy") then reload() end
end
```

- **Names are the piece's.** Each piece runs its script file once in an
  environment of its own (one compiled chunk, so pieces share the code and
  the JIT's work). Reading a name looks at the script's functions, then the
  piece (properties, variables, methods bound to it: `move()` is
  `self:move()`), then children for capitalized names (`Look.color`,
  `Camera.zoom`), then the short API, then Lua's globals. Assigning a name
  that isn't `local` sets it on the piece. `self` is there too.
- **The short API** (`love/src/modules/scene/script.lua`): `pressed`,
  `down`, `released`, `axis`, `vector`; `go`, `reload`, `spawn`, `make`,
  `tagged`, `first`, `root`; `sfx("coin")`, `music("theme")`, `stopMusic`;
  `wait`, `task`, `after`, `every`, `tween`, `time`; `approach`, `lerp`,
  `clamp`, `sign`, `round`, `rnd`, `choose`, `dist`, `jumpSpeed`;
  `screenWidth`, `screenHeight`, `mouse`; and for `draw()`: `pen`, `rect`,
  `circle`, `line`, `write`, `sprite`. Everything in `smitten.*` is still
  there. Names that pieces already use as properties (`color`, `text`,
  `image`) or methods (`find`, `start`) were left to them; `spawn()` adds to
  the scene, `self:spawn()` inside the piece.
- **Callbacks**: `ready()`, `update(dt)`, `physicsUpdate(dt)` (60 a
  second), `draw()`, `removed()`, and events named after what happened:
  `hit(other)`, `entered(other)` / `exited(other)`, `pressed()`,
  `finished()`, `tick()`. Any piece can `emit("name", ...)` its own;
  `piece:on("pressed", fn)` listens from elsewhere. Another script calls a
  script's function as a method: `other:hurt(5)`.
- **Waiting**: `ready()` and events run as tasks (pooled coroutines), so
  they can `wait(1)`; `task(function() ... end)` runs anything as one.
  `update` and `draw` run straight through and say so if they `wait()`.
- **Script variables**: top-level `name = value` lines (numbers, strings,
  booleans, colors) appear in the inspector; `local` ones don't, and are the
  piece's own private state.
- **Old-style scripts** (a table they return, `function Player:update(dt)`)
  still work, so older projects don't break.

## 5. Ready-made scripts

Platformer player, top-down player, patrol, chase, fly straight, pickup,
spin, bob and drag (`web/editor/scripts/*.lua`). Attaching one copies it
into the project's `scripts/` folder, where it's an ordinary script: read
it, change it, delete it. Templates use them the same way. They only use
the public API, so they double as examples of how things are done.

## 6. Editor

Rules: nothing waits for you to make something first (Paint opens on a new
image, Sound on a new effect); one place for each thing; panels that don't
apply are hidden; the layout is yours (drag panel tabs between docks, hide
and show panels, per-workspace layouts, reset); everything explains itself
in place; standard conventions; neutral looks with icons from
[Lucide](https://lucide.dev) (generated into `web/editor/icons.js` by
`tools/gen-icons.mjs`).

- **Workspaces**: Scene, Script, Paint, Sound, Music.
- **Panels**: Scene (the pieces), Files, Inspector, Output; the tile panel
  appears under the scene view while a Tiles piece is selected.
- **Add a piece** (Ctrl+A): searchable, grouped, with what each piece does
  and suggestions for what goes inside what. **Attach a script** offers a new
  script, a ready-made one, or one the project has.
- **Scene view**: pan, zoom, grid and snapping, move/rotate/scale handles,
  Body and Zone shapes drawn when Shapes is on, files dropped in as pieces,
  tile painting.
- **Live tweaking**: while a game runs, the Scene panel and Inspector show
  the running game's pieces with their current values. Changes go only to
  the running copy and are gone when it stops; the saved scene is never
  touched. (`love/src/modules/engine/live.lua`, `web/editor/core/live-doc.js`.)
- **Project settings**: name, main scene, display (resolution and how it
  fits the window, smooth or pixel, antialiasing, background color),
  splash screen, input actions, physics, modules.
- **Export**: a web zip with only the modules the game uses, a project
  zip, a `.love`; share links; publishing to the sharing site.

## 7. Sharing site

A Scratch/Roblox-style site where people publish games from the editor and
anyone plays them in the browser, with remixing. It's in `platform/`: a
plain Node server with SQLite and game files on disk, made to run on Hack
Club Nest. Accounts (username and password with recovery codes, or Hack
Club's sign-in; no email), games owned by accounts, the editor signing in
through a popup for a revocable token, a gallery, profiles, a play page
running Smitten's player, remix into the editor, reporting that hides a
game after several reports, moderation with bans, size and content checks,
rate limits. `platform/README.md` has the details and the next steps.

## 8. Language

Lua 5.1 with LuaJIT's extensions plus Luau-style syntax in the parser,
compiled to existing bytecode, so the JIT, debug hooks, coroutines and
green threads work unchanged:

| Feature | Example |
| --- | --- |
| Compound assignment | `score += 10`, `name ..= "!"`, also `-= *= /= %= ^=` |
| `continue` | `for i = 1, n do if skip(i) then continue end end` |
| String interpolation | `` `HP: {hp}/{maxHp}` `` |
| If-expressions | `local speed = if running then 200 else 100` |

The JIT speculates on types seen at run time and falls back to the
interpreter when a guess is wrong (README, "The Lua JIT").

## 9. What Smitten changes from LÖVE

Smitten started from LÖVE 12 (love2d/love@ef388d4) and Lua 5.1.5, through
Cupid's web port.

- **Runs in the browser** (Cupid's port): an Emscripten platform; the main
  loop driven by `requestAnimationFrame`; WebGL 2 differences; an HTTPS
  backend through `fetch`; green threads for `love.thread` (one core);
  audio streaming and video decoding from the frame loop; file dialogs and
  text input through the page. No LuaSocket, ENet or FFI.
- **Lua**: PUC Lua 5.1 with LuaJIT's extensions instead of LuaJIT (which
  can't target WebAssembly), a JIT that compiles Lua to WebAssembly, and
  Smitten's syntax.
- **One table**, `smitten` = `love`, and helpers in LÖVE's modules.
- **Split into a core and optional modules** loaded only when used.
- **New modules**: scenes and pieces, input actions, tweens and timers,
  assets, saving, display scaling, JSON, the sound generator, live tweaking.
- **The main loop** runs the scene tree; `smitten.json` replaces the need
  for `main.lua`.

LÖVE's own engine code is barely touched outside the web port: its API,
`conf.lua` and callbacks work as in LÖVE, so LÖVE games run as they are
(except LuaJIT-only and networking libraries).

## 10. Storage, hosting, export

Projects live in the browser's IndexedDB (`smitten`); settings use
`smitten-editor.*`; game saves have their own folder. Smitten is hosted on
its own domain; `serve.py` uses port 8766 locally.

## 11. Repository layout

```
smitten/
  DESIGN.md, README.md, build.py, serve.py, package.py
  love/                        the engine (a LÖVE 12 fork)
    src/modules/love/          boot, the main loop, the smitten/love table, optional modules
    src/modules/scene/         scenes and pieces; pieces.json describes them all
    src/modules/engine/        start-up, helpers, live tweaking
    src/modules/{input,tween,assets,storage,display,json,synth}/
  deps/lua-5.1.5/              Lua, Smitten's syntax, the JIT
  web/native/, web/player/     web entry point and the player
  web/editor/                  the editor; scripts/ holds the ready-made scripts
  platform/                    the sharing site prototype
  tools/                       tests and generators
```

## 12. Next

- Triangle shapes, turned shapes for scripted Bodies and Zones (physics
  already turns them), slopes in tiles.
- An animation timeline for any property.
- Hack Club sign-in, moderation tools and hosting for the sharing site.
- The WebGPU experiment (README) if it pays off.
