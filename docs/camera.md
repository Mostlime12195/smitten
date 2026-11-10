# Camera

A **Camera** decides which part of the scene is on the screen. Without
one, the screen shows the scene from (0, 0) at the top-left corner. UI
pieces stay put on the screen whatever the camera does.

## Following the player

The simplest way is to put the Camera inside the player: it moves with
them. Or set the Camera's **target** to the player in the Inspector (or
call `Camera:follow(player)`), which lets the camera live anywhere and
switch targets later.

**smoothing** makes it glide after its target instead of sticking to it
(0 sticks, 5 is gentle). `offsetX` and `offsetY` shift the view, for
example to look ahead of a running player. After teleporting the player,
`snap()` jumps the camera straight there.

```lua
-- On the player: look ahead in the direction it's running
function update(dt)
  Camera.offsetX = approach(Camera.offsetX, sign(vx) * 60, 120 * dt)
end
```

## Keeping it inside the level

`left`, `top`, `right` and `bottom` stop the camera from showing anything
past those edges. `setLimits(left, top, right, bottom)` sets all four, and
`limitTo(level)` uses the painted area of a Tiles piece, so the view never
shows empty space outside the level. If the limited area is smaller than
the screen, it's centered.

## Zoom and shake

`zoom = 2` makes everything twice as big; tween it for a smooth zoom.
`shake(strength, seconds)` shakes the view and fades out: `shake(6, 0.3)`
for a hit, `shake(16, 0.8)` for an explosion.

## Several cameras

The first active camera in the scene is the one used. `makeCurrent()`
switches to another camera, and `camera()` returns the one in use.

## Screen and scene positions

The screen is measured in game pixels, and the scene in its own units
through the camera. These convert between them:

| | |
| --- | --- |
| `mouse()` | The pointer's position in the scene |
| `Camera:screenToWorld(x, y)` | A point on the screen, as a point in the scene |
| `Camera:worldToScreen(x, y)` | A point in the scene, as a point on the screen |
| `Camera:getView()` | The part of the scene on screen: x, y, width, height |

```lua
-- Spawn a bat just past the right edge of the screen
local vx, vy, vw, vh = camera():getView()
spawn("scenes/bat.scene", { x = vx + vw + 32, y = vy + rnd(vh) })
```

For layers that scroll slower or faster than the camera (far hills, a sky
that stays put), see [Backgrounds](backgrounds.md).

<!-- piece:Camera -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `active` | bool | true | When this is on, the game uses this camera. If more than one camera is active, the first in the scene has priority. |
| `zoom` | number | 1 | The zoom: 2 shows everything twice as big. |
| `smoothing` | number | 0 | How gently the camera catches up: 0 follows exactly, 5 glides. |
| `target` | piecepath | "" | A piece to follow, anywhere in the scene. If it is empty, the camera stays at its own position. |
| `offsetX` | number (px) | 0 | The camera looks this far to the right of what it follows. |
| `offsetY` | number (px) | 0 | The camera looks this far below what it follows. |
| `left` | number (px) | none | The camera does not show anything to the left of this edge. If it is empty, there is no edge. |
| `top` | number (px) | none | The camera does not show anything above this edge. |
| `right` | number (px) | none | The camera does not show anything to the right of this edge. |
| `bottom` | number (px) | none | The camera does not show anything below this edge. |

| Method | |
| --- | --- |
| `shake(strength?, seconds?)` | Shakes the view: shake(6, 0.3). |
| `follow(piece)` | Follows a piece. With nil, the camera goes back to target, or to its own position. |
| `snap()` | Moves directly to what it follows, without smoothing (for example, after a teleport). |
| `setLimits(left, top, right, bottom)` | Sets the edges that the camera does not show past (nil for no edge). |
| `limitTo(piece)` | Keeps the view inside the painted part of a Tiles piece. |
| `makeCurrent()` | Makes this the camera in use and turns the other cameras off. |
| `getView()` | Returns the part of the scene that is on the screen: x, y, width, height. |
| `screenToWorld(sx, sy)` | Takes a point on the screen and returns it as a point in the scene. |
| `worldToScreen(x, y)` | Takes a point in the scene and returns it as a point on the screen. |
<!-- end -->
