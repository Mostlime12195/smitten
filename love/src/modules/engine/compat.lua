-- Old projects keep the old rules.
--
-- A project's smitten.json carries "version". Version 3 changed four things
-- a script can see:
--
--   1. Angles are degrees everywhere a script meets one (rotation, spin,
--      angleTo(), a Joint's minAngle...). They were radians.
--   2. A Button's (Panel's, Picture's) event is clicked(); a TouchButton's
--      and TouchStick's are touched() and untouched(). They were pressed()
--      and released(), the names of the input calls.
--   3. Assigning a name a script never declared is an error. It quietly
--      made a new variable.
--   4. A Body's gravity multiplier is gravityScale. It was gravity.
--
-- A project of version 2 or less (every game published before this, whose
-- files nobody edits) runs with the old rules, exactly as it did. This
-- module is the one place that knows which rules a game plays by; the rest
-- of the engine asks it at a few boundaries and has no version checks:
--
--   * Angles. A piece's angle fields (n.rotation, n.spin, ...) hold the
--     unit the game's scripts use, because scripts read and write those
--     fields directly (self.rotation, other.rotation, tweens). The engine
--     works in radians, and multiplies by compat.rad where it reads such a
--     field and by compat.deg where it writes one or hands an angle to a
--     script. Old rules: both are 1, so nothing changes, bit for bit.
--     An Animator's keys keep angles in degrees (animations only exist in
--     version 3 files) and turn them into the game's unit with
--     compat.fromDegrees.
--   * Event names. Pieces send compat.event("clicked"): "clicked", or the
--     old name.
--   * Undeclared names. script.lua checks assignments when compat.strict.
--   * Names and defaults of properties. For an old project this module
--     gives the piece schema the old names and defaults when it loads,
--     before any piece is made; physics2d.lua reads the multiplier as
--     n[compat.gravityScale].
--   * Scene files say which rules they were saved with (their own
--     "version": 3 stores degrees and gravityScale). compat.scene() turns
--     one saved with the other rules into this game's, when it's loaded.
--   * The editor always talks in the new rules: live.lua translates with
--     compat.toEditor() and compat.fromEditor().
--
-- web/editor/core/update-project.js does the same scene conversion (old to
-- new only) for the editor: keep the two in step.

local compat = {}

local pi = math.pi

local function projectVersion()
	local fs = love and love.filesystem
	if not (fs and fs.getInfo("smitten.json", "file")) then return 3 end
	local ok, data = pcall(require("love.assets").readJSON, "smitten.json")
	if not ok or type(data) ~= "table" then return 3 end
	-- A smitten.json from before versions were written is an old project.
	return type(data.version) == "number" and data.version or 2
end

---The project's format version, and true for a project with the old rules.
compat.version = projectVersion()
compat.old = compat.version < 3

local old = compat.old

---Multiply a script's angle by rad for radians, radians by deg for a script.
compat.rad = old and 1 or pi / 180
compat.deg = old and 1 or 180 / pi

---Multiply an angle in degrees (an Animator's key for rotation, as scene
---files of version 3 keep angles) by this for the unit scripts use.
compat.fromDegrees = old and pi / 180 or 1

---Added to a Body's slope (in radians): a ramp of exactly 45 degrees counts
---as ground with slope = 45, whatever rounding does. The old default,
---0.7854 radians, had this much room over a quarter of pi already.
compat.slopeMargin = old and 0 or 2e-6

---True when assigning an undeclared name in a script is an error.
compat.strict = not old

---The field a Body keeps its gravity multiplier in.
compat.gravityScale = old and "gravity" or "gravityScale"

local OLD_EVENTS = { clicked = "pressed", touched = "pressed", untouched = "released" }

---The name a piece sends an event under in this game.
function compat.event(name)
	return old and OLD_EVENTS[name] or name
end

-- Old name -> the new names it may have now.
local RENAMED_EVENTS = { pressed = { "clicked", "touched" }, released = { "untouched" } }

---The new name of an event of a piece type that was renamed ("pressed" on
---a Button: "clicked"), for a hint; nil if it wasn't, or with the old rules.
function compat.renamedEvent(typeName, event)
	local names = not old and RENAMED_EVENTS[event]
	if not names then return nil end
	local types = require("love.scene.schema").types
	local name = typeName
	while name do
		local def = types[name]
		if not def then return nil end
		for i = 1, #names do
			if def.events and def.events[names[i]] then return names[i] end
		end
		name = def.extends
	end
	return nil
end

---------------------------------------------------------------------------
-- Properties whose default changed with the unit: what version 2 had.
-- motorSpeed is radians a second for a pin or a wheel, pixels a second for
-- a slider or a distance joint.

local OLD_DEFAULTS = {
	Particles = { direction = -1.5708, spread = 0.5 },
	Body = { slope = 0.7854 },
	Joint = { minAngle = -0.7854, maxAngle = 0.7854, motorSpeed = 2 },
}
compat.OLD_DEFAULTS = OLD_DEFAULTS

local TURNING_JOINT = { pin = true, wheel = true }

-- The piece schema (love.scene.schema, made from pieces.json) describes the
-- new rules. For an old project it gets the old names and defaults here,
-- when this module loads: before node.lua makes the classes from it.
local schema = require("love.scene.schema")

-- The new defaults of OLD_DEFAULTS' properties.
local NEW_DEFAULTS = {}
for base, olds in pairs(OLD_DEFAULTS) do
	local out = {}
	local props = schema.types[base] and schema.types[base].properties or {}
	for prop in pairs(olds) do out[prop] = props[prop] and props[prop].default end
	NEW_DEFAULTS[base] = out
end
compat.NEW_DEFAULTS = NEW_DEFAULTS

if old then
	for typeName, def in pairs(schema.types) do
		local olds = OLD_DEFAULTS[typeName] or {}
		for prop, p in pairs(def.properties or {}) do
			if olds[prop] ~= nil then
				p.default = olds[prop]
			elseif p.type == "angle" and type(p.default) == "number" then
				p.default = p.default * pi / 180
			end
		end
		local events = def.events
		if events then
			for new, was in pairs(OLD_EVENTS) do
				if events[new] then
					events[was] = events[new]
					events[new] = nil
				end
			end
		end
	end
	local body = schema.types.Body
	if body and body.properties and body.properties.gravityScale then
		body.properties.gravity = body.properties.gravityScale
		body.properties.gravityScale = nil
	end
end

---------------------------------------------------------------------------
-- Scene files

---Radians as degrees: 1.5708 is 90, not 90.0002 (a round number of
---hundredths within half a thousandth is what was meant).
local function toDegrees(v)
	local d = v * 180 / pi
	local nice = math.floor(d * 100 + 0.5) / 100
	if math.abs(d - nice) < 0.0005 then return nice end
	return math.floor(d * 1e6 + 0.5) / 1e6
end
compat.toDegrees = toDegrees

local function toRadians(v) return v * pi / 180 end

local function typeDef(name)
	return schema.types[name]
end

-- name -> true for the angle properties of a type (its own and inherited).
local angleProps = {}
local function anglesOf(typeName)
	local out = angleProps[typeName]
	if out then return out end
	out = {}
	local name = typeName
	while name do
		local def = typeDef(name)
		if not def then break end
		for prop, p in pairs(def.properties or {}) do
			if p.type == "angle" then out[prop] = true end
		end
		name = def.extends
	end
	angleProps[typeName] = out
	return out
end

local function isA(typeName, base)
	local name = typeName
	while name do
		if name == base then return true end
		local def = typeDef(name)
		name = def and def.extends
	end
	return false
end

-- The type of the root of a scene another scene places (for its entries,
-- which carry no type of their own).
local resolving = {}
local function rootType(path, depth)
	-- Scenes that place each other in a circle: love.scene says so later.
	if depth > 16 or resolving[path] then return "Group" end
	resolving[path] = true
	local ok, data = pcall(require("love.assets").scene, path)
	resolving[path] = nil
	if not ok or type(data) ~= "table" or type(data.root) ~= "table" then return "Group" end
	if data.root.scene then return rootType(data.root.scene, depth + 1) end
	return data.root.type or "Group"
end

-- One entry of a scene saved with the other rules, into this game's.
-- toOld: the file is version 3 and the game has the old rules.
local function convertEntry(e, toOld)
	local placed = e.scene ~= nil
	local typeName = placed and rootType(e.scene, 0) or e.type or "Group"
	local props = e.properties
	local convert = toOld and toRadians or toDegrees
	if typeDef(typeName) then
		local joint = isA(typeName, "Joint")
		local turning = joint and TURNING_JOINT[(props and props.kind) or typeDef("Joint").properties.kind.default]
		if props then
			for prop in pairs(anglesOf(typeName)) do
				if type(props[prop]) == "number" then props[prop] = convert(props[prop]) end
			end
			if turning and type(props.motorSpeed) == "number" then props.motorSpeed = convert(props.motorSpeed) end
		end
		-- A property left at its default keeps the default it was saved
		-- under, where the two rules' defaults differ (a scene placed in
		-- another leaves that to its own file).
		if not placed then
			for base, olds in pairs(OLD_DEFAULTS) do
				if isA(typeName, base) then
					for prop, was in pairs(olds) do
						-- (null in the file means the default, as leaving it out does.)
						if props == nil or props[prop] == nil or props[prop] == require("love.json").null then
							local angle = prop ~= "motorSpeed" or turning
							local now = NEW_DEFAULTS[base][prop]
							local saved = toOld and now or was
							if angle then saved = convert(saved) end
							local mine = toOld and was or now
							if type(mine) == "number" and math.abs(saved - mine) > (toOld and 1e-4 or 0.005) then
								props = props or {}
								e.properties = props
								props[prop] = saved
							end
						end
					end
				end
			end
		end
		if isA(typeName, "Body") and props then
			if toOld then
				if props.gravityScale ~= nil then
					-- (The old rules have one name for both: a script's own
					-- gravity, if the scene sets one, keeps it.)
					if props.gravity == nil then props.gravity = props.gravityScale end
					props.gravityScale = nil
				end
			elseif type(props.gravity) == "number" and props.gravity <= 50 and props.gravityScale == nil then
				-- A big gravity was a script's own variable (see jumpSpeed).
				props.gravityScale = props.gravity
				props.gravity = nil
			end
		end
	end
	if e.children then
		for _, c in ipairs(e.children) do convertEntry(c, toOld) end
	end
end

---A scene file's data (decoded, changed in place) under this game's rules.
---A file saved with the same rules is left exactly as it is.
function compat.scene(data)
	local fileOld = not (type(data.version) == "number" and data.version >= 3)
	if fileOld == old then return data end
	if type(data.root) == "table" then convertEntry(data.root, old) end
	return data
end

---------------------------------------------------------------------------
-- The editor (live.lua) shows and sets properties in the new rules.

---A property of a running piece, as the editor names and measures it.
function compat.toEditor(n, key, value)
	if not old then return key, value end
	if key == "gravity" and n.motion ~= nil and n.fixedRotation ~= nil then return "gravityScale", value end
	if type(value) == "number" then
		if anglesOf(n.type)[key]
			or (key == "motorSpeed" and TURNING_JOINT[n.kind]) then
			return key, value * 180 / pi
		end
	end
	return key, value
end

---The other way: what the editor set, as the game keeps it.
function compat.fromEditor(n, key, value)
	if not old then return key, value end
	if key == "gravityScale" and n.motion ~= nil and n.fixedRotation ~= nil then return "gravity", value end
	if type(value) == "number" then
		if anglesOf(n.type)[key]
			or (key == "motorSpeed" and TURNING_JOINT[n.kind]) then
			return key, value * pi / 180
		end
	end
	return key, value
end

return compat
