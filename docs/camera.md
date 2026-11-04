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

<!-- piece:Camera -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `active` | bool | true | Use this camera. When several are active, the first in the scene wins. |
| `zoom` | number | 1 | 2 shows everything twice as big. |
| `smoothing` | number | 0 | How gently it catches up: 0 sticks exactly, 5 glides. |
| `target` | piecepath | "" | A piece to follow, wherever the camera is in the scene (empty: the camera's own position). |
| `offsetX` | number (px) | 0 | Looks this far right of what it follows. |
| `offsetY` | number (px) | 0 | Looks this far below what it follows. |
| `left` | number (px) | none | Don't show anything left of this (empty for no edge). |
| `top` | number (px) | none | Don't show anything above this. |
| `right` | number (px) | none | Don't show anything right of this. |
| `bottom` | number (px) | none | Don't show anything below this. |

| Method | |
| --- | --- |
| `shake(strength?, seconds?)` | Shakes the view: shake(6, 0.3). |
| `follow(piece)` | Follows a piece (nil: back to target, or the camera's own position). |
| `snap()` | Jumps straight to what it follows, without smoothing (after a teleport). |
| `setLimits(left, top, right, bottom)` | Sets the edges it doesn't show past (nil for no edge). |
| `limitTo(piece)` | Keeps the view inside the painted part of a Tiles piece. |
| `makeCurrent()` | Makes this the camera in use, turning the others off. |
| `getView()` | The part of the scene on screen: x, y, width, height. |
| `screenToWorld(sx, sy)` | A point on the screen, as a point in the scene. |
| `worldToScreen(x, y)` | A point in the scene, as a point on the screen. |
<!-- end -->
