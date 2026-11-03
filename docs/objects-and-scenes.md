# Objects, scenes and the simple API

How a Smitten game is put together, and the small API that makes common
things one line. This extends `docs/reference.md`; nothing in it changes
existing functions (`smitten.sprite`, `smitten.map`, `smitten.scene.switch`
with tables, `smitten.input.bind`, ... keep working).

## Why

Teenagers think in things ("the player", "a coin", "the first level"), not
in files ("a PNG, a Lua file and a JSON file"). Every engine aimed at them
is built around that: Scratch has sprites with their own scripts, GameMaker
has objects placed in rooms, GDevelop and Construct have objects with
behaviors placed in scenes, MakeCode Arcade has sprite kinds and
`controller.moveSprite`, Godot has scenes made of nodes. Smitten takes the
smallest version of that idea that still leaves LÖVE fully available:

- An **object** is a kind of thing in the game: a sprite, a Lua script, and
  optionally built-in **behaviors** (platformer movement, top-down
  movement). `objects/player.lua`.
- A **scene** is a level or a screen: tile layers plus placed objects, and
  optionally a script. `scenes/level1.scene.json` (+ `scenes/level1.lua`).
- `smitten.start()` runs the game's first scene. Objects in it are created,
  updated, drawn, collided and destroyed by the engine, so a game needs no
  hand-written loops over its entities.

Plain `love.*` code works alongside all of it; nothing is required.

## Objects

`objects/coin.lua`:

```lua
local Coin = smitten.object {
  sprite = "sprites/coin",      -- drawn automatically, playing its first animation
}

function Coin:touch(other)      -- called when another object starts overlapping this one
  if other.type == "player" then
    smitten.sfx("sfx/coin"):play()
    self:destroy()
  end
end

return Coin
```

`objects/player.lua`, with no code at all:

```lua
return smitten.object {
  sprite = "sprites/player",
  behaviors = { "platformer" },
  camera = true,                -- the camera follows it
}
```

`smitten.object(definition)` returns a class. The object's **type** is its
file name (`objects/player.lua` → `"player"`; an object made elsewhere
needs `type = "bullet"` in its definition). Definition fields (all
optional): `sprite`, `animation` (the one to start with; default: `"idle"`
if it exists, else the first in alphabetical order), `width`/`height`
(hitbox, default the sprite's frame size or 16×16), `offsetX`/`offsetY`
(hitbox position relative to the sprite's origin; see below),
`behaviors`, `camera`, `solid` (other objects' movement is blocked by it,
like a solid tile), `layer` (draw order; higher draws on top; default 0),
`color` (a palette number or `"#rrggbb"`: the color of the box drawn while
the object has no sprite), `visible`, plus any defaults for the object's
own fields (`speed = 90`). The definition table becomes the class, so
`function Coin:touch(other)` adds to it.

**Hitbox.** By default the hitbox is centered horizontally on the sprite's
frame and stands on the frame's bottom edge. With the usual origin at the
feet (bottom middle), that is: centered on `x`, bottom at `y`. A 16×16
sprite with origin (8, 16) and `width = 10, height = 13` gets
`offsetX = -5, offsetY = -13`. Set `offsetX`/`offsetY` to place it
elsewhere (a coin with its origin in the middle: `offsetY = -5`). Objects
without a sprite have their hitbox's top left at `x`, `y`.

**No art yet.** If the sprite file doesn't exist, the object is drawn as a
box the size of its hitbox, in `color` or a palette color picked from its
type name, and the console says so once. Objects with no `sprite` draw
nothing (triggers, zones), unless they have a `color`.

Callbacks (all optional): `create()` (after every object placed in the
scene exists, so it can `smitten.find` others), `update(dt)` (after its
behaviors), `draw()` (default: `self:drawSprite()`), `touch(other)`
(overlap started), `untouch(other)` (overlap ended, or the other object
was destroyed), `destroyed()` (when `destroy()` is called). Platformer
objects also get `fell()`, `jumped()` and `landed()`. A misspelled
callback (`tuch`) gets a warning in the console.

Instance fields: `x`, `y` (position of the sprite's origin), `vx`, `vy`
(velocity, pixels per second, applied by behaviors), `width`, `height`,
`offsetX`, `offsetY`, `type`, `scene` (the scene script's table, so
`self.scene:win()` calls into it), `flipX`/`flipY` (flipX is set
automatically from the movement direction by behaviors; sprites are
expected to face right), `visible`, `alpha`, `scale`, `rotation` (used by
`drawSprite`; `alpha` also by the box), `anim` (the sprite's
`smitten.Animation`: `self.anim.name`, `self.anim.frame`), every property
set on the placed object in the scene editor, and the definition's
defaults. `tostring(object)` gives `"player at 40, 160"`.

Methods:

| Method | What it does |
| --- | --- |
| `self:destroy()` | Removes it at the end of the frame |
| `self:play(name)` | Switches animation (no restart if already playing) |
| `self:drawSprite()` | Draws the sprite with flip and the current animation |
| `self:overlaps(typeOrObject)` | The first overlapping object of that type (or that object), or nil |
| `self:isOnGround()` | True if standing on something solid (platformer) |
| `self:distanceTo(other)` / `self:angleTo(other)` | |
| `self:moveTo(x, y, speed, dt)` | Moves towards a point; returns true when there |
| `self:box()` | `x, y, w, h` of the hitbox |
| `self:move(dx, dy)` | Moves, stopping at solid tiles and solid objects; returns `hitX, hitY` |
| `self:respawn()` | Back to where it was created, standing still |
| `self:jump()` | Makes a platformer object jump (for `controls = false`), buffered like a key press |
| `self:touchingTile(name)` | The properties of a tile under its hitbox with that property set or that `name` (`"damage"`, `"spikes"`), or nil |

`overlaps` and `touch` use the hitboxes; touching edges don't count,
except with a `solid` object (standing on it counts as touching).
`distanceTo`/`angleTo` measure between hitbox centers and also take a point
(`self:distanceTo(x, y)`). `moveTo`'s `dt` is optional (this frame's).

`smitten.spawn(type, x, y, properties)` creates an object in the current
scene (e.g. bullets) and runs its `create()`; `x, y` is where its sprite's
origin goes. `Bullet(x, y)` does the same with a class. `smitten.find(type)`
returns the first object of a type, `smitten.all(type)` a list of all of
them (`smitten.all()`: every object). Misspelled types are errors with a
suggestion: `objects/plyer.lua doesn't exist; did you mean "player"?`.

### Behaviors

Built in, configured with object fields (shown with defaults):

- `"platformer"`: left/right/jump input (the default `left`, `right`,
  `jump` actions), gravity, variable jump height (release early = lower),
  collision with solid tiles and solid objects, coyote time and jump
  buffering (forgiving controls). Fields: `speed = 90`, `acceleration =
  900`, `jumpSpeed = 260`, `gravity = 760`, `maxFall = 420`, `coyoteTime =
  0.1` (seconds after leaving a ledge when a jump still works),
  `jumpBuffer = 0.12` (seconds before landing when a jump press still
  counts). Plays `run`/`jump`/`fall`/`idle` animations when the sprite has
  them. The scene's left and right edges are walls. Falling out of the
  scene calls `fell()` if defined, else respawns at the start. Calls
  `jumped()` and `landed()` if defined (sounds, dust).
- `"topdown"`: 8-way movement with `left/right/up/down` (diagonals aren't
  faster), collision with solid tiles and objects; the scene's edges are
  walls. `speed = 80`. Plays `walk`/`idle` if present.
- `"mover"`: moves by `vx`, `vy` each frame and stops at walls (bullets,
  enemies that patrol: `bounce = true` reverses on walls). Falls if the
  object has a `gravity`. Destroyed once it's out of the scene.

Objects with `solid = true` block behaviors' movement. `controls = false`
makes platformer and topdown objects ignore the keys: set `self.moveX`
(and `moveY` for topdown) to -1, 0 or 1 and call `self:jump()` from code
(enemies, cutscenes, a player who has won). `"top-down"` works as a name
too.

## Scenes

A scene file is a map file (same format as `.map.json`, see
docs/reference.md) with `"format": "smitten.scene"` and the extension
`.scene.json`. The map editor opens both; new files are scenes. Object
layers place objects by `type`; objects whose type has no
`objects/<type>.lua` are plain data, as before (`level:objects()`), unless
the type looks like a typo of an object type (then it's an error).

A placed object's `x`, `y` is its sprite's origin (the scene editor draws
the sprite's frame at `x - originX`, `y - originY`). Its `width` and
`height` are left out unless the hitbox was changed in the editor: missing
or 0 means the type's hitbox, a positive size replaces it (zones, a goal
without a sprite). Its `properties` become fields of the object.

Objects are drawn above the tile layers that come before the first object
layer, and below the ones after it (a foreground layer).

`scenes/level1.lua` (optional) is the scene's script:

```lua
local Level = {}
Level.background = 11                 -- optional: a palette number or "#rrggbb"
function Level:enter() end            -- after the scene's objects are created
function Level:update(dt) end         -- after objects update
function Level:drawWorld() end        -- optional: in scene coordinates, above the objects
function Level:draw() end             -- on top, in screen coordinates (HUD)
function Level:leave() end
function Level:keypressed(key) end    -- any other love callback works too
return Level
```

The script is loaded again each time the scene starts, so its state starts
fresh (a restart really restarts). The background is the script's
`background`, else the scene file's, else palette color 1.

A scene can also be only a script (`scenes/title.lua`, no tiles), for title
screens and menus.

```lua
smitten.scene.go("level1")           -- scenes/level1.scene.json and/or scenes/level1.lua
smitten.scene.go("level1", { lives = 3 })  -- passed to enter(...)
smitten.scene.restart()
smitten.scene.name                   -- "level1"
smitten.scene.map                    -- the scene's map (getTile, isSolid, ...) or nil
```

`smitten.scene.switch/push/pop` with tables keep working; `go` is the
simple path. `go` called during a frame (from an object's `touch`, the
script's `update`) switches at the end of that frame; scenes pushed on top
are popped first. Leaving a scene ends its objects (without calling their
`destroyed()`), timers and tweens, and resets the camera.

Each frame the engine: updates timers and tweens, updates objects
(behaviors, then `update`, then the sprite animation), resolves touches,
removes destroyed objects, updates the scene script, moves the camera; then
draws the background color, tile layers and objects sorted by `layer`
(then by `y`, so lower objects draw in front, which suits top-down games)
through the camera, then the scene script's `draw()`. It all happens inside
`smitten.screen` (the project resolution, scaled to the window). Frames
longer than 1/15 s (a hidden tab) are slowed down to that, so nothing
tunnels through walls.

### Starting the game

`main.lua` for a scene-based game:

```lua
function love.load()
  smitten.start()      -- goes to smitten.json's "start" scene
end
```

`smitten.json` gets `"start": "title"`. The editor's **Play scene** runs
the game starting at the scene being edited: it adds a file
`.smitten/start` with the scene name to the files it runs, and
`smitten.start()` prefers it. Without either, a game with only one scene
starts there. `smitten.start("level2")` names the scene directly.
`start()` also sets up `smitten.screen`, makes `nearest` the default image
filter and makes the pixel font the current font, so `love.graphics.print`
uses it too.

## The simple API

All are fields of `smitten`, documented with `---@` annotations.

### Input (no setup needed)

Default actions, bound at startup (games can rebind with
`smitten.input.bind`):

| Action | Keys | Gamepad |
| --- | --- | --- |
| `left` `right` `up` `down` | arrows, WASD | d-pad, left stick |
| `jump` / `a` | Space, Z | A |
| `b` | X, Shift | B |
| `start` | Enter | Start |

Escape isn't bound: by convention games quit on it.

`smitten.input.down/pressed/released` also accept a key name, a gamepad
button or a mouse button directly (`smitten.input.pressed("e")`,
`"pad:x"`, `"mouse:left"`), and `smitten.input.axis("left", "right")`
returns -1, 0 or 1. An action of the same name comes first: `"a"` is the
action (Space, Z), not the A key. `smitten.input.bind` also takes
`"mouse:left"`, `"mouse:right"`, `"mouse:middle"`.

### Mouse and touch

```lua
smitten.mouse.x, smitten.mouse.y        -- in game pixels (through smitten.screen)
smitten.mouse.worldX, smitten.mouse.worldY  -- in the scene (through the camera)
smitten.mouse.down(button)              -- button 1 (default), 2, 3 (or "left", "right", "middle")
smitten.mouse.pressed(button)           -- this frame
smitten.mouse.released(button)
smitten.mouse.over(object)              -- the pointer is over this object's hitbox
```

A touch acts as mouse button 1.

### Time

```lua
smitten.after(2, function() ... end)    -- once, in 2 seconds; returns a handle with :cancel()
smitten.every(0.5, function() ... end)  -- repeatedly, until it returns false or is cancelled
smitten.tween(object, 0.3, { y = 40, alpha = 0 }, "outBack")  -- easing names: linear, inQuad, outQuad (default),
                                                              -- inOutQuad, inCubic, outCubic, inOutCubic, inSine,
                                                              -- outSine, inOutSine, inBack, outBack, outElastic, outBounce
smitten.tween(object, 0.3, { y = 40 }, "outQuad", function() ... end)  -- called at the end
```

Timers and tweens created while a scene runs end with it (and pause while
a scene is pushed on top of it); others run until cancelled. A tween of a
destroyed object stops.

### Camera

```lua
smitten.camera.follow(object)           -- or `camera = true` in an object definition
smitten.camera.x, smitten.camera.y      -- top left of the view
smitten.camera.shake(4, 0.3)            -- pixels, seconds
smitten.camera.bounds = false           -- by default the view stays inside the scene
smitten.camera.toWorld(x, y)            -- screen -> scene coordinates (and toScreen)
```

The camera centers on the followed object's hitbox. A scene smaller than
the screen is centered. Shaking moves the picture, not `x` and `y`.

### Drawing, color, text

```lua
smitten.palette                          -- the project palette: { {r, g, b, 1}, ... }
love.graphics.setColor(smitten.color(3)) -- palette color 3 (1-based), or a "#rrggbb" string
love.graphics.setColor(smitten.color(1, 0.5))  -- with alpha
smitten.print("Score: 10", 4, 4, 13)     -- the built-in 5×7 pixel font, palette color 13
smitten.print("BIG", 4, 20, 13, 2)       -- twice as big; no color: the current one
smitten.printCentered("GAME OVER", 80)   -- centered horizontally on the screen
smitten.textWidth("Score: 10")           -- in pixels
smitten.font                             -- the font itself, for love.graphics.setFont
```

The font was drawn for Smitten (`text.lua`): every printable ASCII
character, capitals and digits 5×7, lowercase 5 high, with two rows below
the baseline for g, j, p, q, y; characters 6 pixels apart, lines 10.

### Handy helpers

```lua
smitten.random(1, 6)       -- whole number from 1 to 6
smitten.chance(0.25)       -- true a quarter of the time
smitten.pick(list)         -- a random element
smitten.clamp(v, lo, hi)
smitten.lerp(a, b, t)
smitten.approach(v, target, step)
smitten.random(6)          -- 1 to 6; smitten.random() is a fraction from 0 to 1
smitten.save("best", 42)   -- saved between runs (smitten-save.json in the game's save folder)
smitten.load("best", 0)    -- with a default
```

## In the editor

- The assets panel shows **Objects** with their sprite as the thumbnail and
  their behaviors, and **Scenes**.
- **New object** asks for a name and a behavior (none, platformer,
  top-down), creates `objects/<name>.lua` and, if needed, a sprite
  `sprites/<name>.png`.
- The scene editor's object tool offers the project's object types with
  their sprites, places them by clicking, and draws placed objects with
  their sprite (first frame of their starting animation) instead of a
  labeled box. The editor learns an object's sprite from the
  `sprite = "..."` line in its file.
- **Play scene** (Ctrl+F5) runs the game from the scene being edited.
