-- graphics3d.camera: where the 3D view is seen from.
--
--   local cam = g3d.newCamera{fov = 70, near = 0.05, far = 1000}
--   cam:setTransform(0, 2, 6)          -- position (and optionally a quaternion)
--   cam:lookAt(0, 0, 0)
--   local ox, oy, oz, dx, dy, dz = cam:screenToRay(mx, my, w, h)
--
-- A camera looks down its local -z with +y up. fov is the vertical field of
-- view in degrees; an orthographic camera shows `size` meters vertically.

local mat4 = require("graphics3d.mat4")
local quat = require("graphics3d.quat")

local sqrt, tan, rad = math.sqrt, math.tan, math.rad

---@class graphics3d.Camera
---@field fov number vertical field of view in degrees (perspective)
---@field near number
---@field far number
---@field projection "perspective"|"orthographic"
---@field size number visible height in meters (orthographic)
---@field x number
---@field y number
---@field z number
---@field qx number
---@field qy number
---@field qz number
---@field qw number
local Camera = {}
Camera.__index = Camera

local function newCamera(opts)
	opts = opts or {}
	local projection = opts.projection or "perspective"
	if projection ~= "perspective" and projection ~= "orthographic" then
		error("graphics3d.newCamera: projection must be \"perspective\" or \"orthographic\", not " .. tostring(projection), 2)
	end
	local cam = setmetatable({
		fov = opts.fov or 70,
		near = opts.near or 0.05,
		far = opts.far or 1000,
		projection = projection,
		size = opts.size or 10,
		x = 0, y = 0, z = 0,
		qx = 0, qy = 0, qz = 0, qw = 1,
		_view = mat4.new(),
		_world = mat4.new(),
		_proj = mat4.new(),
		_viewProj = mat4.new(),
		_dirty = true,
	}, Camera)
	if opts.x or opts.y or opts.z then cam:setTransform(opts.x or 0, opts.y or 0, opts.z or 0) end
	return cam
end

---Sets the position and, when given, the rotation (a unit quaternion).
function Camera:setTransform(x, y, z, qx, qy, qz, qw)
	self.x, self.y, self.z = x, y, z
	if qx ~= nil then
		self.qx, self.qy, self.qz, self.qw = quat.normalize(qx, qy, qz, qw)
	end
	self._dirty = true
end

function Camera:setPosition(x, y, z)
	self.x, self.y, self.z = x, y, z
	self._dirty = true
end

---@return number x, number y, number z
function Camera:getPosition()
	return self.x, self.y, self.z
end

---@return number qx, number qy, number qz, number qw
function Camera:getRotation()
	return self.qx, self.qy, self.qz, self.qw
end

---Turns the camera (where it is) to face a point. Up defaults to +y.
function Camera:lookAt(x, y, z, upx, upy, upz)
	self.qx, self.qy, self.qz, self.qw = quat.lookRotation(x - self.x, y - self.y, z - self.z, upx, upy, upz)
	self._dirty = true
end

---The direction the camera faces (unit vector).
---@return number dx, number dy, number dz
function Camera:getForward()
	return quat.rotateVector(self.qx, self.qy, self.qz, self.qw, 0, 0, -1)
end

local function update(self)
	if not self._dirty then return end
	local w = mat4.fromTRS(self._world, self.x, self.y, self.z, self.qx, self.qy, self.qz, self.qw)
	-- The inverse of a rotation plus translation: transpose the rotation.
	local v = self._view
	v[1], v[2], v[3], v[4] = w[1], w[5], w[9], 0
	v[5], v[6], v[7], v[8] = w[2], w[6], w[10], 0
	v[9], v[10], v[11], v[12] = w[3], w[7], w[11], 0
	local x, y, z = self.x, self.y, self.z
	v[13] = -(w[1] * x + w[2] * y + w[3] * z)
	v[14] = -(w[5] * x + w[6] * y + w[7] * z)
	v[15] = -(w[9] * x + w[10] * y + w[11] * z)
	v[16] = 1
	self._dirty = false
end

---The world-to-camera matrix. The table is the camera's own: don't change it.
---@return table
function Camera:getViewMatrix()
	update(self)
	return self._view
end

---The camera-to-world matrix. The table is the camera's own: don't change it.
---@return table
function Camera:getWorldMatrix()
	update(self)
	return self._world
end

---The projection for a view `aspect` (width / height) wide. The table is the
---camera's own: don't change it.
---@param aspect number
---@return table
function Camera:getProjectionMatrix(aspect)
	aspect = aspect or 1
	if self.projection == "orthographic" then
		local hh = self.size * 0.5
		local hw = hh * aspect
		return mat4.orthographic(self._proj, -hw, hw, -hh, hh, self.near, self.far)
	end
	return mat4.perspective(self._proj, rad(self.fov), aspect, self.near, self.far)
end

---projection * view. The table is the camera's own: don't change it.
---@return table
function Camera:getViewProjectionMatrix(aspect)
	return mat4.multiply(self._viewProj, self:getProjectionMatrix(aspect), self:getViewMatrix())
end

---The ray through a point on a w×h screen (pixels, y down): origin and unit direction.
---@return number ox, number oy, number oz, number dx, number dy, number dz
function Camera:screenToRay(sx, sy, w, h)
	local nx = 2 * sx / w - 1
	local ny = 1 - 2 * sy / h
	local aspect = w / h
	local qx, qy, qz, qw = self.qx, self.qy, self.qz, self.qw
	if self.projection == "orthographic" then
		local hh = self.size * 0.5
		local ox, oy, oz = quat.rotateVector(qx, qy, qz, qw, nx * hh * aspect, ny * hh, -self.near)
		local dx, dy, dz = quat.rotateVector(qx, qy, qz, qw, 0, 0, -1)
		return self.x + ox, self.y + oy, self.z + oz, dx, dy, dz
	end
	local t = tan(rad(self.fov) * 0.5)
	local dx, dy, dz = quat.rotateVector(qx, qy, qz, qw, nx * t * aspect, ny * t, -1)
	local len = sqrt(dx * dx + dy * dy + dz * dz)
	return self.x, self.y, self.z, dx / len, dy / len, dz / len
end

---Where a world point lands on a w×h screen (pixels, y down), and its distance
---in front of the camera. Returns nil for points behind the camera.
---@return number? sx, number? sy, number? depth
function Camera:worldToScreen(x, y, z, w, h)
	local v = self:getViewMatrix()
	local vx = v[1] * x + v[5] * y + v[9] * z + v[13]
	local vy = v[2] * x + v[6] * y + v[10] * z + v[14]
	local vz = v[3] * x + v[7] * y + v[11] * z + v[15]
	local depth = -vz
	local aspect = w / h
	local nx, ny
	if self.projection == "orthographic" then
		local hh = self.size * 0.5
		nx, ny = vx / (hh * aspect), vy / hh
	else
		if depth <= 0 then return nil end
		local t = tan(rad(self.fov) * 0.5)
		nx, ny = vx / (depth * t * aspect), vy / (depth * t)
	end
	return (nx + 1) * 0.5 * w, (1 - ny) * 0.5 * h, depth
end

return newCamera
