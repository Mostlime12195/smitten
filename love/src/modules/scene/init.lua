-- smitten.scene: the running scene (DESIGN.md, section 4).
--
--   smitten.scene.go("scenes/level2.scene")
--   local coin = smitten.scene.spawn("scenes/coin.scene", { x = 100, y = 40 })
--   for _, e in ipairs(smitten.scene.tagged("enemy")) do e:destroy() end
--
-- love.run calls update() and draw() through love.engine; a project names
-- its main scene in smitten.json.

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
---What the last go() passed after the path.
scene.args = {}
---While true, pieces don't update and physics doesn't run (drawing goes on),
---except pieces whose pausable is false and what's inside them.
scene.paused = false
---How fast time goes: 0.5 is slow motion, 2 double speed.
scene.timeScale = 1

local STEP = 1 / 60
local MAX_STEPS = 4

-- The running tree: tags, pieces to free, systems (collisions, physics).
local tree = {
	root = nil,
	tags = {},
	toFree = {},
	systems = {},  -- name -> {step = fn(h), reset = fn(), order = n}
	systemList = {},
	frame = 0,
	epoch = 0,  -- counts physics steps and updates
	accumulator = 0,
	dt = 0,
}
nodeLib.tree = tree
scene._tree = tree

function tree:tagAdd(name, n)
	local g = self.tags[name]
	if not g then
		g = {}
		self.tags[name] = g
	end
	g[#g + 1] = n
end

function tree:tagRemove(name, n)
	local g = self.tags[name]
	if not g then return end
	for i = #g, 1, -1 do
		if g[i] == n then table.remove(g, i) end
	end
end

---Adds a system that runs every physics step (used by the piece files).
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
-- Piece types (each file extends the classes made from pieces.json). The
-- first Body, Zone or Joint in a scene loads the physics2d module (Box2D);
-- joints2d.lua loads with the first Joint.

for _, f in ipairs({ "love.scene.basic", "love.scene.nodes2d", "love.scene.tilemap", "love.scene.physics2d",
	"love.scene.ui", "love.scene.audio" }) do
	require(f)
end

local function ensureType(typeName)
	if typeName == "Joint" then require("love.scene.joints2d") end
end

---------------------------------------------------------------------------
-- Making pieces and loading scenes

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
		local typeName = entry.type or "Group"
		ensureType(typeName)
		local script = entry.script and assets.script(entry.script) or nil
		n = nodeLib.new(typeName, script)
		n.script = entry.script
	end
	if entry.name then n.name = entry.name end
	if entry.properties then
		for k, v in pairs(entry.properties) do n[k] = decode(v) end
	end
	if entry.tags then
		for _, g in ipairs(entry.tags) do n:tag(g) end
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

---Makes a piece without adding it to the scene: from a scene file
---(make("scenes/coin.scene")) or a piece type (make("Sprite", { image =
---"art/coin.png" })), with optional properties and, for a type, a script (a
---table or the path of a .lua file).
function scene.make(what, props, script)
	if type(what) ~= "string" then error("make() needs a .scene file or a piece type, like \"Sprite\"", 2) end
	local ok, n
	if what:match("%.scene$") then
		ok, n = pcall(scene._instance, what)
	else
		ensureType(what)
		local scriptTable = script
		if type(script) == "string" then scriptTable = assets.script(script) end
		ok, n = pcall(nodeLib.new, what, scriptTable)
		if ok and type(script) == "string" then n.script = script end
	end
	if not ok then error(n, 2) end
	if props then
		for k, v in pairs(props) do n[k] = v end
	end
	return n
end

---Makes a piece (like make) and adds it to the running scene, or to parent.
function scene.spawn(what, props, parent)
	local ok, n = pcall(scene.make, what, props)
	if not ok then error(n, 2) end
	parent = parent or tree.root
	if not parent then error("spawn() needs a running scene (or a parent to add to)", 2) end
	return parent:add(n)
end

---The pieces with a tag (a new list, safe to change while looping).
function scene.tagged(name)
	local g = tree.tags[name]
	if not g then return {} end
	local out = {}
	for i = 1, #g do
		if not g[i]._dead then out[#out + 1] = g[i] end
	end
	return out
end

---The first piece with a tag, or nil.
function scene.first(name)
	local g = tree.tags[name]
	if g then
		for i = 1, #g do
			if not g[i]._dead then return g[i] end
		end
	end
	return nil
end

---A point on the screen (game coordinates, like smitten.mouse.x, y) as a
---point in the scene, through the active Camera.
function scene.screenToWorld(x, y)
	return require("love.scene.nodes2d").toWorld(x, y)
end

---A point in the scene as a point on the screen.
function scene.worldToScreen(x, y)
	return require("love.scene.nodes2d").toScreen(x, y)
end

---A piece of the running scene by path from the root ("Player/Sword").
function scene.find(path)
	if not tree.root then return nil end
	if path == tree.root.name then return tree.root end
	return tree.root:find(path)
end

---------------------------------------------------------------------------
-- Changing scenes

local pending = nil

local function setRoot(root, path, args)
	for _, sys in ipairs(tree.systemList) do
		if sys.reset then sys.reset() end
	end
	if tree.root then nodeLib.exitTree(tree.root) end
	tree.tags = {}
	tree.toFree = {}
	tree.accumulator = 0
	require("love.tween")._sceneChanged()
	tree.root = root
	scene.current = root
	scene.path = path
	if root then
		-- The root's ready() gets go()'s extra values.
		if args and #args > 0 then root._readyArgs = args end
		nodeLib.enterTree(root)
	end
end

local function load(path)
	local ok, root = pcall(scene._instance, path)
	if not ok then error(root, 0) end
	return root
end

-- The transition go() uses (transition()), and the one running: it covers
-- the screen ("out"), changes the scene, then uncovers it ("in").
local style = { kind = "none", seconds = 0.4, color = { 0, 0, 0, 1 } }
local fading = nil -- { phase = "out" | "in", time = 0 }

---Sets how go() and reload() change scenes: transition("fade", 0.4) fades
---to black and back, transition("fade", 0.4, {1, 1, 1}) to white,
---transition("none") cuts.
function scene.transition(kind, seconds, color)
	if kind ~= "none" and kind ~= "fade" then error('transition() takes "fade" or "none"', 2) end
	style.kind = kind
	if seconds then style.seconds = math.max(0, seconds) end
	if color then style.color = { color[1] or 0, color[2] or 0, color[3] or 0, color[4] or 1 } end
end

---True while the scene is about to change or a transition is running.
function scene.isChanging()
	return pending ~= nil or fading ~= nil
end

---Goes to another scene at the end of this frame (or once the transition
---covers the screen). Extra values go to the new scene root's ready(...)
---and stay in smitten.scene.args.
function scene.go(path, ...)
	if type(path) ~= "string" then error("go() needs the path of a .scene file", 2) end
	local args = { ... }
	path = assets.normalize(path)
	if not tree.root then
		scene.args = args
		local ok, err = pcall(function() setRoot(load(path), path, args) end)
		if not ok then error(err, 2) end
		return
	end
	-- Load now, so a missing file is reported where go() was called.
	local ok, root = pcall(load, path)
	if not ok then error(root, 2) end
	pending = { root = root, path = path, args = args }
	if style.kind == "fade" and style.seconds > 0 and not (fading and fading.phase == "out") then
		-- Covering starts from however covered the screen is now.
		local covered = fading and (1 - fading.time / style.seconds) or 0
		fading = { phase = "out", time = covered * style.seconds }
	end
end

---Starts the running scene again from its file.
function scene.reload()
	if scene.path then scene.go(scene.path, unpack(scene.args)) end
end

---Makes a piece the running scene's root (a scene built in code).
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

-- frozen: the game is paused and this piece doesn't run while it is
-- (pieces with pausable = false, and what's inside them, still run).
local function physicsTraverse(n, h, frozen)
	if n._dead then return end
	if frozen and n.pausable == false then frozen = false end
	if not frozen then
		if n._physics then n:_physics(h) end
		local f = n.physicsUpdate
		if f then
			f(n, h)
			local after = n._afterScript
			if after then after(n) end
		end
	end
	local ch = n.children
	for i = 1, #ch do
		local c = ch[i]
		if c then physicsTraverse(c, h, frozen) end
	end
end

local function processTraverse(n, dt, frozen)
	if n._dead then return end
	if frozen and n.pausable == false then frozen = false end
	if not frozen then
		if n._process then n:_process(dt) end
		local f = n.update
		if f then
			f(n, dt)
			local after = n._afterScript
			if after then after(n) end
		end
	end
	local ch = n.children
	for i = 1, #ch do
		local c = ch[i]
		if c then processTraverse(c, dt, frozen) end
	end
end

---True if a piece runs while the game is paused: it, or a piece it's
---inside, has pausable = false.
function scene.runsWhilePaused(n)
	while n do
		if n.pausable == false then return true end
		n = n.parent
	end
	return false
end

local function physicsStep(h)
	tree.dt = h
	tree.epoch = tree.epoch + 1
	local paused = scene.paused
	physicsTraverse(tree.root, h, paused)
	if not paused then
		local systems = tree.systemList
		for i = 1, #systems do
			local s = systems[i]
			if s.step and tree.root then s.step(h) end
		end
	end
	freeNodes()
end

local function changeScene()
	local p = pending
	pending = nil
	scene.args = p.args
	setRoot(p.root, p.path, p.args)
end

-- dt is scaled by timeScale; realDt isn't (transitions use it).
function scene._update(dt, realDt)
	realDt = realDt or dt
	if fading then
		fading.time = fading.time + realDt
		if fading.time >= style.seconds then
			if fading.phase == "out" then
				fading = { phase = "in", time = 0 }
				if pending then changeScene() end
			else
				fading = nil
			end
		end
	end
	if pending and not (fading and fading.phase == "out") then changeScene() end
	if not tree.root then return end
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
	tree.epoch = tree.epoch + 1
	processTraverse(tree.root, dt, scene.paused)
	freeNodes()
	-- UI answers the pointer and the keyboard even while paused.
	if tree.root then require("love.scene.ui").update(tree.root) end
end

---The length of the current step: the frame's dt in update(), the fixed
---step in physicsUpdate().
function scene.getDelta()
	return tree.dt
end

-- Drawing: the world, then UI on top, then the transition's cover.
function scene._draw()
	local root = tree.root
	if root then require("love.scene.nodes2d").render(root) end
	if root then require("love.scene.ui").render(root) end
	if fading then
		local t = style.seconds > 0 and math.min(1, fading.time / style.seconds) or 1
		local a = fading.phase == "out" and t or 1 - t
		local c = style.color
		local d = require("love.display")
		love.graphics.push("all")
		love.graphics.setColor(c[1], c[2], c[3], (c[4] or 1) * a)
		love.graphics.rectangle("fill", d.viewX, d.viewY, d.viewWidth, d.viewHeight)
		love.graphics.pop()
	end
end

---Sends an input event to the tree's UI (called by love.engine).
function scene._uiInput(...)
	if tree.root then require("love.scene.ui").input(tree.root, ...) end
end

return scene
