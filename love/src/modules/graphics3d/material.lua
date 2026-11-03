-- graphics3d.material: how a surface looks.
--
--   local red = g3d.newMaterial{color = {1, 0.2, 0.2}, roughness = 0.3}
--   red.metallic = 1          -- fields can be changed at any time
--
-- Fields: color {r,g,b,a} (sRGB, like every LÖVE color), texture (an Image,
-- multiplied with color), roughness 0..1, metallic 0..1, emission {r,g,b},
-- unshaded (ignore lights), transparent (blend; also when color alpha < 1),
-- doubleSided (draw back faces), uvScale {u,v} and uvOffset {u,v} (tiling a
-- texture sets its wrap to repeat), alphaCutoff (discard pixels with alpha
-- below it; 0 = off), castShadows (default true).

local M = {}

---@class graphics3d.Material
---@field color number[]
---@field texture love.Texture?
---@field roughness number
---@field metallic number
---@field emission number[]
---@field unshaded boolean
---@field transparent boolean
---@field doubleSided boolean
---@field uvScale number[]
---@field uvOffset number[]
---@field alphaCutoff number
---@field castShadows boolean
---@field id integer used to sort draws by material
local Material = {}
Material.__index = Material
Material.isMaterial = true
M.Material = Material

local nextId = 0

local function color3(name, c, default)
	if c == nil then return { default[1], default[2], default[3] } end
	if type(c) ~= "table" then error(("graphics3d.newMaterial: %s must be a table like {r, g, b}"):format(name), 3) end
	return { c[1] or 0, c[2] or 0, c[3] or 0, c[4] }
end

---@return graphics3d.Material
function M.newMaterial(opts)
	opts = opts or {}
	if type(opts) ~= "table" then error("graphics3d.newMaterial: expected a table of fields", 2) end
	nextId = nextId + 1
	local color = color3("color", opts.color, { 1, 1, 1 })
	color[4] = color[4] or 1
	local emission = color3("emission", opts.emission, { 0, 0, 0 })
	local uvScale = opts.uvScale or { 1, 1 }
	local uvOffset = opts.uvOffset or { 0, 0 }
	return setmetatable({
		id = nextId,
		color = color,
		texture = opts.texture,
		roughness = opts.roughness or 0.6,
		metallic = opts.metallic or 0,
		emission = emission,
		unshaded = opts.unshaded or false,
		transparent = opts.transparent or false,
		doubleSided = opts.doubleSided or false,
		uvScale = { uvScale[1] or 1, uvScale[2] or uvScale[1] or 1 },
		uvOffset = { uvOffset[1] or 0, uvOffset[2] or 0 },
		alphaCutoff = opts.alphaCutoff or 0,
		castShadows = opts.castShadows ~= false,
		name = opts.name,
	}, Material)
end

---True when the material is drawn in the blended (transparent) pass.
function Material:isTransparent()
	-- With an alpha cutoff, alpha only decides which pixels are drawn.
	return self.transparent or (self.alphaCutoff <= 0 and (self.color[4] or 1) < 1)
end

---A copy with its own id and tables.
function Material:clone()
	local m = M.newMaterial(self)
	m.name = self.name
	return m
end

M.default = M.newMaterial({ color = { 0.8, 0.8, 0.8 }, name = "default" })

return M
