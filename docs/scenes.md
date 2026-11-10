# Scenes and pieces

A **scene** is one screen of your game, for example a level, a menu or a
game over screen. Smitten keeps each scene in a `.scene` file. A scene is
a tree of **pieces**. For example, a level can have the player, the ground,
some coins and a camera in it. The player has its image and its own
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
| `function physicsUpdate(dt)` | The engine calls it 60 times per second, before bodies move. Use it for movement. |
| `function draw()` | The engine calls it every frame. Draw extra things on top of the piece here, in the piece's own coordinates. |
| `function removed()` | The engine calls it when the piece leaves the scene. |
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
