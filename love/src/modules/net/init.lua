-- smitten.net: online rooms on the games site.
--
-- A game joins a room by its name; everyone in the same room of the same
-- game can send messages to each other. This module is only the transport:
-- what the messages mean (who moves what, who decides) is the game's. It
-- only works while the game runs on its page on the games site: in the
-- editor, in an exported game and anywhere else, available() is false and
-- join() answers nil, "unavailable", so a game works the same without it.
--
-- Like smitten.boards, the game has no network access. Its messages go out
-- as printed lines starting with "\1site " (the player hands them to the
-- page, which holds the connection: platform/public/play.js), and the
-- relay's come back through the queue live tweaking uses (love.engine.live
-- gives them to _receive).
--
-- Events go to the scripts that have a function with their name
-- (peerJoined, peerLeft, message, disconnected): love.scene.script keeps a
-- set of those pieces, so no walk through the tree is needed.

local json = require("love.json")

local net = {}

net.MAX_BYTES = 8192      -- the most data in one message, as JSON
local JOIN_TIMEOUT = 15   -- seconds to wait for a room

local available = false
local state = "out"       -- "out", "joining" or "in"
local session = 0         -- a new number for each join()
local roomName = nil
local joining = nil       -- { task = coroutine } or { callback = fn }, with deadline
local peers = {}          -- id -> peer table { id, name, guest, me }
local order = {}          -- the peers, in the order they joined
local mePeer, hostPeer = nil, nil
local warnedAt = {}

local function now()
	return love.timer and love.timer.getTime() or os.clock()
end

local function script()
	return package.loaded["love.scene.script"]
end

local function out(message)
	print("\1site " .. json.encode(message))
end

local function reset()
	state = "out"
	roomName = nil
	peers = {}
	order = {}
	mePeer, hostPeer = nil, nil
end

-- Gives join()'s answer to whoever waits for it.
local function finishJoin(a, b)
	local j = joining
	joining = nil
	if not j then return end
	local s = script()
	if j.callback then
		if s then s.runTask(nil, j.callback, a, b) else j.callback(a, b) end
	elseif j.task and s then
		s.resumeTask(j.task, a, b)
	end
end

-- Sends an event to every piece in the scene whose script has a function
-- with its name. Stops if the game leaves the room (or joins another) in
-- one of them.
local scratch = {}
local function deliver(event, ...)
	local s = script()
	if not s then return end
	local count = 0
	for p in pairs(s.netPieces) do
		count = count + 1
		scratch[count] = p
	end
	local mine = session
	for i = 1, count do
		local p = scratch[i]
		scratch[i] = nil
		if session == mine and p._inside and not p._dead and type(p[event]) == "function" then
			p:emit(event, ...)
		end
	end
end

local function peerFrom(info)
	if type(info) ~= "table" or type(info.id) ~= "number" then return nil end
	local p = peers[info.id]
	if not p then
		p = { id = info.id }
		peers[info.id] = p
	end
	p.name = type(info.name) == "string" and info.name or ("Player " .. info.id)
	p.guest = info.guest == true
	return p
end

local function dropFromOrder(p)
	for i = #order, 1, -1 do
		if order[i] == p then table.remove(order, i) end
	end
end

-- The relay's welcome: when join() succeeds, and again after the page
-- reconnects (then the peers that came and went meanwhile get events).
local function welcome(msg)
	local again = state == "in"
	local present = {}
	local newOrder = {}
	local added = {}
	for _, info in ipairs(type(msg.peers) == "table" and msg.peers or {}) do
		local known = type(info) == "table" and peers[info.id]
		local p = peerFrom(info)
		if p then
			present[p.id] = true
			newOrder[#newOrder + 1] = p
			if not known then added[#added + 1] = p end
		end
	end
	local gone = {}
	for _, p in ipairs(order) do
		if not present[p.id] then gone[#gone + 1] = p end
	end
	for _, p in ipairs(gone) do peers[p.id] = nil end
	order = newOrder
	mePeer = peers[msg.me]
	if mePeer then mePeer.me = true end
	hostPeer = peers[msg.host]
	state = "in"
	if type(msg.room) == "string" and not again then roomName = roomName or msg.room end

	local mine = session
	if not again then
		finishJoin(mePeer)
		-- The players who were there first, as if they had just come in.
		for _, p in ipairs(newOrder) do
			if session ~= mine then return end
			if p ~= mePeer then deliver("peerJoined", p) end
		end
	else
		for _, p in ipairs(gone) do
			if session ~= mine then return end
			deliver("peerLeft", p)
		end
		for _, p in ipairs(added) do
			if session ~= mine then return end
			if p ~= mePeer then deliver("peerJoined", p) end
		end
	end
end

local WARNINGS = {
	["too-fast"] = "the games site did not send some messages: send fewer messages per second (30 at most)",
	["too-big"] = "the games site did not send a message that was too big",
	["no-peer"] = "a message went to a peer that is not in the room",
	["bad-message"] = "the games site could not read a message",
}

---A message from the games site's page (love.engine.live).
function net._receive(msg)
	-- Each join() has its own number: what comes from an earlier room is old.
	if msg.s ~= session then return end
	local t = msg.t
	if t == "msg" then
		if state ~= "in" then return end
		local from = peers[msg.from]
		if not from then return end
		local d = msg.d
		if d == json.null then d = nil end
		deliver("message", from, d)
	elseif t == "welcome" then
		if state ~= "out" then welcome(msg) end
	elseif t == "joined" then
		if state ~= "in" or type(msg.peer) ~= "table" or peers[msg.peer.id] then return end
		local p = peerFrom(msg.peer)
		if not p then return end
		order[#order + 1] = p
		deliver("peerJoined", p)
	elseif t == "left" then
		if state ~= "in" then return end
		local p = peers[msg.id]
		if p then
			peers[msg.id] = nil
			dropFromOrder(p)
		end
		hostPeer = peers[msg.host] or hostPeer
		if hostPeer and not peers[hostPeer.id] then hostPeer = order[1] end
		if p then deliver("peerLeft", p) end
	elseif t == "closed" then
		local reason = type(msg.reason) == "string" and msg.reason or "error"
		if state == "joining" then
			reset()
			finishJoin(nil, reason)
		elseif state == "in" then
			reset()
			session = session + 1
			deliver("disconnected", reason)
		end
	elseif t == "warn" then
		local reason = tostring(msg.reason)
		local at = now()
		if not warnedAt[reason] or at - warnedAt[reason] > 5 then
			warnedAt[reason] = at
			print("Warning: smitten.net: " .. (WARNINGS[reason] or reason) .. ".")
		end
	end
end

---Called every frame (love.engine.live): a join that takes too long gives up.
function net._update()
	if joining and state == "joining" and now() >= joining.deadline then
		out({ type = "net", call = "leave" })
		reset()
		session = session + 1
		finishJoin(nil, "timeout")
	end
end

---A message from the page when the game starts (love.engine.live).
function net._hello(msg)
	available = msg.net == true
end

---------------------------------------------------------------------------
-- What scripts call

---True while the game runs on its page on the games site.
function net.available()
	return available
end

-- A name the relay can take: 1 to 32 characters, no control characters.
local function roomOk(room)
	if room:find("^%s") or room:find("%s$") or room:find("%c") then return false end
	local chars = 0
	for _ in room:gmatch("[^\128-\191]") do chars = chars + 1 end
	return chars >= 1 and chars <= 32
end

---Joins a room (and makes it if nobody is in it). In a task it waits and
---returns your peer, or nil and why; with a callback it returns at once.
function net.join(room, options, callback)
	if type(options) == "function" then options, callback = nil, options end
	if callback ~= nil and type(callback) ~= "function" then callback = nil end
	local function answer(a, b)
		if callback then callback(a, b) end
		return a, b
	end
	if not available then return answer(nil, "unavailable") end
	if type(room) == "number" then room = tostring(room) end
	if type(room) ~= "string" or not roomOk(room) then return answer(nil, "bad-room") end
	if state ~= "out" then return answer(nil, "in-room") end

	local s = script()
	local task = not callback and s and s.currentTask() or nil
	-- Nothing could take the answer: update() and draw() can't wait.
	if not callback and not task then return nil, "needs-callback" end

	options = type(options) == "table" and options or {}
	local max = tonumber(options.maxPlayers)
	local name = options.name
	if name ~= nil then name = tostring(name) end
	session = session + 1
	state = "joining"
	roomName = room
	joining = { task = task, callback = callback, deadline = now() + JOIN_TIMEOUT }
	out({ type = "net", call = "join", s = session, room = room, max = max and math.floor(max) or nil, name = name })
	if task then return s.suspendTask() end
	return nil, "sent"
end

---Leaves the room. The others get peerLeft(); you get no event.
function net.leave()
	if state == "out" then return end
	out({ type = "net", call = "leave" })
	local wasJoining = state == "joining"
	reset()
	session = session + 1
	if wasJoining then finishJoin(nil, "left") end
end

---The name of the room you are in, or nil.
function net.room()
	return state == "in" and roomName or nil
end

---Your own peer: { id, name, guest, me = true }, or nil outside a room.
function net.me()
	return mePeer
end

---Everyone in the room (you too), in the order they came in: a new list.
function net.peers()
	local list = {}
	for i = 1, #order do list[i] = order[i] end
	return list
end

---The peer with this id, or nil.
function net.peer(id)
	return peers[id]
end

---The host: the peer that has been in the room longest. The site picks a
---new one when the host leaves. The engine gives the host no other power.
function net.host()
	return hostPeer
end

---True if you are the host.
function net.isHost()
	return mePeer ~= nil and hostPeer == mePeer
end

-- Checks that data can go as JSON, and says where it can't.
local function checkData(v, path, depth, seen)
	local t = type(v)
	if v == nil or v == json.null or t == "string" or t == "boolean" then return end
	if t == "number" then
		if v ~= v or v == math.huge or v == -math.huge then
			error(("%s is %s, which a message cannot hold"):format(path, tostring(v)), 0)
		end
		return
	end
	if t ~= "table" then
		error(("%s is a %s: a message can hold tables, text, numbers and true or false"):format(path, t), 0)
	end
	if getmetatable(v) ~= nil then
		error(("%s is a piece or another table with a metatable: send its values instead, for example { x = p.x, y = p.y }"):format(path), 0)
	end
	if seen[v] then error(path .. " contains itself", 0) end
	if depth > 32 then error("the data has more than 32 tables inside each other", 0) end
	seen[v] = true
	local count, numbers, texts = 0, false, false
	for k, x in pairs(v) do
		count = count + 1
		local kt = type(k)
		if kt == "number" then
			numbers = true
			checkData(x, ("%s[%s]"):format(path, tostring(k)), depth + 1, seen)
		elseif kt == "string" then
			texts = true
			checkData(x, path .. "." .. k, depth + 1, seen)
		else
			error(("%s has a key that is a %s: keys must be text, or 1, 2, 3... for a list"):format(path, kt), 0)
		end
	end
	if numbers and (texts or count ~= #v) then
		error(("%s is not a list (1, 2, 3... with no gaps) and not a table with text keys: use one or the other"):format(path), 0)
	end
	seen[v] = nil
end

local function encode(fname, data)
	local ok, err = pcall(checkData, data, "data", 0, {})
	if not ok then error(("smitten.net.%s(): %s."):format(fname, err), 3) end
	local text = json.encode(data)
	if #text > net.MAX_BYTES then
		error(("smitten.net.%s(): the data is %d bytes as JSON, and the most is %d. Send less in each message.")
			:format(fname, #text, net.MAX_BYTES), 3)
	end
	return text
end

---Sends data to one peer (a peer or its id). Returns true, or nil and why.
function net.send(peer, data)
	local text = encode("send", data)
	if state ~= "in" then return nil, "not-in-room" end
	local id = type(peer) == "table" and peer.id or peer
	local target = peers[id]
	if not target or target == mePeer or (type(peer) == "table" and target ~= peer) then return nil, "no-peer" end
	print('\1site {"type":"net","call":"to","to":' .. ("%d"):format(target.id) .. ',"d":' .. text .. "}")
	return true
end

---Sends data to everyone in the room but you. Returns true, or nil and why.
function net.broadcast(data)
	local text = encode("broadcast", data)
	if state ~= "in" then return nil, "not-in-room" end
	print('\1site {"type":"net","call":"all","d":' .. text .. "}")
	return true
end

-- The page says hello before the game starts; take it now, so available()
-- is right in the first ready(). (The module is registered first: messages
-- are handed to it by name.)
package.loaded["love.net"] = net
if love._livePoll then
	local live = require("love.engine.live")
	live.poll()
	if live.hello then net._hello(live.hello) end
end

return net
