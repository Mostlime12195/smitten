local Main = {}

Main.speedLimit = 10

function Main:ready()
  self.ticks = 0
  self.coins = 0
  print("ready", self.name, self:find("Player").type, smitten == love, smitten.version)
  self:find("Tick"):on("timeout", function() self.ticks += 1 end)
  self:find("UI/Restart"):on("pressed", function() smitten.scene.reload() end)
  local player = self:find("Player")
  player:on("entered", function(area)
    if area:inGroup("coins") then
      self.coins += 1
      area:destroy()
      print("coin collected")
    end
  end)
end

function Main:update(dt)
  local player = self:find("Player")
  self:find("UI/Score").text = `Coins: {self.coins}  ticks: {self.ticks}  floor: {player:isOnFloor()}`
  -- Walk right automatically so the test picks up the coin.
  if smitten.timer.getTime() > 0 then player.x += 60 * dt end
end

return Main
