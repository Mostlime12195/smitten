-- Measurements for the engine's developers: frame times, draw calls, the
-- time to compile the game's scripts, and a hash of each image. It is off
-- unless the player page has ?probe=<what> (the player puts it in the
-- SMITTEN_PROBE environment variable), so games never pay for it.
--
-- <what> is a comma-separated list:
--   frames  every 120 frames, the mean CPU time of update (without physics),
--           physics, draw and present in milliseconds, love.graphics.getStats()
--           of the last frame, and Lua's memory
--   draws   also counts how many batches the draws of a frame make, and how
--           many they would make if all images were one texture (an atlas)
--   parse   once, the time to compile every .lua file of the game, and to
--           load the same chunks precompiled (string.dump)
--   images  once, an MD5 of the pixels of every .png file of the game
-- Every probe also reports the first frame and each new scene. All lines
-- are printed as "\1probe <json>".

local probe = {}

local json = require("love.json")
local getTime = love.timer and love.timer.getTime or os.clock

local function send(t)
	print("\1probe " .. json.encode(t))
end

local function ms(s) return math.floor(s * 100000 + 0.5) / 100 end

-- Every file of the game with the given extension, in a stable order.
local function filesWith(ext, dir, out)
	out = out or {}
	for _, name in ipairs(love.filesystem.getDirectoryItems(dir or "")) do
		local path = dir and dir ~= "" and (dir .. "/" .. name) or name
		local info = love.filesystem.getInfo(path)
		if info and info.type == "directory" then
			if name ~= ".smitten" then filesWith(ext, path, out) end
		elseif info and path:lower():sub(-#ext) == ext then
			out[#out + 1] = path
		end
	end
	table.sort(out)
	return out
end

local function parseCost()
	local files = filesWith(".lua")
	local sources, chunks = {}, {}
	local sourceBytes, dumpBytes = 0, 0
	for i, path in ipairs(files) do
		sources[i] = love.filesystem.read(path) or ""
		sourceBytes = sourceBytes + #sources[i]
	end
	-- The best of three runs, so a slow first run (caches, the GC) does not count.
	local compile, undump = math.huge, math.huge
	local failed = 0
	for _ = 1, 3 do
		local t0 = getTime()
		for i, path in ipairs(files) do
			local f = loadstring(sources[i], "@" .. path)
			if f then chunks[i] = string.dump(f) else failed = failed + 1 end
		end
		compile = math.min(compile, getTime() - t0)
		t0 = getTime()
		for i = 1, #files do
			if chunks[i] then loadstring(chunks[i], "=dump") end
		end
		undump = math.min(undump, getTime() - t0)
	end
	for i = 1, #files do dumpBytes = dumpBytes + (chunks[i] and #chunks[i] or 0) end
	send({ ev = "parse", files = #files, failed = failed / 3, sourceBytes = sourceBytes, dumpBytes = dumpBytes,
		compileMs = ms(compile), undumpMs = ms(undump) })
end

local function imageHashes()
	local out = {}
	for _, path in ipairs(filesWith(".png")) do
		local ok, data = pcall(love.image.newImageData, path)
		if ok then
			out[path] = ("%dx%d %s %s"):format(data:getWidth(), data:getHeight(), data:getFormat(),
				love.data.encode("string", "hex", love.data.hash("string", "md5", data)))
		else
			out[path] = "error: " .. tostring(data)
		end
	end
	send({ ev = "images", images = out })
end

-- Batches: a new one starts when the texture changes. "atlas" puts every
-- image (not canvases, fonts or shapes) on one texture.
local draws = { batches = 0, atlas = 0, last = nil, lastAtlas = nil, calls = 0 }

local function noteDraw(key, atlasKey)
	draws.calls = draws.calls + 1
	if key ~= draws.last then draws.batches = draws.batches + 1; draws.last = key end
	if atlasKey ~= draws.lastAtlas then draws.atlas = draws.atlas + 1; draws.lastAtlas = atlasKey end
end

local function textureOf(d)
	if type(d) ~= "userdata" or not d.typeOf then return "shape", "shape" end
	local tex = d
	if d:typeOf("SpriteBatch") or d:typeOf("ParticleSystem") or d:typeOf("Mesh") then
		tex = d.getTexture and d:getTexture() or d
	end
	if tex and tex.typeOf and tex:typeOf("Canvas") then return tex, tex end
	if tex and tex.typeOf and tex:typeOf("Image") then return tex, "atlas" end
	return tex, tex
end

local function wrapDraws()
	local g = love.graphics
	local draw = g.draw
	g.draw = function(d, ...)
		noteDraw(textureOf(d))
		return draw(d, ...)
	end
	for _, name in ipairs({ "print", "printf" }) do
		local f = g[name]
		g[name] = function(...)
			local font = g.getFont()
			noteDraw(font, font)
			return f(...)
		end
	end
	for _, name in ipairs({ "rectangle", "circle", "ellipse", "polygon", "line", "points", "arc" }) do
		local f = g[name]
		g[name] = function(...)
			noteDraw("shape", "shape")
			return f(...)
		end
	end
end

function probe.start(what)
	local want = {}
	for w in what:gmatch("[^,%s]+") do want[w] = true end
	local engine = love._engine or require("love.engine")
	local g = love.graphics

	local sums = { update = 0, physics = 0, draw = 0, present = 0, dt = 0, n = 0, batches = 0, atlas = 0, calls = 0 }
	local physicsTime = 0
	local wrapped = false
	local function wrapPhysics()
		local scene = package.loaded["love.scene"]
		if wrapped or not scene then return end
		wrapped = true
		local add = scene._addSystem
		local function wrapSystem(s)
			if not s.step or s._probed then return end
			local step = s.step
			s._probed = true
			s.step = function(...)
				local t0 = getTime()
				step(...)
				physicsTime = physicsTime + getTime() - t0
			end
		end
		scene._addSystem = function(name, system)
			local s = add(name, system)
			wrapSystem(s)
			return s
		end
		local physics = scene._getSystem and scene._getSystem("physics2d")
		if physics then wrapSystem(physics) end
	end

	local update, drawFrame = engine.update, engine.draw
	engine.update = function(dt)
		wrapPhysics()
		physicsTime = 0
		local t0 = getTime()
		update(dt)
		local t = getTime() - t0
		sums.update = sums.update + t - physicsTime
		sums.physics = sums.physics + physicsTime
		sums.dt = sums.dt + dt
	end

	local scenePath = nil
	engine.draw = function()
		draws.batches, draws.atlas, draws.calls, draws.last, draws.lastAtlas = 0, 0, 0, nil, nil
		local t0 = getTime()
		drawFrame()
		sums.draw = sums.draw + getTime() - t0
		local scene = package.loaded["love.scene"]
		if scene and scene.current and scene.path ~= scenePath then
			scenePath = scene.path
			send({ ev = "scene", path = scenePath })
		end
	end

	if want.draws then wrapDraws() end

	local first = true
	local present = g.present
	local stats = {}
	g.present = function(...)
		if want.frames then g.getStats(stats) end
		local t0 = getTime()
		present(...)
		local t = getTime() - t0
		if first then
			first = false
			send({ ev = "first" })
			if want.parse then parseCost() end
			if want.images then imageHashes() end
		end
		if not want.frames then return end
		sums.present = sums.present + t
		sums.n = sums.n + 1
		sums.batches = sums.batches + draws.batches
		sums.atlas = sums.atlas + draws.atlas
		sums.calls = sums.calls + draws.calls
		if sums.n >= 120 then
			local n = sums.n
			send({
				ev = "frames", n = n, scene = scenePath,
				updateMs = ms(sums.update / n), physicsMs = ms(sums.physics / n),
				drawMs = ms(sums.draw / n), presentMs = ms(sums.present / n), intervalMs = ms(sums.dt / n),
				drawcalls = stats.drawcalls, drawcallsbatched = stats.drawcallsbatched,
				canvasswitches = stats.canvasswitches, shaderswitches = stats.shaderswitches,
				textures = stats.textures, texturememory = stats.texturememory,
				batches = want.draws and sums.batches / n or nil, atlasBatches = want.draws and sums.atlas / n or nil,
				drawCalls = want.draws and sums.calls / n or nil,
				luaKB = math.floor(collectgarbage("count")),
			})
			for k in pairs(sums) do sums[k] = 0 end
		end
	end
	send({ ev = "init", what = what })
end

return probe
