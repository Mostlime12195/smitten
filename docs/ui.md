# UI

UI pieces draw on top of the game, in screen pixels. The camera does not
move them. Because of this, UI pieces are good for scores, health bars and menus.

| | |
| --- | --- |
| To show | **Label** (text), **Bar** (health, progress), **Panel** (a box behind other UI), **Picture** |
| To work | **Button**, **Slider**, **Checkbox** (a box to tick, a switch, or one item in a choice), **TextInput** (a box to type in) |
| To lay out | **Row**, **Column**, **Grid**, **Scroll** (a list that is longer than the screen) |
| For touch screens | **TouchStick** and **TouchButton** ([Input: Touch](input.md#touch)) |

These pieces are building blocks. A settings screen, an inventory or a chat
box is a set of these pieces. There is an example
[below](#a-settings-screen-from-these-parts). If a UI piece is inside a
different UI piece, Smitten lays it out inside that piece.

## Layout

Smitten puts each UI piece relative to an **anchor**. The anchor is a
corner, an edge, the center, or `fill`. `fill` is all of the screen, or all
of the UI piece that the piece is inside. `x` and `y` are the distance in
from the anchor. For example, set the anchor to `bottomRight`. Then set
`x` and `y` to 16. On all screen sizes, the piece is 16 pixels in from the
bottom-right corner.

You can change each property while the game runs:

```lua
Message.text = "Level complete!"
tween(Message, 0.3, { opacity = 1 })
```

`getRect()` gives the position of a UI piece on the screen at this time.
`visible` hides a UI piece and all the pieces in it. `opacity` fades a UI
piece and all the pieces in it.

## Laying things out

It takes a long time to put each button of a menu in its position. A
**Row**, a **Column** or a **Grid** puts the UI pieces that are directly in
it in a line. It uses the order of the pieces in the Scene panel:

| | |
| --- | --- |
| **Row** | Left to right |
| **Column** | Top to bottom |
| **Grid** | In `columns`, one row after the other: for example, an inventory or a level select screen |
| **Scroll** | Top to bottom (or left to right), in a window that scrolls |

In one of these containers, a piece keeps its `width` and `height`. The
container does not use the anchor, `x` and `y` of the piece. To move the
piece, drag it up or down in the Scene panel. The container itself uses
its own anchor. Because of this, a Column with the anchor `center` is a menu in the
middle of the screen, on all screen sizes.

| Property | What it does |
| --- | --- |
| `gap` | The space between one piece and the next piece |
| `padding` | The space between the edges of the container and the pieces |
| `alignItems` | The position across the line of pieces: `start`, `center`, `end`, or `stretch`. `stretch` makes all the pieces as tall as the Row (or as wide as the Column) |
| `justify` | The position along the line of pieces, when there is space that the pieces do not use: `start`, `center`, `end`, or `spaceBetween`. `spaceBetween` puts the pieces from one edge to the other edge, with equal spaces |
| `width`, `height` | 0 makes the container fit the pieces in it. If you set a different value, the container has that size, independent of the pieces in it |
| `grow` (on a piece in the container) | The part of the unused space in a Row or Column that the piece gets. If one piece has `grow` 1, it gets all the space. If two pieces have `grow` 1, they share it |

You can put containers in containers. For example, a Column of Rows is a
form, with a Label and a Slider in each Row. Containers do not draw
anything. For a background, put the container in a Panel. A container
calculates its layout again only when a piece in it changes. Because of this, a big
menu that does not change does not make the game slower.

Smitten also puts pieces that you make while the game runs in the line:

```lua
-- On a Column: make one Button for each saved game
function ready()
  for i, name in ipairs(load("saves", {})) do
    local b = self:spawn("Button", { text = name })
    b:on("clicked", function() go("scenes/game.scene", { save = name }) end)
  end
end
```

### Scroll

A **Scroll** is a window on a list that is longer than the Scroll. It puts
the pieces in it one below the other, as a Column does. Each piece is as
wide as the Scroll. If you set `direction` to `horizontal`, the Scroll puts
the pieces from left to right, as a Row does. Then each piece is as tall as
the Scroll. The Scroll shows the part of the list that fits in it.

These scroll the list:

- the mouse wheel.
- a drag or a flick with a finger or the mouse.
- the keyboard focus: if the focus moves to a piece that you cannot see,
  the Scroll scrolls to show that piece.

For a grid that scrolls, put a Grid in the Scroll.

```lua
List.scrollY = 0                 -- go back to the top
List:scrollTo(List.Item20)       -- scroll only as far as necessary to show a piece
```

## Buttons

When you click or tap a Button, the engine calls `clicked()` in its
script. Pictures and Panels also get `clicked()`:

```lua
-- On a "Play" button
function clicked()
  go("scenes/level1.scene")
end
```

In a different script, use `Play:on("clicked", function() ... end)` to
listen for the event. In the script of a Button, `pressed("jump")` is
the input function, as in all other scripts.

| | |
| --- | --- |
| `disabled` | You cannot press the Button. Smitten draws it faded |
| `isHovered()`, `isDown()` | `isHovered()`: the pointer is on the Button. `isDown()`: the pointer holds the Button down |
| `hovered()`, `unhovered()` | Events when the pointer comes onto the Button and when it goes off |
| `smitten.mouse.isOverUI()` | The pointer is on a button or a panel |

## Sliders

A **Slider** sets a number between `min` and `max`. Drag its knob, or
click a position on its track. `step` makes the knob move in steps: set it
to 1 for whole numbers. When the player moves the Slider, the engine calls
`changed(value)` in its script:

```lua
-- On a Slider with min 0 and max 1
function changed(value)
  masterVolume(value)
end
```

If a script sets `value`, the knob moves, but the engine does not call
`changed()`. `vertical` turns the Slider, so that it goes from bottom to
top.

## Checkboxes

A **Checkbox** is a box that you can tick, with words next to it. If you
set `look` to `switch`, the Checkbox is a switch that slides. When the
Checkbox changes, the engine calls `toggled(checked)`:

```lua
function toggled(checked)
  fullscreen(checked)
end
```

For a choice of one item from a set (easy, normal, hard), give the
Checkboxes the same `group` name. In a group, when you tick one Checkbox,
the other Checkboxes with that name in the same piece become unticked.
Smitten draws Checkboxes in a group as circles:

```lua
-- On each of three Checkboxes with group "difficulty"
function toggled(checked)
  if checked then game.difficulty = text end
end
```

## Typing boxes

A **TextInput** is a box to type in. To type, click or tap the box. On a
phone, the keyboard comes up. A TextInput has:

- a caret.
- a selection (drag, or use Shift with the arrow keys).
- Ctrl+A, copy, cut and paste.
- Home and End.
- Ctrl with the arrow keys, to go to the next word.

```lua
-- On a TextInput
function submitted(text)       -- the player pressed Enter
  print("Hello, " .. text)
end
```

| Property | What it does |
| --- | --- |
| `placeholder` | Faint words when the box is empty: "Your name" |
| `maxLength` | The maximum number of characters in the box |
| `allow` | `numbers`, `letters`, or `only` (only the characters in `allowCharacters`) |
| `secret` | Shows dots, not the characters |
| `multiline` | More than one line: Enter starts a new line, and Ctrl+Enter submits |

The engine calls these functions:

- `changed(text)`: after each change.
- `submitted(text)`: when the player presses Enter.
- `focused()`: when typing starts.
- `blurred()`: when typing stops.

`text` is the text in the box. You can read it or set it at all times.

While the player types in a TextInput, the keys go to the TextInput and
not to the game. For example, "w" does not make the player walk, and the
space bar does not make `pressed("jump")` true. Typing stops when one of
these occurs:

- The player presses Escape.
- The player presses Tab. The focus goes to the next piece.
- The player clicks a different position.
- A script calls `blur()`.

The TextInput uses [`typed()`](input.md#typing). To make your own text
input without a piece, use `typed()`.

## Skins

Smitten draws Panels, Buttons, TextInputs and Sliders as plain shapes in a
color. To draw a picture instead, give the piece a **skin**. When Smitten
stretches a skin, the corners keep their shape. `skinEdges` sets how many
pixels at each edge keep their size. Only the middle stretches. For
example, take a 24 × 24 picture of a wooden frame, and set `skinEdges` to
8. This makes a panel of any size with sharp corners.

| | |
| --- | --- |
| `skin` | The picture |
| `skinEdges` | `8` for all four edges, or `8, 4, 8, 12`: left, top, right, bottom |
| `skinHover`, `skinDown` (Button) | Pictures for when the pointer is on the Button, and for when the Button is down. Without them, Smitten draws the skin a little lighter or darker |
| `knobImage` (Slider) | A picture for the knob. `skin` is the track. `color` tints the filled part |
| `skin`, `skinChecked` (Checkbox) | Pictures for the box when it is not ticked and when it is ticked |

If the display setting of the project is pixel, Smitten does not smooth
the skins. This is the same for all pictures.

## Menus for keyboards and gamepads

If you turn on **autofocus** on a Button, the Button has the focus when the
scene starts. This is also possible on a Slider, a Checkbox or a
TextInput. Then:

- The arrow keys, the d-pad and the stick move the focus to the nearest
  piece in that direction.
- Tab and Shift+Tab move the focus through the pieces in their order.
- The piece with the focus shows a ring.

| Piece with the focus | What the keys do |
| --- | --- |
| Button | Enter, Space or gamepad A press it |
| Checkbox | Enter, Space or gamepad A change it to ticked or not ticked |
| Slider | Left and right move it (up and down for a vertical Slider). Hold the key to continue |
| TextInput | Keys type. Up and down go to the piece in that direction. Tab goes to the next piece. Escape or gamepad B stops the typing |

When you click a piece, it also gets the focus. In a script, `focus()`
moves the focus to the piece. When no piece has the focus, the arrow keys
go to the game as usual.

All players can use a menu with their keys and gamepads. If a piece has a
`player` ([More than one player](input.md#more-than-one-player)), only that
player can use it. This is also true for the pieces inside
it. Because of this, you can make a menu for each player on a split screen.

UI continues to work while the game is paused. Pause menus need this
([Pausing](scenes.md#pausing-and-slow-motion)).

## A settings screen from these parts

Smitten does not have a ready-made settings menu. This example uses the
pieces above. You can make your menu in the shape that your game needs.

```
Panel      Settings    anchor center, 360 × 250
└ Column   Menu        anchor fill, x 16, y 16, gap 12
  ├ Label    Title       text "Settings"
  ├ Row      VolumeRow
  │ ├ Label    (text "Volume", width 100)
  │ └ Slider   Volume    min 0, max 1, grow 1
  ├ Checkbox Fullscreen  text "Fullscreen", look switch
  ├ Row      NameRow
  │ ├ Label    (text "Name", width 100)
  │ └ TextInput Name     placeholder "Your name", maxLength 12, grow 1
  └ Button   Back        text "Back", autofocus on
```

The Column stretches each Row to the width of the Column. `grow` gives the
Slider and the TextInput the space that the Labels do not use. You set all
of these properties in the Inspector. Three short scripts make the menu
work:

```lua
-- On the Volume slider
function ready()
  value = load("volume", 1)
  masterVolume(value)
end

function changed(value)
  masterVolume(value)
  save("volume", value)
end
```

```lua
-- On the Fullscreen checkbox
function ready()
  checked = fullscreen()
end

function toggled(checked)
  fullscreen(checked)
end
```

```lua
-- On the Name box
function ready()
  text = load("name", "")
end

function blurred()          -- typing stopped: Enter, Escape, Tab or a click on a different position
  save("name", text)
end

function submitted()
  blur()
end
```

With a gamepad or the arrow keys, the focus starts on Back. Then it moves
up through the Name box, the switch and the slider.

<!-- piece:UI -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `anchor` | enum | "topLeft" | The point from which the piece measures x and y. fill covers the screen or the parent UI piece. Inside a Row, Column, Grid or Scroll, that piece decides the position. |
| `x` | number (px) | 0 | The distance in from the anchor. |
| `y` | number (px) | 0 | The distance in from the anchor. |
| `width` | number (px) | 160 | The width. It has no effect when anchor is fill. |
| `height` | number (px) | 40 | The height. It has no effect when anchor is fill. |
| `grow` | number | 0 | Inside a Row or Column, the part of the remaining space that this piece gets. Two pieces with 1 get half each. 0 keeps its own size. |
| `visible` | bool | true | When this is on, this piece and everything inside it are visible. |
| `opacity` | number | 1 | 0 is invisible, 1 is fully visible. |

| Method | |
| --- | --- |
| `getRect()` | Returns the current position and size on the screen: x, y, width, height. |
| `isHovered()` | Returns true while the mouse pointer is over it. |

| Event (a function in its script) | |
| --- | --- |
| `function hovered()` | The engine calls it when the mouse pointer comes over it (not for Labels). |
| `function unhovered()` | The engine calls it when the mouse pointer leaves it. |
<!-- end -->

## Label

The text of a Label can do all the things on the [Text](text.md) page:

- tags for colors, sizes and effects in the text (turn on `rich`).
- an outline or a shadow.
- a smaller size, to fit in the Label (`fit`).
- one character after the other comes onto the screen (`reveal()`).
- links that call `linkPressed(name)`.

<!-- piece:Label -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Label" | The text that the piece shows. Change it from a script: text = `Score: {score}`. |
| `font` | resource | "" | A .ttf or .otf font file, "pixel" for the built-in pixel font, or empty for the default font. |
| `size` | int (px) | 20 | The font size. |
| `color` | color | {1, 1, 1, 1} | The text color. |
| `align` | enum | "left" | Aligns the text inside its rectangle. justify stretches wrapped lines to the same width. |
| `valign` | enum | "top" | Aligns the text vertically inside its rectangle. |
| `wrapBy` | enum | "word" | Where the text breaks lines that are too long for the rectangle: between words, after any character (for languages without spaces, like Japanese), or never. |
| `fit` | enum | "none" | shrink makes the text smaller until it fits inside the rectangle. |
| `rich` | bool | false | When this is on, the text reads markup: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `outline` | bool | false | When this is on, the text has a dark outline. |
| `fontBold` | resource | "" | The font file for [b]bold[/b] words. If it is empty, the engine makes the font thicker. |
| `fontItalic` | resource | "" | The font file for [i]italic[/i] words. If it is empty, the engine slants the font. |
| `lineHeight` | number | 1 | The distance between lines: 1 is the font's own spacing, 1.5 leaves half a line between them. |
| `letterSpacing` | number (px) | 0 | Extra space between letters. A negative value pushes them closer together. |
| `outlineWidth` | number (px) | 0 | The thickness of the outline. 0 keeps it one screen pixel thin. |
| `outlineColor` | color | {0, 0, 0, 0.8} | The color of the outline. |
| `shadow` | bool | false | When this is on, the text has a shadow behind it. |
| `shadowColor` | color | {0, 0, 0, 0.5} | The color of the shadow. |
| `shadowX` | number (px) | 2 | How far right the shadow is. A negative value moves it left. |
| `shadowY` | number (px) | 2 | How far down the shadow is. A negative value moves it up. |
| `visibleCharacters` | int | -1 | The number of characters that show, counting from the start: 0 shows none, -1 shows all. reveal() increases this for a typewriter effect. |
| `visibleRatio` | number | 1 | The part of the text that shows: 0 is none, 0.5 is the first half, 1 is all of it. Tween it to show the text gradually. |

| Method | |
| --- | --- |
| `measure()` | Returns the size of the text in its current layout: width, height. |
| `lineCount()` | Returns the number of lines in the text. |
| `characterCount()` | Returns the number of characters in the text. Markup and line breaks do not count. |
| `characterRect(index)` | Returns the position and size of a character, measured from the top-left corner of the Label: x, y, width, height. Use it to put a cursor or a sparkle on the character. |
| `characterAt(x, y)` | Returns the number of the character at a point (measured from the top-left corner of the Label), or nil. |
| `linkAt(x, y)` | Returns the name of the [link=name] at a point (measured from the top-left corner of the Label), or nil. |
| `reveal(charactersPerSecond?, from?)` | Shows the text one character at a time, like a typewriter (30 characters per second if you do not give a speed). Returns a handle with cancel(), after(fn) and wait(seconds). [pause=0.5] and [speed=10] in rich text change the speed. |
| `skip()` | Shows all of the text now and stops a reveal(). |

| Event (a function in its script) | |
| --- | --- |
| `function revealed(index, char)` | The engine calls it when reveal() shows one more character. Use it to play a blip, or to wait at a full stop. |
| `function finished()` | The engine calls it when reveal() has shown all of the text. |
| `function eachCharacter(c)` | The engine calls it for every character each time it draws the text. Use it to move or color the character: c.y = math.sin(c.time * 4 + c.index) * 3. You can change x, y, rotation, scale, color, alpha and visible of c. You can read index, count, char, line, time and since. The engine uses the same table c for every character, so do not keep it. |
| `function linkPressed(name)` | The engine calls it when the player clicks or taps a [link=name] in the text. |
<!-- end -->

## Button

<!-- piece:Button -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Button" | The words on the button. |
| `font` | resource | "" | A font, or empty for the default font. |
| `size` | int (px) | 18 | The font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | The background color. |
| `textColor` | color | {1, 1, 1, 1} | The text color. |
| `rich` | bool | false | When this is on, the text reads markup: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `fit` | enum | "none" | shrink makes the words smaller until they fit inside the button. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `disabled` | bool | false | When this is on, the player cannot press the button, and it looks faded. |
| `autofocus` | bool | false | When this is on, the button has keyboard focus when the scene starts. |
| `skin` | resource | "" | An image to draw instead of the colored box. Its corners keep their size and its middle stretches. It is lighter under the mouse pointer and darker while the player holds it down, unless skinHover and skinDown give other images. |
| `skinHover` | resource | "" | The image while the mouse pointer is over the button or the button has keyboard focus. If it is empty, the button uses the skin, a little lighter. |
| `skinDown` | resource | "" | The image while the player holds the button down. If it is empty, the button uses the skin, a little darker. |
| `skinEdges` | string | "8" | The number of pixels at the edges of the image that keep their size while the middle stretches. Give one number for all four edges, or four: left, top, right, bottom. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus. |
| `isFocused()` | Returns true while it has keyboard focus. |
| `isDown()` | Returns true while the player holds it down. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The engine calls it when the player clicks or taps the button, or presses the accept action while the button has keyboard focus. |
<!-- end -->

## Bar

<!-- piece:Bar -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `value` | number | 50 | How full it is, between min and max. |
| `min` | number | 0 | The value when the bar is empty. |
| `max` | number | 100 | The value when the bar is full. |
| `color` | color | {0.3, 0.8, 0.45, 1} | The fill color. |
| `background` | color | {0, 0, 0, 0.45} | The color of the empty part. |
| `cornerRadius` | number (px) | 4 | Rounds the corners. |
| `showValue` | bool | false | When this is on, the bar shows the value as text. |
<!-- end -->

## Panel

<!-- piece:Panel -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.08, 0.09, 0.12, 0.85} | The fill color. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |
| `borderColor` | color | {1, 1, 1, 0.15} | The color of the outline. |
| `borderWidth` | number (px) | 1 | The thickness of the outline. 0 means no outline. |
| `skin` | resource | "" | An image to draw instead of the colored box. Its corners keep their size and its middle stretches, so one small image makes a panel of any size. |
| `skinEdges` | string | "8" | The number of pixels at the edges of the image that keep their size while the middle stretches. Give one number for all four edges, or four: left, top, right, bottom. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The engine calls it when the player clicks or taps the panel (but not a button inside it). |
<!-- end -->

## Picture

<!-- piece:Picture -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | The image. |
| `fit` | enum | "contain" | How the image fills the rectangle. |
| `color` | color | {1, 1, 1, 1} | The tint of the image. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The engine calls it when the player clicks or taps the Picture. |
<!-- end -->

## TextInput

<!-- piece:TextInput -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 200 | The width. It has no effect when anchor is fill. |
| `height` | number (px) | 36 | The height. It has no effect when anchor is fill. |
| `text` | text | "" | The text in the box. Read it from a script, or set it. |
| `placeholder` | string | "" | Pale words that show while the box is empty: "Your name". |
| `multiline` | bool | false | When this is on, the box has more than one line: Enter starts a new line, and long lines wrap. |
| `maxLength` | int | 0 | The maximum number of characters that it accepts. 0 means no limit. |
| `secret` | bool | false | When this is on, the box shows dots instead of the characters, for passwords. |
| `allow` | enum | "anything" | What the player can type. numbers: digits, a minus sign at the start and one decimal point. letters: letters and digits, but no spaces or symbols. only: the characters that you list. |
| `allowCharacters` | string | "" | The characters that the player can type, for example abcdef0123456789. |
| `disabled` | bool | false | When this is on, the player cannot type in it, and it looks faded. |
| `autofocus` | bool | false | When this is on, the box has keyboard focus when the scene starts. |
| `font` | resource | "" | A .ttf or .otf font file, "pixel" for the built-in pixel font, or empty for the default font. |
| `size` | int (px) | 18 | The font size. |
| `color` | color | {1, 1, 1, 1} | The text color (also the color of the blinking text cursor). |
| `placeholderColor` | color | {1, 1, 1, 0.4} | The color of the placeholder. |
| `background` | color | {0.05, 0.06, 0.09, 0.9} | The color of the box. |
| `borderColor` | color | {1, 1, 1, 0.3} | The color of the outline. While the box has keyboard focus, the outline has the selection color. |
| `selectionColor` | color | {0.25, 0.47, 0.95, 1} | The color behind selected text. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `skin` | resource | "" | An image to draw instead of the colored box. Its corners keep their size and its middle stretches. |
| `skinEdges` | string | "8" | The number of pixels at the edges of the image that keep their size while the middle stretches. Give one number for all four edges, or four: left, top, right, bottom. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus, as a click does, so the player can type in it. |
| `blur()` | Takes keyboard focus away from it, so typing in it stops. |
| `isFocused()` | Returns true while it has keyboard focus. |
| `selectAll()` | Selects all of its text, so the next typing replaces it. |

| Event (a function in its script) | |
| --- | --- |
| `function changed(text)` | The engine calls it when the player changes the text by typing, deleting or pasting (not when a script sets the text). |
| `function submitted(text)` | The engine calls it when the player presses Enter (in a multiline box: Ctrl+Enter). |
| `function focused()` | The engine calls it when the box gets keyboard focus. |
| `function blurred()` | The engine calls it when the box loses keyboard focus: the focus goes to something else, or the player presses Escape. |
<!-- end -->

## Slider

<!-- piece:Slider -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `height` | number (px) | 24 | The height. It has no effect when anchor is fill. |
| `value` | number | 50 | The current number, between min and max. |
| `min` | number | 0 | The value at the left end (at the bottom end, if vertical is on). |
| `max` | number | 100 | The value at the right end (at the top end, if vertical is on). |
| `step` | number | 0 | The value changes in steps of this size: 1 for whole numbers, 10 for tens. 0 changes it smoothly. |
| `vertical` | bool | false | When this is on, the slider goes from bottom to top, not from left to right. |
| `disabled` | bool | false | When this is on, the player cannot move it, and it looks faded. |
| `autofocus` | bool | false | When this is on, the slider has keyboard focus when the scene starts. |
| `color` | color | {0.25, 0.47, 0.95, 1} | The color of the filled part of the track. |
| `background` | color | {0, 0, 0, 0.45} | The color of the remaining part of the track. |
| `knobColor` | color | {1, 1, 1, 1} | The color of the knob (or a tint for its image). |
| `skin` | resource | "" | An image for the track, instead of the drawn track. Its ends keep their size and its middle stretches. |
| `skinEdges` | string | "8" | The number of pixels at the edges of the image that keep their size while the middle stretches. Give one number for all four edges, or four: left, top, right, bottom. |
| `knobImage` | resource | "" | An image for the knob, instead of the drawn knob. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus. Then the arrow keys or a stick move it. |
| `isFocused()` | Returns true while it has keyboard focus. |

| Event (a function in its script) | |
| --- | --- |
| `function changed(value)` | The engine calls it when the player moves the slider (not when a script sets value). |
<!-- end -->

## Checkbox

<!-- piece:Checkbox -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `height` | number (px) | 28 | The height. It has no effect when anchor is fill. |
| `checked` | bool | false | When this is on, the box has a tick (or the switch is on). |
| `text` | text | "Checkbox" | The words next to it. |
| `look` | enum | "box" | box is a square with a tick. switch slides left and right. In a group, the engine draws a box as a circle. |
| `group` | string | "" | Checkboxes inside the same piece with the same group name are a choice: when one gets a tick, the others lose theirs. If it is empty, the checkbox is alone. |
| `disabled` | bool | false | When this is on, the player cannot change it, and it looks faded. |
| `autofocus` | bool | false | When this is on, the checkbox has keyboard focus when the scene starts. |
| `font` | resource | "" | A font, or empty for the default font. |
| `size` | int (px) | 18 | The font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | The color of the box when it has a tick. |
| `background` | color | {0, 0, 0, 0.45} | The color of the box when it has no tick. |
| `textColor` | color | {1, 1, 1, 1} | The color of the words and the tick. |
| `skin` | resource | "" | An image for the box when it has no tick, instead of the drawn box. |
| `skinChecked` | resource | "" | An image for the box when it has a tick. |

| Method | |
| --- | --- |
| `toggle()` | Adds or removes the tick, as a click does (the engine calls toggled()). |
| `focus()` | Gives it keyboard focus. Then the accept action adds or removes the tick. |
| `isFocused()` | Returns true while it has keyboard focus. |

| Event (a function in its script) | |
| --- | --- |
| `function toggled(checked)` | The engine calls it when the tick goes on or off. The cause can be the player, toggle(), or a tick on another checkbox in its group. |
<!-- end -->

## Row

<!-- piece:Row -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | The width. 0 fits the pieces inside it. |
| `height` | number (px) | 0 | The height. 0 fits the pieces inside it. |
| `gap` | number (px) | 8 | The space between one piece and the next. |
| `padding` | number (px) | 0 | The space between its edges and the pieces inside. |
| `alignItems` | enum | "center" | From top to bottom: start puts the pieces at the top, end at the bottom, and stretch makes them all as tall as the Row. |
| `justify` | enum | "start" | Where the pieces go when the Row is wider than they are: start (left), end (right) or spaceBetween (spread from edge to edge). |
<!-- end -->

## Column

<!-- piece:Column -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | The width. 0 fits the pieces inside it. |
| `height` | number (px) | 0 | The height. 0 fits the pieces inside it. |
| `gap` | number (px) | 8 | The space between one piece and the next. |
| `padding` | number (px) | 0 | The space between its edges and the pieces inside. |
| `alignItems` | enum | "stretch" | From left to right: start puts the pieces at the left, end at the right, and stretch makes them all as wide as the Column. |
| `justify` | enum | "start" | Where the pieces go when the Column is taller than they are: start (top), end (bottom) or spaceBetween (spread from edge to edge). |
<!-- end -->

## Grid

<!-- piece:Grid -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | The width, which the columns share. 0 fits the pieces inside it. |
| `height` | number (px) | 0 | The height. 0 fits the pieces inside it. |
| `columns` | int | 2 | The number of pieces in a row before the next row starts. |
| `gap` | number (px) | 8 | The space between one piece and the next, in both directions. |
| `padding` | number (px) | 0 | The space between its edges and the pieces inside. |
| `alignItems` | enum | "stretch" | Where each piece is in its cell: start is the top-left corner, end is the bottom-right corner, and stretch fills the cell. |
| `justify` | enum | "start" | Where the rows go when the Grid is taller than they are: start (top), end (bottom) or spaceBetween (spread from edge to edge). |
<!-- end -->

## Scroll

<!-- piece:Scroll -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 240 | The width. It has no effect when anchor is fill. |
| `height` | number (px) | 160 | The height. It has no effect when anchor is fill. |
| `direction` | enum | "vertical" | vertical puts the pieces from top to bottom, each as wide as the Scroll, and scrolls up and down. horizontal puts them from left to right and scrolls sideways. |
| `gap` | number (px) | 8 | The space between one piece and the next. |
| `padding` | number (px) | 0 | The space between its edges and the pieces inside. |
| `scrollX` | number (px) | 0 | How far it has scrolled sideways (when direction is horizontal). |
| `scrollY` | number (px) | 0 | How far it has scrolled down. |
| `scrollbar` | bool | true | When this is on, a thin bar shows at the edge while some pieces do not fit. |
| `barColor` | color | {1, 1, 1, 0.4} | The color of the scrollbar. |

| Method | |
| --- | --- |
| `scrollTo(piece)` | Scrolls only as far as necessary to show a piece inside it: List:scrollTo(List.Item20). |
| `scrollLimit()` | Returns how far it can scroll: the largest scrollX and scrollY. |

| Event (a function in its script) | |
| --- | --- |
| `function scrolled(x, y)` | The engine calls it when the player scrolls it. |
<!-- end -->

## TouchStick

A stick for a thumb. It pushes input actions, as the stick of a gamepad
does. [Input: Touch](input.md#touch) shows how to put touch buttons and
sticks on the screen.

<!-- piece:TouchStick -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `leftAction` | action | "left" | The action that it presses when the thumb moves left. With none, it presses nothing in that direction. |
| `rightAction` | action | "right" | The action that it presses when the thumb moves right. |
| `upAction` | action | "up" | The action that it presses when the thumb moves up. |
| `downAction` | action | "down" | The action that it presses when the thumb moves down. |
| `player` | int | 0 | The player whose actions it presses: 2 for player 2. 0 uses the player of the piece that it is inside, or player 1. |
| `mode` | enum | "fixed" | fixed stays in the middle of its rectangle. floating comes to where the thumb touches, anywhere in the rectangle. follow does the same, and moves with the thumb when the thumb goes past the radius. |
| `radius` | number (px) | 60 | How far the thumb moves for a full push. It is also the size of the circle of the stick. |
| `deadzone` | number | 0.2 | The part of the radius near the middle that does not count as a push (0.2 is a fifth). |
| `show` | enum | "touch" | touch shows it on phones and tablets, and on any screen after a finger touches it. always shows it everywhere, and the mouse can use it. never keeps it invisible, but fingers can still use it. |
| `color` | color | {1, 1, 1, 0.25} | The color of the circle of the stick (or a tint for its image). |
| `knobColor` | color | {1, 1, 1, 0.6} | The color of the knob under the thumb (or a tint for its image). |
| `image` | resource | "" | An image for the circle of the stick, instead of the drawn circle. |
| `knobImage` | resource | "" | An image for the knob, instead of the drawn knob. |

| Method | |
| --- | --- |
| `getValue()` | Returns the direction and size of the push: x, y from -1 to 1 (0, 0 when no finger is on the stick). |
| `isActive()` | Returns true while a finger is on the stick. |

| Event (a function in its script) | |
| --- | --- |
| `function touched()` | The engine calls it when a finger touches the stick. |
| `function untouched()` | The engine calls it when the finger lets go of the stick. |
<!-- end -->

## TouchButton

A button for a finger. While a finger holds the TouchButton down, the
input action is down.

<!-- piece:TouchButton -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `action` | action | "jump" | The action that it holds down while a finger is on it. With none, it only tells its script, with touched() and untouched(). |
| `player` | int | 0 | The player whose action it presses: 2 for player 2. 0 uses the player of the piece that it is inside, or player 1. |
| `shape` | enum | "circle" | circle is the largest circle that fits in its rectangle. rectangle is the whole rectangle. |
| `text` | text | "" | Words or a letter on the button. |
| `image` | resource | "" | An image on the button: an arrow, a sword. |
| `show` | enum | "touch" | touch shows it on phones and tablets, and on any screen after a finger touches it. always shows it everywhere, and the mouse can press it. never keeps it invisible, but fingers can still press it. |
| `color` | color | {1, 1, 1, 0.3} | The color of the button. The color is stronger while a finger holds the button. |
| `textColor` | color | {1, 1, 1, 0.9} | The color of its words. |
| `font` | resource | "" | A font, or empty for the default font. |
| `size` | int (px) | 20 | The font size. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |

| Method | |
| --- | --- |
| `isDown()` | Returns true while a finger holds it down. |

| Event (a function in its script) | |
| --- | --- |
| `function touched()` | The engine calls it when a finger presses the button (or slides onto it). |
| `function untouched()` | The engine calls it when the finger lets go or slides off. |
<!-- end -->
