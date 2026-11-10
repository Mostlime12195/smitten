# Sound and music

Smitten plays `.wav`, `.ogg`, `.mp3` and `.flac` files. It also plays the
sound effects (`.sfx`) and songs (`.song`) that you make in the **Sound**
and **Music** workspaces of the editor. There are two methods to play
them:

- from a script, with `sfx` and `music`.
- with a **Sound** piece in a scene.

```lua
sfx("coin")                                -- finds coin.sfx (or coin.wav...) in all the project
sfx("hit", { volume = 0.5, pitch = 0.9 + rnd(0.2) })
music("theme")                             -- plays again and again, also after the scene changes
music("boss", { fade = 1 })                -- fades from the old music to this music
stopMusic(2)                               -- fades out in 2 seconds
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

## Finding sounds

If you give only a name, for example `"coin"`, Smitten finds the sound with
that name in all of your project. If more than one file has the name,
Smitten uses the `.sfx` file. A full path, for example
`"sounds/coin.wav"`, plays only that file.

Some random pitch (`pitch = 0.9 + rnd(0.2)`) makes sounds that play many
times sound more natural, for example footsteps or hits. A pitch of 2 is
one octave higher.

## Music

`music(name)` plays a sound again and again as background music. It
replaces the music that played before. If you ask for the music that
plays now, nothing changes. Because of this, each level can safely call
`music("theme")`. Music continues when the scene changes. Pausing the game
does not stop the music, and `timeScale` does not make it slower.

## The Sound piece

A Sound piece plays one file. You choose the file in the Inspector. A
Sound piece is good for these sounds:

- sounds that belong to a thing in the level (for example, a waterfall or
  the hum of an engine).
- sounds that must start with the scene (**autoplay**).
- sounds that a script starts, stops and changes in detail.

Its `volume` and `pitch` can change while it plays. Because of this, you can tween
them. The Sound piece stops when it goes out of the scene.

```lua
function ready() fadeIn(2) end   -- an alarm that becomes louder
```

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
| `play()` | Plays it and returns its Source (see smitten.audio). Calling it while playing starts another copy (not for .song). |
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

## smitten.audio

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
`.song` files. They give objects that you can play and stop in your script
([File formats](formats.md#sound-effects-in-code)).
