-- smitten.sfx, smitten.song and smitten.synth: sound effects and music made
-- with Smitten's tools (docs/reference.md, "Sound effects" and "Songs").
--
-- Both are rendered by the C++ synthesizer (Synth.cpp) into a SoundData and
-- played as ordinary LÖVE Sources. A looping song plays from a streaming
-- Source whose decoder (LoopDecoder.cpp) jumps from the end of the rendered
-- song back to its loop point: the intro (patterns before `loopStart`) plays
-- once, the rest repeats without a gap, and release tails at the end of the
-- song ring on over the start of the next loop. Streaming Sources are
-- refilled from a timer, so music keeps playing in background tabs.

local native = require("smitten.native")
local assets = require("smitten.assets").assets

local SFX_VERSION = 1
local SONG_VERSION = 1

local audio = {}

local function needModules(what)
	if not love.sound then
		local ok = pcall(require, "love.sound")
		if not ok then error(("smitten.%s needs love.sound, which is disabled in conf.lua"):format(what), 3) end
	end
end

local function needAudio(what)
	if not love.audio then
		error(("smitten.%s: love.audio is disabled in conf.lua, so sounds can't play"):format(what), 3)
	end
end

local function checkFile(data, format, version, path)
	if type(data) ~= "table" then
		error(("%s: expected a JSON object"):format(path), 0)
	end
	if data.format ~= nil and data.format ~= format then
		error(("%s: not a %s file (its format is %s)"):format(path, format, tostring(data.format)), 0)
	end
	if type(data.version) == "number" and data.version > version then
		error(("%s: made by a newer version of Smitten (%s version %d; this engine reads up to version %d)")
			:format(path, format, data.version, version), 0)
	end
end

-- A copy of a song table with each sound-effect instrument's file loaded:
-- inst.sfx becomes the decoded .sfx.json table, as the native renderer
-- expects.
local function resolveSongSfx(song, basePath)
	local copy = {}
	for k, v in pairs(song) do copy[k] = v end
	local instruments = {}
	for i, inst in ipairs(type(song.instruments) == "table" and song.instruments or {}) do
		if type(inst) == "table" and inst.type == "sfx" and type(inst.sfx) == "string" then
			local resolved = {}
			for k, v in pairs(inst) do resolved[k] = v end
			local file = assets.join(basePath, inst.sfx)
			local found = love.filesystem.getInfo(file, "file") and file
				or (love.filesystem.getInfo(file .. ".sfx.json", "file") and file .. ".sfx.json")
			if not found then
				error(("%s: instrument %d (%s) uses %s, which doesn't exist")
					:format(basePath, i, tostring(inst.name or "unnamed"), file), 0)
			end
			local params = assets.readJSON(found)
			checkFile(params, "smitten.sfx", SFX_VERSION, found)
			resolved.sfx = params
			instruments[i] = resolved
		else
			instruments[i] = inst
		end
	end
	copy.instruments = instruments
	return copy
end

-- Seconds of one pass through `order` (same defaults as Synth.h).
local function songDuration(song)
	local bpm = type(song.bpm) == "number" and song.bpm or 120
	local steps = type(song.stepsPerBeat) == "number" and song.stepsPerBeat or 4
	local length = type(song.patternLength) == "number" and math.floor(song.patternLength) or 32
	local order = type(song.order) == "table" and #song.order or 0
	if bpm <= 0 or steps <= 0 or length <= 0 then return 0 end
	return order * length * 60 / (bpm * steps)
end

-- basePath may be a file in the song's folder or the folder itself.
local function songBase(basePath)
	basePath = basePath or ""
	if basePath ~= "" and basePath:sub(-1) ~= "/" and love.filesystem.getInfo(basePath, "directory") then
		basePath = basePath .. "/"
	end
	return basePath
end

---@class smitten.Sfx
---@field soundData love.SoundData the rendered sound
---@field duration number seconds
---@field path string the .sfx.json file
local Sfx = {}
Sfx.__index = Sfx

---Play the sound. Each call plays a new copy, so plays can overlap.
---@param options? {volume?: number, pitch?: number}
---@return love.Source source the Source playing this copy
function Sfx:play(options)
	needAudio("sfx")
	if not self._source then
		self._source = love.audio.newSource(self.soundData)
	end
	local playing = self._playing
	for i = #playing, 1, -1 do
		if not playing[i]:isPlaying() then table.remove(playing, i) end
	end
	local source = self._source:clone()
	if options then
		if options.volume then source:setVolume(options.volume) end
		if options.pitch then source:setPitch(options.pitch) end
	end
	source:play()
	playing[#playing + 1] = source
	return source
end

---Stop every playing copy of the sound.
function Sfx:stop()
	for _, source in ipairs(self._playing) do source:stop() end
	self._playing = {}
end

---@class smitten.Song
---@field duration number seconds of one pass through the song's `order`
---@field path string the .song.json file
local Song = {}
Song.__index = Song

function Song:_load()
	if self._source then return self._source end
	needAudio("song")
	needModules("song")
	local song = resolveSongSfx(self._data, self.path)
	local soundData, loopPoint, passSeconds = native.synthRenderSong(song, true)
	self.duration = passSeconds
	if loopPoint then
		self._source = love.audio.newSource(native.synthNewLoopDecoder(soundData, loopPoint))
	else
		self._source = love.audio.newSource(soundData)
	end
	self._source:setVolume(self._volume)
	return self._source
end

---Start playing, from the beginning unless paused. Loops if the file says so.
function Song:play()
	self:_load():play()
end

---Stop playing; the next play() starts from the beginning.
function Song:stop()
	if self._source then self._source:stop() end
end

---Pause playing; resume() or play() continues from here.
function Song:pause()
	if self._source then self._source:pause() end
end

---Continue after pause().
function Song:resume()
	if self._source and not self._source:isPlaying() then self._source:play() end
end

---@param volume number 0-1
function Song:setVolume(volume)
	self._volume = volume
	if self._source then self._source:setVolume(volume) end
end

---@return boolean
function Song:isPlaying()
	return self._source ~= nil and self._source:isPlaying()
end

---Load a sound effect (a .sfx.json file; the extension may be left out). The
---sound is rendered once and cached.
---@param path string e.g. "sfx/jump"
---@return smitten.Sfx
function audio.sfx(path)
	path = assets.resolve(path, { ".sfx.json" }, "sfx")
	return assets.cached("sfx", path, function(p)
		local params = assets.readJSON(p)
		checkFile(params, "smitten.sfx", SFX_VERSION, p)
		needModules("sfx")
		local soundData = native.synthRenderSfx(params)
		return setmetatable({
			path = p,
			soundData = soundData,
			duration = soundData:getDuration(),
			_playing = {},
		}, Sfx)
	end)
end

---Load a song (a .song.json file; the extension may be left out). Cached; the
---song is rendered the first time it plays.
---@param path string e.g. "music/theme"
---@return smitten.Song
function audio.song(path)
	path = assets.resolve(path, { ".song.json" }, "song")
	return assets.cached("song", path, function(p)
		local data = assets.readJSON(p)
		checkFile(data, "smitten.song", SONG_VERSION, p)
		return setmetatable({
			path = p,
			duration = songDuration(data),
			_data = data,
			_volume = 1,
		}, Song)
	end)
end

audio.synth = {}

---Render sound effect parameters (a decoded .sfx.json table) to a SoundData
---(44100 Hz, 16-bit, mono).
---@param params table
---@return love.SoundData
function audio.synth.renderSfx(params)
	if type(params) ~= "table" then
		error(("smitten.synth.renderSfx: expected a table, got %s"):format(type(params)), 2)
	end
	needModules("synth")
	return (native.synthRenderSfx(params))
end

---Render a song (a decoded .song.json table) to a SoundData: one pass through
---its `order`, followed by whatever still rings. basePath (the song file's
---path, or its folder) resolves the paths of sound-effect instruments.
---@param song table
---@param basePath? string
---@return love.SoundData
function audio.synth.renderSong(song, basePath)
	if type(song) ~= "table" then
		error(("smitten.synth.renderSong: expected a table, got %s"):format(type(song)), 2)
	end
	needModules("synth")
	return (native.synthRenderSong(resolveSongSfx(song, songBase(basePath)), false))
end

return { sfx = audio.sfx, song = audio.song, synth = audio.synth }
