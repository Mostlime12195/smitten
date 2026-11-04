-- smitten.synth: sound effects and music made with Smitten's Sound and Music
-- workspaces (.sfx and .song files). Sound pieces use it; code can too:
-- smitten.synth.sfx("sounds/jump.sfx"):play().
--
-- Both are rendered by the C++ synthesizer (Synth.cpp) into a SoundData and
-- played as ordinary LÖVE Sources. A looping song plays from a streaming
-- Source whose decoder (LoopDecoder.cpp) jumps from the end of the rendered
-- song back to its loop point: the intro (patterns before `loopStart`) plays
-- once, the rest repeats without a gap, and release tails at the end of the
-- song ring on over the start of the next loop. Streaming Sources are
-- refilled from a timer, so music keeps playing in background tabs.

local native = require("love.synth.native")
local assets = require("love.assets")

local SFX_VERSION = 1
local SONG_VERSION = 1

local audio = {}

local function needModules(what)
	if not love.sound then
		local ok = pcall(require, "love.sound")
		if not ok then error(("smitten.%s needs the sound module, which this build doesn't have"):format(what), 3) end
	end
end

local function needAudio(what)
	if not love.audio then
		error(("smitten.%s: audio isn't available, so sounds can't play"):format(what), 3)
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
-- inst.sfx becomes the decoded .sfx table, as the native renderer
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
				or (love.filesystem.getInfo(file .. ".sfx", "file") and file .. ".sfx")
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

-- The folder instrument paths are relative to. basePath may be the song
-- file (or another file in its folder) or the folder itself.
local function songBase(basePath)
	basePath = basePath or ""
	if basePath == "" or basePath:sub(-1) == "/" then return basePath end
	if love.filesystem.getInfo(basePath, "directory") then return basePath .. "/" end
	return basePath:match("^(.*/)[^/]*$") or ""
end

---@class smitten.Sfx
---@field soundData love.SoundData the rendered sound
---@field duration number seconds
---@field path string the .sfx file
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
---@field path string the .song file
local Song = {}
Song.__index = Song

function Song:_load()
	if self._source then return self._source end
	needAudio("song")
	needModules("song")
	local song = resolveSongSfx(self._data, songBase(self.path))
	local soundData, loopPoint, passSeconds = native.renderSong(song, true)
	self.duration = passSeconds
	if loopPoint then
		self._source = love.audio.newSource(native.newLoopDecoder(soundData, loopPoint))
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

---The Source the song plays from (rendering the song if it hasn't been):
---for pitch, seek and the rest of a Source's methods.
---@return love.Source
function Song:getSource()
	return self:_load()
end

---@return boolean
function Song:isPlaying()
	return self._source ~= nil and self._source:isPlaying()
end

---Load a sound effect (a .sfx file; the extension may be left out). The
---sound is rendered once and cached.
---@param path string e.g. "sfx/jump"
---@return smitten.Sfx
function audio.sfx(path)
	path = assets.resolve(path, { ".sfx" }, "sfx")
	return assets.cached("sfx", path, function(p)
		local params = assets.readJSON(p)
		checkFile(params, "smitten.sfx", SFX_VERSION, p)
		needModules("sfx")
		local soundData = native.renderSfx(params)
		return setmetatable({
			path = p,
			soundData = soundData,
			duration = soundData:getDuration(),
			_playing = {},
		}, Sfx)
	end)
end

---Load a song (a .song file; the extension may be left out). Cached; the
---song is rendered the first time it plays.
---@param path string e.g. "music/theme"
---@return smitten.Song
function audio.song(path)
	path = assets.resolve(path, { ".song" }, "song")
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

---Render sound effect parameters (a decoded .sfx table) to a SoundData
---(44100 Hz, 16-bit, mono).
---@param params table
---@return love.SoundData
function audio.synth.renderSfx(params)
	if type(params) ~= "table" then
		error(("smitten.synth.renderSfx: expected a table, got %s"):format(type(params)), 2)
	end
	needModules("synth")
	return (native.renderSfx(params))
end

---Render a song (a decoded .song table) to a SoundData: one pass through
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
	return (native.renderSong(resolveSongSfx(song, songBase(basePath)), false))
end

return { sfx = audio.sfx, song = audio.song, renderSfx = audio.synth.renderSfx, renderSong = audio.synth.renderSong }
