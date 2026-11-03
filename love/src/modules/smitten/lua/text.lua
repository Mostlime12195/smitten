-- smitten.print and smitten.font: Smitten's own pixel font.
--
--   smitten.print("Score: 10", 4, 4, 13)        -- palette color 13
--   smitten.printCentered("GAME OVER", 80, 3, 2) -- centered, twice as big
--   love.graphics.setFont(smitten.font)         -- for love.graphics.print too
--
-- The font was drawn for Smitten, pixel by pixel, below: every printable
-- ASCII character in a 5 × 7 box (capitals and digits fill it; lowercase
-- letters are 5 high), with two more rows under the baseline for the tails
-- of g, j, p, q, y and commas. Characters are 6 pixels apart and lines 10.
-- It becomes a LÖVE ImageFont, so love.graphics.print/printf work with it.

-- Rows from top to bottom, "#" = pixel. Rows 8 and 9 (below the baseline)
-- are left out when empty.
local GLYPHS = {
	[" "] = "..... ..... ..... ..... ..... ..... .....",
	["!"] = "..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..",
	['"'] = ".#.#. .#.#. .#.#. ..... ..... ..... .....",
	["#"] = ".#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.",
	["$"] = "..#.. .#### #.#.. .###. ..#.# ####. ..#..",
	["%"] = "##... ##..# ...#. ..#.. .#... #..## ...##",
	["&"] = ".##.. #..#. #.#.. .#... #.#.# #..#. .##.#",
	["'"] = "..#.. ..#.. .#... ..... ..... ..... .....",
	["("] = "...#. ..#.. .#... .#... .#... ..#.. ...#.",
	[")"] = ".#... ..#.. ...#. ...#. ...#. ..#.. .#...",
	["*"] = "..... ..#.. #.#.# .###. #.#.# ..#.. .....",
	["+"] = "..... ..#.. ..#.. ##### ..#.. ..#.. .....",
	[","] = "..... ..... ..... ..... ..... .##.. .##.. ..#.. .#...",
	["-"] = "..... ..... ..... .###. ..... ..... .....",
	["."] = "..... ..... ..... ..... ..... .##.. .##..",
	["/"] = "....# ....# ...#. ..#.. .#... #.... #....",
	["0"] = ".###. #...# #..## #.#.# ##..# #...# .###.",
	["1"] = "..#.. .##.. #.#.. ..#.. ..#.. ..#.. #####",
	["2"] = ".###. #...# ....# ..##. .#... #.... #####",
	["3"] = "####. ....# ....# .###. ....# ....# ####.",
	["4"] = "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
	["5"] = "##### #.... ####. ....# ....# #...# .###.",
	["6"] = ".###. #.... #.... ####. #...# #...# .###.",
	["7"] = "##### ....# ...#. ..#.. ..#.. ..#.. ..#..",
	["8"] = ".###. #...# #...# .###. #...# #...# .###.",
	["9"] = ".###. #...# #...# .#### ....# ....# .###.",
	[":"] = "..... .##.. .##.. ..... .##.. .##.. .....",
	[";"] = "..... .##.. .##.. ..... .##.. .##.. ..#.. .#...",
	["<"] = "...#. ..#.. .#... #.... .#... ..#.. ...#.",
	["="] = "..... ..... ##### ..... ##### ..... .....",
	[">"] = ".#... ..#.. ...#. ....# ...#. ..#.. .#...",
	["?"] = ".###. #...# ....# ..##. ..#.. ..... ..#..",
	["@"] = ".###. #...# #.### #.#.# #.### #.... .####",
	["A"] = ".###. #...# #...# ##### #...# #...# #...#",
	["B"] = "####. #...# #...# ####. #...# #...# ####.",
	["C"] = ".###. #...# #.... #.... #.... #...# .###.",
	["D"] = "###.. #..#. #...# #...# #...# #..#. ###..",
	["E"] = "##### #.... #.... ####. #.... #.... #####",
	["F"] = "##### #.... #.... ####. #.... #.... #....",
	["G"] = ".###. #...# #.... #..## #...# #...# .####",
	["H"] = "#...# #...# #...# ##### #...# #...# #...#",
	["I"] = "##### ..#.. ..#.. ..#.. ..#.. ..#.. #####",
	["J"] = "..### ....# ....# ....# ....# #...# .###.",
	["K"] = "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
	["L"] = "#.... #.... #.... #.... #.... #.... #####",
	["M"] = "#...# ##.## #.#.# #.#.# #...# #...# #...#",
	["N"] = "#...# #...# ##..# #.#.# #..## #...# #...#",
	["O"] = ".###. #...# #...# #...# #...# #...# .###.",
	["P"] = "####. #...# #...# ####. #.... #.... #....",
	["Q"] = ".###. #...# #...# #...# #.#.# #..#. .##.#",
	["R"] = "####. #...# #...# ####. #.#.. #..#. #...#",
	["S"] = ".#### #.... #.... .###. ....# ....# ####.",
	["T"] = "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
	["U"] = "#...# #...# #...# #...# #...# #...# .###.",
	["V"] = "#...# #...# #...# #...# .#.#. .#.#. ..#..",
	["W"] = "#...# #...# #...# #.#.# #.#.# ##.## #...#",
	["X"] = "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
	["Y"] = "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
	["Z"] = "##### ....# ...#. ..#.. .#... #.... #####",
	["["] = ".###. .#... .#... .#... .#... .#... .###.",
	["\\"] = "#.... #.... .#... ..#.. ...#. ....# ....#",
	["]"] = ".###. ...#. ...#. ...#. ...#. ...#. .###.",
	["^"] = "..#.. .#.#. #...# ..... ..... ..... .....",
	["_"] = "..... ..... ..... ..... ..... ..... ..... #####",
	["`"] = ".#... ..#.. ..... ..... ..... ..... .....",
	["a"] = "..... ..... .###. ....# .#### #...# .####",
	["b"] = "#.... #.... ####. #...# #...# #...# ####.",
	["c"] = "..... ..... .###. #.... #.... #.... .###.",
	["d"] = "....# ....# .#### #...# #...# #...# .####",
	["e"] = "..... ..... .###. #...# ##### #.... .###.",
	["f"] = "..##. .#... .#... ####. .#... .#... .#...",
	["g"] = "..... ..... .#### #...# #...# #...# .#### ....# .###.",
	["h"] = "#.... #.... ####. #...# #...# #...# #...#",
	["i"] = "..#.. ..... .##.. ..#.. ..#.. ..#.. .###.",
	["j"] = "...#. ..... ..##. ...#. ...#. ...#. ...#. #..#. .##..",
	["k"] = "#.... #.... #..#. #.#.. ##... #.#.. #..#.",
	["l"] = ".##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
	["m"] = "..... ..... ##.#. #.#.# #.#.# #.#.# #...#",
	["n"] = "..... ..... ####. #...# #...# #...# #...#",
	["o"] = "..... ..... .###. #...# #...# #...# .###.",
	["p"] = "..... ..... ####. #...# #...# #...# ####. #.... #....",
	["q"] = "..... ..... .#### #...# #...# #...# .#### ....# ....#",
	["r"] = "..... ..... #.##. ##..# #.... #.... #....",
	["s"] = "..... ..... .#### #.... .###. ....# ####.",
	["t"] = ".#... .#... ####. .#... .#... .#... ..##.",
	["u"] = "..... ..... #...# #...# #...# #...# .####",
	["v"] = "..... ..... #...# #...# #...# .#.#. ..#..",
	["w"] = "..... ..... #...# #...# #.#.# #.#.# .#.#.",
	["x"] = "..... ..... #...# .#.#. ..#.. .#.#. #...#",
	["y"] = "..... ..... #...# #...# #...# #...# .#### ....# .###.",
	["z"] = "..... ..... ##### ...#. ..#.. .#... #####",
	["{"] = "...#. ..#.. ..#.. .#... ..#.. ..#.. ...#.",
	["|"] = "..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
	["}"] = ".#... ..#.. ..#.. ...#. ..#.. ..#.. .#...",
	["~"] = "..... ..... .#... #.#.# ...#. ..... .....",
}

local WIDTH, ROWS, LINE = 5, 9, 10
local ORDER = {}
for code = 32, 126 do ORDER[#ORDER + 1] = string.char(code) end

local floor = math.floor

-- Draw the glyphs into an ImageData laid out as LÖVE's image fonts expect:
-- one spacer column (the color of the top-left pixel) before each glyph and
-- after the last one.
local function makeFont()
	local w = #ORDER * (WIDTH + 1) + 1
	local data = love.image.newImageData(w, ROWS)
	for x = 0, w - 1, WIDTH + 1 do
		for y = 0, ROWS - 1 do data:setPixel(x, y, 1, 0, 1, 1) end
	end
	for i, ch in ipairs(ORDER) do
		local glyph = GLYPHS[ch]
		local left = (i - 1) * (WIDTH + 1) + 1
		local y = 0
		for row in glyph:gmatch("[#.]+") do
			for x = 1, WIDTH do
				if row:sub(x, x) == "#" then data:setPixel(left + x - 1, y, 1, 1, 1, 1) end
			end
			y = y + 1
		end
	end
	local font = love.graphics.newImageFont(data, table.concat(ORDER), 1)
	font:setFilter("nearest", "nearest")
	font:setLineHeight(LINE / ROWS)
	return font
end

local font

local function getFont()
	if not font then font = makeFont() end
	return font
end

local function setColor(color, what)
	if color == nil then return end
	local ok, r, g, b, a = pcall(require("smitten.util").color, color)
	if not ok then error(("smitten.%s: %s"):format(what, (tostring(r):gsub("^[^:\n]*:%d+: smitten%.color: ", ""))), 3) end
	love.graphics.setColor(r, g, b, a)
end

local function show(text, x, y, color, scale, what)
	if type(text) ~= "string" then text = tostring(text) end
	local f = getFont()
	local oldFont = love.graphics.getFont()
	local r, g, b, a
	if color ~= nil then
		r, g, b, a = love.graphics.getColor()
		setColor(color, what)
	end
	scale = scale or 1
	love.graphics.setFont(f)
	love.graphics.print(text, floor(x + 0.5), floor(y + 0.5), 0, scale, scale)
	love.graphics.setFont(oldFont)
	if color ~= nil then love.graphics.setColor(r, g, b, a) end
end

local text = {}

---Draw text with Smitten's pixel font. color: a palette number, "#rrggbb"
---or {r, g, b}; without it, the current color is used. scale: whole numbers
---keep it crisp (2 = twice as big).
---@param s any
---@param x number
---@param y number
---@param color? integer|string|number[]
---@param scale? number
function text.print(s, x, y, color, scale)
	if type(x) ~= "number" or type(y) ~= "number" then
		error("smitten.print: expected the text, then x and y, like smitten.print(\"Score: 10\", 4, 4)", 2)
	end
	show(s, x, y, color, scale, "print")
end

---Draw text centered horizontally on the game screen (smitten.screen.width).
---@param s any
---@param y number
---@param color? integer|string|number[]
---@param scale? number
function text.printCentered(s, y, color, scale)
	if type(y) ~= "number" then
		error("smitten.printCentered: expected the text, then y, like smitten.printCentered(\"GAME OVER\", 80)", 2)
	end
	if type(s) ~= "string" then s = tostring(s) end
	local width = require("smitten.screen").screen.width
	local w = text.textWidth(s) * (scale or 1)
	show(s, floor((width - w) / 2), y, color, scale, "printCentered")
end

---Width in pixels of text in Smitten's font (its longest line).
---@param s any
---@return integer
function text.textWidth(s)
	if type(s) ~= "string" then s = tostring(s) end
	local f = getFont()
	local widest = 0
	for line in (s .. "\n"):gmatch("([^\n]*)\n") do
		local w = f:getWidth(line)
		if w > 0 then w = w - 1 end -- no spacing after the last character
		if w > widest then widest = w end
	end
	return widest
end

return setmetatable({
	print = text.print, printCentered = text.printCentered, textWidth = text.textWidth,
	-- Internal:
	GLYPHS = GLYPHS, getFont = getFont,
}, {
	-- smitten.font is made the first time it's used.
	__index = function(_, key)
		if key == "font" then return getFont() end
	end,
})
