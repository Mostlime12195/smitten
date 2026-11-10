# Tiles

A **Tiles** piece is a grid painted with tiles from a tileset: a picture
cut into squares, where each tile can have settings like `solid` (blocks
bodies), `oneWay` (only solid from above) or anything of your own, such
as `damage`. You paint it in the scene view, and scripts can read and
change it while the game runs, for breakable blocks, doors or
procedurally built levels.

Cells are counted in columns and rows from the Tiles piece's position:
(0, 0) is its top-left cell, and negative numbers work too. Each cell
holds a tile number, counted from 0 across the tileset picture, or -1 when
it's empty.

## Reading and changing cells

| | |
| --- | --- |
| `getTile(column, row)`, `setTile(column, row, tile)` | Read or change one cell; -1 empties it |
| `fill(column, row, columns, rows, tile)` | Fill a rectangle of cells |
| `clear()` | Empty every cell |
| `cellsWith(tile)` | Every painted cell (or every cell with that tile), as `{column, row, tile}` |
| `neighbors(column, row, diagonal)` | The cells around one, as `{column, row, tile}` |
| `tileInfo(tile)` | A tile's settings: `solid`, `name`, `damage`... |
| `isSolid(column, row)` | Whether that cell's tile is solid |

Solid tiles start blocking bodies as soon as they change.

## Cells and positions

| | |
| --- | --- |
| `cellAt(x, y)` | The cell under a point in the scene |
| `tileAt(x, y)` | The tile under a point, or -1 |
| `cellPosition(column, row)`, `cellCenter(column, row)` | A cell's corner or center in the scene |
| `getTileSize()` | How big one cell is in the scene |
| `getBounds()` | The painted area: x, y, width, height |

A common trick is to paint markers in the tile map and turn them into
pieces when the level starts:

```lua
-- Turn every coin tile (tile 7) into a real coin
function ready()
  for _, c in ipairs(Level:cellsWith(7)) do
    local cx, cy = Level:cellCenter(c.column, c.row)
    spawn("scenes/coin.scene", { x = cx, y = cy })
    Level:setTile(c.column, c.row, -1)
  end
end
```

## Touching tiles

A Body's `hit(other)` receives the Tiles piece when it bumps into solid
tiles. `touchingTile(setting)` returns the settings of a touched tile that
has that setting, which suits hazards:

```lua
local t = touchingTile("damage")
if t then hurt(t.damage) end
```

With **castShadows** on, the tiles marked solid block
[Lights](lights.md#shadows) that have shadows on.

The tileset file format is in [File formats](formats.md#tilesets).

<!-- piece:Tiles -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `tileset` | resource | "" | The .tileset file: a picture cut into tiles, with settings such as solid. |
| `solid` | bool | true | Tiles marked solid block bodies. Off makes every tile just decoration. |
| `castShadows` | bool | false | Tiles marked solid block Lights that have shadows on. |

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
