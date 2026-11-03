-- smitten.scene: the running scene tree (DESIGN.md, section 4).
--
--   smitten.scene.change("levels/level2.scene")
--   local coin = smitten.scene.instance("coin.scene", { x = 100, y = 40 })
--   smitten.scene.current:add(coin)
--   for _, e in ipairs(smitten.scene.group("enemies")) do e:destroy() end
--
-- love.run calls update() and draw() through love.engine, so a project
-- only needs a main scene in smitten.json; main.lua is optional.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")
local json = require("love.json")

local scene = {}
-- The node type files below require this module while it's still loading.
package.loaded["love.scene"] = scene

---The root node of the running scene, or nil.
scene.current = nil
---The path of the running scene's file, or nil.
scene.path = nil
---What the last change() passed after the path.
scene.args = {}
---While true, nodes don't update and physics doesn't run (drawing goes on).
scene.paused = false

local STEP = 1 / 60
local MAX_STEPS = 4

-- The running tree: groups, nodes to free, systems (collisions, physics).
local tree = {
	root = nil,
	groups = {},
	toFree = {},
	systems = {},  -- name -> {step = fn(h), reset = fn(), order = n}
	systemList = {},
	frame = 0,
	accumulator = 0,
	dt = 0,
}
nodeLib.tree = tree
scene._tree = tree

function tree:groupAdd(name, n)
	local g = self.groups[name]
	if not g then
		g = {}
		self.groups[name] = g
	end
	g[#g + 1] = n
end

function tree:groupRemove(name, n)
	local g = self.groups[name]
	if not g then return end
	for i = #g, 1, -1 do
		if g[i] == n then table.remove(g, i) end
	end
end

---Adds a system that runs every physics step (used by the node modules).
function scene._addSystem(name, system)
	if tree.systems[name] then return tree.systems[name] end
	system.order = system.order or 50
	tree.systems[name] = system
	tree.systemList[#tree.systemList + 1] = system
	table.sort(tree.systemList, function(a, b) return a.order < b.order end)
	return system
end

function scene._getSystem(name)
	return tree.systems[name]
end

---------------------------------------------------------------------------
-- Node types (each file extends the classes made from nodes.json)

local loaded = {}
local TYPE_FILES = {
	"love.scene.basic", "love.scene.nodes2d", "love.scene.tilemap", "love.scene.physics2d",
	"love.scene.ui", "love.scene.audio", "love.scene.behaviors",
}
for _, f in ipairs(TYPE_FILES) do require(f) end

-- Types whose implementation lives in an optional module are loaded the
-- first time a node of that type is made.
local LAZY_TYPE_FILES = {
	RigidBody2D = "love.scene.rigid2d", Joint2D = "love.scene.rigid2d",
}
local THREE_D = "love.scene.nodes3d"
local PHYSICS_3D = "love.scene.physics3d"

local function ensureType(typeName)
	if loaded[typeName] then return end
	loaded[typeName] = true
	local file = LAZY_TYPE_FILES[typeName]
	local def = require("love.scene.schema").types[typeName]
	if not file and def then
		if def.group == "physics3d" or typeName == "FirstPerson" then
			file = PHYSICS_3D
		elseif def.module == "3d" then
			file = THREE_D
		end
	end
	if file == PHYSICS_3D then require(THREE_D) end
	if file then require(file) end
end

---------------------------------------------------------------------------
-- Making nodes and loading scenes

local function decode(v)
	if v == json.null then return nil end
	return v
end

local building = {}

local function build(entry, file)
	local n
	if entry.scene then
		n = scene._instance(entry.scene, entry.script)
	else
		local typeName = entry.type or "Node"
		ensureType(typeName)
		local script = entry.script and assets.script(entry.script) or nil
		n = nodeLib.new(typeName, script)
		n.script = entry.script
	end
	if entry.name then n.name = entry.name end
	if entry.properties then
		for k, v in pairs(entry.properties) do n[k] = decode(v) end
	end
	if entry.groups then
		for _, g in ipairs(entry.groups) do n:addToGroup(g) end
	end
	if entry.children then
		for _, c in ipairs(entry.children) do n:add(build(c, file)) end
	end
	return n
end

function scene._instance(path, scriptOverride)
	path = assets.normalize(path)
	if building[path] then
		error(("%s places itself inside itself (directly or through another scene)"):format(path), 0)
	end
	local data = assets.scene(path)
	building[path] = true
	local ok, root = pcall(function()
		local entry = data.root
		if scriptOverride then
			entry = nodeLib.copy(entry)
			entry.script = scriptOverride
		end
		return build(entry, path)
	end)
	building[path] = nil
	if not ok then error(root, 0) end
	root._scene = path
	return root
end

---Makes a node from a scene file (an instance), with optional property
---overrides. Add it to the tree with node:add() to bring it to life.
function scene.instance(path, props)
	if type(path) ~= "string" then error("instance() needs the path of a .scene file", 2) end
	local ok, n = pcall(scene._instance, path)
	if not ok then error(n, 2) end
	if props then
		for k, v in pairs(props) do n[k] = v end
	end
	return n
end

---Makes a node of a type ("Sprite2D", "Label", ...) with optional properties
---and an optional script (a table or the path of a .lua file).
function scene.create(typeName, props, script)
	if type(typeName) ~= "string" then error("create() needs a node type, like \"Sprite2D\"", 2) end
	ensureType(typeName)
	local scriptTable = script
	if type(script) == "string" then scriptTable = assets.script(script) end
	local ok, n = pcall(nodeLib.new, typeName, scriptTable, props)
	if not ok then error(n, 2) end
	if type(script) == "string" then n.script = script end
	return n
end

---The nodes in a group (a new list, safe to change while looping).
function scene.group(name)
	local g = tree.groups[name]
	if not g then return {} end
	local out = {}
	for i = 1, #g do
		if not g[i]._dead then out[#out + 1] = g[i] end
	end
	return out
end

---The first node in a group, or nil.
function scene.first(name)
	local g = tree.groups[name]
	if g then
		for i = 1, #g do
			if not g[i]._dead then return g[i] end
		end
	end
	return nil
end

---A node of the running scene by path from the root ("Player/Sword").
function scene.find(path)
	if not tree.root then return nil end
	if path == tree.root.name then return tree.root end
	return tree.root:find(path)
end

---------------------------------------------------------------------------
-- Changing scenes

local pending = nil

local function setRoot(root, path)
	for _, sys in ipairs(tree.systemList) do
		if sys.reset then sys.reset() end
	end
	if tree.root then nodeLib.exitTree(tree.root) end
	tree.groups = {}
	tree.toFree = {}
	tree.accumulator = 0
	require("love.tween")._sceneChanged()
	tree.root = root
	scene.current = root
	scene.path = path
	if root then nodeLib.enterTree(root) end
end

local function load(path)
	local ok, root = pcall(scene._instance, path)
	if not ok then error(root, 0) end
	return root
end

---Goes to another scene at the end of this frame. Extra arguments are kept
---in smitten.scene.args for the new scene's scripts.
function scene.change(path, ...)
	if type(path) ~= "string" then error("change() needs the path of a .scene file", 2) end
	local args = { ... }
	path = assets.normalize(path)
	if not tree.root then
		scene.args = args
		local ok, err = pcall(function() setRoot(load(path), path) end)
		if not ok then error(err, 2) end
		return
	end
	-- Load now, so a missing file is reported where change() was called.
	local ok, root = pcall(load, path)
	if not ok then error(root, 2) end
	pending = { root = root, path = path, args = args }
end

---Starts the running scene again from its file.
function scene.reload()
	if scene.path then scene.change(scene.path, unpack(scene.args)) end
end

---Makes a node the running scene's root (a scene built in code).
function scene.setCurrent(root)
	if tree.root then
		pending = { root = root, path = nil, args = {} }
	else
		setRoot(root, nil)
	end
end

---------------------------------------------------------------------------
-- The frame (called by love.engine)

local function freeNodes()
	local list = tree.toFree
	if #list == 0 then return end
	tree.toFree = {}
	for i = 1, #list do
		local n = list[i]
		if n.parent then
			n.parent:_detach(n)
		elseif n == tree.root then
			setRoot(nil, nil)
		end
	end
end

local function physicsTraverse(n, h)
	if n._dead then return end
	if n._physics then n:_physics(h) end
	local f = n.physicsUpdate
	if f then f(n, h) end
	local ch = n.children
	for i = 1, #ch do
		local c = ch[i]
		if c then physicsTraverse(c, h) end
	end
end

local function processTraverse(n, dt)
	if n._dead then return end
	if n._process then n:_process(dt) end
	local f = n.update
	if f then f(n, dt) end
	local ch = n.children
	for i = 1, #ch do
		local c = ch[i]
		if c then processTraverse(c, dt) end
	end
end

local function physicsStep(h)
	tree.dt = h
	physicsTraverse(tree.root, h)
	local systems = tree.systemList
	for i = 1, #systems do
		local s = systems[i]
		if s.step and tree.root then s.step(h) end
	end
	freeNodes()
end

function scene._update(dt)
	if pending then
		local p = pending
		pending = nil
		scene.args = p.args
		setRoot(p.root, p.path)
	end
	if not tree.root or scene.paused then return end
	tree.frame = tree.frame + 1
	tree.accumulator = tree.accumulator + dt
	local steps = 0
	while tree.accumulator >= STEP and steps < MAX_STEPS and tree.root do
		physicsStep(STEP)
		tree.accumulator = tree.accumulator - STEP
		steps = steps + 1
	end
	if steps == MAX_STEPS then tree.accumulator = 0 end
	if not tree.root then return end
	tree.dt = dt
	processTraverse(tree.root, dt)
	freeNodes()
end

---The length of the current step: the frame's dt in update(), the fixed
---step in physicsUpdate().
function scene.getDelta()
	return tree.dt
end

-- Drawing: 3D first (if the scene has a 3D camera), then the 2D world, the
-- game's own smitten.draw, then UI on top.
function scene._draw(userDraw)
	local root = tree.root
	if root then
		local r3 = package.loaded[THREE_D]
		if r3 then r3.render(root) end
		require("love.scene.nodes2d").render(root)
	end
	if userDraw then userDraw() end
	if root then require("love.scene.ui").render(root) end
end

---Sends an input event to the tree's UI (called by love.engine).
function scene._uiInput(...)
	if tree.root then require("love.scene.ui").input(tree.root, ...) end
end

return scene
