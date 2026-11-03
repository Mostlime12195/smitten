-- 2D collisions without a physics engine (DESIGN.md, section 7):
-- CharacterBody2D (moveAndSlide), StaticBody2D, Area2D, CollisionShape2D and
-- solid TileMap tiles.
--
-- Shapes are axis-aligned rectangles and circles: they move and scale with
-- their nodes but don't rotate. Characters move one axis at a time and stop
-- at the first solid in the way, which is what platformers and top-down games
-- need; RigidBody2D (rigid2d.lua, Box2D) is for things that tumble.

local nodeLib = require("love.scene.node")
local scene = require("love.scene")
local nodes2d = require("love.scene.nodes2d")

local abs, max, min, sqrt, floor = math.abs, math.max, math.min, math.sqrt, math.floor
local band = bit and bit.band or function(a, b)
	local r, m = 0, 1
	while a > 0 and b > 0 do
		if a % 2 == 1 and b % 2 == 1 then r = r + m end
		a, b, m = floor(a / 2), floor(b / 2), m * 2
	end
	return r
end

local M = {}

local bodies = {}   -- CharacterBody2D, StaticBody2D, RigidBody2D
local areas = {}
local tilemaps = {}
M.bodies, M.areas, M.tilemaps = bodies, areas, tilemaps

local function addTo(list, n)
	list[#list + 1] = n
end

local function removeFrom(list, n)
	for i = #list, 1, -1 do
		if list[i] == n then table.remove(list, i) end
	end
end

local function collides(a, b)
	return band(a.mask, b.layer) ~= 0
end

---------------------------------------------------------------------------
-- Shapes

-- The global shapes of a body or area: a list of {kind, x, y, hw, hh | r}.
-- Reuses the node's own list.
local function shapesOf(n)
	local out = n._shapes
	if not out then
		out = {}
		n._shapes = out
	end
	local k = 0
	local ch = n.children
	for i = 1, #ch do
		local s = ch[i]
		if s.type == "CollisionShape2D" and not s.disabled and not s._dead then
			local a, b, c, d, tx, ty = nodes2d.globalMatrix(s)
			local sx, sy = sqrt(a * a + b * b), sqrt(c * c + d * d)
			k = k + 1
			local sh = out[k]
			if not sh then
				sh = {}
				out[k] = sh
			end
			sh.x, sh.y = tx, ty
			if s.shape == "circle" then
				sh.kind = "circle"
				sh.r = s.radius * max(sx, sy)
				sh.hw, sh.hh = sh.r, sh.r
			else
				sh.kind = "rect"
				sh.hw, sh.hh = s.width / 2 * sx, s.height / 2 * sy
			end
		end
	end
	for i = k + 1, #out do out[i] = nil end
	return out
end
M.shapesOf = shapesOf

-- The bounding box of a node's shapes, in scene coordinates, or nil.
local function boundsOf(n)
	local shapes = shapesOf(n)
	if #shapes == 0 then return nil end
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	for i = 1, #shapes do
		local s = shapes[i]
		x0, y0 = min(x0, s.x - s.hw), min(y0, s.y - s.hh)
		x1, y1 = max(x1, s.x + s.hw), max(y1, s.y + s.hh)
	end
	return x0, y0, x1, y1
end
M.boundsOf = boundsOf

local function shapesOverlap(p, q)
	if p.kind == "circle" and q.kind == "circle" then
		local dx, dy, r = p.x - q.x, p.y - q.y, p.r + q.r
		return dx * dx + dy * dy < r * r
	elseif p.kind == "rect" and q.kind == "rect" then
		return abs(p.x - q.x) < p.hw + q.hw and abs(p.y - q.y) < p.hh + q.hh
	end
	local c, r = p, q
	if p.kind == "rect" then c, r = q, p end
	local cx = max(r.x - r.hw, min(c.x, r.x + r.hw))
	local cy = max(r.y - r.hh, min(c.y, r.y + r.hh))
	local dx, dy = c.x - cx, c.y - cy
	return dx * dx + dy * dy < c.r * c.r
end

local function nodesOverlap(a, b)
	local sa, sb = shapesOf(a), shapesOf(b)
	for i = 1, #sa do
		for j = 1, #sb do
			if shapesOverlap(sa[i], sb[j]) then return true end
		end
	end
	return false
end
M.nodesOverlap = nodesOverlap

---------------------------------------------------------------------------
-- Tile maps (tilemap.lua registers them)

function M.addTileMap(t) addTo(tilemaps, t) end
function M.removeTileMap(t) removeFrom(tilemaps, t) end

-- Calls fn(x0, y0, x1, y1, props, map) for each solid tile overlapping a box.
local function eachSolidTile(x0, y0, x1, y1, mask, fn)
	for m = 1, #tilemaps do
		local map = tilemaps[m]
		if map.collision and band(mask, map.layer) ~= 0 then
			local tw, th, ox, oy = map:_cellSize()
			if tw > 0 and th > 0 then
				local cx0, cy0 = floor((x0 - ox) / tw), floor((y0 - oy) / th)
				local cx1, cy1 = floor((x1 - ox - 1e-6) / tw), floor((y1 - oy - 1e-6) / th)
				for cy = cy0, cy1 do
					for cx = cx0, cx1 do
						local props = map:_solidAt(cx, cy)
						if props then
							local tx, ty = ox + cx * tw, oy + cy * th
							fn(tx, ty, tx + tw, ty + th, props, map)
						end
					end
				end
			end
		end
	end
end

---------------------------------------------------------------------------
-- Moving characters

local EPS = 1e-4

-- Moves a box (x0, y0, x1, y1) along one axis by delta, stopping at solids.
-- Returns the allowed delta and what was hit.
local function sweep(self, x0, y0, x1, y1, axis, delta)
	if delta == 0 then return 0, nil end
	local hit = nil
	local mask = self.mask
	-- The area the move covers.
	local sx0, sy0, sx1, sy1 = x0, y0, x1, y1
	if axis == "x" then
		if delta > 0 then sx1 = x1 + delta else sx0 = x0 + delta end
	else
		if delta > 0 then sy1 = y1 + delta else sy0 = y0 + delta end
	end
	local function block(ox0, oy0, ox1, oy1, what, oneWay)
		if axis == "x" then
			if oneWay then return end
			if y1 <= oy0 + EPS or y0 >= oy1 - EPS then return end
			if delta > 0 and x1 <= ox0 + EPS and x1 + delta > ox0 then
				delta = ox0 - x1
				hit = what
			elseif delta < 0 and x0 >= ox1 - EPS and x0 + delta < ox1 then
				delta = ox1 - x0
				hit = what
			end
		else
			if x1 <= ox0 + EPS or x0 >= ox1 - EPS then return end
			if delta > 0 and y1 <= oy0 + EPS and y1 + delta > oy0 then
				delta = oy0 - y1
				hit = what
			elseif delta < 0 and not oneWay and y0 >= oy1 - EPS and y0 + delta < oy1 then
				delta = oy1 - y0
				hit = what
			end
		end
	end
	eachSolidTile(sx0, sy0, sx1, sy1, mask, function(tx0, ty0, tx1, ty1, props, map)
		block(tx0, ty0, tx1, ty1, map, props.oneWay)
	end)
	for i = 1, #bodies do
		local b = bodies[i]
		if b ~= self and not b._dead and collides(self, b) then
			local bx0, by0, bx1, by1 = boundsOf(b)
			if bx0 and bx1 > sx0 and bx0 < sx1 and by1 > sy0 and by0 < sy1 then
				block(bx0, by0, bx1, by1, b, false)
			end
		end
	end
	return delta, hit
end

local function moveBy(self, dx, dy)
	local x0, y0, x1, y1 = boundsOf(self)
	if not x0 then
		self:translate(dx, dy)
		return dx, dy, nil, nil
	end
	local hx, hy
	dx, hx = sweep(self, x0, y0, x1, y1, "x", dx)
	x0, x1 = x0 + dx, x1 + dx
	dy, hy = sweep(self, x0, y0, x1, y1, "y", dy)
	if dx ~= 0 or dy ~= 0 then
		local gx, gy = self:getGlobalPosition()
		self:setGlobalPosition(gx + dx, gy + dy)
	end
	return dx, dy, hx, hy
end

local CharacterBody2D = nodeLib.classes.CharacterBody2D

function CharacterBody2D:_enter()
	addTo(bodies, self)
	self._onFloor, self._onWall, self._onCeiling = false, false, false
end

function CharacterBody2D:_exit()
	removeFrom(bodies, self)
end

function CharacterBody2D:moveAndSlide()
	local dt = scene.getDelta()
	-- Ride along with a moving floor.
	local floor = self._floorBody
	if floor and floor._dx and (floor._dx ~= 0 or floor._dy ~= 0) and not floor._dead then
		moveBy(self, floor._dx, floor._dy)
	end
	local wasOnFloor = self._onFloor
	local _, _, hx, hy = moveBy(self, self.vx * dt, self.vy * dt)
	self._onWall = hx ~= nil
	self._onFloor = hy ~= nil and self.vy > 0
	self._onCeiling = hy ~= nil and self.vy < 0
	self._floorBody = self._onFloor and type(hy) == "table" and hy.type ~= "TileMap" and hy or nil
	if not self._onFloor and wasOnFloor and self.vy >= 0 then
		-- Snap down small steps so walking off a slight edge doesn't bounce.
		local _, dy, _, hit = moveBy(self, 0, 2)
		if hit then self._onFloor = true else moveBy(self, 0, -dy) end
	end
	if hx then
		self.vx = 0
		if type(hx) == "table" and hx.emit then self:emit("collided", hx) end
	end
	if hy then
		self.vy = 0
		if type(hy) == "table" and hy.emit and hy ~= hx then self:emit("collided", hy) end
	end
end

function CharacterBody2D:moveAndCollide(dx, dy)
	local _, _, hx, hy = moveBy(self, dx, dy)
	return hx or hy
end

function CharacterBody2D:isOnFloor() return self._onFloor end
function CharacterBody2D:isOnWall() return self._onWall end
function CharacterBody2D:isOnCeiling() return self._onCeiling end

---The properties of a solid or non-solid tile the body overlaps that has a
---property (e.g. "damage"), or nil.
function CharacterBody2D:touchingTile(property)
	local x0, y0, x1, y1 = boundsOf(self)
	if not x0 then return nil end
	for m = 1, #tilemaps do
		local found = tilemaps[m]:_findInBox(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5, property)
		if found then return found end
	end
	return nil
end

local function overlapsWhat(self, what)
	local candidates = {}
	if type(what) == "table" then
		candidates[1] = what
	else
		for _, list in ipairs({ areas, bodies }) do
			for i = 1, #list do
				local o = list[i]
				if o ~= self and not o._dead and o:inGroup(what) then candidates[#candidates + 1] = o end
			end
		end
	end
	for _, o in ipairs(candidates) do
		if o ~= self and nodesOverlap(self, o) then return o end
	end
	return nil
end

CharacterBody2D.overlaps = overlapsWhat

---------------------------------------------------------------------------
-- Static bodies

local StaticBody2D = nodeLib.classes.StaticBody2D

function StaticBody2D:_enter()
	addTo(bodies, self)
	self._px, self._py = self:getGlobalPosition()
	self._dx, self._dy = 0, 0
end

function StaticBody2D:_exit()
	removeFrom(bodies, self)
end

---------------------------------------------------------------------------
-- Areas

local Area2D = nodeLib.classes.Area2D

function Area2D:_enter()
	addTo(areas, self)
	self._inside_ = {}
end

function Area2D:_exit()
	removeFrom(areas, self)
	if self._inside_ then
		for other in pairs(self._inside_) do
			if other._areasTouching then other._areasTouching[self] = nil end
		end
	end
	self._inside_ = nil
end

function Area2D:getOverlapping()
	local out = {}
	for o in pairs(self._inside_ or {}) do
		if not o._dead then out[#out + 1] = o end
	end
	return out
end

Area2D.overlaps = overlapsWhat

---------------------------------------------------------------------------
-- The system: area events, platform movement

local function isBody(n)
	return n.type ~= "Area2D"
end

local function stepAreas()
	for i = 1, #areas do
		local a = areas[i]
		if not a._dead and a.monitoring then
			local was = a._inside_
			local now = {}
			for _, list in ipairs({ bodies, areas }) do
				for j = 1, #list do
					local o = list[j]
					if o ~= a and not o._dead and o.type ~= "StaticBody2D" and collides(a, o) and nodesOverlap(a, o) then
						now[o] = true
					end
				end
			end
			a._inside_ = now
			for o in pairs(now) do
				if not was[o] then
					a:emit("entered", o)
					if isBody(o) and not a._dead and not o._dead then o:emit("entered", a) end
				end
			end
			for o in pairs(was) do
				if not now[o] then
					if not a._dead then a:emit("exited", o) end
					if isBody(o) and not o._dead then o:emit("exited", a) end
				end
			end
		end
	end
end

local function trackStatics()
	for i = 1, #bodies do
		local b = bodies[i]
		if b.type == "StaticBody2D" then
			local x, y = b:getGlobalPosition()
			b._dx, b._dy = x - (b._px or x), y - (b._py or y)
			b._px, b._py = x, y
		end
	end
end

scene._addSystem("collision2d", {
	order = 80,
	step = function()
		stepAreas()
		trackStatics()
	end,
	reset = function() end,
})

---------------------------------------------------------------------------
-- CollisionShape2D: drawn only when collision shapes are shown (the editor's
-- "Show collision shapes", or smitten.scene.showCollisions = true).

local CollisionShape2D = nodeLib.classes.CollisionShape2D

function CollisionShape2D:_draw()
	if not scene.showCollisions then return end
	local g = love.graphics
	g.setColor(0.3, 0.7, 1, 0.35)
	if self.shape == "circle" then
		g.circle("fill", 0, 0, self.radius)
	else
		g.rectangle("fill", -self.width / 2, -self.height / 2, self.width, self.height)
	end
end

return M
