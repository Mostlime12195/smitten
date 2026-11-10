-- TextInput: a box to type in.
--
-- While one has the focus, love.engine hands it the keys and the typed
-- text before the game's input sees them (ui.keyEvent), so typing "w"
-- doesn't walk. Text comes the way smitten.input.typed() gets it: on the
-- web through the page's hidden text field, which also serves IMEs and
-- phones' keyboards. Focusing a TextInput turns text input on (on a phone
-- the keyboard comes up, since the focus came from a tap) and puts that
-- field over the box; losing the focus puts text input back as it was.
--
-- Positions in the text count characters, not bytes: the caret is after
-- `_caret` characters (0 is before the first), and a selection runs from
-- `_anchor` to the caret.

local nodeLib = require("love.scene.node")
local ui = require("love.scene.ui")

local floor, max, min = math.floor, math.max, math.min
local concat = table.concat
local setColor = ui.setColor

local TextInput = nodeLib.classes.TextInput

TextInput._focusable = true
TextInput._typing = true  -- the keyboard is its own while it has the focus

local CHAR = "[%z\1-\127\194-\244][\128-\191]*"
local PAD_X, PAD_Y = 8, 6

-- The text as a list of characters, made again when the text changes.
local function chars(self)
	local t = self.text
	if type(t) ~= "string" then t = t == nil and "" or tostring(t) end
	if self._charsOf ~= t then
		local list = self._chars or {}
		local n = 0
		for ch in t:gmatch(CHAR) do
			n = n + 1
			list[n] = ch
		end
		for i = #list, n + 1, -1 do list[i] = nil end
		self._chars, self._charsOf, self._n = list, t, n
		self._lines = nil
		local caret = self._caret
		if caret == nil or caret > n then self._caret = n end
		if self._anchor and self._anchor > n then self._anchor = n end
	end
	return self._chars, self._n
end

local function fontOf(self)
	return ui.scaledFont(self.font, self.size)
end

-- What a character looks like in the box.
local function shown(self, ch, dot)
	if ch == "\n" or ch == "\t" then return " " end
	return self.secret and dot or ch
end

-- The lines as they're drawn: { first, last, text, width } with first and
-- last the numbers of the line's characters (last < first: an empty line).
-- Made again when the text, the box or the font changes.
local function lines(self, innerW)
	local list, n = chars(self)
	local font, s = fontOf(self)
	local ls = self._lines
	if ls and ls.w == innerW and ls.font == font and ls.secret == self.secret and ls.multiline == self.multiline then
		return ls, font, s
	end
	ls = { w = innerW, font = font, secret = self.secret, multiline = self.multiline }
	local dot = "*"
	if self.secret then
		local ok, has = pcall(font.hasGlyphs, font, "•")
		if ok and has then dot = "•" end
	end
	local disp = {}
	for i = 1, n do disp[i] = shown(self, list[i], dot) end
	local function add(first, last)
		local text = concat(disp, "", first, last)
		ls[#ls + 1] = { first = first, last = last, text = text, width = font:getWidth(text) * s }
	end
	if not self.multiline then
		add(1, n)
	else
		-- Words wrap; a word longer than the box is cut where it must be.
		local first, width, space = 1, 0, nil
		local i = 1
		while i <= n do
			local ch = list[i]
			if ch == "\n" then
				add(first, i - 1)
				first, width, space = i + 1, 0, nil
			else
				local cw = font:getWidth(disp[i]) * s
				if width + cw > innerW and i > first and ch ~= " " then
					local cut = space and space >= first and space or i - 1
					add(first, cut)
					first = cut + 1
					width = font:getWidth(concat(disp, "", first, i - 1)) * s
					space = nil
				end
				if ch == " " then space = i end
				width = width + cw
			end
			i = i + 1
		end
		add(first, n)
	end
	self._lines = ls
	return ls, font, s
end

-- The line a caret position is on.
local function lineOf(ls, caret)
	for i = #ls, 1, -1 do
		if ls[i].first - 1 <= caret then return i end
	end
	return 1
end

-- How far along its line a caret position is, in pixels.
local function xOf(self, ls, li, caret, font, s)
	local l = ls[li]
	local k = min(caret, l.last) - l.first + 1
	if k <= 0 then return 0 end
	if k >= l.last - l.first + 1 then return l.width end
	-- The line's text up to the caret (its characters may be several bytes).
	local bytes, count = 0, 0
	for ch in l.text:gmatch(CHAR) do
		if count == k then break end
		count = count + 1
		bytes = bytes + #ch
	end
	return font:getWidth(l.text:sub(1, bytes)) * s
end

-- The caret position nearest a point on a line.
local function caretAt(l, px, font, s)
	local best, bestD = l.first - 1, math.abs(px)
	local bytes, k = 0, 0
	for ch in l.text:gmatch(CHAR) do
		bytes = bytes + #ch
		k = k + 1
		local d = math.abs(font:getWidth(l.text:sub(1, bytes)) * s - px)
		if d < bestD then best, bestD = l.first - 1 + k, d end
	end
	return best
end

-- The box's inner rectangle, the lines and where the text starts.
local function geometry(self)
	local r = self._rect
	local x, y, w, h = 0, 0, self.width, self.height
	if r then x, y, w, h = r[1], r[2], r[3], r[4] end
	local innerW = max(1, w - 2 * PAD_X)
	local ls, font, s = lines(self, innerW)
	local lineH = font:getHeight() * s
	local top
	if self.multiline then top = y + PAD_Y else top = y + (h - lineH) / 2 end
	return ls, font, s, x + PAD_X, top, innerW, lineH, h
end

-- Scrolls the text so the caret shows.
local function follow(self, ls, font, s, innerW, lineH, h)
	local caret = self._caret or 0
	local li = lineOf(ls, caret)
	if self.multiline then
		local viewH = max(lineH, h - 2 * PAD_Y)
		local sy = self._sy or 0
		local cy = (li - 1) * lineH
		if cy < sy then sy = cy end
		if cy + lineH > sy + viewH then sy = cy + lineH - viewH end
		self._sy = max(0, min(sy, max(0, #ls * lineH - viewH)))
		self._sx = 0
	else
		local sx = self._sx or 0
		local cx = xOf(self, ls, li, caret, font, s)
		if cx < sx then sx = cx end
		if cx > sx + innerW - 2 then sx = cx - innerW + 2 end
		self._sx = max(0, min(sx, max(0, ls[1].width - innerW + 2)))
		self._sy = 0
	end
end

-- The caret position under a point (in game coordinates).
local function caretAtPoint(self, px, py)
	local ls, font, s, left, top, innerW, lineH = geometry(self)
	local li = floor((py - top + (self._sy or 0)) / lineH) + 1
	li = max(1, min(#ls, li))
	return caretAt(ls[li], px - left + (self._sx or 0), font, s)
end

local function selection(self)
	local a, c = self._anchor, self._caret or 0
	if a == nil or a == c then return nil end
	if a < c then return a, c end
	return c, a
end

local function touch(self)
	self._blink = love.timer.getTime()
end

-- Puts new text in the box as the player's doing: changed() runs.
local function edit(self, text, caret)
	self.text = text
	self._anchor = nil
	chars(self)
	self._caret = max(0, min(self._n, caret))
	touch(self)
	self:emit("changed", text)
end

-- The text with the characters from a+1 to b replaced by str.
local function spliced(self, a, b, str)
	local list, n = chars(self)
	return concat(list, "", 1, a) .. str .. concat(list, "", b + 1, n)
end

-- Removes the selection. True if there was one.
local function deleteSelection(self)
	local a, b = selection(self)
	if not a then return false end
	edit(self, spliced(self, a, b, ""), a)
	return true
end

-- What of a string the box takes, given what's in it already: no control
-- characters, only what `allow` lets through, no more than maxLength.
local function filter(self, str, at, room)
	local list, n = chars(self)
	local allow = self.allow
	local only = allow == "only" and tostring(self.allowCharacters or "") or nil
	local hasDot = false
	if allow == "numbers" then
		for i = 1, n do
			if list[i] == "." then hasDot = true end
		end
	end
	local out, count = {}, 0
	str = str:gsub("\r\n", "\n"):gsub("\r", "\n")
	for ch in str:gmatch(CHAR) do
		if room and count >= room then break end
		local ok
		if ch == "\n" then
			ok = self.multiline == true
		elseif #ch == 1 and (ch:byte() < 32 or ch:byte() == 127) then
			ok = false
		elseif allow == "numbers" then
			if ch:match("%d") then
				ok = true
			elseif ch == "-" then
				ok = at == 0 and count == 0 and list[1] ~= "-"
			elseif ch == "." then
				ok = not hasDot
				if ok then hasDot = true end
			end
		elseif allow == "letters" then
			ok = #ch > 1 or ch:match("%w") ~= nil
		elseif only then
			ok = only:find(ch, 1, true) ~= nil
		else
			ok = true
		end
		if ok then
			count = count + 1
			out[count] = ch
		end
	end
	return concat(out), count
end

-- Types a string at the caret, over the selection if there is one.
local function insert(self, str)
	-- First, so a caret left beyond text a script has shortened is brought in.
	local _, n = chars(self)
	local a, b = selection(self)
	local caret = self._caret or 0
	if not a then a, b = caret, caret end
	local limit = tonumber(self.maxLength) or 0
	local room = limit > 0 and max(0, limit - (n - (b - a))) or nil
	-- What's left once the selection goes decides what a number may take.
	local had = self.text
	if b > a then
		self.text = spliced(self, a, b, "")
		chars(self)
	end
	local add, count = filter(self, str, a, room)
	if count == 0 then
		self.text = had
		chars(self)
		return false
	end
	edit(self, spliced(self, a, a, add), a + count)
	return true
end

local function isSpace(ch)
	return ch == " " or ch == "\n" or ch == "\t"
end

-- The start of the word before a position, and the end of the one after.
local function wordLeft(self, at)
	local list = chars(self)
	while at > 0 and isSpace(list[at]) do at = at - 1 end
	while at > 0 and not isSpace(list[at]) do at = at - 1 end
	return at
end

local function wordRight(self, at)
	local list, n = chars(self)
	while at < n and isSpace(list[at + 1]) do at = at + 1 end
	while at < n and not isSpace(list[at + 1]) do at = at + 1 end
	return at
end

-- Moves the caret; with Shift held the selection stretches to it.
local function moveTo(self, at, shift)
	local _, n = chars(self)
	at = max(0, min(n, at))
	if shift then
		if self._anchor == nil then self._anchor = self._caret or 0 end
	else
		self._anchor = nil
	end
	self._caret = at
	touch(self)
end

local function selectedText(self)
	local a, b = selection(self)
	if not a then return nil end
	return concat((chars(self)), "", a + 1, b)
end

local function clipboard(set)
	local sys = love.system
	if not sys then return nil end
	if set then
		pcall(sys.setClipboardText, set)
		return nil
	end
	local ok, text = pcall(sys.getClipboardText)
	return ok and type(text) == "string" and text or nil
end

-- Shift, and Ctrl (or Cmd), as the engine's input has them. Ctrl with Alt
-- is AltGr, which types letters on many keyboards, so it isn't Ctrl here.
local function modifiers()
	local held = require("love.input")._rawDown
	local shift = held("lshift") or held("rshift")
	local ctrl = (held("lctrl") or held("rctrl") or held("lgui") or held("rgui")) and not (held("lalt") or held("ralt"))
	return shift, ctrl
end

local PASS = {
	lshift = true, rshift = true, lctrl = true, rctrl = true, lalt = true, ralt = true, lgui = true, rgui = true,
	capslock = true, numlock = true, scrolllock = true, printscreen = true, pause = true, menu = true, application = true,
}

---A key went down while the box has the focus (from ui.keyEvent). True if
---the box took it; false for keys that aren't its business (F5, Shift).
function TextInput:_key(key, isRepeat)
	if PASS[key] or key:match("^f%d+$") then return false end
	local shift, ctrl = modifiers()
	local _, n = chars(self)
	local caret = self._caret or 0
	if key == "left" or key == "right" then
		local a, b = selection(self)
		if a and not shift then
			moveTo(self, key == "left" and a or b, false)
		elseif ctrl then
			moveTo(self, key == "left" and wordLeft(self, caret) or wordRight(self, caret), shift)
		else
			moveTo(self, caret + (key == "left" and -1 or 1), shift)
		end
	elseif key == "home" or key == "end" then
		if ctrl or not self.multiline then
			moveTo(self, key == "home" and 0 or n, shift)
		else
			local ls = geometry(self)
			local l = ls[lineOf(ls, caret)]
			moveTo(self, key == "home" and l.first - 1 or l.last, shift)
		end
	elseif key == "up" or key == "down" then
		local dy = key == "up" and -1 or 1
		local moved = false
		if self.multiline then
			local ls, font, s = geometry(self)
			local li = lineOf(ls, caret)
			local to = ls[li + dy]
			if to then
				moveTo(self, caretAt(to, xOf(self, ls, li, caret, font, s), font, s), shift)
				moved = true
			end
		end
		-- Off the top or the bottom, the focus goes to the piece that way.
		if not moved and not shift then ui.navigate(0, dy) end
	elseif key == "backspace" then
		if not deleteSelection(self) and caret > 0 then
			local from = ctrl and wordLeft(self, caret) or caret - 1
			edit(self, spliced(self, from, caret, ""), from)
		end
	elseif key == "delete" then
		if not deleteSelection(self) and caret < n then
			local to = ctrl and wordRight(self, caret) or caret + 1
			edit(self, spliced(self, caret, to, ""), caret)
		end
	elseif key == "return" or key == "kpenter" then
		if self.multiline and not ctrl then
			insert(self, "\n")
		elseif not isRepeat then
			self:emit("submitted", self.text)
		end
	elseif key == "tab" then
		ui.focusNext(shift and -1 or 1)
	elseif key == "escape" then
		ui.setFocus(nil)
	elseif ctrl and key == "a" then
		self:selectAll()
	elseif ctrl and (key == "c" or key == "x") then
		local text = selectedText(self)
		-- A secret isn't for copying.
		if text and not self.secret then
			clipboard(text)
			if key == "x" then deleteSelection(self) end
		end
	elseif ctrl and key == "v" then
		-- In a browser the page's paste arrives as typed text (the hidden
		-- text field's paste event); elsewhere the clipboard is read here.
		if not (love.system and love.system.getOS() == "Web") then
			local text = clipboard()
			if text and text ~= "" then insert(self, text) end
		end
	end
	return true
end

---Text was typed or pasted while the box has the focus (from ui.keyEvent).
function TextInput:_type(str)
	if type(str) == "string" and str ~= "" then insert(self, str) end
end

function TextInput:_press(x, y)
	self._drag = true
	moveTo(self, caretAtPoint(self, x, y), (modifiers()))
	-- A drag from here selects.
	if self._anchor == nil then self._anchor = self._caret end
end

function TextInput:_dragTo(x, y)
	if not self._drag then return end
	local at = caretAtPoint(self, x, y)
	if at ~= self._caret then
		self._caret = at
		touch(self)
	end
end

function TextInput:_release()
	self._drag = false
	if self._anchor == self._caret then self._anchor = nil end
end

-- Where the page's text field goes (IME windows open there, and a phone
-- scrolls it into view above its keyboard): over the box.
local function place(self)
	local kb = love.keyboard
	local r = self._rect
	if not (kb and kb.setTextInput) then return end
	if not r then
		kb.setTextInput(true)
		return
	end
	local display = require("love.display")
	local x0, y0 = display.toWindow(r[1], r[2])
	local x1, y1 = display.toWindow(r[1] + r[3], r[2] + r[4])
	local p = self._placed
	if not p then
		p = {}
		self._placed = p
	end
	if p[1] == x0 and p[2] == y0 and p[3] == x1 and p[4] == y1 and kb.hasTextInput() then return end
	p[1], p[2], p[3], p[4] = x0, y0, x1, y1
	kb.setTextInput(true, x0, y0, max(1, x1 - x0), max(1, y1 - y0))
end

-- The focus came (ui.lua).
function TextInput:_focused()
	local kb = love.keyboard
	if kb and kb.hasTextInput then
		self._hadTextInput = kb.hasTextInput()
		self._hadRepeat = kb.hasKeyRepeat()
		kb.setKeyRepeat(true)
		self._placed = nil
		place(self)
	end
	chars(self)
	touch(self)
	self._on = true
	if not self._dead then self:emit("focused") end
end

-- The focus went.
function TextInput:_blurred()
	if not self._on then return end
	self._on = false
	self._drag = false
	self._anchor = nil
	local kb = love.keyboard
	if kb and kb.hasTextInput then
		kb.setKeyRepeat(self._hadRepeat == true)
		-- Another TextInput taking the focus turns it straight back on.
		kb.setTextInput(self._hadTextInput == true)
	end
	if not self._dead and not self._leaving then self:emit("blurred") end
end

-- Leaving the scene with the focus: typing ends, and its script (on its
-- way out) isn't told.
function TextInput:_exit()
	if ui.focused == self then
		self._leaving = true
		ui.setFocus(nil)
		self._leaving = nil
	end
end

---Starts typing in the box, as a click does.
function TextInput:focus()
	ui.setFocus(self)
end

---Stops typing in the box.
function TextInput:blur()
	if ui.focused == self then ui.setFocus(nil) end
end

function TextInput:isFocused()
	return ui.focused == self
end

---Selects all of the text, so typing replaces it.
function TextInput:selectAll()
	local _, n = chars(self)
	self._anchor = 0
	self._caret = n
	touch(self)
end

function TextInput:_drawUI(x, y, w, h, alpha)
	local g = love.graphics
	if self.disabled then alpha = alpha * 0.5 end
	local focused = ui.focused == self and self._on
	local radius = self.cornerRadius
	if ui.hasSkin(self.skin) then
		ui.drawSkinState(self, (focused or ui.hovered == self) and not self.disabled and "hover" or "normal", x, y, w, h, alpha)
	else
		setColor(self.background, alpha)
		g.rectangle("fill", x, y, w, h, radius, radius)
		setColor(focused and self.selectionColor or self.borderColor, alpha)
		g.setLineWidth(focused and 2 or 1)
		local b = focused and 1 or 0.5
		g.rectangle("line", x + b, y + b, w - 2 * b, h - 2 * b, radius, radius)
	end
	if focused and ui.hasSkin(self.skin) then ui.focusRing(self.selectionColor, alpha, x, y, w, h, radius) end

	local ls, font, s, left, top, innerW, lineH = geometry(self)
	if focused then
		follow(self, ls, font, s, innerW, lineH, h)
		place(self)
	end
	local sx, sy = self._sx or 0, self._sy or 0
	local _, n = chars(self)

	local ox, oy, ow, oh = g.getScissor()
	local ax, ay = g.transformPoint(x + PAD_X - 1, y + 1)
	local bx, by = g.transformPoint(x + w - PAD_X + 1, y + h - 1)
	g.intersectScissor(ax, ay, max(0, bx - ax), max(0, by - ay))
	g.setFont(font)
	if n == 0 then
		local hint = tostring(self.placeholder or "")
		if hint ~= "" then
			setColor(self.placeholderColor, alpha)
			g.print(hint, left, top, 0, s, s)
		end
	else
		local a, b = selection(self)
		local caret = self._caret or 0
		for i = 1, #ls do
			local l = ls[i]
			local ly = top + (i - 1) * lineH - sy
			if ly + lineH > y and ly < y + h then
				if a and focused and b >= l.first - 1 and a <= l.last then
					local x0 = xOf(self, ls, i, max(a, l.first - 1), font, s)
					local x1 = xOf(self, ls, i, min(b, l.last), font, s)
					-- A selection that goes on to the next line shows it.
					if b > l.last and i < #ls then x1 = x1 + lineH * 0.3 end
					setColor(self.selectionColor, alpha * 0.6)
					g.rectangle("fill", left + x0 - sx, ly, x1 - x0, lineH)
				end
				setColor(self.color, alpha)
				g.print(l.text, left - sx, ly, 0, s, s)
			end
		end
	end
	-- The caret blinks, and stays lit just after a key.
	if focused and not self.disabled and (love.timer.getTime() - (self._blink or 0)) % 1 < 0.55 then
		local caret = self._caret or 0
		local li = lineOf(ls, caret)
		local cx = left + xOf(self, ls, li, caret, font, s) - sx
		local cy = top + (li - 1) * lineH - sy
		setColor(self.color, alpha)
		g.rectangle("fill", floor(cx), cy + lineH * 0.1, max(1, s), lineH * 0.8)
	end
	if ox then g.setScissor(ox, oy, ow, oh) else g.setScissor() end
end
