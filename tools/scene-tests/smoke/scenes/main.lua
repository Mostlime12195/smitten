-- The smoke test's root: counts coins and ticks, and tries the script API.
-- (scripts/spin.lua stays in the old style, to check that it still works.)

local ticks, coins = 0, 0
step = "start"

function score() return coins end

function ready()
  print("ready", name, Player.type, Player.motion, smitten == love, smitten.version, Player:getSize())
  Tick:on("tick", function() ticks += 1 end)
  find("UI/Restart"):on("pressed", function() reload() end)
  local spawned = spawn("Shape", { x = 500, y = 200, shape = "circle", radius = 6 })
  print("spawned", spawned.type, spawned.parent == self, #tagged("coin"), Coin:is("coin"), Coin:is("Zone"), Coin:is("enemy"))
  print("api", clamp(5, 0, 3), sign(-2), round(2.6), lerp(0, 10, 0.5), choose(7), dist(0, 0, 3, 4), screenWidth(), rnd({ "only" }))
  print("own function", score(), self:score())
  after(0.3, function() print("after 0.3", step) end)
  wait(0.5)
  step = "waited"
  print("ready went on after wait(0.5)")
end

function collected(item)
  coins += 1
  print("coin collected", item.name, score())
end

function update(dt)
  find("UI/Score").text = `Coins: {coins}  ticks: {ticks}  ground: {Player:onGround()}`
end

function physicsUpdate(dt)
  -- Walk right for the test, as if holding the right action.
  if Player:onGround() then Player.vx = 80 end
end

function draw()
  pen("#ff4060")
  rect(4, 340, 12, 12)
  circle(30, 346, 6, false)
  write(step, 44, 338)
end
