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
| `sfx(name, volume, pitch)` | Plays a sound once. sfx("coin") finds coin.sfx (or .wav, .ogg...) anywhere in the project. You can also give options: sfx("hit", { volume = 0.5, pitch = 1.2 }). |
| `music(name, options)` | Plays music in a loop, in place of the current music: music("theme", { volume = 0.6, fade = 1 }). |
| `stopMusic(fade)` | Stops the music. If you give fade, the music fades out over fade seconds. |
| `pauseMusic()` | Pauses the music. |
| `resumeMusic()` | Continues the music. |
| `masterVolume(volume)` | Sets the volume of every sound, 0 to 1. masterVolume() returns the current value. |
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
| `autoplay` | bool | false | When this is on, the sound plays when the scene starts. |
| `loop` | bool | false | When this is on, the sound starts again at the end. |
| `volume` | number | 1 | The loudness, from 0 to 1. |
| `pitch` | number | 1 | 1 is normal, 2 is one octave higher. |

| Method | |
| --- | --- |
| `play()` | Plays the sound and returns its Source (see smitten.audio). If you call it while the sound plays, another copy starts (not for .song files). |
| `stop()` | Stops every copy. |
| `pause()` | Pauses the sound. |
| `resume()` | Continues the sound after pause(). |
| `isPlaying()` | Returns true while the sound plays. |
| `fadeIn(seconds, volume?)` | Plays the sound from silence up to its volume property (or to the volume that you give) over some seconds. |
| `fadeOut(seconds)` | Makes the sound quieter until it is silent, then stops it. Then the volume property goes back to its old value. |
| `seek(seconds)` | Moves to a time in the sound. |
| `tell()` | Returns the current play position, in seconds. |
| `getDuration()` | Returns the length of the sound, in seconds. |

| Event (a function in its script) | |
| --- | --- |
| `function finished()` | The engine calls it when the sound reaches its end (not when it loops). |
<!-- end -->

## smitten.audio

<!-- module:audio -->
| Function | |
| --- | --- |
| `smitten.audio.sfx(name, volume?, pitch?)` | Plays a sound once by name or path: smitten.audio.sfx("coin", { volume = 0.5 }). |
| `smitten.audio.music(name, options?)` | Plays music in a loop, in place of the current music. options: volume, pitch, fade. |
| `smitten.audio.stopMusic(fade?)` | Stops the music. If you give fade, the music fades out over fade seconds. |
| `smitten.audio.pauseMusic()` | Pauses the music. |
| `smitten.audio.resumeMusic()` | Continues the music. |
| `smitten.audio.getMusic()` | Returns the Source that plays the music, or nil. |
<!-- end -->

`smitten.synth.sfx(path)` and `smitten.synth.song(path)` load `.sfx` and
`.song` files as objects you can play and stop yourself
([File formats](formats.md#sound-effects-in-code)).
