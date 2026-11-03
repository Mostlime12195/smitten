-- Pieces: the classes behind every piece type, scripts, the tree, events and
-- tags (DESIGN.md, section 4).
--
-- Every piece type in pieces.json becomes a class table whose fields are the
-- type's property defaults, inheriting from its parent type. A piece is a
-- plain table whose metatable reads through to its class, so properties are
-- ordinary fields: `self.x = 10` sets one, and a property never set reads
-- the default. Types implement themselves with underscore methods, which
-- scripts never clash with:
--
--   _enter()          joined the running scene
--   _exit()           leaving it
--   _process(dt)      every frame, before the script's update(dt)
--   _physics(dt)      every physics step, before physicsUpdate(dt)
--   _draw()           draws the piece in its own coordinates
--
-- A script is a table of functions and variables. A piece with a script gets
-- a class made of the script's fields over the type's class, so `self:foo()`
-- finds the script's function first, then the type's method.

local schema = require("love.scene.schema")

local node = {}

local classes = {}       -- type name -> class
node.classes = classes

local tableDefaults = {} -- class -> {field = default table}, copied into each node

local function copy(t)
	local out = {}
	for k, v in pairs(t) do out[k] = v end
	return out
end
node.copy = copy

---The base of every class: the methods of Piece.
local Node = {}
Node.__index = Node
Node.__mt = { __index = Node }

local function makeClass(name)
	if classes[name] then return classes[name] end
	local def = schema.types[name]
	if not def then return nil end
	local base = def.extends and makeClass(def.extends) or Node
	local cls = setmetatable({}, { __index = base })
	cls.__mt = { __index = cls, __tostring = function(n) return n.type .. " \"" .. tostring(n.name) .. "\"" end }
	cls.type = name
	cls._base = base
	cls._def = def
	local tdefaults = copy(tableDefaults[base] or {})
	for prop, p in pairs(def.properties or {}) do
		if type(p.default) == "table" then
			tdefaults[prop] = p.default
		elseif p.default ~= nil then
			cls[prop] = p.default
		end
	end
	tableDefaults[cls] = tdefaults
	classes[name] = cls
	return cls
end

for name in pairs(schema.types) do makeClass(name) end
Node.type = "Piece"

---Adds methods to a piece type: node.extend("Sprite", { _draw = ... }).
function node.extend(typeName, methods)
	local cls = assert(classes[typeName], typeName)
	for k, v in pairs(methods) do cls[k] = v end
	return cls
end

---Every property of a type, its own and inherited: name -> definition.
function node.properties(typeName)
	local out = {}
	local name = typeName
	while name do
		local def = schema.types[name]
		for prop, p in pairs(def.properties or {}) do
			if out[prop] == nil then out[prop] = p end
		end
		name = def.extends
	end
	return out
end

-- Script classes, cached per (script, type).
local scriptClasses = setmetatable({}, { __mode = "k" })

local function scriptClass(script, cls)
	local byType = scriptClasses[script]
	if not byType then
		byType = {}
		scriptClasses[script] = byType
	end
	local sc = byType[cls]
	if sc then return sc end
	sc = setmetatable({}, { __index = cls })
	local tdefaults = copy(tableDefaults[cls])
	for k, v in pairs(script) do
		if type(v) == "table" and getmetatable(v) == nil then
			tdefaults[k] = v
		else
			sc[k] = v
		end
	end
	tableDefaults[sc] = tdefaults
	sc.__mt = cls.__mt.__tostring and { __index = sc, __tostring = cls.__mt.__tostring } or { __index = sc }
	byType[cls] = sc
	return sc
end

---Forgets cached script classes (after a script file changes).
function node.clearScripts()
	for k in pairs(scriptClasses) do scriptClasses[k] = nil end
end

local function deepCopyValue(v)
	if type(v) ~= "table" then return v end
	local out = {}
	for k, x in pairs(v) do out[k] = deepCopyValue(x) end
	return out
end

---Makes a piece of a type, with an optional script table and properties.
function node.new(typeName, script, props)
	local cls = classes[typeName]
	if not cls then
		local names = {}
		for n, def in pairs(schema.types) do
			if not def.abstract then names[#names + 1] = n end
		end
		local hint = require("love.engine.util").didYouMean(typeName, names)
		error(("there's no piece type called %q%s"):format(tostring(typeName), hint), 3)
	end
	if cls._def.abstract then
		error(("%s is the base of other piece types and can't be made itself"):format(typeName), 3)
	end
	local c = script and scriptClass(script, cls) or cls
	local n = setmetatable({ name = typeName, type = typeName, children = {}, parent = nil, script = nil }, c.__mt)
	for k, v in pairs(tableDefaults[c]) do n[k] = deepCopyValue(v) end
	if props then
		for k, v in pairs(props) do n[k] = v end
	end
	return n
end

---------------------------------------------------------------------------
-- The tree

-- Set by love.scene: the running tree (tags, pieces to free, systems).
node.tree = nil

local function enterTree(n)
	n._inside = true
	local tree = node.tree
	if n._tags and tree then
		for g in pairs(n._tags) do tree:tagAdd(g, n) end
	end
	if n._enter then n:_enter() end
	local ch = n.children
	for i = 1, #ch do enterTree(ch[i]) end
	-- Ready runs children first, like Godot: a parent's ready() can use them.
	if not n._ready then
		n._ready = true
		local f = n.ready
		if f then f(n) end
	end
end
node.enterTree = enterTree

local function exitTree(n)
	local ch = n.children
	for i = #ch, 1, -1 do exitTree(ch[i]) end
	local f = n.removed
	if f then f(n) end
	if n._exit then n:_exit() end
	local tree = node.tree
	if n._tags and tree then
		for g in pairs(n._tags) do tree:tagRemove(g, n) end
	end
	n._inside = false
end
node.exitTree = exitTree

function Node:add(child, index)
	if type(child) ~= "table" or getmetatable(child) == nil or child.children == nil then
		error("add() needs a piece (made with smitten.scene.make)", 2)
	end
	if child.parent then child.parent:_detach(child) end
	child.parent = self
	if index then
		table.insert(self.children, index, child)
	else
		self.children[#self.children + 1] = child
	end
	if self._inside then enterTree(child) end
	return child
end

function Node:_detach(child)
	local ch = self.children
	for i = 1, #ch do
		if ch[i] == child then
			table.remove(ch, i)
			break
		end
	end
	if child._inside then exitTree(child) end
	child.parent = nil
end

---Takes the piece out of its parent now (it can be added somewhere else).
function Node:remove()
	if self.parent then self.parent:_detach(self) end
	return self
end

function Node:destroy()
	if self._dead then return end
	self._dead = true
	local tree = node.tree
	if tree and self._inside then
		tree.toFree[#tree.toFree + 1] = self
	elseif self.parent then
		self.parent:_detach(self)
	end
end

function Node:isAlive()
	return self._inside == true and not self._dead
end

---Makes a piece from a scene file or a type and adds it as a child.
function Node:spawn(what, props)
	local scene = require("love.scene")
	local ok, n = pcall(scene.make, what, props)
	if not ok then error(n, 2) end
	return self:add(n)
end

function Node:find(path)
	if type(path) ~= "string" then error("find() needs a name or a path", 2) end
	local n = self
	for part in path:gmatch("[^/]+") do
		if part == ".." then
			n = n.parent
		elseif part ~= "." then
			local found
			local ch = n.children
			for i = 1, #ch do
				if ch[i].name == part then
					found = ch[i]
					break
				end
			end
			n = found
		end
		if not n then return nil end
	end
	return n
end

---Finds a piece inside this one by name, at any depth (first in tree order).
function Node:findDeep(name)
	local ch = self.children
	for i = 1, #ch do
		if ch[i].name == name then return ch[i] end
	end
	for i = 1, #ch do
		local f = ch[i]:findDeep(name)
		if f then return f end
	end
	return nil
end

---The first child of a type (or a type it extends), or nil.
function Node:findChildOfType(typeName)
	for _, c in ipairs(self.children) do
		if c:isA(typeName) then return c end
	end
	return nil
end

function Node:isA(typeName)
	local name = self.type
	while name do
		if name == typeName then return true end
		local def = schema.types[name]
		name = def and def.extends
	end
	return false
end

function Node:getPath()
	local parts = {}
	local n = self
	while n do
		table.insert(parts, 1, n.name)
		n = n.parent
	end
	return table.concat(parts, "/")
end

function Node:tag(name)
	self._tags = self._tags or {}
	if self._tags[name] then return end
	self._tags[name] = true
	if self._inside and node.tree then node.tree:tagAdd(name, self) end
end

function Node:untag(name)
	if not (self._tags and self._tags[name]) then return end
	self._tags[name] = nil
	if self._inside and node.tree then node.tree:tagRemove(name, self) end
end

function Node:hasTag(name)
	return self._tags ~= nil and self._tags[name] == true
end

---True if the piece has any of the tags in a comma-separated list.
function Node:hasAnyTag(list)
	if not self._tags or list == nil or list == "" then return false end
	for t in list:gmatch("[^,%s]+") do
		if self._tags[t] then return true end
	end
	return false
end

---------------------------------------------------------------------------
-- Events

local Listener = {}
Listener.__index = Listener

function Listener:off()
	local list = self.node._listeners and self.node._listeners[self.event]
	if not list then return end
	for i = #list, 1, -1 do
		if list[i] == self then table.remove(list, i) end
	end
end

function Node:on(event, fn)
	if type(fn) ~= "function" then error("on() needs an event name and a function", 2) end
	self._listeners = self._listeners or {}
	local list = self._listeners[event]
	if not list then
		list = {}
		self._listeners[event] = list
	end
	local l = setmetatable({ node = self, event = event, fn = fn }, Listener)
	list[#list + 1] = l
	return l
end

function Node:emit(event, ...)
	local f = self[event]
	if type(f) == "function" then f(self, ...) end
	local list = self._listeners and self._listeners[event]
	if list then
		for i = 1, #list do
			local l = list[i]
			if l then l.fn(...) end
		end
	end
end

node.Node = Node
return node
