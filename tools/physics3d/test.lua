-- Tests for love.physics3d. Run with tools/physics3d/build.sh (which builds
-- the Node.js harness) or: node tools/physics3d/build/p3test.js tools/physics3d/test.lua
local p3 = require("love.physics3d")

local passed, failed = 0, 0

local function check(name, ok, detail)
	if ok then
		passed = passed + 1
		print("PASS " .. name)
	else
		failed = failed + 1
		print("FAIL " .. name .. (detail and (": " .. detail) or ""))
	end
end

local function near(a, b, eps)
	return math.abs(a - b) <= (eps or 1e-3)
end

-- Jolt lets resting bodies sink up to its penetration slop (2 cm) into
-- each other, so resting heights are checked with this tolerance.
local REST = 0.03

local function fmt(...)
	local t = {}
	for i = 1, select("#", ...) do
		local v = select(i, ...)
		t[i] = type(v) == "number" and string.format("%.3f", v) or tostring(v)
	end
	return table.concat(t, ", ")
end

-- Runs fn(name) and reports an error it raises as a failure.
local function group(name, fn)
	local ok, err = pcall(fn)
	if not ok then
		check(name, false, "error: " .. tostring(err))
	end
end

local function run(world, seconds, each, dt)
	dt = dt or 1 / 60
	local t = 0
	while t < seconds - 1e-9 do
		if each then each(dt, t) end
		world:update(dt)
		t = t + dt
	end
end

local function newFloorWorld(halfSize)
	local w = p3.newWorld{gravity = {0, -9.81, 0}}
	local h = halfSize or 20
	local floor = w:newBody{type = "static", shape = p3.newBoxShape(h, 0.5, h), y = -0.5}
	return w, floor
end

-- --------------------------------------------------------------------------
group("module", function()
	check("module table", type(p3) == "table" and type(p3.newWorld) == "function")
	local w = p3.newWorld()
	check("World3D type", w:type() == "World3D" and w:typeOf("World3D") and w:typeOf("Object") and not w:typeOf("Body3D"))
	local gx, gy, gz = w:getGravity()
	check("default gravity", near(gx, 0) and near(gy, -9.81) and near(gz, 0), fmt(gx, gy, gz))
	w:setGravity(0, -20, 1)
	gx, gy, gz = w:getGravity()
	check("setGravity", near(gx, 0) and near(gy, -20) and near(gz, 1), fmt(gx, gy, gz))
	local s = p3.newBoxShape(1, 1, 1)
	check("Shape3D type", s:type() == "Shape3D" and s:typeOf("Shape3D") and s:getType() == "box")
	check("shape types", p3.newSphereShape(1):getType() == "sphere" and p3.newCapsuleShape(1, 0.5):getType() == "capsule"
		and p3.newCylinderShape(1, 0.5):getType() == "cylinder")
	check("tostring", tostring(w):match("^World3D: ") ~= nil, tostring(w))
	local ok, err = pcall(w.newBody, w, {type = "static"})
	check("newBody without shape errors", not ok and tostring(err):find("shape") ~= nil, tostring(err))
	ok, err = pcall(w.newBody, w, {shape = s, type = "flying"})
	check("newBody with a bad type errors", not ok and tostring(err):find("flying") ~= nil, tostring(err))
	ok, err = pcall(p3.newBoxShape, 1, -1, 1)
	check("bad box size errors", not ok and tostring(err):find("greater than 0") ~= nil, tostring(err))
	ok, err = pcall(w.newBody, w, {shape = s, layer = 70000})
	check("bad layer errors", not ok and tostring(err):find("16%-bit") ~= nil, tostring(err))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("box falls onto floor", function()
	local w, floor = newFloorWorld()
	local box = w:newBody{shape = p3.newBoxShape(0.5, 0.5, 0.5), x = 1, y = 5, z = -2}
	check("Body3D type", box:type() == "Body3D" and box:typeOf("Body3D") and box:typeOf("Object"))
	check("default type is dynamic", box:getType() == "dynamic" and floor:getType() == "static")
	local mass = box:getMass()
	check("mass from density (1000 kg/m^3)", near(mass, 1000, 1), fmt(mass))
	check("static mass is 0", floor:getMass() == 0)
	run(w, 0.5)
	local _, y1 = box:getPosition()
	check("box is falling", y1 < 4.0, fmt(y1))
	run(w, 3)
	local x, y, z = box:getPosition()
	check("box rests on the floor at y = 0.5", near(y, 0.5, REST) and near(x, 1, REST) and near(z, -2, REST), fmt(x, y, z))
	local vx, vy, vz = box:getLinearVelocity()
	check("box at rest", math.abs(vx) + math.abs(vy) + math.abs(vz) < 0.05, fmt(vx, vy, vz))
	run(w, 2)
	check("box falls asleep", not box:isAwake())
	box:wake()
	check("wake", box:isAwake())
	local t = {box:getTransform()}
	check("getTransform returns 7 numbers", #t == 7 and near(t[2], 0.5, REST) and near(t[7], 1, 0.01), fmt(unpack(t)))
	box:setRotation(0, 0, 1, 1)
	local qx, qy, qz, qw = box:getRotation()
	check("setRotation normalizes", near(qz, math.sqrt(0.5)) and near(qw, math.sqrt(0.5)), fmt(qx, qy, qz, qw))
	check("getBodies / getBodyCount", w:getBodyCount() == 2 and #w:getBodies() == 2)
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("restitution", function()
	local w = newFloorWorld()
	local bouncy = w:newBody{shape = p3.newSphereShape(0.5), y = 3, restitution = 0.8}
	local dull = w:newBody{shape = p3.newSphereShape(0.5), x = 3, y = 3, restitution = 0}
	check("getRestitution", near(bouncy:getRestitution(), 0.8) and near(dull:getRestitution(), 0))
	local bounced, peak, dullPeak = false, 0, 0
	run(w, 3, function()
		local _, vy = bouncy:getLinearVelocity()
		local _, y = bouncy:getPosition()
		if vy > 2 then bounced = true end
		if bounced then peak = math.max(peak, y) end
		local _, dy, _ = dull:getPosition()
		local _, dvy = dull:getLinearVelocity()
		if dvy > 0.5 then dullPeak = math.max(dullPeak, dy) end
	end)
	check("restitution 0.8 bounces", bounced and peak > 1.5, fmt(peak))
	check("restitution 0 doesn't bounce", dullPeak < 0.6, fmt(dullPeak))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("stack", function()
	local w = newFloorWorld()
	local shape = p3.newBoxShape(0.5, 0.5, 0.5)
	local boxes = {}
	for i = 1, 5 do
		boxes[i] = w:newBody{shape = shape, y = 0.5 + (i - 1) * 1.0}
	end
	local events = 0
	w:setCallbacks(nil, function() events = events + 1 end)
	run(w, 5)
	check("a stack going to sleep sends no finish", events == 0 and not boxes[5]:isAwake(), fmt(events))
	local ok, detail = true, ""
	for i, b in ipairs(boxes) do
		local x, y, z = b:getPosition()
		if not (near(x, 0, 0.05) and near(z, 0, 0.05) and near(y, 0.5 + (i - 1), 0.05)) then
			ok = false
			detail = detail .. string.format(" box %d at (%s)", i, fmt(x, y, z))
		end
	end
	check("5 boxes stay stacked after 5 s", ok, detail)
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("raycast", function()
	local w, floor = newFloorWorld()
	local box = w:newBody{type = "static", shape = p3.newBoxShape(0.5, 0.5, 0.5), x = 5, y = 0.5, layer = 2}
	local body, hx, hy, hz, nx, ny, nz, fraction = w:raycast(0, 10, 0, 0, -20, 0)
	check("raycast hits the floor", body == floor and near(hy, 0, 1e-3) and near(ny, 1, 1e-3) and near(fraction, 0.5, 1e-3),
		fmt(body, hx, hy, hz, nx, ny, nz, fraction))
	body, hx, hy, hz, nx, ny, nz = w:raycast(0, 0.5, 0, 10, 0, 0)
	check("raycast hits the box's side", body == box and near(hx, 4.5, 1e-3) and near(nx, -1, 1e-3), fmt(body, hx, hy, hz, nx, ny, nz))
	check("raycast can miss", w:raycast(0, 5, 0, 0, 10, 0) == nil)
	check("raycast too short misses", w:raycast(0, 10, 0, 0, -5, 0) == nil)
	body = w:raycast(5, 10, 0, 0, -20, 0, 1)
	check("raycast mask skips layer 2", body == floor, tostring(body))
	body = w:raycast(5, 10, 0, 0, -20, 0, 2)
	check("raycast mask selects layer 2", body == box, tostring(body))
	local sensor = w:newBody{type = "static", shape = p3.newBoxShape(1, 1, 1), x = -5, y = 3, sensor = true}
	body = w:raycast(-5, 10, 0, 0, -20, 0)
	check("raycast ignores sensors", body == floor and sensor:isSensor(), tostring(body))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("sensor callbacks", function()
	local w, floor = newFloorWorld()
	local sensor = w:newBody{type = "static", shape = p3.newBoxShape(1, 0.5, 1), y = 3, sensor = true}
	local ball = w:newBody{shape = p3.newSphereShape(0.25), y = 6}
	local log = {}
	local function name(o)
		return o == sensor and "sensor" or o == ball and "ball" or o == floor and "floor" or tostring(o)
	end
	w:setCallbacks(function(a, b, nx, ny, nz)
		local pair = {name(a), name(b)}
		table.sort(pair)
		log[#log + 1] = "begin " .. table.concat(pair, "+")
		assert(type(nx) == "number" and type(ny) == "number" and type(nz) == "number")
	end, function(a, b)
		local pair = {name(a), name(b)}
		table.sort(pair)
		log[#log + 1] = "end " .. table.concat(pair, "+")
	end)
	local b1, e1 = w:getCallbacks()
	check("getCallbacks", type(b1) == "function" and type(e1) == "function")
	run(w, 3)
	local text = table.concat(log, ", ")
	check("sensor begin then finish, then floor begin",
		text == "begin ball+sensor, end ball+sensor, begin ball+floor", text)
	local _, y = ball:getPosition()
	check("ball fell through the sensor", near(y, 0.25, REST), fmt(y))
	check("contacts last while a body sleeps", not ball:isAwake() and #log == 3, text)
	ball:setPosition(0, 1.5, 0)
	run(w, 0.1)
	check("finish when a sleeping body is moved away", log[4] == "end ball+floor", table.concat(log, ", "))
	run(w, 1)
	check("begin again when it lands", log[5] == "begin ball+floor" and #log == 5, table.concat(log, ", "))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("collision normal", function()
	local w, floor = newFloorWorld()
	local box = w:newBody{shape = p3.newBoxShape(0.5, 0.5, 0.5), y = 2}
	local normal
	w:setCallbacks(function(a, b, nx, ny, nz)
		if a == floor and b == box then normal = {nx, ny, nz}
		elseif a == box and b == floor then normal = {-nx, -ny, -nz} end
	end)
	run(w, 1.5)
	check("begin normal points from a to b", normal ~= nil and near(normal[2], 1, 0.01), normal and fmt(unpack(normal)) or "no contact")
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("layers", function()
	local w = p3.newWorld()
	local floor = w:newBody{type = "static", shape = p3.newBoxShape(20, 0.5, 20), y = -0.5, layer = 1, mask = 1}
	local shape = p3.newBoxShape(0.5, 0.5, 0.5)
	local lands = w:newBody{shape = shape, x = -3, y = 3}
	local ghost = w:newBody{shape = shape, x = 0, y = 3, layer = 2, mask = 0xFFFF}
	local ghost2 = w:newBody{shape = shape, x = 3, y = 3, layer = 1, mask = 2}
	run(w, 2)
	local _, y1 = lands:getPosition()
	local _, y2 = ghost:getPosition()
	local _, y3 = ghost2:getPosition()
	check("same layer collides", near(y1, 0.5, REST), fmt(y1))
	check("floor mask excludes the body's layer: falls through", y2 < -5, fmt(y2))
	check("body mask excludes the floor's layer: falls through", y3 < -5, fmt(y3))
	local l, m = ghost:getLayer()
	check("getLayer", l == 2 and m == 0xFFFF, fmt(l, m))
	-- setLayer: put a falling ghost back on layer 1.
	ghost2:setPosition(3, 3, 0)
	ghost2:setLinearVelocity(0, 0, 0)
	ghost2:setLayer(1, 0xFFFF)
	run(w, 2)
	local _, y4 = ghost2:getPosition()
	check("setLayer makes it collide", near(y4, 0.5, REST), fmt(y4))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("forces", function()
	local w = newFloorWorld()
	local box = w:newBody{shape = p3.newBoxShape(0.5, 0.5, 0.5), y = 5, linearDamping = 0, allowSleep = false}
	local m = box:getMass()
	-- Hover: a force cancelling gravity, applied every frame, at frame rates
	-- that don't match the fixed step.
	local i = 0
	run(w, 2, function()
		box:applyForce(0, m * 9.81, 0)
	end, 1 / 144)
	local _, y1 = box:getPosition()
	run(w, 2, function()
		box:applyForce(0, m * 9.81, 0)
	end, 1 / 30)
	local _, y2 = box:getPosition()
	check("applyForce is frame-rate independent (hovers)", near(y1, 5, 0.05) and near(y2, 5, 0.05), fmt(y1, y2))
	box:setLinearVelocity(0, 0, 0)
	box:applyImpulse(m * 2, 0, 0)
	local vx = box:getLinearVelocity()
	check("applyImpulse changes velocity at once", near(vx, 2, 1e-3), fmt(vx))
	box:setGravityScale(0)
	box:setLinearVelocity(0, 0, 0)
	box:setAngularVelocity(0, 0, 0)
	run(w, 1, function() box:applyTorque(0, 100, 0) end)
	local _, wy = box:getAngularVelocity()
	check("applyTorque spins", wy > 0.1, fmt(wy))
	box:setAngularVelocity(0, 0, 0)
	box:setLinearVelocity(0, 0, 0)
	box:applyImpulse(0, 0, m, 0, 5.5, 0) -- at the top edge: also spins
	local ax, ay, az = box:getAngularVelocity()
	check("applyImpulse at a point spins", math.abs(ax) > 0.1, fmt(ax, ay, az))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("body properties", function()
	local w = newFloorWorld()
	local shape = p3.newBoxShape(0.5, 0.5, 0.5)
	local box = w:newBody{shape = shape, y = 0.5, friction = 0.2}
	check("friction", near(box:getFriction(), 0.2))
	box:setFriction(0.9)
	check("setFriction", near(box:getFriction(), 0.9))
	box:setRestitution(0.3)
	check("setRestitution", near(box:getRestitution(), 0.3))
	local heavy = w:newBody{shape = shape, x = 3, y = 0.5, mass = 5}
	check("mass override", near(heavy:getMass(), 5, 1e-3), fmt(heavy:getMass()))
	local floating = w:newBody{shape = shape, x = 6, y = 5, gravityScale = 0}
	local locked = w:newBody{shape = shape, x = -3, y = 5, gravityScale = 0, lockRotation = true}
	local awake = w:newBody{shape = shape, x = -6, y = 0.5, allowSleep = false}
	locked:applyImpulse(0, 0, 500, -3, 5.5, 0)
	run(w, 3)
	local _, fy = floating:getPosition()
	check("gravityScale 0 floats", near(fy, 5, 1e-3), fmt(fy))
	local ax, ay, az = locked:getAngularVelocity()
	local qx, qy, qz, qw = locked:getRotation()
	check("lockRotation keeps it from turning", near(ax, 0) and near(ay, 0) and near(az, 0) and near(qw, 1), fmt(ax, ay, az, qw))
	local _, _, lz = locked:getPosition()
	check("lockRotation still moves", lz > 1, fmt(lz))
	check("allowSleep = false stays awake", awake:isAwake() and not box:isAwake())
	floating:setGravityScale(1)
	run(w, 0.5)
	_, fy = floating:getPosition()
	check("setGravityScale wakes and falls", fy < 4.5, fmt(fy))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("kinematic", function()
	local w = newFloorWorld()
	local platform = w:newBody{type = "kinematic", shape = p3.newBoxShape(0.5, 0.5, 0.5), x = 0, y = 0.5}
	local crate = w:newBody{shape = p3.newBoxShape(0.5, 0.5, 0.5), x = 2, y = 0.5}
	check("kinematic type and mass", platform:getType() == "kinematic" and platform:getMass() == 0)
	local x = 0
	run(w, 2, function(dt)
		x = x + 2 * dt
		platform:moveKinematic(x, 0.5, 0, 0, 0, 0, 1, dt)
	end)
	local px, py = platform:getPosition()
	check("moveKinematic reaches its target", near(px, 4, 0.05) and near(py, 0.5, 0.01), fmt(px, py))
	local cx = crate:getPosition()
	check("kinematic body pushes a dynamic one", cx > 4.4, fmt(cx))
	local ok, err = pcall(function()
		w:getBodies()[1]:moveKinematic(0, 0, 0, 0, 0, 0, 1, 1 / 60)
	end)
	local floorBody
	for _, b in ipairs(w:getBodies()) do if b:getType() == "static" then floorBody = b end end
	ok, err = pcall(floorBody.moveKinematic, floorBody, 0, 0, 0, 0, 0, 0, 1, 1 / 60)
	check("moveKinematic on a static body errors", not ok and tostring(err):find("static") ~= nil, tostring(err))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("destroy", function()
	local w = newFloorWorld()
	local shape = p3.newSphereShape(0.5)
	local a = w:newBody{shape = shape, y = 2}
	local b = w:newBody{shape = shape, x = 2, y = 2}
	a:destroy()
	check("isDestroyed", a:isDestroyed() and not b:isDestroyed())
	local ok, err = pcall(a.getPosition, a)
	check("use after destroy errors", not ok and tostring(err):find("Body3D has been destroyed") ~= nil, tostring(err))
	check("destroy twice is fine", pcall(a.destroy, a))
	check("body count after destroy", w:getBodyCount() == 2)
	run(w, 0.5)
	-- Destroying inside a callback.
	local c = w:newBody{shape = shape, x = 5, y = 1}
	w:setCallbacks(function(x, y)
		if x == c or y == c then c:destroy() end
	end)
	run(w, 1)
	check("destroy inside a callback", c:isDestroyed())
	shape:release()
	ok, err = pcall(w.newBody, w, {shape = shape})
	check("released shape errors", not ok and tostring(err):find("released") ~= nil, tostring(err))
	local _, by = b:getPosition()
	check("bodies keep their shape after it's released", near(by, 0.5, REST), fmt(by))
	w:destroy()
	check("world isDestroyed", w:isDestroyed())
	ok, err = pcall(w.update, w, 1 / 60)
	check("world use after destroy errors", not ok and tostring(err):find("World3D has been destroyed") ~= nil, tostring(err))
	ok, err = pcall(b.getPosition, b)
	check("bodies die with their world", not ok and tostring(err):find("destroyed") ~= nil, tostring(err))
	-- Destroying the world from a callback stops dispatching safely.
	local w2 = newFloorWorld()
	w2:newBody{shape = p3.newSphereShape(0.5), y = 1}
	w2:newBody{shape = p3.newSphereShape(0.5), x = 3, y = 1}
	local calls = 0
	w2:setCallbacks(function() calls = calls + 1; w2:destroy() end)
	for _ = 1, 120 do
		if w2:isDestroyed() then break end
		w2:update(1 / 60)
	end
	check("destroy world inside a callback", w2:isDestroyed() and calls == 1, "calls: " .. calls)
end)

-- --------------------------------------------------------------------------
group("userdata", function()
	local w, floor = newFloorWorld()
	local box = w:newBody{shape = p3.newBoxShape(0.5, 0.5, 0.5), y = 0.5}
	check("no userdata by default", box:getUserData() == nil)
	local data = {name = "crate"}
	box:setUserData(data)
	check("userdata round trip (table)", rawequal(box:getUserData(), data))
	box:setUserData("hello")
	check("userdata round trip (string)", box:getUserData() == "hello")
	box:setUserData(nil)
	check("userdata cleared", box:getUserData() == nil)
	floor:setUserData(data)
	collectgarbage()
	collectgarbage()
	local found
	for _, b in ipairs(w:getBodies()) do
		if b == floor then found = b:getUserData() end
	end
	check("getBodies returns the same objects (with their userdata)", rawequal(found, data))
	local character = w:newCharacter{shape = p3.newCapsuleShape(0.5, 0.3), x = 5, y = 1}
	character:setUserData(data)
	check("character userdata round trip", rawequal(character:getUserData(), data))
	w:destroy()
end)

-- --------------------------------------------------------------------------
group("shapes", function()
	local w = newFloorWorld()
	local compound = p3.newCompoundShape{
		{p3.newSphereShape(0.5), -1, 0, 0},
		{p3.newSphereShape(0.5), 1, 0, 0},
		{p3.newBoxShape(1, 0.1, 0.1)},
	}
	check("compound type", compound:getType() == "compound")
	local dumbbell = w:newBody{shape = compound, y = 3}
	local hull = p3.newConvexHullShape{-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0}
	check("convex hull type", hull:getType() == "convexhull")
	local pyramid = w:newBody{shape = hull, x = 4, y = 3}
	local cylinder = w:newBody{shape = p3.newCylinderShape(0.75, 0.3), x = -4, y = 3}
	local one = p3.newCompoundShape{{p3.newBoxShape(0.5, 0.5, 0.5), 0, 0.5, 0}}
	check("one-part compound type", one:getType() == "compound")
	local lifted = w:newBody{shape = one, x = 8, y = 3}
	run(w, 3)
	local x, y, z = dumbbell:getPosition()
	check("compound rests on its spheres", near(y, 0.5, REST), fmt(x, y, z))
	check("compound mass is the sum of its parts", dumbbell:getMass() > 2 * 4 / 3 * math.pi * 0.125 * 1000 * 0.99, fmt(dumbbell:getMass()))
	_, y = pyramid:getPosition()
	check("convex hull rests on its base", near(y, 0, REST), fmt(y))
	_, y = cylinder:getPosition()
	check("cylinder rests on its end", near(y, 0.75, REST), fmt(y))
	_, y = lifted:getPosition()
	check("one-part compound keeps its offset", near(y, 0, REST), fmt(y))

	-- A mesh floor (two triangles), static only.
	local w2 = p3.newWorld()
	local mesh = p3.newMeshShape({-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10}, {1, 3, 2, 1, 4, 3})
	check("mesh type", mesh:getType() == "mesh")
	local ground = w2:newBody{type = "static", shape = mesh}
	local box = w2:newBody{shape = p3.newBoxShape(0.5, 0.5, 0.5), x = 2, y = 3, z = 1}
	local sphere = w2:newBody{shape = p3.newSphereShape(0.5), x = -2, y = 3}
	run(w2, 3)
	_, y = box:getPosition()
	check("box rests on a mesh", near(y, 0.5, REST), fmt(y))
	_, y = sphere:getPosition()
	check("sphere rests on a mesh", near(y, 0.5, REST), fmt(y))
	check("raycast hits a mesh", w2:raycast(0, 5, 0, 0, -10, 0) == ground)
	local ok, err = pcall(w2.newBody, w2, {shape = mesh})
	check("dynamic mesh body errors", not ok and tostring(err):find("static") ~= nil, tostring(err))
	ok, err = pcall(p3.newMeshShape, {0, 0, 0, 1, 0, 0, 0, 0, 1}, {1, 2, 4})
	check("mesh index out of range errors", not ok and tostring(err):find("1%-based") ~= nil, tostring(err))
	ok, err = pcall(p3.newConvexHullShape, {0, 0, 0, 1, 0, 0})
	check("convex hull with too few points errors", not ok and tostring(err):find("at least 4") ~= nil, tostring(err))
	w:destroy()
	w2:destroy()
end)

-- --------------------------------------------------------------------------
local function newCharacterWorld()
	local w, floor = newFloorWorld(10)
	local shape = p3.newCapsuleShape(0.5, 0.3) -- 1.6 m tall, origin at its center
	local c = w:newCharacter{shape = shape, x = 0, y = 0.85, z = 0}
	return w, floor, c
end

local function walk(w, c, seconds, vx, vz, each)
	run(w, seconds, function(dt)
		local _, vy = c:getLinearVelocity()
		c:setLinearVelocity(vx, vy, vz)
		c:update(dt)
		if each then each(dt) end
	end)
end

group("character", function()
	local w, floor, c = newCharacterWorld()
	check("Character3D type", c:type() == "Character3D" and c:typeOf("Character3D") and c:typeOf("Object"))
	check("starts in the air", c:getGroundState() == "inair")
	walk(w, c, 1, 0, 0)
	local x, y, z = c:getPosition()
	check("character stands on the floor", c:isOnGround() and c:getGroundState() == "onground" and near(y, 0.8, 0.03), fmt(x, y, z))
	local nx, ny, nz = c:getGroundNormal()
	check("ground normal is up", near(ny, 1, 1e-3), fmt(nx, ny, nz))
	local _, vy = c:getLinearVelocity()
	check("no vertical velocity on the ground", near(vy, 0, 1e-3), fmt(vy))
	local alwaysOnGround = true
	walk(w, c, 1, 2, 0, function() if not c:isOnGround() then alwaysOnGround = false end end)
	x, y, z = c:getPosition()
	check("character walks on the floor", near(x, 2, 0.05) and near(y, 0.8, 0.03) and near(z, 0, 0.01), fmt(x, y, z))
	check("stays on the ground while walking", alwaysOnGround)

	-- Jump.
	local _, vy0 = c:getLinearVelocity()
	local vx0 = c:getLinearVelocity()
	c:setLinearVelocity(vx0, 5, 0)
	local peak = 0
	run(w, 0.3, function(dt)
		c:update(dt)
		local _, py = c:getPosition()
		peak = math.max(peak, py)
	end)
	check("character jumps", peak > 1.5 and not c:isOnGround(), fmt(peak))
	walk(w, c, 1.5, 0, 0)
	_, y = c:getPosition()
	check("character lands", c:isOnGround() and near(y, 0.8, 0.03), fmt(y))

	-- The callbacks report the character touching the floor.
	local began = {}
	w:setCallbacks(function(a, b)
		began[#began + 1] = a:type() .. "+" .. b:type()
	end)
	c:setPosition(-4, 2, -4)
	walk(w, c, 1, 0, 0)
	check("character contacts are reported", began[1] == "Character3D+Body3D", table.concat(began, ", "))
	w:destroy()
end)

group("character steps and slopes", function()
	local w, floor, c = newCharacterWorld()
	-- A 0.2 m step from x = 3 to 7.
	w:newBody{type = "static", shape = p3.newBoxShape(2, 0.1, 2), x = 5, y = 0.1, z = 0}
	walk(w, c, 2.5, 2, 0)
	local x, y = c:getPosition()
	check("character climbs a 0.2 m step", x > 4 and near(y, 1.0, 0.03) and c:isOnGround(), fmt(x, y))
	w:destroy()

	-- A 70 degree slope rising from x = 3; maxSlope is 50 degrees.
	w, floor, c = newCharacterWorld()
	local a = math.rad(70)
	local ramp = p3.newBoxShape(3, 0.1, 2)
	local function rampAt(angle, x0)
		-- Box rotated about z so that its top face rises at `angle`, starting near (x0, 0).
		local cx, cy = x0 + 3 * math.cos(angle) + 0.1 * math.sin(angle), 3 * math.sin(angle) - 0.1 * math.cos(angle)
		return w:newBody{type = "static", shape = ramp, x = cx, y = cy, qz = math.sin(angle / 2), qw = math.cos(angle / 2)}
	end
	rampAt(a, 3)
	walk(w, c, 3, 2, 0)
	x, y = c:getPosition()
	check("character can't climb a 70 degree slope", y < 1.0 and x < 3.2, fmt(x, y))
	w:destroy()

	w, floor, c = newCharacterWorld()
	rampAt(math.rad(30), 3)
	walk(w, c, 3, 2, 0)
	x, y = c:getPosition()
	check("character climbs a 30 degree slope", y > 1.5, fmt(x, y))
	w:destroy()

	-- Walking off the edge of a 4 x 4 platform.
	w = p3.newWorld()
	w:newBody{type = "static", shape = p3.newBoxShape(2, 0.5, 2), y = -0.5}
	c = w:newCharacter{shape = p3.newCapsuleShape(0.5, 0.3), y = 0.8}
	walk(w, c, 0.5, 0, 0)
	check("character on the platform", c:isOnGround())
	walk(w, c, 2, 3, 0)
	x, y = c:getPosition()
	check("character falls off the edge", y < -1 and not c:isOnGround() and c:getGroundState() == "inair", fmt(x, y, c:getGroundState()))
	w:destroy()
end)

group("character and bodies", function()
	local w, floor, c = newCharacterWorld()
	local crate = w:newBody{shape = p3.newBoxShape(0.4, 0.4, 0.4), x = 2, y = 0.4, mass = 10}
	local touched
	w:setCallbacks(function(a, b, nx, ny, nz)
		if a == c and b == crate then touched = {nx, ny, nz} end
	end)
	walk(w, c, 2.5, 1.5, 0)
	local cx = crate:getPosition()
	check("character pushes a dynamic body", cx > 2.3, fmt(cx))
	check("character/body contact reported with the Character3D", touched ~= nil and touched[1] > 0.5,
		touched and fmt(unpack(touched)) or "no begin")
	-- A dynamic body landing on a character's head is ignored by the body
	-- (characters aren't rigid bodies), but the character still stands.
	local x = c:getPosition()
	check("character still on the ground", c:isOnGround(), fmt(x))
	-- Raycasts see characters.
	local cxp, cyp, czp = c:getPosition()
	local hit, hx, hy, hz, nx, ny, nz = w:raycast(cxp, 5, czp, 0, -10, 0)
	check("raycast hits a character", hit == c and near(ny, 1, 0.01) and hy > cyp, fmt(tostring(hit), hy, ny))
	local ok, err = pcall(function() c:destroy(); c:getPosition() end)
	check("character use after destroy errors", not ok and tostring(err):find("Character3D has been destroyed") ~= nil, tostring(err))
	check("raycast skips destroyed characters", w:raycast(cxp, 5, czp, 0, -10, 0) == floor)
	w:destroy()
end)

group("character on a moving platform", function()
	local w = p3.newWorld()
	local platform = w:newBody{type = "kinematic", shape = p3.newBoxShape(2, 0.25, 2), y = -0.25}
	local c = w:newCharacter{shape = p3.newCapsuleShape(0.5, 0.3), y = 0.85}
	local x = 0
	local function ride(seconds)
		run(w, seconds, function(dt)
			x = x + dt
			platform:moveKinematic(x, -0.25, 0, 0, 0, 0, 1, dt)
			local gx, _, gz = c:getGroundVelocity()
			local _, vy = c:getLinearVelocity()
			c:setLinearVelocity(gx, vy, gz)
			c:update(dt)
		end)
	end
	ride(0.5) -- lands on the platform
	local x0 = c:getPosition()
	ride(1.5)
	local cx, cy = c:getPosition()
	check("character rides a moving platform (getGroundVelocity)", near(cx - x0, 1.5, 0.03) and near(cy, 0.8, REST) and c:isOnGround(), fmt(cx - x0, cy))
	w:destroy()
end)

group("character in a sensor", function()
	local w, floor, c = newCharacterWorld()
	local area = w:newBody{type = "static", shape = p3.newBoxShape(1, 1, 1), x = 3, y = 1, sensor = true}
	local log = {}
	w:setCallbacks(function(a, b)
		if b == area then log[#log + 1] = "begin" end
	end, function(a, b)
		if b == area then log[#log + 1] = "end" end
	end)
	walk(w, c, 4, 1.5, 0)
	local x = c:getPosition()
	check("character enters and leaves a sensor", table.concat(log, ",") == "begin,end", table.concat(log, ",") .. " x=" .. fmt(x))
	w:destroy()
end)

print(string.format("%d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
