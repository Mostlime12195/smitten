-- The pieces you see: Group's position, Sprite, Shape, Text, Camera and
-- Particles, and the renderer.
--
-- Positions are measured from the parent. A piece's world transform is the
-- affine matrix [a c tx; b d ty] of its Group ancestors and itself; it's
-- worked out when needed rather than kept up to date, since properties are
-- plain fields that scripts change freely.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")

local cos, sin, atan2, sqrt, floor = math.cos, math.sin, math.atan2, math.sqrt, math.floor

local M = {}

-- Groups and everything made from them (not UI, timers or sounds).
local function hasPosition(n)
	return n.scaleX ~= nil and n.rotation ~= nil
end
M.hasPosition = hasPosition

---The world transform of a piece: a, b, c, d, tx, ty.
local function globalMatrix(n)
	local a, b, c, d, tx, ty = 1, 0, 0, 1, 0, 0
	local chain = nil
	local p = n
	-- Collect the Group ancestors.
	local depth = 0
	local stack = M._stack
	while p do
		if hasPosition(p) then
			depth = depth + 1
			stack[depth] = p
		end
		p = p.parent
	end
	for i = depth, 1, -1 do
		local q = stack[i]
		stack[i] = nil
		local r = q.rotation
		local cr, sr = cos(r), sin(r)
		local la, lb, lc, ld = cr * q.scaleX, sr * q.scaleX, -sr * q.scaleY, cr * q.scaleY
		local x, y = q.x, q.y
		tx, ty = a * x + c * y + tx, b * x + d * y + ty
		a, b, c, d = a * la + c * lb, b * la + d * lb, a * lc + c * ld, b * lc + d * ld
	end
	return a, b, c, d, tx, ty
end
M._stack = {}
M.globalMatrix = globalMatrix

local Group = nodeLib.classes.Group

function Group:worldPosition()
	local _, _, _, _, tx, ty = globalMatrix(self)
	return tx, ty
end

function Group:toWorld(x, y)
	local a, b, c, d, tx, ty = globalMatrix(self)
	return a * x + c * y + tx, b * x + d * y + ty
end

function Group:fromWorld(x, y)
	local a, b, c, d, tx, ty = globalMatrix(self)
	local det = a * d - b * c
	if det == 0 then return 0, 0 end
	x, y = x - tx, y - ty
	return (d * x - c * y) / det, (a * y - b * x) / det
end

function Group:setWorldPosition(x, y)
	local p = self.parent
	if p and hasPosition(p) then
		x, y = p:fromWorld(x, y)
	elseif p then
		-- A parent without a position (a Timer, a Sound) passes its own parent's on.
		local q = p
		while q and not hasPosition(q) do q = q.parent end
		if q then x, y = q:fromWorld(x, y) end
	end
	self.x, self.y = x, y
end

local function point(a, b, c)
	if type(a) == "table" then return a:worldPosition() end
	return a, b
end

function Group:distanceTo(a, b)
	local x, y = self:worldPosition()
	local px, py = point(a, b)
	return sqrt((px - x) ^ 2 + (py - y) ^ 2)
end

function Group:angleTo(a, b)
	local x, y = self:worldPosition()
	local px, py = point(a, b)
	return atan2(py - y, px - x)
end

function Group:lookAt(x, y)
	local gx, gy = self:worldPosition()
	local parentRot = 0
	local p = self.parent
	while p do
		if hasPosition(p) then parentRot = parentRot + p.rotation end
		p = p.parent
	end
	self.rotation = atan2(y - gy, x - gx) - parentRot
end

function Group:moveToward(x, y, distance)
	local gx, gy = self:worldPosition()
	local dx, dy = x - gx, y - gy
	local len = sqrt(dx * dx + dy * dy)
	if len <= distance or len == 0 then
		self:setGlobalPosition(x, y)
		return true
	end
	self:setGlobalPosition(gx + dx / len * distance, gy + dy / len * distance)
	return false
end

function Group:translate(dx, dy)
	self.x, self.y = self.x + dx, self.y + dy
end

---------------------------------------------------------------------------
-- Sprite

local Sprite = nodeLib.classes.Sprite

-- The sprite sheet behind a Sprite's image: a .sprite file's data, or a
-- plain picture cut into columns x rows.
local function sheetOf(self)
	local path = self.image
	if path == nil or path == "" then return nil end
	if self._sheetPath == path and self._sheetH == self.columns and self._sheetV == self.rows then
		return self._sheet
	end
	local sheet
	if path:match("%.sprite$") then
		sheet = assets.sprite(path)
	else
		sheet = assets.sheet(path, self.columns, self.rows)
	end
	self._sheet, self._sheetPath, self._sheetH, self._sheetV = sheet, path, self.columns, self.rows
	return sheet
end
M.sheetOf = sheetOf

function Sprite:_enter()
	self._time = 0
	local sheet = sheetOf(self)
	if sheet and (self.animation == nil or self.animation == "") and sheet.defaultAnimation then
		self.animation = sheet.defaultAnimation
	end
end

function Sprite:_process(dt)
	if not self.playing then return end
	local sheet = sheetOf(self)
	if not sheet then return end
	local anim = sheet.animations[self.animation]
	if not anim then return end
	if self._animName ~= self.animation then
		self._animName = self.animation
		self._time = 0
		self._done = false
	end
	if self._done then return end
	self._time = (self._time or 0) + dt * self.speed
	local frames = anim.frames
	local i = floor(self._time * anim.fps)
	if i >= #frames then
		if anim.loop then
			i = i % #frames
		else
			i = #frames - 1
			self._done = true
			self:emit("finished", self.animation)
		end
	end
	self.frame = frames[i + 1]
end

function Sprite:play(name)
	if name and name ~= self.animation then
		local sheet = sheetOf(self)
		if sheet and not sheet.animations[name] then
			local names = {}
			for n in pairs(sheet.animations) do names[#names + 1] = n end
			error(("%s has no animation called %q%s"):format(self.image, name,
				require("love.engine.util").didYouMean(name, names)), 2)
		end
		self.animation = name
		self._time = 0
		self._done = false
	elseif name and self._done then
		self._time = 0
		self._done = false
	end
	self.playing = true
end

function Sprite:stop()
	self.playing = false
end

---True if the sprite's .sprite file has an animation with this name.
function Sprite:hasAnimation(name)
	local sheet = sheetOf(self)
	return sheet ~= nil and sheet.animations[name] ~= nil
end

function Sprite:getSize()
	local sheet = sheetOf(self)
	if not sheet then return 0, 0 end
	return sheet.frameWidth, sheet.frameHeight
end

---The rectangle the sprite covers, in its own coordinates: x, y, w, h.
function Sprite:getRect()
	local sheet = sheetOf(self)
	if not sheet then return 0, 0, 0, 0 end
	local ox, oy = sheet.originX, sheet.originY
	if not sheet.hasOrigin then
		ox = self.centered and sheet.frameWidth / 2 or 0
		oy = self.centered and sheet.frameHeight / 2 or 0
	end
	return -ox, -oy, sheet.frameWidth, sheet.frameHeight
end

function Sprite:_draw()
	local sheet = sheetOf(self)
	if not sheet then return end
	local quad = sheet.quads[(self.frame % sheet.frameCount) + 1]
	local x, y, w, h = self:getRect()
	local sx, sy = self.flipX and -1 or 1, self.flipY and -1 or 1
	love.graphics.draw(sheet.image, quad, x + (self.flipX and w or 0), y + (self.flipY and h or 0), 0, sx, sy)
end

---------------------------------------------------------------------------
-- Shape

local Shape = nodeLib.classes.Shape

function Shape:_draw(tr, tg, tb, ta)
	local c = self.color
	love.graphics.setColor(c[1] * tr, c[2] * tg, c[3] * tb, (c[4] or 1) * ta)
	local mode = self.filled and "fill" or "line"
	love.graphics.setLineWidth(self.lineWidth)
	local shape = self.shape
	if shape == "rectangle" then
		local w, h = self.width, self.height
		local x, y = self.centered and -w / 2 or 0, self.centered and -h / 2 or 0
		local r = self.cornerRadius
		love.graphics.rectangle(mode, x, y, w, h, r, r)
	elseif shape == "circle" then
		love.graphics.circle(mode, 0, 0, self.radius)
	elseif shape == "polygon" then
		local p = self.points
		if #p >= 6 then
			if mode == "fill" and not love.math.isConvex(p) then
				for _, tri in ipairs(love.math.triangulate(p)) do love.graphics.polygon("fill", tri) end
			else
				love.graphics.polygon(mode, p)
			end
		end
	elseif shape == "line" then
		if #self.points >= 4 then love.graphics.line(self.points) end
	end
end

function Shape:getRect()
	local shape = self.shape
	if shape == "rectangle" then
		local w, h = self.width, self.height
		return self.centered and -w / 2 or 0, self.centered and -h / 2 or 0, w, h
	elseif shape == "circle" then
		return -self.radius, -self.radius, self.radius * 2, self.radius * 2
	end
	local p = self.points
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	for i = 1, #p - 1, 2 do
		x0, x1 = math.min(x0, p[i]), math.max(x1, p[i])
		y0, y1 = math.min(y0, p[i + 1]), math.max(y1, p[i + 1])
	end
	if x0 > x1 then return 0, 0, 0, 0 end
	return x0, y0, x1 - x0, y1 - y0
end

---------------------------------------------------------------------------
-- Text

local Text = nodeLib.classes.Text

function Text:_draw(tr, tg, tb, ta)
	local font, scale = assets.font(self.font, self.size, M.textScale)
	local c = self.color
	love.graphics.setColor(c[1] * tr, c[2] * tg, c[3] * tb, (c[4] or 1) * ta)
	love.graphics.setFont(font)
	local text = tostring(self.text)
	local s = 1 / scale
	if self.wrap > 0 then
		local limit = self.wrap * scale
		local ox = self.align == "center" and self.wrap / 2 or self.align == "right" and self.wrap or 0
		love.graphics.printf(text, -ox, 0, limit, self.align, 0, s, s)
	else
		local w = font:getWidth(text) * s
		local ox = self.align == "center" and w / 2 or self.align == "right" and w or 0
		love.graphics.print(text, -ox, -font:getHeight() * s / 2, 0, s, s)
	end
end

---------------------------------------------------------------------------
-- Camera

local Camera = nodeLib.classes.Camera
local cameras = {}

function Camera:_enter()
	cameras[#cameras + 1] = self
	self._cx, self._cy = nil, nil
	self._shake, self._shakeTime, self._shakeLeft = 0, 0, 0
end

function Camera:_exit()
	for i = #cameras, 1, -1 do
		if cameras[i] == self then table.remove(cameras, i) end
	end
end

local function currentCamera()
	for i = 1, #cameras do
		local c = cameras[i]
		if c.active and c._inside then return c end
	end
	return nil
end
M.currentCamera = currentCamera

function Camera:_process(dt)
	local x, y = self:worldPosition()
	if self._cx == nil or self.smoothing <= 0 then
		self._cx, self._cy = x, y
	else
		local k = 1 - math.exp(-self.smoothing * dt)
		self._cx = self._cx + (x - self._cx) * k
		self._cy = self._cy + (y - self._cy) * k
	end
	if self._shakeLeft > 0 then
		self._shakeLeft = math.max(0, self._shakeLeft - dt)
	end
end

function Camera:shake(strength, seconds)
	self._shake = strength or 6
	self._shakeTime = seconds or 0.3
	self._shakeLeft = self._shakeTime
end

-- The view: where the camera looks, with limits and shake. Returns the
-- matrix from scene coordinates to game coordinates.
local function cameraMatrix()
	local display = require("love.display")
	local cam = currentCamera()
	if not cam then return 1, 0, 0, 1, 0, 0 end
	local vw, vh = display.viewWidth, display.viewHeight
	local zoom = cam.zoom
	local cx, cy = cam._cx or 0, cam._cy or 0
	local hw, hh = vw / 2 / zoom, vh / 2 / zoom
	local l, t, r, b = cam.left, cam.top, cam.right, cam.bottom
	if l and r and r - l < hw * 2 then cx = (l + r) / 2
	else
		if l and cx - hw < l then cx = l + hw end
		if r and cx + hw > r then cx = r - hw end
	end
	if t and b and b - t < hh * 2 then cy = (t + b) / 2
	else
		if t and cy - hh < t then cy = t + hh end
		if b and cy + hh > b then cy = b - hh end
	end
	if cam._shakeLeft > 0 then
		local s = cam._shake * (cam._shakeLeft / cam._shakeTime)
		cx = cx + (love.math.random() * 2 - 1) * s
		cy = cy + (love.math.random() * 2 - 1) * s
	end
	local ox, oy = display.viewX + vw / 2, display.viewY + vh / 2
	return zoom, 0, 0, zoom, ox - cx * zoom, oy - cy * zoom
end
M.cameraMatrix = cameraMatrix

---Scene coordinates of a point in game coordinates (e.g. the mouse).
function M.toWorld(gx, gy)
	local a, b, c, d, tx, ty = cameraMatrix()
	local det = a * d - b * c
	gx, gy = gx - tx, gy - ty
	return (d * gx - c * gy) / det, (a * gy - b * gx) / det
end

function M.toScreen(x, y)
	local a, b, c, d, tx, ty = cameraMatrix()
	return a * x + c * y + tx, b * x + d * y + ty
end

function Camera:screenToWorld(sx, sy) return M.toWorld(sx, sy) end
function Camera:worldToScreen(x, y) return M.toScreen(x, y) end

---------------------------------------------------------------------------
-- Particles

local Particles = nodeLib.classes.Particles
local particleImage

local function softDot()
	if particleImage then return particleImage end
	local size = 32
	local data = love.image.newImageData(size, size)
	data:mapPixel(function(x, y)
		local dx, dy = (x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1
		local a = math.max(0, 1 - sqrt(dx * dx + dy * dy))
		return 1, 1, 1, a * a
	end)
	particleImage = love.graphics.newImage(data)
	return particleImage
end

local function configure(self)
	local img = (self.image ~= nil and self.image ~= "") and assets.image(self.image) or softDot()
	local ps = self._ps
	if not ps or self._psImage ~= img then
		ps = love.graphics.newParticleSystem(img, 4096)
		self._ps, self._psImage = ps, img
	end
	local iw = img:getWidth()
	ps:setEmissionRate(self.burst and 0 or self.rate)
	local life = math.max(0.01, self.lifetime)
	ps:setParticleLifetime(life * 0.8, life)
	local spr = self.speedRandom
	ps:setSpeed(self.speed * (1 - spr), self.speed * (1 + spr))
	ps:setDirection(self.direction)
	ps:setSpread(self.spread * 2)
	ps:setLinearAcceleration(self.gravityX, self.gravityY, self.gravityX, self.gravityY)
	ps:setSizes(self.sizeStart / iw, self.sizeEnd / iw)
	local a, b = self.colorStart, self.colorEnd
	ps:setColors(a[1], a[2], a[3], a[4] or 1, b[1], b[2], b[3], b[4] or 1)
	ps:setRelativeRotation(false)
	return ps
end

function Particles:_enter()
	configure(self)
	if self.burst and self.emitting then self._ps:emit(math.floor(self.rate)) end
end

function Particles:_process(dt)
	local ps = configure(self)
	if self.emitting and not self.burst then
		if not ps:isActive() then ps:start() end
	elseif ps:isActive() then
		ps:pause()
	end
	if not self.followPiece then
		-- Particles stay where they were born: emit at the piece's world position.
		local x, y = self:worldPosition()
		ps:moveTo(x, y)
	end
	ps:update(dt)
end

function Particles:emit(count)
	configure(self):emit(count or 1)
end

function Particles:restart()
	configure(self):reset()
	if self.burst then self._ps:emit(math.floor(self.rate)) end
end

function Particles:_draw(tr, tg, tb, ta)
	if self._ps and self.followPiece then love.graphics.draw(self._ps) end
end

-- Particles that stay where they were born are drawn in scene coordinates.
function Particles:_drawWorld(tr, tg, tb, ta)
	if self._ps and not self.followPiece then love.graphics.draw(self._ps) end
end

---------------------------------------------------------------------------
-- The 2D renderer

local items = {}   -- reused draw items
local count = 0
local order = 0
local transform = love.math.newTransform()
M._world = love.math.newTransform()

local function setMatrix(t, a, b, c, d, tx, ty)
	t:setMatrix(a, c, 0, tx, b, d, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1)
end

local function collect(n, a, b, c, d, tx, ty, tr, tg, tb, ta, z)
	if n._dead then return end
	local is2d = hasPosition(n)
	if is2d then
		if not n.visible then return end
		local r = n.rotation
		local cr, sr = cos(r), sin(r)
		local la, lb, lc, ld = cr * n.scaleX, sr * n.scaleX, -sr * n.scaleY, cr * n.scaleY
		local x, y = n.x, n.y
		tx, ty = a * x + c * y + tx, b * x + d * y + ty
		a, b, c, d = a * la + c * lb, b * la + d * lb, a * lc + c * ld, b * lc + d * ld
		local t = n.tint
		tr, tg, tb, ta = tr * t[1], tg * t[2], tb * t[3], ta * (t[4] or 1)
		z = z + n.layer
		if n._draw or n.draw or n._drawWorld then
			count = count + 1
			order = order + 1
			local it = items[count]
			if not it then
				it = {}
				items[count] = it
			end
			it.node, it.a, it.b, it.c, it.d, it.tx, it.ty = n, a, b, c, d, tx, ty
			it.r, it.g, it.bl, it.al, it.z, it.order = tr, tg, tb, ta, z, order
		end
	elseif n.anchor ~= nil then
		return -- UI is drawn separately, on top
	end
	local ch = n.children
	for i = 1, #ch do
		local child = ch[i]
		if child then collect(child, a, b, c, d, tx, ty, tr, tg, tb, ta, z) end
	end
end

local function byZ(p, q)
	if p.z ~= q.z then return p.z < q.z end
	return p.order < q.order
end

---Draws the pieces of a tree (called by love.scene).
function M.render(root)
	count, order = 0, 0
	local ca, cb, cc, cd, ctx, cty = cameraMatrix()
	collect(root, ca, cb, cc, cd, ctx, cty, 1, 1, 1, 1, 0)
	for i = count + 1, #items do items[i].node = nil end
	if count == 0 then return end
	local list = M._sorted
	for i = 1, count do list[i] = items[i] end
	for i = count + 1, #list do list[i] = nil end
	table.sort(list, byZ)
	local g = love.graphics
	g.push("all")
	setMatrix(M._world, ca, cb, cc, cd, ctx, cty)
	for i = 1, count do
		local it = list[i]
		local n = it.node
		g.setColor(it.r, it.g, it.bl, it.al)
		if n._drawWorld then
			g.push()
			g.applyTransform(M._world)
			n:_drawWorld(it.r, it.g, it.bl, it.al)
			g.pop()
		end
		setMatrix(transform, it.a, it.b, it.c, it.d, it.tx, it.ty)
		g.push()
		g.applyTransform(transform)
		if n._draw then n:_draw(it.r, it.g, it.bl, it.al) end
		local f = n.draw
		if f then
			g.setColor(it.r, it.g, it.bl, it.al)
			f(n)
		end
		g.pop()
	end
	g.pop()
end
M._sorted = {}

---Font scale for crisp text when the display is scaled (set by love.display).
M.textScale = 1

return M
