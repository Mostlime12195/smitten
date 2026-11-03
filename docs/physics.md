# Physics

Every scene has a physics world (Box2D 3). **Bodies** are solid, **Zones**
notice what goes in and out, **Hitboxes** give either one more shapes,
**Joints** connect bodies, and solid **tiles** are walls and floors.
Physics runs 60 times a second, after every piece's `physicsUpdate(dt)`.

Units: lengths in pixels, speeds in pixels per second (`vx`, `vy`), angles
in radians (`rotation`, `spin` in radians per second, clockwise positive),
mass in kilograms. y points down: `vy = -400` goes up.

## Bodies

A Body's `motion` says what moves it:

| `motion` | Moved by | Use it for |
| --- | --- | --- |
| `still` | Nothing, unless a script moves it (then it carries what stands on it and pushes physics bodies) | Floors, walls, moving platforms |
| `scripted` | Its script: set `vx`, `vy` and call `move()` | Players, enemies, anything you control |
| `physics` | Physics: gravity, bumps, pushes, joints | Crates, balls, debris, ragdolls |

Change `motion` any time: a crate can be `still` until it's knocked loose.

### Shapes

| `shape` | |
| --- | --- |
| `auto` | Fits the Sprites and Shapes inside it: a box around them, or exactly a lone circle or polygon Shape |
| `rectangle` | `width` x `height`, centered on the Body |
| `circle` | `radius` |
| `capsule` | `width` x `height` with round ends: good for characters |
| `polygon` | `points` {x1, y1, x2, y2, ...}, up to 8 corners (a dent is filled in) |
| `none` | Only its Hitboxes |

Shapes move, turn and scale with the piece (and the pieces it's inside).
A **Hitbox** inside a Body or Zone adds a shape at the Hitbox's position and
rotation; `off = true` turns it off (a sword's reach only while swinging).
`getSize()` is the size of the box around a Body's shapes.

## Moving scripted bodies

```lua
speed, gravity = 220, 1800

function physicsUpdate(dt)
  vx = axis("left", "right") * speed
  vy = math.min(vy + gravity * dt, 1000)
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
  move()
end
```

`move()` goes `vx * dt`, `vy * dt` and:

- slides along walls, floors and ceilings, and takes the speed into them off
  `vx`, `vy` (landing sets `vy` to 0);
- walks up and down slopes up to `slope` (45° by default) at full speed,
  without sliding back or hopping off going down; steeper ones are walls;
- stays on the ground over small steps and edges going down;
- rides what it stands on: moving platforms, physics bodies;
- pushes physics bodies it walks into, as hard as its `mass` against theirs
  allows (a 1 kg player shoves a 1 kg crate, barely moves a 20 kg one), and
  presses down on what it stands on (a seesaw tips);
- lands on one-way tiles from above and jumps up through them;
- turns by `spin * dt` if `spin` isn't 0.

| | |
| --- | --- |
| `onGround()` | The last move ended standing on something walkable (and not going up) |
| `onWall()` | The last move ran into a wall |
| `onCeiling()` | The last move ran into a ceiling |
| `moveBy(dx, dy)` | Goes straight until something is in the way; returns what it hit, or nil |

Setting `x`, `y` or `rotation` moves a scripted or still body there; within
64 pixels in a step it pushes what's in the way, further it jumps there.
`applyImpulse(ix, iy)` on a scripted body changes `vx`, `vy` by the impulse
over its mass; `applyForce` does the same over one step.

## Physics bodies

`vx`, `vy` and `spin` are the body's speed now: read them, or set them to
throw it. Settings take effect the next step.

| | |
| --- | --- |
| `applyImpulse(ix, iy, x?, y?)` | A sudden push: the speed changes by impulse / `mass`. At a point in the scene it also spins it |
| `applyForce(fx, fy, x?, y?)` | A steady push for one step: call it every `physicsUpdate` for wind, thrusters, magnets |
| `applyTorque(t)` | A steady twist for one step |
| `applyAngularImpulse(i)` | A sudden twist |
| `wake()` | Wakes it if it's asleep |
| `grab(x, y)`, `dragTo(x, y)`, `drop()` | Hold it by a point with a spring, for dragging and throwing (below) |

| Setting | |
| --- | --- |
| `mass` | Kilograms. Impulses and forces scale with it: `applyImpulse(0, -400 * mass)` sends anything up at 400 px/s |
| `gravity` | How much gravity pulls it: 0 floats, -1 falls up |
| `friction`, `bounce` | Grip (0 is ice) and bounciness (0 to 1) |
| `drag`, `spinDrag` | Slow down its movement and its turning, like air |
| `fixedRotation` | Never turns: for upright characters moved by physics |
| `bullet` | Checked continuously against other physics bodies too, so it can't pass through them however fast it goes. Walls and floors are always checked |
| `asleep` | Physics bodies that stop fall asleep (and cost nothing); anything touching them wakes them. Set it true to start a stack at rest |

Setting `x`, `y` or `rotation` moves a physics body there and keeps its speed
(set `vx, vy, spin = 0, 0, 0` as well to stop it).

```lua
-- A bomb: everything near it flies away.
function explode()
  for _, p in ipairs(overlap("circle", x, y, 150)) do
    if p.motion == "physics" then
      local dx, dy = p.x - x, p.y - y
      local d = math.max(dist(0, 0, dx, dy), 1)
      p:applyImpulse(dx / d * 600 * p.mass, dy / d * 600 * p.mass)
    end
  end
  destroy()
end
```

## Collisions

`hit(other, contact)` runs once when a Body starts touching another body or
solid tiles (and runs on both). `contact` has:

| | |
| --- | --- |
| `x`, `y` | Where they touch |
| `nx`, `ny` | The direction from `other` towards this body (landing on a floor: 0, -1) |
| `impulse` | How hard: mass times the speed lost. Small for a touch, big for a crash |

```lua
function hit(other, contact)
  if contact.impulse > 300 then sfx("thud", math.min(contact.impulse / 2000, 1)) end
  if other:is("spikes") then reload() end
end
```

| | |
| --- | --- |
| `isTouching(other)` | True if it touches a piece (a Body, Zone or Tiles) or anything with a tag |
| `touching(tagOrPiece)` | The first body or zone with a tag (or that piece) touching it, or nil |
| `contacts()` | What it touches now: a list of `{piece, x, y, nx, ny, impulse}` |
| `touchingTile(setting)` | The settings of a touching tile with that setting (`"damage"`), or nil |

**Tags** filter what bumps into what: a Body passes through bodies with a
tag in its `passThrough` (`"ghost, pickup"`), and they pass through it.
`"tiles"` passes through solid tiles.

## Zones

A Zone notices bodies and zones going in and out: `entered(other)` and
`exited(other)` run on the Zone, and `entered(zone)` / `exited(zone)` on a
Body. `detects` limits it to things with some tags; `active = false` stops
it noticing; `inside()` lists what's in it now. Nothing bumps into a Zone,
and Zones don't notice still bodies.

```lua
-- scripts/pickup.lua on a coin Zone that detects "player"
function entered(other)
  sfx("coin")
  root():emit("collected", self)
  destroy()
end
```

## Tiles

Tiles marked `solid` in their tileset are walls and floors, smooth at the
seams between tiles (nothing catches on them). `oneWay` tiles are only solid
from above: land on them, jump up through them. `setTile`, `fill` and
`clear` change them right away. See [Tiles](tiles.md).

## Queries

Global in scripts, and on `smitten.physics`:

<!-- api:Physics -->
| Call | |
| --- | --- |
| `raycast(x1, y1, x2, y2, tags)` | The first body or solid tiles on a line: { piece, x, y, nx, ny, fraction }, or nil. tags (optional) only counts pieces with one of them. |
| `raycastAll(x1, y1, x2, y2, tags)` | Everything on a line, nearest first: a list of { piece, x, y, nx, ny, fraction }. |
| `piecesAt(x, y, tags)` | The bodies and zones whose shapes contain a point. |
| `overlap(kind, x, y, ...)` | The bodies and zones touching a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, width, height). |
| `getGravity()` | The scene's gravity: x, y in pixels per second per second. |
| `setGravity(x, y)` | Changes the scene's gravity: setGravity(0, 0) floats everything. |
<!-- end -->

```lua
-- Can the enemy see the player? (Nothing solid in between.)
local hit = raycast(x, y, player.x, player.y)
local sees = hit and hit.piece == player

-- What's under the mouse?
local mx, my = mouse()
for _, p in ipairs(piecesAt(mx, my)) do print(p.name) end
```

Ray casts skip Zones and the backs of tiles; `fraction` is how far along the
line the hit is (0 to 1).

## Gravity

The scenes' gravity is in **Project settings › Physics** (`physics.gravity`
in `smitten.json`, `[0, 980]` by default). `setGravity(0, 0)` turns it off
for a space level; `getGravity()` reads it. A body's `gravity` scales it for
that body. Scripted bodies make their own gravity (`vy += gravity * dt`).

## Joints

A Joint connects body `a` to body `b`, or to the place where the Joint is
when `b` is empty. It works where the Joint piece is: put a pin Joint on a
door's hinge.

| `kind` | |
| --- | --- |
| `pin` | Turns around the Joint. `motor`, `limit` (`minAngle`, `maxAngle`), `spring` |
| `weld` | Holds them together; with `spring` it bends and wobbles |
| `rope` | At most `length` apart (0: as far as they start) |
| `spring` | Pulls towards `length` apart: `stiffness` (wobbles per second), `damping` (1: no overshoot) |
| `distance` | Exactly `length` apart, a rod |
| `slider` | Slides along the Joint's x direction (turn the Joint to aim it). `motor`, `limit` (`lower`, `upper`), `spring` |
| `wheel` | Turns around the Joint and springs along its y direction, like a car's wheel. `motor` drives it |
| `mouse` | Pulls `a`'s point under the Joint towards wherever the Joint moves |

Settings change while the game runs (`motorSpeed = 5`). `collide` lets the
two bodies still bump into each other. With `breakForce` above 0 the joint
breaks when pulled harder and the Joint gets `broke()`. `getAngle()`,
`getTranslation()`, `getLength()`, `getSpeed()`, `getForce()` and
`getTorque()` read it.

```lua
-- A seesaw: the plank is a physics Body; this Joint sits at its middle.
-- kind = "pin", a = "Plank", b empty: pinned to the scene.
-- A motorized drawbridge:
Hinge.kind, Hinge.motor, Hinge.motorSpeed = "pin", true, -1
Hinge.limit, Hinge.minAngle, Hinge.maxAngle = true, -1.4, 0
```

## Dragging and throwing

`grab(x, y)` holds a physics body by that point with a spring; `dragTo(x, y)`
moves the point; `drop()` lets go and the body keeps its speed, so a quick
flick throws it. It swings and bumps into things on the way. Other bodies
follow the point exactly. The ready-made **Drag** script (`drag.lua`) does
this with the mouse or a finger:

```lua
function update(dt)
  local mx, my = mouse()
  if smitten.mouse.pressed(1) then
    for _, p in ipairs(piecesAt(mx, my)) do
      if p == self then grab(mx, my) end
    end
  end
  if smitten.mouse.down(1) then dragTo(mx, my) else drop() end
end
```

## LÖVE's love.physics

`love.physics.newWorld` and the rest of LÖVE's physics API work as in LÖVE
(Box2D 2.4), for code that makes its own worlds. It's a separate module
(`lovephysics`), included when a game's code uses it; scenes don't need it.

## Under the hood

The world is our fork of Box2D 3.1.1 (`deps/box2d3`, changes in
`PATCHES.md`), in the `physics2d` module. Box2D counts 64 pixels to a meter,
which only tunes its tolerances; it steps 60 times a second with 4
substeps. Still bodies are static (kinematic once moved), scripted ones
kinematic and moved with Box2D's character mover, physics ones dynamic;
Zones are sensors; solid tiles are chain segments, rebuilt 16 x 16 cells
at a time when they change. The same project runs the same way every time:
the stress case `physics-check` (tools/stress) prints
`check digest=622696633 hits=1444347 bodies=160 physics=41` after 600
steps; a different digest means physics behaves differently.

## Reference

<!-- piece:Body -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `motion` | enum | "scripted" | Still never moves on its own (a script can still move it, and it carries what stands on it); scripted moves when its script calls move(), sliding along walls and up slopes; physics falls, bounces, tumbles and gets pushed. |
| `shape` | enum | "auto" | Auto fits the Sprites and Shapes inside it (a lone circle or polygon Shape exactly). Capsule is a rectangle with round ends, good for characters. None uses only its Hitboxes. Shapes turn and scale with the Body. |
| `width` | number (px) | 32 | Rectangle or capsule width. |
| `height` | number (px) | 32 | Rectangle or capsule height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... (up to 8 corners; a dent is filled in). |
| `vx` | number (px/s) | 0 | Speed sideways. Scripted: what move() goes by. Physics: its speed now (set it to throw it). |
| `vy` | number (px/s) | 0 | Speed down (negative is up). Scripted: what move() goes by. Physics: its speed now. |
| `spin` | number (rad/s) | 0 | How fast it turns (clockwise is positive). Scripted: move() turns it this fast. |
| `slope` | angle | 45° | The steepest surface that still counts as ground: move() walks up it without sliding back. |
| `mass` | number (kg) | 1 | How heavy it is. A scripted body pushes physics bodies as hard as its mass against theirs allows. |
| `friction` | number | 0.3 | How much it grips what it touches: 0 is ice. |
| `bounce` | number | 0 | How much it bounces: 0 none, 1 forever. |
| `gravity` | number | 1 | How strongly gravity pulls it; 0 floats, -1 falls up. |
| `drag` | number | 0 | Air resistance: slows its movement down. |
| `spinDrag` | number | 0 | Slows its turning down. |
| `fixedRotation` | bool | false | Never tip over or spin. |
| `bullet` | bool | false | Checked continuously against other physics bodies too, so it can't pass through them however fast it goes. For small fast things. |
| `asleep` | bool | false | Resting: it doesn't move until something touches or pushes it. Physics bodies fall asleep by themselves when they stop. |
| `passThrough` | tags | "" | Tags of things it doesn't bump into, like "ghost, pickup" ("tiles" for solid tiles). |

| Method | |
| --- | --- |
| `move()` | Moves by vx, vy for this step, sliding along walls, walking up slopes, standing on moving platforms and pushing physics bodies (scripted bodies). Speed into what it touches is taken off vx, vy. |
| `moveBy(dx, dy)` | Moves by an offset and stops at the first thing in the way; returns what it hit, or nil. |
| `onGround()` | True if the last move ended standing on something. |
| `onWall()` | True if the last move ran into a wall. |
| `onCeiling()` | True if the last move ran into a ceiling. |
| `applyImpulse(ix, iy, x?, y?)` | A sudden push (mass times change of speed), like a jump, a kick or a hit; at a point in the scene it also spins it. applyImpulse(0, -400) on a 1 kg body sends it up at 400 px/s. |
| `applyForce(fx, fy, x?, y?)` | Pushes steadily for this step (call it every physicsUpdate for wind or thrusters), at its center or at a point. |
| `applyTorque(torque)` | Turns it steadily for this step (physics bodies). |
| `applyAngularImpulse(impulse)` | A sudden twist (physics bodies). |
| `push(ix, iy)` | The same as applyImpulse(ix, iy). |
| `wake()` | Wakes a sleeping physics body. |
| `grab(x, y, strength?)` | Takes hold of it at a point in the scene, for dragTo(): a physics body is pulled there by a spring, so it swings and can be thrown. |
| `dragTo(x, y)` | Moves the grabbed point towards x, y. |
| `drop()` | Lets go after grab(); a physics body keeps its speed. |
| `touching(tagOrPiece)` | The first body or zone with a tag (or that piece) touching this one, or nil. |
| `isTouching(other)` | True if it touches a piece (a body, zone or Tiles) or anything with a tag. |
| `contacts()` | What it touches now: a list of {piece, x, y, nx, ny, impulse}, the normal pointing towards this body. |
| `touchingTile(setting)` | The settings of a touching tile that has this setting (like "damage"), or nil. |
| `getSize()` | The size of the box around its shapes: width, height. |

| Event (a function in its script) | |
| --- | --- |
| `function hit(other, contact)` | It started touching another body or solid tiles. contact has x, y (where), nx, ny (the direction from other to this body) and impulse (how hard). |
| `function entered(zone)` | It went into a zone. |
| `function exited(zone)` | It left a zone. |
<!-- end -->

<!-- piece:Zone -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | Auto fits the Sprites and Shapes inside it. Shapes turn and scale with the Zone. |
| `width` | number (px) | 32 | Rectangle or capsule width. |
| `height` | number (px) | 32 | Rectangle or capsule height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... (up to 8 corners). |
| `detects` | tags | "" | Only notices things with one of these tags (empty: everything). |
| `active` | bool | true | Notice things going in and out. |

| Method | |
| --- | --- |
| `inside()` | A list of the bodies and zones inside it now. |
| `touching(tagOrPiece)` | The first body or zone with a tag (or that piece) inside it, or nil. |
| `isTouching(other)` | True if a piece (or anything with a tag) is inside it. |

| Event (a function in its script) | |
| --- | --- |
| `function entered(other)` | A body or zone came in. |
| `function exited(other)` | A body or zone left. |
<!-- end -->

<!-- piece:Hitbox -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "rectangle" | The shape, placed and turned by the Hitbox's position and rotation. |
| `width` | number (px) | 32 | Rectangle or capsule width. |
| `height` | number (px) | 32 | Rectangle or capsule height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... (up to 8 corners). |
| `off` | bool | false | Turn this shape off. |
<!-- end -->

<!-- piece:Joint -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "pin" | Pin turns around the Joint; weld holds tight; rope keeps them at most length apart; spring pulls them towards length apart; distance keeps them exactly length apart; slider slides along the Joint's x direction; wheel turns and springs along the Joint's y direction; mouse pulls a towards the Joint. |
| `a` | piecepath | "" | The body it holds. |
| `b` | piecepath | "" | The body it connects a to (empty: the place where the Joint is). |
| `length` | number (px) | 0 | How far apart; 0 uses the distance when the joint is made. |
| `spring` | bool | false | Springy: a pin or slider pulls back to where it started, a weld wobbles. |
| `stiffness` | number (Hz) | 4 | How stiff the spring is: wobbles per second. |
| `damping` | number | 0.5 | How quickly the spring stops wobbling: 1 doesn't overshoot. |
| `motor` | bool | false | Drive it: turn a pin or wheel, or move a slider, at motorSpeed. |
| `motorSpeed` | number | 2 | Radians per second (pin, wheel) or pixels per second (slider, distance). |
| `motorStrength` | number | 100000 | The most torque (pin, wheel) or force (slider, distance) the motor uses. |
| `limit` | bool | false | Keep a pin between minAngle and maxAngle, or a slider or wheel between lower and upper. |
| `minAngle` | angle | -45° | The furthest a pin turns anticlockwise. |
| `maxAngle` | angle | 45° | The furthest a pin turns clockwise. |
| `lower` | number (px) | -50 | The furthest a slider or wheel goes back. |
| `upper` | number (px) | 50 | The furthest a slider or wheel goes forward. |
| `strength` | number | 0 | The most force a mouse joint pulls with; 0 is plenty for the body's mass. |
| `collide` | bool | false | The two bodies still bump into each other. |
| `breakForce` | number | 0 | Breaks (and sends broke) when pulled harder than this; 0 never breaks. |

| Method | |
| --- | --- |
| `getAngle()` | How far a pin has turned (radians). |
| `getTranslation()` | How far a slider has slid (pixels). |
| `getLength()` | How far apart a rope, spring or distance joint's ends are. |
| `getSpeed()` | How fast a pin turns or a slider slides. |
| `getForce()` | How hard the joint pulls now. |
| `getTorque()` | How hard the joint twists now. |
| `isBroken()` | True once breakForce broke it. |

| Event (a function in its script) | |
| --- | --- |
| `function broke()` | It was pulled harder than breakForce and let go. |
<!-- end -->
