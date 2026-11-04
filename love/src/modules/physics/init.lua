-- smitten.physics: queries on the running scene's physics.
--
--   local hit = smitten.physics.raycast(x, y, x + 300, y)
--   for _, p in ipairs(smitten.physics.piecesAt(mx, my)) do ... end
--   smitten.physics.setGravity(0, 0)
--
-- The queries work on the running scene's Box2D world (scene/physics2d.lua,
-- the physics2d module).

local physics = {}

local function scenePhysics() return require("love.scene.physics2d") end

---The first body or tiles a line from (x1, y1) to (x2, y2) touches, nearest
---first, as {piece, x, y, nx, ny, fraction}, or nil. tags (optional, "a, b")
---only counts pieces with one of them.
function physics.raycast(x1, y1, x2, y2, tags) return scenePhysics().raycast(x1, y1, x2, y2, tags) end

---Every ray hit along the line, nearest first: a list of {piece, x, y, nx, ny, fraction}.
function physics.raycastAll(x1, y1, x2, y2, tags) return scenePhysics().raycastAll(x1, y1, x2, y2, tags) end

---The bodies and zones whose shapes contain a point.
function physics.piecesAt(x, y, tags) return scenePhysics().piecesAt(x, y, tags) end

---The bodies and zones touching a shape: overlap("circle", x, y, radius) or
---overlap("rect", x, y, width, height) (centered on x, y), optionally with tags.
function physics.overlap(kind, ...) return scenePhysics().overlap(kind, ...) end

---The scene's gravity (pixels per second per second): x, y.
function physics.getGravity() return scenePhysics().getGravity() end

---Changes the scene's gravity: setGravity(0, 980) pulls down, setGravity(0, 0) floats.
function physics.setGravity(x, y) return scenePhysics().setGravity(x, y) end

return physics
