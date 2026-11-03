# Smitten design

Status: second design, 2026-11-03. It replaces the first one (2026-11-02),
whose pixel-first defaults, separate `smitten` module and objects-with-
behaviors model were dropped at the project owner's request. The old
document is in git history.

Smitten is a general 2D and 3D game engine that runs in the browser: an
editor with a scene tree, an inspector, 2D and 3D viewports, a code editor,
a paint tool and sound tools, on top of an engine that is a fork of LÖVE 12
compiled to WebAssembly with a Lua-to-WebAssembly JIT. Nothing to install;
games export to the web.

## 0. Decisions

| Question | Decision | Section |
| --- | --- | --- |
| Who it's for | Teenagers and game jams first (e.g. Hack Club members); experienced LÖVE developers a close second | 1 |
| Engine | A full fork of LÖVE. One namespace, `smitten`; `love` is the same table, so LÖVE games and tutorials still work | 2 |
| Look and feel | A general engine like Godot, Construct or GDevelop. Not retro: pixel art is a project setting, not the default | 5 |
| How games are built | A Godot-style node tree: each node does one job, nodes nest, any scene can be placed inside another, one script per node | 4 |
| Logic | Code (Smitten's Luau-like Lua) plus ready-made nodes. No event sheets | 4 |
| Dimensions | 2D and 3D | 5, 6 |
| Physics | Built-in 2D collisions; Box2D for 2D rigid bodies; Jolt for 3D | 7 |
| Packaging | A game ships only the engine modules it uses. Box2D, Jolt, 3D, video and the synthesizer are separate downloads, added automatically when a game uses them or by hand in Project settings or the export dialog | 3 |
| Editor | Flexible (panels move, hide and reset), modular (each tool is a workspace that opens ready to use) and understandable (every node, property and panel explains itself) | 8 |
| Language | Luau-like syntax in the parser, compiled to Lua 5.1 bytecode the JIT already runs | 9 |
| Hosting | Its own domain | 10 |
| Code from Cupid | Borrowed; Cupid is not part of Smitten | 11 |

The project owner made the engine, look, model, logic, dimension, physics,
packaging and hosting decisions; the rest follow from them.

## 1. Who it's for

1. **Teenagers making their first games, and jam teams.** Often on
   Chromebooks or school laptops where nothing can be installed. They decide
   the defaults, the wording and what is on screen.
2. **Experienced LÖVE developers.** The whole LÖVE 12 API is still there
   (as `smitten.*` or `love.*`), plain Lua runs as is, `main.lua` games run
   without a single scene, and LÖVE libraries work.

Smitten is for 2D and 3D games of jam-to-indie size. Out of scope: large
teams, consoles and app stores.

## 2. One engine: Smitten is a fork of LÖVE

Smitten's features are no longer a module bolted onto LÖVE. The engine is
one thing with one name:

- `smitten` is the engine table, with LÖVE's modules
  (`smitten.graphics`, `smitten.audio`, `smitten.physics`, …) and Smitten's
  own next to them (`smitten.scene`, `smitten.input`, `smitten.tween`,
  `smitten.graphics3d`, `smitten.physics3d`, …).
- `love` is the same table. `function love.update(dt)` and
  `function smitten.update(dt)` define the same callback, and
  `love.graphics` is `smitten.graphics`. Existing LÖVE games, `conf.lua`
  files and libraries run unchanged.
- Helpers join the module they belong to instead of a grab bag:
  `smitten.math.chance/pick/clamp/lerp/approach` join LÖVE's
  `love.math.random`; `smitten.mouse.pressed(1)` and
  `smitten.mouse.worldX` join `love.mouse.getPosition`;
  `smitten.timer.after/every` join `love.timer.getDelta`.
- `smitten.getVersion()` still answers LÖVE's version (12.0), because LÖVE
  libraries check it; `smitten.version` is Smitten's own.
- What players see is Smitten's: the window title, the error screen, the
  loading screen, the save folder.
- The C++ keeps LÖVE's `love::` namespace and `love/` folder, so upstream
  fixes still merge. Renaming them would change hundreds of thousands of
  lines for no visible gain.

### The main loop

`smitten.run` (LÖVE's `love.run`) runs the scene tree when there is one:
each frame it reads input, calls the game's own `smitten.update`, then
updates the tree (scripts, behaviors, physics), then draws the tree and
calls the game's `smitten.draw` on top. A project whose `smitten.json`
names a main scene needs no `main.lua` at all; a LÖVE game with no scenes
runs exactly as in LÖVE.

## 3. Modules: a game ships only what it uses

| Module | What's in it | When a game gets it |
| --- | --- | --- |
| core (`smitten.wasm`) | Lua and the JIT, window, 2D graphics, audio, input devices, files, the scene tree, 2D nodes, 2D collisions, UI nodes | Always |
| `physics2d` | Box2D and `smitten.physics` | A `RigidBody2D` or `Joint2D` node, or code using `smitten.physics` / `love.physics` |
| `3d` | The 3D renderer, glTF loading, `smitten.graphics3d` | Any 3D node, or code using `smitten.graphics3d` |
| `physics3d` | Jolt and `smitten.physics3d` | A 3D body, area or collision shape, or code using `smitten.physics3d` |
| `video` | Theora and `smitten.video` | A `VideoPlayer` node, or code using `smitten.video` |
| `synth` | The sound effect and music synthesizer | A `.sfx` or `.song` file played by the game, or `smitten.synth` |

How it works:

- Each optional module is a WebAssembly side module (Emscripten dynamic
  linking). The core exports exactly the functions the side modules
  import, and the player loads the game's modules before `main` runs, so
  `require` never waits on the network.
- The editor detects the modules a project needs from its scenes' node
  types and its scripts' API calls. `smitten.json` stores only overrides:
  `"modules": { "physics3d": "always" }` or `"never"`.
- Project settings › Modules and the export dialog list every module,
  whether it's included and why ("used by player.scene, enemy.lua"), and
  its download size.
- Using a module that isn't loaded raises one clear error: *"This game
  uses 3D physics, but the physics3d module isn't included. Turn it on in
  Project settings › Modules."* When play-testing in the editor, the editor
  turns it on and restarts instead.

## 4. Scenes and nodes

Five nouns, used the same way everywhere in the editor and the docs:

- **Project**: a folder of files with a `smitten.json`.
- **Scene**: a tree of nodes saved as a `.scene` file. A level, a menu, a
  player and a coin are all scenes.
- **Node**: one thing in a scene, with one job: a `Sprite2D` draws an
  image, a `CollisionShape2D` gives its parent a shape, a `Camera3D` views a
  3D scene. Nodes nest; children move with their parent.
- **Script**: a Lua file attached to a node (at most one per node) that
  gives it behavior.
- **Asset**: any other file a scene or script uses: images, models, sounds,
  fonts, tilesets.

### Scenes inside scenes

A scene can be placed in another scene as one node (an *instance*): the
player scene is placed in every level, the coin scene twenty times. An
instance can override its root's properties (position, script variables);
editing `coin.scene` updates every coin. In code,
`smitten.scene.instance("coin.scene")` makes a new one.

### The scene file

```json
{
  "format": "smitten.scene",
  "version": 2,
  "root": {
    "name": "Level1", "type": "Node2D",
    "children": [
      { "name": "Player", "scene": "player.scene", "properties": { "x": 64, "y": 120 } },
      { "name": "Ground", "type": "TileMap", "properties": { "tileset": "tiles.tileset", "cells": { "...": "..." } } },
      { "name": "Camera", "type": "Camera2D", "script": "camera.lua" }
    ]
  }
}
```

Property names are the Lua field names. Defaults are left out, so files
stay small and diff well.

### Node types

All node types, their properties (type, default, range, one-line
description) and their methods are defined once in
`love/src/modules/scene/nodes.json`, which the runtime, the inspector,
code completion and the docs all read.

| Group | Nodes |
| --- | --- |
| Basic | `Node` (groups others, runs a script), `Timer` |
| 2D | `Node2D`, `Sprite2D` (an image or an animated sprite sheet), `Shape2D` (a rectangle, circle, polygon or line to draw), `Text2D`, `TileMap`, `Camera2D`, `Particles2D` |
| 2D physics | `CharacterBody2D`, `StaticBody2D`, `Area2D`, `CollisionShape2D`; with the physics2d module: `RigidBody2D`, `Joint2D` |
| 3D | `Node3D`, `MeshInstance3D` (a box, sphere, cylinder, capsule or plane), `Model3D` (a glTF/GLB file), `Camera3D`, `DirectionalLight3D`, `PointLight3D`, `SpotLight3D`, `Environment3D` (sky, ambient light, fog), `Sprite3D` |
| 3D physics (physics3d) | `CharacterBody3D`, `RigidBody3D`, `StaticBody3D`, `Area3D`, `CollisionShape3D` |
| UI (drawn on screen, not in the world) | `Label`, `Button`, `Panel`, `ImageRect`, `ProgressBar` |
| Sound | `AudioPlayer`, `AudioPlayer3D` |
| Behaviors (move their parent) | `Platformer`, `TopDown`, `FirstPerson`, `Follow`, `Mover`, `Spin`, `Draggable` |

Behaviors are nodes because the model is one job per node: a
`CharacterBody2D` with a `Platformer` child runs and jumps, and removing the
child removes the ability. Their properties (speed, jump height, keys) are
in the inspector like any other node's.

### Scripts

```lua
-- player.lua, attached to a CharacterBody2D
local Player = {}

Player.speed = 140        -- script variables: shown in the inspector,
Player.jumpHeight = 64    -- and can be changed per node

function Player:ready()
  self.coins = 0
end

function Player:update(dt)
  self.vx = smitten.input.axis("left", "right") * self.speed
  if self:isOnFloor() and smitten.input.pressed("jump") then
    self.vy = -math.sqrt(2 * self.gravity * self.jumpHeight)
  end
  self:moveAndSlide()
end

function Player:entered(area)          -- an Area2D touched this body
  if area:inGroup("coins") then
    self.coins += 1
    area:destroy()
  end
end

return Player
```

- A script is a table of functions; `self` is the node. Fields read through
  to the node's properties and methods (`self.x`, `self:isOnFloor()`).
- **Callbacks**: `ready()`, `update(dt)`, `physicsUpdate(dt)` (fixed 60 Hz),
  `draw()` (2D, on top of the node), `removed()`, and events named after
  what happened: `entered(other)` / `exited(other)` (areas and bodies),
  `collided(other)` (bodies), `pressed()` (buttons), `finished()`
  (animations, sounds, timers, tweens), `timeout()` (timers).
- **Listening from elsewhere**: `node:on("pressed", fn)`, which returns a
  handle with `:off()`.
- **Script variables**: top-level fields with a number, string, boolean or
  color value are shown in the inspector and can be overridden per node.
  Names starting with `_` are hidden.
- **Tree**: `self.parent`, `self.children`, `self:find("Sword")` (a name or
  a path like `"UI/Score"`), `self:add(node)`, `self:destroy()`,
  `self:addToGroup("enemies")`, `smitten.scene.group("enemies")`.
- **Scenes**: `smitten.scene.change("level2.scene")`,
  `smitten.scene.reload()`, `smitten.scene.current` (the root node).

## 5. 2D, and no retro defaults

- Coordinates in pixels, y down, rotation in radians in code and degrees in
  the inspector.
- **Display** (Project settings): a game resolution (default 1280×720) and
  how it fits the window: *Fit* (letterbox, the default), *Expand*
  (show more), *Stretch*, or *Pixel perfect* (whole-number scaling).
- **Texture filter**: *Smooth* by default, or *Pixel*.
- **Pixel art** is a template and one switch (320×180, Pixel perfect, Pixel
  filter), not the engine's identity. The 5×7 pixel font stays as a font
  you can pick; the default font is LÖVE's.
- Draw order: tree order, then `z` (an integer) for 2D; UI nodes always on
  top, in screen space.

## 6. 3D

- Units in meters, y up, right-handed, like glTF and Godot.
- A forward renderer on LÖVE 12's own graphics (depth buffers, meshes,
  shaders, `setProjection`): a standard material (color, texture,
  roughness, metallic, emission, transparency, unshaded), directional
  lights with shadows, point and spot lights, sky color or gradient,
  ambient light and fog.
- `MeshInstance3D` draws built-in shapes, so a 3D game can start with no
  art. `Model3D` draws a glTF/GLB file with its own node hierarchy and
  materials.
- `smitten.graphics3d` is the low-level API for code-first games: cameras,
  meshes, models, lights and `draw` calls without nodes.

## 7. Physics

| | Module | Bodies |
| --- | --- | --- |
| 2D collisions | core | `CharacterBody2D` (`moveAndSlide`, `isOnFloor`), `StaticBody2D` (moving ones carry characters), `Area2D`, `TileMap` tiles marked solid or one-way; shapes are axis-aligned rectangles and circles |
| 2D rigid bodies | physics2d (Box2D) | `RigidBody2D`, `Joint2D`; static bodies and tiles are mirrored into Box2D so rigid bodies land on them |
| 3D | physics3d (Jolt) | `CharacterBody3D` (Jolt's virtual character), `RigidBody3D`, `StaticBody3D`, `Area3D`; shapes are boxes, spheres, capsules, cylinders and meshes from models |

Collision layers and masks work the same in 2D and 3D: a body is on some
layers and collides with the bodies on the layers in its mask.

## 8. Editor

### Rules

1. **Nothing waits for you to make something.** Every workspace opens
   ready to use: Paint opens on a blank canvas, Sound on a new effect, the
   scene view on the project's main scene. New work is saved to a sensible
   name on the first save, which can be changed later.
2. **One place for each thing.** The Scene panel shows structure, the
   Inspector shows the selection's properties, Files shows everything on
   disk, Output shows messages. Nothing is shown in two places.
3. **Everything is for a reason.** A panel that doesn't apply to the
   current workspace is hidden there by default, not left empty.
4. **The layout is yours.** Panels dock left, right or bottom; drag a
   panel's tab to move it; hide or show any panel from the View menu; each
   workspace remembers its own layout; View › Reset layout puts it back.
5. **Explain in place.** Every node type, property and setting has a one-
   line description in the UI (Add node dialog, inspector tooltips), with a
   link to the docs. Empty states say what to do next.
6. **Standard conventions.** Menus, tabs, right-click menus, drag and drop,
   Ctrl+S / Z / Shift+Z / D, Delete, F5 Play, F6 Play this scene, F8 Stop,
   Ctrl+K command palette.
7. **Neutral looks.** Modern, minimal, flat; one accent color; pink only in
   the logo. The editor is not themed after any game style.

### Layout

```
┌ Smitten  Project Edit View Help ─── [Scene] Script  Paint  Sound  Music ─── ▶ Play  ▶ Scene  ■ ┐
├──────────────┬─────────────────────────────────────────────────────────┬─────────────────────┤
│ Scene        │ level1.scene ×  player.scene ×                    2D 3D │ Inspector           │
│ ▾ Level1     │ ┌ Select Move Rotate Scale │ Snap  Grid ──────────────┐ │ Player              │
│   ▸ Player   │ │                                                     │ │ CharacterBody2D  ?  │
│   ▸ Coins    │ │                  viewport                           │ │ ▾ Transform         │
│     Ground   │ │                                                     │ │   x 64   y 120      │
│     Camera   │ │                                                     │ │ ▾ Script variables  │
├──────────────┤ └─────────────────────────────────────────────────────┘ │   speed 140         │
│ Files        ├─────────────────────────────────────────────────────────┤                     │
│ ▸ scenes     │ Output                                                  │                     │
│ ▸ art        │ > Game started                                          │                     │
└──────────────┴─────────────────────────────────────────────────────────┴─────────────────────┘
```

- **Workspaces** (top center): *Scene* (2D or 3D viewport, picked from the
  scene's root and switchable), *Script*, *Paint*, *Sound*, *Music*. Each
  has its own document tabs.
- **Panels**: Scene, Files, Inspector, Output, and panels that belong to a
  selection (the TileMap panel opens below the viewport while a `TileMap` is
  selected).
- **Add node** (Ctrl+A or the + in the Scene panel): a searchable list
  grouped as in section 4, each entry with an icon and a one-line
  description, and the full description of the highlighted one.
- **2D viewport**: pan, zoom, grid and snapping; select, move, rotate and
  scale handles; drag an image from Files to make a `Sprite2D`, a scene to
  make an instance, a sound to make an `AudioPlayer`; paint tiles when a
  `TileMap` is selected.
- **3D viewport**: orbit, pan and fly cameras; grid; move/rotate/scale
  handles on each axis; perspective and orthographic; drag a model from
  Files to make a `Model3D`.
- **Inspector**: properties grouped by node type, typed editors (numbers
  you can drag, vectors, colors, asset pickers, dropdowns, toggles), a
  reset arrow on changed properties, script variables, and the node type's
  description with a docs link.
- **Undo and redo** cover every edit in every workspace.
- **Project settings**: name, main scene, display, input actions, modules.
- **Export**: web zip (itch.io ready) or single HTML file, with the module
  list and the download size.

## 9. Language: Luau-like syntax, native to the VM

Smitten's Lua is Lua 5.1 with LuaJIT's extensions plus Luau-style syntax
in the parser itself, compiled to the bytecode Lua 5.1 already has: no new
opcodes, no transpiler, so the JIT, debug hooks, coroutines and green
threads work unchanged, and line numbers are the source's own.

| Feature | Example |
| --- | --- |
| Compound assignment | `score += 10`, `name ..= "!"`, also `-= *= /= %= ^=`; `t[f()] += 1` calls `f` once |
| `continue` | `for i = 1, n do if skip(i) then continue end end` (a contextual keyword; `goto continue` still works) |
| String interpolation | `` `HP: {hp}/{maxHp}` `` |
| If-expressions | `local speed = if running then 200 else 100` |

Later: Luau type annotations, parsed and discarded, then type checking in
the editor.

The JIT speculates on types seen at run time (numbers in loops, field reads,
`__index` chains) and falls back to the interpreter when a guess is wrong;
the README has its measurements.

## 10. Storage, sharing and export

- Projects live in the browser's IndexedDB (database `smitten`); settings
  use `smitten-editor.*` keys; game saves have their own IDBFS mount. The
  editor asks for persistent storage and offers zip backups.
- Sharing: share links for small projects (no server), and web export for
  itch.io. A hosted gallery is a later decision (accounts and moderation
  for a teenage audience).
- Export: a web zip or a single HTML file containing only the modules the
  game uses (section 3); a project zip; `.love` for games that use only
  LÖVE's API and plain Lua.
- Its own domain; `serve.py` uses port 8766 locally.

## 11. Repository layout

```
smitten/
  DESIGN.md, README.md, build.py, serve.py, package.py
  love/                          the engine (a LÖVE 12 fork)
    src/modules/love/            boot, main loop, the smitten/love table
    src/modules/scene/           scene tree, 2D nodes, collisions, nodes.json
    src/modules/input/, tween/   input actions, tweens and timers
    src/modules/graphics3d/      3D renderer and glTF (the 3d module)
    src/modules/physics3d/       Jolt bindings (the physics3d module)
    src/modules/synth/           synthesizer (the synth module)
  deps/lua-5.1.5/                Lua VM, Smitten syntax, the JIT
  deps/jolt/                     Jolt Physics
  web/native/                    web entry point, module loader
  web/player/                    the player that runs exported games
  web/editor/                    the editor
  web/examples/                  examples and templates
  tools/                         tests and benchmarks
```

Smitten started from Cupid's code (the LÖVE web port, the JIT and its
editor), imported with its history. Cupid stays a separate product and is
not part of Smitten.

## 12. What's built (2026-11-03)

Everything above, in one pass. Where each part is and how it's tested:

| Part | Where | Tests |
| --- | --- | --- |
| One engine table, Smitten's modules loaded on first use | `love.cpp`, `boot.lua`, `love/src/modules/engine/` | `tools/scene-tests` |
| Optional side modules and the player's module loading | `build.py`, `love.cpp`, `web/player/player.js`, `package.py` | the build checks every module links; `tools/scene-tests/rigid`, `world3d` |
| Scene tree, 2D nodes, collisions, tile maps, UI, audio, behaviors | `love/src/modules/scene/` | `tools/scene-tests/smoke` |
| Box2D rigid bodies and joints | `scene/rigid2d.lua` | `tools/scene-tests/rigid` |
| 3D renderer and glTF | `love/src/modules/graphics3d/` | `tools/graphics3d` (91 checks) |
| Jolt 3D physics | `love/src/modules/physics3d/`, `deps/jolt/` | `tools/physics3d` (119 checks) |
| 3D nodes and physics nodes | `scene/nodes3d.lua`, `scene/physics3d.lua` | `tools/scene-tests/world3d` |
| Editor core: schema, scene documents, modules, templates | `web/editor/core/` | `tools/editor-tests` (1083 checks) |
| Editor shell, panels, workspaces, dialogs | `web/editor/shell/`, `panels/`, `workspaces/`, `dialogs/` | in the browser |
| 2D and 3D views, tile painting | `web/editor/workspaces/scene/` | their harness pages |
| Image editor (any size, smooth or pixel brushes) | `web/editor/tools/sprite/` | its harness page |

### Next

- Triangle-mesh collision from glTF models (3D bodies use the model's
  bounding box for now); joints in 3D; shadows from point and spot lights.
- Rotated 2D collision shapes and capsules; slopes in tile maps.
- Skinned and animated glTF models; an animation timeline for any property.
- The editor running scripts in the viewport (tool scripts), and inspecting
  the running game's tree (Godot's "Remote" view).
- Hosted sharing and a gallery (accounts and moderation for a teenage
  audience), desktop export.
