-- graphics3d.quat: unit quaternions passed as four numbers (x, y, z, w), so
-- rotating things never allocates:
--
--   local qx, qy, qz, qw = quat.fromEuler(0, math.pi / 2, 0)
--   mat4.fromTRS(m, x, y, z, qx, qy, qz, qw)
--   camera:setTransform(x, y, z, quat.lookRotation(dx, dy, dz))
--
-- Euler angles are in radians and in YXZ order, like Godot: yaw (y), then
-- pitch (x), then roll (z). Forward is -z and up is +y.
--
-- Lua keeps all four results only when the call is the last argument; when
-- more arguments follow, unpack into locals first:
--   local qx, qy, qz, qw = quat.fromEuler(0, yaw, 0)
--   mat4.fromTRS(m, x, y, z, qx, qy, qz, qw, sx, sy, sz)

local sin, cos, sqrt, asin, atan2, acos, abs = math.sin, math.cos, math.sqrt, math.asin, math.atan2 or math.atan, math.acos, math.abs

local quat = {}

---@return number x, number y, number z, number w
function quat.identity()
	return 0, 0, 0, 1
end

---@return number x, number y, number z, number w
function quat.normalize(x, y, z, w)
	local len = sqrt(x * x + y * y + z * z + w * w)
	if len == 0 then return 0, 0, 0, 1 end
	return x / len, y / len, z / len, w / len
end

---The inverse of a unit quaternion.
---@return number x, number y, number z, number w
function quat.conjugate(x, y, z, w)
	return -x, -y, -z, w
end

---a * b: the rotation b followed by a.
---@return number x, number y, number z, number w
function quat.multiply(ax, ay, az, aw, bx, by, bz, bw)
	return aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz
end

---Rotation from Euler angles in radians, YXZ order (q = qy * qx * qz).
---@return number x, number y, number z, number w
function quat.fromEuler(x, y, z)
	local hx, hy, hz = x * 0.5, y * 0.5, z * 0.5
	local cx, sx = cos(hx), sin(hx)
	local cy, sy = cos(hy), sin(hy)
	local cz, sz = cos(hz), sin(hz)
	return cy * sx * cz + sy * cx * sz,
		sy * cx * cz - cy * sx * sz,
		cy * cx * sz - sy * sx * cz,
		cy * cx * cz + sy * sx * sz
end

---Euler angles (radians, YXZ order) of a rotation; the inverse of fromEuler.
---@return number x, number y, number z
function quat.toEuler(qx, qy, qz, qw)
	-- Rotation matrix elements (row, column) that YXZ needs.
	local m12 = 2 * (qy * qz - qw * qx)
	if m12 < 1 - 1e-7 then
		if m12 > -(1 - 1e-7) then
			local m02 = 2 * (qx * qz + qw * qy)
			local m22 = 1 - 2 * (qx * qx + qy * qy)
			local m10 = 2 * (qx * qy + qw * qz)
			local m11 = 1 - 2 * (qx * qx + qz * qz)
			return asin(-m12), atan2(m02, m22), atan2(m10, m11)
		else
			local m01 = 2 * (qx * qy - qw * qz)
			local m00 = 1 - 2 * (qy * qy + qz * qz)
			return math.pi * 0.5, atan2(m01, m00), 0
		end
	else
		local m01 = 2 * (qx * qy - qw * qz)
		local m00 = 1 - 2 * (qy * qy + qz * qz)
		return -math.pi * 0.5, -atan2(m01, m00), 0
	end
end

---Rotation of `angle` radians around an axis (normalized here).
---@return number x, number y, number z, number w
function quat.fromAxisAngle(ax, ay, az, angle)
	local len = sqrt(ax * ax + ay * ay + az * az)
	if len == 0 then return 0, 0, 0, 1 end
	local s = sin(angle * 0.5) / len
	return ax * s, ay * s, az * s, cos(angle * 0.5)
end

---Axis (unit) and angle of a rotation.
---@return number ax, number ay, number az, number angle
function quat.toAxisAngle(x, y, z, w)
	if w > 1 then w = 1 elseif w < -1 then w = -1 end
	local angle = 2 * acos(w)
	local s = sqrt(1 - w * w)
	if s < 1e-9 then return 1, 0, 0, 0 end
	return x / s, y / s, z / s, angle
end

---Spherical interpolation from a to b, the short way round.
---@return number x, number y, number z, number w
function quat.slerp(ax, ay, az, aw, bx, by, bz, bw, t)
	local d = ax * bx + ay * by + az * bz + aw * bw
	if d < 0 then
		d = -d
		bx, by, bz, bw = -bx, -by, -bz, -bw
	end
	local s0, s1
	if d > 0.9995 then
		s0, s1 = 1 - t, t
	else
		local theta = acos(d)
		local st = sin(theta)
		s0 = sin((1 - t) * theta) / st
		s1 = sin(t * theta) / st
	end
	return quat.normalize(ax * s0 + bx * s1, ay * s0 + by * s1, az * s0 + bz * s1, aw * s0 + bw * s1)
end

---Rotates the vector (vx, vy, vz).
---@return number x, number y, number z
function quat.rotateVector(qx, qy, qz, qw, vx, vy, vz)
	-- t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
	local tx = 2 * (qy * vz - qz * vy)
	local ty = 2 * (qz * vx - qx * vz)
	local tz = 2 * (qx * vy - qy * vx)
	return vx + qw * tx + (qy * tz - qz * ty),
		vy + qw * ty + (qz * tx - qx * tz),
		vz + qw * tz + (qx * ty - qy * tx)
end

---Rotation from the columns of a rotation matrix (x axis, y axis, z axis).
---@return number x, number y, number z, number w
function quat.fromBasis(r00, r10, r20, r01, r11, r21, r02, r12, r22)
	local qx, qy, qz, qw
	local trace = r00 + r11 + r22
	if trace > 0 then
		local s = 0.5 / sqrt(trace + 1)
		qw, qx, qy, qz = 0.25 / s, (r21 - r12) * s, (r02 - r20) * s, (r10 - r01) * s
	elseif r00 > r11 and r00 > r22 then
		local s = 2 * sqrt(1 + r00 - r11 - r22)
		qw, qx, qy, qz = (r21 - r12) / s, 0.25 * s, (r01 + r10) / s, (r02 + r20) / s
	elseif r11 > r22 then
		local s = 2 * sqrt(1 + r11 - r00 - r22)
		qw, qx, qy, qz = (r02 - r20) / s, (r01 + r10) / s, 0.25 * s, (r12 + r21) / s
	else
		local s = 2 * sqrt(1 + r22 - r00 - r11)
		qw, qx, qy, qz = (r10 - r01) / s, (r02 + r20) / s, (r12 + r21) / s, 0.25 * s
	end
	return quat.normalize(qx, qy, qz, qw)
end

---The rotation that points forward (-z) along (dx, dy, dz), with up as close to
---(ux, uy, uz) as it can be (default +y).
---@return number x, number y, number z, number w
function quat.lookRotation(dx, dy, dz, ux, uy, uz)
	ux, uy, uz = ux or 0, uy or 1, uz or 0
	local len = sqrt(dx * dx + dy * dy + dz * dz)
	if len == 0 then return 0, 0, 0, 1 end
	-- z axis points backwards.
	local zx, zy, zz = -dx / len, -dy / len, -dz / len
	-- x = up × z
	local xx, xy, xz = uy * zz - uz * zy, uz * zx - ux * zz, ux * zy - uy * zx
	len = sqrt(xx * xx + xy * xy + xz * xz)
	if len < 1e-9 then
		-- Looking straight along up: use another up.
		if abs(zy) > 0.9 then ux, uy, uz = 0, 0, (zy > 0) and 1 or -1 else ux, uy, uz = 0, 1, 0 end
		xx, xy, xz = uy * zz - uz * zy, uz * zx - ux * zz, ux * zy - uy * zx
		len = sqrt(xx * xx + xy * xy + xz * xz)
	end
	xx, xy, xz = xx / len, xy / len, xz / len
	-- y = z × x
	local yx, yy, yz = zy * xz - zz * xy, zz * xx - zx * xz, zx * xy - zy * xx
	return quat.fromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz)
end

return quat
