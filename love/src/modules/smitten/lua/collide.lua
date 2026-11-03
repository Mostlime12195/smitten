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
	local tw, th = level.tileWidth, level.tileHeight
	-- Outside the map nothing is solid, so sweeps stop at its edges.
	local cols, rows = level.width or huge, level.height or huge
	local hit = { x = false, y = false, ground = false, ceiling = false }

	if dx ~= 0 then
		-- Rows the box covers (an edge exactly on a boundary doesn't count).
		local r0 = floor((box.y + EPSILON) / th)
		local r1 = floor((box.y + box.height - EPSILON) / th)
		r0, r1 = max(r0, 0), min(r1, rows - 1)
		if dx > 0 then
			local right = box.x + box.width
			local first = floor((right - EPSILON) / tw) + 1
			local last = floor((right + dx - EPSILON) / tw)
			box.x = box.x + dx
			for col = max(first, 0), min(last, cols - 1) do
				if columnSolid(level, col, r0, r1) then
					box.x = col * tw - box.width
					hit.x = true
					break
				end
			end
		else
			local left = box.x
			local first = floor((left + EPSILON) / tw) - 1
			local last = floor((left + dx + EPSILON) / tw)
			box.x = box.x + dx
			for col = min(first, cols - 1), max(last, 0), -1 do
				if columnSolid(level, col, r0, r1) then
					box.x = (col + 1) * tw
					hit.x = true
					break
				end
			end
		end
	end

	if dy ~= 0 then
		-- Columns at the box's new x position.
		local c0 = floor((box.x + EPSILON) / tw)
		local c1 = floor((box.x + box.width - EPSILON) / tw)
		c0, c1 = max(c0, 0), min(c1, cols - 1)
		if dy > 0 then
			local bottom = box.y + box.height
			local first = floor((bottom - EPSILON) / th) + 1
			local last = floor((bottom + dy - EPSILON) / th)
			box.y = box.y + dy
			for row = max(first, 0), min(last, rows - 1) do
				if rowSolid(level, row, c0, c1) then
					box.y = row * th - box.height
					hit.y, hit.ground = true, true
					break
				end
			end
		else
			local top = box.y
			local first = floor((top + EPSILON) / th) - 1
			local last = floor((top + dy + EPSILON) / th)
			box.y = box.y + dy
			for row = min(first, rows - 1), max(last, 0), -1 do
				if rowSolid(level, row, c0, c1) then
					box.y = (row + 1) * th
					hit.y, hit.ceiling = true, true
					break
				end
			end
		end
	end

	return hit
end

return { collide = collide }
