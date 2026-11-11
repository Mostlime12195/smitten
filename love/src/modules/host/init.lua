-- smitten.host: the page that hosts the game, and what it can do.
--
-- A game in the web player can run inside a page that "hosts" it: the
-- games site's play page, or any other page that implements the host
-- interface (docs/host-interface.md). The player says hello to the page;
-- the page answers with its name, its version and a list of features
-- ("cloudSaves", "boards", "net"). With no such page (the editor, an
-- exported game by itself, a desktop build) there is no host: name() and
-- info() are nil and has() is false for every feature.
--
-- Games have no network access. The page does the work: a call goes out
-- as a printed line starting with "\1site " (the player hands it to the
-- page), and the page's answer comes back through the queue live tweaking
-- uses (love.engine.live gives it to _receive). This module keeps the
-- calls that wait for an answer: smitten.cloud and smitten.boards send
-- their calls through request(). smitten.net has messages of its own
-- (type "net"), and only reads the "net" feature from here.

local json = require("love.json")

local host = {}

host.PROTOCOL = 1         -- the version of the messages this engine speaks
local TIMEOUT = 10        -- seconds to wait for an answer
local MAX_PENDING = 16    -- calls waiting at once; more answer "busy"

local info = nil          -- what the host said in its hello, or nil
local features = {}       -- feature name -> true
local user = nil          -- the name of the signed-in player, or nil

local nextId = 0
local pending = {}        -- id -> { callback = fn } or { task = coroutine }, with deadline and shape
local pendingCount = 0

local function now()
	return love.timer and love.timer.getTime() or os.clock()
end

local function script()
	return package.loaded["love.scene.script"]
end

local function shortText(v, max)
	if type(v) == "number" then v = tostring(v) end
	if type(v) ~= "string" or v == "" or v:find("%c") then return nil end
	return #v <= max and v or v:sub(1, max)
end

-- Gives a call's result to whoever waits for it.
local function finish(entry, result, reason)
	if result ~= nil and entry.shape then result, reason = entry.shape(result) end
	local s = script()
	if entry.callback then
		-- As a task, so the callback can wait() like an event can.
		if s then s.runTask(nil, entry.callback, result, reason) else entry.callback(result, reason) end
	elseif entry.task and s then
		s.resumeTask(entry.task, result, reason)
	end
end

---Sends a call to the host. feature: the feature it needs ("cloudSaves").
---message: the fields of the call ({ call = "cloud.load", key = "slot1" }).
---In a task (ready(), an event, task()) without a callback it waits for the
---answer and returns it; with a callback it returns at once and the
---callback gets the answer later. needsAnswer: false for a call that
---update() can send without waiting (it then returns nil, "sent").
---shape(result) turns the host's result table into what the script gets.
function host.request(feature, message, callback, needsAnswer, shape)
	if callback ~= nil and type(callback) ~= "function" then callback = nil end
	local function refuse(reason)
		if callback then callback(nil, reason) end
		return nil, reason
	end
	if not features[feature] then return refuse("unavailable") end

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
	pending[nextId] = { callback = callback, task = task, deadline = now() + TIMEOUT, shape = shape }
	pendingCount = pendingCount + 1
	print("\1site " .. json.encode(message))

	if task then return s.suspendTask() end
	return nil, "sent"
end

---Returns the name of the host ("smitten-games" on the games site), or nil
---when there is no host.
function host.name()
	return info and info.name or nil
end

---Returns { name, version, protocol, features } of the host (a new table
---each time), or nil when there is no host.
function host.info()
	if not info then return nil end
	local list = {}
	for i, f in ipairs(info.features) do list[i] = f end
	return { name = info.name, version = info.version, protocol = info.protocol, features = list }
end

---Returns true if the host has a feature: has("cloudSaves").
function host.has(feature)
	return features[feature] == true
end

---Returns the name of the player who is signed in on the host, or nil.
function host.user()
	return user
end

-- The host's hello. The games site's page before protocol 1 sent no
-- name and no features, only boards = true and net = true.
local function hello(msg)
	local list, set = {}, {}
	local function add(f)
		f = shortText(f, 32)
		if f and not set[f] then
			set[f] = true
			list[#list + 1] = f
		end
	end
	if type(msg.features) == "table" then
		for i = 1, math.min(#msg.features, 64) do add(msg.features[i]) end
	end
	if msg.boards == true then add("boards") end
	if msg.net == true then add("net") end
	local protocol = math.floor(tonumber(msg.protocol) or 0)
	info = {
		name = shortText(msg.name, 64) or (protocol == 0 and "smitten-games" or "unknown"),
		version = shortText(msg.version, 32) or "",
		protocol = protocol,
		features = list,
	}
	features = set
	user = type(msg.user) == "table" and shortText(msg.user.name, 64) or nil
	-- smitten.net reads these two (love.engine.live passes this hello on).
	msg.net = set.net == true
	msg.boards = set.boards == true
end

---A message from the host's page (love.engine.live): its hello, or an
---answer to a call.
function host._receive(msg)
	if msg.type == "hello" then
		hello(msg)
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
function host._update()
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

-- The page says hello before the game starts; take it now, so has() is
-- right in the first ready(). (The module is registered first: the hello
-- is handed to it by name.)
package.loaded["love.host"] = host
if love._livePoll then require("love.engine.live").poll() end

return host
