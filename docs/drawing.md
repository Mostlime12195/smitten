# Drawing

A piece's `draw()` runs after the piece draws, in its own coordinates:
(0, 0) is its position, and it turns and scales with it. UI pieces draw in
screen pixels from their top-left corner.

```lua
function draw()
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

## Colors

`pen(r, g, b, a)` (0 to 1), `pen(gray)`, `pen({r, g, b, a})` or
`pen("#rrggbb[aa]")`. The piece's `tint` multiplies what it draws.

## Text

`write(text, x, y[, size])`, or a table: `size`, `font` (a font file or
`"pixel"`), `align` (`left`, `center`, `right`) and `width` (wraps).

## Sprites

`sprite(path, x, y[, options])` draws a picture from its top-left corner.

| Option | |
| --- | --- |
| `frame` | A frame of a `.sprite`, or of a sheet cut with `columns`/`rows` (from 0) |
| `columns`, `rows` | Cut a picture into frames |
| `rotation`, `scale`, `scaleX`, `scaleY` | |
| `flipX`, `flipY` | |
| `centered` | Center on x, y |

```lua
sprite("art/tiles.png", 32, 0, { columns = 8, rows = 8, frame = 12 })
```

All of [`smitten.graphics`](https://love2d.org/wiki/love.graphics) also
works in `draw()`; `pen` is `smitten.graphics.setColor`.
