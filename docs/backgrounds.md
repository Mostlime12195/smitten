# Backgrounds

A **Background** is a Group that scrolls at its own speed when the camera
moves. Far hills that slide by slowly, a sky that stays put, clouds that
drift, fog in front of everything: this is parallax, and it makes a flat
scene look deep.

Anything can go inside one: Sprites, Shapes, a Tiles piece, a whole scene.
The pieces inside keep their own positions; the Background moves them
together when the game draws them.

| | |
| --- | --- |
| `scrollX`, `scrollY` | How much it moves with the scene when the camera moves. 1: like everything else. 0.5: half as fast, so it looks far away. 0: it stays on the screen. Above 1: faster, for things in front |
| `repeatWidth`, `repeatHeight` | Draws what's inside again every this many pixels, as far as the view goes: an endless background from one picture (0: once) |
| `driftX`, `driftY` | Slides by itself, in pixels a second: clouds, rain, a starfield |
| `offsetX`, `offsetY` | Shifts it; change them from a script to scroll by hand |
| `left`, `top`, `right`, `bottom` | Edges: while the view is past one, it stops scrolling its own way and moves with the scene |

Everything else is a Group's: `layer` and the order in the scene decide
what's in front, `tint` colors it, `visible` hides it, and a
[Light or the Tint](lights.md) lights what's inside like any piece (turn
`lit` off for a sky that should stay bright at night).

## Three layers

A sky, hills and a forest behind a platformer level:

1. Add a **Background** called Sky and set `scrollX` and `scrollY` to 0.
   Put a Sprite with the sky picture inside it, placed so it fills the
   game's screen (its frame in the scene view).
2. Add a **Background** called Hills with `scrollX` 0.3 (and `scrollY`
   0.3, or 1 to keep it level with the ground). Put the hills Sprite
   inside, with its left edge at x = 0, and set `repeatWidth` to the
   picture's width: the hills now go on for ever.
3. Add a **Background** called Forest with `scrollX` 0.6 and the same
   repeat for its own picture.
4. Then the level itself (Tiles, the player, a Camera that follows the
   player), after the Backgrounds in the scene so it's drawn in front.

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

No code is needed. For clouds, add one more Background with a cloud
picture, a `repeatWidth` and `driftX = -10`.

## Where things end up

A Background is drawn where you placed it while the camera shows the
scene's **first screen**: the area from 0, 0 to the game's width and
height, which is also what a scene without a Camera shows. So place
background pictures against that frame in the scene view. When the camera
moves away from there by some distance, the Background follows the scene
by `scroll` times that distance. The scene view shows Backgrounds as
placed, with a note of their scroll and an outline of the repeat size.

Zooming the camera zooms Backgrounds too, around the middle of the screen.

With a repeat size, what's inside should fit between 0 and the repeat size
(measured from the Background): a 480-wide picture with its left edge at
x = 0 and `repeatWidth = 480` tiles without gaps. A smaller repeat makes
copies overlap; a bigger one leaves gaps, which suits single clouds or
lamp posts.

```lua
-- Scroll a starfield by hand instead of with the camera
function update(dt)
  Stars.offsetX -= shipSpeed * dt * 0.2
end
```

```lua
-- Where is it now? getScroll() gives how far it's drawn from its place
local x, y = Hills:getScroll()
```

## Good to know

- Backgrounds are for looks. A Body or Zone inside one collides where it
  was placed, not where it's drawn, and `worldPosition()` gives the placed
  position.
- In a repeating Background, a Light or an Occluder shines or blocks in
  one copy only.
- Particles inside a Background should have `followPiece` on, or they are
  drawn where they were made in the scene.
- A Background inside a Background adds both movements.
- A scene without a Background pays nothing for the feature.

<!-- piece:Background -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `scrollX` | number | 0.5 | How much it moves sideways with the scene when the camera moves: 1 like everything else, 0.5 half as fast (far away), 0 stays on the screen, above 1 for things in front. |
| `scrollY` | number | 0.5 | The same, up and down. |
| `repeatWidth` | number (px) | 0 | Draws what's inside again every this many pixels sideways, as far as the view goes (0: once). Use the width of the picture. |
| `repeatHeight` | number (px) | 0 | Draws what's inside again every this many pixels up and down (0: once). |
| `driftX` | number (px/s) | 0 | Slides sideways by itself at this speed, like clouds. Negative goes left. |
| `driftY` | number (px/s) | 0 | Slides down by itself at this speed. Negative goes up. |
| `offsetX` | number (px) | 0 | Shifts what's inside sideways. Change it from a script to scroll by hand. |
| `offsetY` | number (px) | 0 | Shifts what's inside up or down. |
| `left` | number (px) | none | Stops scrolling its own way while the view is left of this: from there it moves with the scene (empty for no edge). |
| `top` | number (px) | none | Stops scrolling its own way while the view is above this. |
| `right` | number (px) | none | Stops scrolling its own way while the view is right of this. |
| `bottom` | number (px) | none | Stops scrolling its own way while the view is below this. |

| Method | |
| --- | --- |
| `getScroll()` | How far it is drawn from where it was placed, right now: x, y. |
<!-- end -->
