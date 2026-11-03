-- Sound: plays sound files and Smitten's .sfx and .song files.

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
	end
	return self._snd
end
M.soundOf = soundOf

local Sound = nodeLib.classes.Sound

function Sound:_enter()
	self._sources = {}
	if self.autoplay then self:play() end
end

function Sound:_exit()
	self:stop()
end

function Sound:play()
	local snd = soundOf(self)
	if not snd then return end
	if snd.song then
		snd.song:setVolume(self.volume)
		snd.song:play()
		self._playingSong = true
		return
	end
	local src = snd:newSource()
	src:setLooping(self.loop)
	src:setVolume(self.volume)
	src:setPitch(self.pitch)
	src:play()
	local list = self._sources or {}
	self._sources = list
	list[#list + 1] = src
	return src
end

function Sound:stop()
	local snd = self._snd
	if snd and snd.song and self._playingSong then snd.song:stop() end
	self._playingSong = false
	for _, s in ipairs(self._sources or {}) do s:stop() end
	self._sources = {}
end

function Sound:pause()
	local snd = self._snd
	if snd and snd.song then snd.song:pause() end
	for _, s in ipairs(self._sources or {}) do s:pause() end
end

function Sound:resume()
	local snd = self._snd
	if snd and snd.song and self._playingSong then snd.song:resume() end
	for _, s in ipairs(self._sources or {}) do s:play() end
end

function Sound:isPlaying()
	local snd = self._snd
	if snd and snd.song then return snd.song:isPlaying() end
	for _, s in ipairs(self._sources or {}) do
		if s:isPlaying() then return true end
	end
	return false
end

function Sound:_process()
	local list = self._sources
	if not list or #list == 0 then return end
	local finished = false
	for i = #list, 1, -1 do
		local s = list[i]
		s:setVolume(self.volume)
		if not s:isPlaying() and not s:isLooping() and s:tell() == 0 then
			table.remove(list, i)
			finished = true
		end
	end
	if finished and #list == 0 then self:emit("finished") end
end

return M
