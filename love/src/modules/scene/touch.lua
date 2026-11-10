-- Touch controls: TouchStick and TouchButton, UI pieces a finger works.
--
-- Each drives input actions through smitten.input's own setStrength(),
-- press() and release(), so a game reads a thumb on the glass the way it
-- reads a key or a gamepad: axis("left", "right"), pressed("jump").
--
-- Every finger is followed by its id, so a stick and several buttons can be
-- held at once. A touch that lands on a touch piece belongs to it and is not
-- a click as well: the game never sees it as "mouse:1", and UI under it
-- isn't pressed. Any other touch is the mouse, as it always was. (SDL turns
-- the first finger into the mouse by itself; when that finger is on a touch
-- piece, the next finger elsewhere stands in for the mouse instead.)
--
-- love.engine sends pointer events here while a scene has touch pieces.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")
local ui = require("love.scene.ui")

local M = {}

M.count = 0              -- touch pieces in the running scene

local held = {}          -- touch id (or "mouse") -> the piece it's on
local swallowed = false  -- the finger SDL made into the mouse is on a touch piece
local finger = nil       -- the id of the finger standing in for the mouse
local holds = {}         -- player -> action -> how many TouchButtons hold it

local function input() return require("love.input") end

local function toGame(x, y)
	return require("love.display").toGame(x, y)
end

-- An action name a piece was given: nil for none.
local function actionOf(name)
	if type(name) ~= "string" or name == "" then return nil end
	return name
end

-- A problem with a piece's action says which piece.
local function feed(n, fn, action, a, b)
	local ok, err = pcall(fn, action, a, b)
	if not ok then
		local why = tostring(err):gsub("^.-:%d+: ", "")
		error(("%s \"%s\": %s"):format(n.type, tostring(n.name), why), 0)
	end
end

local function hold(n, action, player)
	local byAction = holds[player]
	if not byAction then
		byAction = {}
		holds[player] = byAction
	end
	local count = (byAction[action] or 0) + 1
	byAction[action] = count
	if count == 1 then feed(n, input().press, action, player) end
end

local function letGo(n, action, player)
	local byAction = holds[player]
	local count = byAction and byAction[action]
	if not count then return end
	byAction[action] = count > 1 and count - 1 or nil
	if count == 1 then feed(n, input().release, action, player) end
end

-- Drawn on phones and tablets (and once a finger has touched the screen),
-- always, or never.
local function shown(n)
	local show = n.show
	if show == "always" then return true end
	if show == "never" then return false end
	return input().hasTouch()
end

local function playerOf(n)
	return require("love.scene.script").playerOf(n) or 1
end

local function setColor(c, alpha)
	love.graphics.setColor(c[1], c[2], c[3], (c[4] or 1) * alpha)
end

local function drawImage(path, cx, cy, size)
	local img = assets.image(path)
	local iw, ih = img:getDimensions()
	local s = size / math.max(iw, ih)
	love.graphics.draw(img, cx - iw * s / 2, cy - ih * s / 2, 0, s, s)
end

local function enter(n)
	M.count = M.count + 1
end

local function exit(n)
	M.count = M.count - 1
	for id, p in pairs(held) do
		if p == n then held[id] = nil end
	end
	-- Let go of what it held, without telling a script that's on its way out.
	if n._touch ~= nil then
		n._leaving = true
		n:_touchUp()
		n._leaving = nil
	end
	if M.count <= 0 then
		M.count = 0
		swallowed = false
		if finger ~= nil then
			finger = nil
			input()._finger = nil
		end
	end
end

---------------------------------------------------------------------------
-- TouchStick

local Stick = nodeLib.classes.TouchStick

Stick._touchControl = true
Stick._enter = enter
Stick._exit = exit

-- Where the stick rests: the middle of its rectangle.
local function restCenter(n)
	local r = n._rect
	if not r then return 0, 0 end
	return r[1] + r[3] / 2, r[2] + r[4] / 2
end

-- A fixed stick is its circle (and a little around it, for thumbs that
-- miss); a floating or following one is its whole rectangle.
function Stick:_takes(x, y, isFinger)
	if not isFinger and self.show ~= "always" then return false end
	local r = self._rect
	if self.mode == "fixed" then
		local cx, cy = restCenter(self)
		local reach = math.max(1, self.radius) * 1.3
		return (x - cx) ^ 2 + (y - cy) ^ 2 <= reach * reach
	end
	return x >= r[1] and y >= r[2] and x < r[1] + r[3] and y < r[2] + r[4]
end

local function feedStick(n)
	local fed = n._fed
	if not fed then return end
	local x, y = n._vx or 0, n._vy or 0
	local set = input().setStrength
	if fed.left then feed(n, set, fed.left, x < 0 and -x or 0, fed.player) end
	if fed.right then feed(n, set, fed.right, x > 0 and x or 0, fed.player) end
	if fed.up then feed(n, set, fed.up, y < 0 and -y or 0, fed.player) end
	if fed.down then feed(n, set, fed.down, y > 0 and y or 0, fed.player) end
end

function Stick:_touchDown(id, x, y)
	self._touch = id
	if self.mode == "fixed" then
		self._cx, self._cy = restCenter(self)
	else
		self._cx, self._cy = x, y
	end
	-- The actions and the player it feeds stay the same until it's let go.
	self._fed = {
		left = actionOf(self.leftAction), right = actionOf(self.rightAction),
		up = actionOf(self.upAction), down = actionOf(self.downAction), player = playerOf(self),
	}
	self:_touchMove(x, y)
	self:emit("pressed")
end

function Stick:_touchMove(x, y)
	local radius = math.max(1, self.radius)
	local dx, dy = x - self._cx, y - self._cy
	local len = math.sqrt(dx * dx + dy * dy)
	if len > radius then
		if self.mode == "follow" then
			-- The base is dragged along behind the thumb.
			local over = (len - radius) / len
			self._cx, self._cy = self._cx + dx * over, self._cy + dy * over
		end
		dx, dy = dx * radius / len, dy * radius / len
		len = radius
	end
	self._kx, self._ky = dx, dy
	local dead = math.max(0, math.min(0.95, self.deadzone))
	local t = len / radius
	if t > dead then
		local k = (t - dead) / (1 - dead) / len
		self._vx, self._vy = dx * k, dy * k
	else
		self._vx, self._vy = 0, 0
	end
	feedStick(self)
end

function Stick:_touchUp()
	self._touch = nil
	self._kx, self._ky, self._vx, self._vy = 0, 0, 0, 0
	feedStick(self)
	self._fed = nil
	if not self._dead and not self._leaving then self:emit("released") end
end

---Where the stick is pushed: x, y from -1 to 1 (0, 0 when it isn't touched).
function Stick:getValue()
	return self._vx or 0, self._vy or 0
end

---True while a finger is on the stick.
function Stick:isActive()
	return self._touch ~= nil
end

function Stick:_drawUI(x, y, w, h, alpha)
	if not shown(self) then return end
	local g = love.graphics
	local radius = math.max(1, self.radius)
	local cx, cy = x + w / 2, y + h / 2
	if self._touch ~= nil then cx, cy = self._cx, self._cy end
	local image = self.image
	if image ~= nil and image ~= "" then
		setColor(self.color, alpha)
		drawImage(image, cx, cy, radius * 2)
	else
		setColor(self.color, alpha)
		g.circle("fill", cx, cy, radius)
		setColor(self.color, alpha * 1.6)
		g.setLineWidth(2)
		g.circle("line", cx, cy, radius)
	end
	local kx, ky = cx + (self._kx or 0), cy + (self._ky or 0)
	local knob = radius * 0.45
	setColor(self.knobColor, alpha)
	image = self.knobImage
	if image ~= nil and image ~= "" then
		drawImage(image, kx, ky, knob * 2)
	else
		g.circle("fill", kx, ky, knob)
	end
end

---------------------------------------------------------------------------
-- TouchButton

local TButton = nodeLib.classes.TouchButton

TButton._touchControl = true
TButton._slides = true
TButton._enter = enter
TButton._exit = exit

local function contains(n, x, y)
	local r = n._rect
	if not r then return false end
	if n.shape == "rectangle" then
		return x >= r[1] and y >= r[2] and x < r[1] + r[3] and y < r[2] + r[4]
	end
	local radius = math.min(r[3], r[4]) / 2
	local cx, cy = r[1] + r[3] / 2, r[2] + r[4] / 2
	return (x - cx) ^ 2 + (y - cy) ^ 2 <= radius * radius
end

function TButton:_takes(x, y, isFinger)
	if not isFinger and self.show ~= "always" then return false end
	return contains(self, x, y)
end

local function buttonDown(n)
	if n._down then return end
	n._down = true
	local action = actionOf(n.action)
	if action then
		n._held = { action, playerOf(n) }
		hold(n, action, n._held[2])
	end
	n:emit("pressed")
end

local function buttonUp(n)
	if not n._down then return end
	n._down = false
	local was = n._held
	if was then
		n._held = nil
		letGo(n, was[1], was[2])
	end
	if not n._dead and not n._leaving then n:emit("released") end
end

function TButton:_touchDown(id, x, y)
	self._touch = id
	buttonDown(self)
end

-- A finger that slides off lets go; sliding back on presses again.
function TButton:_touchMove(x, y)
	if contains(self, x, y) then buttonDown(self) else buttonUp(self) end
end

function TButton:_touchUp()
	self._touch = nil
	buttonUp(self)
end

---True while a finger holds the button down.
function TButton:isDown()
	return self._down == true
end

function TButton:_drawUI(x, y, w, h, alpha)
	if not shown(self) then return end
	local g = love.graphics
	-- Held down, it's drawn stronger.
	local a = self._down and alpha * 1.8 or alpha
	setColor(self.color, a)
	local size = math.min(w, h)
	if self.shape == "rectangle" then
		g.rectangle("fill", x, y, w, h, self.cornerRadius, self.cornerRadius)
	else
		g.circle("fill", x + w / 2, y + h / 2, size / 2)
	end
	local image = self.image
	if image ~= nil and image ~= "" then
		g.setColor(1, 1, 1, a)
		drawImage(image, x + w / 2, y + h / 2, size * 0.7)
	end
	local text = tostring(self.text or "")
	if text ~= "" then
		setColor(self.textColor, alpha)
		ui.printIn(text, self.font, self.size, x, y, w, h)
	end
end

---------------------------------------------------------------------------
-- Pointer events (from love.engine)

local function mouse(name, x, y, c, d)
	return require("love.engine")._mouse(name, x, y, c, d)
end

local function live(p)
	return p ~= nil and not p._dead and p._inside
end

local function down(id, p, x, y)
	-- A piece already under another finger keeps that finger.
	if p._touch ~= nil then return end
	held[id] = p
	p:_touchDown(id, x, y)
end

local function move(id, p, x, y)
	-- Sliding from one button onto the next hands the finger over (a d-pad
	-- made of four buttons works under a rolling thumb).
	if p._slides and not contains(p, x, y) then
		local q = ui.pick(x, y, id ~= "mouse")
		if q and q ~= p and q._slides and q._touch == nil and live(q) then
			held[id] = nil
			p:_touchUp()
			down(id, q, x, y)
			return
		end
	end
	p:_touchMove(x, y)
end

local function up(id, p)
	held[id] = nil
	p:_touchUp()
end

---A pointer event: name, then LÖVE's arguments. Returns true if a touch
---piece took it and the game shouldn't see it as the mouse.
function M.event(name, a, b, c, d, e)
	if name == "touchpressed" then
		local x, y = toGame(b, c)
		local p = ui.pick(x, y, true)
		if p and p._touchControl then
			down(a, p, x, y)
		elseif swallowed and finger == nil then
			-- The first finger is on a touch piece; this one is the mouse.
			finger = a
			input()._finger = { b, c }
			mouse("mousepressed", b, c, 1, true)
		end
	elseif name == "touchmoved" then
		local p = held[a]
		if p then
			move(a, p, toGame(b, c))
		elseif a == finger and finger ~= nil then
			local f = input()._finger
			if f then f[1], f[2] = b, c end
			mouse("mousemoved", b, c, d, e)
		end
	elseif name == "touchreleased" then
		local p = held[a]
		if p then
			up(a, p)
		elseif a == finger and finger ~= nil then
			finger = nil
			mouse("mousereleased", b, c, 1, true)
		end
	elseif name == "mousepressed" then
		local x, y = toGame(a, b)
		if d then
			-- The mouse SDL makes from the first finger down.
			local p = ui.pick(x, y, true)
			swallowed = p ~= nil and p._touchControl == true
			if swallowed then return true end
			input()._finger = nil
			return false
		end
		input()._finger = nil
		if c == 1 then
			local p = ui.pick(x, y, false)
			if p and p._touchControl then
				down("mouse", p, x, y)
				return true
			end
		end
	elseif name == "mousemoved" then
		if e then return swallowed end
		local p = held.mouse
		if p then
			move("mouse", p, toGame(a, b))
			return true
		end
	elseif name == "mousereleased" then
		if d then
			if swallowed then
				swallowed = false
				return true
			end
			return false
		end
		local p = held.mouse
		if c == 1 and p then
			up("mouse", p)
			return true
		end
	end
	return false
end

---Lets go of everything (the window went to the background, where fingers
---that lift are never heard of).
function M.releaseAll()
	for id, p in pairs(held) do
		held[id] = nil
		p:_touchUp()
	end
	swallowed = false
	if finger ~= nil then
		finger = nil
		input()._finger = nil
		mouse("mousereleased", 0, 0, 1, true)
	end
end

return M
