-- RigidBody2D and Joint2D on Box2D (smitten.physics, the physics2d module).
--
-- Rigid bodies live in a Box2D world made when the first one enters the
-- scene. So that they land on and bump into everything else, static bodies,
-- characters and solid tiles are mirrored into that world as kinematic
-- bodies, moved each step to wherever the scene put them.

local nodeLib = require("love.scene.node")
local scene = require("love.scene")
local physics2d = require("love.scene.physics2d")
local nodes2d = require("love.scene.nodes2d")

local physics = love.physics -- loads the physics2d module (or explains it's missing)

local M = {}

local world = nil
local mirrors = {}     -- node -> {body, shapesKey}
local rigids = {}      -- list of RigidBody2D
local joints = {}      -- list of Joint2D
local tileBodies = {}  -- tilemap -> {body, version}
local contacts = {}

local GRAVITY = 980

local function shapeKey(shapes)
	local parts = {}
	for i, s in ipairs(shapes) do
		parts[i] = ("%s:%.2f:%.2f"):format(s.kind, s.hw, s.hh)
	end
	return table.concat(parts, ";")
end

-- Adds a node's collision shapes to a body, relative to the body's position.
local function addShapes(body, n, cx, cy, props)
	for _, s in ipairs(physics2d.shapesOf(n)) do
		local shape
		if s.kind == "circle" then
			shape = physics.newCircleShape(body, s.x - cx, s.y - cy, s.r)
		else
			shape = physics.newRectangleShape(body, s.x - cx, s.y - cy, s.hw * 2, s.hh * 2, 0)
		end
		shape:setUserData(n)
		shape:setFilterData(n.layer or 1, n.mask or 1, 0)
		if props then
			shape:setFriction(props.friction or 0.3)
			shape:setRestitution(props.bounce or 0)
			if props.density then shape:setDensity(props.density) end
		end
	end
end

local function totalArea(n)
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
	scene._addSystem("rigid2d", { order = 60, step = M.step, reset = M.reset })
	return world
end

---------------------------------------------------------------------------
-- Mirrors of everything that isn't a rigid body

local function syncMirror(n, h)
	local m = mirrors[n]
	local shapes = physics2d.shapesOf(n)
	local key = shapeKey(shapes)
	local x, y = n:getGlobalPosition()
	if m and m.key ~= key then
		m.body:destroy()
		m = nil
	end
	if not m then
		if #shapes == 0 then return end
		local body = physics.newBody(world, x, y, "kinematic")
		addShapes(body, n, x, y, { friction = n.friction, bounce = n.bounce })
		body:setUserData(n)
		m = { body = body, key = key }
		mirrors[n] = m
		return
	end
	local bx, by = m.body:getPosition()
	local dx, dy = x - bx, y - by
	if dx * dx + dy * dy > 64 * 64 then
		m.body:setPosition(x, y)
		m.body:setLinearVelocity(0, 0)
	else
		m.body:setLinearVelocity(dx / h, dy / h)
	end
end

local function syncTiles(map)
	local t = tileBodies[map]
	local version = tostring(map._grid) .. tostring(map._ts)
	if t and t.version == version and not map._dirty then return end
	if t then t.body:destroy() end
	local ts = map._ts
	if not ts or not map.collision then
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
			shape:setFilterData(map.layer or 1, 0xFFFF, 0)
			shape:setFriction(0.4)
			i = j + 1
		end
	end
	tileBodies[map] = { body = body, version = version }
end

---------------------------------------------------------------------------
-- RigidBody2D

local RigidBody2D = nodeLib.classes.RigidBody2D

function RigidBody2D:_enter()
	ensureWorld()
	rigids[#rigids + 1] = self
	self._body = nil
	physics2d.bodies[#physics2d.bodies + 1] = self
end

function RigidBody2D:_exit()
	for i = #rigids, 1, -1 do
		if rigids[i] == self then table.remove(rigids, i) end
	end
	for i = #physics2d.bodies, 1, -1 do
		if physics2d.bodies[i] == self then table.remove(physics2d.bodies, i) end
	end
	if self._body and not self._body:isDestroyed() then self._body:destroy() end
	self._body = nil
end

local function createBody(self)
	local x, y = self:getGlobalPosition()
	local a, b = nodes2d.globalMatrix(self)
	local body = physics.newBody(world, x, y, "dynamic")
	body:setAngle(math.atan2(b, a))
	local area = totalArea(self)
	addShapes(body, self, x, y, {
		friction = self.friction, bounce = self.bounce,
		density = area > 0 and self.mass / (area / (64 * 64)) or 1,
	})
	body:resetMassData()
	body:setGravityScale(self.gravityScale)
	body:setLinearDamping(self.linearDamping)
	body:setAngularDamping(self.angularDamping)
	body:setFixedRotation(self.lockRotation)
	body:setLinearVelocity(self.vx, self.vy)
	body:setAngularVelocity(self.spin)
	body:setUserData(self)
	self._body = body
	self._lastX, self._lastY = x, y
	self._lastVx, self._lastVy, self._lastSpin = self.vx, self.vy, self.spin
end

function RigidBody2D:applyForce(fx, fy)
	if self._body then self._body:applyForce(fx, fy) end
end

function RigidBody2D:applyImpulse(ix, iy)
	if self._body then self._body:applyLinearImpulse(ix, iy) end
end

function RigidBody2D:applyTorque(t)
	if self._body then self._body:applyTorque(t) end
end

---------------------------------------------------------------------------
-- Joint2D

local Joint2D = nodeLib.classes.Joint2D

function Joint2D:_enter()
	ensureWorld()
	joints[#joints + 1] = self
	self._joint = nil
end

function Joint2D:_exit()
	for i = #joints, 1, -1 do
		if joints[i] == self then table.remove(joints, i) end
	end
	if self._joint and not self._joint:isDestroyed() then self._joint:destroy() end
	self._joint = nil
end

local function bodyOf(self, path)
	if path == nil or path == "" then return nil end
	local n = self.parent and self.parent:find(path) or scene.find(path)
	return n and (n._body or (mirrors[n] and mirrors[n].body))
end

local function makeJoint(self)
	local a = bodyOf(self, self.nodeA)
	if not a then return end
	local b = bodyOf(self, self.nodeB)
	if not b then
		-- Pinned to the world: an anchor body where the joint is.
		local x, y = self:getGlobalPosition()
		b = physics.newBody(world, x, y, "static")
		self._anchor = b
	end
	local x, y = self:getGlobalPosition()
	local ax, ay = a:getPosition()
	local bx, by = b:getPosition()
	local kind = self.kind
	local j
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
		if n.type ~= "RigidBody2D" and not n._dead then
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

	-- Scripts may have moved bodies or set velocities since the last step.
	for _, r in ipairs(rigids) do
		if not r._body then
			createBody(r)
		else
			local body = r._body
			local x, y = r:getGlobalPosition()
			if x ~= r._lastX or y ~= r._lastY then body:setPosition(x, y) end
			if r.vx ~= r._lastVx or r.vy ~= r._lastVy then body:setLinearVelocity(r.vx, r.vy) end
			if r.spin ~= r._lastSpin then body:setAngularVelocity(r.spin) end
			body:setGravityScale(r.gravityScale)
		end
	end
	for _, j in ipairs(joints) do
		if not j._joint then makeJoint(j) end
	end

	world:update(h)

	for _, r in ipairs(rigids) do
		local body = r._body
		if body and not r._dead then
			local x, y = body:getPosition()
			r:setGlobalPosition(x, y)
			local parentAngle = 0
			local p = r.parent
			if p and nodes2d.isNode2D(p) then
				local a, b = nodes2d.globalMatrix(p)
				parentAngle = math.atan2(b, a)
			end
			r.rotation = body:getAngle() - parentAngle
			r.vx, r.vy = body:getLinearVelocity()
			r.spin = body:getAngularVelocity()
			r._lastX, r._lastY = r:getGlobalPosition()
			r._lastVx, r._lastVy, r._lastSpin = r.vx, r.vy, r.spin
		end
	end

	local list = contacts
	contacts = {}
	for _, c in ipairs(list) do
		local a, b = c[1], c[2]
		if type(a) == "table" and type(b) == "table" and a.emit and b.emit then
			if not a._dead then a:emit("collided", b) end
			if not b._dead then b:emit("collided", a) end
		end
	end
end

function M.reset()
	if world and not world:isDestroyed() then world:destroy() end
	world = nil
	mirrors, rigids, joints, tileBodies, contacts = {}, {}, {}, {}, {}
	if scene._tree.systems.rigid2d then
		scene._tree.systems.rigid2d = nil
		for i = #scene._tree.systemList, 1, -1 do
			if scene._tree.systemList[i].step == M.step then table.remove(scene._tree.systemList, i) end
		end
	end
end

---The Box2D world, for code that wants to use smitten.physics directly.
function M.getWorld()
	return ensureWorld()
end

return M
