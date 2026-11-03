local Main = {}

function Main:ready()
  self.ticks, self.coins = 0, 0
  local player = self:find("Player")
  print("ready", self.name, player.type, player.motion, smitten == love, smitten.version, player:getSize())
  self:find("Tick"):on("tick", function() self.ticks += 1 end)
  self:find("UI/Restart"):on("pressed", function() smitten.scene.reload() end)
  local spawned = smitten.scene.spawn("Shape", { x = 500, y = 200, shape = "circle", radius = 6 })
  print("spawned", spawned.type, #smitten.scene.tagged("coin"))
end

function Main:collected(item)
  self.coins += 1
  print("coin collected")
end

function Main:update(dt)
  local player = self:find("Player")
  self:find("UI/Score").text = `Coins: {self.coins}  ticks: {self.ticks}  ground: {player:onGround()}`
end

function Main:physicsUpdate(dt)
  -- Walk right for the test, as if holding the right action.
  local player = self:find("Player")
  if player:onGround() then player.vx = 80 end
end

return Main
