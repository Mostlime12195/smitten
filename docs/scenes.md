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
| `go(scene, ...)` | Goes to another scene; extra values go to its root's ready(...). |
| `reload()` | Starts this scene again. |
| `transition(kind, seconds, color)` | How go() changes scenes: transition("fade", 0.4) or transition("none"). |
| `spawn(sceneOrType, properties, parent)` | Makes a piece and adds it to the scene (self:spawn adds it inside this piece). |
| `make(sceneOrType, properties)` | Makes a piece without adding it anywhere. |
| `tagged(tag)` | Every piece with a tag. |
| `first(tag)` | The first piece with a tag, or nil. |
| `root()` | The scene's root piece. |
| `camera()` | The camera in use, or nil. |
| `game` | A table for the whole game, kept when the scene changes: game.score += 1. |
| `pauseGame()` | Pauses pieces and physics (pieces with pausable off keep running). |
| `resumeGame()` | Unpauses. |
| `isPaused()` | True while the game is paused. |
| `timeScale(scale)` | How fast time goes: timeScale(0.5) is slow motion; timeScale() reads it. |
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
| `pausable` | bool | true | Stops while the game is paused. Off: this piece and its children keep running (pause menus). |

| Method | |
| --- | --- |
| `find(path)` | A child by name, or a deeper piece by path ("UI/Score"); nil if there isn't one. |
| `findDeep(name)` | The first piece with this name anywhere inside this one. |
| `findChildOfType(type)` | The first child of a type ("Sprite"), or nil. |
| `isA(type)` | True if the piece is of a type, or a type made from it. |
| `add(piece)` | Adds a piece as the last child; returns it. |
| `remove()` | Takes the piece out of its parent now, without destroying it. |
| `spawn(sceneOrType, properties?)` | Makes a piece from a scene file or type and adds it as a child. |
| `destroy()` | Removes the piece and everything inside it at the end of the frame. |
| `tag(name)` | Adds a tag. |
| `untag(name)` | Takes a tag away. |
| `hasTag(name)` | True if the piece has the tag. |
| `hasAnyTag(tags)` | True if the piece has any of the tags in a comma-separated list: hasAnyTag("enemy, spikes"). |
| `is(tagOrType)` | True if the piece has the tag or is of the type: other:is("enemy"), other:is("Body"). |
| `on(event, fn)` | Calls fn(...) on an event. Returns a handle with :off(). |
| `emit(event, ...)` | Fires an event: calls the script's function of that name and every listener. |
| `getPath()` | The piece's path from the scene's root, like "Level/Player". |
| `isAlive()` | True while the piece is in the running scene and not destroyed. |

| Event (a function in its script) | |
| --- | --- |
| `function ready(...)` | The piece and its children joined the scene. The scene root gets go()'s extra values. |
| `function update(dt)` | Every frame. dt is the time since the last frame, in seconds. |
| `function physicsUpdate(dt)` | 60 times a second, before bodies move. Use it for movement. |
| `function draw()` | Draw extra things on top of the piece, in its own coordinates. |
| `function removed()` | The piece is leaving the scene. |
<!-- end -->

Every piece also has `name`, `type`, `parent`, `children` and `script`.

## Position, size and drawing order

Pieces that appear in the world (Group and everything based on it) have
`x`, `y`, `rotation` (in radians), `scaleX`, `scaleY`, `visible`, `tint`
and `layer`. Positions are measured from the parent piece, and `y` grows
downwards. Higher layers draw on top.

<!-- piece:Group -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `x` | number (px) | 0 | Position, measured from the parent. |
| `y` | number (px) | 0 | Position, measured from the parent. y grows downwards. |
| `rotation` | angle | 0° | Turn, clockwise: radians in code, degrees in the inspector. |
| `scaleX` | number | 1 | Width multiplier. Negative mirrors it. |
| `scaleY` | number | 1 | Height multiplier. Negative flips it. |
| `visible` | bool | true | Show this piece and everything inside it. |
| `tint` | color | {1, 1, 1, 1} | Multiplies the colors of this piece and everything inside it. |
| `layer` | int | 0 | Higher layers are drawn on top. Pieces on the same layer draw in scene order. |
| `lit` | bool | true | Lights and the Tint change how this piece and everything inside it looks. Off: always at full brightness (glows, lasers, signs). |

| Method | |
| --- | --- |
| `worldPosition()` | Where the piece is in the scene (not measured from its parent): x, y. |
| `setWorldPosition(x, y)` | Moves the piece to a place in the scene. |
| `toWorld(x, y)` | A point measured from this piece, as a point in the scene. |
| `fromWorld(x, y)` | A point in the scene, measured from this piece. |
| `lookAt(x, y)` | Turns the piece to face a point in the scene. |
| `distanceTo(pieceOrX, y?)` | Distance in pixels to another piece or a point. |
| `angleTo(pieceOrX, y?)` | Angle in radians towards another piece or a point. |
| `moveToward(x, y, distance)` | Moves at most distance pixels towards a point; true once it's there. |
| `translate(dx, dy)` | Moves the piece by an offset. |
<!-- end -->

## smitten.scene

<!-- module:scene -->
| Function | |
| --- | --- |
| `smitten.scene.go(path, ...)` | Goes to another scene at the end of the frame: smitten.scene.go("scenes/level2.scene"). |
| `smitten.scene.reload()` | Starts the running scene again from its file. |
| `smitten.scene.make(sceneOrType, properties?, script?)` | Makes a piece without adding it: make("scenes/coin.scene") or make("Sprite", { image = "art/coin.png" }). |
| `smitten.scene.spawn(sceneOrType, properties?, parent?)` | Makes a piece and adds it to the scene (or to parent): spawn("scenes/bullet.scene", { x = 10 }). |
| `smitten.scene.tagged(tag)` | Every piece with a tag, as a list. |
| `smitten.scene.first(tag)` | The first piece with a tag, or nil. |
| `smitten.scene.find(path)` | A piece of the running scene by its path from the root. |
| `smitten.scene.screenToWorld(x, y)` | A point on the screen as a point in the scene (through the camera). |
| `smitten.scene.worldToScreen(x, y)` | A point in the scene as a point on the screen. |
| `smitten.scene.setCurrent(root)` | Makes a piece built in code the running scene. |
| `smitten.scene.getDelta()` | The current step's length: the frame time in update(), the fixed step in physicsUpdate(). |
| `smitten.scene.transition(kind, seconds?, color?)` | How go() and reload() change scenes: transition("fade", 0.4) or transition("none"). |
| `smitten.scene.isChanging()` | True while the scene is about to change or a transition is running. |
| `smitten.scene.runsWhilePaused(piece)` | True if a piece keeps running while the game is paused (pausable off on it or a piece it's inside). |

Fields: `current`, `path`, `args`, `paused`, `timeScale`, `showShapes`.
<!-- end -->
