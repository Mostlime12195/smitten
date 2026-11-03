# UI

UI pieces draw on top of the game in screen pixels and ignore cameras:
**Label**, **Button**, **Bar**, **Panel** and **Picture**. A UI piece
inside another is laid out inside it.

## Layout

Each UI piece is placed from an **anchor** (a corner, an edge, `center` or
`fill`); `x` and `y` are the distance in from it. `getRect()` returns the
current screen rectangle. `visible` and `opacity` apply to children too.

```lua
Message.text = "Level complete"
tween(Message, 0.3, { opacity = 1 })
```

## Buttons

A Button's script gets `pressed()` when clicked or tapped (Pictures and
Panels too). In a Button's script, read input with
`smitten.input.pressed`, since `pressed` is the event.

```lua
function pressed() go("scenes/level1.scene") end
```

| | |
| --- | --- |
| `disabled` | Can't be pressed; drawn faded |
| `isHovered()`, `isDown()` | Pointer over it; held down |
| `hovered()`, `unhovered()` | Events |
| `smitten.mouse.isOverUI()` | Pointer over any button or panel |

## Keyboard and gamepad menus

With **autofocus** on, a Button has focus when the scene starts. The
`up`/`down`/`left`/`right` actions move focus to the nearest button and
`accept` presses it. `focus()` and `isFocused()` control it from scripts.
Without a focused button, arrow keys go to the game.

UI keeps working while the game is paused; see [Pausing](scenes.md#pausing).

A UI piece's `draw()` uses screen pixels from its top-left corner.

<!-- piece:UI -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `anchor` | enum | "topLeft" | What x and y are measured from. fill covers the screen or the parent UI piece. |
| `x` | number (px) | 0 | Distance in from the anchor. |
| `y` | number (px) | 0 | Distance in from the anchor. |
| `width` | number (px) | 160 | Width (ignored with fill). |
| `height` | number (px) | 40 | Height (ignored with fill). |
| `visible` | bool | true | Show this piece and everything inside it. |
| `opacity` | number | 1 | 0 is invisible, 1 is solid. |

| Method | |
| --- | --- |
| `getRect()` | Where it is on the screen now: x, y, width, height. |
| `isHovered()` | True while the mouse is over it. |

| Event (a function in its script) | |
| --- | --- |
| `function hovered()` | The pointer came over it (not Labels). |
| `function unhovered()` | The pointer left it. |
<!-- end -->

## Label

<!-- piece:Label -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Label" | What it says. Change it from a script: text = `Score: {score}`. |
| `font` | resource | "" | A .ttf/.otf font, "pixel", or empty for the default font. |
| `size` | int (px) | 20 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color. |
| `align` | enum | "left" | Lines up the text inside its rectangle. |
| `valign` | enum | "top" | Lines up the text top to bottom. |
| `outline` | bool | false | A dark outline around the text. |
<!-- end -->

## Button

<!-- piece:Button -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Button" | The button's words. |
| `font` | resource | "" | A font, or empty for the default. |
| `size` | int (px) | 18 | Font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | Background color. |
| `textColor` | color | {1, 1, 1, 1} | Text color. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `disabled` | bool | false | Can't be pressed; drawn faded. |
| `autofocus` | bool | false | Has keyboard focus when the scene starts. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus. |
| `isFocused()` | True while it has the keyboard focus. |
| `isDown()` | True while it's held down. |

| Event (a function in its script) | |
| --- | --- |
| `function pressed()` | The button was clicked, tapped, or pressed with accept while focused. |
<!-- end -->

## Bar

<!-- piece:Bar -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `value` | number | 50 | How full it is, between min and max. |
| `min` | number | 0 | The value when empty. |
| `max` | number | 100 | The value when full. |
| `color` | color | {0.3, 0.8, 0.45, 1} | Fill color. |
| `background` | color | {0, 0, 0, 0.45} | Empty color. |
| `cornerRadius` | number (px) | 4 | Rounds the corners. |
| `showValue` | bool | false | Show the value as text. |
<!-- end -->

## Panel

<!-- piece:Panel -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.08, 0.09, 0.12, 0.85} | Fill color. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |
| `borderColor` | color | {1, 1, 1, 0.15} | Outline color. |
| `borderWidth` | number (px) | 1 | Outline thickness; 0 for none. |

| Event (a function in its script) | |
| --- | --- |
| `function pressed()` | The panel was clicked or tapped (not on a button inside it). |
<!-- end -->

## Picture

<!-- piece:Picture -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | The picture. |
| `fit` | enum | "contain" | How the picture fills the rectangle. |
| `color` | color | {1, 1, 1, 1} | Tint. |

| Event (a function in its script) | |
| --- | --- |
| `function pressed()` | The picture was clicked or tapped. |
<!-- end -->
