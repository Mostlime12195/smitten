-- graphics3d.environment: background, ambient light and fog, plus the light
-- tables g3d.begin takes.
--
--   local env = g3d.newEnvironment{background = "sky", fog = true, fogEnd = 80}
--
-- background: "color" (fills with `color`), "sky" (a gradient from skyTop
-- through skyHorizon to skyBottom, which also lights and reflects in the
-- scene), or "none" (keeps what is already drawn; only depth is cleared).
-- Colors are sRGB {r, g, b}. ambient (times ambientEnergy) lights every
-- surface: with "sky" it tints the light from the sky above and the ground
-- below (default white); otherwise it is the ambient color (default: the
-- background color). fogColor defaults to the horizon or background color.
--
-- Lights are plain tables:
--   {type = "directional", dx, dy, dz, color, energy, shadows = true}
--   {type = "point", x, y, z, range = 10, color, energy}
--   {type = "spot", x, y, z, dx, dy, dz, range, angle = math.rad(30), color, energy}
-- A spot light's angle is the half-angle of its cone. Directional lights may
-- also set shadowDistance (meters from the camera that get shadows, default
-- 50), shadowMapSize (default 2048) and shadowBias.

local M = {}

---@class graphics3d.Environment
---@field background "color"|"sky"|"none"
---@field color number[]
---@field skyTop number[]
---@field skyHorizon number[]
---@field skyBottom number[]
---@field ambient number[]?
---@field ambientEnergy number
---@field fog boolean
---@field fogColor number[]?
---@field fogStart number
---@field fogEnd number
local Environment = {}
Environment.__index = Environment
Environment.isEnvironment = true
M.Environment = Environment

local function rgb(c, default)
	c = c or default
	return { c[1] or 0, c[2] or 0, c[3] or 0 }
end

---@return graphics3d.Environment
function M.newEnvironment(opts)
	opts = opts or {}
	if type(opts) ~= "table" then error("graphics3d.newEnvironment: expected a table of fields", 2) end
	local background = opts.background or "color"
	if background ~= "color" and background ~= "sky" and background ~= "none" then
		error("graphics3d.newEnvironment: background must be \"color\", \"sky\" or \"none\", not " .. tostring(background), 2)
	end
	return setmetatable({
		background = background,
		color = rgb(opts.color, { 0.3, 0.3, 0.3 }),
		skyTop = rgb(opts.skyTop, { 0.26, 0.47, 0.80 }),
		skyHorizon = rgb(opts.skyHorizon, { 0.72, 0.80, 0.90 }),
		skyBottom = rgb(opts.skyBottom, { 0.32, 0.30, 0.27 }),
		-- nil: derived from the sky (or a neutral grey for "color").
		ambient = opts.ambient and rgb(opts.ambient) or nil,
		ambientEnergy = opts.ambientEnergy or 1,
		fog = opts.fog or false,
		fogColor = opts.fogColor and rgb(opts.fogColor) or nil,
		fogStart = opts.fogStart or 10,
		fogEnd = opts.fogEnd or 100,
	}, Environment)
end

M.default = M.newEnvironment({ background = "color" })

local VALID_TYPES = { directional = true, point = true, spot = true }

---Checks a light table and fills in what g3d.begin reads, without changing it.
function M.checkLight(light, index)
	if type(light) ~= "table" then
		error(("graphics3d.begin: light %d must be a table like {type = \"point\", x = 0, y = 2, z = 0}"):format(index), 3)
	end
	if not VALID_TYPES[light.type] then
		error(("graphics3d.begin: light %d has type %s; use \"directional\", \"point\" or \"spot\""):format(index, tostring(light.type)), 3)
	end
end

return M
