-- Pixel Platformer: a Smitten example.
--
-- Arrow keys or A/D to run, Space or Z to jump (or a gamepad). Collect the
-- coins and reach the flag.
--
-- Everything here was made in Smitten: open sprites/player.png to draw,
-- scenes/level1.scene.json to change the level, objects/player.lua to tune
-- the jump, sfx/*.sfx.json for sounds and music/theme.song.json for music.
--
-- This is the title screen: a scene that's only a script.

local Title = {}
Title.background = 11 -- palette color 11: sky blue

function Title:enter()
  self.time = 0
  local theme = smitten.song("music/theme")
  if not theme:isPlaying() then theme:play() end
end

function Title:update(dt)
  self.time += dt
  if smitten.input.pressed("jump") or smitten.input.pressed("start") then
    smitten.scene.go("level1")
  end
end

function Title:draw()
  -- The hero bobbing in the middle of the screen, twice as big.
  local frame = math.floor(self.time * 3) % 2
  smitten.sprite("sprites/player"):draw(frame, smitten.screen.width / 2, 112, 0, 2, 2)
  smitten.printCentered("PIXEL PLATFORMER", 41, 1, 2)
  smitten.printCentered("PIXEL PLATFORMER", 40, 13, 2)
  if self.time % 1 < 0.65 then
    smitten.printCentered("Press Space to start", 140, 13)
  end
end

return Title
