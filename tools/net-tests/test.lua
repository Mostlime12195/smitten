-- Tests for smitten.net (love/src/modules/net) under plain Lua 5.1, with
-- stand-ins for the engine: the clock, tasks (love.scene.script) and the
-- page's messages. From the repository's root:
--
--   lua5.1 tools/net-tests/test.lua
--
-- The page and the relay are tested in tools/platform-tests/rooms.mjs and,
-- with a real engine and browser, rooms-e2e.mjs.

local root = (arg and arg[0] or ""):match("^(.*)tools[/\\]net%-tests[/\\]") or ""
table.insert(package.loaders, 2, function(name)
	local dir, file = name:match("^love%.(%w+)%.?(%w*)$")
	if not dir then return nil end
	if file == "" then file = "init" end
	local path = root .. "love/src/modules/" .. dir .. "/" .. file .. ".lua"
	local f = io.open(path, "r")
	if not f then return "\n\tno file " .. path end
	f:close()
	return assert(loadfile(path))
end)

-- The engine's clock.
local T = 100
love = { timer = { getTime = function() return T end } }

-- Tasks, as love.scene.script runs them (ready() and events are tasks).
local tasks = {}
local script = { netPieces = setmetatable({}, { __mode = "k" }) }
function script.runTask(owner, fn, ...)
	local co = coroutine.create(fn)
	tasks[co] = true
	local ok, err = coroutine.resume(co, ...)
	if not ok then error(err, 0) end
end
function script.currentTask()
	local co = coroutine.running()
	return co and tasks[co] and co or nil
end
function script.suspendTask() return coroutine.yield() end
function script.resumeTask(co, ...)
	if coroutine.status(co) ~= "suspended" then return end
	local ok, err = coroutine.resume(co, ...)
	if not ok then error(err, 0) end
end
package.loaded["love.scene.script"] = script

-- What the module prints: the lines for the page, and warnings.
local sent, printed = {}, {}
local realPrint = print
print = function(text)
	text = tostring(text)
	if text:sub(1, 6) == "\1site " then sent[#sent + 1] = text:sub(7) else printed[#printed + 1] = text end
end

local json = require("love.json")
local net = require("love.net")

local passed, failed = 0, 0
local function check(name, ok, detail)
	if ok then
		passed = passed + 1
	else
		failed = failed + 1
		realPrint("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
	end
end

local function fails(name, fn, want)
	local ok, err = pcall(fn)
	check(name, not ok and tostring(err):find(want, 1, true) ~= nil, ok and "no error" or err)
end

local function lastSent()
	local text = sent[#sent]
	return text and json.decode(text)
end

-- A message from the page, as love.engine.live gives it (decoded JSON).
local session = 0
local function page(t)
	t.type = "net"
	if t.s == nil then t.s = session end
	net._receive(json.decode(json.encode(t)))
end

-- A piece with a script that has the net events.
local function piece(name)
	local p = { name = name, _inside = true, got = {} }
	function p.emit(self, event, ...)
		local f = self[event]
		if f then script.runTask(self, f, self, ...) end
	end
	for _, e in ipairs({ "peerJoined", "peerLeft", "message", "disconnected" }) do
		p[e] = function(self, ...) self.got[#self.got + 1] = { e, ... } end
	end
	script.netPieces[p] = true
	return p
end

local function events(p)
	local out = {}
	for _, g in ipairs(p.got) do
		local parts = { g[1] }
		for i = 2, #g do
			local v = g[i]
			parts[#parts + 1] = type(v) == "table" and (v.name or json.encode(v)) or tostring(v)
		end
		out[#out + 1] = table.concat(parts, " ")
	end
	p.got = {}
	return table.concat(out, "; ")
end

-- Runs fn as a task (like ready()); returns a table that gets its results.
local function task(fn)
	local result = {}
	script.runTask(nil, function()
		result.values = { fn() }
		result.done = true
	end)
	return result
end

local function welcome(peers, me, host, extra)
	local t = { t = "welcome", room = "Arena", me = me, host = host, max = 4, peers = peers }
	for k, v in pairs(extra or {}) do t[k] = v end
	page(t)
end

-- 1. Without the games site ---------------------------------------------

check("not available before the page says hello", net.available() == false)
do
	local a, b = net.join("arena")
	check("join: nil, unavailable", a == nil and b == "unavailable", b)
	local got
	net.join("arena", { maxPlayers = 2 }, function(x, y) got = { x, y } end)
	check("join's callback gets nil, unavailable at once", got and got[1] == nil and got[2] == "unavailable")
	a, b = net.send(1, { x = 1 })
	check("send outside a room: nil, not-in-room", a == nil and b == "not-in-room", b)
	a, b = net.broadcast("hi")
	check("broadcast outside a room: nil, not-in-room", a == nil and b == "not-in-room", b)
	check("peers() is an empty list", type(net.peers()) == "table" and #net.peers() == 0)
	check("me(), host(), room() are nil; isHost() false", net.me() == nil and net.host() == nil and net.room() == nil and net.isHost() == false)
	net.leave()
	check("leave() outside a room sends nothing", #sent == 0, #sent)
end

net._hello({ type = "hello", net = true })
check("available after hello", net.available() == true)

-- 2. Joining --------------------------------------------------------------

local A = piece("A")
local B = piece("B")
B._inside = false   -- not in the scene: gets nothing

do
	local a, b = net.join("arena")
	check("join outside a task and without a callback: needs-callback", a == nil and b == "needs-callback", b)
	check("and sends nothing", #sent == 0)
	for _, bad in ipairs({ "", " lead", "trail ", "a\nb", string.rep("x", 33), {}, true }) do
		a, b = net.join(bad)
		if not (a == nil and b == "bad-room") then check("bad room name " .. tostring(bad), false, b) end
	end
	check("bad room names: nil, bad-room", true)
	a, b = net.join(string.rep("é", 32), function() end)
	check("32 letters of two bytes are fine", a == nil and b == "sent", b)
	net.leave()
	sent = {}
end

local joined = task(function() return net.join("Arena", { maxPlayers = 4, name = "Ada" }) end)
local call = lastSent()
session = call and call.s or 0
check("join sends a join call", call and call.type == "net" and call.call == "join" and call.room == "Arena" and call.max == 4 and call.name == "Ada", sent[#sent])
check("join waits", not joined.done)
check("in-room while joining", select(2, net.join("other", function() end)) == "in-room")
check("room() is nil until joined", net.room() == nil)

page({ t = "joined", peer = { id = 9, name = "Early" } })
check("events before the welcome are ignored", events(A) == "")

welcome({ { id = 1, name = "Bo" }, { id = 2, name = "Guest 2", guest = true }, { id = 3, name = "Ada", guest = true } }, 3, 1)
check("join returns your peer", joined.done and type(joined.values[1]) == "table" and joined.values[1].id == 3 and joined.values[1].me == true)
check("me()", net.me() == joined.values[1])
check("peers(): everyone, in order", #net.peers() == 3 and net.peers()[1].name == "Bo" and net.peers()[3] == net.me())
check("peers() is a new list each time", net.peers() ~= net.peers())
check("guest", net.peers()[2].guest == true and net.peers()[1].guest == false)
check("host() is the first", net.host() == net.peers()[1] and not net.isHost())
check("room()", net.room() == "Arena")
check("peer(id)", net.peer(2) == net.peers()[2] and net.peer(77) == nil)
check("peerJoined for those already there, not for me", events(A) == "peerJoined Bo; peerJoined Guest 2", "")
check("a piece outside the scene gets nothing", #B.got == 0)

-- 3. Peers come and go ------------------------------------------------------

local bo = net.peer(1)
page({ t = "joined", peer = { id = 4, name = "Cy" } })
check("peerJoined", events(A) == "peerJoined Cy")
check("the new peer is last", net.peers()[4].name == "Cy")
page({ t = "left", id = 1, host = 2 })
check("peerLeft gets the peer", events(A) == "peerLeft Bo")
check("host changes", net.host() == net.peer(2) and #net.peers() == 3)
check("the old peer table is not in the room", net.peer(1) == nil)
page({ t = "left", id = 2, host = 3 })
events(A)
check("you can become the host", net.isHost())

-- 4. Messages ---------------------------------------------------------------

page({ t = "msg", from = 4, d = { x = 10, y = 20.5, list = { 1, 2, 3 }, name = "é" } })
local got = A.got[1]
check("message(from, data)", got and got[1] == "message" and got[2] == net.peer(4) and got[3].x == 10 and got[3].y == 20.5 and #got[3].list == 3 and got[3].name == "é")
A.got = {}
page({ t = "msg", from = 4 })
check("a message without data gives nil", #A.got == 1 and A.got[1][2] == net.peer(4) and A.got[1][3] == nil)
A.got = {}
page({ t = "msg", from = 4, d = json.null })
check("null gives nil", #A.got == 1 and A.got[1][3] == nil)
A.got = {}
page({ t = "msg", from = 99, d = 1 })
check("a message from a peer that is not here is ignored", events(A) == "")
page({ t = "msg", from = 4, d = "old", s = session - 1 })
check("a message from an earlier join is ignored", events(A) == "")

sent = {}
check("send to a peer", net.send(net.peer(4), { x = 1, tags = { "a", "b" } }) == true)
local line = sent[1]
check("the line for the page", line == '{"type":"net","call":"to","to":4,"d":{"tags":["a","b"],"x":1}}', line)
check("send to an id", net.send(4, "hi") == true and sent[2] == '{"type":"net","call":"to","to":4,"d":"hi"}', sent[2])
check("send with no data", net.send(4) == true and sent[3]:find('"d":null', 1, true) ~= nil, sent[3])
check("broadcast", net.broadcast({ 1, 2 }) == true and sent[4] == '{"type":"net","call":"all","d":[1,2]}', sent[4])
check("send to yourself: no-peer", select(2, net.send(net.me(), 1)) == "no-peer")
check("send to someone not here: no-peer", select(2, net.send(77, 1)) == "no-peer")
check("send to an old peer table: no-peer", select(2, net.send(bo, 1)) == "no-peer")
check("text with quotes and new lines stays one line", net.send(4, 'a "b"\nc') == true and not sent[#sent]:find("\n"))

fails("a function can't be sent", function() net.send(4, { x = 1, f = print }) end, "smitten.net.send(): data.f is a function")
fails("a piece can't be sent", function() net.broadcast({ who = setmetatable({}, {}) }) end, "smitten.net.broadcast(): data.who is a piece")
fails("NaN can't be sent", function() net.send(4, { 0 / 0 }) end, "data[1] is nan")
fails("a list with a gap can't be sent", function() net.send(4, { 1, nil, 3 }) end, "data is not a list")
fails("a table with both kinds of keys can't be sent", function() net.send(4, { 1, 2, x = 3 }) end, "data is not a list")
fails("number keys that are not a list", function() net.send(4, { [5] = "x" }) end, "data is not a list")
fails("a table key", function() net.send(4, { [{}] = 1 }) end, "has a key that is a table")
local loop = {}
loop.self = loop
fails("a table that contains itself", function() net.send(4, loop) end, "data.self contains itself")
fails("too big", function() net.broadcast(string.rep("x", 9000)) end, "the data is 9002 bytes as JSON, and the most is 8192")
fails("the error is at the caller", function() net.send(4, print) end, "test.lua:")
check("the same table twice is fine", net.send(4, { a = { 1 }, b = { 1 } }) == true)
local shared = { 1 }
check("a table used in two places is fine", net.send(4, { a = shared, b = shared }) == true)
check("an empty table is fine", net.send(4, {}) == true)

-- 5. Warnings from the relay --------------------------------------------------

printed = {}
page({ t = "warn", reason = "too-fast" })
page({ t = "warn", reason = "too-fast" })
check("a warning is printed once", #printed == 1 and printed[1]:find("^Warning: smitten.net: the games site did not send some messages") ~= nil, printed[1])
T = T + 6
page({ t = "warn", reason = "too-fast" })
check("and again 5 seconds later", #printed == 2)

-- 6. Reconnecting: the welcome again -------------------------------------------

welcome({ { id = 3, name = "Ada", guest = true }, { id = 5, name = "Di" } }, 3, 3)
check("after a reconnect: peerLeft for those who went, peerJoined for those who came", events(A) == "peerLeft Cy; peerJoined Di")
check("still in the room, same me", net.room() == "Arena" and net.me().id == 3 and #net.peers() == 2)

-- 7. Disconnected ---------------------------------------------------------------

page({ t = "closed", reason = "lost" })
check("disconnected(reason)", events(A) == "disconnected lost")
check("out of the room", net.room() == nil and net.me() == nil and #net.peers() == 0)
page({ t = "msg", from = 5, d = 1 })
check("nothing more arrives", events(A) == "")

-- 8. Joining fails, waits too long, or is cancelled ------------------------------

joined = task(function() return net.join("full room") end)
session = lastSent().s
page({ t = "closed", reason = "full" })
check("a refused join: nil and the reason", joined.done and joined.values[1] == nil and joined.values[2] == "full", joined.values[2])
check("a refused join sends no event", events(A) == "")

sent = {}
joined = task(function() return net.join("slow") end)
session = lastSent().s
T = T + 10
net._update()
check("not yet", not joined.done)
T = T + 6
net._update()
check("join gives up after 15 seconds", joined.done and joined.values[2] == "timeout", joined.values[2])
check("and tells the page to leave", lastSent().call == "leave")
welcome({ { id = 1, name = "Late" } }, 1, 1)
check("a late welcome is ignored", net.room() == nil and events(A) == "")

joined = task(function() return net.join("x") end)
net.leave()
check("leave() while joining: join gives nil, left", joined.done and joined.values[2] == "left")

local cb
local r1, r2 = net.join("cb", function(me, why) cb = { me, why } end)
session = lastSent().s
check("join with a callback returns nil, sent", r1 == nil and r2 == "sent")
welcome({ { id = 1, name = "Me" } }, 1, 1)
check("the callback gets your peer", cb and cb[1] == net.me() and net.isHost())

-- 9. Leaving ---------------------------------------------------------------

sent = {}
net.leave()
check("leave() tells the page", lastSent().call == "leave" and lastSent().type == "net")
check("leave() sends you no event", events(A) == "")
page({ t = "joined", peer = { id = 2, name = "After" } })
check("events after leave() are ignored", events(A) == "")

-- 10. An event that leaves the room stops the rest -------------------------------

local C = piece("C")
B._inside = true
function A:peerJoined() net.leave() end
function B:peerJoined() self.got[#self.got + 1] = { "peerJoined" } end
function C:peerJoined() self.got[#self.got + 1] = { "peerJoined" } end
joined = task(function() return net.join("again") end)
session = lastSent().s
welcome({ { id = 1, name = "Old" }, { id = 2, name = "New" } }, 2, 1)
check("after leave() in an event, no more events come", #B.got <= 1 and #C.got <= 1, #B.got .. " " .. #C.got)
check("and the room is left", net.room() == nil)

realPrint(("%d passed, %d failed"):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
