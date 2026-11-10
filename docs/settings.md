# Project settings

**Project › Project settings** (Ctrl+,) changes `smitten.json`. This file
is at the top of each project. It has these settings of the game:

- its name.
- the scene that it starts with.
- its resolution, and how it fits the screen.
- its splash screen.
- its input actions.
- its physics settings.
- the engine modules that it downloads.

```json
{
  "format": "smitten.project",
  "version": 3,
  "name": "My game",
  "main": "scenes/level.scene",
  "display": { "width": 1280, "height": 720, "stretch": "expand" },
  "input": { "dash": ["lshift", "pad:rightshoulder"] }
}
```

| Setting | |
| --- | --- |
| `version` | The rules of the game. New projects are version 3. An older project keeps the rules of its version until you [update it](older-projects.md) |
| `name` | The name of the game: the window title and the name of its saves |
| `main` | The scene that the game starts with |
| `display.width`, `display.height` | The resolution that you make the game for |
| `display.stretch` | How the game fits the screen (see below) |
| `display.filter` | `smooth`, or `pixel` for sharp pixel art (the default with `pixel` stretch) |
| `display.antialias` | Smooth edges on shapes and lines. On, but not with `pixel` stretch |
| `display.background` | The color behind all things, also behind the bars, as `[r, g, b, a]` |
| `splash` | The splash screen that shows while the game loads (see below) |
| `input` | [Input actions](input.md#actions) to add or change. `input.players` has the inputs of each player: `"players": { "2": { "jump": ["return", "pad:a"] } }` ([More than one player](input.md#more-than-one-player)) |
| `physics.gravity` | Gravity, as `[x, y]` in pixels per second per second. See [Physics](physics.md) |
| `modules` | Makes the game always use an engine module (`"always"`) or never use it (`"never"`) |
| `identity` | The name of the saves, if it must be different from `name` |

## Resolution and fitting the screen

You make a game for one resolution, for example 1280×720. Smitten scales
the game to fit the window or screen where it plays. Positions in scenes
and in UI are always in these game pixels. The resolution is the size that
you make the game for. It is not a limit. The game always fills the
window, and it draws with the full sharpness of the screen. Because of this, it looks
sharp in fullscreen and on phones.

| `stretch` | |
| --- | --- |
| `expand` | The default. Scales to fit. If the screen has a different shape, it shows a little more of the world. Because of this, there are never bars |
| `fit` | Scales to fit. It fills the remaining space with the background color |
| `stretch` | Fills the screen exactly. If the screen has a different shape, the game changes its shape too |
| `pixel` | Draws at your resolution, and scales it up by whole numbers (2×, 3×...), for sharp pixel art |

With `expand`, the edges of the screen move with the shape of the screen.
Because of this, do these things:

- Anchor UI to the edges.
- For the area that shows on the screen, use `viewX`, `viewY`,
  `viewWidth` and `viewHeight` of `smitten.display`.

`screenWidth()` and `screenHeight()` are always your resolution.

<!-- api:Screen -->
| Call | |
| --- | --- |
| `screenWidth()` | Returns the width of the game, in game pixels. |
| `screenHeight()` | Returns the height of the game, in game pixels. |
| `fullscreen(on)` | fullscreen(true) fills the screen. fullscreen() returns true while the game fills the screen. |
<!-- end -->

Browsers allow fullscreen only immediately after a click or a key press.
Because of this, call `fullscreen(true)` from the `clicked()` function of a button,
or after `pressed("f")`.

<!-- module:display -->
| Function | |
| --- | --- |
| `smitten.display.toGame(x, y)` | Takes window coordinates and returns game coordinates. |
| `smitten.display.toWindow(x, y)` | Takes game coordinates and returns window coordinates. |
| `smitten.display.getWindowRect()` | Returns the area of the game in the window: x, y, width, height. |

Fields: `width`, `height`, `viewX`, `viewY`, `viewWidth`, `viewHeight`, `scale`, `stretch`, `filter`, `antialias`, `background`.
<!-- end -->

## The splash screen

While a game loads in a browser, Smitten shows a splash screen: a heart
and "Made with Smitten" on a dark background. When the game has loaded,
and the splash screen has shown for one second, the splash screen fades
into the main scene. The player does not have to press a Play button.

To change the splash screen, go to **Project settings › Splash**:

1. Choose a picture from your project (for example, a logo or a title
   screen).
2. Choose a background color.
3. Choose how long the splash screen shows.
4. Choose if "Made with Smitten" shows below the picture.

```json
"splash": { "image": "art/logo.png", "background": "#1a1c2c", "duration": 2, "madeWith": false }
```

| `splash` | |
| --- | --- |
| `image` | A picture from the project, in the middle. Empty for the heart of Smitten |
| `background` | `"#rrggbb"`, or `[r, g, b]` from 0 to 1 |
| `duration` | The minimum time in seconds that the splash screen shows (0 to 10). It shows longer if the game continues to load |
| `madeWith` | Show "Made with Smitten" (`true` if you do not turn it off) |

In pixel-art games (`display.filter` is `pixel`), the splash picture is
sharp, not blurred.

## Engine modules

Some parts of the engine are separate downloads. A game includes them only
when it uses them. Because of this, small games load fast:

| Module | A game includes it when it uses |
| --- | --- |
| `physics2d` | Bodies, Zones, Joints or `smitten.physics` ([Physics](physics.md)) |
| `video` | `smitten.video` |
| `synth` | `.sfx` and `.song` files |

**Project settings › Modules** shows the modules that the game includes,
and why.
