-- How Row, Column, Grid and Scroll place the pieces inside them: plain
-- arithmetic with no drawing, so it runs under plain Lua 5.1 too
-- (tools/ui-tests/test.lua).
--
-- The editor's scene view runs the same rules in JavaScript
-- (web/editor/workspaces/scene/uilayout.js). Both are checked against the
-- same cases, tools/scene-tests/ui/layout-cases.json: change one and the
-- other must change with it.
--
-- A container is described by a table o:
--   kind      "row" (left to right), "column" (top to bottom) or "grid"
--   gap       room between one piece and the next
--   padding   room between the container's edge and the pieces
--   align     "start", "center", "end" or "stretch": across the direction
--             the pieces run in (in a grid: inside each cell, both ways)
--   justify   "start", "center", "end" or "spaceBetween": where the pieces
--             go along that direction when there's room left over
--   columns   a grid's columns
-- and the pieces inside it by a list of items { w, h, grow }.

local M = {}

local floor, max, ceil = math.floor, math.max, math.ceil

local function round(v)
	return floor(v + 0.5)
end

local function columnsOf(o)
	local c = floor(tonumber(o.columns) or 1)
	return c >= 1 and c or 1
end

---The size a container needs to hold its items, padding included: w, h.
function M.measure(o, items)
	local n = #items
	local gap, pad = o.gap or 0, o.padding or 0
	local kind = o.kind
	if kind == "grid" then
		local cols = columnsOf(o)
		local rows = ceil(n / cols)
		local colW, total = 0, 0
		for r = 0, rows - 1 do
			local rowH = 0
			for c = 1, cols do
				local it = items[r * cols + c]
				if it then
					if it.w > colW then colW = it.w end
					if it.h > rowH then rowH = it.h end
				end
			end
			total = total + rowH
		end
		return 2 * pad + cols * colW + gap * (cols - 1), 2 * pad + total + gap * max(0, rows - 1)
	end
	local along, across = 0, 0
	local row = kind == "row"
	for i = 1, n do
		local it = items[i]
		local a, b = it.w, it.h
		if not row then a, b = b, a end
		along = along + a
		if b > across then across = b end
	end
	along = along + gap * max(0, n - 1)
	if row then return 2 * pad + along, 2 * pad + across end
	return 2 * pad + across, 2 * pad + along
end

-- Where a run of pieces starts and how far apart they are, given the room
-- left over.
local function spread(justify, free, n, gap)
	if free <= 0 then return 0, gap end
	if justify == "center" then return free / 2, gap end
	if justify == "end" then return free, gap end
	if justify == "spaceBetween" and n > 1 then return 0, gap + free / (n - 1) end
	return 0, gap
end

-- A piece of size s across room of size room, starting at start.
local function across(align, start, room, s)
	if align == "stretch" then return start, room end
	if align == "center" then return start + (room - s) / 2, s end
	if align == "end" then return start + room - s, s end
	return start, s
end

local function put(out, i, x, y, w, h)
	local r = out[i]
	if not r then
		r = {}
		out[i] = r
	end
	-- Whole pixels, with no gaps or overlaps between neighbours.
	local x0, y0 = round(x), round(y)
	r[1], r[2], r[3], r[4] = x0, y0, max(0, round(x + w) - x0), max(0, round(y + h) - y0)
end

---Places the items in a container that is w by h: fills out[i] with
---{ x, y, width, height } measured from the container's top-left corner,
---and returns out.
function M.arrange(o, items, w, h, out)
	out = out or {}
	local n = #items
	local gap, pad = o.gap or 0, o.padding or 0
	local kind = o.kind
	local align, justify = o.align or "start", o.justify or "start"
	local innerW, innerH = max(0, w - 2 * pad), max(0, h - 2 * pad)
	if kind == "grid" then
		local cols = columnsOf(o)
		local rows = ceil(n / cols)
		local colW = max(0, (innerW - gap * (cols - 1)) / cols)
		local heights, total = {}, 0
		for r = 0, rows - 1 do
			local rowH = 0
			for c = 1, cols do
				local it = items[r * cols + c]
				if it and it.h > rowH then rowH = it.h end
			end
			heights[r + 1] = rowH
			total = total + rowH
		end
		local lead, between = spread(justify, innerH - total - gap * max(0, rows - 1), rows, gap)
		local y = pad + lead
		for r = 0, rows - 1 do
			local rowH = heights[r + 1]
			for c = 1, cols do
				local i = r * cols + c
				local it = items[i]
				if it then
					local cx, cw = across(align, pad + (c - 1) * (colW + gap), colW, it.w)
					local cy, ch = across(align, y, rowH, it.h)
					put(out, i, cx, cy, cw, ch)
				end
			end
			y = y + rowH + between
		end
	else
		local row = kind == "row"
		local room, cross = innerW, innerH
		if not row then room, cross = innerH, innerW end
		local total, grow = 0, 0
		for i = 1, n do
			local it = items[i]
			total = total + (row and it.w or it.h)
			local g = it.grow or 0
			if g > 0 then grow = grow + g end
		end
		local free = room - total - gap * max(0, n - 1)
		local share = 0
		if free > 0 and grow > 0 then
			share = free / grow
			free = 0
		end
		local lead, between = spread(justify, free, n, gap)
		local at = pad + lead
		for i = 1, n do
			local it = items[i]
			local g = it.grow or 0
			local size = (row and it.w or it.h) + (g > 0 and g * share or 0)
			local c, cs = across(align, pad, cross, row and it.h or it.w)
			if row then put(out, i, at, c, size, cs) else put(out, i, c, at, cs, size) end
			at = at + size + between
		end
	end
	for i = n + 1, #out do out[i] = nil end
	return out
end

return M
