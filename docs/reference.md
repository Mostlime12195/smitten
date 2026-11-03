# Smitten reference

The engine's API and file formats. Every piece is in
[pieces.md](pieces.md); the reasons behind them are in
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
  "modules": { "physics2d": "always" }
}
```

| Field | Meaning |
| --- | --- |
| `main` | The scene the game starts with. With a main scene, `main.lua` is optional |
| `display.width`, `height` | The resolution the game is designed for |
| `display.stretch` | `fit` (letterbox), `expand` (show more of the world), `stretch`, or `pixel` (whole-number scaling) |
| `display.filter` | `smooth` or `pixel` (nearest-neighbor for images and fonts) |
| `input` | Input actions on top of the defaults (`left`, `right`, `up`, `down`, `jump` (space), `fire`, `accept`, `cancel`, `pause`) |
| `modules` | Overrides for engine modules: `"always"` or `"never"`; others are worked out from the project |

A game with a `smitten.json` but no `main.lua` runs its main scene. A game
with a `main.lua` and no scenes runs as in LÖVE. Both together work too:
`smitten.update` and `smitten.draw` run alongside the scene, and
`smitten.draw` draws in game coordinates over the world, under the UI.

### Engine modules

| Module | Loaded when a game uses |
| --- | --- |
| `physics2d` | a Body whose motion is `physics`, a `Joint`, `smitten.physics` |
| `video` | `smitten.video` |
| `synth` | `.sfx` and `.song` files, `smitten.synth` |

Using a module that wasn't loaded raises: *This game uses physics, but the
'physics2d' module isn't included. Turn it on in Project settings >
Modules.*

## Scenes

A scene is a tree of pieces in a `.scene` file (JSON):

```json
{
  "format": "smitten.scene",
  "version": 2,
  "root": {
    "name": "Level", "type": "Group", "script": "scripts/level.lua",
    "children": [
      { "name": "Player", "scene": "scenes/player.scene", "properties": { "x": 120, "y": 540 } },
      { "name": "Ground", "type": "Tiles", "properties": { "tileset": "art/tiles.tileset",
        "cells": { "x": 0, "y": 10, "w": 4, "h": 1, "data": "3*4" } } },
      { "name": "Coin", "type": "Zone", "script": "scripts/pickup.lua", "tags": ["coin"] }
    ]
  }
}
```

- An entry has `name`, then `type` (a piece type) or `scene` (another scene
  placed here), and optionally `script`, `properties` (only values that
  differ from the defaults, plus script variables), `tags` and `children`.
- A placed scene's `properties` override its scene's root; its `children`
  are added to the ones its scene has.
- Paths are relative to the project's folder.
- Tiles `cells` are one rectangle of tile numbers, row by row; `-1` is
  empty and `n*k` repeats `n` `k` times.

### `smitten.scene`

| Function | |
| --- | --- |
| `go(path, ...)` | Goes to another scene at the end of the frame; extra values are kept in `smitten.scene.args` |
| `reload()` | Starts the running scene again from its file |
| `make(sceneOrType, properties?, script?)` | A piece from a scene file (`"scenes/coin.scene"`) or a type (`"Sprite"`), not yet in the scene |
| `spawn(sceneOrType, properties?, parent?)` | Like `make`, and adds it to the running scene (or to `parent`) |
| `tagged(tag)` | The pieces with a tag (a new list) |
| `first(tag)` | The first piece with a tag, or nil |
| `find(path)` | A piece of the running scene by path from the root |
| `screenToWorld(x, y)`, `worldToScreen(x, y)` | Between screen (game) coordinates and the scene's, through the camera |
| `setCurrent(root)` | Runs a piece built in code as the scene |
| `getDelta()` | The frame time in `update`, the fixed step in `physicsUpdate` |
| `current`, `path`, `args` | The root piece, its file, and `go`'s extra values |
| `paused` | While true, pieces don't update and physics stops (drawing goes on) |
| `showShapes` | Draw Body and Zone shapes while the game runs |

## Scripts

A script is a Lua file that returns a table; attach it to a piece in the
inspector (or with `"script"` in the scene file). `self` is the piece.

```lua
local Enemy = {}

Enemy.speed = 80          -- script variables: shown in the inspector,
Enemy.hurtsPlayer = true  -- changeable per piece

function Enemy:ready() end
function Enemy:update(dt) end
function Enemy:hit(other) end

return Enemy
```

- **Lifecycle**: `ready()` once when the piece and its children are in the
  scene (children first), `update(dt)` every frame (parents first),
  `physicsUpdate(dt)` 60 times a second, `draw()` in the piece's own
  coordinates on top of it, `removed()` when it leaves.
- **Events**, called by name when they happen: `hit(other)` (a Body bumped
  into something), `entered(other)` / `exited(other)` (Zones, and Bodies
  going in and out of them), `pressed()` (Buttons), `finished(...)`
  (animations, sounds), `tick()` (Timers). Any piece can `emit(name, ...)`
  its own.
- **Listening from elsewhere**: `piece:on("pressed", fn)` returns a handle
  with `:off()`.
- **Script variables**: top-level `Name.field = value` lines with a number,
  string, boolean or color (`{r, g, b, a}`) value; names starting with `_`
  are hidden.
- **Every piece** has `name`, `type`, `parent`, `children`, `script`, and
  `find(path)`, `findDeep(name)`, `findChildOfType(type)`, `add(piece)`,
  `spawn(sceneOrType, properties?)`, `remove()`, `destroy()`, `isA(type)`,
  `getPath()`, `tag(name)`, `untag(name)`, `hasTag(name)`,
  `on(event, fn)`, `emit(event, ...)`, `isAlive()`.

## Ready-made scripts

Attaching one in the editor copies it into the project's `scripts/` folder,
to change like any other script: `platformer.lua` (run and jump, for a
scripted Body), `topdown.lua`, `patrol.lua`, `chase.lua` (towards the first
piece with a tag), `fly.lua` (bullets), `pickup.lua` (for a Zone; tells the
scene `collected`), `spin.lua`, `bob.lua`, `drag.lua`.

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
Tweens and timers end when the scene changes; a tween of a piece ends when
the piece is destroyed.

## Assets: `smitten.assets`

Loads and caches files: `image(path)`, `sprite(path)`, `tileset(path)`,
`font(path, size)` (`""` for the default font, `"pixel"` for the built-in
pixel font), `audio(path)` (`:newSource()` per play), `scene(path)`,
`script(path)`, `readJSON(path)`, `load(path)` (by extension),
`clear(path?)`.

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
relative to the `.sprite` file. A `Sprite` whose `image` is a `.sprite`
plays its animations; the ready-made player scripts play `idle`, `run` or
`walk`, `jump` and `fall` when they exist (`sprite:hasAnimation(name)`).

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

`solid` tiles block Bodies, `oneWay` ones only from above (a Body with
`tiles` in its `passThrough` ignores them). Other settings are for scripts:
`body:touchingTile("damage")` returns the settings of a touching tile that
has one, and `tiles:tileInfo(tile)` returns any tile's.

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
