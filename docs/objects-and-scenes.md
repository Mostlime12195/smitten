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
file name (`objects/player.lua` → `"player"`). Definition fields (all
optional): `sprite`, `animation` (the one to start with; default: `"idle"`
if it exists, else the first), `width`/`height` (hitbox, default the
sprite's frame size or 16×16), `offsetX`/`offsetY` (hitbox position
relative to the sprite's origin), `behaviors`, `camera`, `solid` (other
objects' movement is blocked by it, like a solid tile), `layer` (draw order;
higher draws on top; default 0), plus any defaults for the object's own
fields (`speed = 90`).

Callbacks (all optional): `create()`, `update(dt)`, `draw()` (default:
`self:drawSprite()`), `touch(other)` (overlap started), `untouch(other)`
(overlap ended), `destroyed()`.

Instance fields: `x`, `y` (position of the sprite's origin), `vx`, `vy`
(velocity, pixels per second, applied by behaviors), `width`, `height`,
`type`, `scene`, `flipX` (set automatically from movement direction by
behaviors), `visible`, every property set on the placed object in the
scene editor, and the definition's defaults.

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

`smitten.spawn(type, x, y, properties)` creates an object in the current
scene (e.g. bullets); `smitten.find(type)` returns the first object of a
type, `smitten.all(type)` all of them.

### Behaviors

Built in, configured with object fields (shown with defaults):

- `"platformer"`: left/right/jump input (the default `left`, `right`,
  `jump` actions), gravity, variable jump height (release early = lower),
  collision with solid tiles and solid objects, coyote time and jump
  buffering (forgiving controls). Fields: `speed = 90`, `acceleration =
  900`, `jumpSpeed = 260`, `gravity = 760`, `maxFall = 420`. Plays
  `run`/`jump`/`fall`/`idle` animations when the sprite has them. Falling
  out of the scene calls `fell()` if defined, else respawns at the start.
- `"topdown"`: 8-way movement with `left/right/up/down`, collision with
  solid tiles and objects. `speed = 80`. Plays `walk`/`idle` if present.
- `"mover"`: moves by `vx`, `vy` each frame and stops at walls (bullets,
  enemies that patrol: `bounce = true` reverses on walls).

Objects with `solid = true` block behaviors' movement.

## Scenes

A scene file is a map file (same format as `.map.json`, see
docs/reference.md) with `"format": "smitten.scene"` and the extension
`.scene.json`. The map editor opens both; new files are scenes. Object
layers place objects by `type`; objects whose type has no
`objects/<type>.lua` are plain data, as before (`level:objects()`).

`scenes/level1.lua` (optional) is the scene's script:

```lua
local Level = {}
function Level:enter() end            -- after the scene's objects are created
function Level:update(dt) end         -- after objects update
function Level:draw() end             -- on top, in screen coordinates (HUD)
function Level:leave() end
return Level
```

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
simple path. Each frame the engine: updates timers and tweens, updates
objects (behaviors, then `update`), resolves touches, removes destroyed
objects, updates the scene script; then draws the background color, tile
layers and objects sorted by `layer` (then by `y`, so lower objects draw in
front, which suits top-down games) through the camera, then the scene
script's `draw()`. It all happens inside `smitten.screen` (the project
resolution, scaled to the window).

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
`smitten.start()` prefers it.

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

Escape isn't bound: by convention it quits.

`smitten.input.down/pressed/released` also accept a key name or
`"mouse:left"` directly (`smitten.input.pressed("e")`), and
`smitten.input.axis("left", "right")` returns -1, 0 or 1.

### Mouse and touch

```lua
smitten.mouse.x, smitten.mouse.y        -- in game pixels (through smitten.screen)
smitten.mouse.worldX, smitten.mouse.worldY  -- in the scene (through the camera)
smitten.mouse.down(button)              -- button 1 (default), 2, 3
smitten.mouse.pressed(button)           -- this frame
smitten.mouse.released(button)
smitten.mouse.over(object)              -- the pointer is over this object
```

A touch acts as mouse button 1.

### Time

```lua
smitten.after(2, function() ... end)    -- once, in 2 seconds; returns a handle with :cancel()
smitten.every(0.5, function() ... end)  -- repeatedly
smitten.tween(object, 0.3, { y = 40, alpha = 0 }, "outBack")  -- easing names: linear, inQuad, outQuad,
                                                              -- inOutQuad, outCubic, outBack, outElastic, outBounce
```

Timers and tweens created while a scene runs end with it.

### Camera

```lua
smitten.camera.follow(object)           -- or `camera = true` in an object definition
smitten.camera.x, smitten.camera.y      -- top left of the view
smitten.camera.shake(4, 0.3)            -- pixels, seconds
smitten.camera.bounds = false           -- by default the view stays inside the scene
```

### Drawing, color, text

```lua
smitten.palette                          -- the project palette: { {r, g, b, 1}, ... }
love.graphics.setColor(smitten.color(3)) -- palette color 3 (1-based), or a "#rrggbb" string
smitten.print("Score: 10", 4, 4, 13)     -- the built-in 5×7 pixel font, palette color 13
smitten.printCentered("GAME OVER", 80)   -- centered horizontally on the screen
```

### Handy helpers

```lua
smitten.random(1, 6)       -- whole number from 1 to 6
smitten.chance(0.25)       -- true a quarter of the time
smitten.pick(list)         -- a random element
smitten.clamp(v, lo, hi)
smitten.lerp(a, b, t)
smitten.approach(v, target, step)
smitten.save("best", 42)   -- saved between runs (in the game's save folder)
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
