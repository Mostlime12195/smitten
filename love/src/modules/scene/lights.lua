-- Light, Occluder and Tint: lights, shadows and the scene's ambient color
-- (docs/lights.md).
--
-- THE MODEL (Godot's, in Smitten's words)
--
--   shown = piece's color x (tint + what the lights add - subtract, mix)
--
-- A Tint multiplies the pieces it applies to (white when there is none); each
-- Light then adds to (blend "add"), takes from ("subtract") or replaces
-- ("mix") that amount where it shines. So lights alone brighten a normally
-- lit scene, a Tint alone is a color grade, and a dark Tint with lights is
-- night. A piece with lit = false (inherited, like visible) ignores all of it.
--
-- HOW IT IS DRAWN
--
-- A scene with no Light and no Tint never comes here: nodes2d.render checks
-- one counter (nodes2d._lights, kept by _enter/_exit below) and takes its
-- usual path, with no canvas, shader or extra pass. With one, render() below
-- draws the frame:
--
--  1. One walk of the tree (the same walk the renderer makes anyway) lists the
--     draw items and finds the visible Lights, Occluders, shadow-casting
--     Tiles and the first Tint, with their place in the scene.
--  2. Lights whose reach misses the view are dropped.
--  3. Lit pieces are sorted into light groups: pieces the same lights (and the
--     Tint) apply to. A scene whose lights have no `lights` tags and no layer
--     range has one group. Each group gets a light map: a canvas the size of
--     what the game draws to, cleared to the Tint (or white) and with every
--     light of the group drawn into it, one textured quad each, with the
--     light's blend mode. The maps are half-float where the browser can
--     render to that (nearly everywhere), so light adds up past white; if
--     not, they're 8 bit and hold up to twice white.
--  4. The pieces are drawn exactly as usual and in the usual order, lit ones
--     through a small shader that multiplies their color by their group's
--     light map at that pixel; unlit ones with no shader. That keeps an unlit
--     glow between two lit sprites between them.
--
-- SHADOWS are geometry: for a light with shadows on, every occluder edge
-- facing away from it is stretched away from the light into a shadow mask
-- (one shared canvas), and the light is drawn multiplied by what the mask
-- leaves. Only far edges cast, so the occluder itself stays lit and shadows
-- are exact at any distance and resolution (a 1D shadow map per light, the
-- other usual way, needs a texture upload per moving light and has soft,
-- wobbly edges on big pixels). shadowSoftness blurs the mask (two passes over
-- the light's rectangle), so soft shadows cost more and their blur is the
-- same width everywhere rather than growing with distance.
--
-- Occluder edges are kept in scene coordinates and worked out again only when
-- the occluder's shape or place changes. Tiles make edges for each 32x32
-- chunk when a light first reaches it, merging runs of solid tiles, and again
-- only for chunks whose tiles change.
--
-- WHAT IT COSTS
--
--   a light           one quad the size of its reach, per group it lights
--   + shadows         a clear of the mask, one 5-corner polygon for each far
--                     edge within reach, and a texture lookup in the quad
--   + shadowSoftness  two blur passes over the light's rectangle
--   lit pieces        one texture lookup more per pixel
--   each light group  one canvas the size of the screen
--
-- LIMITS
--
--  - At most 24 lights in view can have `lights` tags or a layer range at
--    once, and at most 8 light groups; past that a light's mask is ignored
--    (it lights everything) or pieces join the first group. A warning says so.
--  - A script's draw() that sets its own shader isn't lit.
--  - Lights blend in the order they joined the scene (it matters for "mix").
--  - An endless sun shadow uses shadow-casting tiles up to two screens away.

local nodeLib = require("love.scene.node")
local nodes2d = require("love.scene.nodes2d")

local cos, sin, sqrt, floor, abs = math.cos, math.sin, math.sqrt, math.floor, math.abs
local min, max, huge = math.min, math.max, math.huge

local classes = nodeLib.classes
local Light, Occluder, Tint, Tiles = classes.Light, classes.Occluder, classes.Tint, classes.Tiles
local hasPosition = nodes2d.hasPosition

local L = {}

-- What collect() looks for (one field read per piece).
local IS_LIGHT, IS_OCCLUDER, IS_TINT, IS_TILES = 1, 2, 3, 4
Light._lk, Occluder._lk, Tint._lk, Tiles._lk = IS_LIGHT, IS_OCCLUDER, IS_TINT, IS_TILES

local MAX_MASKED = 24   -- lights with tags or a layer range, in view at once
local MAX_GROUPS = 8    -- light maps
local CHUNK = 32        -- tiles per side of a chunk of edges
local CIRCLE_SIDES = 24

-- For tests and for measuring: frames drawn here, and the last frame's work.
L._frames = 0
L._stats = { lights = 0, shadowLights = 0, groups = 0, edges = 0, float = false }

---------------------------------------------------------------------------
-- The pieces

local all = {}   -- every Light in the running scene, in the order they joined

local function joined()
	nodes2d._lights = nodes2d._lights + 1
end

local function left()
	nodes2d._lights = max(0, nodes2d._lights - 1)
	if nodes2d._lights == 0 then L._release() end
end

function Light:_enter()
	all[#all + 1] = self
	joined()
end

function Light:_exit()
	for i = #all, 1, -1 do
		if all[i] == self then table.remove(all, i) end
	end
	left()
end

Tint._enter = joined
Tint._exit = left

local warned = {}
local function warnOnce(key, text, limit)
	if warned[key] then return end
	warned[key] = true
	print("Warning: " .. text:format(limit))
end
local TOO_MANY_MASKED = "more than %d lights in view use tags or layers at once: the rest light everything"
local TOO_MANY_GROUPS = "more than %d different combinations of lights (tags and layers) are in view: some pieces get the wrong lights"

local BLENDS = { add = "add", subtract = "subtract", mix = "alpha" }

---------------------------------------------------------------------------
-- Shaders and canvases

local litShader, lightShader, shadowLightShader, blurShader
local white
local mapFormat, mapScale = nil, 1
local pw, ph = 0, 0          -- the size of the light maps, in pixels
local maps = {}              -- light map canvases
local mask, mask2            -- the shadow mask and the blur's other canvas

local LIT = [[
uniform Image lightMap;
uniform vec3 lightInfo;
vec4 effect(vec4 color, Image tex, vec2 uv, vec2 sc) {
	vec4 c = Texel(tex, uv) * color;
	vec3 l = max(Texel(lightMap, sc * lightInfo.xy).rgb, vec3(0.0)) * lightInfo.z;
	return vec4(c.rgb * l, c.a);
}
]]

-- lightParams: brightness (already divided by the map's scale), 1 for the
-- built-in round glow, 1 for blend "mix".
local LIGHT = [[
uniform vec3 lightParams;
#ifdef SHADOWS
uniform Image shadowMask;
uniform vec2 shadowInfo;
uniform vec4 shadowColor;
#endif
vec4 effect(vec4 color, Image tex, vec2 uv, vec2 sc) {
	vec4 t = Texel(tex, uv);
	float a = t.a * color.a;
	if (lightParams.y > 0.5) {
		float d = clamp(1.0 - length(uv * 2.0 - vec2(1.0)), 0.0, 1.0);
		a *= d * d * (3.0 - 2.0 * d);
	}
	vec3 rgb = t.rgb * color.rgb * lightParams.x;
#ifdef SHADOWS
	float s = Texel(shadowMask, sc * shadowInfo).r * shadowColor.a;
	if (lightParams.z > 0.5) {
		a *= 1.0 - s;
	} else {
		rgb *= mix(vec3(1.0), shadowColor.rgb, s);
	}
#endif
	return vec4(rgb, a);
}
]]

local BLUR = [[
uniform vec2 blurStep;
vec4 effect(vec4 color, Image tex, vec2 uv, vec2 sc) {
	float s = Texel(tex, uv).r * 0.2270270270;
	s += (Texel(tex, uv + blurStep * 1.3846153846).r + Texel(tex, uv - blurStep * 1.3846153846).r) * 0.3162162162;
	s += (Texel(tex, uv + blurStep * 3.2307692308).r + Texel(tex, uv - blurStep * 3.2307692308).r) * 0.0702702703;
	return vec4(s);
}
]]

local function setup()
	if litShader then return end
	local g = love.graphics
	litShader = g.newShader(LIT)
	lightShader = g.newShader(LIGHT)
	shadowLightShader = g.newShader("#define SHADOWS 1\n" .. LIGHT)
	blurShader = g.newShader(BLUR)
	local data = love.image.newImageData(1, 1)
	data:setPixel(0, 0, 1, 1, 1, 1)
	white = g.newImage(data)
	white:setFilter("linear", "linear")
	-- Half-float light maps where they can be drawn to; else 8 bit holding
	-- half the light, so it still adds up to twice white.
	local ok, formats = pcall(g.getTextureFormats, { canvas = true })
	if ok and type(formats) == "table" and formats.rgba16f then
		mapFormat, mapScale = "rgba16f", 1
	else
		mapFormat, mapScale = "rgba8", 2
	end
	L._stats.float = mapFormat == "rgba16f"
end

local function newCanvas(format)
	local c = love.graphics.newCanvas(pw, ph, { dpiscale = 1, format = format })
	c:setFilter("linear", "linear")
	c:setWrap("clamp", "clamp")
	return c
end

local function releaseCanvases()
	for i = #maps, 1, -1 do
		maps[i]:release()
		maps[i] = nil
	end
	if mask then mask:release() end
	if mask2 then mask2:release() end
	mask, mask2 = nil, nil
end

-- Frees the canvases when the last Light or Tint leaves the scene.
function L._release()
	releaseCanvases()
end

local function mapCanvas(i)
	local c = maps[i]
	if not c then
		local ok, made = pcall(newCanvas, mapFormat)
		if not ok and mapFormat ~= "rgba8" then
			mapFormat, mapScale = "rgba8", 2
			L._stats.float = false
			made = newCanvas(mapFormat)
		elseif not ok then
			error(made, 0)
		end
		c = made
		maps[i] = c
	end
	return c
end

---------------------------------------------------------------------------
-- Collecting: the draw items, and the lights, occluders and tint in view

local items = {}
local sorted = {}
local count, order = 0, 0
local frame = 0
local tagLights, nTagLights = {}, 0   -- lights with a `lights` tag list
local occluders, nOccluders = {}, 0
local tintPiece = nil

local function collect(n, a, b, c, d, tx, ty, tr, tg, tb, ta, z, lit, tags)
	if n._dead then return end
	local kind = n._lk
	if hasPosition(n) then
		if not n.visible then return end
		local pa, pb, pc, pd, px, py = a, b, c, d, tx, ty
		local r = n.rotation
		local cr, sr = cos(r), sin(r)
		local la, lb, lc, ld = cr * n.scaleX, sr * n.scaleX, -sr * n.scaleY, cr * n.scaleY
		local x, y = n.x, n.y
		tx, ty = a * x + c * y + tx, b * x + d * y + ty
		a, b, c, d = a * la + c * lb, b * la + d * lb, a * lc + c * ld, b * lc + d * ld
		local t = n.tint
		tr, tg, tb, ta = tr * t[1], tg * t[2], tb * t[3], ta * (t[4] or 1)
		z = z + n.layer
		if lit and n.lit == false then lit = false end
		if nTagLights > 0 and n._tags then
			for j = 1, nTagLights do
				local tl = tagLights[j]
				local bit = tl._tagBit
				if tags % (bit * 2) < bit and n:hasAnyTag(tl.lights) then tags = tags + bit end
			end
		end
		if n._draw or n.draw or n._drawWorld then
			count = count + 1
			order = order + 1
			local it = items[count]
			if not it then
				it = {}
				items[count] = it
			end
			it.node, it.a, it.b, it.c, it.d, it.tx, it.ty = n, a, b, c, d, tx, ty
			it.r, it.g, it.bl, it.al, it.z, it.order = tr, tg, tb, ta, z, order
			it.lit, it.tags, it.group = lit, tags, 0
		end
		if kind then
			if kind == IS_LIGHT then
				if not n.off then
					n._seen = frame
					n._wa, n._wb, n._wc, n._wd, n._wx, n._wy = a, b, c, d, tx, ty
					n._tr, n._tg, n._tb, n._ta = tr, tg, tb, ta
				end
			elseif kind == IS_OCCLUDER then
				if not n.off then
					nOccluders = nOccluders + 1
					occluders[nOccluders] = n
					n._wa, n._wb, n._wc, n._wd, n._wx, n._wy = a, b, c, d, tx, ty
					n._pa, n._pb, n._pc, n._pd, n._px, n._py = pa, pb, pc, pd, px, py
				end
			elseif n.castShadows then
				nOccluders = nOccluders + 1
				occluders[nOccluders] = n
				n._wa, n._wb, n._wc, n._wd, n._wx, n._wy = a, b, c, d, tx, ty
			end
		end
	elseif n.anchor ~= nil then
		return -- UI is drawn separately, on top, and is never lit
	elseif kind == IS_TINT then
		if tintPiece == nil and not n.off then tintPiece = n end
	end
	local ch = n.children
	for i = 1, #ch do
		local child = ch[i]
		if child then collect(child, a, b, c, d, tx, ty, tr, tg, tb, ta, z, lit, tags) end
	end
end

---------------------------------------------------------------------------
-- Occluder edges
--
-- An edge set is a flat list of segments in scene coordinates, x1, y1, x2,
-- y2, ..., with its count in .n and a circle around them in .cx, .cy, .rad.
-- Segments go round their shape so that the solid side is where
-- (B - A) x (P - A) > 0: an edge casts a shadow when the light is on that
-- side of it (the edge faces away from the light).

local unitCircle = {}
for i = 0, CIRCLE_SIDES - 1 do
	local t = i / CIRCLE_SIDES * math.pi * 2
	unitCircle[i * 2 + 1], unitCircle[i * 2 + 2] = cos(t), sin(t)
end

local scratch = {}

-- The outline of an Occluder as corner points in scratch (returns how many
-- numbers), and whether they are in its parent's coordinates (auto fitting
-- the pieces next to it) rather than its own.
local function outline(n)
	local shape = n.shape
	local pts = scratch
	if shape == "rectangle" then
		local hw, hh = n.width / 2, n.height / 2
		pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7], pts[8] = -hw, -hh, hw, -hh, hw, hh, -hw, hh
		return 8, false
	elseif shape == "circle" then
		local r = n.radius
		for i = 1, CIRCLE_SIDES * 2 do pts[i] = unitCircle[i] * r end
		return CIRCLE_SIDES * 2, false
	elseif shape == "polygon" then
		local p = n.points
		if type(p) ~= "table" or #p < 6 then return 0, false end
		local k = #p - #p % 2
		for i = 1, k do pts[i] = p[i] end
		return k, false
	elseif shape ~= "auto" then
		return 0, false
	end
	-- auto: what Body does. The Sprites and Shapes inside the Occluder, or,
	-- when it has none, the ones inside the piece it is in.
	local visualBounds = require("love.scene.physics2d")._visualBounds
	local inParent = false
	local x0, y0, x1, y1, lone = visualBounds(n)
	if not x0 and n.parent then
		x0, y0, x1, y1, lone = visualBounds(n.parent)
		inParent = true
	end
	if not x0 then return 0, false end
	if lone and lone.shape == "circle" then
		local rx, ry = lone.radius * lone.scaleX, lone.radius * lone.scaleY
		local cr, sr = cos(lone.rotation), sin(lone.rotation)
		for i = 1, CIRCLE_SIDES * 2, 2 do
			local ux, uy = unitCircle[i] * rx, unitCircle[i + 1] * ry
			pts[i], pts[i + 1] = lone.x + ux * cr - uy * sr, lone.y + ux * sr + uy * cr
		end
		return CIRCLE_SIDES * 2, inParent
	elseif lone and lone.shape == "polygon" and type(lone.points) == "table" and #lone.points >= 6 then
		local p = lone.points
		local cr, sr = cos(lone.rotation), sin(lone.rotation)
		local k = #p - #p % 2
		for i = 1, k, 2 do
			local ux, uy = p[i] * lone.scaleX, p[i + 1] * lone.scaleY
			pts[i], pts[i + 1] = lone.x + ux * cr - uy * sr, lone.y + ux * sr + uy * cr
		end
		return k, inParent
	end
	pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7], pts[8] = x0, y0, x1, y0, x1, y1, x0, y1
	return 8, inParent
end

-- Turns a closed outline (k numbers in pts, a piece's own coordinates) into
-- an edge set in scene coordinates through the matrix a..ty.
local function outlineToEdges(es, pts, k, a, b, c, d, tx, ty)
	local x0, y0, x1, y1 = huge, huge, -huge, -huge
	local area = 0
	local lastX = a * pts[k - 1] + c * pts[k] + tx
	local lastY = b * pts[k - 1] + d * pts[k] + ty
	local firstX, firstY = lastX, lastY
	local n = 0
	for i = 1, k, 2 do
		local x, y = a * pts[i] + c * pts[i + 1] + tx, b * pts[i] + d * pts[i + 1] + ty
		es[n + 1], es[n + 2], es[n + 3], es[n + 4] = lastX, lastY, x, y
		n = n + 4
		area = area + lastX * y - x * lastY
		if x < x0 then x0 = x end
		if x > x1 then x1 = x end
		if y < y0 then y0 = y end
		if y > y1 then y1 = y end
		lastX, lastY = x, y
	end
	if area < 0 then
		-- Wound the other way (or mirrored by a negative scale): turn each edge.
		for i = 1, n, 4 do
			es[i], es[i + 1], es[i + 2], es[i + 3] = es[i + 2], es[i + 3], es[i], es[i + 1]
		end
	end
	for i = n + 1, #es do es[i] = nil end
	es.n = n
	es.cx, es.cy = (x0 + x1) / 2, (y0 + y1) / 2
	es.rad = sqrt((x1 - x0) ^ 2 + (y1 - y0) ^ 2) / 2
	return es
end

-- An Occluder's edge set, made again only when its outline or place changed.
local function occluderEdges(n)
	local k, inParent = outline(n)
	local a, b, c, d, tx, ty
	if inParent then
		a, b, c, d, tx, ty = n._pa, n._pb, n._pc, n._pd, n._px, n._py
	else
		a, b, c, d, tx, ty = n._wa, n._wb, n._wc, n._wd, n._wx, n._wy
	end
	local es = n._edges
	local kept = n._outline
	if not es then
		es, kept = { n = 0 }, {}
		n._edges, n._outline = es, kept
	end
	local same = kept.k == k and kept.a == a and kept.b == b and kept.c == c and kept.d == d
		and kept.tx == tx and kept.ty == ty
	if same then
		for i = 1, k do
			if kept[i] ~= scratch[i] then
				same = false
				break
			end
		end
	end
	if same then return es end
	for i = 1, k do kept[i] = scratch[i] end
	kept.k, kept.a, kept.b, kept.c, kept.d, kept.tx, kept.ty = k, a, b, c, d, tx, ty
	L._rebuilt = (L._rebuilt or 0) + 1
	if k < 6 then
		es.n, es.cx, es.cy, es.rad = 0, 0, 0, 0
		return es
	end
	return outlineToEdges(es, scratch, k, a, b, c, d, tx, ty)
end

local function chunkKey(kx, ky) return (kx + 2097152) * 4194304 + (ky + 2097152) end

-- The edges of one chunk of a Tiles piece, in its own coordinates: the sides
-- of solid tiles that face a tile that isn't, with runs merged.
local function chunkOutline(self, kx, ky)
	local grid, ts = self._grid, self._ts
	local info = ts.tiles
	local tw, th = ts.tileWidth, ts.tileHeight
	local cx0, cy0 = kx * CHUNK, ky * CHUNK
	local out, n = {}, 0
	local function solid(cx, cy)
		local row = grid[cy]
		local tile = row and row[cx]
		if not tile then return false end
		local props = info[tile]
		return props ~= nil and props.solid == true
	end
	-- Sides along x: tops (solid below the line) run left to right, bottoms
	-- right to left.
	for cy = cy0, cy0 + CHUNK - 1 do
		if grid[cy] then
			for side = 0, 1 do
				local other = side == 0 and cy - 1 or cy + 1
				local start = nil
				for cx = cx0, cx0 + CHUNK do
					local edge = cx < cx0 + CHUNK and solid(cx, cy) and not solid(cx, other)
					if edge and not start then
						start = cx
					elseif not edge and start then
						local y = (cy + side) * th
						if side == 0 then
							out[n + 1], out[n + 2], out[n + 3], out[n + 4] = start * tw, y, cx * tw, y
						else
							out[n + 1], out[n + 2], out[n + 3], out[n + 4] = cx * tw, y, start * tw, y
						end
						n = n + 4
						start = nil
					end
				end
			end
		end
	end
	-- Sides along y: lefts (solid to the right) run upwards, rights downwards.
	for cx = cx0, cx0 + CHUNK - 1 do
		for side = 0, 1 do
			local other = side == 0 and cx - 1 or cx + 1
			local start = nil
			for cy = cy0, cy0 + CHUNK do
				local edge = cy < cy0 + CHUNK and solid(cx, cy) and not solid(other, cy)
				if edge and not start then
					start = cy
				elseif not edge and start then
					local x = (cx + side) * tw
					if side == 0 then
						out[n + 1], out[n + 2], out[n + 3], out[n + 4] = x, cy * th, x, start * th
					else
						out[n + 1], out[n + 2], out[n + 3], out[n + 4] = x, start * th, x, cy * th
					end
					n = n + 4
					start = nil
				end
			end
		end
	end
	out.n = n
	return out
end

-- A chunk's edge set in scene coordinates (made when a light first needs it,
-- and again when the Tiles piece moves or the chunk's tiles change).
local function chunkEdges(self, occ, kx, ky)
	local key = chunkKey(kx, ky)
	local ch = occ.chunks[key]
	if not ch then
		ch = { loc = chunkOutline(self, kx, ky), es = { n = 0 }, moved = -1 }
		occ.chunks[key] = ch
		L._rebuilt = (L._rebuilt or 0) + 1
	end
	if ch.moved == occ.moved then return ch.es end
	ch.moved = occ.moved
	local loc, es = ch.loc, ch.es
	local a, b, c, d, tx, ty = self._wa, self._wb, self._wc, self._wd, self._wx, self._wy
	local flip = a * d - b * c < 0
	local x0, y0, x1, y1 = huge, huge, -huge, -huge
	for i = 1, loc.n, 4 do
		local ax, ay = a * loc[i] + c * loc[i + 1] + tx, b * loc[i] + d * loc[i + 1] + ty
		local bx, by = a * loc[i + 2] + c * loc[i + 3] + tx, b * loc[i + 2] + d * loc[i + 3] + ty
		if flip then ax, ay, bx, by = bx, by, ax, ay end
		es[i], es[i + 1], es[i + 2], es[i + 3] = ax, ay, bx, by
		x0, x1 = min(x0, ax, bx), max(x1, ax, bx)
		y0, y1 = min(y0, ay, by), max(y1, ay, by)
	end
	for i = loc.n + 1, #es do es[i] = nil end
	es.n = loc.n
	if loc.n == 0 then
		es.cx, es.cy, es.rad = 0, 0, 0
	else
		es.cx, es.cy = (x0 + x1) / 2, (y0 + y1) / 2
		es.rad = sqrt((x1 - x0) ^ 2 + (y1 - y0) ^ 2) / 2
	end
	return es
end

-- The edge cache of a Tiles piece. Tiles drops it (self._occ = nil) when
-- every cell changes and forgets single chunks in setTile.
local function tilesOccluder(self)
	self:getTile(0, 0) -- decodes the cells and loads the tileset if needed
	if not self._ts then return nil end
	local occ = self._occ
	if not occ or occ.ts ~= self._ts then
		occ = { chunks = {}, moved = 0, ts = self._ts }
		self._occ = occ
	end
	local a, b, c, d, tx, ty = self._wa, self._wb, self._wc, self._wd, self._wx, self._wy
	if occ.a ~= a or occ.b ~= b or occ.c ~= c or occ.d ~= d or occ.tx ~= tx or occ.ty ~= ty then
		occ.a, occ.b, occ.c, occ.d, occ.tx, occ.ty = a, b, c, d, tx, ty
		occ.moved = occ.moved + 1
	end
	return occ
end

---Forgets the edges around a changed tile (called by Tiles:setTile).
function L._tileChanged(self, cx, cy)
	local occ = self._occ
	if not occ then return end
	local kx, ky = floor(cx / CHUNK), floor(cy / CHUNK)
	local chunks = occ.chunks
	chunks[chunkKey(kx, ky)] = nil
	-- A tile on a chunk's border changes its neighbour's edges too.
	local ix, iy = cx - kx * CHUNK, cy - ky * CHUNK
	if ix == 0 then chunks[chunkKey(kx - 1, ky)] = nil end
	if ix == CHUNK - 1 then chunks[chunkKey(kx + 1, ky)] = nil end
	if iy == 0 then chunks[chunkKey(kx, ky - 1)] = nil end
	if iy == CHUNK - 1 then chunks[chunkKey(kx, ky + 1)] = nil end
end

---------------------------------------------------------------------------
-- Shadows

local edgeCount = 0

-- Draws the shadows a point light at lx, ly throws from an edge set: for
-- each edge facing away, the area behind it out to distance far.
local function castPoint(es, lx, ly, far)
	local polygon = love.graphics.polygon
	for i = 1, es.n, 4 do
		local ax, ay, bx, by = es[i], es[i + 1], es[i + 2], es[i + 3]
		local dax, day, dbx, dby = ax - lx, ay - ly, bx - lx, by - ly
		-- (B - A) x (L - A) > 0: the light is on the solid side.
		if (bx - ax) * -day + (by - ay) * dax > 0 then
			local la, lb = sqrt(dax * dax + day * day), sqrt(dbx * dbx + dby * dby)
			if la > 1e-6 and lb > 1e-6 then
				local ux, uy, vx, vy = dax / la, day / la, dbx / lb, dby / lb
				-- A corner between the two far ones keeps the far side outside
				-- the light's reach even when the light is right next to the edge.
				local mx, my = ux + vx, uy + vy
				local ml = sqrt(mx * mx + my * my)
				if ml < 1e-6 then
					local el = sqrt((bx - ax) ^ 2 + (by - ay) ^ 2)
					mx, my, ml = by - ay, -(bx - ax), el
				end
				if ml > 0 then
					polygon("fill", ax, ay, bx, by, lx + vx * far, ly + vy * far,
						lx + mx / ml * far, ly + my / ml * far, lx + ux * far, ly + uy * far)
					edgeCount = edgeCount + 1
				end
			end
		end
	end
end

-- The same for a sun shining along dx, dy: shadows `far` long.
local function castSun(es, dx, dy, far)
	local polygon = love.graphics.polygon
	local ox, oy = dx * far, dy * far
	for i = 1, es.n, 4 do
		local ax, ay, bx, by = es[i], es[i + 1], es[i + 2], es[i + 3]
		-- (B - A) x -D > 0: the light comes from the solid side.
		if (bx - ax) * -dy + (by - ay) * dx > 0 then
			polygon("fill", ax, ay, bx, by, bx + ox, by + oy, ax + ox, ay + oy)
			edgeCount = edgeCount + 1
		end
	end
end

-- True if an occluder (or the piece it is in) has one of the light's
-- shadowsFrom tags.
local function castsFor(light, n)
	local list = light.shadowsFrom
	if list == nil or list == "" then return true end
	if n:hasAnyTag(list) then return true end
	local p = n.parent
	return p ~= nil and p:hasAnyTag(list)
end

-- The view in scene coordinates (set each frame by render).
local viewCX, viewCY, viewRad = 0, 0, 0

-- Draws every shadow of a light (in scene coordinates; the caller has set
-- the canvas, transform and color).
local function castShadows(light)
	local sun = light._sun
	local lx, ly, reach = light._wx, light._wy, light._reach
	local dx, dy = light._dx, light._dy
	local far, length
	if sun then
		length = light.shadowLength or 0
		if length <= 0 then length = huge end
		far = min(length, viewRad * 8 + 1000)
	else
		far = reach * 64 + 1000
	end
	for i = 1, nOccluders do
		local n = occluders[i]
		if castsFor(light, n) then
			if n._lk == IS_OCCLUDER then
				local es = n._edgesFrame == frame and n._edges or occluderEdges(n)
				n._edgesFrame = frame
				if es.n > 0 then
					if sun then
						-- Not past the view, not beside it, not too far before it.
						local rx, ry = es.cx - viewCX, es.cy - viewCY
						local along, across = rx * dx + ry * dy, abs(rx * dy - ry * dx)
						local room = es.rad + viewRad
						if across <= room and along <= room and along >= -(room + length) then
							castSun(es, dx, dy, far)
						end
					elseif (es.cx - lx) ^ 2 + (es.cy - ly) ^ 2 <= (es.rad + reach) ^ 2 then
						castPoint(es, lx, ly, far)
					end
				end
			else
				local occ = tilesOccluder(n)
				if occ then
					-- The chunks the light (or the view and what's before it,
					-- for a sun) reaches, in the Tiles piece's own coordinates.
					local x0, y0, x1, y1
					if sun then
						local back = min(length, viewRad * 4)
						x0, x1 = viewCX - viewRad - max(0, dx) * back, viewCX + viewRad - min(0, dx) * back
						y0, y1 = viewCY - viewRad - max(0, dy) * back, viewCY + viewRad - min(0, dy) * back
					else
						x0, y0, x1, y1 = lx - reach, ly - reach, lx + reach, ly + reach
					end
					local a, b, c, d, tx, ty = n._wa, n._wb, n._wc, n._wd, n._wx, n._wy
					local det = a * d - b * c
					if det ~= 0 then
						local u0, v0, u1, v1 = huge, huge, -huge, -huge
						for corner = 0, 3 do
							local wx = (corner % 2 == 0 and x0 or x1) - tx
							local wy = (corner < 2 and y0 or y1) - ty
							local u, v = (d * wx - c * wy) / det, (a * wy - b * wx) / det
							u0, u1, v0, v1 = min(u0, u), max(u1, u), min(v0, v), max(v1, v)
						end
						local cw, chh = CHUNK * n._ts.tileWidth, CHUNK * n._ts.tileHeight
						local kx0, kx1 = floor(u0 / cw), floor(u1 / cw)
						local ky0, ky1 = floor(v0 / chh), floor(v1 / chh)
						if (kx1 - kx0 + 1) * (ky1 - ky0 + 1) <= 1024 then
							for ky = ky0, ky1 do
								for kx = kx0, kx1 do
									local es = chunkEdges(n, occ, kx, ky)
									if es.n > 0 then
										if sun then
											castSun(es, dx, dy, far)
										elseif (es.cx - lx) ^ 2 + (es.cy - ly) ^ 2 <= (es.rad + reach) ^ 2 then
											castPoint(es, lx, ly, far)
										end
									end
								end
							end
						end
					end
				end
			end
		end
	end
end

---------------------------------------------------------------------------
-- The frame

local active = {}     -- the lights that shine on this frame's view
local masked = {}     -- those of them with tags or a layer range
local groups = {}     -- light groups: { key, tint, canvas }
local groupOf = {}    -- key -> index in groups
local worldT = love.math.newTransform()
local pieceT = love.math.newTransform()
local setMatrix = nodes2d._setMatrix
local info3, params3, info2, step2, color4 = {}, {}, {}, {}, {}

local function inLayers(z, from, to)
	return (from == nil or z >= from) and (to == nil or z <= to)
end

-- Draws the pieces: lit ones through the lit shader with their group's
-- light map, the rest plainly. groupsUsed is 0 when nothing is lit.
local function drawItems(ca, cb, cc, cd, ctx, cty, groupsUsed)
	local g = love.graphics
	local list = sorted
	local transform = pieceT
	local world = nodes2d._world
	setMatrix(world, ca, cb, cc, cd, ctx, cty)
	local current = 0
	for i = 1, count do
		local it = list[i]
		local n = it.node
		local group = it.group
		if group ~= current then
			if group == 0 then
				g.setShader()
			else
				g.setShader(litShader)
				litShader:send("lightMap", groups[group].canvas)
			end
			current = group
		end
		g.setColor(it.r, it.g, it.bl, it.al)
		if n._drawWorld then
			g.push()
			g.applyTransform(world)
			n:_drawWorld(it.r, it.g, it.bl, it.al)
			g.pop()
		end
		local a, b, c, d, tx, ty = it.a, it.b, it.c, it.d, it.tx, it.ty
		setMatrix(transform, ca * a + cc * b, cb * a + cd * b, ca * c + cc * d, cb * c + cd * d,
			ca * tx + cc * ty + ctx, cb * tx + cd * ty + cty)
		g.push()
		g.applyTransform(transform)
		if n._draw then n:_draw(it.r, it.g, it.bl, it.al) end
		local f = n.draw
		if f then
			g.setColor(it.r, it.g, it.bl, it.al)
			f(n)
			-- A script's draw() may have set a shader of its own.
			if groupsUsed > 0 and g.getShader() ~= (current ~= 0 and litShader or nil) then current = -1 end
		end
		g.pop()
	end
end

---Draws the pieces of a tree with its lights (nodes2d.render calls it when
---the scene has a Light or a Tint).
function L.render(root)
	local g = love.graphics
	frame = frame + 1
	L._frames = L._frames + 1
	local stats = L._stats
	stats.lights, stats.shadowLights, stats.groups, stats.edges = 0, 0, 0, 0

	-- Lights with a tag list get a bit each; pieces carry the bits of the
	-- lists they (or a piece they're inside) match.
	nTagLights = 0
	for i = 1, #all do
		local light = all[i]
		local list = light.lights
		light._tagBit = nil
		if not light.off and list ~= nil and list ~= "" then
			if nTagLights < MAX_MASKED then
				nTagLights = nTagLights + 1
				tagLights[nTagLights] = light
				light._tagBit = 2 ^ (nTagLights - 1)
			else
				warnOnce("masked", TOO_MANY_MASKED, MAX_MASKED)
			end
		end
	end
	for i = nTagLights + 1, #tagLights do tagLights[i] = nil end

	count, order, nOccluders, tintPiece = 0, 0, 0, nil
	collect(root, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, true, 0)
	for i = count + 1, #items do items[i].node = nil end
	for i = nOccluders + 1, #occluders do occluders[i] = nil end
	if count == 0 then return end
	for i = 1, count do sorted[i] = items[i] end
	for i = count + 1, #sorted do sorted[i] = nil end
	nodes2d._sortItems(sorted, count)

	local ca, cb, cc, cd, ctx, cty = nodes2d.cameraMatrix()
	local display = require("love.display")

	-- What the game is drawing to, and how game coordinates land on its pixels.
	local target = g.getCanvas()
	local uw, uh, tw, th
	if target then
		uw, uh = target:getDimensions()
		tw, th = target:getPixelDimensions()
	else
		uw, uh = g.getDimensions()
		tw, th = g.getPixelDimensions()
	end
	if uw <= 0 or uh <= 0 or tw <= 0 or th <= 0 then return end
	local kx, ky = tw / uw, th / uh
	local ox, oy = g.transformPoint(0, 0)
	local xx, xy = g.transformPoint(1, 0)
	local yx, yy = g.transformPoint(0, 1)
	-- Game coordinates to pixels: [ga gc gx; gb gd gy].
	local ga, gb, gc, gd = (xx - ox) * kx, (xy - oy) * ky, (yx - ox) * kx, (yy - oy) * ky
	local gx, gy = ox * kx, oy * ky
	-- Scene coordinates to pixels.
	local pa, pb = ga * ca + gc * cb, gb * ca + gd * cb
	local pc, pd = ga * cc + gc * cd, gb * cc + gd * cd
	local px, py = ga * ctx + gc * cty + gx, gb * ctx + gd * cty + gy
	local pixelScale = sqrt(abs(pa * pd - pb * pc))

	-- The view, in scene coordinates.
	local vx, vy, vw, vh
	if display.active then
		vx, vy, vw, vh = display.viewX, display.viewY, display.viewWidth, display.viewHeight
	else
		vx, vy, vw, vh = 0, 0, uw, uh
	end
	local cdet = ca * cd - cb * cc
	if cdet == 0 then cdet = 1 end
	local ax, ay, bx, by = vx - ctx, vy - cty, vx + vw - ctx, vy + vh - cty
	local sx0, sy0 = (cd * ax - cc * ay) / cdet, (ca * ay - cb * ax) / cdet
	local sx1, sy1 = (cd * bx - cc * by) / cdet, (ca * by - cb * bx) / cdet
	if sx0 > sx1 then sx0, sx1 = sx1, sx0 end
	if sy0 > sy1 then sy0, sy1 = sy1, sy0 end
	viewCX, viewCY = (sx0 + sx1) / 2, (sy0 + sy1) / 2
	viewRad = sqrt((sx1 - sx0) ^ 2 + (sy1 - sy0) ^ 2) / 2

	-- The lights that reach the view.
	local nActive, nMasked, anyShadows = 0, 0, false
	for i = 1, #all do
		local light = all[i]
		if light._seen == frame then
			local brightness = (light.brightness or 0) * light._ta
			local a, b, c, d = light._wa, light._wb, light._wc, light._wd
			local sun = light.kind == "sun"
			local keep = brightness > 0
			if keep and sun then
				local len = sqrt(a * a + b * b)
				if len > 0 then light._dx, light._dy = a / len, b / len else light._dx, light._dy = 1, 0 end
				light._reach = huge
				light._image = nil
			elseif keep then
				local r = light.radius or 0
				local path = light.image
				local image = nil
				local reach = r
				if path ~= nil and path ~= "" then
					image = require("love.assets").image(path)
					local iw, ih = image:getDimensions()
					reach = r * sqrt(1 + (ih / iw) ^ 2)
				end
				light._image = image
				reach = reach * sqrt(max(a * a + b * b, c * c + d * d))
				light._reach = reach
				local lx, ly = light._wx, light._wy
				keep = reach > 0 and lx + reach >= sx0 and lx - reach <= sx1 and ly + reach >= sy0 and ly - reach <= sy1
			end
			if keep then
				nActive = nActive + 1
				active[nActive] = light
				light._sun = sun
				light._power = brightness
				light._bit = nil
				local from, to = light.fromLayer, light.toLayer
				if light._tagBit or from ~= nil or to ~= nil then
					if nMasked < MAX_MASKED then
						nMasked = nMasked + 1
						masked[nMasked] = light
						light._bit = 2 ^ (nMasked - 1)
					else
						warnOnce("masked", TOO_MANY_MASKED, MAX_MASKED)
					end
				end
				if light.shadows and nOccluders > 0 then anyShadows = true end
			end
		end
	end
	for i = nActive + 1, #active do active[i] = nil end
	for i = nMasked + 1, #masked do masked[i] = nil end
	stats.lights = nActive

	local tint = tintPiece
	if nActive == 0 and not tint then
		-- Nothing shines and nothing tints: draw as usual.
		g.push("all")
		drawItems(ca, cb, cc, cd, ctx, cty, 0)
		g.pop()
		return
	end

	-- Sort the lit pieces into groups by what applies to them.
	local nGroups = 0
	for k in pairs(groupOf) do groupOf[k] = nil end
	local tintFrom, tintTo = nil, nil
	if tint then tintFrom, tintTo = tint.fromLayer, tint.toLayer end
	local everywhere = nActive > nMasked   -- a light without a mask lights every group
	local lastKey, lastGroup = nil, 0
	for i = 1, count do
		local it = sorted[i]
		if it.lit then
			local z = it.z
			local key = 0
			for j = 1, nMasked do
				local light = masked[j]
				local tagBit = light._tagBit
				if inLayers(z, light.fromLayer, light.toLayer) and (tagBit == nil or it.tags % (tagBit * 2) >= tagBit) then
					key = key + light._bit
				end
			end
			key = key * 2
			if tint and inLayers(z, tintFrom, tintTo) then key = key + 1 end
			if key ~= lastKey then
				lastKey = key
				if key == 0 and not everywhere then
					lastGroup = 0 -- no light and no tint reaches it: plain
				else
					local index = groupOf[key]
					if not index then
						if nGroups < MAX_GROUPS then
							nGroups = nGroups + 1
							index = nGroups
							local group = groups[index]
							if not group then
								group = {}
								groups[index] = group
							end
							group.key, group.tint = key, key % 2 == 1
						else
							warnOnce("groups", TOO_MANY_GROUPS, MAX_GROUPS)
							index = 1
						end
						groupOf[key] = index
					end
					lastGroup = index
				end
			end
			it.group = lastGroup
		else
			it.group = 0
		end
	end
	stats.groups = nGroups

	if nGroups == 0 then
		g.push("all")
		drawItems(ca, cb, cc, cd, ctx, cty, 0)
		g.pop()
		return
	end

	-- The light maps.
	setup()
	if pw ~= tw or ph ~= th then
		releaseCanvases()
		pw, ph = tw, th
	end
	g.push("all")
	g.setScissor()
	g.origin()
	local scale = mapScale
	local tr, tgc, tb = 1, 1, 1
	if tint then
		local c = tint.color
		tr, tgc, tb = c[1], c[2], c[3]
	end
	for i = 1, nGroups do
		local group = groups[i]
		group.canvas = mapCanvas(i)
		scale = mapScale -- (a canvas that couldn't be half-float changes it)
		g.setCanvas(group.canvas)
		if group.tint then
			g.clear(tr / scale, tgc / scale, tb / scale, 1)
		else
			g.clear(1 / scale, 1 / scale, 1 / scale, 1)
		end
	end
	local onCanvas = groups[nGroups].canvas

	if anyShadows then
		if not mask then mask = newCanvas("rgba8") end
		info2[1], info2[2] = 1 / pw, 1 / ph
		shadowLightShader:send("shadowInfo", info2)
	end
	setMatrix(worldT, pa, pb, pc, pd, px, py)
	edgeCount = 0

	for i = 1, nActive do
		local light = active[i]
		local sun = light._sun
		local shadows = light.shadows and nOccluders > 0
		local a, b, c, d, lx, ly = light._wa, light._wb, light._wc, light._wd, light._wx, light._wy
		if shadows then
			-- The shadow mask: white where this light is blocked.
			stats.shadowLights = stats.shadowLights + 1
			local soft = max(0, light.shadowSoftness or 0) * pixelScale
			g.setCanvas(mask)
			onCanvas = mask
			g.clear(0, 0, 0, 0)
			local scissor = false
			if not sun then
				-- Only the light's rectangle matters.
				local cxp, cyp = pa * lx + pc * ly + px, pb * lx + pd * ly + py
				local rp = light._reach * pixelScale + soft * 4 + 2
				local x0, y0 = max(0, floor(cxp - rp)), max(0, floor(cyp - rp))
				local x1, y1 = min(pw, floor(cxp + rp) + 1), min(ph, floor(cyp + rp) + 1)
				if x1 > x0 and y1 > y0 then
					g.setScissor(x0, y0, x1 - x0, y1 - y0)
					scissor = true
				end
			end
			g.setShader()
			g.setBlendMode("replace", "premultiplied")
			g.setColor(1, 1, 1, 1)
			g.origin()
			g.applyTransform(worldT)
			castShadows(light)
			g.origin()
			if soft > 0.01 then
				if not mask2 then mask2 = newCanvas("rgba8") end
				g.setShader(blurShader)
				g.setCanvas(mask2)
				step2[1], step2[2] = soft / 4 / pw, 0
				blurShader:send("blurStep", step2)
				g.draw(mask, 0, 0)
				g.setCanvas(mask)
				step2[1], step2[2] = 0, soft / 4 / ph
				blurShader:send("blurStep", step2)
				g.draw(mask2, 0, 0)
			end
			if scissor then g.setScissor() end
		end

		local shader = shadows and shadowLightShader or lightShader
		g.setShader(shader)
		local blend = light.blend
		g.setBlendMode(BLENDS[blend] or "add", "alphamultiply")
		params3[1] = light._power / scale
		params3[2] = (sun or light._image) and 0 or 1
		params3[3] = blend == "mix" and 1 or 0
		shader:send("lightParams", params3)
		if shadows then
			shader:send("shadowMask", mask)
			local sc = light.shadowColor
			color4[1], color4[2], color4[3], color4[4] = sc[1], sc[2], sc[3], sc[4] or 1
			shader:send("shadowColor", color4)
		end
		local col = light.color
		g.setColor(col[1] * light._tr, col[2] * light._tg, col[3] * light._tb, col[4] or 1)
		if sun then
			g.origin()
		else
			setMatrix(pieceT, pa * a + pc * b, pb * a + pd * b, pa * c + pc * d, pb * c + pd * d,
				pa * lx + pc * ly + px, pb * lx + pd * ly + py)
			g.origin()
			g.applyTransform(pieceT)
		end
		local bit = light._bit
		local from, to = light.fromLayer, light.toLayer
		for j = 1, nGroups do
			local group = groups[j]
			-- key = the masked lights' bits * 2 + the tint's bit.
			if bit == nil or floor(group.key / 2) % (bit * 2) >= bit then
				if onCanvas ~= group.canvas then
					g.setCanvas(group.canvas)
					onCanvas = group.canvas
				end
				if sun then
					g.draw(white, 0, 0, 0, pw, ph)
				else
					local r = light.radius
					local image = light._image
					if image then
						local iw, ih = image:getDimensions()
						local s = 2 * r / iw
						g.draw(image, -r, -ih * s / 2, 0, s, s)
					else
						g.draw(white, -r, -r, 0, 2 * r, 2 * r)
					end
				end
			end
		end
	end
	stats.edges = edgeCount
	g.pop()

	-- The pieces.
	g.push("all")
	info3[1], info3[2], info3[3] = 1 / pw, 1 / ph, scale
	litShader:send("lightInfo", info3)
	drawItems(ca, cb, cc, cd, ctx, cty, nGroups)
	g.pop()
end

nodes2d._renderLit = L.render

return L
