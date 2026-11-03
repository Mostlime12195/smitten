-- Sound: the Sound piece, and the music and sound effects scripts play with
-- sfx() and music(). Plays sound files and Smitten's .sfx and .song files.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")

local M = {}

---A source-making handle for a sound file (see assets.audio).
local function soundOf(self)
	local path = self.sound
	if path == nil or path == "" then return nil end
	if self._soundPath ~= path then
		self._soundPath = path
		self._snd = assets.audio(path)
		self._duration = nil
	end
	return self._snd
end
M.soundOf = soundOf

-- A Source to play a sound with: a new one per play, or a song's own.
local function newSource(snd)
	if snd.song then return snd.song:getSource(), true end
	return snd:newSource(), false
end
M.newSource = newSource

---------------------------------------------------------------------------
-- The Sound piece

local Sound = nodeLib.classes.Sound

function Sound:_enter()
	self._sources = {}
	if self.autoplay then self:play() end
end

function Sound:_exit()
	self:stop()
end

local function apply(self, src, isSong)
	src:setVolume(math.max(0, self.volume))
	src:setPitch(math.max(0.01, self.pitch))
	-- A song loops (or not) as its file says.
	if not isSong then src:setLooping(self.loop) end
end

---Plays the sound and returns the Source playing it. Calling it again while
---it plays starts another copy (good for effects); a .song plays once.
function Sound:play()
	local snd = soundOf(self)
	if not snd then return nil end
	local src, isSong = newSource(snd)
	apply(self, src, isSong)
	src:play()
	local list = self._sources or {}
	self._sources = list
	for i = 1, #list do
		if list[i] == src then return src end
	end
	list[#list + 1] = src
	self._song = isSong and src or nil
	return src
end

function Sound:stop()
	for _, s in ipairs(self._sources or {}) do s:stop() end
	self._sources = {}
	if self._fade then
		self._fade:cancel()
		self._fade = nil
		self.volume = self._fadeVolume or self.volume
	end
end

function Sound:pause()
	for _, s in ipairs(self._sources or {}) do s:pause() end
end

function Sound:resume()
	for _, s in ipairs(self._sources or {}) do
		if not s:isPlaying() then s:play() end
	end
end

function Sound:isPlaying()
	for _, s in ipairs(self._sources or {}) do
		if s:isPlaying() then return true end
	end
	return false
end

---Jumps to a time in the sound, in seconds (every copy playing).
function Sound:seek(seconds)
	for _, s in ipairs(self._sources or {}) do s:seek(math.max(0, seconds)) end
end

---Where the newest copy is, in seconds (0 when nothing plays).
function Sound:tell()
	local list = self._sources or {}
	local s = list[#list]
	return s and s:tell() or 0
end

---How long the sound is, in seconds.
function Sound:getDuration()
	local snd = soundOf(self)
	if not snd then return 0 end
	if snd.song then return snd.song.duration or 0 end
	if not self._duration then self._duration = snd:newSource():getDuration() end
	return self._duration
end

local function cancelFade(self)
	if self._fade then
		self._fade:cancel()
		self._fade = nil
		self.volume = self._fadeVolume
	end
end

---Starts playing from silence up to its volume over some seconds.
function Sound:fadeIn(seconds, volume)
	cancelFade(self)
	local target = volume or self.volume
	self._fadeVolume = target
	self.volume = 0
	if not self:isPlaying() then self:play() end
	self._fade = require("love.tween").to(self, seconds or 1, { volume = target }, "linear", function()
		self._fade = nil
	end)
end

---Fades to silence over some seconds, then stops (its volume goes back to
---what it was, for the next play()).
function Sound:fadeOut(seconds)
	cancelFade(self)
	local was = self.volume
	self._fadeVolume = was
	self._fade = require("love.tween").to(self, seconds or 1, { volume = 0 }, "linear", function()
		self._fade = nil
		self:stop()
		self.volume = was
	end)
end

function Sound:_process()
	local list = self._sources
	if not list or #list == 0 then return end
	local finished = false
	for i = #list, 1, -1 do
		local s = list[i]
		apply(self, s, s == self._song)
		if not s:isPlaying() and not s:isLooping() and s:tell() == 0 then
			table.remove(list, i)
			finished = true
		end
	end
	if finished and #list == 0 then self:emit("finished") end
end

---------------------------------------------------------------------------
-- Music and sound effects for scripts (sfx(), music()). Music isn't part of
-- a scene: it keeps playing when the scene changes, and its fades run at the
-- real speed.

local fades = {}   -- source -> { from, to, time, seconds, stop }
local music = nil  -- { source, path, volume }

local function fadeSource(src, to, seconds, stop)
	if not seconds or seconds <= 0 then
		fades[src] = nil
		src:setVolume(to)
		if stop then src:stop() end
		return
	end
	fades[src] = { from = src:getVolume(), to = to, time = 0, seconds = seconds, stop = stop }
end

function M._update(dt)
	for src, f in pairs(fades) do
		f.time = f.time + dt
		local t = math.min(1, f.time / f.seconds)
		src:setVolume(f.from + (f.to - f.from) * t)
		if t >= 1 then
			fades[src] = nil
			if f.stop then src:stop() end
		end
	end
end

-- Options: a volume (number) or { volume, pitch, fade }.
local function options(o, pitch)
	if type(o) == "table" then return o end
	return { volume = o, pitch = pitch }
end

---Plays a sound once; returns its Source.
function M.sfx(path, opts, pitch)
	opts = options(opts, pitch)
	local snd = assets.audio(path)
	local src = newSource(snd)
	src:setVolume(opts.volume or 1)
	src:setPitch(opts.pitch or 1)
	src:play()
	return src
end

---Plays music on a loop instead of the music playing (the same file keeps
---playing). Options: volume, pitch, fade (seconds to fade in, and to fade
---the old music out).
function M.music(path, opts)
	opts = options(opts)
	local volume = opts.volume or 1
	if music and music.path == path and music.source:isPlaying() then
		music.volume = volume
		fadeSource(music.source, volume, opts.fade or 0)
		if opts.pitch then music.source:setPitch(opts.pitch) end
		return music.source
	end
	M.stopMusic(opts.fade)
	local snd = assets.audio(path)
	local src, isSong = newSource(snd)
	if not isSong then src:setLooping(true) end
	src:setPitch(opts.pitch or 1)
	if opts.fade and opts.fade > 0 then
		src:setVolume(0)
		fadeSource(src, volume, opts.fade)
	else
		fades[src] = nil
		src:setVolume(volume)
	end
	src:play()
	music = { source = src, path = path, volume = volume }
	return src
end

---Stops the music, fading it out over some seconds if given.
function M.stopMusic(seconds)
	if not music then return end
	fadeSource(music.source, 0, seconds, true)
	music = nil
end

function M.pauseMusic()
	if music then music.source:pause() end
end

function M.resumeMusic()
	if music and not music.source:isPlaying() then music.source:play() end
end

---The Source playing the music, or nil.
function M.currentMusic()
	return music and music.source or nil
end

return M
