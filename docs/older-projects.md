# Older projects

Smitten changed four things about how scripts work. Projects that are
older than this change continue to work as before. A project uses the
rules of its version until you update it. Smitten does not change games
that you published before.

The `"version"` setting in `smitten.json` gives the rules of a project.
New projects are version 3. When you open a project of version 2, the
editor shows **Older rules · Update…** at the bottom.

## What changed in version 3

### 1. Angles are degrees

Before, `rotation` was in radians in scripts and in degrees in the
Inspector. Now it is in degrees in all places. All other angles are also in
degrees:

- `spin` of a Body (degrees each second).
- `angleTo()` and `lookAt()`.
- `minAngle`, `maxAngle`, `getAngle()` of a Joint, and `motorSpeed` of a
  motor that turns.
- `direction` and `spread` of a Particles piece.
- `rotation` of `sprite()`.
- `smitten.math.angle()`.

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

`math.sin`, `math.cos` and `math.atan2` are Lua functions, and they
continue to use radians. `math.rad(angle)` changes degrees to radians.
`math.deg(radians)` changes radians to degrees. The low-level
`smitten.graphics` functions also use radians.

### 2. A Button's event is `clicked()`

Before, a Button, Panel or Picture called `pressed()` in its script. But
`pressed` is also the name of the input function. Now the engine calls
`clicked()`, and `pressed("jump")` always asks about input. The events of
a TouchButton and a TouchStick are `touched()` and `untouched()`.

```lua
-- Before                              -- Now
function pressed()                     function clicked()
  go("scenes/level1.scene")              go("scenes/level1.scene")
end                                    end

Play:on("pressed", start)              Play:on("clicked", start)
```

### 3. Setting a name that was never made is an error

Before, a typing mistake in a name made a new variable, with no message.
Now a script makes its variables at the top (or with `local`). If a
function sets a different name, the game stops. The message tells you
which name you possibly wanted. See
[Making variables](scripts.md#making-variables).

```lua
-- Before: the first coin that the player collects makes found
function entered(other)
  found = (found or 0) + 1
end

-- Now: the top of the script makes found
found = 0

function entered(other)
  found += 1
end
```

`name = nil` at the top makes a variable that has no value now.

### 4. A Body's `gravity` is `gravityScale`

The name of the property that makes one Body fall faster, float or fall
upwards is now `gravityScale`. Because of this, a script can use `gravity` as the name
of its own variable. `jumpSpeed()` uses this variable.

```lua
-- Before                              -- Now
Balloon.gravity = -0.2                 Balloon.gravityScale = -0.2
fallGravity = 1800                     gravity = 1800
vy += fallGravity * dt                 vy += gravity * dt
```

## Update this project

**Older rules · Update…** (or **Update this project…** in the menu of
the project) shows the changes that the update makes. It makes the changes
only if you agree. First, it keeps a copy of the project as it is now,
with the name "… (before update)", with your other games.

The update makes the changes that a program can make safely:

- It changes the version of the project to 3.
- In scenes, it changes angles to degrees, and the `gravity` of a Body to
  `gravityScale`. The Inspector shows the same values as before.
- In scripts on Buttons, Panels and Pictures, it changes
  `function pressed()` to `function clicked()`. For touch pieces, it
  changes them to `touched()` and `untouched()`. It also changes
  `on("pressed", ...)` when it can find which piece sends the event.
- If you keep the box ticked, it adds lines at the top of a script. It adds
  a `name = nil` line for each variable that the script makes only in a
  function.
  Because of this, no script stops with the new error.

The update cannot safely change calculations. Because of this, it makes a list of
lines for you to examine:

- lines that use angles (`rotation`, `spin`, `angleTo`, `math.pi`,
  `math.cos`...). Change radians to degrees, as in the examples above.
- `on("pressed", ...)` on pieces that it cannot identify.

The list stays in the Output panel. If there is a problem, you still have
the copy from before the update.

Until you update, the project works as this page shows under "Before".
The other pages of the docs tell about the new rules. When you change a
scene, the editor saves it in the new form, before and after the update
(the engine reads both forms). When you remix a game from the games site,
it opens with the rules of its version when its maker published it.
