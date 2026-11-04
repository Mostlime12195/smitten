# Sound and music

Smitten plays `.wav`, `.ogg`, `.mp3` and `.flac` files, plus the sound
effects (`.sfx`) and songs (`.song`) you make in the editor's **Sound** and
**Music** workspaces. There are two ways to play them: from a script with
`sfx` and `music`, or with a **Sound** piece placed in a scene.

```lua
sfx("coin")                                -- finds coin.sfx (or coin.wav...) anywhere
sfx("hit", { volume = 0.5, pitch = 0.9 + rnd(0.2) })
music("theme")                             -- loops, and keeps playing between scenes
music("boss", { fade = 1 })                -- fades from the old music to this one
stopMusic(2)                               -- fades out over 2 seconds
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

Give a bare name like `"coin"` and Smitten finds the sound with that name
anywhere in your project. If several files share the name, `.sfx` wins.
A full path like `"sounds/coin.wav"` plays exactly that file.

A little random pitch (`pitch = 0.9 + rnd(0.2)`) keeps repeated sounds,
like footsteps or hits, from sounding mechanical. A pitch of 2 is an
octave higher.

## Music

`music(name)` loops a sound as background music, replacing whatever was
playing. Asking for the music that's already playing changes nothing, so
every level can safely call `music("theme")`. Music carries on across
scene changes, and isn't stopped by pausing or slowed by `timeScale`.

## The Sound piece

A Sound piece plays one file, chosen in the Inspector. It's useful for
sounds that belong to something in the level (a waterfall, an engine
hum), for sounds that should start with the scene (**autoplay**), and for
sounds a script controls in detail. Its `volume` and `pitch` can change
while it plays, so you can tween them. It stops when it leaves the scene.

```lua
function ready() fadeIn(2) end   -- an alarm that swells in
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
`.song` files as objects you can play and stop yourself
([File formats](formats.md#sound-effects-in-code)).
