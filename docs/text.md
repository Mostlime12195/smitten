# Text

Three things draw words:

- the **Text** piece, in the game world (for example, a sign or a damage
  number).
- the **Label** piece, on the screen (for example, a score or a title).
- `write()` in the `draw()` function of a script.

Buttons also have words. All of them use the same text engine,
`smitten.text`. Because of this, what this page tells about one of them is also true
for the others.

With their default properties, they draw plain text in one font, one size
and one color. This page tells about the other things that they can do:

- words in different colors and sizes in one text.
- letters that move up and down or shake.
- text that comes onto the screen one letter after the other.
- how to find the size of a text, or the position of one of its letters.

Smitten does not have a ready-made dialogue box, name tag or choice menu.
You make your own from the parts on this page.
[The last example](#a-dialogue-box-from-these-parts) shows one way.

## Plain text

| Property | |
| --- | --- |
| `text` | The words. To start a new line in the Inspector, press Enter |
| `font` | A `.ttf` or `.otf` file from your project, `pixel` for the pixel font that Smitten has, or empty for the default font |
| `size`, `color` | The size, and the color |
| `align` | `left`, `center`, `right`, or `justify` (Smitten makes wrapped lines the same width) |
| `wrap` (Text) | A line that is longer than this number of pixels goes onto the next line. 0 does not wrap. A Label wraps at its own width |
| `wrapBy` | Where lines break: between words (`word`), after any character (`character`, for languages without spaces, for example Japanese) or, on a Label, nowhere (`none`) |
| `lineHeight` | 1 is the line spacing of the font. 1.5 puts half a line of space between lines |
| `letterSpacing` | More pixels between letters |
| `outline`, `outlineWidth`, `outlineColor` | A line around each letter. With it, you can read the text on all backgrounds |
| `shadow`, `shadowX`, `shadowY`, `shadowColor` | A copy of the text behind it, a small distance away |
| `valign` (Label) | `top`, `middle` or `bottom` of the rectangle of the Label |
| `fit` (Label, Button) | `shrink` makes the text smaller until it fits in the rectangle |

Smitten draws text at its size on the screen. Because of this, the text stays sharp
when the game becomes bigger to fill a big window.

## Rich text

If you turn on **rich**, the text can have **text tags**. A text tag is a
word in square brackets. It changes how the text after it looks. The
change stops at a closing text tag with a slash.

```
You found the [color=gold][b]Sun Key[/b][/color]!
```

You can do this in the Inspector, without code. Type the text tags into
the `text` of a Text or a Label. `[/]` closes the last text tag that you
opened. If you do not close a text tag, it continues to the end of the
text.

| Tag | What it does |
| --- | --- |
| `[b]`, `[i]` | Bold, italic |
| `[u]`, `[s]` | Underline, strike-through |
| `[color=red]`, `[color=#ff8800]` | A color: a name or a hex code (`#f80`, `#ff8800`, or `#ff8800cc` with transparency) |
| `[size=24]`, `[size=+4]` | A size in pixels, or bigger (`+`) or smaller (`-`) than the text around it |
| `[font=fonts/title.ttf]` | A different font file (or `[font=pixel]`) |
| `[outline]`, `[outline=#000]`, `[outline=2,#000]` | An outline. It is 1 pixel and black if you do not give a width and a color |
| `[shadow]`, `[shadow=#000 x=2 y=2]` | A shadow, with its color and its distance from the text |
| `[center]`, `[right]`, `[left]` | Aligns this line, and ignores `align`. Put it at the start of a line |
| `[img=art/coin.png]` | A picture in the line, as tall as the letters. `[img=art/hero.sprite frame=2]` shows one frame. `columns=` and `rows=` cut a plain picture into frames. `height=` or `width=` set its size |
| `[link=shop]` | Marks a part of the text that the player can click (see [Links](#links)) |
| `[wave]`, `[shake]`, `[rainbow]`, `[pulse]`, `[fade]` | Effects that move or color each letter (see below) |
| `[pause=0.5]`, `[speed=10]` | For [revealing text](#revealing-text-a-typewriter): wait at this position, or change the speed |

The color names are `white`, `black`, `gray`, `silver`, `red`, `orange`,
`yellow`, `gold`, `green`, `lime`, `teal`, `cyan`, `blue`, `navy`,
`purple`, `pink`, `brown` and `clear`.

You can put text tags inside other text tags. Text tags are not
characters: Smitten does not draw, count or measure them.

**A real square bracket:** type it two times: `[[`. If Smitten does not
know a text tag (for example, `[colour=red]`, a typing mistake), it shows
the text tag as you wrote it. The Output panel also tells you one time.
Because of this, you can find mistakes quickly. If you put text from a different source
into rich text (for example, the name of a player), give it to
`smitten.text.escape(name)` first.

**Bold and italic:** if you have the bold and italic versions of your font,
set them as the `fontBold` and `fontItalic` properties of the piece. Then
`[b]` and `[i]` use them. Without them, Smitten makes the bold and italic
itself. It draws bold text two times, one pixel apart. It slants italic
text. The pixel font also uses this method.

### Effects

An effect changes each letter separately, in each frame. Smitten has five
effects. Each effect can have values after its name:

| Tag | Values (and their default values) |
| --- | --- |
| `[wave]` | `amp=3` pixels up and down, `freq=1.5` waves each second, `spread=0.5` how much each letter is behind the letter before it |
| `[shake]` | `amp=1.5` pixels, `speed=20` jumps each second |
| `[rainbow]` | `speed=0.5` cycles through the colors each second, `spread=0.06` between letters, `sat=0.75` how strong the colors are |
| `[pulse]` | `amp=0.15` how much bigger and smaller, `freq=1` beats each second |
| `[fade]` | `time=0.3` seconds for each letter to fade in when it comes onto the screen |

```
[wave amp=5 freq=2]Wheee![/wave]   [shake]it's c-c-cold[/shake]
```

## Your own effects

`smitten.text.effect(name, fn)` adds your own text tag. Smitten calls the
function in each frame, for each letter in the text tag. It gives the
function a table `c`. The table tells about the letter, and the function
changes the table:

```lua
-- [bounce height=6]boing[/bounce]
smitten.text.effect("bounce", function(c)
  local height = c.args.height or 4
  c.y = c.y - math.abs(math.sin(c.time * 6 + c.index * 0.4)) * height
end)
```

Add each effect one time, before Smitten shows the text that uses it. The
script of the main scene is a good place.

| Change these | |
| --- | --- |
| `c.x`, `c.y` | Moves the letter this number of pixels (both start at 0) |
| `c.rotation` | Turns the letter around its middle, in degrees |
| `c.scale` | Makes the letter bigger or smaller (1 is normal) |
| `c.color` | The color of the letter, `{r, g, b, a}`: change the numbers or set a new table |
| `c.alpha` | 0 is invisible, 1 is solid |
| `c.visible` | `false` hides the letter |

| Read these | |
| --- | --- |
| `c.index`, `c.count` | The number of this letter (1 is the first letter of all the text), and the number of letters |
| `c.char` | The letter |
| `c.line` | The line that the letter is on |
| `c.time` | Seconds. This number always increases: put it in `math.sin` for movement |
| `c.since` | Seconds since this letter came onto the screen (see below) |
| `c.args` | The values in the text tag: `[bounce height=6]` gives `c.args.height` |
| `c.piece` | The Text or Label that Smitten draws |

`c` is **one table for all the letters**. This keeps the game fast. Read
and change `c` in the function. Do not keep it for later.

For an effect on only one piece, you do not need a text tag. Give the
script of the piece an `eachCharacter(c)` function. Smitten calls it for
each letter of that piece, with the same `c`:

```lua
-- On a Label: each letter falls in from above when it comes onto the screen
function eachCharacter(c)
  local t = math.min(1, c.since / 0.2)
  c.y = c.y - (1 - t) * 12
  c.alpha = t
end
```

## Revealing text (a typewriter)

Two properties set how much of a text Smitten shows:

- `visibleCharacters`: the number of letters, from the start. 0 shows no
  letters, and -1 shows all the letters.
- `visibleRatio`: the same as a part of all the text, from 0 to 1. It is
  a plain number, so you can tween it:
  `tween(Label, 2, { visibleRatio = 1 })`.

Text tags and line breaks are not letters. Hidden letters keep their
space. Because of this, the text does not move while the letters come onto the
screen.

`reveal(charactersPerSecond)` increases `visibleCharacters` for you. The
default speed is 30 letters each second. While it runs, the engine calls
`revealed(index, char)` for each letter, and `finished()` at the end.
`skip()` shows the remaining text immediately. While the game is paused,
`reveal()` stops.

```lua
-- On a Label: show the text one letter after the other, with a blip for
-- each letter and a short stop after punctuation.
local typing

function ready()
  typing = reveal(40)
end

function revealed(index, char)
  if char ~= " " then sfx("blip") end
  if char == "." or char == "!" or char == "?" then typing:wait(0.35) end
  if char == "," then typing:wait(0.15) end
end

function finished()
  print("all shown")
end
```

`reveal()` gives a handle:

| | |
| --- | --- |
| `typing:wait(seconds)` | Waits before the next letter |
| `typing:cancel()` | Stops at the current letter |
| `typing:after(fn)` | Calls `fn` when all the text shows |
| `typing.speed = 80` | Changes the speed |

Rich text can set the speed in the text. `[pause=0.5]` waits half a second
at that position. `[speed=10]slowly...[/speed]` shows its part at 10
letters each second.

```
Well...[pause=0.6] [speed=8]I suppose so.[/speed]
```

`[fade]` and `c.since` are good with this. Put `[fade]` around all the
text, and each letter fades in when it comes onto the screen.

## Measuring

A Text or a Label can tell you about the current layout of its text:

| | |
| --- | --- |
| `measure()` | The width and height of all the text |
| `lineCount()`, `characterCount()` | The number of lines, and the number of letters |
| `characterRect(index)` | The position of one letter: x, y, width, height |
| `characterAt(x, y)` | The number of the letter at a point, or nil |
| `linkAt(x, y)` | The name of the `[link]` at a point, or nil |

For a Text, points and rectangles are relative to the position of the
piece. For a Label, they are relative to the top-left corner of the Label.

```lua
-- Make a Panel behind a Label the size of its text
local w, h = Label:measure()
Panel.width, Panel.height = w + 24, h + 16

-- Find the position of the last letter, to put a cursor after it
local x, y, w, h = Label:characterRect(Label:characterCount())
```

Without a piece, `smitten.text` can measure any text:

```lua
local w, h, lines = smitten.text.measure("Some [b]words[/b]", { rich = true, size = 20, width = 200 })
local lines = smitten.text.wrap("A long sentence to cut up", { width = 120, size = 16 })
```

<!-- module:text -->
| Function | |
| --- | --- |
| `smitten.text.effect(name, fn)` | Adds an effect for rich text: after effect("bounce", fn), [bounce]boing[/bounce] calls fn(c) for each character, every frame. Change c.x, c.y, c.rotation, c.scale, c.color, c.alpha, c.visible; read c.index, c.count, c.char, c.line, c.time, c.since, c.args, c.piece. |
| `smitten.text.effects()` | The names of every effect, sorted. |
| `smitten.text.measure(text, options?)` | How big a text is when drawn: width, height, lines. options: font, size, width (wraps), rich, wrap, lineHeight, letterSpacing. |
| `smitten.text.wrap(text, options?)` | The lines a text is broken into at a width: wrap("a long sentence", { width = 120 }) gives a list of strings. |
| `smitten.text.strip(text)` | The text without its tags: strip("[b]Hi[/b]") is "Hi". |
| `smitten.text.escape(text)` | Makes text safe to put inside rich text (a player's name): square brackets are shown, not read as tags. |
| `smitten.text.color(value)` | A color from "#ff8800", "#f80" or a name like "red": {r, g, b, a}, or nil. |
<!-- end -->

## Links

`[link=name]` marks a part of rich text. On a **Label**, when the player
clicks or taps that part, the engine calls `linkPressed(name)` in the
script of the Label:

```lua
-- text: Visit the [link=shop][u]shop[/u][/link] or [link=inn][u]rest[/u][/link].
function linkPressed(name)
  if name == "shop" then go("scenes/shop.scene") end
end
```

The text tag only marks the part of the text. You choose how a link looks:
for example, underline it or give it a color. On a **Text** in the world,
your script must find the position of the pointer:

```lua
function update()
  if smitten.mouse.pressed(1) then
    local name = linkAt(fromWorld(mouse()))
    if name then print("clicked", name) end
  end
end
```

## write()

`write(text, x, y, options)` uses the same properties as options:

- `rich = true` to read text tags.
- `visible`: the number of letters that show.
- `wrap`, `lineHeight` and `letterSpacing`.
- `outline` (true or a width), with `outlineColor`.
- `shadow`, with `shadowX`, `shadowY` and `shadowColor`.
- `size`, `font`, `align` and `width`.

It gives the width and height of the text that it wrote.

```lua
function draw()
  local w, h = write("[b]HP[/b] [color=red]12[/color]/20", 8, 8, { rich = true, size = 20, outline = 2 })
  rect(8, 12 + h, w, 3)
end
```

## A dialogue box from these parts

Make a Panel. Put a Label in it (anchor `fill`, `rich` on). Put this
script on the Label. The game calls `say()` with the lines to show. When
the player presses a key, the Label shows the remaining part of the line.
At the next key press, it shows the next line.

```lua
-- On the Label inside the Panel
local lines, at = {}, 0

local function show()
  text = lines[at]
  reveal(45)
end

function say(list)          -- Dialog:say({ "Hello!", "Nice [wave]weather[/wave]." })
  lines, at = list, 1
  parent.visible = true
  show()
end

function revealed(index, char)
  if char ~= " " then sfx("blip") end
end

function update()
  if not parent.visible or not pressed("accept") then return end
  if visibleCharacters >= 0 then
    skip()                  -- the line is not complete: show all of it
  elseif at < #lines then
    at += 1
    show()
  else
    parent.visible = false
  end
end
```

For names, portraits and choices, add more pieces: a different Label, a
Picture, some Buttons.

## How fast it is

- Smitten reads and lays out a text one time, when the text or one of its
  properties changes. Then it draws the text from a ready-made batch. Text
  that does not change uses almost no time in each frame, with any number
  of text tags.
- Smitten calculates in each frame only the letters in an effect (or all
  the letters, on a piece with `eachCharacter`). Put effect text tags
  around only the words that need them, not around all the text.
- If a text changes in each frame (for example, a timer), Smitten lays it
  out again in each frame. This is not a problem for one or two lines.
  Do not change long paragraphs in each frame.
- Smitten draws plain text without the properties on this page in the same
  way as before.

## Reference

A Label has the same properties, methods and events. It also has `valign`,
`fit` and `linkPressed(name)`: see [UI](ui.md#label).

<!-- piece:Text -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Text" | What it says. |
| `font` | resource | "" | A .ttf/.otf font file, "pixel" for the built-in pixel font, or empty for the default font. |
| `size` | int (px) | 16 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color. |
| `align` | enum | "center" | Lines up the text around the piece's position. justify stretches wrapped lines to the same width. |
| `wrap` | number (px) | 0 | Wrap lines longer than this; 0 never wraps. |
| `wrapBy` | enum | "word" | Where a line that's too long is broken: between words, or after any character (for writing without spaces, like Japanese). |
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
| `characterRect(index)` | Where a character is, measured from the piece's position: x, y, width, height. For putting a cursor or a sparkle on it. |
| `characterAt(x, y)` | The number of the character at a point (measured from the piece's position), or nil. |
| `linkAt(x, y)` | The name of the [link=name] at a point (measured from the piece's position), or nil. |
| `reveal(charactersPerSecond?, from?)` | Shows the text a character at a time (30 a second unless you say): a typewriter. Returns a handle with cancel(), after(fn) and wait(seconds). [pause=0.5] and [speed=10] in rich text change the pace. |
| `skip()` | Shows all of the text now, and ends a reveal(). |

| Event (a function in its script) | |
| --- | --- |
| `function revealed(index, char)` | reveal() showed one more character: play a blip, or wait at a full stop. |
| `function finished()` | reveal() has shown the whole text. |
| `function eachCharacter(c)` | Called for every character each time the text is drawn, to move or color it: c.y = math.sin(c.time * 4 + c.index) * 3. c has x, y, rotation, scale, color, alpha, visible to change, and index, count, char, line, time, since to read. It's one table used for every character, so don't keep it. |
<!-- end -->
