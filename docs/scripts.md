# Scripts

A script is the code of a piece. In the Inspector, you can attach a script
to a piece. The script can move the piece, do something when an event
occurs, and change the other parts of the game. You write scripts in Lua,
with some additions.

In a script, names refer to the piece that has the script. You do not
write `self.`, and you do not return a table. For example:

- `x` is the position of the piece.
- `move()` calls the `move` method of the piece.
- A variable that you set belongs to the piece.

```lua
-- scripts/enemy.lua, on a Body
speed = 80           -- a script variable: you can change it for each piece in the Inspector
local hp = 3         -- only this piece has this value

function ready()
  vx = speed
end

function physicsUpdate(dt)
  vy += 1800 * dt
  move()
  if onWall() then vx = -vx end   -- at a wall, go the other way
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

When a script uses a name, Smitten looks for the name in this order:

1. The functions in the script.
2. The properties, script variables and methods of the piece (`x`, `vx`, `move()`).
3. The children of the piece, for names that start with a capital letter (`Look.color`, `Camera.zoom`).
4. The [Script API](api.md): `pressed`, `spawn`, `sfx`, `wait` and the other functions.
5. The functions and tables that Lua has, for example `math`, `string` and `print`.

If you give a value to a name that is not `local`, Smitten keeps the value
on the piece. Other scripts can read it there (`other.hp`). `self` is the
piece. Use `self` when you must give the piece to a function.

## Making variables

Make the variables of a script at its top level, outside all functions:

```lua
score = 0          -- a variable, with the value 0
target = nil       -- a variable with no value now
local timer = 0    -- a variable that only this script can see

function hit(other)
  score += 1       -- correct: the line above made score
  target = other   -- correct
  scroe = 0        -- a typing mistake: the game stops here and tells you
end
```

In a function, you can set these names:

- a variable from the top of the script.
- a property of the piece (`x`, `vx`, `text`).
- a `local`.

If you set a different name, Smitten thinks that it is a typing mistake.
The game stops with this message:

```
scripts/player.lua:9: there's no variable called "scroe" here (did you mean "score"?).
To make a new one, write scroe = 0 at the top of the script (or local scroe = 0
right here, if only this function uses it).
```

Without this check, a typing mistake makes a second variable with no
message. Then, for example, the score does not increase. Some names are
already made:

- a value that the piece gets in the Inspector.
- a value that the piece gets from `spawn("...", { hp = 3 })`.
- a name that you set with `self.name = ...`. You can always do this.

If your function has the same name as a method of the piece, your function
replaces the method. For example, if you write `function move()` on a Body,
`move()` is your function, and the Body does not move by itself. Smitten
tells you about this in Output when the game starts. If you do not want
this, use a different name, for example `walk()`.

Some more details:

- `spawn()` adds a new piece to the scene. `self:spawn()` adds the new
  piece inside this piece.
- `type()` is the Lua function. Because of this, the piece type of a piece is
  `self.type`.
- `load()` reads a [saved value](saving.md). The Lua function `load` is
  `_G.load`.

## Script variables

A top-level line such as `speed = 80` makes a **script variable** if its
value is one of these:

- a number
- text
- true or false
- a color (`{r, g, b, a}`)

The Inspector shows the script variable. It shows the comment on the same
line as help for the variable. Each piece that uses the script can have its
own value. The Inspector does not show names that start with `_`.

Each piece has its own top-level `local` variables. For a value that all of
the game shares, for example the score, use the
[`game`](scenes.md#the-game-table) table.

## What the engine calls

If you write one of these functions, the engine calls it at the correct
time:

| Function | When the engine calls it |
| --- | --- |
| `ready(...)` | One time, after the piece and its children come into the scene. The root of the scene gets the extra values from `go()` |
| `update(dt)` | In each frame. `dt` is the time since the last frame, in seconds |
| `physicsUpdate(dt)` | 60 times each second, immediately before bodies move. Put movement here |
| `draw()` | After the piece draws itself, in the coordinates of the piece (see [Drawing](drawing.md)) |
| `removed()` | When the piece goes out of the scene |

Pieces also send **events** when something occurs to them. For example, a
Body sends `hit(other)`, a Zone sends `entered(other)`, a Button sends
`clicked()` and a Timer sends `tick()`. [Pieces](pieces.md) shows the
events of each piece type.

## Your own events

`emit(name, ...)` sends your own event. It calls the function of the piece
that has that name. It also calls all the functions that listen for the
event. `piece:on(name, fn)` listens for an event. It gives a handle. To
stop listening, call `:off()` on the handle.

```lua
-- On the player, when it lands:
emit("landed")

-- In a different script: shake the camera each time that the player lands
first("player"):on("landed", function() shake(4, 0.2) end)
```

## Waiting

`ready()`, `removed()` and events can stop for some time with
`wait(seconds)`, and then continue. This makes it easy to write a sequence
of steps:

```lua
function hit(other)
  if other:is("spikes") then
    visible = false
    wait(1)
    x, y, visible = 100, 100, true   -- after one second, go back to the start
  end
end
```

`update()`, `physicsUpdate()` and `draw()` run in each frame. Because of this,
they cannot wait. In these functions, start a `task` or use `after`.

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

The waits, timers and tweens of a piece stop when you destroy the piece or
when the scene changes. When you pause the game, they pause too.

- `after`, `every` and `tween` give a handle. To stop it, call `:cancel()`
  on the handle.
- On the handle of a tween, `:after(fn)` calls `fn` when the tween ends.

```lua
tween(self, 0.4, { y = y - 40 }, "outBack")   -- jump up 40 pixels
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

[`smitten.math`](engine.md) has more math functions.

## Smitten's Lua

Scripts are Lua 5.1, with some additions that make code shorter:

| Write | Means |
| --- | --- |
| `score += 10` | `score = score + 10`; also `-=`, `*=`, `/=`, `%=`, `^=`, `..=` |
| `` `HP: {hp}/{maxHp}` `` | Text with the values put in |
| `continue` | Go to the next cycle of a loop |
| `x = if a then b else c` | An `if` that gives a value |

## Ready-made scripts

**Attach a script** shows scripts that you can start from. When you
choose a script, Smitten copies it into your `scripts/` folder. Then you can
read it and change it.

| Script | For |
| --- | --- |
| `platformer.lua` | A Body that runs and jumps, with coyote time and double jumps. With coyote time, the Body can jump for a short time after it goes off an edge |
| `topdown.lua` | A Body that walks in all directions |
| `patrol.lua` | An enemy that walks from side to side. It turns at walls and at edges |
| `chase.lua` | Moves to the nearest piece with a tag |
| `fly.lua` | Moves in the direction that it points to, for example a bullet or an arrow |
| `pickup.lua` | A Zone that the player collects. It tells the scene with the event `collected` |
| `spin.lua`, `bob.lua` | `spin.lua` turns all the time. `bob.lua` moves slowly up and down |
| `drag.lua` | You can pick it up with the mouse or a finger, and throw it |
