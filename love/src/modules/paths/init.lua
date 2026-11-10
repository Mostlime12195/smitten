-- smitten.paths: finding a way from one place to another.
--
-- Three pathfinders, to use on their own or together:
--
--   grids    cells that are open or solid, for tile games:
--              local grid = Ground:newPathGrid()     -- from a Tiles piece
--              local grid = smitten.paths.newGrid(40, 30, { cellSize = 16 })
--   graphs   points you place and connect by hand (waypoints, rooms):
--              local graph = smitten.paths.newGraph()
--   areas    polygons to walk around freely in, with holes: the scene's
--            Walkable pieces, or smitten.paths.newArea(areas, holes):
--              local path = smitten.paths.findPath(x, y, targetX, targetY)
--
-- A path is always a flat list of points, {x1, y1, x2, y2, ...}, like a
-- Shape's points, or nil when there's no way. Nothing here moves a piece:
-- a script reads the path and moves its piece however it likes. An agent
-- (newAgent) only remembers a path and says which point to head for next.
--
-- grid.lua, graph.lua and area.lua use nothing of the engine and are
-- tested under plain Lua (tools/paths-tests).

local gridLib = require("love.paths.grid")
local graphLib = require("love.paths.graph")
local areaLib = require("love.paths.area")

local sqrt = math.sqrt

local paths = {}

---A grid of open cells: newGrid(40, 30, { cellSize = 16, diagonals = "noCorners" }).
function paths.newGrid(columns, rows, options)
	local grid = gridLib.new(columns, rows, options)
	return grid
end

---An empty graph: add points and connect them.
function paths.newGraph()
	return graphLib.new()
end

---A walkable area from polygons and holes: newArea({ polygon, ... }, { hole, ... }).
function paths.newArea(areas, holes)
	local area = areaLib.new(areas, holes)
	return area
end

---------------------------------------------------------------------------
-- Paths as lists of points

local function checkPath(path, what, level)
	if type(path) ~= "table" or #path % 2 ~= 0 then
		error(("%s needs a path: a flat list of points {x1, y1, x2, y2, ...}"):format(what), level + 1)
	end
end

---How long a path is, in pixels.
function paths.length(path)
	checkPath(path, "length(path)", 2)
	local total = 0
	for i = 3, #path, 2 do
		local dx, dy = path[i] - path[i - 2], path[i + 1] - path[i - 1]
		total = total + sqrt(dx * dx + dy * dy)
	end
	return total
end

---The point a distance along a path from its start: x, y, and true once
---the distance reaches the path's end.
function paths.pointAt(path, distance)
	checkPath(path, "pointAt(path, distance)", 2)
	if type(distance) ~= "number" then error("pointAt(path, distance) needs how far along the path, in pixels", 2) end
	local n = #path
	if n == 0 then return nil end
	if distance <= 0 then return path[1], path[2], n == 2 end
	for i = 3, n, 2 do
		local x0, y0 = path[i - 2], path[i - 1]
		local dx, dy = path[i] - x0, path[i + 1] - y0
		local len = sqrt(dx * dx + dy * dy)
		if distance < len then
			local t = distance / len
			return x0 + dx * t, y0 + dy * t, false
		end
		distance = distance - len
	end
	return path[n - 1], path[n], true
end

---------------------------------------------------------------------------
-- The scene's Walkable pieces

local walkables = {}  -- the Walkable pieces in the running scene, in the order they joined
local cache = {}      -- tags -> { sig = {...}, n = count, area = area, version = n }
local cached = 0
local builds = 0

function paths._add(piece)
	walkables[#walkables + 1] = piece
end

function paths._remove(piece)
	for i = #walkables, 1, -1 do
		if walkables[i] == piece then table.remove(walkables, i) end
	end
end

local function tagsOf(options, what, level)
	if options == nil then return "" end
	if type(options) == "string" then return options end
	if type(options) == "table" then
		local tags = options.tags
		if tags == nil then return "" end
		if type(tags) == "string" then return tags end
	end
	error(("%s: tags is a list of tags in one string, like \"land, bridge\""):format(what), level + 1)
end

-- The area made of the scene's Walkable pieces (those with one of the
-- tags, if any are given). It's built again only when one of the pieces
-- was added, removed, moved or changed: `sig` remembers what it was built
-- from.
local function sceneEntry(tags)
	local entry = cache[tags]
	if not entry then
		if cached >= 16 then cache, cached = {}, 0 end
		entry = { sig = {}, n = -1, version = 0 }
		cache[tags] = entry
		cached = cached + 1
	end
	local sig = entry.sig
	local same = entry.area ~= nil
	local k = 0
	local count = #walkables
	if count > 0 then
		local globalMatrix = require("love.scene.nodes2d").globalMatrix
		for i = 1, count do
			local w = walkables[i]
			if w.active and not w._dead and (tags == "" or w:hasAnyTag(tags)) then
				local points, hole = w.points, w.hole
				local a, b, c, d, tx, ty = globalMatrix(w)
				if same and (sig[k + 1] ~= w or sig[k + 2] ~= points or sig[k + 3] ~= #points or sig[k + 4] ~= hole
					or sig[k + 5] ~= a or sig[k + 6] ~= b or sig[k + 7] ~= c or sig[k + 8] ~= d
					or sig[k + 9] ~= tx or sig[k + 10] ~= ty) then
					same = false
				end
				sig[k + 1], sig[k + 2], sig[k + 3], sig[k + 4] = w, points, #points, hole
				sig[k + 5], sig[k + 6], sig[k + 7], sig[k + 8], sig[k + 9], sig[k + 10] = a, b, c, d, tx, ty
				k = k + 10
			end
		end
	end
	if same and entry.n == k then return entry end
	for i = #sig, k + 1, -1 do sig[i] = nil end
	entry.n = k
	local areas, holes = {}, {}
	for i = 1, k, 10 do
		local points = sig[i + 1]
		local a, b, c, d, tx, ty = sig[i + 4], sig[i + 5], sig[i + 6], sig[i + 7], sig[i + 8], sig[i + 9]
		local n = math.floor(#points / 2)
		if n >= 3 then
			local poly = {}
			for j = 1, n do
				local x, y = points[j * 2 - 1], points[j * 2]
				if type(x) ~= "number" or type(y) ~= "number" then
					error(("%s: points must be numbers: x1, y1, x2, y2, ..."):format(tostring(sig[i])), 0)
				end
				poly[j * 2 - 1], poly[j * 2] = a * x + c * y + tx, b * x + d * y + ty
			end
			if sig[i + 3] then holes[#holes + 1] = poly else areas[#areas + 1] = poly end
		end
	end
	entry.area = areaLib.new(areas, holes)
	builds = builds + 1
	entry.version = builds
	return entry
end

local warned = false

local function sceneArea(tags)
	if #walkables == 0 and not warned then
		warned = true
		print("smitten.paths: this scene has no Walkable pieces, so there's nowhere to walk. Add a Walkable piece, or use a grid or a graph.")
	end
	return sceneEntry(tags).area
end

local function numbers(what, level, ...)
	for i = 1, select("#", ...) do
		if type((select(i, ...))) ~= "number" then error(what, level + 1) end
	end
end

---The short way between two points through the scene's Walkable pieces: a
---flat list of points {x, y, x, y, ...}, or nil. options: tags (only
---Walkable pieces with one of these tags), partial (go as near as it can).
function paths.findPath(x1, y1, x2, y2, options)
	numbers("findPath(x1, y1, x2, y2) needs two points in the scene (four numbers)", 2, x1, y1, x2, y2)
	if options ~= nil and type(options) ~= "table" then
		error("findPath's last argument is a table of options, like { tags = \"land\", partial = true }", 2)
	end
	local area = sceneArea(tagsOf(options, "findPath", 2))
	local path = area:findPath(x1, y1, x2, y2, options)
	return path
end

---The walkable point nearest a point: x, y (nil if the scene has no Walkable pieces).
function paths.closestPoint(x, y, options)
	numbers("closestPoint(x, y) needs a point in the scene (two numbers)", 2, x, y)
	local area = sceneArea(tagsOf(options, "closestPoint", 2))
	local cx, cy = area:closestPoint(x, y)
	return cx, cy
end

---True if a point is inside a Walkable piece (and not in a hole).
function paths.isWalkable(x, y, options)
	numbers("isWalkable(x, y) needs a point in the scene (two numbers)", 2, x, y)
	local area = sceneArea(tagsOf(options, "isWalkable", 2))
	return area:isWalkable(x, y)
end

---The area built from the scene's Walkable pieces (see newArea), for its
---own questions or for drawing its pieces.
function paths.getArea(options)
	return sceneArea(tagsOf(options, "getArea", 2))
end

---Builds the scene's walkable area again. Only needed after changing a
---Walkable's points in place (points[1] = 5); other changes are noticed.
function paths.refresh()
	cache, cached = {}, 0
end

-- A finder for agents that uses the scene's Walkable pieces.
local sceneFinder = {}

function sceneFinder:_follow(x1, y1, x2, y2, options)
	return sceneArea(tagsOf(options, "newAgent", 2)):findPath(x1, y1, x2, y2, options)
end

---------------------------------------------------------------------------
-- Agents

local Agent = {}
Agent.__index = Agent

---Something that follows paths: it remembers a target and a path to it, and
---says which point to head for next. It moves nothing itself.
---options: finder (a grid, a graph, an area, or a function(x1, y1, x2, y2)
---that returns a path; the scene's Walkable pieces if left out), reach
---(how near a point counts as there, 4), replan (plan again once the target
---has moved this far, 16), partial (go as near as it can, true), tags.
function paths.newAgent(options)
	options = options or {}
	if type(options) ~= "table" then error("newAgent's argument is a table of options, like { finder = grid, reach = 4 }", 2) end
	local finder = options.finder
	if finder ~= nil and type(finder) ~= "function" and not (type(finder) == "table" and type(finder._follow) == "function") then
		error("newAgent: finder must be a grid, a graph, an area, or a function(x1, y1, x2, y2) that returns a path", 2)
	end
	local self = setmetatable({}, Agent)
	self.finder = finder
	self.reach = options.reach or 4
	self.replan = options.replan or 16
	self.partial = options.partial ~= false
	self.tags = options.tags
	if type(self.reach) ~= "number" or type(self.replan) ~= "number" then error("newAgent: reach and replan are distances in pixels", 2) end
	if self.tags ~= nil and type(self.tags) ~= "string" then error("newAgent: tags is a list of tags in one string, like \"land, bridge\"", 2) end
	self._options = {}
	self._index = 1
	return self
end

---Where to go. Calling it again with a new place is fine every frame: the
---path is only planned again once the target has moved further than replan.
function Agent:setTarget(x, y)
	if type(x) ~= "number" or type(y) ~= "number" then error("setTarget(x, y) needs a point in the scene (two numbers)", 2) end
	self._tx, self._ty = x, y
end

---The target: x, y (nil if there's none).
function Agent:getTarget()
	return self._tx, self._ty
end

---Forgets the target and the path.
function Agent:stop()
	self._tx, self._ty, self._path, self._planned, self._blocked = nil, nil, nil, false, false
end

local function finderVersion(self)
	local finder = self.finder
	if finder == nil then return sceneEntry(self.tags or "").version end
	if type(finder) == "table" then return finder.version end
	return nil
end

local function plan(self, x, y)
	local finder = self.finder
	local options = self._options
	options.partial, options.tags = self.partial, self.tags
	local path
	if type(finder) == "function" then
		path = finder(x, y, self._tx, self._ty)
		if path ~= nil then checkPath(path, "an agent's finder function must return a path or nil; it", 3) end
	else
		path = (finder or sceneFinder):_follow(x, y, self._tx, self._ty, options)
	end
	self._path, self._index = path, 1
	self._px, self._py = self._tx, self._ty
	self._version = finderVersion(self)
	self._planned, self._blocked = true, path == nil
end

---Plans the path again from a position, now.
function Agent:plan(x, y)
	if type(x) ~= "number" or type(y) ~= "number" then error("plan(x, y) needs where the piece is now (two numbers)", 2) end
	if self._tx then plan(self, x, y) end
end

---The point to head for from where the piece is now: x, y. Past points are
---dropped as the piece gets within reach of them, and the path is planned
---again when the target has moved far or the grid, graph or area changed.
---With no target, no way, or at the end, it's a point to stay at.
function Agent:next(x, y)
	if type(x) ~= "number" or type(y) ~= "number" then error("next(x, y) needs where the piece is now (two numbers)", 2) end
	local tx, ty = self._tx, self._ty
	if not tx then return x, y end
	if not self._planned or self._version ~= finderVersion(self) then
		plan(self, x, y)
	else
		local dx, dy = tx - self._px, ty - self._py
		if dx * dx + dy * dy > self.replan * self.replan then plan(self, x, y) end
	end
	local path = self._path
	if not path then return x, y end
	local reach2 = self.reach * self.reach
	local count = #path / 2
	local i = self._index
	while i <= count do
		local dx, dy = path[i * 2 - 1] - x, path[i * 2] - y
		if dx * dx + dy * dy > reach2 then break end
		i = i + 1
	end
	self._index = i
	if i > count then
		-- At the end. If the target moved a little meanwhile, go the rest.
		if tx ~= self._px or ty ~= self._py then
			plan(self, x, y)
			path = self._path
			if not path then return x, y end
			count = #path / 2
			i = 1
			while i <= count do
				local dx, dy = path[i * 2 - 1] - x, path[i * 2] - y
				if dx * dx + dy * dy > reach2 then break end
				i = i + 1
			end
			self._index = i
			if i <= count then return path[i * 2 - 1], path[i * 2] end
		end
		if count == 0 then return x, y end
		return path[count * 2 - 1], path[count * 2]
	end
	return path[i * 2 - 1], path[i * 2]
end

---True when there's nowhere left to go: no target, or the end of the path
---was reached.
function Agent:isDone()
	if not self._tx then return true end
	if not self._planned or not self._path then return false end
	return self._index > #self._path / 2 and self._tx == self._px and self._ty == self._py
end

---True if the last plan found no way to the target.
function Agent:isBlocked()
	return self._blocked == true
end

---The planned path (a flat list of points; nil if there's none), and the
---number of the point the agent is heading for.
function Agent:path()
	return self._path, self._index
end

---------------------------------------------------------------------------
-- Seeing paths

local inverse

---Draws a path (or an agent's path, or an area's pieces; with nothing, the
---scene's Walkable pieces) in scene coordinates, for finding mistakes.
---Call it from a script's draw(). options: color = {r, g, b, a}, width.
function paths.debugDraw(what, options)
	local g = love.graphics
	if not g then return end
	if what == nil then what = sceneEntry("").area end
	local mt = getmetatable(what)
	if mt == Agent then
		what = what._path
		if not what then return end
	end
	if type(what) ~= "table" then
		error("debugDraw needs a path, an agent or an area (or nothing, for the scene's Walkable pieces)", 2)
	end
	if mt ~= areaLib.Area then checkPath(what, "debugDraw", 2) end
	local color = options and options.color
	local width = options and options.width or 2
	g.push("all")
	-- A script's draw() draws in its piece's coordinates: undo the piece's
	-- position to get the scene's.
	local nodes2d = package.loaded["love.scene.nodes2d"]
	if nodes2d and nodes2d._inDraw and nodes2d._piece then
		inverse = nodes2d._piece:inverse()
		g.applyTransform(inverse)
		g.applyTransform(nodes2d._world)
	end
	g.setLineWidth(width)
	if mt == areaLib.Area then
		local r, gr, b, a = 0.3, 0.85, 0.5, 0.9
		if color then r, gr, b, a = color[1], color[2], color[3], color[4] or 1 end
		for _, piece in ipairs(what:pieces()) do
			g.setColor(r, gr, b, a * 0.25)
			g.polygon("fill", piece)
			g.setColor(r, gr, b, a)
			g.polygon("line", piece)
		end
	else
		if color then g.setColor(color[1], color[2], color[3], color[4] or 1) else g.setColor(1, 0.85, 0.2, 1) end
		if #what >= 4 then g.line(what) end
		for i = 1, #what - 1, 2 do g.circle("fill", what[i], what[i + 1], width * 1.5) end
	end
	g.pop()
end

return paths
