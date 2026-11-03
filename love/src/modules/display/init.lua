-- smitten.display: the game's resolution and how it fits the window
-- (Project settings > Display; DESIGN.md, section 5).
--
--   smitten.display.width, smitten.display.height   the game's resolution
--   smitten.display.toGame(x, y)                     window -> game coordinates
--
-- Stretch modes: "fit" scales the game to fit and letterboxes the rest;
-- "expand" scales the same way but shows more of the world instead of bars;
-- "stretch" fills the window, distorting if the shapes differ; "pixel"
-- scales by whole numbers only, for crisp pixel art.

local display = {}

display.width, display.height = 1280, 720
display.stretch = "fit"
display.filter = "smooth"
display.background = { 0.11, 0.12, 0.15, 1 }
-- The visible part of the game, in game coordinates (bigger than width x
-- height in "expand" mode).
display.viewX, display.viewY = 0, 0
display.viewWidth, display.viewHeight = 1280, 720
display.scale = 1
display.active = false

local ox, oy, sx, sy = 0, 0, 1, 1   -- game -> window
local canvas = nil

local STRETCH = { fit = true, expand = true, stretch = true, pixel = true }

---Sets up the display (love.engine does it from smitten.json).
function display.setup(settings)
	settings = settings or {}
	display.width = settings.width or display.width
	display.height = settings.height or display.height
	if settings.stretch then
		if not STRETCH[settings.stretch] then
			error(("display stretch must be fit, expand, stretch or pixel, not %q"):format(tostring(settings.stretch)), 2)
		end
		display.stretch = settings.stretch
	end
	display.filter = settings.filter or (display.stretch == "pixel" and "pixel" or display.filter)
	if type(settings.background) == "table" then display.background = settings.background end
	require("love.assets").filter = display.filter
	if display.filter == "pixel" then love.graphics.setDefaultFilter("nearest", "nearest") end
	display.active = true
	display.update()
end

---Works out the scale and offsets for the window's current size.
function display.update()
	local ww, wh = love.graphics.getDimensions()
	if ww <= 0 or wh <= 0 then ww, wh = display.width, display.height end
	local w, h = display.width, display.height
	local mode = display.stretch
	if mode == "stretch" then
		sx, sy = ww / w, wh / h
		ox, oy = 0, 0
		display.viewX, display.viewY, display.viewWidth, display.viewHeight = 0, 0, w, h
	else
		local s = math.min(ww / w, wh / h)
		if mode == "pixel" then s = math.max(1, math.floor(s)) end
		sx, sy = s, s
		if mode == "expand" then
			local vw, vh = ww / s, wh / s
			display.viewX, display.viewY = -(vw - w) / 2, -(vh - h) / 2
			display.viewWidth, display.viewHeight = vw, vh
			ox, oy = (ww - w * s) / 2, (wh - h * s) / 2
		else
			display.viewX, display.viewY, display.viewWidth, display.viewHeight = 0, 0, w, h
			ox, oy = math.floor((ww - w * s) / 2), math.floor((wh - h * s) / 2)
		end
	end
	display.scale = math.min(sx, sy)
	-- Text is rendered at the screen's size so it stays crisp when scaled.
	require("love.scene.nodes2d").textScale = display.filter == "pixel" and 1 or display.scale
end

---Window coordinates to game coordinates.
function display.toGame(x, y)
	if not display.active then return x, y end
	return (x - ox) / sx, (y - oy) / sy
end

---Game coordinates to window coordinates.
function display.toWindow(x, y)
	if not display.active then return x, y end
	return x * sx + ox, y * sy + oy
end

---The game's area in the window, in pixels: x, y, width, height.
function display.getWindowRect()
	if not display.active then
		local w, h = love.graphics.getDimensions()
		return 0, 0, w, h
	end
	if display.stretch == "expand" then
		local w, h = love.graphics.getDimensions()
		return 0, 0, w, h
	end
	return ox, oy, display.width * sx, display.height * sy
end

---Starts drawing in game coordinates (love.engine calls it).
function display.begin()
	if not display.active then return end
	display.update()
	local g = love.graphics
	local bg = display.background
	if display.stretch == "pixel" then
		local w, h = display.width, display.height
		if not canvas or canvas:getWidth() ~= w or canvas:getHeight() ~= h then
			canvas = g.newCanvas(w, h)
			canvas:setFilter("nearest", "nearest")
		end
		g.setCanvas(canvas)
		g.clear(bg[1], bg[2], bg[3], bg[4] or 1)
		g.origin()
	else
		g.clear(0, 0, 0, 1)
		local x, y, w, h = display.getWindowRect()
		g.setColor(bg[1], bg[2], bg[3], bg[4] or 1)
		g.rectangle("fill", x, y, w, h)
		g.setColor(1, 1, 1, 1)
		if display.stretch ~= "expand" then g.setScissor(x, y, w, h) end
		g.origin()
		g.translate(ox, oy)
		g.scale(sx, sy)
	end
end

---Finishes drawing and shows the game in the window.
function display.finish()
	if not display.active then return end
	local g = love.graphics
	if display.stretch == "pixel" then
		g.setCanvas()
		g.origin()
		g.clear(0, 0, 0, 1)
		g.setColor(1, 1, 1, 1)
		g.setBlendMode("alpha", "premultiplied")
		g.draw(canvas, ox, oy, 0, sx, sy)
		g.setBlendMode("alpha")
	else
		g.setScissor()
		g.origin()
	end
end

return display
