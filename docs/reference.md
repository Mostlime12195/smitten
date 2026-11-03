# Smitten reference

The engine's API and file formats. Every node type is in
[nodes.md](nodes.md); the reasons behind them are in
[../DESIGN.md](../DESIGN.md).

`smitten` is the engine table, and `love` is the same table: everything in
LÖVE 12's API is here as `smitten.graphics`, `smitten.audio`, ... (see
[love2d.org/wiki](https://love2d.org/wiki/Main_Page)). This page covers what
Smitten adds.

## Project

### `smitten.json`

```json
{
  "format": "smitten.project",
  "version": 2,
  "name": "My game",
  "main": "scenes/level.scene",
  "display": { "width": 1280, "height": 720, "stretch": "fit", "filter": "smooth", "background": [0.11, 0.12, 0.15, 1] },
  "input": { "dash": ["lshift", "pad:rightshoulder"] },
  "modules": { "physics3d": "always" }
}
```

| Field | Meaning |
| --- | --- |
| `main` | The scene the game starts with. With a main scene, `main.lua` is optional |
| `display.width`, `height` | The resolution the game is designed for |
| `display.stretch` | `fit` (letterbox), `expand` (show more of the world), `stretch`, or `pixel` (whole-number scaling) |
| `display.filter` | `smooth` or `pixel` (nearest-neighbor for images and fonts) |
| `input` | Input actions on top of the defaults (`left`, `right`, `up`, `down`, `jump`, `fire`, `accept`, `cancel`, `pause`) |
| `modules` | Overrides for engine modules: `"always"` or `"never"`; others are worked out from the project |

A game with a `smitten.json` but no `main.lua` runs its main scene. A game
with a `main.lua` and no scenes runs as in LÖVE. Both together work too:
`smitten.update` and `smitten.draw` run alongside the scene, and
`smitten.draw` draws in game coordinates over the world, under the UI.

### Engine modules

| Module | Loaded when a game uses |
| --- | --- |
| `physics2d` | `RigidBody2D`, `Joint2D`, `smitten.physics` |
| `3d` | any 3D node, `smitten.graphics3d` |
| `physics3d` | 3D bodies, areas and collision shapes, `FirstPerson`, `smitten.physics3d` |
| `video` | `smitten.video` |
| `synth` | `.sfx` and `.song` files, `smitten.synth` |

Using a module that wasn't loaded raises: *This game uses 3D physics, but
the 'physics3d' module isn't included. Turn it on in Project settings >
Modules.*

## Scenes

A scene is a tree of nodes in a `.scene` file (JSON):

```json
{
  "format": "smitten.scene",
  "version": 2,
  "root": {
    "name": "Level", "type": "Node2D", "script": "scripts/level.lua",
    "children": [
      { "name": "Player", "scene": "scenes/player.scene", "properties": { "x": 120, "y": 540 } },
      { "name": "Ground", "type": "TileMap", "properties": { "tileset": "art/tiles.tileset",
        "cells": { "x": 0, "y": 10, "w": 4, "h": 1, "data": "3*4" } } },
      { "name": "Coin", "type": "Area2D", "groups": ["coins"] }
    ]
  }
}
```

- An entry has `name`, then `type` (a node type) or `scene` (another scene
  placed here, an *instance*), and optionally `script`, `properties` (only
  values that differ from the defaults), `groups` and `children`.
- An instance's `properties` override its scene's root; its `children` are
  added to the ones its scene has.
- Paths are relative to the project's folder.
- TileMap `cells` are one rectangle of tile numbers, row by row; `-1` is
  empty and `n*k` repeats `n` `k` times.

### `smitten.scene`

| Function | |
| --- | --- |
| `change(path, ...)` | Goes to another scene at the end of the frame; extra values are kept in `smitten.scene.args` |
| `reload()` | Starts the running scene again from its file |
| `instance(path, properties?)` | A node made from a scene file; add it with `node:add(...)` |
| `create(type, properties?, script?)` | A node of a type; `script` is a table or a `.lua` path |
| `group(name)` | The nodes in a group (a new list) |
| `first(name)` | The first node in a group, or nil |
| `find(path)` | A node of the running scene by path from the root |
| `setCurrent(root)` | Runs a node built in code as the scene |
| `getDelta()` | The frame time in `update`, the fixed step in `physicsUpdate` |
| `raycast3d(x, y, z, dx, dy, dz, mask?)` | node, x, y, z, nx, ny, nz of the first 3D body hit |
| `current`, `path`, `args` | The root node, its file, and `change`'s extra values |
| `paused` | While true, nodes don't update and physics stops (drawing goes on) |
| `showCollisions` | Draw collision shapes while the game runs |

## Scripts

A script is a Lua file that returns a table; attach it to a node in the
inspector (or with `"script"` in the scene file). `self` is the node.

```lua
local Enemy = {}

Enemy.speed = 80          -- script variables: shown in the inspector,
Enemy.hurtsPlayer = true  -- changeable per node

function Enemy:ready() end
function Enemy:update(dt) end
function Enemy:collided(other) end

return Enemy
```

- **Lifecycle**: `ready()` once when the node and its children are in the
  scene (children first), `update(dt)` every frame (parents first),
  `physicsUpdate(dt)` 60 times a second, `draw()` (2D) in the node's own
  coordinates on top of it, `removed()` when it leaves.
- **Events**, called by name when they happen: `entered(other)`,
  `exited(other)`, `collided(other)`, `pressed()`, `finished(...)`,
  `timeout()`, `jumped()`, `landed()`, `dragStarted()`, `dragEnded()`. Any
  node can `emit(name, ...)` its own.
- **Listening from elsewhere**: `node:on("pressed", fn)` returns a handle with
  `:off()`.
- **Script variables**: top-level `Name.field = value` lines with a number,
  string, boolean or color (`{r, g, b, a}`) value; names starting with `_`
  are hidden.
- **Every node** has `name`, `type`, `parent`, `children`, `script`, and
  `find(path)`, `findDeep(name)`, `findChildOfType(type)`, `add(node)`,
  `remove()`, `destroy()`, `isA(type)`, `getPath()`, `addToGroup(name)`,
  `removeFromGroup(name)`, `inGroup(name)`, `on(event, fn)`,
  `emit(event, ...)`, `isInside()`.

## Input: `smitten.input`

| Function | |
| --- | --- |
| `pressed(action)` / `released(action)` | True on the frame the action went down / up |
| `down(action)` | True while held |
| `strength(action)` | 0 to 1 (sticks give values in between) |
| `axis(negative, positive)` | -1 to 1 |
| `vector(left, right, up, down)` | x, y, at most 1 long |
| `bind(action, inputs)`, `unbind(action)`, `bindings(action)`, `actions()` | Change actions while the game runs |

Inputs: keys (`"space"`, `"a"`, `"left"`), `"mouse:1"`, gamepad buttons
(`"pad:a"`, `"pad:dpleft"`), and stick or trigger halves (`"axis:leftx-"`,
`"axis:triggerright+"`).

LÖVE's modules gain:

| | |
| --- | --- |
| `smitten.keyboard.pressed(key)`, `released(key)` | This frame only |
| `smitten.mouse.pressed(button?)`, `released(button?)`, `down(button?)` | Button 1 by default; touches count as button 1 |
| `smitten.mouse.x`, `y` | The pointer in game coordinates |
| `smitten.mouse.worldX`, `worldY` | The pointer in the 2D scene (through the camera) |
| `smitten.mouse.getDelta()` | Movement this frame, also while captured (`setRelativeMode`) |
| `smitten.mouse.isOverUI()` | True over a button or panel |

## Time and tweens: `smitten.tween`, `smitten.timer`

```lua
smitten.tween(self, 0.4, { y = 40, scaleX = 2 }, "outBack")
smitten.tween.to(label, 1, { opacity = 0 }):after(function() label:destroy() end)
smitten.timer.after(2, function() spawnWave() end)
local blink = smitten.timer.every(0.5, function() light.visible = not light.visible end)
blink:cancel()
```

Easings: `linear`, `inQuad`, `outQuad`, `inOutQuad`, `inCubic`,
`outCubic`, `inOutCubic`, `inSine`, `outSine`, `inOutSine`, `inExpo`,
`outExpo`, `inBack`, `outBack`, `inOutBack`, `outBounce`, `outElastic`.
Tweens and timers end when the scene changes; a tween of a node ends when
the node is destroyed.

## Assets: `smitten.assets`

Loads and caches files: `image(path)`, `sprite(path)`, `tileset(path)`,
`font(path, size)` (`""` for the default font, `"pixel"` for the built-in
pixel font), `audio(path)` (`:newSource()` per play), `model(path)` (glTF,
3D games), `scene(path)`, `script(path)`, `readJSON(path)`, `load(path)`
(by extension), `clear(path?)`.

## Saving: `smitten.storage`

`save(key, value)`, `load(key, default)`, `remove(key)`, `keys()`. Values
are numbers, strings, booleans and tables of them, kept in the game's save
folder.

## Display: `smitten.display`

`width`, `height` (the game's resolution), `viewX`, `viewY`, `viewWidth`,
`viewHeight` (the visible part, in game coordinates; bigger than the
resolution in `expand` mode), `scale`, `toGame(x, y)`, `toWindow(x, y)`,
`getWindowRect()`.

## Helpers in `smitten.math`

`chance(p)`, `pick(list)`, `clamp(v, lo, hi)`, `lerp(a, b, t)`,
`approach(v, target, step)`, `sign(v)`, `round(v, step?)`,
`distance(x1, y1, x2, y2)`, `angle(x1, y1, x2, y2)`, `randomFloat(a, b)`,
next to LÖVE's `random`, `noise` and the rest.

## JSON: `smitten.json`

`decode(text)`, `encode(value, indent?)`, `null`.

## 3D: `smitten.graphics3d`

The renderer the 3D nodes use, for code-first games:

```lua
local g3d = smitten.graphics3d
local cam = g3d.newCamera{ fov = 70 }
cam:lookAt(0, 0, 0)
local box = g3d.newBox(1, 1, 1)
local red = g3d.newMaterial{ color = {0.9, 0.2, 0.2, 1}, roughness = 0.4 }
function smitten.draw()
  g3d.begin(cam, nil, { { type = "directional", dx = -0.5, dy = -1, dz = -0.3, shadows = true } })
  g3d.draw(box, g3d.mat4.fromTRS(nil, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1), red)
  g3d.finish()
end
```

`newCamera`, `newBox`, `newSphere`, `newCylinder`, `newCapsule`,
`newPlane`, `newMesh{positions, normals?, uvs?, colors?, indices?}`,
`newMaterial`, `newEnvironment`, `loadModel(path)`, `begin(camera,
environment?, lights)`, `draw(meshOrModel, matrix, material?)`, `finish()`,
`stats()`, and `mat4` and `quat` helpers (quaternions are passed as four
numbers).

## 3D physics: `smitten.physics3d`

Jolt, as used by the 3D physics nodes; documented in
`love/src/modules/physics3d/README.md` (`newWorld`, `newBody`,
`newCharacter`, shapes, raycasts and contact callbacks).

## Sprites

A `.sprite` file describes an image's frames and animations:

```json
{
  "format": "smitten.sprite",
  "version": 1,
  "image": "hero.png",
  "frameWidth": 32,
  "frameHeight": 32,
  "origin": [16, 32],
  "animations": {
    "idle": { "frames": [0, 1], "fps": 4, "loop": true },
    "run": { "frames": [2, 3, 4, 5], "fps": 12, "loop": true }
  }
}
```

Frames are numbered from 0, left to right and top to bottom. `image` is
relative to the `.sprite` file. A `Sprite2D` whose `image` is a `.sprite`
plays its animations; behaviors play `idle`, `run`/`walk`, `jump` and `fall`
when they exist.

## Tilesets

```json
{
  "format": "smitten.tileset",
  "version": 1,
  "image": "terrain.png",
  "tileWidth": 16,
  "tileHeight": 16,
  "tiles": { "0": { "solid": true }, "4": { "name": "spikes", "damage": 1 }, "7": { "solid": true, "oneWay": true } }
}
```

`solid` tiles block bodies, `oneWay` ones only from above. Other
properties are for scripts: `body:touchingTile("damage")` returns the
properties of a touching tile that has one, and `TileMap:getTileProperties`
returns any tile's.

## Sound effects

`sfx/jump.sfx`. Synth parameters in physical units; the synthesizer
renders 44100 Hz mono.

```json
{
  "format": "smitten.sfx",
  "version": 1,
  "wave": "square",
  "volume": 0.5,
  "attack": 0.0,
  "sustain": 0.08,
  "punch": 0.3,
  "decay": 0.25,
  "frequency": 440,
  "minFrequency": 30,
  "slide": 1.5,
  "deltaSlide": 0,
  "vibratoDepth": 0,
  "vibratoSpeed": 0,
  "arpeggio": 0,
  "arpeggioTime": 0,
  "duty": 0.5,
  "dutySweep": 0,
  "repeat": 0,
  "lowpass": 1,
  "highpass": 0,
  "bitcrush": 0
}
```

| Field | Range | Meaning |
| --- | --- | --- |
| `wave` | `square`, `sawtooth`, `triangle`, `sine`, `noise` | Oscillator |
| `volume` | 0–1 | Output level |
| `attack`, `sustain`, `decay` | seconds, ≥ 0 | Envelope: rise, hold, fall. Length = their sum |
| `punch` | 0–1 | Extra level at the start of the sustain, fading out over it |
| `frequency` | Hz, 20–8000 | Start pitch |
| `minFrequency` | Hz | The sound stops early when a downward slide reaches it |
| `slide` | octaves/second | Pitch change; negative falls |
| `deltaSlide` | octaves/second² | Change of `slide` |
| `vibratoDepth` | semitones | Vibrato amount |
| `vibratoSpeed` | Hz | Vibrato rate |
| `arpeggio` | semitones | Pitch jump at `arpeggioTime` |
| `arpeggioTime` | seconds; 0 = off | When the jump happens |
| `duty` | 0–1 | Square-wave pulse width |
| `dutySweep` | per second | Change of `duty` |
| `repeat` | seconds; 0 = off | Restart the pitch effects every so often |
| `lowpass` | 0–1; 1 = off | Low-pass cutoff (0 = darkest) |
| `highpass` | 0–1; 0 = off | High-pass cutoff |
| `bitcrush` | 0–1; 0 = off | Sample-rate and bit-depth reduction |

Missing fields take the values in the example above. The same parameters
always produce the same samples (`noise` uses a fixed seed).

### Lua

```lua
local jump = smitten.synth.sfx("sfx/jump")     -- cached; rendered once
jump:play()                              -- returns the love Source playing it (several can overlap)
jump:play({ volume = 0.5, pitch = 1.2 })
jump:stop()                              -- stops every copy
jump.soundData                           -- the rendered love SoundData
jump.duration                            -- seconds
```

## Songs

`music/theme.song`.

```json
{
  "format": "smitten.song",
  "version": 1,
  "bpm": 120,
  "stepsPerBeat": 4,
  "patternLength": 32,
  "loop": true,
  "loopStart": 0,
  "channels": [
    { "name": "Lead", "instrument": 0, "volume": 0.8 },
    { "name": "Bass", "instrument": 1, "volume": 0.8 },
    { "name": "Drums", "instrument": 2, "volume": 0.8 },
    { "name": "Pad", "instrument": 3, "volume": 0.6 }
  ],
  "instruments": [
    {
      "name": "Square lead", "type": "synth", "wave": "square", "volume": 0.5,
      "attack": 0.01, "decay": 0.1, "sustain": 0.6, "release": 0.1,
      "duty": 0.5, "vibratoDepth": 0, "vibratoSpeed": 5, "lowpass": 1
    },
    { "name": "Kick", "type": "sfx", "sfx": "../sfx/kick.sfx", "pitched": false }
  ],
  "patterns": [
    {
      "name": "Intro",
      "notes": [
        { "channel": 0, "step": 0, "length": 2, "note": 60, "volume": 1 }
      ]
    }
  ],
  "order": [0, 0, 1]
}
```

- Steps are `1 / stepsPerBeat` of a beat at `bpm`. A pattern is
  `patternLength` steps long. `order` lists patterns to play in sequence.
- A note plays on its channel with the channel's instrument. Notes on the
  same channel may overlap (chords). `note` is a MIDI number (60 = middle
  C, 261.63 Hz). `volume` 0–1, default 1.
- Synth instruments: `wave` as in sound effects, an ADSR envelope
  (`attack`, `decay`, `release` in seconds, `sustain` level 0–1),
  `duty`, vibrato, `lowpass`. The note sounds for `length` steps, then
  releases.
- Sound-effect instruments play an `.sfx` per note, whole (a note's
  `length` doesn't cut it); with `pitched: true` its `frequency` (and
  `minFrequency`) is shifted by the note's distance from 60. An optional
  `volume` (default 1) scales them.
- `loop`: whether playback loops; `loopStart` is the index in `order` it
  loops back to. When looping, notes still ringing at the end of the song
  ring on over the start of the next loop.
- Missing fields take these defaults: `bpm` 120, `stepsPerBeat` 4,
  `patternLength` 32, `loop` true, `loopStart` 0; a channel's `instrument`
  is its own index and `volume` 1; synth instruments' fields as in "Square
  lead" above; a note's `channel` 0, `step` 0, `length` 1, `note` 60,
  `volume` 1. Steps and lengths may be fractional.

### Lua

```lua
local theme = smitten.synth.song("music/theme")   -- cached; rendered once, on first use
theme:play()                                -- loops as the file says
theme:stop(); theme:pause(); theme:resume()
theme:setVolume(0.5)
theme:isPlaying()
theme.duration                              -- seconds, one pass through `order`
```

Songs are rendered to a buffer by the C++ synthesizer and played as an
ordinary LÖVE Source, so they keep playing in background tabs.

### Synthesizer

```lua
smitten.synth.renderSfx(params)            -- params: a decoded .sfx table -> SoundData
smitten.synth.renderSong(song, basePath)   -- a decoded .song table; basePath (the song's path or folder) resolves its sfx paths -> SoundData
```

SoundData is 44100 Hz, 16-bit, mono. `renderSong` renders one pass through
`order`, followed by whatever still rings.

## Editor tools

Each tool is an ES module in `web/editor/tools/<id>/index.js`, listed in
`web/editor/tools/index.js`, whose default export is:

```js
export default {
  id: 'sprite',
  label: 'Sprite editor',
  // Which files the tool opens (instead of the code editor or preview).
  match: (path) => /\.png$/i.test(path),
  // Entries for the "New" menu in the file panel.
  newAssets: [{
    label: 'Sprite',
    folder: 'sprites',              // suggested folder
    extension: '.png',              // the file the tool then opens
    files: (base) => ({             // base: chosen path without extension
      [`${base}.png`]: pngBytes,
      [`${base}.sprite`]: jsonText,
    }),
  }],
  // Create an instance for one open file.
  open(host) { return instance; },
};
```

`host` (one per opened file):

| Member | Meaning |
| --- | --- |
| `host.path` | The opened file |
| `host.read(path)` | A project file's contents (`string` for text, `Uint8Array` for binary), or `undefined` |
| `host.write(path, data)` | Promise; creates or replaces a project file |
| `host.exists(path)` | |
| `host.list()` | Every file path in the project |
| `host.setDirty(dirty)` | Marks the tab as having unsaved changes |
| `host.palette()` | The project palette (`['#rrggbb', ...]`) |
| `host.project()` | The parsed `smitten.json` (with defaults) |
| `host.synth()` | Promise of the synthesizer (below) |
| `host.toast(message, {type})` | `type`: `'info'`, `'success'`, `'error'` |
| `host.openFile(path)` | Open another file in a tab |
| `host.ui` | `ui.js`'s helpers (`h`, `icon`, `showMenu`, `promptDialog`, ...) |

`instance`:

| Member | Meaning |
| --- | --- |
| `element` | The tool's root element, shown in the editor area |
| `save()` | Promise; writes the tool's files with `host.write` |
| `focus()` | Optional |
| `show()` / `hide()` | Optional; called when its tab is selected or left |
| `reload(path)` | Optional; called with the path of any project file that changed outside the tool |
| `destroy()` | Called when the tab closes |
| `handleKey(event)` | Optional; return `true` if the tool used the key |

The editor saves dirty tools on Ctrl+S, before running the game, and on
close (after asking). Tools style themselves with the editor's CSS
variables (`editor.css`), so light and dark themes work.

### Synthesizer in the editor

`host.synth()` resolves to:

```js
synth.renderSfx(params)          // -> Float32Array, 44100 Hz mono
synth.renderSong(song, readSfx)  // readSfx(path as written in the song) -> params or null; -> Float32Array
synth.play(samples)              // plays through WebAudio; returns {stop()}
synth.sampleRate                 // 44100
```

It's the same C++ code as the engine's, compiled to `synth.mjs`, so
previews sound exactly like the game.
