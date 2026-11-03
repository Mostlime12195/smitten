-- graphics3d demo: every primitive, materials, a textured custom mesh, glTF
-- and GLB models, a sun with shadows, two point lights, a spot light, sky,
-- fog, transparency, an orbiting camera, and 2D drawn on top.
--
-- Keys: drag to orbit, wheel to zoom, space pause, V a fixed view, B 500-cube benchmark,
-- C render through a canvas without depth, O orthographic, S shadows,
-- F fog, K sky/color background, T run tests, P screenshot.

local g3d = require("graphics3d")
local mat4, quat = g3d.mat4, g3d.quat
local lg = love.graphics

local camera, orthoCamera, env, envColor
local sun, lamp1, lamp2, spot, lights
local scene = {}
local house, tower
local t, paused = 0, false
local orbit = { yaw = 0.7, pitch = 0.38, dist = 17 }
local dragging = false
local useOrtho, useCanvas, useColorBg = false, false, false
local userCanvas
local bench = { on = false, cubes = {}, material = nil, frames = 0, sum = 0, avg = 0, queue = 0, finish = 0 }
local frameMs = { sum = 0, n = 0, avg = 0 }
local testLines
local message, messageTime = nil, 0

local function checker(size, cells, a, b)
	local data = love.image.newImageData(size, size)
	data:mapPixel(function(x, y)
		local c = ((math.floor(x / (size / cells)) + math.floor(y / (size / cells))) % 2 == 0) and a or b
		return c[1], c[2], c[3], 1
	end)
	local img = lg.newImage(data, { mipmaps = true })
	img:setWrap("repeat", "repeat")
	img:setMipmapFilter("linear")
	img:setFilter("linear", "linear", 8)
	return img
end

local function crate(size)
	local data = love.image.newImageData(size, size)
	data:mapPixel(function(x, y)
		local edge = x < 6 or y < 6 or x >= size - 6 or y >= size - 6
		local diag = math.abs(x - y) < 5 or math.abs(x - (size - y)) < 5
		local grain = 0.04 * math.sin(y * 0.9 + math.sin(x * 0.15) * 3)
		if edge or diag then return 0.45 + grain, 0.28 + grain, 0.12, 1 end
		return 0.75 + grain, 0.55 + grain, 0.3, 1
	end)
	local img = lg.newImage(data, { mipmaps = true })
	img:setMipmapFilter("linear")
	return img
end

local function add(mesh, material, update)
	local obj = { mesh = mesh, material = material, matrix = mat4.new(), update = update }
	scene[#scene + 1] = obj
	return obj
end

local function runTests()
	local ok, passed, failed, lines = pcall(require("test"))
	if not ok then
		testLines = { "tests crashed: " .. tostring(passed) }
		print(testLines[1])
	else
		testLines = lines
	end
end

function love.load()
	camera = g3d.newCamera({ fov = 60, near = 0.1, far = 300 })
	orthoCamera = g3d.newCamera({ projection = "orthographic", size = 18, near = 0.1, far = 300 })
	env = g3d.newEnvironment({ background = "sky", fog = true, fogStart = 30, fogEnd = 110, ambientEnergy = 0.55 })
	envColor = g3d.newEnvironment({ background = "color", color = { 0.12, 0.13, 0.17 }, ambient = { 0.3, 0.32, 0.38 }, fog = true, fogStart = 30, fogEnd = 110 })

	sun = { type = "directional", dx = -0.45, dy = -1, dz = -0.3, color = { 1, 0.95, 0.85 }, energy = 2.4, shadows = true, shadowDistance = 45 }
	lamp1 = { type = "point", color = { 1, 0.45, 0.1 }, energy = 3, range = 7, x = 0, y = 1.2, z = 0 }
	lamp2 = { type = "point", color = { 0.15, 0.55, 1 }, energy = 3, range = 7, x = 0, y = 1.2, z = 0 }
	spot = { type = "spot", x = 0, y = 5, z = -4, dx = 0, dy = -1, dz = 0.15, angle = math.rad(28), color = { 1, 0.85, 0.95 }, energy = 4, range = 12 }
	lights = { sun, lamp1, lamp2, spot }

	-- Ground
	local ground = g3d.newPlane(120, 120)
	local groundTex = checker(128, 2, { 0.56, 0.58, 0.52 }, { 0.42, 0.45, 0.4 })
	add(ground, g3d.newMaterial({ texture = groundTex, uvScale = { 60, 60 }, roughness = 0.95 }), function(o)
		mat4.identity(o.matrix)
	end)

	-- A row of primitives with different materials.
	local row = {
		{ g3d.newBox(1.4, 1.4, 1.4), { color = { 0.9, 0.2, 0.15 }, roughness = 0.7 }, 0.7 },
		{ g3d.newSphere(0.8, 32), { color = { 1, 0.78, 0.35 }, metallic = 1, roughness = 0.25 }, 0.8 },
		{ g3d.newCylinder(0.6, 1.6, 24), { color = { 0.2, 0.75, 0.35 }, roughness = 0.35 }, 0.8 },
		{ g3d.newCapsule(0.55, 2, 24), { color = { 0.25, 0.45, 1 }, metallic = 0.5, roughness = 0.4 }, 1.0 },
		{ g3d.newSphere(0.8, 32), { color = { 0.6, 0.85, 1, 0.35 }, roughness = 0.05 }, 0.8 }, -- transparent
	}
	for i, r in ipairs(row) do
		local x = (i - 3) * 3
		add(r[1], g3d.newMaterial(r[2]), function(o, time)
			mat4.fromTRS(o.matrix, x, r[3], 3.5, quat.fromEuler(0, time * 0.5 + i, 0))
		end)
	end
	-- A glowing unshaded cube floating above the row.
	add(g3d.newBox(0.5), g3d.newMaterial({ color = { 1, 1, 1 }, emission = { 0.3, 1, 0.6 }, unshaded = true }), function(o, time)
		mat4.fromTRS(o.matrix, 0, 3 + math.sin(time * 2) * 0.3, 3.5, quat.fromEuler(time, time * 1.3, 0))
	end)
	-- A double-sided plane standing up (a sign), seen from both sides.
	add(g3d.newPlane(1.6, 1.2), g3d.newMaterial({ color = { 0.95, 0.9, 0.4 }, doubleSided = true }), function(o)
		mat4.fromTRS(o.matrix, 8.5, 1.2, 3.5, quat.fromEuler(math.pi / 2, 0.3, 0))
	end)

	-- Lamp bulbs follow the point lights.
	local bulb = g3d.newSphere(0.15, 12)
	add(bulb, g3d.newMaterial({ color = { 1, 0.6, 0.3 }, unshaded = true }), function(o)
		mat4.fromTRS(o.matrix, lamp1.x, lamp1.y, lamp1.z)
	end)
	add(bulb, g3d.newMaterial({ color = { 0.4, 0.7, 1 }, unshaded = true }), function(o)
		mat4.fromTRS(o.matrix, lamp2.x, lamp2.y, lamp2.z)
	end)

	-- A textured custom mesh (a crate with sloped top) from flat arrays,
	-- with normals computed by newMesh, under the spot light.
	local p = {
		-1, 0, 1, 1, 0, 1, 1, 1.4, 1, -1, 1.4, 1, -- front
		1, 0, -1, -1, 0, -1, -1, 1.8, -1, 1, 1.8, -1, -- back
		1, 0, 1, 1, 0, -1, 1, 1.8, -1, 1, 1.4, 1, -- right
		-1, 0, -1, -1, 0, 1, -1, 1.4, 1, -1, 1.8, -1, -- left
		-1, 1.4, 1, 1, 1.4, 1, 1, 1.8, -1, -1, 1.8, -1, -- top
	}
	local uv, idx = {}, {}
	for f = 0, 4 do
		local b = f * 4
		for _, v in ipairs({ 0, 1, 1, 1, 1, 0, 0, 0 }) do uv[#uv + 1] = v end
		for _, k in ipairs({ 1, 2, 3, 1, 3, 4 }) do idx[#idx + 1] = b + k end
	end
	local crateMesh = g3d.newMesh({ positions = p, uvs = uv, indices = idx })
	add(crateMesh, g3d.newMaterial({ texture = crate(128), roughness = 0.8 }), function(o, time)
		mat4.fromTRS(o.matrix, 0, 0, -4, quat.fromEuler(0, time * 0.2, 0))
	end)

	-- Vertex colors from newMesh: a rainbow triangle.
	local rainbow = g3d.newMesh({
		positions = { -1, 0, 0, 1, 0, 0, 0, 1.7, 0 },
		colors = { 1, 0.1, 0.1, 1, 0.1, 1, 0.1, 1, 0.2, 0.3, 1, 1 },
	})
	add(rainbow, g3d.newMaterial({ doubleSided = true, roughness = 0.5 }), function(o, time)
		mat4.fromTRS(o.matrix, -9, 0, 3.5, quat.fromEuler(0, time, 0))
	end)

	-- glTF models.
	house = g3d.loadModel("models/house.gltf")
	tower = g3d.loadModel("models/tower.glb")
	add(house, nil, function(o)
		-- A quaternion is four values: when more arguments follow, unpack it first.
		local qx, qy, qz, qw = quat.fromEuler(0, 0.4, 0)
		mat4.fromTRS(o.matrix, -6, 0, -5, qx, qy, qz, qw, 1.3, 1.3, 1.3)
	end)
	add(tower, nil, function(o)
		mat4.fromTRS(o.matrix, 6.5, 0, -5, quat.fromEuler(0, -0.6, 0))
	end)

	-- Benchmark cubes: 500 boxes in a grid over the scene.
	bench.material = g3d.newMaterial({ color = { 0.8, 0.82, 0.9 }, roughness = 0.5 })
	bench.mesh = g3d.newBox(0.5)
	for i = 0, 499 do
		bench.cubes[i + 1] = { x = (i % 25 - 12) * 1.1, z = (math.floor(i / 25) - 10) * 1.1, m = mat4.new() }
	end

	if love.filesystem.getInfo("runtests") then runTests() end
	for _, a in ipairs(arg or {}) do
		if a == "--test" then runTests() end
	end
end

function love.update(dt)
	if not paused then
		t = t + dt
		orbit.yaw = orbit.yaw + dt * 0.12
	end
	lamp1.x, lamp1.z = math.cos(t) * 4.5, math.sin(t) * 4.5 + 3.5
	lamp2.x, lamp2.z = math.cos(t + math.pi) * 4.5, math.sin(t + math.pi) * 4.5 + 3.5
	lamp1.y = 1.2 + math.sin(t * 2) * 0.3
	lamp2.y = 1.2 + math.cos(t * 2) * 0.3
	sun.shadows = sun.shadows

	local cx = math.sin(orbit.yaw) * math.cos(orbit.pitch) * orbit.dist
	local cy = math.sin(orbit.pitch) * orbit.dist + 1
	local cz = math.cos(orbit.yaw) * math.cos(orbit.pitch) * orbit.dist
	camera:setPosition(cx, cy, cz)
	camera:lookAt(0, 1, 0)
	orthoCamera:setTransform(cx, cy, cz, camera:getRotation())

	for _, o in ipairs(scene) do o.update(o, t) end
	if bench.on then
		for i, c in ipairs(bench.cubes) do
			mat4.fromTRS(c.m, c.x, 5 + math.sin(t + i * 0.3) * 0.5, c.z, quat.fromEuler(t + i, t * 0.7, 0))
		end
	end
	if messageTime > 0 then messageTime = messageTime - dt end
end

local function draw3D()
	local cam = useOrtho and orthoCamera or camera
	local start = love.timer.getTime()
	g3d.begin(cam, useColorBg and envColor or env, lights)
	for _, o in ipairs(scene) do g3d.draw(o.mesh, o.matrix, o.material) end
	if bench.on then
		local mesh, mat = bench.mesh, bench.material
		for i = 1, #bench.cubes do g3d.draw(mesh, bench.cubes[i].m, mat) end
	end
	local queued = love.timer.getTime()
	g3d.finish()
	local done = love.timer.getTime()

	frameMs.sum, frameMs.n = frameMs.sum + (done - start) * 1000, frameMs.n + 1
	if frameMs.n >= 30 then
		frameMs.avg = frameMs.sum / frameMs.n
		frameMs.sum, frameMs.n = 0, 0
	end
	if bench.on then
		bench.frames = bench.frames + 1
		bench.queue = bench.queue + (queued - start) * 1000
		bench.finish = bench.finish + (done - queued) * 1000
	end
end

function love.draw()
	if useCanvas then
		local w, h = lg.getDimensions()
		if not userCanvas or userCanvas:getWidth() ~= w or userCanvas:getHeight() ~= h then
			userCanvas = lg.newCanvas(w, h)
		end
		lg.setCanvas(userCanvas)
		lg.clear(0, 0, 0, 0)
		draw3D()
		lg.setCanvas()
		lg.draw(userCanvas, 0, 0)
	else
		draw3D()
	end

	-- 2D on top: proves projection, depth, cull mode, shader and canvas came back.
	local s = g3d.stats()
	local lines = {
		("graphics3d demo   %d fps   3D %.2f ms/frame (CPU)"):format(love.timer.getFPS(), frameMs.avg),
		("draw calls %d (shadow %d)   triangles %d   objects %d   culled %d   lights %d"):format(
			s.drawCalls, s.shadowDrawCalls, s.triangles, s.objects, s.culled, s.lights),
		("camera %s   target %s   shadows %s   fog %s   background %s%s"):format(
			useOrtho and "ortho" or "perspective", useCanvas and "canvas without depth" or "screen",
			sun.shadows and "on" or "off", env.fog and "on" or "off", useColorBg and "color" or "sky",
			lg.isGammaCorrect() and "   gamma-correct" or ""),
	}
	if bench.on and bench.frames > 0 then
		lines[#lines + 1] = ("benchmark: 500 cubes, queue %.2f ms + finish %.2f ms (avg of %d frames)"):format(
			bench.queue / bench.frames, bench.finish / bench.frames, bench.frames)
	end
	lg.setColor(0, 0, 0, 0.55)
	lg.rectangle("fill", 8, 8, 640, #lines * 18 + 10, 6, 6)
	lg.setColor(1, 1, 1)
	for i, l in ipairs(lines) do lg.print(l, 16, 13 + (i - 1) * 18) end

	local help = "drag orbit  wheel zoom  space pause  V view  B bench  C canvas  O ortho  S shadows  F fog  K background  T tests  P screenshot"
	local h = lg.getHeight()
	lg.setColor(0, 0, 0, 0.55)
	lg.rectangle("fill", 8, h - 32, lg.getFont():getWidth(help) + 16, 24, 6, 6)
	lg.setColor(1, 1, 1)
	lg.print(help, 16, h - 28)

	if testLines then
		local y = 100
		lg.setColor(0, 0, 0, 0.7)
		lg.rectangle("fill", 8, y - 6, 640, #testLines * 18 + 12, 6, 6)
		for i, l in ipairs(testLines) do
			lg.setColor(l:match("^FAIL") and { 1, 0.4, 0.4 } or (l:match(" 0 failed") and { 0.5, 1, 0.5 } or { 1, 1, 1 }))
			lg.print(l, 16, y + (i - 1) * 18)
		end
		lg.setColor(1, 1, 1)
	end
	if message and messageTime > 0 then
		lg.print(message, 16, h - 56)
	end
end

function love.keypressed(key)
	if key == "space" then paused = not paused
	elseif key == "b" then
		bench.on = not bench.on
		bench.frames, bench.queue, bench.finish = 0, 0, 0
	elseif key == "c" then useCanvas = not useCanvas
	elseif key == "o" then useOrtho = not useOrtho
	elseif key == "s" then sun.shadows = not sun.shadows
	elseif key == "f" then env.fog = not env.fog; envColor.fog = env.fog
	elseif key == "k" then useColorBg = not useColorBg
	elseif key == "t" then
		if testLines then testLines = nil else runTests() end
	elseif key == "v" then
		-- A fixed view for screenshots.
		t, paused = 3, true
		orbit.yaw, orbit.pitch, orbit.dist = 0.12, 0.34, 13.5
	elseif key == "p" then
		lg.captureScreenshot("screenshot.png")
		message, messageTime = "saved screenshot.png to " .. love.filesystem.getSaveDirectory(), 3
	end
end

function love.mousepressed(_, _, button) if button == 1 then dragging = true end end
function love.mousereleased(_, _, button) if button == 1 then dragging = false end end
function love.mousemoved(_, _, dx, dy)
	if dragging then
		orbit.yaw = orbit.yaw - dx * 0.008
		orbit.pitch = math.max(-0.2, math.min(1.45, orbit.pitch + dy * 0.008))
	end
end
function love.wheelmoved(_, y)
	orbit.dist = math.max(3, math.min(80, orbit.dist * (1 - y * 0.1)))
	orthoCamera.size = orbit.dist
end
