-- Checks Animators (docs/animation.md): values between keys, step keys,
-- colors, rotation in degrees (a version 3 project), loops, seek(), speed,
-- call keys (once each pass, in order, also across a big step), finished,
-- animate() in a task, an Animator inside a placed scene, autoplay and
-- pausing, and then that a scene without Animators runs as it always did
-- (scenes/plain.lua). Prints PASS or FAIL for each check, then DONE
-- (tools/scene-tests/run.mjs reads them).

local nodes2d = require("love.scene.nodes2d")
local keyframes = require("love.scene.keyframes")
local Animator = require("love.scene.node").classes.Animator
local g = smitten.graphics

game.passed = 0
game.failed = 0
game.animatorSteps = 0
game.clock = 0
game.lastDt = 0

local function check(name, ok, why)
  if ok then
    game.passed += 1
    print("PASS " .. name)
  else
    game.failed += 1
    print("FAIL " .. name .. ": " .. tostring(why or "not so"))
  end
end

local function near(a, b, tolerance)
  return type(a) == "number" and math.abs(a - b) <= (tolerance or 1e-6)
end

local function show(v)
  if type(v) ~= "table" then return tostring(v) end
  local parts = {}
  for i = 1, #v do parts[i] = show(v[i]) end
  return "{" .. table.concat(parts, ", ") .. "}"
end

local function same(a, b)
  if type(a) == "number" and type(b) == "number" then return math.abs(a - b) < 1e-9 end
  if type(a) == "table" and type(b) == "table" then
    if #a ~= #b then return false end
    for i = 1, #a do
      if not same(a[i], b[i]) then return false end
    end
    return true
  end
  return a == b
end

-- Waits for the next frame (the Driver resumes this once a frame).
local function frame(n)
  for i = 1, n or 1 do coroutine.yield() end
end

---------------------------------------------------------------------------
-- 1. The engine's keyframes.lua against the cases the editor's copy is
-- checked with (keyframe-cases.json).

local function shared()
  local fixture = smitten.assets.readJSON("keyframe-cases.json")
  local bad, count = nil, 0
  for _, case in ipairs(fixture.tracks) do
    local keys = keyframes.sorted(case.keys)
    for i, t in ipairs(case.times) do
      count += 1
      local v = keyframes.sample(keys, t)
      if not same(v, case.expect[i]) and not bad then bad = `{case.name} at {t}: {show(v)}, wanted {show(case.expect[i])}` end
    end
  end
  check(`the shared keyframe cases ({count} values)`, bad == nil, bad)
  bad, count = nil, 0
  for _, case in ipairs(fixture.calls) do
    local list = keyframes.sorted(case.calls)
    for i, r in ipairs(case.ranges) do
      count += 1
      local first, last = keyframes.callRange(list, r[1], r[2], r[3])
      local ids = {}
      local step = if r[1] <= r[2] then 1 else -1
      for k = first, last, step do ids[#ids + 1] = list[k].id end
      if not same(ids, case.expect[i]) and not bad then bad = `{case.name} {r[1]}..{r[2]}: {table.concat(ids, ",")}` end
    end
  end
  check(`the shared call key cases ({count} ranges)`, bad == nil, bad)
end

---------------------------------------------------------------------------
-- 2. A door made from its scene but not added to the running scene, so
-- this script moves its Animator on by exact steps.

local function door()
  local d = make("scenes/door.scene")
  local anim, panel, label = d:find("Anim"), d:find("Panel"), d:find("Label")
  check("an Animator from a scene file", anim ~= nil and anim:isA("Animator") and anim:hasAnimation("open") and anim:hasAnimation("swing"))
  check("getLength()", anim:getLength("open") == 0.5 and anim:getLength("swing") == 1)
  check("nothing plays without autoplay", anim.playing == false and anim.current == "" and panel.y == 0)

  anim:play("open")
  check("play()", anim.playing and anim.current == "open" and anim.position == 0)
  check("no call key runs before the first step", d.creaks == "", d.creaks)
  anim:_process(0.125)
  anim:_process(0.125)
  -- outQuad halfway is 0.75 of the way.
  check("an eased key halfway", near(panel.y, -48), panel.y)
  check("a linear key halfway", near(panel.x, 5), panel.x)
  check("a color halfway", same(panel.color, { 0.5, 0, 0.5, 1 }), show(panel.color))
  check("rotation in degrees halfway", near(panel.rotation, 45), panel.rotation)
  check("a word steps at its key", label.text == "opening", label.text)
  check("a true stays until the next key", panel.visible == true)
  check("call keys at 0 and 0.25, in order", d.creaks == "start,middle", d.creaks)

  -- What that looks like: the Shape is drawn in the animated color.
  local canvas = g.newCanvas(120, 120, { dpiscale = 1 })
  d.x, d.y = 60, 100
  g.push("all")
  g.setCanvas(canvas)
  g.setScissor()
  g.origin()
  g.clear(0, 0, 0, 1)
  nodes2d.render(d)
  g.pop()
  local r, gr, b = g.readbackTexture(canvas):getPixel(65, 52)
  check("the piece is drawn in the animated color", near(r, 0.5, 0.03) and near(gr, 0, 0.03) and near(b, 0.5, 0.03), `{r} {gr} {b}`)

  local finished = {}
  anim:on("finished", function(name) finished[#finished + 1] = name end)
  anim:_process(0.3)
  check("it ends at its length", anim.playing == false and anim.position == 0.5)
  check("the end values", near(panel.y, -64) and near(panel.rotation, 90) and label.text == "open" and panel.visible == false)
  check("finished is sent once, with the name", #finished == 1 and finished[1] == "open", #finished)
  check("the key at the end runs once", d.creaks == "start,middle,end", d.creaks)
  anim:_process(0.3)
  check("nothing more after the end", #finished == 1 and d.creaks == "start,middle,end")

  anim:seek(0.1)
  check("seek()", near(panel.y, -64 * 0.2 * 1.8) and near(anim.position, 0.1), panel.y)
  check("seek() runs no call keys", d.creaks == "start,middle,end", d.creaks)
  anim:stop()
  check("stop() puts the pieces back", panel.y == 0 and panel.rotation == 0 and label.text == "closed" and anim.playing == false)

  anim.speed = 2
  anim:play("open", true)
  anim:_process(0.125)
  check("speed 2", near(panel.y, -48), panel.y)
  anim.speed = -1
  anim:_process(0.0625)
  check("speed -1 plays backwards", near(anim.position, 0.1875), anim.position)
  anim.speed = 1

  d.creaks = ""
  anim:play("swing")
  d.rotation = 99
  anim:_process(0.25)
  check("a loop: inOutSine halfway to its key", near(d.rotation, 15), d.rotation)
  check("a loop: the parent itself is \".\"", d.rotation ~= 99)
  anim:_process(1)
  check("a loop wraps", near(anim.position, 0.25) and near(d.rotation, 15), anim.position)
  check("a call key runs once a pass", d.creaks == "swing", d.creaks)
  anim:_process(2)
  check("a step of two passes runs it twice", d.creaks == "swing,swing,swing", d.creaks)
  check("a loop never finishes", anim.playing and #finished == 1)
  anim:pause()
  anim:_process(0.5)
  check("pause()", near(anim.position, 0.25) and not anim.playing)
  anim:play()
  anim:_process(0.25)
  check("play() goes on after pause()", near(anim.position, 0.5), anim.position)
end

---------------------------------------------------------------------------
-- 3. In the running scene: animate() in a task, an Animator inside a placed
-- scene, autoplay, pausing.

local function running()
  local doorA, doorB = find("DoorA"), find("DoorB")
  local anim = doorA:find("Anim")
  local heard = {}
  anim:on("finished", function(name) heard[#heard + 1] = name end)
  local result = {}
  -- The Animator moves on in this frame too, after this: by game.lastDt.
  task(function()
    local t0 = game.clock - game.lastDt
    result.ok = anim:animate("open")
    result.seconds = game.clock - t0
    result.lastDt = game.lastDt
    result.y = doorA:find("Panel").y
    result.playing = anim.playing
  end)
  local frames = 0
  while result.ok == nil and frames < 600 do
    frame()
    frames += 1
  end
  check("animate() goes on after the end", result.ok == true, tostring(result.ok))
  check("animate() waits for the length of the animation", type(result.seconds) == "number" and result.seconds >= 0.5 - 1e-6
    and result.seconds < 0.5 + result.lastDt + 1e-6, result.seconds)
  check("when it goes on, the pieces are at the end", near(result.y, -64) and result.playing == false, result.y)
  check("finished in the running scene", #heard == 1 and heard[1] == "open")
  check("call keys in the running scene", doorA.creaks == "start,middle,end", doorA.creaks)
  check("the other copy of the placed scene does not move", doorB:find("Panel").y == 0 and doorB.creaks == "", doorB.creaks)

  -- A task that waits while the animation is stopped goes on with false.
  local stopped = nil
  task(function() stopped = anim:animate("open", true) end)
  anim:stop()
  check("stop() ends animate() with false", stopped == false, tostring(stopped))
  local ok, err = pcall(function() anim:animate("open") end)
  check("animate() outside a task says where it works", not ok and tostring(err):find("tasks", 1, true) ~= nil, err)

  local spinner, spin = find("Spinner"), find("Spinner"):find("Spin")
  check("autoplay", spin.playing and spin.current == "turn")
  local before = spinner.rotation
  frame(5)
  check("autoplay moves on every frame", spinner.rotation ~= before and spinner.rotation > 0 and spinner.rotation < 360, spinner.rotation)
  pauseGame()
  frame(2)
  local paused = spinner.rotation
  frame(5)
  check("a paused game pauses Animators", spinner.rotation == paused, spinner.rotation)
  resumeGame()
  frame(3)
  check("and they go on after", spinner.rotation ~= paused)
end

---------------------------------------------------------------------------

local run, finished

local function all()
  frame()
  for _, part in ipairs({ { "shared", shared }, { "door", door }, { "running", running } }) do
    local ok, err = pcall(part[2])
    if not ok then check("the " .. part[1] .. " checks stopped", false, err) end
  end
  -- Then a scene without Animators: no Animator runs, and its pieces keep
  -- the values the file gives them (scenes/plain.lua checks, and prints DONE).
  local process, physics = Animator._process, Animator._physics
  Animator._process = function(self, dt)
    game.animatorSteps += 1
    return process(self, dt)
  end
  Animator._physics = function(self, h)
    game.animatorSteps += 1
    return physics(self, h)
  end
  finished = true
  go("scenes/plain.scene")
end

-- The Driver (scripts/driver.lua) runs while the game is paused too, and
-- moves the checks on once a frame.
game.step = function()
  if not run then run = coroutine.wrap(all) end
  if not finished then run() end
end
