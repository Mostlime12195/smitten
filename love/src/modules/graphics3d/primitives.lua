-- graphics3d.primitives: built-in shapes, centered on the origin, with
-- normals and uvs (uv (0, 0) is a texture's top left). Faces wind counter-
-- clockwise seen from outside, like glTF.
--
--   g3d.newBox(w, h, d)
--   g3d.newSphere(radius, segments)            -- segments around (default 24)
--   g3d.newCylinder(radius, height, segments)  -- along y (default 24)
--   g3d.newCapsule(radius, height, segments)   -- height includes the caps (default 16)
--   g3d.newPlane(w, d)                         -- in xz, facing +y

local meshlib = require("graphics3d.mesh")

local sin, cos, pi, max, floor = math.sin, math.cos, math.pi, math.max, math.floor

local P = {}

local function check(name, value, default)
	if value == nil then return default end
	if type(value) ~= "number" or value ~= value then
		error(("graphics3d.%s: expected numbers, got %s"):format(name, type(value)), 3)
	end
	return value
end

-- normal, right, up of each face (right x up = normal)
local FACES = {
	{ 1, 0, 0, 0, 0, -1, 0, 1, 0 },
	{ -1, 0, 0, 0, 0, 1, 0, 1, 0 },
	{ 0, 1, 0, 1, 0, 0, 0, 0, -1 },
	{ 0, -1, 0, 1, 0, 0, 0, 0, 1 },
	{ 0, 0, 1, 1, 0, 0, 0, 1, 0 },
	{ 0, 0, -1, -1, 0, 0, 0, 1, 0 },
}
local CORNERS = { -1, -1, 0, 1, 1, -1, 1, 1, 1, 1, 1, 0, -1, 1, 0, 0 } -- su, sv, u, v

---@return graphics3d.Mesh3D
function P.newBox(w, h, d)
	w = check("newBox", w, 1)
	h = check("newBox", h, w)
	d = check("newBox", d, w)
	local hx, hy, hz = w * 0.5, h * 0.5, d * 0.5
	local positions, normals, uvs, indices = {}, {}, {}, {}
	local p, t, k = 0, 0, 0
	for f = 1, 6 do
		local F = FACES[f]
		local nx, ny, nz, ux, uy, uz, vx, vy, vz = F[1], F[2], F[3], F[4], F[5], F[6], F[7], F[8], F[9]
		local base = (f - 1) * 4
		for c = 0, 3 do
			local su, sv = CORNERS[c * 4 + 1], CORNERS[c * 4 + 2]
			positions[p + 1] = (nx + ux * su + vx * sv) * hx
			positions[p + 2] = (ny + uy * su + vy * sv) * hy
			positions[p + 3] = (nz + uz * su + vz * sv) * hz
			normals[p + 1], normals[p + 2], normals[p + 3] = nx, ny, nz
			p = p + 3
			uvs[t + 1], uvs[t + 2] = CORNERS[c * 4 + 3], CORNERS[c * 4 + 4]
			t = t + 2
		end
		indices[k + 1], indices[k + 2], indices[k + 3] = base + 1, base + 2, base + 3
		indices[k + 4], indices[k + 5], indices[k + 6] = base + 1, base + 3, base + 4
		k = k + 6
	end
	return meshlib.newMesh({ positions = positions, normals = normals, uvs = uvs, indices = indices })
end

-- Rows of vertices around the y axis, joined into quads. rows[i] = {y, radius,
-- ny, nr, v}: height, ring radius, the normal's y and outward parts, and the v
-- texture coordinate. Top row first.
local function lathe(rows, segments)
	local positions, normals, uvs, indices = {}, {}, {}, {}
	local p, t = 0, 0
	local cols = segments + 1
	for i = 1, #rows do
		local row = rows[i]
		local y, r, ny, nr, v = row[1], row[2], row[3], row[4], row[5]
		for j = 0, segments do
			local theta = 2 * pi * j / segments
			local s, c = sin(theta), cos(theta)
			if j == segments then s, c = 0, 1 end
			positions[p + 1], positions[p + 2], positions[p + 3] = r * s, y, r * c
			normals[p + 1], normals[p + 2], normals[p + 3] = nr * s, ny, nr * c
			p = p + 3
			uvs[t + 1], uvs[t + 2] = j / segments, v
			t = t + 2
		end
	end
	local k = 0
	for i = 0, #rows - 2 do
		for j = 0, segments - 1 do
			local a = i * cols + j + 1
			local b = a + cols
			local c = b + 1
			local d = a + 1
			indices[k + 1], indices[k + 2], indices[k + 3] = a, b, c
			indices[k + 4], indices[k + 5], indices[k + 6] = a, c, d
			k = k + 6
		end
	end
	return positions, normals, uvs, indices
end

---@return graphics3d.Mesh3D
function P.newSphere(radius, segments)
	radius = check("newSphere", radius, 0.5)
	segments = max(3, floor(check("newSphere", segments, 24)))
	local rings = max(2, floor(segments / 2))
	local rows = {}
	for i = 0, rings do
		local phi = pi * i / rings
		local ny, nr = cos(phi), sin(phi)
		if i == 0 then ny, nr = 1, 0 elseif i == rings then ny, nr = -1, 0 end
		rows[i + 1] = { radius * ny, radius * nr, ny, nr, i / rings }
	end
	local positions, normals, uvs, indices = lathe(rows, segments)
	return meshlib.newMesh({ positions = positions, normals = normals, uvs = uvs, indices = indices })
end

---@return graphics3d.Mesh3D
function P.newCylinder(radius, height, segments)
	radius = check("newCylinder", radius, 0.5)
	height = check("newCylinder", height, 1)
	segments = max(3, floor(check("newCylinder", segments, 24)))
	local hh = height * 0.5
	local positions, normals, uvs, indices = lathe({
		{ hh, radius, 0, 1, 0 },
		{ -hh, radius, 0, 1, 1 },
	}, segments)
	-- Caps: a center vertex and a ring for each.
	for cap = 1, 2 do
		local y = cap == 1 and hh or -hh
		local ny = cap == 1 and 1 or -1
		local center = #positions / 3 + 1
		positions[#positions + 1], positions[#positions + 2], positions[#positions + 3] = 0, y, 0
		normals[#normals + 1], normals[#normals + 2], normals[#normals + 3] = 0, ny, 0
		uvs[#uvs + 1], uvs[#uvs + 2] = 0.5, 0.5
		for j = 0, segments - 1 do
			local theta = 2 * pi * j / segments
			local s, c = sin(theta), cos(theta)
			positions[#positions + 1], positions[#positions + 2], positions[#positions + 3] = radius * s, y, radius * c
			normals[#normals + 1], normals[#normals + 2], normals[#normals + 3] = 0, ny, 0
			uvs[#uvs + 1], uvs[#uvs + 2] = 0.5 + 0.5 * s, 0.5 + 0.5 * c * ny
		end
		for j = 0, segments - 1 do
			local a = center + 1 + j
			local b = center + 1 + (j + 1) % segments
			if cap == 1 then
				indices[#indices + 1], indices[#indices + 2], indices[#indices + 3] = center, a, b
			else
				indices[#indices + 1], indices[#indices + 2], indices[#indices + 3] = center, b, a
			end
		end
	end
	return meshlib.newMesh({ positions = positions, normals = normals, uvs = uvs, indices = indices })
end

---@return graphics3d.Mesh3D
function P.newCapsule(radius, height, segments)
	radius = check("newCapsule", radius, 0.5)
	height = check("newCapsule", height, 2)
	segments = max(3, floor(check("newCapsule", segments, 16)))
	if height < radius * 2 then height = radius * 2 end
	local hc = (height - radius * 2) * 0.5 -- half the straight part
	local rings = max(2, floor(segments / 4))
	local rows = {}
	for half = 0, 1 do
		for i = 0, rings do
			local phi = (pi * 0.5) * (i / rings + half)
			local ny, nr = cos(phi), sin(phi)
			if half == 0 and i == 0 then ny, nr = 1, 0 end
			if half == 1 and i == rings then ny, nr = -1, 0 end
			if (half == 0 and i == rings) or (half == 1 and i == 0) then ny, nr = 0, 1 end
			local y = radius * ny + (half == 0 and hc or -hc)
			rows[#rows + 1] = { y, radius * nr, ny, nr, (height * 0.5 - y) / height }
		end
	end
	local positions, normals, uvs, indices = lathe(rows, segments)
	return meshlib.newMesh({ positions = positions, normals = normals, uvs = uvs, indices = indices })
end

---@return graphics3d.Mesh3D
function P.newPlane(w, d)
	w = check("newPlane", w, 1)
	d = check("newPlane", d, w)
	local hw, hd = w * 0.5, d * 0.5
	return meshlib.newMesh({
		positions = { -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd },
		normals = { 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0 },
		uvs = { 0, 0, 1, 0, 1, 1, 0, 1 },
		indices = { 4, 3, 2, 4, 2, 1 },
	})
end

return P
