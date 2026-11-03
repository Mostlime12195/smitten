-- 3D nodes (DESIGN.md, section 6): Node3D's transform, MeshInstance3D,
-- Model3D, Camera3D, the lights, Environment3D, Sprite3D and AudioPlayer3D,
-- drawn with smitten.graphics3d (the 3d module).
--
-- Meters, y up, -z forward. Rotations are Euler angles applied yaw (y), then
-- pitch (x), then roll (z), like Godot; scripts set rotationX/Y/Z directly.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")
local g3d = love.graphics3d -- loads the 3d module (or explains it's missing)
local mat4, quat = g3d.mat4, g3d.quat

local sqrt, atan2, asin, max, min = math.sqrt, math.atan2, math.asin, math.max, math.min

local M = {}

local function is3D(n)
	return n.rotationX ~= nil
end
M.is3D = is3D

-- The local matrix of a 3D node (written into out).
local function localMatrix(out, n)
	local qx, qy, qz, qw = quat.fromEuler(n.rotationX, n.rotationY, n.rotationZ)
	return mat4.fromTRS(out, n.x, n.y, n.z, qx, qy, qz, qw, n.scaleX, n.scaleY, n.scaleZ)
end

local scratch = {}

---The world matrix of a node (a new table).
local function worldMatrix(n)
	local chain, k = scratch, 0
	local p = n
	while p do
		if is3D(p) then
			k = k + 1
			chain[k] = p
		end
		p = p.parent
	end
	local m = mat4.identity()
	local l = {}
	for i = k, 1, -1 do
		localMatrix(l, chain[i])
		mat4.multiply(m, m, l)
		chain[i] = nil
	end
	return m
end
M.worldMatrix = worldMatrix

local function parentWorld(n)
	local p = n.parent
	while p and not is3D(p) do p = p.parent end
	return p and worldMatrix(p) or nil
end

---------------------------------------------------------------------------
-- Node3D

local Node3D = nodeLib.classes.Node3D

function Node3D:getGlobalPosition()
	local m = worldMatrix(self)
	return m[13], m[14], m[15]
end

function Node3D:setGlobalPosition(x, y, z)
	local pw = parentWorld(self)
	if pw then
		local inv = mat4.invert({}, pw)
		x, y, z = mat4.transformPoint(inv, x, y, z)
	end
	self.x, self.y, self.z = x, y, z
end

function Node3D:forward()
	local m = worldMatrix(self)
	local x, y, z = -m[9], -m[10], -m[11]
	local len = sqrt(x * x + y * y + z * z)
	if len == 0 then return 0, 0, -1 end
	return x / len, y / len, z / len
end

function Node3D:right()
	local m = worldMatrix(self)
	local x, y, z = m[1], m[2], m[3]
	local len = sqrt(x * x + y * y + z * z)
	if len == 0 then return 1, 0, 0 end
	return x / len, y / len, z / len
end

function Node3D:translate(dx, dy, dz)
	self.x, self.y, self.z = self.x + dx, self.y + (dy or 0), self.z + (dz or 0)
end

---Moves along the node's own axes (right, up, forward), keeping it level:
---forward ignores pitch, so walking doesn't fly into the sky.
function Node3D:moveLocal(right, up, forward)
	local yaw = self.rotationY
	local fx, fz = -math.sin(yaw), -math.cos(yaw)
	local rx, rz = math.cos(yaw), -math.sin(yaw)
	self.x = self.x + rx * right + fx * forward
	self.y = self.y + up
	self.z = self.z + rz * right + fz * forward
end

function Node3D:lookAt(x, y, z)
	local gx, gy, gz = self:getGlobalPosition()
	local dx, dy, dz = x - gx, y - gy, z - gz
	local flat = sqrt(dx * dx + dz * dz)
	if flat == 0 and dy == 0 then return end
	self.rotationY = atan2(-dx, -dz)
	self.rotationX = atan2(dy, flat)
	self.rotationZ = 0
end

function Node3D:distanceTo(a, b, c)
	local x, y, z = self:getGlobalPosition()
	local px, py, pz = a, b, c
	if type(a) == "table" then px, py, pz = a:getGlobalPosition() end
	return sqrt((px - x) ^ 2 + (py - y) ^ 2 + (pz - z) ^ 2)
end

---------------------------------------------------------------------------
-- Meshes, models, sprites

local meshCache = {}

local function primitive(n)
	local kind = n.mesh
	local key
	if kind == "box" then key = ("box:%g:%g:%g"):format(n.width, n.height, n.depth)
	elseif kind == "sphere" then key = ("sphere:%g"):format(n.radius)
	elseif kind == "cylinder" then key = ("cyl:%g:%g"):format(n.radius, n.height)
	elseif kind == "capsule" then key = ("cap:%g:%g"):format(n.radius, n.height)
	else key = ("plane:%g:%g"):format(n.width, n.depth) end
	local m = meshCache[key]
	if m then return m end
	if kind == "box" then m = g3d.newBox(n.width, n.height, n.depth)
	elseif kind == "sphere" then m = g3d.newSphere(n.radius)
	elseif kind == "cylinder" then m = g3d.newCylinder(n.radius, n.height)
	elseif kind == "capsule" then m = g3d.newCapsule(n.radius, n.height)
	else m = g3d.newPlane(n.width, n.depth) end
	meshCache[key] = m
	return m
end

local function materialOf(n)
	local mat = n._material
	if not mat then
		mat = g3d.newMaterial({})
		n._material = mat
	end
	mat.color = n.color
	mat.roughness = n.roughness
	mat.metallic = n.metallic
	mat.emission = n.emission
	mat.unshaded = n.unshaded
	mat.transparent = (n.color[4] or 1) < 1
	mat.castShadows = n.castShadows
	local tex = n.texture
	mat.texture = (tex ~= nil and tex ~= "") and assets.image(tex) or nil
	return mat
end

local spriteMaterialCache = setmetatable({}, { __mode = "k" })

---------------------------------------------------------------------------
-- Cameras and lights

local Camera3D = nodeLib.classes.Camera3D
local cameras = {}

function Camera3D:_enter() cameras[#cameras + 1] = self end
function Camera3D:_exit()
	for i = #cameras, 1, -1 do
		if cameras[i] == self then table.remove(cameras, i) end
	end
end

local function currentCamera()
	for i = 1, #cameras do
		if cameras[i].current and cameras[i]._inside then return cameras[i] end
	end
	return nil
end
M.currentCamera = currentCamera

local function syncCamera(node, cam)
	cam.fov = node.fov
	cam.near, cam.far = node.near, node.far
	cam.projection = node.projection
	cam.size = node.size
	local m = worldMatrix(node)
	local x, y, z, qx, qy, qz, qw = mat4.decompose(m)
	cam:setTransform(x, y, z, qx, qy, qz, qw)
	return cam
end

local function gcam(node)
	local cam = node._cam
	if not cam then
		cam = g3d.newCamera({ fov = node.fov })
		node._cam = cam
	end
	return syncCamera(node, cam)
end

function Camera3D:screenToRay(sx, sy)
	local display = require("love.display")
	return gcam(self):screenToRay(sx - display.viewX, sy - display.viewY, display.viewWidth, display.viewHeight)
end

function Camera3D:worldToScreen(x, y, z)
	local display = require("love.display")
	local sx, sy, d = gcam(self):worldToScreen(x, y, z, display.viewWidth, display.viewHeight)
	if not sx then return nil end
	return sx + display.viewX, sy + display.viewY, d
end

---------------------------------------------------------------------------
-- AudioPlayer3D

local AudioPlayer3D = nodeLib.classes.AudioPlayer3D
local audio2d = require("love.scene.audio")

function AudioPlayer3D:_enter()
	self._sources = {}
	if self.autoplay then self:play() end
end

function AudioPlayer3D:_exit() self:stop() end

function AudioPlayer3D:play()
	local snd = audio2d.soundOf(self)
	if not snd or not snd.newSource then return end
	local src = snd:newSource()
	src:setLooping(self.loop)
	src:setVolume(self.volume)
	if src:getChannelCount() == 1 then
		src:setAttenuationDistances(1, max(1, self.range))
		src:setPosition(self:getGlobalPosition())
	end
	src:play()
	self._sources[#self._sources + 1] = src
	return src
end

function AudioPlayer3D:stop()
	for _, s in ipairs(self._sources or {}) do s:stop() end
	self._sources = {}
end

function AudioPlayer3D:isPlaying()
	for _, s in ipairs(self._sources or {}) do
		if s:isPlaying() then return true end
	end
	return false
end

function AudioPlayer3D:_process()
	local list = self._sources
	if not list or #list == 0 then return end
	local x, y, z = self:getGlobalPosition()
	local ended = false
	for i = #list, 1, -1 do
		local s = list[i]
		if s:getChannelCount() == 1 then s:setPosition(x, y, z) end
		if not s:isPlaying() and not s:isLooping() and s:tell() == 0 then
			table.remove(list, i)
			ended = true
		end
	end
	if ended and #list == 0 then self:emit("finished") end
end

---------------------------------------------------------------------------
-- Rendering

local queue = {}   -- {kind, node, matrix}
local lights = {}
local env = nil
local canvas = nil

local function linear(c)
	return { c[1], c[2], c[3] }
end

local function collect(n, parentMatrix)
	if n._dead then return end
	local m = parentMatrix
	if is3D(n) then
		if not n.visible then return end
		m = mat4.multiply({}, parentMatrix, localMatrix({}, n))
		local t = n.type
		if t == "MeshInstance3D" or t == "Model3D" or t == "Sprite3D" then
			queue[#queue + 1] = { n, m }
		elseif t == "DirectionalLight3D" or t == "PointLight3D" or t == "SpotLight3D" then
			local l = { color = n.color, energy = n.energy, shadows = n.shadows }
			local fx, fy, fz = -m[9], -m[10], -m[11]
			local len = sqrt(fx * fx + fy * fy + fz * fz)
			if len > 0 then fx, fy, fz = fx / len, fy / len, fz / len end
			if t == "DirectionalLight3D" then
				l.type = "directional"
			else
				l.type = t == "PointLight3D" and "point" or "spot"
				l.x, l.y, l.z = m[13], m[14], m[15]
				l.range = n.range
				l.angle = n.angle
				l.shadows = false
			end
			l.dx, l.dy, l.dz = fx, fy, fz
			lights[#lights + 1] = l
		end
	elseif n.type == "Environment3D" then
		env = n
	elseif n.anchor ~= nil or n.scaleX ~= nil and n.rotation ~= nil then
		return -- UI and 2D subtrees
	end
	local ch = n.children
	for i = 1, #ch do
		local c = ch[i]
		if c then collect(c, m) end
	end
end

local envObject = nil

local function environmentFrom(n)
	if not n then return nil end
	local e = envObject
	local opts = {
		background = n.background, color = linear(n.color),
		skyTop = linear(n.skyTop), skyHorizon = linear(n.skyHorizon), skyBottom = linear(n.skyBottom),
		ambient = linear(n.ambient), ambientEnergy = n.ambientEnergy,
		fog = n.fog, fogColor = linear(n.fogColor), fogStart = n.fogStart, fogEnd = n.fogEnd,
	}
	if not e then
		e = g3d.newEnvironment(opts)
		envObject = e
	else
		for k, v in pairs(opts) do e[k] = v end
	end
	return e
end

---Draws the 3D part of a tree (called by love.scene before 2D and UI).
function M.render(root)
	local camNode = currentCamera()
	if not camNode then return end
	for i = #queue, 1, -1 do queue[i] = nil end
	for i = #lights, 1, -1 do lights[i] = nil end
	env = nil
	collect(root, mat4.identity())

	local display = require("love.display")
	local cw, ch
	if display.stretch == "pixel" then
		cw, ch = display.width, display.height
	else
		local _, _, w, h = display.getWindowRect()
		cw, ch = math.max(1, math.floor(w)), math.max(1, math.floor(h))
	end
	if not canvas or canvas:getWidth() ~= cw or canvas:getHeight() ~= ch then
		canvas = love.graphics.newCanvas(cw, ch)
		if display.filter == "pixel" then canvas:setFilter("nearest", "nearest") end
	end

	local cam = gcam(camNode)
	love.graphics.push("all")
	love.graphics.setCanvas(canvas)
	love.graphics.origin()
	love.graphics.setScissor()
	love.graphics.clear(0, 0, 0, 0)
	g3d.begin(cam, environmentFrom(env), lights)
	local camM = cam:getWorldMatrix()
	for i = 1, #queue do
		local item = queue[i]
		local n, m = item[1], item[2]
		local t = n.type
		if t == "MeshInstance3D" then
			g3d.draw(primitive(n), m, materialOf(n))
		elseif t == "Model3D" then
			if n.model ~= nil and n.model ~= "" then g3d.draw(assets.model(n.model), m) end
		elseif t == "Sprite3D" and n.image ~= nil and n.image ~= "" then
			local img = assets.image(n.image)
			local w, h = img:getDimensions()
			local mesh = meshCache["plane:1:1:sprite"]
			if not mesh then
				mesh = g3d.newPlane(1, 1)
				meshCache["plane:1:1:sprite"] = mesh
			end
			local mat = spriteMaterialCache[n]
			if not mat then
				mat = g3d.newMaterial({ doubleSided = true })
				spriteMaterialCache[n] = mat
			end
			mat.texture, mat.color, mat.unshaded = img, n.color, n.unshaded
			mat.transparent = true
			local x, y, z = m[13], m[14], m[15]
			local qx, qy, qz, qw
			if n.billboard then
				local cx, cy, cz = camM[13], camM[14], camM[15]
				qx, qy, qz, qw = quat.fromEuler(math.pi / 2, atan2(cx - x, cz - z), 0)
			else
				local _, _, _, a, b, c, d = mat4.decompose(m)
				qx, qy, qz, qw = quat.multiply(a, b, c, d, quat.fromAxisAngle(1, 0, 0, math.pi / 2))
			end
			local s = n.pixelSize
			g3d.draw(mesh, mat4.fromTRS({}, x, y, z, qx, qy, qz, qw, w * s, 1, h * s), mat)
		end
	end
	g3d.finish()
	love.graphics.pop()

	-- The listener follows the camera, for AudioPlayer3D.
	if love.audio then
		love.audio.setPosition(camM[13], camM[14], camM[15])
		love.audio.setOrientation(-camM[9], -camM[10], -camM[11], camM[5], camM[6], camM[7])
	end

	love.graphics.push("all")
	love.graphics.setColor(1, 1, 1, 1)
	love.graphics.setBlendMode("alpha", "premultiplied")
	love.graphics.draw(canvas, display.viewX, display.viewY, 0, display.viewWidth / cw, display.viewHeight / ch)
	love.graphics.pop()
end

return M
