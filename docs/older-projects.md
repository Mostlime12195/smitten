# Older projects

Smitten changed four things about how scripts work. Projects made before
that keep working exactly as they did: a project plays by the rules it
was made with until you choose to update it. Games you already published
are never touched.

A project's rules go by the `"version"` in its `smitten.json`. New
projects are version 3. A project of version 2 opens with **Older rules ·
Update…** at the bottom of the editor.

## What changed in version 3

### 1. Angles are degrees

`rotation` used to be radians in scripts and degrees in the Inspector.
Now it's degrees everywhere, and so is every other angle: a Body's `spin`
(degrees a second), `angleTo()`, `lookAt()`, a Joint's `minAngle`,
`maxAngle`, `getAngle()` and a turning motor's `motorSpeed`, a Particles
piece's `direction` and `spread`, `sprite()`'s `rotation`, and
`smitten.math.angle()`.

```lua
-- Before
rotation = math.pi / 2
rotation += 2 * math.pi * dt
vx, vy = math.cos(rotation) * 300, math.sin(rotation) * 300
rotation = math.atan2(dy, dx)

-- Now
rotation = 90
rotation += 360 * dt
vx, vy = smitten.math.direction(rotation, 300)
rotation = smitten.math.angle(dx, dy)
```

`math.sin`, `math.cos` and `math.atan2` are Lua's and still work in
radians: `math.rad(angle)` turns degrees into radians, `math.deg(radians)`
turns them back. The low-level `smitten.graphics` calls take radians too.

### 2. A Button's event is `clicked()`

A Button, Panel or Picture used to call its script's `pressed()`, which is
also the name of the input call. Now it calls `clicked()`, and
`pressed("jump")` always asks about input. A TouchButton's and
TouchStick's events are `touched()` and `untouched()`.

```lua
-- Before                              -- Now
function pressed()                     function clicked()
  go("scenes/level1.scene")              go("scenes/level1.scene")
end                                    end

Play:on("pressed", start)              Play:on("clicked", start)
```

### 3. Setting a name that was never made is an error

A mistyped name used to make a new variable without a word. Now a script
makes its variables at the top (or with `local`), and setting any other
name inside a function stops the game and says which name it could have
meant. See [Making variables](scripts.md#making-variables).

```lua
-- Before: found is made the first time a coin is picked up
function entered(other)
  found = (found or 0) + 1
end

-- Now: made at the top
found = 0

function entered(other)
  found += 1
end
```

`name = nil` at the top makes a variable with no value yet.

### 4. A Body's `gravity` is `gravityScale`

The setting that makes one Body fall faster, float or fall upwards is
called `gravityScale`. That leaves `gravity` free as an ordinary name for
a script's own variable, and `jumpSpeed()` uses it.

```lua
-- Before                              -- Now
Balloon.gravity = -0.2                 Balloon.gravityScale = -0.2
fallGravity = 1800                     gravity = 1800
vy += fallGravity * dt                 vy += gravity * dt
```

## Update this project

**Older rules · Update…** (or **Update this project…** in the project's
menu) shows what updating would change, and does it only if you say so.
First it keeps a copy of the project as it is, called "… (before
update)", among your games.

It changes what a program can change safely:

- the project's version, to 3;
- scenes: angles to degrees, and a Body's `gravity` to `gravityScale`.
  What you see in the Inspector stays the same;
- `function pressed()` to `function clicked()` in scripts attached to
  Buttons, Panels and Pictures (and `touched()`, `untouched()` for touch
  pieces), and `on("pressed", ...)` where it can tell whose event it is;
- if you leave the box ticked, a `name = nil` line at the top of a script
  for each variable the script only made inside a function, so nothing
  stops with the new error.

It can't safely rewrite sums, so it lists the lines for you to look at:

- lines that work with angles (`rotation`, `spin`, `angleTo`, `math.pi`,
  `math.cos`...). Change radians to degrees as in the examples above;
- `on("pressed", ...)` on pieces it couldn't identify.

The list stays in the Output panel. If something goes wrong, the copy
from before is still there.

Until you update, everything on this page under "Before" is still how the
project works, though the rest of the docs describe the new rules. Scenes
you edit are saved in the new form either way (the engine reads both).
A game remixed from the games site opens with the rules it was published
with.
