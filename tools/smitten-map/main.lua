-- Tests for smitten.map, smitten.tileset, smitten.collide, smitten.scene and
-- smitten.input. Prints "MAP PASS ..." / "MAP FAIL ..." lines and a final
-- "MAP DONE <passed>/<total>" line, then becomes a small platformer:
-- arrows or A/D to run, Space/Up/W to jump, P to pause (a pushed scene).
--
--   python3 tools/test_server.py 8772
--   http://localhost:8772/player.html?game=tools/smitten-map.love

local passed, total = 0, 0
local function check(name, ok, detail)
	total = total + 1
	if ok then
		passed = passed + 1
		print("MAP PASS " .. name)
	else
		print("MAP FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end
local function eq(name, got, want)
	check(name, got == want, ("got %s, want %s"):format(tostring(got), tostring(want)))
end
local function errors(name, fn, pattern)
	local ok, err = pcall(fn)
	check(name, not ok and tostring(err):find(pattern, 1, true) ~= nil, ok and "no error" or err)
end

-------------------------------------------------------------------------------
-- Map and tileset loading

local level = smitten.map("maps/test")
eq("map cached", smitten.map("maps/test.map.json"), level)
eq("map width", level.width, 100)
eq("map pixelWidth", level.pixelWidth, 1600)
eq("map pixelHeight", level.pixelHeight, 192)
eq("map properties", level.properties.title, "Test level")
eq("map background", level.background, "#1a1c2c")
check("map backgroundColor", math.abs(level.backgroundColor[1] - 0x1a / 255) < 1e-9)
eq("two tilesets", #level.tilesets, 2)
local a = smitten.tileset("tiles/a")
eq("tileset cached and shared with the map", level.tilesets[1], a)
eq("tileset a count", a.count, 8)
eq("tileset b count", level.tilesets[2].count, 2)
eq("tile count across tilesets", level.tileCount, 10)
check("tileset quad", a:quad(5) ~= nil and a:quad(8) == nil)
eq("tileset properties", a:properties(1).name, "grass")
-- The map editor's new tilesets: a transparent 1-bit indexed PNG.
eq("editor's blank tileset loads", smitten.tileset("tiles/blank").count, 32)
check("tileset properties empty", next(a:properties(2)) == nil)

eq("getTile ground", level:getTile("ground", 0, 10), 1)
eq("getTile by index", level:getTile(1, 0, 11), 0)
eq("getTile empty", level:getTile("ground", 0, 0), -1)
eq("getTile outside", level:getTile("ground", -1, 0), -1)
eq("getTile far outside", level:getTile("ground", 100, 0), -1)
local ts, localTile = level:tilesetOf(9)
check("tile numbers continue across tilesets", ts == level.tilesets[2] and localTile == 1)
eq("tileProperties from the second tileset", level:tileProperties(9).damage, 1)
check("tileProperties empty", next(level:tileProperties(3)) == nil)
check("tileProperties of -1", next(level:tileProperties(-1)) == nil)

check("isSolid ground", level:isSolid(5, 10 * 16 + 1))
check("isSolid air", not level:isSolid(5, 5))
check("isSolid hidden layer counts", level:isSolid(50 * 16 + 8, 5 * 16 + 8))
check("isSolid non-solid tile", not level:isSolid(40 * 16 + 8, 9 * 16 + 8))
check("isSolid outside", not level:isSolid(-5, 170))

eq("objects all", #level:objects(), 4)
eq("objects by type", #level:objects("coin"), 2)
eq("object properties", level:objects("coin")[1].properties.value, 5)
eq("object layer name", level:objects("sign")[1].layer, "objects")

local Coin = {}
Coin.__index = Coin
function Coin.new(o) return setmetatable({ x = o.x, value = o.properties.value }, Coin) end
local made = level:spawn({ coin = Coin, sign = function(o) return { text = o.properties.text } end })
eq("spawn count", #made, 3)
check("spawn class.new", getmetatable(made[1]) == Coin and made[1].value == 5)
eq("spawn function", made[3].text, "hi")

errors("unknown layer error", function() level:getTile("nope", 0, 0) end, 'no layer nope (it has "ground", "decor", "objects")')
errors("object layer as tile layer", function() level:getTile("objects", 0, 0) end, "object layer")
errors("missing map error", function() smitten.map("maps/missing") end, 'can\'t find "maps/missing"')
errors("setTile range error", function() level:setTile("ground", 0, 0, 10) end, "0 to 9")
errors("setTile outside error", function() level:setTile("ground", 100, 0, 1) end, "outside")

-------------------------------------------------------------------------------
-- Drawing: chunks, culling and setTile

local A = { { 200, 60, 60 }, { 60, 180, 80 }, { 70, 90, 200 }, { 220, 200, 60 }, { 160, 90, 40 } }
local B = { { 250, 250, 250 }, { 250, 140, 0 } }
local function colorOf(c) return c[1] / 255, c[2] / 255, c[3] / 255 end

local canvas = love.graphics.newCanvas(320, 192, { dpiscale = 1 })
local function render(camera)
	love.graphics.push("all")
	love.graphics.setCanvas(canvas)
	love.graphics.clear(0, 0, 0, 0)
	love.graphics.origin()
	love.graphics.translate(-camera, 0)
	level:draw()
	love.graphics.pop()
	return love.graphics.readbackTexture(canvas)
end
local function pixelIs(name, img, x, y, rgb)
	local r, g, b, al = img:getPixel(x, y)
	local wr, wg, wb = colorOf(rgb)
	check(name, math.abs(r - wr) < 0.02 and math.abs(g - wg) < 0.02 and math.abs(b - wb) < 0.02 and al > 0.99,
		("pixel %d,%d is %.2f %.2f %.2f %.2f"):format(x, y, r, g, b, al))
end
local function transparent(name, img, x, y)
	local _, _, _, al = img:getPixel(x, y)
	check(name, al == 0, ("alpha %.2f"):format(al))
end

local img = render(0)
pixelIs("draw ground tile", img, 8, 10 * 16 + 8, A[2])
pixelIs("draw bottom tile", img, 8, 11 * 16 + 8, A[1])
transparent("draw empty cell", img, 8, 8)
transparent("hidden layer not drawn", img, 3 * 16 + 8, 9 * 16 + 8)
pixelIs("draw platform", img, 12 * 16 + 8, 6 * 16 + 8, A[5])

-- Only the chunks in view are drawn: a 320-pixel view at the start of a
-- 1600-pixel map touches one 32-tile chunk column.
love.graphics.setCanvas(canvas)
local before = love.graphics.getStats().drawcalls
level:draw()
local oneView = love.graphics.getStats().drawcalls - before
love.graphics.push()
love.graphics.scale(0.2) -- the whole map fits: every chunk is drawn
before = love.graphics.getStats().drawcalls
level:draw()
local wholeMap = love.graphics.getStats().drawcalls - before
love.graphics.pop()
love.graphics.setCanvas()
check("culling draws fewer chunks", oneView >= 1 and wholeMap > oneView, ("%d in view, %d whole"):format(oneView, wholeMap))

-- setTile in a chunk that's already built: same tileset, other tileset, empty.
level:setTile("ground", 2, 3, 2)
level:setTile("ground", 3, 3, 8)
level:setTile("ground", 0, 10, -1)
level:setTile("ground", 4, 10, 3)
eq("setTile then getTile", level:getTile("ground", 2, 3), 2)
img = render(0)
pixelIs("setTile same tileset (new cell)", img, 2 * 16 + 8, 3 * 16 + 8, A[3])
pixelIs("setTile other tileset (new cell)", img, 3 * 16 + 8, 3 * 16 + 8, B[1])
transparent("setTile -1 clears", img, 8, 10 * 16 + 8)
pixelIs("setTile replaces in place", img, 4 * 16 + 8, 10 * 16 + 8, A[4])
level:setTile("ground", 4, 10, 9)
level:setTile("ground", 0, 10, 1)
img = render(0)
pixelIs("setTile switches tileset", img, 4 * 16 + 8, 10 * 16 + 8, B[2])
pixelIs("setTile refills a cleared cell", img, 8, 10 * 16 + 8, A[2])
-- A chunk that hasn't been drawn yet picks up changes when it's built.
level:setTile("ground", 90, 3, 2)
img = render(1600 - 320)
pixelIs("setTile before the chunk is built", img, 90 * 16 + 8 - (1600 - 320), 3 * 16 + 8, A[3])
pixelIs("draw with camera", img, 8, 10 * 16 + 8, A[2])
-- Put things back for the collision tests.
level:setTile("ground", 2, 3, -1)
level:setTile("ground", 3, 3, -1)
level:setTile("ground", 4, 10, 1)
level:setTile("ground", 90, 3, -1)

local hidden = level:layer("decor")
hidden.visible = true
img = render(0)
pixelIs("showing a hidden layer", img, 3 * 16 + 8, 9 * 16 + 8, B[1])
hidden.visible = false

-------------------------------------------------------------------------------
-- Collision

check("overlaps", smitten.collide.overlaps({ x = 0, y = 0, width = 10, height = 10 }, { x = 5, y = 5, width = 10, height = 10 }))
check("touching isn't overlapping",
	not smitten.collide.overlaps({ x = 0, y = 0, width = 10, height = 10 }, { x = 10, y = 0, width = 10, height = 10 }))

-- Ground is the row at y = 160.
local box = { x = 40, y = 100, width = 12, height = 14 }
local hit = smitten.collide.move(level, box, 0, 1000)
check("fast fall lands on the ground", hit.y and hit.ground and box.y == 160 - 14, box.y)
hit = smitten.collide.move(level, box, 0, 0.5)
check("resting box stays on the ground", hit.ground and box.y == 160 - 14, box.y)
hit = smitten.collide.move(level, box, 37.5, 0)
check("sliding along the ground isn't blocked", not hit.x and box.x == 77.5, box.x)
hit = smitten.collide.move(level, box, 0, -3)
check("moving up off the ground", not hit.y and box.y == 160 - 17, box.y)

-- The wall is column 30 (x 480..496), rows 5..9.
box = { x = 400, y = 140, width = 12, height = 14 }
hit = smitten.collide.move(level, box, 15.9, 0) -- just under a tile per step
for _ = 1, 10 do hit = smitten.collide.move(level, box, 15.9, 0) end
check("walking into a wall stops at it", hit.x and box.x == 480 - 12, box.x)
box = { x = 400, y = 140, width = 12, height = 14 }
hit = smitten.collide.move(level, box, 500, 0)
check("no tunneling through a thin wall", hit.x and box.x == 480 - 12, box.x)
box = { x = 600, y = 140, width = 12, height = 14 }
hit = smitten.collide.move(level, box, -500, 0)
check("no tunneling moving left", hit.x and box.x == 496, box.x)
box = { x = 480 - 12, y = 40, width = 12, height = 14 }
hit = smitten.collide.move(level, box, 0, 200)
check("falling along a wall isn't blocked by it", hit.ground and not hit.x and box.y == 160 - 14 and box.x == 468, box.y)

-- Platform: columns 12..17 at row 6 (y 96..112).
box = { x = 210, y = 130, width = 12, height = 14 }
hit = smitten.collide.move(level, box, 0, -100)
check("ceiling", hit.ceiling and box.y == 112, box.y)
-- Corner: moving diagonally into the platform's top-left corner from above-left.
box = { x = 12 * 16 - 14, y = 96 - 16, width = 12, height = 14 }
hit = smitten.collide.move(level, box, 6, 6)
check("diagonal onto a corner lands on top", hit.ground and not hit.x and box.y == 96 - 14 and box.x == 12 * 16 - 8, ("%s %s"):format(box.x, box.y))
box = { x = 12 * 16 - 14, y = 100, width = 12, height = 10 }
hit = smitten.collide.move(level, box, 6, 1)
check("diagonal into a side stops x", hit.x and not hit.y and box.x == 12 * 16 - 12 and box.y == 101, ("%s %s"):format(box.x, box.y))

-- Fractional sizes: pushing into a wall repeatedly doesn't jitter.
box = { x = 440.25, y = 140.5, width = 12.3, height = 13.7 }
for _ = 1, 20 do smitten.collide.move(level, box, 3.3, 1) end
local xs = box.x
smitten.collide.move(level, box, 3.3, 1)
check("fractional box rests against the wall", box.x == xs and math.abs(box.x + box.width - 480) < 1e-9, box.x)
hit = smitten.collide.move(level, box, -2, 1)
check("and can move away", not hit.x and math.abs(box.x - (xs - 2)) < 1e-9, box.x)

-- Outside the map nothing is solid.
box = { x = -50, y = -100, width = 10, height = 10 }
hit = smitten.collide.move(level, box, -1000, -1000)
check("outside the map", not hit.x and not hit.y and box.x == -1050, box.x)

errors("collide.move needs a map", function() smitten.collide.move({}, box, 1, 1) end, "expected a map")

-------------------------------------------------------------------------------
-- Scenes and input, checked over several frames from love.update.

local log = {}
local function note(s) log[#log + 1] = s end

-- The game's own callbacks, some defined before the first scene and some after.
local frame, steps = 0, {}
function love.update(dt)
	note("game.update")
	frame = frame + 1
	if steps[frame] then steps[frame]() end
end

smitten.input.bind("jump", { "space", "up", "w", "pad:a" })
smitten.input.bind("left", { "left", "a", "pad:dpleft", "axis:leftx-" })
smitten.input.bind("right", { "right", "d", "pad:dpright", "axis:leftx+" })
smitten.input.bind("pause", { "p", "pad:start" })
errors("input unknown key", function() smitten.input.bind("x", { "jumpkey" }) end, 'unknown key "jumpkey"')
errors("input unknown button", function() smitten.input.bind("x", { "pad:z" }) end, 'unknown gamepad button "z"')
errors("input unknown axis", function() smitten.input.bind("x", { "axis:up+" }) end, "axis:<axis>+")
errors("input unknown action", function() smitten.input.pressed("jmp") end, 'no action named "jmp"')
eq("input bindings", table.concat(smitten.input.bindings("jump"), " "), "space up w pad:a")

local Probe = { name = "probe" }
function Probe:enter(arg) note("probe.enter " .. tostring(arg)) end
function Probe:update(dt) note("probe.update") end
function Probe:draw() note("probe.draw") end
function Probe:keypressed(key) note("probe.keypressed " .. key) end
function Probe:leave() note("probe.leave") end
function Probe:resume(arg) note("probe.resume " .. tostring(arg)) end
function Probe:pause() note("probe.pause") end
function Probe:mousepressed() note("probe.mousepressed") end

local Overlay = { transparent = true }
function Overlay:update() note("overlay.update") end
function Overlay:draw() note("overlay.draw") end
function Overlay:leave() note("overlay.leave") end

smitten.scene.switch(Probe, 42)
eq("scene enter args", log[#log], "probe.enter 42")
eq("scene current", smitten.scene.current(), Probe)

-- Defined after the first scene: still runs, before the scene's.
function love.draw() note("game.draw") end
function love.keypressed(key) note("game.keypressed " .. key) end
-- A library wrapping a callback the usual way: the scene runs once.
local oldMouse = love.mousepressed
love.mousepressed = function(...)
	if oldMouse then oldMouse(...) end
	note("lib.mousepressed")
end
check("callbacks exist while scenes handle them", love.update ~= nil and love.draw ~= nil)
check("unhandled callbacks stay nil", love.textedited == nil)

local function logged(s)
	for _, l in ipairs(log) do if l == s then return true end end
	return false
end
local function index(s)
	for i, l in ipairs(log) do if l == s then return i end end
	return nil
end

local Game -- the platformer, below

-- Each step runs in the game's love.update, before the scene's update; events
-- pushed in one step are handled at the start of the next frame.
steps[1] = function() end
steps[2] = function()
	check("game update runs first", (index("game.update") or 99) < (index("probe.update") or 0))
	love.event.push("keypressed", "space", "space", false)
	love.event.push("mousepressed", 1, 1, 1, false, 1)
end
steps[3] = function()
	check("input pressed after a key event", smitten.input.pressed("jump"))
	check("input down counts a tap for its frame", smitten.input.down("jump"))
	check("game keypressed then scene keypressed",
		(index("game.keypressed space") or 99) < (index("probe.keypressed space") or 0))
	local n, lib = 0, 0
	for _, l in ipairs(log) do
		if l == "probe.mousepressed" then n = n + 1 end
		if l == "lib.mousepressed" then lib = lib + 1 end
	end
	check("wrapped library callback runs, then the scene once", lib == 1 and n == 1
		and index("lib.mousepressed") < index("probe.mousepressed"), ("%d %d"):format(lib, n))
	check("draw: game then scene", (index("game.draw") or 99) < (index("probe.draw") or 0))
end
steps[4] = function()
	check("input pressed resets the next frame", not smitten.input.pressed("jump") and not smitten.input.released("jump"))
	check("input down follows the keyboard after the tap", not smitten.input.down("jump"))
	love.event.push("keyreleased", "space", "space")
	love.event.push("keypressed", "space", "space", true) -- a key repeat
end
steps[5] = function()
	check("input released after a key event", smitten.input.released("jump"))
	check("key repeats aren't presses", not smitten.input.pressed("jump"))
	log = {}
	smitten.scene.push(Overlay)
	check("push pauses the scene below", logged("probe.pause"))
end
steps[6] = function()
	check("pushed scene updates, the one below doesn't", logged("overlay.update") and not logged("probe.update"))
	check("transparent scene draws the one below", (index("probe.draw") or 99) < (index("overlay.draw") or 0))
	log = {}
	smitten.scene.pop("back")
	check("pop leaves and resumes", logged("overlay.leave") and logged("probe.resume back"))
	errors("pop the last scene", function() smitten.scene.pop() end, "no scene below")
end
steps[7] = function()
	check("after pop the scene updates again", logged("probe.update") and not logged("overlay.update"))
	-- Hand over to the platformer: the game's callbacks are removed.
	love.update, love.draw, love.keypressed, love.mousepressed = nil, nil, nil, nil
	smitten.scene.switch(Game)
	check("switch leaves the old scene", logged("probe.leave"))
	check("scenes alone keep love.update and love.draw", love.update ~= nil and love.draw ~= nil)
	print(("MAP DONE %d/%d"):format(passed, total))
end


-------------------------------------------------------------------------------
-- The platformer

local Player = {}
Player.__index = Player
function Player.new(o)
	return setmetatable({ x = o.x + 2, y = o.y + 2, width = 12, height = 14, vx = 0, vy = 0, onGround = false }, Player)
end
function Player:update(dt)
	local dir = (smitten.input.down("right") and 1 or 0) - (smitten.input.down("left") and 1 or 0)
	self.vx = dir * 90
	if smitten.input.pressed("jump") and self.onGround then self.vy = -260 end
	self.vy = math.min(self.vy + 700 * dt, 400)
	local hit = smitten.collide.move(Game.level, self, self.vx * dt, self.vy * dt)
	if hit.y then self.vy = 0 end
	self.onGround = hit.ground
	if self.y > Game.level.pixelHeight then self.x, self.y = 34, 100 end
end
function Player:draw()
	love.graphics.setColor(1, 0.8, 0.3)
	love.graphics.rectangle("fill", math.floor(self.x), math.floor(self.y), self.width, self.height)
end

local Paused = { transparent = true }
function Paused:draw()
	love.graphics.setColor(0, 0, 0, 0.5)
	love.graphics.rectangle("fill", 0, 0, love.graphics.getDimensions())
	love.graphics.setColor(1, 1, 1)
	love.graphics.print("Paused (P to go on)", 20, 20)
end
function Paused:update()
	if smitten.input.pressed("pause") then smitten.scene.pop() end
end

Game = {}
function Game:enter()
	self.level = level
	self.player = level:spawn({ player = Player })[1]
	self.camera = 0
end
function Game:update(dt)
	if smitten.input.pressed("pause") then return smitten.scene.push(Paused) end
	self.player:update(dt)
	local w = love.graphics.getWidth() / 2
	self.camera = math.max(0, math.min(self.player.x - w / 2, level.pixelWidth - w))
end
function Game:draw()
	love.graphics.clear(level.backgroundColor)
	love.graphics.push()
	love.graphics.scale(2)
	love.graphics.translate(-math.floor(self.camera), 0)
	love.graphics.setColor(1, 1, 1)
	level:draw()
	self.player:draw()
	love.graphics.pop()
	love.graphics.setColor(1, 1, 1)
	love.graphics.print(("MAP %d/%d   x %.1f  y %.1f  %s"):format(passed, total, self.player.x, self.player.y,
		self.player.onGround and "ground" or "air"), 8, 8)
end
