-- smitten.screen: draw at a fixed game resolution, scaled up by whole numbers.
--
--   smitten.screen.setup(320, 180)   -- or no arguments: smitten.json's resolution
--   function love.draw()
--     smitten.screen.begin()         -- draw at 320x180 from here
--     ...
--     smitten.screen.finish()        -- scaled, centered, letterboxed
--   end

local DEFAULT_WIDTH, DEFAULT_HEIGHT = 320, 180

---@class smitten.screen
---@field width integer game width in pixels
---@field height integer game height in pixels
---@field scale number how many window pixels one game pixel takes
---@field x number left edge of the game in the window
---@field y number top edge of the game in the window
---@field canvas love.Canvas
local screen = {
	width = DEFAULT_WIDTH,
	height = DEFAULT_HEIGHT,
	scale = 1,
	x = 0,
	y = 0,
	canvas = nil,
}

local drawing = false

local function isSize(n)
	return type(n) == "number" and n >= 1 and n == math.floor(n)
end

-- smitten.json's resolution, or the default.
local function projectResolution()
	if not love.filesystem.getInfo("smitten.json", "file") then return DEFAULT_WIDTH, DEFAULT_HEIGHT end
	local text = love.filesystem.read("smitten.json")
	local ok, data = pcall(require("smitten.json").json.decode, text or "")
	if not ok or type(data) ~= "table" then
		error("smitten.json: " .. tostring(ok and "expected a JSON object" or data), 0)
	end
	local r = data.resolution
	if r == nil then return DEFAULT_WIDTH, DEFAULT_HEIGHT end
	if type(r) ~= "table" or not isSize(r[1]) or not isSize(r[2]) then
		error("smitten.json: \"resolution\" should be [width, height] in whole pixels", 0)
	end
	return r[1], r[2]
end

-- Works out scale and position for the current window size.
local function layout()
	local pw, ph = love.graphics.getPixelDimensions()
	local dpi = love.graphics.getDPIScale()
	local s = math.floor(math.min(pw / screen.width, ph / screen.height))
	if s < 1 then
		-- The window is smaller than the game: shrink to fit instead.
		s = math.min(pw / screen.width, ph / screen.height)
	end
	screen.scale = s / dpi
	screen.x = math.floor((pw - screen.width * s) / 2) / dpi
	screen.y = math.floor((ph - screen.height * s) / 2) / dpi
end

---Set the game's resolution. With no arguments, uses smitten.json's
---"resolution" (320x180 if it has none).
---@param width? integer
---@param height? integer
function screen.setup(width, height)
	if width == nil and height == nil then
		local ok, w, h = pcall(projectResolution)
		if not ok then error(w, 2) end
		width, height = w, h
	elseif not isSize(width) or not isSize(height) then
		error(("smitten.screen.setup: expected a width and height in whole pixels, got %s, %s"):format(
			tostring(width), tostring(height)), 2)
	end
	if drawing then error("smitten.screen.setup: can't change the size between begin() and finish()", 2) end
	if not screen.canvas or screen.width ~= width or screen.height ~= height then
		screen.canvas = love.graphics.newCanvas(width, height, { dpiscale = 1 })
		screen.canvas:setFilter("nearest", "nearest")
	end
	screen.width, screen.height = width, height
	layout()
end

---Start drawing to the game screen. Everything until finish() is drawn at the
---game's resolution. Calls setup() first if it hasn't been called.
function screen.begin()
	if drawing then error("smitten.screen.begin: already drawing (call smitten.screen.finish() first)", 2) end
	if not screen.canvas then
		local ok, err = pcall(screen.setup)
		if not ok then error(err, 2) end
	end
	drawing = true
	love.graphics.push("all")
	love.graphics.setCanvas(screen.canvas)
	love.graphics.origin()
	love.graphics.clear(love.graphics.getBackgroundColor())
end

---Stop drawing to the game screen and draw it to the window (or the canvas
---that was active before begin()), scaled by the largest whole number that
---fits, centered, with black bars around it.
function screen.finish()
	if not drawing then error("smitten.screen.finish: call smitten.screen.begin() first", 2) end
	drawing = false
	love.graphics.pop()
	layout()
	-- pop() restored the target that was active before begin() (normally the
	-- window).
	love.graphics.push("all")
	love.graphics.origin()
	love.graphics.setShader()
	love.graphics.setScissor()
	love.graphics.clear(0, 0, 0, 1)
	love.graphics.setColor(1, 1, 1, 1)
	love.graphics.setBlendMode("alpha", "premultiplied")
	love.graphics.draw(screen.canvas, screen.x, screen.y, 0, screen.scale, screen.scale)
	love.graphics.pop()
end

---Convert window coordinates (e.g. love.mouse.getPosition()) to game
---coordinates. The result can be outside the game when the point is in the
---bars around it.
---@param x number
---@param y number
---@return number gameX
---@return number gameY
function screen.toGame(x, y)
	if not screen.canvas then
		local ok, err = pcall(screen.setup)
		if not ok then error(err, 2) end
	else
		layout()
	end
	return (x - screen.x) / screen.scale, (y - screen.y) / screen.scale
end

---Convert game coordinates to window coordinates.
---@param x number
---@param y number
---@return number windowX
---@return number windowY
function screen.toWindow(x, y)
	if not screen.canvas then
		local ok, err = pcall(screen.setup)
		if not ok then error(err, 2) end
	else
		layout()
	end
	return x * screen.scale + screen.x, y * screen.scale + screen.y
end

return { screen = screen }
