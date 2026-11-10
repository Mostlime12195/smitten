# File formats

All project files are JSON, except scripts and images. Paths are
relative to the project folder, unless this page gives a different rule.
[Project settings](settings.md) tells about `smitten.json`.

## Scenes

A scene is a tree of pieces in a `.scene` file (JSON):

```json
{
  "format": "smitten.scene",
  "version": 3,
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

- Each entry has a `name`. Then it has a `type` (a piece type) or a
  `scene` (a different scene, placed here).
- An entry can also have `script`, `properties`, `tags` and `children`.
  `properties` has only the values that are not the defaults, and the
  script variables.
- The `properties` of a placed scene override the root of its scene. The
  engine adds its `children` to the children that its scene has.
- Paths are relative to the folder of the project.
- Angles are in degrees. Scenes with `"version": 2` have angles in
  radians. They also keep the `gravityScale` of a Body with the name
  `gravity`. These scenes still load, and the editor saves them as
  version 3. See [Older projects](older-projects.md).
- The `cells` of a Tiles piece are one rectangle of tile numbers, row by
  row. `-1` is an empty cell, and `n*k` is `n` repeated `k` times.
- The `animations` of an Animator are its animations: tracks of keys. See
  [The animations in the scene file](animation.md#the-animations-in-the-scene-file).

## Sprites

A `.sprite` file gives the frames and the animations of an image:

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

Frame numbers start at 0, and go from left to right and from top to
bottom. `image` is relative to the `.sprite` file. If the `image` of a
`Sprite` is a `.sprite` file, the Sprite plays its animations. The
ready-made player scripts play `idle`, `run` or `walk`, `jump` and `fall`,
if the file has them (`sprite:hasAnimation(name)`).

### Layers

A sprite that has layers in the sprite editor has one more field,
`layers`. It is optional.

```json
{
  "format": "smitten.sprite",
  "version": 1,
  "image": "hero.png",
  "frameWidth": 32,
  "frameHeight": 32,
  "layers": [
    { "name": "Body", "image": "data:image/png;base64,iVBORw0KGgo..." },
    { "name": "Shade", "opacity": 0.5, "image": "data:image/png;base64,iVBORw0KGgo..." },
    { "name": "Sketch", "hidden": true, "image": "data:image/png;base64,iVBORw0KGgo..." }
  ]
}
```

- The bottom layer is first.
- `image` of a layer is a PNG in a `data:` URL. It has the same size and
  the same grid of frames as the `image` of the sprite.
- `opacity` (0 to 1) and `hidden` are optional. The defaults are 1 and
  `false`.

The engine does not read `layers`. It draws the `image` of the sprite, which
the editor saves as the layers flattened (the layers that show, at their
opacity). Because of this, a sprite with layers works in all versions of
Smitten. The editor writes `layers` only when a sprite has more than one
layer, one hidden layer, or one layer that is not fully opaque.

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

`tiles` gives the tile properties of each tile, by tile number:

- `solid` tiles block Bodies.
- `oneWay` tiles block Bodies only from above.
- A Body with `tiles` in its `passThrough` goes through `solid` and
  `oneWay` tiles.
- Other tile properties are for scripts. `body:touchingTile("damage")`
  returns the tile properties of a touched tile that has `damage`.
  `tiles:tileInfo(tile)` returns the tile properties of a tile.

There are two more sections, which are optional.
[Tiles](tiles.md#terrains) tells about them:

```json
{
  "terrains": [
    { "name": "grass", "match": "all", "color": "#4caf50",
      "tiles": { "0": 0, "1": 28, "2": 124, "3": 112, "9": 255 } }
  ],
  "animations": {
    "8": { "frames": [8, 9, 10, 11], "fps": 6 },
    "12": { "frames": [12, 13], "durations": [0.8, 0.2], "randomStart": true }
  }
}
```

- `terrains` is a list. Each terrain has:
  - `name`.
  - `match`: `"all"` (sides and corners, the default), `"sides"` or
    `"corners"`.
  - `color`: the color of the terrain in the editor.
  - `tiles`: for each tile of the terrain, a number that tells where the
    terrain continues past that tile. The number is a sum of these values:
    up 1, up-right 2, right 4, down-right 8, down 16, down-left 32, left 64,
    up-left 128. Tiles with the same number are variants.

  If a tile is in two terrains, it is part of the first terrain only.
- `animations` gives a tile the tiles that it shows in turn (`frames`).
  It shows them at `fps` animation frames per second (8 if there is no
  `fps`), or for `durations` seconds each. With `randomStart`, each cell
  starts at a different point of the loop.

## Sound effects

For example, `sfx/jump.sfx`. The synth parameters are in physical
units. The synthesizer makes sound at 44100 Hz, mono.

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
| `attack`, `sustain`, `decay` | seconds, ≥ 0 | Envelope: rise, hold, fall. The length of the sound is their sum |
| `punch` | 0–1 | More level at the start of the sustain. It decreases during the sustain |
| `frequency` | Hz, 20–8000 | Start pitch |
| `minFrequency` | Hz | When a slide down gets to this frequency, the sound stops |
| `slide` | octaves/second | Change of pitch. A negative value makes the pitch go down |
| `deltaSlide` | octaves/second² | Change of `slide` |
| `vibratoDepth` | semitones | Vibrato amount |
| `vibratoSpeed` | Hz | Vibrato rate |
| `arpeggio` | semitones | Pitch jump at `arpeggioTime` |
| `arpeggioTime` | seconds; 0 = off | When the jump happens |
| `duty` | 0–1 | Square-wave pulse width |
| `dutySweep` | per second | Change of `duty` |
| `repeat` | seconds; 0 = off | Starts the pitch effects again at this interval |
| `lowpass` | 0–1; 1 = off | Low-pass cutoff (0 = darkest) |
| `highpass` | 0–1; 0 = off | High-pass cutoff |
| `bitcrush` | 0–1; 0 = off | Sample-rate and bit-depth reduction |

If a field is not in the file, it has the value from the example above.
The same parameters always make the same samples (`noise` uses a fixed
seed).

### Sound effects in code

```lua
local jump = smitten.synth.sfx("sfx/jump")     -- kept in memory; made one time
jump:play()                              -- returns the sound that plays it (many can overlap)
jump:play({ volume = 0.5, pitch = 1.2 })
jump:stop()                              -- stops all copies
jump.soundData                           -- the samples
jump.duration                            -- seconds
```

## Songs

For example, `music/theme.song`.

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
    { "name": "Kick", "type": "sfx", "sfx": "../sfx/kick.sfx", "pitched": false },
    { "name": "Bap", "type": "sample", "sample": "../sounds/bap.wav", "baseNote": 60, "pitched": false }
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

- A step is `1 / stepsPerBeat` of a beat at `bpm`. A pattern has
  `patternLength` steps. `order` is the list of patterns to play, in
  sequence.
- A note plays on its channel, with the instrument of the channel. Notes
  on the same channel can overlap (chords). `note` is a MIDI number
  (60 = middle C, 261.63 Hz). `volume` is from 0 to 1, and its default is 1.
- Synth instruments have:
  - `wave`, as in sound effects.
  - An ADSR envelope: `attack`, `decay` and `release` in seconds, and the
    `sustain` level from 0 to 1.
  - `duty`, vibrato and `lowpass`.

  The note plays for `length` steps. Then it releases.
- Sound-effect instruments play an `.sfx` for each note, from start to
  end (the `length` of a note does not stop it). With `pitched: true`,
  the engine moves its `frequency` (and `minFrequency`) by the distance of
  the note from 60. An optional `volume` (default 1) scales them.
- Sample instruments (`"type": "sample"`) play a sound file of the
  project (`.wav`, `.ogg`, `.mp3` or `.flac`) for each note. `sample` is
  the path of the file, relative to the song. A note at `baseNote` (a MIDI
  number, default 60) plays the file as it is. Each semitone above the
  base note plays it faster and higher, and each semitone below plays it
  slower and lower. With `pitched: false`, every note plays the file as it
  is. With `playToEnd: true` (the default), each note plays all of the
  file. With `playToEnd: false`, the note releases at the end of its
  `length`. `pitched` is true if it is not in the file. The envelope,
  `volume`, vibrato and `lowpass` are as for synth instruments. Only
  the defaults are different: `volume` 1, `attack` 0, `decay` 0,
  `sustain` 1 and `release` 0.05. If `sample` is `""`, the instrument is silent. If the
  file does not exist, the song stops with an error that names the
  instrument. The engine reads at most 60 seconds of a file.
- `loop` tells whether the song plays again from `loopStart` when it gets
  to the end. `loopStart` is the index in `order` where the loop starts.
  When the song loops, notes that still sound at the end of the song
  continue over the start of the next loop.
- If a field is not in the file, it has its default:
  - `bpm` 120, `stepsPerBeat` 4, `patternLength` 32, `loop` true,
    `loopStart` 0.
  - For a channel: `instrument` is the index of the channel, and `volume`
    is 1.
  - For a synth instrument: the fields of "Square lead" above.
  - For a note: `channel` 0, `step` 0, `length` 1, `note` 60, `volume` 1.

  Steps and lengths can be fractions.

### Songs in code

```lua
local theme = smitten.synth.song("music/theme")   -- kept in memory; made one time, at first use
theme:play()                                -- loops if the file says so
theme:stop(); theme:pause(); theme:resume()
theme:setVolume(0.5)
theme:isPlaying()
theme.duration                              -- seconds, one pass through `order`
```

The C++ synthesizer makes the samples of a song into a buffer. The
engine plays them as it plays all other sounds. Because of this, songs
continue to play in background tabs.

### The synthesizer in code

```lua
smitten.synth.renderSfx(params)            -- params: a decoded .sfx table -> SoundData
smitten.synth.renderSong(song, basePath)   -- a decoded .song table; sfx and sample paths are relative to basePath (the song's path or folder) -> SoundData
```

SoundData is 44100 Hz, 16-bit, mono. `renderSong` makes the samples for
one pass through `order`. Then it adds the notes that still sound.
