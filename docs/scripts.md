# Scripts

A script is a Lua file attached to a piece. Names in it refer to the
piece: no `self.`, no table to return.

```lua
-- scripts/enemy.lua, on a Body
speed = 80           -- script variable: editable per piece in the Inspector
local hp = 3         -- private to this piece

function ready()
  vx = speed
end

function physicsUpdate(dt)
  vy += 1800 * dt
  move()
  if onWall() then vx = -vx end
end

function hurt(damage)          -- other scripts call other:hurt(1)
  hp -= damage
  if hp <= 0 then destroy() end
end

function hit(other)
  if other:is("player") then other:hurt(1) end
end
```

## Names

A name is looked up in this order:

1. the script's functions;
2. the piece's properties, script variables and methods (`x`, `vx`, `move()`);
3. children, for capitalized names (`Look.color`, `Camera.zoom`);
4. the [Script API](api.md) (`pressed`, `spawn`, `sfx`);
5. Lua globals (`math`, `print`, `smitten`).

Assigning a name without `local` sets it on the piece. `self` is the piece.
`spawn()` adds to the scene; `self:spawn()` adds inside the piece. `type()`
is Lua's; the piece's type is `self.type`.

## Script variables

Top-level `name = value` lines with a number, string, boolean or color
(`{r, g, b, a}`) appear in the Inspector, with the line's comment as help.
Names starting with `_` are hidden. Top-level `local`s are per piece; for
state shared by the whole game, use [`game`](scenes.md#the-game-table).

## Callbacks

| Function | Called |
| --- | --- |
| `ready(...)` | Once, after the piece and its children enter the scene. The scene root gets `go()`'s extra values |
| `update(dt)` | Every frame |
| `physicsUpdate(dt)` | 60 times a second, before bodies move |
| `draw()` | After the piece draws, in its own coordinates ([Drawing](drawing.md)) |
| `removed()` | When it leaves the scene |

Pieces also call **events**, such as `hit(other)`, `entered(other)`,
`pressed()`, `finished()` and `tick()`. Each piece's events are listed in
[Pieces](pieces.md).

## Your own events

`emit(name, ...)` calls the piece's function of that name and its
listeners. `piece:on(name, fn)` listens and returns a handle with `:off()`.

```lua
first("player"):on("landed", function() shake(4, 0.2) end)
```

## Waiting

`ready()`, `removed()` and events can `wait(seconds)`. `update()`,
`physicsUpdate()` and `draw()` can't; start a `task` from them instead.

```lua
function hit(other)
  if other:is("spikes") then
    visible = false
    wait(1)
    x, y, visible = 100, 100, true
  end
end
```

<!-- api:Time -->
| Call | |
| --- | --- |
| `wait(seconds)` | Pauses ready(), an event or a task for some seconds. |
| `task(function)` | Runs a function that can wait(). |
| `after(seconds, function)` | Calls a function once, after some seconds. |
| `every(seconds, function)` | Calls a function every so many seconds, until it returns false. |
| `tween(target, seconds, values, easing)` | Changes numbers smoothly: tween(self, 0.3, { y = 100 }). |
| `time()` | Seconds since the game started. |
<!-- end -->

A piece's waits, timers and tweens stop when it's destroyed or the scene
changes, and pause with the game. `after`, `every` and `tween` return a
handle with `:cancel()`; a tween's `:after(fn)` runs when it ends.

Easings: `linear`, `outQuad` (default), `inQuad`, `inOutQuad`, `inCubic`,
`outCubic`, `inOutCubic`, `inSine`, `outSine`, `inOutSine`, `inExpo`,
`outExpo`, `inBack`, `outBack`, `inOutBack`, `outBounce`, `outElastic`.

```lua
tween(self, 0.4, { y = y - 40 }, "outBack")
```

## Math

<!-- api:Math -->
| Call | |
| --- | --- |
| `approach(value, target, step)` | Moves a value towards a target by at most step. |
| `lerp(a, b, t)` | Between a and b: t = 0 is a, 1 is b. |
| `clamp(value, min, max)` | The value, kept between min and max. |
| `sign(value)` | -1, 0 or 1. |
| `round(value, step)` | Rounded to the nearest step (default 1). |
| `rnd(n)` | rnd(): 0 to 1. rnd(n): 0 to n. rnd(list): one of its items. |
| `choose(...)` | One of its arguments, at random. |
| `dist(a, b)` | The distance between two pieces, or dist(x1, y1, x2, y2). |
| `jumpSpeed(height, gravity)` | How fast to go up to jump this high (with the piece's gravity). |
<!-- end -->

More in [`smitten.math`](engine.md).

## Lua additions

| Syntax | |
| --- | --- |
| `score += 10` | Also `-=`, `*=`, `/=`, `%=`, `^=`, `..=` |
| `` `HP: {hp}` `` | String interpolation |
| `continue` | Next loop iteration |
| `x = if a then b else c` | `if` expression |

## Ready-made scripts

**Attach a script** copies one of these into `scripts/`:

| Script | For |
| --- | --- |
| `platformer.lua` | A Body that runs and jumps |
| `topdown.lua` | A Body that walks in any direction |
| `patrol.lua` | A Body that walks back and forth |
| `chase.lua` | Moves towards the first piece with a tag |
| `fly.lua` | Moves the way it faces |
| `pickup.lua` | A Zone the player collects; emits `collected` on the scene root |
| `spin.lua`, `bob.lua` | Turns; floats up and down |
| `drag.lua` | Dragged with the mouse or a finger |

## Old-style scripts

Scripts that return a table (`function Player:update(dt)`) still work.
