-- 3D physics nodes on Jolt (smitten.physics3d, the physics3d module):
-- RigidBody3D, StaticBody3D, CharacterBody3D, Area3D, CollisionShape3D, and
-- the FirstPerson behavior.
--
-- Bodies are made in the first physics step after they enter the scene, from
-- their CollisionShape3D children. Static bodies follow their nodes (moved as
-- kinematic bodies when a script moves them); rigid bodies move their nodes.

local nodeLib = require("love.scene.node")
local scene = require("love.scene")
local nodes3d = require("love.scene.nodes3d")
local p3 = love.physics3d -- loads the physics3d module (or explains it's missing)
local g3d = love.graphics3d
local mat4, quat = g3d.mat4, g3d.quat

local sqrt, max, min, abs = math.sqrt, math.max, math.min, math.abs

local M = {}

local world = nil
local bodies = {}   -- nodes with a Jolt body or character
local GRAVITY = -9.81

local function emitPair(a, b, kind)
	local na, nb = a:getUserData(), b:getUserData()
	if type(na) ~= "table" or type(nb) ~= "table" then return end
	local function send(n, other)
		if n._dead or other._dead then return end
		local isArea = n.type == "Area3D"
		local otherArea = other.type == "Area3D"
		if kind == "begin" then
			if isArea then n:emit("entered", other)
			elseif otherArea then n:emit("entered", other)
			else n:emit("collided", other) end
		else
			if isArea or otherArea then n:emit("exited", other) end
		end
	end
	send(na, nb)
	send(nb, na)
end

local function ensureWorld()
	if world then return world end
	world = p3.newWorld({ gravity = { 0, GRAVITY, 0 } })
	world:setCallbacks(function(a, b) emitPair(a, b, "begin") end, function(a, b) emitPair(a, b, "end") end)
	scene._addSystem("physics3d", { order = 60, step = M.step, reset = M.reset })
	return world
end

---The Jolt world, for code that uses smitten.physics3d directly with nodes.
function M.getWorld() return ensureWorld() end

---------------------------------------------------------------------------
-- Shapes

local function shapeFor(s)
	local sx, sy, sz = abs(s.scaleX), abs(s.scaleY), abs(s.scaleZ)
	local kind = s.shape
	if kind == "sphere" then return p3.newSphereShape(s.radius * max(sx, sy, sz)) end
	if kind == "capsule" then
		local r = s.radius * max(sx, sz)
		return p3.newCapsuleShape(max(0.001, s.height * sy / 2 - r), r)
	end
	if kind == "cylinder" then return p3.newCylinderShape(s.height * sy / 2, s.radius * max(sx, sz)) end
	if kind == "mesh" then
		-- The parent's model or mesh: its bounding box until triangle meshes
		-- from models are supported.
		local owner = s.parent
		local model = owner and owner:findChildOfType("Model3D")
		if model and model.model ~= "" then
			local x0, y0, z0, x1, y1, z1 = require("love.assets").model(model.model):getBounds()
			return p3.newBoxShape(max(0.01, (x1 - x0) / 2), max(0.01, (y1 - y0) / 2), max(0.01, (z1 - z0) / 2)), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
		end
		local mesh = owner and owner:findChildOfType("MeshInstance3D")
		if mesh then
			return p3.newBoxShape(mesh.width / 2 * sx, mesh.height / 2 * sy, mesh.depth / 2 * sz)
		end
	end
	return p3.newBoxShape(max(0.001, s.width * sx / 2), max(0.001, s.height * sy / 2), max(0.001, s.depth * sz / 2))
end

-- One shape for a body: its CollisionShape3D children, as a compound if
-- there are several or one is moved or turned.
local function bodyShape(n)
	local parts = {}
	for _, c in ipairs(n.children) do
		if c.type == "CollisionShape3D" and not c.disabled and not c._dead then
			local shape, ox, oy, oz = shapeFor(c)
			local qx, qy, qz, qw = quat.fromEuler(c.rotationX, c.rotationY, c.rotationZ)
			parts[#parts + 1] = { shape, c.x + (ox or 0), c.y + (oy or 0), c.z + (oz or 0), qx, qy, qz, qw }
		end
	end
	if #parts == 0 then return nil end
	local p = parts[1]
	if #parts == 1 and p[2] == 0 and p[3] == 0 and p[4] == 0 and p[5] == 0 and p[6] == 0 and p[7] == 0 then
		return p[1]
	end
	return p3.newCompoundShape(parts)
end

local function globalTransform(n)
	local m = nodes3d.worldMatrix(n)
	local x, y, z, qx, qy, qz, qw = mat4.decompose(m)
	return x, y, z, qx, qy, qz, qw
end

-- Writes a world position and rotation back into a node's own properties.
local function setFromWorld(n, x, y, z, qx, qy, qz, qw)
	local p = n.parent
	while p and not nodes3d.is3D(p) do p = p.parent end
	if p then
		local pm = nodes3d.worldMatrix(p)
		local inv = mat4.invert({}, pm)
		local local_ = mat4.multiply({}, inv, mat4.fromTRS({}, x, y, z, qx, qy, qz, qw, 1, 1, 1))
		x, y, z, qx, qy, qz, qw = mat4.decompose(local_)
	end
	n.x, n.y, n.z = x, y, z
	n.rotationX, n.rotationY, n.rotationZ = quat.toEuler(qx, qy, qz, qw)
end

---------------------------------------------------------------------------
-- Bodies

local function register(n)
	ensureWorld()
	bodies[#bodies + 1] = n
	n._body = nil
end

local function unregister(n)
	for i = #bodies, 1, -1 do
		if bodies[i] == n then table.remove(bodies, i) end
	end
	local b = n._body
	if b and not b:isDestroyed() then b:destroy() end
	n._body = nil
end

local function create(n)
	local shape = bodyShape(n)
	if not shape then return end
	local x, y, z, qx, qy, qz, qw = globalTransform(n)
	local t = n.type
	if t == "CharacterBody3D" then
		n._body = world:newCharacter({
			shape = shape, x = x, y = y, z = z, maxSlope = n.maxSlope, stepHeight = n.stepHeight,
			layer = n.layer, mask = n.mask,
		})
	else
		local opts = { shape = shape, x = x, y = y, z = z, qx = qx, qy = qy, qz = qz, qw = qw, layer = n.layer, mask = n.mask }
		if t == "RigidBody3D" then
			opts.type = "dynamic"
			opts.mass = n.mass
			opts.friction, opts.restitution = n.friction, n.bounce
			opts.gravityScale = n.gravityScale
			opts.linearDamping, opts.angularDamping = n.linearDamping, n.angularDamping
			opts.lockRotation = n.lockRotation
		elseif t == "Area3D" then
			opts.type = "kinematic"
			opts.sensor = true
		else
			opts.type = "kinematic"
			opts.friction, opts.restitution = n.friction, n.bounce
		end
		n._body = world:newBody(opts)
		if t == "RigidBody3D" then n._body:setLinearVelocity(n.vx, n.vy, n.vz) end
	end
	n._body:setUserData(n)
	n._last = { x, y, z, qx, qy, qz, qw }
	n._lastV = { n.vx, n.vy, n.vz }
end

for _, t in ipairs({ "RigidBody3D", "StaticBody3D", "CharacterBody3D", "Area3D" }) do
	nodeLib.extend(t, { _enter = register, _exit = unregister })
end

local RigidBody3D = nodeLib.classes.RigidBody3D

function RigidBody3D:applyForce(x, y, z) if self._body then self._body:applyForce(x, y, z) end end
function RigidBody3D:applyImpulse(x, y, z) if self._body then self._body:applyImpulse(x, y, z) end end
function RigidBody3D:applyTorque(x, y, z) if self._body then self._body:applyTorque(x, y, z) end end

local Area3D = nodeLib.classes.Area3D

function Area3D:_enter()
	register(self)
	self._inside_ = {}
	self:on("entered", function(o) self._inside_[o] = true end)
	self:on("exited", function(o) self._inside_[o] = nil end)
end

function Area3D:getOverlapping()
	local out = {}
	for o in pairs(self._inside_ or {}) do
		if not o._dead then out[#out + 1] = o end
	end
	return out
end

local CharacterBody3D = nodeLib.classes.CharacterBody3D

function CharacterBody3D:moveAndSlide()
	local c = self._body
	if not c then
		if world then create(self) end
		c = self._body
		if not c then return end
	end
	local dt = scene.getDelta()
	c:setLinearVelocity(self.vx, self.vy, self.vz)
	c:update(dt)
	local x, y, z = c:getPosition()
	local _, _, _, qx, qy, qz, qw = globalTransform(self)
	setFromWorld(self, x, y, z, qx, qy, qz, qw)
	self.vx, self.vy, self.vz = c:getLinearVelocity()
	self._onFloor = c:isOnGround()
	if self._onFloor and self.vy < 0 then self.vy = 0 end
	self._last = { x, y, z, qx, qy, qz, qw }
end

function CharacterBody3D:isOnFloor()
	return self._onFloor == true
end

---------------------------------------------------------------------------
-- The step

function M.step(h)
	if not world then return end
	for i = 1, #bodies do
		local n = bodies[i]
		if not n._body and not n._dead then create(n) end
		local b = n._body
		if b and n.type ~= "CharacterBody3D" then
			local x, y, z, qx, qy, qz, qw = globalTransform(n)
			local l = n._last
			local moved = abs(x - l[1]) + abs(y - l[2]) + abs(z - l[3]) + abs(qx - l[4]) + abs(qy - l[5]) + abs(qz - l[6]) + abs(qw - l[7]) > 1e-6
			if n.type == "RigidBody3D" then
				if moved then b:setTransform(x, y, z, qx, qy, qz, qw) end
				local v = n._lastV
				if n.vx ~= v[1] or n.vy ~= v[2] or n.vz ~= v[3] then b:setLinearVelocity(n.vx, n.vy, n.vz) end
				b:setGravityScale(n.gravityScale)
			elseif moved then
				b:moveKinematic(x, y, z, qx, qy, qz, qw, h)
				n._last = { x, y, z, qx, qy, qz, qw }
			end
		end
	end
	world:update(h)
	for i = 1, #bodies do
		local n = bodies[i]
		local b = n._body
		if b and n.type == "RigidBody3D" and not n._dead then
			local x, y, z, qx, qy, qz, qw = b:getTransform()
			setFromWorld(n, x, y, z, qx, qy, qz, qw)
			n.vx, n.vy, n.vz = b:getLinearVelocity()
			n._last = { globalTransform(n) }
			n._lastV = { n.vx, n.vy, n.vz }
		end
	end
end

function M.reset()
	if world and not world:isDestroyed() then world:destroy() end
	world = nil
	bodies = {}
	local tree = scene._tree
	if tree.systems.physics3d then
		tree.systems.physics3d = nil
		for i = #tree.systemList, 1, -1 do
			if tree.systemList[i].step == M.step then table.remove(tree.systemList, i) end
		end
	end
end

---Casts a ray through the 3D world: hit node, x, y, z, nx, ny, nz (or nil).
function M.raycast(x, y, z, dx, dy, dz, mask)
	if not world then return nil end
	local obj, hx, hy, hz, nx, ny, nz = world:raycast(x, y, z, dx, dy, dz, mask)
	if not obj then return nil end
	return obj:getUserData(), hx, hy, hz, nx, ny, nz
end
scene.raycast3d = M.raycast

---------------------------------------------------------------------------
-- FirstPerson

local FirstPerson = nodeLib.classes.FirstPerson

local function input() return require("love.input") end

function FirstPerson:_enter()
	self._pitch = 0
end

function FirstPerson:_process(dt)
	local body = self.parent
	if not body or body.rotationY == nil then return end
	local mouse = love.mouse
	if self.mouseLook then
		if mouse.pressed(1) and not mouse.getRelativeMode() then mouse.setRelativeMode(true) end
		if love.keyboard.pressed("escape") then mouse.setRelativeMode(false) end
		if mouse.getRelativeMode() then
			local dx, dy = input()._mouseDelta()
			body.rotationY = body.rotationY - dx * self.sensitivity
			self._pitch = max(-1.55, min(1.55, self._pitch - dy * self.sensitivity))
			local cam = body:findChildOfType("Camera3D")
			if cam then cam.rotationX = self._pitch end
		end
	end
	if input().pressed("jump") then self._jump = 0.15 end
end

function FirstPerson:_physics(dt)
	local body = self.parent
	if not body or not body.moveAndSlide or body.vz == nil then return end
	local ix, iz = input().vector("left", "right", "up", "down")
	local speed = love.keyboard.isDown("lshift", "rshift") and self.sprintSpeed or self.speed
	local yaw = body.rotationY
	local s, c = math.sin(yaw), math.cos(yaw)
	-- Forward is -z; input up (iz = -1) walks forward.
	local wx = ix * c + iz * s
	local wz = -ix * s + iz * c
	body.vx, body.vz = wx * speed, wz * speed
	body.vy = body.vy - self.gravity * dt
	if (self._jump or 0) > 0 then
		if body:isOnFloor() then
			body.vy = sqrt(2 * self.gravity * self.jumpHeight)
			self._jump = 0
		else
			self._jump = self._jump - dt
		end
	end
	body:moveAndSlide()
end

return M
