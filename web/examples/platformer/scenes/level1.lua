-- The level's script: score, time and winning. The player, the coins and
-- the goal are objects placed in level1.scene.json.

local Level = {}

function Level:enter()
  self.coins = #smitten.all("coin")
  self.time = 0
  self.won = false
end

function Level:win() -- called by the goal
  if self.won then return end
  self.won = true
  smitten.find("player").controls = false -- stop running
  smitten.song("music/theme"):stop()
  smitten.sfx("sfx/win"):play()
  smitten.after(1, function() self.canLeave = true end)
end

function Level:update(dt)
  if not self.won then self.time += dt end
  if self.canLeave and (smitten.input.pressed("jump") or smitten.input.pressed("start")) then
    smitten.scene.go("title")
  end
end

function Level:draw() -- on top of everything, in screen pixels
  local collected = self.coins - #smitten.all("coin")
  local seconds = ("%.1f"):format(self.time)
  local hud = `Coins {collected}/{self.coins}   Time {seconds}`
  smitten.print(hud, 7, 7, 1) -- a dark shadow first
  smitten.print(hud, 6, 6, 13)
  if self.won then
    love.graphics.setColor(smitten.color(1, 0.75))
    love.graphics.rectangle("fill", 0, 60, smitten.screen.width, 56)
    smitten.printCentered("You made it!", 68, 13)
    smitten.printCentered(`{collected} of {self.coins} coins in {seconds} seconds`, 84, 13)
    if self.canLeave then smitten.printCentered("Press Space", 100, 13) end
  end
end

return Level
