-- Checks the rules a project plays by. tools/scene-tests/rules3 (version 3:
-- degrees, clicked(), undeclared names are errors, gravityScale) and
-- tools/scene-tests/rules2 (version 2: the rules of before) hold the same
-- files apart from smitten.json's "version", so the same lines are checked
-- under both. Prints PASS or FAIL for each check, then DONE
-- (tools/scene-tests/run.mjs reads them).

local g = smitten.graphics

-- Which rules: the project's version.
local NEW = tonumber((smitten.filesystem.read("smitten.json") or ""):match('"version"%s*:%s*(%d+)')) >= 3
-- A quarter turn, and a turn a second, in the unit this project's scripts use.
local QUARTER = if NEW then 90 else math.pi / 2

local passed, failed = 0, 0
local stage
local steps, moving = 0, nil

local function check(name, ok, why)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. ": " .. tostring(why or "not so"))
  end
end

local function near(a, b, tolerance)
  return type(a) == "number" and math.abs(a - b) <= (tolerance or 0.001)
end

-- Waits for the next frame (update() resumes this once a frame).
local function frame(n)
  for i = 1, n or 1 do coroutine.yield() end
end

-- Waits for some physics steps (60 a second).
local function physics(n)
  local from = steps
  while steps < from + n do coroutine.yield() end
  return steps - from
end

local function add(kind, props, script, parent)
  return (parent or stage):add(make(kind, props, script))
end

local function mouse(what, x, y)
  local wx, wy = smitten.display.toWindow(x, y)
  smitten.event.push("mouse" .. what, wx, wy, 1, false, 1)
end

local function click(x, y)
  mouse("pressed", x, y)
  frame(2)
  mouse("released", x, y)
  frame(2)
end

---------------------------------------------------------------------------
-- 1. Angles: degrees in a version 3 project, radians before.

local function angles()
  local arm = add("Group", { x = 0, y = 0 })
  local tip = add("Group", { x = 100, y = 0 }, nil, arm)

  -- The same line under both rules: 90 is a quarter turn, or 90 radians.
  arm.rotation = 90
  local x, y = tip:worldPosition()
  if NEW then
    check("rotation = 90 is a quarter turn", near(x, 0, 0.01) and near(y, 100, 0.01), x .. ", " .. y)
  else
    check("old: rotation = 90 is 90 radians", near(x, 100 * math.cos(90), 0.01) and near(y, 100 * math.sin(90), 0.01), x .. ", " .. y)
  end
  arm.rotation = math.pi / 2
  x, y = tip:worldPosition()
  if NEW then
    check("rotation = math.pi / 2 is hardly a turn", near(x, 100 * math.cos(math.rad(math.pi / 2)), 0.01), x .. ", " .. y)
  else
    check("old: rotation = math.pi / 2 is a quarter turn", near(x, 0, 0.01) and near(y, 100, 0.01), x .. ", " .. y)
  end

  local looker = add("Group", { x = 10, y = 10 })
  local a = looker:angleTo(10, 60)
  check(if NEW then "angleTo() gives degrees" else "old: angleTo() gives radians", near(a, QUARTER), a)
  looker:lookAt(10, 60)
  check(if NEW then "lookAt() sets degrees" else "old: lookAt() sets radians", near(looker.rotation, QUARTER), looker.rotation)
  -- Inside a turned parent, lookAt() takes the parent's turn off.
  arm.rotation = QUARTER
  local inner = add("Group", { x = 0, y = 0 }, nil, arm)
  inner:lookAt(0, 50)
  check("lookAt() inside a turned parent", near(inner.rotation, 0), inner.rotation)

  local m = smitten.math
  check(if NEW then "smitten.math.angle() gives degrees" else "old: smitten.math.angle() gives radians",
    near(m.angle(0, 5), QUARTER) and near(m.angle(1, 1, 1, 9), QUARTER) and near(m.angle(-3, 0), QUARTER * 2), m.angle(0, 5))
  local dx, dy = m.direction(QUARTER)
  local lx, ly = m.direction(QUARTER * 2, 10)
  check("smitten.math.direction() takes the same unit", near(dx, 0) and near(dy, 1) and near(lx, -10) and near(ly, 0), dx .. ", " .. dy)
  check("math.rad and math.deg are there for trig", near(math.sin(math.rad(90)), 1) and near(math.deg(math.pi), 180))

  -- Defaults that are angles.
  local dust = make("Particles")
  local body = make("Body")
  local pin = make("Joint")
  if NEW then
    check("defaults are in degrees", dust.direction == -90 and dust.spread == 30 and body.slope == 45 and pin.minAngle == -45
      and pin.maxAngle == 45 and pin.motorSpeed == 90, dust.direction .. " " .. dust.spread .. " " .. body.slope .. " " .. pin.motorSpeed)
  else
    check("old: defaults are in radians", dust.direction == -1.5708 and dust.spread == 0.5 and body.slope == 0.7854
      and pin.minAngle == -0.7854 and pin.maxAngle == 0.7854 and pin.motorSpeed == 2, dust.direction .. " " .. dust.spread .. " " .. body.slope .. " " .. pin.motorSpeed)
  end

  -- A tween works on the field, so it is in the same unit.
  local turning = add("Group", {})
  tween(turning, 0.05, { rotation = QUARTER })
  frame(12)
  check("tween of rotation", near(turning.rotation, QUARTER), turning.rotation)

  -- An Animator's keys keep degrees, as scene files of version 3 do; the
  -- piece gets them in this project's unit.
  local hinge = add("Group", {})
  local animator = add("Animator", { animations = { turn = { length = 1, tracks = {
    { piece = ".", property = "rotation", keys = { { time = 0, value = 0 }, { time = 1, value = 90 } } },
  } } } }, nil, hinge)
  animator:play("turn")
  animator:seek(1)
  check(if NEW then "an Animator's key of 90 is 90 degrees" else "old: an Animator's key of 90 degrees is a quarter turn in radians",
    near(hinge.rotation, QUARTER), hinge.rotation)

  -- sprite() in draw(): a bar 8 wide and 2 high, turned a quarter, points down.
  local canvas = g.newCanvas(64, 64, { dpiscale = 1 })
  local function drawn(...)
    g.push("all")
    g.setCanvas(canvas)
    g.setScissor()
    g.origin()
    g.clear(0, 0, 0, 1)
    pen(1, 1, 1)
    sprite("art/bar.png", 32, 32, ...)
    g.pop()
    local data = g.readbackTexture(canvas)
    return data:getPixel(31, 36) > 0.5, data:getPixel(36, 32) > 0.5
  end
  local down, right = drawn()
  check("sprite() unturned", right and not down)
  down, right = drawn(QUARTER)
  check("sprite(image, x, y, rotation)", down and not right)
  down, right = drawn({ rotation = QUARTER })
  check("sprite(image, x, y, { rotation = ... })", down and not right)
  down, right = drawn(90)
  check(if NEW then "sprite() with 90 is a quarter turn" else "old: sprite() with 90 is 90 radians", (down and not right) == NEW)
end

---------------------------------------------------------------------------
-- 2. Physics: spin, joints and gravityScale.

local function bodies()
  local GRAVITY_SCALE = if NEW then "gravityScale" else "gravity"
  local OTHER_NAME = if NEW then "gravity" else "gravityScale"
  local look = function(parent) add("Shape", { shape = "circle", radius = 8 }, nil, parent) end

  -- A physics body spinning a quarter turn a second.
  -- (Right inside the scene's root, where physics skips the matrix; the
  -- others are inside Stage, and go through it.)
  local spinner = add("Body", { x = 100, y = 100, motion = "physics", [GRAVITY_SCALE] = 0 }, nil, root())
  look(spinner)
  local mark = add("Group", { x = 20 }, nil, spinner)
  -- A scripted body: move() turns it by its spin.
  local mover = add("Body", { x = 200, y = 100 })
  look(mover)
  -- A wheel on a pin with a motor, and one that stops at a limit.
  local wheel = add("Body", { name = "Wheel", x = 300, y = 100, motion = "physics", [GRAVITY_SCALE] = 0 })
  look(wheel)
  local pin = add("Joint", { x = 300, y = 100, a = "Wheel", motor = true, motorSpeed = QUARTER })
  local stopped = add("Body", { name = "Stopped", x = 400, y = 100, motion = "physics", [GRAVITY_SCALE] = 0 })
  look(stopped)
  local limited = add("Joint", { x = 400, y = 100, a = "Stopped", motor = true, motorSpeed = QUARTER, limit = true,
    minAngle = -QUARTER / 9, maxAngle = QUARTER / 9 })
  -- Gravity: one falls, one floats, and one sets the name the other rules
  -- use, which is nothing to this project's physics.
  local faller = add("Body", { x = 100, y = 200, motion = "physics" })
  look(faller)
  local floater = add("Body", { x = 200, y = 200, motion = "physics", [GRAVITY_SCALE] = 0 })
  look(floater)
  local other = add("Body", { x = 300, y = 200, motion = "physics", [OTHER_NAME] = 0 })
  look(other)

  physics(3)
  spinner.spin = QUARTER
  mover.spin = QUARTER
  local spinFrom, moverFrom, wheelFrom = spinner.rotation, mover.rotation, wheel.rotation
  moving = mover
  local n = physics(30)
  moving = nil
  local seconds = n / 60

  local turned = spinner.rotation - spinFrom
  check(if NEW then "spin is degrees a second" else "old: spin is radians a second", near(turned, QUARTER * seconds, QUARTER * 0.06), turned)
  check("spin reads back in the same unit", near(spinner.spin, QUARTER, QUARTER * 0.01), spinner.spin)
  -- What the body really did: the mark went an eighth of a turn round it.
  local mx, my = mark:worldPosition()
  local real = math.atan2(my - spinner.y, mx - spinner.x)
  check("the body really turned that far", near(real, math.pi / 2 * seconds, 0.1), real)
  local moved = mover.rotation - moverFrom
  check("move() turns a scripted body by its spin", near(moved, QUARTER * seconds, QUARTER * 0.06), moved)

  local angle = pin:getAngle()
  check(if NEW then "a motor's speed is degrees a second" else "old: a motor's speed is radians a second",
    near(wheel.rotation - wheelFrom, QUARTER * seconds, QUARTER * 0.15), wheel.rotation - wheelFrom)
  -- (Since the joint was made, when the wheel hadn't turned.)
  check("getAngle() is in the same unit", near(angle, wheel.rotation, QUARTER * 0.03), angle .. " " .. wheel.rotation)
  check("getSpeed() is in the same unit", near(pin:getSpeed(), QUARTER, QUARTER * 0.1), pin:getSpeed())
  check("maxAngle stops a pin", near(stopped.rotation, QUARTER / 9, QUARTER / 9 * 0.25) and near(limited:getAngle(), QUARTER / 9, QUARTER / 9 * 0.25), stopped.rotation)

  check(if NEW then "gravityScale = 0 floats" else "old: gravity = 0 floats", faller.y > 220 and near(floater.y, 200, 1), faller.y .. " " .. floater.y)
  check(if NEW then "gravity is no property of a Body" else "old: gravityScale is no property of a Body", other.y > 220, other.y)
  local plain = make("Body")
  check(if NEW then "a Body's gravityScale is 1" else "old: a Body's gravity is 1", plain[GRAVITY_SCALE] == 1 and plain[OTHER_NAME] == nil)

  -- gravity as a script's own variable.
  local jumper = add("Body", { x = -300, y = -300, motion = "still" }, "scripts/jumper.lua")
  check("jumpSpeed() uses the script's gravity", near(jumper:leap(), 600), jumper:leap())
  local low = add("Body", { x = -300, y = -400, motion = "still" }, "scripts/lowjump.lua")
  if NEW then
    check("gravity = 8 is the script's too", near(low:leap(), 40) and low.gravity == 8 and low.gravityScale == 1, low:leap())
  else
    check("old: a small gravity is the Body's, not the script's", near(low:leap(), 600) and low.gravity == 8, low:leap())
  end
end

---------------------------------------------------------------------------
-- 3. Scene files say which rules they were saved with.

local function scenes()
  local old = make("scenes/old.scene")
  local body, dust, pin, rail = old:find("Body"), old:find("Dust"), old:find("Pin"), old:find("Rail")
  if NEW then
    check("an old scene's angles become degrees", old.rotation == 90 and near(body.spin, 180, 0.0001) and near(body.slope, 57.29578, 0.00001)
      and near(pin.minAngle, 28.64789 * -1, 0.00001), old.rotation .. " " .. body.spin .. " " .. body.slope .. " " .. pin.minAngle)
    check("an old scene's gravity becomes gravityScale", body.gravityScale == 0.5 and body.gravity == nil, tostring(body.gravityScale))
    check("a big gravity stays the script's variable", old:find("Scripted").gravity == 1800 and old:find("Scripted").gravityScale == 1)
    check("an old scene keeps its old defaults", near(dust.spread, 28.64789, 0.00001) and dust.direction == -90
      and near(pin.motorSpeed, 114.591559, 0.00001) and rail.motorSpeed == 2 and body.slope ~= 45, dust.spread .. " " .. pin.motorSpeed .. " " .. rail.motorSpeed)
  else
    check("old: an old scene is read as it is", old.rotation == 1.5708 and body.spin == 3.14159265 and body.slope == 1 and pin.minAngle == -0.5
      and body.gravity == 0.5 and old:find("Scripted").gravity == 1800 and dust.spread == 0.5 and pin.motorSpeed == 2 and rail.motorSpeed == 2,
      old.rotation .. " " .. body.spin .. " " .. tostring(body.gravity))
  end

  local new = make("scenes/new.scene")
  body, dust, pin, rail = new:find("Body"), new:find("Dust"), new:find("Pin"), new:find("Rail")
  if NEW then
    check("a new scene is read as it is", new.rotation == 90 and body.spin == 180 and body.slope == 60 and pin.minAngle == -30
      and body.gravityScale == 0.5 and dust.spread == 30 and pin.motorSpeed == 90 and rail.motorSpeed == 90, new.rotation .. " " .. body.spin)
  else
    check("old: a new scene's angles become radians", near(new.rotation, math.pi / 2, 1e-9) and near(body.spin, math.pi, 1e-9)
      and near(body.slope, math.pi / 3, 1e-9) and near(pin.minAngle, -math.pi / 6, 1e-9), new.rotation .. " " .. body.spin)
    check("old: a new scene's gravityScale becomes gravity", body.gravity == 0.5 and body.gravityScale == nil)
    check("old: a new scene keeps its new defaults", near(dust.spread, math.pi / 6, 1e-9) and near(pin.motorSpeed, math.pi / 2, 1e-9)
      and rail.motorSpeed == 90, dust.spread .. " " .. pin.motorSpeed .. " " .. rail.motorSpeed)
  end
end

---------------------------------------------------------------------------
-- 4. A Button's event: clicked() in version 3, pressed() before.

local function buttons()
  local new = add("Button", { x = 20, y = 20, width = 100, height = 40 }, "scripts/button.lua")
  local old = add("Button", { x = 140, y = 20, width = 100, height = 40 }, "scripts/oldbutton.lua")
  local heard = { clicked = 0, pressed = 0, touched = 0, untouched = 0, released = 0 }
  new:on("clicked", function() heard.clicked += 1 end)
  new:on("pressed", function() heard.pressed += 1 end)
  local panel = add("Panel", { x = 260, y = 20, width = 100, height = 40 })
  local panelHeard = { clicked = 0, pressed = 0 }
  panel:on("clicked", function() panelHeard.clicked += 1 end)
  panel:on("pressed", function() panelHeard.pressed += 1 end)
  local finger = add("TouchButton", { x = 380, y = 20, width = 60, height = 60, show = "always", action = "" })
  finger:on("touched", function() heard.touched += 1 end)
  finger:on("untouched", function() heard.untouched += 1 end)
  finger:on("released", function() heard.released += 1 end)
  frame(2)

  click(70, 40)
  click(190, 40)
  click(310, 40)
  click(410, 50)
  if NEW then
    check("a Button's script gets clicked()", new.clicks == 1, new.clicks)
    check("on(\"clicked\") hears a Button", heard.clicked == 1 and heard.pressed == 0, heard.clicked .. " " .. heard.pressed)
    check("a Button doesn't call pressed()", old.presses == 0, old.presses)
    check("a Panel sends clicked", panelHeard.clicked == 1 and panelHeard.pressed == 0)
    check("a TouchButton sends touched and untouched", heard.touched == 1 and heard.untouched == 1 and heard.released == 0,
      heard.touched .. " " .. heard.untouched .. " " .. heard.released)
  else
    check("old: a Button's script gets pressed()", old.presses == 1, old.presses)
    check("old: on(\"pressed\") hears a Button", heard.pressed == 1 and heard.clicked == 0, heard.clicked .. " " .. heard.pressed)
    check("old: a Button doesn't call clicked()", new.clicks == 0, new.clicks)
    check("old: a Panel sends pressed", panelHeard.pressed == 1 and panelHeard.clicked == 0)
    check("old: a TouchButton sends pressed and released", heard.released == 1 and heard.touched == 0 and heard.untouched == 0,
      heard.touched .. " " .. heard.untouched .. " " .. heard.released)
  end
  -- In a Button's script, pressed("accept") asks about input.
  check("pressed(\"accept\") in a Button's script is the input call", new:accepting() == false, tostring(new:accepting()))
  smitten.input.press("accept")
  local held = new:accepting()
  smitten.input.release("accept")
  check("... and true when accept is pressed", held == true, tostring(held))
end

---------------------------------------------------------------------------
-- 5. Names a script never declared.

local function names()
  local piece = find("Named")
  local ok, err = pcall(piece.declared, piece)
  check("declared names can be set in a function", ok and piece.score == 1 and piece.target == "x" and piece.vx == 3
    and piece.fromInspector == 6 and piece.fresh == 2, err)
  ok, err = pcall(piece.cleared, piece)
  check("a name set to nil stays declared", ok and piece.target == "again" and piece.fromInspector == 7, err)
  ok, err = pcall(piece.typo, piece)
  err = tostring(err)
  if NEW then
    check("an undeclared name is an error", not ok and piece.scroe == nil, err)
    check("the error is in plain words", err:find('there\'s no variable called "scroe" here', 1, true) ~= nil, err)
    check("the error has a did-you-mean", err:find('(did you mean "score"?)', 1, true) ~= nil, err)
    check("the error says how to make one", err:find("write scroe = 0 at the top of the script", 1, true) ~= nil, err)
    check("the error names the line", err:find("^scripts/names.lua:19: ") ~= nil, err)
    check("the error keeps the engine out of it", not err:find("script.lua", 1, true) and not err:find("[love", 1, true), err)
    -- Without a near name, no guess.
    local other = make("Group", {}, "scripts/jumper.lua")
    local fine, why = pcall(function() other.gravity = 5 end)
    check("self.name = ... is always allowed", fine and other.gravity == 5, why)
  else
    check("old: an undeclared name makes a new variable", ok and piece.scroe == 5, err)
  end
end

---------------------------------------------------------------------------

local run, finished

local function all()
  stage = find("Stage")
  frame()
  for _, part in ipairs({ { "angles", angles }, { "bodies", bodies }, { "scenes", scenes }, { "buttons", buttons }, { "names", names } }) do
    local ok, err = pcall(part[2])
    if not ok then check("the " .. part[1] .. " checks stopped", false, err) end
  end
  print("RULES " .. (NEW and "new" or "old"))
  print(`DONE {passed} passed, {failed} failed`)
  finished = true
end

function physicsUpdate(dt)
  steps += 1
  if moving then moving:move() end
end

function update(dt)
  if not run then run = coroutine.wrap(all) end
  if not finished then run() end
end
