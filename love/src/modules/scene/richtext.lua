-- What Text, Label and Button share: they hand their words to love.text
-- (parsing, layout, drawing; docs/text.md) and get measuring, looking
-- characters up and reveal() back.
--
-- A piece that uses none of the new settings is still drawn with the
-- engine's plain print (see plain() below), exactly as before there was
-- rich text.

local text = require("love.text")
local nodeLib = require("love.scene.node")

local M = {}

local max = math.max

---The piece's text state (its parse, layout and batches), made when first
---needed.
local function state(self)
	local st = self._text
	if not st then
		st = text.state()
		st.d = {}
		self._text = st
	end
	return st
end

---Fills the layout's options from a piece's properties (Button has only
---some of them).
local function options(self, st)
	local o = st.o
	o.rich = self.rich == true
	o.font = self.font or ""
	o.fontBold = self.fontBold or ""
	o.fontItalic = self.fontItalic or ""
	o.size = self.size
	o.wrapMode = self.wrapBy or "word"
	o.align = self.align or "left"
	o.lineHeight = self.lineHeight or 1
	o.letterSpacing = self.letterSpacing or 0
	o.blockAlign = nil
	o.fitWidth, o.fitHeight = nil, nil
	return o
end
M.state, M.options = state, options

---True if a piece's text needs nothing print can't do: it's drawn the way
---it always was.
function M.plain(self)
	return not self.rich and self.visibleCharacters < 0 and self.visibleRatio >= 1
		and self.letterSpacing == 0 and self.lineHeight == 1 and self.wrapBy == "word"
		and self.align ~= "justify" and not self.shadow and self.eachCharacter == nil
end

-- Outline and shadow settings, as love.text draws them. An outlineWidth
-- of 0 is one screen pixel, however the game is scaled.
local function decoration(self, st, lay)
	local d = st.d
	d.outline = self.outline == true
	if d.outline then
		local w = self.outlineWidth or 0
		if w <= 0 then w = max(lay.s, 1 / max(1, require("love.display").scale)) end
		d.outlineWidth, d.outlineColor = w, self.outlineColor
	end
	d.shadow = self.shadow == true
	if d.shadow then
		d.shadowX, d.shadowY, d.shadowColor = self.shadowX, self.shadowY, self.shadowColor
	end
	return d
end

---Draws a piece's text through love.text. x, y: where the piece's own
---coordinates start; color: the text's color; tr, tg, tb, ta: tint.
function M.draw(self, x, y, color, tr, tg, tb, ta)
	local lay, ox, oy, st = self:_textLayout()
	local visible = text._visibleCount(lay.n, self.visibleCharacters, self.visibleRatio)
	text._draw(st, lay, x + ox, y + oy, color, tr, tg, tb, ta, visible, decoration(self, st, lay), self.eachCharacter, self)
end

---------------------------------------------------------------------------
-- The methods Text and Label share. Each type has a _textLayout() that
-- returns the layout and where its top-left corner is in the piece's own
-- coordinates.

local Shared = {}

---How big the text is as it's laid out now: width, height.
function Shared:measure()
	local lay = self:_textLayout()
	return lay.width * lay.s, lay.height * lay.s
end

function Shared:lineCount()
	return (self:_textLayout()).lineCount
end

---How many characters there are (tags and line breaks don't count).
function Shared:characterCount()
	return (self:_textLayout()).n
end

---Where a character is: x, y, width, height (nil if there's no such one).
function Shared:characterRect(index)
	local lay, ox, oy = self:_textLayout()
	local x, y, w, h = text._characterRect(lay, index)
	if not x then return nil end
	return x + ox, y + oy, w, h
end

---The number of the character at a point, or nil.
function Shared:characterAt(x, y)
	if type(x) ~= "number" or type(y) ~= "number" then error("characterAt() needs a point: x, y", 2) end
	local lay, ox, oy = self:_textLayout()
	return text._characterAt(lay, x - ox, y - oy)
end

---The name of the [link=name] at a point, or nil.
function Shared:linkAt(x, y)
	if type(x) ~= "number" or type(y) ~= "number" then error("linkAt() needs a point: x, y", 2) end
	local lay, ox, oy = self:_textLayout()
	if not lay.doc.hasLinks then return nil end
	local i = text._characterAt(lay, x - ox, y - oy)
	return i and lay.doc.st[i].link or nil
end

local function docOf(self)
	return (self:_textLayout()).doc
end

local function onCharacter(self, index, char)
	self:emit("revealed", index, char)
end

local function onFinished(self)
	self:emit("finished")
end

---Shows the text a character at a time. Returns a handle: cancel(),
---after(fn), wait(seconds).
function Shared:reveal(charactersPerSecond, from)
	return text._reveal(self, charactersPerSecond, from, docOf, onCharacter, onFinished)
end

---Shows the whole text now and ends a reveal().
function Shared:skip()
	text._skip(self)
end

function Shared:_process(dt)
	if self._reveal then text._advance(self, dt) end
end

---Gives a piece type the shared methods.
function M.install(typeName)
	local cls = nodeLib.classes[typeName]
	for k, v in pairs(Shared) do cls[k] = v end
end

return M
