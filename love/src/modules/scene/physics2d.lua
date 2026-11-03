-- Bodies and zones (DESIGN.md, section 7).
--
-- A Body is solid. Its motion says how it moves: "still" (walls, floors,
-- platforms a script slides around), "scripted" (players and enemies: the
-- script sets vx, vy and calls move()) or "physics" (rigid2d.lua: Box2D makes
-- it fall and tumble). A Zone notices things going in and out.
--
-- Shapes are part of the Body or Zone: "auto" fits the Sprites and Shapes
-- inside it, or a rectangle or circle of a set size; Hitbox children add more.
-- Shapes move and scale with their pieces but don't rotate. Tags filter what
-- touches what: a body passes through bodies with a tag in its passThrough,
-- and a zone only notices things with a tag in its detects.

local nodeLib = require("love.scene.node")
local scene = require("love.scene")
local nodes2d = require("love.scene.nodes2d")

local abs, max, min, sqrt, floor = math.abs, math.max, math.min, math.sqrt, math.floor

local M = {}

local bodies = {}   -- every Body, whatever its motion
local zones = {}
local tilemaps = {}
M.bodies, M.zones, M.tilemaps = bodies, zones, tilemaps

-- Each piece knows its place in its list (n._index), so the broadphase can
-- give back candidates in list order: what touches first wins ties.
local function addTo(list, n)
	list[#list + 1] = n
	n._index = #list
end

local function removeFrom(list, n)
	for i = #list, 1, -1 do
		if list[i] == n then table.remove(list, i) end
	end
	for i = 1, #list do list[i]._index = i end
end

-- Whether two bodies bump into each other.
local function collides(a, b)
	return not (b:hasAnyTag(a.passThrough) or a:hasAnyTag(b.passThrough))
end
M.collides = collides

local function passesTiles(body)
	return body.passThrough ~= nil and body.passThrough:find("tiles", 1, true) ~= nil
end

---------------------------------------------------------------------------
-- Shapes

-- The rectangle the visible pieces inside a piece cover, in its own
-- coordinates (x0, y0, x1, y1), and whether it's a lone circle Shape.
local function visualBounds(n)
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	local circle = nil
	local count = 0
	for _, c in ipairs(n.children) do
		if c.getRect and c.visible ~= false and not c._dead and c.type ~= "Hitbox" then
			local rx, ry, rw, rh = c:getRect()
			if rw > 0 and rh > 0 then
				count = count + 1
				local sx, sy = c.scaleX, c.scaleY
				local ax, bx = c.x + rx * sx, c.x + (rx + rw) * sx
				local ay, by = c.y + ry * sy, c.y + (ry + rh) * sy
				x0, x1 = min(x0, ax, bx), max(x1, ax, bx)
				y0, y1 = min(y0, ay, by), max(y1, ay, by)
				if c.type == "Shape" and c.shape == "circle" then circle = c end
			end
		end
	end
	if count == 0 then return nil end
	return x0, y0, x1, y1, count == 1 and circle or nil
end

local function push(out, k, kind, x, y, hw, hh, r)
	local sh = out[k]
	if not sh then
		sh = {}
		out[k] = sh
	end
	sh.kind, sh.x, sh.y, sh.hw, sh.hh, sh.r = kind, x, y, hw, hh, r
end

-- The world shapes of a body or zone: a reused list of {kind, x, y, hw, hh, r}.
local function shapesOf(n)
	local out = n._shapes
	if not out then
		out = {}
		n._shapes = out
	end
	local k = 0
	local a, b, c, d, tx, ty = nodes2d.globalMatrix(n)
	local sx, sy = sqrt(a * a + b * b), sqrt(c * c + d * d)
	local kind = n.shape
	if kind == "auto" then
		local x0, y0, x1, y1, circle = visualBounds(n)
		if x0 then
			local cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
			local wx, wy = a * cx + c * cy + tx, b * cx + d * cy + ty
			k = k + 1
			if circle then
				local r = circle.radius * abs(circle.scaleX) * max(sx, sy)
				push(out, k, "circle", wx, wy, r, r, r)
			else
				push(out, k, "rect", wx, wy, (x1 - x0) / 2 * sx, (y1 - y0) / 2 * sy)
			end
		end
	elseif kind == "rectangle" then
		k = k + 1
		push(out, k, "rect", tx, ty, n.width / 2 * sx, n.height / 2 * sy)
	elseif kind == "circle" then
		k = k + 1
		local r = n.radius * max(sx, sy)
		push(out, k, "circle", tx, ty, r, r, r)
	end
	for _, h in ipairs(n.children) do
		if h.type == "Hitbox" and not h.off and not h._dead then
			local ha, hb, hc, hd, htx, hty = nodes2d.globalMatrix(h)
			local hsx, hsy = sqrt(ha * ha + hb * hb), sqrt(hc * hc + hd * hd)
			k = k + 1
			if h.shape == "circle" then
				local r = h.radius * max(hsx, hsy)
				push(out, k, "circle", htx, hty, r, r, r)
			else
				push(out, k, "rect", htx, hty, h.width / 2 * hsx, h.height / 2 * hsy)
			end
		end
	end
	for i = k + 1, #out do out[i] = nil end
	return out
end
M.shapesOf = shapesOf

-- The box around a piece's shapes, in the scene, or nil.
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

---------------------------------------------------------------------------
-- Broadphase: a grid of boxes, so a move or a zone only looks at what's near
-- it instead of at every body in the scene.

local CELL = 128
local MAX_CELLS = 256  -- bigger boxes go in a list that every query sees

local Grid = {}
Grid.__index = Grid

local grids = 0

local function newGrid()
	grids = grids + 1
	-- The field a query marks pieces with, so each is listed once.
	return setmetatable({ cells = {}, ranges = {}, big = {}, spare = {}, clears = 0, query = 0, mark = "_near" .. grids }, Grid)
end

local function key(cx, cy) return cx * 4194304 + cy end

-- Empties the grid, keeping its tables for next time (it's refilled every step).
function Grid:clear()
	for _, list in pairs(self.cells) do
		for i = #list, 1, -1 do list[i] = nil end
	end
	local spare = self.spare
	for n, r in pairs(self.ranges) do
		if r then spare[#spare + 1] = r end
		self.ranges[n] = nil
	end
	for n in pairs(self.big) do self.big[n] = nil end
	-- Lists for cells nothing has used in a while go, now and then.
	self.clears = self.clears + 1
	if self.clears % 600 == 0 then self.cells = {} end
end

function Grid:insert(n, x0, y0, x1, y1)
	local cx0, cy0, cx1, cy1 = floor(x0 / CELL), floor(y0 / CELL), floor(x1 / CELL), floor(y1 / CELL)
	if (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS then
		self.big[n] = true
		self.ranges[n] = false
		return
	end
	local cells = self.cells
	for cy = cy0, cy1 do
		for cx = cx0, cx1 do
			local k = key(cx, cy)
			local list = cells[k]
			if not list then
				list = {}
				cells[k] = list
			end
			list[#list + 1] = n
		end
	end
	local spare = self.spare
	local r = spare[#spare]
	if r then spare[#spare] = nil else r = {} end
	r[1], r[2], r[3], r[4] = cx0, cy0, cx1, cy1
	self.ranges[n] = r
end

function Grid:remove(n)
	local r = self.ranges[n]
	if r == nil then return end
	self.ranges[n] = nil
	if r == false then
		self.big[n] = nil
		return
	end
	self.spare[#self.spare + 1] = r
	local cells = self.cells
	for cy = r[2], r[4] do
		for cx = r[1], r[3] do
			local list = cells[key(cx, cy)]
			for i = #list, 1, -1 do
				if list[i] == n then
					list[i] = list[#list]
					list[#list] = nil
					break
				end
			end
		end
	end
end

-- What's in the cells a box touches (and every big box), once each, in no
-- particular order, or nil when the box covers too many cells to be worth it.
function Grid:near(x0, y0, x1, y1, out)
	local cx0, cy0, cx1, cy1 = floor(x0 / CELL), floor(y0 / CELL), floor(x1 / CELL), floor(y1 / CELL)
	if (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS then return nil end
	self.query = self.query + 1
	local q, mark = self.query, self.mark
	local count = 0
	local cells = self.cells
	for cy = cy0, cy1 do
		for cx = cx0, cx1 do
			local list = cells[key(cx, cy)]
			if list then
				for i = 1, #list do
					local n = list[i]
					if n[mark] ~= q then
						n[mark] = q
						count = count + 1
						out[count] = n
					end
				end
			end
		end
	end
	for n in pairs(self.big) do
		if n[mark] ~= q then
			n[mark] = q
			count = count + 1
			out[count] = n
		end
	end
	for i = count + 1, #out do out[i] = nil end
	return out
end

local function byIndex(p, q) return p._index < q._index end

-- The bodies, for moves. It's built from scratch the first time something
-- moves in each physics step and each update (scene.lua's tree.epoch counts
-- them). Within one, a body is put back where it now is when it moves, and
-- after its own script's physicsUpdate() or update() if that changed its
-- position, angle or scale. Boxes go in with a margin, so a body that
-- something else moved a little is still found; the bodies near a move are
-- then measured afresh.
local MARGIN = 32
local bodyGrid = newGrid()
local gridEpoch = nil
local near = {}

local function placeBody(b)
	b._gx, b._gy, b._gr, b._gsx, b._gsy, b._gparent = b.x, b.y, b.rotation, b.scaleX, b.scaleY, b.parent
	b._gepoch = gridEpoch
	local x0, y0, x1, y1 = boundsOf(b)
	if x0 then bodyGrid:insert(b, x0 - MARGIN, y0 - MARGIN, x1 + MARGIN, y1 + MARGIN) end
end

local function regrid(b)
	bodyGrid:remove(b)
	placeBody(b)
end

local function refreshGrid()
	local epoch = scene._tree.epoch
	if epoch == gridEpoch then return end
	gridEpoch = epoch
	bodyGrid:clear()
	for i = 1, #bodies do placeBody(bodies[i]) end
end

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

local function overlap(a, b)
	local sa, sb = shapesOf(a), shapesOf(b)
	for i = 1, #sa do
		for j = 1, #sb do
			if shapesOverlap(sa[i], sb[j]) then return true end
		end
	end
	return false
end
M.overlap = overlap

---------------------------------------------------------------------------
-- Tiles (tilemap.lua registers them)

function M.addTiles(t) addTo(tilemaps, t) end
function M.removeTiles(t) removeFrom(tilemaps, t) end

---------------------------------------------------------------------------
-- Moving scripted bodies

local EPS = 1e-4

-- What sweep() is working on. block() reads and updates it; sweeps don't
-- nest, and keeping it here saves making two closures per sweep.
local axis, delta, hit, bx0, by0, bx1, by1

-- Counts move() and moveBy() calls. Only the moving body changes during one,
-- so the others are measured once per call however many sweeps it takes.
local moveStamp = 0

local function boundsDuringMove(b)
	if b._moveStamp ~= moveStamp then
		b._moveStamp = moveStamp
		b._mx0, b._my0, b._mx1, b._my1 = boundsOf(b)
	end
	return b._mx0, b._my0, b._mx1, b._my1
end

-- Shortens the sweep if it runs into the box (ox0, oy0, ox1, oy1).
local function block(ox0, oy0, ox1, oy1, what, oneWay)
	local x0, y0, x1, y1 = bx0, by0, bx1, by1
	if axis == "x" then
		if oneWay then return end
		if y1 <= oy0 + EPS or y0 >= oy1 - EPS then return end
		if delta > 0 and x1 <= ox0 + EPS and x1 + delta > ox0 then
			delta, hit = ox0 - x1, what
		elseif delta < 0 and x0 >= ox1 - EPS and x0 + delta < ox1 then
			delta, hit = ox1 - x0, what
		end
	else
		if x1 <= ox0 + EPS or x0 >= ox1 - EPS then return end
		if delta > 0 and y1 <= oy0 + EPS and y1 + delta > oy0 then
			delta, hit = oy0 - y1, what
		elseif delta < 0 and not oneWay and y0 >= oy1 - EPS and y0 + delta < oy1 then
			delta, hit = oy1 - y0, what
		end
	end
end

-- Moves a box along one axis by delta, stopping at the first solid thing.
-- Returns the allowed delta and what it hit.
local function sweep(self, x0, y0, x1, y1, sweepAxis, sweepDelta)
	if sweepDelta == 0 then return 0, nil end
	axis, delta, hit = sweepAxis, sweepDelta, nil
	bx0, by0, bx1, by1 = x0, y0, x1, y1
	local sx0, sy0, sx1, sy1 = x0, y0, x1, y1
	if axis == "x" then
		if delta > 0 then sx1 = x1 + delta else sx0 = x0 + delta end
	else
		if delta > 0 then sy1 = y1 + delta else sy0 = y0 + delta end
	end
	if not passesTiles(self) then
		-- The solid tiles in the swept box.
		for m = 1, #tilemaps do
			local map = tilemaps[m]
			if map.solid then
				local tw, th, ox, oy = map:_cellSize()
				if tw > 0 and th > 0 then
					local cx0, cy0 = floor((sx0 - ox) / tw), floor((sy0 - oy) / th)
					local cx1, cy1 = floor((sx1 - ox - 1e-6) / tw), floor((sy1 - oy - 1e-6) / th)
					for cy = cy0, cy1 do
						for cx = cx0, cx1 do
							local info = map:_solidAt(cx, cy)
							if info then
								local tx, ty = ox + cx * tw, oy + cy * th
								block(tx, ty, tx + tw, ty + th, map, info.oneWay)
							end
						end
					end
				end
			end
		end
	end
	-- The bodies near the sweep, in the order of the list of bodies.
	local list = bodyGrid:near(sx0, sy0, sx1, sy1, near)
	if list then table.sort(list, byIndex) else list = bodies end
	for i = 1, #list do
		local b = list[i]
		if b ~= self and not b._dead and collides(self, b) then
			local ox0, oy0, ox1, oy1 = boundsDuringMove(b)
			if ox0 and ox1 > sx0 and ox0 < sx1 and oy1 > sy0 and oy0 < sy1 then
				block(ox0, oy0, ox1, oy1, b, false)
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
		local gx, gy = self:worldPosition()
		self:setWorldPosition(gx + dx, gy + dy)
		regrid(self)
	end
	return dx, dy, hx, hy
end

local Body = nodeLib.classes.Body

function Body:_enter()
	addTo(bodies, self)
	self._onGround, self._onWall, self._onCeiling = false, false, false
	self._px, self._py = self:worldPosition()
	self._dx, self._dy = 0, 0
	if gridEpoch == scene._tree.epoch then placeBody(self) end
	if self.motion == "physics" then require("love.scene.rigid2d").add(self) end
end

function Body:_exit()
	removeFrom(bodies, self)
	bodyGrid:remove(self)
	self._gepoch = nil
	if self._rigid then require("love.scene.rigid2d").remove(self) end
end

-- Called by scene.lua after the body's own script ran.
function Body:_afterScript()
	if self._gepoch == gridEpoch and (self._gx ~= self.x or self._gy ~= self.y or self._gr ~= self.rotation
		or self._gsx ~= self.scaleX or self._gsy ~= self.scaleY or self._gparent ~= self.parent) then
		regrid(self)
	end
end

function Body:move()
	if self.motion ~= "scripted" then
		if self.motion == "physics" then return end
		error("move() is for bodies whose motion is \"scripted\"; this one is \"" .. tostring(self.motion) .. "\"", 2)
	end
	local dt = scene.getDelta()
	refreshGrid()
	moveStamp = moveStamp + 1
	-- Ride along with a moving platform.
	local ground = self._groundBody
	if ground and (ground._dx ~= 0 or ground._dy ~= 0) and not ground._dead then
		moveBy(self, ground._dx, ground._dy)
	end
	local wasOnGround = self._onGround
	local _, _, hx, hy = moveBy(self, self.vx * dt, self.vy * dt)
	self._onWall = hx ~= nil
	self._onGround = hy ~= nil and self.vy > 0
	self._onCeiling = hy ~= nil and self.vy < 0
	self._groundBody = self._onGround and type(hy) == "table" and hy.type == "Body" and hy or nil
	if not self._onGround and wasOnGround and self.vy >= 0 then
		-- Snap down small steps so walking off a slight edge doesn't bounce.
		local _, dy, _, hit = moveBy(self, 0, 2)
		if hit then self._onGround = true else moveBy(self, 0, -dy) end
	end
	if hx then
		self.vx = 0
		if type(hx) == "table" and hx.emit then self:emit("hit", hx) end
	end
	if hy then
		self.vy = 0
		if type(hy) == "table" and hy.emit and hy ~= hx then self:emit("hit", hy) end
	end
end

function Body:moveBy(dx, dy)
	refreshGrid()
	moveStamp = moveStamp + 1
	local _, _, hx, hy = moveBy(self, dx, dy)
	return hx or hy
end

function Body:onGround() return self._onGround == true end
function Body:onWall() return self._onWall == true end
function Body:onCeiling() return self._onCeiling == true end

function Body:getSize()
	local x0, y0, x1, y1 = boundsOf(self)
	if not x0 then return 0, 0 end
	return x1 - x0, y1 - y0
end

function Body:touchingTile(setting)
	local x0, y0, x1, y1 = boundsOf(self)
	if not x0 then return nil end
	for m = 1, #tilemaps do
		local found = tilemaps[m]:_findInBox(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5, setting)
		if found then return found end
	end
	return nil
end

function Body:push(ix, iy)
	if self._rigid then self._rigid:applyLinearImpulse(ix, iy) end
end

function Body:applyForce(fx, fy)
	if self._rigid then self._rigid:applyForce(fx, fy) end
end

local function touching(self, what)
	local candidates = {}
	if type(what) == "table" then
		candidates[1] = what
	else
		for _, list in ipairs({ zones, bodies }) do
			for i = 1, #list do
				local o = list[i]
				if o ~= self and not o._dead and o:hasTag(what) then candidates[#candidates + 1] = o end
			end
		end
	end
	for _, o in ipairs(candidates) do
		if o ~= self and not o._dead and overlap(self, o) then return o end
	end
	return nil
end

Body.touching = touching

---------------------------------------------------------------------------
-- Zones

local Zone = nodeLib.classes.Zone

function Zone:_enter()
	addTo(zones, self)
	self._in = {}
end

function Zone:_exit()
	removeFrom(zones, self)
	self._in = nil
end

function Zone:inside()
	local out = {}
	for o in pairs(self._in or {}) do
		if not o._dead then out[#out + 1] = o end
	end
	return out
end

Zone.touching = touching

local function detects(zone, other)
	local list = zone.detects
	return list == nil or list == "" or other:hasAnyTag(list)
end

-- Whether emitting an event to a piece runs anything (which may move things).
local function handles(n, event)
	if type(n[event]) == "function" then return true end
	local list = n._listeners and n._listeners[event]
	return list ~= nil and #list > 0
end

-- The shapes of every zone and every body that isn't still, measured once
-- and put in a grid. Nothing moves while zones are checked unless an
-- entered/exited handler runs, and then they're measured again.
local zoneGrid = newGrid()
local zoneOrder = {}  -- piece -> its place: bodies first, then zones
local zoneNear = {}

local function measureForZones()
	zoneGrid:clear()
	local order = {}
	zoneOrder = order
	for _, list in ipairs({ bodies, zones }) do
		for j = 1, #list do
			local o = list[j]
			if not o._dead and o.motion ~= "still" then
				local x0, y0, x1, y1 = boundsOf(o)  -- fills o._shapes
				if x0 then
					order[o] = list == bodies and j or #bodies + j
					zoneGrid:insert(o, x0, y0, x1, y1)
				end
			end
		end
	end
end

local function byZoneOrder(p, q) return zoneOrder[p] < zoneOrder[q] end

-- overlap() with the shapes measured by measureForZones().
local function overlapMeasured(a, b)
	local sa, sb = a._shapes, b._shapes
	for i = 1, #sa do
		for j = 1, #sb do
			if shapesOverlap(sa[i], sb[j]) then return true end
		end
	end
	return false
end

local function stepZones()
	if #zones == 0 then return end
	measureForZones()
	local stale = false
	for i = 1, #zones do
		local z = zones[i]
		if not z._dead and z.active then
			if stale then
				measureForZones()
				stale = false
			end
			local was = z._in
			local now = {}
			if zoneOrder[z] then
				-- A zone with no shapes touches nothing.
				local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
				for _, sh in ipairs(z._shapes) do
					x0, y0 = min(x0, sh.x - sh.hw), min(y0, sh.y - sh.hh)
					x1, y1 = max(x1, sh.x + sh.hw), max(y1, sh.y + sh.hh)
				end
				local list = zoneGrid:near(x0, y0, x1, y1, zoneNear)
				if not list then
					list = zoneNear
					local k = 0
					for o in pairs(zoneOrder) do
						k = k + 1
						list[k] = o
					end
					for j = k + 1, #list do list[j] = nil end
				end
				table.sort(list, byZoneOrder)
				for j = 1, #list do
					local o = list[j]
					if o ~= z and detects(z, o) and overlapMeasured(z, o) then
						now[o] = true
					end
				end
			end
			z._in = now
			for o in pairs(now) do
				if not was[o] then
					stale = stale or handles(z, "entered") or (o.type == "Body" and handles(o, "entered"))
					z:emit("entered", o)
					if o.type == "Body" and not z._dead and not o._dead then o:emit("entered", z) end
				end
			end
			for o in pairs(was) do
				if not now[o] then
					stale = stale or handles(z, "exited") or (o.type == "Body" and handles(o, "exited"))
					if not z._dead then z:emit("exited", o) end
					if o.type == "Body" and not o._dead then o:emit("exited", z) end
				end
			end
		end
	end
end

-- Still bodies carry scripted bodies standing on them when a script moves them.
local function trackStill()
	for i = 1, #bodies do
		local b = bodies[i]
		if b.motion == "still" then
			local x, y = b:worldPosition()
			b._dx, b._dy = x - (b._px or x), y - (b._py or y)
			b._px, b._py = x, y
		end
	end
end

scene._addSystem("collision2d", {
	order = 80,
	step = function()
		stepZones()
		trackStill()
	end,
})

---------------------------------------------------------------------------
-- Showing shapes (the editor's "Shapes" switch, or smitten.scene.showShapes)

local function drawShapes(self)
	if not scene.showShapes then return end
	-- Drawn in scene coordinates (the renderer applies the camera).
	local g = love.graphics
	g.setColor(0.3, 0.7, 1, 0.3)
	for _, s in ipairs(shapesOf(self)) do
		if s.kind == "circle" then g.circle("fill", s.x, s.y, s.r)
		else g.rectangle("fill", s.x - s.hw, s.y - s.hh, s.hw * 2, s.hh * 2) end
	end
end

Body._drawWorld = drawShapes
Zone._drawWorld = drawShapes

return M
