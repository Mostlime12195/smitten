# Drawing

Most games do not need drawing code. Sprites, Shapes, Text, Tiles and
Particles draw themselves. If you want something that they cannot do, give
the piece a `draw()` function. For example, use `draw()` for a health bar
above an enemy, or for a laser beam.

The engine calls `draw()` immediately after the piece draws itself. It
uses the coordinates of the piece: (0, 0) is the position of the piece.
When the piece turns or changes its scale, the drawing also turns or
changes its scale.

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
| `write(text, x, y, options)` | Text; options: a size, or { size, font, align, width }. With rich = true it reads tags like [b]bold[/b]; visible = 5 shows the first 5 characters. Returns the width and height. |
| `sprite(image, x, y, options)` | An image, or a frame of a sheet: sprite("art/hero.sprite", x, y, { frame = 2, rotation = 90 }). rotation is in degrees. |
<!-- end -->

## Colors

`pen` sets the color for the next things that you draw. You can give it:

- red, green, blue and alpha, from 0 to 1 (`pen(1, 0.5, 0)`).
- a gray (`pen(0.5)`).
- a table, as color properties use (`pen({1, 0, 0, 0.5})`).
- a hex code (`pen("#ff8800")`).

The `tint` of the piece also changes the color of all the things that it
draws.

## Text

`write(text, x, y)` writes text with a size of 16 pixels.
`write(text, x, y, 24)` writes with a size of 24 pixels. For more options,
give a table:

- `size`.
- `font`: a font file, or `"pixel"` for the pixel font that Smitten has.
- `align`: `"left"`, `"center"` or `"right"`.
- `width`: longer lines wrap.

Text stays sharp when the game becomes bigger.

`write()` gives the width and height of the text that it wrote. It can do
the things that the [Text](text.md) page tells about:

- `rich = true` reads text tags such as `[b]bold[/b]` and `[color=red]`.
- `visible` shows only a number of letters from the start.
- `outline` and `shadow` make text easy to read on all backgrounds.

```lua
write("[b]Wave[/b] [color=gold]3[/color]", 160, 8, { rich = true, size = 20, align = "center", outline = true })
```

## Sprites

`sprite(path, x, y)` draws a picture with its top-left corner at x, y. A
table of options can choose a frame, or turn, scale or flip the picture:

| Option | |
| --- | --- |
| `frame` | A frame of a `.sprite` file, or of a sheet that `columns` and `rows` cut (the first frame is 0) |
| `columns`, `rows` | Cut a plain picture into frames |
| `rotation`, `scale`, `scaleX`, `scaleY` | Turn (in degrees) and size |
| `flipX`, `flipY` | Mirror the picture |
| `centered` | Put the center of the picture on x, y |

```lua
sprite("art/tiles.png", 32, 0, { columns = 8, rows = 8, frame = 12 })
```

## Drawing on the screen

The `draw()` function of a UI piece uses screen pixels, from the top-left
corner of the piece. Because of this, use it for all drawings that the camera must
not move. `clearScreen(color)` fills all of the screen with a color, for
backgrounds that you draw yourself.

For more, [`smitten.graphics`](engine.md) has the full set of functions:
meshes, canvases, shaders, blend modes and more.
