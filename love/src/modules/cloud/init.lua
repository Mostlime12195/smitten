-- smitten.cloud: saves that the host keeps, on the player's account.
--
-- save() and load() (smitten.storage) keep values in the browser, always.
-- This module is different: a game calls it when it wants to, and the
-- page that hosts the game (smitten.host) keeps the values. On the games
-- site, they belong to the account of the player who is signed in, so they
-- follow the player to another computer. Nothing is copied by itself.
--
-- Without a host that has the "cloudSaves" feature (the editor, an
-- exported game by itself), every call answers nil, "unavailable" at once.
--
-- Values are the same as save() takes: numbers, text, true or false, and
-- tables of them. They go to the host as JSON text (the "data" of the
-- call), at most MAX_BYTES of it.

local json = require("love.json")
local host = require("love.host")

local cloud = {}

cloud.MAX_BYTES = 65536   -- the most data in one value, as JSON
cloud.MAX_KEY = 64        -- the longest key

local function checkKey(fname, key)
	if type(key) ~= "string" or #key > cloud.MAX_KEY or not key:find("^%w") or key:find("[^%w_%.%-]") then
		error(("smitten.cloud.%s() needs a key: 1 to %d letters, digits, _, . or -, with a letter or a digit first (for example \"slot1\"), not %s")
			:format(fname, cloud.MAX_KEY, type(key) == "string" and ("%q"):format(key) or tostring(key)), 3)
	end
end

local function okShape()
	return true
end

local function loadShape(result)
	local data = result.data
	if type(data) ~= "string" then return nil, "missing" end
	local ok, value = pcall(json.decode, data)
	if not ok then return nil, "bad-data" end
	if value == nil or value == json.null then return nil, "missing" end
	return value
end

local function byKey(a, b) return a.key < b.key end

local function listShape(result)
	local out = {}
	for _, s in ipairs(result) do
		if type(s) == "table" and type(s.key) == "string" then
			out[#out + 1] = {
				key = s.key,
				size = tonumber(s.size) or 0,
				time = tonumber(s.time) or 0,
			}
		end
	end
	table.sort(out, byKey)
	return out
end

---True if the host keeps cloud saves (on the games site: also for a
---player who is not signed in; their calls answer "signed-out").
function cloud.available()
	return host.has("cloudSaves")
end

---Saves a value in the cloud under a key. Waits in a task and returns
---true, or nil and why; with a callback, returns at once.
function cloud.save(key, value, callback)
	checkKey("save", key)
	if value == nil then
		error("smitten.cloud.save() needs a value. To delete a cloud save, use smitten.cloud.remove(key)", 2)
	end
	local ok, data = pcall(json.encode, value)
	if not ok then
		error("smitten.cloud.save() can only save numbers, text, true or false, and tables of them (" .. tostring(data) .. ")", 2)
	end
	if #data > cloud.MAX_BYTES then
		if type(callback) == "function" then callback(nil, "too-big") end
		return nil, "too-big"
	end
	return host.request("cloudSaves", { call = "cloud.save", key = key, data = data }, callback, false, okShape)
end

---Returns the value saved in the cloud under a key, or nil and why
---("missing" if there is none).
function cloud.load(key, callback)
	checkKey("load", key)
	return host.request("cloudSaves", { call = "cloud.load", key = key }, callback, true, loadShape)
end

---Returns the cloud saves of this game: a list of { key, size, time },
---sorted by key, or nil and why.
function cloud.list(callback)
	return host.request("cloudSaves", { call = "cloud.list" }, callback, true, listShape)
end

---Deletes a cloud save. Returns true (also if there was none), or nil
---and why.
function cloud.remove(key, callback)
	checkKey("remove", key)
	return host.request("cloudSaves", { call = "cloud.remove", key = key }, callback, false, okShape)
end

return cloud
