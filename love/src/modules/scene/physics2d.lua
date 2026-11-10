-- Bodies, Zones, Hitboxes and solid tiles, on Box2D 3 (docs/physics.md).
--
-- Each scene has one Box2D world (the physics2d module, love.box2d, loaded
-- when the first Body or Zone joins it). A Body's motion picks its kind of
-- Box2D body:
--
--   still     a static body (a kinematic one once a script moves it, so it
--             carries what stands on it)
--   scripted  a kinematic body that move() drives with the character mover:
--             it slides along walls, climbs slopes and pushes physics bodies
--   physics   a dynamic body: Box2D moves it
--
-- A Zone is a body of sensors; solid Tiles are chain segments along the
-- outline of their solid cells. Shapes turn with their pieces. A Zone with
-- forces on changes the physics of the physics bodies inside it (its own
-- gravity, drag, a steady push): see "Forces in zones" below.
--
-- Every physics step (love.scene, 60 a second): scripts run (physicsUpdate),
-- then sync() hands Box2D what scripts changed (positions, speeds, shapes,
-- settings), the world steps, and what Box2D did comes back: positions and
-- speeds of physics bodies, hit, entered and exited events. Pieces are plain
-- tables, so changes are noticed by comparing with what was last handed over.
--
-- Tags filter collisions with Box2D's collision bits: a Box2D shape's
-- category is its kind plus a bit for each of its tags that some passThrough
-- or detects list names; its mask leaves out the bits of its passThrough.
-- The custom filter in wrap_box2d.c makes that "pass through bodies with any
-- of these tags"; a Zone's mask is the bits of the tags it detects.

local nodeLib = require("love.scene.node")
local scene = require("love.scene")
local nodes2d = require("love.scene.nodes2d")

local abs, max, min, sqrt, floor, atan2, cos, sin = math.abs, math.max, math.min, math.sqrt, math.floor, math.atan2, math.cos, math.sin
local globalMatrix, hasPosition = nodes2d.globalMatrix, nodes2d.hasPosition

-- Box2D works in radians. A piece's angle fields (rotation, spin, slope)
-- hold the unit scripts use: RAD turns one into radians and DEG turns
-- radians into one, here where the two meet (worldPose, setWorldPose, the
-- velocities, move()). GRAVITY_SCALE is the field with a Body's gravity
-- multiplier. See engine/compat.lua.
local compat = require("love.engine.compat")
local RAD, DEG, SLOPE_MARGIN, GRAVITY_SCALE = compat.rad, compat.deg, compat.slopeMargin, compat.gravityScale

local M = {}

local b2 = nil     -- love.box2d
local world = nil  -- the running scene's world (a number), or nil
local anchor = nil -- a static body at the origin, for joints pinned in place

local bodies, zones, tilemaps = {}, {}, {}
M.bodies, M.zones, M.tilemaps = bodies, zones, tilemaps
local forced = {} -- bodies inside at least one Zone with forces on
M.forced = forced

local STEP_SUBSTEPS = 4
local TELEPORT = 64 -- moving a still or scripted body further than this in a step jumps there

---------------------------------------------------------------------------
-- Lists: each piece knows its place, so leaving is quick.

local function addTo(list, n)
	list[#list + 1] = n
	n._listIndex = #list
end

local function removeFrom(list, n)
	local i = n._listIndex
	if not i or list[i] ~= n then
		for j = 1, #list do
			if list[j] == n then i = j break end
		end
		if not i or list[i] ~= n then return end
	end
	local last = list[#list]
	list[i] = last
	last._listIndex = i
	list[#list] = nil
	n._listIndex = nil
end

---------------------------------------------------------------------------
-- Slots: the number that stands for a piece in Box2D (its bodies' and
-- shapes' user data). A freed slot waits a step before it's reused, so late
-- events about the old piece don't land on a new one.

local slots = {}       -- slot -> piece
local freeSlots = {}
local freedThisStep = {}
local slotCount = 0

local function takeSlot(n)
	local s = freeSlots[#freeSlots]
	if s then
		freeSlots[#freeSlots] = nil
	else
		slotCount = slotCount + 1
		s = slotCount
	end
	slots[s] = n
	n._slot = s
	return s
end

local function freeSlot(n)
	local s = n._slot
	if s then
		freedThisStep[#freedThisStep + 1] = s
		n._slot = nil
	end
end

-- Shapes that went away recently, for sensor events that name them: shape -> piece.
local goneShapes, goneShapesNext = {}, {}

---------------------------------------------------------------------------
-- Collision bits (keep in step with wrap_box2d.c)

local KIND_STILL, KIND_SCRIPTED, KIND_PHYSICS, KIND_ZONE = 1, 2, 4, 8
local KIND_TILES, KIND_ONEWAY = 16, 32
local KIND = { still = KIND_STILL, scripted = KIND_SCRIPTED, physics = KIND_PHYSICS }
local ALL = 2 ^ 53 - 1
local FIRST_TAG_BIT, LAST_TAG_BIT = 8, 52

local tagBits = {}   -- tag -> its bit (a power of two), for tags some list names
local nextBit = FIRST_TAG_BIT
local bitsVersion = 0 -- goes up when a tag gets a bit: every piece's bits are worked out again
local warnedBits = false

local function splitTags(list)
	local out = {}
	if type(list) == "string" then
		for g in list:gmatch("[^,%s]+") do out[#out + 1] = g end
	end
	return out
end

-- The bits of a list of tags ("ghost, coin"), giving new tags a bit.
local listBits = {}
local function bitsOfList(list)
	if list == nil or list == "" then return 0 end
	local cached = listBits[list]
	if cached and cached[2] == bitsVersion then return cached[1] end
	local sum = 0
	for _, g in ipairs(splitTags(list)) do
		local bit = tagBits[g]
		if not bit then
			if nextBit <= LAST_TAG_BIT then
				bit = 2 ^ nextBit
				nextBit = nextBit + 1
				tagBits[g] = bit
				bitsVersion = bitsVersion + 1
			elseif not warnedBits then
				warnedBits = true
				print("physics: more than 45 different tags in passThrough and detects lists; the rest are ignored")
			end
		end
		if bit then sum = sum + bit end
	end
	listBits[list] = { sum, bitsVersion }
	return sum
end

-- The bits of a piece's own tags.
local function bitsOfTags(n)
	local tags = n._tags
	if not tags then return 0 end
	local sum = 0
	for g in pairs(tags) do
		local bit = tagBits[g]
		if bit then sum = sum + bit end
	end
	return sum
end

-- category, mask for a piece's shapes.
local function filterOf(n)
	local t = n.type
	if t == "Zone" then
		local detects = n.detects
		local mask
		if detects == nil or detects == "" then
			mask = KIND_SCRIPTED + KIND_PHYSICS + KIND_ZONE
		else
			mask = bitsOfList(detects)
		end
		return KIND_ZONE + bitsOfTags(n), mask
	elseif t == "Tiles" then
		local tilesBit = tagBits.tiles or 0
		local own = bitsOfTags(n)
		if n._tags and n._tags.tiles then tilesBit = 0 end
		return KIND_TILES + own + tilesBit, ALL - bitsOfList(n.passThrough)
	end
	return (KIND[n.motion] or KIND_STILL) + bitsOfTags(n), ALL - bitsOfList(n.passThrough)
end

---------------------------------------------------------------------------
-- The world

local engine = nil

local function projectGravity()
	engine = engine or require("love.engine")
	local p = engine.project
	local g = p and type(p.physics) == "table" and p.physics.gravity
	if type(g) == "table" and type(g[1]) == "number" and type(g[2]) == "number" then return g[1], g[2] end
	return 0, 980
end

local gravityX, gravityY = nil, nil -- set by setGravity before a world exists

local step, reset

local function ensureWorld()
	if world then return world end
	b2 = b2 or require("love.box2d") -- loads the physics2d module (or explains it's missing)
	local gx, gy = projectGravity()
	if gravityX then gx, gy = gravityX, gravityY end
	world = b2.newWorld(gx, gy)
	anchor = b2.createBody(world, 0, 0, 0, 0, 0)
	scene._addSystem("physics2d", { order = 60, step = function(h) step(h) end, reset = function() reset() end })
	return world
end
M.ensureWorld = ensureWorld

function M.getWorld() return world end
function M.getAnchor() ensureWorld() return anchor end
function M.box2d() ensureWorld() return b2 end
function M.slotPiece(s) return slots[s] end

---------------------------------------------------------------------------
-- Where a piece is in the scene: x, y, angle, and its scale (sx may be
-- negative: flipped). Pieces right inside an unmoved root skip the matrix.

local function worldPose(n)
	local p = n.parent
	if p and p.parent == nil and p.x == 0 and p.y == 0 and p.rotation == 0 and p.scaleX == 1 and p.scaleY == 1 then
		return n.x, n.y, n.rotation * RAD, n.scaleX, n.scaleY
	end
	local a, b, c, d, tx, ty = globalMatrix(n)
	local sy = sqrt(c * c + d * d)
	if sy == 0 then return tx, ty, 0, 0, 0 end
	return tx, ty, atan2(-c, d), (a * d - b * c) / sy, sy
end
M.worldPose = worldPose

-- Puts a piece at a place and angle in the scene (through its parents).
local function setWorldPose(n, x, y, angle)
	local p = n.parent
	if p and p.parent == nil and p.x == 0 and p.y == 0 and p.rotation == 0 and p.scaleX == 1 and p.scaleY == 1 then
		n.x, n.y = x, y
		if angle then n.rotation = angle * DEG end
		return
	end
	while p and not hasPosition(p) do p = p.parent end
	if not p then
		n.x, n.y = x, y
		if angle then n.rotation = angle * DEG end
		return
	end
	local a, b, c, d, tx, ty = globalMatrix(p)
	local det = a * d - b * c
	if det ~= 0 then
		local px, py = x - tx, y - ty
		n.x, n.y = (d * px - c * py) / det, (a * py - b * px) / det
	end
	if angle then n.rotation = (angle - atan2(-c, d)) * DEG end
end

---------------------------------------------------------------------------
-- Shapes: what a Body or Zone collides as, in its Box2D body's frame
-- (scaled with the piece, turned with it by the body).

-- The rectangle the visible pieces inside a piece cover, in its own
-- coordinates, and the lone Shape if it's the only one (a circle or polygon
-- fits it exactly).
local function visualBounds(n)
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	local lone = nil
	local count = 0
	for _, c in ipairs(n.children) do
		if c.getRect and c.visible ~= false and not c._dead and c.type ~= "Hitbox" then
			local rx, ry, rw, rh = c:getRect()
			if rw > 0 and rh > 0 then
				count = count + 1
				local sx, sy = c.scaleX, c.scaleY
				local ax, bx = c.x + rx * sx, c.x + (rx + rw) * sx
				local ay, by = c.y + ry * sy, c.y + (ry + rh) * sy
				x0, x1 = min(x0, ax, bx), max(x1, ax, bx)
				y0, y1 = min(y0, ay, by), max(y1, ay, by)
				lone = c
			end
		end
	end
	if count == 0 then return nil end
	if count > 1 or lone.type ~= "Shape" then lone = nil end
	return x0, y0, x1, y1, lone
end
M._visualBounds = visualBounds -- an Occluder's auto shape fits the same way

-- Shape descriptions: {kind, ...numbers}, reused. Kinds: "box" cx cy hw hh
-- angle, "circle" cx cy r, "capsule" x1 y1 x2 y2 r, "polygon" {points}.
local function put(out, k, kind, a, b, c, d, e)
	local s = out[k]
	if not s then
		s = {}
		out[k] = s
	end
	s.kind, s[1], s[2], s[3], s[4], s[5] = kind, a, b, c, d, e
	s.points = nil
	return s
end

-- A box, circle, capsule or polygon of a piece with size w x h, radius r or
-- points pts, at (ox, oy) turned by angle within the body, scaled by (sx, sy).
local function addOwnShape(out, k, kind, w, h, r, pts, ox, oy, angle, sx, sy)
	local asx, asy = abs(sx), abs(sy)
	if sx * sy < 0 then angle = -angle end
	if kind == "rectangle" then
		return k + 1, put(out, k + 1, "box", ox, oy, w / 2 * asx, h / 2 * asy, angle)
	elseif kind == "circle" then
		return k + 1, put(out, k + 1, "circle", ox, oy, r * max(asx, asy))
	elseif kind == "capsule" then
		local hw, hh = w / 2 * asx, h / 2 * asy
		local c, s = cos(angle), sin(angle)
		if hh >= hw then
			local len = hh - hw
			return k + 1, put(out, k + 1, "capsule", ox + s * len, oy - c * len, ox - s * len, oy + c * len, hw)
		else
			local len = hw - hh
			return k + 1, put(out, k + 1, "capsule", ox - c * len, oy - s * len, ox + c * len, oy + s * len, hh)
		end
	elseif kind == "polygon" then
		if type(pts) ~= "table" or #pts < 6 then return k end
		local shape = put(out, k + 1, "polygon")
		local list = {}
		local c, s = cos(angle), sin(angle)
		for i = 1, #pts - 1, 2 do
			local px, py = pts[i] * asx, pts[i + 1] * asy
			if sx < 0 then px = -px end
			if sy < 0 then py = -py end
			list[#list + 1] = ox + px * c - py * s
			list[#list + 1] = oy + px * s + py * c
		end
		shape.points = list
		return k + 1, shape
	end
	return k
end

-- Fills n._desc with its shapes; returns how many and a number that changes
-- when they do.
local function describe(n, sx, sy)
	local out = n._desc
	if not out then
		out = {}
		n._desc = out
	end
	local k = 0
	local kind = n.shape
	if kind == "auto" then
		local x0, y0, x1, y1, lone = visualBounds(n)
		if x0 then
			if lone and lone.shape == "circle" then
				k = addOwnShape(out, k, "circle", 0, 0, lone.radius * abs(lone.scaleX), nil,
					lone.x * sx, lone.y * sy, 0, sx, sy)
			elseif lone and lone.shape == "polygon" and type(lone.points) == "table" then
				local pts = {}
				local c, s = cos(lone.rotation * RAD), sin(lone.rotation * RAD)
				for i = 1, #lone.points - 1, 2 do
					local px, py = lone.points[i] * lone.scaleX, lone.points[i + 1] * lone.scaleY
					pts[#pts + 1] = lone.x + px * c - py * s
					pts[#pts + 1] = lone.y + px * s + py * c
				end
				k = addOwnShape(out, k, "polygon", 0, 0, 0, pts, 0, 0, 0, sx, sy)
			else
				k = addOwnShape(out, k, "rectangle", x1 - x0, y1 - y0, 0, nil, (x0 + x1) / 2 * sx, (y0 + y1) / 2 * sy, 0, sx, sy)
			end
		end
	elseif kind ~= "none" then
		k = addOwnShape(out, k, kind, n.width, n.height, n.radius, n.points, 0, 0, 0, sx, sy)
	end
	local hitboxes = nil
	for _, h in ipairs(n.children) do
		if h.type == "Hitbox" and not h._dead then
			hitboxes = hitboxes or {}
			hitboxes[#hitboxes + 1] = h
			if not h.off then
				k = addOwnShape(out, k, h.shape, h.width * abs(h.scaleX), h.height * abs(h.scaleY), h.radius * abs(h.scaleX),
					h.points, h.x * sx, h.y * sy, h.rotation * RAD, sx, sy)
			end
		end
	end
	n._hitboxes = hitboxes
	for i = k + 1, #out do out[i] = nil end
	-- A number from all of it, rounded to hundredths of a pixel.
	local key = k
	for i = 1, k do
		local s = out[i]
		key = (key * 31 + #s.kind) % 4294967296
		for j = 1, 5 do
			local v = s[j]
			if v then key = (key * 131 + floor(v * 100 + 0.5)) % 1099511627776 end
		end
		if s.points then
			for _, v in ipairs(s.points) do key = (key * 131 + floor(v * 100 + 0.5)) % 1099511627776 end
		end
	end
	return k, key
end

-- A cheap number from what most often changes a piece's shapes: checked every step.
local function quickKey(n)
	local key = #n.children + (n.width or 0) * 7 + (n.height or 0) * 13 + (n.radius or 0) * 17
		+ n.scaleX * 1009 + n.scaleY * 2003
	local hs = n._hitboxes
	if hs then
		for i = 1, #hs do
			local h = hs[i]
			key = key + (h.off and 3 or 5) * i + h.x * 0.37 + h.y * 0.71 + h.width * 1.3 + h.height * 1.7
				+ h.radius * 1.9 + h.rotation * 2.3
		end
	end
	return key
end

local SHAPE_SENSOR, SHAPE_SENSOR_EVENTS, SHAPE_CONTACT_EVENTS = 1, 2, 4

local function forgetShapes(n)
	local list = n._shapes
	if not list then return end
	for i = 1, #list do goneShapes[list[i]] = n end
	n._shapes = nil
end

-- Makes the Box2D shapes of a piece again if they changed (or force).
local stepCount = 0

local function updateShapes(n, force)
	local body = n._body
	if not body then return end
	local qk = quickKey(n)
	if not force and qk == n._quickKey and n.shape == n._shapeKind and n.points == n._points
		and (stepCount + n._slot) % 16 ~= 0 then
		return
	end
	n._quickKey, n._shapeKind, n._points = qk, n.shape, n.points
	local _, _, _, sx, sy = worldPose(n)
	local count, key = describe(n, sx, sy)
	if not force and key == n._shapeKey then return end
	n._shapeKey = key
	forgetShapes(n)
	b2.clearShapes(body)
	local isZone = n.type == "Zone"
	local cat, mask = filterOf(n)
	n._cat, n._mask = cat, mask
	local flags
	if isZone then
		flags = SHAPE_SENSOR + (n.active ~= false and SHAPE_SENSOR_EVENTS or 0)
	else
		flags = SHAPE_CONTACT_EVENTS + (n.motion ~= "still" and SHAPE_SENSOR_EVENTS or 0)
	end
	-- Zones have no material: a script variable of theirs called friction
	-- or bounce is the script's own.
	local friction, bounce = 0.3, 0
	if not isZone then friction, bounce = n.friction or 0.3, n.bounce or 0 end
	local list = {}
	local slot = n._slot
	for i = 1, count do
		local s = n._desc[i]
		local id
		if s.kind == "polygon" then
			id = b2.addShape(body, slot, cat, mask, friction, bounce, flags, "polygon", s.points)
		else
			id = b2.addShape(body, slot, cat, mask, friction, bounce, flags, s.kind, s[1], s[2], s[3], s[4], s[5])
		end
		if id then list[#list + 1] = id end
	end
	n._shapes = list
	n._friction, n._bounce = friction, bounce
	if n.motion == "physics" and not isZone then
		b2.setMass(body, n.mass)
		n._mass = n.mass
	end
end

---------------------------------------------------------------------------
-- Making and losing Box2D bodies

local BODY_STATIC, BODY_KINEMATIC, BODY_DYNAMIC = 0, 1, 2

local function typeFor(n)
	if n.type == "Zone" then return BODY_KINEMATIC end
	local m = n.motion
	if m == "physics" then return BODY_DYNAMIC end
	if m == "scripted" then return BODY_KINEMATIC end
	return BODY_STATIC
end

-- What Box2D gets as a physics body's gravity multiplier, drag and spin
-- drag: its own, changed by the force zones it's in (n._zReplace,
-- n._zDrag, n._zSpin, worked out each step by zoneForces below). Handed
-- over only when something changed, or with force.
local function bodyProps(n, force)
	local gs, drag, spinDrag = n[GRAVITY_SCALE], n.drag, n.spinDrag
	if n._fz then
		-- In a zone that replaces gravity, the zone applies it instead.
		if n._zReplace then gs = 0 end
		drag, spinDrag = drag + n._zDrag, spinDrag + n._zSpin
	end
	if force or gs ~= n._gravity or drag ~= n._drag or spinDrag ~= n._spinDrag or n.fixedRotation ~= n._fixed
		or n.bullet ~= n._bullet then
		b2.setBodyProps(n._body, gs, drag, spinDrag, n.fixedRotation, n.bullet)
		n._gravity, n._drag, n._spinDrag, n._fixed, n._bullet = gs, drag, spinDrag, n.fixedRotation, n.bullet
	end
end

local function create(n)
	ensureWorld()
	local x, y, angle = worldPose(n)
	local t = typeFor(n)
	takeSlot(n)
	n._body = b2.createBody(world, t, x, y, angle, n._slot)
	n._btype = t
	n._motion = n.motion
	n._bx, n._by, n._ba = x, y, angle
	n._bmoving = false
	n._shapeKey = nil
	n._filterVersion = bitsVersion
	n._pt, n._det, n._tagsDirty = n.passThrough, n.detects, false
	n._active = n.active
	if t == BODY_DYNAMIC then
		bodyProps(n, true)
		b2.setVelocity(n._body, n.vx, n.vy, n.spin * RAD)
		n._lastX, n._lastY, n._lastR = n.x, n.y, n.rotation
		n._lastVx, n._lastVy, n._lastSpin = n.vx, n.vy, n.spin
		n._lastAsleep = n.asleep
		if n.asleep then b2.setAwake(n._body, false) end
	end
	updateShapes(n, true)
end

local function destroy(n)
	if n._grab then
		b2.destroyJoint(n._grab)
		n._grab = nil
	end
	if n._body then
		forgetShapes(n)
		b2.destroyBody(n._body)
		n._body = nil
	end
	freeSlot(n)
end

-- The Box2D body of a piece, made now if it isn't yet (it is, once the
-- piece has been in a running scene for a step).
local function ensure(n)
	if not n._body then
		if not n._inside or n._dead then return nil end
		create(n)
	end
	return n._body
end
M.ensure = ensure

---------------------------------------------------------------------------
-- Handing Box2D what scripts changed

local function refreshFilter(n)
	local cat, mask = filterOf(n)
	n._filterVersion = bitsVersion
	n._pt, n._det, n._tagsDirty = n.passThrough, n.detects, false
	if cat == n._cat and mask == n._mask then return end
	n._cat, n._mask = cat, mask
	local list = n._shapes
	if list then
		for i = 1, #list do b2.setFilter(list[i], cat, mask) end
	end
end

local function syncCommon(n)
	if n._filterVersion ~= bitsVersion or n._tagsDirty or n.passThrough ~= n._pt or n.detects ~= n._det then
		refreshFilter(n)
	end
	updateShapes(n, false)
	if n.type == "Body" and (n.friction ~= n._friction or n.bounce ~= n._bounce) then
		n._friction, n._bounce = n.friction, n.bounce
		local list = n._shapes
		if list then
			for i = 1, #list do b2.setMaterial(list[i], n.friction, n.bounce) end
		end
	end
end

local function syncBody(n, h)
	local body = n._body
	if n.motion ~= n._motion then
		-- A new motion: a new kind of body, and new shapes (bits, events).
		local wasDynamic = n._btype == BODY_DYNAMIC
		n._motion = n.motion
		local t = typeFor(n)
		b2.setType(body, t)
		n._btype = t
		local x, y, angle = worldPose(n)
		b2.setTransform(body, x, y, angle, true)
		n._bx, n._by, n._ba, n._bmoving = x, y, angle, false
		if t == BODY_DYNAMIC then
			bodyProps(n, true)
			b2.setVelocity(body, n.vx, n.vy, n.spin * RAD)
			n._lastX, n._lastY, n._lastR = n.x, n.y, n.rotation
			n._lastVx, n._lastVy, n._lastSpin = n.vx, n.vy, n.spin
		elseif wasDynamic then
			b2.setVelocity(body, 0, 0, 0)
		end
		updateShapes(n, true)
	end
	syncCommon(n)
	if n._btype == BODY_DYNAMIC then
		if n.x ~= n._lastX or n.y ~= n._lastY or n.rotation ~= n._lastR then
			-- Moved by a script: it's there now, going as fast as it was.
			local x, y, angle = worldPose(n)
			b2.setTransform(body, x, y, angle, true)
			n._lastX, n._lastY, n._lastR = n.x, n.y, n.rotation
		end
		if n.vx ~= n._lastVx or n.vy ~= n._lastVy or n.spin ~= n._lastSpin then
			b2.setVelocity(body, n.vx, n.vy, n.spin * RAD)
			n._lastVx, n._lastVy, n._lastSpin = n.vx, n.vy, n.spin
		end
		if n.mass ~= n._mass then
			b2.setMass(body, n.mass)
			n._mass = n.mass
		end
		bodyProps(n)
		if n.asleep ~= n._lastAsleep then
			b2.setAwake(body, not n.asleep)
			n._lastAsleep = n.asleep
		end
		return
	end
	-- Still and scripted bodies go wherever scripts put them: Box2D gets the
	-- velocity that takes them there in this step, so they push and carry
	-- physics bodies.
	local x, y, angle = worldPose(n)
	local bx, by, ba = n._bx, n._by, n._ba
	if x ~= bx or y ~= by or angle ~= ba then
		local dx, dy = x - bx, y - by
		if n._btype == BODY_STATIC then
			b2.setType(body, BODY_KINEMATIC)
			n._btype = BODY_KINEMATIC
		end
		if dx * dx + dy * dy > TELEPORT * TELEPORT or abs(angle - ba) > 1 then
			b2.setTransform(body, x, y, angle, true)
			if n._bmoving then b2.setVelocity(body, 0, 0, 0) end
			n._bmoving = false
		else
			b2.driveTo(body, bx, by, ba, x, y, angle, h)
			n._bmoving = true
		end
		n._bx, n._by, n._ba = x, y, angle
	elseif n._bmoving then
		b2.setVelocity(body, 0, 0, 0)
		n._bmoving = false
	end
end

---------------------------------------------------------------------------
-- Forces in zones (docs/physics.md). A Zone with forces on (and active)
-- changes the physics of the physics bodies inside it: gravity of its own
-- (added to the scene's, or instead of it; one way, or towards the Zone's
-- position), drag and spin drag (added to the body's own) and a steady push
-- (a force). Only physics bodies feel them; a body's gravityScale
-- multiplies the zone's gravity as it does the scene's. Which bodies are
-- inside is what entered and exited go by (so detects filters them too).
--
-- Each such body keeps the force zones it's in, in the order it went into
-- them (n._fz), and is in the forced list; each step, before Box2D steps,
-- only those bodies are worked on. Zones without forces cost nothing more
-- than before, and nothing is made per step.
--
-- Overlapping zones: gravity that adds, drags and pushes all add up; of the
-- zones that replace gravity, the one the body went into last wins.

local GRAVITY_MODE = { add = 1, replace = 2 }

local function number(v) return type(v) == "number" and v == v and v or 0 end

-- A force zone's settings, read once a step (scripts may change them).
local function readForces(z)
	z._fMode = GRAVITY_MODE[z.gravity] or 0
	z._fCenter = z.toCenter == true
	z._fgx, z._fgy = number(z.gravityX), number(z.gravityY)
	z._fStrength = number(z.gravityStrength)
	z._fDrag, z._fSpin = max(0, number(z.drag)), max(0, number(z.spinDrag))
	z._fpx, z._fpy = number(z.pushX), number(z.pushY)
end

-- Body o is in force zone z (it went in, or z's forces came on).
local function addForceZone(o, z)
	if o.type ~= "Body" or o._dead then return end
	local list = o._fz
	if not list then
		list = {}
		o._fz = list
		o._zReplace, o._zDrag, o._zSpin = false, 0, 0
		forced[#forced + 1] = o
		o._forcedIndex = #forced
	end
	for i = 1, #list do
		if list[i] == z then return end
	end
	list[#list + 1] = z
end

-- o is in no force zone any more.
local function dropForced(o)
	local i = o._forcedIndex
	if not i or forced[i] ~= o then
		i = nil
		for j = 1, #forced do
			if forced[j] == o then i = j break end
		end
	end
	if i then
		local last = forced[#forced]
		forced[i] = last
		last._forcedIndex = i
		forced[#forced] = nil
	end
	o._forcedIndex, o._fz = nil, nil
	o._zReplace, o._zDrag, o._zSpin = nil, nil, nil
end

-- o left z (or z's forces went off). Out of the last one, it's back to
-- its own settings.
local function removeForceZone(o, z)
	local list = o._fz
	if not list then return end
	for i = #list, 1, -1 do
		if list[i] == z then
			table.remove(list, i)
			break
		end
	end
	if #list == 0 then
		dropForced(o)
		if o._body and o._btype == BODY_DYNAMIC and not o._dead then bodyProps(o) end
	end
end

local function setForcing(z, on)
	z._forcing = on
	local inside = z._in
	if not inside then return end
	for o in pairs(inside) do
		if on then addForceZone(o, z) else removeForceZone(o, z) end
	end
end

-- The gravity of zone z on a body: x, y in pixels per second per second.
local function zoneGravity(z, body)
	if z._fCenter then
		local x, y = b2.getTransform(body)
		local dx, dy = z._bx - x, z._by - y
		local d = sqrt(dx * dx + dy * dy)
		if d < 0.001 then return 0, 0 end
		local k = z._fStrength / d
		return dx * k, dy * k
	end
	return z._fgx, z._fgy
end

-- What the force zones a body is in do to it in this step.
local function zoneForces(n)
	local body = n._body
	if not body or n._dead or n._btype ~= BODY_DYNAMIC then return end
	local list = n._fz
	local gx, gy, px, py, drag, spin = 0, 0, 0, 0, 0, 0
	local replace = nil
	for i = #list, 1, -1 do
		local z = list[i]
		local mode = z._fMode
		if mode == 2 then
			if not replace then replace = z end
		elseif mode == 1 then
			local ax, ay = zoneGravity(z, body)
			gx, gy = gx + ax, gy + ay
		end
		drag, spin = drag + z._fDrag, spin + z._fSpin
		px, py = px + z._fpx, py + z._fpy
	end
	if replace then
		local ax, ay = zoneGravity(replace, body)
		gx, gy = gx + ax, gy + ay
	end
	n._zReplace, n._zDrag, n._zSpin = replace ~= nil, drag, spin
	bodyProps(n)
	if gx ~= 0 or gy ~= 0 then
		-- As a force, so it's exactly like the scene's gravity: Box2D gives
		-- it to the body in each substep.
		local k = number(n[GRAVITY_SCALE]) * b2.getMass(body)
		px, py = px + gx * k, py + gy * k
	end
	if px ~= 0 or py ~= 0 then
		b2.applyForce(body, px, py)
		n.asleep, n._lastAsleep = false, false
	end
end

local function syncZone(n)
	if n.active ~= n._active then
		n._active = n.active
		local list = n._shapes
		if list then
			for i = 1, #list do b2.enableSensorEvents(list[i], n.active ~= false) end
		end
	end
	syncCommon(n)
	local x, y, angle = worldPose(n)
	if x ~= n._bx or y ~= n._by or angle ~= n._ba then
		b2.setTransform(n._body, x, y, angle)
		n._bx, n._by, n._ba = x, y, angle
	end
	local on = n.forces == true and n.active ~= false
	if on ~= n._forcing then setForcing(n, on) end
	if on then readForces(n) end
end

---------------------------------------------------------------------------
-- Tiles: each solid Tiles piece is a static body; its cells' outline is
-- made in chunks of 16 x 16 cells, so changing a cell remakes one chunk
-- (or the few around a cell on a chunk's edge).

local CHUNK = 16

local function chunkKey(kx, ky) return kx * 4194304 + ky end

local function tileKinds(ts)
	local kinds = {}
	for id, props in pairs(ts.tiles) do
		if props.solid then kinds[id] = props.oneWay and 2 or 1 end
	end
	return kinds
end

local function dropTiles(map)
	local t = map._phys
	if not t then return end
	for _, chains in pairs(t.chunks) do b2.destroyChains(chains) end
	b2.destroyBody(t.body)
	map._phys = nil
	freeSlot(map)
end

local function buildChunk(map, t, key, kx, ky)
	local old = t.chunks[key]
	if old then b2.destroyChains(old) end
	local chains = {}
	local cat, mask = filterOf(map)
	b2.buildTiles(t.body, map._grid, t.kinds, kx * CHUNK, ky * CHUNK, kx * CHUNK + CHUNK - 1, ky * CHUNK + CHUNK - 1,
		t.tw, t.th, map._slot, cat, mask, cat + KIND_ONEWAY, t.friction, chains)
	t.chunks[key] = #chains > 0 and chains or nil
end

local function buildAllTiles(map)
	dropTiles(map)
	local ts = map._ts
	if not ts or not map.solid or not map._inside then return end
	local tw, th, ox, oy = map:_cellSize()
	if tw == 0 or th == 0 then return end
	takeSlot(map)
	local t = {
		body = b2.createBody(world, BODY_STATIC, ox, oy, 0, map._slot),
		chunks = {}, dirty = {}, kinds = tileKinds(ts), tw = tw, th = th, ox = ox, oy = oy,
		friction = 0.6, version = nil,
	}
	map._phys = t
	local cat, mask = filterOf(map)
	t.cat, t.mask, t.filterVersion, t.pt = cat, mask, bitsVersion, map.passThrough
	local seen = {}
	for cy, row in pairs(map._grid) do
		local ky = floor(cy / CHUNK)
		for cx in pairs(row) do
			local kx = floor(cx / CHUNK)
			local key = chunkKey(kx, ky)
			if not seen[key] then
				seen[key] = true
				buildChunk(map, t, key, kx, ky)
			end
		end
	end
end

-- Called by tilemap.lua when a cell changes.
function M.tileChanged(map, cx, cy)
	local t = map._phys
	if not t then return end
	-- The cell's outline and the ghosts of its neighbours' outlines.
	for dy = -1, 1 do
		for dx = -1, 1 do
			local kx, ky = floor((cx + dx) / CHUNK), floor((cy + dy) / CHUNK)
			t.dirty[chunkKey(kx, ky)] = { kx, ky }
		end
	end
end

-- Called by tilemap.lua when a rectangle of cells changes.
function M.tileAreaChanged(map, cx0, cy0, cx1, cy1)
	local t = map._phys
	if not t then return end
	for ky = floor((cy0 - 1) / CHUNK), floor((cy1 + 1) / CHUNK) do
		for kx = floor((cx0 - 1) / CHUNK), floor((cx1 + 1) / CHUNK) do
			t.dirty[chunkKey(kx, ky)] = { kx, ky }
		end
	end
end

local function tilesVersion(map)
	return tostring(map._grid) .. tostring(map._ts) .. tostring(map.solid)
end

local function syncTiles(map)
	if not map._inside then return end
	map:_cellSize() -- decodes new cells or a new tileset
	local t = map._phys
	local version = tilesVersion(map)
	local tw, th, ox, oy = map:_cellSize()
	if not t or t.version ~= version or t.tw ~= tw or t.th ~= th then
		buildAllTiles(map)
		t = map._phys
		if t then t.version = version end
		return
	end
	if ox ~= t.ox or oy ~= t.oy then
		b2.setTransform(t.body, ox, oy, 0)
		t.ox, t.oy = ox, oy
	end
	if t.filterVersion ~= bitsVersion or map.passThrough ~= t.pt or map._tagsDirty then
		local cat, mask = filterOf(map)
		t.filterVersion, t.pt, map._tagsDirty = bitsVersion, map.passThrough, false
		if cat ~= t.cat or mask ~= t.mask then
			t.cat, t.mask = cat, mask
			for _, chains in pairs(t.chunks) do b2.setChainFilters(chains, cat, mask, cat + KIND_ONEWAY) end
		end
	end
	if next(t.dirty) then
		for key, k in pairs(t.dirty) do
			buildChunk(map, t, key, k[1], k[2])
			t.dirty[key] = nil
		end
	end
end

function M.addTiles(map)
	addTo(tilemaps, map)
end

function M.removeTiles(map)
	removeFrom(tilemaps, map)
	if world then dropTiles(map) end
end

---------------------------------------------------------------------------
-- Events

-- Whether emitting an event to a piece runs anything.
local function handles(n, event)
	if type(n[event]) == "function" then return true end
	local list = n._listeners and n._listeners[event]
	return list ~= nil and #list > 0
end
M.handles = handles

local moveBuf, contactBuf, beginBuf, endBuf = {}, {}, {}, {}

local function contactFor(other, x, y, nx, ny, impulse)
	return { other = other, x = x, y = y, nx = nx, ny = ny, impulse = impulse }
end

local function sendHit(n, other, x, y, nx, ny, impulse)
	if n._dead or not handles(n, "hit") then return end
	n:emit("hit", other, contactFor(other, x, y, nx, ny, impulse))
end
M.sendHit = sendHit

local function readMoves()
	local count = b2.moves(world, moveBuf)
	local buf = moveBuf
	for i = 0, count - 1 do
		local j = i * 8
		local n = slots[buf[j + 1]]
		if n and not n._dead and n._btype == BODY_DYNAMIC then
			setWorldPose(n, buf[j + 2], buf[j + 3], buf[j + 4])
			n.vx, n.vy, n.spin = buf[j + 5], buf[j + 6], buf[j + 7] * DEG
			n.asleep = buf[j + 8] == 1
			n._lastX, n._lastY, n._lastR = n.x, n.y, n.rotation
			n._lastVx, n._lastVy, n._lastSpin = n.vx, n.vy, n.spin
			n._lastAsleep = n.asleep
		end
	end
end

local function readContacts()
	local count = b2.contacts(world, contactBuf)
	if count == 0 then return end
	-- Copied first: a hit handler may step nothing, but may spawn or destroy.
	local list = {}
	local buf = contactBuf
	for i = 1, count * 7 do list[i] = buf[i] end
	for i = 0, count - 1 do
		local j = i * 7
		local a, b = slots[list[j + 1]], slots[list[j + 2]]
		if a and b and a ~= b then
			local x, y, nx, ny, impulse = list[j + 3], list[j + 4], list[j + 5], list[j + 6], list[j + 7]
			-- The normal points from a to b: each gets the one pointing at itself.
			sendHit(a, b, x, y, -nx, -ny, impulse)
			sendHit(b, a, x, y, nx, ny, impulse)
		end
	end
end

local function zoneEnter(z, o)
	local inside = z._in
	if not inside or z._dead then return end
	local c = (inside[o] or 0) + 1
	inside[o] = c
	if c == 1 then
		if z._forcing then addForceZone(o, z) end
		z:emit("entered", o)
		if o.type == "Body" and not o._dead and not z._dead then o:emit("entered", z) end
	end
end

local function zoneExit(z, o)
	local inside = z._in
	if not inside then return end
	local c = (inside[o] or 0) - 1
	if c > 0 then
		inside[o] = c
		return
	end
	inside[o] = nil
	if o._fz then removeForceZone(o, z) end
	if not z._dead then z:emit("exited", o) end
	if o.type == "Body" and not o._dead then o:emit("exited", z) end
end

local function readSensors()
	local nb, ne = b2.sensors(world, beginBuf, endBuf)
	if nb == 0 and ne == 0 then return end
	local begins, ends = {}, {}
	for i = 1, nb * 3 do begins[i] = beginBuf[i] end
	for i = 1, ne * 3 do ends[i] = endBuf[i] end
	-- Begins first: a shape made again (a resized Hitbox) ends and begins in
	-- the same step, which isn't leaving.
	for i = 0, nb - 1 do
		local z, o = slots[begins[i * 3 + 1]], slots[begins[i * 3 + 2]]
		if z and o and z ~= o then zoneEnter(z, o) end
	end
	for i = 0, ne - 1 do
		local z = slots[ends[i * 3 + 1]]
		local o = slots[ends[i * 3 + 2]] or goneShapes[ends[i * 3 + 3]]
		if z and o and z ~= o then zoneExit(z, o) end
	end
end

---------------------------------------------------------------------------
-- The step

local joints = nil -- joints2d.lua, once a Joint joins

step = function(h)
	if not world then return end
	stepCount = stepCount + 1
	for i = 1, #bodies do
		local n = bodies[i]
		if not n._dead and n._body then syncBody(n, h) end
	end
	for i = 1, #zones do
		local n = zones[i]
		if not n._dead and n._body then syncZone(n) end
	end
	for i = 1, #tilemaps do syncTiles(tilemaps[i]) end
	if joints then joints.sync(h) end
	for i = 1, #forced do zoneForces(forced[i]) end

	b2.step(world, h, STEP_SUBSTEPS)

	-- Still and scripted bodies are where they were driven to.
	readMoves()
	-- Slots and shapes freed before this step can't be in any later event.
	for i = 1, #freedThisStep do
		local s = freedThisStep[i]
		slots[s] = nil
		freeSlots[#freeSlots + 1] = s
		freedThisStep[i] = nil
	end
	readContacts()
	readSensors()
	goneShapes, goneShapesNext = goneShapesNext, goneShapes
	for k in pairs(goneShapes) do goneShapes[k] = nil end
	goneShapes, goneShapesNext = goneShapesNext, goneShapes
	if joints then joints.afterStep() end
end

reset = function()
	if world then b2.destroyWorld(world) end
	world, anchor = nil, nil
	for _, list in ipairs({ bodies, zones }) do
		for i = #list, 1, -1 do
			local n = list[i]
			n._body, n._shapes, n._slot, n._listIndex, n._grab = nil, nil, nil, nil, nil
			list[i] = nil
		end
	end
	for i = #forced, 1, -1 do
		local n = forced[i]
		n._forcedIndex, n._fz, n._zReplace, n._zDrag, n._zSpin = nil, nil, nil, nil, nil
		forced[i] = nil
	end
	for _, map in ipairs(tilemaps) do map._phys = nil end
	slots, freeSlots, freedThisStep, slotCount = {}, {}, {}, 0
	goneShapes, goneShapesNext = {}, {}
	if joints then joints.reset() end
	local tree = scene._tree
	if tree.systems.physics2d then
		local sys = tree.systems.physics2d
		tree.systems.physics2d = nil
		for i = #tree.systemList, 1, -1 do
			if tree.systemList[i] == sys then table.remove(tree.systemList, i) end
		end
	end
end

function M.useJoints(j) joints = j end

---------------------------------------------------------------------------
-- Bodies

local Body = nodeLib.classes.Body
local Node = nodeLib.Node

function Body:_enter()
	addTo(bodies, self)
	self._onGround, self._onWall, self._onCeiling = false, false, false
	create(self)
end

function Body:_exit()
	removeFrom(bodies, self)
	destroy(self)
	-- (Only moving elsewhere in the scene, it's still in its zones until
	-- they say it left.)
	if self._fz and self._dead then dropForced(self) end
end

-- Tags change what passes through what.
local function tagChanged(self) self._tagsDirty = true end
for _, cls in ipairs({ Body, nodeLib.classes.Zone, nodeLib.classes.Tiles }) do
	function cls:tag(name)
		Node.tag(self, name)
		tagChanged(self)
	end
	function cls:untag(name)
		Node.untag(self, name)
		tagChanged(self)
	end
end

local hitBuf = {}

-- Begins-touching for a scripted body's moves: hit fires once per touch.
local function moverHits(self, count)
	local was = self._touching
	local now = {}
	local records = nil
	for i = 0, count - 1 do
		local j = i * 6
		local o = slots[hitBuf[j + 1]]
		if o and o ~= self and not now[o] then
			now[o] = true
			records = records or {}
			records[#records + 1] = { o, hitBuf[j + 2], hitBuf[j + 3], hitBuf[j + 4], hitBuf[j + 5], hitBuf[j + 6] }
		end
	end
	self._touching = now
	self._moveContacts = records
	if not records then return end
	for _, r in ipairs(records) do
		local o = r[1]
		-- Physics bodies get their hits from Box2D's contacts.
		if not (was and was[o]) and o._btype ~= BODY_DYNAMIC and not o._dead then
			local impulse = r[6] * (self.mass or 1)
			sendHit(self, o, r[2], r[3], r[4], r[5], impulse)
			if o.type == "Body" then sendHit(o, self, r[2], r[3], -r[4], -r[5], impulse) end
		end
	end
end

function Body:move()
	if self.motion ~= "scripted" then
		if self.motion == "physics" then return end
		error("move() is for bodies whose motion is \"scripted\"; this one is \"" .. tostring(self.motion) .. "\"", 2)
	end
	local body = ensure(self)
	if not body then return end
	if self._motion ~= "scripted" then syncBody(self, scene.getDelta()) end
	local dt = scene.getDelta()
	local x, y, angle = worldPose(self)
	local spin = self.spin
	if spin ~= 0 then angle = angle + spin * RAD * dt end
	local nx, ny, vx, vy, flags, ground, count = b2.move(body, x, y, angle, self.vx * dt, self.vy * dt, self.vx, self.vy,
		self.slope * RAD + SLOPE_MARGIN, self._onGround, self._ground or 0, self.mass, dt, hitBuf)
	setWorldPose(self, nx, ny, spin ~= 0 and angle or nil)
	self.vx, self.vy = vx, vy
	self._onGround = flags % 2 == 1
	self._onWall = floor(flags / 2) % 2 == 1
	self._onCeiling = floor(flags / 4) % 2 == 1
	self._ground = ground ~= 0 and ground or nil
	moverHits(self, count)
end

function Body:moveBy(dx, dy)
	local body = ensure(self)
	if not body or self.motion == "physics" then
		self:translate(dx, dy)
		return nil
	end
	local x, y, angle = worldPose(self)
	local nx, ny, fraction = b2.moveBy(body, x, y, angle, dx, dy)
	setWorldPose(self, nx, ny)
	b2.setTransform(body, nx, ny, angle)
	if fraction < 1 then
		-- What's in the way: whatever it touches now on that side.
		local _, _, _, _, _, _, count = b2.move(body, nx, ny, angle, 0, 0, 0, 0, self.slope * RAD + SLOPE_MARGIN, false, 0, self.mass, 1, hitBuf)
		b2.setTransform(body, nx, ny, angle)
		for i = 0, count - 1 do
			local j = i * 6
			local o = slots[hitBuf[j + 1]]
			if o and o ~= self and (dx * hitBuf[j + 4] + dy * hitBuf[j + 5]) < 0 then return o end
		end
	end
	return nil
end

function Body:onGround() return self._onGround == true end
function Body:onWall() return self._onWall == true end
function Body:onCeiling() return self._onCeiling == true end

-- The box around a body's shapes in the scene, or nil.
local function boundsOf(n)
	local body = ensure(n)
	if not body then return nil end
	updateShapes(n, false)
	return b2.bodyAABB(body)
end
M.boundsOf = boundsOf

function Body:getSize()
	local x0, y0, x1, y1 = boundsOf(self)
	if not x0 then return 0, 0 end
	return x1 - x0, y1 - y0
end

function Body:touchingTile(setting)
	local x0, y0, x1, y1 = boundsOf(self)
	if not x0 then return nil end
	for m = 1, #tilemaps do
		local found = tilemaps[m]:_findInBox(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5, setting)
		if found then return found end
	end
	return nil
end

-- Pushes: a physics body gets them from Box2D; a scripted one changes its
-- speed (by impulse / mass); a still one doesn't move.
function Body:applyImpulse(ix, iy, x, y)
	local body = ensure(self)
	if not body then return end
	if self._btype == BODY_DYNAMIC then
		b2.applyImpulse(body, ix, iy, x, y)
		local vx, vy, spin = b2.getVelocity(body)
		self.vx, self.vy, self.spin = vx, vy, spin * DEG
		self._lastVx, self._lastVy, self._lastSpin = self.vx, self.vy, self.spin
		self.asleep, self._lastAsleep = false, false
	elseif self.motion == "scripted" then
		local m = self.mass > 0 and self.mass or 1
		self.vx, self.vy = self.vx + ix / m, self.vy + iy / m
	end
end
Body.push = Body.applyImpulse

function Body:applyForce(fx, fy, x, y)
	local body = ensure(self)
	if not body then return end
	if self._btype == BODY_DYNAMIC then
		b2.applyForce(body, fx, fy, x, y)
		self.asleep, self._lastAsleep = false, false
	elseif self.motion == "scripted" then
		local m = self.mass > 0 and self.mass or 1
		local dt = scene.getDelta()
		self.vx, self.vy = self.vx + fx / m * dt, self.vy + fy / m * dt
	end
end

function Body:applyTorque(t)
	local body = ensure(self)
	if body and self._btype == BODY_DYNAMIC then
		b2.applyTorque(body, t)
		self.asleep, self._lastAsleep = false, false
	end
end

function Body:applyAngularImpulse(i)
	local body = ensure(self)
	if body and self._btype == BODY_DYNAMIC then
		b2.applyAngularImpulse(body, i)
		local vx, vy, spin = b2.getVelocity(body)
		self.vx, self.vy, self.spin = vx, vy, spin * DEG
		self._lastVx, self._lastVy, self._lastSpin = self.vx, self.vy, self.spin
		self.asleep, self._lastAsleep = false, false
	end
end

function Body:wake()
	local body = ensure(self)
	if body and self._btype == BODY_DYNAMIC then
		b2.setAwake(body, true)
		self.asleep, self._lastAsleep = false, false
	end
end

-- Dragging with the mouse: a mouse joint pulls the grabbed point towards
-- the pointer, so the body swings, bumps into things and keeps its speed
-- when dropped. Other bodies follow the point directly.
function Body:grab(x, y, strength)
	local body = ensure(self)
	if not body then return end
	if self._grab then self:drop() end
	x, y = x or select(1, worldPose(self)), y or select(2, worldPose(self))
	if self._btype == BODY_DYNAMIC then
		local mass = b2.getMass(body)
		self._grab = b2.createJoint("mouse", anchor, body, x, y, {
			hertz = 6, damping = 0.9, maxForce = strength or 60 * max(mass, 0.01) * 980,
		})
		self.asleep, self._lastAsleep = false, false
	else
		local px, py = worldPose(self)
		self._grabDX, self._grabDY = px - x, py - y
		self._grab = false
	end
	self._grabbing = true
end

function Body:dragTo(x, y)
	if not self._grabbing then return end
	if self._grab then
		b2.setJointTarget(self._grab, x, y)
	else
		setWorldPose(self, x + (self._grabDX or 0), y + (self._grabDY or 0))
	end
end

function Body:drop()
	if self._grab then b2.destroyJoint(self._grab) end
	self._grab, self._grabbing = nil, nil
end

function Body:isGrabbed() return self._grabbing == true end

---------------------------------------------------------------------------
-- Touching

-- How far apart two pieces' shapes are (0: overlapping), or nil.
local function distance(a, b)
	local ba, bb = ensure(a), ensure(b)
	if not ba or not bb then return nil end
	updateShapes(a, false)
	updateShapes(b, false)
	-- Measured where the pieces are now (scripts may have moved them this step).
	local ax, ay, aa = worldPose(a)
	local bx, by, bA = worldPose(b)
	return b2.bodyDistance(ba, bb, ax, ay, aa, bx, by, bA)
end

local TOUCH = 1 -- pixels apart that still count as touching

local function touching(self, what)
	local candidates
	if type(what) == "table" then
		candidates = { what }
	else
		candidates = scene.tagged(what)
	end
	for _, o in ipairs(candidates) do
		if o ~= self and not o._dead and (o.type == "Body" or o.type == "Zone") then
			local d = distance(self, o)
			local limit = (self.type == "Zone" or o.type == "Zone") and 0 or TOUCH
			if d and d <= limit then return o end
		end
	end
	return nil
end

Body.touching = touching

function Body:isTouching(other)
	if type(other) ~= "table" then return touching(self, other) ~= nil end
	if other.type == "Tiles" then
		local t = other._phys
		if not t or not self._body then return false end
		for _, c in ipairs(self:contacts()) do
			if c.piece == other then return true end
		end
		return false
	end
	return touching(self, other) ~= nil
end

local contactsBuf = {}

---A list of what the body touches now: {piece, x, y, nx, ny, impulse}, the
---normal pointing towards this body.
function Body:contacts()
	local out = {}
	local body = ensure(self)
	if not body then return out end
	local seen = {}
	local count = b2.bodyContacts(body, contactsBuf)
	for i = 0, count - 1 do
		local j = i * 6
		local o = slots[contactsBuf[j + 1]]
		if o and not seen[o] then
			seen[o] = true
			out[#out + 1] = { piece = o, x = contactsBuf[j + 2], y = contactsBuf[j + 3], nx = contactsBuf[j + 4],
				ny = contactsBuf[j + 5], impulse = contactsBuf[j + 6] }
		end
	end
	if self._moveContacts then
		for _, r in ipairs(self._moveContacts) do
			local o = r[1]
			if not seen[o] and not o._dead then
				seen[o] = true
				out[#out + 1] = { piece = o, x = r[2], y = r[3], nx = r[4], ny = r[5], impulse = r[6] * (self.mass or 1) }
			end
		end
	end
	return out
end

---------------------------------------------------------------------------
-- Zones

local Zone = nodeLib.classes.Zone

function Zone:_enter()
	addTo(zones, self)
	self._in = {}
	self._forcing = false
	create(self)
end

function Zone:_exit()
	removeFrom(zones, self)
	destroy(self)
	if self._forcing then setForcing(self, false) end
	self._in = nil
end

function Zone:inside()
	local out = {}
	for o in pairs(self._in or {}) do
		if not o._dead then out[#out + 1] = o end
	end
	table.sort(out, function(p, q) return (p._slot or 0) < (q._slot or 0) end)
	return out
end

Zone.touching = touching
Zone.isTouching = function(self, other) return touching(self, other) ~= nil end

---------------------------------------------------------------------------
-- Queries (smitten.physics and the short script API)

local function wanted(n, tags)
	return n and not n._dead and (tags == nil or tags == "" or n:hasAnyTag(tags))
end

local rayBuf = {}

local function rayHits(x1, y1, x2, y2, tags, all, zonesToo)
	if not world then return all and {} or nil end
	local count = b2.raycast(world, x1, y1, x2, y2, rayBuf, zonesToo)
	local out = all and {} or nil
	local seen = {}
	for i = 0, count - 1 do
		local j = i * 6
		local n = slots[rayBuf[j + 1]]
		if wanted(n, tags) and not seen[n] then
			seen[n] = true
			local hit = { piece = n, x = rayBuf[j + 2], y = rayBuf[j + 3], nx = rayBuf[j + 4], ny = rayBuf[j + 5],
				fraction = rayBuf[j + 6] }
			if not all then return hit end
			out[#out + 1] = hit
		end
	end
	return out
end

function M.raycast(x1, y1, x2, y2, tags) return rayHits(x1, y1, x2, y2, tags, false, false) end
function M.raycastAll(x1, y1, x2, y2, tags) return rayHits(x1, y1, x2, y2, tags, true, false) end

local queryBuf = {}

local function piecesFrom(count, tags)
	local out, seen = {}, {}
	for i = 1, count do
		local n = slots[queryBuf[i]]
		if wanted(n, tags) and not seen[n] and n.type ~= "Tiles" then
			seen[n] = true
			out[#out + 1] = n
		end
	end
	return out
end

function M.piecesAt(x, y, tags)
	if not world then return {} end
	return piecesFrom(b2.pointQuery(world, x, y, queryBuf), tags)
end

function M.overlap(kind, a, b, c, d, e)
	if not world then return {} end
	if kind == "circle" then
		return piecesFrom(b2.overlapShape(world, queryBuf, "circle", a, b, c), d)
	elseif kind == "rect" or kind == "rectangle" then
		return piecesFrom(b2.overlapShape(world, queryBuf, "rect", a, b, c / 2, d / 2, 0), e)
	end
	error("overlap() needs \"circle\", x, y, radius or \"rect\", x, y, width, height", 2)
end

function M.getGravity()
	if world then return b2.getGravity(world) end
	if gravityX then return gravityX, gravityY end
	return projectGravity()
end

function M.setGravity(x, y)
	gravityX, gravityY = x, y
	if world then
		b2.setGravity(world, x, y)
		-- Sleeping bodies don't notice: wake them.
		for i = 1, #bodies do
			local n = bodies[i]
			if n._btype == BODY_DYNAMIC and n._body then b2.setAwake(n._body, true) end
		end
	end
end

---------------------------------------------------------------------------
-- Showing shapes (the editor's "Shapes" switch, or smitten.scene.showShapes)

local function drawShapes(self)
	if not scene.showShapes or not self._desc or not self._body then return end
	local g = love.graphics
	local x, y, angle = worldPose(self)
	g.push()
	g.translate(x, y)
	g.rotate(angle)
	if self.type == "Zone" then g.setColor(0.4, 0.9, 0.5, 0.3) else g.setColor(0.3, 0.7, 1, 0.3) end
	for _, s in ipairs(self._desc) do
		if s.kind == "circle" then
			g.circle("fill", s[1], s[2], s[3])
		elseif s.kind == "box" then
			g.push()
			g.translate(s[1], s[2])
			g.rotate(s[5] or 0)
			g.rectangle("fill", -s[3], -s[4], s[3] * 2, s[4] * 2)
			g.pop()
		elseif s.kind == "capsule" then
			local dx, dy = s[3] - s[1], s[4] - s[2]
			local len = sqrt(dx * dx + dy * dy)
			g.circle("fill", s[1], s[2], s[5])
			g.circle("fill", s[3], s[4], s[5])
			g.push()
			g.translate((s[1] + s[3]) / 2, (s[2] + s[4]) / 2)
			g.rotate(atan2(dy, dx))
			g.rectangle("fill", -len / 2, -s[5], len, s[5] * 2)
			g.pop()
		elseif s.kind == "polygon" and s.points and #s.points >= 6 then
			g.polygon("fill", s.points)
		end
	end
	g.pop()
end

Body._drawWorld = drawShapes
Zone._drawWorld = drawShapes

return M
