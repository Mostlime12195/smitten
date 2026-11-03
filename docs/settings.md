# Project settings

**Project › Project settings** (Ctrl+,) edits `smitten.json`, the file at
the top of every project. It holds the game's name, the scene it starts
with, its resolution and how it fits the screen, its splash screen, input
actions, physics settings and which engine modules it downloads.

```json
{
  "format": "smitten.project",
  "version": 2,
  "name": "My game",
  "main": "scenes/level.scene",
  "display": { "width": 1280, "height": 720, "stretch": "expand", "filter": "smooth" },
  "input": { "dash": ["lshift", "pad:rightshoulder"] }
}
```

| Setting | |
| --- | --- |
| `name` | The game's name: the window title and the name of its saves |
| `main` | The scene the game starts with |
| `display.width`, `display.height` | The resolution the game is designed for |
| `display.stretch` | How it fits the screen (below) |
| `display.filter` | `smooth`, or `pixel` for crisp pixel art |
| `display.background` | The color behind everything |
| `splash` | The splash screen shown while the game loads (below) |
| `input` | [Input actions](input.md#actions) to add or change |
| `physics.gravity` | Gravity, as `[x, y]` in pixels per second per second. See [Physics](physics.md) |
| `modules` | Force an engine module `"always"` or `"never"` |
| `identity` | The name saves use, if it shouldn't follow `name` |

## Resolution and fitting the screen

You design a game for one resolution, like 1280×720, and Smitten scales
it to fit whatever window or screen it's played on. Positions in scenes
and UI are always in these game pixels.

| `stretch` | |
| --- | --- |
| `expand` | Scales to fit, and shows a little more of the world where the shapes differ instead of bars |
| `fit` | Scales to fit, and fills the leftover space with the background color |
| `stretch` | Fills the screen exactly, distorting if the shapes differ |
| `pixel` | Scales by whole numbers only (2×, 3×...), for crisp pixel art |

<!-- api:Screen -->
| Call | |
| --- | --- |
| `screenWidth()` | The game's width, in game pixels. |
| `screenHeight()` | The game's height, in game pixels. |
| `fullscreen(on)` | fullscreen(true) fills the screen; fullscreen() is true while it does. |
<!-- end -->

Browsers only allow fullscreen right after a click or key press, so call
`fullscreen(true)` from a button's `pressed()` or after `pressed("f")`.

<!-- module:display -->
| Function | |
| --- | --- |
| `smitten.display.toGame(x, y)` | Window coordinates to game coordinates. |
| `smitten.display.toWindow(x, y)` | Game coordinates to window coordinates. |
| `smitten.display.getWindowRect()` | The game's area in the window: x, y, width, height. |

Fields: `width`, `height`, `viewX`, `viewY`, `viewWidth`, `viewHeight`, `scale`, `stretch`, `filter`.
<!-- end -->

## The splash screen

While a game loads in a browser, Smitten shows a splash screen: a heart
and "Made with Smitten" on a dark background. Once the game has loaded,
and the splash has been up for a second, it fades into the main scene.
There's no Play button to press.

Make it yours in **Project settings › Splash**. Pick a picture from your
project (a logo or a title screen), a background color and how long it
stays up, and choose whether "Made with Smitten" shows underneath.

```json
"splash": { "image": "art/logo.png", "background": "#1a1c2c", "duration": 2, "madeWith": false }
```

| `splash` | |
| --- | --- |
| `image` | A picture from the project, shown in the middle. Empty for Smitten's heart |
| `background` | `"#rrggbb"`, or `[r, g, b]` from 0 to 1 |
| `duration` | Seconds it stays up at least (0 to 10); longer if the game is still loading |
| `madeWith` | Show "Made with Smitten" (`true` unless you turn it off) |

Pixel-art games (`display.filter` set to `pixel`) get a crisp, unblurred
splash picture.

## Engine modules

Some parts of the engine are separate downloads, included only when a game
uses them, so small games load fast:

| Module | Included when a game uses |
| --- | --- |
| `physics2d` | Bodies, Zones, Joints or `smitten.physics` ([Physics](physics.md)) |
| `video` | `smitten.video` |
| `synth` | `.sfx` and `.song` files |

Project settings › Modules shows what's included and why.
