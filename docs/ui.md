# UI

UI pieces draw on top of the game, in screen pixels, and the camera
doesn't move them, which suits scores, health bars and menus.

| | |
| --- | --- |
| To show | **Label** (text), **Bar** (health, progress), **Panel** (a box behind other UI), **Picture** |
| To work | **Button**, **Slider**, **Checkbox** (a tick box, a switch, or one of a choice), **TextInput** (a box to type in) |
| To lay out | **Row**, **Column**, **Grid**, **Scroll** (a list longer than the screen) |
| For touch screens | **TouchStick** and **TouchButton** ([Input: Touch](input.md#touch)) |

They are building blocks: a settings screen, an inventory or a chat box
is some of these put together ([below](#a-settings-screen-from-these-parts)
is one). A UI piece inside another is laid out inside it.

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

## Laying things out

Placing every button of a menu by hand gets old. A **Row**, a **Column**
or a **Grid** places the UI pieces directly inside it, in the order they
are in the Scene panel:

| | |
| --- | --- |
| **Row** | Left to right |
| **Column** | Top to bottom |
| **Grid** | In `columns`, row after row: an inventory, a level select |
| **Scroll** | Top to bottom (or left to right) in a window that scrolls |

Inside one of these, a piece keeps its `width` and `height`, and its
anchor, `x` and `y` aren't used: move it by dragging it up or down in the
Scene panel. The container itself is still placed by its own anchor, so a
Column with the anchor `center` is a menu in the middle of any screen.

| Setting | What it does |
| --- | --- |
| `gap` | The room between one piece and the next |
| `padding` | The room between the container's edges and the pieces |
| `alignItems` | Across the way the pieces run: `start`, `center`, `end`, or `stretch` to make them all as tall as the Row (as wide as the Column) |
| `justify` | Along the way they run, when there's room left: `start`, `center`, `end`, or `spaceBetween` to spread them from edge to edge |
| `width`, `height` | 0 fits what's inside. Set one and the container is that big whatever it holds |
| `grow` (on a piece inside) | Its share of the room left over in a Row or Column: one piece with `grow` 1 takes it all, two share it |

Containers nest: a Column of Rows is a form, with a Label and a Slider in
each Row. They draw nothing themselves; put one in a Panel for a
background. They work the layout out again only when something inside
them changes, so a big menu costs nothing while it sits there.

Pieces made while the game runs line up like the rest:

```lua
-- On a Column: one Button for each saved game
function ready()
  for i, name in ipairs(load("saves", {})) do
    local b = self:spawn("Button", { text = name })
    b:on("pressed", function() go("scenes/game.scene", { save = name }) end)
  end
end
```

### Scroll

A **Scroll** is a window onto a list longer than itself. It stacks the
pieces inside it like a Column, each as wide as the Scroll (with
`direction` set to `horizontal`: like a Row, each as tall), and shows
the part that fits. The mouse wheel scrolls it, and so does a drag or a
flick with a finger or the mouse; moving the keyboard focus to a piece out
of sight scrolls it into view. For a scrolling grid, put a Grid inside.

```lua
List.scrollY = 0                 -- back to the top
List:scrollTo(List.Item20)       -- just far enough to show a piece
```

## Buttons

When a Button is clicked or tapped, its script's `clicked()` runs
(Pictures and Panels get it too):

```lua
-- On a "Play" button
function clicked()
  go("scenes/level1.scene")
end
```

From another script, listen with `Play:on("clicked", function() ... end)`.
`pressed("jump")` is always the input call, in a Button's script as
anywhere else.

| | |
| --- | --- |
| `disabled` | Can't be pressed; drawn faded |
| `isHovered()`, `isDown()` | The pointer is over it; it's held down |
| `hovered()`, `unhovered()` | Events when the pointer arrives and leaves |
| `smitten.mouse.isOverUI()` | The pointer is over any button or panel |

## Sliders

A **Slider** picks a number between `min` and `max` by dragging its knob
(or clicking anywhere on its track). `step` makes it move in jumps: 1 for
whole numbers. Its script's `changed(value)` runs when the player moves
it:

```lua
-- On a Slider with min 0 and max 1
function changed(value)
  masterVolume(value)
end
```

Setting `value` from a script moves the knob without calling `changed()`.
`vertical` turns it to run bottom to top.

## Checkboxes

A **Checkbox** is a box to tick with words beside it; with `look` set to
`switch` it's a switch that slides. `toggled(checked)` runs when it
changes:

```lua
function toggled(checked)
  fullscreen(checked)
end
```

For a choice of one among several (easy, normal, hard), give the
Checkboxes the same `group` name. In a group, ticking one unticks the
others inside the same piece, and they are drawn round:

```lua
-- On each of three Checkboxes with group "difficulty"
function toggled(checked)
  if checked then game.difficulty = text end
end
```

## Typing boxes

A **TextInput** is a box to type in. Click or tap it and type; on a phone
the keyboard comes up. It has a caret, a selection (drag, or Shift with
the arrow keys), Ctrl+A, copy, cut and paste, Home and End, and Ctrl with
the arrows to jump a word.

```lua
-- On a TextInput
function submitted(text)       -- Enter
  print("Hello, " .. text)
end
```

| Setting | What it does |
| --- | --- |
| `placeholder` | Faint words while it's empty: "Your name" |
| `maxLength` | The most characters it takes |
| `allow` | `numbers`, `letters`, or `only` the characters in `allowCharacters` |
| `secret` | Dots instead of characters |
| `multiline` | Several lines: Enter starts a new one, and Ctrl+Enter submits |

`changed(text)` runs on every edit, `submitted(text)` on Enter, and
`focused()` and `blurred()` when typing starts and stops. `text` is what's
in it: read it or set it at any time.

While a TextInput is being typed in, the keys go to it and not to the
game: typing "w" doesn't walk, and `pressed("jump")` doesn't fire on the
space bar. Typing ends with Escape, Tab (on to the next piece), a click
somewhere else, or `blur()`.

For text input of your own making, without a piece,
[`typed()`](input.md#typing) is what this is built on.

## Skins

Panels, Buttons, TextInputs and Sliders are drawn as plain colored shapes
until you give them a **skin**: a picture to draw instead. A skin is
stretched in a way that keeps its corners: `skinEdges` says how many
pixels at each edge stay their own size, and only the middle stretches.
One 24 × 24 picture of a wooden frame with `skinEdges` at 8 makes a panel
of any size with crisp corners.

| | |
| --- | --- |
| `skin` | The picture |
| `skinEdges` | `8` for all four edges, or `8, 4, 8, 12`: left, top, right, bottom |
| `skinHover`, `skinDown` (Button) | Pictures for under the pointer and held down. Without them the skin is drawn a little lighter and darker |
| `knobImage` (Slider) | A picture for the knob; `skin` is the track, and `color` tints the filled part |
| `skin`, `skinChecked` (Checkbox) | Pictures for the box, unticked and ticked |

In a project whose display is set to pixel, skins aren't smoothed, like
every other picture.

## Menus for keyboards and gamepads

Turn on **autofocus** on a Button (or a Slider, Checkbox or TextInput)
and it has the focus when the scene starts. The arrow keys, d-pad and
stick then move the focus to the nearest piece in that direction, Tab and
Shift+Tab step through them in order, and the focused piece shows a ring:

| Focused piece | What the keys do |
| --- | --- |
| Button | Enter, Space or gamepad A press it |
| Checkbox | Enter, Space or gamepad A flip it |
| Slider | Left and right move it (up and down for a vertical one); hold to keep going |
| TextInput | Keys type. Up and down leave it for the piece that way, Tab goes to the next, Escape or gamepad B ends the typing |

Clicking a piece also focuses it, and `focus()` moves the focus from a
script. While nothing has focus, the arrow keys go to the game as usual.

Any player's keys and gamepad work a menu. If a piece, or one it's
inside, has a `player` ([More than one player](input.md#more-than-one-player)),
only that player's input does: a menu each for split screen.

UI keeps working while the game is paused, which is what pause menus
need ([Pausing](scenes.md#pausing-and-slow-motion)).

## A settings screen from these parts

Nothing here is a ready-made options menu; this one is built from the
pieces above, and yours can be shaped however your game needs.

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

The Column stretches each row to its own width, and `grow` gives the
Slider and the TextInput whatever the Labels leave. All of that is set in
the Inspector. Three short scripts make it work:

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

function blurred()          -- typing ended: Enter, Escape, Tab or a click away
  save("name", text)
end

function submitted()
  blur()
end
```

With a gamepad or the arrow keys, the focus starts on Back and moves up
through the box, the switch and the slider.

<!-- piece:UI -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `anchor` | enum | "topLeft" | What x and y are measured from. fill covers the screen or the parent UI piece. Inside a Row, Column, Grid or Scroll, that piece decides where this one goes instead. |
| `x` | number (px) | 0 | Distance in from the anchor. |
| `y` | number (px) | 0 | Distance in from the anchor. |
| `width` | number (px) | 160 | Width (ignored with fill). |
| `height` | number (px) | 40 | Height (ignored with fill). |
| `grow` | number | 0 | Inside a Row or Column: its share of the room left over (two pieces with 1 split it in half). 0 keeps its own size. |
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
| `skin` | resource | "" | A picture to draw instead of the colored box. Its corners keep their size and its middle stretches. It's drawn lighter under the pointer and darker while held, unless the next two say otherwise. |
| `skinHover` | resource | "" | The picture while the pointer is over the button or it has the focus. Empty: the skin, a little lighter. |
| `skinDown` | resource | "" | The picture while the button is held down. Empty: the skin, a little darker. |
| `skinEdges` | string | "8" | How many pixels at the picture's edges keep their size while the middle stretches. One number for all four edges, or four: left, top, right, bottom. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus. |
| `isFocused()` | True while it has the keyboard focus. |
| `isDown()` | True while it's held down. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The button was clicked, tapped, or pressed with accept while focused. |
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
| `skin` | resource | "" | A picture to draw instead of the colored box. Its corners keep their size and its middle stretches, so one small picture makes a panel of any size. |
| `skinEdges` | string | "8" | How many pixels at the picture's edges keep their size while the middle stretches. One number for all four edges, or four: left, top, right, bottom. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The panel was clicked or tapped (not on a button inside it). |
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
| `function clicked()` | The picture was clicked or tapped. |
<!-- end -->

## TextInput

<!-- piece:TextInput -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 200 | Width (ignored with fill). |
| `height` | number (px) | 36 | Height (ignored with fill). |
| `text` | text | "" | What's typed in it. Read it from a script, or set it. |
| `placeholder` | string | "" | Faint words shown while it's empty: "Your name". |
| `multiline` | bool | false | Several lines: Enter starts a new line and long lines wrap. |
| `maxLength` | int | 0 | The most characters it takes. 0 is no limit. |
| `secret` | bool | false | Shows dots instead of the characters, for passwords. |
| `allow` | enum | "anything" | What can be typed. numbers: digits, a minus sign in front and one decimal point. letters: letters and digits, no spaces or symbols. only: the characters you list. |
| `allowCharacters` | string | "" | The characters that can be typed, like abcdef0123456789. |
| `disabled` | bool | false | Can't be typed in; drawn faded. |
| `autofocus` | bool | false | Ready to type in when the scene starts. |
| `font` | resource | "" | A .ttf/.otf font, "pixel", or empty for the default font. |
| `size` | int (px) | 18 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color (the blinking caret's too). |
| `placeholderColor` | color | {1, 1, 1, 0.4} | The placeholder's color. |
| `background` | color | {0.05, 0.06, 0.09, 0.9} | The box's color. |
| `borderColor` | color | {1, 1, 1, 0.3} | The outline's color. The outline takes the selection's color while it's being typed in. |
| `selectionColor` | color | {0.25, 0.47, 0.95, 1} | The color behind selected text. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `skin` | resource | "" | A picture to draw instead of the colored box. Its corners keep their size and its middle stretches. |
| `skinEdges` | string | "8" | How many pixels at the picture's edges keep their size while the middle stretches. One number for all four edges, or four: left, top, right, bottom. |

| Method | |
| --- | --- |
| `focus()` | Starts typing in it, as a click does. |
| `blur()` | Stops typing in it. |
| `isFocused()` | True while it's being typed in. |
| `selectAll()` | Selects all of its text, so typing replaces it. |

| Event (a function in its script) | |
| --- | --- |
| `function changed(text)` | The text changed by typing, deleting or pasting (not when a script sets it). |
| `function submitted(text)` | Enter was pressed (in a multiline one: Ctrl+Enter). |
| `function focused()` | It began being typed in. |
| `function blurred()` | It stopped being typed in: the focus went elsewhere, or Escape was pressed. |
<!-- end -->

## Slider

<!-- piece:Slider -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `height` | number (px) | 24 | Height (ignored with fill). |
| `value` | number | 50 | The number it's at, between min and max. |
| `min` | number | 0 | The value at the left end (the bottom, when vertical). |
| `max` | number | 100 | The value at the right end (the top, when vertical). |
| `step` | number | 0 | The value moves in jumps this big: 1 for whole numbers, 10 for tens. 0 moves smoothly. |
| `vertical` | bool | false | Runs bottom to top instead of left to right. |
| `disabled` | bool | false | Can't be moved; drawn faded. |
| `autofocus` | bool | false | Has keyboard focus when the scene starts. |
| `color` | color | {0.25, 0.47, 0.95, 1} | The color of the filled part of the track. |
| `background` | color | {0, 0, 0, 0.45} | The color of the rest of the track. |
| `knobColor` | color | {1, 1, 1, 1} | The knob's color (or a tint for its image). |
| `skin` | resource | "" | A picture for the track instead of the drawn one. Its ends keep their size and its middle stretches. |
| `skinEdges` | string | "8" | How many pixels at the picture's edges keep their size while the middle stretches. One number for all four edges, or four: left, top, right, bottom. |
| `knobImage` | resource | "" | A picture for the knob, instead of the drawn one. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus: the arrow keys or a stick then move it. |
| `isFocused()` | True while it has the keyboard focus. |

| Event (a function in its script) | |
| --- | --- |
| `function changed(value)` | The player moved the slider (not when a script sets value). |
<!-- end -->

## Checkbox

<!-- piece:Checkbox -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `height` | number (px) | 28 | Height (ignored with fill). |
| `checked` | bool | false | Ticked (or switched on). |
| `text` | text | "Checkbox" | The words beside it. |
| `look` | enum | "box" | box is a square with a tick. switch slides left and right. In a group, a box is drawn round. |
| `group` | string | "" | Checkboxes inside the same piece with the same group name are a choice: ticking one unticks the others. Empty: it's on its own. |
| `disabled` | bool | false | Can't be changed; drawn faded. |
| `autofocus` | bool | false | Has keyboard focus when the scene starts. |
| `font` | resource | "" | A font, or empty for the default. |
| `size` | int (px) | 18 | Font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | The box's color when it's ticked. |
| `background` | color | {0, 0, 0, 0.45} | The box's color when it isn't. |
| `textColor` | color | {1, 1, 1, 1} | The color of the words and the tick. |
| `skin` | resource | "" | A picture for the box when it isn't ticked, instead of the drawn one. |
| `skinChecked` | resource | "" | A picture for the box when it's ticked. |

| Method | |
| --- | --- |
| `toggle()` | Flips it, as a click does (toggled() runs). |
| `focus()` | Gives it keyboard focus: accept then flips it. |
| `isFocused()` | True while it has the keyboard focus. |

| Event (a function in its script) | |
| --- | --- |
| `function toggled(checked)` | It was ticked or unticked: by the player, by toggle(), or because another one in its group was ticked. |
<!-- end -->

## Row

<!-- piece:Row -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | Width. 0 fits what's inside it. |
| `height` | number (px) | 0 | Height. 0 fits what's inside it. |
| `gap` | number (px) | 8 | The room between one piece and the next. |
| `padding` | number (px) | 0 | The room between its edges and the pieces inside. |
| `alignItems` | enum | "center" | Top to bottom: start puts the pieces at the top, end at the bottom, stretch makes them all as tall as the row. |
| `justify` | enum | "start" | Where the pieces go when the row is wider than they are: start is the left, end the right, spaceBetween spreads them from edge to edge. |
<!-- end -->

## Column

<!-- piece:Column -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | Width. 0 fits what's inside it. |
| `height` | number (px) | 0 | Height. 0 fits what's inside it. |
| `gap` | number (px) | 8 | The room between one piece and the next. |
| `padding` | number (px) | 0 | The room between its edges and the pieces inside. |
| `alignItems` | enum | "stretch" | Left to right: start puts the pieces at the left, end at the right, stretch makes them all as wide as the column. |
| `justify` | enum | "start" | Where the pieces go when the column is taller than they are: start is the top, end the bottom, spaceBetween spreads them from edge to edge. |
<!-- end -->

## Grid

<!-- piece:Grid -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | Width: the columns share it. 0 fits what's inside it. |
| `height` | number (px) | 0 | Height. 0 fits what's inside it. |
| `columns` | int | 2 | How many pieces go in a row before the next row starts. |
| `gap` | number (px) | 8 | The room between one piece and the next, both ways. |
| `padding` | number (px) | 0 | The room between its edges and the pieces inside. |
| `alignItems` | enum | "stretch" | Where each piece sits in its cell: start is the top-left corner, end the bottom-right, stretch fills the cell. |
| `justify` | enum | "start" | Where the rows go when the grid is taller than they are: start is the top, end the bottom, spaceBetween spreads them from edge to edge. |
<!-- end -->

## Scroll

<!-- piece:Scroll -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 240 | Width (ignored with fill). |
| `height` | number (px) | 160 | Height (ignored with fill). |
| `direction` | enum | "vertical" | vertical stacks the pieces top to bottom, each as wide as the Scroll, and scrolls up and down. horizontal lines them up left to right and scrolls sideways. |
| `gap` | number (px) | 8 | The room between one piece and the next. |
| `padding` | number (px) | 0 | The room between its edges and the pieces inside. |
| `scrollX` | number (px) | 0 | How far it's scrolled sideways (horizontal ones). |
| `scrollY` | number (px) | 0 | How far down it's scrolled. |
| `scrollbar` | bool | true | Shows a thin bar at the edge while there's more than fits. |
| `barColor` | color | {1, 1, 1, 0.4} | The scrollbar's color. |

| Method | |
| --- | --- |
| `scrollTo(piece)` | Scrolls just far enough to show a piece inside it: List:scrollTo(List.Item20). |
| `scrollLimit()` | How far it can scroll: the biggest scrollX and scrollY. |

| Event (a function in its script) | |
| --- | --- |
| `function scrolled(x, y)` | The player scrolled it. |
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
| `function touched()` | A finger landed on the stick. |
| `function untouched()` | The finger let go of the stick. |
<!-- end -->

## TouchButton

A button for a finger: it holds an input action down while it's held.

<!-- piece:TouchButton -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `action` | action | "jump" | The action it holds down while a finger is on it (none: it only tells its script, with touched() and untouched()). |
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
| `function touched()` | A finger pressed the button (or slid onto it). |
| `function untouched()` | The finger let go, or slid off. |
<!-- end -->
