# Lights

Three pieces make light and darkness, in the **Light and shadow** group of
Add a piece:

- A **Light** shines on the pieces around it.
- An **Occluder** blocks light, so lights can throw shadows.
- A **Tint** colors the whole scene: dark blue for night, orange for sunset.

They are building blocks, and each works without the others:

| In the scene | What you get |
| --- | --- |
| A Tint | A color grade: everything multiplied by the Tint's color |
| Lights | The scene as usual, brighter where the lights shine |
| A dark Tint and Lights | Night, with pools of light |
| Lights with `shadows` on, and Occluders | Shadows behind the Occluders |

The rule behind it: a piece is shown in its own colors multiplied by the
light that falls on it. That light starts as the Tint's color (white if
there's no Tint), and each Light adds to it where it shines.

The on-screen UI (Labels, Buttons, Bars...) is never lit or tinted.

## A night scene with a torch

1. Add a **Tint**. Its color starts as a dim blue, so the scene turns to
   night straight away. Make it darker for a cave, lighter for dusk.
2. Add a **Light** inside the player, so it moves with them. Set `radius`
   to how far the torch reaches and `color` to a warm orange.
3. Turn on the Light's **shadows**.
4. Put an **Occluder** inside each thing that should block the light, next
   to its Sprite or Shape: a crate, a pillar, a wall. Its `shape` starts as
   `auto`, which fits that Sprite or Shape, the way a Body does. For walls
   painted with a Tiles piece, turn on the Tiles piece's **castShadows**
   instead: every tile marked solid in the tileset blocks light.

That's all of it, with no code. To make the torch flicker, give the Light a
script:

```lua
function update(dt)
  brightness = 0.9 + rnd(0.2)
end
```

and to light it up or put it out smoothly:

```lua
tween(Torch, 0.5, { brightness = 0 })
```

## Lights

A Light's `kind` is **point** or **sun**.

- A **point** light shines out from where the piece is, as far as `radius`,
  fading towards the edge. Give it an `image` to change its shape: the light
  is the picture, white where it shines, stretched so it is `radius` wide
  each side of the piece. A cone-shaped picture makes a flashlight (turn the
  Light to aim it), a window-shaped one makes light through a window.
  Scaling the Light stretches it.
- A **sun** lights the whole view evenly. It only has a direction, the way
  the piece is turned (`rotation` 0 shines to the right), which is where its
  shadows point. `shadowLength` keeps a sun's shadows short, which suits
  games seen from above.

`brightness` is how strong the light is and `color` its color. `off` turns
it off; a hidden Light (`visible` off, or inside a hidden piece) is off too.

`blend` is what the light does to the light already there:

| blend | |
| --- | --- |
| `add` | Makes it brighter. Lights add up. |
| `subtract` | Makes it darker: a patch of gloom, a blob shadow under a character |
| `mix` | Replaces it with this light's color: a colored spotlight that looks the same by day and by night |

Everything is an ordinary property, so scripts change them and `tween`
animates them:

```lua
Lamp.color = { 1, 0.2, 0.2 }           -- alarm!
tween(Lamp, 0.3, { radius = 400 })
```

## Shadows

A Light with **shadows** on is blocked by every Occluder, and by the solid
tiles of Tiles pieces with **castShadows** on.

An Occluder's `shape` is `auto`, `rectangle`, `circle` or `polygon`. `auto`
fits the Sprites and Shapes inside the Occluder; when it has none, it fits
the ones in the piece it is inside. So both of these work:

```
Crate (Body)              Pillar (Occluder)
  Look (Sprite)             Look (Sprite)
  Shadow (Occluder)
```

The shadow starts at the far side of the Occluder, so the thing that blocks
the light is lit itself. `off` lets light through again (a door opening).

On the Light:

- `shadowColor` is what is left of the light inside a shadow. Black (the
  start) leaves none. Lower its opacity for fainter shadows.
- `shadowSoftness` blurs the shadows' edges by that many pixels. 0 is sharp
  and quickest.
- `shadowsFrom` is a list of tags: only Occluders and Tiles with one of them
  block this light (the tag can be on the Occluder or on the piece it is
  inside). Empty means all of them.

## Which pieces a light lights

- **lit** is a setting every piece with a position has. Turn it off and the
  piece, and everything inside it, ignores Lights and the Tint: it always
  shows at full brightness. Use it for things that glow by themselves: a
  laser, lava, a sign, a firefly. It keeps its place in the drawing order.
- A Light's **lights** is a list of tags: it only lights pieces with one of
  them, and what's inside those pieces. `lights = "player"` makes a light
  that picks out the player and leaves the floor dark.
- A Light's **fromLayer** and **toLayer** limit it to pieces on those
  layers. A Tint has the same two settings: `toLayer = 0` on a Tint leaves
  everything on layer 1 and above untinted.

```lua
-- Lightning: a sun that lights only the background layers, for a moment
Flash.fromLayer, Flash.toLayer = -10, -1
Flash.brightness = 3
tween(Flash, 0.4, { brightness = 0 })
```

## Day and night

A Tint's `color` is a list of three numbers, and `tween` can change them:

```lua
-- On the scene's root, with a Tint called Sky and a sun Light called Sun
local day = { 1, 1, 1 }
local dusk = { 1, 0.6, 0.45 }
local night = { 0.2, 0.25, 0.45 }

function ready()
  while true do
    tween(Sky.color, 8, dusk)
    tween(Sun, 8, { brightness = 0.2, rotation = math.pi })
    wait(8)
    tween(Sky.color, 8, night)
    tween(Sun, 8, { brightness = 0 })
    wait(20)
    tween(Sky.color, 8, day)
    Sun.rotation = 0
    tween(Sun, 8, { brightness = 0.5 })
    wait(20)
  end
end
```

Lamps that come on at night are Lights whose `brightness` you tween up when
it gets dark; windows that glow are pieces with `lit` off.

The first Tint in the scene that isn't `off` is the one used, like Cameras.

## Try it

`tools/scene-tests/lights` in Smitten's source is a small project to open
in the editor: `scenes/demo.scene` is a night scene with a torch on the
mouse, a lamp, crates and a wall of tiles that throw shadows, and a
glowing sign. (`scenes/main.scene` is the engine's own test of all of
this.)

## How fast it is, and its limits

A scene without a Light or a Tint is drawn exactly as before: none of this
costs anything until you use it.

- Each Light is one picture drawn over the area it reaches. Dozens of small
  lights are fine on a school laptop; what costs is area, so a few huge
  lights cost more than many small ones. Lights that are off, hidden, or
  don't reach the view cost nothing.
- Shadows cost more: for each Light with `shadows` on, the far edges of the
  Occluders within its reach are drawn. Turn shadows on for the lights
  where they matter (the player's torch), not for every candle.
  `shadowSoftness` above 0 adds two blur passes per light.
- Occluder outlines are worked out again only when the Occluder moves or
  changes. Tiles merge runs of solid tiles into single edges.
- Lights that use `lights` tags or a layer range are drawn into their own
  light map, one for each different combination of lights in view. Up to 8
  combinations and 24 such lights are handled at once; past that a warning
  is printed and some pieces get the wrong lights.
- Shadows are hard-edged shapes behind each Occluder; `shadowSoftness`
  blurs them by the same amount everywhere, rather than more further away.
- A sun's endless shadows use shadow-casting tiles up to two screens away
  from the view; set `shadowLength` for exact, shorter shadows.
- Lights blend in the order they joined the scene, which only matters for
  `mix`.
- A script's `draw()` is lit like the piece, unless it sets a shader of its
  own.

<!-- piece:Light -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "point" | point shines out from where the piece is, as far as radius. sun lights the whole view from one side: it shines the way the piece is turned. |
| `radius` | number (px) | 200 | How far the light reaches. |
| `brightness` | number | 1 | How strong the light is: 0 is dark, 2 is twice as bright. |
| `color` | color | {1, 1, 1, 1} | The light's color. |
| `image` | resource | "" | A picture of the light's shape, white where it shines: a beam, a window. Empty: a soft round glow. |
| `blend` | enum | "add" | add makes what it shines on brighter. subtract makes it darker (a patch of gloom). mix swaps the light that's there for this light's color. |
| `off` | bool | false | Turn this light off. |
| `lights` | tags | "" | Only lights pieces with one of these tags, and what's inside them (empty: every piece). |
| `fromLayer` | number | none | Only lights pieces on this layer and higher (empty: no limit). |
| `toLayer` | number | none | Only lights pieces on this layer and lower (empty: no limit). |
| `shadows` | bool | false | Occluders, and Tiles with castShadows on, block this light. |
| `shadowColor` | color | {0, 0, 0, 1} | What's left of the light inside a shadow: black for nothing. A see-through color makes fainter shadows. |
| `shadowSoftness` | number (px) | 0 | Blurs the edges of the shadows this far. 0 keeps them sharp, and is quickest. |
| `shadowLength` | number (px) | 0 | How long a sun's shadows are; 0 for shadows that never end. |
| `shadowsFrom` | tags | "" | Only Occluders and Tiles with one of these tags block it (empty: all of them). The tag can be on the piece the Occluder is inside. |
<!-- end -->

<!-- piece:Occluder -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside it or, when it has none, the ones in the piece it is inside. |
| `width` | number (px) | 32 | Rectangle width. |
| `height` | number (px) | 32 | Rectangle height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... of the outline. |
| `off` | bool | false | Let light through. |
<!-- end -->

<!-- piece:Tint -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.35, 0.4, 0.6, 1} | Every piece's colors are multiplied by this: white changes nothing, black hides everything that no light reaches. |
| `off` | bool | false | Turn the tint off. |
| `fromLayer` | number | none | Only tints pieces on this layer and higher (empty: no limit). |
| `toLayer` | number | none | Only tints pieces on this layer and lower (empty: no limit). |
<!-- end -->
