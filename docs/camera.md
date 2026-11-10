# Camera

A **Camera** sets which part of the scene is on the screen. If a scene has
no Camera, the screen shows the scene with (0, 0) at the top-left corner.
UI pieces stay in the same position on the screen, when the camera moves
and when it does not.

## Following the player

The simplest method is to put the Camera inside the player. Then the
Camera moves with the player. A different method is to set the **target**
of the Camera to the player in the Inspector, or to call
`Camera:follow(player)`. With this method, the Camera can be in any
position in the scene, and it can change to a different target later.

- **smoothing** makes the Camera move smoothly after its target. 0 makes
  the Camera stay exactly on the target. 5 makes it move gently.
- `offsetX` and `offsetY` move the view. For example, use them to show
  more of the level in front of a player who runs.
- After you teleport the player, call `snap()`. The camera then goes to
  the player immediately.

```lua
-- On the player: show more of the level in the direction that the player runs
function update(dt)
  Camera.offsetX = approach(Camera.offsetX, sign(vx) * 60, 120 * dt)
end
```

## Keeping it inside the level

`left`, `top`, `right` and `bottom` are limits. The camera does not show
the scene past these edges.

- `setLimits(left, top, right, bottom)` sets all four limits.
- `limitTo(level)` uses the painted area of a Tiles piece as the limits.
  Because of this, the view does not show empty space outside the level.

If the area in the limits is smaller than the screen, the camera puts the
area in the center.

## Zoom and shake

`zoom = 2` makes all things two times bigger. To zoom smoothly, tween
`zoom`. `shake(strength, seconds)` shakes the view, and the shake becomes
weaker until it stops. For example, use `shake(6, 0.3)` for a hit and
`shake(16, 0.8)` for an explosion.

## Several cameras

Smitten uses the first active camera in the scene. `makeCurrent()` changes
to a different camera. `camera()` gives the camera that Smitten uses now.

## Screen and scene positions

Positions on the screen are in game pixels. Positions in the scene are in
the units of the scene, through the camera. These functions change one
type of position to the other:

| | |
| --- | --- |
| `mouse()` | The position of the pointer in the scene |
| `Camera:screenToWorld(x, y)` | A point on the screen, as a point in the scene |
| `Camera:worldToScreen(x, y)` | A point in the scene, as a point on the screen |
| `Camera:getView()` | The part of the scene that is on the screen: x, y, width, height |

```lua
-- Spawn a bat immediately past the right edge of the screen
local vx, vy, vw, vh = camera():getView()
spawn("scenes/bat.scene", { x = vx + vw + 32, y = vy + rnd(vh) })
```

For layers that scroll slower or faster than the camera (for example, far
hills, or a sky that does not move), see [Backgrounds](backgrounds.md).

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
