-- The smitten module: everything Smitten adds to LÖVE.
--
-- Available as the global `smitten` (like `love`) and as require("smitten").
-- Each feature lives in its own file next to this one and is loaded the first
-- time it's used, so games only pay for what they touch.

local smitten = {
	---The engine version, e.g. "0.1.0".
	version = "0.1.0",
}

-- Which file provides each field of `smitten`. Every file returns a table of
-- the fields it provides.
local providers = {
	json = "json",
	assets = "assets",
	sprite = "sprite",
	screen = "screen",
	tileset = "map",
	map = "map",
	sfx = "audio",
	song = "audio",
	synth = "audio",
	scene = "scene",
	collide = "collide",
	input = "input",
}

setmetatable(smitten, {
	__index = function(t, key)
		local file = providers[key]
		if not file then return nil end
		local value = require("smitten." .. file)[key]
		rawset(t, key, value)
		return value
	end,
})

return smitten
