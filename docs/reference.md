# Smitten reference

The file formats Smitten's tools write, the `smitten` Lua module that games
use to load them, and the interface the editor's tools implement.

All JSON files have `format` and `version` fields. Readers reject files with
a newer `version` than they know, with a message saying so. Paths inside a
file are relative to that file's folder.

## Project

### `smitten.json`

At the project root. Optional; defaults apply when it's missing.

```json
{
  "format": "smitten.project",
  "version": 1,
  "engine": "0.1.0",
  "resolution": [320, 180],
  "palette": ["#1a1c2c", "#5d275d", "..."]
}
```

- `resolution`: the game's logical size, used by `smitten.screen` and as
  the default canvas size for new maps.
- `palette`: colors offered first in the pixel and map editors. Free colors
  are always allowed.

## Sprites

`sprites/hero.png` plus `sprites/hero.sprite.json`. A PNG without a
`.sprite.json` is a sprite with one frame the size of the image.

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

- Frames are numbered from 0, left to right, then top to bottom, in a sheet
  of `frameWidth` × `frameHeight` cells. The sheet's size is a multiple of
  the frame size.
- `origin`: the point drawn at (x, y), in pixels from the frame's top left.
  Default `[0, 0]`.
- `animations`: optional. `loop` defaults to `true`, `fps` to 8.

### Lua

```lua
local hero = smitten.sprite("sprites/hero")   -- or "sprites/hero.png"; cached
hero.image          -- the love Image (nearest filtering)
hero.width, hero.height   -- frame size
hero.frameCount
hero.originX, hero.originY
hero:quad(frame)    -- love Quad for a frame (0-based)
hero:draw(frame, x, y, r, sx, sy)   -- same transform arguments as love.graphics.draw
hero:has(name)      -- whether an animation exists

local anim = hero:animation("run")    -- new, independent playback state
anim:update(dt)
anim:draw(x, y, r, sx, sy)            -- negative sx flips around the origin
anim:play("idle")                     -- switch animation (no-op if already playing it)
anim:play("idle", true)               -- restart even if already playing
anim:pause(); anim:resume()
anim.name           -- current animation
anim.frame          -- current frame number in the sheet
anim.finished       -- true once a non-looping animation reached its end
```

Errors name the file and what's wrong: missing file, unknown animation
(listing the ones that exist), frame out of range.

## Screen

```lua
smitten.screen.setup(320, 180)   -- or no arguments: smitten.json's resolution
function love.draw()
  smitten.screen.begin()         -- draw at 320×180 from here
  ...
  smitten.screen.finish()        -- scaled by the largest whole number that fits, centered, letterboxed
end
smitten.screen.toGame(mx, my)    -- window coordinates -> game coordinates
smitten.screen.width, smitten.screen.height, smitten.screen.scale
```

## Tilesets

`tiles/terrain.png` plus `tiles/terrain.tileset.json`.

```json
{
  "format": "smitten.tileset",
  "version": 1,
  "image": "terrain.png",
  "tileWidth": 16,
  "tileHeight": 16,
  "tiles": {
    "0": { "solid": true },
    "5": { "solid": true, "name": "spikes", "damage": 1 }
  }
}
```

Tile numbers start at 0 and go left to right, then top to bottom.
`tiles` holds any properties per tile; `solid` is used by `smitten.collide`.

## Maps

`maps/level1.map.json`.

```json
{
  "format": "smitten.map",
  "version": 1,
  "width": 40,
  "height": 12,
  "tileWidth": 16,
  "tileHeight": 16,
  "tilesets": ["../tiles/terrain.tileset.json"],
  "background": "#1a1c2c",
  "layers": [
    {
      "name": "ground",
      "type": "tiles",
      "visible": true,
      "data": [-1, -1, 0, 1, "... width × height entries, row by row"]
    },
    {
      "name": "objects",
      "type": "objects",
      "visible": true,
      "objects": [
        { "id": 1, "type": "player", "x": 32, "y": 160, "width": 16, "height": 16, "properties": {} }
      ]
    }
  ],
  "properties": {}
}
```

- Tile layer `data`: one number per cell, row by row; `-1` is empty. With
  several tilesets, tile numbers continue across them in order (the first
  tileset's tiles start at 0, the next one's after the last tile of the
  first, and so on).
- Object `x`, `y`: pixels from the map's top left. `type` names the entity
  class `spawn` creates.

### Lua

```lua
local level = smitten.map("maps/level1")       -- cached; .map.json may be left out
level.width, level.height          -- in tiles
level.tileWidth, level.tileHeight
level.pixelWidth, level.pixelHeight
level:draw()                       -- every visible tile layer, in order
level:drawLayer("ground")
level:getTile("ground", tx, ty)    -- tile number or -1 (tile coordinates from 0)
level:setTile("ground", tx, ty, tile)
level:tileProperties(tile)         -- that tile's properties table (empty table if none)
level:isSolid(px, py)              -- any tile layer has a solid tile at pixel (px, py)
level:objects("player")            -- list of objects (all if no type given)
level:spawn(classes)               -- for each object whose type is in classes:
                                   --   classes[type].new(object) or classes[type](object)
                                   -- returns the list of created entities
level.properties

local tiles = smitten.tileset("tiles/terrain")  -- cached
tiles.image, tiles.tileWidth, tiles.tileHeight, tiles.count
tiles:quad(tile)
tiles:properties(tile)
```

`draw` draws in map pixels from (0, 0); use `love.graphics.translate` for
the camera. Large maps are split into chunks of `SpriteBatch`es, and only
chunks on screen are drawn.

## Collision

```lua
smitten.collide.overlaps(a, b)    -- a and b have x, y, width, height
-- Move a box through a map's solid tiles, one axis at a time.
local hit = smitten.collide.move(level, box, dx, dy)
-- box.x, box.y are updated. hit.x / hit.y: true if blocked on that axis;
-- hit.ground: true if blocked while moving down; hit.ceiling: blocked while moving up.
```

## Scenes

```lua
local Title = {}
function Title:enter(...) end        -- all optional
function Title:leave() end
function Title:update(dt) end
function Title:draw() end
function Title:keypressed(key) end   -- any love callback name works

smitten.scene.switch(Title, ...)     -- replace the current scene
smitten.scene.push(Pause, ...)       -- put a scene on top (the one below stops updating,
                                     -- and draws only if the top scene has `transparent = true`)
smitten.scene.pop(...)               -- back to the scene below; its resume(...) is called
smitten.scene.current()
```

Once a scene is active, the love callbacks the game defines still run, and
the current scene's method of the same name runs after them. Games that
define no `love.update`/`love.draw` can rely on scenes alone.

## Input

```lua
smitten.input.bind("jump", { "space", "up", "w", "pad:a" })
smitten.input.bind("left", { "left", "a", "pad:dpleft", "axis:leftx-" })
smitten.input.down("jump")       -- held now
smitten.input.pressed("jump")    -- went down since the previous frame
smitten.input.released("jump")
```

Keys use `love.keyboard` key constants; `pad:<button>` uses
`love.joystick` gamepad buttons on any connected gamepad;
`axis:<axis>+` / `axis:<axis>-` count a gamepad axis beyond 0.5 in that
direction. `pressed` and `released` are reset each frame automatically.

## Sound effects

`sfx/jump.sfx.json`. Synth parameters in physical units; the synthesizer
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
local jump = smitten.sfx("sfx/jump")     -- cached; rendered once
jump:play()                              -- returns the love Source playing it (several can overlap)
jump:play({ volume = 0.5, pitch = 1.2 })
jump:stop()                              -- stops every copy
jump.soundData                           -- the rendered love SoundData
jump.duration                            -- seconds
```

## Songs

`music/theme.song.json`.

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
    { "name": "Kick", "type": "sfx", "sfx": "../sfx/kick.sfx.json", "pitched": false }
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
- Sound-effect instruments play an `.sfx.json` per note, whole (a note's
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
local theme = smitten.song("music/theme")   -- cached; rendered once, on first use
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
smitten.synth.renderSfx(params)            -- params: a decoded .sfx.json table -> SoundData
smitten.synth.renderSong(song, basePath)   -- a decoded .song.json table; basePath (the song's path or folder) resolves its sfx paths -> SoundData
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
      [`${base}.sprite.json`]: jsonText,
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
| `reload()` | Optional; called when one of its files changed outside the tool |
| `destroy()` | Called when the tab closes |
| `handleKey(event)` | Optional; return `true` if the tool used the key |

The editor saves dirty tools on Ctrl+S, before running the game, and on
close (after asking). Tools style themselves with the editor's CSS
variables (`editor.css`), so light and dark themes work.

### Synthesizer in the editor

`host.synth()` resolves to:

```js
synth.renderSfx(params)          // -> Float32Array, 44100 Hz mono
synth.renderSong(song, readSfx)  // readSfx(path) -> params; -> Float32Array
synth.play(samples)              // plays through WebAudio; returns {stop()}
synth.sampleRate                 // 44100
```

It's the same C++ code as the engine's, compiled to `synth.mjs`, so
previews sound exactly like the game.
