# Sound and music

Sounds are `.wav`, `.ogg`, `.mp3` and `.flac` files, or `.sfx` sound
effects and `.song` music made in the editor's Sound and Music workspaces.
Play them from a script with `sfx` and `music`, or with a Sound piece.

```lua
sfx("coin")                                  -- finds coin.sfx (or .wav, .ogg...) anywhere
sfx("hit", { volume = 0.5, pitch = 0.9 + rnd(0.2) })
music("theme")                               -- loops; keeps playing across scenes
music("boss", { fade = 1 })                  -- fades the old music out and this in
stopMusic(2)                                 -- fades out over 2 seconds
```

<!-- api:Sound -->
| Call | |
| --- | --- |
| `sfx(name, volume, pitch)` | Plays a sound once: sfx("coin") finds coin.sfx (or .wav, .ogg...) anywhere; sfx("hit", { volume = 0.5, pitch = 1.2 }). |
| `music(name, options)` | Plays music on a loop instead of the music playing: music("theme", { volume = 0.6, fade = 1 }). |
| `stopMusic(fade)` | Stops the music, fading out over fade seconds if given. |
| `pauseMusic()` | Pauses the music. |
| `resumeMusic()` | Continues the music. |
| `masterVolume(volume)` | Every sound's volume, 0 to 1; masterVolume() reads it. |
<!-- end -->

## Names and files

A bare name like `"coin"` finds the sound file with that name anywhere in
the project; when there are several, `.sfx` wins over `.wav`, `.ogg`,
`.mp3`, `.flac` and `.song`. A path (`"sounds/coin.wav"`) plays that file.

## Sound effects

`sfx(name, volume, pitch)` or `sfx(name, { volume, pitch })` plays a sound
once; copies overlap. It returns the LÖVE
[Source](https://love2d.org/wiki/Source) playing it, for anything else
(`:stop()`, `:setPosition()`...). Pitch 2 is an octave up.

## Music

`music(name, options)` plays a sound on a loop instead of whatever music is
playing. Options: `volume` (0 to 1), `pitch`, `fade` (seconds to fade the
new music in and the old out). Asking for the music that's already playing
keeps it playing (so every level can call `music("theme")`). Music isn't
part of a scene: it carries on when the scene changes, and isn't slowed by
`timeScale` or stopped by `pauseGame()`; pause it with `pauseMusic()`.

A `.song` loops as its file says (from its loop point).

## Volume

`masterVolume(0.5)` turns every sound down; `masterVolume()` reads it. For
separate music and effects volumes, keep them in variables (or
[saved](saving.md)) and pass them to `music` and `sfx`.

## The Sound piece

A Sound piece plays one sound file, set in the Inspector: good for
sounds that belong to something (an engine hum, a waterfall), sounds that
start with the scene (`autoplay`), and sounds a script controls.

```lua
-- An alarm: a Sound piece with loop on
function ready() fadeIn(2) end
function switchOff() fadeOut(0.5) end    -- elsewhere: Alarm:switchOff()
```

Changes to `volume` and `pitch` apply while it plays, so they can be
[tweened](scripts.md#waiting): `tween(Engine, 0.3, { pitch = 1.5 })`. It stops when it
leaves the scene.

<!-- piece:Sound -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `sound` | resource | "" | The sound file. |
| `autoplay` | bool | false | Play when the scene starts. |
| `loop` | bool | false | Start again at the end. |
| `volume` | number | 1 | Loudness, 0 to 1. |
| `pitch` | number | 1 | 1 is normal; 2 is an octave up. |

| Method | |
| --- | --- |
| `play()` | Plays the sound and returns the LÖVE Source playing it. Calling it again while it plays starts another copy (good for effects); a .song has one. |
| `stop()` | Stops every copy. |
| `pause()` | Pauses. |
| `resume()` | Continues after pause(). |
| `isPlaying()` | True while it's playing. |
| `fadeIn(seconds, volume?)` | Plays from silence up to its volume (or volume) over some seconds. |
| `fadeOut(seconds)` | Fades to silence, then stops; volume goes back to what it was. |
| `seek(seconds)` | Jumps to a time in the sound. |
| `tell()` | Where it's playing, in seconds. |
| `getDuration()` | How long the sound is, in seconds. |

| Event (a function in its script) | |
| --- | --- |
| `function finished()` | The sound reached its end (not when looping). |
<!-- end -->

## In code: smitten.audio

The same calls are in `smitten.audio` for code outside scripts
(`smitten.audio.sfx("coin")`), next to all of LÖVE's
[love.audio](https://love2d.org/wiki/love.audio):

<!-- module:audio -->
| Function | |
| --- | --- |
| `smitten.audio.sfx(name, volume?, pitch?)` | Plays a sound once by name or path: smitten.audio.sfx("coin", { volume = 0.5 }). |
| `smitten.audio.music(name, options?)` | Plays music on a loop instead of the music playing; options: volume, pitch, fade. |
| `smitten.audio.stopMusic(fade?)` | Stops the music, fading out over fade seconds if given. |
| `smitten.audio.pauseMusic()` | Pauses the music. |
| `smitten.audio.resumeMusic()` | Continues the music. |
| `smitten.audio.getMusic()` | The Source playing the music, or nil. |
<!-- end -->

`smitten.synth.sfx(path)` and `smitten.synth.song(path)` load `.sfx` and
`.song` files as objects with `:play()`, `:stop()` and more (see
[File formats](formats.md#sound-effects-in-code)).
