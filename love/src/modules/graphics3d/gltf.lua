-- graphics3d.gltf: loads glTF 2.0 models (.gltf with external or embedded
-- base64 buffers, and .glb) into a Model.
--
--   local model = g3d.loadModel("models/ship.glb")
--   g3d.draw(model, matrix)
--   local minx, miny, minz, maxx, maxy, maxz = model:getBounds()
--
-- Supported: triangle (and strip) primitives with POSITION, NORMAL,
-- TEXCOORD_0 and COLOR_0; u8/u16/u32 indices; pbrMetallicRoughness base
-- color factor and texture, metallic and roughness factors, emissive factor
-- (and KHR_materials_emissive_strength), alphaMode and alphaCutoff,
-- doubleSided; images in buffers, data URIs or files next to the model; the
-- node hierarchy (TRS or matrix) of the default scene. Vertex data goes to
-- the GPU straight from the file's bytes whenever LÖVE has a matching vertex
-- format; only the rest (u8 indices, u8 texture coordinates, rgb colors in
-- integers, missing normals) is converted in Lua. Skins, morph targets,
-- animations, cameras and lights are ignored.

local json = require("graphics3d.json")
local mat4 = require("graphics3d.mat4")
local meshlib = require("graphics3d.mesh")
local materiallib = require("graphics3d.material")

local abs, huge = math.abs, math.huge

local G = {}

local A = meshlib.ATTRIBUTE

-- componentType -> bytes, Data getter, normalization divisor
local COMPONENTS = {
	[5120] = { 1, "getInt8", 127 },
	[5121] = { 1, "getUInt8", 255 },
	[5122] = { 2, "getInt16", 32767 },
	[5123] = { 2, "getUInt16", 65535 },
	[5125] = { 4, "getUInt32", 4294967295 },
	[5126] = { 4, "getFloat", 1 },
}
local NCOMPONENTS = { SCALAR = 1, VEC2 = 2, VEC3 = 3, VEC4 = 4, MAT2 = 4, MAT3 = 9, MAT4 = 16 }

-- LÖVE vertex formats that read glTF data as it is: [componentType][count][normalized]
local DIRECT = {
	[5126] = { [1] = { [false] = "float" }, [2] = { [false] = "floatvec2" }, [3] = { [false] = "floatvec3" }, [4] = { [false] = "floatvec4" } },
	[5121] = { [4] = { [true] = "unorm8vec4" } },
	[5120] = { [4] = { [true] = "snorm8vec4" } },
	[5123] = { [2] = { [true] = "unorm16vec2" }, [4] = { [true] = "unorm16vec4" } },
	[5122] = { [2] = { [true] = "snorm16vec2" }, [4] = { [true] = "snorm16vec4" } },
}
local FLOAT_FORMATS = { "float", "floatvec2", "floatvec3", "floatvec4" }

local function linearToSrgb(c)
	if c <= 0.0031308 then return c * 12.92 end
	return 1.055 * c ^ (1 / 2.4) - 0.055
end

local function uriDecode(s)
	return (s:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
end

---@class graphics3d.Model
---@field nodes table[] every node: name, index, parent, children, mesh, x,y,z, qx,qy,qz,qw, sx,sy,sz, localMatrix, matrix
---@field roots table[] the nodes of the scene's top level
---@field meshes table[] {name, primitives = {{mesh = Mesh3D, material = Material}, ...}}
---@field materials graphics3d.Material[]
---@field images love.Image[]
---@field drawList table[] {node, mesh, material} for every primitive in the scene
local Model = {}
Model.__index = Model
Model.isModel = true
G.Model = Model

---Recomputes every node's localMatrix from its TRS fields and its matrix
---(relative to the model) from its parents. Call after changing node TRS.
function Model:updateMatrices()
	local function visit(node, parentMatrix)
		mat4.fromTRS(node.localMatrix, node.x, node.y, node.z, node.qx, node.qy, node.qz, node.qw, node.sx, node.sy, node.sz)
		if parentMatrix then
			mat4.multiply(node.matrix, parentMatrix, node.localMatrix)
		else
			mat4.copy(node.matrix, node.localMatrix)
		end
		for i = 1, #node.children do visit(node.children[i], node.matrix) end
	end
	for i = 1, #self.roots do visit(self.roots[i], nil) end
	self._bounds = nil
end

---The model's bounding box in its own space (all scene nodes applied).
---@return number minx, number miny, number minz, number maxx, number maxy, number maxz
function Model:getBounds()
	local b = self._bounds
	if not b then
		local minx, miny, minz = huge, huge, huge
		local maxx, maxy, maxz = -huge, -huge, -huge
		for i = 1, #self.drawList do
			local e = self.drawList[i]
			local m, mesh = e.node.matrix, e.mesh
			local cx, cy, cz = (mesh.minx + mesh.maxx) * 0.5, (mesh.miny + mesh.maxy) * 0.5, (mesh.minz + mesh.maxz) * 0.5
			local ex, ey, ez = (mesh.maxx - mesh.minx) * 0.5, (mesh.maxy - mesh.miny) * 0.5, (mesh.maxz - mesh.minz) * 0.5
			local wx = m[1] * cx + m[5] * cy + m[9] * cz + m[13]
			local wy = m[2] * cx + m[6] * cy + m[10] * cz + m[14]
			local wz = m[3] * cx + m[7] * cy + m[11] * cz + m[15]
			local rx = abs(m[1]) * ex + abs(m[5]) * ey + abs(m[9]) * ez
			local ry = abs(m[2]) * ex + abs(m[6]) * ey + abs(m[10]) * ez
			local rz = abs(m[3]) * ex + abs(m[7]) * ey + abs(m[11]) * ez
			if wx - rx < minx then minx = wx - rx end
			if wy - ry < miny then miny = wy - ry end
			if wz - rz < minz then minz = wz - rz end
			if wx + rx > maxx then maxx = wx + rx end
			if wy + ry > maxy then maxy = wy + ry end
			if wz + rz > maxz then maxz = wz + rz end
		end
		if minx > maxx then minx, miny, minz, maxx, maxy, maxz = 0, 0, 0, 0, 0, 0 end
		b = { minx, miny, minz, maxx, maxy, maxz }
		self._bounds = b
	end
	return b[1], b[2], b[3], b[4], b[5], b[6]
end

---The first node with this name, or nil.
function Model:findNode(name)
	for i = 1, #self.nodes do
		if self.nodes[i].name == name then return self.nodes[i] end
	end
	return nil
end

function Model:release()
	for _, m in ipairs(self.meshes) do
		for _, p in ipairs(m.primitives) do p.mesh:release() end
	end
	for _, img in pairs(self.images) do
		if img then img:release() end
	end
	self.meshes, self.images, self.drawList = {}, {}, {}
end

-- Loading ---------------------------------------------------------------------

local Loader = {}
Loader.__index = Loader

function Loader:fail(msg)
	error("graphics3d.loadModel: " .. self.path .. ": " .. msg, 0)
end

function Loader:readFile(uri)
	local name = self.dir .. uriDecode(uri)
	local ok, data = pcall(love.filesystem.newFileData, name)
	if not ok then self:fail("can't read " .. name) end
	return data
end

function Loader:dataFromUri(uri)
	local b64 = uri:match("^data:[^,]*;base64,(.*)$")
	if b64 then return love.data.decode("data", "base64", b64) end
	if uri:match("^data:") then self:fail("only base64 data URIs are supported") end
	return self:readFile(uri)
end

function Loader:buffer(index)
	local cached = self.buffers[index]
	if cached then return cached end
	local b = self.gltf.buffers and self.gltf.buffers[index + 1]
	if not b then self:fail("missing buffer " .. index) end
	local data
	if b.uri == nil then
		data = self.bin
		if not data then self:fail("buffer " .. index .. " has no uri and the file has no binary chunk") end
	else
		data = self:dataFromUri(b.uri)
	end
	self.buffers[index] = data
	return data
end

-- Where an accessor's elements are: Data, byte offset of the first, stride,
-- element size, count, component info, component count, normalized.
function Loader:accessor(index)
	local acc = self.gltf.accessors and self.gltf.accessors[index + 1]
	if not acc then self:fail("missing accessor " .. index) end
	local comp = COMPONENTS[acc.componentType]
	local ncomp = NCOMPONENTS[acc.type]
	if not comp or not ncomp then self:fail("accessor " .. index .. " has an unknown type") end
	local esize = comp[1] * ncomp
	local info = {
		acc = acc, count = acc.count or 0, comp = comp, componentType = acc.componentType,
		ncomp = ncomp, normalized = acc.normalized == true, elementSize = esize,
	}
	if acc.bufferView == nil then
		info.zero = true -- all zeros (sparse accessors are not supported)
		return info
	end
	local view = self.gltf.bufferViews[acc.bufferView + 1]
	if not view then self:fail("missing bufferView " .. acc.bufferView) end
	info.data = self:buffer(view.buffer)
	info.offset = (view.byteOffset or 0) + (acc.byteOffset or 0)
	info.stride = view.byteStride or esize
	if info.offset + (info.count - 1) * info.stride + esize > info.data:getSize() then
		self:fail("accessor " .. index .. " reaches past the end of its buffer")
	end
	return info
end

-- An accessor as a flat Lua array of numbers (normalized ints become 0..1).
function Loader:readNumbers(info)
	local out = {}
	local n, count, ncomp = 0, info.count, info.ncomp
	if info.zero then
		for i = 1, count * ncomp do out[i] = 0 end
		return out
	end
	local data, getter = info.data, info.data[info.comp[2]]
	local div = info.normalized and info.comp[3] or 1
	local offset, stride = info.offset, info.stride
	for i = 0, count - 1 do
		local base = offset + i * stride
		if ncomp == 1 then
			n = n + 1
			out[n] = getter(data, base) / div
		elseif ncomp == 2 then
			local a, b = getter(data, base, 2)
			out[n + 1], out[n + 2] = a / div, b / div
			n = n + 2
		elseif ncomp == 3 then
			local a, b, c = getter(data, base, 3)
			out[n + 1], out[n + 2], out[n + 3] = a / div, b / div, c / div
			n = n + 3
		else
			local vals = { getter(data, base, ncomp) }
			for k = 1, ncomp do out[n + k] = vals[k] / div end
			n = n + ncomp
		end
	end
	if info.normalized and (info.componentType == 5120 or info.componentType == 5122) then
		for i = 1, n do if out[i] < -1 then out[i] = -1 end end
	end
	return out
end

-- A vertex buffer for an accessor at a shader location: straight from the
-- file's bytes when possible, converted to floats otherwise.
function Loader:vertexBuffer(info, location, wantComponents)
	local lg = love.graphics
	local format = not info.zero and DIRECT[info.componentType]
	format = format and format[info.ncomp]
	format = format and format[info.normalized]
	if format and (wantComponents == nil or wantComponents == info.ncomp) then
		local esize, stride, count = info.elementSize, info.stride, info.count
		if stride == esize then
			local view = love.data.newDataView(info.data, info.offset, esize * count)
			return lg.newBuffer({ { format = format, location = location } }, view, { vertex = true, usage = "static" })
		end
		-- Interleaved: the element followed by padding up to the stride.
		local pad = stride - esize
		if pad > 0 and pad % 4 == 0 and stride <= 252 and info.offset + count * stride <= info.data:getSize() then
			local decl = { { format = format, location = location } }
			local padLocation = 29 -- LÖVE allows locations 0..29
			while pad > 0 do
				local n = pad >= 16 and 4 or pad / 4
				decl[#decl + 1] = { format = FLOAT_FORMATS[n], location = padLocation }
				padLocation = padLocation - 1
				pad = pad - n * 4
			end
			local view = love.data.newDataView(info.data, info.offset, count * stride)
			return lg.newBuffer(decl, view, { vertex = true, usage = "static" })
		end
	end
	self.converted = self.converted + 1
	local numbers = self:readNumbers(info)
	local ncomp = info.ncomp
	if wantComponents and wantComponents ~= ncomp then
		-- e.g. vec3 → vec4 colors: add alpha 1.
		local out, n = {}, 0
		for i = 0, info.count - 1 do
			for k = 1, wantComponents do
				n = n + 1
				out[n] = k <= ncomp and numbers[i * ncomp + k] or 1
			end
		end
		numbers, ncomp = out, wantComponents
	end
	return lg.newBuffer({ { format = FLOAT_FORMATS[ncomp], location = location } }, numbers, { vertex = true, usage = "static" })
end

function Loader:indexBuffer(info, vertexCount)
	local lg = love.graphics
	local ct = info.componentType
	if (ct == 5123 or ct == 5125) and info.stride == info.elementSize and not info.zero then
		local view = love.data.newDataView(info.data, info.offset, info.elementSize * info.count)
		return lg.newBuffer(ct == 5123 and "uint16" or "uint32", view, { index = true, usage = "static" })
	end
	self.converted = self.converted + 1
	local numbers = self:readNumbers(info)
	return lg.newBuffer(vertexCount > 65535 and "uint32" or "uint16", numbers, { index = true, usage = "static" })
end

function Loader:image(index)
	local cached = self.images[index]
	if cached ~= nil then return cached or nil end
	local img = self.gltf.images and self.gltf.images[index + 1]
	if not img then self:fail("missing image " .. index) end
	local data
	if img.bufferView then
		local view = self.gltf.bufferViews[img.bufferView + 1]
		local buf = self:buffer(view.buffer)
		data = love.data.newDataView(buf, view.byteOffset or 0, view.byteLength)
	elseif img.uri then
		data = self:dataFromUri(img.uri)
	else
		self:fail("image " .. index .. " has no data")
	end
	local ok, result = pcall(function()
		local imageData = love.image.newImageData(data)
		return love.graphics.newImage(imageData, { mipmaps = true })
	end)
	if not ok then
		-- A texture the platform can't decode shouldn't stop the model loading.
		print(("graphics3d.loadModel: %s: image %d: %s"):format(self.path, index, tostring(result)))
		self.images[index] = false
		return nil
	end
	result:setMipmapFilter("linear")
	result:setWrap("repeat", "repeat")
	self.images[index] = result
	return result
end

local WRAP = { [33071] = "clamp", [33648] = "mirroredrepeat", [10497] = "repeat" }

function Loader:texture(texInfo)
	if not texInfo then return nil end
	local tex = self.gltf.textures and self.gltf.textures[texInfo.index + 1]
	if not tex or tex.source == nil then return nil end
	local img = self:image(tex.source)
	if img and tex.sampler and self.gltf.samplers then
		local s = self.gltf.samplers[tex.sampler + 1]
		if s then
			img:setWrap(WRAP[s.wrapS] or "repeat", WRAP[s.wrapT] or "repeat")
			local mag = s.magFilter == 9728 and "nearest" or "linear"
			local min = (s.minFilter == 9728 or s.minFilter == 9984 or s.minFilter == 9986) and "nearest" or "linear"
			img:setFilter(min, mag)
			if s.minFilter == 9728 or s.minFilter == 9729 then img:setMipmapFilter() end
		end
	end
	return img
end

function Loader:material(index)
	local cached = self.materials[index + 1]
	if cached then return cached end
	local m = self.gltf.materials[index + 1]
	if not m then self:fail("missing material " .. index) end
	local pbr = m.pbrMetallicRoughness or {}
	local f = pbr.baseColorFactor or { 1, 1, 1, 1 }
	local e = m.emissiveFactor or { 0, 0, 0 }
	local strength = m.extensions and m.extensions.KHR_materials_emissive_strength
	strength = strength and strength.emissiveStrength or 1
	local alphaMode = m.alphaMode or "OPAQUE"
	-- glTF colors are linear; Material colors are sRGB.
	local mat = materiallib.newMaterial({
		name = m.name,
		color = { linearToSrgb(f[1]), linearToSrgb(f[2]), linearToSrgb(f[3]), alphaMode ~= "OPAQUE" and f[4] or 1 },
		texture = self:texture(pbr.baseColorTexture),
		metallic = pbr.metallicFactor or 1,
		roughness = pbr.roughnessFactor or 1,
		emission = { linearToSrgb(e[1] * strength), linearToSrgb(e[2] * strength), linearToSrgb(e[3] * strength) },
		transparent = alphaMode == "BLEND",
		alphaCutoff = alphaMode == "MASK" and (m.alphaCutoff or 0.5) or 0,
		doubleSided = m.doubleSided == true,
		unshaded = m.extensions ~= nil and m.extensions.KHR_materials_unlit ~= nil,
	})
	self.materials[index + 1] = mat
	return mat
end

local MODES = { [4] = "triangles", [5] = "strip" }

function Loader:primitive(meshIndex, p)
	local mode = MODES[p.mode or 4]
	if not mode then return nil end -- points, lines and fans are skipped
	local attrs = p.attributes or {}
	if attrs.POSITION == nil then return nil end
	local lg = love.graphics

	local pos = self:accessor(attrs.POSITION)
	local vertexCount = pos.count
	if vertexCount == 0 then return nil end
	local attributes = {}

	local posBuffer
	local minx, miny, minz, maxx, maxy, maxz
	local positions -- Lua copy, only when something needs it
	if pos.acc.min and pos.acc.max and not pos.zero then
		minx, miny, minz = pos.acc.min[1], pos.acc.min[2], pos.acc.min[3]
		maxx, maxy, maxz = pos.acc.max[1], pos.acc.max[2], pos.acc.max[3]
	else
		positions = self:readNumbers(pos)
		minx, miny, minz, maxx, maxy, maxz = meshlib.bounds(positions, vertexCount)
	end
	posBuffer = self:vertexBuffer(pos, A.position, 3)
	attributes[#attributes + 1] = { buffer = posBuffer, location = A.position }

	local indexInfo = p.indices ~= nil and self:accessor(p.indices) or nil

	if attrs.NORMAL ~= nil then
		local nrm = self:accessor(attrs.NORMAL)
		attributes[#attributes + 1] = { buffer = self:vertexBuffer(nrm, A.normal, 3), location = A.normal }
	elseif mode == "triangles" then
		self.converted = self.converted + 1
		positions = positions or self:readNumbers(pos)
		local indices = indexInfo and self:readNumbers(indexInfo)
		local normals = meshlib.computeNormals(positions, vertexCount, indices, indices and #indices or 0)
		attributes[#attributes + 1] = { buffer = meshlib.vertexBuffer("floatvec3", A.normal, normals), location = A.normal }
	end

	if attrs.TEXCOORD_0 ~= nil then
		attributes[#attributes + 1] = { buffer = self:vertexBuffer(self:accessor(attrs.TEXCOORD_0), A.uv, 2), location = A.uv }
	end
	if attrs.COLOR_0 ~= nil then
		local col = self:accessor(attrs.COLOR_0)
		local want = col.ncomp
		-- Integer rgb has no LÖVE format; floats can stay rgb (alpha reads as 1).
		if want == 3 and col.componentType ~= 5126 then want = 4 end
		attributes[#attributes + 1] = { buffer = self:vertexBuffer(col, A.color, want), location = A.color }
	end

	local mesh = lg.newMesh(attributes, mode)
	local triangleCount
	if indexInfo then
		mesh:setIndexBuffer(self:indexBuffer(indexInfo, vertexCount))
		triangleCount = mode == "strip" and indexInfo.count - 2 or indexInfo.count / 3
	else
		triangleCount = mode == "strip" and vertexCount - 2 or vertexCount / 3
	end
	local m3 = meshlib.wrap(mesh, vertexCount, math.floor(triangleCount), minx, miny, minz, maxx, maxy, maxz)
	m3.name = self.gltf.meshes[meshIndex + 1].name

	local material
	if p.material ~= nil then
		material = self:material(p.material)
	else
		material = self.defaultMaterial
	end
	return { mesh = m3, material = material }
end

function Loader:mesh(index)
	local cached = self.meshes[index + 1]
	if cached then return cached end
	local m = self.gltf.meshes and self.gltf.meshes[index + 1]
	if not m then self:fail("missing mesh " .. index) end
	local group = { name = m.name, primitives = {} }
	for _, p in ipairs(m.primitives or {}) do
		local prim = self:primitive(index, p)
		if prim then group.primitives[#group.primitives + 1] = prim end
	end
	self.meshes[index + 1] = group
	return group
end

local function parseGLB(loader, fileData)
	local size = fileData:getSize()
	local version = fileData:getUInt32(4)
	if version ~= 2 then loader:fail("glTF version " .. tostring(version) .. " (only 2 is supported)") end
	local length = math.min(fileData:getUInt32(8), size)
	local offset = 12
	local jsonText, bin
	while offset + 8 <= length do
		local chunkLength = fileData:getUInt32(offset)
		local chunkType = fileData:getUInt32(offset + 4)
		if offset + 8 + chunkLength > length then loader:fail("truncated GLB chunk") end
		if chunkType == 0x4E4F534A then -- "JSON"
			jsonText = fileData:getString(offset + 8, chunkLength)
		elseif chunkType == 0x004E4942 and not bin and chunkLength > 0 then -- "BIN\0"
			bin = love.data.newDataView(fileData, offset + 8, chunkLength)
		end
		offset = offset + 8 + chunkLength
	end
	if not jsonText then loader:fail("GLB without a JSON chunk") end
	return jsonText, bin
end

---Loads a .gltf or .glb file.
---@param path string
---@return graphics3d.Model
function G.loadModel(path)
	if type(path) ~= "string" then error("graphics3d.loadModel: expected a file path", 2) end
	local ok, fileData = pcall(love.filesystem.newFileData, path)
	if not ok then error("graphics3d.loadModel: can't read " .. path, 2) end

	local loader = setmetatable({
		path = path,
		dir = path:match("^(.*/)") or "",
		buffers = {}, images = {}, materials = {}, meshes = {},
		converted = 0,
	}, Loader)

	local jsonText
	if fileData:getSize() >= 12 and fileData:getString(0, 4) == "glTF" then
		jsonText, loader.bin = parseGLB(loader, fileData)
	else
		jsonText = fileData:getString()
	end

	local okJson, gltf = pcall(json.decode, jsonText)
	if not okJson then loader:fail(tostring(gltf)) end
	if type(gltf) ~= "table" or type(gltf.asset) ~= "table" then loader:fail("not a glTF file") end
	local major = tostring(gltf.asset.version or ""):match("^(%d+)")
	if major ~= "2" then loader:fail("glTF version " .. tostring(gltf.asset.version) .. " (only 2.x is supported)") end
	for _, ext in ipairs(gltf.extensionsRequired or {}) do
		if ext ~= "KHR_materials_emissive_strength" and ext ~= "KHR_materials_unlit" then
			loader:fail("needs the unsupported extension " .. tostring(ext))
		end
	end
	loader.gltf = gltf
	loader.defaultMaterial = materiallib.newMaterial({ name = "default", color = { 1, 1, 1 }, roughness = 0.6, metallic = 0 })

	-- Nodes, with TRS (decomposed from a matrix when that's what the file has).
	local nodes = {}
	for i, n in ipairs(gltf.nodes or {}) do
		local node = {
			name = n.name or ("node" .. (i - 1)),
			index = i,
			children = {},
			localMatrix = mat4.new(),
			matrix = mat4.new(),
			x = 0, y = 0, z = 0, qx = 0, qy = 0, qz = 0, qw = 1, sx = 1, sy = 1, sz = 1,
		}
		if n.matrix then
			node.x, node.y, node.z, node.qx, node.qy, node.qz, node.qw, node.sx, node.sy, node.sz = mat4.decompose(n.matrix)
		else
			local t, r, s = n.translation, n.rotation, n.scale
			if t then node.x, node.y, node.z = t[1], t[2], t[3] end
			if r then node.qx, node.qy, node.qz, node.qw = r[1], r[2], r[3], r[4] end
			if s then node.sx, node.sy, node.sz = s[1], s[2], s[3] end
		end
		nodes[i] = node
	end
	for i, n in ipairs(gltf.nodes or {}) do
		for _, c in ipairs(n.children or {}) do
			local child = nodes[c + 1]
			if not child then loader:fail("node " .. (i - 1) .. " has a missing child " .. c) end
			child.parent = nodes[i]
			nodes[i].children[#nodes[i].children + 1] = child
		end
	end

	local roots = {}
	local scene = gltf.scenes and gltf.scenes[(gltf.scene or 0) + 1]
	if scene then
		for _, r in ipairs(scene.nodes or {}) do roots[#roots + 1] = nodes[r + 1] end
	else
		for _, node in ipairs(nodes) do
			if not node.parent then roots[#roots + 1] = node end
		end
	end

	local model = setmetatable({
		path = path,
		nodes = nodes,
		roots = roots,
		meshes = loader.meshes,
		materials = loader.materials,
		images = loader.images,
		drawList = {},
	}, Model)

	for i, node in ipairs(nodes) do
		local n = gltf.nodes[i]
		if n.mesh ~= nil then node.mesh = loader:mesh(n.mesh) end
	end
	-- What draws: the meshes of the scene's nodes, in tree order.
	local function visit(node)
		if node.mesh then
			for _, p in ipairs(node.mesh.primitives) do
				model.drawList[#model.drawList + 1] = { node = node, mesh = p.mesh, material = p.material }
			end
		end
		for _, c in ipairs(node.children) do visit(c) end
	end
	for _, r in ipairs(roots) do visit(r) end

	-- Materials that no drawn primitive used still load, so the list matches the file.
	for i = 0, #(gltf.materials or {}) - 1 do loader:material(i) end

	model.convertedAccessors = loader.converted
	model:updateMatrices()
	return model
end

return G
