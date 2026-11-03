-- Smitten's synthesizer test: renders every sound effect and song in this
-- folder, prints render timings and a checksum per file, and plays them.
--
-- The checksum lines ("checksum <file> <hex> <samples>") are compared with
-- the editor's synthesizer by check.mjs: copy the console output into a file
-- and run `node tools/smitten-audio/check.mjs that-file`.
--
-- Keys: 1-9 play the sound effects, space pauses/resumes the theme, s stops
-- it, j plays the jingle, r renders the theme again (timing).

local native = (function() local _ = smitten.synth return require("love.synth.native") end)()

local sounds = {}
local log = {}
local theme, jingle

local function say(fmt, ...)
	local line = fmt:format(...)
	print(line)
	log[#log + 1] = line
	if #log > 16 then table.remove(log, 1) end
end

local function ms(t0)
	return (love.timer.getTime() - t0) * 1000
end

local function readJSON(path)
	return smitten.json.decode(assert(love.filesystem.read(path)))
end

-- A song table with its sound-effect instruments loaded, as smitten.song
-- does, so the native renderer's checksum can be printed.
local function resolveSong(song, path)
	local copy = {}
	for k, v in pairs(song) do copy[k] = v end
	copy.instruments = {}
	for i, inst in ipairs(song.instruments) do
		local c = {}
		for k, v in pairs(inst) do c[k] = v end
		if inst.type == "sfx" then
			local file = smitten.assets.join(path, inst.sfx)
			if not love.filesystem.getInfo(file, "file") then file = file .. ".sfx" end
			c.sfx = readJSON(file)
		end
		copy.instruments[i] = c
	end
	return copy
end

local function sorted(folder, suffix)
	local files = {}
	for _, name in ipairs(love.filesystem.getDirectoryItems(folder)) do
		if name:sub(-#suffix) == suffix then files[#files + 1] = folder .. "/" .. name end
	end
	table.sort(files)
	return files
end

function love.load()
	local t0 = love.timer.getTime()
	for _, path in ipairs(sorted("sfx", ".sfx")) do
		local t = love.timer.getTime()
		local sound = smitten.synth.sfx(path)
		local renderMs = ms(t)
		local _, sum = native.renderSfx(readJSON(path))
		say("checksum %s %08x %d", path, sum, sound.soundData:getSampleCount())
		say("  %s: %.3f s, rendered in %.2f ms", path, sound.duration, renderMs)
		sounds[#sounds + 1] = sound
	end
	say("all sound effects: %.1f ms", ms(t0))

	for _, path in ipairs(sorted("music", ".song")) do
		local t = love.timer.getTime()
		local data = smitten.synth.renderSong(readJSON(path), path)
		local renderMs = ms(t)
		local _, _, _, sum = native.renderSong(resolveSong(readJSON(path), path), false)
		say("checksum %s %08x %d", path, sum, data:getSampleCount())
		say("  %s: %.1f s of samples, rendered in %.1f ms", path, data:getDuration(), renderMs)
	end

	theme = smitten.synth.song("music/theme")
	jingle = smitten.synth.song("music/jingle")
	local t = love.timer.getTime()
	theme:play()
	say("theme: %.1f s per pass, first play (render + loop decoder) %.1f ms", theme.duration, ms(t))
	assert(smitten.synth.song("music/theme") == theme, "songs are cached")
	assert(smitten.synth.sfx("sfx/jump") == smitten.synth.sfx("sfx/jump.sfx"), "sound effects are cached")
end

local checked = false
function love.update()
	if not checked and love.timer.getTime() > 3 then
		checked = true
		say("after 3 s: theme playing %s", tostring(theme:isPlaying()))
		local a, b = sounds[1]:play(), sounds[1]:play({ volume = 0.3, pitch = 1.5 })
		say("overlapping copies: %s", tostring(a ~= b and a:isPlaying() and b:isPlaying()))
		sounds[1]:stop()
		say("after stop: %s", tostring(not a:isPlaying() and not b:isPlaying()))
	end
end

function love.keypressed(key)
	local n = tonumber(key)
	if n and sounds[n] then
		sounds[n]:play()
		say("play %s", sounds[n].path)
	elseif key == "space" then
		if theme:isPlaying() then theme:pause() else theme:resume() end
	elseif key == "s" then
		theme:stop()
	elseif key == "j" then
		jingle:stop()
		jingle:play()
	elseif key == "r" then
		local t = love.timer.getTime()
		smitten.synth.renderSong(readJSON("music/theme.song"), "music/")
		say("theme rendered again in %.1f ms", ms(t))
	end
end

function love.draw()
	love.graphics.print("1-9: sound effects   space: pause theme   s: stop   j: jingle   r: render", 10, 10)
	for i, line in ipairs(log) do
		love.graphics.print(line, 10, 20 + i * 18)
	end
end
