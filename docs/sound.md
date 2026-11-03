# Sound and music

Plays `.wav`, `.ogg`, `.mp3` and `.flac` files, and `.sfx` and `.song`
files made in the Sound and Music workspaces.

```lua
sfx("coin")                              -- coin.sfx, coin.wav, ... anywhere
sfx("hit", { volume = 0.5, pitch = 0.9 + rnd(0.2) })
music("theme")                           -- loops across scenes
music("boss", { fade = 1 })              -- crossfades
stopMusic(2)
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

A bare name finds the file anywhere in the project; `.sfx` wins over other
types. A path plays that file.

`sfx` returns the LÖVE [Source](https://love2d.org/wiki/Source). Pitch 2 is
an octave up.

`music` with the music already playing keeps it playing. Music continues
across scenes and isn't affected by `pauseGame()` or `timeScale()`.

## The Sound piece

Plays one file, set in the Inspector. `volume` and `pitch` apply while
playing, so they can be tweened. It stops when it leaves the scene.

```lua
function ready() fadeIn(2) end
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
| `play()` | Plays and returns the LÖVE Source. Calling it while playing starts another copy (not for .song). |
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
`.song` files ([File formats](formats.md#sound-effects-in-code)).
