-- Slider and Checkbox: UI pieces the pointer, the keyboard and a gamepad
-- work (ui.lua sends them presses, drags and the focus).

local nodeLib = require("love.scene.node")
local assets = require("love.assets")
local ui = require("love.scene.ui")

local floor, max, min = math.floor, math.max, math.min
local setColor = ui.setColor

---------------------------------------------------------------------------
-- Slider

local Slider = nodeLib.classes.Slider

Slider._focusable = true

local function range(self)
	local lo, hi = tonumber(self.min) or 0, tonumber(self.max) or 0
	if hi < lo then lo, hi = hi, lo end
	return lo, hi
end

-- A value on the slider's steps, between its ends.
local function snap(self, v)
	local lo, hi = range(self)
	local step = tonumber(self.step) or 0
	if step > 0 then v = lo + floor((v - lo) / step + 0.5) * step end
	return max(lo, min(hi, v))
end

-- Moves the slider as the player does: changed() runs if the value did.
local function move(self, v)
	v = snap(self, v)
	if v == self.value then return false end
	self.value = v
	self:emit("changed", v)
	return true
end

-- The knob's radius and the track's two ends along the way it runs.
local function track(self, x, y, w, h)
	if self.vertical then
		local r = min(w / 2, h / 2)
		return r, y + h - r, y + r
	end
	local r = min(h / 2, w / 2)
	return r, x + r, x + w - r
end

-- 0 to 1: how far along the value is.
local function fraction(self)
	local lo, hi = range(self)
	if hi == lo then return 0 end
	return max(0, min(1, ((tonumber(self.value) or lo) - lo) / (hi - lo)))
end

function Slider:_press(x, y)
	self._drag = true
	self:_dragTo(x, y)
end

function Slider:_dragTo(x, y)
	if not self._drag or self.disabled then return end
	local r = self._rect
	if not r then return end
	local _, from, to = track(self, r[1], r[2], r[3], r[4])
	local t = to ~= from and ((self.vertical and y or x) - from) / (to - from) or 0
	local lo, hi = range(self)
	move(self, lo + max(0, min(1, t)) * (hi - lo))
end

function Slider:_release()
	self._drag = false
end

-- An arrow key, the d-pad or a stick along the slider moves it; across it,
-- the focus moves on (ui.lua).
function Slider:_direction(dx, dy)
	local d
	if self.vertical then
		if dy == 0 then return false end
		d = -dy
	else
		if dx == 0 then return false end
		d = dx
	end
	local lo, hi = range(self)
	local step = tonumber(self.step) or 0
	if step <= 0 then step = (hi - lo) / 20 end
	move(self, (tonumber(self.value) or lo) + d * step)
	return true
end

---Gives the slider the keyboard focus.
function Slider:focus()
	ui.setFocus(self)
end

function Slider:isFocused()
	return ui.focused == self
end

local function knobImage(path, cx, cy, size)
	local img = assets.image(path)
	local iw, ih = img:getDimensions()
	local s = size / max(iw, ih)
	love.graphics.draw(img, cx - iw * s / 2, cy - ih * s / 2, 0, s, s)
end

function Slider:_drawUI(x, y, w, h, alpha)
	local g = love.graphics
	if self.disabled then alpha = alpha * 0.5 end
	local vertical = self.vertical
	local r, from, to = track(self, x, y, w, h)
	local t = fraction(self)
	local at = from + (to - from) * t
	local focused = ui.focused == self
	local lit = not self.disabled and (ui.hovered == self or focused or self._drag)
	if ui.hasSkin(self.skin) then
		-- The track is the picture at its own thickness (or the slider's, if
		-- that's thinner); the filled part is the same picture tinted.
		local img = assets.image(self.skin)
		local iw, ih = img:getDimensions()
		local tx, ty, tw, th = x, y, w, h
		if vertical then
			tw = min(w, iw)
			tx = x + (w - tw) / 2
		else
			th = min(h, ih)
			ty = y + (h - th) / 2
		end
		g.setColor(1, 1, 1, alpha)
		ui.drawSkin(self.skin, self.skinEdges, tx, ty, tw, th)
		if t > 0 then
			setColor(self.color, alpha)
			local sx, sy, sw, sh = g.getScissor()
			local ax, ay, bx, by
			if vertical then
				ax, ay = g.transformPoint(tx, at)
				bx, by = g.transformPoint(tx + tw, ty + th)
			else
				ax, ay = g.transformPoint(tx, ty)
				bx, by = g.transformPoint(at, ty + th)
			end
			g.intersectScissor(ax, ay, max(0, bx - ax), max(0, by - ay))
			ui.drawSkin(self.skin, self.skinEdges, tx, ty, tw, th)
			if sx then g.setScissor(sx, sy, sw, sh) else g.setScissor() end
		end
	else
		local thick = max(4, floor((vertical and w or h) / 3))
		local half = thick / 2
		setColor(self.background, alpha)
		if vertical then
			g.rectangle("fill", x + w / 2 - half, y, thick, h, half, half)
		else
			g.rectangle("fill", x, y + h / 2 - half, w, thick, half, half)
		end
		setColor(self.color, alpha)
		if vertical then
			g.rectangle("fill", x + w / 2 - half, at - half, thick, y + h - at + half, half, half)
		else
			g.rectangle("fill", x, y + h / 2 - half, at - x + half, thick, half, half)
		end
	end
	local cx, cy = at, y + h / 2
	if vertical then cx, cy = x + w / 2, at end
	local c = self.knobColor
	local k = lit and 1 or 0.9
	g.setColor(c[1] * k, c[2] * k, c[3] * k, (c[4] or 1) * alpha)
	if ui.hasSkin(self.knobImage) then
		knobImage(self.knobImage, cx, cy, r * 2)
	else
		g.circle("fill", cx, cy, r)
	end
	if focused then ui.focusRing(self.knobColor, alpha, x, y, w, h, min(w, h) / 2) end
end

---------------------------------------------------------------------------
-- Checkbox

local Checkbox = nodeLib.classes.Checkbox

Checkbox._focusable = true

local function inGroup(self)
	local g = self.group
	return type(g) == "string" and g ~= ""
end

-- Unticks the other checkboxes of a group (the ones inside the same piece
-- with the same group name).
local function untickOthers(self)
	local parent = self.parent
	if not parent then return end
	local group = self.group
	local ch = parent.children
	for i = 1, #ch do
		local c = ch[i]
		if c ~= self and c.type == "Checkbox" and c.group == group and c.checked and not c._dead then
			c.checked = false
			c._was = false
			c:emit("toggled", false)
		end
	end
end

---Flips the checkbox, as a click does. One in a group is a choice: it
---turns on and the others off, and it can't be turned off by itself.
function Checkbox:toggle()
	if inGroup(self) then
		if self.checked then return end
		self.checked = true
		self._was = true
		untickOthers(self)
	else
		self.checked = not self.checked
		self._was = self.checked
	end
	self:emit("toggled", self.checked)
end

function Checkbox:_press()
	self._down = true
end

function Checkbox:_release(x, y, over)
	if over and not self.disabled then self:toggle() end
end

function Checkbox:_accept()
	self:toggle()
end

---Gives the checkbox the keyboard focus.
function Checkbox:focus()
	ui.setFocus(self)
end

function Checkbox:isFocused()
	return ui.focused == self
end

local function boxImage(path, x, y, size)
	local img = assets.image(path)
	local iw, ih = img:getDimensions()
	local s = size / max(iw, ih)
	love.graphics.draw(img, x + (size - iw * s) / 2, y + (size - ih * s) / 2, 0, s, s)
end

function Checkbox:_drawUI(x, y, w, h, alpha)
	local g = love.graphics
	local checked = self.checked == true
	-- A script ticked one of a group: the others go off.
	if checked and not self._was and inGroup(self) then untickOthers(self) end
	self._was = checked
	if self.disabled then alpha = alpha * 0.5 end
	local focused = ui.focused == self
	local lit = not self.disabled and (ui.hovered == self or focused)
	local size = max(8, min(h, floor(self.size * 1.2 + 0.5)))
	local switch = self.look == "switch"
	local bw = switch and floor(size * 1.8 + 0.5) or size
	local by = y + (h - size) / 2
	local skin = checked and ui.hasSkin(self.skinChecked) and self.skinChecked or self.skin
	if ui.hasSkin(skin) then
		local k = lit and 1 or 0.92
		g.setColor(k, k, k, alpha)
		bw = size
		boxImage(skin, x, by, size)
	else
		local c = checked and self.color or self.background
		local k = lit and 1.15 or 1
		g.setColor(min(1, c[1] * k), min(1, c[2] * k), min(1, c[3] * k), (c[4] or 1) * alpha)
		if switch then
			g.rectangle("fill", x, by, bw, size, size / 2, size / 2)
			setColor(self.textColor, alpha)
			local kr = size / 2 - 3
			g.circle("fill", checked and x + bw - size / 2 or x + size / 2, by + size / 2, max(1, kr))
		elseif inGroup(self) then
			g.circle("fill", x + size / 2, by + size / 2, size / 2)
			if checked then
				setColor(self.textColor, alpha)
				g.circle("fill", x + size / 2, by + size / 2, max(1, size / 5))
			end
		else
			g.rectangle("fill", x, by, size, size, 4, 4)
			if checked then
				setColor(self.textColor, alpha)
				g.setLineWidth(max(2, size / 9))
				g.line(x + size * 0.22, by + size * 0.52, x + size * 0.42, by + size * 0.72, x + size * 0.78, by + size * 0.28)
			end
		end
	end
	local text = tostring(self.text or "")
	if text ~= "" then
		local font, s = ui.scaledFont(self.font, self.size)
		setColor(self.textColor, alpha)
		ui.printText(text, font, s, x + bw + 8, y, max(0, w - bw - 8), h, "left", "middle")
	end
	if focused then ui.focusRing(self.textColor, alpha, x, y, w, h, 4) end
end
