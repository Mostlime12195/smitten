-- smitten.collide: box collision against each other and against a map's
-- solid tiles.
--
--   local hit = smitten.collide.move(level, player, player.vx * dt, player.vy * dt)
--   if hit.ground then player.onGround = true end
--
-- move() goes one axis at a time (x, then y) and sweeps the box's leading
-- edge across every tile row or column it passes, so fast boxes can't skip
-- through thin walls at any speed. Boxes touching a wall (edge exactly on a
-- tile boundary) aren't counted as inside it, so sliding along floors and
-- walls works.

local collide = {}

local floor, min, max = math.floor, math.min, math.max
local huge = math.huge

-- Tiny tolerance so boxes placed exactly against a tile (after a previous
-- move, or with fractional sizes) aren't treated as overlapping it.
local EPSILON = 1e-6

local function checkBox(box, what)
	if type(box) ~= "table" or type(box.x) ~= "number" or type(box.y) ~= "number"
		or type(box.width) ~= "number" or type(box.height) ~= "number" then
		error(("smitten.collide.%s: expected a box with numbers x, y, width and height"):format(what), 3)
	end
end

---Whether two boxes overlap (touching edges don't count).
---@param a {x: number, y: number, width: number, height: number}
---@param b {x: number, y: number, width: number, height: number}
---@return boolean
function collide.overlaps(a, b)
	checkBox(a, "overlaps")
	checkBox(b, "overlaps")
	return a.x < b.x + b.width and b.x < a.x + a.width
		and a.y < b.y + b.height and b.y < a.y + a.height
end

-- Whether any cell in column `col`, rows r0..r1, is solid (or row `row`,
-- columns c0..c1 when vertical).
local function columnSolid(level, col, r0, r1)
	for r = r0, r1 do
		if level:isSolidTile(col, r) then return true end
	end
	return false
end

local function rowSolid(level, row, c0, c1)
	for c = c0, c1 do
		if level:isSolidTile(c, row) then return true end
	end
	return false
end

-- Sweep a box (x, y, w, h) along x by dx through a level's solid tiles.
-- Returns the new x and whether it was blocked. No tables are made, so
-- smitten's objects can call this every frame.
local function sweepX(level, x, y, w, h, dx)
	local tw, th = level.tileWidth, level.tileHeight
	-- Outside the map nothing is solid, so sweeps stop at its edges.
	local cols, rows = level.width or huge, level.height or huge
	-- Rows the box covers (an edge exactly on a boundary doesn't count).
	local r0 = max(floor((y + EPSILON) / th), 0)
	local r1 = min(floor((y + h - EPSILON) / th), rows - 1)
	if dx > 0 then
		local right = x + w
		local first = floor((right - EPSILON) / tw) + 1
		local last = floor((right + dx - EPSILON) / tw)
		for col = max(first, 0), min(last, cols - 1) do
			if columnSolid(level, col, r0, r1) then return col * tw - w, true end
		end
	elseif dx < 0 then
		local first = floor((x + EPSILON) / tw) - 1
		local last = floor((x + dx + EPSILON) / tw)
		for col = min(first, cols - 1), max(last, 0), -1 do
			if columnSolid(level, col, r0, r1) then return (col + 1) * tw, true end
		end
	end
	return x + dx, false
end

-- The same along y: returns the new y and whether it was blocked.
local function sweepY(level, x, y, w, h, dy)
	local tw, th = level.tileWidth, level.tileHeight
	local cols, rows = level.width or huge, level.height or huge
	local c0 = max(floor((x + EPSILON) / tw), 0)
	local c1 = min(floor((x + w - EPSILON) / tw), cols - 1)
	if dy > 0 then
		local bottom = y + h
		local first = floor((bottom - EPSILON) / th) + 1
		local last = floor((bottom + dy - EPSILON) / th)
		for row = max(first, 0), min(last, rows - 1) do
			if rowSolid(level, row, c0, c1) then return row * th - h, true end
		end
	elseif dy < 0 then
		local first = floor((y + EPSILON) / th) - 1
		local last = floor((y + dy + EPSILON) / th)
		for row = min(first, rows - 1), max(last, 0), -1 do
			if rowSolid(level, row, c0, c1) then return (row + 1) * th, true end
		end
	end
	return y + dy, false
end

---Move a box by (dx, dy) through a map's solid tiles, x first, then y.
---box.x and box.y are updated. Returns a table with:
--- x, y: true if movement on that axis was blocked;
--- ground: blocked while moving down; ceiling: blocked while moving up.
---@param level smitten.Map a map from smitten.map (or anything with isSolidTile(tx, ty), tileWidth, tileHeight)
---@param box {x: number, y: number, width: number, height: number}
---@param dx number
---@param dy number
---@return {x: boolean, y: boolean, ground: boolean, ceiling: boolean}
function collide.move(level, box, dx, dy)
	if type(level) ~= "table" or type(level.isSolidTile) ~= "function" then
		error("smitten.collide.move: expected a map (from smitten.map) as the first argument", 2)
	end
	checkBox(box, "move")
	dx, dy = dx or 0, dy or 0
	if type(dx) ~= "number" or type(dy) ~= "number" or dx ~= dx or dy ~= dy then
		error("smitten.collide.move: dx and dy should be numbers", 2)
	end
	local hit = { x = false, y = false, ground = false, ceiling = false }
	if dx ~= 0 then
		box.x, hit.x = sweepX(level, box.x, box.y, box.width, box.height, dx)
	end
	if dy ~= 0 then
		box.y, hit.y = sweepY(level, box.x, box.y, box.width, box.height, dy)
		if hit.y then
			if dy > 0 then hit.ground = true else hit.ceiling = true end
		end
	end
	return hit
end

return { collide = collide, sweepX = sweepX, sweepY = sweepY, EPSILON = EPSILON }
