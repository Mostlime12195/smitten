-- graphics3d.mesh: Mesh3D, triangles on the GPU with a bounding box.
--
--   local tri = g3d.newMesh{
--       positions = {0,0,0,  1,0,0,  0,1,0},
--       uvs = {0,0, 1,0, 0,1},          -- optional
--       normals = {...},                -- optional, computed when missing
--       colors = {...},                 -- optional, rgba (or rgb) per vertex
--       indices = {1, 2, 3},            -- optional, 1-based
--   }
--
-- Each attribute lives in its own vertex buffer at a fixed shader location
-- (see ATTRIBUTE below), so glTF data can be uploaded as it is.

local sqrt = math.sqrt

local M = {}

local function srgbToLinear(c)
	if c <= 0.04045 then return c / 12.92 end
	return ((c + 0.055) / 1.055) ^ 2.4
end
M.srgbToLinear = srgbToLinear

-- Vertex attribute locations shared by the meshes and the shaders. 0-2 are
-- LÖVE's own VertexPosition, VertexTexCoord and VertexColor.
M.ATTRIBUTE = { position = 0, uv = 1, color = 2, normal = 3 }

---@class graphics3d.Mesh3D
---@field mesh love.Mesh the LÖVE mesh (attributes at the locations in ATTRIBUTE)
---@field vertexCount integer
---@field triangleCount integer
---@field minx number
---@field miny number
---@field minz number
---@field maxx number
---@field maxy number
---@field maxz number
local Mesh3D = {}
Mesh3D.__index = Mesh3D
Mesh3D.isMesh3D = true
M.Mesh3D = Mesh3D

---@return number minx, number miny, number minz, number maxx, number maxy, number maxz
function Mesh3D:getBounds()
	return self.minx, self.miny, self.minz, self.maxx, self.maxy, self.maxz
end

---@return love.Mesh
function Mesh3D:getLoveMesh()
	return self.mesh
end

function Mesh3D:release()
	if self.mesh then self.mesh:release() end
	self.mesh = nil
end

---Wraps a LÖVE mesh whose attributes already use the locations in ATTRIBUTE.
function M.wrap(mesh, vertexCount, triangleCount, minx, miny, minz, maxx, maxy, maxz)
	return setmetatable({
		mesh = mesh,
		vertexCount = vertexCount,
		triangleCount = triangleCount,
		minx = minx, miny = miny, minz = minz,
		maxx = maxx, maxy = maxy, maxz = maxz,
	}, Mesh3D)
end

---The bounding box of a flat xyz array.
function M.bounds(positions, count)
	count = count or #positions / 3
	if count == 0 then return 0, 0, 0, 0, 0, 0 end
	local minx, miny, minz = math.huge, math.huge, math.huge
	local maxx, maxy, maxz = -math.huge, -math.huge, -math.huge
	for i = 0, count - 1 do
		local x, y, z = positions[i * 3 + 1], positions[i * 3 + 2], positions[i * 3 + 3]
		if x < minx then minx = x end
		if x > maxx then maxx = x end
		if y < miny then miny = y end
		if y > maxy then maxy = y end
		if z < minz then minz = z end
		if z > maxz then maxz = z end
	end
	return minx, miny, minz, maxx, maxy, maxz
end

---Smooth normals for a flat xyz array: each vertex gets the area-weighted
---average of the faces using it. indices are 0-based (or nil: a triangle list).
function M.computeNormals(positions, vertexCount, indices, indexCount)
	local normals = {}
	for i = 1, vertexCount * 3 do normals[i] = 0 end
	local triCount = indices and indexCount / 3 or vertexCount / 3
	for t = 0, triCount - 1 do
		local a, b, c
		if indices then
			a, b, c = indices[t * 3 + 1], indices[t * 3 + 2], indices[t * 3 + 3]
		else
			a, b, c = t * 3, t * 3 + 1, t * 3 + 2
		end
		local ax, ay, az = positions[a * 3 + 1], positions[a * 3 + 2], positions[a * 3 + 3]
		local e1x, e1y, e1z = positions[b * 3 + 1] - ax, positions[b * 3 + 2] - ay, positions[b * 3 + 3] - az
		local e2x, e2y, e2z = positions[c * 3 + 1] - ax, positions[c * 3 + 2] - ay, positions[c * 3 + 3] - az
		local nx = e1y * e2z - e1z * e2y
		local ny = e1z * e2x - e1x * e2z
		local nz = e1x * e2y - e1y * e2x
		normals[a * 3 + 1] = normals[a * 3 + 1] + nx
		normals[a * 3 + 2] = normals[a * 3 + 2] + ny
		normals[a * 3 + 3] = normals[a * 3 + 3] + nz
		normals[b * 3 + 1] = normals[b * 3 + 1] + nx
		normals[b * 3 + 2] = normals[b * 3 + 2] + ny
		normals[b * 3 + 3] = normals[b * 3 + 3] + nz
		normals[c * 3 + 1] = normals[c * 3 + 1] + nx
		normals[c * 3 + 2] = normals[c * 3 + 2] + ny
		normals[c * 3 + 3] = normals[c * 3 + 3] + nz
	end
	for i = 0, vertexCount - 1 do
		local x, y, z = normals[i * 3 + 1], normals[i * 3 + 2], normals[i * 3 + 3]
		local len = sqrt(x * x + y * y + z * z)
		if len > 0 then
			normals[i * 3 + 1], normals[i * 3 + 2], normals[i * 3 + 3] = x / len, y / len, z / len
		else
			normals[i * 3 + 2] = 1
		end
	end
	return normals
end

local function vertexBuffer(format, location, data)
	return love.graphics.newBuffer({ { format = format, location = location } }, data, { vertex = true, usage = "static" })
end
M.vertexBuffer = vertexBuffer

---A Mesh3D from flat Lua arrays (see the top of this file).
---@return graphics3d.Mesh3D
function M.newMesh(opts)
	if type(opts) ~= "table" or type(opts.positions) ~= "table" then
		error("graphics3d.newMesh: expected a table with a flat `positions` array, like {positions = {x1,y1,z1, x2,y2,z2, ...}}", 2)
	end
	local positions = opts.positions
	if #positions % 3 ~= 0 or #positions == 0 then
		error("graphics3d.newMesh: `positions` needs 3 numbers per vertex", 2)
	end
	local vertexCount = #positions / 3

	local indices, indexCount = nil, 0
	if opts.indices then
		local src = opts.indices
		indexCount = #src
		if indexCount % 3 ~= 0 then error("graphics3d.newMesh: `indices` needs 3 per triangle", 2) end
		indices = {}
		for i = 1, indexCount do
			local v = src[i]
			if v < 1 or v > vertexCount then
				error(("graphics3d.newMesh: index %d is %s, outside 1..%d"):format(i, tostring(v), vertexCount), 2)
			end
			indices[i] = v - 1
		end
	elseif vertexCount % 3 ~= 0 then
		error("graphics3d.newMesh: without `indices`, positions must hold whole triangles (3 vertices each)", 2)
	end

	local normals = opts.normals
	if normals == nil then
		normals = M.computeNormals(positions, vertexCount, indices, indexCount)
	elseif #normals ~= vertexCount * 3 then
		error("graphics3d.newMesh: `normals` needs 3 numbers per vertex", 2)
	end

	local A = M.ATTRIBUTE
	local attributes = {
		{ buffer = vertexBuffer("floatvec3", A.position, positions), location = A.position },
		{ buffer = vertexBuffer("floatvec3", A.normal, normals), location = A.normal },
	}
	if opts.uvs then
		if #opts.uvs ~= vertexCount * 2 then error("graphics3d.newMesh: `uvs` needs 2 numbers per vertex", 2) end
		attributes[#attributes + 1] = { buffer = vertexBuffer("floatvec2", A.uv, opts.uvs), location = A.uv }
	end
	if opts.colors then
		local src = opts.colors
		local n = #src
		local format, comps
		if n == vertexCount * 4 then format, comps = "floatvec4", 4
		elseif n == vertexCount * 3 then format, comps = "floatvec3", 3
		else error("graphics3d.newMesh: `colors` needs 4 (or 3) numbers per vertex", 2) end
		-- Colors are given in sRGB like every LÖVE color; the shaders want
		-- linear vertex colors (as glTF stores them).
		local linear = {}
		for i = 1, n do
			local c = src[i]
			if i % comps ~= 0 or comps == 3 then c = srgbToLinear(c) end
			linear[i] = c
		end
		attributes[#attributes + 1] = { buffer = vertexBuffer(format, A.color, linear), location = A.color }
	end

	local mesh = love.graphics.newMesh(attributes, "triangles")
	if indices then
		local ib = love.graphics.newBuffer(vertexCount > 65535 and "uint32" or "uint16", indices, { index = true, usage = "static" })
		mesh:setIndexBuffer(ib)
	end
	local triangleCount = (indices and indexCount or vertexCount) / 3
	return M.wrap(mesh, vertexCount, triangleCount, M.bounds(positions, vertexCount))
end

return M
