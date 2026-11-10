# Scripts

A script is a piece's own code. Attach one to any piece in the Inspector,
and it can move the piece, react to what happens to it, and change the
rest of the game. Scripts are written in Lua with a few additions.

Inside a script, names refer to the piece it's attached to. There's no
`self.` to write and no table to return: `x` is the piece's position,
`move()` calls its `move` method, and a variable you set belongs to it.

```lua
-- scripts/enemy.lua, on a Body
speed = 80           -- a script variable: editable per piece in the Inspector
local hp = 3         -- private to this piece

function ready()
  vx = speed
end

function physicsUpdate(dt)
  vy += 1800 * dt
  move()
  if onWall() then vx = -vx end   -- turn around at walls
end

function hurt(damage)             -- other scripts can call other:hurt(1)
  hp -= damage
  if hp <= 0 then destroy() end
end

function hit(other)
  if other:is("player") then other:hurt(1) end
end
```

## How names are found

When a script uses a name, Smitten looks for it in this order:

1. functions defined in the script itself;
2. the piece's own properties, script variables and methods (`x`, `vx`, `move()`);
3. the piece's children, for names that start with a capital letter (`Look.color`, `Camera.zoom`);
4. the [Script API](api.md): `pressed`, `spawn`, `sfx`, `wait` and the rest;
5. Lua's built-ins, such as `math`, `string` and `print`.

Assigning to a name that isn't `local` stores it on the piece, where other
scripts can read it (`other.hp`). `self` is the piece itself, for when you
need to pass it somewhere.

## Making variables

A script's variables are made at its top level, outside any function:

```lua
score = 0          -- a variable, starting at 0
target = nil       -- one with no value yet
local timer = 0    -- one only this script sees

function hit(other)
  score += 1       -- fine: score was made above
  target = other   -- fine
  scroe = 0        -- a typing mistake: the game stops here and says so
end
```

Inside a function you can set a variable from the top of the script, one
of the piece's properties (`x`, `vx`, `text`), or a `local`. Setting any
other name is taken for a typing mistake, and the game stops with

```
scripts/player.lua:9: there's no variable called "scroe" here (did you mean "score"?).
To make a new one, write scroe = 0 at the top of the script (or local scroe = 0
right here, if only this function uses it).
```

Without this, a mistyped name would quietly make a second variable, and
the score would just never go up. A few things count as made already: a
value given to the piece in the Inspector or by `spawn("...", { hp = 3 })`,
and anything set with `self.name = ...`, which is always allowed.

A function of yours with the name of something the piece already does
replaces it: `function move()` on a Body means `move()` is yours, and the
body no longer moves by itself. Smitten says so in Output when the game
starts. If that isn't what you meant, pick another name, like `walk()`.

A few details: `spawn()` adds a new piece to the scene, while
`self:spawn()` adds it inside this piece; `type()` is Lua's function, so a
piece's type is `self.type`; and `load()` reads a [saved value](saving.md),
so Lua's own `load` is `_G.load`.

## Script variables

Any top-level line like `speed = 80` with a number, text, true/false or a
color (`{r, g, b, a}`) becomes a **script variable**. The Inspector shows
it, uses the comment on the same line as its help, and lets each piece
that uses the script have its own value. Names starting with `_` stay
hidden.

Top-level `local` variables belong to each piece separately. For
something the whole game shares, like the score, use the
[`game`](scenes.md#the-game-table) table.

## What the engine calls

Define any of these and the engine calls them at the right time:

| Function | Called |
| --- | --- |
| `ready(...)` | Once, after the piece and its children have joined the scene. The scene's root receives `go()`'s extra values |
| `update(dt)` | Every frame. `dt` is the time since the last frame, in seconds |
| `physicsUpdate(dt)` | 60 times a second, just before bodies move. Put movement here |
| `draw()` | After the piece draws itself, in its own coordinates (see [Drawing](drawing.md)) |
| `removed()` | When the piece leaves the scene |

Pieces also call **events** when things happen to them: a Body's
`hit(other)`, a Zone's `entered(other)`, a Button's `clicked()`, a
Timer's `tick()`, and so on. [Pieces](pieces.md) lists every piece's
events.

## Your own events

`emit(name, ...)` sends an event of your own: it calls the piece's
function with that name, and anyone listening. `piece:on(name, fn)`
listens, and returns a handle whose `:off()` stops listening.

```lua
-- On the player, when it lands:
emit("landed")

-- Somewhere else, shake the camera whenever that happens:
first("player"):on("landed", function() shake(4, 0.2) end)
```

## Waiting

`ready()`, `removed()` and events can pause partway with `wait(seconds)`
and carry on afterwards, which makes sequences easy to write:

```lua
function hit(other)
  if other:is("spikes") then
    visible = false
    wait(1)
    x, y, visible = 100, 100, true   -- back to the start, a second later
  end
end
```

`update()`, `physicsUpdate()` and `draw()` run every frame, so they can't
wait. Start a `task` from them instead, or use `after`.

<!-- api:Time -->
| Call | |
| --- | --- |
| `wait(seconds)` | Pauses ready(), an event function or a task for some seconds. |
| `task(function)` | Runs a function that can wait(). |
| `after(seconds, function)` | Calls a function once, after some seconds. |
| `every(seconds, function)` | Calls a function each time the given seconds pass, until it returns false. |
| `tween(target, seconds, values, easing)` | Changes numbers smoothly: tween(self, 0.3, { y = 100 }). |
| `time()` | Returns the seconds since the game started. |
<!-- end -->

A piece's waits, timers and tweens end when the piece is destroyed or the
scene changes, and pause while the game is paused. `after`, `every` and
`tween` return a handle with `:cancel()`, and a tween's `:after(fn)` runs
when it finishes.

```lua
tween(self, 0.4, { y = y - 40 }, "outBack")   -- hop up 40 pixels
```

Easings: `linear`, `outQuad` (the default), `inQuad`, `inOutQuad`,
`inCubic`, `outCubic`, `inOutCubic`, `inSine`, `outSine`, `inOutSine`,
`inExpo`, `outExpo`, `inBack`, `outBack`, `inOutBack`, `outBounce`,
`outElastic`.

## Math helpers

<!-- api:Math -->
| Call | |
| --- | --- |
| `approach(value, target, step)` | Returns value, moved towards target by at most step. |
| `lerp(a, b, t)` | Returns a value between a and b: t = 0 gives a, 1 gives b. |
| `clamp(value, min, max)` | Returns value, kept between min and max. |
| `sign(value)` | Returns -1, 0 or 1. |
| `round(value, step)` | Returns value, rounded to the nearest step (1 if you leave it out). |
| `rnd(n)` | rnd() returns 0 to 1. rnd(n) returns 0 to n. rnd(list) returns one of its items. |
| `choose(...)` | Returns one of its arguments, at random. |
| `dist(a, b)` | Returns the distance between two pieces, or between two points: dist(x1, y1, x2, y2). |
| `jumpSpeed(height, gravity)` | Returns the upward speed for a jump of this height. It uses the gravity variable of the script, or the gravity that you give, or 1800 if there is neither. |
<!-- end -->

There's more in [`smitten.math`](engine.md).

## Smitten's Lua

Scripts are Lua 5.1 with a few conveniences:

| Write | Means |
| --- | --- |
| `score += 10` | `score = score + 10`; also `-=`, `*=`, `/=`, `%=`, `^=`, `..=` |
| `` `HP: {hp}/{maxHp}` `` | Text with values filled in |
| `continue` | Skip to the next turn of a loop |
| `x = if a then b else c` | An `if` that produces a value |

## Ready-made scripts

**Attach a script** offers scripts to start from. Choosing one copies it
into your `scripts/` folder, so you can read it and change anything.

| Script | For |
| --- | --- |
| `platformer.lua` | A Body that runs and jumps, with coyote time and double jumps |
| `topdown.lua` | A Body that walks in any direction |
| `patrol.lua` | An enemy that walks back and forth, turning at walls and edges |
| `chase.lua` | Moves towards the nearest piece with a tag |
| `fly.lua` | Keeps moving the way it faces: bullets, arrows |
| `pickup.lua` | A Zone the player collects; tells the scene with `collected` |
| `spin.lua`, `bob.lua` | Keeps turning; floats gently up and down |
| `drag.lua` | Picked up with the mouse or a finger, and thrown |
