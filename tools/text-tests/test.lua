-- Tests for smitten.text's parser, layout and reveal under plain Lua 5.1,
-- with a made-up font whose characters are all the same width. From the
-- repository's root:
--
--   lua5.1 tools/text-tests/test.lua

local root = (arg and arg[0] or ""):match("^(.*)tools[/\\]text%-tests[/\\]") or ""
table.insert(package.loaders, 2, function(name)
	local dir, file = name:match("^love%.(%w+)%.?(%w*)$")
	if not dir then return nil end
	if file == "" then file = "init" end
	local path = root .. "love/src/modules/" .. dir .. "/" .. file .. ".lua"
	local f = io.open(path, "r")
	if not f then return "\n\tno file " .. path end
	f:close()
	return assert(loadfile(path))
end)

local text = require("love.text")

local passed, failed = 0, 0
local function check(name, ok, detail)
	if ok then
		passed = passed + 1
	else
		failed = failed + 1
		print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end
local function eq(name, got, want)
	check(name, got == want, ("got %s, wanted %s"):format(tostring(got), tostring(want)))
end
local function near(name, got, want, tol)
	check(name, type(got) == "number" and math.abs(got - want) <= (tol or 1e-6), ("got %s, wanted %s"):format(tostring(got), tostring(want)))
end

-- The made-up font: every character is half its size wide, lines are its
-- size high, the baseline is at 80%. SCALE font pixels make a game pixel.
local SCALE = 1
local made = {}
local warnings = {}
text._log = function(line) warnings[#warnings + 1] = line end
local now = 0
text._fonts.now = function() return now end
text._fonts.epoch = function() return SCALE end
text._fonts.get = function(path, size)
	local px = math.floor(size * SCALE + 0.5)
	local key = path .. "#" .. px
	local f = made[key]
	if not f then
		f = { path = path, px = px }
		function f:getWidth(s)
			local n = 0
			for _ in s:gmatch("[%z\1-\127\194-\244][\128-\191]*") do n = n + 1 end
			-- "AV" sits a pixel closer together, as kerning does.
			local _, pairs = s:gsub("AV", "")
			return n * self.px / 2 - pairs
		end
		function f:getHeight() return self.px end
		function f:getLineHeight() return 1 end
		function f:getBaseline() return self.px * 0.8 end
		made[key] = f
	end
	return f, px / size
end
text._fonts.picture = function(path, args)
	if path == "missing.png" then error("can't find the image \"missing.png\"") end
	return { image = path, quad = args.frame or 0, width = 8, height = 16 }
end

local function opts(o)
	o = o or {}
	return text._userOptions(o, {})
end
local function lay(str, o)
	return text._layout(text._parse(str, o and o.rich), opts(o))
end

-- Parsing ----------------------------------------------------------------

local d = text._parse("Hello [b]you[/b]", false)
eq("plain keeps brackets", d.n, 16)
eq("plain: no styles", d.st[8], d.st[1])

d = text._parse("Hello [b]you[/b]!", true)
eq("tags aren't characters", d.n, 10)
check("bold on the tagged part", d.st[7].bold == true and d.st[9].bold == true)
check("not bold before or after", not d.st[6].bold and not d.st[10].bold)
eq("after a tag closes, the style is the first one again", d.st[10], d.st[1])

d = text._parse("[b][i]x[/b]y[/i]z", true)
check("tags closed out of order", d.st[1].bold and d.st[1].italic and not d.st[2].bold and d.st[2].italic and not d.st[3].italic)

d = text._parse("[b]never closed", true)
check("an unclosed tag runs to the end", d.n == 12 and d.st[12].bold)

d = text._parse("a[/b]c", true)
eq("closing a tag that isn't open is shown", text.strip("a[/b]c"), "a[/b]c")

d = text._parse("[color=red]r[/color][color=#ff8800]o[/color][color=#f80c]s[/][color=nope]x", true)
check("a named color", d.st[1].color and math.abs(d.st[1].color[1] - 0.94) < 1e-9)
near("a hex color", d.st[2].color[2], 0x88 / 255)
near("a short hex color with alpha", d.st[3].color[4], 12 / 15)
eq("a color that isn't one is shown", text.strip("[color=nope]x"), "[color=nope]x")

warnings = {}
eq("an unknown tag is shown", text.strip("press [E] to open"), "press [E] to open")
check("and warned about", #warnings == 1 and warnings[1]:find("%[e%]") ~= nil, warnings[1])
text.strip("press [E] again")
eq("once", #warnings, 1)

eq("[[ is a bracket", text.strip("a [[b] c"), "a [b] c")
eq("escape", text.escape("a [b] c"), "a [[b] c")
eq("escape then strip", text.strip(text.escape("[b]x[/b] [")), "[b]x[/b] [")
eq("a lone bracket", text.strip("3 ] 2 [ 1"), "3 ] 2 [ 1")
eq("strip keeps lines", text.strip("[b]a[/b]\n\n[i]b[/i]\n"), "a\n\nb\n")

d = text._parse("[size=24]a[size=+4]b[/size][/size][size=+2]c[size=-1]d", true)
eq("size", d.st[1].size, 24)
eq("a size on top of a size", d.st[2].size, 28)
eq("a size on top of the piece's", d.st[3].sizeAdd, 2)
eq("two on top of each other", d.st[4].sizeAdd, 1)

d = text._parse("[outline]a[/outline][outline=#f00]b[/outline][outline=3]c[/outline][outline=2,#00f]d", true)
check("outline", d.st[1].outline == 1 and d.st[1].outlineColor[1] == 0)
check("outline color", d.st[2].outline == 1 and d.st[2].outlineColor[1] == 1)
check("outline width", d.st[3].outline == 3)
check("outline width and color", d.st[4].outline == 2 and d.st[4].outlineColor[3] == 1)

d = text._parse("[wave amp=4 freq=2]w[/wave][shake]s[/shake][wave][rainbow]x", true)
check("an effect and its settings", d.st[1].effects[1].name == "wave" and d.st[1].effects[1].args.amp == 4 and d.st[1].effects[1].args.freq == 2)
check("two effects at once", #d.st[3].effects == 2 and d.st[3].effects[2].name == "rainbow")
check("hasEffects", d.hasEffects == true)

d = text._parse("a[pause=0.5]b[speed=10]c[/speed]d[pause=1]", true)
eq("control tags aren't characters", d.n, 4)
check("pause before b", d.pause[2] == 0.5 and d.pause[5] == 1)
check("speed", d.st[3].speed == 10 and d.st[4].speed == nil)

d = text._parse("see [link=shop]the shop[/link] now", true)
check("link", d.st[5].link == "shop" and d.st[12].link == "shop" and d.st[13].link == nil and d.hasLinks)

d = text._parse("a\n\nb\r\nc\n", true)
check("line breaks aren't characters", d.n == 3 and d.brk[2] == 2 and d.brk[3] == 1 and d.brk[4] == 1)

d = text._parse("né 日本", true)
eq("characters, not bytes", d.n, 5)

d = text._parse("[img=art/coin.png] x [img=hero.sprite frame=2]", true)
check("pictures are characters", d.n == 5 and d.ch[1] == "" and d.st[1].img.path == "art/coin.png" and d.st[5].img.args.frame == 2)

-- A custom effect: registering one makes its tag work.
eq("before it's registered", text.strip("[bounce height=6]x[/bounce]"), "[bounce height=6]x[/bounce]")
text.effect("bounce", function(c) c.y = c.y - c.args.height end)
eq("after", text.strip("[bounce height=6]x[/bounce]"), "x")
check("effect() checks its name", not pcall(text.effect, "b", function() end) and not pcall(text.effect, "two words", function() end))

-- Layout -----------------------------------------------------------------
-- Size 16: every character is 8 wide, lines are 16 high.

local l = lay("Hello", { size = 16 })
eq("width", l.width, 40)
eq("height", l.height, 16)
eq("one line", l.lineCount, 1)
eq("positions", l.x[3], 16)

local w, h, lines = text.measure("Hello\nyou", { size = 16 })
check("measure", w == 40 and h == 32 and lines == 2, ("%s %s %s"):format(w, h, lines))
w, h, lines = text.measure("[b]Hello[/b]", { size = 16, rich = true })
eq("measure skips tags", w, 40)
w = text.measure("[b]Hello[/b]", { size = 16 })
eq("unless rich is off", w, 96)

-- Wrapping like the engine's own printf: at spaces, the spaces stay at
-- the end of the line and don't count.
l = lay("aaa bbb ccc", { size = 16, width = 50 })
eq("wraps at spaces", l.lineCount, 3)
eq("line width without its last space", l.lines[1].width, 24)
check("line ranges", l.lines[1].last == 4 and l.lines[2].first == 5)
l = lay("aaa bbb ccc", { size = 16, width = 56 })
eq("exactly fits", l.lineCount, 2)
l = lay("aaaaaaaaaa", { size = 16, width = 40 })
eq("a word too long is cut", l.lineCount, 2)
l = lay("aaaaaaaaaa", { size = 16, width = 4 })
eq("at least a character a line", l.lineCount, 10)
l = lay("aaa bbb ccc", { size = 16, width = 60, wrap = "none" })
eq("wrap none", l.lineCount, 1)
l = lay("aaa bbb ccc", { size = 16, width = 60, wrap = "character" })
check("wrap by character", l.lineCount == 2 and l.lines[1].last == 8, l.lines[1].last)
eq("wrap()", table.concat(text.wrap("aaa bbb ccc", { size = 16, width = 50 }), "|"), "aaa|bbb|ccc")
eq("wrap() strips tags", table.concat(text.wrap("[b]aaa[/b] bbb", { size = 16, width = 30, rich = true }), "|"), "aaa|bbb")

l = lay("a\n\nb", { size = 16 })
check("an empty line", l.lineCount == 3 and l.y[2] == 32 and l.height == 48)
eq("no characters", lay("", { size = 16 }).lineCount, 1)
eq("no characters: one line high", lay("", { size = 16 }).height, 16)
eq("a line break at the end adds nothing (like print)", lay("a\n", { size = 16 }).lineCount, 1)
eq("two add a line", lay("a\n\n", { size = 16 }).lineCount, 2)
eq("one at the start adds a line", lay("\na", { size = 16 }).lineCount, 2)

-- Alignment.
l = lay("ab\nabcd", { size = 16, width = 100, align = "center" })
check("center", l.x[1] == 42 and l.x[3] == 34, l.x[1])
l = lay("ab\nabcd", { size = 16, width = 100, align = "right" })
check("right", l.x[1] == 84 and l.x[3] == 68)
l = lay("ab\nabcd", { size = 16, align = "right" })
check("without a width, lines line up with the longest", l.x[1] == 16 and l.x[3] == 0)
local o = opts({ size = 16, align = "center" })
o.blockAlign = true
l = text._layout(text._parse("ab\nabcd", false), o)
check("blockAlign keeps them flush left", l.x[1] == 0 and l.x[3] == 0)
l = lay("[right]ab[/right]\nabcd\n[center]ab", { size = 16, width = 100, rich = true })
check("alignment tags, per line", l.x[1] == 84 and l.x[3] == 0 and l.x[7] == 42)
l = lay("aa bb cc dd", { size = 16, width = 70, align = "justify" })
check("justify spreads the words", l.lineCount == 2 and l.x[7] == 54 and l.x[4] == 27 and l.x[10] == 0, ("%s %s %s"):format(l.lineCount, l.x[7], l.x[4]))

-- Mixed sizes on a line: the tallest sets the line, baselines line up.
l = lay("a[size=32]B[/size]c\nd", { size = 16, rich = true })
eq("mixed widths", l.x[3], 24)
near("line height from the tallest", l.y[4], 32)
near("small text sits on the big text's baseline", l.y[1], 32 * 0.8 - 16 * 0.8)
eq("big text at the top", l.y[2], 0)
eq("total height", l.height, 48)
eq("runs", #l.runs, 4)
l = lay("aaa [size=32]BBB[/size] ccc", { size = 16, rich = true, width = 70 })
check("wrapping with mixed sizes", l.lineCount == 3 and l.line[5] == 2 and l.line[9] == 3 and l.y[9] == 48, ("%s %s"):format(l.lineCount, l.y[9]))

-- Line height, letter spacing, kerning, tabs.
l = lay("a\nb", { size = 16, lineHeight = 1.5 })
check("lineHeight", l.y[2] == 24 and l.height == 40)
l = lay("abc", { size = 16, letterSpacing = 2 })
check("letterSpacing", l.x[2] == 10 and l.x[3] == 20 and #l.runs == 3)
l = lay("AV", { size = 16 })
check("kerning inside a run", l.x[2] == 7 and #l.runs == 1)

-- Pictures in a line.
l = lay("a[img=coin.png]b", { size = 20, rich = true })
check("a picture as tall as the letters", l.w[2] == 8 and l.x[3] == 18 and l.y[2] == 0, ("%s %s %s"):format(l.w[2], l.x[3], l.y[2]))
warnings = {}
l = lay("a[img=missing.png]b", { size = 20, rich = true })
check("a missing picture takes no room and warns", l.w[2] == 0 and #warnings == 1)

-- Bold and italic: companion fonts when given, else faked.
l = lay("[b]a[/b][i]b[/i]", { size = 16, rich = true })
check("faked bold and italic", l.rs[1].bold == 1 and l.rs[2].slant ~= nil and l.rs[1].font.path == "")
l = lay("[b]a[/b][i]b[/i][font=x.ttf]c", { size = 16, rich = true, fontBold = "bold.ttf", fontItalic = "it.ttf" })
check("companion fonts", l.rs[1].font.path == "bold.ttf" and l.rs[1].bold == nil and l.rs[2].font.path == "it.ttf" and l.rs[2].slant == nil)
eq("[font]", l.rs[3].font.path, "x.ttf")

-- A scaled display: fonts are made bigger, measurements stay in game pixels.
SCALE = 1.5
l = lay("ab\nabcd", { size = 16, width = 100, align = "center" })
near("scaled: width in game pixels", l.width * l.s, 32)
near("scaled: centered in font pixels", l.x[1], math.floor((150 - 24) / 2))
w, h = text.measure("Hello", { size = 16 })
check("scaled measure", math.abs(w - 40) < 1e-9 and math.abs(h - 16) < 1e-9)
SCALE = 1

-- Text in one style is broken into lines by the font itself (the engine's
-- fonts have getWrap; this one cuts every line after 4 characters), and
-- its characters are only measured when asked for.
local realGet = text._fonts.get
text._fonts.get = function(path, size)
	local f, sc = realGet(path, size)
	if path == "wraps.ttf" and not f.getWrap then
		function f:getWrap(str, limit)
			self.asked = limit
			local out = {}
			for line in (str .. "\n"):gmatch("([^\n]*)\n") do
				repeat
					out[#out + 1] = line:sub(1, 4)
					line = line:sub(5)
				until line == ""
			end
			return 0, out
		end
	end
	return f, sc
end
l = lay("abcdefgh\nij ", { size = 16, font = "wraps.ttf", width = 64, align = "right" })
check("the font's own lines", l.lineCount == 3 and l.lines[2].first == 5 and l.lines[3].last == 11 and l.base.font.asked == 64, l.lineCount)
check("one run a line", #l.runs == 3 and l.runs[2].text == "efgh" and l.runs[3].x == 64 - 16 and l.runs[2].y == 16)
check("not measured until asked", l.x[6] == nil)
local rx, ry, rw = text._characterRect(l, 6)
check("measured when asked", rx == 40 and ry == 16 and rw == 8, rx)
eq("found again", text._characterAt(l, 41, 17), 6)
l = lay("[b]abcdefgh[/b]", { size = 16, font = "wraps.ttf", rich = true })
eq("one style all through counts too", #l.runs, 2)
l = lay("abcd[b]efgh[/b]", { size = 16, font = "wraps.ttf", rich = true })
eq("two styles: laid out here", #l.runs, 2)
check("and measured", l.x[6] == 40 and l.lineCount == 1)
text._fonts.get = realGet

-- Looking characters up.
l = lay("ab\ncd", { size = 16 })
local x, y, cw, chh = text._characterRect(l, 4)
check("characterRect", x == 8 and y == 16 and cw == 8 and chh == 16)
eq("characterRect past the end", text._characterRect(l, 5), nil)
eq("characterAt", text._characterAt(l, 9, 20), 4)
eq("characterAt outside", text._characterAt(l, 40, 20), nil)

-- States: nothing is done twice.
local st = text.state()
o = opts({ size = 16, rich = true, width = 100 })
local a = text._prepare(st, "[b]hi[/b] there", o)
check("the same text gives the same layout", text._prepare(st, "[b]hi[/b] there", o) == a)
local doc = st.doc
o.width = 50
local b = text._prepare(st, "[b]hi[/b] there", o)
check("a new width lays out again without parsing again", b ~= a and st.doc == doc and b.lineCount == 2)
check("a new text parses again", text._prepare(st, "x", o).n == 1 and st.doc ~= doc)

-- fit = "shrink".
st = text.state()
o = opts({ size = 16, width = 40 })
o.fitWidth, o.fitHeight = 40, 16
l = text._prepare(st, "Hello you", o)
check("shrinks until it fits", l.height * l.s <= 16.01 and l.width * l.s <= 40.01 and l.base.size < 16, l.base.size)
l = text._prepare(st, "Hi", o)
eq("doesn't shrink what fits", l.base.size, 16)

-- visibleCharacters and visibleRatio.
eq("all", text._visibleCount(10, -1, 1), 10)
eq("characters", text._visibleCount(10, 3, 1), 3)
eq("ratio", text._visibleCount(10, -1, 0.5), 5)
eq("ratio rounds down", text._visibleCount(3, -1, 0.5), 1)
eq("the smaller of the two", text._visibleCount(10, 8, 0.5), 5)
eq("more than there is", text._visibleCount(10, 99, 1), 10)

-- reveal() ---------------------------------------------------------------

local function piece(str)
	local p = { visibleCharacters = -1, visibleRatio = 1, events = {} }
	local st2, o2 = text.state(), opts({ size = 16, rich = true })
	function p:emit(name, ...)
		self.events[#self.events + 1] = { name, ... }
		if self["on_" .. name] then self["on_" .. name](self, ...) end
	end
	p.doc = function(self) return text._prepare(st2, self.text, o2).doc end
	p.text = str
	return p
end
local function onCharacter(q, i, c) q:emit("revealed", i, c) end
local function onFinished(q) q:emit("finished") end
local function reveal(p, speed) return text._reveal(p, speed, 0, p.doc, onCharacter, onFinished) end

local p = piece("abcd")
local hnd = reveal(p, 10)
eq("starts with nothing", p.visibleCharacters, 0)
text._advance(p, 0.05)
eq("not yet", p.visibleCharacters, 0)
text._advance(p, 0.05)
eq("one after a tenth of a second", p.visibleCharacters, 1)
text._advance(p, 0.25)
eq("time adds up", p.visibleCharacters, 3)
check("revealed(index, char)", #p.events == 3 and p.events[3][1] == "revealed" and p.events[3][2] == 3 and p.events[3][3] == "c")
local done = false
hnd:after(function() done = true end)
text._advance(p, 0.2)
check("finished", p.visibleCharacters == -1 and p.events[#p.events][1] == "finished" and done and not hnd:isActive() and p._reveal == nil)

p = piece("ab[pause=0.5]cd")
reveal(p, 10)
text._advance(p, 0.3)
eq("[pause] holds", p.visibleCharacters, 2)
text._advance(p, 0.35)
eq("still holding", p.visibleCharacters, 2)
text._advance(p, 0.06)
eq("the pause is over, the next character takes its usual time", p.visibleCharacters, 2)
text._advance(p, 0.1)
eq("then goes on", p.visibleCharacters, 3)

p = piece("ab[speed=100]cdefghij[/speed]kl")
reveal(p, 10)
text._advance(p, 0.2)
text._advance(p, 0.085)
eq("[speed] changes the pace", p.visibleCharacters, 10)

p = piece("a.b")
hnd = reveal(p, 10)
p.on_revealed = function(_, _, c) if c == "." then hnd:wait(1) end end
text._advance(p, 0.5)
eq("wait() from revealed", p.visibleCharacters, 2)
text._advance(p, 0.75)
eq("still waiting", p.visibleCharacters, 2)
text._advance(p, 0.1)
check("goes on after it", p.events[3] and p.events[3][2] == 3 and p.events[4][1] == "finished")

p = piece("abcdef")
hnd = reveal(p, 10)
text._advance(p, 0.25)
hnd:cancel()
text._advance(p, 1)
check("cancel() stops it there", p.visibleCharacters == 2 and p._reveal == nil)

p = piece("abcdef")
reveal(p, 10)
text._advance(p, 0.25)
text._skip(p)
check("skip() shows everything and finishes", p.visibleCharacters == -1 and p.events[#p.events][1] == "finished")
check("reveal() checks its speed", not pcall(text._reveal, p, 0, 0, p.doc) and not pcall(text._reveal, p, "fast", 0, p.doc))

-- The built-in effects change the character they're given.
local c = { x = 0, y = 0, rotation = 0, scale = 1, alpha = 1, color = { 1, 1, 1, 1 }, index = 2, time = 0.37, since = 0.1, args = {} }
d = text._parse("[wave]a[/wave][shake]a[/shake][rainbow]a[/rainbow][fade]a[/fade][pulse]a[/pulse]", true)
d.st[1].effects[1].fn(c)
check("wave moves it up and down", c.y ~= 0 and c.x == 0)
c.y = 0
d.st[2].effects[1].fn(c)
check("shake moves it about", c.x ~= 0 and c.y ~= 0 and math.abs(c.x) <= 1.5)
d.st[3].effects[1].fn(c)
check("rainbow colors it", not (c.color[1] == 1 and c.color[2] == 1 and c.color[3] == 1))
d.st[4].effects[1].fn(c)
near("fade", c.alpha, 1 / 3)
d.st[5].effects[1].fn(c)
check("pulse", c.scale ~= 1)

print(("%d passed, %d failed"):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
