# Backgrounds

A **Background** is a Group that scrolls at its own speed when the camera
moves. Some examples are hills far away that move slowly, a sky that does
not move, and clouds that move by themselves. Another example is fog in
front of all the other pieces. This is parallax, and it gives a flat scene depth.

You can put any piece inside a Background: Sprites, Shapes, a Tiles piece,
or a placed scene. The pieces inside keep their own positions. When the
game draws them, the Background moves them all by the same distance.

| | |
| --- | --- |
| `scrollX`, `scrollY` | How much it moves with the scene when the camera moves. Use 1 for the same speed as all other pieces. Use 0.5 for half the speed, so it looks far away. Use 0 to keep it at one place on the screen. Use more than 1 for things in front |
| `repeatWidth`, `repeatHeight` | The engine draws the pieces inside again at each interval of this many pixels, to the end of the view. With this, one picture gives a background with no end (0: once) |
| `driftX`, `driftY` | Moves by itself, in pixels a second: for clouds, rain or a starfield |
| `offsetX`, `offsetY` | Moves it by this distance. Change these properties from a script to scroll the Background yourself |
| `left`, `top`, `right`, `bottom` | Edges. While the view is past an edge, the Background does not scroll at its own speed in that direction. It moves with the scene |

All the other properties come from Group:

- `layer` and the sequence in the scene set which pieces are in front.
- `tint` gives it a color.
- `visible` hides it.
- A [Light or the Tint](lights.md) lights the pieces inside, as it lights
  all pieces. For a sky that must stay bright at night, turn `lit` off.

## Three layers

This example puts a sky, hills and a forest behind the level of a
platformer:

1. Add a **Background** with the name Sky. Set `scrollX` and `scrollY`
   to 0.
2. Put a Sprite with the sky picture inside Sky. Put it where it fills the
   screen of the game (the outline of the screen in the scene view).
3. Add a **Background** with the name Hills. Set `scrollX` to 0.3.
4. Set `scrollY` of Hills to 0.3. To keep the hills level with the ground,
   set it to 1.
5. Put the Sprite with the hills inside Hills. Put its left edge at
   x = 0.
6. Set `repeatWidth` of Hills to the width of the picture. The hills now
   continue with no end.
7. Add a **Background** with the name Forest. Set `scrollX` to 0.6.
8. Set `repeatWidth` of Forest to the width of its picture.
9. Add the level (Tiles, the player, a Camera that follows the player)
   after the Backgrounds in the scene. The engine then draws the level in
   front of them.

```
Level
├─ Sky       Background   scroll 0
│  └─ Sprite
├─ Hills     Background   scroll 0.3, repeatWidth 480
│  └─ Sprite
├─ Forest    Background   scroll 0.6, repeatWidth 480
│  └─ Sprite
├─ Ground    Tiles
└─ Player    Body
   └─ Camera
```

You do not need code for this. For clouds, add one more Background with a
picture of clouds, a `repeatWidth` and `driftX = -10`.

## Where the engine draws Backgrounds

The engine draws a Background at the position where you put it, while the
camera shows the **first screen** of the scene. The first screen is the
area from 0, 0 to the width and height of the game. A scene without a
Camera also shows this area. For this reason, put the background pictures
against the outline of this area in the scene view.

When the camera moves a distance away from the first screen, the
Background moves with the scene by `scroll` times that distance. The scene
view shows Backgrounds at the positions where you put them. It also shows
a note with their scroll values and an outline of the repeat size.

When the camera zooms, the Backgrounds also zoom, around the center of the
screen.

When you use a repeat size, the pieces inside must fit between 0 and the
repeat size (from the position of the Background). For example, a picture
with a width of 480 pixels, its left edge at x = 0 and
`repeatWidth = 480` repeats with no gaps. A smaller repeat size makes the
copies overlap. A larger repeat size makes gaps between the copies, which
is good for clouds or lamp posts that stand alone.

```lua
-- Scroll a starfield from the script, not with the camera
function update(dt)
  Stars.offsetX -= shipSpeed * dt * 0.2
end
```

```lua
-- Where is it now? getScroll() gives its distance from its own position
local x, y = Hills:getScroll()
```

## Notes

- Backgrounds change only how the game looks. A Body or a Zone inside a
  Background collides at the position where you put it, not where the
  engine draws it. `worldPosition()` also gives the position where you put
  it.
- In a Background that repeats, a Light or an Occluder works in one copy
  only.
- Particles inside a Background must have `followPiece` on. If not, the
  engine draws the particles where they started in the scene.
- A Background inside a Background adds the two movements.
- If a scene has no Background, this feature costs it no time.

<!-- piece:Background -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `scrollX` | number | 0.5 | How much it moves sideways when the camera moves. 1 moves with the scene, 0.5 moves half as much (far away), and 0 stays on the screen. Use more than 1 for things in front. |
| `scrollY` | number | 0.5 | The same as scrollX, but up and down. |
| `repeatWidth` | number (px) | 0 | The pieces inside repeat sideways at this distance, as far as the view goes. 0 draws them once. Use the width of the image. |
| `repeatHeight` | number (px) | 0 | The pieces inside repeat up and down at this distance. 0 draws them once. |
| `driftX` | number (px/s) | 0 | Moves sideways by itself at this speed, like clouds. A negative value moves it left. |
| `driftY` | number (px/s) | 0 | Moves down by itself at this speed. A negative value moves it up. |
| `offsetX` | number (px) | 0 | Moves the pieces inside sideways. Change it from a script to scroll by hand. |
| `offsetY` | number (px) | 0 | Moves the pieces inside up or down. |
| `left` | number (px) | none | While the view is left of this edge, the background stops its own scrolling and moves with the scene. If it is empty, there is no edge. |
| `top` | number (px) | none | While the view is above this edge, the background stops its own scrolling and moves with the scene. |
| `right` | number (px) | none | While the view is right of this edge, the background stops its own scrolling and moves with the scene. |
| `bottom` | number (px) | none | While the view is below this edge, the background stops its own scrolling and moves with the scene. |

| Method | |
| --- | --- |
| `getScroll()` | Returns the current distance between where the engine draws it and where you put it: x, y. |
<!-- end -->
