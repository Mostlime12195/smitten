# Tiles

A **Tiles** piece is a grid of cells that you paint with tiles from a
tileset. A tileset is a picture with a grid of squares, and each square
is one tile. Each tile can have **tile properties**. For example:

- `solid`: the tile blocks bodies.
- `oneWay`: the tile is solid only from above.
- A tile property of your own, such as `damage`.

You paint the tiles in the
scene view. Scripts can read and change the cells while the game runs:
for blocks that break, for doors, or for levels that a script makes.

Cell numbers are columns and rows from the position of the Tiles piece.
The top-left cell is (0, 0), and negative numbers are also correct. Each
cell holds a tile number or -1. Tile numbers start at 0 and count across
the tileset picture. The number -1 means that the cell is empty.

## Reading and changing cells

| | |
| --- | --- |
| `getTile(column, row)`, `setTile(column, row, tile)` | Get or change one cell. The tile -1 empties the cell |
| `fill(column, row, columns, rows, tile)` | Fill a rectangle of cells |
| `clear()` | Empty all cells |
| `cellsWith(tile)` | All painted cells (or all cells with that tile), as `{column, row, tile}` |
| `neighbors(column, row, diagonal)` | The cells next to one cell, as `{column, row, tile}` |
| `tileInfo(tile)` | The tile properties of a tile: `solid`, `name`, `damage`... |
| `isSolid(column, row)` | Whether the tile in that cell is solid |

When you change a cell, a solid tile in it blocks bodies immediately.

## Cells and positions

| | |
| --- | --- |
| `cellAt(x, y)` | The cell at a point in the scene |
| `tileAt(x, y)` | The tile at a point, or -1 |
| `cellPosition(column, row)`, `cellCenter(column, row)` | The corner or the center of a cell, in the scene |
| `getTileSize()` | The size of one cell in the scene |
| `getBounds()` | The painted area: x, y, width, height |

You can paint marker tiles in the Tiles piece and change them into pieces
when the level starts:

```lua
-- Change each coin tile (tile 7) into a coin piece
function ready()
  for _, c in ipairs(Level:cellsWith(7)) do
    local cx, cy = Level:cellCenter(c.column, c.row)
    spawn("scenes/coin.scene", { x = cx, y = cy })
    Level:setTile(c.column, c.row, -1)
  end
end
```

## Finding paths through tiles

`newPathGrid()` makes a grid that knows which cells are solid. Use it to
find the way through a maze of tiles. The grid follows the changes that
`setTile()`, `fill()` and `clear()` make. [Pathfinding](pathfinding.md)
tells you more about grids.

```lua
local grid = Level:newPathGrid()
local path = grid:findPoints(x, y, Player.x, Player.y)   -- {x, y, x, y, ...} or nil
```

## Touching tiles

When a Body hits solid tiles, the engine calls its `hit(other)` with the
Tiles piece as `other`. `touchingTile(setting)` gives the tile properties
of a touched tile that has the tile property `setting`. This is good for
hazards:

```lua
local t = touchingTile("damage")
if t then hurt(t.damage) end
```

When **castShadows** is on, the solid tiles block the
[Lights](lights.md#shadows) that have shadows on.

## Terrains

A **terrain** is a set of tiles that show one material in all its shapes.
The shapes are the tile that is alone, the edges, the corners and the
middle. When you
paint with a terrain, each cell gets the tile that fits the cells next to
it. A platform gets its ends and a lake gets its shore, and you do not
pick the tiles yourself. A tileset can have many terrains (grass,
stone, water). A tile is part of one terrain only.

To make a terrain, select a Tiles piece. Then open **Terrains** at the
side of the Tiles panel, and do these steps:

1. Click **New terrain**.
2. Give the terrain a name.
3. Mark the tiles of the terrain. When **Mark its tiles** is on, each tile
   in the picture has nine parts:
   1. Click the **middle** of each tile of the terrain.
   2. Click the **sides and corners** where that tile joins more of the
      same terrain.

   For example, if the grass in a tile goes to the right side of the tile,
   mark the right side. For a tile in the middle of an area of grass, mark all the
   parts.
4. Click **Paint with it**.
5. Paint the terrain in the scene view. The brush, the rectangle, the
   bucket and the eraser fit the edges of the cells that they change. They
   also fit the edges of the cells around those cells. One stroke is one
   undo step, as with all painting.

To paint with plain tiles again, set **Paint with** to **Picked tiles**,
or pick a tile.

If your picture has one of the usual layouts (below), choose the layout in
**Fill in from a layout**. This marks the full sheet in one step. Before
you do this, pick the top-left tile of the sheet. You can also mark the
tiles of a different layout by hand.

**Neighbours that count** sets which cells around a cell change its tile:

| | A cell looks at | Different tiles |
| --- | --- | --- |
| **Sides and corners** | Its four sides. It also looks at a corner when the two sides next to that corner are the same terrain | 47 (a "blob" set) |
| **Sides** | Its four sides | 16 |
| **Corners** | Each corner. A corner counts when the three cells around that corner are the same terrain | 16 (a 2 × 2 or "wang corner" set) |

If two or more tiles have the **same marks**, they are variants. Each cell
picks one variant from its position. Because of this, a cell always shows
the same variant, and the tiles do not flicker. A set that does not have all its
tiles also works. In that case, a cell gets the nearest tile that the set
has. A wrong side counts more than a wrong corner.

### The layouts

Here, each tile shows its nine parts. A `#` is a part with the terrain,
and a `.` is a part without it. The middle is always `#`.

**16 tiles, 4 × 4 (sides)**: a column, a block of 3 × 3 and a row.

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

**16 tiles, 4 × 4 (corners)**: all the mixes of the four corners, in
reading order. Each corner has a number: up-right 1, down-right 2,
down-left 4, up-left 8. The first tile has no corner, and the last tile
has all four.

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

**47 tiles, 8 × 6 (sides and corners)**: the 47 blob tiles, in the
sequence of their numbers. Each part of a tile has this number:

```
 128 |  1 |  2
 ----+----+----
  64 |    |  4
 ----+----+----
  32 | 16 |  8
```

The number of a tile is the sum of the parts where the terrain continues.
This is the tile numbering of the well-known "blob" tileset. This is the
sheet, in reading order. The last square has no tile:

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
| `setTerrain(column, row, terrain)` | Paints a terrain (by name) in a cell, and fits the 8 cells around it. `nil` erases |
| `fillTerrain(column, row, columns, rows, terrain)` | The same for a rectangle of cells |
| `getTerrain(column, row)` | The name of the terrain in a cell, or `nil` |
| `terrains()` | The names of the terrains of the tileset |

```lua
-- Make a hole where the player clicks. The grass around it gets new edges.
function update(dt)
  if pressed("mouse:1") then
    local column, row = Level:cellAt(mouse())
    Level:setTerrain(column, row, nil)
  end
end
```

```lua
-- A random cave. All its walls fit.
function ready()
  Level:fillTerrain(0, 0, 60, 40, "rock")
  for i = 1, 400 do
    Level:setTerrain(math.random(1, 58), math.random(1, 38), nil)
  end
end
```

`setTile` is exact: it puts the tile that you give in the cell, and it does
not change the cells next to it. Cells hold only tile numbers. The terrain of a
cell comes from its tile. Because of this, maps do not need new data, and
you can add terrains to a tileset later.

## Animated tiles

A tile can be an **animation**: it shows other tiles in turn. Use this for
water, lava, torches or conveyor belts. To make an animated tile:

1. In the Tiles panel, open **Animation**.
2. Drag across the animation frames in the picture, from the first to the
   last.
3. Click **Animate with these tiles**.

You paint with the first tile. The tile properties of the first tile
(`solid`, `damage`...) are the ones that count. The picture shows the
animation.

| | |
| --- | --- |
| **Frames** | The tiles that it shows, in sequence |
| **Frames a second** | The speed, when all animation frames have the same time |
| **Seconds for each frame** | A different time for each animation frame, for example `0.8, 0.1, 0.1` |
| **Random start** | Each cell starts at a different point of the loop, so that a lake does not move in one wave |

Animated tiles use the clock of the game: they stop while the game pauses,
and they go slower with `timeScale()`. The **animate** property of the
Tiles piece stops all of them: `Level.animate = false` stops them on the
animation frame that they show. Between changes of animation frame, they use
no time, for any number of animated tiles.

## Slopes

Tiles are square: a solid tile blocks its full cell. For a ramp or a hill,
do these steps:

1. Paint the tiles of the slope without `solid`.
2. Put a still **Body** over them.
3. In the Body, put a polygon **Shape** with the outline of the slope.

Bodies that move with `move()` go up slopes that are not steeper than
their `slope` property ([Physics](physics.md)).

The file format of tilesets is in [File formats](formats.md#tilesets).

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
