-- smitten.boards: leaderboards on the games site.
--
-- A published game's owner can give it leaderboards on the site. This module
-- lets the game's scripts send a score and read the top of a board. It only
-- works while the game runs on its page on the games site: in the editor,
-- in an exported game and anywhere else, available() is false and every
-- call answers nil, "unavailable" straight away, so a game works the same
-- without it.
--
-- Games have no network access. The page around the game does the asking:
-- the calls go through smitten.host (love/src/modules/host), which sends
-- them to the page and gives the answers back.

local host = require("love.host")

local boards = {}

local function call(message, callback, needsAnswer)
	return host.request("boards", message, callback, needsAnswer)
end

---True while the game runs on its page on the games site and has leaderboards there.
function boards.available()
	return host.has("boards")
end

---Sends a score to a board: smitten.boards.submit("best", score). options:
---{ name = "Ada" } is the name for someone who isn't signed in to the site.
---Answers { rank, value, improved } (value is the player's best), or nil
---and why.
function boards.submit(key, value, options, callback)
	if type(options) == "function" then options, callback = nil, options end
	local function refuse(reason)
		if type(callback) == "function" then callback(nil, reason) end
		return nil, reason
	end
	if type(key) ~= "string" then return refuse("no-board") end
	if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
		return refuse("bad-value")
	end
	local name = type(options) == "table" and options.name or nil
	if name ~= nil and type(name) ~= "string" then name = tostring(name) end
	return call({ call = "submit", key = key, value = value, name = name }, callback, false)
end

local function rows(kind, key, count, callback)
	if type(count) == "function" then count, callback = nil, count end
	if type(key) ~= "string" then
		if type(callback) == "function" then callback(nil, "no-board") end
		return nil, "no-board"
	end
	count = math.floor(tonumber(count) or 10)
	if count < 1 then count = 1 elseif count > 100 then count = 100 end
	return call({ call = kind, key = key, count = count }, callback, true)
end

---The best scores of a board, best first: a list of { rank, name, value,
---me, guest } (10 unless count says otherwise, 100 at most), or nil and why.
function boards.top(key, count, callback)
	return rows("top", key, count, callback)
end

---The scores around the player's own (the top, if they have none).
function boards.around(key, count, callback)
	return rows("around", key, count, callback)
end

---The game's boards: a list of { key, title, order, format, unit, scores }.
function boards.list(callback)
	return call({ call = "list" }, callback, true)
end

return boards
