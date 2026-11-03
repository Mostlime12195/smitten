# Scripts

A script is a piece's own code, in Lua. Attach it to a piece in the
Inspector (or with `"script"` in the scene file). There's no table to make
or return and no `self.` to write: names in a script are the piece's.

```lua
-- scripts/enemy.lua, on a Body
speed = 80           -- script variables: shown in the Inspector,
hurtsPlayer = true   -- changeable per piece
local hp = 3         -- local: this piece's private state

function ready()
  wait(0.5)          -- ready() and events can wait
  vx = speed
end

function physicsUpdate(dt)
  vy += 1800 * dt
  move()
  if onWall() then vx = -vx end
end

function hurt(damage)          -- other scripts call other:hurt(1)
  hp -= damage
  if hp <= 0 then sfx("pop") destroy() end
end

function hit(other)
  if hurtsPlayer and other:is("player") then other:hurt(1) end
end
```

## Names

When a script reads a name, Smitten looks in this order:

1. the script's own functions (`hurt`, `update`, ...);
2. the piece: its properties (`x`, `vx`, `rotation`), script variables and methods (`move()` is the piece's `move`);
3. its children, for capitalized names: `Look.color = {1, 0, 0}`, `Camera.zoom = 2`;
4. the short [Script API](api.md): `pressed`, `spawn`, `sfx`, `wait`, `pen`, ...;
5. Lua's globals: `math`, `string`, `print`, `smitten`, ...

Assigning a name that isn't `local` sets it on the piece, so other scripts
see it (`other.hp`). `self` is the piece, for passing it on:
`root():emit("collected", self)`.

A few names are decided the other way round: `spawn()` adds to the scene
(`self:spawn()` adds inside this piece), and `type()` is Lua's (the piece's
type is `self.type`).

## Script variables

Top-level `name = value` lines with a number, string, boolean or color
(`{r, g, b, a}`) value are **script variables**: the Inspector shows them,
with the comment after them as help, and each piece can have its own value.
Names starting with `_` are hidden.

Top-level `local`s belong to each piece too: every piece runs the file
once. For state the whole game shares, use the [`game`](scenes.md#the-game-table)
table.

## What the engine calls

| Function | When |
| --- | --- |
| `ready(...)` | Once, when the piece and its children are in the scene (children first). The scene's root gets `go()`'s extra values |
| `update(dt)` | Every frame; `dt` is the seconds since the last one |
| `physicsUpdate(dt)` | 60 times a second, before bodies move: use it for movement |
| `draw()` | After the piece is drawn, in its own coordinates (see [Drawing](drawing.md)) |
| `removed()` | When it leaves the scene |

Pieces call **events** on their scripts when things happen: `hit(other)`
(a Body bumped into something), `entered(other)` / `exited(other)` (Zones,
and Bodies going in and out of them), `pressed()` (Buttons), `finished()`
(animations, sounds, particles), `tick()` (Timers), `hovered()` /
`unhovered()` (UI). Each piece's events are in [Pieces](pieces.md).

## Your own events

Any piece can `emit(name, ...)`: it calls the script function of that name
and every listener. Other code listens with `piece:on(name, fn)`, which
returns a handle with `:off()`.

```lua
-- On the player
function landed() sfx("thud") end
...
emit("landed")

-- On the HUD, listening to the player
first("player"):on("landed", function() shake() end)
```

## Waiting

`ready()`, `removed()` and events run as **tasks**: they can `wait(seconds)`
and carry on where they were. `update()`, `physicsUpdate()` and `draw()`
run straight through and can't wait; start a task from them instead.

```lua
function hit(other)
  if other:is("spikes") then
    visible = false
    wait(1)              -- the rest happens a second later
    x, y = 100, 100
    visible = true
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

Timers, tweens and waits of a piece stop when it's destroyed and when the
scene changes, and wait while the game is paused. `after`, `every` and
`tween` return a handle with `:cancel()`; a tween's `:after(fn)` runs fn
when it ends. Easings: `linear`, `outQuad` (the default), `inQuad`,
`inOutQuad`, `inCubic`, `outCubic`, `inOutCubic`, `inSine`, `outSine`,
`inOutSine`, `inExpo`, `outExpo`, `inBack`, `outBack`, `inOutBack`,
`outBounce`, `outElastic`.

```lua
tween(self, 0.4, { y = y - 40, scaleX = 1.5 }, "outBack")
every(0.5, function() Light.visible = not Light.visible end)
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

`smitten.math` has more: `chance(p)`, `pick(list)`, `angle(x1, y1, x2, y2)`,
`randomFloat(a, b)`, LÖVE's `noise` and `random`. See
[The engine table](engine.md).

## Smitten's Lua

Scripts are Lua 5.1 with a few additions:

| | |
| --- | --- |
| `score += 10` | Also `-=`, `*=`, `/=`, `%=`, `^=`, `..=` |
| `` `HP: {hp}/{maxHp}` `` | Text with values in it |
| `continue` | Skips to the next turn of a loop |
| `x = if a then b else c` | An `if` that gives a value |

## Ready-made scripts

**Attach a script…** offers scripts to start from. Attaching one copies it
into the project's `scripts/` folder, to read and change like any other:

| Script | For |
| --- | --- |
| `platformer.lua` | A Body that runs and jumps (coyote time, jump buffering, double jumps, animations) |
| `topdown.lua` | A Body that walks in any direction |
| `patrol.lua` | A Body that walks back and forth, turning at walls and ledges |
| `chase.lua` | Moves towards the first piece with a tag |
| `fly.lua` | Keeps moving the way it faces: bullets, arrows |
| `pickup.lua` | A Zone collected by the player; tells the scene `collected` |
| `spin.lua`, `bob.lua` | Keep turning; float up and down |
| `drag.lua` | Picked up and moved with the mouse or a finger |

## Old-style scripts

Scripts that return a table (`local Player = {}`, `function Player:update(dt)`,
`return Player`) still work; `self` is the piece there.
