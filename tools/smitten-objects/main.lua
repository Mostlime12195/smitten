-- Tests for objects, behaviors, smitten.scene.go and the simple API
-- (docs/objects-and-scenes.md). Prints "OBJ PASS ..." / "OBJ FAIL ..." lines,
-- a timing line for 500 objects, and a final "OBJ DONE <passed>/<total>"
-- line, then leaves the arena running.
--
--   python3 tools/test_server.py 8771
--   http://localhost:8771/player.html?game=tools/smitten-objects.love
--
-- Most scene tests drive the running scene by hand with a fixed time step
-- (runner:update(1/60)) from the game's love.update, so they're exact; the
-- input and mouse tests use real frames and pushed events.

local passed, total = 0, 0
local function check(name, ok, detail)
	total = total + 1
	if ok then
		passed = passed + 1
		print("OBJ PASS " .. name)
	else
		print("OBJ FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
	end
end
local function eq(name, got, want)
	check(name, got == want, ("got %s, want %s"):format(tostring(got), tostring(want)))
end
local function near(name, got, want, tolerance)
	check(name, type(got) == "number" and math.abs(got - want) <= (tolerance or 1e-6),
		("got %s, want %s"):format(tostring(got), tostring(want)))
end
local function errors(name, fn, pattern)
	local ok, err = pcall(fn)
	check(name, not ok and tostring(err):find(pattern, 1, true) ~= nil, ok and "no error" or err)
end

local _ = smitten.mouse -- start following the mouse and touches now

local DT = 1 / 60
local function sim(frames, dt)
	local runner = smitten.scene.current()
	for _ = 1, frames do runner:update(dt or DT) end
end
local function bottom(o) return o.y + o.offsetY + o.height end

-------------------------------------------------------------------------------
-- Helpers, palette, saving

near("palette color 1 from the default palette", smitten.palette[1][1], 0x1a / 255)
eq("palette has 16 colors", #smitten.palette, 16)
do
	local r, g, b, a = smitten.color(3)
	check("color by number", math.abs(r - 0xb1 / 255) < 1e-9 and math.abs(g - 0x3e / 255) < 1e-9 and a == 1)
	r, g, b, a = smitten.color("#ff8000", 0.5)
	check("color from hex with alpha", r == 1 and math.abs(g - 128 / 255) < 1e-9 and b == 0 and a == 0.5)
end
errors("color out of range", function() smitten.color(17) end, "the palette has no color 17 (it has 16 colors")
errors("color bad string", function() smitten.color("red") end, "isn't a color")

do
	local ok = true
	for _ = 1, 200 do
		local n = smitten.random(1, 6)
		if n < 1 or n > 6 or n % 1 ~= 0 then ok = false end
	end
	check("random whole numbers in range", ok)
	local f = smitten.random()
	check("random fraction", f >= 0 and f < 1)
	check("chance 0 and 1", smitten.chance(0) == false and smitten.chance(1) == true)
	local list = { "a", "b", "c" }
	local p = smitten.pick(list)
	check("pick", p == "a" or p == "b" or p == "c")
	errors("pick empty", function() smitten.pick({}) end, "the list is empty")
	eq("clamp", smitten.clamp(15, 0, 10), 10)
	eq("lerp", smitten.lerp(10, 20, 0.25), 12.5)
	eq("approach", smitten.approach(5, 10, 2), 7)
	eq("approach doesn't pass", smitten.approach(9, 10, 2), 10)
end

smitten.save("best", 42)
smitten.save("progress", { level = 3, names = { "a", "b" } })
eq("save and load", smitten.load("best", 0), 42)
eq("load default", smitten.load("nothing", 7), 7)
eq("save tables", smitten.load("progress").names[2], "b")
check("saved to a file", love.filesystem.getInfo("smitten-save.json") ~= nil)
smitten.save("best", nil)
eq("save nil forgets", smitten.load("best", "gone"), "gone")

-------------------------------------------------------------------------------
-- The font

do
	local font = smitten.font
	check("font exists", font ~= nil and font:typeOf("Font"))
	local all = {}
	for c = 32, 126 do all[#all + 1] = string.char(c) end
	check("font has every printable ASCII character", font:hasGlyphs(table.concat(all)))
	eq("font height", font:getHeight(), 9)
	eq("textWidth of one character", smitten.textWidth("A"), 5)
	eq("textWidth of two", smitten.textWidth("AB"), 11)
	eq("textWidth of lines is the widest", smitten.textWidth("AB\nABC"), 17)
	local canvas = love.graphics.newCanvas(40, 20, { dpiscale = 1 })
	love.graphics.push("all")
	love.graphics.setCanvas(canvas)
	love.graphics.clear(0, 0, 0, 0)
	smitten.print("T", 2, 3, 13)
	smitten.print("i", 10, 3, "#ff0000", 2)
	love.graphics.pop()
	local img = love.graphics.readbackTexture(canvas)
	local function lit(x, y) local _, _, _, a = img:getPixel(x, y) return a > 0.5 end
	-- T: a full top row, then the middle column.
	check("print draws the glyph", lit(2, 3) and lit(6, 3) and lit(4, 9) and not lit(2, 9) and not lit(7, 3))
	local r, g, b = img:getPixel(4, 3)
	check("print in a palette color", math.abs(r - 0xf4 / 255) < 0.02 and math.abs(b - 0xf4 / 255) < 0.02, r)
	-- i at scale 2: the dot is 2x2 at (10 + 2*2, 3).
	check("print scaled", lit(14, 3) and lit(15, 4) and not lit(14, 5))
	r, g, b = img:getPixel(14, 3)
	check("print in a hex color", r > 0.98 and g < 0.02, r)
	local cr, cg, cb, ca = love.graphics.getColor()
	check("print restores the color", cr == 1 and cg == 1 and cb == 1 and ca == 1)
end

-------------------------------------------------------------------------------
-- Input defaults and direct names (checked over frames below)

eq("default jump binding", table.concat(smitten.input.bindings("jump"), " "), "space z pad:a")
eq("default left binding", table.concat(smitten.input.bindings("left"), " "), "left a pad:dpleft axis:leftx-")
eq("default start binding", smitten.input.bindings("start")[1], "return")
check("direct key name without binding", smitten.input.down("e") == false)
errors("unknown action suggests one", function() smitten.input.pressed("jmup") end, 'no action named "jmup"; did you mean "jump"?')
errors("unknown mouse button", function() smitten.input.bind("fire", { "mouse:side" }) end, "unknown mouse button")
eq("axis at rest", smitten.input.axis("left", "right"), 0)

-------------------------------------------------------------------------------
-- Object definitions

errors("object outside objects/ needs a type", function() smitten.object {} end, "give it a type")
local Spark = smitten.object { type = "spark", color = 4, width = 2, height = 2 }
eq("object with a type", Spark.type, "spark")
errors("unknown behavior", function() smitten.object { type = "bad", behaviors = { "platformr" } } end,
	'there\'s no behavior "platformr"; did you mean "platformer"?')
errors("behavior typo field", function() smitten.object { type = "bad2", behavior = { "platformer" } } end,
	'"behavior" isn\'t a field of objects; did you mean behaviors?')
local Alias = smitten.object { type = "alias", behaviors = { "top-down" } }
eq("behavior alias and defaults", Alias.speed, 80)
errors("spawn before a scene", function() smitten.spawn("coin", 0, 0) end, "no scene is running yet")

-------------------------------------------------------------------------------
-- The steps (one per frame, from the game's love.update)

local steps, frame = {}, 0
function love.update(dt)
	frame = frame + 1
	if steps[frame] then steps[frame]() end
end

-- start() prefers .smitten/start (the editor's Play scene) over smitten.json.
love.filesystem.createDirectory(".smitten")
love.filesystem.write(".smitten/start", "menu\n")
smitten.start()
eq("start uses .smitten/start", smitten.scene.name, "menu")
love.filesystem.remove(".smitten/start")
check("script-only scene", smitten.scene.map == nil and smitten.scene.current().update ~= nil)
eq("find in a scene without objects", smitten.find("coin"), nil)

local arena, hero

steps[1] = function()
	smitten.start()
	eq("start uses smitten.json's start", smitten.scene.name, "arena")
	errors("go to a missing scene", function() smitten.scene.go("arenna") end, 'there\'s no scene "arenna" (no scenes/arenna.scene.json or scenes/arenna.lua); did you mean "arena"?')
	smitten.scene.go("arena", "a", 2)
	arena = smitten.find("hero").scene
	check("go passes arguments to enter", arena.args[1] == "a" and arena.args[2] == 2)
	check("objects exist in enter", arena.heroAtEnter ~= nil)
	eq("scene.name", smitten.scene.name, "arena")
	check("scene.map", smitten.scene.map ~= nil and smitten.scene.map.width == 40)
	hero = smitten.find("hero")
	eq("type from the file name", hero.type, "hero")
	eq("placed x is the sprite origin", hero.x, 40)
	eq("hitbox from the definition", hero.width, 10)
	eq("default hitbox offset: centered", hero.offsetX, -5)
	eq("default hitbox offset: on the bottom", hero.offsetY, -14)
	eq("objects from the scene", #smitten.all("coin"), 2)
	eq("placed properties", smitten.all("coin")[2].value, 2)
	check("definition defaults", smitten.all("coin")[1].value == 1)
	check("create ran", smitten.all("coin")[1].created == true)
	errors("objects without a file are data", function() smitten.find("spawnpoint") end, "objects/spawnpoint.lua doesn't exist")
	eq("data objects stay in the map", #smitten.scene.map:objects("spawnpoint"), 1)
	local zone = smitten.find("zone")
	check("placed size is the hitbox", zone.width == 48 and zone.height == 24 and zone.offsetX == 0)
	errors("find typo", function() smitten.find("coins") end, 'smitten.find("coins"): objects/coins.lua doesn\'t exist; did you mean "coin"?')
	errors("spawn typo", function() smitten.spawn("hreo", 0, 0) end, 'did you mean "hero"?')
	eq("tostring of an object", tostring(hero), "hero at 40, 160")

	-- Platformer: standing on the ground.
	sim(30)
	check("platformer stands on the ground", hero:isOnGround() and bottom(hero) == 160, bottom(hero))
	eq("platformer origin on the ground", hero.y, 160)
	eq("idle animation", hero.anim.name, "idle")
	hero.moveX = 1
	sim(30)
	check("platformer runs", hero.x > 60 and hero.flipX == false and hero.anim.name == "run", hero.x)
	hero.moveX = -1
	sim(5)
	check("platformer turns", hero.flipX == true)
	hero.moveX = 0
	sim(60)
	eq("platformer stops", hero.vx, 0)
	hero:jump()
	sim(1)
	check("platformer jump", hero.vy < 0 and not hero:isOnGround() and hero.anim.name == "jump")
	sim(120)
	check("platformer lands again", hero:isOnGround() and bottom(hero) == 160)

	-- Landing and callbacks.
	local j = smitten.spawn("jumper", 150, 60)
	check("spawn runs behaviors' create", j._coyote == 0)
	sim(1)
	check("falls when spawned in the air", not j:isOnGround())
	sim(90)
	check("lands on the ground", j:isOnGround() and bottom(j) == 160, bottom(j))
	eq("landed() once", j.landings, 1)

	-- Jump buffering: jump pressed a few frames before landing still jumps.
	j.x, j.y, j.vy = 150, 80, 0
	sim(1)
	local framesToLand = 0
	while bottom(j) < 160 - 8 and framesToLand < 200 do
		sim(1)
		framesToLand = framesToLand + 1
	end
	j:jump()
	local before = j.jumps
	sim(20)
	eq("jump buffering", j.jumps, before + 1)
	sim(120)
	-- Without buffering: jump pressed long before landing does nothing.
	j.x, j.y, j.vy = 150, 20, 0
	sim(10) -- (moved by hand from the ground: let the coyote time run out)
	j:jump()
	before = j.jumps
	sim(120)
	check("too-early jump is dropped", j.jumps == before and j:isOnGround(), j.jumps - before)

	-- Coyote time: a jump just after running off a ledge (the platform at
	-- columns 25-28, y 96) still works; a late one doesn't.
	local function offLedge(lateFrames)
		j.x, j.y, j.vx, j.vy = 450, 82, 0, 0
		sim(5)
		j.moveX = 1
		local n = 0
		while j:isOnGround() and n < 200 do
			sim(1)
			n = n + 1
		end
		j.moveX = 0
		sim(lateFrames)
		local jumps = j.jumps
		j:jump()
		sim(2)
		local jumped = j.jumps > jumps
		sim(120)
		return jumped
	end
	check("on the platform", (function() j.x, j.y = 430, 80 sim(30) return bottom(j) == 96 end)())
	check("coyote time", offLedge(2))
	check("no jump long after leaving the ledge", not offLedge(20))
	j:destroy()

	-- Solid objects block platformers (and count as touching).
	local box = smitten.spawn("box", 600, 140)
	local j2 = smitten.spawn("jumper", 610, 100)
	sim(60)
	check("lands on a solid object", j2:isOnGround() and bottom(j2) == 140, bottom(j2))
	box:destroy()
	j2:destroy()
	sim(1)

	-- Top-down: blocked by the wall at column 20 (x 320) and by solid objects.
	local w = smitten.spawn("walker", 280, 130)
	w.moveX = 1
	sim(60)
	eq("topdown stops at a wall", w.x + w.offsetX + w.width, 320)
	w.moveX, w.moveY = -1, -1
	sim(1)
	near("topdown diagonal speed is normalized", w.vx, -80 * math.sqrt(0.5))
	w.x, w.y, w.moveX, w.moveY = 200, 60, 0, 1
	local block = smitten.spawn("box", 190, 100)
	sim(60)
	eq("topdown stops at a solid object", w.y + w.offsetY + w.height, 100)
	w:destroy()
	block:destroy()
	sim(1)

	-- Mover: bounces between the wall and the left edge of a solid object.
	local wall = smitten.spawn("box", 200, 120)
	local b = smitten.spawn("bullet", 250, 125)
	b.vx = 300
	sim(20)
	check("mover bounces off a wall", b.vx < 0 and b.x + b.offsetX + b.width <= 320, b.vx)
	sim(15)
	check("mover bounces off a solid object", b.vx > 0 and b.x + b.offsetX >= 232, b.x)
	b.bounce = false
	b.vx = 300
	sim(60)
	eq("mover without bounce stops", b.vx, 0)
	wall:destroy()
	b.x, b.y, b.vx = 20, 20, -400
	sim(30)
	eq("mover leaving the scene is destroyed", #smitten.all("bullet"), 0)

	-- Touch, untouch, destroy.
	local coins = smitten.all("coin")
	local c1 = coins[1]
	hero.x, hero.y = c1.x + 4, c1.y + 10
	sim(1)
	eq("touch", c1.touches, 1)
	check("touch gets the other object", c1.lastTouched == hero)
	sim(10)
	eq("touch only when it starts", c1.touches, 1)
	hero.x = 20
	sim(1)
	eq("untouch", c1.untouches, 1)
	local c2 = coins[2]
	c2.vanish = true
	hero.x, hero.y = c2.x + 4, c2.y + 10
	sim(1)
	eq("destroy in touch", #smitten.all("coin"), 1)
	eq("destroyed() runs", getmetatable(c2).destroyedCount, 1)
	check("destroyed objects aren't found", smitten.find("coin") == c1)
	hero.x, hero.y = 40, 160
	sim(1)

	-- Spawn and find.
	local c3 = smitten.spawn("coin", 300, 40, { value = 5 })
	check("spawn with properties", c3.value == 5 and c3.created and c3.x == 300)
	eq("all after spawn", #smitten.all("coin"), 2)
	check("overlaps by type", (function()
		c3.x, c3.y = hero.x, hero.y - 4
		return hero:overlaps("coin") == c3 and hero:overlaps(c3) == c3 and hero:overlaps("box") == nil
	end)())
	-- The hero's hitbox center is (x, y - 7); a spark's is (x + 1, y + 1).
	near("distanceTo", smitten.spawn("spark", hero.x + 29, hero.y - 48):distanceTo(hero), 50, 1e-9)
	near("angleTo a point", hero:angleTo(hero.x, hero.y - 7 + 10), math.pi / 2)
	local s = smitten.spawn("spark", 0, 0)
	local count = 0
	while not s:moveTo(30, 40, 60, 0.1) and count < 100 do count = count + 1 end
	eq("moveTo arrives", count, 8)
	check("Class(x, y) spawns", Spark(5, 5).type == "spark")
	sim(1)

	-- Zone: an invisible object with the placed size touches the hero.
	local zone2 = smitten.find("zone")
	hero.x, hero.y = zone2.x + 10, zone2.y + 20
	hero.vy = 0
	sim(1)
	eq("invisible zone touch", zone2.entered, 1)
	hero:respawn()
	check("respawn", hero.x == 40 and hero.y == 160 and hero.vx == 0)
	sim(1)

	-- Tiles with properties.
	hero.x, hero.y = 35 * 16 + 8, 160
	check("touchingTile by property and name", hero:touchingTile("damage") ~= nil and hero:touchingTile("spikes") ~= nil)
	hero.x = 40
	check("not touching a tile", hero:touchingTile("damage") == nil)
	sim(1)

	-- Timers and tweens.
	local fired, every = 0, 0
	local t1 = smitten.after(0.1, function() fired = fired + 1 end)
	local t2 = smitten.every(0.05, function() every = every + 1 end)
	local cancelled = smitten.after(0.05, function() fired = fired + 100 end)
	cancelled:cancel()
	sim(5)
	eq("after waits", fired, 0)
	sim(2)
	eq("after fires once", fired, 1)
	check("every repeats", every >= 2 and every <= 3, every)
	t2:cancel()
	local n = every
	sim(10)
	eq("cancel stops every", every, n)
	check("finished timer is inactive", t1.active == false)
	local box2 = smitten.spawn("box", 100, 20)
	local done = false
	smitten.tween(box2, 0.5, { x = 200, alpha = 0 }, "linear", function() done = true end)
	sim(15)
	near("tween halfway (linear)", box2.x, 150, 1e-6)
	sim(16)
	check("tween ends at the value and calls done", box2.x == 200 and box2.alpha == 0 and done)
	smitten.tween(box2, 0.5, { y = 120 }, "outBack")
	sim(15)
	check("tween easing outBack overshoots midway", box2.y > 20 + 100 * 0.5)
	sim(30)
	eq("tween easing ends exactly", box2.y, 120)
	errors("tween unknown easing", function() smitten.tween(box2, 1, { x = 1 }, "outBonce") end, 'did you mean "outBounce"?')
	errors("tween missing field", function() smitten.tween(box2, 1, { health = 1 }) end, "can't tween \"health\"")
	box2:destroy()
	sim(1)

	-- Camera.
	local cam = smitten.camera
	eq("camera follows (camera = true) inside the bounds", cam.x, 0)
	hero.x, hero.y = 400, 160
	sim(1)
	near("camera centers on the hero", cam.x, 400 - 160)
	near("camera y stays inside the scene", cam.y, 12)
	hero.x = 630
	sim(1)
	eq("camera stops at the right edge", cam.x, 640 - 320)
	cam.bounds = false
	hero.x, hero.y = 20, 160
	sim(1)
	near("camera without bounds", cam.x, 20 - 160)
	cam.bounds = true
	sim(1)
	cam.shake(6, 0.5)
	sim(1)
	local tx = require("smitten.camera").translation()
	local shook = false
	for _ = 1, 10 do
		sim(1)
		local x = require("smitten.camera").translation()
		if x ~= -math.floor(cam.x + 0.5) then shook = true end
	end
	check("shake moves the picture", shook and cam.x == 0, tx)
	sim(40)
	eq("shake ends", require("smitten.camera").translation(), 0)

	-- Drawing: background, sprite, placeholder box, draw order.
	hero.x, hero.y = 40, 160
	sim(1)
	smitten.spawn("top", 100, 100)
	smitten.spawn("box", 96, 96).layer = 0
	smitten.scene.current():draw()
	local img = love.graphics.readbackTexture(smitten.screen.canvas)
	local function color(x, y) return { img:getPixel(x, y) } end
	local function is(name, c, hex)
		local r, g, b = smitten.color(hex)
		check(name, math.abs(c[1] - r) < 0.02 and math.abs(c[2] - g) < 0.02 and math.abs(c[3] - b) < 0.02,
			("%.2f %.2f %.2f"):format(c[1], c[2], c[3]))
	end
	local camY = smitten.camera.y
	is("background from the scene file", color(5, 50), "#29366f")
	is("tiles drawn", color(5, 165 - camY), "#566c86")
	is("sprite drawn with its origin at x, y", color(40, 155 - camY), "#b13e53")
	is("missing sprite draws a box", color(205, 105 - camY), getmetatable(smitten.find("ghost"))._boxColor)
	is("higher layer draws on top", color(102, 102 - camY), 3)
	is("color objects draw their box", color(120, 100 - camY), 9)
	is("scene script draws text on top", color(5, 6), 13)

	-- Scene change ends the scene's timers.
	local late = false
	smitten.after(0.05, function() late = true end)
	local moved = smitten.find("coin")
	smitten.tween(moved, 1, { x = 0 })
	smitten.scene.go("menu")
	check("leave() runs", arena.left == true)
	eq("go switches scenes", smitten.scene.name, "menu")
	eq("old objects are gone", #smitten.all(), 0)
	sim(10)
	check("timers end with their scene", not late)
	check("background of a script-only scene", (function()
		smitten.scene.current():draw()
		local c = { love.graphics.readbackTexture(smitten.screen.canvas):getPixel(1, 1) }
		local r, g, b = smitten.color(2)
		return math.abs(c[1] - r) < 0.02 and math.abs(c[3] - b) < 0.02
	end)())

	-- Restart: everything comes back from the file.
	smitten.scene.go("arena", "again")
	smitten.scene.map:setTile("ground", 0, 10, -1)
	smitten.find("coin"):destroy()
	sim(1)
	smitten.scene.restart()
	eq("restart recreates objects", #smitten.all("coin"), 2)
	eq("restart reloads the map", smitten.scene.map:getTile("ground", 0, 10), 0)
	eq("restart keeps the arguments", smitten.find("hero").scene.args[1], "again")
	hero = smitten.find("hero")

	-- Deferred go: called during the scene's update, it happens at the end.
	local Scene = smitten.find("hero").scene
	function Scene:update() smitten.scene.go("menu") self.stillHere = smitten.scene.name end
	sim(1)
	check("go during update waits for the end of the frame", Scene.stillHere == "arena" and smitten.scene.name == "menu")
	smitten.scene.go("arena")
	hero = smitten.find("hero")
end

-- Real frames: timers outside scenes, input by events, the mouse.
local sceneTimer = false
steps[2] = function()
	smitten.after(0, function() sceneTimer = true end)
	love.event.push("keypressed", "space", "space", false)
	love.event.push("keypressed", "e", "e", false)
	love.event.push("keypressed", "k", "k", false)
	-- A touch at window (320, 180): game (160, 90) at scale 2.
	love.event.push("touchpressed", 1, 320, 180, 0, 0, 1)
end
steps[3] = function()
	check("scene timers advance in real frames", sceneTimer)
	check("default action pressed", smitten.input.pressed("jump") and smitten.input.pressed("a"))
	check("direct key name pressed", smitten.input.pressed("e"))
	check("first press of a key never asked about", smitten.input.pressed("k"))
	eq("scene script gets keypressed", smitten.find("hero").scene.lastKey, "k")
	near("mouse x in game pixels (touch)", smitten.mouse.x, 160)
	near("mouse y in game pixels", smitten.mouse.y, 90)
	near("mouse worldX through the camera", smitten.mouse.worldX, 160 + smitten.camera.x)
	near("mouse worldY through the camera", smitten.mouse.worldY, 90 + smitten.camera.y)
	check("touch is mouse button 1", smitten.mouse.down() and smitten.mouse.pressed(1) and not smitten.mouse.down(2))
	local z = smitten.find("zone")
	z.x, z.y = smitten.mouse.worldX - 5, smitten.mouse.worldY - 5
	check("mouse over an object", smitten.mouse.over(z) and not smitten.mouse.over(smitten.find("hero")))
	errors("mouse button check", function() smitten.mouse.down(9) end, "buttons are 1")
	love.event.push("touchreleased", 1, 320, 180, 0, 0, 1)
	love.event.push("keyreleased", "e", "e")
end
steps[4] = function()
	check("released after touch ends", smitten.mouse.released(1) and not smitten.mouse.down(1))
	check("direct key released", smitten.input.released("e") and not smitten.input.pressed("e"))
	check("pressed lasts one frame", not smitten.input.pressed("jump"))

	-- 500 objects: movers bouncing around the arena, half of them listening
	-- for touches, all drawn.
	smitten.scene.go("arena")
	for i = 1, 500 do
		local b = smitten.spawn(i % 2 == 0 and "ball" or "coin", 20 + (i * 37) % 600, 20 + (i * 53) % 130)
		if b.type == "ball" then b.vx, b.vy = smitten.random(-120, 120), smitten.random(-120, 120) end
	end
	local runner = smitten.scene.current()
	runner:update(DT)
	local t0 = love.timer.getTime()
	local frames = 120
	for _ = 1, frames do runner:update(DT) end
	local t1 = love.timer.getTime()
	for _ = 1, frames do
		runner:draw()
	end
	love.graphics.present()
	local t2 = love.timer.getTime()
	local up, dr = (t1 - t0) / frames * 1000, (t2 - t1) / frames * 1000
	print(("OBJ TIME 500 objects (%d): update %.2f ms, draw %.2f ms per frame"):format(#smitten.all(), up, dr))
	check("500 objects update in under 8 ms", up < 8, up)
	smitten.scene.go("arena")
	print(("OBJ DONE %d/%d"):format(passed, total))
end
