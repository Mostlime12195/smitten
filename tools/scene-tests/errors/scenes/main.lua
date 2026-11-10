-- Checks what the engine says when a script goes wrong: errors in plain
-- words with a "did you mean", tracebacks without the engine's own lines,
-- and the guard for a function named like one of the piece's methods.
-- Prints PASS or FAIL for each check, then DONE (tools/scene-tests/run.mjs
-- reads them).

local errors = require("love.engine.errors")
local passed, failed, ran = 0, 0, false

score = 0

local function has(name, got, want)
  if type(got) == "string" and got:find(want, 1, true) then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. ": wanted " .. want .. " in: " .. tostring(got))
  end
end

local function hasnt(name, got, bad)
  if type(got) == "string" and not got:find(bad, 1, true) then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. ": didn't want " .. bad .. " in: " .. tostring(got))
  end
end

-- What the error screen would show for an error in fn: the message, then
-- the traceback's lines.
local function shown(fn)
  local _, text = xpcall(fn, function(msg)
    local message, frames = errors.report(msg, debug.traceback("", 2))
    return message .. "\n" .. table.concat(frames, "\n")
  end)
  return text
end

local function checks()
  local text = shown(function() local a = scroe + 1 end)
  has("typo: where", text, "scenes/main.lua:")
  has("typo: plain words", text, '"scroe" has no value here')
  has("typo: did you mean", text, '(did you mean "score"?)')
  hasnt("typo: no Lua wording", text, "attempt to")
  hasnt("typo: no engine frames", text, "[smitten")
  hasnt("typo: no internal name", text, "[love")
  hasnt("typo: no C frames", text, "[C]")

  text = shown(function() fnd("Look") end)
  has("call: plain words", text, 'there\'s no function called "fnd" here')
  has("call: did you mean", text, '(did you mean "find"?)')

  text = shown(function() local a = Lok.x end)
  has("child: did you mean", text, '(did you mean "Look"?)')

  text = shown(function() local a = qqzzyy + 1 end)
  has("unknown: what to do", text, "Give it a value first, like qqzzyy = 0")

  -- An error in a task (ready(), events, task()) comes with its own frames.
  local ok, err = pcall(task, function() local a = scroe + 1 end)
  has("task: plain words", err, '"scroe" has no value here')
  has("task: did you mean", err, '(did you mean "score"?)')
  has("task: its own frame", err, "\tscenes/main.lua:")
  hasnt("task: no engine frames", err, "[smitten")

  -- Other errors are left as they are.
  text = shown(function() error("my own error") end)
  has("own error kept", text, "my own error")

  -- A function named like a method of the piece.
  ok, err = pcall(make, "Body", {}, "scripts/shadow.lua")
  has("method: refused", tostring(ok), "false")
  has("method: says which", err, "every Body already has move()")
  has("method: where", err, "scripts/shadow.lua:4:")
  ok, err = pcall(make, "Sprite", {}, "scripts/shadow-play.lua")
  has("method: Sprite play()", err, "every Sprite already has play()")
  -- move() is no method of a Sprite, and events are the script's to define.
  ok, err = pcall(make, "Sprite", {}, "scripts/shadow.lua")
  has("method: free name on another type", tostring(ok), "true")
  ok, err = pcall(make, "Body", {}, "scripts/events.lua")
  has("method: events allowed", tostring(ok) .. tostring(err), "true")

  -- jumpSpeed() uses the script's fallGravity; a script of before, with a
  -- big gravity, still works.
  local p = make("Body", {}, "scripts/jumper.lua")
  has("jumpSpeed: fallGravity", tostring(p.speedNow), "400")
  p = make("Body", {}, "scripts/jumper-old.lua")
  has("jumpSpeed: old gravity", tostring(p.speedNow), "400")
  p = make("Body", {}, "scripts/jumper-plain.lua")
  has("jumpSpeed: default", tostring(p.speedNow), "600")
end

function update(dt)
  if ran then return end
  ran = true
  local ok, err = pcall(checks)
  if not ok then
    failed += 1
    print("FAIL the checks stopped: " .. tostring(err))
  end
  print(`DONE {passed} passed, {failed} failed`)
end
