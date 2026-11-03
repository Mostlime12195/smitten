-- Playing a level: the map, the player, coins, the goal and the camera.

local Player = require("entities.player")
local Coin = require("entities.coin")
local Goal = require("entities.goal")

local Game = {}

function Game:enter()
  self.level = smitten.map("maps/level1")
  self.entities = self.level:spawn({ player = Player, coin = Coin, goal = Goal })
  self.coins, self.collected = 0, 0
  for _, e in ipairs(self.entities) do
    if getmetatable(e) == Player then self.player = e end
    if getmetatable(e) == Coin then self.coins += 1 end
  end
  self.time = 0
  self.won = false
  self.camera = 0
end

function Game:update(dt)
  if self.won then
    self.wonTime += dt
    if self.wonTime > 1 and smitten.input.pressed("start") then
      smitten.scene.switch(require("scenes.title"))
    end
    return
  end
  self.time += dt

  for _, e in ipairs(self.entities) do
    if e.update then e:update(dt, self) end
  end
  for i = #self.entities, 1, -1 do
    if self.entities[i].removed then table.remove(self.entities, i) end
  end

  -- Follow the player, without showing past the map's edges.
  local w = smitten.screen.width
  local target = self.player.x + self.player.width / 2 - w / 2
  self.camera = math.max(0, math.min(target, self.level.pixelWidth - w))
end

function Game:collect(coin)
  coin.removed = true
  self.collected += 1
  smitten.sfx("sfx/coin"):play()
end

function Game:win()
  if self.won then return end
  self.won, self.wonTime = true, 0
  smitten.song("music/theme"):stop()
  smitten.sfx("sfx/win"):play()
end

function Game:draw()
  smitten.screen.begin()
  love.graphics.clear(0.25, 0.65, 0.96)

  love.graphics.push()
  love.graphics.translate(-math.floor(self.camera), smitten.screen.height - self.level.pixelHeight)
  self.level:draw()
  for _, e in ipairs(self.entities) do
    if e.draw then e:draw() end
  end
  love.graphics.pop()

  -- Score and time.
  local hud = `Coins {self.collected}/{self.coins}   Time {("%.1f"):format(self.time)}`
  love.graphics.setColor(0.1, 0.11, 0.17)
  love.graphics.print(hud, 7, 7)
  love.graphics.setColor(1, 1, 1)
  love.graphics.print(hud, 6, 6)

  if self.won then
    local w = smitten.screen.width
    love.graphics.setColor(0.1, 0.11, 0.17, 0.75)
    love.graphics.rectangle("fill", 0, 60, w, 56)
    love.graphics.setColor(1, 1, 1)
    love.graphics.printf("You made it!", 0, 68, w, "center")
    love.graphics.printf(`{self.collected} of {self.coins} coins in {("%.1f"):format(self.time)} seconds`, 0, 84, w, "center")
    if self.wonTime > 1 then love.graphics.printf("Press Space", 0, 100, w, "center") end
  end
  smitten.screen.finish()
end

return Game
