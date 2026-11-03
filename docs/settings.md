# Project settings

**Project › Project settings** (Ctrl+,) edits `smitten.json`.

```json
{
  "format": "smitten.project",
  "version": 2,
  "name": "My game",
  "main": "scenes/level.scene",
  "display": { "width": 1280, "height": 720, "stretch": "fit", "filter": "smooth" },
  "input": { "dash": ["lshift", "pad:rightshoulder"] },
  "modules": { "physics2d": "always" }
}
```

| Field | |
| --- | --- |
| `name` | Window title and save folder name |
| `main` | The first scene; `main.lua` is optional when set |
| `display.width`, `display.height` | The game's resolution, in game pixels |
| `display.stretch` | How it fits the window: `fit` (bars), `expand` (shows more), `stretch` (distorts), `pixel` (whole-number scales) |
| `display.filter` | `smooth`, or `pixel` for crisp pixel art |
| `display.background` | Background color |
| `input` | Extra [input actions](input.md#actions) |
| `modules` | `"always"` or `"never"` per engine module |
| `identity` | Save folder name, if not `name` |

<!-- api:Screen -->
| Call | |
| --- | --- |
| `screenWidth()` | The game's width, in game pixels. |
| `screenHeight()` | The game's height, in game pixels. |
| `fullscreen(on)` | fullscreen(true) fills the screen; fullscreen() is true while it does. |
<!-- end -->

Browsers only allow `fullscreen(true)` right after a click or key press.

<!-- module:display -->
| Function | |
| --- | --- |
| `smitten.display.toGame(x, y)` | Window coordinates to game coordinates. |
| `smitten.display.toWindow(x, y)` | Game coordinates to window coordinates. |
| `smitten.display.getWindowRect()` | The game's area in the window: x, y, width, height. |

Fields: `width`, `height`, `viewX`, `viewY`, `viewWidth`, `viewHeight`, `scale`, `stretch`, `filter`.
<!-- end -->

## Engine modules

Optional parts of the engine download only when a game uses them:

| Module | Used by |
| --- | --- |
| `physics2d` | Bodies with physics motion, Joints, `smitten.physics` |
| `video` | `smitten.video` |
| `synth` | `.sfx` and `.song` files, `smitten.synth` |

Project settings › Modules shows what's included and why.

## main.lua and conf.lua

Both work as in LÖVE. `smitten.draw` in `main.lua` draws in screen pixels
over the scene, under the UI.
