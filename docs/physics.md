# Physics

Each scene has a Box2D 3 world. **Bodies** are solid, **Zones** detect
overlaps, **Hitboxes** add shapes, **Joints** connect bodies, and solid
**tiles** are walls and floors. Physics steps 60 times a second, after
`physicsUpdate(dt)`.

Units: pixels, pixels per second, radians (clockwise), kilograms. `y` points
down.

## Bodies

| `motion` | Moved by | For |
| --- | --- | --- |
| `still` | Nothing, unless a script moves it | Floors, walls, moving platforms |
| `scripted` | `vx`, `vy` and `move()` | Players, enemies |
| `physics` | Gravity, collisions, forces, joints | Crates, balls, debris |

`motion` can change at any time.

| `shape` | |
| --- | --- |
| `auto` | Fits the Sprites and Shapes inside |
| `rectangle` | `width` × `height` |
| `circle` | `radius` |
| `capsule` | `width` × `height`, round ends |
| `polygon` | `points` `{x1, y1, x2, y2, ...}`, up to 8, convex |
| `none` | Hitboxes only |

Shapes move, turn and scale with the piece. A **Hitbox** inside a Body or
Zone adds a shape; `off = true` disables it.

## Scripted bodies

```lua
function physicsUpdate(dt)
  vx = axis("left", "right") * 220
  vy = math.min(vy + 1800 * dt, 1000)
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
  move()
end
```

`move()` moves by `vx * dt`, `vy * dt`. It slides along surfaces, climbs
slopes up to `slope` (45°), stays grounded over small steps, rides moving
platforms, pushes physics bodies according to `mass`, passes up through
one-way tiles, and turns by `spin`.

| | |
| --- | --- |
| `onGround()`, `onWall()`, `onCeiling()` | What the last move touched |
| `moveBy(dx, dy)` | Moves until blocked; returns what it hit, or nil |

Setting `x`, `y` or `rotation` moves the body there, pushing what's in the
way for short distances.

## Physics bodies

`vx`, `vy` and `spin` are the current velocity; set them to throw.

| | |
| --- | --- |
| `applyImpulse(ix, iy[, x, y])` | Instant change of velocity by impulse / `mass`; at a point, also spins |
| `applyForce(fx, fy[, x, y])` | Force for one step; call every `physicsUpdate` |
| `applyTorque(t)`, `applyAngularImpulse(i)` | Turning force; instant turn |
| `wake()` | Wakes a sleeping body |
| `grab(x, y)`, `dragTo(x, y)`, `drop()` | Hold, move and release by a point; keeps momentum |

| Setting | |
| --- | --- |
| `mass` | Kilograms |
| `gravity` | Gravity scale: 0 floats, -1 falls up |
| `friction`, `bounce` | 0 to 1 |
| `drag`, `spinDrag` | Linear and angular damping |
| `fixedRotation` | Never turns |
| `bullet` | Continuous collision against other moving bodies |
| `asleep` | Start at rest |

Setting `x`, `y` or `rotation` teleports and keeps velocity.

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

`hit(other, contact)` runs on both bodies when they start touching.

| `contact` | |
| --- | --- |
| `x`, `y` | Contact point |
| `nx`, `ny` | Normal, from `other` towards this body |
| `impulse` | Strength of the impact |

| | |
| --- | --- |
| `isTouching(pieceOrTag)` | Whether it touches it now |
| `touching(pieceOrTag)` | The first touching match, or nil |
| `contacts()` | Current contacts: `{piece, x, y, nx, ny, impulse}` |
| `touchingTile(setting)` | Settings of a touching tile that has `setting` |

`passThrough` lists tags this body ignores, both ways; `"tiles"` ignores
solid tiles.

## Zones

`entered(other)` and `exited(other)` run on the Zone and on the Body.
`detects` limits them to tags, `active = false` turns the Zone off, and
`inside()` lists what's in it. Zones don't block and don't detect still
bodies.

## Tiles

Solid tiles have smooth seams. `oneWay` tiles block only from above.
Changes by `setTile`, `fill` and `clear` apply immediately. See
[Tiles](tiles.md).

## Queries

Global in scripts and on `smitten.physics`:

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
local hit = raycast(x, y, player.x, player.y)
local sees = hit and hit.piece == player
```

Raycasts ignore Zones and the backs of tiles.

## Gravity

Set in **Project settings › Physics** (`physics.gravity`, default
`[0, 980]`). `setGravity(x, y)` and `getGravity()` change it at run time.
Scripted bodies apply their own gravity.

## Joints

A Joint connects body `a` to body `b`, or to its own position when `b` is
empty. It acts at the Joint's position.

| `kind` | |
| --- | --- |
| `pin` | Rotates around the Joint. `motor`, `limit` (`minAngle`, `maxAngle`), `spring` |
| `weld` | Fixed together; `spring` makes it flex |
| `rope` | At most `length` apart |
| `spring` | Pulls to `length`: `stiffness`, `damping` |
| `distance` | Exactly `length` apart |
| `slider` | Moves along the Joint's x axis. `motor`, `limit` (`lower`, `upper`), `spring` |
| `wheel` | Rotates, and springs along the Joint's y axis. `motor` |
| `mouse` | Pulls `a` towards the Joint's position |

Settings apply while running. `collide` lets connected bodies collide.
`breakForce` above 0 breaks the joint under that force and emits `broke`.
Read state with `getAngle()`, `getTranslation()`, `getLength()`,
`getSpeed()`, `getForce()` and `getTorque()`.

## love.physics

LÖVE's `love.physics` (Box2D 2.4) works as in LÖVE, as the optional
`lovephysics` module. Scenes don't use it.

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
| `spin` | number (rad/s) | 0 | How fast it turns (clockwise is positive). Scripted: move() turns it this fast. |
| `slope` | angle | 45° | The steepest surface that still counts as ground: move() walks up it without sliding back. |
| `mass` | number (kg) | 1 | Kilograms. A scripted body pushes physics bodies by its mass against theirs. |
| `friction` | number | 0.3 | How much it grips what it touches: 0 is ice. |
| `bounce` | number | 0 | How much it bounces: 0 none, 1 forever. |
| `gravity` | number | 1 | How strongly gravity pulls it; 0 floats, -1 falls up. |
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
