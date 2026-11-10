-- The start of every check script in this folder: run.mjs puts it before
-- the checks of one example, and puts the result on a Group at the start of
-- the main scene of the example. Each check script fills `steps` with
-- { time, function } pairs. update() calls each function at its time (in
-- seconds of game time), and the last step prints DONE. setup() (in the
-- check script) finds the pieces, in the first frame. onPhysics(dt), if
-- the check script has it, runs in each physics step.

local passed, failed = 0, 0
local t, at = 0, 1
local steps = {}
local releaseNext = {}
local started = false

local function check(what, ok, detail)
  if ok then
    passed += 1
    print("PASS " .. what)
  else
    failed += 1
    print("FAIL " .. what .. (if detail ~= nil then ": " .. tostring(detail) else ""))
  end
end

local function done()
  print(("DONE %d passed, %d failed"):format(passed, failed))
end

-- A press for one frame. The press comes in the next physics step, before
-- all the pieces update, so all of them see pressed() in that frame. The
-- release comes one frame later.
local taps = {}
local updates = 0

local function tap(action, player)
  taps[#taps + 1] = { action, player }
end

function physicsUpdate(dt)
  for i = 1, #taps do
    smitten.input.press(taps[i][1], taps[i][2])
    releaseNext[#releaseNext + 1] = { taps[i][1], taps[i][2], updates }
    taps[i] = nil
  end
  if onPhysics then onPhysics(dt) end
end

local function near(a, b, within)
  return math.abs(a - b) <= (within or 0.5)
end

function update(dt)
  -- The first frame: all the pieces of the scene are there now.
  if not started then
    started = true
    setup()
  end
  updates += 1
  for i = #releaseNext, 1, -1 do
    if releaseNext[i][3] < updates - 1 then
      smitten.input.release(releaseNext[i][1], releaseNext[i][2])
      table.remove(releaseNext, i)
    end
  end
  -- A slow frame (the first frames load the game) counts as a short one,
  -- and one step runs in each frame: the steps keep their order and their
  -- distance from each other.
  t += math.min(dt, 1 / 30)
  -- A step that returns false waits for something: it runs again in the
  -- next frame, for 10 seconds at most.
  -- The next step waits until a tap is pressed and released.
  local step = steps[at]
  if step and t >= step[1] and #taps == 0 and #releaseNext == 0 then
    if step[2]() ~= false then
      at += 1
    elseif t > step[1] + 10 then
      check(("step %d: what it waits for comes in 10 seconds"):format(at), false)
      at += 1
    end
  end
end

