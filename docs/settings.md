# Project settings and modules

**Project › Project settings** (Ctrl+,) edits `smitten.json`, the file at
the top of every project: its name, the scene it starts with, the
resolution and how it fits the window, input actions, and engine modules.

```json
{
  "format": "smitten.project",
  "version": 2,
  "name": "My game",
  "main": "scenes/level.scene",
  "display": { "width": 1280, "height": 720, "stretch": "fit", "filter": "smooth", "background": [0.11, 0.12, 0.15, 1] },
  "input": { "dash": ["lshift", "pad:rightshoulder"] },
  "modules": { "physics2d": "always" }
}
```

| Field | Meaning |
| --- | --- |
| `name` | The game's name: the window title, and the name of its save folder |
| `main` | The scene the game starts with. With a main scene, `main.lua` is optional |
| `display.width`, `height` | The resolution the game is made for, in game pixels |
| `display.stretch` | How it fits the window (below) |
| `display.filter` | `smooth`, or `pixel` for crisp pixel art (nearest-neighbor for pictures and fonts) |
| `display.background` | The color behind everything |
| `input` | [Input actions](input.md#actions), on top of the defaults |
| `modules` | Engine modules: `"always"` or `"never"`; others are worked out from the project |
| `identity` | Optional: the save folder's name, if it shouldn't follow `name` |

## Resolution and scaling

The game is made for one resolution, and scaled to fit the window or the
screen. Positions in scenes and UI are in these game pixels, whatever the
window's size.

| `stretch` | |
| --- | --- |
| `fit` | Scales the game to fit and fills the rest with bars |
| `expand` | Scales the same way, but shows more of the world instead of bars |
| `stretch` | Fills the window, distorting if the shapes differ |
| `pixel` | Whole-number scaling only (2×, 3×...), for pixel art |

<!-- api:Screen -->
| Call | |
| --- | --- |
| `screenWidth()` | The game's width, in game pixels. |
| `screenHeight()` | The game's height, in game pixels. |
| `fullscreen(on)` | fullscreen(true) fills the screen; fullscreen() is true while it does. |
<!-- end -->

`fullscreen(true)` fills the screen; on the web, browsers only allow it
right after a click or a key press, so call it from a button's `pressed()`
or after `pressed("f")`. The player page also has a fullscreen button.

```lua
-- On a "Fullscreen" button
function pressed() fullscreen(not fullscreen()) end
```

<!-- module:display -->
| Function | |
| --- | --- |
| `smitten.display.toGame(x, y)` | Window coordinates to game coordinates. |
| `smitten.display.toWindow(x, y)` | Game coordinates to window coordinates. |
| `smitten.display.getWindowRect()` | The game's area in the window: x, y, width, height. |

Fields: `width`, `height`, `viewX`, `viewY`, `viewWidth`, `viewHeight`, `scale`, `stretch`, `filter`.
<!-- end -->

In `expand` mode, the visible part (`viewX`, `viewY`, `viewWidth`,
`viewHeight`) is bigger than the resolution; `scale` is how many window
pixels a game pixel is.

## Engine modules

Some parts of the engine are separate downloads, included only when a game
uses them, so small games load fast:

| Module | Included when the game uses |
| --- | --- |
| `physics2d` | a Body whose motion is `physics`, a Joint, `smitten.physics` |
| `video` | `smitten.video` |
| `synth` | `.sfx` and `.song` files, `smitten.synth` |

The Modules tab shows what's included and why; force one on or off with
`"always"` or `"never"`. A game that uses a module that wasn't included
stops with a message saying which one to turn on.

## main.lua and conf.lua

A project with a main scene needs no `main.lua`. A `main.lua` works as in
LÖVE (`smitten.load`, `smitten.update`, `smitten.draw`...), next to the
scene: `smitten.draw` draws in screen pixels over the world, under the UI.
`conf.lua` is LÖVE's; a game without one gets its title from `name`.
