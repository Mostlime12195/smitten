-- UI pieces: Label, Button, Panel, Picture and Bar, drawn on top of the game
-- in screen space (game coordinates, not moved by cameras), the containers
-- that place the pieces inside them (Row, Column, Grid, Scroll), skins, the
-- pointer and the keyboard focus. TouchStick and TouchButton are in
-- touch.lua, Slider and Checkbox in widgets.lua, TextInput in textinput.lua.
--
-- A UI piece's rectangle is measured from its anchor in its parent UI piece
-- (or the screen): with anchor "bottomRight", x = 16 and y = 16 put it 16
-- pixels in from the bottom-right corner; offsets always point inwards.
-- A piece directly inside a Row, Column, Grid or Scroll is placed by it
-- instead (uilayout.lua has the arithmetic, shared with the editor).

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

-- w, h: the size to use instead of the piece's own (a Row, Column or Grid
-- that fits what's inside it).
local function layout(n, px, py, pw, ph, w, h)
	if n.anchor == "fill" then
		return px + n.x, py + n.y, math.max(0, pw - 2 * n.x), math.max(0, ph - 2 * n.y)
	end
	local a = ANCHORS[n.anchor] or ANCHORS.topLeft
	if not w then w, h = n.width, n.height end
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

M.scaledFont, M.setColor, M.printText = scaledFont, setColor, printIn

---------------------------------------------------------------------------
-- Skins: a picture drawn instead of a piece's colored box. Its edges keep
-- their size and its middle stretches ("nine-slice"), so one small picture
-- makes a box of any size. In a pixel project pictures aren't smoothed
-- (love.assets), so the corners stay sharp.

-- skinEdges as left, top, right, bottom: a number, "8", "8, 4, 8, 4" or a
-- list. Worked out once for each value a piece has had.
local edgeCache = {}

local function edgesOf(v)
	if type(v) == "number" then return v, v, v, v end
	if type(v) == "table" then
		local l = tonumber(v[1]) or 0
		return l, tonumber(v[2]) or l, tonumber(v[3]) or l, tonumber(v[4]) or tonumber(v[2]) or l
	end
	local e = edgeCache[v]
	if not e then
		e = {}
		for part in tostring(v):gmatch("[%d%.]+") do e[#e + 1] = tonumber(part) or 0 end
		local l = e[1] or 0
		e[1], e[2], e[3], e[4] = l, e[2] or l, e[3] or l, e[4] or e[2] or l
		edgeCache[v] = e
	end
	return e[1], e[2], e[3], e[4]
end

-- The nine quads of a picture, kept with the picture for each set of edges.
local skinQuads = setmetatable({}, { __mode = "k" })

local function quadsFor(img, l, t, r, b)
	local iw, ih = img:getDimensions()
	l, r = math.min(l, iw), math.min(r, iw)
	t, b = math.min(t, ih), math.min(b, ih)
	if l + r > iw then r = iw - l end
	if t + b > ih then b = ih - t end
	local byEdges = skinQuads[img]
	if not byEdges then
		byEdges = {}
		skinQuads[img] = byEdges
	end
	local key = l .. "," .. t .. "," .. r .. "," .. b
	local q = byEdges[key]
	if not q then
		local xs, ws = { 0, l, iw - r }, { l, iw - l - r, r }
		local ys, hs = { 0, t, ih - b }, { t, ih - t - b, b }
		q = { l = l, t = t, r = r, b = b, ws = ws, hs = hs }
		for j = 1, 3 do
			for i = 1, 3 do
				q[(j - 1) * 3 + i] = ws[i] > 0 and hs[j] > 0 and love.graphics.newQuad(xs[i], ys[j], ws[i], hs[j], iw, ih) or false
			end
		end
		byEdges[key] = q
	end
	return q
end

---Draws a picture over a rectangle with its edges unstretched. The color
---is whatever is set.
function M.drawSkin(path, edges, x, y, w, h)
	local img = assets.image(path)
	local l, t, r, b = edgesOf(edges)
	local q = quadsFor(img, l, t, r, b)
	l, t, r, b = q.l, q.t, q.r, q.b
	-- A box smaller than its edges squeezes them.
	if l + r > w and l + r > 0 then
		local k = w / (l + r)
		l, r = l * k, r * k
	end
	if t + b > h and t + b > 0 then
		local k = h / (t + b)
		t, b = t * k, b * k
	end
	local g = love.graphics
	local dx1, dx2, dx3 = x, x + l, x + w - r
	local dy1, dy2, dy3 = y, y + t, y + h - b
	local dw1, dw2, dw3 = l, w - l - r, r
	local dh1, dh2, dh3 = t, h - t - b, b
	local ws, hs = q.ws, q.hs
	for j = 1, 3 do
		local dy = j == 1 and dy1 or j == 2 and dy2 or dy3
		local dh = j == 1 and dh1 or j == 2 and dh2 or dh3
		for i = 1, 3 do
			local quad = q[(j - 1) * 3 + i]
			local dw = i == 1 and dw1 or i == 2 and dw2 or dw3
			if quad and dw > 0 and dh > 0 then
				g.draw(img, quad, i == 1 and dx1 or i == 2 and dx2 or dx3, dy, 0, dw / ws[i], dh / hs[j])
			end
		end
	end
end

local function hasSkin(v)
	return v ~= nil and v ~= ""
end
M.hasSkin = hasSkin

---A skinned box in one of its states: "hover" is drawn a little lighter,
---"down" a little darker (unless the piece has pictures of its own for
---them), "off" faded by its caller's alpha.
function M.drawSkinState(n, state, x, y, w, h, alpha)
	local g = love.graphics
	local path, shade, glow = n.skin, 1, false
	if state == "down" then
		if hasSkin(n.skinDown) then path = n.skinDown else shade = 0.8 end
	elseif state == "hover" then
		if hasSkin(n.skinHover) then path = n.skinHover else glow = true end
	end
	g.setColor(shade, shade, shade, alpha)
	M.drawSkin(path, n.skinEdges, x, y, w, h)
	if glow then
		g.setBlendMode("add")
		g.setColor(1, 1, 1, 0.12 * alpha)
		M.drawSkin(path, n.skinEdges, x, y, w, h)
		g.setBlendMode("alpha")
	end
end

---The focus ring: a line just outside a piece's rectangle.
function M.focusRing(color, alpha, x, y, w, h, radius)
	local g = love.graphics
	setColor(color, alpha)
	g.setLineWidth(2)
	g.rectangle("line", x - 3, y - 3, w + 6, h + 6, radius + 3, radius + 3)
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
	if hasSkin(self.skin) then
		M.drawSkinState(self, k < 1 and "down" or k > 1 and "hover" or "normal", x, y, w, h, alpha)
	else
		g.setColor(math.min(1, c[1] * k), math.min(1, c[2] * k), math.min(1, c[3] * k), (c[4] or 1) * alpha)
		g.rectangle("fill", x, y, w, h, self.cornerRadius, self.cornerRadius)
	end
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
	M.setFocus(self)
end

Button._focusable = true

function Button:_press()
	self._down = true
end

function Button:_accept()
	self:emit(CLICKED)
end

function Button:isFocused()
	return M.focused == self
end

local Panel = nodeLib.classes.Panel

function Panel:_drawUI(x, y, w, h, alpha)
	local g = love.graphics
	if hasSkin(self.skin) then
		g.setColor(1, 1, 1, alpha)
		return M.drawSkin(self.skin, self.skinEdges, x, y, w, h)
	end
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
-- Containers: Row, Column, Grid and Scroll place the UI pieces directly
-- inside them.
--
-- Properties are plain fields, so nothing tells a container when one
-- changes. Instead each container keeps what it last laid out (its pieces,
-- their sizes and its own settings) and compares once a frame, which makes
-- no garbage; the arithmetic in uilayout.lua runs again only when
-- something differs, or its own size does.

local uilayout = require("love.scene.uilayout")
local floor, max, min, abs = math.floor, math.max, math.min, math.abs

local KINDS = { Row = "row", Column = "column", Grid = "grid" }
for name, kind in pairs(KINDS) do
	local cls = nodeLib.classes[name]
	cls._container = true
	cls._kind = kind
end

local Scroll = nodeLib.classes.Scroll
Scroll._container = true
Scroll._scroll = true

local stamp = 0  -- counts render() calls: a container is measured once in each

-- A piece a container places: a UI piece that shows.
local function isItem(c)
	return c.anchor ~= nil and c.visible and not c._dead
end

local measure

-- The size a piece asks its container for.
local function prefOf(n)
	if n._container then return measure(n) end
	return n.width, n.height
end

-- The size a container wants: its own width and height, or where they are
-- 0, what its pieces need. Notices anything that changes its layout.
function measure(n)
	if n._stamp == stamp then return n._pw, n._ph end
	n._stamp = stamp
	local sig = n._sig
	if not sig then
		sig = {}
		n._sig, n._items, n._kids, n._slots, n._opts = sig, {}, {}, {}, {}
	end
	local changed = false
	local k, count = 0, 0
	local ch = n.children
	for i = 1, #ch do
		local c = ch[i]
		if c and isItem(c) then
			count = count + 1
			local w, h = prefOf(c)
			local g = c.grow or 0
			if sig[k + 1] ~= c or sig[k + 2] ~= w or sig[k + 3] ~= h or sig[k + 4] ~= g then
				sig[k + 1], sig[k + 2], sig[k + 3], sig[k + 4] = c, w, h, g
				changed = true
			end
			k = k + 4
		end
	end
	local scroll = n._scroll
	local kind = scroll and (n.direction == "horizontal" and "row" or "column") or n._kind
	local align = scroll and "stretch" or n.alignItems
	local justify = scroll and "start" or n.justify
	local gap, pad, cols = n.gap, n.padding, n.columns or 1
	if sig[k + 1] ~= kind or sig[k + 2] ~= align or sig[k + 3] ~= justify or sig[k + 4] ~= gap or sig[k + 5] ~= pad
		or sig[k + 6] ~= cols then
		sig[k + 1], sig[k + 2], sig[k + 3], sig[k + 4], sig[k + 5], sig[k + 6] = kind, align, justify, gap, pad, cols
		changed = true
	end
	k = k + 6
	if sig[k + 1] ~= nil then
		for i = #sig, k + 1, -1 do sig[i] = nil end
		changed = true
	end
	if changed then
		local items, kids, o = n._items, n._kids, n._opts
		for j = 1, count do
			local at = (j - 1) * 4
			local it = items[j]
			if not it then
				it = {}
				items[j] = it
			end
			kids[j], it.w, it.h, it.grow = sig[at + 1], sig[at + 2], sig[at + 3], sig[at + 4]
		end
		for j = #items, count + 1, -1 do items[j], kids[j] = nil, nil end
		o.kind, o.align, o.justify, o.gap, o.padding, o.columns = kind, align, justify, tonumber(gap) or 0, tonumber(pad) or 0, cols
		n._mw, n._mh = uilayout.measure(o, items)
		n._dirty = true
	end
	local w, h = n.width, n.height
	if not scroll then
		if w <= 0 then w = n._mw end
		if h <= 0 then h = n._mh end
	end
	n._pw, n._ph = w, h
	return w, h
end

-- Moves a Scroll (clamped to what it can show) and tells its script.
local function setScroll(s, v, quiet)
	local horizontal = s.direction == "horizontal"
	local limit = horizontal and (s._maxX or 0) or (s._maxY or 0)
	v = max(0, min(limit, v))
	local was = horizontal and s.scrollX or s.scrollY
	if v == was then return false end
	if horizontal then s.scrollX = v else s.scrollY = v end
	if not quiet and not s._dead then s:emit("scrolled", s.scrollX, s.scrollY) end
	return true
end

-- Scrolls just far enough to show a piece inside (from the rectangles of
-- the last frame drawn).
local function reveal(s, p)
	local r, pr = s._rect, p._rect
	if not r or not pr then return end
	local pad = s.padding or 0
	if s.direction == "horizontal" then
		local left = pr[1] - r[1]
		if left < pad then
			setScroll(s, s.scrollX + left - pad, true)
		elseif left + pr[3] > r[3] - pad then
			setScroll(s, s.scrollX + left + pr[3] - (r[3] - pad), true)
		end
	else
		local top = pr[2] - r[2]
		if top < pad then
			setScroll(s, s.scrollY + top - pad, true)
		elseif top + pr[4] > r[4] - pad then
			setScroll(s, s.scrollY + top + pr[4] - (r[4] - pad), true)
		end
	end
end

---Scrolls just far enough to show a piece inside the Scroll.
function Scroll:scrollTo(piece)
	if type(piece) ~= "table" or piece.children == nil then
		error("scrollTo() needs a piece inside the Scroll: List:scrollTo(List.Item20)", 2)
	end
	local p = piece.parent
	while p and p ~= self do p = p.parent end
	if p ~= self then
		error(("scrollTo(): %s isn't inside %s"):format(tostring(piece), tostring(self)), 2)
	end
	-- Now if it has been drawn where it is, and again once the next frame
	-- has placed everything (a piece only just added has no place yet).
	if piece._rect and self._rect and self._maxY then reveal(self, piece) end
	self._scrollTo = piece
end

---How far it can scroll: the biggest scrollX and scrollY.
function Scroll:scrollLimit()
	return self._maxX or 0, self._maxY or 0
end

-- Nothing of its own to draw, but it answers the pointer (see pick()).
function Scroll:_drawUI()
end

-- A click on it isn't an event: it's there to be dragged.
function Scroll:_release()
end

---------------------------------------------------------------------------
-- Drawing

local drawn = {}  -- controls in draw order this frame
local drawnCount = 0
local clip = nil  -- the rectangle of the Scroll being drawn into, if any

local visit

local function visitContainer(n, x, y, w, h, alpha)
	if n._dirty or n._aw ~= w or n._ah ~= h then
		uilayout.arrange(n._opts, n._items, w, h, n._slots)
		n._aw, n._ah, n._dirty = w, h, false
	end
	local g = love.graphics
	local ox, oy = x, y
	local scroll = n._scroll
	local outer = clip
	local sx, sy, sw, sh
	if scroll then
		local horizontal = n.direction == "horizontal"
		local maxX = horizontal and max(0, n._mw - w) or 0
		local maxY = horizontal and 0 or max(0, n._mh - h)
		n._maxX, n._maxY = maxX, maxY
		local px, py = n.scrollX, n.scrollY
		if type(px) ~= "number" then px = 0 end
		if type(py) ~= "number" then py = 0 end
		local cx, cy = max(0, min(maxX, px)), max(0, min(maxY, py))
		if cx ~= n.scrollX then n.scrollX = cx end
		if cy ~= n.scrollY then n.scrollY = cy end
		ox, oy = x - floor(cx + 0.5), y - floor(cy + 0.5)
		-- Only what's inside it shows, and only that answers the pointer.
		local c = n._clipRect
		if not c then
			c = {}
			n._clipRect = c
		end
		local x0, y0, x1, y1 = x, y, x + w, y + h
		if outer then
			x0, y0 = max(x0, outer[1]), max(y0, outer[2])
			x1, y1 = min(x1, outer[1] + outer[3]), min(y1, outer[2] + outer[4])
		end
		c[1], c[2], c[3], c[4] = x0, y0, max(0, x1 - x0), max(0, y1 - y0)
		clip = c
		sx, sy, sw, sh = g.getScissor()
		local ax, ay = g.transformPoint(c[1], c[2])
		local bx, by = g.transformPoint(c[1] + c[3], c[2] + c[4])
		g.intersectScissor(ax, ay, max(0, bx - ax), max(0, by - ay))
	end
	local slots, kids = n._slots, n._kids
	local j = 0
	local ch = n.children
	for i = 1, #ch do
		local c = ch[i]
		if c then
			if kids[j + 1] == c and isItem(c) then
				j = j + 1
				visit(c, x, y, w, h, alpha, slots[j], ox, oy)
			else
				visit(c, x, y, w, h, alpha)
			end
		end
	end
	if scroll then
		if sx then g.setScissor(sx, sy, sw, sh) else g.setScissor() end
		clip = outer
		local to = n._scrollTo
		if to then
			n._scrollTo = nil
			if not to._dead then reveal(n, to) end
		end
		if n.scrollbar then
			local horizontal = n.direction == "horizontal"
			local limit = horizontal and n._maxX or n._maxY
			if limit > 0 then
				-- A thin bar along the edge: as long as the share that shows.
				local view = horizontal and w or h
				local content = view + limit
				local len = max(16, view * view / content)
				local at = (view - len) * (horizontal and n.scrollX or n.scrollY) / limit
				setColor(n.barColor, alpha)
				if horizontal then
					g.rectangle("fill", x + at, y + h - 6, len, 4, 2, 2)
				else
					g.rectangle("fill", x + w - 6, y + at, 4, len, 2, 2)
				end
			end
		end
	end
end

function visit(n, px, py, pw, ph, alpha, slot, ox, oy)
	if n._dead then return end
	if isUI(n) then
		if not n.visible then return end
		local x, y, w, h
		local container = n._container
		if slot then
			x, y, w, h = ox + slot[1], oy + slot[2], slot[3], slot[4]
			if container then measure(n) end
		elseif container then
			x, y, w, h = layout(n, px, py, pw, ph, measure(n))
		else
			x, y, w, h = layout(n, px, py, pw, ph)
		end
		local r = n._rect
		if not r then
			r = {}
			n._rect = r
		end
		r[1], r[2], r[3], r[4] = x, y, w, h
		n._clip = clip
		alpha = alpha * n.opacity
		-- Scrolled out of sight: placed (the focus can still go there) but
		-- not drawn.
		if not (clip and (x >= clip[1] + clip[3] or y >= clip[2] + clip[4] or x + w <= clip[1] or y + h <= clip[2])) then
			if n._drawUI then n:_drawUI(x, y, w, h, alpha) end
			local f = n.draw
			if f then
				love.graphics.push()
				love.graphics.translate(x, y)
				love.graphics.setColor(1, 1, 1, alpha)
				f(n)
				love.graphics.pop()
			end
		end
		drawnCount = drawnCount + 1
		drawn[drawnCount] = n
		if container then return visitContainer(n, x, y, w, h, alpha) end
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

local function pointer()
	return require("love.display").toGame(love.mouse.getPosition())
end

---Draws a tree's UI (called by love.scene after the world).
function M.render(root)
	local display = require("love.display")
	drawnCount = 0
	stamp = stamp + 1
	clip = nil
	love.graphics.push("all")
	visit(root, display.viewX, display.viewY, display.viewWidth, display.viewHeight, 1)
	love.graphics.pop()
	for i = drawnCount + 1, #drawn do drawn[i] = nil end
	-- The pointer is over the topmost control drawn under it.
	local mx, my = pointer()
	M.hovered = M.pick(mx, my, false)
end

-- True if a point is inside a piece's rectangle, and inside the Scroll it
-- shows through.
local function inside(c, x, y)
	local r = c._rect
	if not (x >= r[1] and y >= r[2] and x < r[1] + r[3] and y < r[2] + r[4]) then return false end
	local cl = c._clip
	return cl == nil or (x >= cl[1] and y >= cl[2] and x < cl[1] + cl[3] and y < cl[2] + cl[4])
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
			elseif inside(c, x, y) then
				return c
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
		if c._drawUI ~= nil and not c._dead and inside(c, x, y) then
			local r = c._rect
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

---------------------------------------------------------------------------
-- The keyboard focus: one Button, Slider, Checkbox or TextInput at a time.

-- A piece that can have the focus now.
local function usable(c)
	return c._focusable == true and not c.disabled and not c._dead and c._inside and c._rect ~= nil
end

-- The Scroll a piece is inside that has somewhere to scroll to (or any).
local function scrollOf(n, mustMove)
	local p = n
	while p do
		if p._scroll and (not mustMove or (p._maxX or 0) > 0 or (p._maxY or 0) > 0) then return p end
		p = p.parent
	end
	return nil
end

-- Tells the pieces when the focus has moved: a TextInput turns typing on
-- and off, and a piece in a Scroll is scrolled into sight.
local function syncFocus()
	local f, was = M.focused, M._focusWas
	if f == was then return end
	M._focusWas = f
	if was and was._blurred then was:_blurred() end
	if f and M.focused == f then
		if f._focused then f:_focused() end
		local p = f.parent
		while p do
			if p._scroll then
				if f._rect and p._rect and p._maxY then reveal(p, f) end
				p._scrollTo = f
			end
			p = p.parent
		end
	end
end

---Gives a piece the keyboard focus (nil: nothing has it).
function M.setFocus(n)
	M.focused = n
	syncFocus()
end

-- Keyboard and gamepad focus: the nearest piece in a direction.
local NAV = { { "up", 0, -1 }, { "down", 0, 1 }, { "left", -1, 0 }, { "right", 1, 0 } }

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

---Moves the focus to the nearest piece in a direction (dx, dy is one of
---0, -1 up; 0, 1 down; -1, 0 left; 1, 0 right). True if it moved.
function M.navigate(dx, dy)
	local f = M.focused
	local n = f and f._rect and nearest(f, dx, dy)
	if not n then return false end
	M.setFocus(n)
	return true
end

---Moves the focus to the next piece that can have it, in the order they
---are drawn (step -1: the one before), going round at the ends.
function M.focusNext(step)
	local at = 0
	for i = 1, drawnCount do
		if drawn[i] == M.focused then
			at = i
			break
		end
	end
	for k = 1, drawnCount do
		local c = drawn[(at - 1 + k * step) % drawnCount + 1]
		if c ~= M.focused and usable(c) then
			M.setFocus(c)
			return true
		end
	end
	return false
end

---------------------------------------------------------------------------
-- The pointer

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
		M.pointerDown = true
		local can = target and target._focusable and not target.disabled
		if can then
			-- Clicking moves the keyboard focus, once there is one. A
			-- TextInput always takes it: that's how typing starts.
			if M.focused or target._typing then M.focused = target end
		elseif M.focused and M.focused._typing then
			-- A click anywhere else ends the typing.
			M.focused = nil
		end
		syncFocus()
		if target and not target.disabled and target._press then target:_press(x, y) end
		-- A press inside a Scroll may turn into a drag that scrolls it.
		local s = target and not target._dragTo and scrollOf(target, true) or nil
		M.dragScroll, M.dragging = s, false
		if s then
			M.dragX, M.dragY = x, y
			M.dragFrom = s.direction == "horizontal" and s.scrollX or s.scrollY
			s._vel = nil
		end
	elseif kind == "released" then
		local down = M.pressedOn
		M.pressedOn = nil
		M.pointerDown = false
		local s = M.dragScroll
		M.dragScroll = nil
		if M.dragging then
			-- Let go while moving: it glides on.
			M.dragging = false
			if s and not s._dead and abs(s._vel or 0) > 40 then M._glide = s end
			return
		end
		if down then
			down._down = false
			if down._release then
				if not down._dead then down:_release(x, y, down == target) end
			elseif down == target and not down.disabled and not down._dead then
				-- Buttons, Pictures and Panels: clicked() when let go over the same one.
				down:emit(CLICKED)
			end
		end
	end
end

---The mouse wheel (from love.engine): scrolls the Scroll under the pointer.
function M.wheel(dx, dy)
	local mx, my = pointer()
	local over = M.pick(mx, my, false)
	local s = over and scrollOf(over, true)
	if not s then return false end
	s._vel = nil
	local horizontal = s.direction == "horizontal"
	local turn = horizontal and (dx ~= 0 and dx or -dy) or -dy
	return setScroll(s, (horizontal and s.scrollX or s.scrollY) + turn * 48)
end

---Keys and typed text (from love.engine) while a TextInput has the focus.
---True if the TextInput took it, and the game shouldn't see it as input.
function M.keyEvent(name, a, b, c)
	local f = M.focused
	if not (f and f._typing) or f._dead or not f._inside or f.disabled then return false end
	if name == "keypressed" then return f:_key(a, c) end
	if name == "textinput" then
		f:_type(a)
		return true
	end
	return false
end

local function actionPressed(input, name, player)
	local ok, v = pcall(input.pressed, name, player)
	return ok and v
end

local function actionDown(input, name, player)
	local ok, v = pcall(input.down, name, player)
	return ok and v
end

-- A direction a piece uses itself (a Slider's own way) repeats while held.
local REPEAT_AFTER, REPEAT_EVERY = 0.4, 0.07
local heldName, heldTime = nil, 0

---Every frame, even while paused (called by love.scene): hover events,
---dragging, and moving the focus with the keyboard or a gamepad.
function M.update(root)
	local now = love.timer.getTime()
	local dt = min(0.1, max(0, now - (M._now or now)))
	M._now = now
	local h = M.hovered
	if h ~= M._hoverWas then
		local was = M._hoverWas
		M._hoverWas = h
		if was and not was._dead then was:emit("unhovered") end
		if h and not h._dead then h:emit("hovered") end
	end
	-- The pointer held down: a Slider or a TextInput follows it, and a
	-- press inside a Scroll that moves far enough scrolls it instead.
	if M.pointerDown then
		local p = M.pressedOn
		local mx, my = pointer()
		if p and p._dragTo then
			if not p._dead then p:_dragTo(mx, my) end
		else
			local s = M.dragScroll
			if s and not s._dead then
				local horizontal = s.direction == "horizontal"
				local d = horizontal and mx - M.dragX or my - M.dragY
				local at = horizontal and s.scrollX or s.scrollY
				if not M.dragging and abs(d) > 6 then
					M.dragging = true
					-- What was pressed isn't clicked after all.
					if p then
						p._down = false
						M.pressedOn = nil
					end
				end
				if M.dragging then
					setScroll(s, M.dragFrom - d)
					local to = horizontal and s.scrollX or s.scrollY
					if dt > 0 then s._vel = 0.6 * (to - at) / dt + 0.4 * (s._vel or 0) end
				end
			end
		end
	end
	local glide = M._glide
	if glide then
		local v = glide._vel or 0
		if glide._dead or abs(v) < 20 or M.pointerDown
			or not setScroll(glide, (glide.direction == "horizontal" and glide.scrollX or glide.scrollY) + v * dt) then
			M._glide = nil
			glide._vel = nil
		else
			glide._vel = v * max(0, 1 - 4 * dt)
		end
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
	syncFocus()
	f = M.focused
	if not f then
		heldName = nil
		return
	end
	local input = require("love.input")
	-- Any player works a menu, unless the piece (or one it's inside) has a
	-- player: then only that player does.
	local player = require("love.scene.script").playerOf(f)
	local took = false
	for _, d in ipairs(NAV) do
		local name = d[1]
		local again = false
		if name == heldName then
			if actionDown(input, name, player) then
				heldTime = heldTime + dt
				if heldTime >= REPEAT_AFTER then
					heldTime = heldTime - REPEAT_EVERY
					again = true
				end
			else
				heldName = nil
			end
		end
		if again or actionPressed(input, name, player) then
			if f._direction and f:_direction(d[2], d[3]) then
				if not again then heldName, heldTime = name, 0 end
			elseif not again then
				M.navigate(d[2], d[3])
				f = M.focused
			end
			took = true
			break
		end
	end
	-- Tab and Shift+Tab go to the next piece and the one before. (A
	-- TextInput gets its keys, Tab among them, from keyEvent().)
	if not took and not f._typing and input._rawPressed("tab") then
		M.focusNext((input._rawDown("lshift") or input._rawDown("rshift")) and -1 or 1)
		f = M.focused
	end
	if actionPressed(input, "accept", player) and usable(f) and f._accept then f:_accept() end
	-- cancel (gamepad B) ends typing; the keyboard's Escape does in keyEvent().
	if f._typing and actionPressed(input, "cancel", player) then M.setFocus(nil) end
end

return M
