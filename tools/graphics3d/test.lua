-- Tests for graphics3d: math round trips, projections, camera rays and the
-- glTF loader on the hand-made models in demo/models.
--
-- In the demo press T (or ship a file named "runtests" in the game) to run
-- them; results are printed and returned:
--   local passed, failed, lines = require("test")()

local g3d = require("graphics3d")
local mat4, quat = g3d.mat4, g3d.quat
local abs, pi, sqrt = math.abs, math.pi, math.sqrt

return function(models)
	models = models or "models/"
	local passed, failed, lines = 0, 0, {}
	local function report(ok, name, detail)
		if ok then
			passed = passed + 1
		else
			failed = failed + 1
			local line = "FAIL " .. name .. (detail and (": " .. detail) or "")
			lines[#lines + 1] = line
			print(line)
		end
	end
	local function near(a, b, eps) return abs(a - b) <= (eps or 1e-5) end
	local function check(name, cond, detail) report(cond and true or false, name, detail) end
	local function close(name, a, b, eps)
		report(near(a, b, eps), name, ("%.6f vs %.6f"):format(a or 0 / 0, b or 0 / 0))
	end
	local function vec(name, ax, ay, az, bx, by, bz, eps)
		local ok = near(ax, bx, eps) and near(ay, by, eps) and near(az, bz, eps)
		report(ok, name, ("(%.4f, %.4f, %.4f) vs (%.4f, %.4f, %.4f)"):format(ax, ay, az, bx, by, bz))
	end
	-- Expected values first, so a function's multiple results can come last.
	local function got(name, bx, by, bz, ax, ay, az)
		vec(name, ax, ay, az, bx, by, bz)
	end
	local function sameRotation(name, ax, ay, az, aw, bx, by, bz, bw)
		local d = abs(ax * bx + ay * by + az * bz + aw * bw)
		report(near(d, 1, 1e-5), name, ("dot %.6f"):format(d))
	end
	local function section(name, fn)
		local ok, err = pcall(fn)
		if not ok then report(false, name .. " (error)", tostring(err)) end
	end

	section("mat4", function()
		local I = mat4.new()
		local m = mat4.fromTRS(1, 2, 3, quat.fromEuler(0.3, -1.1, 0.7))
		check("multiply by identity", mat4.equals(mat4.multiply(I, m), m))
		local inv, ok = mat4.invert(m)
		check("invert ok", ok)
		check("m * m^-1 = I", mat4.equals(mat4.multiply(m, inv), I, 1e-5))
		check("m^-1 * m = I", mat4.equals(mat4.multiply(inv, m), I, 1e-5))
		local _, singular = mat4.invert({}, { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 })
		check("singular invert fails", singular == false)
		check("transpose twice", mat4.equals(mat4.transpose(mat4.transpose(m)), m))
		local aliased = mat4.new(m)
		mat4.multiply(aliased, aliased, inv)
		check("multiply into an input", mat4.equals(aliased, I, 1e-5))

		local qx, qy, qz, qw = quat.fromEuler(0.4, 2.1, -0.3)
		local t = mat4.fromTRS(mat4.new(), -4, 5, 6, qx, qy, qz, qw, 2, 3, 0.5)
		local x, y, z, rx, ry, rz, rw, sx, sy, sz = mat4.decompose(t)
		vec("decompose translation", x, y, z, -4, 5, 6)
		sameRotation("decompose rotation", rx, ry, rz, rw, qx, qy, qz, qw)
		vec("decompose scale", sx, sy, sz, 2, 3, 0.5)
		local px, py, pz = mat4.transformPoint(t, 1, 1, 1)
		local vx, vy, vz = quat.rotateVector(qx, qy, qz, qw, 2, 3, 0.5)
		vec("TRS transforms a point", px, py, pz, vx - 4, vy + 5, vz + 6)
		got("transformDirection", 0, 0, -1, mat4.transformDirection(mat4.fromTRS(0, 0, 0, quat.fromAxisAngle(0, 1, 0, pi / 2)), 1, 0, 0))
		check("mirrored determinant", mat4.determinant3(mat4.fromTRS(0, 0, 0, 0, 0, 0, 1, -1, 1, 1)) < 0)
	end)

	section("quat", function()
		for _, e in ipairs({ { 0.3, 0.5, 0.1 }, { -1.2, 2.5, -0.7 }, { 1.4, -3.0, 2.9 }, { 0, 0, 0 }, { 0.01, -0.02, 3.1 } }) do
			local x, y, z = quat.toEuler(quat.fromEuler(e[1], e[2], e[3]))
			vec(("euler round trip %.2f %.2f %.2f"):format(e[1], e[2], e[3]), x, y, z, e[1], e[2], e[3], 1e-5)
		end
		-- YXZ: q = qy * qx * qz
		local ax, ay, az, aw = quat.fromAxisAngle(0, 1, 0, 0.8)
		local bx, by, bz, bw = quat.fromAxisAngle(1, 0, 0, -0.4)
		local cx, cy, cz, cw = quat.fromAxisAngle(0, 0, 1, 1.3)
		local px, py, pz, pw = quat.multiply(ax, ay, az, aw, bx, by, bz, bw)
		px, py, pz, pw = quat.multiply(px, py, pz, pw, cx, cy, cz, cw)
		sameRotation("fromEuler is YXZ", px, py, pz, pw, quat.fromEuler(-0.4, 0.8, 1.3))
		-- Godot: forward is -z; yaw +90° turns it to -x.
		local q1, q2, q3, q4 = quat.fromEuler(0, pi / 2, 0)
		got("yaw 90 turns -z to -x", -1, 0, 0, quat.rotateVector(q1, q2, q3, q4, 0, 0, -1))
		q1, q2, q3, q4 = quat.fromEuler(pi / 2, 0, 0)
		got("pitch 90 turns -z to +y", 0, 1, 0, quat.rotateVector(q1, q2, q3, q4, 0, 0, -1))
		local ex, ey, ez, ew = quat.fromAxisAngle(0, 1, 0, pi / 2)
		local hx, hy, hz, hw = quat.slerp(0, 0, 0, 1, ex, ey, ez, ew, 0.5)
		sameRotation("slerp halfway", hx, hy, hz, hw, quat.fromAxisAngle(0, 1, 0, pi / 4))
		local dx, dy, dz = 0.3, -0.5, -0.8
		local len = sqrt(dx * dx + dy * dy + dz * dz)
		local lx, ly, lz, lw = quat.lookRotation(dx, dy, dz)
		got("lookRotation faces the direction", dx / len, dy / len, dz / len, quat.rotateVector(lx, ly, lz, lw, 0, 0, -1))
		local _, upy = quat.rotateVector(lx, ly, lz, lw, 0, 1, 0)
		check("lookRotation keeps up", upy > 0)
		q1, q2, q3, q4 = quat.lookRotation(0, -1, 0)
		got("lookRotation straight down", 0, -1, 0, quat.rotateVector(q1, q2, q3, q4, 0, 0, -1))
		local axx, axy, axz, angle = quat.toAxisAngle(quat.fromAxisAngle(1, 2, 2, 1.1))
		vec("axis angle round trip", axx, axy, axz, 1 / 3, 2 / 3, 2 / 3)
		close("axis angle angle", angle, 1.1)
	end)

	section("projection", function()
		local p = mat4.perspective(pi / 2, 1, 1, 10)
		local x, y, z = mat4.transformPoint(p, 0, 0, -1)
		close("perspective near -> -1", z, -1)
		x, y, z = mat4.transformPoint(p, 0, 0, -10)
		close("perspective far -> 1", z, 1)
		x, y = mat4.transformPoint(p, 1, 1, -1)
		vec("perspective 90° corner", x, y, 0, 1, 1, 0)
		x, y = mat4.transformPoint(mat4.perspective(pi / 2, 2, 1, 10), 2, 1, -1)
		vec("perspective aspect", x, y, 0, 1, 1, 0)
		local o = mat4.orthographic(-2, 2, -1, 1, 0.5, 20)
		x, y, z = mat4.transformPoint(o, 2, -1, -20)
		vec("orthographic corner", x, y, z, 1, -1, 1)
		local v = mat4.lookAt(1, 2, 3, 1, 2, -7)
		got("lookAt eye at origin", 0, 0, 0, mat4.transformPoint(v, 1, 2, 3))
		got("lookAt target ahead", 0, 0, -10, mat4.transformPoint(v, 1, 2, -7))
		v = mat4.lookAt(0, 5, 0, 0, 0, 0)
		got("lookAt straight down", 0, 0, -5, mat4.transformPoint(v, 0, 0, 0))
	end)

	section("camera", function()
		local cam = g3d.newCamera({ fov = 60, near = 0.1, far = 100 })
		cam:setTransform(3, 4, 5)
		cam:lookAt(0, 1, 0)
		local w, h = 800, 600
		local sx, sy, depth = cam:worldToScreen(0, 1, 0, w, h)
		vec("target at the screen center", sx, sy, 0, 400, 300, 0, 1e-3)
		close("depth is the distance", depth, sqrt(9 + 9 + 25), 1e-4)
		local ox, oy, oz, dx, dy, dz = cam:screenToRay(400, 300, w, h)
		local fx, fy, fz = cam:getForward()
		vec("center ray is forward", dx, dy, dz, fx, fy, fz)
		vec("ray starts at the camera", ox, oy, oz, 3, 4, 5)
		for _, pt in ipairs({ { 0, 0 }, { 800, 600 }, { 123, 456 } }) do
			ox, oy, oz, dx, dy, dz = cam:screenToRay(pt[1], pt[2], w, h)
			local bx, by = cam:worldToScreen(ox + dx * 7, oy + dy * 7, oz + dz * 7, w, h)
			vec(("ray round trip %d,%d"):format(pt[1], pt[2]), bx, by, 0, pt[1], pt[2], 0, 1e-3)
		end
		check("behind the camera is nil", cam:worldToScreen(6, 7, 10, w, h) == nil)
		-- The projection matrix agrees with worldToScreen.
		local vp = cam:getViewProjectionMatrix(w / h)
		local nx, ny = mat4.transformPoint(vp, 1, 0.5, -1)
		local qx, qy = cam:worldToScreen(1, 0.5, -1, w, h)
		vec("matrix and worldToScreen agree", (nx + 1) * 0.5 * w, (1 - ny) * 0.5 * h, 0, qx, qy, 0, 1e-3)

		local ortho = g3d.newCamera({ projection = "orthographic", size = 10 })
		ortho:setTransform(0, 10, 0, quat.lookRotation(0, -1, 0))
		ox, oy, oz, dx, dy, dz = ortho:screenToRay(800, 300, w, h)
		vec("ortho ray direction", dx, dy, dz, 0, -1, 0)
		local rx, ry = ortho:worldToScreen(ox, 0, oz, w, h)
		vec("ortho ray round trip", rx, ry, 0, 800, 300, 0, 1e-3)
		close("ortho half width", abs(ox), 5 * w / h, 1e-4)
	end)

	section("meshes", function()
		local tri = g3d.newMesh({ positions = { 0, 0, 0, 1, 0, 0, 0, 1, 0 } })
		check("newMesh triangle count", tri.triangleCount == 1)
		local a, b, c, d, e, f = tri:getBounds()
		check("newMesh bounds", a == 0 and b == 0 and c == 0 and d == 1 and e == 1 and f == 0)
		local box = g3d.newBox(2, 4, 6)
		a, b, c, d, e, f = box:getBounds()
		vec("box bounds min", a, b, c, -1, -2, -3)
		vec("box bounds max", d, e, f, 1, 2, 3)
		check("box triangles", box.triangleCount == 12)
		local s = g3d.newSphere(1, 16)
		a, b, c, d, e, f = s:getBounds()
		vec("sphere bounds", d, e, f, 1, 1, 1, 1e-6)
		check("sphere vertex count", s.vertexCount == 17 * 9)
		local cap = g3d.newCapsule(0.5, 3)
		a, b, c, d, e, f = cap:getBounds()
		close("capsule height", e - b, 3)
		local cyl = g3d.newCylinder(0.5, 2)
		a, b, c, d, e, f = cyl:getBounds()
		close("cylinder height", e - b, 2)
		local ok = pcall(g3d.newMesh, { positions = { 0, 0, 0 }, indices = { 1, 2, 3 } })
		check("newMesh rejects bad indices", not ok)
		local mat = g3d.newMaterial({ color = { 1, 1, 1, 0.5 } })
		check("alpha < 1 is transparent", mat:isTransparent())
	end)

	section("json", function()
		local json = require("graphics3d.json")
		local v = json.decode('{"a":[1,-2.5e2,true,false,null,"x\\n\\u00e9\\ud83d\\ude00"],"b":{"c":{}}, "d":[] }')
		check("json numbers", v.a[1] == 1 and v.a[2] == -250)
		check("json booleans", v.a[3] == true and v.a[4] == false and v.a[5] == nil)
		check("json escapes", v.a[6] == "x\n\195\169\240\159\152\128")
		check("json nesting", type(v.b.c) == "table" and #v.d == 0)
		check("json errors", not pcall(json.decode, '{"a":}'))
	end)

	section("gltf house", function()
		local m = g3d.loadModel(models .. "house.gltf")
		check("house node count", #m.nodes == 4, tostring(#m.nodes))
		check("house roots", #m.roots == 1 and m.roots[1].name == "House")
		local door = m:findNode("Door")
		check("door parent", door and door.parent == m.roots[1])
		close("door matrix translation", door.z, 1.01)
		check("house draw list", #m.drawList == 3, tostring(#m.drawList))
		check("house materials", #m.materials == 3 and m.materials[1].name == "Walls")
		check("walls texture", m.materials[1].texture ~= nil)
		close("roof color is sRGB", m.materials[2].color[1], 0.735357, 1e-4)
		check("door double sided", m.materials[3].doubleSided == true)
		check("no conversions needed", m.convertedAccessors == 0, tostring(m.convertedAccessors))
		local roof = m:findNode("Roof")
		sameRotation("roof rotation", roof.qx, roof.qy, roof.qz, roof.qw, quat.fromAxisAngle(0, 1, 0, pi / 4))
		local a, b, c, d, e, f = m:getBounds()
		local r = 1.25 * sqrt(2)
		vec("house bounds min", a, b, c, -r, 0, -r, 1e-4)
		vec("house bounds max", d, e, f, r, 1.5 + 0.9 * 1.2, r, 1e-4)
		check("base mesh triangles", m:findNode("Base").mesh.primitives[1].mesh.triangleCount == 12)
	end)

	section("gltf tower", function()
		local m = g3d.loadModel(models .. "tower.glb")
		check("tower node count", #m.nodes == 5, tostring(#m.nodes))
		check("tower draw list", #m.drawList == 4, tostring(#m.drawList))
		local flag = m:findNode("Flag")
		check("flag parent", flag.parent and flag.parent.name == "Pole")
		local fx, fy, fz = mat4.transformPoint(flag.matrix, 1, 0, 0)
		vec("flag world matrix", fx, fy, fz, 0.05, 3.4, -1)
		local mats = {}
		for _, mat in ipairs(m.materials) do mats[mat.name] = mat end
		check("cloth blends", mats.Cloth:isTransparent())
		check("fence masks", mats.Fence.alphaCutoff == 0.5 and not mats.Fence:isTransparent())
		check("fence texture from the binary chunk", mats.Fence.texture ~= nil)
		check("emissive strength", mats.Crystal.emission[3] > 1)
		-- u8 indices and the missing normals are converted; the rest is direct.
		check("conversions", m.convertedAccessors == 2, tostring(m.convertedAccessors))
		local a, b, c, d, e, f = m:getBounds()
		close("tower top (the flag)", e, 3 + 0.4 + 0.7, 1e-4)
		close("tower bottom", b, 0)
		local flagMesh = flag.mesh.primitives[1].mesh
		vec("flag bounds without min/max", flagMesh.maxx, flagMesh.maxy, flagMesh.maxz, 1.2, 0.7, 0)
	end)

	section("errors", function()
		check("missing model errors", not pcall(g3d.loadModel, "models/nope.glb"))
		check("draw outside begin errors", not pcall(g3d.draw, g3d.newBox()))
	end)

	local summary = ("graphics3d tests: %d passed, %d failed"):format(passed, failed)
	print(summary)
	table.insert(lines, 1, summary)
	return passed, failed, lines
end
