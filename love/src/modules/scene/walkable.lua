-- Walkable: a polygon that says where things can walk (or, as a hole, where
-- they can't). The piece only holds the shape: smitten.paths joins every
-- Walkable in the scene into one area and finds paths through it
-- (paths/init.lua, paths/area.lua).

local nodeLib = require("love.scene.node")
local scene = require("love.scene")

local Walkable = nodeLib.classes.Walkable

function Walkable:_enter()
	require("love.paths")._add(self)
end

function Walkable:_exit()
	require("love.paths")._remove(self)
end

-- Shown with the editor's "Shapes" switch (smitten.scene.showShapes).
function Walkable:_draw()
	if not scene.showShapes or not self.active then return end
	local p = self.points
	if type(p) ~= "table" or #p < 6 or #p % 2 ~= 0 then return end
	local g = love.graphics
	if self.hole then g.setColor(0.95, 0.45, 0.35, 0.8) else g.setColor(0.3, 0.85, 0.5, 0.8) end
	g.setLineWidth(2)
	g.polygon("line", p)
end

return Walkable
