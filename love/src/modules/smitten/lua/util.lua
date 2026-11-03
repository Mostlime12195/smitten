-- Small helpers: random numbers, clamping, palette colors, saving, and the
-- project settings in smitten.json.
--
--   smitten.random(1, 6)                      -- a whole number from 1 to 6
--   love.graphics.setColor(smitten.color(3))  -- palette color 3
--   smitten.save("best", 42); smitten.load("best", 0)

local util = {}

local floor, min, max = math.floor, math.min, math.max

-------------------------------------------------------------------------------
-- Project settings

-- "Sweetie 16" by GrafxKid (lospec.com/palette-list/sweetie-16), the same
-- default as the editor's (web/editor/project.js).
local DEFAULT_PALETTE = {
	"#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179",
	"#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
}

---Parse "#rrggbb" (or "#rrggbbaa") into r, g, b, a from 0 to 1, or nil.
local function parseHex(s)
	if type(s) ~= "string" then return nil end
	local hex = s:match("^#(%x+)$")
	if not hex or (#hex ~= 6 and #hex ~= 8) then return nil end
	local r = tonumber(hex:sub(1, 2), 16) / 255
	local g = tonumber(hex:sub(3, 4), 16) / 255
	local b = tonumber(hex:sub(5, 6), 16) / 255
	local a = #hex == 8 and tonumber(hex:sub(7, 8), 16) / 255 or 1
	return r, g, b, a
end

local projectCache

-- smitten.json with defaults: { resolution = {w, h}, palette = {"#rrggbb", ...}, start = name? }.
-- A missing or broken file gives the defaults (screen.setup reports broken ones).
local function project()
	if projectCache then return projectCache end
	local data = {}
	if love.filesystem.getInfo("smitten.json", "file") then
		local ok, value = pcall(require("smitten.assets").assets.readJSON, "smitten.json")
		if ok and type(value) == "table" then data = value end
	end
	local p = {}
	for k, v in pairs(data) do p[k] = v end
	local palette = {}
	if type(data.palette) == "table" then
		for _, c in ipairs(data.palette) do
			if parseHex(c) then palette[#palette + 1] = c end
		end
	end
	p.palette = #palette > 0 and palette or DEFAULT_PALETTE
	if type(data.start) ~= "string" or data.start == "" then p.start = nil end
	projectCache = p
	return p
end

-------------------------------------------------------------------------------
-- Colors

local palette = {}
for i, hex in ipairs(project().palette) do
	local r, g, b = parseHex(hex)
	palette[i] = { r, g, b, 1 }
end

---The project palette from smitten.json (Sweetie 16 if it has none): a list
---of colors { r, g, b, 1 }, numbered from 1.
---@type number[][]
util.palette = palette

---A color as r, g, b, a for love.graphics.setColor: a palette color by
---number (from 1), a "#rrggbb" string, or a { r, g, b, a } table. `alpha`
---replaces its alpha.
---@param c integer|string|number[]
---@param alpha? number
---@return number r, number g, number b, number a
function util.color(c, alpha)
	local r, g, b, a
	if type(c) == "number" then
		local p = palette[c]
		if not p then
			error(("smitten.color: the palette has no color %s (it has %d colors, numbered 1 to %d)"):format(
				tostring(c), #palette, #palette), 2)
		end
		r, g, b, a = p[1], p[2], p[3], p[4]
	elseif type(c) == "string" then
		r, g, b, a = parseHex(c)
		if not r then
			error(("smitten.color: %q isn't a color; use a palette number like 3 or \"#rrggbb\""):format(c), 2)
		end
	elseif type(c) == "table" then
		r, g, b, a = c[1] or 1, c[2] or 1, c[3] or 1, c[4] or 1
	else
		error(("smitten.color: expected a palette number, a \"#rrggbb\" string or {r, g, b}, got %s"):format(type(c)), 2)
	end
	if alpha ~= nil then a = alpha end
	return r, g, b, a
end

-------------------------------------------------------------------------------
-- Numbers

local function random(a, b)
	return love.math.random(a, b)
end

---A random number. random(1, 6): a whole number from 1 to 6. random(6): from
---1 to 6. random(): a fraction from 0 up to (not including) 1.
---@param a? integer
---@param b? integer
---@return number
function util.random(a, b)
	if a == nil then return love.math.random() end
	if type(a) ~= "number" or (b ~= nil and type(b) ~= "number") then
		error("smitten.random: expected whole numbers, like smitten.random(1, 6)", 2)
	end
	if b == nil then a, b = 1, a end
	a, b = math.ceil(a), floor(b)
	if b < a then
		error(("smitten.random: there's no whole number from %s to %s"):format(tostring(a), tostring(b)), 2)
	end
	return random(a, b)
end

---True with this probability: chance(0.25) is true a quarter of the time.
---@param probability number from 0 to 1
---@return boolean
function util.chance(probability)
	if type(probability) ~= "number" then
		error("smitten.chance: expected a number from 0 to 1, like smitten.chance(0.25)", 2)
	end
	return love.math.random() < probability
end

---A random element of a list.
---@param list any[]
---@return any
function util.pick(list)
	if type(list) ~= "table" then error(("smitten.pick: expected a list, got %s"):format(type(list)), 2) end
	local n = #list
	if n == 0 then error("smitten.pick: the list is empty", 2) end
	return list[random(1, n)]
end

---v limited to the range lo..hi.
---@param v number
---@param lo number
---@param hi number
---@return number
function util.clamp(v, lo, hi)
	if v < lo then return lo end
	if v > hi then return hi end
	return v
end

---The value t of the way from a to b (t = 0 gives a, 1 gives b, 0.5 halfway).
---@param a number
---@param b number
---@param t number
---@return number
function util.lerp(a, b, t)
	return a + (b - a) * t
end

---v moved towards target by at most step, without passing it.
---@param v number
---@param target number
---@param step number
---@return number
function util.approach(v, target, step)
	if v < target then return min(v + step, target) end
	if v > target then return max(v - step, target) end
	return v
end

-------------------------------------------------------------------------------
-- Saving

local SAVE_FILE = "smitten-save.json"
local saved

local function readSave()
	if saved then return saved end
	saved = {}
	if love.filesystem.getInfo(SAVE_FILE, "file") then
		local text = love.filesystem.read(SAVE_FILE)
		local ok, value = pcall(require("smitten.json").json.decode, text or "")
		if ok and type(value) == "table" then saved = value end
	end
	return saved
end

---Save a value between runs (numbers, strings, booleans and tables of them),
---in the game's save folder. smitten.save(key, nil) forgets it.
---@param key string
---@param value any
function util.save(key, value)
	if type(key) ~= "string" then error("smitten.save: the key should be a string, like smitten.save(\"best\", 42)", 2) end
	local t = readSave()
	t[key] = value
	local ok, text = pcall(require("smitten.json").json.encode, t)
	if not ok then
		t[key] = nil
		error(("smitten.save: can't save %q: %s"):format(key, (tostring(text):gsub("^[^:\n]*:%d+: ", ""))), 2)
	end
	local written, err = love.filesystem.write(SAVE_FILE, text)
	if not written then error(("smitten.save: couldn't write the save file (%s)"):format(tostring(err)), 2) end
end

---A value saved with smitten.save, or `default` if there's none.
---@param key string
---@param default? any
---@return any
function util.load(key, default)
	if type(key) ~= "string" then error("smitten.load: the key should be a string, like smitten.load(\"best\", 0)", 2) end
	local v = readSave()[key]
	if v == nil then return default end
	return v
end

-------------------------------------------------------------------------------
-- Names (for "did you mean" in error messages)

local function distance(a, b)
	if a == b then return 0 end
	local la, lb = #a, #b
	if la == 0 then return lb end
	if lb == 0 then return la end
	local prev, cur = {}, {}
	for j = 0, lb do prev[j] = j end
	for i = 1, la do
		cur[0] = i
		local ca = a:byte(i)
		for j = 1, lb do
			local cost = ca == b:byte(j) and 0 or 1
			cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
		end
		prev, cur = cur, prev
	end
	return prev[lb]
end

-- The candidate closest to name if it's close enough to be a typo, else nil.
-- Case differences count as close.
local function didYouMean(name, candidates)
	if type(name) ~= "string" then return nil end
	local lower = name:lower()
	local best, bestD
	for _, c in ipairs(candidates) do
		if c ~= name then
			local d = c:lower() == lower and 0 or distance(lower, c:lower())
			if not bestD or d < bestD then best, bestD = c, d end
		end
	end
	if not best then return nil end
	local limit = #name <= 3 and 1 or (#name <= 6 and 2 or 3)
	if bestD <= limit then return best end
	return nil
end

return {
	random = util.random, chance = util.chance, pick = util.pick, clamp = util.clamp, lerp = util.lerp,
	approach = util.approach, save = util.save, load = util.load, color = util.color, palette = util.palette,
	-- Internal (not fields of smitten):
	project = project, parseHex = parseHex, didYouMean = didYouMean, distance = distance,
}
