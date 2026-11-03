# Scenes and pieces

A scene is a tree of pieces saved in a `.scene` file. The game runs one
scene at a time; the project's main scene (Project settings) runs first.
Scenes nest: a coin scene can be placed twenty times in a level, and each
placed copy can change its properties.

## Finding pieces

| | |
| --- | --- |
| `Look`, `Camera` | A child by its (capitalized) name, in the piece's own script |
| `find("UI/Score")` | A piece by path from this piece; `..` goes up a level |
| `findDeep("Score")` | The first piece with that name anywhere inside this one |
| `findChildOfType("Sprite")` | The first child of a type |
| `parent`, `children` | The piece around this one; the list of pieces inside it |
| `root()` | The scene's root piece |
| `first("player")`, `tagged("coin")` | The first piece with a tag; every piece with it |
| `smitten.scene.find("Level/Player")` | A piece by path from the root |

## Tags

Tags group pieces: `player`, `enemy`, `coin`. Give them in the Inspector or
with `tag("enemy")`; `untag(name)` takes one away.
`other:is("enemy")` is true for a tag or a type (`other:is("Body")`),
`hasAnyTag("enemy, spikes")` for any of several. Zones and Bodies filter
what they notice by tag (`detects`, `passThrough`).

## Making and removing pieces

```lua
local bullet = spawn("scenes/bullet.scene", { x = x, y = y, rotation = rotation })
local label = spawn("Text", { text = "+10", x = x, y = y - 20 })
self:spawn("scenes/hat.scene")        -- inside this piece
local later = make("scenes/enemy.scene")  -- made, not in the scene yet
Enemies:add(later)
destroy()                             -- this piece, at the end of the frame
```

`spawn(sceneOrType, properties, parent)` makes a piece from a scene file or
a piece type and adds it to the scene (or to `parent`). `make` makes one
without adding it; `add(piece)` puts it inside another. `destroy()` removes
a piece and everything inside it at the end of the frame (`isAlive()` is
false from then on); `remove()` takes it out now without destroying it, to
add it somewhere else.

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

`go("scenes/level2.scene")` changes scene at the end of the frame. Extra
values reach the new scene root's `ready(...)` (and stay in
`smitten.scene.args`):

```lua
-- In the level
go("scenes/gameover.scene", score, "fell")

-- scenes/gameover.lua, on the game over scene's root
function ready(score, reason)
  find("Score").text = `Score: {score}`
end
```

`reload()` starts the scene again with the same values.

### Transitions

`transition("fade", 0.4)` makes every later `go()` and `reload()` fade to
black, change the scene, and fade back in; `transition("fade", 0.4, {1, 1, 1})`
fades through white, `transition("none")` cuts. The old scene keeps
running while it fades out. `smitten.scene.isChanging()` is true from the
`go()` until the fade has finished.

## The game table

Every piece's state goes when its scene ends. `game` is a table for the
whole run of the game, shared by every script:

```lua
game.lives = game.lives or 3
game.lives -= 1
if game.lives == 0 then go("scenes/gameover.scene") end
```

To keep values between plays, [save](saving.md) them.

## Pausing

`pauseGame()` stops every piece's `update` and `physicsUpdate`, physics,
animations, timers and tweens; drawing goes on and UI still answers clicks
and the keyboard. Pieces whose **pausable** property is off, and everything
inside them, keep running: build the pause menu inside one.

```lua
-- scripts/pause-menu.lua, on a Group with pausable off, holding the menu UI
function ready() visible = false end

function update(dt)
  if pressed("pause") then
    if isPaused() then resumeGame() else pauseGame() end
    visible = isPaused()
  end
end
```

`smitten.timer.after` and `smitten.timer.every` (not a piece's own
`after`/`every`) keep running while paused.

## Slow motion

`timeScale(0.5)` makes the game run at half speed (`dt` is halved, physics
steps half as often, timers and tweens slow down); `timeScale(1)` is normal
and `timeScale(0)` freezes the game like a pause that UI and transitions
still run through. Music isn't affected.

## Pieces every type has

<!-- piece:Piece -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `pausable` | bool | true | Stops while the game is paused (pauseGame()). Turn it off for pause menus: this piece and everything inside it keep running. |

| Method | |
| --- | --- |
| `find(path)` | A child by name, or a deeper piece by path ("UI/Score"); nil if there isn't one. |
| `findDeep(name)` | The first piece with this name anywhere inside this one. |
| `findChildOfType(type)` | The first child of a type ("Sprite"), or nil. |
| `isA(type)` | True if the piece is of a type, or a type made from it. |
| `add(piece)` | Adds a piece as the last child; returns it. |
| `remove()` | Takes the piece out of its parent now, without destroying it, so it can be added somewhere else. |
| `spawn(sceneOrType, properties?)` | Makes a piece from a scene file or a piece type and adds it as a child: self:spawn("scenes/bullet.scene", { x = 10 }). |
| `destroy()` | Removes the piece and everything inside it at the end of the frame. |
| `tag(name)` | Gives the piece a tag, so smitten.scene.tagged(name) finds it and collisions can filter by it. |
| `untag(name)` | Takes a tag away. |
| `hasTag(name)` | True if the piece has the tag. |
| `hasAnyTag(tags)` | True if the piece has any of the tags in a comma-separated list: hasAnyTag("enemy, spikes"). |
| `is(tagOrType)` | True if the piece has the tag or is of the type: other:is("enemy"), other:is("Body"). |
| `on(event, fn)` | Calls fn(...) whenever the piece's event happens ("pressed", "entered", ...). Returns a handle with :off(). |
| `emit(event, ...)` | Fires an event: calls the script's function of that name and every listener. |
| `getPath()` | The piece's path from the scene's root, like "Level/Player". |
| `isAlive()` | True while the piece is in the running scene and not destroyed. |

| Event (a function in its script) | |
| --- | --- |
| `function ready(...)` | The piece and everything inside it have joined the scene. The scene's root gets go()'s extra values. |
| `function update(dt)` | Every frame. dt is the time since the last frame, in seconds. |
| `function physicsUpdate(dt)` | 60 times a second, before bodies move. Use it for movement. |
| `function draw()` | Draw extra things on top of the piece, in its own coordinates. |
| `function removed()` | The piece is leaving the scene. |
<!-- end -->

Every piece also has `name`, `type`, `parent`, `children` and `script`.

## Positions

Pieces with a position (Group and everything made from it) have `x`, `y`,
`rotation` (radians), `scaleX`, `scaleY`, `visible`, `tint` and `layer`.
Positions are measured from the parent; `y` grows downwards.

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
