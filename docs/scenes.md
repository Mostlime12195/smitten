# Scenes and pieces

A **scene** is one screen of your game, for example a level, a menu or a
game over screen. Smitten keeps each scene in a `.scene` file. A scene is
a tree of **pieces**. For example, a level can have the player, the ground,
some coins and a camera in it. The player has its picture and its own
camera in it. One scene runs at a time. The game starts with the main
scene of the project.

You can put a scene inside a different scene (a placed scene). For
example, the coin in the Platformer template is a small scene. The level
has this scene in it many times. Each copy can change its properties. When
you change the coin scene, all the copies change.

## Finding pieces

| | |
| --- | --- |
| `Look`, `Camera` | A child, found by its name (names that start with a capital letter find children) |
| `find("UI/Score")` | A piece, found by its path from this piece. `..` goes up one level of the tree |
| `findDeep("Score")` | The first piece with that name, at any level inside this piece |
| `findChildOfType("Sprite")` | The first child of a piece type |
| `parent`, `children` | `parent` is the piece that has this piece in it. `children` are the pieces in this piece |
| `root()` | The top piece of the scene |
| `first("player")`, `tagged("coin")` | `first` gives the first piece with a tag. `tagged` gives all the pieces with the tag |

## Tags

Tags are words that you put on pieces, for example `player`, `enemy` or
`coin`. Scripts use tags to find pieces and to know which piece is which.
Add tags in the Inspector. In a script, `tag(name)` adds a tag, and
`untag(name)` removes a tag.

`other:is("enemy")` checks for a tag, or for a piece type
(`other:is("Body")`). `hasAnyTag("enemy, spikes")` checks for more than one
tag at the same time. Bodies and Zones also use tags to find what they hit
([Physics](physics.md)).

## Making and removing pieces

`spawn` makes a new piece from a scene file or a piece type. Then it adds
the piece to the scene:

```lua
spawn("scenes/bullet.scene", { x = x, y = y, rotation = rotation })
spawn("Text", { text = "+10", x = x, y = y - 20 })
self:spawn("scenes/hat.scene")           -- put the new piece inside this piece

local enemy = make("scenes/enemy.scene") -- make a piece, but do not add it now
Enemies:add(enemy)

destroy()                                -- remove this piece
```

`destroy()` removes a piece and all the pieces in it, at the end of the
frame. `remove()` takes a piece out immediately, but does not destroy it.
Then you can use `add` to put it in a different place.

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

`go("scenes/level2.scene")` changes to a different scene at the end of the
frame. `go()` gives its extra values to the root of the new scene, in its
`ready(...)`:

```lua
go("scenes/gameover.scene", score)

-- on the root piece of the game over scene
function ready(score)
  find("Score").text = `Score: {score}`
end
```

`reload()` starts the current scene again.

- `transition("fade", 0.4)` makes the screen fade to black and back when
  the scene changes.
- `transition("fade", 0.4, {1, 1, 1})` fades through a different color.
- `transition("none")` makes the scene change immediately again.

## The game table

When a scene ends, all the values in it go away. `game` is a table that
all scripts can use. It stays while the game runs. Because of this, it is
the correct place for values such as lives and the score:

```lua
game.lives = (game.lives or 3) - 1
```

To keep a value after the game closes, [save](saving.md) it.

## Pausing and slow motion

`pauseGame()` stops these:

- `update` and `physicsUpdate` of the pieces
- physics
- animations
- timers
- tweens

The screen continues to draw, and the UI continues to work. Some pieces
continue to run: a piece with its **pausable** property off, and all the
pieces in it. Put your pause menu inside such a piece:

```lua
-- on a Group with pausable off. The pause menu is in this Group.
function update(dt)
  if pressed("pause") then
    if isPaused() then resumeGame() else pauseGame() end
    visible = isPaused()
  end
end
```

`timeScale(0.5)` makes the game run at half speed, for slow motion.
`timeScale(1)` makes the speed normal again. Music plays at its normal
speed at all time scales.

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

All pieces also have `name`, `type`, `parent`, `children` and `script`.

## Position, size and drawing order

Group, and each piece type that has Group as its base, are pieces that you
can see in the scene. These pieces have `x`, `y`, `rotation`, `scaleX`, `scaleY`,
`visible`, `tint` and `layer`. A position is relative to the parent piece. `y`
increases downwards. A piece on a higher layer is on top of a piece on a
lower layer.

### Angles

All angles are in degrees, clockwise. `rotation = 90` is a quarter turn,
and 0 points to the right. This is true for all the angles in scripts:

- `rotation`
- `angleTo()`
- `spin` of a Body (degrees each second)
- `minAngle` of a Joint
- `direction` of a Particles piece

The Inspector shows the same numbers.

```lua
rotation = angleTo(first("player"))           -- point to the player
rotation += 180 * dt                            -- half a turn each second

-- Move in the direction that the piece points to: the x and y of a step at an angle.
vx, vy = smitten.math.direction(rotation, 300)

-- The opposite: the angle of a direction.
rotation = smitten.math.angle(vx, vy)
```

The Lua functions `math.sin` and `math.cos` use radians. Give them
`math.rad(angle)`. `math.deg(radians)` changes radians to degrees. The
low-level `smitten.graphics` functions (`rotate`, `draw`) also use
radians.

<!-- piece:Group -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `x` | number (px) | 0 | Position, measured from the parent. |
| `y` | number (px) | 0 | Position, measured from the parent. y grows downwards. |
| `rotation` | angle (°) | 0° | Turn, clockwise, in degrees: 90 is a quarter turn. |
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
| `angleTo(pieceOrX, y?)` | The angle towards another piece or a point, in degrees: rotation = angleTo(target) faces it. |
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
