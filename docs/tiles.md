# Tiles

A Tiles piece is a grid of tiles from a `.tileset`. Each tile can have
settings such as `solid`, `oneWay` or your own (`damage`).

Cells are addressed by column and row from the piece's position; (0, 0) is
the top-left cell and negatives work. A cell holds a tile number (from 0,
in reading order of the tileset picture) or -1 for empty.

## Cells

| | |
| --- | --- |
| `getTile(column, row)`, `setTile(column, row, tile)` | Read or change a cell; -1 empties it |
| `fill(column, row, columns, rows, tile)` | Fill a rectangle |
| `clear()` | Empty every cell |
| `cellsWith(tile)` | Painted cells (or those with `tile`), as `{column, row, tile}` |
| `neighbors(column, row, diagonal)` | Adjacent cells, as `{column, row, tile}` |
| `tileInfo(tile)` | The tile's settings |
| `isSolid(column, row)` | Whether the cell's tile is solid |

## Cells and positions

| | |
| --- | --- |
| `cellAt(x, y)` | The cell under a scene point |
| `tileAt(x, y)` | The tile under a scene point, or -1 |
| `cellPosition(column, row)`, `cellCenter(column, row)` | A cell's corner or center in the scene |
| `getTileSize()` | One cell's size |
| `getBounds()` | The painted area: x, y, width, height |

```lua
for _, c in ipairs(Level:cellsWith(7)) do
  local cx, cy = Level:cellCenter(c.column, c.row)
  spawn("scenes/coin.scene", { x = cx, y = cy })
  Level:setTile(c.column, c.row, -1)
end
```

## Collisions

A Body's `hit(other)` receives the Tiles piece. `touchingTile(setting)`
returns the settings of a touched tile that has `setting`:

```lua
local t = touchingTile("damage")
if t then hurt(t.damage) end
```

Tileset files: [File formats](formats.md#tilesets).

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
| `neighbors(column, row, diagonal?)` | Adjacent cells as {column, row, tile}: 4, or 8 with diagonal. |
| `cellCenter(column, row)` | The scene position of a cell's center. |
| `getTileSize()` | The size of one cell in the scene: width, height. |
| `getBounds()` | The painted area in the scene: x, y, width, height (all 0 when empty). |
<!-- end -->
