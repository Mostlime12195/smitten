-- Live tweaking (DESIGN.md, section 8): while the game runs in the editor,
-- the editor can look at the running scene's pieces and change their
-- properties. Changes only touch this running copy; stopping the game
-- forgets them.
--
-- The editor's messages arrive through love._livePoll() (web_main.cpp) as
-- JSON: {op = "tree"}, {op = "get", ids = {...}}, {op = "set", id, key,
-- value}, {op = "destroy", id}. Answers go out as printed lines starting
-- with "\1live ", which the editor takes out of the output.
--
-- The games site's page talks to smitten.boards through the same queue:
-- its messages have op = "site" (love.boards).

local json = require("love.json")
local schema = require("love.scene.schema")

local live = {}

local nextId = 0
local byId = setmetatable({}, { __mode = "v" })

local function idOf(n)
	if not n._liveId then
		nextId = nextId + 1
		n._liveId = nextId
		byId[nextId] = n
	end
	return n._liveId
end

local function send(t)
	print("\1live " .. json.encode(t))
end

local function tree(n)
	local out = { id = idOf(n), name = n.name, type = n.type, motion = n.motion, script = n.script, children = {} }
	for _, c in ipairs(n.children) do
		if not c._dead then out.children[#out.children + 1] = tree(c) end
	end
	return out
end

local function simple(v)
	local t = type(v)
	if t == "number" or t == "string" or t == "boolean" then return true end
	if t == "table" and getmetatable(v) == nil and #v > 0 then
		for _, x in ipairs(v) do
			if type(x) ~= "number" then return false end
		end
		return true
	end
	return false
end

-- A piece's properties and script variables as they are right now.
local function props(n)
	local out = {}
	local name = n.type
	while name do
		local def = schema.types[name]
		for k in pairs(def.properties or {}) do
			local v = n[k]
			if v ~= nil and simple(v) then out[k] = v end
		end
		name = def.extends
	end
	if n._scriptVars then
		for k in pairs(n._scriptVars) do
			local v = n[k]
			if type(k) == "string" and k:sub(1, 1) ~= "_" and simple(v) and out[k] == nil then out[k] = v end
		end
	elseif n.script then
		local ok, script = pcall(require("love.assets").script, n.script)
		if ok then
			for k, v in pairs(script) do
				if type(k) == "string" and k:sub(1, 1) ~= "_" and simple(v) and out[k] == nil then out[k] = n[k] end
			end
		end
	end
	return out
end

local function handle(msg)
	local scene = package.loaded["love.scene"]
	if msg.op == "tree" then
		send({ op = "tree", root = scene and scene.current and tree(scene.current) or json.null, path = scene and scene.path })
	elseif msg.op == "get" then
		local values = {}
		for _, id in ipairs(msg.ids or {}) do
			local n = byId[id]
			if n and not n._dead then values[tostring(id)] = props(n) end
		end
		send({ op = "props", values = values })
	elseif msg.op == "set" then
		local n = byId[msg.id]
		if n and not n._dead and type(msg.key) == "string" then
			local v = msg.value
			if v == json.null then v = nil end
			n[msg.key] = v
		end
	elseif msg.op == "destroy" then
		local n = byId[msg.id]
		if n and not n._dead then n:destroy() end
	end
end

---Called every frame by love.engine.
function live.poll()
	local messages = love._livePoll()
	for i = 1, #messages do
		local ok, msg = pcall(json.decode, messages[i])
		if ok and type(msg) == "table" then
			if msg.op == "site" then
				-- Not under pcall: this can run the game's own code (a
				-- callback, the rest of a task), whose errors are the game's.
				require("love.boards")._receive(msg)
			else
				local ran, err = pcall(handle, msg)
				if not ran then send({ op = "error", message = tostring(err) }) end
			end
		end
	end
	local boards = package.loaded["love.boards"]
	if boards then boards._update() end
end

return live
