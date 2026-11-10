# Scenes and pieces

A **scene** is one screen of your game, such as a level, a menu or a game
over screen, saved as a `.scene` file. It's a tree of **pieces**: a level
might hold the player, the ground, some coins and a camera, and the player
holds its picture and its own camera. One scene runs at a time, starting
with the project's main scene.

Scenes can be placed inside other scenes. The Platformer template's coin
is its own small scene, placed many times in the level; each copy can
change its settings, and editing the coin scene changes them all.

## Finding pieces

| | |
| --- | --- |
| `Look`, `Camera` | A child, by its name (names starting with a capital letter work like this) |
| `find("UI/Score")` | A piece by its path from this one; `..` goes up a level |
| `findDeep("Score")` | The first piece with that name anywhere inside this one |
| `findChildOfType("Sprite")` | The first child of a type |
| `parent`, `children` | The piece this one is inside; the pieces inside it |
| `root()` | The scene's top piece |
| `first("player")`, `tagged("coin")` | The first piece with a tag; every piece with it |

## Tags

Tags are labels you give pieces, like `player`, `enemy` or `coin`, so
scripts can find them and tell them apart. Add them in the Inspector, or
with `tag(name)` and `untag(name)` from a script.

`other:is("enemy")` checks for a tag, or a type (`other:is("Body")`).
`hasAnyTag("enemy, spikes")` checks several at once. Bodies and Zones also
use tags to decide what they bump into ([Physics](physics.md)).

## Making and removing pieces

`spawn` makes a new piece, from a scene file or a piece type, and adds it
to the scene:

```lua
spawn("scenes/bullet.scene", { x = x, y = y, rotation = rotation })
spawn("Text", { text = "+10", x = x, y = y - 20 })
self:spawn("scenes/hat.scene")           -- inside this piece instead

local enemy = make("scenes/enemy.scene") -- made, but not added yet
Enemies:add(enemy)

destroy()                                -- remove this piece
```

`destroy()` removes a piece and everything inside it at the end of the
frame. `remove()` takes a piece out straight away without destroying it,
so you can `add` it somewhere else.

<!-- api:Scenes -->
| Call | |
| --- | --- |
| `go(scene, ...)` | Goes to another scene. The extra values go to ready(...) of its root piece. |
| `reload()` | Starts this scene again. |
| `transition(kind, seconds, color)` | Sets how go() changes scenes: transition("fade", 0.4) or transition("none"). |
| `spawn(sceneOrType, properties, parent)` | Makes a piece and adds it to the scene (self:spawn adds it inside this piece). |
| `make(sceneOrType, properties)` | Makes a piece but does not add it to the scene. |
| `tagged(tag)` | Returns every piece with a tag. |
| `first(tag)` | Returns the first piece with a tag, or nil. |
| `root()` | Returns the root piece of the scene. |
| `camera()` | Returns the camera in use, or nil. |
| `game` | A table for the whole game. It stays when the scene changes: game.score += 1. |
| `pauseGame()` | Pauses pieces and physics (pieces with pausable off keep running). |
| `resumeGame()` | Ends the pause: pieces and physics continue. |
| `isPaused()` | Returns true while the game is paused. |
| `timeScale(scale)` | Sets how fast time goes: timeScale(0.5) is slow motion. timeScale() returns the current value. |
<!-- end -->

## Changing scenes

`go("scenes/level2.scene")` switches to another scene at the end of the
frame. Any extra values are handed to the new scene's root, in its
`ready(...)`:

```lua
go("scenes/gameover.scene", score)

-- on the game over scene's root piece
function ready(score)
  find("Score").text = `Score: {score}`
end
```

`reload()` starts the current scene again. `transition("fade", 0.4)` makes
scene changes fade through black (or another color:
`transition("fade", 0.4, {1, 1, 1})`), and `transition("none")` goes back
to instant cuts.

## The game table

Everything in a scene is gone when it ends. `game` is a table every script
can use that lasts for the whole time the game runs, which makes it the
place for things like lives and score:

```lua
game.lives = (game.lives or 3) - 1
```

To keep something after the game closes, [save](saving.md) it.

## Pausing and slow motion

`pauseGame()` stops pieces' `update` and `physicsUpdate`, physics,
animations, timers and tweens; the screen still draws and UI still
responds. Pieces whose **pausable** setting is off, and everything inside
them, keep running, so put your pause menu inside one:

```lua
-- on a Group with pausable off, holding the pause menu
function update(dt)
  if pressed("pause") then
    if isPaused() then resumeGame() else pauseGame() end
    visible = isPaused()
  end
end
```

`timeScale(0.5)` runs the game at half speed for a slow-motion moment, and
`timeScale(1)` puts it back. Music keeps playing normally through both.

## Every piece

<!-- piece:Piece -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `pausable` | bool | true | When this is on, the piece stops while the game is paused. When it is off, this piece and its children keep running (for pause menus). |

| Method | |
| --- | --- |
| `find(path)` | Returns a child by name, or a piece deeper inside by path ("UI/Score"). Returns nil if there is no such piece. |
| `findDeep(name)` | Returns the first piece with this name at any depth inside this piece. |
| `findChildOfType(type)` | Returns the first child of a piece type ("Sprite"), or nil. |
| `isA(type)` | Returns true if the piece is of a piece type, or of a type that extends it. |
| `add(piece)` | Adds a piece as the last child and returns it. |
| `remove()` | Takes the piece out of its parent now, but does not destroy it. |
| `spawn(sceneOrType, properties?)` | Makes a piece from a scene file or a piece type and adds it as a child. |
| `destroy()` | Removes the piece and everything inside it at the end of the frame. |
| `tag(name)` | Adds a tag. |
| `untag(name)` | Removes a tag. |
| `hasTag(name)` | Returns true if the piece has the tag. |
| `hasAnyTag(tags)` | Returns true if the piece has one or more of the tags in a comma-separated list: hasAnyTag("enemy, spikes"). |
| `is(tagOrType)` | Returns true if the piece has the tag or is of the piece type: other:is("enemy"), other:is("Body"). |
| `on(event, fn)` | Calls fn(...) when the piece sends the event. Returns a handle with :off(). |
| `emit(event, ...)` | Sends an event: it calls the script function with that name and every function that on() added. |
| `getPath()` | Returns the path of the piece from the root piece of the scene, for example "Level/Player". |
| `isAlive()` | Returns true while the piece is in the running scene and destroy() has not removed it. |

| Event (a function in its script) | |
| --- | --- |
| `function ready(...)` | The engine calls it when the piece and its children join the scene. The root piece of the scene gets the extra values of go(). |
| `function update(dt)` | The engine calls it every frame. dt is the time since the last frame, in seconds. |
| `function physicsUpdate(dt)` | The engine calls it 60 times a second, before bodies move. Use it for movement. |
| `function draw()` | The engine calls it every frame. Draw extra things on top of the piece here, in the piece's own coordinates. |
| `function removed()` | The engine calls it when the piece leaves the scene. |
<!-- end -->

Every piece also has `name`, `type`, `parent`, `children` and `script`.

## Position, size and drawing order

Pieces that appear in the world (Group and everything based on it) have
`x`, `y`, `rotation`, `scaleX`, `scaleY`, `visible`, `tint` and `layer`.
Positions are measured from the parent piece, and `y` grows downwards.
Higher layers draw on top.

### Angles

Every angle is in degrees, clockwise: `rotation = 90` is a quarter turn,
and 0 points right. That goes for everything a script meets: `rotation`,
`angleTo()`, a Body's `spin` (degrees a second), a Joint's `minAngle`, a
Particles piece's `direction`, and the Inspector shows the same numbers.

```lua
rotation = angleTo(first("player"))           -- face the player
rotation += 180 * dt                            -- half a turn a second

-- Fly the way the piece faces: the x and y of a step at an angle.
vx, vy = smitten.math.direction(rotation, 300)

-- And back: the angle of a direction.
rotation = smitten.math.angle(vx, vy)
```

Lua's own `math.sin` and `math.cos` take radians, so give them
`math.rad(angle)`; `math.deg(radians)` goes the other way. The low-level
`smitten.graphics` calls (`rotate`, `draw`) take radians too.

<!-- piece:Group -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `x` | number (px) | 0 | The horizontal position, measured from the parent. |
| `y` | number (px) | 0 | The vertical position, measured from the parent. y increases downwards. |
| `rotation` | angle (°) | 0° | The rotation, clockwise, in degrees: 90 is a quarter turn. |
| `scaleX` | number | 1 | Multiplies the width. A negative value mirrors the piece left to right. |
| `scaleY` | number | 1 | Multiplies the height. A negative value mirrors the piece top to bottom. |
| `visible` | bool | true | When this is on, this piece and everything inside it are visible. |
| `tint` | color | {1, 1, 1, 1} | Multiplies the colors of this piece and everything inside it. |
| `layer` | int | 0 | The engine draws higher layers on top. It draws pieces on the same layer in scene order. |
| `lit` | bool | true | When this is on, Lights and the Tint change how this piece and everything inside it look. When it is off, they always have full brightness (glows, lasers, signs). |

| Method | |
| --- | --- |
| `worldPosition()` | Returns the position of the piece in the scene (not measured from its parent): x, y. |
| `setWorldPosition(x, y)` | Moves the piece to a position in the scene. |
| `toWorld(x, y)` | Takes a point measured from this piece and returns it as a point in the scene. |
| `fromWorld(x, y)` | Takes a point in the scene and returns it measured from this piece. |
| `lookAt(x, y)` | Turns the piece to face a point in the scene. |
| `distanceTo(pieceOrX, y?)` | Returns the distance in pixels to another piece or a point. |
| `angleTo(pieceOrX, y?)` | Returns the angle towards another piece or a point, in degrees. rotation = angleTo(target) turns the piece to face it. |
| `moveToward(x, y, distance)` | Moves at most distance pixels towards a point. Returns true when the piece is at the point. |
| `translate(dx, dy)` | Moves the piece by an offset. |
<!-- end -->

## smitten.scene

<!-- module:scene -->
| Function | |
| --- | --- |
| `smitten.scene.go(path, ...)` | Goes to another scene at the end of the frame: smitten.scene.go("scenes/level2.scene"). |
| `smitten.scene.reload()` | Starts the running scene again from its file. |
| `smitten.scene.make(sceneOrType, properties?, script?)` | Makes a piece but does not add it to the scene: make("scenes/coin.scene") or make("Sprite", { image = "art/coin.png" }). |
| `smitten.scene.spawn(sceneOrType, properties?, parent?)` | Makes a piece and adds it to the scene (or to parent): spawn("scenes/bullet.scene", { x = 10 }). |
| `smitten.scene.tagged(tag)` | Returns every piece with a tag, as a list. |
| `smitten.scene.first(tag)` | Returns the first piece with a tag, or nil. |
| `smitten.scene.find(path)` | Returns a piece of the running scene by its path from the root piece. |
| `smitten.scene.screenToWorld(x, y)` | Takes a point on the screen and returns it as a point in the scene (through the camera). |
| `smitten.scene.worldToScreen(x, y)` | Takes a point in the scene and returns it as a point on the screen. |
| `smitten.scene.setCurrent(root)` | Makes a piece that a script builds the running scene. |
| `smitten.scene.getDelta()` | Returns the length of the current step: the frame time in update(), the fixed step in physicsUpdate(). |
| `smitten.scene.transition(kind, seconds?, color?)` | Sets how go() and reload() change scenes: transition("fade", 0.4) or transition("none"). |
| `smitten.scene.isChanging()` | Returns true while the scene is about to change or a transition runs. |
| `smitten.scene.runsWhilePaused(piece)` | Returns true if a piece keeps running while the game is paused (pausable is off on it, or on a piece that it is inside). |

Fields: `current`, `path`, `args`, `paused`, `timeScale`, `showShapes`.
<!-- end -->
