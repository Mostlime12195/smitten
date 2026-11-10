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
| `sfx(name, volume, pitch)` | Plays a sound once. sfx("coin") finds coin.sfx (or .wav, .ogg...) anywhere in the project. You can also give options: sfx("hit", { volume = 0.5, pitch = 1.2 }). |
| `music(name, options)` | Plays music in a loop, in place of the current music: music("theme", { volume = 0.6, fade = 1 }). |
| `stopMusic(fade)` | Stops the music. If you give fade, the music fades out over fade seconds. |
| `pauseMusic()` | Pauses the music. |
| `resumeMusic()` | Continues the music. |
| `masterVolume(volume)` | Sets the volume of every sound, 0 to 1. masterVolume() returns the current value. |
<!-- end -->

## Finding sounds

If you give only a name, for example `"coin"`, Smitten finds the sound with
that name in all of your project. If more than one file has the name,
Smitten uses the `.sfx` file. A full path, for example
`"sounds/coin.wav"`, plays only that file.

Some random pitch (`pitch = 0.9 + rnd(0.2)`) makes sounds that play many
times sound more natural, for example footsteps or hits. A pitch of 2 is
one octave higher.

## Volume and pitch

Each call of `sfx` can have its own volume and pitch. Give them as
numbers, or in an options table:

```lua
sfx("ouch", 0.8)                                       -- volume 0.8
sfx("ouch", 0.8, 1.2)                                  -- volume 0.8, pitch 1.2
sfx("ouch", { pitch = 0.9 + rnd(0.3), volume = 0.8 })  -- options
```

- `volume` is from 0 to 1. The default is 1.
- `pitch` is 1 for the normal pitch. 2 is one octave higher and two
  times faster. 0.5 is one octave lower and two times slower. The default
  is 1. If the pitch is 0 or less, the sound plays at a pitch of 0.01.
- Volume and pitch work for all sound files and for `.sfx` files.
- If a value is not a number, `sfx` stops with an error that tells you
  which value is wrong.

This example plays a recorded "ouch" each time that something hurts the
player. Each "ouch" has a different pitch. Because of this, the sound
does not become boring.

```lua
-- scripts/player.lua
hp = 3

function hurt(amount)
  hp -= amount
  sfx("ouch", { pitch = 0.9 + rnd(0.3), volume = 0.8 })
end
```

## Record a sound

You can record a sound with your microphone in the editor. The editor
saves the recording as a WAV file in your project.

1. Open the **Sound** workspace.
2. Click **Record** in the list at the left.
3. If the browser asks, let it use the microphone.
4. Make the sound. The waveform shows the sound while you record.
5. Click **Stop**, or press Space.

You can also start a recording in two other ways:

- Click **+** at the right of the tabs. Then click **Record a sound**.
- In the **Files** panel, click **New**. Then click **Recording**.

After you stop, the editor puts the start marker and the end marker
around the loud part of the recording. The editor saves the recording as
`sounds/recording.wav`. Rename the file in the **Files** panel, for
example to `ouch.wav`. Then `sfx("ouch")` plays it.

- A recording can be 10 seconds long at most. At 10 seconds, the
  recording stops.
- The editor saves recordings as mono WAV files at 22050 Hz. A recording
  of 10 seconds is 441 KB. The engine keeps sound files of less than
  512 KB in memory. Because of this, a recording can play many times at
  the same time.

If the recording does not start, the editor shows a message:

- If the browser blocks the microphone, allow the microphone for the
  site in the address bar of the browser. Then click **Record** again.
- The browser lets only secure pages use the microphone: pages that
  start with `https://`, and `localhost`. If you open the editor with
  `http://` from a different computer, the **Record** button is off. Open
  the editor at its `https://` address.

## Change a sound file

The sound file editor opens all the `.wav` files of the project, for
example a file that you imported. To open a file, click it in the
**Files** panel.

- **Trim**: drag the start marker and the end marker on the waveform. You
  can also drag across the waveform to select a part. The arrow keys move
  the selected marker by 0.01 seconds (with Shift, by 0.1 seconds).
  **Fit to the sound** puts the markers around the loud part. **Use all**
  selects all of the sound.
- **Volume**: 100% is the sound as it is. **Normalize** makes the loudest
  part as loud as possible, but not louder than full volume. If the volume
  is too high, the parts that clip show in red on the waveform.
- **Speed**: 2× makes the sound two times shorter and one octave higher.
  0.5× makes the sound two times longer and one octave lower.
- To play the result, click the waveform or press Space.

The editor saves the result to the file automatically. While the file is
open, the editor keeps all of the original sound. Because of this, you
can make a trim wider again, or undo a change (Ctrl+Z). When you close the
tab, the parts that you trimmed are not in the file any more.

The editor saves WAV files with 16 bits for each sample. An imported file
keeps its sample rate and its channels (mono or stereo).

This example makes a short "bap" for a drum:

1. Record yourself when you say "bap".
2. Click **Fit to the sound**.
3. Drag the end marker to the left until the sound is short.
4. Click **Normalize**.
5. Rename `sounds/recording.wav` to `sounds/bap.wav`.

## Music

`music(name)` plays a sound again and again as background music. It
replaces the music that played before. If you ask for the music that
plays now, nothing changes. Because of this, each level can safely call
`music("theme")`. Music continues when the scene changes. Pausing the game
does not stop the music, and `timeScale` does not make it slower.

## Sample instruments

In a song, an instrument can play a sound file of your project, for
example a recording. This is a sample instrument. Each note plays the
sound at the pitch of the note. A recorded "bap" can be a drum, and a
recorded "la" can sing a melody.

1. Record the sound (see [Record a sound](#record-a-sound)), or import a
   sound file.
2. Open the song in the **Music** workspace.
3. Select a channel.
4. Open **Edit instrument**.
5. Click **Sound file**.
6. Choose the file in the list.
7. Set **Base note**. A note on this row plays the sound as it is.
8. Draw notes on the rows. Each row higher plays the sound faster and one
   semitone higher.

The instrument has these controls:

| Control | |
| --- | --- |
| **Base note** | The note that plays the sound as it is. |
| **Pitched** | When this is off, every note plays the sound as it is. Use this for drums. |
| **Play the whole sound** | When this is on, each note plays all of the sound. When this is off, the sound stops at the end of the note, after the release. |
| **Volume**, **Attack**, **Decay**, **Sustain**, **Release** | The volume and the envelope, as for synth instruments. |
| **Vibrato depth**, **Vibrato speed**, **Low-pass** | As for synth instruments. |

In the `.song` file, a sample instrument looks like this example. It is a
recorded "la" with the base note G4 (67):

```json
{ "name": "La", "type": "sample", "sample": "../sounds/la.wav", "baseNote": 67, "playToEnd": false, "release": 0.2 }
```

A note with `"note": 72` (C5) is 5 semitones higher than the base note.
Because of this, it plays `la.wav` 1.33 times faster. The note stops at
the end of its length, and then fades out in 0.2 seconds.

Songs with sample instruments play in the game as they play in the
editor. The engine makes the song from the same samples. For OGG and MP3
files, the preview in the editor can sound a little different from the
game, because the browser reads these files.

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
`.song` files. They give objects that you can play and stop in your script
([File formats](formats.md#sound-effects-in-code)).
