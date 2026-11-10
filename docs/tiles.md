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

## Finding paths through tiles

`newPathGrid()` makes a grid that knows which cells are solid, for finding
the way through a tile maze. It keeps up with `setTile()`, `fill()` and
`clear()`. [Pathfinding](pathfinding.md) has the details.

```lua
local grid = Level:newPathGrid()
local path = grid:findPoints(x, y, Player.x, Player.y)   -- {x, y, x, y, ...} or nil
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

## Terrains

A **terrain** is a set of tiles that draw one material in all its shapes:
the lone tile, the edges, the corners, the middle. Paint with a terrain
and each cell takes the tile that fits its neighbours, so a platform gets
its ends and a lake its shore without picking tiles by hand. A tileset can
hold several terrains (grass, stone, water), and a tile belongs to one.

To make one, select a Tiles piece and open **Terrains** at the side of the
Tiles panel:

1. **New terrain**, and give it a name.
2. Mark its tiles. With **Mark its tiles** on, each tile in the picture is
   split in nine: click the **middle** of every tile of the terrain, then
   the **sides and corners** where that tile joins more of the same. A
   tile with grass reaching its right side gets its right side marked; the
   tile in the middle of a field gets everything.
3. **Paint with it**. The brush, the rectangle, the bucket and the eraser
   now fit the edges of what they change and of the cells around it. One
   stroke is one undo step, as always. To go back to plain tiles, set
   **Paint with** to **Picked tiles** (or pick a tile).

If your picture is drawn in a usual layout, **Fill in from a layout** marks
the whole sheet in one go: pick the sheet's top-left tile first. Any other
arrangement works too, marked by hand.

**Neighbours that count** says how the terrain looks around a cell:

| | A cell looks at | Different tiles |
| --- | --- | --- |
| **Sides and corners** | its four sides, and a corner when both sides next to it are the same terrain | 47 (a "blob" set) |
| **Sides** | its four sides | 16 |
| **Corners** | each corner: in when the three cells around that corner are the same terrain | 16 (a 2 × 2 or "wang corner" set) |

Two or more tiles with the **same marks** are variants: each cell picks
one by its position, so it's always the same one and nothing flickers.
A set with tiles missing still works: a cell takes the nearest tile there
is (a wrong side counts for more than a wrong corner).

### The layouts

Each tile is drawn here as its nine parts: `#` where the terrain is, `.`
where it isn't. The middle is always `#`.

**16 tiles, 4 × 4 (sides)**: a column, a 3 × 3 block and a row.

```
 ...  ...  ...  ...
 .#.  .##  ###  ##.      top end, then the block's top row
 .#.  .#.  .#.  .#.

 .#.  .#.  .#.  .#.
 .#.  .##  ###  ##.      the middles
 .#.  .#.  .#.  .#.

 .#.  .#.  .#.  .#.
 .#.  .##  ###  ##.      bottom end, the block's bottom row
 ...  ...  ...  ...

 ...  ...  ...  ...
 .#.  .##  ###  ##.      the lone tile, then a row: left end, middle, right end
 ...  ...  ...  ...
```

**16 tiles, 4 × 4 (corners)**: every mix of the four corners, counted
up-right 1, down-right 2, down-left 4, up-left 8, in reading order (the
first tile has no corner, the last has all four).

```
 ...  ..#  ...  ..#
 .#.  .#.  .#.  .#.
 ...  ...  ..#  ..#

 ...  ..#  ...  ..#
 .#.  .#.  .#.  .#.
 #..  #..  #.#  #.#

 #..  #.#  #..  #.#
 .#.  .#.  .#.  .#.
 ...  ...  ..#  ..#

 #..  #.#  #..  #.#
 .#.  .#.  .#.  .#.
 #..  #..  #.#  #.#
```

**47 tiles, 8 × 6 (sides and corners)**: the 47 blob tiles in the order of
their number, where the parts of a tile count

```
 128 |  1 |  2
 ----+----+----
  64 |    |  4
 ----+----+----
  32 | 16 |  8
```

and a tile's number is the sum of the parts where the terrain carries on
(the tile numbering of the well-known "blob" tileset). The sheet, in
reading order, with the last square unused:

```
   0   1   4   5   7  16  17  20
  21  23  28  29  31  64  65  68
  69  71  80  81  84  85  87  92
  93  95 112 113 116 117 119 124
 125 127 193 197 199 209 213 215
 221 223 241 245 247 253 255   ·
```

### Terrains in scripts

| | |
| --- | --- |
| `setTerrain(column, row, terrain)` | Paints a terrain (by name) in a cell and fits the 8 cells around it; `nil` erases |
| `fillTerrain(column, row, columns, rows, terrain)` | The same for a rectangle of cells |
| `getTerrain(column, row)` | The name of the terrain in a cell, or `nil` |
| `terrains()` | The names of the tileset's terrains |

```lua
-- Dig a hole where the player clicks: the grass around it grows new edges
function update(dt)
  if pressed("mouse:1") then
    local column, row = Level:cellAt(mouse())
    Level:setTerrain(column, row, nil)
  end
end
```

```lua
-- A random cave, with all its walls fitted
function ready()
  Level:fillTerrain(0, 0, 60, 40, "rock")
  for i = 1, 400 do
    Level:setTerrain(math.random(1, 58), math.random(1, 38), nil)
  end
end
```

`setTile` stays exact: it puts the tile you say and leaves the neighbours
alone. Cells only ever hold tile numbers; which terrain a cell is comes
from its tile, so maps need nothing new and a tileset can gain terrains
later.

## Animated tiles

A tile can be an **animation**: it shows other tiles in turn, for water,
lava, torches or conveyor belts. In the Tiles panel open **Animation**,
drag over the frames in the picture (first to last) and press **Animate
with these tiles**. The first tile is the one you paint with, and its
settings (solid, damage...) are the ones that count; the picture plays it.

| | |
| --- | --- |
| **Frames** | The tiles it shows, in order |
| **Frames a second** | How fast, when every frame takes the same time |
| **Seconds for each frame** | A time for each frame instead, like `0.8, 0.1, 0.1` |
| **Random start** | Every cell starts at a different point of the loop, so a lake doesn't ripple all in step |

Animated tiles follow the game's clock: they stop while the game is
paused and slow down with `timeScale()`. The Tiles piece's **animate**
property turns them all off (`Level.animate = false` freezes them on the
frame they show). They cost nothing between frame changes, however many
there are.

## Slopes

Tiles are square: a solid tile blocks with its whole cell. For a ramp or a
hill, paint the slope's tiles without `solid` and put a still **Body** over
them with a polygon **Shape** in the slope's outline; bodies moved with
`move()` walk up slopes as steep as their `slope` setting
([Physics](physics.md)).

The tileset file format is in [File formats](formats.md#tilesets).

<!-- piece:Tiles -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `tileset` | resource | "" | The .tileset file: a picture cut into tiles, with settings such as solid. |
| `solid` | bool | true | Tiles marked solid block bodies. Off makes every tile just decoration. |
| `castShadows` | bool | false | Tiles marked solid block Lights that have shadows on. |
| `animate` | bool | true | Animated tiles play. Off freezes them on the frame they show. |

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
| `newPathGrid(options?)` | A grid for finding paths through these tiles (solid tiles are solid cells): grid:findPoints(x, y, toX, toY). It follows setTile(). |
| `setTerrain(column, row, terrain)` | Paints a terrain of the tileset (by name; nil erases) in a cell and re-picks the tiles of the 8 cells around it so the edges fit. |
| `getTerrain(column, row)` | The name of the terrain the cell's tile belongs to, or nil. |
| `fillTerrain(column, row, columns, rows, terrain)` | Paints a terrain (nil erases) in a rectangle of cells and fits the edges, also of the cells around it. |
| `terrains()` | The names of the tileset's terrains. |
<!-- end -->
