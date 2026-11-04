# Drawing

Most games don't need any drawing code: Sprites, Shapes, Text, Tiles and
Particles draw themselves. When you want something they can't do, such as
a health bar over an enemy or a laser beam, give the piece a `draw()`
function.

`draw()` runs right after the piece draws itself, in the piece's own
coordinates: (0, 0) is the piece's position, and the drawing turns and
scales with the piece.

```lua
-- A health bar above an enemy
function draw()
  pen(0, 0, 0, 0.5)
  rect(-16, -30, 32, 4)
  pen("#ff5050")
  rect(-16, -30, 32 * hp / maxHp, 4)
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

## Colors

`pen` sets the color for what you draw next: red, green, blue and alpha
from 0 to 1 (`pen(1, 0.5, 0)`), a gray (`pen(0.5)`), a table like color
settings use (`pen({1, 0, 0, 0.5})`), or a hex code (`pen("#ff8800")`).
The piece's `tint` also colors everything it draws.

## Text

`write(text, x, y)` writes at 16 pixels, and `write(text, x, y, 24)` at
24. For more, pass a table: `size`, `font` (a font file, or `"pixel"` for
the built-in pixel font), `align` (`"left"`, `"center"` or `"right"`) and
`width` (longer lines wrap). Text stays sharp when the game is scaled up.

## Sprites

`sprite(path, x, y)` draws a picture with its top-left corner at x, y. An
options table picks a frame or transforms it:

| Option | |
| --- | --- |
| `frame` | A frame of a `.sprite` file, or of a sheet cut with `columns` and `rows` (counting from 0) |
| `columns`, `rows` | Cut a plain picture into frames |
| `rotation`, `scale`, `scaleX`, `scaleY` | Turn and size |
| `flipX`, `flipY` | Mirror it |
| `centered` | Center it on x, y |

```lua
sprite("art/tiles.png", 32, 0, { columns = 8, rows = 8, frame = 12 })
```

## Drawing on the screen

A UI piece's `draw()` uses screen pixels, starting from its own top-left
corner, so it's the place for anything that should ignore the camera.
`clearScreen(color)` fills the whole screen, for hand-drawn backgrounds.

For anything beyond these, [`smitten.graphics`](engine.md) has the full
set: meshes, canvases, shaders, blend modes and more.
