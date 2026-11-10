-- A graph pathfinder: points you place and connect by hand, and the
-- cheapest way from one to another along the connections (A*).
--
--   local graph = smitten.paths.newGraph()
--   graph:addPoint("door", 100, 40)
--   graph:addPoint("stairs", 300, 40)
--   graph:connect("door", "stairs")
--   local ids = graph:findPath("door", "stairs")       -- {"door", "stairs"}
--   local path = graph:findPoints("door", "stairs")    -- {100, 40, 300, 40}
--
-- A point's id is any number or string. This file uses nothing of the
-- engine, so it runs under plain Lua (tools/paths-tests).

local heap = require("love.paths.heap")

local sqrt, huge = math.sqrt, math.huge

local Graph = {}
Graph.__index = Graph

local function new()
	local self = setmetatable({}, Graph)
	self._points = {}  -- id -> point
	self._list = {}    -- the points in the order they were added
	self._order = 0
	self._search = 0
	self._heap = heap.new()
	self._minWeight = nil -- worked out when a search needs it
	---Goes up whenever the graph changes: an agent following an older path plans again.
	self.version = 0
	return self
end

local function changed(self)
	self.version = self.version + 1
end

local function show(id)
	if type(id) == "string" then return ('"%s"'):format(id) end
	return tostring(id)
end

-- The point with an id, or an error naming the nearest id.
local function point(self, id, what, level)
	local p = self._points[id]
	if p then return p end
	if id == nil then error(("%s needs a point's id"):format(what), level + 1) end
	local hint = ""
	if type(id) == "string" then
		local ok, util = pcall(require, "love.engine.util")
		if ok then
			local names = {}
			for _, q in ipairs(self._list) do
				if type(q.id) == "string" then names[#names + 1] = q.id end
			end
			hint = util.didYouMean(id, names)
		end
	end
	error(("%s: this graph has no point %s%s. Add it first with graph:addPoint(id, x, y)"):format(what, show(id), hint), level + 1)
end

local function checkWeight(weight, what, level)
	if type(weight) ~= "number" or not (weight > 0) or weight == huge then
		error(("%s: a point's weight is a number above 0 (1 is normal, 3 makes going there cost three times as much)"):format(what), level + 1)
	end
end

---Adds a point (or moves the one with that id). Returns the id.
function Graph:addPoint(id, x, y, weight)
	if type(id) ~= "number" and type(id) ~= "string" then
		error("addPoint(id, x, y) needs an id first: a number or a name, like graph:addPoint(\"door\", 100, 40)", 2)
	end
	if type(x) ~= "number" or type(y) ~= "number" then error("addPoint(id, x, y) needs the point's position (two numbers)", 2) end
	if weight ~= nil then checkWeight(weight, "addPoint", 2) end
	local p = self._points[id]
	if p then
		p.x, p.y, p.weight = x, y, weight or p.weight
	else
		self._order = self._order + 1
		p = { id = id, x = x, y = y, weight = weight or 1, disabled = false, out = {}, order = self._order,
			g = 0, from = false, seen = 0, closed = 0 }
		self._points[id] = p
		self._list[#self._list + 1] = p
	end
	self._minWeight = nil
	changed(self)
	return id
end

local function unlink(from, to)
	local out = from.out
	for i = #out, 1, -1 do
		if out[i] == to then
			table.remove(out, i)
			return true
		end
	end
	return false
end

---Removes a point and its connections.
function Graph:removePoint(id)
	local p = point(self, id, "removePoint", 2)
	local list = self._list
	for i = #list, 1, -1 do
		if list[i] == p then
			table.remove(list, i)
		else
			unlink(list[i], p)
		end
	end
	self._points[id] = nil
	self._minWeight = nil
	changed(self)
end

function Graph:hasPoint(id)
	return self._points[id] ~= nil
end

---A point's position: x, y.
function Graph:getPosition(id)
	local p = point(self, id, "getPosition", 2)
	return p.x, p.y
end

function Graph:setPosition(id, x, y)
	local p = point(self, id, "setPosition", 2)
	if type(x) ~= "number" or type(y) ~= "number" then error("setPosition(id, x, y) needs the new position (two numbers)", 2) end
	p.x, p.y = x, y
	changed(self)
end

---Connects two points, both ways unless bothWays is false (then only a to b).
function Graph:connect(a, b, bothWays)
	local p, q = point(self, a, "connect", 2), point(self, b, "connect", 2)
	if p == q then error(("connect: point %s can't be connected to itself"):format(show(a)), 2) end
	unlink(p, q)
	p.out[#p.out + 1] = q
	if bothWays ~= false then
		unlink(q, p)
		q.out[#q.out + 1] = p
	end
	changed(self)
end

---Removes the connection between two points (only a to b if bothWays is false).
function Graph:disconnect(a, b, bothWays)
	local p, q = point(self, a, "disconnect", 2), point(self, b, "disconnect", 2)
	unlink(p, q)
	if bothWays ~= false then unlink(q, p) end
	changed(self)
end

---True if you can go straight from a to b.
function Graph:isConnected(a, b)
	local p, q = point(self, a, "isConnected", 2), point(self, b, "isConnected", 2)
	for i = 1, #p.out do
		if p.out[i] == q then return true end
	end
	return false
end

---A disabled point is left out of paths (a locked door) until it's enabled again.
function Graph:setDisabled(id, disabled)
	point(self, id, "setDisabled", 2).disabled = disabled ~= false
	changed(self)
end

function Graph:isDisabled(id)
	return point(self, id, "isDisabled", 2).disabled
end

function Graph:setWeight(id, weight)
	local p = point(self, id, "setWeight", 2)
	checkWeight(weight, "setWeight", 2)
	p.weight = weight
	self._minWeight = nil
	changed(self)
end

function Graph:getWeight(id)
	return point(self, id, "getWeight", 2).weight
end

---Every point's id, in the order they were added.
function Graph:points()
	local out = {}
	for i, p in ipairs(self._list) do out[i] = p.id end
	return out
end

---The ids of the points you can go straight to from a point.
function Graph:neighbors(id)
	local p = point(self, id, "neighbors", 2)
	local out = {}
	for i, q in ipairs(p.out) do out[i] = q.id end
	return out
end

---Removes every point.
function Graph:clear()
	self._points, self._list = {}, {}
	self._minWeight = nil
	changed(self)
end

---The id of the point nearest a position (nil if the graph is empty).
---Disabled points are skipped unless includeDisabled is true.
function Graph:closestPoint(x, y, includeDisabled)
	if type(x) ~= "number" or type(y) ~= "number" then error("closestPoint(x, y) needs a position (two numbers)", 2) end
	local best, bestD = nil, huge
	local list = self._list
	for i = 1, #list do
		local p = list[i]
		if includeDisabled or not p.disabled then
			local dx, dy = p.x - x, p.y - y
			local d = dx * dx + dy * dy
			if d < bestD then best, bestD = p, d end
		end
	end
	return best and best.id
end

---The nearest position on any connection (or lone point): x, y, then the
---ids of the two points it lies between. nil if the graph is empty.
function Graph:closestPosition(x, y)
	if type(x) ~= "number" or type(y) ~= "number" then error("closestPosition(x, y) needs a position (two numbers)", 2) end
	local bx, by, ba, bb, bestD = nil, nil, nil, nil, huge
	local list = self._list
	for i = 1, #list do
		local p = list[i]
		if not p.disabled then
			local dx, dy = p.x - x, p.y - y
			local d = dx * dx + dy * dy
			if d < bestD then bx, by, ba, bb, bestD = p.x, p.y, p.id, p.id, d end
			local out = p.out
			for j = 1, #out do
				local q = out[j]
				if not q.disabled then
					local ex, ey = q.x - p.x, q.y - p.y
					local len = ex * ex + ey * ey
					if len > 0 then
						local t = ((x - p.x) * ex + (y - p.y) * ey) / len
						if t > 0 and t < 1 then
							local cx, cy = p.x + ex * t, p.y + ey * t
							dx, dy = cx - x, cy - y
							d = dx * dx + dy * dy
							if d < bestD then bx, by, ba, bb, bestD = cx, cy, p.id, q.id, d end
						end
					end
				end
			end
		end
	end
	return bx, by, ba, bb
end

local function minWeight(self)
	local m = self._minWeight
	if m then return m end
	m = 1
	for _, p in ipairs(self._list) do
		if p.weight < m then m = p.weight end
	end
	self._minWeight = m
	return m
end

-- A* from point s to point t. Returns the point the path ends at (t, or
-- with partial the reached point nearest it), or nil; the path is in .from.
local function search(self, s, t, partial)
	local id = self._search + 1
	self._search = id
	local hp = self._heap
	heap.clear(hp)
	local push, pop = heap.push, heap.pop
	local costFn, estimateFn = self.cost, self.estimate
	local scale = minWeight(self)
	local tx, ty, tid = t.x, t.y, t.id

	local h0
	if estimateFn then
		h0 = estimateFn(s.id, tid)
	else
		local dx, dy = tx - s.x, ty - s.y
		h0 = sqrt(dx * dx + dy * dy) * scale
	end
	s.g, s.from, s.seen = 0, false, id
	push(hp, s, h0, h0, s.order)
	local best, bestH, bestG = s, h0, 0

	while true do
		local cur, f = pop(hp)
		if not cur then break end
		if cur.closed ~= id then
			cur.closed = id
			if cur == t then return t end
			local cg = cur.g
			if partial then
				local h = f - cg
				if h < bestH or (h == bestH and cg < bestG) then best, bestH, bestG = cur, h, cg end
			end
			local out = cur.out
			for i = 1, #out do
				local q = out[i]
				if not q.disabled and q.closed ~= id then
					local step
					if costFn then
						step = costFn(cur.id, q.id)
					else
						local dx, dy = q.x - cur.x, q.y - cur.y
						step = sqrt(dx * dx + dy * dy)
					end
					if step then
						local ng = cg + step * q.weight
						if q.seen ~= id or ng < q.g then
							q.g, q.from, q.seen = ng, cur, id
							local h
							if estimateFn then
								h = estimateFn(q.id, tid)
							else
								local dx, dy = tx - q.x, ty - q.y
								h = sqrt(dx * dx + dy * dy) * scale
							end
							push(hp, q, ng + h, h, q.order)
						end
					end
				end
			end
		end
	end
	if partial then return best end
	return nil
end

local function find(self, a, b, options, what, positions)
	local s, t = point(self, a, what, 3), point(self, b, what, 3)
	local partial = false
	if options ~= nil then
		if type(options) ~= "table" then error(what .. "'s last argument is a table of options, like { partial = true }", 3) end
		partial = options.partial == true
	end
	if s.disabled then return nil end
	if t.disabled and not partial then return nil end
	local last = search(self, s, t, partial)
	if not last then return nil end
	local n = 0
	local p = last
	while p do
		n = n + 1
		p = p.from
	end
	local out = {}
	p = last
	if positions then
		for i = n, 1, -1 do
			out[i * 2 - 1], out[i * 2] = p.x, p.y
			p = p.from
		end
	else
		for i = n, 1, -1 do
			out[i] = p.id
			p = p.from
		end
	end
	return out
end

---The cheapest path from point a to point b as a list of ids (a first, b
---last), or nil if there's no way. With { partial = true }, a path to the
---reachable point nearest b.
function Graph:findPath(a, b, options)
	return find(self, a, b, options, "findPath", false)
end

---Like findPath, but the points' positions as a flat list: {x, y, x, y, ...}.
function Graph:findPoints(a, b, options)
	return find(self, a, b, options, "findPoints", true)
end

-- For agents: walk to the nearest point, then along the graph to the point
-- nearest the target.
function Graph:_follow(x1, y1, x2, y2, options)
	local a, b = self:closestPoint(x1, y1), self:closestPoint(x2, y2)
	if a == nil or b == nil then return nil end
	return find(self, a, b, options, "findPoints", true)
end

return { new = new, Graph = Graph }
