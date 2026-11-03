# Drawing

Most games need no drawing code: Sprites, Shapes, Text, Tiles and
Particles draw themselves. For anything else, give a piece a `draw()`
function. It runs after the piece is drawn, in the piece's own coordinates
(0, 0 is the piece's position; it turns and scales with it), on the piece's
layer.

```lua
-- A health ring around an enemy
function draw()
  pen(0, 0, 0, 0.4)
  circle(0, 0, 20, false)
  pen("#ff5050")
  penSize(3)
  line(-16, -28, -16 + 32 * hp / maxHp, -28)
  write(name, 0, 24, { size = 10, align = "center" })
end
```

<!-- api:Drawing -->
| Call | |
| --- | --- |
| `pen(r, g, b, a)` | The color to draw with: pen(1, 0, 0), pen({1, 0, 0}), pen("#ff8800"). |
| `penSize(width)` | How thick lines and outlines are. |
| `clearScreen(color)` | Fills the whole screen with a color (the pen's if none). |
| `rect(x, y, w, h, fill)` | A rectangle (fill = false for an outline). |
| `circle(x, y, radius, fill)` | A circle (fill = false for an outline). |
| `oval(x, y, rx, ry, fill)` | An ellipse. |
| `poly(points, fill)` | A polygon: poly({x1, y1, x2, y2, x3, y3}). |
| `line(x1, y1, x2, y2, ...)` | A line through points. |
| `dot(x, y)` | One pixel. |
| `write(text, x, y, options)` | Text; options: a size, or { size, font, align, width }. |
| `sprite(image, x, y, options)` | An image, or a frame of a sheet: sprite("art/hero.sprite", x, y, { frame = 2 }). |
<!-- end -->

The names don't clash with properties pieces have (`color`, `text`,
`image`): `pen` sets the color, `write` draws text, `sprite` an image.

## Colors

`pen` takes red, green, blue and alpha from 0 to 1 (`pen(1, 0.5, 0)`), a
gray (`pen(0.5)`), a table (`pen({1, 0, 0, 0.5})`, as color properties
are) or a hex string (`pen("#ff8800")`, `pen("#ff880080")`). The piece's
`tint` multiplies everything it draws.

## Text

`write(text, x, y)` writes at 16 pixels; `write(text, x, y, 24)` at 24.
With a table: `size`, `font` (a `.ttf`/`.otf` file, or `"pixel"` for the
built-in pixel font), `align` (`"left"`, `"center"` or `"right"` of x) and
`width` (wraps lines longer than that). Text stays sharp when the game is
scaled up.

## Sprites

`sprite("art/star.png", x, y)` draws a picture with its top-left corner at
x, y. A fourth argument picks a frame and more:

| Option | |
| --- | --- |
| `frame` | The frame of a `.sprite` file, or of a sheet cut with `columns` and `rows` (from 0) |
| `columns`, `rows` | Cut a plain picture into frames |
| `rotation`, `scale`, `scaleX`, `scaleY` | Turn (radians) and size |
| `flipX`, `flipY` | Mirror it |
| `centered` | Center it on x, y (a `.sprite` file's origin is used otherwise) |

```lua
sprite("art/hero.sprite", 0, 0, { frame = 3, flipX = vx < 0 })
sprite("art/tiles.png", 32, 0, { columns = 8, rows = 8, frame = 12 })
```

## UI and the screen

A UI piece's `draw()` is in screen pixels, from its rectangle's top-left
corner, so it's the place for HUD drawing that ignores the camera. A
`smitten.draw` function in `main.lua` draws in screen pixels over the
world, under the UI. `clearScreen(color)` fills the whole screen, for a
background drawn by hand (on a piece with a low `layer`).

## Everything else

All of [`smitten.graphics`](https://love2d.org/wiki/love.graphics) works
in `draw()`: meshes, canvases, shaders, blend modes,
stencils. `smitten.graphics.setColor` and `pen` are the same thing.
