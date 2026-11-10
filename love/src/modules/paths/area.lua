-- Walkable areas: polygons that say where things can walk, with holes cut
-- out of them, and the short way from one point to another that stays
-- inside (what other engines call a navigation mesh).
--
--   local area = smitten.paths.newArea({ { 0, 0, 400, 0, 400, 300, 0, 300 } },   -- areas
--                                      { { 150, 100, 250, 100, 250, 200, 150, 200 } })  -- holes
--   local path = area:findPath(20, 150, 380, 150)    -- {x, y, x, y, ...} around the hole
--
-- How it works: every polygon is cut into convex pieces (ear clipping, then
-- joining triangles while they stay convex). Areas that overlap are made
-- not to (a piece minus a convex piece is a few convex pieces), and holes
-- are taken out the same way. Pieces that share part of an edge are
-- neighbours through that part (a "door"). A search walks from piece to
-- piece through doors (A*), and the doors it went through are pulled tight
-- like a string (the funnel algorithm), which gives a path that hugs
-- corners.
--
-- This file uses nothing of the engine, so it runs under plain Lua
-- (tools/paths-tests).

local heap = require("love.paths.heap")

local sqrt, abs, huge, floor = math.sqrt, math.abs, math.huge, math.floor

local Area = {}
Area.__index = Area

---------------------------------------------------------------------------
-- Polygons into convex pieces

-- A polygon's points as two lists without repeats, turned so its area
-- (x1*y2 - x2*y1 summed) is positive; nil if it has no area.
local function clean(points, eps)
	local xs, ys, n = {}, {}, 0
	for i = 1, #points - 1, 2 do
		local x, y = points[i], points[i + 1]
		if type(x) ~= "number" or type(y) ~= "number" then return nil end
		if n == 0 or abs(x - xs[n]) > eps or abs(y - ys[n]) > eps then
			n = n + 1
			xs[n], ys[n] = x, y
		end
	end
	if n > 1 and abs(xs[1] - xs[n]) <= eps and abs(ys[1] - ys[n]) <= eps then
		xs[n], ys[n] = nil, nil
		n = n - 1
	end
	if n < 3 then return nil end
	local area2 = 0
	for i = 1, n do
		local j = i % n + 1
		area2 = area2 + xs[i] * ys[j] - xs[j] * ys[i]
	end
	if abs(area2) <= eps then return nil end
	if area2 < 0 then
		for i = 1, floor(n / 2) do
			xs[i], xs[n + 1 - i] = xs[n + 1 - i], xs[i]
			ys[i], ys[n + 1 - i] = ys[n + 1 - i], ys[i]
		end
	end
	return xs, ys, n
end

-- Ear clipping: a list of triangles, each three indexes into xs, ys.
local function triangulate(xs, ys, n, eps)
	local idx = {}
	for i = 1, n do idx[i] = i end
	local tris = {}
	local count = n
	while count > 3 do
		local clipped = false
		local fallback = nil
		for k = 1, count do
			local ip, ic, inx = idx[(k - 2) % count + 1], idx[k], idx[k % count + 1]
			local px, py, cx, cy, nx, ny = xs[ip], ys[ip], xs[ic], ys[ic], xs[inx], ys[inx]
			local c = (cx - px) * (ny - py) - (cy - py) * (nx - px)
			if abs(c) <= eps then
				-- Three corners in a line: the middle one isn't needed.
				table.remove(idx, k)
				clipped = true
				break
			elseif c > 0 then
				fallback = fallback or k
				local ear = true
				for m = 1, count do
					local j = idx[m]
					if j ~= ip and j ~= ic and j ~= inx then
						local x, y = xs[j], ys[j]
						if (cx - px) * (y - py) - (cy - py) * (x - px) >= -eps
							and (nx - cx) * (y - cy) - (ny - cy) * (x - cx) >= -eps
							and (px - nx) * (y - ny) - (py - ny) * (x - nx) >= -eps
							and not ((x == px and y == py) or (x == cx and y == cy) or (x == nx and y == ny)) then
							ear = false
							break
						end
					end
				end
				if ear then
					tris[#tris + 1] = { ip, ic, inx }
					table.remove(idx, k)
					clipped = true
					break
				end
			end
		end
		if not clipped then
			-- A polygon that crosses itself has no clean answer: cut off
			-- some corner anyway so this ends.
			local k = fallback or 1
			tris[#tris + 1] = { idx[(k - 2) % count + 1], idx[k], idx[k % count + 1] }
			table.remove(idx, k)
		end
		count = #idx
	end
	if count == 3 then
		local a, b, c = idx[1], idx[2], idx[3]
		if (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]) > eps then tris[#tris + 1] = { a, b, c } end
	end
	return tris
end

local function isConvex(poly, xs, ys, eps)
	local n = #poly
	for i = 1, n do
		local a, b, c = poly[i], poly[i % n + 1], poly[(i + 1) % n + 1]
		if (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]) < -eps then return false end
	end
	return true
end

-- Two index polygons joined along a shared edge, or nil if they share none.
local function joined(p, q)
	local np, nq = #p, #q
	for i = 1, np do
		local a, b = p[i], p[i % np + 1]
		for j = 1, nq do
			if q[j] == b and q[j % nq + 1] == a then
				local out = {}
				-- p from b round to a, then q after a round to before b.
				for k = 0, np - 1 do out[#out + 1] = p[(i + k) % np + 1] end
				for k = 1, nq - 2 do out[#out + 1] = q[(j + k) % nq + 1] end
				return out
			end
		end
	end
	return nil
end

-- Joins neighbouring pieces while the result stays convex.
local function mergeConvex(polys, xs, ys, eps)
	local merged = true
	while merged do
		merged = false
		for a = 1, #polys do
			local b = a + 1
			while b <= #polys do
				local m = joined(polys[a], polys[b])
				if m and isConvex(m, xs, ys, eps) then
					polys[a] = m
					table.remove(polys, b)
					merged = true
				else
					b = b + 1
				end
			end
		end
	end
	return polys
end

-- Gives a convex piece (a flat list of points) its box; nil if it's too
-- small to matter.
local function finish(poly, eps)
	local n = #poly / 2
	if n < 3 then return nil end
	local x0, y0, x1, y1 = huge, huge, -huge, -huge
	local area2 = 0
	for i = 1, n do
		local x, y = poly[i * 2 - 1], poly[i * 2]
		local j = i % n + 1
		area2 = area2 + x * poly[j * 2] - poly[j * 2 - 1] * y
		if x < x0 then x0 = x end
		if x > x1 then x1 = x end
		if y < y0 then y0 = y end
		if y > y1 then y1 = y end
	end
	if area2 <= eps then return nil end
	poly.n, poly.x0, poly.y0, poly.x1, poly.y1 = n, x0, y0, x1, y1
	return poly
end

-- A polygon as a list of convex pieces.
local function convexPieces(points, eps)
	local xs, ys, n = clean(points, eps)
	if not xs then return {} end
	local polys = mergeConvex(triangulate(xs, ys, n, eps), xs, ys, eps)
	local out = {}
	for _, p in ipairs(polys) do
		local flat = {}
		for i, v in ipairs(p) do flat[i * 2 - 1], flat[i * 2] = xs[v], ys[v] end
		out[#out + 1] = finish(flat, eps)
	end
	return out
end

local dist = {} -- reused: each corner's distance from the cutting line

-- Cuts a convex piece along the line a -> b: the part on the left (where
-- the cross product is positive), the part on the right. Either can be nil.
local function split(poly, ax, ay, bx, by, eps)
	local n = poly.n
	local dx, dy = bx - ax, by - ay
	local len = sqrt(dx * dx + dy * dy)
	if len == 0 then return poly, nil end
	local anyIn, anyOut = false, false
	for i = 1, n do
		local d = (dx * (poly[i * 2] - ay) - dy * (poly[i * 2 - 1] - ax)) / len
		if d > eps then anyIn = true elseif d < -eps then anyOut = true else d = 0 end
		dist[i] = d
	end
	if not anyOut then return poly, nil end
	if not anyIn then return nil, poly end
	local inside, outside = {}, {}
	local ni, no = 0, 0
	for i = 1, n do
		local j = i % n + 1
		local di, dj = dist[i], dist[j]
		local x, y = poly[i * 2 - 1], poly[i * 2]
		if di >= 0 then
			inside[ni + 1], inside[ni + 2] = x, y
			ni = ni + 2
		end
		if di <= 0 then
			outside[no + 1], outside[no + 2] = x, y
			no = no + 2
		end
		if (di > 0 and dj < 0) or (di < 0 and dj > 0) then
			local t = di / (di - dj)
			local cx, cy = x + (poly[j * 2 - 1] - x) * t, y + (poly[j * 2] - y) * t
			inside[ni + 1], inside[ni + 2] = cx, cy
			ni = ni + 2
			outside[no + 1], outside[no + 2] = cx, cy
			no = no + 2
		end
	end
	return finish(inside, eps), finish(outside, eps)
end

-- Adds what's left of convex piece `poly` after taking convex piece `cut`
-- out of it to `out`.
local function subtract(poly, cut, out, eps)
	if poly.x1 <= cut.x0 + eps or poly.x0 >= cut.x1 - eps or poly.y1 <= cut.y0 + eps or poly.y0 >= cut.y1 - eps then
		out[#out + 1] = poly
		return
	end
	local first = #out
	local rest = poly
	local n = cut.n
	for i = 1, n do
		local j = i % n + 1
		local inside, outside = split(rest, cut[i * 2 - 1], cut[i * 2], cut[j * 2 - 1], cut[j * 2], eps)
		if outside then out[#out + 1] = outside end
		rest = inside
		if not rest then
			-- They don't overlap after all: keep the piece whole.
			for k = #out, first + 1, -1 do out[k] = nil end
			out[first + 1] = poly
			return
		end
	end
	-- `rest` is the part inside the cut: dropped.
end

local function subtractAll(pieces, cut, eps)
	local out = {}
	for i = 1, #pieces do subtract(pieces[i], cut, out, eps) end
	return out
end

---------------------------------------------------------------------------
-- Building

-- The doors between two pieces: the parts of their edges that lie on each
-- other. Each piece gets the door along its own direction (a -> b, with
-- the piece on the left).
local function connect(p, q, pi, qi, eps)
	local tol, least = eps * 4, eps * 16
	local np, nq = p.n, q.n
	for i = 1, np do
		local j = i % np + 1
		local ax, ay, bx, by = p[i * 2 - 1], p[i * 2], p[j * 2 - 1], p[j * 2]
		local ux, uy = bx - ax, by - ay
		local len = sqrt(ux * ux + uy * uy)
		if len > least then
			ux, uy = ux / len, uy / len
			for k = 1, nq do
				local l = k % nq + 1
				local cx, cy, ex, ey = q[k * 2 - 1], q[k * 2], q[l * 2 - 1], q[l * 2]
				if (ex - cx) * ux + (ey - cy) * uy < 0
					and abs(ux * (cy - ay) - uy * (cx - ax)) <= tol and abs(ux * (ey - ay) - uy * (ex - ax)) <= tol then
					-- q's edge runs the other way: from t2 down to t1 along p's edge.
					local t1 = (ex - ax) * ux + (ey - ay) * uy
					local t2 = (cx - ax) * ux + (cy - ay) * uy
					if t1 < 0 then t1 = 0 end
					if t2 > len then t2 = len end
					if t2 - t1 > least then
						local x1, y1, x2, y2 = ax + ux * t1, ay + uy * t1, ax + ux * t2, ay + uy * t2
						p.doors[#p.doors + 1] = { to = qi, ax = x1, ay = y1, bx = x2, by = y2, seen = 0, closed = 0 }
						q.doors[#q.doors + 1] = { to = pi, ax = x2, ay = y2, bx = x1, by = y1, seen = 0, closed = 0 }
					end
				end
			end
		end
	end
end

local function isPolygon(t)
	return type(t) == "table" and type(t[1]) == "number"
end

local function polygonList(list, what)
	if list == nil then return {} end
	if type(list) ~= "table" then
		error(("newArea: %s must be a list of polygons, each a list of corner points {x1, y1, x2, y2, x3, y3, ...}"):format(what), 3)
	end
	if isPolygon(list) then list = { list } end
	for i, poly in ipairs(list) do
		if not isPolygon(poly) or #poly < 6 or #poly % 2 ~= 0 then
			error(("newArea: polygon %d of the %s needs at least 3 corners as {x1, y1, x2, y2, x3, y3, ...}"):format(i, what), 3)
		end
	end
	return list
end

---Makes a walkable area from polygons (flat lists of corner points) and
---polygons to cut out of them.
local function new(areas, holes)
	areas, holes = polygonList(areas, "areas"), polygonList(holes, "holes")
	local extent = 1
	for _, list in ipairs({ areas, holes }) do
		for _, poly in ipairs(list) do
			for i = 1, #poly do
				local v = abs(poly[i])
				if v > extent and v < huge then extent = v end
			end
		end
	end
	local eps = extent * 1e-7

	-- Areas, each without the ones before it, so no two pieces overlap.
	local pieces, before = {}, {}
	for _, poly in ipairs(areas) do
		local own = convexPieces(poly, eps)
		local rest = own
		for i = 1, #before do
			if #rest == 0 then break end
			rest = subtractAll(rest, before[i], eps)
		end
		for i = 1, #rest do pieces[#pieces + 1] = rest[i] end
		for i = 1, #own do before[#before + 1] = own[i] end
	end
	for _, poly in ipairs(holes) do
		for _, cut in ipairs(convexPieces(poly, eps)) do
			pieces = subtractAll(pieces, cut, eps)
		end
	end

	local n = #pieces
	for i = 1, n do pieces[i].doors = {} end
	for i = 1, n do
		local p = pieces[i]
		for j = i + 1, n do
			local q = pieces[j]
			if p.x1 >= q.x0 - eps and p.x0 <= q.x1 + eps and p.y1 >= q.y0 - eps and p.y0 <= q.y1 + eps then
				connect(p, q, i, j, eps)
			end
		end
	end

	local self = setmetatable({}, Area)
	self._pieces, self._eps = pieces, eps
	-- Doors in a fixed order, so equal paths always come out the same.
	local order = 0
	self._checked = {}
	for i = 1, n do
		self._checked[i] = 0
		for _, door in ipairs(pieces[i].doors) do
			order = order + 1
			door.order = order
		end
	end
	self._search = 0
	self._heap = heap.new()
	self._lx, self._ly, self._rx, self._ry = {}, {}, {}, {}
	self.version = 0
	return self
end

---------------------------------------------------------------------------
-- Questions

local function inside(p, x, y, eps)
	if x < p.x0 - eps or x > p.x1 + eps or y < p.y0 - eps or y > p.y1 + eps then return false end
	local n = p.n
	local ax, ay = p[n * 2 - 1], p[n * 2]
	for i = 1, n do
		local bx, by = p[i * 2 - 1], p[i * 2]
		local c = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
		if c < 0 then
			-- Outside this edge's line: allowed only within eps of it.
			local dx, dy = bx - ax, by - ay
			if c * c > eps * eps * (dx * dx + dy * dy) then return false end
		end
		ax, ay = bx, by
	end
	return true
end

local function locate(self, x, y)
	local pieces, eps = self._pieces, self._eps
	for i = 1, #pieces do
		if inside(pieces[i], x, y, eps) then return i end
	end
	return nil
end

-- The nearest point of a convex piece's edge to a point: x, y, distance squared.
local function nearestOnPiece(p, x, y)
	local n = p.n
	local bestX, bestY, bestD = x, y, huge
	local ax, ay = p[n * 2 - 1], p[n * 2]
	for i = 1, n do
		local bx, by = p[i * 2 - 1], p[i * 2]
		local dx, dy = bx - ax, by - ay
		local len = dx * dx + dy * dy
		local t = len > 0 and ((x - ax) * dx + (y - ay) * dy) / len or 0
		if t < 0 then t = 0 elseif t > 1 then t = 1 end
		local cx, cy = ax + dx * t, ay + dy * t
		local d = (cx - x) * (cx - x) + (cy - y) * (cy - y)
		if d < bestD then bestX, bestY, bestD = cx, cy, d end
		ax, ay = bx, by
	end
	return bestX, bestY, bestD
end

-- The walkable point nearest a point: x, y, the piece it's in (nil if the
-- area is empty).
local function nearest(self, x, y)
	local at = locate(self, x, y)
	if at then return x, y, at end
	local pieces = self._pieces
	local bestX, bestY, bestD, best = nil, nil, huge, nil
	for i = 1, #pieces do
		local p = pieces[i]
		-- Skip pieces whose box is already further than the best so far.
		local bx = x < p.x0 and p.x0 - x or x > p.x1 and x - p.x1 or 0
		local by = y < p.y0 and p.y0 - y or y > p.y1 and y - p.y1 or 0
		if bx * bx + by * by < bestD then
			local cx, cy, d = nearestOnPiece(p, x, y)
			if d < bestD then bestX, bestY, bestD, best = cx, cy, d, i end
		end
	end
	return bestX, bestY, best
end

---True if a point is inside the area (and not in a hole).
function Area:isWalkable(x, y)
	if type(x) ~= "number" or type(y) ~= "number" then error("isWalkable(x, y) needs a point (two numbers)", 2) end
	return locate(self, x, y) ~= nil
end

---The walkable point nearest a point: x, y (the point itself if it's
---walkable; nil if the area is empty).
function Area:closestPoint(x, y)
	if type(x) ~= "number" or type(y) ~= "number" then error("closestPoint(x, y) needs a point (two numbers)", 2) end
	local cx, cy = nearest(self, x, y)
	return cx, cy
end

---The convex pieces the area is made of, each a flat list of points (for
---drawing them; don't change them).
function Area:pieces()
	return self._pieces
end

-- Pulls the string tight through n doors (their left ends in lx, ly, right
-- ends in rx, ry) from s to g. Returns the corners as a flat list.
local function funnel(sx, sy, gx, gy, lx, ly, rx, ry, n, eps)
	local out = { sx, sy }
	local k = 2
	local ax, ay = sx, sy          -- the apex
	local plx, ply, prx, pry = sx, sy, sx, sy
	local apexI, leftI, rightI = 0, 0, 0
	local tiny = eps * eps
	local i = 1
	while i <= n + 1 do
		local nlx, nly, nrx, nry
		if i > n then nlx, nly, nrx, nry = gx, gy, gx, gy else nlx, nly, nrx, nry = lx[i], ly[i], rx[i], ry[i] end
		local restart = false
		-- The right side moves in (or stays).
		if (prx - ax) * (nry - ay) - (pry - ay) * (nrx - ax) >= 0 then
			if ((ax - prx) * (ax - prx) + (ay - pry) * (ay - pry) <= tiny) or (plx - ax) * (nry - ay) - (ply - ay) * (nrx - ax) < 0 then
				prx, pry, rightI = nrx, nry, i
			else
				-- It crossed the left side: the left corner is on the path.
				out[k + 1], out[k + 2] = plx, ply
				k = k + 2
				ax, ay, apexI = plx, ply, leftI
				prx, pry, rightI = ax, ay, apexI
				i = apexI + 1
				restart = true
			end
		end
		if not restart then
			if (plx - ax) * (nly - ay) - (ply - ay) * (nlx - ax) <= 0 then
				if ((ax - plx) * (ax - plx) + (ay - ply) * (ay - ply) <= tiny) or (prx - ax) * (nly - ay) - (pry - ay) * (nlx - ax) > 0 then
					plx, ply, leftI = nlx, nly, i
				else
					out[k + 1], out[k + 2] = prx, pry
					k = k + 2
					ax, ay, apexI = prx, pry, rightI
					plx, ply, leftI = ax, ay, apexI
					i = apexI + 1
					restart = true
				end
			end
			if not restart then i = i + 1 end
		end
	end
	if abs(out[k - 1] - gx) > eps or abs(out[k] - gy) > eps or k == 2 then
		out[k + 1], out[k + 2] = gx, gy
	end
	return out
end

---The short way from one point to another that stays inside the area: a
---flat list of points {x, y, x, y, ...} from the first to the last, or nil
---if there's no way. A point outside the area counts as the nearest
---walkable point. With { partial = true }, when the goal can't be reached
---the path goes as near to it as it can.
function Area:findPath(x1, y1, x2, y2, options)
	if type(x1) ~= "number" or type(y1) ~= "number" or type(x2) ~= "number" or type(y2) ~= "number" then
		error("findPath(x1, y1, x2, y2) needs two points (four numbers)", 2)
	end
	local partial = false
	if options ~= nil then
		if type(options) ~= "table" then error("findPath's last argument is a table of options, like { partial = true }", 2) end
		partial = options.partial == true
	end
	local sx, sy, sp = nearest(self, x1, y1)
	local gx, gy, gp = nearest(self, x2, y2)
	if not sp or not gp then return nil end
	if sp == gp then return { sx, sy, gx, gy } end

	-- The search goes from door to door (a door is one way through an
	-- edge, into the piece on its other side). A door's cost is the way to
	-- it so far, going through each door where the straight line to the goal
	-- crosses it (or at the door's nearest end).
	local pieces, eps = self._pieces, self._eps
	local id = self._search + 1
	self._search = id
	local hp = self._heap
	heap.clear(hp)
	local push, pop = heap.push, heap.pop
	local checked = self._checked
	local tinyDen = 1e-12

	local last = nil           -- the door the goal was reached through
	local best, bestD, bestX, bestY, bestDoor = sp, huge, sx, sy, nil
	if partial then
		bestX, bestY, bestD = nearestOnPiece(pieces[sp], gx, gy)
		checked[sp] = id
	end
	local cur = nil            -- nil: the start; then the door being left
	local cg, cx, cy, at = 0, sx, sy, sp
	while true do
		if at == gp then
			-- Reaching the goal's piece: the goal itself is one more step.
			local h = sqrt((gx - cx) * (gx - cx) + (gy - cy) * (gy - cy))
			push(hp, cur, cg + h, -1, cur.order)
		else
			local doors = pieces[at].doors
			for i = 1, #doors do
				local door = doors[i]
				if door.closed ~= id then
					local dx, dy = door.bx - door.ax, door.by - door.ay
					-- Where the straight line to the goal crosses the door's
					-- line (kept on the door).
					local wx, wy = gx - cx, gy - cy
					local den = dx * wy - dy * wx
					local t
					if den > tinyDen or den < -tinyDen then
						t = ((cx - door.ax) * wy - (cy - door.ay) * wx) / den
					else
						t = ((cx - door.ax) * dx + (cy - door.ay) * dy) / (dx * dx + dy * dy)
					end
					if t < 0 then t = 0 elseif t > 1 then t = 1 end
					local nx, ny = door.ax + dx * t, door.ay + dy * t
					local ng = cg + sqrt((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy))
					if door.seen ~= id or ng < door.g then
						door.g, door.ex, door.ey, door.from, door.seen = ng, nx, ny, cur, id
						local h = sqrt((gx - nx) * (gx - nx) + (gy - ny) * (gy - ny))
						push(hp, door, ng + h, h, door.order)
					end
				end
			end
		end
		-- The next door to leave through.
		local h
		repeat
			cur, h = pop(hp)
			if cur then h = hp.lastH end
		until not cur or h == -1 or cur.closed ~= id
		if not cur then break end
		if h == -1 then
			last = cur
			break
		end
		cur.closed = id
		cg, cx, cy, at = cur.g, cur.ex, cur.ey, cur.to
		if partial and checked[at] ~= id then
			checked[at] = id
			local px, py, d = nearestOnPiece(pieces[at], gx, gy)
			if d < bestD then best, bestD, bestX, bestY, bestDoor = at, d, px, py, cur end
		end
	end
	if not last then
		if not partial then return nil end
		gp, gx, gy, last = best, bestX, bestY, bestDoor
		if not last then return { sx, sy, gx, gy } end
	end

	-- The doors from the start to the goal. Leaving a piece through a door
	-- that runs a -> b along its edge, b is on the left.
	local lx, ly, rx, ry = self._lx, self._ly, self._rx, self._ry
	local n = 0
	local door = last
	while door do
		n = n + 1
		door = door.from
	end
	door = last
	for i = n, 1, -1 do
		lx[i], ly[i], rx[i], ry[i] = door.bx, door.by, door.ax, door.ay
		door = door.from
	end
	return funnel(sx, sy, gx, gy, lx, ly, rx, ry, n, eps)
end

Area._follow = Area.findPath

return { new = new, Area = Area }
