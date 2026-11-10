-- Terrains: picking the tile that fits a cell's neighbours (autotiling).
--
-- A .tileset file can list terrains. A terrain is a set of tiles that draw
-- one material (grass, a wall, water) in all its shapes: the lone tile, the
-- edges, the corners, the middle. Each tile of a terrain has a mask that says
-- on which of its eight sides and corners the terrain carries on:
--
--     128 |  1  |  2          up-left   up    up-right
--     ----+-----+----
--      64 |     |  4          left            right
--     ----+-----+----
--      32 | 16  |  8          down-left down  down-right
--
-- A cell of a terrain looks at its eight neighbours, makes the same kind of
-- number from the ones that hold the same terrain, and takes the tile whose
-- mask is that number. The terrain's `match` says which neighbours count:
--
--   "all"      sides, and a corner when both sides next to it are in too
--              (47 different tiles: the "blob" set)
--   "sides"    the four sides only (16 tiles)
--   "corners"  a corner is in when the three neighbours around it all are
--              (16 tiles: the 2x2 or "wang corner" set)
--
-- Several tiles with the same mask are variants: the cell's position picks
-- one, always the same one. When no tile has the wanted mask, the nearest
-- mask is used (sides count for more than corners), so a set with a few
-- tiles missing still works.
--
-- This file has no engine in it: web/editor/workspaces/scene/terrain.js is
-- the same thing in JavaScript for the editor's Terrain brush, and both are
-- checked against tools/scene-tests/levels/terrain-cases.json.

local floor = math.floor

local T = {}

local N, NE, E, SE, S, SW, W, NW = 1, 2, 4, 8, 16, 32, 64, 128

-- The eight neighbours, clockwise from up: dx, dy, bit.
local AROUND = {
	{ 0, -1, N }, { 1, -1, NE }, { 1, 0, E }, { 1, 1, SE },
	{ 0, 1, S }, { -1, 1, SW }, { -1, 0, W }, { -1, -1, NW },
}
T.AROUND = AROUND

-- Each corner with the two sides next to it.
local CORNERS = { { NE, N, E }, { SE, S, E }, { SW, S, W }, { NW, N, W } }

local function has(mask, bit)
	return mask % (bit * 2) >= bit
end

---What a mask means under a match mode: the bits that mode looks at.
---For a cell, mask has a bit for every neighbour in the terrain; for a tile
---it's the mask from the file (tile = true keeps its corners as painted).
function T.reduce(mask, match, tile)
	mask = floor(tonumber(mask) or 0) % 256
	local out = 0
	if match == "sides" then
		if has(mask, N) then out = out + N end
		if has(mask, E) then out = out + E end
		if has(mask, S) then out = out + S end
		if has(mask, W) then out = out + W end
		return out
	end
	local corners = match == "corners"
	if not corners then
		if has(mask, N) then out = out + N end
		if has(mask, E) then out = out + E end
		if has(mask, S) then out = out + S end
		if has(mask, W) then out = out + W end
	end
	for i = 1, 4 do
		local c = CORNERS[i]
		if has(mask, c[1]) and ((corners and tile) or (has(mask, c[2]) and has(mask, c[3]))) then
			out = out + c[1]
		end
	end
	return out
end

-- How far apart two masks are: a side that differs counts 4, a corner 1.
local function distance(p, q)
	local d = 0
	for i = 1, 8 do
		local bit = AROUND[i][3]
		if has(p, bit) ~= has(q, bit) then d = d + ((i % 2 == 1) and 4 or 1) end
	end
	return d
end

---A number from a cell's position that is always the same for that cell
---(and the same in terrain.js), for picking among variants.
function T.hash(cx, cy)
	local x, y = cx % 65536, cy % 65536
	local h = (x * 374761 + y * 668265 + 12345) % 1000003
	h = (h * h + x * 31 + y * 17) % 1000003
	return (h * 48271) % 2147483647
end

---Makes a terrain ready to use from its entry in the .tileset file:
---{ name = "grass", match = "all", tiles = { ["12"] = 255, ... } }.
function T.compile(def, index)
	local match = def.match
	if match ~= "sides" and match ~= "corners" then match = "all" end
	local t = {
		name = tostring(def.name or ("terrain" .. (index or 1))), match = match,
		tiles = {},   -- tile -> its mask (reduced)
		byMask = {},  -- mask -> the tiles with it, lowest first
		masks = {},   -- the masks in use, lowest first
		first = nil,  -- the lowest tile
	}
	local list = {}
	for k, v in pairs(type(def.tiles) == "table" and def.tiles or {}) do
		local tile = tonumber(k)
		if tile and tile >= 0 and tile == floor(tile) and tonumber(v) then list[#list + 1] = { tile, T.reduce(v, match, true) } end
	end
	table.sort(list, function(p, q) return p[1] < q[1] end)
	for i = 1, #list do
		local tile, mask = list[i][1], list[i][2]
		t.tiles[tile] = mask
		local same = t.byMask[mask]
		if not same then
			same = {}
			t.byMask[mask] = same
			t.masks[#t.masks + 1] = mask
		end
		same[#same + 1] = tile
		if not t.first then t.first = tile end
	end
	table.sort(t.masks)
	return t
end

---Makes every terrain of a tileset ready: returns the list (in file order),
---name -> terrain, and tile -> terrain (a tile in two terrains belongs to
---the first).
function T.compileAll(defs)
	local list, byName, of = {}, {}, {}
	if type(defs) ~= "table" then return list, byName, of end
	for i = 1, #defs do
		local def = defs[i]
		if type(def) == "table" then
			local t = T.compile(def, i)
			if not byName[t.name] then
				list[#list + 1] = t
				byName[t.name] = t
				for tile in pairs(t.tiles) do
					if of[tile] == nil then of[tile] = t end
				end
			end
		end
	end
	return list, byName, of
end

---The tile of a terrain for a mask (already reduced) in cell cx, cy; nil when
---the terrain has no tiles.
function T.pick(t, mask, cx, cy)
	local same = t.byMask[mask]
	if not same then
		local best, bestD = nil, nil
		local masks = t.masks
		for i = 1, #masks do
			local d = distance(masks[i], mask)
			if bestD == nil or d < bestD then best, bestD = masks[i], d end
		end
		if best == nil then return nil end
		same = t.byMask[best]
	end
	local n = #same
	if n == 1 then return same[1] end
	return same[T.hash(cx, cy) % n + 1]
end

---The mask a cell of terrain t should have, from its neighbours.
---get(cx, cy) returns the tile in a cell (nil or -1: empty); of is tile ->
---terrain.
function T.wanted(t, get, of, cx, cy)
	local mask = 0
	for i = 1, 8 do
		local a = AROUND[i]
		local tile = get(cx + a[1], cy + a[2])
		if tile ~= nil and of[tile] == t then mask = mask + a[3] end
	end
	return T.reduce(mask, t.match)
end

---Picks the cell's tile again if it belongs to a terrain. With force, also
---when the tile it has fits already (a variant is picked afresh). Returns
---true if the cell changed.
function T.refresh(get, set, of, cx, cy, force)
	local tile = get(cx, cy)
	local t = tile ~= nil and of[tile] or nil
	if not t then return false end
	local mask = T.wanted(t, get, of, cx, cy)
	if not force and t.tiles[tile] == mask then return false end
	local new = T.pick(t, mask, cx, cy)
	if new == nil or new == tile then return false end
	set(cx, cy, new)
	return true
end

---Puts terrain t in a cell (nil: empties the cell) and fits the cell and its
---eight neighbours.
function T.place(get, set, of, cx, cy, t)
	if t then
		if t.first == nil then return end
		set(cx, cy, t.first)
		T.refresh(get, set, of, cx, cy, true)
	else
		set(cx, cy, -1)
	end
	for i = 1, 8 do
		local a = AROUND[i]
		T.refresh(get, set, of, cx + a[1], cy + a[2], false)
	end
end

---Puts terrain t (nil: nothing) in a rectangle of cells and fits them and
---the cells around the rectangle.
function T.fill(get, set, of, cx, cy, columns, rows, t)
	if t and t.first == nil then return end
	local x1, y1 = cx + columns - 1, cy + rows - 1
	for y = cy, y1 do
		for x = cx, x1 do set(x, y, t and t.first or -1) end
	end
	for y = cy - 1, y1 + 1 do
		for x = cx - 1, x1 + 1 do
			T.refresh(get, set, of, x, y, x >= cx and x <= x1 and y >= cy and y <= y1)
		end
	end
end

return T
