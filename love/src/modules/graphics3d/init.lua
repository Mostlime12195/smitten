-- graphics3d: a 3D renderer on LÖVE 12's graphics (smitten.graphics3d).
--
--   local g3d = require("graphics3d")
--   local camera = g3d.newCamera{fov = 70}
--   local box = g3d.newBox(1, 1, 1)
--   local red = g3d.newMaterial{color = {1, 0.2, 0.2}}
--   local env = g3d.newEnvironment{background = "sky"}
--   local sun = {type = "directional", dx = -0.4, dy = -1, dz = -0.3, shadows = true}
--   local m = g3d.mat4.new()
--
--   function love.draw()
--       g3d.begin(camera, env, {sun})
--       g3d.draw(box, g3d.mat4.fromTRS(m, 0, 0.5, 0), red)
--       g3d.finish()
--       love.graphics.print("2D still works", 10, 10)
--   end
--
-- Units are meters, y is up and the coordinate system is right-handed (like
-- glTF and Godot). Matrices are flat column-major tables of 16 numbers;
-- quaternions are passed around as four numbers (see mat4.lua and quat.lua).

local mesh = require("graphics3d.mesh")
local primitives = require("graphics3d.primitives")
local material = require("graphics3d.material")
local environment = require("graphics3d.environment")
local gltf = require("graphics3d.gltf")
local renderer = require("graphics3d.renderer")

local g3d = {
	mat4 = require("graphics3d.mat4"),
	quat = require("graphics3d.quat"),

	newCamera = require("graphics3d.camera"),

	newMesh = mesh.newMesh,
	newBox = primitives.newBox,
	newSphere = primitives.newSphere,
	newCylinder = primitives.newCylinder,
	newCapsule = primitives.newCapsule,
	newPlane = primitives.newPlane,

	newMaterial = material.newMaterial,
	newEnvironment = environment.newEnvironment,
	loadModel = gltf.loadModel,

	begin = renderer.begin,
	draw = renderer.draw,
	finish = renderer.finish,
	stats = renderer.stats,

	-- Vertex attribute locations, for custom meshes and shaders.
	ATTRIBUTE = mesh.ATTRIBUTE,
	MAX_LIGHTS = require("graphics3d.shaders").MAX_LIGHTS,
}

return g3d
