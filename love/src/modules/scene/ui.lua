-- UI nodes: Label, Button, Panel, ImageRect and ProgressBar, drawn on top of
-- the game in screen space (game coordinates, not moved by cameras).
--
-- A control's rectangle is measured from its anchor in its parent control
-- (or the screen): with anchor "bottomRight", x = 16 and y = 16 put it 16
-- pixels in from the bottom-right corner; offsets always point inwards.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")

local M = {}

local ANCHORS = {
	topLeft = { 0, 0 }, top = { 0.5, 0 }, topRight = { 1, 0 },
	left = { 0, 0.5 }, center = { 0.5, 0.5 }, right = { 1, 0.5 },
	bottomLeft = { 0, 1 }, bottom = { 0.5, 1 }, bottomRight = { 1, 1 },
}

local function isControl(n)
	return n.anchor ~= nil
end
M.isControl = isControl

local function layout(n, px, py, pw, ph)
	if n.anchor == "full" then
		return px + n.x, py + n.y, math.max(0, pw - 2 * n.x), math.max(0, ph - 2 * n.y)
	end
	local a = ANCHORS[n.anchor] or ANCHORS.topLeft
	local w, h = n.width, n.height
	local x = px + a[1] * (pw - w) + (a[1] == 1 and -n.x or n.x)
	local y = py + a[2] * (ph - h) + (a[2] == 1 and -n.y or n.y)
	return x, y, w, h
end
M.layout = layout

local Control = nodeLib.classes.Control

function Control:getRect()
	local r = self._rect
	if r then return r[1], r[2], r[3], r[4] end
	return 0, 0, self.width, self.height
end

function Control:isHovered()
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

---------------------------------------------------------------------------

local Label = nodeLib.classes.Label

function Label:_drawUI(x, y, w, h, alpha)
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
	if self.disabled then alpha = alpha * 0.5
	elseif self._down and M.hovered == self then k = 0.8
	elseif M.hovered == self then k = 1.12 end
	g.setColor(math.min(1, c[1] * k), math.min(1, c[2] * k), math.min(1, c[3] * k), (c[4] or 1) * alpha)
	g.rectangle("fill", x, y, w, h, self.cornerRadius, self.cornerRadius)
	local font, s = scaledFont(self.font, self.size)
	setColor(self.textColor, alpha)
	printIn(tostring(self.text), font, s, x + 4, y, w - 8, h, "center", "middle")
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

local ImageRect = nodeLib.classes.ImageRect

function ImageRect:_drawUI(x, y, w, h, alpha)
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

local ProgressBar = nodeLib.classes.ProgressBar

function ProgressBar:_drawUI(x, y, w, h, alpha)
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
	if isControl(n) then
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
		-- A 2D node: UI inside it still lays out against the screen.
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
	local hovered = nil
	for i = drawnCount, 1, -1 do
		local c = drawn[i]
		local r = c._rect
		if (c._drawUI ~= nil and c.type ~= "Label") and mx >= r[1] and my >= r[2] and mx < r[1] + r[3] and my < r[2] + r[4] then
			hovered = c
			break
		end
	end
	M.hovered = hovered
end

---True if the pointer is over a button or panel (so a game can ignore a
---click that was meant for the UI).
function M.isPointerOver()
	return M.hovered ~= nil
end

---Mouse and touch events from love.engine: (kind, x, y, button) with x, y
---in game coordinates; kind is "pressed" or "released".
function M.input(root, kind, x, y, button)
	if button ~= 1 then return end
	local target = nil
	for i = drawnCount, 1, -1 do
		local c = drawn[i]
		local r = c._rect
		if c._drawUI ~= nil and c.type ~= "Label" and x >= r[1] and y >= r[2] and x < r[1] + r[3] and y < r[2] + r[4] then
			target = c
			break
		end
	end
	if kind == "pressed" then
		M.pressedOn = target
		if target and target.type == "Button" and not target.disabled then target._down = true end
	elseif kind == "released" then
		local down = M.pressedOn
		M.pressedOn = nil
		if down and down.type == "Button" then
			down._down = false
			if down == target and not down.disabled and not down._dead then down:emit("pressed") end
		end
	end
end

return M
