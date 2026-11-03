# Tiles

A Tiles piece is a grid of tiles from a `.tileset` file: a picture cut into
tiles, with settings for each tile (`solid`, `oneWay`, or anything you
like, such as `damage`). Paint it in the scene view; change it from
scripts.

Cells are counted in **columns** and **rows** from the piece's position
(0, 0 is its top-left cell; negative numbers work too). A cell holds a tile
number, counted from 0, left to right and top to bottom in the tileset's
picture, or -1 when empty.

## Reading and changing cells

```lua
-- On a Body: break the brick above when bumping into it from below
function hit(other)
  if other:is("Tiles") and onCeiling() then
    local column, row = other:cellAt(x, y - 20)
    if other:tileInfo(other:getTile(column, row)).name == "brick" then
      other:setTile(column, row, -1)
      sfx("break")
    end
  end
end
```

| | |
| --- | --- |
| `getTile(column, row)`, `setTile(column, row, tile)` | Read and change one cell (-1 empties it) |
| `fill(column, row, columns, rows, tile)` | A rectangle of cells at once |
| `clear()` | Empties every cell |
| `cellsWith(tile)` | Every painted cell (or every cell with one tile), as `{column, row, tile}` |
| `neighbors(column, row, diagonal)` | The 4 (or 8) cells around one, as `{column, row, tile}` |
| `tileInfo(tile)` | A tile's settings from the tileset: `solid`, `name`, `damage`... |
| `isSolid(column, row)` | True if the cell's tile is solid |

Solid tiles block Bodies as soon as they change.

## Cells and the scene

| | |
| --- | --- |
| `cellAt(x, y)` | The cell under a point in the scene: column, row |
| `tileAt(x, y)` | The tile under a point, or -1 |
| `cellPosition(column, row)` | A cell's top-left corner in the scene |
| `cellCenter(column, row)` | A cell's center in the scene |
| `getTileSize()` | One cell's size in the scene |
| `getBounds()` | The painted area in the scene: x, y, width, height |

```lua
-- Turn every coin tile (tile 7) into a coin piece
function ready()
  for _, c in ipairs(Level:cellsWith(7)) do
    local cx, cy = Level:cellCenter(c.column, c.row)
    spawn("scenes/coin.scene", { x = cx, y = cy })
    Level:setTile(c.column, c.row, -1)
  end
end
```

## Touching tiles

Bodies' `hit(other)` gets the Tiles piece when they bump into solid tiles.
`touchingTile(setting)` on a Body returns the settings of a tile it touches
that has that setting:

```lua
local spikes = touchingTile("damage")
if spikes then hurt(spikes.damage) end
```

Tilesets are described in [File formats](formats.md#tilesets).

## The Tiles piece

<!-- piece:Tiles -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `tileset` | resource | "" | The .tileset file: a picture cut into tiles, with settings such as solid. |
| `solid` | bool | true | Tiles marked solid block bodies. Off makes every tile just decoration. |

| Method | |
| --- | --- |
| `getTile(column, row)` | The tile number in a cell, or -1 if it's empty. |
| `setTile(column, row, tile)` | Changes a cell (-1 empties it). |
| `tileInfo(tile)` | The settings of a tile in the tileset (solid, name, ...). |
| `cellAt(x, y)` | The cell under a point in the scene: column, row. |
| `cellPosition(column, row)` | The scene position of a cell's top-left corner. |
| `cellsWith(tile?)` | A list of {column, row, tile} for every painted cell (or every cell with that tile). |
| `fill(column, row, columns, rows, tile)` | Sets a rectangle of cells to one tile (-1 empties them). |
| `clear()` | Empties every cell. |
| `tileAt(x, y)` | The tile number under a point in the scene, or -1. |
| `isSolid(column, row)` | True if the cell's tile is marked solid (and solid is on). |
| `neighbors(column, row, diagonal?)` | The cells around one, as {column, row, tile} (tile -1 when empty): up, right, down, left, or all eight with diagonal. |
| `cellCenter(column, row)` | The scene position of a cell's center. |
| `getTileSize()` | The size of one cell in the scene: width, height. |
| `getBounds()` | The painted area in the scene: x, y, width, height (all 0 when empty). |
<!-- end -->
