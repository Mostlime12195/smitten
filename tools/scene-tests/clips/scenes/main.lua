-- The clips test (tools/scene-tests/run.mjs, "clips"): a box moves on a dark
-- background in a pixel-art game, with a steady tone, so a recording has a
-- picture and a sound to check. The runner presses Record, saves a video and
-- a GIF, and checks the files.

local t = 0

function ready()
  local rate = 22050
  local data = smitten.sound.newSoundData(rate, rate, 16, 1)
  for i = 0, rate - 1 do
    data:setSample(i, math.sin(i / rate * 440 * 2 * math.pi) * 0.25)
  end
  local tone = smitten.audio.newSource(data)
  tone:setLooping(true)
  tone:play()
  print("ready")
end

function update(dt)
  t += dt
  Box.x = math.floor(80 + math.sin(t * 3) * 60)
end
