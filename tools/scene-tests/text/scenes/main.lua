-- Checks text: plain text is drawn as it always was, rich text, effects,
-- revealing, measuring and looking characters up, by drawing to a canvas
-- and reading pixels back. Prints PASS or FAIL for each check, then DONE
-- (tools/scene-tests/run.mjs reads them).

local nodes2d = require("love.scene.nodes2d")
local ui = require("love.scene.ui")
local g = smitten.graphics
local T = smitten.text

local W, H = 240, 140
local passed, failed = 0, 0
local canvas, stage
local steps = nil

local function pass(name)
  passed += 1
  print("PASS " .. name)
end

local function fail(name, why)
  failed += 1
  print("FAIL " .. name .. ": " .. tostring(why))
end

local function check(name, ok, why)
  if ok then pass(name) else fail(name, why or "not so") end
end

local function clear()
  for i = #stage.children, 1, -1 do stage.children[i]:remove() end
end

local function add(kind, props)
  return stage:add(make(kind, props))
end

-- Draws something to the canvas and returns its pixels.
local function shotOf(draw)
  g.push("all")
  g.setCanvas(canvas)
  g.setScissor()
  g.origin()
  g.clear(0, 0, 0, 1)
  g.setColor(1, 1, 1, 1)
  draw()
  g.pop()
  return g.readbackTexture(canvas)
end

local function world() return shotOf(function() nodes2d.render(stage) end) end
local function screen() return shotOf(function() ui.render(stage) end) end

local function lit(r, gr, b) return r > 0.35 or gr > 0.35 or b > 0.35 end

-- Where the pixels that pass a test are: { x0, y0, x1, y1, count } (x1, y1
-- are the last column and row), in a part of the picture if one is given.
local function ink(data, test, x0, y0, x1, y1)
  test = test or lit
  local out = { x0 = math.huge, y0 = math.huge, x1 = -1, y1 = -1, count = 0 }
  for y = math.max(0, math.floor(y0 or 0)), math.min(H - 1, math.ceil(y1 or H - 1)) do
    for x = math.max(0, math.floor(x0 or 0)), math.min(W - 1, math.ceil(x1 or W - 1)) do
      if test(data:getPixel(x, y)) then
        out.count += 1
        if x < out.x0 then out.x0 = x end
        if x > out.x1 then out.x1 = x end
        if y < out.y0 then out.y0 = y end
        if y > out.y1 then out.y1 = y end
      end
    end
  end
  out.w, out.h = out.x1 - out.x0 + 1, out.y1 - out.y0 + 1
  return out
end

-- How many pixels differ between two pictures.
local function differ(a, b)
  local n = 0
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local r1, g1, b1 = a:getPixel(x, y)
      local r2, g2, b2 = b:getPixel(x, y)
      if math.abs(r1 - r2) > 0.02 or math.abs(g1 - g2) > 0.02 or math.abs(b1 - b2) > 0.02 then n += 1 end
    end
  end
  return n
end

local function about(a, b, tolerance) return math.abs(a - b) <= (tolerance or 1) end

local function box(i) return ("%s,%s to %s,%s (%s lit)"):format(i.x0, i.y0, i.x1, i.y1, i.count) end

---------------------------------------------------------------------------

local function sameAsBefore()
  -- The same words through print (rich off) and through smitten.text (rich
  -- on) are the same pixels: the pixel font, then the default font.
  local cases = {
    { "pixel font", { text = "Hello, World", font = "pixel", size = 20, x = 120, y = 30 } },
    { "pixel font, wrapped and centered", { text = "The quick brown fox jumps over the lazy dog", font = "pixel", size = 10, x = 120, y = 10, wrap = 90, align = "center" } },
    { "pixel font, wrapped, right, with line breaks", { text = "one two three\n\nfour five six seven", font = "pixel", size = 10, x = 200, y = 10, wrap = 70, align = "right" } },
    { "default font", { text = "Hello, World! AVA Typography", size = 16, x = 120, y = 40 } },
    { "default font, wrapped", { text = "The quick brown fox jumps over the lazy dog, twice over.", size = 14, x = 20, y = 10, wrap = 150, align = "left" } },
    { "default font, two lines, left", { text = "Top line\nSecond", size = 18, x = 20, y = 40, align = "left" } },
  }
  for _, c in ipairs(cases) do
    clear()
    local t = add("Text", c[2])
    local before = world()
    local was = ink(before)
    t.rich = true
    local after = world()
    local n = differ(before, after)
    check("rich on, no tags, same pixels: " .. c[1], was.count > 40 and n == 0, ("%d pixels differ of %d lit"):format(n, was.count))
    -- And measure() agrees with what was drawn.
    t.rich = false
    local w, h = t:measure()
    check("measure() fits the drawn text: " .. c[1], about(w, was.w, 4) and h >= was.h - 1 and h <= was.h + c[2].size * 0.7 + 2,
      ("measured %.1f x %.1f, drew %d x %d"):format(w, h, was.w, was.h))
  end

  -- Labels: in their rectangle, with valign and the old thin outline.
  local labels = {
    { "label", { text = "Score: 1200", font = "pixel", size = 10, x = 10, y = 10, width = 120, height = 40 } },
    { "label, middle right", { text = "Lives left: 3", size = 16, x = 10, y = 10, width = 200, height = 80, align = "right", valign = "middle" } },
    { "label, wrapped, bottom center", { text = "A longer line of words that wraps in its box", font = "pixel", size = 10, x = 10, y = 10, width = 100, height = 100, align = "center", valign = "bottom" } },
  }
  for _, c in ipairs(labels) do
    clear()
    local l = add("Label", c[2])
    local before = screen()
    local was = ink(before)
    l.rich = true
    local n = differ(before, screen())
    check("rich on, no tags, same pixels: " .. c[1], was.count > 40 and n == 0, ("%d pixels differ of %d lit"):format(n, was.count))
  end
  clear()
  local b = add("Button", { text = "Play", font = "pixel", size = 10, x = 20, y = 20, width = 100, height = 30 })
  local before = screen()
  b.rich = true
  local n = differ(before, screen())
  check("rich on, no tags, same pixels: button", n == 0, n .. " pixels differ")

  -- write(): the same through both, and it says how big the text was.
  local w1, h1, w2, h2
  local plain = shotOf(function() w1, h1 = write("Written words", 20, 20, { font = "pixel", size = 10 }) end)
  local rich = shotOf(function() w2, h2 = write("Written words", 20, 20, { font = "pixel", size = 10, rich = true }) end)
  n = differ(plain, rich)
  local was = ink(plain)
  check("write() rich, no tags, same pixels", was.count > 40 and n == 0, n .. " pixels differ")
  check("write() returns its size", w1 == w2 and h1 == h2 and about(w1, was.w, 2) and about(h1, was.h, 3), ("%s x %s and %s x %s, drew %s"):format(w1, h1, w2, h2, box(was)))
  plain = shotOf(function() w1, h1 = write("Written words that wrap around", 120, 20, { font = "pixel", size = 10, width = 80, align = "center" }) end)
  rich = shotOf(function() w2, h2 = write("Written words that wrap around", 120, 20, { font = "pixel", size = 10, width = 80, align = "center", rich = true }) end)
  n = differ(plain, rich)
  was = ink(plain)
  check("write() wrapped and centered, same pixels", was.count > 40 and n == 0, n .. " pixels differ")
  check("write() wrapped returns its size", w1 == w2 and h1 == h2 and w1 <= 80 and about(h1, was.h, 3), ("%s x %s and %s x %s, drew %s"):format(w1, h1, w2, h2, box(was)))
end

local function richText()
  -- [color] colors the pixels of its part only.
  clear()
  local t = add("Text", { text = "[color=#ff0000]AAAA[/color]AAAA", rich = true, font = "pixel", size = 10, x = 20, y = 20, align = "left", wrap = 220 })
  local d = world()
  local red = ink(d, function(r, gr, b) return r > 0.9 and gr < 0.1 and b < 0.1 end)
  local white = ink(d, function(r, gr, b) return r > 0.9 and gr > 0.9 and b > 0.9 end)
  check("[color] colors its part", red.count > 20 and red.count == white.count and red.x1 < white.x0 and about(red.x0, 20) and about(white.x0, 44),
    "red " .. box(red) .. ", white " .. box(white))
  check("tags aren't characters", t:characterCount() == 8, t:characterCount())

  -- An unknown tag is shown as it's written.
  t.text = "[colour=red]A"
  check("an unknown tag is shown", t:characterCount() == 13, t:characterCount())
  t.text = "[[A]"
  check("[[ is a square bracket", t:characterCount() == 3, t:characterCount())

  -- [size] makes taller letters; [b] adds ink; [u] and [s] draw lines.
  t.text = "A"
  local smallPicture = world()
  local small = ink(smallPicture)
  t.text = "[size=20]A[/size]"
  local big = ink(world())
  check("[size] makes bigger letters", about(big.h, small.h * 2, 1) and about(big.w, small.w * 2, 1), "from " .. box(small) .. " to " .. box(big))
  t.text = "[size=+10]A[/size]"
  local big2 = ink(world())
  check("[size=+10] adds to the piece's size", big2.h == big.h and big2.w == big.w, box(big2))
  t.text = "[b]A[/b]"
  local bold = ink(world())
  check("[b] makes thicker letters", bold.count > small.count and bold.w == small.w + 1, "from " .. box(small) .. " to " .. box(bold))
  t.text = "[i]A[/i]"
  local italicPicture = world()
  local italic = ink(italicPicture)
  check("[i] slants", italic.count > 0 and differ(smallPicture, italicPicture) > 0, "from " .. box(small) .. " to " .. box(italic))
  t.text = "AAA"
  local three = ink(world())
  t.text = "[u]AAA[/u]"
  local under = ink(world())
  check("[u] underlines", under.y1 > three.y1 and under.count >= three.count + 15, "from " .. box(three) .. " to " .. box(under))
  t.text = "[s]AAA[/s]"
  local struck = ink(world())
  check("[s] strikes through", struck.y1 == three.y1 and struck.count > three.count, "from " .. box(three) .. " to " .. box(struck))

  -- Outline and shadow, as tags and as the piece's settings.
  local function isRed(r, gr, b) return r > 0.6 and gr < 0.2 and b < 0.2 end
  t.text = "[outline=1,#ff0000]A[/outline]"
  d = world()
  local line = ink(d, isRed)
  local fill = ink(d, function(r, gr, b) return r > 0.9 and gr > 0.9 and b > 0.9 end)
  check("[outline] draws around the letters", line.count > 10 and line.x0 == fill.x0 - 1 and line.y1 == fill.y1 + 1 and fill.count == small.count,
    "outline " .. box(line) .. ", letters " .. box(fill))
  t.text = "A"
  t.outline, t.outlineWidth, t.outlineColor = true, 2, { 1, 0, 0, 1 }
  d = world()
  line = ink(d, isRed)
  check("the outline setting", line.count > 20 and line.x0 == small.x0 - 2 and line.x1 == small.x1 + 2, "outline " .. box(line) .. ", letter " .. box(small))
  t.outline = false
  t.shadow, t.shadowColor, t.shadowX, t.shadowY = true, { 1, 0, 0, 1 }, 3, 4
  d = world()
  line = ink(d, isRed)
  check("the shadow setting", line.count > 5 and line.x1 == small.x1 + 3 and line.y1 == small.y1 + 4, "shadow " .. box(line) .. ", letter " .. box(small))
  t.shadow = false
  t.text = "[shadow=#ff0000 x=3 y=4]A[/shadow]"
  local line2 = ink(world(), isRed)
  check("[shadow]", line2.count == line.count and line2.x1 == line.x1 and line2.y1 == line.y1, box(line2))

  -- [img] puts a picture in the line, as tall as the letters.
  t.text = "A[img=art/coin.png]A"
  d = world()
  local green = ink(d, function(r, gr, b) return gr > 0.9 and r < 0.1 and b < 0.1 end)
  local x, y, w, h = t:characterRect(2)
  check("[img] draws a picture in the line", green.count >= 36 and green.w >= 6 and green.w <= 7 and green.h >= 6 and green.h <= 7 and about(green.x0, 20 + x, 1), "picture " .. box(green) .. (", rect %s %s %s %s"):format(x, y, w, h))
  check("the picture is a character", t:characterCount() == 3 and about(w, 7, 0.01))

  -- [center] and [right] line single lines up.
  t.text = "AAAAAAAAAA\n[right]A[/right]\n[center]A"
  t.wrap = 100
  d = world()
  local l2 = ink(d, nil, 0, 20 + 10, W, 20 + 19)
  local l3 = ink(d, nil, 0, 20 + 20, W, 20 + 29)
  check("[right] and [center] move a line", about(l2.x1, 119, 1) and about((l3.x0 + l3.x1) / 2, 69.5, 1.5), "second line " .. box(l2) .. ", third " .. box(l3))
  t.wrap = 220

  -- Mixed fonts and sizes share a baseline.
  t.text = "A[size=30]A[/size]"
  d = world()
  local a1 = ink(d, nil, 20, 0, 25, H)
  local a2 = ink(d, nil, 26, 0, 60, H)
  check("small and big letters stand on one line", a1.y1 == a2.y1 and a2.h == 21, "small " .. box(a1) .. ", big " .. box(a2))

  -- A Label and a Button read tags too.
  clear()
  local l = add("Label", { text = "[color=#ff0000]AA[/color]AA", rich = true, font = "pixel", size = 10, x = 10, y = 10, width = 100, height = 20 })
  d = screen()
  red = ink(d, isRed)
  check("a Label reads tags", red.count > 10 and about(red.x0, 10) and red.x1 < 22, box(red))
  clear()
  local b = add("Button", { text = "[color=#ff0000]Go[/color]", rich = true, font = "pixel", size = 10, x = 10, y = 10, width = 100, height = 30, color = { 0, 0, 0, 1 } })
  red = ink(screen(), isRed)
  check("a Button reads tags", red.count > 10 and about((red.x0 + red.x1) / 2, 59.5, 1.5), box(red))

  -- write() with tags.
  red = ink(shotOf(function() write("[color=#ff0000]AA[/color]", 30, 30, { font = "pixel", size = 10, rich = true }) end), isRed)
  check("write() reads tags", red.count > 10 and red.x0 == 30 and red.y0 == 30, box(red))
  local all = ink(shotOf(function() write("AAAA", 30, 30, { font = "pixel", size = 10, visible = 2 }) end))
  check("write() visible", all.x0 == 30 and all.x1 == 30 + 10, box(all))
end

local function layoutChecks()
  clear()
  -- visibleCharacters hides the rest: the same pixels as the shorter text.
  local t = add("Text", { text = "ABCDEF", font = "pixel", size = 10, x = 20, y = 20, align = "left", wrap = 220 })
  local full = ink(world())
  t.text = "AB"
  local ab = world()
  t.text = "ABCDEF"
  t.visibleCharacters = 2
  local two = world()
  check("visibleCharacters shows the first ones only", differ(ab, two) == 0 and ink(two).count < full.count, box(ink(two)))
  t.visibleCharacters = 0
  check("visibleCharacters = 0 shows nothing", ink(world()).count == 0)
  t.visibleCharacters = -1
  t.visibleRatio = 1 / 3
  check("visibleRatio shows a part", differ(ab, world()) == 0)
  t.visibleRatio = 1
  t.rich = true
  t.text = "[b][/b]AB[color=red]CDEF"
  t.visibleCharacters = 2
  check("tags don't count as characters", differ(ab, world()) == 0)
  t.rich, t.visibleCharacters, t.text = false, -1, "ABCDEF"

  -- measure() is the size of what's drawn.
  local w, h = t:measure()
  check("measure()", about(w, full.w, 1.01) and w >= full.w and about(h, full.h, 2.01), ("measured %s x %s, drew %s"):format(w, h, box(full)))
  check("lineCount() and characterCount()", t:lineCount() == 1 and t:characterCount() == 6)
  local mw, mh, lines = T.measure("ABCDEF", { font = "pixel", size = 10 })
  check("smitten.text.measure() says the same", mw == w and mh == h and lines == 1, ("%s x %s, %s lines"):format(mw, mh, lines))

  -- The wrap width is respected, by word and by character.
  t.text = "word word word word word word"
  t.wrap = 70
  local wrapped = ink(world())
  w, h = t:measure()
  check("lines wrap at the width", wrapped.w <= 70 and t:lineCount() == 3 and about(wrapped.x0, 20) and about(h, wrapped.h, 3), ("%s lines, %s"):format(t:lineCount(), box(wrapped)))
  local parts = T.wrap("word word word word word word", { font = "pixel", size = 10, width = 70 })
  check("smitten.text.wrap()", #parts == 3 and parts[1] == "word word" and parts[3] == "word word", table.concat(parts, "|"))
  t.text = "wordwordwordwordwordword"
  t.wrapBy = "character"
  wrapped = ink(world())
  check("wrapBy character", wrapped.w <= 70 and wrapped.w >= 60 and t:lineCount() == 3, ("%s lines, %s"):format(t:lineCount(), box(wrapped)))
  t.wrapBy = "word"

  -- Alignment moves the text.
  t.text = "AB"
  t.wrap, t.x = 100, 60
  t.align = "left"
  local left = ink(world())
  t.align = "center"
  local center = ink(world())
  t.align = "right"
  local right = ink(world())
  check("align moves the text", left.x0 == 60 and about(right.x1, 59, 1) and about((center.x0 + center.x1) / 2, 60, 1.5),
    "left " .. box(left) .. ", center " .. box(center) .. ", right " .. box(right))
  t.text = "aa bb cc dd ee ff gg"
  t.wrap, t.x, t.align = 80, 20, "left"
  local ragged = ink(world(), nil, 0, 20, W, 28)
  t.align = "justify"
  local justified = ink(world(), nil, 0, 20, W, 28)
  check("justify stretches wrapped lines to the width", ragged.x1 < 20 + 76 and about(justified.x1, 20 + 79, 1) and justified.x0 == 20, "ragged " .. box(ragged) .. ", justified " .. box(justified))
  t.align, t.wrap = "left", 220

  -- lineHeight and letterSpacing.
  t.text = "A\nA"
  local tight = ink(world())
  t.lineHeight = 2
  local loose = ink(world())
  check("lineHeight spreads lines", loose.h == tight.h + 10, "from " .. box(tight) .. " to " .. box(loose))
  t.lineHeight = 1
  t.text = "AAA"
  tight = ink(world())
  t.letterSpacing = 4
  loose = ink(world())
  check("letterSpacing spreads letters", loose.w == tight.w + 8, "from " .. box(tight) .. " to " .. box(loose))
  t.letterSpacing = 0

  -- characterRect lands on the character; characterAt finds it again.
  t.text = "A B\nC D"
  local d = world()
  local x, y, cw, ch = t:characterRect(6)
  local glyph = ink(d, nil, 20 + x, 20 + y, 20 + x + cw - 1, 20 + y + ch - 1)
  local gap = ink(d, nil, 20 + 6, 20, 20 + 11, 20 + 9)
  check("characterRect() is where the character is", x == 12 and y == 10 and cw == 6 and glyph.count > 10 and gap.count == 0,
    ("rect %s %s %s %s, lit there %d, in the space %d"):format(x, y, cw, ch, glyph.count, gap.count))
  check("characterAt() finds it", t:characterAt(x + 2, y + 3) == 6 and t:characterAt(2, 2) == 1 and t:characterAt(100, 0) == nil and t:characterAt(2, 40) == nil)

  -- Links: where they are, and a click on one in a Label.
  clear()
  local l = add("Label", { text = "go [link=shop]shop[/link] now", rich = true, font = "pixel", size = 10, x = 10, y = 50, width = 200, height = 20 })
  x, y, cw, ch = l:characterRect(5)
  check("linkAt()", l:linkAt(x + 2, y + 4) == "shop" and l:linkAt(2, 4) == nil and l:linkAt(x + 2, 60) == nil, tostring(l:linkAt(x + 2, y + 4)))

  -- fit = "shrink" makes text small enough for its box.
  clear()
  l = add("Label", { text = "Far too many words for this little box", font = "pixel", size = 20, x = 10, y = 10, width = 110, height = 24 })
  local over = ink(screen())
  l.fit = "shrink"
  local fits = ink(screen())
  w, h = l:measure()
  check("fit = shrink makes the text fit", over.y1 > 34 and fits.y1 <= 34 and fits.x1 <= 120 and h <= 24, "before " .. box(over) .. ", after " .. box(fits))

  -- strip() and escape().
  check("strip() and escape()", T.strip("[b]Hi[/b] [color=red]you[/color]") == "Hi you" and T.escape("[b]") == "[[b]" and T.strip(T.escape("[b]")) == "[b]")
end

local function effectChecks()
  clear()
  local t = add("Text", { text = "AAA", rich = true, font = "pixel", size = 10, x = 20, y = 40, align = "left", wrap = 220 })
  local still = ink(world())
  -- A custom effect moves one character.
  T.effect("lift", function(c)
    if c.index == 2 then c.y = c.y - (c.args.by or 5) end
  end)
  t.text = "[lift by=10]AAA[/lift]"
  local d = world()
  local moved = ink(d)
  local first = ink(d, nil, 20, 0, 25, H)
  local second = ink(d, nil, 26, 0, 31, H)
  check("a custom effect moves a character", moved.y0 == still.y0 - 10 and first.y0 == still.y0 and second.y0 == still.y0 - 10 and second.count == first.count,
    "still " .. box(still) .. ", first " .. box(first) .. ", second " .. box(second))
  -- What an effect is told.
  local seen = {}
  T.effect("spy", function(c)
    seen[#seen + 1] = { c.index, c.char, c.count, c.line, c.args.note, type(c.time), type(c.since), c.piece }
  end)
  t.text = "x[spy note=hi]yz[/spy]"
  world()
  check("an effect is told about each character", #seen == 2 and seen[1][1] == 2 and seen[1][2] == "y" and seen[2][2] == "z" and seen[1][3] == 3
    and seen[1][4] == 1 and seen[1][5] == "hi" and seen[1][6] == "number" and seen[1][7] == "number" and seen[1][8] == t, #seen)
  -- color, alpha, scale, visible.
  T.effect("paint", function(c)
    if c.index == 1 then c.color = { 1, 0, 0, 1 } elseif c.index == 2 then c.visible = false else c.scale = 2 end
  end)
  t.text = "[paint]AAA[/paint]"
  d = world()
  local red = ink(d, function(r, gr, b) return r > 0.9 and gr < 0.1 end)
  second = ink(d, nil, 26, 0, 31, H)
  local third = ink(d, function(r, gr, b) return r > 0.9 and gr > 0.9 end)
  check("an effect colors, hides and scales", red.count > 10 and red.x1 <= 25 and third.h == 14 and third.x0 >= 28, "red " .. box(red) .. ", second " .. box(second) .. ", third " .. box(third))
  -- The built-in ones do something.
  t.text = "[wave amp=6]AAAAAAAA[/wave]"
  local waved = ink(world())
  check("[wave] moves letters up and down", waved.h > still.h + 2, box(waved))
  t.text = "[rainbow]AAAAAAAA[/rainbow]"
  local colors = ink(world(), function(r, gr, b) return math.max(r, gr, b) - math.min(r, gr, b) > 0.3 end)
  check("[rainbow] colors letters", colors.count > 50, box(colors))
  -- The piece's own eachCharacter.
  t.text = "AAA"
  t.eachCharacter = function(self, c) c.x = c.x + 20 end
  local pushed = ink(world())
  check("eachCharacter moves every character", pushed.x0 == still.x0 + 20 and pushed.count == still.count, box(pushed))
  t.eachCharacter = nil
  local back = ink(world())
  check("and without it they're back", back.x0 == still.x0)
end

---------------------------------------------------------------------------
-- Checks that take time: they run over several frames.

local function waitFor(test, limit)
  local frames = 0
  while not test() do
    coroutine.yield()
    frames += 1
    if frames > (limit or 600) then return false end
  end
  return true
end

-- A Text that counts the time its reveal has had.
local function timed(str)
  local t = add("Text", { text = str, rich = true, font = "pixel", size = 10, x = 20, y = 100, align = "left" })
  t.elapsed, t.slowest = 0, 0
  t.update = function(self, dt)
    self.elapsed += dt
    if dt > self.slowest then self.slowest = dt end
  end
  return t
end

local function revealChecks()
  clear()
  -- Long enough that slow frames don't reach its end before skip() does.
  local t = timed(("abcdefghijklmnopqrstuvwxyz"):rep(8))
  local events = {}
  t:on("revealed", function(index, char) events[#events + 1] = char end)
  local finished = 0
  t:on("finished", function() finished += 1 end)
  local handle = t:reveal(20)
  check("reveal() starts with nothing showing", t.visibleCharacters == 0 and ink(world()).count == 0)
  waitFor(function() return t.elapsed >= 0.4 end)
  local want = math.floor(t.elapsed * 20 + 1e-6)
  check("reveal() shows characters as time passes", math.abs(t.visibleCharacters - want) <= 1 and #events == t.visibleCharacters and events[1] == "a" and events[3] == "c",
    ("%d showing after %.3f s, %d events"):format(t.visibleCharacters, t.elapsed, #events))
  local shown = ink(world())
  check("and they're the ones drawn", about(shown.w, math.min(t.visibleCharacters * 6, W - 20), 4), box(shown))

  -- It stops while the game is paused.
  pauseGame()
  coroutine.yield()
  local at, was = t.visibleCharacters, t.elapsed
  for _ = 1, 20 do coroutine.yield() end
  check("reveal() stops while the game is paused", t.visibleCharacters == at and t.elapsed == was, ("%d then %d"):format(at, t.visibleCharacters))
  resumeGame()
  waitFor(function() return t.elapsed >= was + 0.2 end)
  check("and goes on after", t.visibleCharacters > at and finished == 0, ("%d then %d"):format(at, t.visibleCharacters))

  -- skip() shows the rest.
  local done = false
  handle:after(function() done = true end)
  t:skip()
  check("skip() shows everything and finishes", t.visibleCharacters == -1 and finished == 1 and done and ink(world()).w > 150)

  -- [pause] holds it; finished comes at the end.
  clear()
  t = timed("ab[pause=0.8]cd")
  events, finished = {}, 0
  t:on("revealed", function(index, char) events[#events + 1] = char end)
  t:on("finished", function() finished += 1 end)
  t:reveal(20)
  waitFor(function() return t.elapsed >= 0.4 end)
  if t.elapsed < 0.85 then
    check("[pause] holds the reveal", t.visibleCharacters == 2 and finished == 0, ("%d showing after %.3f s"):format(t.visibleCharacters, t.elapsed))
  else
    pass("[pause] holds the reveal (the frames were too slow to look)")
  end
  local ok = waitFor(function() return finished > 0 end)
  check("and lets go: revealed for each character, then finished", ok and t.elapsed >= 0.89 and table.concat(events) == "abcd" and finished == 1 and t.visibleCharacters == -1,
    ("finished after %.3f s, events %s"):format(t.elapsed, table.concat(events)))

  -- A script's own revealed() can hold it with wait(), and [speed] changes the pace.
  clear()
  t = timed("a.[speed=200]bcdefghij")
  handle = t:reveal(20)
  t:on("revealed", function(index, char)
    if char == "." then handle:wait(0.5) end
  end)
  waitFor(function() return t.elapsed >= 0.3 end)
  if t.elapsed < 0.55 then
    check("wait() on the handle holds the next character", t.visibleCharacters == 2, ("%d showing after %.3f s"):format(t.visibleCharacters, t.elapsed))
  else
    pass("wait() on the handle holds the next character (the frames were too slow to look)")
  end
  ok = waitFor(function() return t.visibleCharacters == -1 end)
  check("[speed] hurries the rest", ok and t.elapsed < 0.1 + 0.5 + 9 / 200 + t.slowest + 0.05, ("done after %.3f s (slowest frame %.3f)"):format(t.elapsed, t.slowest))

  -- cancel() leaves it where it is.
  clear()
  t = timed(("abcdefghij"):rep(20))
  handle = t:reveal(20)
  waitFor(function() return t.visibleCharacters >= 2 end)
  handle:cancel()
  at = t.visibleCharacters
  for _ = 1, 10 do coroutine.yield() end
  check("cancel() stops it there", t.visibleCharacters == at and at >= 2 and at < 200 and not handle:isActive(), at)

  -- visibleRatio can be tweened.
  clear()
  t = timed("abcdefghij")
  t.visibleRatio = 0
  local finishedTween = false
  tween(t, 0.2, { visibleRatio = 1 }, "linear", function() finishedTween = true end)
  ok = waitFor(function() return finishedTween end)
  check("visibleRatio can be tweened", ok and t.visibleRatio == 1 and ink(world()).w >= 58)

  -- c.since counts from when a character was revealed.
  clear()
  t = timed("[age]" .. ("abcdefghij"):rep(20) .. "[/age]")
  local ages = {}
  T.effect("age", function(c) ages[c.index] = c.since end)
  t:reveal(20)
  waitFor(function() return t.visibleCharacters >= 6 end)
  ages = {}
  world()
  check("c.since is the time since a character appeared", ages[1] and ages[5] and ages[1] > ages[5] and ages[5] >= 0 and ages[t.visibleCharacters + 1] == nil,
    ("%s and %s"):format(tostring(ages[1]), tostring(ages[5])))

  -- A click on a [link] in a Label: linkPressed(name).
  clear()
  local l = add("Label", { text = "go [link=shop]shop[/link] now", rich = true, font = "pixel", size = 10, x = 10, y = 50, width = 200, height = 20 })
  local pressed = {}
  l:on("linkPressed", function(name) pressed[#pressed + 1] = name end)
  coroutine.yield()
  coroutine.yield()
  local x, y = l:characterRect(5)
  local scene = require("love.scene")
  scene._uiInput("pressed", 10 + x + 2, 50 + y + 4, 1)
  scene._uiInput("released", 10 + x + 2, 50 + y + 4, 1)
  scene._uiInput("pressed", 10 + 2, 50 + 4, 1)
  scene._uiInput("released", 10 + 2, 50 + 4, 1)
  check("a click on a link: linkPressed(name)", #pressed == 1 and pressed[1] == "shop", table.concat(pressed, ","))
  clear()
end

local function run(name, fn)
  local ok, err = pcall(fn)
  if not ok then fail(name .. " stopped", err) end
end

function update(dt)
  if steps == nil then
    stage = root():find("Stage")
    canvas = g.newCanvas(W, H, { dpiscale = 1 })
    run("same as before", sameAsBefore)
    run("rich text", richText)
    run("layout", layoutChecks)
    run("effects", effectChecks)
    steps = coroutine.create(revealChecks)
  end
  if steps ~= "done" then
    local ok, err = coroutine.resume(steps)
    if not ok then fail("the reveal checks stopped", err) end
    if not ok or coroutine.status(steps) == "dead" then
      steps = "done"
      print(`DONE {passed} passed, {failed} failed`)
    end
  end
end
