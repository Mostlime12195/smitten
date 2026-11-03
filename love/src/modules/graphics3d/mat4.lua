-- graphics3d.mat4: 4x4 matrices as flat tables of 16 numbers, column-major
-- (the layout of OpenGL and glTF): m[1..4] is the first column and the
-- translation is m[13], m[14], m[15]. love.graphics.setProjection("column", m)
-- and Transform:setMatrix("column", m) take them as they are.
--
-- Functions write into an `out` table passed first, so a game can keep its
-- matrices and never allocate per frame:
--
--   local m = mat4.new()
--   mat4.fromTRS(m, x, y, z, qx, qy, qz, qw, sx, sy, sz)
--   mat4.multiply(m, parent, m)       -- out may be one of the inputs
--
-- When `out` is left out, a new matrix is returned.

local sqrt, tan, abs = math.sqrt, math.tan, math.abs
local type = type

local mat4 = {}

---A new matrix: identity, a copy of `m`, or the 16 given numbers (column-major).
---@return table
function mat4.new(a, ...)
	if type(a) == "table" then
		return { a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13], a[14], a[15], a[16] }
	elseif type(a) == "number" then
		return { a, ... }
	end
	return { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }
end

local new = mat4.new

---@param out table?
---@return table out
function mat4.identity(out)
	out = out or {}
	out[1], out[2], out[3], out[4] = 1, 0, 0, 0
	out[5], out[6], out[7], out[8] = 0, 1, 0, 0
	out[9], out[10], out[11], out[12] = 0, 0, 1, 0
	out[13], out[14], out[15], out[16] = 0, 0, 0, 1
	return out
end

---@param out table
---@param m table
---@return table out
function mat4.copy(out, m)
	if m == nil then out, m = {}, out end
	for i = 1, 16 do out[i] = m[i] end
	return out
end

---out = a * b (b is applied first). out may be a or b.
---@param out table
---@param a table
---@param b table?
---@return table out
function mat4.multiply(out, a, b)
	if b == nil then out, a, b = {}, out, a end
	local a1, a2, a3, a4 = a[1], a[2], a[3], a[4]
	local a5, a6, a7, a8 = a[5], a[6], a[7], a[8]
	local a9, a10, a11, a12 = a[9], a[10], a[11], a[12]
	local a13, a14, a15, a16 = a[13], a[14], a[15], a[16]

	local b1, b2, b3, b4 = b[1], b[2], b[3], b[4]
	out[1] = a1 * b1 + a5 * b2 + a9 * b3 + a13 * b4
	out[2] = a2 * b1 + a6 * b2 + a10 * b3 + a14 * b4
	out[3] = a3 * b1 + a7 * b2 + a11 * b3 + a15 * b4
	out[4] = a4 * b1 + a8 * b2 + a12 * b3 + a16 * b4

	b1, b2, b3, b4 = b[5], b[6], b[7], b[8]
	out[5] = a1 * b1 + a5 * b2 + a9 * b3 + a13 * b4
	out[6] = a2 * b1 + a6 * b2 + a10 * b3 + a14 * b4
	out[7] = a3 * b1 + a7 * b2 + a11 * b3 + a15 * b4
	out[8] = a4 * b1 + a8 * b2 + a12 * b3 + a16 * b4

	b1, b2, b3, b4 = b[9], b[10], b[11], b[12]
	out[9] = a1 * b1 + a5 * b2 + a9 * b3 + a13 * b4
	out[10] = a2 * b1 + a6 * b2 + a10 * b3 + a14 * b4
	out[11] = a3 * b1 + a7 * b2 + a11 * b3 + a15 * b4
	out[12] = a4 * b1 + a8 * b2 + a12 * b3 + a16 * b4

	b1, b2, b3, b4 = b[13], b[14], b[15], b[16]
	out[13] = a1 * b1 + a5 * b2 + a9 * b3 + a13 * b4
	out[14] = a2 * b1 + a6 * b2 + a10 * b3 + a14 * b4
	out[15] = a3 * b1 + a7 * b2 + a11 * b3 + a15 * b4
	out[16] = a4 * b1 + a8 * b2 + a12 * b3 + a16 * b4
	return out
end

---Translation, rotation (a unit quaternion) and scale: out = T * R * S.
---Rotation defaults to none and scale to 1.
---@return table out
function mat4.fromTRS(out, x, y, z, qx, qy, qz, qw, sx, sy, sz)
	if type(out) ~= "table" then
		return mat4.fromTRS(new(), out, x, y, z, qx, qy, qz, qw, sx, sy)
	end
	qx, qy, qz, qw = qx or 0, qy or 0, qz or 0, qw or 1
	sx = sx or 1
	sy = sy or sx
	sz = sz or sx
	local xx, yy, zz = qx * qx, qy * qy, qz * qz
	local xy, xz, yz = qx * qy, qx * qz, qy * qz
	local wx, wy, wz = qw * qx, qw * qy, qw * qz
	out[1] = (1 - 2 * (yy + zz)) * sx
	out[2] = 2 * (xy + wz) * sx
	out[3] = 2 * (xz - wy) * sx
	out[4] = 0
	out[5] = 2 * (xy - wz) * sy
	out[6] = (1 - 2 * (xx + zz)) * sy
	out[7] = 2 * (yz + wx) * sy
	out[8] = 0
	out[9] = 2 * (xz + wy) * sz
	out[10] = 2 * (yz - wx) * sz
	out[11] = (1 - 2 * (xx + yy)) * sz
	out[12] = 0
	out[13], out[14], out[15], out[16] = x or 0, y or 0, z or 0, 1
	return out
end

---Splits an affine matrix into translation, rotation and scale.
---@return number x, number y, number z, number qx, number qy, number qz, number qw, number sx, number sy, number sz
function mat4.decompose(m)
	local sx = sqrt(m[1] * m[1] + m[2] * m[2] + m[3] * m[3])
	local sy = sqrt(m[5] * m[5] + m[6] * m[6] + m[7] * m[7])
	local sz = sqrt(m[9] * m[9] + m[10] * m[10] + m[11] * m[11])
	-- A mirrored matrix: put the flip in x.
	local det = m[1] * (m[6] * m[11] - m[7] * m[10]) - m[5] * (m[2] * m[11] - m[3] * m[10]) + m[9] * (m[2] * m[7] - m[3] * m[6])
	if det < 0 then sx = -sx end
	local isx = sx ~= 0 and 1 / sx or 0
	local isy = sy ~= 0 and 1 / sy or 0
	local isz = sz ~= 0 and 1 / sz or 0
	local r00, r10, r20 = m[1] * isx, m[2] * isx, m[3] * isx
	local r01, r11, r21 = m[5] * isy, m[6] * isy, m[7] * isy
	local r02, r12, r22 = m[9] * isz, m[10] * isz, m[11] * isz
	local qx, qy, qz, qw
	local trace = r00 + r11 + r22
	if trace > 0 then
		local s = 0.5 / sqrt(trace + 1)
		qw = 0.25 / s
		qx = (r21 - r12) * s
		qy = (r02 - r20) * s
		qz = (r10 - r01) * s
	elseif r00 > r11 and r00 > r22 then
		local s = 2 * sqrt(1 + r00 - r11 - r22)
		qw = (r21 - r12) / s
		qx = 0.25 * s
		qy = (r01 + r10) / s
		qz = (r02 + r20) / s
	elseif r11 > r22 then
		local s = 2 * sqrt(1 + r11 - r00 - r22)
		qw = (r02 - r20) / s
		qx = (r01 + r10) / s
		qy = 0.25 * s
		qz = (r12 + r21) / s
	else
		local s = 2 * sqrt(1 + r22 - r00 - r11)
		qw = (r10 - r01) / s
		qx = (r02 + r20) / s
		qy = (r12 + r21) / s
		qz = 0.25 * s
	end
	local len = sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
	if len > 0 then qx, qy, qz, qw = qx / len, qy / len, qz / len, qw / len end
	return m[13], m[14], m[15], qx, qy, qz, qw, sx, sy, sz
end

---out = m⁻¹. Returns out and false (leaving out unchanged) when m is singular.
---@return table out, boolean ok
function mat4.invert(out, m)
	if m == nil then out, m = {}, out end
	local a00, a01, a02, a03 = m[1], m[2], m[3], m[4]
	local a10, a11, a12, a13 = m[5], m[6], m[7], m[8]
	local a20, a21, a22, a23 = m[9], m[10], m[11], m[12]
	local a30, a31, a32, a33 = m[13], m[14], m[15], m[16]

	local b00 = a00 * a11 - a01 * a10
	local b01 = a00 * a12 - a02 * a10
	local b02 = a00 * a13 - a03 * a10
	local b03 = a01 * a12 - a02 * a11
	local b04 = a01 * a13 - a03 * a11
	local b05 = a02 * a13 - a03 * a12
	local b06 = a20 * a31 - a21 * a30
	local b07 = a20 * a32 - a22 * a30
	local b08 = a20 * a33 - a23 * a30
	local b09 = a21 * a32 - a22 * a31
	local b10 = a21 * a33 - a23 * a31
	local b11 = a22 * a33 - a23 * a32

	local det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
	if det == 0 or det ~= det then return out, false end
	det = 1 / det

	out[1] = (a11 * b11 - a12 * b10 + a13 * b09) * det
	out[2] = (a02 * b10 - a01 * b11 - a03 * b09) * det
	out[3] = (a31 * b05 - a32 * b04 + a33 * b03) * det
	out[4] = (a22 * b04 - a21 * b05 - a23 * b03) * det
	out[5] = (a12 * b08 - a10 * b11 - a13 * b07) * det
	out[6] = (a00 * b11 - a02 * b08 + a03 * b07) * det
	out[7] = (a32 * b02 - a30 * b05 - a33 * b01) * det
	out[8] = (a20 * b05 - a22 * b02 + a23 * b01) * det
	out[9] = (a10 * b10 - a11 * b08 + a13 * b06) * det
	out[10] = (a01 * b08 - a00 * b10 - a03 * b06) * det
	out[11] = (a30 * b04 - a31 * b02 + a33 * b00) * det
	out[12] = (a21 * b02 - a20 * b04 - a23 * b00) * det
	out[13] = (a11 * b07 - a10 * b09 - a12 * b06) * det
	out[14] = (a00 * b09 - a01 * b07 + a02 * b06) * det
	out[15] = (a31 * b01 - a30 * b03 - a32 * b00) * det
	out[16] = (a20 * b03 - a21 * b01 + a22 * b00) * det
	return out, true
end

---@return table out
function mat4.transpose(out, m)
	if m == nil then out, m = {}, out end
	local m2, m3, m4, m7, m8, m12 = m[2], m[3], m[4], m[7], m[8], m[12]
	out[1], out[6], out[11], out[16] = m[1], m[6], m[11], m[16]
	out[2], out[3], out[4] = m[5], m[9], m[13]
	out[5], out[9], out[13] = m2, m3, m4
	out[7], out[8] = m[10], m[14]
	out[10], out[14] = m7, m8
	out[12], out[15] = m[15], m12
	return out
end

---OpenGL perspective projection (right-handed, looking down -z, depth -1..1).
---@param fovy number vertical field of view in radians
---@return table out
function mat4.perspective(out, fovy, aspect, near, far)
	if type(out) ~= "table" then
		return mat4.perspective(new(), out, fovy, aspect, near)
	end
	local f = 1 / tan(fovy * 0.5)
	out[1], out[2], out[3], out[4] = f / aspect, 0, 0, 0
	out[5], out[6], out[7], out[8] = 0, f, 0, 0
	out[9], out[10], out[12] = 0, 0, -1
	out[13], out[14], out[16] = 0, 0, 0
	if far == nil or far == math.huge then
		out[11] = -1
		out[15] = -2 * near
	else
		out[11] = (far + near) / (near - far)
		out[15] = 2 * far * near / (near - far)
	end
	return out
end

---OpenGL orthographic projection.
---@return table out
function mat4.orthographic(out, left, right, bottom, top, near, far)
	if type(out) ~= "table" then
		return mat4.orthographic(new(), out, left, right, bottom, top, near)
	end
	local rl, tb, fn = right - left, top - bottom, far - near
	out[1], out[2], out[3], out[4] = 2 / rl, 0, 0, 0
	out[5], out[6], out[7], out[8] = 0, 2 / tb, 0, 0
	out[9], out[10], out[11], out[12] = 0, 0, -2 / fn, 0
	out[13] = -(right + left) / rl
	out[14] = -(top + bottom) / tb
	out[15] = -(far + near) / fn
	out[16] = 1
	return out
end

---A view matrix for an eye at (ex, ey, ez) looking at (tx, ty, tz). Up defaults to +y.
---@return table out
function mat4.lookAt(out, ex, ey, ez, tx, ty, tz, ux, uy, uz)
	if type(out) ~= "table" then
		return mat4.lookAt(new(), out, ex, ey, ez, tx, ty, tz, ux, uy)
	end
	ux, uy, uz = ux or 0, uy or 1, uz or 0
	local fx, fy, fz = tx - ex, ty - ey, tz - ez
	local len = sqrt(fx * fx + fy * fy + fz * fz)
	if len == 0 then return mat4.identity(out) end
	fx, fy, fz = fx / len, fy / len, fz / len
	-- s = f x up
	local sx, sy, sz = fy * uz - fz * uy, fz * ux - fx * uz, fx * uy - fy * ux
	len = sqrt(sx * sx + sy * sy + sz * sz)
	if len < 1e-9 then
		-- Looking along up: pick another up.
		ux, uy, uz = 0, 0, (fy > 0) and 1 or -1
		sx, sy, sz = fy * uz - fz * uy, fz * ux - fx * uz, fx * uy - fy * ux
		len = sqrt(sx * sx + sy * sy + sz * sz)
	end
	sx, sy, sz = sx / len, sy / len, sz / len
	-- u = s x f
	local vx, vy, vz = sy * fz - sz * fy, sz * fx - sx * fz, sx * fy - sy * fx
	out[1], out[5], out[9] = sx, sy, sz
	out[2], out[6], out[10] = vx, vy, vz
	out[3], out[7], out[11] = -fx, -fy, -fz
	out[4], out[8], out[12] = 0, 0, 0
	out[13] = -(sx * ex + sy * ey + sz * ez)
	out[14] = -(vx * ex + vy * ey + vz * ez)
	out[15] = fx * ex + fy * ey + fz * ez
	out[16] = 1
	return out
end

---Transforms a point, dividing by w when the matrix is projective.
---@return number x, number y, number z, number w
function mat4.transformPoint(m, x, y, z)
	local rx = m[1] * x + m[5] * y + m[9] * z + m[13]
	local ry = m[2] * x + m[6] * y + m[10] * z + m[14]
	local rz = m[3] * x + m[7] * y + m[11] * z + m[15]
	local rw = m[4] * x + m[8] * y + m[12] * z + m[16]
	if rw ~= 1 and rw ~= 0 then
		return rx / rw, ry / rw, rz / rw, rw
	end
	return rx, ry, rz, rw
end

---Transforms a direction (no translation).
---@return number x, number y, number z
function mat4.transformDirection(m, x, y, z)
	return m[1] * x + m[5] * y + m[9] * z,
		m[2] * x + m[6] * y + m[10] * z,
		m[3] * x + m[7] * y + m[11] * z
end

---@return number x, number y, number z
function mat4.getTranslation(m)
	return m[13], m[14], m[15]
end

---The determinant of the upper 3x3 (negative for mirrored transforms).
function mat4.determinant3(m)
	return m[1] * (m[6] * m[11] - m[7] * m[10])
		- m[5] * (m[2] * m[11] - m[3] * m[10])
		+ m[9] * (m[2] * m[7] - m[3] * m[6])
end

---True when every element differs by at most eps.
function mat4.equals(a, b, eps)
	eps = eps or 1e-6
	for i = 1, 16 do
		if abs(a[i] - b[i]) > eps then return false end
	end
	return true
end

return mat4
