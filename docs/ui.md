# UI

UI pieces draw on top of the game, in screen pixels, and the camera
doesn't move them, which suits scores, health bars and menus. There are
seven: **Label** (text), **Button**, **Bar** (health, progress), **Panel**
(a box behind other UI), **Picture**, and for touch screens **TouchStick**
and **TouchButton** ([Input: Touch](input.md#touch)). A UI piece inside
another is laid out inside it.

## Layout

Each UI piece is placed from an **anchor**: a corner, an edge, the
center, or `fill` (the whole screen, or the whole of the UI piece it's
inside). `x` and `y` are the distance in from that anchor. With the anchor
`bottomRight` and `x`, `y` at 16, a piece sits 16 pixels in from the
bottom-right corner on any screen size.

Every setting can change while the game runs:

```lua
Message.text = "Level complete!"
tween(Message, 0.3, { opacity = 1 })
```

`getRect()` returns where a UI piece is on the screen right now, and
`visible` and `opacity` hide or fade it along with everything inside it.

## Buttons

When a Button is clicked or tapped, its script's `pressed()` runs
(Pictures and Panels get it too):

```lua
-- On a "Play" button
function pressed()
  go("scenes/level1.scene")
end
```

In a Button's own script, `pressed` means that event, so read input there
with `smitten.input.pressed(...)`.

| | |
| --- | --- |
| `disabled` | Can't be pressed; drawn faded |
| `isHovered()`, `isDown()` | The pointer is over it; it's held down |
| `hovered()`, `unhovered()` | Events when the pointer arrives and leaves |
| `smitten.mouse.isOverUI()` | The pointer is over any button or panel |

## Menus for keyboards and gamepads

Turn on a Button's **autofocus** and it has the focus when the scene
starts. The arrow keys, d-pad and stick then move the focus to the nearest
button in that direction, and Enter, Space or gamepad A press it. Clicking
a button also focuses it, and `focus()` moves the focus from a script.
While no button has focus, the arrow keys go to the game as usual.

UI keeps working while the game is paused, which is what pause menus
need ([Pausing](scenes.md#pausing-and-slow-motion)).

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

A Label's words can do everything on the [Text](text.md) page: tags for
colors, sizes and effects inside the text (turn on `rich`), an outline or
a shadow, shrinking to fit (`fit`), typing themselves out (`reveal()`),
and links that call `linkPressed(name)`.

<!-- piece:Label -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Label" | What it says. Change it from a script: text = `Score: {score}`. |
| `font` | resource | "" | A .ttf/.otf font, "pixel", or empty for the default font. |
| `size` | int (px) | 20 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color. |
| `align` | enum | "left" | Lines up the text inside its rectangle. justify stretches wrapped lines to the same width. |
| `valign` | enum | "top" | Lines up the text top to bottom. |
| `wrapBy` | enum | "word" | Where a line too long for the rectangle is broken: between words, after any character (for writing without spaces, like Japanese), or not at all. |
| `fit` | enum | "none" | shrink makes the text smaller until it fits inside the rectangle. |
| `rich` | bool | false | Reads tags in the text: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `outline` | bool | false | A dark outline around the text. |
| `fontBold` | resource | "" | The font file for [b]bold[/b] words. Empty: the font is made thicker instead. |
| `fontItalic` | resource | "" | The font file for [i]italic[/i] words. Empty: the font is slanted instead. |
| `lineHeight` | number | 1 | How far apart lines are: 1 is the font's own spacing, 1.5 leaves half a line between them. |
| `letterSpacing` | number (px) | 0 | Extra room between letters (negative squeezes them together). |
| `outlineWidth` | number (px) | 0 | How thick the outline is. 0 keeps it one screen pixel thin. |
| `outlineColor` | color | {0, 0, 0, 0.8} | The outline's color. |
| `shadow` | bool | false | A shadow behind the text. |
| `shadowColor` | color | {0, 0, 0, 0.5} | The shadow's color. |
| `shadowX` | number (px) | 2 | How far right the shadow falls (negative: left). |
| `shadowY` | number (px) | 2 | How far down the shadow falls (negative: up). |
| `visibleCharacters` | int | -1 | How many characters show, counted from the start: 0 shows nothing, -1 shows them all. reveal() counts this up for a typewriter effect. |
| `visibleRatio` | number | 1 | How much of the text shows: 0 is nothing, 0.5 the first half, 1 all of it. Tween it to reveal the text smoothly. |

| Method | |
| --- | --- |
| `measure()` | How big the text is as it's laid out now: width, height. |
| `lineCount()` | How many lines the text takes. |
| `characterCount()` | How many characters the text has (tags and line breaks don't count). |
| `characterRect(index)` | Where a character is, measured from the label's top-left corner: x, y, width, height. For putting a cursor or a sparkle on it. |
| `characterAt(x, y)` | The number of the character at a point (measured from the label's top-left corner), or nil. |
| `linkAt(x, y)` | The name of the [link=name] at a point (measured from the label's top-left corner), or nil. |
| `reveal(charactersPerSecond?, from?)` | Shows the text a character at a time (30 a second unless you say): a typewriter. Returns a handle with cancel(), after(fn) and wait(seconds). [pause=0.5] and [speed=10] in rich text change the pace. |
| `skip()` | Shows all of the text now, and ends a reveal(). |

| Event (a function in its script) | |
| --- | --- |
| `function revealed(index, char)` | reveal() showed one more character: play a blip, or wait at a full stop. |
| `function finished()` | reveal() has shown the whole text. |
| `function eachCharacter(c)` | Called for every character each time the text is drawn, to move or color it: c.y = math.sin(c.time * 4 + c.index) * 3. c has x, y, rotation, scale, color, alpha, visible to change, and index, count, char, line, time, since to read. It's one table used for every character, so don't keep it. |
| `function linkPressed(name)` | A [link=name] in the text was clicked or tapped. |
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
| `rich` | bool | false | Reads tags in the text: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `fit` | enum | "none" | shrink makes the words smaller until they fit inside the button. |
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

## TouchStick

A stick for a thumb: it pushes input actions like a gamepad's stick.
[Input: Touch](input.md#touch) shows how to lay out touch controls.

<!-- piece:TouchStick -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `leftAction` | action | "left" | The action it pushes when the thumb goes left (none: it pushes nothing that way). |
| `rightAction` | action | "right" | The action it pushes when the thumb goes right. |
| `upAction` | action | "up" | The action it pushes when the thumb goes up. |
| `downAction` | action | "down" | The action it pushes when the thumb goes down. |
| `player` | int | 0 | Whose actions it pushes: 2 for player 2. 0 takes the player of the piece it's inside, or player 1. |
| `mode` | enum | "fixed" | fixed stays in the middle of its rectangle. floating appears where the thumb lands, anywhere in the rectangle. follow does too, and is dragged along when the thumb goes further than the radius. |
| `radius` | number (px) | 60 | How far the thumb goes for a full push; also the size of the stick's circle. |
| `deadzone` | number | 0.2 | How much of the radius near the middle counts as not pushed at all (0.2 is a fifth). |
| `show` | enum | "touch" | touch draws it on phones and tablets, and on any screen once a finger touches it. always draws it everywhere, and the mouse can work it. never keeps it invisible; fingers still work it. |
| `color` | color | {1, 1, 1, 0.25} | The color of the stick's circle (or a tint for its image). |
| `knobColor` | color | {1, 1, 1, 0.6} | The color of the knob under the thumb (or a tint for its image). |
| `image` | resource | "" | A picture for the stick's circle, instead of the drawn one. |
| `knobImage` | resource | "" | A picture for the knob, instead of the drawn one. |

| Method | |
| --- | --- |
| `getValue()` | Where the stick is pushed: x, y from -1 to 1 (0, 0 when no finger is on it). |
| `isActive()` | True while a finger is on the stick. |

| Event (a function in its script) | |
| --- | --- |
| `function pressed()` | A finger landed on the stick. |
| `function released()` | The finger let go of the stick. |
<!-- end -->

## TouchButton

A button for a finger: it holds an input action down while it's held.

<!-- piece:TouchButton -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `action` | action | "jump" | The action it holds down while a finger is on it (none: it only tells its script, with pressed() and released()). |
| `player` | int | 0 | Whose action it presses: 2 for player 2. 0 takes the player of the piece it's inside, or player 1. |
| `shape` | enum | "circle" | circle is the biggest circle that fits its rectangle. rectangle is the whole rectangle. |
| `text` | text | "" | Words or a letter on the button. |
| `image` | resource | "" | A picture on the button: an arrow, a sword. |
| `show` | enum | "touch" | touch draws it on phones and tablets, and on any screen once a finger touches it. always draws it everywhere, and the mouse can press it. never keeps it invisible; fingers still press it. |
| `color` | color | {1, 1, 1, 0.3} | The button's color. It's drawn stronger while held. |
| `textColor` | color | {1, 1, 1, 0.9} | The color of its words. |
| `font` | resource | "" | A font, or empty for the default. |
| `size` | int (px) | 20 | Font size. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |

| Method | |
| --- | --- |
| `isDown()` | True while a finger holds it down. |

| Event (a function in its script) | |
| --- | --- |
| `function pressed()` | A finger pressed the button (or slid onto it). |
| `function released()` | The finger let go, or slid off. |
<!-- end -->
