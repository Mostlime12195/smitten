-- Bodies whose motion is "physics", and Joints, on Box2D (smitten.physics, the
-- physics2d module, loaded the first time one joins a scene).
--
-- They live in a Box2D world. So that they land on and bump into everything
-- else, still and scripted bodies and solid tiles are mirrored into that
-- world as kinematic bodies, moved each step to wherever the scene put them.
-- Tags filter contacts the same way as everywhere else (passThrough).

local nodeLib = require("love.scene.node")
local scene = require("love.scene")
local physics2d = require("love.scene.physics2d")
local nodes2d = require("love.scene.nodes2d")

local physics = love.physics -- loads the physics2d module (or explains it's missing)

local M = {}

local world = nil
local mirrors = {}     -- piece -> {body, key}
local rigids = {}      -- Bodies with physics motion
local joints = {}
local tileBodies = {}  -- Tiles piece -> {body, version}
local contacts = {}

local GRAVITY = 980

-- Where a shape sits on a body at (cx, cy) turned by angle.
local function offset(s, cx, cy, angle)
	local dx, dy = s.x - cx, s.y - cy
	local c, si = math.cos(angle), math.sin(angle)
	return dx * c + dy * si, dy * c - dx * si
end

-- The angle a piece is turned to in the scene.
local function angleOf(n)
	local a, b = nodes2d.globalMatrix(n)
	return math.atan2(b, a)
end

-- Adds a piece's shapes to a Box2D body at (cx, cy) turned by angle. The
-- shapes (physics2d.shapesOf) are measured unturned, so they turn with it.
local function addShapes(body, n, cx, cy, angle, props)
	for _, s in ipairs(physics2d.shapesOf(n)) do
		local shape
		local ox, oy = offset(s, cx, cy, angle)
		if s.kind == "circle" then
			shape = physics.newCircleShape(body, ox, oy, s.r)
		else
			shape = physics.newRectangleShape(body, ox, oy, s.hw * 2, s.hh * 2, 0)
		end
		shape:setUserData(n)
		shape:setFriction(props.friction or 0.3)
		shape:setRestitution(props.bounce or 0)
		if props.density then shape:setDensity(props.density) end
	end
end

local function area(n)
	local a = 0
	for _, s in ipairs(physics2d.shapesOf(n)) do
		a = a + (s.kind == "circle" and math.pi * s.r * s.r or s.hw * s.hh * 4)
	end
	return a
end

local function ensureWorld()
	if world then return world end
	physics.setMeter(64)
	world = physics.newWorld(0, GRAVITY, true)
	world:setCallbacks(function(a, b)
		contacts[#contacts + 1] = { a:getUserData(), b:getUserData() }
	end)
	world:setContactFilter(function(a, b)
		local pa, pb = a:getUserData(), b:getUserData()
		if type(pa) ~= "table" or type(pb) ~= "table" then return true end
		if pa.type == "Tiles" then pa, pb = pb, pa end
		if pb.type == "Tiles" then return not (pa.passThrough and pa.passThrough:find("tiles", 1, true)) end
		return physics2d.collides(pa, pb)
	end)
	scene._addSystem("rigid2d", { order = 60, step = M.step, reset = M.reset })
	return world
end

function M.add(n)
	ensureWorld()
	rigids[#rigids + 1] = n
end

function M.remove(n)
	for i = #rigids, 1, -1 do
		if rigids[i] == n then table.remove(rigids, i) end
	end
	if n._rigid and not n._rigid:isDestroyed() then n._rigid:destroy() end
	n._rigid = nil
end

---------------------------------------------------------------------------
-- Mirrors of everything that isn't moved by physics

-- A shape's size and place on its body, rounded to hundredths: a mirror is
-- rebuilt when one of these changes.
local function round2(v) return math.floor(v * 100 + 0.5) end

local function syncMirror(n, h)
	local m = mirrors[n]
	local a, b, _, _, x, y = nodes2d.globalMatrix(n)
	local angle = math.atan2(b, a)
	local shapes = physics2d.shapesOf(n)
	-- Shapes measured from the piece, so moving or turning it doesn't change them.
	local key = m and m.key
	local same = key ~= nil and #key == #shapes * 5
	if same then
		for i, s in ipairs(shapes) do
			local ox, oy = offset(s, x, y, angle)
			local j = (i - 1) * 5
			if key[j + 1] ~= s.kind or key[j + 2] ~= round2(s.hw) or key[j + 3] ~= round2(s.hh)
				or key[j + 4] ~= round2(ox) or key[j + 5] ~= round2(oy) then
				same = false
				break
			end
		end
	end
	if m and not same then
		m.body:destroy()
		m = nil
	end
	if not m then
		if #shapes == 0 then return end
		local body = physics.newBody(world, x, y, "kinematic")
		body:setAngle(angle)
		addShapes(body, n, x, y, angle, { friction = n.friction, bounce = n.bounce })
		body:setUserData(n)
		key = {}
		for i, s in ipairs(shapes) do
			local ox, oy = offset(s, x, y, angle)
			local j = (i - 1) * 5
			key[j + 1], key[j + 2], key[j + 3], key[j + 4], key[j + 5] = s.kind, round2(s.hw), round2(s.hh), round2(ox), round2(oy)
		end
		mirrors[n] = { body = body, key = key }
		return
	end
	local bx, by = m.body:getPosition()
	local dx, dy = x - bx, y - by
	local da = (angle - m.body:getAngle() + math.pi) % (2 * math.pi) - math.pi
	if dx * dx + dy * dy > 64 * 64 or math.abs(da) > 1 then
		m.body:setPosition(x, y)
		m.body:setAngle(angle)
		m.body:setLinearVelocity(0, 0)
		m.body:setAngularVelocity(0)
	else
		m.body:setLinearVelocity(dx / h, dy / h)
		m.body:setAngularVelocity(da / h)
	end
end

local function syncTiles(map)
	local t = tileBodies[map]
	local version = tostring(map._grid) .. tostring(map._ts) .. tostring(map.solid) .. "#" .. tostring(map._changes)
	if t and t.version == version then return end
	if t then t.body:destroy() end
	if not map._ts or not map.solid then
		tileBodies[map] = nil
		return
	end
	local tw, th, ox, oy = map:_cellSize()
	local body = physics.newBody(world, ox, oy, "static")
	-- One rectangle per horizontal run of solid tiles.
	for cy, row in pairs(map._grid) do
		local cols = {}
		for cx in pairs(row) do
			if map:_solidAt(cx, cy) then cols[#cols + 1] = cx end
		end
		table.sort(cols)
		local i = 1
		while i <= #cols do
			local j = i
			while j < #cols and cols[j + 1] == cols[j] + 1 do j = j + 1 end
			local w = (cols[j] - cols[i] + 1) * tw
			local shape = physics.newRectangleShape(body, cols[i] * tw + w / 2, cy * th + th / 2, w, th, 0)
			shape:setUserData(map)
			shape:setFriction(0.4)
			i = j + 1
		end
	end
	tileBodies[map] = { body = body, version = version }
end

---------------------------------------------------------------------------
-- Physics bodies

local function create(n)
	local x, y = n:worldPosition()
	local angle = angleOf(n)
	local body = physics.newBody(world, x, y, "dynamic")
	body:setAngle(angle)
	local size = area(n)
	addShapes(body, n, x, y, angle, {
		friction = n.friction, bounce = n.bounce,
		density = size > 0 and n.mass / (size / (64 * 64)) or 1,
	})
	body:resetMassData()
	body:setGravityScale(n.gravity)
	body:setLinearDamping(n.drag)
	body:setFixedRotation(n.fixedRotation)
	body:setLinearVelocity(n.vx, n.vy)
	body:setUserData(n)
	n._rigid = body
	n._lastX, n._lastY = x, y
	n._lastVx, n._lastVy = n.vx, n.vy
end

---------------------------------------------------------------------------
-- Joints

local Joint = nodeLib.classes.Joint

function Joint:_enter()
	ensureWorld()
	joints[#joints + 1] = self
	self._joint = nil
end

function Joint:_exit()
	for i = #joints, 1, -1 do
		if joints[i] == self then table.remove(joints, i) end
	end
	if self._joint and not self._joint:isDestroyed() then self._joint:destroy() end
	self._joint = nil
end

local function bodyOf(self, path)
	if path == nil or path == "" then return nil end
	local n = self.parent and self.parent:find(path) or scene.find(path)
	return n and (n._rigid or (mirrors[n] and mirrors[n].body))
end

local function makeJoint(self)
	local a = bodyOf(self, self.a)
	if not a then return end
	local x, y = self:worldPosition()
	local b = bodyOf(self, self.b)
	if not b then
		-- Pinned in place: an anchor where the joint is.
		b = physics.newBody(world, x, y, "static")
		self._anchor = b
	end
	local ax, ay = a:getPosition()
	local bx, by = b:getPosition()
	local kind, j = self.kind, nil
	if kind == "pin" then
		j = physics.newRevoluteJoint(a, b, x, y, false)
	elseif kind == "weld" then
		j = physics.newWeldJoint(a, b, x, y, false)
	elseif kind == "rope" then
		local len = self.length > 0 and self.length or math.sqrt((ax - bx) ^ 2 + (ay - by) ^ 2)
		j = physics.newRopeJoint(a, b, ax, ay, bx, by, len, false)
	else
		j = physics.newDistanceJoint(a, b, ax, ay, bx, by, false)
		if self.length > 0 then j:setLength(self.length) end
		local stiffness, damping = physics.computeLinearStiffness(self.stiffness, self.damping, a, b)
		j:setStiffness(stiffness)
		j:setDamping(damping)
	end
	self._joint = j
end

---------------------------------------------------------------------------
-- The step

function M.step(h)
	if not world then return end
	local seen = {}
	for _, n in ipairs(physics2d.bodies) do
		if n.motion ~= "physics" and not n._dead then
			seen[n] = true
			syncMirror(n, h)
		end
	end
	for n, m in pairs(mirrors) do
		if not seen[n] then
			m.body:destroy()
			mirrors[n] = nil
		end
	end
	for _, map in ipairs(physics2d.tilemaps) do syncTiles(map) end
	for map, t in pairs(tileBodies) do
		if not map._inside then
			t.body:destroy()
			tileBodies[map] = nil
		end
	end

	-- Scripts may have moved bodies or changed their speed since the last step.
	for _, r in ipairs(rigids) do
		if not r._rigid then
			create(r)
		else
			local body = r._rigid
			local x, y = r:worldPosition()
			if x ~= r._lastX or y ~= r._lastY then body:setPosition(x, y) end
			if r.vx ~= r._lastVx or r.vy ~= r._lastVy then body:setLinearVelocity(r.vx, r.vy) end
			body:setGravityScale(r.gravity)
		end
	end
	for _, j in ipairs(joints) do
		if not j._joint then makeJoint(j) end
	end

	world:update(h)

	for _, r in ipairs(rigids) do
		local body = r._rigid
		if body and not r._dead then
			local x, y = body:getPosition()
			r:setWorldPosition(x, y)
			local parentAngle = 0
			local p = r.parent
			if p and nodes2d.hasPosition(p) then
				local a, b = nodes2d.globalMatrix(p)
				parentAngle = math.atan2(b, a)
			end
			r.rotation = body:getAngle() - parentAngle
			r.vx, r.vy = body:getLinearVelocity()
			r._lastX, r._lastY = r:worldPosition()
			r._lastVx, r._lastVy = r.vx, r.vy
		end
	end

	local list = contacts
	contacts = {}
	for _, c in ipairs(list) do
		local a, b = c[1], c[2]
		if type(a) == "table" and type(b) == "table" and a.emit and b.emit then
			if not a._dead then a:emit("hit", b) end
			if not b._dead then b:emit("hit", a) end
		end
	end
end

function M.reset()
	if world and not world:isDestroyed() then world:destroy() end
	world = nil
	mirrors, rigids, joints, tileBodies, contacts = {}, {}, {}, {}, {}
	local tree = scene._tree
	if tree.systems.rigid2d then
		tree.systems.rigid2d = nil
		for i = #tree.systemList, 1, -1 do
			if tree.systemList[i].step == M.step then table.remove(tree.systemList, i) end
		end
	end
end

---The Box2D world, for code that uses smitten.physics directly with pieces.
function M.getWorld()
	return ensureWorld()
end

return M
