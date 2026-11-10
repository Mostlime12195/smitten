# Physics

Each scene has a physics world, which uses Box2D:

- **Bodies** are solid things that hit each other.
- **Zones** see when things go in and out.
- **Hitboxes** give Bodies and Zones more shapes.
- **Joints** connect bodies.
- Solid **tiles** are walls and floors.

The engine updates the physics world 60 times a second, immediately after
it calls `physicsUpdate(dt)` on all pieces.

Lengths are in pixels, and speeds are in pixels a second. Angles are in
degrees, clockwise (`spin` is in degrees a second). Mass is in kilograms.
As everywhere in Smitten, `y` points down, so `vy = -400` moves up.

## Bodies

The **motion** of a Body sets what moves it:

| `motion` | Moved by | Use it for |
| --- | --- | --- |
| `still` | Nothing, unless a script moves it | Floors, walls, moving platforms |
| `scripted` | Its script, which sets `vx` and `vy` and calls `move()` | Players and enemies |
| `physics` | The physics world: gravity, collisions, forces, joints | Crates, balls, debris |

You can change the motion at any time. For example, a crate can stay
`still` until something hits it.

The **shape** of a Body is the part that collides:

| `shape` | |
| --- | --- |
| `auto` | Fits the Sprites and Shapes inside the Body (the default) |
| `rectangle` | `width` × `height` |
| `circle` | `radius` |
| `capsule` | `width` × `height` with round ends. Good for characters |
| `polygon` | Up to 8 corners in `points`: `{x1, y1, x2, y2, ...}` |
| `none` | Only its Hitboxes |

Shapes move, turn and scale with the piece. A **Hitbox** inside a Body or
a Zone adds one more shape. Use it for shapes that `auto` cannot make, for
example an L shape or the reach of a sword. To disable a Hitbox, set its
`off`.

## Moving players and enemies

The script of a scripted Body moves it. Set the speed that you want. Then
call `move()`:

```lua
gravity = 1800       -- how fast it falls

function physicsUpdate(dt)
  vx = axis("left", "right") * 220
  vy = math.min(vy + gravity * dt, 1000)         -- gravity, with a maximum speed
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
  move()
end
```

`jumpSpeed(height)` calculates the speed for a jump of that height. It
uses the `gravity` of the script, or a gravity that you give it:
`jumpSpeed(96, 1200)`.

`move()` does the difficult parts of platformer movement for you:

- It slides along walls.
- It walks up and down slopes to a maximum of `slope` degrees.
- It stays on the ground over small bumps.
- It moves with moving platforms.
- It pushes physics bodies. A larger `mass` pushes them more.
- It jumps up through one-way tiles and lands on them.

| | |
| --- | --- |
| `onGround()`, `onWall()`, `onCeiling()` | What the last `move()` hit |
| `moveBy(dx, dy)` | Moves in a straight line until something blocks it, and returns what it hit |

When you set `x`, `y` or `rotation` directly, the body goes there. Over
short distances, it pushes away the things in its path.

## Physics bodies

Physics bodies move by themselves. `vx`, `vy` and `spin` are their
velocity now. To throw a body, set them. To push bodies, use these
methods:

| | |
| --- | --- |
| `applyImpulse(ix, iy)` | A sudden push, like a jump or a kick. If you give a point (`applyImpulse(ix, iy, x, y)`), it also turns the body |
| `applyForce(fx, fy)` | A constant push for one step. For wind or thrusters, call it in each `physicsUpdate` |
| `applyTorque(t)`, `applyAngularImpulse(i)` | The same for turning (the values are strengths of the twist, not angles) |
| `grab(x, y)`, `dragTo(x, y)`, `drop()` | Hold the body at a point, move it, and release it (it keeps its momentum) |
| `wake()` | Wake a body that is at rest |

| Property | |
| --- | --- |
| `mass` | How heavy it is, in kilograms |
| `gravityScale` | How much gravity pulls it: 1 is usual, 0 floats, -1 falls up |
| `friction`, `bounce` | From 0 to 1: grip, and bounce |
| `drag`, `spinDrag` | Make its movement and its turning slower, like air resistance |
| `fixedRotation` | It never turns |
| `bullet` | More careful collisions, for small things that move fast |
| `asleep` | It starts at rest, until something touches it |

When you set `x`, `y` or `rotation` of a physics body, the body goes there
immediately, and it keeps its speed. This explosion throws all the bodies
near it away from it:

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

When a Body starts to touch something, the engine calls
`hit(other, contact)` in its script. It does this for the two bodies. `contact` tells
where they touched and the force of the hit:

| `contact` | |
| --- | --- |
| `x`, `y` | Where they touched |
| `nx`, `ny` | The direction from `other` to this body |
| `impulse` | The force of the hit: small for a touch, large for a crash |

```lua
function hit(other, contact)
  if contact.impulse > 300 then sfx("thud") end
  if other:is("spikes") then reload() end
end
```

| | |
| --- | --- |
| `isTouching(pieceOrTag)` | Whether it touches that piece, or a piece with that tag, now |
| `touching(pieceOrTag)` | The first piece that it touches and that matches, or nil |
| `contacts()` | All the things that it touches: `{piece, x, y, nx, ny, impulse}` |
| `touchingTile(setting)` | The tile properties of a touched tile that has the tile property `setting` |

**passThrough** is a list of tags. The body goes through pieces with these
tags, and they go through the body. For example, a ghost can go through
`"walls"`. The tag `"tiles"` goes through solid tiles.

## Zones

A Zone sees when bodies and other zones go in and out. It does not block
anything. The engine calls `entered(other)` and `exited(other)` in its
script. It also calls them in the script of the Body that went in.

- **detects** limits the Zone to things with some tags.
- `active = false` turns the Zone off.
- `inside()` gives a list of what is in the Zone now.

Zones do not see `still` bodies.

## Tiles

Solid tiles in a Tiles piece are walls and floors with smooth seams, so
nothing catches on the edges between tiles. One-way tiles are solid only
from above. When you change tiles with `setTile`, `fill` or `clear`, the
change has an effect immediately. See [Tiles](tiles.md).

## Queries

These functions get data about the scene from the physics world. You can
use them in all scripts, and on `smitten.physics`:

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
-- Can this enemy see the player, with nothing solid between them?
local hit = raycast(x, y, player.x, player.y)
local sees = hit and hit.piece == player
```

Raycasts do not see Zones, and they do not see the back sides of tiles.

## Gravity

You set the gravity of the scene in **Project settings › Physics**
(`physics.gravity`, `[0, 980]` by default). `setGravity(0, 0)` turns it
off, for a level in space. `getGravity()` gets it. Scripted bodies apply
their own gravity in their script, as in the example above.

## Joints

A **Joint** connects body `a` to body `b`. When `b` is empty, it connects
`a` to a point in the scene. The Joint works at the position of the Joint
piece. For this reason, put the hinge Joint of a door at the hinge.

| `kind` | |
| --- | --- |
| `pin` | Turns around the Joint, like a hinge or a wheel on an axle. It can have a `motor`, a `limit` (`minAngle`, `maxAngle`) and a `spring` |
| `weld` | Holds them together. With `spring`, it bends |
| `rope` | Keeps them at a maximum distance of `length` |
| `spring` | Pulls them to a distance of `length`, with `stiffness` and `damping` |
| `distance` | Keeps them at exactly the distance `length`, like a rod |
| `slider` | Slides along the x direction of the Joint, like a piston. It can have a `motor`, a `limit` (`lower`, `upper`) and a `spring` |
| `wheel` | Turns, with a spring along the y direction of the Joint, like the wheel of a car |
| `mouse` | Pulls `a` to the position of the Joint |

You can change the properties of a Joint while the game runs
(`motorSpeed = 5`). `collide` lets the two connected bodies continue to
hit each other. When a Joint has a `breakForce`, it breaks when a pull is
stronger than that force. Then it sends the `broke` event. `getAngle()`,
`getTranslation()`, `getLength()`, `getSpeed()`, `getForce()` and
`getTorque()` get its state.

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
