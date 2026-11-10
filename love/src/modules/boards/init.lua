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
-- a call goes out as a printed line starting with "\1site " (the player
-- hands it to the page), and the page's answer comes back through the
-- queue live tweaking uses (love.engine.live gives it to _receive).

local json = require("love.json")

local boards = {}

local TIMEOUT = 10        -- seconds to wait for an answer
local MAX_PENDING = 16    -- calls waiting at once; more answer "busy"

local available = false
local nextId = 0
local pending = {}        -- id -> { callback = fn } or { task = coroutine }, with deadline
local pendingCount = 0

local function now()
	return love.timer and love.timer.getTime() or os.clock()
end

local function script()
	return package.loaded["love.scene.script"]
end

-- Gives a call's result to whoever waits for it.
local function finish(entry, result, reason)
	local s = script()
	if entry.callback then
		-- As a task, so the callback can wait() like an event can.
		if s then s.runTask(nil, entry.callback, result, reason) else entry.callback(result, reason) end
	elseif entry.task and s then
		s.resumeTask(entry.task, result, reason)
	end
end

-- Sends a call, or answers it right away when it can't be sent. In a task
-- (ready(), an event, task()) without a callback it waits for the answer
-- and returns it; with a callback it returns at once and the callback gets
-- the answer later.
local function call(message, callback, needsAnswer)
	if callback ~= nil and type(callback) ~= "function" then callback = nil end
	local function refuse(reason)
		if callback then callback(nil, reason) end
		return nil, reason
	end
	if not available then return refuse("unavailable") end

	local s = script()
	local task = not callback and s and s.currentTask() or nil
	if not callback and not task and needsAnswer then
		-- Nothing could take the answer: update() and draw() can't wait.
		return nil, "needs-callback"
	end
	if pendingCount >= MAX_PENDING then return refuse("busy") end

	nextId = nextId + 1
	message.type = "request"
	message.id = nextId
	pending[nextId] = { callback = callback, task = task, deadline = now() + TIMEOUT }
	pendingCount = pendingCount + 1
	print("\1site " .. json.encode(message))

	if task then return s.suspendTask() end
	return nil, "sent"
end

---True while the game runs on its page on the games site and has leaderboards there.
function boards.available()
	return available
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

---A message from the games site's page (love.engine.live).
function boards._receive(msg)
	if msg.type == "hello" then
		available = msg.boards == true
		return
	end
	if msg.type ~= "reply" then return end
	local entry = pending[msg.id]
	if not entry then return end
	pending[msg.id] = nil
	pendingCount = pendingCount - 1
	if msg.ok == true and type(msg.result) == "table" then
		finish(entry, msg.result)
	else
		finish(entry, nil, type(msg.reason) == "string" and msg.reason or "error")
	end
end

---Called every frame (love.engine.live): calls nobody answered time out.
function boards._update()
	if pendingCount == 0 then return end
	local t = now()
	local late
	for id, entry in pairs(pending) do
		if t >= entry.deadline then
			late = late or {}
			late[#late + 1] = id
		end
	end
	if not late then return end
	table.sort(late)
	for _, id in ipairs(late) do
		local entry = pending[id]
		if entry then
			pending[id] = nil
			pendingCount = pendingCount - 1
			finish(entry, nil, "timeout")
		end
	end
end

-- The page says hello before the game starts; take it now, so available()
-- is right in the first ready(). (The module is registered first: the hello
-- is handed to it by name.)
package.loaded["love.boards"] = boards
if love._livePoll then require("love.engine.live").poll() end

return boards
