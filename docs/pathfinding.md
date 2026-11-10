# Pathfinding

`smitten.paths` finds a way from one place to another: around walls,
through a maze, along roads. It gives you building blocks, not an enemy
that is ready to use. A pathfinder tells you which way to go. Your script
decides what to do with that answer.

There are three pathfinders. Choose one for the type of level that you
make:

| Your level | Use | How to make it |
| --- | --- | --- |
| Tiles, or a different square grid | A **grid** | `Tiles:newPathGrid()` or `smitten.paths.newGrid()` |
| Some places with routes between them that you choose: waypoints, rooms, a road map | A **graph** | `smitten.paths.newGraph()` |
| Open ground that walkers can go across freely, with obstacles | **Walkable** pieces | Draw them in the editor. Then use `smitten.paths.findPath()` |

You can use more than one pathfinder in a game. For example, use a graph
to go from town to town, and a grid in a dungeon.

**A path is always a flat list of points**, `{x1, y1, x2, y2, ...}`, from
the start to the end. It has the same form as the `points` of a Shape.
When there is no way, you get `nil`.

```lua
local path = grid:findPoints(x, y, Player.x, Player.y)
if path then
  for i = 1, #path, 2 do
    print(path[i], path[i + 1])
  end
end
```

`smitten.paths` does not move pieces, does not look for the player, and
does not decide when to stop. Your script does these things, in some
lines of code (see the examples below).

## Grids

A grid has columns and rows of cells, and each cell is open or solid. The
cell numbers are the same as in a Tiles piece: the first cell is column 0,
row 0.

### From a Tiles piece

```lua
local grid = Maze:newPathGrid()
```

Solid tiles become solid cells, and all other cells are open. The grid
covers the painted area. The grid follows the changes to the tiles. After
`Maze:setTile(...)`, `fill()` or `clear()`, the next search sees the
change. The grid changes positions through the Tiles piece. Because of
this, the grid continues to fit when you move or scale the piece.

| Option | |
| --- | --- |
| `diagonals` | `"never"` (the default: up, down, left, right), `"always"`, or `"noCorners"`. With `"noCorners"`, a path can go diagonally, but it never goes across the corner of a solid cell |
| `heuristic` | How the search estimates the remaining distance: `"manhattan"`, `"octile"`, `"euclidean"` or `"chebyshev"`. The default is correct for the `diagonals` that you use. Do not change it, unless you know that you need a different one |
| `empty` | `"open"` (the default) or `"solid"`: whether walkers can go on cells that have no tile. Use `"solid"` when you paint the floor, not the walls |
| `solid` | Your own rule: `function(tiles, tile, info) return info.wall == true end`. `info` has the tile properties of the tile |
| `cost` | The name of the tile property that tells the cost of a tile (default `"cost"`) |
| `margin` | Open cells to add around the painted area (default 0) |
| `column`, `row`, `columns`, `rows` | Cover this rectangle of cells, not the painted area |

You can give a tile a `cost` tile property in the tileset: a number more
than 0. Then a path through that tile costs that many times more. For
example, mud has a `cost` of 3. A path goes through the mud only if the
way around it is more than three times as long.

One-way tiles (`oneWay`) are open cells. A grid cannot know in which
direction a walker goes through them. If this is important, give the grid
your own cost function (see below), and make it stop the steps that you do
not want.

### By hand

```lua
local grid = smitten.paths.newGrid(40, 30, { cellSize = 16, x = 0, y = 0 })
grid:fillSolid(10, 0, 1, 20)        -- a wall
grid:setCost(3, 4, 5)               -- a swamp cell
```

The options are:

- `cellSize` (or `cellWidth` and `cellHeight`).
- `x` and `y`: the position in the scene of the top-left corner of the
  first cell.
- `firstColumn` and `firstRow`: the numbers of the first cell (0 by
  default).
- `diagonals` and `heuristic`, as above.

### What a grid can do

| | |
| --- | --- |
| `grid:findPath(fromColumn, fromRow, toColumn, toRow, options)` | The path with the lowest cost, as cells: `{column, row, column, row, ...}`, or `nil` |
| `grid:findPoints(x1, y1, x2, y2, options)` | The same, between two points in the scene, as the centers of the cells: `{x, y, x, y, ...}`, or `nil`. A point outside the grid is the same as the nearest cell on the edge of the grid |
| `grid:setSolid(column, row, solid)`, `grid:isSolid(column, row)` | Make a cell solid or open, or get which it is. Cells outside the grid are solid |
| `grid:fillSolid(column, row, columns, rows, solid)` | Make a rectangle of cells solid or open |
| `grid:setCost(column, row, cost)`, `grid:getCost(column, row)` | The cost of a step into a cell (1 is usual) |
| `grid:clear()` | Make all cells open, and set all costs to 1 |
| `grid:contains(column, row)` | Whether the grid has that cell |
| `grid:cellAt(x, y)`, `grid:cellCenter(column, row)` | Change a position in the scene to a cell, and a cell to a position |
| `grid:refresh()` | (Grids from Tiles only) Read all the tiles again. You almost never need this, because the grid already follows the changes from `setTile` and `fill`. It removes the changes that you made with `setSolid` and `setCost` |
| `grid.columns`, `grid.rows`, `grid.cellWidth`, `grid.cellHeight` | Its size |

With `{ partial = true }`, a search that cannot get to the goal does not
give `nil`. It gives the path to the cell that is nearest to the goal and
that the search can get to. For example, an enemy walks to the locked door
and does not stand still.

If you ask for a cell that the grid does not have, you get an error. The
error tells which cells the grid has. A path can start in a solid cell, so
a walker that something pushes into a wall can find its way out. A solid
goal has no path, unless `partial` is on.

### Your own rules

`grid.cost` replaces the cost of a step. It can also stop a step:

```lua
-- Do not step down from a ledge (a one-way drop). Water costs two times more.
grid.cost = function(fromColumn, fromRow, toColumn, toRow)
  if Maze:getTile(toColumn, toRow) == LEDGE and toRow < fromRow then return nil end
  return if Maze:getTile(toColumn, toRow) == WATER then 2 else 1
end
```

Return a number more than 0, or return `nil` to stop the step.

`grid.estimate = function(column, row, goalColumn, goalRow)` replaces the
estimate of the remaining cost. The estimate must never be too high. If it
is too high, the paths do not always have the lowest cost.

To use the built-in functions again, set `grid.cost` and `grid.estimate`
to `nil`.

## Graphs

A graph is a set of points that you put and connect yourself. The path
follows the connections, so walkers go only where you permit: along a
road, from door to door, between platforms.

```lua
local graph = smitten.paths.newGraph()
graph:addPoint("gate", 80, 60)
graph:addPoint("well", 240, 60)
graph:addPoint("barn", 240, 200)
graph:connect("gate", "well")
graph:connect("well", "barn")

local ids = graph:findPath("gate", "barn")       -- {"gate", "well", "barn"}
local path = graph:findPoints("gate", "barn")    -- {80, 60, 240, 60, 240, 200}
```

The id of a point can be any number or name. An easy way to put the
points is with marker pieces. Put them in the scene, and read them when
the game starts:

```lua
for _, marker in ipairs(tagged("waypoint")) do
  graph:addPoint(marker.name, marker.x, marker.y)
end
```

| | |
| --- | --- |
| `graph:addPoint(id, x, y, weight)` | Adds a point (or moves the point with that id). `weight` makes a step to the point cost more. 1 is usual |
| `graph:removePoint(id)`, `graph:hasPoint(id)`, `graph:clear()` | |
| `graph:connect(a, b, bothWays)`, `graph:disconnect(a, b, bothWays)` | In the two directions, unless `bothWays` is `false`. If it is `false`, only from `a` to `b` (a drop, a one-way street) |
| `graph:isConnected(a, b)` | Whether a walker can go directly from `a` to `b` |
| `graph:setDisabled(id, disabled)`, `graph:isDisabled(id)` | Paths do not use a disabled point until you enable it again. Use this for a locked door |
| `graph:setWeight(id, weight)`, `graph:getWeight(id)` | |
| `graph:getPosition(id)`, `graph:setPosition(id, x, y)` | |
| `graph:points()`, `graph:neighbors(id)` | All the ids. The ids that a point connects to |
| `graph:closestPoint(x, y)` | The id of the nearest point that is not disabled |
| `graph:closestPosition(x, y)` | The nearest position on a connection: `x, y`, then the two ids at the ends of that connection |
| `graph:findPath(a, b, options)` | The path with the lowest cost, as ids, or `nil` |
| `graph:findPoints(a, b, options)` | The same, as positions: `{x, y, x, y, ...}` |

`{ partial = true }` works as on grids. If you type an id incorrectly, you
get an error. The error tells you the id that you possibly wanted.

Usually, the cost of a step is its length, multiplied by the weight of the
point that the step goes to. `graph.cost = function(fromId, toId)`
replaces the length. Return `nil` from it to stop the step.
`graph.estimate = function(id, goalId)` replaces the estimate of the
remaining cost. These functions are for graphs where the distance on the
screen is not important: a subway map, a tech tree, a conversation.

## Walkable areas

For ground that walkers can go across freely, draw the area where they can
walk:

1. Add a **Walkable** piece (Add a piece › Bodies and zones).
2. Select it.
3. Change the shape of its polygon:
   - To move a corner, drag it.
   - To add a corner, drag the small dot in the middle of an edge.
   - To remove a corner, drag it onto the corner next to it.

You can also type the `points` in the Inspector.

- When Walkable pieces overlap, or have an edge in common, they join into
  one area. Make them overlap a small distance. Do not try to align them
  exactly by eye.
- A Walkable with `hole` on removes its shape from the area: for pillars,
  ponds, furniture.
- With `active` off, the Walkable is not part of the area for a time. Use
  this for a bridge that is up, or a door that is shut (a hole across the
  door).
- You can move, turn and scale Walkable pieces as all other pieces, also
  while the game runs. The engine calculates the area again the next time
  that a script uses it.

Then use this function in a script:

```lua
local path = smitten.paths.findPath(x, y, targetX, targetY)
```

The path goes in a straight line where it can. It turns at the corners of
walls and holes. If the start or the target is outside the area, the path
uses the nearest point in the area. Because of this, a click at an
incorrect place also gets a path.

<!-- module:paths -->
| Function | |
| --- | --- |
| `smitten.paths.newGrid(columns, rows, options?)` | Makes a grid of open and solid cells to find paths through: newGrid(40, 30, { cellSize = 16, diagonals = "noCorners" }). A Tiles piece makes its own grid with newPathGrid(). |
| `smitten.paths.newGraph()` | Makes an empty graph: you add points and connect them, and it finds paths along the connections. |
| `smitten.paths.newArea(areas, holes?)` | Makes a walkable area from polygons, with holes cut out of them: newArea({ { 0, 0, 400, 0, 400, 300, 0, 300 } }, { hole }). |
| `smitten.paths.newAgent(options?)` | Makes an agent that follows paths: it keeps a target and tells you the next point to go to. options: finder, reach, replan, partial, tags. finder is a grid, graph or area (the Walkable pieces of the scene if you leave it out). |
| `smitten.paths.findPath(x1, y1, x2, y2, options?)` | Returns a short path between two points through the Walkable pieces of the scene: {x, y, x, y, ...}, or nil. options: tags, partial. |
| `smitten.paths.closestPoint(x, y, options?)` | Returns the walkable point that is nearest to a point: x, y. |
| `smitten.paths.isWalkable(x, y, options?)` | Returns true if a point is inside a Walkable piece and not in a hole. |
| `smitten.paths.getArea(options?)` | Returns the area that the engine makes from the Walkable pieces of the scene. |
| `smitten.paths.refresh()` | Makes the walkable area of the scene again. You need it only after you change the points of a Walkable in place. |
| `smitten.paths.length(path)` | Returns the length of a path, in pixels. |
| `smitten.paths.pointAt(path, distance)` | Returns the point at a distance along a path from its start: x, y, and true if it is the end. |
| `smitten.paths.debugDraw(what?, options?)` | Draws a path, the path of an agent or an area, from the draw() function of a script. With no argument, it draws the Walkable pieces of the scene. options: color, width. |
<!-- end -->

`options` is a table:

- `tags = "land, bridge"` uses only the Walkable pieces (areas and holes)
  with one of those tags. With this, boats and people can each have their
  own ground.
- `partial = true` goes as near as possible when the walkers cannot get to
  the ground of the target.

`closestPoint`, `isWalkable` and `getArea` also accept only the tags:
`isWalkable(x, y, "land")`.

**The size of the walker.** A path touches the corners exactly, as if the
walker is a dot. Draw the areas half the width of a walker away from the
walls. Make each hole larger than the thing that it goes around, by the
same distance. Then no walker goes across a corner.

`smitten.paths.newArea(areas, holes)` makes an area from lists of
polygons, without pieces. The area has `findPath`, `closestPoint` and
`isWalkable` as methods. Use it for levels that a script makes.


## Following a path: agents

An agent keeps the target and the path to it. It tells you the next point
to go to. It never moves pieces: you move them, in the way that your game
moves things.

```lua
local agent = smitten.paths.newAgent({ finder = grid })
agent:setTarget(600, 200)

-- at each step:
local nextX, nextY = agent:next(x, y)     -- x, y: the position of the piece now
```

| Option | |
| --- | --- |
| `finder` | What finds the paths: a grid, a graph, an area, or your own `function(x1, y1, x2, y2)` that returns a path or `nil`. If you do not give a finder, the agent uses the Walkable pieces of the scene |
| `reach` | When the walker is this near to a point, in pixels, the agent goes to the next point (4). For walkers that move fast, make it larger: at least the distance that they move in one step |
| `replan` | When the target moves this distance from its position at the last plan, the agent makes a new plan (16) |
| `partial` | Go as near as possible when the agent cannot get to the target (`true`) |
| `tags` | If there is no finder: the Walkable pieces to use |

| | |
| --- | --- |
| `agent:setTarget(x, y)` | Where to go. You can call it in each frame with a target that moves |
| `agent:next(x, y)` | The point to go to from `x, y`. It removes a point from the path when `x, y` is in the `reach` distance of that point. It plans again when the target moves far, or when the grid, graph or area changes |
| `agent:isDone()` | True when the agent is at the end (or has no target) |
| `agent:isBlocked()` | True if the last plan found no way |
| `agent:path()` | The planned path, and the number of the point that the agent goes to now |
| `agent:plan(x, y)` | Plan again now |
| `agent:stop()`, `agent:getTarget()` | Remove the target. Get the target |

On a graph, an agent goes to the nearest point, then along the
connections, and stops at the point nearest to the target. On a grid, it
goes from the center of a cell to the center of the next cell.

Agents do not go around other agents or around other things that move. If
two enemies must not overlap, make them Bodies (they hit each other). Or
keep them apart with your own code.

## Examples

### An enemy that chases through a tile maze

The enemy is a scripted Body next to a Tiles piece with the name `Maze`.
The Body must be smaller than a tile.

```lua
-- scripts/ghost.lua
speed = 90

local agent

function ready()
  local grid = parent:find("Maze"):newPathGrid()
  agent = smitten.paths.newAgent({ finder = grid })
end

function physicsUpdate(dt)
  local player = first("player")
  if not player then return end
  agent:setTarget(player.x, player.y)
  local nextX, nextY = agent:next(x, y)
  local dx, dy = nextX - x, nextY - y
  local d = math.sqrt(dx * dx + dy * dy)
  if agent:isDone() or d == 0 then
    vx, vy = 0, 0
  else
    vx, vy = dx / d * speed, dy / d * speed
  end
  move()
end
```

If you remove a wall with `Maze:setTile(column, row, -1)`, the ghost
finds the new shorter way by itself. You can make the ghost stop the
chase when the player is far away, hides, or is out of sight. To do this,
add code around `setTarget`. You decide how the enemy behaves.

`x`, `y` and `player.x` are correct when the pieces are directly in the
scene. For pieces inside Groups that you moved, use `worldPosition()`.

### A guard that patrols between waypoints

Groups with the tag `waypoint` mark the places. The script connects them
in a ring. It moves the guard along the ring at a constant speed with
`pointAt`.

```lua
-- scripts/guard.lua
speed = 60

local graph = smitten.paths.newGraph()
local stops = {}
local route, walked, heading = nil, 0, 1

function ready()
  for i, marker in ipairs(tagged("waypoint")) do
    graph:addPoint(i, marker.x, marker.y)
    if i > 1 then graph:connect(i - 1, i) end
    stops[i] = i
  end
  if #stops > 2 then graph:connect(#stops, 1) end
  route = graph:findPoints(graph:closestPoint(x, y), stops[heading])
end

function update(dt)
  if not route then return end
  walked += speed * dt
  local px, py, arrived = smitten.paths.pointAt(route, walked)
  x, y = px, py
  if arrived then
    local from = stops[heading]
    heading = heading % #stops + 1
    route, walked = graph:findPoints(from, stops[heading]), 0
  end
end
```

If you remove a connection with `graph:disconnect(2, 3)`, the guard goes
to stop 3 the other way around the ring.

### Click to move across open ground

The scene has Walkable pieces. Attach this script to the character. The
character can be any piece. Here, the script moves it directly, without a
Body.

```lua
-- scripts/walker.lua
speed = 140

local agent = smitten.paths.newAgent()

function update(dt)
  if smitten.mouse.pressed(1) then agent:setTarget(mouse()) end
  if agent:isDone() then return end
  local nextX, nextY = agent:next(x, y)
  moveToward(nextX, nextY, speed * dt)
end

function draw()
  smitten.paths.debugDraw(agent)      -- shows the path while you make the game
end
```

## Drawing paths and areas

`smitten.paths.debugDraw(what)` draws a path, the path of an agent, or the
parts of an area. It draws in scene coordinates, from the `draw()` of a
script. Without `what`, it draws the walkable area of the scene as the
pathfinder sees it: cut into simple parts, without the holes. The `options` are `color = {r, g, b, a}` and `width`. The
**Shapes** switch of the editor also shows the outlines of Walkable pieces
in the game while it runs.

There are two helpers for paths:

- `smitten.paths.length(path)` gives the length of a path in pixels.
- `smitten.paths.pointAt(path, distance)` gives the point at that distance
  along the path: `x, y`, and `true` when that point is the end.

## How fast it is, and when to plan

A search costs more when it must look at more cells, points or corners.
We measured these times on a small server with two cores. One set of
times is from the engine in a browser tab (headless Chromium, with the
JIT). The other set is from plain Lua 5.1, without the JIT. The machines of
your players are different, but the proportions are almost the same.

| Search | In the browser | Plain Lua 5.1 |
| --- | --- | --- |
| Grid 100 × 100, empty, corner to corner | 2.5 ms | 1.0 ms |
| Grid 100 × 100, a maze that goes through each column | 19 ms | 27 ms |
| Grid 100 × 100, no way (looks at each cell that it can get to) | 21 ms | 28 ms |
| Grid 32 × 32, the same maze | | 2.3 ms |
| Grid 200 × 200, the same maze | | 120 ms |
| Graph of 900 points, corner to corner | | 1.9 ms |
| Walkable area with 48 holes: making it | 45 ms | 13 ms |
| Walkable area with 48 holes: one path across it | 1.7 ms | 0.7 ms |

`lua5.1 tools/paths-tests/test.lua time` runs these searches in plain Lua.
`tools/scene-tests/paths` shows the times in the browser. At 60 frames a
second, one frame is 16.7 ms.

This is what the times mean for a game:

- **Do not plan in each frame.** An agent already waits until the target
  moves `replan` pixels. If you have many enemies, make `replan` larger.
  Or let each enemy plan at a different time.
- **A search that finds no way is the slow one.** It looks at each cell
  that it can get to before it stops. On large grids, do not ask again and
  again for a target that has walls all around it. An agent does not do this: it
  asks again only when the target moves or the grid changes.
- **The engine makes Walkable areas again in full** when a Walkable piece
  moves or changes. If a door opens from time to time, this is not a
  problem. If a hole moves in each frame, the cost is too high. For things that move all the
  time, use Bodies and let the walker hit them, or use a grid.
- Grids, graphs and agents use their working memory again. A search makes
  no garbage, except the path that it returns.

## Limits

- A path on a grid goes through the centers of the cells, so it turns in
  steps. On open ground, Walkable pieces give smoother paths.
- A path through Walkable pieces is the shortest path through the parts
  that the search chose. It is almost always the shortest path of all. We
  compared it with the true shortest path in random rooms. In these tests,
  99% of the paths were less than 2% longer, and the worst path was 9%
  longer.
- If the edges of a Walkable polygon cross each other, the polygon has no
  clear inside. Then the results are not defined. Areas that almost touch
  do not join.
- There is no walker size (draw the areas smaller), no avoidance of other
  walkers, and no links for jumps or falls between areas. Make these from
  a graph, or from the cost function of a grid.
- If you change the `points` of a Walkable directly (`points[1] = 5`), the
  engine does not see the change. Set a new list, or call
  `smitten.paths.refresh()`.
