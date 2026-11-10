# File formats

Project files other than scripts and pictures are JSON. Paths are relative
to the project folder unless noted. `smitten.json` is in
[Project settings](settings.md).

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

Two more sections are optional ([Tiles](tiles.md#terrains) explains them):

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

- `terrains` is a list. Each has a `name`, a `match` (`"all"`: sides and
  corners, the default; `"sides"`; `"corners"`), a `color` for the editor,
  and `tiles`: for each tile of the terrain, a number that says where the
  terrain carries on past that tile. Add up: up 1, up-right 2, right 4,
  down-right 8, down 16, down-left 32, left 64, up-left 128. Tiles with the
  same number are variants. A tile listed in two terrains belongs to the
  first.
- `animations` gives a tile the tiles it shows in turn (`frames`), at `fps`
  frames a second (8 if left out) or for `durations` seconds each;
  `randomStart` starts every cell at a different point of the loop.

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

### Sound effects in code

```lua
local jump = smitten.synth.sfx("sfx/jump")     -- cached; rendered once
jump:play()                              -- returns the sound playing it (several can overlap)
jump:play({ volume = 0.5, pitch = 1.2 })
jump:stop()                              -- stops every copy
jump.soundData                           -- the rendered samples
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

### Songs in code

```lua
local theme = smitten.synth.song("music/theme")   -- cached; rendered once, on first use
theme:play()                                -- loops as the file says
theme:stop(); theme:pause(); theme:resume()
theme:setVolume(0.5)
theme:isPlaying()
theme.duration                              -- seconds, one pass through `order`
```

Songs are rendered to a buffer by the C++ synthesizer and played like
any other sound, so they keep playing in background tabs.

### The synthesizer in code

```lua
smitten.synth.renderSfx(params)            -- params: a decoded .sfx table -> SoundData
smitten.synth.renderSong(song, basePath)   -- a decoded .song table; basePath (the song's path or folder) resolves its sfx paths -> SoundData
```

SoundData is 44100 Hz, 16-bit, mono. `renderSong` renders one pass through
`order`, followed by whatever still rings.
