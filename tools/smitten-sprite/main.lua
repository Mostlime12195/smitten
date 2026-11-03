-- Tests for smitten.sprite and smitten.screen. Prints "SPRITE PASS ..." /
-- "SPRITE FAIL ..." lines and a final "SPRITE DONE <passed>/<total>" line,
-- then shows a small demo: an animated figure at 160x90 (smitten.json's
-- resolution), scaled up by smitten.screen. Left/right run, Space flips the
-- direction, the mouse shows game coordinates.
--
--   python3 tools/test_server.py 8772
--   http://localhost:8772/player.html?game=tools/smitten-sprite.love

local passed, total = 0, 0
local function check(name, ok, detail)
	total = total + 1
	if ok then
		passed = passed + 1
		print("SPRITE PASS " .. name)
	else
		print("SPRITE FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end
local function eq(name, got, want)
	check(name, got == want, ("got %s, want %s"):format(tostring(got), tostring(want)))
end
local function near(name, got, want)
	check(name, math.abs(got - want) < 1e-6, ("got %s, want %s"):format(tostring(got), tostring(want)))
end
local function errors(name, fn, ...)
	local ok, err = pcall(fn)
	local good = not ok
	for _, pattern in ipairs({ ... }) do
		good = good and tostring(err):find(pattern, 1, true) ~= nil
	end
	check(name, good, ok and "no error" or err)
end

-- Draws fn() into a canvas and returns the color at (x, y) as 0-255 values.
local function pixelAfter(w, h, fn, x, y)
	local canvas = love.graphics.newCanvas(w, h, { dpiscale = 1 })
	love.graphics.push("all")
	love.graphics.setCanvas(canvas)
	love.graphics.clear(0, 0, 0, 0)
	love.graphics.origin()
	fn()
	love.graphics.pop()
	local data = love.graphics.readbackTexture(canvas)
	local r, g, b, a = data:getPixel(x, y)
	local function b8(v) return math.floor(v * 255 + 0.5) end
	return b8(r), b8(g), b8(b), b8(a)
end
local function colorAt(...)
	local r, g, b, a = pixelAfter(...)
	return ("%d,%d,%d,%d"):format(r, g, b, a)
end

local RED, GREEN, BLUE, YELLOW, WHITE, NONE = "255,0,0,255", "0,255,0,255", "0,0,255,255", "255,255,0,255", "255,255,255,255", "0,0,0,0"

-------------------------------------------------------------------------------
-- Loading

local hero = smitten.sprite("sprites/hero")
eq("loaded through require too", require("smitten").sprite("sprites/hero"), hero)
eq("cached by .png path", smitten.sprite("sprites/hero.png"), hero)
eq("cached by .sprite.json path", smitten.sprite("sprites/hero.sprite.json"), hero)
eq("cached with ./ prefix", smitten.sprite("./sprites/hero"), hero)
eq("width", hero.width, 8)
eq("height", hero.height, 8)
eq("frameCount", hero.frameCount, 4)
eq("columns", hero.columns, 2)
eq("originX", hero.originX, 2)
eq("originY", hero.originY, 8)
eq("image width", hero.image:getWidth(), 16)
eq("nearest filtering", select(1, hero.image:getFilter()), "nearest")
eq("nearest mag filtering", select(2, hero.image:getFilter()), "nearest")
check("has idle", hero:has("idle"))
check("has no jump", not hero:has("jump"))
eq("animation names", table.concat(hero:animationNames(), ","), "defaults,idle,once,run")
eq("fps default", hero.animations.defaults.fps, 8)
eq("loop default", hero.animations.defaults.loop, true)
eq("run loops by default", hero.animations.run.loop, true)

local single = smitten.sprite("sprites/single.png")
eq("png alone: one frame", single.frameCount, 1)
eq("png alone: frame width", single.width, 5)
eq("png alone: frame height", single.height, 3)
eq("png alone: origin", single.originX + single.originY, 0)
check("png alone: no animations", not single:has("idle"))

local strip = smitten.sprite("sprites/strip")
eq("image path relative to the .sprite.json", strip.imagePath, "art/strip.png")
eq("strip frames", strip.frameCount, 3)

-- Exact colors survive (the PNG decoder doesn't premultiply).
local semi = love.image.newImageData("sprites/semi.png")
do
	local r, g, b, a = semi:getPixel(0, 0)
	check("semi-transparent pixel kept", math.floor(r * 255 + 0.5) == 10 and math.floor(g * 255 + 0.5) == 20
		and math.floor(b * 255 + 0.5) == 30 and math.floor(a * 255 + 0.5) == 128, ("%g %g %g %g"):format(r, g, b, a))
end

-------------------------------------------------------------------------------
-- Quads and drawing

do
	local x, y, w, h = hero:quad(3):getViewport()
	eq("quad 3 viewport", ("%d,%d,%d,%d"):format(x, y, w, h), "8,8,8,8")
	x, y = hero:quad(1):getViewport()
	eq("quad 1 viewport", ("%d,%d"):format(x, y), "8,0")
	eq("quads cached", hero:quad(2), hero:quad(2))
end

-- Frame 3 is yellow with a white top-left pixel. Drawn at (10, 10) with the
-- origin (2, 8), its top left lands at (8, 2).
eq("draw: origin at (x, y)", colorAt(20, 20, function() hero:draw(3, 10, 10) end, 8, 2), WHITE)
eq("draw: rest of the frame", colorAt(20, 20, function() hero:draw(3, 10, 10) end, 12, 6), YELLOW)
eq("draw: outside the frame", colorAt(20, 20, function() hero:draw(3, 10, 10) end, 7, 2), NONE)
eq("draw: frame 0", colorAt(20, 20, function() hero:draw(0, 10, 10) end, 9, 5), RED)
eq("draw: frame 2", colorAt(20, 20, function() hero:draw(2, 10, 10) end, 9, 5), BLUE)
-- Flipped: the origin stays at (10, 10), so the frame covers x 4..11 and the
-- white pixel (top left of the frame) is at x = 11.
eq("draw: negative sx flips around the origin", colorAt(20, 20, function() hero:draw(3, 10, 10, 0, -1, 1) end, 11, 2), WHITE)
eq("draw: flipped covers left of the origin", colorAt(20, 20, function() hero:draw(3, 10, 10, 0, -1, 1) end, 4, 2), YELLOW)
eq("draw: scale 2", colorAt(40, 40, function() hero:draw(3, 10, 20, 0, 2) end, 7, 5), WHITE)
eq("draw: explicit ox, oy", colorAt(20, 20, function() hero:draw(3, 0, 0, 0, 1, 1, 0, 0) end, 0, 0), WHITE)

-------------------------------------------------------------------------------
-- Animation timing

do
	local a = hero:animation("idle")
	eq("idle starts at its first frame", a.frame, 0)
	eq("name", a.name, "idle")
	a:update(0.24)
	eq("idle before 1/4 s", a.frame, 0)
	a:update(0.02)
	eq("idle after 1/4 s", a.frame, 1)
	a:update(0.25)
	eq("idle loops", a.frame, 0)
	check("looping never finishes", not a.finished)
	a:update(2.6) -- 10 more steps and a bit: back on frame 0
	eq("large dt", a.frame, 0)

	local b = hero:animation("idle")
	check("animations are independent", b ~= a and b.frame == 0)

	local run = hero:animation("run")
	eq("run frame 0", run.frame, 2)
	run:update(0.35) -- 3 steps of 0.1 s through [2, 3, 1] -> back to the first
	eq("run wraps", run.frame, 2)
	run:update(0.1)
	eq("run step", run.frame, 3)

	local once = hero:animation("once")
	once:update(0.25)
	eq("once mid", once.frame, 2)
	check("once not finished on its last frame", not once.finished)
	once:update(0.1)
	check("once finished", once.finished)
	eq("once holds the last frame", once.frame, 2)
	once:update(1)
	eq("once stays", once.frame, 2)
	once:play("once", true)
	check("play(name, true) restarts", once.frame == 0 and not once.finished)

	local p = hero:animation("idle")
	p:update(0.3)
	p:play("idle")
	eq("play same name is a no-op", p.frame, 1)
	p:play("idle", true)
	eq("play restart", p.frame, 0)
	p:play("run")
	check("play switches", p.name == "run" and p.frame == 2)
	p:pause()
	p:update(1)
	eq("paused doesn't advance", p.frame, 2)
	p:resume()
	p:update(0.1)
	eq("resumed advances", p.frame, 3)
	near("duration", p:getDuration(), 0.3)

	local all = hero:animation()
	eq("no name: every frame", all.frame, 0)
	all:update(3 / 8)
	eq("no name: 8 fps", all.frame, 3)

	local d = hero:animation("defaults")
	d:update(10)
	eq("one-frame animation", d.frame, 3)

	eq("animation draws its frame", colorAt(20, 20, function() run:draw(10, 10) end, 8, 2), WHITE)
end

-------------------------------------------------------------------------------
-- Errors name the file and the problem

errors("unknown animation lists the ones that exist", function() hero:animation("jump") end,
	"sprites/hero.sprite.json", '"jump"', '"defaults", "idle", "once", "run"')
errors("play unknown animation", function() hero:animation("idle"):play("fly") end, '"fly"', "sprites/hero.sprite.json")
errors("sprite without animations", function() single:animation("idle") end, "sprites/single.png", "no animations")
errors("frame out of range (quad)", function() hero:quad(4) end, "sprites/hero.sprite.json", "frame 4", "4 frames, 0-3")
errors("frame out of range (draw)", function() hero:draw(-1, 0, 0) end, "frame -1")
errors("frame not a number", function() hero:draw("a", 0, 0) end, "frame a")
errors("missing file", function() smitten.sprite("sprites/nothing") end,
	"sprites/nothing", "sprites/nothing.sprite.json", "sprites/nothing.png")
errors("not a path", function() smitten.sprite(42) end, "expected a file path")
errors("newer format version", function() smitten.sprite("sprites/newer") end, "sprites/newer.sprite.json", "newer version", "format 2")
errors("animation with a frame out of range", function() smitten.sprite("sprites/badframe") end,
	"sprites/badframe.sprite.json", '"walk"', "frame 9", "4 frames, 0-3")
errors("image missing", function() smitten.sprite("sprites/noimage") end, "sprites/noimage.sprite.json", "sprites/nope.png")
errors("broken JSON", function() smitten.sprite("sprites/broken") end, "sprites/broken.sprite.json", "JSON")
do
	local ok, err = pcall(function() smitten.sprite("sprites/nothing") end)
	check("error points at the caller", not ok and tostring(err):find("main.lua:%d+:") ~= nil, err)
	ok, err = pcall(function() hero:animation("jump") end)
	check("animation error points at the caller", not ok and tostring(err):find("main.lua:%d+:") ~= nil, err)
end

-------------------------------------------------------------------------------
-- Screen

local screen = smitten.screen
errors("finish without begin", function() screen.finish() end, "begin")
errors("setup with bad size", function() screen.setup(0, 10) end, "whole pixels")
screen.setup()
eq("setup() reads smitten.json's resolution", screen.width .. "x" .. screen.height, "160x90")
screen.setup(320, 180)
eq("setup(w, h)", screen.width .. "x" .. screen.height, "320x180")
screen.setup()

do
	-- The window is 640x400 (conf.lua): 160x90 scales by 4 to 640x360, 20 px bars above and below.
	local ww, wh = love.graphics.getDimensions()
	local s = math.floor(math.min(ww / 160, wh / 90))
	local gx, gy = screen.toGame(ww / 2, wh / 2)
	near("toGame center x", gx, 80)
	near("toGame center y", gy, 45)
	eq("scale is a whole number", screen.scale, s)
	local wx, wy = screen.toWindow(0, 0)
	local bx, by = screen.toGame(wx, wy)
	check("toWindow inverts toGame", math.abs(bx) < 1e-9 and math.abs(by) < 1e-9, bx .. "," .. by)

	-- Draw a red game pixel at (0, 0) and check where it lands.
	local canvas = love.graphics.newCanvas(ww, wh, { dpiscale = love.graphics.getDPIScale() })
	love.graphics.push("all")
	love.graphics.setCanvas(canvas)
	screen.begin()
	errors("begin twice", function() screen.begin() end, "already")
	love.graphics.setColor(1, 0, 0)
	love.graphics.rectangle("fill", 0, 0, 1, 1)
	screen.finish()
	love.graphics.pop()
	local data = love.graphics.readbackTexture(canvas)
	local dpi = love.graphics.getDPIScale()
	local px, py = math.floor(wx * dpi + 0.5), math.floor(wy * dpi + 0.5)
	local r, g, b = data:getPixel(px, py)
	check("game pixel drawn at the scaled position", r > 0.99 and g < 0.01, ("%g %g %g at %d,%d"):format(r, g, b, px, py))
	r, g, b = data:getPixel(px + math.floor(s * dpi) - 1, py)
	check("one game pixel is scale pixels wide", r > 0.99, ("%g at %d"):format(r, px + s - 1))
	r, g, b = data:getPixel(px + math.floor(s * dpi), py)
	check("next game pixel is the background", r < 0.99, ("%g"):format(r))
	if py > 0 then
		local _, _, _, a = data:getPixel(px, py - 1)
		r, g, b = data:getPixel(px, py - 1)
		check("letterbox bars are black", r == 0 and g == 0 and b == 0 and a == 1, ("%g %g %g %g"):format(r, g, b, a))
	end
end

print(("SPRITE DONE %d/%d"):format(passed, total))

-------------------------------------------------------------------------------
-- Demo

local player = smitten.sprite("sprites/player")
local anim = player:animation("idle")
local x, dir = 80, 1

function love.keypressed(key)
	if key == "space" then dir = -dir end
end

function love.update(dt)
	local move = 0
	if love.keyboard.isDown("left", "a") then move = -1 end
	if love.keyboard.isDown("right", "d") then move = 1 end
	if move ~= 0 then dir = move end
	anim:play(move ~= 0 and "run" or "idle")
	anim:update(dt)
	x = math.max(8, math.min(152, x + move * 60 * dt))
end

function love.draw()
	screen.begin()
	love.graphics.clear(0x1a / 255, 0x1c / 255, 0x2c / 255)
	love.graphics.setColor(0x33 / 255, 0x3c / 255, 0x57 / 255)
	love.graphics.rectangle("fill", 0, 70, 160, 20)
	love.graphics.setColor(1, 1, 1)
	anim:draw(math.floor(x), 70, 0, dir, 1)
	for f = 0, hero.frameCount - 1 do hero:draw(f, 10 + f * 12, 20) end
	love.graphics.print(("%d/%d"):format(passed, total), 100, 4)
	local mx, my = screen.toGame(love.mouse.getPosition())
	love.graphics.print(("%d,%d"):format(mx, my), 100, 16)
	screen.finish()
end
