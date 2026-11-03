-- Pixel Platformer: a Smitten example.
--
-- Arrow keys or WASD to run, Space, Up or W to jump (or a gamepad).
-- Collect the coins and reach the flag.
--
-- Everything here was made in Smitten: open sprites/player.png to draw,
-- maps/level1.map.json to change the level, sfx/*.sfx.json for sounds and
-- music/theme.song.json for the music.

local Title = require("scenes.title")

function love.load()
  smitten.screen.setup() -- 320×180, from smitten.json
  love.graphics.setFont(love.graphics.newFont(8, "mono"))

  smitten.input.bind("left", { "left", "a", "pad:dpleft", "axis:leftx-" })
  smitten.input.bind("right", { "right", "d", "pad:dpright", "axis:leftx+" })
  smitten.input.bind("jump", { "space", "up", "w", "pad:a" })
  smitten.input.bind("start", { "return", "space", "pad:start", "pad:a" })

  smitten.scene.switch(Title)
end

function love.keypressed(key)
  if key == "escape" then love.event.quit() end
end
