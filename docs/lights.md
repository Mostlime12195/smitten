# Lights

Three pieces make light and darkness. They are in the **Light and shadow**
group of Add a piece:

- A **Light** shines on the pieces around it.
- An **Occluder** stops light, so that lights can make shadows.
- A **Tint** gives a color to all of the scene: dark blue for night, orange
  for sunset.

Each of these pieces works without the others:

| In the scene | Result |
| --- | --- |
| A Tint | A color grade: the engine multiplies all colors by the color of the Tint |
| Lights | The usual scene, brighter where the lights shine |
| A dark Tint and Lights | Night, with pools of light |
| Lights with `shadows` on, and Occluders | Shadows behind the Occluders |

This is how it works: the engine shows a piece in its own colors,
multiplied by the light on it. That light starts as the color of the Tint
(white if there is no Tint). Each Light adds to it where the Light shines.

Lights and the Tint never change the on-screen UI (Labels, Buttons,
Bars...).

## A night scene with a torch

1. Add a **Tint**. Its color starts as a dim blue, so the scene
   immediately changes to night. For a cave, make the color darker. For
   dusk, make it lighter.
2. Add a **Light** inside the player, so that it moves with the player.
3. Set `radius` to the distance that the torch lights.
4. Set `color` to a warm orange.
5. Turn on **shadows** of the Light.
6. Put an **Occluder** inside each thing that must stop the light (a crate,
   a pillar, a wall). Put it next to the Sprite or Shape of that thing. Its `shape` starts as
   `auto`, which fits that Sprite or Shape, as a Body does.
7. For walls that you paint with a Tiles piece, do not use Occluders. Turn
   on **castShadows** of the Tiles piece. Then all the tiles that are solid
   in the tileset stop light.

You do not need code for this. To make the torch flicker, give the Light a
script:

```lua
function update(dt)
  brightness = 0.9 + rnd(0.2)
end
```

To turn the light on or off smoothly, use a tween:

```lua
tween(Torch, 0.5, { brightness = 0 })
```

## Lights

The `kind` of a Light is **point** or **sun**.

- A **point** light shines out from the position of the piece. It goes to
  a distance of `radius` and becomes less bright near the edge.
  - To change the shape of the light, give it an `image`. The light is then
    the image: white where it shines. The engine stretches the image so
    that it goes `radius` to each side of the piece.
  - An image with the shape of a cone makes a flashlight. Turn the Light
    to aim it. An image with the shape of a window makes light through a
    window.
  - When you scale the Light, the light stretches.
- A **sun** lights all of the view with the same brightness. It has only a
  direction, which is the rotation of the piece. With `rotation` 0, it
  shines to the right. With 90, it shines down. Its shadows point in this
  direction. `shadowLength` keeps the shadows of a sun short, which is good
  for games that you see from above.

`brightness` is the strength of the light, and `color` is its color. `off`
turns it off. A hidden Light is also off: a Light with `visible` off, or a
Light inside a hidden piece.

`blend` sets what the light does to the light that is already there:

| blend | |
| --- | --- |
| `add` | Makes it brighter. Lights add together. |
| `subtract` | Makes it darker: an area of gloom, or a round shadow under a character |
| `mix` | Replaces it with the color of this light: a colored spotlight that looks the same by day and by night |

All of these are usual properties. Scripts can change them, and `tween`
can animate them:

```lua
Lamp.color = { 1, 0.2, 0.2 }           -- alarm!
tween(Lamp, 0.3, { radius = 400 })
```

## Shadows

When **shadows** is on, all Occluders stop the Light. The solid tiles of
Tiles pieces with **castShadows** on also stop it.

The `shape` of an Occluder is `auto`, `rectangle`, `circle` or `polygon`.
`auto` fits the Sprites and Shapes inside the Occluder. If the Occluder has
none, `auto` fits the Sprites and Shapes in the piece that the Occluder is
inside. Because of this, these two trees both work:

```
Crate (Body)              Pillar (Occluder)
  Look (Sprite)             Look (Sprite)
  Shadow (Occluder)
```

The shadow starts at the far side of the Occluder, so the light also falls
on the thing that stops it. `off` lets light through again, for example
when a door opens.

These properties of the Light change its shadows:

- `shadowColor` is the part of the light that stays inside a shadow. Black
  (the start value) keeps no light. For shadows that are less dark, make
  its opacity lower.
- `shadowSoftness` blurs the edges of the shadows by that number of pixels.
  0 gives sharp edges and is the fastest.
- `shadowsFrom` is a list of tags. If it has tags, only the Occluders and
  Tiles with one of these tags stop this light. The tag can be on the
  Occluder or on the piece that the Occluder is inside. When the list is
  empty, all of them stop the light.

## Which pieces a light lights

- All pieces with a position have the property **lit**. When you turn it
  off, Lights and the Tint do not change the piece and all the pieces
  inside it. It always shows at full brightness. Use it for things that
  make their own light: a laser, lava, a sign, a firefly. The piece keeps
  its place in the drawing sequence.
- **lights** on a Light is a list of tags. The Light lights only the pieces
  with one of these tags, and the pieces inside them. `lights = "player"`
  makes a light that shows the player and keeps the floor dark.
- **fromLayer** and **toLayer** on a Light let it light only the pieces on
  those layers. A Tint has the same two properties. `toLayer = 0` on a Tint
  does not tint the pieces on layer 1 and higher.

```lua
-- Lightning: for a short time, a sun lights only the background layers
Flash.fromLayer, Flash.toLayer = -10, -1
Flash.brightness = 3
tween(Flash, 0.4, { brightness = 0 })
```

## Day and night

The `color` of a Tint is a list of three numbers, and `tween` can change
them:

```lua
-- On the scene root. Sky is a Tint, and Sun is a sun Light.
local day = { 1, 1, 1 }
local dusk = { 1, 0.6, 0.45 }
local night = { 0.2, 0.25, 0.45 }

function ready()
  while true do
    tween(Sky.color, 8, dusk)
    tween(Sun, 8, { brightness = 0.2, rotation = 180 })
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

For lamps that come on at night, use Lights and tween their `brightness`
up when it gets dark. For windows that glow, use pieces with `lit` off.

The engine uses the first Tint in the scene that is not `off`. It chooses
Cameras in the same way.

## Try it

`tools/scene-tests/lights` in the source of Smitten is a small project.
Open it in the editor:

- `scenes/demo.scene` is a night scene. It has a torch that follows the
  mouse, a lamp, crates, a wall of tiles that make shadows, and a sign that
  glows.
- `scenes/main.scene` is the test of all these features that the engine
  runs.

## Speed and limits

If a scene has no Light and no Tint, the engine draws it as before. These
features cost no time until you use them.

- The engine draws each Light as one image over the area that it
  lights. A school laptop can draw many small lights (tens of them). The
  cost comes from the area, so a few very large lights cost more than many
  small ones. Lights that are off, hidden, or outside the view cost no
  time.
- Shadows cost more. For each Light with `shadows` on, the engine draws
  the far edges of the Occluders that the Light reaches. Turn on shadows
  only for the lights where they are important (the torch of the player),
  not for all candles. A `shadowSoftness` of more than 0 adds two blur
  passes for each light.
- The engine calculates the outline of an Occluder again only when the
  Occluder moves or changes. A Tiles piece joins lines of solid tiles into
  single edges.
- The engine draws Lights that use `lights` tags or a range of layers into
  their own light map. It makes one light map for each different
  combination of these lights in view. At one time, it can use up to 8
  combinations and 24 of these lights. If there are more, the engine shows
  a warning, and some pieces get the wrong lights.
- Shadows are shapes with hard edges behind each Occluder.
  `shadowSoftness` blurs them by the same quantity at all distances. It
  does not blur them more when they are farther away.
- The shadows of a sun have no end. They use the tiles that make shadows up
  to two screens away from the view. For exact shadows that are shorter,
  set `shadowLength`.
- Lights blend in the sequence in which they came into the scene. This is
  important only for `mix`.
- The engine lights the `draw()` of a script in the same way as the piece,
  if the script does not set its own shader.

<!-- piece:Light -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "point" | point shines out from the position of the piece, as far as radius. sun lights the whole view from one side, in the direction that the piece points. |
| `radius` | number (px) | 200 | How far the light goes. |
| `brightness` | number | 1 | How strong the light is: 0 is dark, 2 is twice as bright. |
| `color` | color | {1, 1, 1, 1} | The color of the light. |
| `image` | resource | "" | An image of the shape of the light, white where it shines: a beam, a window. If it is empty, the light is a soft round glow. |
| `blend` | enum | "add" | add makes the pieces that it shines on brighter. subtract makes them darker (a dark patch). mix replaces the light that is there with the color of this light. |
| `off` | bool | false | When this is on, the light is off. |
| `lights` | tags | "" | The light shines only on pieces with one of these tags, and on what is inside them. If it is empty, it shines on every piece. |
| `fromLayer` | number | none | The light shines only on pieces on this layer and higher. If it is empty, there is no limit. |
| `toLayer` | number | none | The light shines only on pieces on this layer and lower. If it is empty, there is no limit. |
| `shadows` | bool | false | When this is on, Occluders, and Tiles with castShadows on, block this light. |
| `shadowColor` | color | {0, 0, 0, 1} | The part of the light that stays in a shadow: black is none. A transparent color makes weaker shadows. |
| `shadowSoftness` | number (px) | 0 | Blurs the edges of the shadows by this distance. 0 keeps them sharp and is the fastest. |
| `shadowLength` | number (px) | 0 | The length of the shadows of a sun. 0 makes shadows that never end. |
| `shadowsFrom` | tags | "" | Only Occluders and Tiles with one of these tags block the light. If it is empty, all of them block it. The tag can be on the piece that holds the Occluder. |
<!-- end -->

<!-- piece:Occluder -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside it. If it has none, it fits the ones in the piece that it is inside. |
| `width` | number (px) | 32 | The width of the rectangle. |
| `height` | number (px) | 32 | The height of the rectangle. |
| `radius` | number (px) | 16 | The radius of the circle. |
| `points` | points | {0, -16, 16, 16, -16, 16} | The corner points x1, y1, x2, y2, ... of the outline. |
| `off` | bool | false | When this is on, light goes through it. |
<!-- end -->

<!-- piece:Tint -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.35, 0.4, 0.6, 1} | The engine multiplies the colors of every piece by this color. White changes nothing. Black hides everything that no light reaches. |
| `off` | bool | false | When this is on, the tint is off. |
| `fromLayer` | number | none | The Tint colors only pieces on this layer and higher. If it is empty, there is no limit. |
| `toLayer` | number | none | The Tint colors only pieces on this layer and lower. If it is empty, there is no limit. |
<!-- end -->
