# Physics

Every scene has a physics world, powered by Box2D. **Bodies** are solid
things that bump into each other, **Zones** notice when things go in and
out, **Hitboxes** give either one extra shapes, **Joints** connect bodies
together, and solid **tiles** act as walls and floors. Physics updates 60
times a second, right after every piece's `physicsUpdate(dt)`.

Lengths are in pixels, speeds in pixels per second, angles in degrees
(clockwise; `spin` is degrees per second), and mass in kilograms. As everywhere in Smitten, `y` points
down, so `vy = -400` moves up.

## Bodies

A Body's **motion** decides what moves it:

| `motion` | Moved by | Good for |
| --- | --- | --- |
| `still` | Nothing, unless a script moves it | Floors, walls, moving platforms |
| `scripted` | Its script, by setting `vx`, `vy` and calling `move()` | Players and enemies |
| `physics` | The physics world: gravity, collisions, forces, joints | Crates, balls, debris |

Motion can change at any time, so a crate can sit `still` until something
knocks it loose.

A Body's **shape** is the part that collides:

| `shape` | |
| --- | --- |
| `auto` | Fits the Sprites and Shapes inside the Body (the default) |
| `rectangle` | `width` × `height` |
| `circle` | `radius` |
| `capsule` | `width` × `height` with rounded ends; good for characters |
| `polygon` | Up to 8 corners in `points`: `{x1, y1, x2, y2, ...}` |
| `none` | Only its Hitboxes |

Shapes move, turn and scale with the piece. A **Hitbox** inside a Body or
Zone adds another shape, for things `auto` can't make, like an L shape or
a sword's reach; set its `off` to disable it.

## Moving players and enemies

Scripted bodies are moved by their script. Set the speed you want, then
call `move()`:

```lua
gravity = 1800       -- how fast it falls

function physicsUpdate(dt)
  vx = axis("left", "right") * 220
  vy = math.min(vy + gravity * dt, 1000)         -- gravity, with a top speed
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
  move()
end
```

`jumpSpeed(height)` works out the speed for a jump that high from the
script's `gravity` (or give it one: `jumpSpeed(96, 1200)`).

`move()` does the hard parts of platformer movement for you: it slides
along walls, walks up and down slopes up to `slope` degrees, stays on the
ground over small bumps, rides moving platforms, pushes physics bodies
(harder the heavier its `mass`), jumps up through one-way tiles and lands
on them.

| | |
| --- | --- |
| `onGround()`, `onWall()`, `onCeiling()` | What the last `move()` ran into |
| `moveBy(dx, dy)` | Moves in a straight line until blocked, and returns what it hit |

Setting `x`, `y` or `rotation` directly moves a body there, pushing aside
what's in the way over short distances.

## Physics bodies

Physics bodies move on their own. `vx`, `vy` and `spin` are their current
velocity; set them to throw something. To push them around:

| | |
| --- | --- |
| `applyImpulse(ix, iy)` | A sudden push, like a jump or a kick. Applied at a point (`applyImpulse(ix, iy, x, y)`), it also spins the body |
| `applyForce(fx, fy)` | A steady push for one step; call it every `physicsUpdate` for wind or thrusters |
| `applyTorque(t)`, `applyAngularImpulse(i)` | The same for turning (twisting strengths, not angles) |
| `grab(x, y)`, `dragTo(x, y)`, `drop()` | Hold the body by a point, move it, and let go (it keeps its momentum) |
| `wake()` | Wake a body that has come to rest |

| Setting | |
| --- | --- |
| `mass` | How heavy it is, in kilograms |
| `gravityScale` | How strongly gravity pulls it: 1 is normal, 0 floats, -1 falls up |
| `friction`, `bounce` | From 0 to 1: grip, and bounciness |
| `drag`, `spinDrag` | Slow its movement and its turning, like air resistance |
| `fixedRotation` | Never turns over |
| `bullet` | Extra-careful collisions for small, fast things |
| `asleep` | Start resting until something touches it |

Setting `x`, `y` or `rotation` of a physics body teleports it and keeps
its speed. Here's an explosion that throws everything nearby outwards:

```lua
for _, p in ipairs(overlap("circle", x, y, 150)) do
  if p.motion == "physics" then
    local dx, dy = p.x - x, p.y - y
    local d = math.max(dist(0, 0, dx, dy), 1)
    p:applyImpulse(dx / d * 600 * p.mass, dy / d * 600 * p.mass)
  end
end
```

## Collisions

When a Body starts touching something, its script's `hit(other, contact)`
runs, on both bodies. `contact` says where and how hard:

| `contact` | |
| --- | --- |
| `x`, `y` | Where they touched |
| `nx`, `ny` | The direction from `other` towards this body |
| `impulse` | How hard they hit: small for a touch, large for a crash |

```lua
function hit(other, contact)
  if contact.impulse > 300 then sfx("thud") end
  if other:is("spikes") then reload() end
end
```

| | |
| --- | --- |
| `isTouching(pieceOrTag)` | Whether it's touching that piece, or anything with that tag, right now |
| `touching(pieceOrTag)` | The first matching piece it's touching, or nil |
| `contacts()` | Everything it's touching: `{piece, x, y, nx, ny, impulse}` |
| `touchingTile(setting)` | The settings of a touched tile with that setting |

**passThrough** lists tags a body goes straight through, both ways: a
ghost might pass through `"walls"`. `"tiles"` passes through solid tiles.

## Zones

A Zone notices bodies and other zones going in and out, without blocking
anything. Its script gets `entered(other)` and `exited(other)`, and so
does the Body that went in. **detects** limits it to things with certain
tags, `active = false` turns it off, and `inside()` lists what's in it
right now. Zones don't notice `still` bodies.

## Tiles

Solid tiles in a Tiles piece are walls and floors with smooth seams, so
nothing catches on the edges between tiles. One-way tiles are solid only
from above. Changing tiles with `setTile`, `fill` or `clear` takes effect
immediately. See [Tiles](tiles.md).

## Queries

These ask the physics world about the scene. They work in any script, and
on `smitten.physics`:

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
-- Can this enemy see the player, with nothing solid in between?
local hit = raycast(x, y, player.x, player.y)
local sees = hit and hit.piece == player
```

Raycasts skip Zones and the backs of tiles.

## Gravity

The scene's gravity is set in **Project settings › Physics**
(`physics.gravity`, `[0, 980]` by default). `setGravity(0, 0)` switches it
off for a space level, and `getGravity()` reads it. Scripted bodies apply
their own gravity in their script, as in the example above.

## Joints

A **Joint** connects body `a` to body `b`, or to its own spot in the
scene when `b` is empty. It acts where the Joint piece is, so a door's
hinge Joint goes at the hinge.

| `kind` | |
| --- | --- |
| `pin` | Turns around the Joint, like a hinge or a wheel on an axle. Can have a `motor`, a `limit` (`minAngle`, `maxAngle`) and a `spring` |
| `weld` | Holds them together; with `spring`, it flexes |
| `rope` | Keeps them at most `length` apart |
| `spring` | Pulls them towards `length` apart, with `stiffness` and `damping` |
| `distance` | Keeps them exactly `length` apart, like a rod |
| `slider` | Slides along the Joint's x direction, like a piston. Can have a `motor`, a `limit` (`lower`, `upper`) and a `spring` |
| `wheel` | Turns, with a spring along the Joint's y direction, like a car's wheel |
| `mouse` | Pulls `a` towards wherever the Joint is |

Joint settings can change while the game runs (`motorSpeed = 5`).
`collide` lets the two connected bodies still bump into each other. With a
`breakForce`, the joint snaps when pulled harder than that and sends
`broke`. `getAngle()`, `getTranslation()`, `getLength()`, `getSpeed()`,
`getForce()` and `getTorque()` read its state.

## Reference

<!-- piece:Body -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `motion` | enum | "scripted" | still: moves only when a script sets x/y. scripted: moved by move(). physics: simulated. |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside. capsule has round ends. none: Hitboxes only. |
| `width` | number (px) | 32 | Rectangle or capsule width. |
| `height` | number (px) | 32 | Rectangle or capsule height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... (up to 8 corners; a dent is filled in). |
| `vx` | number (px/s) | 0 | Horizontal speed (px/s). |
| `vy` | number (px/s) | 0 | Speed down (negative is up). Scripted: what move() goes by. Physics: its speed now. |
| `spin` | angle (°/s) | 0° | How fast it turns, in degrees a second (clockwise is positive): 360 is a whole turn every second. Scripted: move() turns it this fast. |
| `slope` | angle (°) | 2578.31° | The steepest surface that still counts as ground, in degrees: move() walks up it without sliding back. |
| `mass` | number (kg) | 1 | Kilograms. A scripted body pushes physics bodies by its mass against theirs. |
| `friction` | number | 0.3 | How much it grips what it touches: 0 is ice. |
| `bounce` | number | 0 | How much it bounces: 0 none, 1 forever. |
| `gravityScale` | number | 1 | How strongly gravity pulls it: 1 is normal, 0 floats, -1 falls up. |
| `drag` | number | 0 | Air resistance: slows its movement down. |
| `spinDrag` | number | 0 | Slows its turning down. |
| `fixedRotation` | bool | false | Never tip over or spin. |
| `bullet` | bool | false | Continuous collision against moving bodies, for small fast objects. |
| `asleep` | bool | false | At rest until touched. Physics bodies sleep when they stop. |
| `passThrough` | tags | "" | Tags of things it doesn't bump into, like "ghost, pickup" ("tiles" for solid tiles). |

| Method | |
| --- | --- |
| `move()` | Moves by vx, vy for this step: slides along walls, climbs slopes, rides platforms, pushes physics bodies. |
| `moveBy(dx, dy)` | Moves by an offset and stops at the first thing in the way; returns what it hit, or nil. |
| `onGround()` | True if the last move ended standing on something. |
| `onWall()` | True if the last move ran into a wall. |
| `onCeiling()` | True if the last move ran into a ceiling. |
| `applyImpulse(ix, iy, x?, y?)` | Instant change of velocity by impulse / mass. At a point, also spins. |
| `applyForce(fx, fy, x?, y?)` | Force for this step; call every physicsUpdate. At its center or a point. |
| `applyTorque(torque)` | Turns it steadily for this step (physics bodies). |
| `applyAngularImpulse(impulse)` | A sudden twist (physics bodies). |
| `push(ix, iy)` | The same as applyImpulse(ix, iy). |
| `wake()` | Wakes a sleeping physics body. |
| `grab(x, y, strength?)` | Holds it by a scene point for dragTo(); drop() releases with momentum. |
| `dragTo(x, y)` | Moves the grabbed point towards x, y. |
| `drop()` | Lets go after grab(); a physics body keeps its speed. |
| `touching(tagOrPiece)` | The first body or zone with a tag (or that piece) touching this one, or nil. |
| `isTouching(other)` | True if it touches a piece (a body, zone or Tiles) or anything with a tag. |
| `contacts()` | Current contacts: {piece, x, y, nx, ny, impulse}. |
| `touchingTile(setting)` | The settings of a touching tile that has this setting (like "damage"), or nil. |
| `getSize()` | The size of the box around its shapes: width, height. |

| Event (a function in its script) | |
| --- | --- |
| `function hit(other, contact)` | Started touching a body or solid tiles. contact: x, y, nx, ny (from other to this body), impulse. |
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
| `kind` | enum | "pin" | pin, weld, rope, spring, distance, slider (x axis), wheel (y axis spring) or mouse. |
| `a` | piecepath | "" | The body it holds. |
| `b` | piecepath | "" | The body it connects a to (empty: the place where the Joint is). |
| `length` | number (px) | 0 | How far apart; 0 uses the distance when the joint is made. |
| `spring` | bool | false | Springy: a pin or slider pulls back to where it started, a weld wobbles. |
| `stiffness` | number (Hz) | 4 | How stiff the spring is: wobbles per second. |
| `damping` | number | 0.5 | How quickly the spring stops wobbling: 1 doesn't overshoot. |
| `motor` | bool | false | Drive it: turn a pin or wheel, or move a slider, at motorSpeed. |
| `motorSpeed` | number | 90 | Degrees a second (pin, wheel) or pixels a second (slider, distance). |
| `motorStrength` | number | 100000 | The most torque (pin, wheel) or force (slider, distance) the motor uses. |
| `limit` | bool | false | Keep a pin between minAngle and maxAngle, or a slider or wheel between lower and upper. |
| `minAngle` | angle (°) | -2578.31° | The furthest a pin turns anticlockwise, in degrees. |
| `maxAngle` | angle (°) | 2578.31° | The furthest a pin turns clockwise, in degrees. |
| `lower` | number (px) | -50 | The furthest a slider or wheel goes back. |
| `upper` | number (px) | 50 | The furthest a slider or wheel goes forward. |
| `strength` | number | 0 | The most force a mouse joint pulls with; 0 is plenty for the body's mass. |
| `collide` | bool | false | The two bodies still bump into each other. |
| `breakForce` | number | 0 | Breaks (and sends broke) when pulled harder than this; 0 never breaks. |

| Method | |
| --- | --- |
| `getAngle()` | How far a pin has turned, in degrees. |
| `getTranslation()` | How far a slider has slid (pixels). |
| `getLength()` | How far apart a rope, spring or distance joint's ends are. |
| `getSpeed()` | How fast a pin turns (degrees a second) or a slider slides (pixels a second). |
| `getForce()` | How hard the joint pulls now. |
| `getTorque()` | How hard the joint twists now. |
| `isBroken()` | True once breakForce broke it. |

| Event (a function in its script) | |
| --- | --- |
| `function broke()` | It was pulled harder than breakForce and let go. |
<!-- end -->
