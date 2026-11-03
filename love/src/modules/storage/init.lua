-- smitten.storage: values that stay between plays (high scores, settings,
-- progress), saved in the game's save folder.
--
--   smitten.storage.save("best", score)
--   local best = smitten.storage.load("best", 0)

local json = require("love.json")

local storage = {}

local FILE = "storage.json"
local data = nil

local function read()
	if data then return data end
	data = {}
	local text = love.filesystem.getInfo(FILE) and love.filesystem.read(FILE)
	if text then
		local ok, value = pcall(json.decode, text)
		if ok and type(value) == "table" then data = value end
	end
	return data
end

local function write()
	local ok, text = pcall(json.encode, data, "  ")
	if not ok then error("storage can only save numbers, strings, booleans and tables of them", 3) end
	local written, err = love.filesystem.write(FILE, text)
	if not written then error(("couldn't save: %s"):format(tostring(err)), 3) end
end

---Saves a value under a name.
function storage.save(key, value)
	if type(key) ~= "string" then error("save() needs a name (a string) and a value", 2) end
	read()[key] = value
	write()
end

---The value saved under a name, or default.
function storage.load(key, default)
	local v = read()[key]
	if v == nil or v == json.null then return default end
	return v
end

---Forgets a saved value.
function storage.remove(key)
	read()[key] = nil
	write()
end

---The names of every saved value.
function storage.keys()
	local out = {}
	for k in pairs(read()) do out[#out + 1] = k end
	table.sort(out)
	return out
end

return storage
