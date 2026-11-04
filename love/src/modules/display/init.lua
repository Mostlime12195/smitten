-- smitten.display: the game's resolution and how it fits the window
-- (Project settings > Display; DESIGN.md, section 5).
--
--   smitten.display.width, smitten.display.height   the game's resolution
--   smitten.display.toGame(x, y)                     window -> game coordinates
--
-- The resolution is the size the game is designed for, not the size it is
-- drawn at: the window fills the page, and the game is drawn at the screen's
-- real resolution (high-DPI included), so it stays sharp at any size.
--
-- Stretch modes: "expand" (the default) scales the game to fit and shows more
-- of the world instead of bars; "fit" scales the same way and fills the rest
-- with the background color; "stretch" fills the window, distorting if the
-- shapes differ; "pixel" draws the game at its resolution and scales it by
-- whole numbers only, for crisp pixel art.

local display = {}

display.width, display.height = 1280, 720
display.stretch = "expand"
display.filter = "smooth"
-- Smooth edges on shapes and lines (multisampling); off for "pixel".
display.antialias = true
display.background = { 0.11, 0.12, 0.15, 1 }
-- The visible part of the game, in game coordinates (bigger than width x
-- height in "expand" mode).
display.viewX, display.viewY = 0, 0
display.viewWidth, display.viewHeight = 1280, 720
-- Window pixels (LÖVE's units, not the screen's) per game pixel.
display.scale = 1
display.active = false

-- How many samples antialiasing uses: 4 smooths edges well and is what
-- browsers and GPUs do fastest.
local MSAA = 4

local ox, oy, sx, sy = 0, 0, 1, 1   -- game -> window
local canvas = nil

local STRETCH = { fit = true, expand = true, stretch = true, pixel = true }
local FILTER = { smooth = true, pixel = true }

---Sets up the display (love.engine does it from smitten.json).
function display.setup(settings)
	settings = settings or {}
	local function size(v, name)
		if v == nil then return nil end
		if type(v) ~= "number" or v < 1 then
			error(("display %s must be a number of pixels, not %q"):format(name, tostring(v)), 3)
		end
		return math.floor(v)
	end
	display.width = size(settings.width, "width") or display.width
	display.height = size(settings.height, "height") or display.height
	if settings.stretch ~= nil then
		if not STRETCH[settings.stretch] then
			error(("display stretch must be expand, fit, stretch or pixel, not %q"):format(tostring(settings.stretch)), 2)
		end
		display.stretch = settings.stretch
	end
	local pixel = display.stretch == "pixel"
	if settings.filter ~= nil then
		if not FILTER[settings.filter] then
			error(("display filter must be smooth or pixel, not %q"):format(tostring(settings.filter)), 2)
		end
		display.filter = settings.filter
	else
		display.filter = pixel and "pixel" or "smooth"
	end
	if settings.antialias ~= nil then
		display.antialias = settings.antialias == true
	else
		display.antialias = not pixel
	end
	if type(settings.background) == "table" then display.background = settings.background end
	require("love.assets").filter = display.filter
	if display.filter == "pixel" then love.graphics.setDefaultFilter("nearest", "nearest") end
	display.active = true
	display.update()
end

---The window's options for this display (love.engine opens the window with
---them): it can be resized (the player makes it fill the page), uses the
---screen's real resolution, and is multisampled when antialias is on.
function display._windowSettings()
	-- In "pixel" mode the game is drawn to its own canvas (multisampled
	-- there, if asked), so the window never needs it.
	local msaa = (display.antialias and display.stretch ~= "pixel") and MSAA or 0
	return { width = display.width, height = display.height, resizable = true, highdpi = true, msaa = msaa }
end

---Works out the scale and offsets for the window's current size.
function display.update()
	local g = love.graphics
	local ww, wh = g.getDimensions()
	if ww <= 0 or wh <= 0 then ww, wh = display.width, display.height end
	local dpi = g.getDPIScale and g.getDPIScale() or 1
	local w, h = display.width, display.height
	local mode = display.stretch
	-- Offsets land on whole screen pixels, so edges stay sharp.
	local function snap(v) return math.floor(v * dpi + 0.5) / dpi end
	if mode == "stretch" then
		sx, sy = ww / w, wh / h
		ox, oy = 0, 0
		display.viewX, display.viewY, display.viewWidth, display.viewHeight = 0, 0, w, h
	elseif mode == "pixel" then
		-- Whole numbers of the screen's own pixels per game pixel (not of the
		-- window's units, which are bigger on high-DPI screens). A window
		-- smaller than the game shrinks it rather than cutting it off.
		local fit = math.min(ww * dpi / w, wh * dpi / h)
		local s = fit >= 1 and math.floor(fit) or fit
		sx, sy = s / dpi, s / dpi
		ox, oy = math.floor((ww * dpi - w * s) / 2) / dpi, math.floor((wh * dpi - h * s) / 2) / dpi
		display.viewX, display.viewY, display.viewWidth, display.viewHeight = 0, 0, w, h
	else
		local s = math.min(ww / w, wh / h)
		sx, sy = s, s
		if mode == "expand" then
			local vw, vh = ww / s, wh / s
			display.viewX, display.viewY = -(vw - w) / 2, -(vh - h) / 2
			display.viewWidth, display.viewHeight = vw, vh
			ox, oy = (ww - w * s) / 2, (wh - h * s) / 2
		else
			display.viewX, display.viewY, display.viewWidth, display.viewHeight = 0, 0, w, h
			ox, oy = snap((ww - w * s) / 2), snap((wh - h * s) / 2)
		end
	end
	display.scale = math.min(sx, sy)
	-- Text is rendered at the screen's size so it stays crisp when scaled
	-- (fonts add the screen's pixel density themselves).
	require("love.scene.nodes2d").textScale = mode == "pixel" and 1 or display.scale
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

local function clearToBackground()
	local bg = display.background
	love.graphics.clear(bg[1], bg[2], bg[3], bg[4] or 1)
end

---Starts drawing in game coordinates (love.engine calls it).
function display.begin()
	if not display.active then return end
	display.update()
	local g = love.graphics
	if display.stretch == "pixel" then
		local w, h = display.width, display.height
		if not canvas or canvas:getWidth() ~= w or canvas:getHeight() ~= h then
			-- One texel per game pixel, whatever the screen's density.
			local msaa = display.antialias and MSAA or nil
			local ok, made = pcall(g.newCanvas, w, h, { dpiscale = 1, msaa = msaa })
			canvas = ok and made or g.newCanvas(w, h, { dpiscale = 1 })
			canvas:setFilter("nearest", "nearest")
			-- Without antialiasing, lines are whole pixels too (once, so a
			-- game can still choose smooth lines).
			if not display.antialias and not display._lineStyleSet then
				display._lineStyleSet = true
				g.setLineStyle("rough")
			end
		end
		g.setCanvas(canvas)
		clearToBackground()
		g.origin()
	else
		-- The bars "fit" leaves are the game's background color.
		clearToBackground()
		if display.stretch == "fit" then
			local x, y, w, h = display.getWindowRect()
			g.setScissor(x, y, w, h)
		end
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
		g.setScissor()
		clearToBackground()
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
