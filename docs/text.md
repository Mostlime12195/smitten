# Text

Three things draw words: the **Text** piece (in the game world: a sign, a
damage number), the **Label** (on the screen: a score, a title) and
`write()` in a script's `draw()`. Buttons have words too. All of them use
the same text engine, `smitten.text`, so what this page says about one is
true of the others.

Out of the box they draw plain text in one font, size and color. This page
is about everything past that: words in different colors and sizes inside
one text, letters that wave or shake, text that types itself out, and
finding out how big a text is or where one of its letters sits.

There's no ready-made dialogue box, name tag or choice menu. The pieces
here are what you build your own from; [the last example](#a-dialogue-box-from-these-parts)
shows one way.

## Plain text

| Setting | |
| --- | --- |
| `text` | What it says. Press Enter in the Inspector for a new line |
| `font` | A `.ttf` or `.otf` file from your project, `pixel` for the built-in pixel font, or empty for the default font |
| `size`, `color` | How big, and what color |
| `align` | `left`, `center`, `right`, or `justify` (wrapped lines stretched to the same width) |
| `wrap` (Text) | Lines longer than this many pixels wrap; 0 never wraps. A Label wraps at its own width |
| `wrapBy` | Break lines between words (`word`), after any character (`character`, for writing without spaces such as Japanese) or, on a Label, not at all (`none`) |
| `lineHeight` | 1 is the font's own line spacing; 1.5 leaves half a line between lines |
| `letterSpacing` | Extra pixels between letters |
| `outline`, `outlineWidth`, `outlineColor` | A line around every letter, so text reads on any background |
| `shadow`, `shadowX`, `shadowY`, `shadowColor` | A copy of the text behind it, moved a little |
| `valign` (Label) | `top`, `middle` or `bottom` of the Label's rectangle |
| `fit` (Label, Button) | `shrink` makes the text smaller until it fits the rectangle |

Text is drawn at the size it has on the screen, so it stays sharp when the
game is scaled up to fill a big window.

## Rich text

Turn on **rich** and the text can carry **tags**: words in square
brackets that change how the text after them looks, until a closing tag
with a slash.

```
You found the [color=gold][b]Sun Key[/b][/color]!
```

This works in the Inspector with no code: type the tags into a Text's or
Label's `text`. `[/]` closes whichever tag was opened last, and a tag
that's never closed runs to the end of the text.

| Tag | What it does |
| --- | --- |
| `[b]`, `[i]` | Bold, italic |
| `[u]`, `[s]` | Underline, strike-through |
| `[color=red]`, `[color=#ff8800]` | A color: a name or a hex code (`#f80`, `#ff8800`, `#ff8800cc` with see-through) |
| `[size=24]`, `[size=+4]` | A size in pixels, or bigger (`+`) or smaller (`-`) than the text around it |
| `[font=fonts/title.ttf]` | Another font file (or `[font=pixel]`) |
| `[outline]`, `[outline=#000]`, `[outline=2,#000]` | An outline: 1 pixel and black unless you give a width and a color |
| `[shadow]`, `[shadow=#000 x=2 y=2]` | A shadow, with its color and how far it falls |
| `[center]`, `[right]`, `[left]` | Lines this line up on its own, whatever `align` says. Put it at the start of a line |
| `[img=art/coin.png]` | A picture in the line, as tall as the letters. `[img=art/hero.sprite frame=2]` shows one frame; `columns=` and `rows=` cut a plain picture into frames; `height=` or `width=` set its size |
| `[link=shop]` | Marks a part of the text that can be clicked (see [Links](#links)) |
| `[wave]`, `[shake]`, `[rainbow]`, `[pulse]`, `[fade]` | Effects that move or color each letter (below) |
| `[pause=0.5]`, `[speed=10]` | For [revealing text](#revealing-text-a-typewriter): wait here, or change the pace |

The color names are `white`, `black`, `gray`, `silver`, `red`, `orange`,
`yellow`, `gold`, `green`, `lime`, `teal`, `cyan`, `blue`, `navy`,
`purple`, `pink`, `brown` and `clear`.

Tags can sit inside each other, and tags aren't characters: they're never
drawn, counted or measured.

**A real square bracket** is typed twice: `[[`. A tag Smitten doesn't know
(`[colour=red]`, a typing mistake) is shown as it's written, and the
Output panel says so once, so mistakes are easy to see. Before putting
text you didn't write into rich text (a player's name), pass it through
`smitten.text.escape(name)`.

**Bold and italic.** If you have the bold and italic versions of your
font, set them as the piece's `fontBold` and `fontItalic` and `[b]` and
`[i]` use them. Without them the font is faked: bold is drawn twice a
pixel apart, italic is slanted. That's also how the pixel font does it.

### Effects

An effect changes each letter separately, every frame. Five are built in,
and each takes settings after its name:

| Tag | Settings (and what they are when left out) |
| --- | --- |
| `[wave]` | `amp=3` pixels up and down, `freq=1.5` waves a second, `spread=0.5` how far each letter is behind the one before |
| `[shake]` | `amp=1.5` pixels, `speed=20` jumps a second |
| `[rainbow]` | `speed=0.5` times round the colors a second, `spread=0.06` between letters, `sat=0.75` how strong the colors are |
| `[pulse]` | `amp=0.15` how much bigger and smaller, `freq=1` beats a second |
| `[fade]` | `time=0.3` seconds each letter takes to fade in when it's revealed |

```
[wave amp=5 freq=2]Wheee![/wave]   [shake]it's c-c-cold[/shake]
```

## Your own effects

`smitten.text.effect(name, fn)` adds a tag of your own. Smitten calls the
function for each letter inside the tag, every frame, with a table `c`
that describes the letter and that the function changes:

```lua
-- [bounce height=6]boing[/bounce]
smitten.text.effect("bounce", function(c)
  local height = c.args.height or 4
  c.y = c.y - math.abs(math.sin(c.time * 6 + c.index * 0.4)) * height
end)
```

Add effects once, before the text that uses them is shown: the main
scene's script is a good place.

| Change these | |
| --- | --- |
| `c.x`, `c.y` | Moves the letter this many pixels (both start at 0) |
| `c.rotation` | Turns it, in radians, around its middle |
| `c.scale` | Makes it bigger or smaller (1 is normal) |
| `c.color` | Its color, `{r, g, b, a}`: change the numbers or set a new table |
| `c.alpha` | 0 is invisible, 1 is solid |
| `c.visible` | `false` hides it |

| Read these | |
| --- | --- |
| `c.index`, `c.count` | Which letter this is (1 is the first of the whole text), and how many there are |
| `c.char` | The letter itself |
| `c.line` | Which line it's on |
| `c.time` | Seconds, always counting up: put it in `math.sin` for movement |
| `c.since` | Seconds since this letter was revealed (see below) |
| `c.args` | The settings typed in the tag: `[bounce height=6]` gives `c.args.height` |
| `c.piece` | The Text or Label being drawn |

`c` is **one table used for every letter**, to keep things fast. Read it
and change it inside the function, but don't store it for later.

For a one-off effect on a single piece, skip the tag: give the piece's
script an `eachCharacter(c)` function. It runs for every letter of that
piece, with the same `c`:

```lua
-- On a Label: every letter drops in from above when it's revealed
function eachCharacter(c)
  local t = math.min(1, c.since / 0.2)
  c.y = c.y - (1 - t) * 12
  c.alpha = t
end
```

## Revealing text (a typewriter)

Two settings decide how much of a text shows:

- `visibleCharacters`: how many letters, counted from the start. 0 shows
  nothing and -1 shows everything.
- `visibleRatio`: the same as a part of the whole, 0 to 1. It's a plain
  number, so it can be tweened: `tween(Label, 2, { visibleRatio = 1 })`.

Tags and line breaks don't count as letters, and hidden letters still take
up their room, so nothing jumps about as the text appears.

`reveal(charactersPerSecond)` counts `visibleCharacters` up for you, 30 a
second unless you give another number. While it runs, the piece gets
`revealed(index, char)` for each letter and `finished()` at the end.
`skip()` shows the rest at once. It stops while the game is paused.

```lua
-- On a Label: types its text out, with a blip for each letter and a
-- short stop after punctuation.
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

`reveal()` returns a handle:

| | |
| --- | --- |
| `typing:wait(seconds)` | Holds the next letter back |
| `typing:cancel()` | Stops where it is |
| `typing:after(fn)` | Calls `fn` when everything shows |
| `typing.speed = 80` | Changes the pace |

Rich text can set the pace from inside the text: `[pause=0.5]` waits half
a second at that spot, and `[speed=10]slowly...[/speed]` reveals its part
at 10 letters a second.

```
Well...[pause=0.6] [speed=8]I suppose so.[/speed]
```

`[fade]` and `c.since` go well with this: `[fade]` around the whole text
makes each letter fade in as it's revealed.

## Measuring

A Text or Label can tell you about its text as it's laid out right now:

| | |
| --- | --- |
| `measure()` | Width and height of the whole text |
| `lineCount()`, `characterCount()` | How many lines, and how many letters |
| `characterRect(index)` | Where one letter is: x, y, width, height |
| `characterAt(x, y)` | The number of the letter at a point, or nil |
| `linkAt(x, y)` | The name of the `[link]` at a point, or nil |

Points and rectangles are measured from the piece's own position (a
Text) or from the Label's top-left corner.

```lua
-- A Panel behind a Label, sized to its text
local w, h = Label:measure()
Panel.width, Panel.height = w + 24, h + 16

-- Where the last letter is, to put a cursor after it
local x, y, w, h = Label:characterRect(Label:characterCount())
```

Without a piece, `smitten.text` measures any text:

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

`[link=name]` marks a part of rich text. On a **Label**, clicking or
tapping it calls `linkPressed(name)` in the Label's script:

```lua
-- text: Visit the [link=shop][u]shop[/u][/link] or [link=inn][u]rest[/u][/link].
function linkPressed(name)
  if name == "shop" then go("scenes/shop.scene") end
end
```

The tag only marks the spot. How a link looks is up to you: underline it,
color it. On a **Text** in the world, ask where the pointer is yourself:

```lua
function update()
  if smitten.mouse.pressed(1) then
    local name = linkAt(fromWorld(mouse()))
    if name then print("clicked", name) end
  end
end
```

## write()

`write(text, x, y, options)` takes the same ideas as options: `rich =
true` to read tags, `visible` (how many letters show), `wrap`,
`lineHeight`, `letterSpacing`, `outline` (true or a width) with
`outlineColor`, and `shadow` with `shadowX`, `shadowY`, `shadowColor`,
next to `size`, `font`, `align` and `width`. It returns the width and
height of what it wrote.

```lua
function draw()
  local w, h = write("[b]HP[/b] [color=red]12[/color]/20", 8, 8, { rich = true, size = 20, outline = 2 })
  rect(8, 12 + h, w, 3)
end
```

## A dialogue box from these parts

A Panel, with a Label inside it (anchor `fill`, `rich` on) and this
script on the Label. The game calls `say()` with the lines to show;
pressing a key shows the rest of a line, then the next line.

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
  if not parent.visible or not smitten.input.pressed("accept") then return end
  if visibleCharacters >= 0 then
    skip()                  -- still typing: show the whole line
  elseif at < #lines then
    at += 1
    show()
  else
    parent.visible = false
  end
end
```

Names, portraits and choices are more pieces: another Label, a Picture,
a few Buttons.

## How fast it is

- A text is read and laid out once, when it or one of its settings
  changes, and then drawn from a ready-made batch. Text that stays the
  same costs almost nothing per frame, however many tags it has.
- Only letters inside an effect (or all of them, on a piece with
  `eachCharacter`) are worked out every frame. Put effect tags around
  the words that need them rather than the whole page.
- A text that changes every frame (a timer) is laid out again every
  frame. That's fine for a line or two; keep long paragraphs still.
- Plain text with none of this page's settings is drawn exactly as it
  always was.

## Reference

A Label has the same settings, methods and events, plus `valign`, `fit`
and `linkPressed(name)`: see [UI](ui.md#label).

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
