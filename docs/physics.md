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
| `raycast(x1, y1, x2, y2, tags)` | Returns the first body or solid tiles on a line: { piece, x, y, nx, ny, fraction }, or nil. If you give tags, it counts only pieces with one of them. |
| `raycastAll(x1, y1, x2, y2, tags)` | Returns everything on a line, nearest first: a list of { piece, x, y, nx, ny, fraction }. |
| `piecesAt(x, y, tags)` | Returns the bodies and zones whose shapes contain a point. |
| `overlap(kind, x, y, ...)` | Returns the bodies and zones that touch a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, width, height). |
| `getGravity()` | Returns the gravity of the scene: x, y in pixels per second per second. |
| `setGravity(x, y)` | Changes the gravity of the scene: setGravity(0, 0) makes everything float. |
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
| `motion` | enum | "scripted" | still: it moves only when a script sets x or y. scripted: move() moves it. physics: the physics engine moves it. |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside it. capsule has round ends. none means that only Hitboxes give it a shape. |
| `width` | number (px) | 32 | The width of the rectangle or capsule. |
| `height` | number (px) | 32 | The height of the rectangle or capsule. |
| `radius` | number (px) | 16 | The radius of the circle. |
| `points` | points | {0, -16, 16, 16, -16, 16} | The corner points x1, y1, x2, y2, ... (8 corners at most; the engine fills in dents). |
| `vx` | number (px/s) | 0 | The horizontal speed, in pixels per second. |
| `vy` | number (px/s) | 0 | The speed down (a negative value is up). For scripted motion, move() uses it. For physics motion, it is the current speed. |
| `spin` | angle (°/s) | 0° | How fast it turns, in degrees per second (clockwise is positive): 360 is a full turn every second. For scripted motion, move() turns it at this speed. |
| `slope` | angle (°) | 2578.31° | The steepest surface that is still ground, in degrees. move() walks up it and does not slide back. |
| `mass` | number (kg) | 1 | The mass, in kilograms. A scripted body pushes physics bodies by its mass against their mass. |
| `friction` | number | 0.3 | How much it grips what it touches: 0 is ice. |
| `bounce` | number | 0 | How much it bounces: 0 is no bounce, 1 bounces forever. |
| `gravityScale` | number | 1 | How strongly gravity pulls it: 1 is normal, 0 floats, -1 falls up. |
| `drag` | number | 0 | Air resistance: it slows the movement down. |
| `spinDrag` | number | 0 | Slows the turning down. |
| `fixedRotation` | bool | false | When this is on, the body never tips over or turns. |
| `bullet` | bool | false | When this is on, the physics engine checks collisions continuously against moving bodies. Use it for small, fast bodies. |
| `asleep` | bool | false | When this is on, the body stays at rest until something touches it. Physics bodies go to sleep when they stop. |
| `passThrough` | tags | "" | The tags of things that it does not bump into, for example "ghost, pickup" ("tiles" for solid tiles). |

| Method | |
| --- | --- |
| `move()` | Moves by vx, vy for this physics step. It slides along walls, climbs slopes, rides on platforms and pushes physics bodies. |
| `moveBy(dx, dy)` | Moves by an offset and stops at the first thing in the way. Returns what it hit, or nil. |
| `onGround()` | Returns true if the last move ended on top of something. |
| `onWall()` | Returns true if the last move ran into a wall. |
| `onCeiling()` | Returns true if the last move ran into a ceiling. |
| `applyImpulse(ix, iy, x?, y?)` | Changes the speed immediately by impulse / mass. At a point, it also makes the body spin. |
| `applyForce(fx, fy, x?, y?)` | Pushes with a force for this physics step, at the center or at a point. Call it in every physicsUpdate. |
| `applyTorque(torque)` | Turns a physics body steadily for this physics step. |
| `applyAngularImpulse(impulse)` | Gives a physics body a sudden twist. |
| `push(ix, iy)` | Does the same as applyImpulse(ix, iy). |
| `wake()` | Wakes up a physics body that sleeps. |
| `grab(x, y, strength?)` | Holds the body at a point in the scene for dragTo(). drop() lets it go with its momentum. |
| `dragTo(x, y)` | Moves the point that grab() holds towards x, y. |
| `drop()` | Lets go after grab(). A physics body keeps its speed. |
| `touching(tagOrPiece)` | Returns the first body or zone with a tag (or that piece) that touches this one, or nil. |
| `isTouching(other)` | Returns true if it touches a piece (a body, zone or Tiles) or anything with a tag. |
| `contacts()` | Returns the current contacts: {piece, x, y, nx, ny, impulse}. |
| `touchingTile(setting)` | Returns the tile properties of a touching tile that has this tile property (for example "damage"), or nil. |
| `getSize()` | Returns the size of the box around its shapes: width, height. |

| Event (a function in its script) | |
| --- | --- |
| `function hit(other, contact)` | The engine calls it when the body starts to touch a body or solid tiles. contact has x, y, nx, ny (from other to this body) and impulse. |
| `function entered(zone)` | The engine calls it when the body goes into a zone. |
| `function exited(zone)` | The engine calls it when the body leaves a zone. |
<!-- end -->

<!-- piece:Zone -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside it. The shapes turn and scale with the Zone. |
| `width` | number (px) | 32 | The width of the rectangle or capsule. |
| `height` | number (px) | 32 | The height of the rectangle or capsule. |
| `radius` | number (px) | 16 | The radius of the circle. |
| `points` | points | {0, -16, 16, 16, -16, 16} | The corner points x1, y1, x2, y2, ... (8 corners at most). |
| `detects` | tags | "" | The Zone notices only things with one of these tags. If it is empty, it notices everything. |
| `active` | bool | true | When this is on, the Zone notices things that go in and out. |

| Method | |
| --- | --- |
| `inside()` | Returns a list of the bodies and zones that are inside it now. |
| `touching(tagOrPiece)` | Returns the first body or zone with a tag (or that piece) that is inside it, or nil. |
| `isTouching(other)` | Returns true if a piece (or anything with a tag) is inside it. |

| Event (a function in its script) | |
| --- | --- |
| `function entered(other)` | The engine calls it when a body or zone comes in. |
| `function exited(other)` | The engine calls it when a body or zone leaves. |
<!-- end -->

<!-- piece:Hitbox -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "rectangle" | The shape. The position and rotation of the Hitbox put it in place and turn it. |
| `width` | number (px) | 32 | The width of the rectangle or capsule. |
| `height` | number (px) | 32 | The height of the rectangle or capsule. |
| `radius` | number (px) | 16 | The radius of the circle. |
| `points` | points | {0, -16, 16, 16, -16, 16} | The corner points x1, y1, x2, y2, ... (8 corners at most). |
| `off` | bool | false | When this is on, this shape is off. |
<!-- end -->

<!-- piece:Joint -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "pin" | pin, weld, rope, spring, distance, slider (on the x axis), wheel (a spring on the y axis) or mouse. |
| `a` | piecepath | "" | The body that the joint holds. |
| `b` | piecepath | "" | The body that the joint connects a to. If it is empty, the joint connects a to the position of the Joint. |
| `length` | number (px) | 0 | The distance between the bodies. 0 uses the distance at the time when the engine makes the joint. |
| `spring` | bool | false | When this is on, the joint is springy: a pin or slider pulls back to where it started, and a weld wobbles. |
| `stiffness` | number (Hz) | 4 | How stiff the spring is, in wobbles per second. |
| `damping` | number | 0.5 | How fast the spring stops wobbling: 1 does not overshoot. |
| `motor` | bool | false | When this is on, the joint drives the bodies: it turns a pin or wheel, or moves a slider, at motorSpeed. |
| `motorSpeed` | number | 90 | The speed of the motor, in degrees per second (pin, wheel) or pixels per second (slider, distance). |
| `motorStrength` | number | 100000 | The maximum torque (pin, wheel) or force (slider, distance) that the motor uses. |
| `limit` | bool | false | When this is on, a pin stays between minAngle and maxAngle, and a slider or wheel stays between lower and upper. |
| `minAngle` | angle (°) | -2578.31° | The maximum angle that a pin turns anticlockwise, in degrees. |
| `maxAngle` | angle (°) | 2578.31° | The maximum angle that a pin turns clockwise, in degrees. |
| `lower` | number (px) | -50 | The maximum distance that a slider or wheel moves back. |
| `upper` | number (px) | 50 | The maximum distance that a slider or wheel moves forward. |
| `strength` | number | 0 | The maximum force of the pull of a mouse joint. 0 gives enough force for the mass of the body. |
| `collide` | bool | false | When this is on, the two bodies still bump into each other. |
| `breakForce` | number | 0 | The joint breaks (and sends broke) when a pull is stronger than this. 0 means that it never breaks. |

| Method | |
| --- | --- |
| `getAngle()` | Returns how far a pin has turned, in degrees. |
| `getTranslation()` | Returns how far a slider has moved, in pixels. |
| `getLength()` | Returns the distance between the ends of a rope, spring or distance joint. |
| `getSpeed()` | Returns how fast a pin turns (degrees per second) or a slider moves (pixels per second). |
| `getForce()` | Returns how hard the joint pulls now. |
| `getTorque()` | Returns how hard the joint twists now. |
| `isBroken()` | Returns true after breakForce has broken the joint. |

| Event (a function in its script) | |
| --- | --- |
| `function broke()` | The engine calls it when a pull is stronger than breakForce and the joint lets go. |
<!-- end -->
