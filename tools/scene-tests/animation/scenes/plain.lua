-- The second half of the animation test: a scene with no Animator. No
-- Animator runs (main.lua counts their steps in game.animatorSteps), and
-- the pieces keep the values the file gives them. Prints DONE for both.

local frames = 0
local ticks = 0

local function check(name, ok, why)
  if ok then
    game.passed += 1
    print("PASS " .. name)
  else
    game.failed += 1
    print("FAIL " .. name .. ": " .. tostring(why or "not so"))
  end
end

function ready()
  game.animatorSteps = 0
  Clock:on("tick", function() ticks += 1 end)
end

function update(dt)
  frames += 1
  if frames ~= 40 then return end
  check("a scene without Animators runs no Animator", game.animatorSteps == 0, game.animatorSteps)
  check("its pieces keep their values", Box.x == 40 and Box.y == 50 and Box.rotation == 30 and Words.text == "still"
    and Box.color[1] == 0 and Box.color[2] == 1, `{Box.x} {Box.rotation} {Words.text}`)
  check("and the rest goes on as before (a Timer ticks)", ticks > 0, ticks)
  print(`DONE {game.passed} passed, {game.failed} failed`)
end
