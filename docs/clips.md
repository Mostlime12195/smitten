# Clips

A **clip** is the last seconds of a running game, saved as a file. You can
save a clip as a video (with sound) or as a GIF. Then you can show your game
to other people, for example in a chat or on a page about your game.

Smitten does not record until you tell it to. When you click **Record**,
Smitten keeps the last 10 seconds of the game. When you save a clip, the
browser downloads these seconds as a file. Smitten does not upload the clip.

## Recording and saving a clip

1. Start the game.
2. Click **Record**. Smitten starts to keep the last seconds.
3. Play the game.
4. Click **Clip**.
5. Select **Video (WebM, with sound)** or **GIF**.

You can also press a key while Smitten records:

| Key | What it saves |
| --- | --- |
| F9 | A video |
| Shift+F9 | A GIF |

To stop the recording, click **Record** again.

The file name is the title of the game and the time, for example
`Lamplight 2026-11-10 14-03-05.webm`. A GIF takes some seconds to make.
The web player shows the progress at the bottom right.

## Where you can record

| Where | Buttons |
| --- | --- |
| The editor | **Record** and **Clip** in the bar above the game |
| The web player (an exported game, or the page of a game on the games site) | The record button and the save button at the bottom right of the game. Move the mouse pointer over the game to show them |

In the web player, a small red dot at the bottom right shows that Smitten
records.

In the editor, **Record** stays on for the next runs of the game, until you
click it again. To change this, open **Editor settings › Running**:

| | |
| --- | --- |
| **Record clips** | When this is on, Smitten records each run from the start |
| **Clip length** | How many seconds a clip keeps: 3 to 60. The default is 10 |

A web player can also record from the start. Add `record=1` to the address
of `player.html` (or of the `index.html` of an exported game). Add
`clipSeconds=5` to change the length, for example
`index.html?record=1&clipSeconds=5`.

## Video or GIF

| | Video (WebM) | GIF |
| --- | --- | --- |
| Sound | Yes, if the browser plays the sound of the game | No |
| Frames per second | 30 at most | 15 at most |
| Size | 960 pixels wide or high at most, and at most 960 × 540 pixels in all | 480 pixels wide or high at most (640 for pixel art) |
| Colors | All | 255 at most |
| Where it plays | Browsers, VLC, Discord and most video programs | Everywhere |

If a game uses the `pixel` stretch (see [Project settings](settings.md)),
the clip shows the game without the bars around it. Each pixel of the game
is a square of the same size in the clip, so the pixel art stays sharp.

## Limits

- Clips work in Chrome, Edge and Firefox. We did not test Safari. If a
  browser cannot record a WebM video, Smitten does not show the record
  button.
- On phones and tablets, the web player does not show its buttons, because
  there is no mouse pointer. Because of this, you cannot record there.
- If the browser has not started the sound of the game, the video has no
  sound. Browsers start the sound after a click or a key press in the game.
- While Smitten records, the browser encodes the video. On a slow computer,
  this can make the game slower. When you do not need a clip, stop the
  recording.
- A clip shows only the game. It does not show the page around the game
  or the mouse pointer.
- While Smitten records, the game does not get F9.
- A GIF has a maximum of 255 colors. Smooth color gradients can show steps.
- Scripts cannot start a recording or save a clip. Only the person who plays
  can do this.
