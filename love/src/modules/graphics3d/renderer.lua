-- graphics3d.renderer: a forward renderer on LÖVE 12's graphics.
--
--   g3d.begin(camera, environment, lights)  -- lights: array of light tables
--   g3d.draw(meshOrModel, matrix, material)  -- queued, culled against the view
--   g3d.finish()                              -- shadow map, sky, opaque, transparent
--
-- It draws into the current canvas (or the screen). When that target has no
-- depth buffer it renders into its own canvas with one and draws that over
-- the target. LÖVE's state (canvas, shader, projection, transform, color,
-- blend, depth and cull modes) is pushed before and popped after, so 2D
-- drawing carries on unchanged.

local mat4 = require("graphics3d.mat4")
local shaders = require("graphics3d.shaders")
local materiallib = require("graphics3d.material")
local envlib = require("graphics3d.environment")

local abs, sqrt, tan, rad, cos, floor, min, max = math.abs, math.sqrt, math.tan, math.rad, math.cos, math.floor, math.min, math.max
local unpack = unpack or table.unpack
local sort = table.sort
local send = shaders.send

local R = {}

local lg -- love.graphics, set in begin

local function srgbToLinear(c)
	if c <= 0.04045 then return c / 12.92 end
	return ((c + 0.055) / 1.055) ^ 2.4
end

-- Frame state ------------------------------------------------------------------

local active = false
local camera, env, lights
local targetW, targetH, targetDpi, targetHasDepth
local view, proj, viewProj = mat4.new(), mat4.new(), mat4.new()
local planes = {}
local camX, camY, camZ = 0, 0, 0
local wantShadows = false

local items, nItems = {}, 0
local opaque, nOpaque, lastOpaque = {}, 0, 0
local blended, nBlended, lastBlended = {}, 0, 0

local stats = { drawCalls = 0, triangles = 0, shadowDrawCalls = 0, objects = 0, culled = 0, lights = 0 }
local lastStats = { drawCalls = 0, triangles = 0, shadowDrawCalls = 0, objects = 0, culled = 0, lights = 0 }

local IDENTITY = mat4.new()
local EMPTY = {}

local transform -- love Transform used for every model matrix
local white     -- 1x1 white texture for materials without one
local repeatSet = setmetatable({}, { __mode = "k" })

local shadowMap, shadowMapSize
local shadowsBroken = false
local lightView, lightProj, shadowMatrix = mat4.new(), mat4.new(), mat4.new()
local shadowParams, shadowFade = { 0, 0, 0, 0 }, { 0, 0, 0, 0 }

local offscreen, offscreenKey

-- Scratch tables for uniforms.
local v4a, v4b, v4c, v4d = { 0, 0, 0, 0 }, { 0, 0, 0, 0 }, { 0, 0, 0, 0 }, { 0, 0, 0, 0 }

-- LÖVE state stack depth we pushed, so an error never leaves it unbalanced.
local pushed = 0
local function push()
	lg.push("all")
	pushed = pushed + 1
end
local function pop()
	lg.pop()
	pushed = pushed - 1
end

local function setPlane(p, i, a, b, c, d)
	local len = sqrt(a * a + b * b + c * c)
	if len == 0 then len = 1 end
	p[i * 4 + 1], p[i * 4 + 2], p[i * 4 + 3], p[i * 4 + 4] = a / len, b / len, c / len, d / len
end

-- The six frustum planes (left, right, bottom, top, near, far) of a
-- projection * view matrix, pointing inwards.
local function extractPlanes(p, m)
	local r0x, r0y, r0z, r0w = m[1], m[5], m[9], m[13]
	local r1x, r1y, r1z, r1w = m[2], m[6], m[10], m[14]
	local r2x, r2y, r2z, r2w = m[3], m[7], m[11], m[15]
	local r3x, r3y, r3z, r3w = m[4], m[8], m[12], m[16]
	setPlane(p, 0, r3x + r0x, r3y + r0y, r3z + r0z, r3w + r0w)
	setPlane(p, 1, r3x - r0x, r3y - r0y, r3z - r0z, r3w - r0w)
	setPlane(p, 2, r3x + r1x, r3y + r1y, r3z + r1z, r3w + r1w)
	setPlane(p, 3, r3x - r1x, r3y - r1y, r3z - r1z, r3w - r1w)
	setPlane(p, 4, r3x + r2x, r3y + r2y, r3z + r2z, r3w + r2w)
	setPlane(p, 5, r3x - r2x, r3y - r2y, r3z - r2z, r3w - r2w)
end

local function boxVisible(cx, cy, cz, ex, ey, ez)
	local p = planes
	for i = 0, 20, 4 do
		local a, b, c = p[i + 1], p[i + 2], p[i + 3]
		if a * cx + b * cy + c * cz + p[i + 4] < -(abs(a) * ex + abs(b) * ey + abs(c) * ez) then
			return false
		end
	end
	return true
end

local function sphereVisible(x, y, z, r)
	local p = planes
	for i = 0, 20, 4 do
		if p[i + 1] * x + p[i + 2] * y + p[i + 3] * z + p[i + 4] < -r then return false end
	end
	return true
end

-- begin ---------------------------------------------------------------------------

local function currentTarget()
	local c = lg.getCanvas()
	if c == nil then
		local w, h = lg.getDimensions()
		local _, _, flags = love.window.getMode()
		local depth = flags and flags.depth
		return w, h, lg.getDPIScale(), depth == true or (type(depth) == "number" and depth > 0)
	end
	local first, hasDepth = c, false
	if type(c) == "table" then
		first = c[1]
		if type(first) == "table" then first = first[1] or first.texture end
		hasDepth = c.depthstencil ~= nil
	end
	local w, h = first:getDimensions()
	return w, h, first:getDPIScale(), hasDepth
end

function R.begin(cam, environment, lightList)
	if active then error("graphics3d.begin: already drawing; call graphics3d.finish() first", 2) end
	if type(cam) ~= "table" or type(cam.getViewMatrix) ~= "function" then
		error("graphics3d.begin: expected a camera from graphics3d.newCamera", 2)
	end
	if environment ~= nil and (type(environment) ~= "table" or not environment.isEnvironment) then
		error("graphics3d.begin: the second argument must be an environment from graphics3d.newEnvironment (or nil)", 2)
	end
	if lightList ~= nil and type(lightList) ~= "table" then
		error("graphics3d.begin: the third argument must be an array of light tables (or nil)", 2)
	end
	lg = love.graphics
	camera, env, lights = cam, environment or envlib.default, lightList or EMPTY

	wantShadows = false
	for i = 1, #lights do
		local l = lights[i]
		envlib.checkLight(l, i)
		if l.type == "directional" and l.shadows and not shadowsBroken then wantShadows = true end
	end

	targetW, targetH, targetDpi, targetHasDepth = currentTarget()
	local aspect = targetW / targetH
	mat4.copy(view, cam:getViewMatrix())
	mat4.copy(proj, cam:getProjectionMatrix(aspect))
	mat4.multiply(viewProj, proj, view)
	extractPlanes(planes, viewProj)
	camX, camY, camZ = cam.x, cam.y, cam.z

	nItems = 0
	stats.drawCalls, stats.triangles, stats.shadowDrawCalls = 0, 0, 0
	stats.objects, stats.culled, stats.lights = 0, 0, 0
	active = true
end

-- draw ----------------------------------------------------------------------------

local function queue(mesh, matrix, localMatrix, material)
	local n = nItems + 1
	local it = items[n]
	if not it then
		it = { m = {} }
		items[n] = it
	end
	local m = it.m
	if localMatrix then
		mat4.multiply(m, matrix, localMatrix)
	else
		for i = 1, 16 do m[i] = matrix[i] end
	end

	local lx, ly, lz = (mesh.minx + mesh.maxx) * 0.5, (mesh.miny + mesh.maxy) * 0.5, (mesh.minz + mesh.maxz) * 0.5
	local hx, hy, hz = (mesh.maxx - mesh.minx) * 0.5, (mesh.maxy - mesh.miny) * 0.5, (mesh.maxz - mesh.minz) * 0.5
	local m1, m2, m3, m5, m6, m7, m9, m10, m11 = m[1], m[2], m[3], m[5], m[6], m[7], m[9], m[10], m[11]
	local cx = m1 * lx + m5 * ly + m9 * lz + m[13]
	local cy = m2 * lx + m6 * ly + m10 * lz + m[14]
	local cz = m3 * lx + m7 * ly + m11 * lz + m[15]
	local ex = abs(m1) * hx + abs(m5) * hy + abs(m9) * hz
	local ey = abs(m2) * hx + abs(m6) * hy + abs(m10) * hz
	local ez = abs(m3) * hx + abs(m7) * hy + abs(m11) * hz

	local visible = boxVisible(cx, cy, cz, ex, ey, ez)
	stats.objects = stats.objects + 1
	if not visible then
		stats.culled = stats.culled + 1
		-- Off screen things can still cast shadows into view.
		if not wantShadows or not material.castShadows then return end
	end

	it.mesh, it.material, it.visible = mesh, material, visible
	it.cx, it.cy, it.cz, it.ex, it.ey, it.ez = cx, cy, cz, ex, ey, ez
	local d = -(view[3] * cx + view[7] * cy + view[11] * cz + view[15])
	it.depth = d == d and d or 0
	it.flip = (m1 * (m6 * m11 - m7 * m10) - m5 * (m2 * m11 - m3 * m10) + m9 * (m2 * m7 - m3 * m6)) < 0
	nItems = n
end

function R.draw(obj, matrix, material)
	if not active then error("graphics3d.draw: call graphics3d.begin(camera, environment, lights) first", 2) end
	if matrix == nil then
		matrix = IDENTITY
	elseif type(matrix) ~= "table" or matrix[16] == nil then
		error("graphics3d.draw: the second argument must be a matrix from graphics3d.mat4 (or nil)", 2)
	end
	if material ~= nil and (type(material) ~= "table" or not material.isMaterial) then
		error("graphics3d.draw: the third argument must be a material from graphics3d.newMaterial (or nil)", 2)
	end
	if type(obj) == "table" and obj.isMesh3D then
		if obj.mesh == nil then error("graphics3d.draw: this mesh was released", 2) end
		queue(obj, matrix, nil, material or materiallib.default)
	elseif type(obj) == "table" and obj.isModel then
		local list = obj.drawList
		for i = 1, #list do
			local e = list[i]
			queue(e.mesh, matrix, e.node.matrix, material or e.material)
		end
	else
		error("graphics3d.draw: expected a mesh (graphics3d.newBox, newMesh, ...) or a model (graphics3d.loadModel), got " .. type(obj), 2)
	end
end

-- finish --------------------------------------------------------------------------

local function opaqueBefore(a, b)
	local ia, ib = a.material.id, b.material.id
	if ia ~= ib then return ia < ib end
	return a.depth < b.depth
end

local function blendedBefore(a, b)
	return a.depth > b.depth
end

-- Lights packed for the shader: the shadowed directional light first.
local lightPos, lightColor, lightDir = {}, {}, {}
local nLights = 0
local shadowLight
local pointCandidates = {}

local function addLight(l, typeCode)
	nLights = nLights + 1
	local p, c, d = lightPos[nLights], lightColor[nLights], lightDir[nLights]
	if not p then
		p, c, d = {}, {}, {}
		lightPos[nLights], lightColor[nLights], lightDir[nLights] = p, c, d
	end
	local color = l.color or EMPTY
	local energy = l.energy or 1
	local range = l.range or 10
	p[1], p[2], p[3], p[4] = l.x or 0, l.y or 0, l.z or 0, typeCode
	c[1] = srgbToLinear(color[1] or 1) * energy
	c[2] = srgbToLinear(color[2] or 1) * energy
	c[3] = srgbToLinear(color[3] or 1) * energy
	c[4] = range > 0 and 1 / range or 1e6
	local dx, dy, dz = l.dx or 0, l.dy or -1, l.dz or 0
	local len = sqrt(dx * dx + dy * dy + dz * dz)
	if len == 0 then dx, dy, dz, len = 0, -1, 0, 1 end
	d[1], d[2], d[3], d[4] = dx / len, dy / len, dz / len, cos(l.angle or rad(30))
end

local function pointBefore(a, b) return a.score < b.score end

local function selectLights()
	nLights = 0
	shadowLight = nil
	local maxLights = shaders.MAX_LIGHTS
	if wantShadows then
		for i = 1, #lights do
			local l = lights[i]
			if l.type == "directional" and l.shadows then
				shadowLight = l
				addLight(l, 0)
				break
			end
		end
	end
	local directional = nLights
	for i = 1, #lights do
		local l = lights[i]
		if l.type == "directional" and l ~= shadowLight and directional < 4 then
			addLight(l, 0)
			directional = directional + 1
		end
	end
	-- Point and spot lights that reach the view, nearest first, up to 8.
	local n = 0
	for i = 1, #lights do
		local l = lights[i]
		if l.type ~= "directional" then
			local x, y, z, r = l.x or 0, l.y or 0, l.z or 0, l.range or 10
			if sphereVisible(x, y, z, r) then
				n = n + 1
				local cand = pointCandidates[n]
				if not cand then
					cand = {}
					pointCandidates[n] = cand
				end
				local dx, dy, dz = x - camX, y - camY, z - camZ
				cand.light = l
				cand.score = sqrt(dx * dx + dy * dy + dz * dz) - r
			end
		end
	end
	for i = n + 1, #pointCandidates do pointCandidates[i].light = nil; pointCandidates[i].score = math.huge end
	if n > 8 then
		sort(pointCandidates, pointBefore)
	end
	for i = 1, min(n, 8) do
		if nLights >= maxLights then break end
		local l = pointCandidates[i].light
		addLight(l, l.type == "spot" and 2 or 1)
	end
	stats.lights = nLights
end

-- Uniforms that stay the same for the whole frame.
local frameUniforms = {}

local function computeFrameUniforms()
	local u = frameUniforms
	local e = env
	local energy = e.ambientEnergy or 1
	local top, hor, bot = e.skyTop, e.skyHorizon, e.skyBottom
	u.skyTop = u.skyTop or {}
	u.skyHorizon = u.skyHorizon or {}
	u.skyBottom = u.skyBottom or {}
	u.ambientUp = u.ambientUp or {}
	u.ambientDown = u.ambientDown or {}
	u.fogColor = u.fogColor or {}
	for k = 1, 3 do
		u.skyTop[k] = srgbToLinear(top[k])
		u.skyHorizon[k] = srgbToLinear(hor[k])
		u.skyBottom[k] = srgbToLinear(bot[k])
	end
	local amb = e.ambient
	for k = 1, 3 do
		local tint = amb and srgbToLinear(amb[k]) or 1
		if e.background == "sky" then
			u.ambientUp[k] = (u.skyHorizon[k] + u.skyTop[k]) * 0.5 * tint * energy
			u.ambientDown[k] = (u.skyHorizon[k] + u.skyBottom[k]) * 0.5 * tint * energy
		else
			local a = amb and tint or srgbToLinear(e.background == "color" and e.color[k] or 0.3)
			u.ambientUp[k] = a * energy
			u.ambientDown[k] = a * energy
		end
	end
	u.env = u.env or {}
	u.env[1], u.env[2], u.env[3], u.env[4] = e.background == "sky" and 1 or 0, energy, 0, 0
	u.fog = u.fog or {}
	local fs, fe = e.fogStart or 10, e.fogEnd or 100
	u.fog[1], u.fog[2], u.fog[3], u.fog[4] = fs, 1 / max(fe - fs, 1e-4), e.fog and 1 or 0, 0
	local fc = e.fogColor or (e.background == "sky" and hor) or (e.background == "color" and e.color) or { 0.5, 0.5, 0.5 }
	for k = 1, 3 do u.fogColor[k] = srgbToLinear(fc[k]) end
	u.cameraPos = u.cameraPos or {}
	u.cameraPos[1], u.cameraPos[2], u.cameraPos[3] = camX, camY, camZ
end

local function sendFrameUniforms(shader, shadows)
	local u = frameUniforms
	send(shader, "u_cameraPos", u.cameraPos)
	send(shader, "u_lightCount", nLights)
	if nLights > 0 then
		send(shader, "u_lightPos", unpack(lightPos, 1, nLights))
		send(shader, "u_lightColor", unpack(lightColor, 1, nLights))
		send(shader, "u_lightDir", unpack(lightDir, 1, nLights))
	end
	send(shader, "u_ambientUp", u.ambientUp)
	send(shader, "u_ambientDown", u.ambientDown)
	send(shader, "u_env", u.env)
	send(shader, "u_skyTop", u.skyTop)
	send(shader, "u_skyHorizon", u.skyHorizon)
	send(shader, "u_skyBottom", u.skyBottom)
	send(shader, "u_fog", u.fog)
	send(shader, "u_fogColor", u.fogColor)
	if shadows then
		send(shader, "u_shadowMap", shadowMap)
		send(shader, "u_shadowMatrix", "column", shadowMatrix)
		send(shader, "u_shadowParams", shadowParams)
		send(shader, "u_shadowFade", shadowFade)
	end
end

local function applyMaterial(shader, mat)
	local c = mat.color
	v4a[1], v4a[2], v4a[3], v4a[4] = srgbToLinear(c[1]), srgbToLinear(c[2]), srgbToLinear(c[3]), c[4] or 1
	send(shader, "u_color", v4a)
	v4b[1], v4b[2], v4b[3], v4b[4] = mat.roughness, mat.metallic, mat.alphaCutoff or 0, mat:isTransparent() and 1 or 0
	send(shader, "u_material", v4b)
	local e = mat.emission
	v4c[1], v4c[2], v4c[3], v4c[4] = srgbToLinear(e[1]), srgbToLinear(e[2]), srgbToLinear(e[3]), mat.unshaded and 1 or 0
	send(shader, "u_emission", v4c)
	local s, o = mat.uvScale, mat.uvOffset
	v4d[1], v4d[2] = s and s[1] or 1, s and s[2] or 1
	v4d[3], v4d[4] = o and o[1] or 0, o and o[2] or 0
	send(shader, "u_uvTransform", v4d)
	local tex = mat.texture
	if tex then
		if not repeatSet[tex] and (v4d[1] ~= 1 or v4d[2] ~= 1 or v4d[3] ~= 0 or v4d[4] ~= 0) then
			-- Tiling needs repeat; LÖVE textures clamp by default.
			local ws, wt = tex:getWrap()
			if ws == "clamp" and wt == "clamp" then tex:setWrap("repeat", "repeat") end
			repeatSet[tex] = true
		end
		send(shader, "u_albedo", tex)
	else
		send(shader, "u_albedo", white)
	end
end

local CULL_FLIPPED = { back = "front", front = "back", none = "none" }

local function drawItems(list, n, shader, countStats)
	local lastMat, lastCull
	local draw, setCull = lg.draw, lg.setMeshCullMode
	local tf = transform
	for i = 1, n do
		local it = list[i]
		local mat = it.material
		if mat ~= lastMat then
			applyMaterial(shader, mat)
			lastMat = mat
		end
		local cull = mat.doubleSided and "none" or "back"
		if it.flip then cull = CULL_FLIPPED[cull] end
		if cull ~= lastCull then
			setCull(cull)
			lastCull = cull
		end
		tf:setMatrix("column", it.m)
		draw(it.mesh.mesh, tf)
		if countStats then
			stats.drawCalls = stats.drawCalls + 1
			stats.triangles = stats.triangles + it.mesh.triangleCount
		end
	end
end

local function ensureResources()
	if not transform then transform = love.math.newTransform() end
	if not white then
		local data = love.image.newImageData(1, 1)
		data:setPixel(0, 0, 1, 1, 1, 1)
		white = lg.newImage(data)
	end
end

local function ensureShadowMap(size)
	if shadowMap and shadowMapSize == size then return true end
	if shadowMap then shadowMap:release() end
	local ok, canvas = pcall(lg.newCanvas, size, size, { format = "depth24", readable = true, dpiscale = 1 })
	if not ok then
		print("graphics3d: shadows are off, this system can't render a depth texture: " .. tostring(canvas))
		shadowsBroken = true
		shadowMap = nil
		return false
	end
	-- LÖVE's depth sample modes compare the stored depth against the
	-- reference ("stored >= fragment" here), the reverse of GL's order.
	canvas:setDepthSampleMode("gequal")
	canvas:setFilter("linear", "linear")
	canvas:setWrap("clamp", "clamp")
	shadowMap, shadowMapSize = canvas, size
	return true
end

-- Fits an orthographic shadow map around the part of the view within the
-- light's shadowDistance, then marks the items that can cast into it.
local shadowCasters, nCasters = {}, 0

local function fitShadow(light, size)
	local cam = camera
	local aspect = targetW / targetH
	local near = cam.near
	local far = min(light.shadowDistance or 50, cam.far)
	if far <= near then far = near + 1 end
	-- Bounding sphere of the view between near and far (stable as the camera turns).
	local zc, radius
	if cam.projection == "orthographic" then
		local hh = cam.size * 0.5
		local hw, hd = hh * aspect, (far - near) * 0.5
		zc = (near + far) * 0.5
		radius = sqrt(hw * hw + hh * hh + hd * hd)
	else
		local t = tan(rad(cam.fov) * 0.5)
		local k2 = t * t * (1 + aspect * aspect)
		zc = 0.5 * (near + far) * (1 + k2)
		if zc >= far then
			zc = far
			radius = far * sqrt(k2)
		else
			radius = sqrt((far - zc) ^ 2 + far * far * k2)
		end
	end
	local fx, fy, fz = cam:getForward()
	local cx, cy, cz = camX + fx * zc, camY + fy * zc, camZ + fz * zc

	local d = lightDir[1] -- the shadowed light is always first
	local dx, dy, dz = d[1], d[2], d[3]
	local ux, uy, uz = 0, 1, 0
	if abs(dy) > 0.99 then ux, uy, uz = 0, 0, 1 end
	mat4.lookAt(lightView, 0, 0, 0, dx, dy, dz, ux, uy, uz)
	local lx, ly, lz = mat4.transformPoint(lightView, cx, cy, cz)
	-- Snap to whole texels so edges don't shimmer as the camera moves.
	local texel = 2 * radius / size
	lx, ly = floor(lx / texel + 0.5) * texel, floor(ly / texel + 0.5) * texel
	lightView[13], lightView[14], lightView[15] = -lx, -ly, -lz

	-- Casters: anything in the light's box, however far towards the light.
	local v = lightView
	local zmax = radius
	nCasters = 0
	for i = 1, nItems do
		local it = items[i]
		if it.material.castShadows then
			local ix, iy, iz = it.cx, it.cy, it.cz
			local r = sqrt(it.ex * it.ex + it.ey * it.ey + it.ez * it.ez)
			local vx = v[1] * ix + v[5] * iy + v[9] * iz + v[13]
			local vy = v[2] * ix + v[6] * iy + v[10] * iz + v[14]
			local vz = v[3] * ix + v[7] * iy + v[11] * iz + v[15]
			if abs(vx) - r < radius and abs(vy) - r < radius and vz + r > -radius then
				nCasters = nCasters + 1
				shadowCasters[nCasters] = it
				if vz + r > zmax then zmax = vz + r end
			end
		end
	end
	for i = nCasters + 1, #shadowCasters do shadowCasters[i] = nil end
	zmax = min(zmax, radius + 500)

	mat4.orthographic(lightProj, -radius, radius, -radius, radius, -zmax, radius)
	mat4.multiply(shadowMatrix, lightProj, lightView)

	local bias = light.shadowBias or 1
	shadowParams[1] = 1 / size
	shadowParams[2] = texel * bias / (zmax + radius)
	shadowParams[3] = texel * 1.5 * bias
	shadowParams[4] = 0
	local fadeLength = far * 0.1
	shadowFade[1], shadowFade[2] = far - fadeLength, 1 / fadeLength
end

local function renderShadowMap(light)
	local size = light.shadowMapSize or 2048
	if not ensureShadowMap(size) then return false end
	fitShadow(light, size)
	local shader = shaders.depth()
	push()
	lg.setCanvas({ depthstencil = shadowMap })
	lg.clear(false, false, 1)
	lg.origin()
	lg.setShader(shader)
	lg.setDepthMode("lequal", true)
	lg.setFrontFaceWinding("ccw")
	lg.setProjection("column", shadowMatrix)
	sort(shadowCasters, opaqueBefore)
	drawItems(shadowCasters, nCasters, shader, false)
	stats.shadowDrawCalls = nCasters
	stats.drawCalls = stats.drawCalls + nCasters
	for i = 1, nCasters do stats.triangles = stats.triangles + shadowCasters[i].mesh.triangleCount end
	pop()
	return true
end

local function ensureOffscreen()
	local _, _, flags = love.window.getMode()
	local msaa = flags and flags.msaa or 0
	if type(msaa) ~= "number" then msaa = 0 end
	local key = targetW .. "x" .. targetH .. "@" .. targetDpi .. "/" .. msaa
	if offscreen and offscreenKey == key then return end
	if offscreen then offscreen:release() end
	offscreen = lg.newCanvas(targetW, targetH, { dpiscale = targetDpi, msaa = msaa > 1 and msaa or nil })
	offscreenKey = key
end

local skyInvViewProj, skyView = mat4.new(), mat4.new()

local function drawSky()
	local shader = shaders.sky()
	-- Rotation-only view, so the sky is infinitely far away.
	mat4.copy(skyView, view)
	skyView[13], skyView[14], skyView[15] = 0, 0, 0
	mat4.multiply(skyInvViewProj, proj, skyView)
	mat4.invert(skyInvViewProj, skyInvViewProj)
	local u = frameUniforms
	send(shader, "u_invViewProj", "column", skyInvViewProj)
	send(shader, "u_skyTop", u.skyTop)
	send(shader, "u_skyHorizon", u.skyHorizon)
	send(shader, "u_skyBottom", u.skyBottom)
	send(shader, "u_fog", u.fog)
	send(shader, "u_fogColor", u.fogColor)
	lg.setShader(shader)
	lg.setDepthMode("always", false)
	lg.setMeshCullMode("none")
	lg.rectangle("fill", 0, 0, targetW, targetH)
	stats.drawCalls = stats.drawCalls + 1
	stats.triangles = stats.triangles + 2
end

local function render()
	ensureResources()
	selectLights()
	computeFrameUniforms()

	-- Visible items into the opaque and blended lists.
	nOpaque, nBlended = 0, 0
	for i = 1, nItems do
		local it = items[i]
		if it.visible then
			if it.material:isTransparent() then
				nBlended = nBlended + 1
				blended[nBlended] = it
			else
				nOpaque = nOpaque + 1
				opaque[nOpaque] = it
			end
		end
	end
	for i = nOpaque + 1, lastOpaque do opaque[i] = nil end
	for i = nBlended + 1, lastBlended do blended[i] = nil end
	lastOpaque, lastBlended = nOpaque, nBlended
	sort(opaque, opaqueBefore)
	sort(blended, blendedBefore)

	push()

	local shadows = false
	if shadowLight then shadows = renderShadowMap(shadowLight) end
	if not shadows and shadowLight then
		-- The light still lights, just without shadows.
		shadowLight = nil
	end
	local shader = shaders.standard(shadows)

	local useOffscreen = not targetHasDepth
	if useOffscreen then
		ensureOffscreen()
		lg.setCanvas({ offscreen, depth = true })
	end

	lg.origin()
	lg.setColor(1, 1, 1, 1)
	lg.setBlendMode("alpha", "alphamultiply")
	lg.setColorMask(true, true, true, true)
	lg.setFrontFaceWinding("ccw")
	lg.resetProjection()

	local bg = env.background
	if bg == "color" then
		local c = env.color
		lg.clear(c[1], c[2], c[3], 1, false, 1)
	elseif useOffscreen then
		lg.clear(0, 0, 0, 0, false, 1)
	else
		lg.clear(false, false, 1)
	end
	if bg == "sky" then drawSky() end

	lg.setShader(shader)
	sendFrameUniforms(shader, shadows)
	lg.setProjection("column", viewProj)
	lg.setDepthMode("lequal", true)
	drawItems(opaque, nOpaque, shader, true)
	if nBlended > 0 then
		lg.setDepthMode("lequal", false)
		drawItems(blended, nBlended, shader, true)
	end
	pop()

	if useOffscreen then
		push()
		lg.origin()
		lg.resetProjection()
		lg.setShader()
		lg.setColor(1, 1, 1, 1)
		lg.setDepthMode("always", false)
		lg.setBlendMode("alpha", "premultiplied")
		lg.draw(offscreen, 0, 0)
		pop()
		stats.drawCalls = stats.drawCalls + 1
	end
end

function R.finish()
	if not active then error("graphics3d.finish: call graphics3d.begin first", 2) end
	active = false
	local ok, err = pcall(render)
	while pushed > 0 do pop() end
	-- Don't keep the queued objects alive until the next frame.
	for i = 1, nItems do
		local it = items[i]
		it.mesh, it.material = nil, nil
	end
	for i = 1, nCasters do shadowCasters[i] = nil end
	nItems, nCasters = 0, 0
	for k, v in pairs(stats) do lastStats[k] = v end
	if not ok then error(err, 2) end
end

---Counts from the last finished frame: drawCalls and triangles (all passes),
---shadowDrawCalls, objects (queued), culled (outside the view), lights.
function R.stats()
	return lastStats
end

function R.isActive()
	return active
end

return R
