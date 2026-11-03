# Camera

A Camera decides which part of the scene is on screen. Without one, the
scene's (0, 0) is the screen's top-left corner. UI pieces aren't moved by
cameras.

## Following

Two ways to follow the player:

- **Put the Camera inside the player.** It moves with them.
- **Set its `target`** to the player in the Inspector (or call
  `Camera:follow(player)` from a script). The camera can then sit anywhere
  in the scene, and switch targets.

`smoothing` makes it glide instead of sticking (0 sticks, 5 is gentle);
`offsetX`, `offsetY` look ahead of what it follows. After a teleport,
`snap()` jumps straight there.

```lua
-- On the player: look ahead the way it runs
function update(dt)
  Camera.offsetX = approach(Camera.offsetX, sign(vx) * 60, 120 * dt)
end
```

## Edges

`left`, `top`, `right` and `bottom` stop the camera showing anything past
them (empty: no edge). `setLimits(l, t, r, b)` sets all four;
`limitTo(Tiles)` uses the painted area of a tile map, so the camera stays
inside the level:

```lua
-- On the scene's root, which holds Camera and Level (a Tiles piece)
function ready() Camera:limitTo(Level) end
```

When the area is smaller than the screen, it's centered.

## Zoom and shake

`zoom = 2` shows everything twice as big; tween it for a smooth zoom:
`tween(Camera, 0.5, { zoom = 1.5 })`. `shake(strength, seconds)` shakes the
view, fading out: `shake(6, 0.3)` for a hit, `shake(16, 0.8)` for an
explosion.

## Several cameras

The first active camera in the scene is used. `makeCurrent()` switches to a
camera (and turns the others off); `camera()` returns the one in use.

## Screen and scene coordinates

The screen is measured in game pixels (the resolution in Project settings),
the scene in its own units, through the camera.

| | |
| --- | --- |
| `mouse()` | The mouse in the scene |
| `Camera:screenToWorld(x, y)` | A point on the screen, in the scene |
| `Camera:worldToScreen(x, y)` | A point in the scene, on the screen |
| `Camera:getView()` | The part of the scene on screen: x, y, width, height |
| `smitten.scene.screenToWorld(x, y)`, `worldToScreen(x, y)` | The same through whichever camera is in use |

```lua
-- Spawn enemies just off the right of the screen
local vx, vy, vw, vh = camera():getView()
spawn("scenes/bat.scene", { x = vx + vw + 32, y = vy + rnd(vh) })
```

## The Camera piece

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
