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
| `raycast(x1, y1, x2, y2, tags)` | The first body or solid tiles on a line: { piece, x, y, nx, ny, fraction }, or nil. tags (optional) only counts pieces with one of them. |
| `raycastAll(x1, y1, x2, y2, tags)` | Everything on a line, nearest first: a list of { piece, x, y, nx, ny, fraction }. |
| `piecesAt(x, y, tags)` | The bodies and zones whose shapes contain a point. |
| `overlap(kind, x, y, ...)` | The bodies and zones touching a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, width, height). |
| `getGravity()` | The scene's gravity: x, y in pixels per second per second. |
| `setGravity(x, y)` | Changes the scene's gravity: setGravity(0, 0) floats everything. |
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
