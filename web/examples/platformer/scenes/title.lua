-- The title screen.

local Title = {}

function Title:enter()
  self.time = 0
  local theme = smitten.song("music/theme")
  if not theme:isPlaying() then theme:play() end
end

function Title:update(dt)
  self.time += dt
  if smitten.input.pressed("start") then
    smitten.scene.switch(require("scenes.game"))
  end
end

function Title:draw()
  smitten.screen.begin()
  love.graphics.clear(0.25, 0.65, 0.96)
  local w = smitten.screen.width

  -- The hero bobbing in the middle of the screen.
  local hero = smitten.sprite("sprites/player")
  local frame = math.floor(self.time * 3) % 2
  hero:draw(frame, w / 2, 112, 0, 2, 2)

  love.graphics.setColor(0.1, 0.11, 0.17)
  love.graphics.printf("PIXEL PLATFORMER", 0, 41, w, "center")
  love.graphics.setColor(1, 1, 1)
  love.graphics.printf("PIXEL PLATFORMER", 0, 40, w, "center")
  if self.time % 1 < 0.65 then
    love.graphics.printf("Press Space to start", 0, 140, w, "center")
  end
  smitten.screen.finish()
end

return Title
