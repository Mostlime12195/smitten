-- smitten.text: the text engine behind the Text piece, Label, Button and
-- write(): inline formatting ("rich text"), wrapping and alignment,
-- measuring, effects that move single characters, and revealing text a
-- character at a time. docs/text.md is the guide.
--
--   smitten.text.effect("bounce", function(c)        -- [bounce height=6]hi[/bounce]
--     c.y = c.y - math.abs(math.sin(c.time * 6 + c.index)) * (c.args.height or 4)
--   end)
--   local w, h, lines = smitten.text.measure("Some [b]words[/b]", { rich = true, size = 20, width = 200 })
--   local lines = smitten.text.wrap("A long sentence", { width = 120 })
--   smitten.text.strip("[b]hi[/b]")    --> "hi"
--   smitten.text.escape("[x]")         --> "[[x]"
--
-- How it works: a text is parsed once into a flat list of characters, each
-- with a style (parse), laid out once for a width and a font into lines and
-- runs (layout), and drawn from cached batches; only characters with an
-- effect are drawn one by one each frame. Nothing is parsed, measured or
-- allocated per frame for text that doesn't change.
--
-- Layout is done in the pixels of the piece's own font (the font is made at
-- the size it shows on screen, see love.assets.font), so plain text lands
-- exactly where the engine's own print puts it.
--
-- The parser and the layout use nothing of the engine but a font's
-- measurements, and are tested under plain Lua (tools/text-tests).

local text = {}

local floor, max, min, sin, abs, huge = math.floor, math.max, math.min, math.sin, math.abs, math.huge
local concat = table.concat
local type, tonumber, tostring, pairs, setmetatable = type, tonumber, tostring, pairs, setmetatable

---------------------------------------------------------------------------
-- Fonts: everything the engine is asked for goes through this table, so the
-- tests can stand in a fake font.

local fonts = {}
text._fonts = fonts

---A font at a size: the font, and how many of its pixels make one game pixel.
function fonts.get(path, size)
	return require("love.assets").font(path or "", size, require("love.scene.nodes2d").textScale)
end

---Changes when fonts made earlier are the wrong size for the screen.
function fonts.epoch()
	local dpi = love.graphics.getDPIScale and love.graphics.getDPIScale() or 1
	return require("love.scene.nodes2d").textScale * 4096 + dpi
end

---An inline picture: { image, quad, width, height } in the picture's pixels.
function fonts.picture(path, args)
	local assets = require("love.assets")
	local sheet
	if path:match("%.sprite$") then
		sheet = assets.sprite(path)
	else
		sheet = assets.sheet(path, tonumber(args.columns) or 1, tonumber(args.rows) or 1)
	end
	local frame = (floor(tonumber(args.frame) or 0) % sheet.frameCount) + 1
	return { image = sheet.image, quad = sheet.quads[frame], width = sheet.frameWidth, height = sheet.frameHeight }
end

function fonts.now()
	return love.timer.getTime()
end

-- Per font: the width of each character and the kerning of each pair, asked
-- for once.
local metrics = setmetatable({}, { __mode = "k" })

local function metricsOf(font, path)
	local m = metrics[font]
	if m then return m end
	local h = font:getHeight()
	local base
	if path == "pixel" then
		base = 7 -- the built-in pixel font: 7 rows above the line, 2 below
	else
		base = font.getBaseline and font:getBaseline() or 0
		if not base or base <= 0 then base = h end
	end
	m = { adv = {}, kern = {}, height = h, line = h * (font.getLineHeight and font:getLineHeight() or 1), baseline = base }
	metrics[font] = m
	return m
end

local function advance(font, m, ch)
	local a = m.adv[ch]
	if a == nil then
		a = font:getWidth(ch)
		m.adv[ch] = a
	end
	return a
end

---------------------------------------------------------------------------
-- Warnings, once each.

local warned = {}
local function warn(message)
	if warned[message] then return end
	warned[message] = true
	text._log("Warning: " .. message)
end
text._log = print

---------------------------------------------------------------------------
-- Colors

local COLORS = {
	white = { 1, 1, 1, 1 }, black = { 0, 0, 0, 1 }, gray = { 0.5, 0.5, 0.5, 1 }, grey = { 0.5, 0.5, 0.5, 1 },
	silver = { 0.75, 0.75, 0.78, 1 }, red = { 0.94, 0.27, 0.27, 1 }, orange = { 0.98, 0.57, 0.2, 1 },
	yellow = { 0.98, 0.84, 0.25, 1 }, gold = { 1, 0.8, 0.2, 1 }, green = { 0.3, 0.8, 0.4, 1 },
	lime = { 0.64, 0.9, 0.21, 1 }, teal = { 0.18, 0.72, 0.68, 1 }, cyan = { 0.3, 0.85, 0.95, 1 },
	blue = { 0.25, 0.47, 0.95, 1 }, navy = { 0.12, 0.16, 0.4, 1 }, purple = { 0.62, 0.36, 0.9, 1 },
	pink = { 0.96, 0.5, 0.75, 1 }, brown = { 0.55, 0.36, 0.22, 1 }, clear = { 0, 0, 0, 0 },
}
text.colors = COLORS

---A color from "#f80", "#ff8800", "#ff8800cc" or a name like "red": a table
---{r, g, b, a}, or nil if it isn't one.
local hexColors, hexColorCount = {}, 0

local function parseColor(v)
	if type(v) == "table" then return v end
	if type(v) ~= "string" then return nil end
	local known = hexColors[v] or COLORS[v] or COLORS[v:lower()]
	if known then return known end
	local hex = v:match("^#(%x+)$")
	if not hex then return nil end
	local n = #hex
	local out = nil
	if n == 3 or n == 4 then
		out = {}
		for i = 1, n do out[i] = tonumber(hex:sub(i, i), 16) / 15 end
	elseif n == 6 or n == 8 then
		out = {}
		for i = 1, n / 2 do out[i] = tonumber(hex:sub(i * 2 - 1, i * 2), 16) / 255 end
	end
	if not out then return nil end
	out[4] = out[4] or 1
	-- Remembered, so a color written as text costs nothing the next time.
	if hexColorCount >= 256 then hexColors, hexColorCount = {}, 0 end
	hexColors[v], hexColorCount = out, hexColorCount + 1
	return out
end
text.color = parseColor

---------------------------------------------------------------------------
-- Effects: functions that change one character at a time.

local effects = {}
local effectsVersion = 0

-- Tags that mean something on their own (the rest are effects).
local TAGS = {
	b = true, i = true, u = true, s = true, color = true, size = true, font = true, outline = true,
	shadow = true, center = true, right = true, left = true, link = true, speed = true,
	img = true, pause = true,
}

---Adds an effect, used in rich text as a tag with its name: after
---effect("bounce", fn), "[bounce height=6]boing[/bounce]" calls fn(c) for
---each character, every frame. c is one table used for every character
---(don't keep it): change c.x, c.y (moved by this many pixels), c.rotation,
---c.scale, c.color ({r, g, b, a}), c.alpha, c.visible; read c.index,
---c.count, c.char, c.line, c.time, c.since, c.args, c.piece.
function text.effect(name, fn)
	if type(name) ~= "string" or not name:match("^[%a_][%w_]*$") then
		error("effect() needs a name made of letters, like \"bounce\", and a function", 2)
	end
	name = name:lower()
	if fn ~= nil and type(fn) ~= "function" then
		error(("effect(%q, ...) needs a function that changes a character, not %s"):format(name, type(fn)), 2)
	end
	if TAGS[name] then
		error(("[%s] is already a tag of its own; give the effect another name"):format(name), 2)
	end
	effects[name] = fn
	effectsVersion = effectsVersion + 1
end

---The names of every effect, sorted.
function text.effects()
	local out = {}
	for name in pairs(effects) do out[#out + 1] = name end
	table.sort(out)
	return out
end

local TAU = math.pi * 2

effects.wave = function(c)
	local a = c.args
	c.y = c.y + sin(c.time * (a.freq or 1.5) * TAU + c.index * (a.spread or 0.5)) * (a.amp or 3)
end

-- A different small nudge for each character, a few times a second.
local function jitter(i, step, salt)
	local v = sin(i * 12.9898 + step * 78.233 + salt * 37.719) * 43758.5453
	return (v - floor(v)) * 2 - 1
end

effects.shake = function(c)
	local a = c.args
	local step = floor(c.time * (a.speed or 20))
	local amp = a.amp or 1.5
	c.x = c.x + jitter(c.index, step, 1) * amp
	c.y = c.y + jitter(c.index, step, 2) * amp
end

local function hue(h)
	h = (h - floor(h)) * 6
	local x = 1 - abs(h % 2 - 1)
	if h < 1 then return 1, x, 0 elseif h < 2 then return x, 1, 0 elseif h < 3 then return 0, 1, x
	elseif h < 4 then return 0, x, 1 elseif h < 5 then return x, 0, 1 end
	return 1, 0, x
end

effects.rainbow = function(c)
	local a = c.args
	local r, g, b = hue(c.time * (a.speed or 0.5) + c.index * (a.spread or 0.06))
	local soft = 1 - (a.sat or 0.75)
	local col = c.color
	col[1], col[2], col[3] = r + (1 - r) * soft, g + (1 - g) * soft, b + (1 - b) * soft
end

-- Fades each character in when it's revealed.
effects.fade = function(c)
	local t = c.since / (c.args.time or 0.3)
	if t < 1 then c.alpha = c.alpha * max(0, t) end
end

effects.pulse = function(c)
	local a = c.args
	c.scale = c.scale * (1 + sin(c.time * (a.freq or 1) * TAU) * (a.amp or 0.15))
end

---------------------------------------------------------------------------
-- Parsing: text -> characters with styles.
--
-- A doc is { n, ch = {}, st = {}, brk = {}, pause = {} }: ch[i] is the
-- i-th character ("" for an inline picture), st[i] its style (styles are
-- shared between characters and never change), brk[i] the number of line
-- breaks before it (brk[n + 1]: at the end), pause[i] the seconds [pause]
-- asks for before it. Line breaks aren't characters.

local UTF8 = "[%z\1-\127\194-\244][\128-\191]*"

local ROOT = {}

local function fold(stack)
	if #stack == 0 then return ROOT end
	local s = {}
	for i = 1, #stack do
		local e = stack[i]
		for k, v in pairs(e.set) do
			if k == "size" then
				if type(v) == "string" then
					-- "+4" or "-2": on top of the size around it.
					if s.size then s.size = s.size + tonumber(v) else s.sizeAdd = (s.sizeAdd or 0) + tonumber(v) end
				else
					s.size, s.sizeAdd = v, nil
				end
			elseif k == "effect" then
				local list = {}
				if s.effects then
					for j = 1, #s.effects do list[j] = s.effects[j] end
				end
				list[#list + 1] = v
				s.effects = list
			else
				s[k] = v
			end
		end
	end
	return s
end

local function value(v)
	if v == "true" then return true end
	if v == "false" then return false end
	return tonumber(v) or v
end

-- "=red amp=4 freq=2" -> { [1] = "red", value = "red", amp = 4, freq = 2 }, or
-- nil if it isn't written like that.
local function parseArgs(rest)
	local args = {}
	local pos = 1
	if rest:sub(1, 1) == "=" then
		local v, e = rest:match('^="([^"]*)"()', 1)
		if not v then v, e = rest:match("^=(%S*)()", 1) end
		args[1] = value(v)
		args.value = args[1]
		pos = e
	end
	while pos <= #rest do
		local s, e, k, v = rest:find('^%s+([%a_][%w_]*)="([^"]*)"', pos)
		if not s then s, e, k, v = rest:find("^%s+([%a_][%w_]*)=(%S+)", pos) end
		if not s then
			if rest:find("^%s*$", pos) then break end
			return nil
		end
		args[k] = value(v)
		pos = e + 1
	end
	return args
end

-- What a tag sets on the style: a table of fields, false if the tag is
-- written wrong, or nil if it isn't a tag at all.
local function tagStyle(name, args)
	local v = args[1]
	if name == "b" then return { bold = true }
	elseif name == "i" then return { italic = true }
	elseif name == "u" then return { underline = true }
	elseif name == "s" then return { strike = true }
	elseif name == "center" or name == "right" or name == "left" then return { align = name }
	elseif name == "color" then
		local c = parseColor(v)
		if not c then return false end
		return { color = c }
	elseif name == "size" then
		if type(v) ~= "number" then return false end
		local raw = tostring(args.raw or "")
		if raw:sub(1, 1) == "+" or raw:sub(1, 1) == "-" then return { size = raw } end
		if v <= 0 then return false end
		return { size = v }
	elseif name == "font" then
		if type(v) ~= "string" or v == "" then return false end
		return { font = v }
	elseif name == "outline" then
		-- [outline], [outline=#000], [outline=2], [outline=2,#000]
		local width, color = 1, COLORS.black
		if v ~= nil then
			local a, b = tostring(v):match("^([^,]*),?(.*)$")
			if tonumber(a) then
				width = tonumber(a)
				if b ~= "" then color = parseColor(b) end
			else
				color = parseColor(a)
			end
			if not color then return false end
		end
		if args.color then color = parseColor(args.color) or color end
		if type(args.width) == "number" then width = args.width end
		return { outline = width, outlineColor = color }
	elseif name == "shadow" then
		local color = nil
		if v ~= nil then
			color = parseColor(v)
			if not color then return false end
		end
		if args.color then color = parseColor(args.color) or color end
		return { shadow = true, shadowColor = color, shadowX = tonumber(args.x), shadowY = tonumber(args.y) }
	elseif name == "link" then
		if v == nil then return false end
		return { link = tostring(v) }
	elseif name == "speed" then
		if type(v) ~= "number" or v <= 0 then return false end
		return { speed = v }
	end
	local fn = effects[name]
	if fn then return { effect = { fn = fn, args = args, name = name } } end
	return nil
end

local function unknownTag(name)
	local names = {}
	for n in pairs(TAGS) do names[#names + 1] = n end
	for n in pairs(effects) do names[#names + 1] = n end
	local hint = ""
	local ok, util = pcall(require, "love.engine.util")
	if ok and util and util.didYouMean then hint = util.didYouMean(name, names) end
	warn(("rich text has no tag called [%s]%s; it's shown as it's written. (For a real square bracket, type [[)"):format(name, hint))
end

local function parse(str, rich)
	local ch, st, brk = {}, {}, {}
	-- oneStyle: every character looks the same (no tag changes anything).
	local doc = { n = 0, ch = ch, st = st, brk = brk, rich = rich == true, oneStyle = true }
	local n, pendingBreaks, pendingPause = 0, 0, 0
	local stack = {}
	local style = ROOT

	local function put(c, s)
		n = n + 1
		ch[n], st[n] = c, s
		if s ~= st[1] or s.img then doc.oneStyle = false end
		if pendingBreaks > 0 then
			brk[n] = pendingBreaks
			pendingBreaks = 0
		end
		if pendingPause > 0 then
			doc.pause = doc.pause or {}
			doc.pause[n] = pendingPause
			pendingPause = 0
		end
	end

	local function literal(s)
		for c in s:gmatch(UTF8) do
			if c == "\n" then
				pendingBreaks = pendingBreaks + 1
			elseif c ~= "\r" then
				put(c, style)
			end
		end
	end

	local function tag(body)
		if body:sub(1, 1) == "/" then
			local name = body:sub(2):lower()
			if name == "" then
				if #stack == 0 then return false end
				stack[#stack] = nil
			else
				local at = nil
				for i = #stack, 1, -1 do
					if stack[i].name == name then
						at = i
						break
					end
				end
				if not at then return false end
				table.remove(stack, at)
			end
			style = fold(stack)
			return true
		end
		local name, rest = body:match("^([%a_][%w_]*)(.*)$")
		if not name then return false end
		name = name:lower()
		if rest ~= "" and not rest:match("^[=%s]") then return false end
		local args = parseArgs(rest)
		if not args then
			if TAGS[name] or effects[name] then
				warn(("the tag [%s] isn't written the way rich text understands; it's shown as it's written"):format(body))
			end
			return false
		end
		args.raw = rest:match('^="?([^%s"]*)')
		if name == "img" then
			if type(args[1]) ~= "string" then return false end
			local s = {}
			for k, v in pairs(style) do s[k] = v end
			s.img = { path = args[1], args = args }
			put("", s)
			doc.hasPictures = true
			return true
		elseif name == "pause" then
			if type(args[1]) ~= "number" then return false end
			pendingPause = pendingPause + max(0, args[1])
			return true
		end
		local set = tagStyle(name, args)
		if set == nil then
			unknownTag(name)
			return false
		elseif set == false then
			warn(("the tag [%s] isn't written the way rich text understands; it's shown as it's written"):format(body))
			return false
		end
		stack[#stack + 1] = { name = name, set = set }
		style = fold(stack)
		if set.effect then doc.hasEffects = true end
		if set.link then doc.hasLinks = true end
		return true
	end

	if not rich then
		literal(str)
	else
		local pos, len = 1, #str
		while pos <= len do
			local s = str:find("[", pos, true)
			if not s then
				literal(str:sub(pos))
				break
			end
			if s > pos then literal(str:sub(pos, s - 1)) end
			if str:sub(s + 1, s + 1) == "[" then
				put("[", style)
				pos = s + 2
			else
				local e = str:find("]", s + 1, true)
				local nextOpen = str:find("[", s + 1, true)
				if e and (not nextOpen or nextOpen > e) and tag(str:sub(s + 1, e - 1)) then
					pos = e + 1
				else
					put("[", style)
					pos = s + 1
				end
			end
		end
	end
	doc.n = n
	if pendingBreaks > 0 then brk[n + 1] = pendingBreaks end
	if pendingPause > 0 then
		doc.pause = doc.pause or {}
		doc.pause[n + 1] = pendingPause
	end
	return doc
end
text._parse = parse

local function plainOf(doc)
	if doc.plain then return doc.plain end
	local out = {}
	local ch, brk = doc.ch, doc.brk
	for i = 1, doc.n do
		local b = brk[i]
		if b then out[#out + 1] = ("\n"):rep(b) end
		out[#out + 1] = ch[i]
	end
	if brk[doc.n + 1] then out[#out + 1] = ("\n"):rep(brk[doc.n + 1]) end
	doc.plain = concat(out)
	return doc.plain
end

---The text without its tags: strip("[b]Hi[/b] there") is "Hi there".
function text.strip(str)
	return plainOf(parse(tostring(str), true))
end

---Makes any text safe to put inside rich text: square brackets are shown
---instead of being read as tags. escape(playerName).
function text.escape(str)
	return (tostring(str):gsub("%[", "[["))
end

---------------------------------------------------------------------------
-- Layout: characters -> positions, lines and runs.
--
-- Everything in a layout is measured in the pixels of the base font (the
-- piece's font at its size); lay.s turns them into game pixels.

local FAUX_SLANT = 0.2

local function isSpace(c)
	return c == " " or c == "\t"
end

-- A style, with the fonts of this layout: { font, k, m, height, line,
-- baseline, bold, slant }. k: this font's pixels to base pixels.
local function resolve(style, o, baseSc, cache)
	local rs = cache[style]
	if rs then return rs end
	local size = style.size or (o.size + (style.sizeAdd or 0))
	size = max(1, size * (o.sizeScale or 1))
	local path = style.font or o.font or ""
	local fauxBold, slant = false, false
	if style.bold then
		if not style.font and o.fontBold and o.fontBold ~= "" then path = o.fontBold else fauxBold = true end
	end
	if style.italic then
		if not style.font and not (style.bold and not fauxBold) and o.fontItalic and o.fontItalic ~= "" then
			path = o.fontItalic
		else
			slant = true
		end
	end
	local font, sc = fonts.get(path, size)
	local m = metricsOf(font, path)
	local k = (baseSc or sc) / sc
	rs = {
		font = font, k = k, m = m, size = size, path = path,
		height = m.height * k, line = m.line * k, baseline = m.baseline * k,
		bold = fauxBold and max(1, floor(size * sc / 14 + 0.5)) or nil, -- in this font's pixels
		slant = slant and FAUX_SLANT or nil,
		sc = sc,
	}
	if style.img then
		local ok, pic = pcall(fonts.picture, style.img.path, style.img.args)
		if ok then
			local a = style.img.args
			local h = (tonumber(a.height) and a.height * (baseSc or sc)) or rs.baseline
			local w = (tonumber(a.width) and a.width * (baseSc or sc)) or (pic.width * h / pic.height)
			if tonumber(a.width) and not tonumber(a.height) then h = pic.height * w / pic.width end
			rs.picture, rs.pictureWidth, rs.pictureHeight = pic, w, h
		else
			warn(tostring(pic))
			rs.pictureWidth, rs.pictureHeight = 0, 0
		end
	end
	cache[style] = rs
	return rs
end
local function utf8len(s)
	local n = 0
	for _ in s:gmatch(UTF8) do n = n + 1 end
	return n
end

-- Where the characters of a line are, left to right. A character's place
-- is what the font says the text up to it measures, so kerning and
-- anything else the font does between letters is counted. Lines of one
-- style are only measured like this when somebody asks (see positions()).
local function measureLine(lay, l)
	local ch, gx, gw = lay.doc.ch, lay.x, lay.w
	local rs = lay.rs[l.first]
	local font, m, k = rs.font, rs.m, rs.k
	local first = l.first
	for i = first, l.last do
		local a = advance(font, m, ch[i])
		local e = i == first and a or font:getWidth(concat(ch, "", first, i))
		gx[i], gw[i] = l.x + (e - a) * k, a * k
	end
	l.measured = true
end

---Makes sure the x and width of a line's characters are worked out.
local function positions(lay, li)
	local l = lay.lines[li]
	if l and not l.measured then measureLine(lay, l) end
end

---Lays a parsed text out. o: font, fontBold, fontItalic, size, width (the
---box: lines wrap to it and line up in it; nil for none), wrapMode ("word",
---"character", "none"), align, lineHeight, letterSpacing, sizeScale,
---blockAlign (without a width, keep lines flush left as print does).
local function layout(doc, o)
	local n = doc.n
	local ch, st, brk = doc.ch, doc.st, doc.brk
	local cache = {}
	local base = resolve(ROOT, o, nil, cache)
	local baseSc = base.sc
	local lay = {
		doc = doc, s = 1 / baseSc, base = base, n = n,
		x = {}, y = {}, w = {}, line = {}, rs = {},
		lines = {}, runs = {}, width = 0, height = 0,
	}
	local gx, gy, gw, gl, grs = lay.x, lay.y, lay.w, lay.line, lay.rs
	local gstart = {}
	local lines = lay.lines
	local runs = lay.runs
	local mode = o.wrapMode or "word"
	local limit = (o.width and mode ~= "none") and o.width * baseSc or nil
	local spacing = (o.letterSpacing or 0) * baseSc
	local lineMul = o.lineHeight or 1
	local justify = o.align == "justify"

	local y = 0
	local count = 0
	local lastHeight = base.height

	local function closeLine(first, last, width, soft)
		count = count + 1
		local lh, lbase, lfont = 0, 0, 0
		for j = first, last do
			local rs = grs[j]
			if rs.line > lh then lh = rs.line end
			if rs.baseline > lbase then lbase = rs.baseline end
			if rs.height > lfont then lfont = rs.height end
			local ph = rs.pictureHeight
			if ph and ph > lbase then lbase = ph end
		end
		if last < first then lh, lbase, lfont = base.line, base.baseline, base.height end
		if lfont < lbase then lfont = lbase end
		if lh < lfont then lh = lfont end
		lh = lh * lineMul
		local top = floor(y + 0.5)
		for j = first, last do
			local rs = grs[j]
			gl[j] = count
			gy[j] = top + (lbase - (rs.pictureHeight or rs.baseline))
		end
		local l = { first = first, last = last, y = top, height = lh, baseline = lbase, width = width, soft = soft, x = 0 }
		lines[count] = l
		lastHeight = lfont
		y = y + lh
		if width > lay.width then lay.width = width end
		return l
	end

	-- Text in one style: the font itself breaks it into lines (exactly as
	-- printf would), and each line is one run.
	local simple = false
	if doc.oneStyle and n > 0 and spacing == 0 and mode ~= "character" and not justify then
		local rs = resolve(st[1], o, baseSc, cache)
		local font = rs.font
		if font.getWrap then
			local _, wrapped = font:getWrap(plainOf(doc), limit and limit / rs.k or 1e9)
			local total, ascii = 0, not plainOf(doc):find("[\128-\255]")
			for i = 1, #wrapped do total = total + (ascii and #wrapped[i] or utf8len(wrapped[i])) end
			if total == n then
				simple = true
				for i = 1, n do grs[i] = rs end
				local at = 1
				for i = 1, #wrapped do
					local str = wrapped[i]
					local len = ascii and #str or utf8len(str)
					local inked = str:match("^(.-)[ \t]*$")
					local width = (inked == "" and 0 or font:getWidth(inked)) * rs.k
					local l = closeLine(at, at + len - 1, width, false)
					l.text = str
					at = at + len
				end
			end
		end
	end

	if not simple then
		local i = 1
		while i <= n or count == 0 do
			local hard = brk[i]
			if hard and i <= n then
				-- brk[i] line breaks before character i: the first ends the line
				-- before (already closed), the others are empty lines.
				for _ = 1, hard - (count > 0 and 1 or 0) do closeLine(i, i - 1, 0, false) end
			end
			if i > n then
				if count == 0 then closeLine(1, 0, 0, false) end
				break
			end
			local first = i
			local pen, out, beforeSpace = 0, 0, 0
			local afterSpace = nil
			local prevSpace, prevPicture = false, false
			local runFirst, runBase = i, 0
			local soft = false
			while i <= n do
				if i > first and brk[i] then break end
				local c = ch[i]
				local rs = resolve(st[i], o, baseSc, cache)
				grs[i] = rs
				local picture = rs.pictureWidth ~= nil
				-- A new run: another style, a picture, or letters spaced apart.
				if i == first or st[i] ~= st[i - 1] or picture or prevPicture or spacing ~= 0 then
					runFirst, runBase = i, pen
					gstart[i] = true
				else
					gstart[i] = nil
				end
				local a, e
				if picture then
					a = rs.pictureWidth
					e = runBase + a
				else
					a = advance(rs.font, rs.m, c) * rs.k
					if runFirst == i then
						e = runBase + a
					else
						-- What the font says the run measures up to here.
						e = runBase + rs.font:getWidth(concat(ch, "", runFirst, i)) * rs.k
					end
				end
				local x = e - a
				local space = isSpace(c)
				if space then
					if not prevSpace then beforeSpace = pen end
				else
					if prevSpace then afterSpace = i end
					if limit and e > limit then
						local at = i > first and i or first + 1
						if mode == "word" and afterSpace then
							at = afterSpace
							out = beforeSpace
						elseif at > i then
							gx[i], gw[i] = x, a
							out = e
						end
						i = at
						soft = true
						break
					end
					out = e
				end
				gx[i], gw[i] = x, a
				pen = e + spacing
				prevSpace, prevPicture = space, picture
				i = i + 1
			end
			local l = closeLine(first, i - 1, out, soft and i <= n)
			l.measured = true
		end
		-- Line breaks at the very end add empty lines.
		if brk[n + 1] and n > 0 then
			-- (the first one only ends the last line, as it does for print)
			for _ = 2, brk[n + 1] do closeLine(n + 1, n, 0, false) end
		elseif brk[n + 1] and n == 0 then
			for _ = 2, brk[n + 1] do closeLine(1, 0, 0, false) end
		end
	end

	-- The last line doesn't count the gap under it.
	local last = lines[count]
	lay.height = last.y + (last.last >= last.first and lastHeight or base.height)
	lay.lineCount = count
	-- print's own idea of the height (what Label centers by): every line as
	-- high as the font, when they're all the piece's font.
	local uniform = lineMul == 1
	for li = 1, count do
		if lines[li].height ~= base.line then uniform = false end
	end
	lay.boxHeight = uniform and count * base.height or lay.height

	-- Lining lines up in the box.
	local box = o.width and o.width * baseSc or lay.width
	lay.box = box
	local blockAlign = o.blockAlign and not o.width
	for li = 1, count do
		local l = lines[li]
		local a = (l.last >= l.first and st[l.first].align) or (blockAlign and "left") or o.align or "left"
		local off = 0
		if a == "center" then
			off = floor((box - l.width) / 2)
		elseif a == "right" then
			off = floor(box - l.width)
		elseif a == "justify" and justify and l.soft and limit then
			-- Share what's left of the line between its spaces.
			local spaces, lastInk = 0, l.first - 1
			for j = l.last, l.first, -1 do
				if not isSpace(ch[j]) then
					lastInk = j
					break
				end
			end
			for j = l.first, lastInk do
				if ch[j] == " " then spaces = spaces + 1 end
			end
			if spaces > 0 then
				local extra = (limit - l.width) / spaces
				local shift = 0
				for j = l.first, l.last do
					gx[j] = gx[j] + floor(shift + 0.5)
					if shift > 0 and j > l.first and ch[j - 1] == " " then gstart[j] = true end
					if ch[j] == " " and j < lastInk then shift = shift + extra end
				end
				l.width = limit
			end
		end
		l.x = off
		if off ~= 0 and l.measured then
			for j = l.first, l.last do gx[j] = gx[j] + off end
		end
	end

	-- Runs: characters next to each other in one style, drawn as one string.
	for li = 1, count do
		local l = lines[li]
		if l.last >= l.first then
			if not l.measured then
				runs[#runs + 1] = { first = l.first, last = l.last, style = st[l.first], rs = grs[l.first], line = li,
					x = l.x, y = gy[l.first], text = l.text }
			else
				local r = nil
				for j = l.first, l.last do
					if r == nil or gstart[j] or st[j] ~= r.style then
						r = { first = j, last = j, style = st[j], rs = grs[j], line = li, x = gx[j], y = gy[j] }
						runs[#runs + 1] = r
					else
						r.last = j
					end
				end
			end
		end
	end
	return lay
end
text._layout = layout

---------------------------------------------------------------------------
-- States: a text with its parse and layout, kept until something changes.

local KEYS = { "rich", "font", "fontBold", "fontItalic", "size", "width", "wrapMode", "align", "lineHeight",
	"letterSpacing", "blockAlign", "fitWidth", "fitHeight" }
local NKEYS = #KEYS

---A fresh state: one per piece.
function text.state()
	return { key = {}, o = {} }
end

local function fresh(st, str, o)
	if st.str ~= str or st.epoch ~= fonts.epoch() then return false end
	if st.doc.rich and st.effectsVersion ~= effectsVersion then return false end
	local key = st.key
	for i = 1, NKEYS do
		local k = KEYS[i]
		if key[k] ~= o[k] then return false end
	end
	return true
end

local MIN_FIT_SIZE = 4

---The layout of a text with these options, from the state when nothing
---changed.
local function prepare(st, str, o)
	if st.lay and fresh(st, str, o) then return st.lay end
	local reparse = st.str ~= str or st.docRich ~= (o.rich == true) or st.effectsVersion ~= effectsVersion
	if reparse or not st.doc then
		st.doc = parse(str, o.rich)
		st.docRich = o.rich == true
	end
	st.str = str
	st.epoch = fonts.epoch()
	st.effectsVersion = effectsVersion
	local key = st.key
	for i = 1, NKEYS do
		local k = KEYS[i]
		key[k] = o[k]
	end
	o.sizeScale = 1
	local lay = layout(st.doc, o)
	-- fit = "shrink": smaller, a step at a time, until it's inside the box.
	if o.fitWidth or o.fitHeight then
		local fw, fh = o.fitWidth or huge, o.fitHeight or huge
		local scale = 1
		while (lay.width * lay.s > fw + 0.01 or lay.height * lay.s > fh + 0.01) and o.size * scale > MIN_FIT_SIZE do
			scale = scale * 0.92
			o.sizeScale = scale
			lay = layout(st.doc, o)
		end
		o.sizeScale = 1
	end
	st.lay = lay
	st.built = nil
	if reparse or not st.t0 then
		-- A new text: its characters appear now.
		st.shown, st.at = nil, nil
		st.t0 = fonts.now()
	end
	return lay
end
text._prepare = prepare

-- States for write() and measure(), found by their text.
local byText, byTextCount = {}, 0
local BY_TEXT_LIMIT = 256

local function cached(str, o)
	local list = byText[str]
	if list then
		for i = 1, #list do
			local st = list[i]
			if fresh(st, str, o) then return st, st.lay end
		end
	else
		if byTextCount >= BY_TEXT_LIMIT then byText, byTextCount = {}, 0 end
		list = {}
		byText[str] = list
		byTextCount = byTextCount + 1
	end
	local st = text.state()
	if #list >= 4 then list[1] = st else list[#list + 1] = st end
	return st, prepare(st, str, o)
end
text._cached = cached

local scratch = {}

-- The options people pass to measure(), wrap() and write(), as the
-- layout's.
local function userOptions(o, into)
	into = into or scratch
	into.rich = o.rich == true
	into.font = o.font or ""
	into.fontBold = o.fontBold or ""
	into.fontItalic = o.fontItalic or ""
	into.size = o.size or 16
	into.width = o.width
	into.wrapMode = o.wrap or "word"
	into.align = o.align or "left"
	into.lineHeight = o.lineHeight or 1
	into.letterSpacing = o.letterSpacing or 0
	into.blockAlign = nil
	into.fitWidth, into.fitHeight = nil, nil
	return into
end
text._userOptions = userOptions

local function checkOptions(o, fname)
	if o ~= nil and type(o) ~= "table" then
		error(("%s needs its options in a table, like { size = 20, width = 200 }"):format(fname), 3)
	end
end

---How big a text is when drawn: width, height and the number of lines.
---options: font, size, width (wraps), rich, wrap, lineHeight, letterSpacing,
---fontBold, fontItalic.
function text.measure(str, options)
	checkOptions(options, "measure()")
	local _, lay = cached(tostring(str), userOptions(options or {}))
	return lay.width * lay.s, lay.height * lay.s, lay.lineCount
end

---The lines a text is broken into at a width: wrap("a long sentence",
---{ width = 120, size = 16 }) gives a list of strings (without tags).
function text.wrap(str, options)
	checkOptions(options, "wrap()")
	local _, lay = cached(tostring(str), userOptions(options or {}))
	local out = {}
	local ch = lay.doc.ch
	for i = 1, lay.lineCount do
		local l = lay.lines[i]
		local last = l.last
		while last >= l.first and isSpace(ch[last]) do last = last - 1 end
		out[i] = last >= l.first and concat(ch, "", l.first, last) or ""
	end
	return out
end

---------------------------------------------------------------------------
-- Looking things up in a layout (x, y in game pixels from the layout's
-- top-left corner).

---The rectangle of a character: x, y, width, height (the height of its line).
function text._characterRect(lay, index)
	local n = lay.n
	if type(index) ~= "number" or index < 1 or index > n or index % 1 ~= 0 then return nil end
	local s = lay.s
	positions(lay, lay.line[index])
	local l = lay.lines[lay.line[index]]
	return lay.x[index] * s, l.y * s, lay.w[index] * s, l.height * s
end

---The character at a point: its number, or nil.
function text._characterAt(lay, x, y)
	local s = lay.s
	x, y = x / s, y / s
	local lines = lay.lines
	for li = 1, lay.lineCount do
		local l = lines[li]
		if y >= l.y and y < l.y + l.height then
			positions(lay, li)
			local gx, gw = lay.x, lay.w
			for j = l.first, l.last do
				if x >= gx[j] and x < gx[j] + gw[j] then return j end
			end
			return nil
		end
	end
	return nil
end

---How many characters show: visibleCharacters (-1 for all) and visibleRatio.
local function visibleCount(n, characters, ratio)
	local v = n
	if characters and characters >= 0 and characters < v then v = floor(characters) end
	if ratio and ratio < 1 then
		local r = floor(n * max(0, ratio) + 1e-6)
		if r < v then v = r end
	end
	return v
end
text._visibleCount = visibleCount

---------------------------------------------------------------------------
-- Drawing

local OUTLINE = { -1, 0, 1, 0, 0, -1, 0, 1, -0.7071, -0.7071, 0.7071, -0.7071, -0.7071, 0.7071, 0.7071, 0.7071 }
local DEFAULT_SHADOW = { 0, 0, 0, 0.5 }

local colored = { nil, nil }

-- A batch for each font at each scale (the pixel font is one font drawn
-- at any size).
local function batchFor(st, rs)
	local byScale = st.batches[rs.font]
	if not byScale then
		byScale = {}
		st.batches[rs.font] = byScale
	end
	local b = byScale[rs.k]
	if not b then
		b = { font = rs.font, k = rs.k, fill = love.graphics.newTextBatch(rs.font), deco = nil, fills = 0, decos = 0 }
		byScale[rs.k] = b
		st.batchList[#st.batchList + 1] = b
	end
	return b
end

local function addText(batch, str, x, y, color, rs)
	colored[1], colored[2] = color, str
	if rs.slant then
		batch:add(colored, x + rs.slant * rs.m.baseline, y, 0, 1, 1, 0, 0, -rs.slant, 0)
	else
		batch:add(colored, x, y)
	end
end

-- What decorates a run: outline width (base pixels) and color, shadow
-- offsets (base pixels) and color. d: the piece's own settings.
local function decoOf(style, d, baseSc)
	local ow, oc, sx, sy, sc
	if style.outline then
		ow, oc = style.outline * baseSc, style.outlineColor
	elseif d.outline then
		ow, oc = d.outlineWidth * baseSc, d.outlineColor
	end
	if style.shadow then
		sx = (style.shadowX or d.shadowX or 2) * baseSc
		sy = (style.shadowY or d.shadowY or 2) * baseSc
		sc = style.shadowColor or d.shadowColor or DEFAULT_SHADOW
	elseif d.shadow then
		sx, sy, sc = d.shadowX * baseSc, d.shadowY * baseSc, d.shadowColor
	end
	if ow and ow <= 0 then ow = nil end
	return ow, oc, sx, sy, sc
end

local DKEYS = { "outline", "outlineWidth", "shadow", "shadowX", "shadowY" }

local function sameColor(a, b)
	if a == b then return true end
	if a == nil or b == nil then return false end
	return a[1] == b[1] and a[2] == b[2] and a[3] == b[3] and (a[4] or 1) == (b[4] or 1)
end

local function keepColor(into, c)
	if c == nil then return nil end
	into = into or {}
	into[1], into[2], into[3], into[4] = c[1], c[2], c[3], c[4] or 1
	return into
end

-- Builds the batches of everything that stands still: runs without
-- effects, up to the last visible character.
local function build(st, lay, visible, color, d, allDynamic)
	local b = st.built
	if b and b.lay == lay and b.visible == visible and b.allDynamic == allDynamic
		and b.r == color[1] and b.g == color[2] and b.b == color[3] and b.a == (color[4] or 1) then
		local same = true
		for i = 1, #DKEYS do
			if b[DKEYS[i]] ~= d[DKEYS[i]] then
				same = false
				break
			end
		end
		if same and sameColor(b.outlineColor, d.outlineColor) and sameColor(b.shadowColor, d.shadowColor) then return end
	end
	b = b or {}
	st.built = b
	b.lay, b.visible, b.allDynamic = lay, visible, allDynamic
	b.r, b.g, b.b, b.a = color[1], color[2], color[3], color[4] or 1
	for i = 1, #DKEYS do b[DKEYS[i]] = d[DKEYS[i]] end
	b.outlineColor = keepColor(b.outlineColor, d.outline and d.outlineColor or nil)
	b.shadowColor = keepColor(b.shadowColor, d.shadow and d.shadowColor or nil)
	local pieceColor = { b.r, b.g, b.b, b.a }
	b.color = pieceColor

	st.batches = st.batches or {}
	st.batchList = st.batchList or {}
	for i = 1, #st.batchList do
		local bt = st.batchList[i]
		if bt.fills > 0 then bt.fill:clear() end
		if bt.decos > 0 then bt.deco:clear() end
		bt.fills, bt.decos = 0, 0
	end
	local rules, pictures, dynamic = {}, {}, {}
	st.rules, st.pictures, st.dynamic = rules, pictures, dynamic
	st.dynamicDeco = false

	local doc = lay.doc
	local ch = doc.ch
	local gx, gw = lay.x, lay.w
	local baseSc = 1 / lay.s
	local runs = lay.runs
	for ri = 1, #runs do
		local run = runs[ri]
		if run.first > visible then break end
		local style, rs = run.style, run.rs
		local last = min(run.last, visible)
		local color1 = style.color or pieceColor
		local ow, oc, sx, sy, sc = decoOf(style, d, baseSc)
		local x, y = run.x, run.y
		-- Underline and strike-through: bars, drawn after the text.
		if style.underline or style.strike then
			positions(lay, run.line)
			local thick = max(1, floor(rs.size * rs.sc / 14 + 0.5)) * rs.k
			local width = gx[last] + gw[last] - x
			local baseY = y + (rs.pictureHeight or rs.baseline)
			if style.underline then
				rules[#rules + 1] = { x, baseY + thick, width, thick, color1 }
			end
			if style.strike then
				rules[#rules + 1] = { x, baseY - floor(rs.baseline * 0.32 + 0.5), width, thick, color1 }
			end
		end
		if rs.pictureWidth then
			if rs.picture then
				local p = rs.picture
				local item = { p.image, p.quad, x, y, rs.pictureWidth / p.width, rs.pictureHeight / p.height, run.first, style, p.width, p.height }
				if allDynamic or style.effects then dynamic[#dynamic + 1] = run else pictures[#pictures + 1] = item end
				run.picture = item
			end
		elseif allDynamic or style.effects then
			positions(lay, run.line)
			dynamic[#dynamic + 1] = run
			if ow or sx then st.dynamicDeco = true end
		else
			local str
			if last == run.last then
				str = run.text
				if not str then
					str = concat(ch, "", run.first, run.last)
					run.text = str
				end
			else
				str = concat(ch, "", run.first, last)
			end
			local bt = batchFor(st, rs)
			local k = rs.k
			local bx, by = x / k, y / k
			if ow or sx then
				if not bt.deco then bt.deco = love.graphics.newTextBatch(rs.font) end
				if sx then
					addText(bt.deco, str, bx + sx / k, by + sy / k, sc, rs)
					if rs.bold then addText(bt.deco, str, bx + sx / k + rs.bold, by + sy / k, sc, rs) end
					bt.decos = bt.decos + 1
				end
				if ow then
					local w = ow / k
					for j = 1, 16, 2 do
						addText(bt.deco, str, bx + OUTLINE[j] * w, by + OUTLINE[j + 1] * w, oc, rs)
						if rs.bold then addText(bt.deco, str, bx + OUTLINE[j] * w + rs.bold, by + OUTLINE[j + 1] * w, oc, rs) end
					end
					bt.decos = bt.decos + 1
				end
			end
			addText(bt.fill, str, bx, by, color1, rs)
			if rs.bold then addText(bt.fill, str, bx + rs.bold, by, color1, rs) end
			bt.fills = bt.fills + 1
		end
	end
	-- Batches of fonts no longer used (another size, a resized window) go.
	local list = st.batchList
	for i = #list, 1, -1 do
		local bt = list[i]
		if bt.fills == 0 and bt.decos == 0 then
			st.batches[bt.font][bt.k] = nil
			table.remove(list, i)
		end
	end
end

-- The one table effects get, for every character.
local C = { color = { 1, 1, 1, 1 } }
local T0 = nil
local NO_ARGS = {}

-- Results of the effects of this frame's moving characters.
local fx = { n = 0, i = {}, run = {}, x = {}, y = {}, rot = {}, scale = {}, r = {}, g = {}, b = {}, a = {} }

local function drawGlyph(g, lay, run, i, dx, dy, rot, scale, kx)
	local rs = run.rs
	local k = rs.k
	local w, h = lay.w[i], rs.height
	if run.picture then
		local p = run.picture
		local pw, ph = rs.pictureWidth, rs.pictureHeight
		g.draw(p[1], p[2], lay.x[i] + dx + pw / 2, lay.y[i] + dy + ph / 2, rot, p[5] * scale, p[6] * scale, p[9] / 2, p[10] / 2)
		return
	end
	local c = lay.doc.ch[i]
	local x, y = lay.x[i] + dx + w / 2, lay.y[i] + dy + h / 2
	local ox, oy = w / k / 2, h / k / 2
	if rs.slant then
		g.print(c, rs.font, x + rs.slant * rs.baseline, y, rot, k * scale, k * scale, ox, oy, -rs.slant, 0)
	else
		g.print(c, rs.font, x, y, rot, k * scale, k * scale, ox, oy)
	end
	if rs.bold then
		g.print(c, rs.font, x + rs.bold * k, y, rot, k * scale, k * scale, ox, oy, rs.slant and -rs.slant or 0, 0)
	end
end

---Draws a prepared text with its top-left corner at x, y (game pixels).
---color: the text's own color; tr, tg, tb, ta: what everything is
---multiplied by (tints, opacity). visible: how many characters show.
---d: outline and shadow settings. hook: a function called for every
---character (the piece's eachCharacter), with piece as its first argument.
function text._draw(st, lay, x, y, color, tr, tg, tb, ta, visible, d, hook, piece)
	local g = love.graphics
	local n = lay.n
	if visible == nil or visible > n then visible = n end
	local now = fonts.now()
	-- When each character appeared (for c.since).
	local shown = st.shown
	if shown == nil then
		st.shown = visible
	elseif visible > shown then
		local at = st.at
		if not at then
			at = {}
			st.at = at
		end
		for i = shown + 1, visible do at[i] = now end
		st.shown = visible
	elseif visible < shown then
		st.shown = visible
	end
	if visible <= 0 then return end

	build(st, lay, visible, color, d, hook ~= nil)

	local s = lay.s
	g.push()
	g.translate(x, y)
	g.scale(s, s)
	local list = st.batchList
	local nlist = #list
	local dynamic = st.dynamic
	local ndyn = #dynamic
	local baseSc = 1 / s

	-- Characters with effects: work out where each is this frame.
	local count = 0
	if ndyn > 0 then
		local doc = lay.doc
		local ch, gl = doc.ch, lay.line
		local at, t0 = st.at, st.t0 or now
		local pieceColor = st.built.color
		local c = C
		T0 = T0 or now
		c.count, c.time, c.piece = n, now - T0, piece
		for ri = 1, ndyn do
			local run = dynamic[ri]
			local style = run.style
			local fxs = style.effects
			local col = style.color or pieceColor
			for i = run.first, min(run.last, visible) do
				c.x, c.y, c.rotation, c.scale, c.alpha, c.visible = 0, 0, 0, 1, 1, true
				local cc = c.color
				if type(cc) ~= "table" then
					cc = {}
					c.color = cc
				end
				cc[1], cc[2], cc[3], cc[4] = col[1], col[2], col[3], col[4] or 1
				c.index, c.char, c.line = i, ch[i], gl[i]
				c.since = now - ((at and at[i]) or t0)
				if fxs then
					for j = 1, #fxs do
						c.args = fxs[j].args
						fxs[j].fn(c)
					end
				end
				if hook then
					c.args = NO_ARGS
					hook(piece, c)
				end
				if c.visible then
					count = count + 1
					fx.i[count], fx.run[count] = i, run
					fx.x[count], fx.y[count] = (tonumber(c.x) or 0) * baseSc, (tonumber(c.y) or 0) * baseSc
					fx.rot[count], fx.scale[count] = tonumber(c.rotation) or 0, tonumber(c.scale) or 1
					cc = type(c.color) == "table" and c.color or col
					fx.r[count], fx.g[count], fx.b[count] = cc[1] or 1, cc[2] or 1, cc[3] or 1
					fx.a[count] = (cc[4] or 1) * (tonumber(c.alpha) or 1)
				end
			end
		end
		c.piece = nil
	end

	-- Shadows and outlines first, so they never cover a neighbour.
	g.setColor(tr, tg, tb, ta)
	for i = 1, nlist do
		local bt = list[i]
		if bt.decos > 0 then g.draw(bt.deco, 0, 0, 0, bt.k, bt.k) end
	end
	if count > 0 and st.dynamicDeco then
		for j = 1, count do
			local run = fx.run[j]
			local ow, oc, sx, sy, sc = decoOf(run.style, d, baseSc)
			local i = fx.i[j]
			if sx then
				g.setColor(sc[1] * tr, sc[2] * tg, sc[3] * tb, (sc[4] or 1) * fx.a[j] * ta)
				drawGlyph(g, lay, run, i, fx.x[j] + sx, fx.y[j] + sy, fx.rot[j], fx.scale[j])
			end
			if ow and not run.picture then
				g.setColor(oc[1] * tr, oc[2] * tg, oc[3] * tb, (oc[4] or 1) * fx.a[j] * ta)
				for o = 1, 16, 2 do
					drawGlyph(g, lay, run, i, fx.x[j] + OUTLINE[o] * ow, fx.y[j] + OUTLINE[o + 1] * ow, fx.rot[j], fx.scale[j])
				end
			end
		end
	end

	-- The text itself.
	g.setColor(tr, tg, tb, ta)
	for i = 1, nlist do
		local bt = list[i]
		if bt.fills > 0 then g.draw(bt.fill, 0, 0, 0, bt.k, bt.k) end
	end
	local pictures = st.pictures
	for i = 1, #pictures do
		local p = pictures[i]
		g.draw(p[1], p[2], p[3], p[4], 0, p[5], p[6])
	end
	for j = 1, count do
		local run = fx.run[j]
		if run.picture then
			g.setColor(tr, tg, tb, fx.a[j] * ta)
		else
			g.setColor(fx.r[j] * tr, fx.g[j] * tg, fx.b[j] * tb, fx.a[j] * ta)
		end
		drawGlyph(g, lay, run, fx.i[j], fx.x[j], fx.y[j], fx.rot[j], fx.scale[j])
		fx.run[j] = nil
	end
	local rules = st.rules
	for i = 1, #rules do
		local r = rules[i]
		local col = r[5]
		g.setColor(col[1] * tr, col[2] * tg, col[3] * tb, (col[4] or 1) * ta)
		g.rectangle("fill", r[1], r[2], r[3], r[4])
	end
	g.pop()
end

---------------------------------------------------------------------------
-- Revealing text a character at a time (the pieces' reveal()).

local Reveal = {}
Reveal.__index = Reveal

---Stops revealing where it is.
function Reveal:cancel()
	self.active = false
	local p = self.piece
	if p and p._reveal == self then p._reveal = nil end
end

---Calls fn once every character shows.
function Reveal:after(fn)
	self.done = fn
	return self
end

---Holds the next character back this many seconds (on top of any wait
---still running): for a breath after a full stop.
function Reveal:wait(seconds)
	self.waiting = self.waiting + max(0, tonumber(seconds) or 0)
	return self
end

---True until every character shows (or it's cancelled).
function Reveal:isActive()
	return self.active
end

---Starts revealing a piece's text: speed characters a second, from a
---character (0: from nothing). docOf(piece) gives the parsed text;
---onCharacter(piece, index, char) and onFinished(piece) tell the piece.
function text._reveal(piece, speed, from, docOf, onCharacter, onFinished)
	if speed ~= nil and (type(speed) ~= "number" or speed <= 0) then
		error("reveal() needs how many characters to show each second, like reveal(30)", 3)
	end
	local old = piece._reveal
	if old then old.active = false end
	local h = setmetatable({ piece = piece, speed = speed or 30, carry = 0, waiting = 0, active = true, docOf = docOf,
		onCharacter = onCharacter, onFinished = onFinished }, Reveal)
	piece.visibleCharacters = max(0, floor(tonumber(from) or 0))
	piece.visibleRatio = 1
	piece._reveal = h
	return h
end

local function finishReveal(piece, h)
	h.active = false
	if piece._reveal == h then piece._reveal = nil end
	piece.visibleCharacters = -1
	if h.onFinished then h.onFinished(piece) end
	local done = h.done
	if done then done(piece) end
end

---Moves a piece's reveal on by dt seconds (from the piece's _process, so
---it stops while the game is paused).
function text._advance(piece, dt)
	local h = piece._reveal
	if not h then return end
	if not h.active then
		piece._reveal = nil
		return
	end
	local budget = dt
	for _ = 1, 100000 do
		local doc = h.docOf(piece)
		local n = doc.n
		local cur = piece.visibleCharacters
		if cur < 0 then cur = n end
		local nxt = cur + 1
		local pause = doc.pause and doc.pause[min(nxt, n + 1)]
		if pause and h.paused ~= nxt then
			h.paused = nxt
			h.waiting = h.waiting + pause
		end
		if h.waiting > 0 then
			if budget < h.waiting then
				h.waiting = h.waiting - budget
				return
			end
			budget = budget - h.waiting
			h.waiting = 0
		end
		if cur >= n then
			finishReveal(piece, h)
			return
		end
		local speed = max(0.001, doc.st[nxt].speed or tonumber(h.speed) or 30)
		local cost = 1 / speed
		if h.carry + budget < cost then
			h.carry = h.carry + budget
			return
		end
		budget = budget - (cost - h.carry)
		h.carry = 0
		piece.visibleCharacters = nxt
		if h.onCharacter then h.onCharacter(piece, nxt, doc.ch[nxt]) end
		if not h.active or piece._reveal ~= h then return end
	end
end

---Shows the whole text now and ends a reveal().
function text._skip(piece)
	local h = piece._reveal
	piece.visibleCharacters = -1
	piece.visibleRatio = 1
	if h and h.active then finishReveal(piece, h) end
end

return text
