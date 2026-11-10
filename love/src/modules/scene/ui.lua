-- UI pieces: Label, Button, Panel, Picture and Bar, drawn on top of the game
-- in screen space (game coordinates, not moved by cameras). TouchStick and
-- TouchButton are in touch.lua.
--
-- A UI piece's rectangle is measured from its anchor in its parent UI piece
-- (or the screen): with anchor "bottomRight", x = 16 and y = 16 put it 16
-- pixels in from the bottom-right corner; offsets always point inwards.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")

-- What a Button, Panel or Picture tells its script when it's clicked:
-- clicked(), or pressed() in a project from before that (engine/compat.lua).
local CLICKED = require("love.engine.compat").event("clicked")

local M = {}

local ANCHORS = {
	topLeft = { 0, 0 }, top = { 0.5, 0 }, topRight = { 1, 0 },
	left = { 0, 0.5 }, center = { 0.5, 0.5 }, right = { 1, 0.5 },
	bottomLeft = { 0, 1 }, bottom = { 0.5, 1 }, bottomRight = { 1, 1 },
}

local function isUI(n)
	return n.anchor ~= nil
end
M.isUI = isUI

local function layout(n, px, py, pw, ph)
	if n.anchor == "fill" then
		return px + n.x, py + n.y, math.max(0, pw - 2 * n.x), math.max(0, ph - 2 * n.y)
	end
	local a = ANCHORS[n.anchor] or ANCHORS.topLeft
	local w, h = n.width, n.height
	local x = px + a[1] * (pw - w) + (a[1] == 1 and -n.x or n.x)
	local y = py + a[2] * (ph - h) + (a[2] == 1 and -n.y or n.y)
	return x, y, w, h
end
M.layout = layout

local UIBase = nodeLib.classes.UI

function UIBase:getRect()
	local r = self._rect
	if r then return r[1], r[2], r[3], r[4] end
	return 0, 0, self.width, self.height
end

function UIBase:isHovered()
	return M.hovered == self
end

local function scaledFont(path, size)
	local font, scale = assets.font(path, size, require("love.scene.nodes2d").textScale)
	return font, 1 / scale
end

local function setColor(c, alpha)
	love.graphics.setColor(c[1], c[2], c[3], (c[4] or 1) * alpha)
end

local function printIn(text, font, s, x, y, w, h, align, valign)
	local g = love.graphics
	g.setFont(font)
	local _, lines = font:getWrap(text, w / s)
	local th = #lines * font:getHeight() * s
	local ty = y
	if valign == "middle" then ty = y + (h - th) / 2 elseif valign == "bottom" then ty = y + h - th end
	g.printf(text, x, ty, w / s, align, 0, s, s)
end

---Draws text in the middle of a rectangle (for the touch pieces).
function M.printIn(text, fontPath, size, x, y, w, h)
	local font, s = scaledFont(fontPath, size)
	printIn(text, font, s, x, y, w, h, "center", "middle")
end

---------------------------------------------------------------------------

local richtext = require("love.scene.richtext")
local Label = nodeLib.classes.Label
richtext.install("Label")

-- A Label that only uses what print can do is drawn with it, as it always
-- was (the thin dark outline included).
local function plainLabel(self)
	if not richtext.plain(self) or self.fit == "shrink" then return false end
	if self.outline then
		local c = self.outlineColor
		return self.outlineWidth == 0 and c[1] == 0 and c[2] == 0 and c[3] == 0 and c[4] == 0.8
	end
	return true
end

---The text's layout and where its top-left corner is inside the label.
function Label:_textLayout()
	local st = richtext.state(self)
	local o = richtext.options(self, st)
	local _, _, w, h = self:getRect()
	o.width = w
	if self.fit == "shrink" then o.fitWidth, o.fitHeight = w, h end
	local lay = require("love.text")._prepare(st, tostring(self.text), o)
	local valign = self.valign
	local th = lay.boxHeight * lay.s
	return lay, 0, valign == "middle" and (h - th) / 2 or valign == "bottom" and h - th or 0, st
end

function Label:_drawUI(x, y, w, h, alpha)
	if not plainLabel(self) then
		return richtext.draw(self, x, y, self.color, 1, 1, 1, alpha)
	end
	local font, s = scaledFont(self.font, self.size)
	local text = tostring(self.text)
	if self.outline then
		-- One screen pixel each way, however the game is scaled.
		local px = math.max(s, 1 / math.max(1, require("love.display").scale))
		love.graphics.setColor(0, 0, 0, 0.8 * alpha)
		for _, o in ipairs({ { -1, 0 }, { 1, 0 }, { 0, -1 }, { 0, 1 } }) do
			printIn(text, font, s, x + o[1] * px, y + o[2] * px, w, h, self.align, self.valign)
		end
	end
	setColor(self.color, alpha)
	printIn(text, font, s, x, y, w, h, self.align, self.valign)
end

local Button = nodeLib.classes.Button

function Button:_drawUI(x, y, w, h, alpha)
	local g = love.graphics
	local c = self.color
	local k = 1
	local focused = M.focused == self
	if self.disabled then alpha = alpha * 0.5
	elseif self._down and M.hovered == self then k = 0.8
	elseif M.hovered == self or focused then k = 1.12 end
	g.setColor(math.min(1, c[1] * k), math.min(1, c[2] * k), math.min(1, c[3] * k), (c[4] or 1) * alpha)
	g.rectangle("fill", x, y, w, h, self.cornerRadius, self.cornerRadius)
	if focused then
		-- The focus ring: a line in the text's color just outside the button.
		setColor(self.textColor, alpha)
		g.setLineWidth(2)
		g.rectangle("line", x - 3, y - 3, w + 6, h + 6, self.cornerRadius + 3, self.cornerRadius + 3)
	end
	if self.rich or self.fit == "shrink" then
		return richtext.draw(self, x, y, self.textColor, 1, 1, 1, alpha)
	end
	local font, s = scaledFont(self.font, self.size)
	setColor(self.textColor, alpha)
	printIn(tostring(self.text), font, s, x + 4, y, w - 8, h, "center", "middle")
end

---The words' layout and where their top-left corner is inside the button.
function Button:_textLayout()
	local st = richtext.state(self)
	local o = richtext.options(self, st)
	local _, _, w, h = self:getRect()
	o.width, o.align = w - 8, "center"
	if self.fit == "shrink" then o.fitWidth, o.fitHeight = w - 8, h end
	local lay = require("love.text")._prepare(st, tostring(self.text), o)
	return lay, 4, (h - lay.boxHeight * lay.s) / 2, st
end

---True while the button is held down.
function Button:isDown()
	return self._down == true
end

---Gives the button the keyboard focus: arrow keys, the d-pad and the
---up/down/left/right actions then move between buttons, and accept presses.
function Button:focus()
	M.focused = self
end

function Button:isFocused()
	return M.focused == self
end

local Panel = nodeLib.classes.Panel

function Panel:_drawUI(x, y, w, h, alpha)
	local g = love.graphics
	setColor(self.color, alpha)
	g.rectangle("fill", x, y, w, h, self.cornerRadius, self.cornerRadius)
	if self.borderWidth > 0 then
		setColor(self.borderColor, alpha)
		g.setLineWidth(self.borderWidth)
		local b = self.borderWidth / 2
		g.rectangle("line", x + b, y + b, w - 2 * b, h - 2 * b, self.cornerRadius, self.cornerRadius)
	end
end

local Picture = nodeLib.classes.Picture

function Picture:_drawUI(x, y, w, h, alpha)
	if self.image == nil or self.image == "" then return end
	local img = assets.image(self.image)
	local iw, ih = img:getDimensions()
	local g = love.graphics
	setColor(self.color, alpha)
	local fit = self.fit
	if fit == "stretch" then
		g.draw(img, x, y, 0, w / iw, h / ih)
	elseif fit == "contain" or fit == "cover" then
		local s = (fit == "contain" and math.min or math.max)(w / iw, h / ih)
		g.push("all")
		if fit == "cover" then
			local sx0, sy0 = g.transformPoint(x, y)
			local sx1, sy1 = g.transformPoint(x + w, y + h)
			g.intersectScissor(sx0, sy0, sx1 - sx0, sy1 - sy0)
		end
		g.draw(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, 0, s, s)
		g.pop()
	elseif fit == "center" then
		g.draw(img, x + (w - iw) / 2, y + (h - ih) / 2)
	elseif fit == "tile" then
		img:setWrap("repeat", "repeat")
		local q = self._quad or love.graphics.newQuad(0, 0, w, h, iw, ih)
		q:setViewport(0, 0, w, h, iw, ih)
		self._quad = q
		g.draw(img, q, x, y)
	end
end

local Bar = nodeLib.classes.Bar

function Bar:_drawUI(x, y, w, h, alpha)
	local g = love.graphics
	local r = self.cornerRadius
	setColor(self.background, alpha)
	g.rectangle("fill", x, y, w, h, r, r)
	local range = self.max - self.min
	local t = range ~= 0 and math.max(0, math.min(1, (self.value - self.min) / range)) or 0
	if t > 0 then
		setColor(self.color, alpha)
		g.rectangle("fill", x, y, w * t, h, math.min(r, w * t / 2), math.min(r, w * t / 2))
	end
	if self.showValue then
		local font, s = scaledFont("", math.max(10, math.floor(h * 0.6)))
		g.setColor(1, 1, 1, alpha)
		printIn(("%d"):format(self.value), font, s, x, y, w, h, "center", "middle")
	end
end

---------------------------------------------------------------------------
-- Drawing and input

local drawn = {}  -- controls in draw order this frame
local drawnCount = 0

local function visit(n, px, py, pw, ph, alpha)
	if n._dead then return end
	if isUI(n) then
		if not n.visible then return end
		local x, y, w, h = layout(n, px, py, pw, ph)
		local r = n._rect
		if not r then
			r = {}
			n._rect = r
		end
		r[1], r[2], r[3], r[4] = x, y, w, h
		alpha = alpha * n.opacity
		if n._drawUI then n:_drawUI(x, y, w, h, alpha) end
		local f = n.draw
		if f then
			love.graphics.push()
			love.graphics.translate(x, y)
			love.graphics.setColor(1, 1, 1, alpha)
			f(n)
			love.graphics.pop()
		end
		drawnCount = drawnCount + 1
		drawn[drawnCount] = n
		px, py, pw, ph = x, y, w, h
	elseif n.x ~= nil and (n.scaleX ~= nil) then
		-- A Group: UI inside it still lays out against the screen.
		if n.visible == false then return end
	end
	local ch = n.children
	for i = 1, #ch do
		local c = ch[i]
		if c then visit(c, px, py, pw, ph, alpha) end
	end
end

---Draws a tree's UI (called by love.scene after the world).
function M.render(root)
	local display = require("love.display")
	drawnCount = 0
	love.graphics.push("all")
	visit(root, display.viewX, display.viewY, display.viewWidth, display.viewHeight, 1)
	love.graphics.pop()
	for i = drawnCount + 1, #drawn do drawn[i] = nil end
	-- The pointer is over the topmost control drawn under it.
	local mx, my = display.toGame(love.mouse.getPosition())
	M.hovered = M.pick(mx, my, false)
end

---The topmost UI piece at a point (in game coordinates) that answers the
---pointer: not Labels, and touch pieces only when they take this pointer
---(a finger, or the mouse on ones that are always shown).
function M.pick(x, y, finger)
	for i = drawnCount, 1, -1 do
		local c = drawn[i]
		if c._drawUI ~= nil and c.type ~= "Label" then
			local takes = c._takes
			if takes then
				if not c._dead and c._inside and takes(c, x, y, finger) then return c end
			else
				local r = c._rect
				if x >= r[1] and y >= r[2] and x < r[1] + r[3] and y < r[2] + r[4] then return c end
			end
		end
	end
	return nil
end

---True if the pointer is over a button or panel (so a game can ignore a
---click that was meant for the UI).
function M.isPointerOver()
	return M.hovered ~= nil
end
-- The [link] of a Label's rich text under a point, unless something drawn
-- over the Label covers it: the Label and the link's name.
local function linkUnder(x, y)
	for i = drawnCount, 1, -1 do
		local c = drawn[i]
		local r = c._rect
		if c._drawUI ~= nil and not c._dead and x >= r[1] and y >= r[2] and x < r[1] + r[3] and y < r[2] + r[4] then
			if c.type ~= "Label" then
				local takes = c._takes
				if not takes or (c._inside and takes(c, x, y, false)) then return nil end
			elseif c.rich then
				local name = c:linkAt(x - r[1], y - r[2])
				if name then return c, name end
			end
		end
	end
	return nil
end

---Mouse and touch events from love.engine: (kind, x, y, button) with x, y
---in game coordinates; kind is "pressed" or "released".
function M.input(root, kind, x, y, button)
	if button ~= 1 then return end
	local target = M.pick(x, y, false)
	-- Touch pieces answer fingers themselves (scene/touch.lua).
	if target and target._touchControl then target = nil end
	-- A [link] in a Label's rich text takes the press; the rest of a Label
	-- lets it through.
	local linkLabel, linkName = linkUnder(x, y)
	if linkLabel then target = nil end
	if kind == "pressed" then
		M.linkLabel, M.linkName = linkLabel, linkName
	elseif kind == "released" then
		local label, name = M.linkLabel, M.linkName
		M.linkLabel, M.linkName = nil, nil
		if label and label == linkLabel and name == linkName and not label._dead then label:emit("linkPressed", name) end
	end
	if kind == "pressed" then
		M.pressedOn = target
		if target and target.type == "Button" and not target.disabled then
			target._down = true
			-- Clicking moves the keyboard focus, once there is one.
			if M.focused then M.focused = target end
		end
	elseif kind == "released" then
		local down = M.pressedOn
		M.pressedOn = nil
		if down then
			down._down = false
			-- Buttons, Pictures and Panels: clicked() when let go over the same one.
			if down == target and not down.disabled and not down._dead then down:emit(CLICKED) end
		end
	end
end

-- Keyboard and gamepad focus: the nearest enabled Button in a direction.
local NAV = { { "up", 0, -1 }, { "down", 0, 1 }, { "left", -1, 0 }, { "right", 1, 0 } }

local function usable(c)
	return c.type == "Button" and not c.disabled and not c._dead and c._inside and c._rect ~= nil
end

local function nearest(from, dx, dy)
	local r = from._rect
	local fx, fy = r[1] + r[3] / 2, r[2] + r[4] / 2
	local best, bestScore = nil, math.huge
	for i = 1, drawnCount do
		local c = drawn[i]
		if c ~= from and usable(c) then
			local cr = c._rect
			local ox, oy = cr[1] + cr[3] / 2 - fx, cr[2] + cr[4] / 2 - fy
			local along = ox * dx + oy * dy
			if along > 1 then
				local score = along + 2 * math.abs(ox * dy + oy * dx)
				if score < bestScore then best, bestScore = c, score end
			end
		end
	end
	return best
end

local function actionPressed(input, name)
	local ok, v = pcall(input.pressed, name)
	return ok and v
end

---Every frame, even while paused (called by love.scene): hover events,
---and moving the focus with the keyboard or a gamepad.
function M.update(root)
	local h = M.hovered
	if h ~= M._hoverWas then
		local was = M._hoverWas
		M._hoverWas = h
		if was and not was._dead then was:emit("unhovered") end
		if h and not h._dead then h:emit("hovered") end
	end
	local f = M.focused
	if f and not usable(f) and (f._dead or not f._inside) then
		f = nil
		M.focused = nil
	end
	if not f then
		for i = 1, drawnCount do
			local c = drawn[i]
			if c.autofocus and not c._autofocused and usable(c) then
				c._autofocused = true
				f = c
				M.focused = c
				break
			end
		end
	end
	if not f then return end
	local input = require("love.input")
	for _, d in ipairs(NAV) do
		if actionPressed(input, d[1]) then
			local n = f._rect and nearest(f, d[2], d[3])
			if n then
				M.focused = n
				f = n
			end
			break
		end
	end
	if actionPressed(input, "accept") and usable(f) then f:emit(CLICKED) end
end

return M
