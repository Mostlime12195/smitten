# Pathfinding

`smitten.paths` finds a way from one place to another: round walls, through
a maze, along roads. It gives you building blocks, not a ready-made enemy:
a pathfinder answers "which way?", and your script decides what to do with
the answer.

There are three pathfinders. Pick by how your level is made:

| Your level | Use | Made with |
| --- | --- | --- |
| Tiles, or anything on a square grid | A **grid** | `Tiles:newPathGrid()` or `smitten.paths.newGrid()` |
| A few places joined by routes you choose: waypoints, rooms, a road map | A **graph** | `smitten.paths.newGraph()` |
| Open ground to cross freely, with things in the way | **Walkable** pieces | Drawn in the editor; `smitten.paths.findPath()` |

They can be mixed: a graph for getting from town to town, a grid inside a
dungeon.

**A path is always a flat list of points**, `{x1, y1, x2, y2, ...}`, the
same shape as a Shape's `points`, from the start to the end. When there's
no way, you get `nil`.

```lua
local path = grid:findPoints(x, y, Player.x, Player.y)
if path then
  for i = 1, #path, 2 do
    print(path[i], path[i + 1])
  end
end
```

Nothing in `smitten.paths` moves a piece, looks for the player or decides
when to give up: that's your script's job, and it's a few lines (below).

## Grids

A grid is columns and rows of cells that are open or solid. Cells are
numbered like a Tiles piece's: the first is column 0, row 0.

### From a Tiles piece

```lua
local grid = Maze:newPathGrid()
```

Solid tiles become solid cells, everything else is open, and the grid
covers the painted area. It keeps up with the tiles: after
`Maze:setTile(...)`, `fill()` or `clear()`, the next search sees the
change. Positions go through the Tiles piece, so the grid still fits if
the piece is moved or scaled.

| Option | |
| --- | --- |
| `diagonals` | `"never"` (the default: up, down, left, right), `"always"`, or `"noCorners"` (diagonal steps, but never squeezing past the corner of a solid cell) |
| `heuristic` | How the search guesses the distance left: `"manhattan"`, `"octile"`, `"euclidean"` or `"chebyshev"`. The default suits `diagonals`; leave it alone unless you know you want another |
| `empty` | `"open"` (the default) or `"solid"`: whether cells with no tile can be walked on. Use `"solid"` when you paint the floor rather than the walls |
| `solid` | Your own rule: `function(tiles, tile, info) return info.wall == true end`, where `info` is the tile's settings |
| `cost` | The name of the tile setting that says how costly a tile is to cross (default `"cost"`) |
| `margin` | Extra open cells around the painted area (default 0) |
| `column`, `row`, `columns`, `rows` | Cover this rectangle of cells instead of the painted area |

A tile with a `cost` setting (a number above 0; add it to the tile in the
tileset) costs that many times more to cross: mud with `cost` 3 is avoided
unless the way round is more than three times as long.

One-way tiles (`oneWay`) count as open: a grid can't know which way you're
going through them. If that matters, give the grid your own cost function
(below) that forbids the steps you don't want.

### By hand

```lua
local grid = smitten.paths.newGrid(40, 30, { cellSize = 16, x = 0, y = 0 })
grid:fillSolid(10, 0, 1, 20)        -- a wall
grid:setCost(3, 4, 5)               -- a swamp cell
```

Options: `cellSize` (or `cellWidth` and `cellHeight`), `x` and `y` (the
scene position of the first cell's top-left corner), `firstColumn` and
`firstRow` (the first cell's numbers, 0 by default), `diagonals` and
`heuristic` as above.

### What a grid can do

| | |
| --- | --- |
| `grid:findPath(fromColumn, fromRow, toColumn, toRow, options)` | The cheapest path as cells: `{column, row, column, row, ...}`, or `nil` |
| `grid:findPoints(x1, y1, x2, y2, options)` | The same between two points in the scene, as the centers of the cells: `{x, y, x, y, ...}`, or `nil`. Points outside the grid count as the nearest cell on its edge |
| `grid:setSolid(column, row, solid)`, `grid:isSolid(column, row)` | Block or open a cell. Cells outside the grid are solid |
| `grid:fillSolid(column, row, columns, rows, solid)` | Block or open a rectangle of cells |
| `grid:setCost(column, row, cost)`, `grid:getCost(column, row)` | How costly a cell is to step into (1 is normal) |
| `grid:clear()` | Open every cell, every cost back to 1 |
| `grid:contains(column, row)` | Whether the grid has that cell |
| `grid:cellAt(x, y)`, `grid:cellCenter(column, row)` | From a scene position to a cell and back |
| `grid:refresh()` | (Grids from Tiles) read every tile again. Rarely needed: changes made with `setTile` and `fill` are followed already. It undoes your own `setSolid` and `setCost` |
| `grid.columns`, `grid.rows`, `grid.cellWidth`, `grid.cellHeight` | Its size |

With `{ partial = true }`, a search that can't reach the goal returns the
path to the reachable cell nearest to it instead of `nil`: an enemy walks
up to the locked door rather than standing still.

Asking for a cell the grid doesn't have is an error that says which cells
it has. A solid start cell is fine (a walker pushed into a wall can still
find its way out); a solid goal has no path unless `partial` is on.

### Your own rules

`grid.cost` replaces how much a step costs, and can forbid it:

```lua
-- Never step down off a ledge (a one-way drop), and water costs double
grid.cost = function(fromColumn, fromRow, toColumn, toRow)
  if Maze:getTile(toColumn, toRow) == LEDGE and toRow < fromRow then return nil end
  return if Maze:getTile(toColumn, toRow) == WATER then 2 else 1
end
```

Return a number above 0, or `nil` to forbid the step. `grid.estimate =
function(column, row, goalColumn, goalRow)` replaces the guess of the cost
left; it must never guess too much, or paths stop being the cheapest. Set
them back to `nil` for the built-in ones.

## Graphs

A graph is points you place and connect yourself. The path follows the
connections, so things walk exactly where you allowed: along a road, from
door to door, between platforms.

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

A point's id is any number or name. A handy way to place points is to put
marker pieces in the scene and read them when the game starts:

```lua
for _, marker in ipairs(tagged("waypoint")) do
  graph:addPoint(marker.name, marker.x, marker.y)
end
```

| | |
| --- | --- |
| `graph:addPoint(id, x, y, weight)` | Adds a point (or moves the one with that id). `weight` makes going there cost more: 1 is normal |
| `graph:removePoint(id)`, `graph:hasPoint(id)`, `graph:clear()` | |
| `graph:connect(a, b, bothWays)`, `graph:disconnect(a, b, bothWays)` | Both ways unless `bothWays` is `false`: then only from `a` to `b` (a drop, a one-way street) |
| `graph:isConnected(a, b)` | Whether you can go straight from `a` to `b` |
| `graph:setDisabled(id, disabled)`, `graph:isDisabled(id)` | A disabled point is left out of paths until it's enabled again: a locked door |
| `graph:setWeight(id, weight)`, `graph:getWeight(id)` | |
| `graph:getPosition(id)`, `graph:setPosition(id, x, y)` | |
| `graph:points()`, `graph:neighbors(id)` | Every id; the ids a point leads to |
| `graph:closestPoint(x, y)` | The id of the nearest point (skipping disabled ones) |
| `graph:closestPosition(x, y)` | The nearest position on any connection: `x, y`, then the two ids it lies between |
| `graph:findPath(a, b, options)` | The cheapest path as ids, or `nil` |
| `graph:findPoints(a, b, options)` | The same as positions: `{x, y, x, y, ...}` |

`{ partial = true }` works as on grids. A mistyped id is an error that
suggests the one you probably meant.

A step normally costs its length times the weight of the point it goes to.
`graph.cost = function(fromId, toId)` replaces the length (return `nil` to
forbid the step), and `graph.estimate = function(id, goalId)` the guess of
what's left, for graphs where distance on screen isn't what matters: a
subway map, a tech tree, a conversation.

## Walkable areas

For ground that things cross freely, draw where they can walk. Add a
**Walkable** piece (Add a piece › Bodies and zones) and shape its polygon:
with it selected, drag a corner to move it, drag the small dot in the
middle of an edge to add a corner, and drop a corner onto its neighbour to
remove it. The `points` can also be typed in the Inspector.

- Several Walkable pieces that overlap, or share an edge, join into one
  area. Overlap them a little rather than lining them up by eye.
- A Walkable with `hole` on cuts its shape out instead: pillars, ponds,
  furniture.
- `active` off takes one out for a while: a bridge that's up, a door
  that's shut (a hole across the doorway).
- Walkable pieces move, turn and scale like any piece, also while the game
  runs; the area is worked out again the next time it's asked about.

Then, from any script:

```lua
local path = smitten.paths.findPath(x, y, targetX, targetY)
```

The path goes straight where it can and bends round the corners of walls
and holes. A start or target outside the area counts as the nearest
walkable point, so a click in the wrong place still gets a path.

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

`options` is a table: `tags = "land, bridge"` uses only the Walkable
pieces (areas and holes) with one of those tags, so boats and people can
each have their own ground; `partial = true` goes as near as possible when
the target is on ground that can't be reached. `closestPoint`,
`isWalkable` and `getArea` also take just the tags: `isWalkable(x, y,
"land")`.

**The walker's size.** A path hugs corners exactly, as if the walker were
a dot. Draw areas a walker's half-width in from the walls, and holes that
much bigger than the thing they go round, and nothing clips a corner.

`smitten.paths.newArea(areas, holes)` makes an area without pieces, from
lists of polygons, with the same `findPath`, `closestPoint` and
`isWalkable` as methods: for levels built in code.

<!-- piece:Walkable -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `points` | points | {-100, -60, 100, -60, 100, 60, -100, 60} | The corner points x1, y1, x2, y2, ... in order around the shape. It can have any number of corners, and dents are OK. |
| `hole` | bool | false | When this is on, the shape does not add to the walkable areas below it. It cuts a hole in them: a pillar, a pond, a table. |
| `active` | bool | true | When this is on, paths use it. Turn it off to close an area (or fill a hole) for a time. |
<!-- end -->

## Following a path: agents

An agent remembers where it's going and the path there, and tells you the
next point to head for. It never moves anything: you do, however your game
moves things.

```lua
local agent = smitten.paths.newAgent({ finder = grid })
agent:setTarget(600, 200)

-- every step:
local nextX, nextY = agent:next(x, y)     -- x, y: where the piece is now
```

| Option | |
| --- | --- |
| `finder` | What finds the paths: a grid, a graph, an area, or your own `function(x1, y1, x2, y2)` that returns a path or `nil`. Left out: the scene's Walkable pieces |
| `reach` | How near a point counts as reached, in pixels (4). Make it bigger for fast movers: at least the distance covered in one step |
| `replan` | The path is planned again once the target has moved this far from where it was planned to (16) |
| `partial` | Go as near as possible when the target can't be reached (`true`) |
| `tags` | With no finder: which Walkable pieces to use |

| | |
| --- | --- |
| `agent:setTarget(x, y)` | Where to go. Fine to call every frame with a moving target |
| `agent:next(x, y)` | The point to head for from `x, y`. It drops points as you get within `reach` of them, and plans again when the target has moved far or the grid, graph or area has changed |
| `agent:isDone()` | True once the end is reached (or there's no target) |
| `agent:isBlocked()` | True if the last plan found no way |
| `agent:path()` | The planned path, and the number of the point it's heading for |
| `agent:plan(x, y)` | Plan again now |
| `agent:stop()`, `agent:getTarget()` | Forget the target; read it |

Over a graph, an agent walks to the nearest point, along the connections,
and stops at the point nearest the target. Over a grid it goes from cell
center to cell center.

Agents don't steer round each other or round other moving things. If two
enemies should not overlap, make them Bodies (they'll bump) or keep them
apart in your own code.

## Examples

### An enemy that chases through a tile maze

A scripted Body next to a Tiles piece called `Maze`. The Body should be
smaller than a tile.

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

Break a wall with `Maze:setTile(column, row, -1)` and the ghost takes the
new shortcut by itself. To make it give up when the player is far, hide
or lose the trail, add that around `setTarget`: it's your enemy.

(`x`, `y` and `player.x` are right when the pieces sit directly in the
scene. For pieces inside moved Groups, use `worldPosition()`.)

### A guard that patrols between waypoints

Groups tagged `waypoint` mark the places; the script joins them in a ring
and walks the guard along at a steady speed with `pointAt`.

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

Cut a connection with `graph:disconnect(2, 3)` and the guard reaches stop
3 the other way round the ring.

### Click to move across open ground

The scene has Walkable pieces; this goes on the character (any piece: here
it's moved directly, with no Body).

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
  smitten.paths.debugDraw(agent)      -- shows the path while you build the game
end
```

## Seeing what's going on

`smitten.paths.debugDraw(what)` draws a path, an agent's path, or an area's
pieces, in scene coordinates, from any script's `draw()`. With nothing, it
draws the scene's walkable area the way the pathfinder sees it: cut into
simple pieces, holes removed. `options`: `color = {r, g, b, a}`, `width`.
The editor's **Shapes** switch also outlines Walkable pieces in the
running game.

Two helpers for paths: `smitten.paths.length(path)` is how long one is in
pixels, and `smitten.paths.pointAt(path, distance)` is the point that far
along it (`x, y`, and `true` once that's the end).

## How fast it is, and when to plan

A search costs more the more cells, points or corners it has to look at.
These were measured on a small two-core server: in the engine in a
browser tab (headless Chromium, with the JIT), and under plain Lua 5.1
without it. Your players' machines will differ; the proportions won't
much.

| Search | In the browser | Plain Lua 5.1 |
| --- | --- | --- |
| Grid 100 × 100, empty, corner to corner | 2.5 ms | 1.0 ms |
| Grid 100 × 100, a maze that snakes through every column | 19 ms | 27 ms |
| Grid 100 × 100, no way (looks at every reachable cell) | 21 ms | 28 ms |
| Grid 32 × 32, the same maze | | 2.3 ms |
| Grid 200 × 200, the same maze | | 120 ms |
| Graph of 900 points, corner to corner | | 1.9 ms |
| Walkable area with 48 holes: building it | 45 ms | 13 ms |
| Walkable area with 48 holes: one path across it | 1.7 ms | 0.7 ms |

(`lua5.1 tools/paths-tests/test.lua time` runs them under plain Lua;
`tools/scene-tests/paths` prints the browser ones.) A frame at 60 a second
is 16.7 ms.

What that means for a game:

- **Don't plan every frame.** An agent already waits until the target has
  moved `replan` pixels. With many enemies, raise `replan`, or give each a
  different moment to plan.
- **A search with no way is the slow one**: it looks at every cell it can
  reach before giving up. On big grids, avoid asking again and again for a
  target that's walled off (an agent doesn't: it asks again only when the
  target moves or the grid changes).
- **Walkable areas are rebuilt whole** when a Walkable piece moves or
  changes. Opening a door now and then is fine; a hole that moves every
  frame is not. For things that move all the time, use Bodies and let the
  walker bump, or a grid.
- Grids, graphs and agents reuse their working memory: a search makes no
  garbage except the path it returns.

## Limits

- A grid path goes through cell centers, so it turns in steps. On open
  ground, Walkable pieces give smoother paths.
- A path through Walkable pieces is the shortest through the pieces the
  search chose, and nearly always the shortest of all: in tests against the
  true shortest path on random rooms, 99% were within 2% of it and the
  worst was 9% longer.
- Walkable polygons whose edges cross themselves have no clear inside:
  results are undefined. Areas that almost touch aren't joined.
- No walker size (draw areas inset), no avoiding other walkers, no jumping
  or falling links between areas: build those from a graph or a grid's own
  cost function.
- Changing a Walkable's `points` in place (`points[1] = 5`) isn't noticed:
  set a new list, or call `smitten.paths.refresh()`.
