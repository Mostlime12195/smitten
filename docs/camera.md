# Camera

A Camera sets which part of the scene is on screen. Without one, the
scene's (0, 0) is the top-left corner. Cameras don't move UI.

## Following

Put the Camera inside the player, or set its `target` (or call
`Camera:follow(piece)`). `smoothing` glides (0 sticks); `offsetX` and
`offsetY` shift the view; `snap()` jumps to the target.

```lua
Camera.offsetX = approach(Camera.offsetX, sign(vx) * 60, 120 * dt)
```

## Limits

`left`, `top`, `right` and `bottom` stop the view at those edges.
`setLimits(l, t, r, b)` sets all four; `limitTo(tiles)` uses a Tiles
piece's painted area. A limited area smaller than the screen is centered.

## Zoom and shake

`zoom = 2` doubles the size. `shake(strength, seconds)`: `shake(6, 0.3)`.

## Several cameras

The first active camera is used. `makeCurrent()` switches; `camera()`
returns the one in use.

## Coordinates

| | |
| --- | --- |
| `mouse()` | The pointer in the scene |
| `Camera:screenToWorld(x, y)`, `worldToScreen(x, y)` | Convert between screen and scene |
| `Camera:getView()` | The visible area: x, y, width, height |

```lua
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
