# UI

UI pieces are drawn on top of the game, in screen pixels, and cameras
don't move them: **Label** (words), **Button**, **Bar** (health, loading),
**Panel** (a box behind other UI) and **Picture**. Put them anywhere in the
scene; a UI piece inside another is laid out inside it.

## Layout

A UI piece is a rectangle placed from an **anchor**: a corner, an edge, the
center, or `fill` (the whole screen, or the UI piece it's inside). `x` and
`y` are the distance in from the anchor, so with `bottomRight`, `x = 16`,
`y = 16` is 16 pixels in from the bottom-right corner, whatever the screen
size. Every property can change while the game runs:

```lua
Message.anchor = "center"
Message.text = "Level complete!"
tween(Message, 0.3, { opacity = 1, y = 0 })
```

`getRect()` is where a UI piece is on the screen now (x, y, width,
height). `visible` and `opacity` hide or fade it and everything inside it.

## Labels and bars

```lua
function update(dt)
  find("HUD/Score").text = `Score: {game.score}`
  find("HUD/Health").value = hp      -- a Bar from min to max
end
```

## Buttons

A Button's script gets `pressed()` when it's clicked or tapped. Pictures
and Panels get it too.

```lua
-- On a "Play" button
function pressed()
  go("scenes/level1.scene")
end
```

Other scripts listen with `on`: `find("UI/Quit"):on("pressed", function() ... end)`.
In a Button's script, `pressed` is the button's event, so read input there
with `smitten.input.pressed(action)`.

| | |
| --- | --- |
| `disabled` | Can't be pressed; drawn faded |
| `isHovered()` | The pointer is over it |
| `isDown()` | It's held down |
| `hovered()`, `unhovered()` | Events: the pointer came over it, left it |
| `smitten.mouse.isOverUI()` | The pointer is over a button or panel (so a click there doesn't also shoot) |

## Menus with the keyboard and gamepads

Turn on a Button's **autofocus** and it has the focus when the scene
starts: the arrow keys, the d-pad and the stick (the `up`, `down`, `left`
and `right` actions) move the focus to the nearest button that way, and
`accept` (Enter, Space, gamepad A) presses it. The focused button is
outlined. `focus()` moves the focus from a script; `isFocused()` tells.
Clicking a button moves the focus to it.

Without a focused button, the arrow keys are the game's alone, so a
Restart button in a game's HUD doesn't steal them.

## Pause menus

UI answers clicks and the keyboard while the game is paused. For a pause
menu's script to keep running, put the menu inside a piece whose
`pausable` is off; see [Pausing](scenes.md#pausing).

## Drawing on UI

A UI piece's `draw()` draws in screen pixels, from its rectangle's top-left
corner: see [Drawing](drawing.md).

## The pieces

### UI

The base of every UI piece.

<!-- piece:UI -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `anchor` | enum | "topLeft" | What its position is measured from. Fill stretches over the whole screen (or the UI piece it's inside). |
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

### Label

<!-- piece:Label -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Label" | What it says. Change it from a script: text = `Score: {score}`. |
| `font` | resource | "" | A .ttf/.otf font, "pixel", or empty for the default font. |
| `size` | int (px) | 20 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color. |
| `align` | enum | "left" | Lines up the text inside its rectangle. |
| `valign` | enum | "top" | Lines up the text top to bottom. |
| `outline` | bool | false | A dark outline, so it reads on any background. |
<!-- end -->

### Button

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
| `autofocus` | bool | false | Has the keyboard focus when the scene starts: arrow keys and the d-pad move between buttons, accept presses. For menus. |

| Method | |
| --- | --- |
| `focus()` | Gives it the keyboard focus (arrow keys and the d-pad then move it between buttons; accept presses). |
| `isFocused()` | True while it has the keyboard focus. |
| `isDown()` | True while it's held down. |

| Event (a function in its script) | |
| --- | --- |
| `function pressed()` | The button was clicked, tapped, or pressed with accept while focused. |
<!-- end -->

### Bar

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

### Panel

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

### Picture

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
