-- Joints: a Joint piece connects two Bodies (or one Body and the place where
-- the Joint is) with a Box2D joint (docs/physics.md, "Joints").
--
--   pin       turns around the Joint's position (a revolute joint)
--   weld      holds them together (springy with spring on)
--   rope      keeps them no further apart than length
--   spring    pulls them towards length apart, wobbling
--   distance  keeps them exactly length apart (a rod)
--   slider    slides along the Joint's x direction (a prismatic joint)
--   wheel     turns around the Joint's position and springs along its y
--             direction (a car's wheel)
--   mouse     pulls a's point under the Joint towards wherever the Joint is
--
-- Settings change while the game runs; breakForce > 0 breaks the joint
-- (it's removed and the Joint gets a "broke" event) when pulled harder.

local nodeLib = require("love.scene.node")
local scene = require("love.scene")
local physics2d = require("love.scene.physics2d")

local M = {}

local joints = {}

local Joint = nodeLib.classes.Joint

function Joint:_enter()
	physics2d.ensureWorld()
	joints[#joints + 1] = self
	self._joint = nil
end

local function forget(self)
	if self._joint then
		physics2d.box2d().destroyJoint(self._joint)
		self._joint = nil
	end
end

function Joint:_exit()
	for i = #joints, 1, -1 do
		if joints[i] == self then table.remove(joints, i) end
	end
	if physics2d.getWorld() then forget(self) end
	self._joint = nil
end

local function bodyPiece(self, path)
	if path == nil or path == "" then return nil end
	local n = self.parent and self.parent:find(path) or scene.find(path)
	if n and n.type == "Body" and not n._dead then return n end
	return nil
end

-- The settings a running joint takes, as one table (and whether they changed).
local function options(self)
	local kind = self.kind
	local o = self._opts or {}
	self._opts = o
	local spring = self.spring or kind == "spring" or kind == "wheel"
	local angles = kind == "pin"
	-- Length 0: as far apart as they were when the joint was made.
	local length = self.length > 0 and self.length or self._autoLength or 0
	local changed = o.kind ~= kind or o.spring ~= spring or o.hertz ~= self.stiffness or o.damping ~= self.damping
		or o.motor ~= self.motor or o.motorSpeed ~= self.motorSpeed or o.maxMotor ~= self.motorStrength
		or o.limit ~= self.limit or o.length ~= length or o.strength ~= self.strength
		or o.lower ~= (angles and self.minAngle or self.lower) or o.upper ~= (angles and self.maxAngle or self.upper)
	if not changed then return o, false end
	o.kind, o.spring, o.hertz, o.damping = kind, spring, self.stiffness, self.damping
	o.motor, o.motorSpeed, o.maxMotor = self.motor, self.motorSpeed, self.motorStrength
	o.limit, o.length, o.strength = self.limit, length, self.strength
	o.lower = angles and self.minAngle or self.lower
	o.upper = angles and self.maxAngle or self.upper
	-- Rope: free up to its length. Spring: pulls towards it.
	o.minLength, o.maxLength = nil, nil
	if kind == "rope" then
		o.spring, o.hertz, o.limit = true, 0, true
		o.minLength, o.maxLength = 0, length > 0 and length or nil
	end
	o.maxForce = (kind == "mouse" and self.strength > 0) and self.strength or nil
	return o, true
end

local BOX2D_KIND = { pin = "pin", weld = "weld", rope = "distance", spring = "distance", distance = "distance",
	slider = "slider", wheel = "wheel", mouse = "mouse" }

local function make(self)
	local b2 = physics2d.box2d()
	local a = bodyPiece(self, self.a)
	if not a then return end
	local bodyA = physics2d.ensure(a)
	if not bodyA then return end
	local b = bodyPiece(self, self.b)
	local bodyB = b and physics2d.ensure(b) or physics2d.getAnchor()
	local x, y, angle = physics2d.worldPose(self)
	local kind = BOX2D_KIND[self.kind] or "pin"
	self._autoLength = nil
	if kind == "distance" then
		local ax, ay = physics2d.worldPose(a)
		local bx, by = x, y
		if b then bx, by = physics2d.worldPose(b) end
		self._autoLength = math.sqrt((ax - bx) ^ 2 + (ay - by) ^ 2)
	end
	self._opts = nil
	local o = options(self)
	o.collide = self.collide
	if kind == "distance" then
		-- Between the bodies' positions (or a's and the Joint's).
		local ax, ay = physics2d.worldPose(a)
		local bx, by = x, y
		if b then bx, by = physics2d.worldPose(b) end
		o.bx, o.by = bx, by
		self._joint = b2.createJoint("distance", bodyA, bodyB, ax, ay, o)
	elseif kind == "mouse" then
		self._joint = b2.createJoint("mouse", physics2d.getAnchor(), bodyA, x, y, o)
	else
		-- The slider's axis is the Joint's x direction; a wheel springs along its y.
		local axis = kind == "wheel" and angle + math.pi / 2 or angle
		o.ax, o.ay = math.cos(axis), math.sin(axis)
		-- Angles, limits and motors measure a against b (or the scene).
		self._joint = b2.createJoint(kind, bodyB, bodyA, x, y, o)
	end
	o.bx, o.by, o.ax, o.ay, o.collide = nil, nil, nil, nil, nil
	self._bodyA, self._bodyB = bodyA, b and bodyB or nil
	self._pieceA, self._pieceB = a, b
	self._tx, self._ty = x, y
	self._made = { self.kind, self.a, self.b, self.collide }
end

function M.sync(h)
	local b2 = physics2d.box2d()
	for i = 1, #joints do
		local j = joints[i]
		if not j._dead then
			local made = j._made
			if j._joint then
				-- Gone with one of its bodies, or connected differently now.
				local a, b = j._pieceA, j._pieceB
				if a._body ~= j._bodyA or (b and b._body ~= j._bodyB) or made[1] ~= j.kind or made[2] ~= j.a
					or made[3] ~= j.b or made[4] ~= j.collide then
					if a._body == j._bodyA and (not b or b._body == j._bodyB) then forget(j) end
					j._joint = nil
				end
			end
			if not j._joint then
				make(j)
			else
				local o, changed = options(j)
				if changed then b2.updateJoint(j._joint, o) end
				if j.kind == "mouse" then
					local x, y = physics2d.worldPose(j)
					if x ~= j._tx or y ~= j._ty then
						b2.setJointTarget(j._joint, x, y)
						j._tx, j._ty = x, y
					end
				end
			end
		end
	end
end

function M.afterStep()
	local b2 = physics2d.box2d()
	for i = #joints, 1, -1 do
		local j = joints[i]
		if j and j._joint and not j._dead and j.breakForce > 0 then
			local _, _, force = b2.jointState(j._joint)
			if force > j.breakForce then
				forget(j)
				j._broken = true
				j._made = { j.kind, j.a, j.b, j.collide }
				j:emit("broke")
			end
		end
	end
end

function M.reset()
	for _, j in ipairs(joints) do j._joint = nil end
end

-- A broken joint stays broken until a, b or kind change.
local makeJoint = make
make = function(self)
	if self._broken then
		local m = self._made
		if m and m[1] == self.kind and m[2] == self.a and m[3] == self.b then return end
		self._broken = nil
	end
	return makeJoint(self)
end

local function state(self)
	if not self._joint then return 0, 0, 0, 0 end
	return physics2d.box2d().jointState(self._joint)
end

---The angle a pin has turned (radians), a slider's or wheel's travel, a distance joint's length.
function Joint:getAngle() return (state(self)) end
function Joint:getTranslation() return (state(self)) end
function Joint:getLength() return (state(self)) end
function Joint:getSpeed() return select(2, state(self)) end
function Joint:getForce() return select(3, state(self)) end
function Joint:getTorque() return select(4, state(self)) end
function Joint:isBroken() return self._broken == true end

physics2d.useJoints(M)

return M
