-- Something to look at when the checks are done: a sky that stays put,
-- clouds that drift, hills at 0.4 of the camera's speed, and a level whose
-- ground is painted with a terrain, with lava (an animated tile) in the dips.

function ready()
  for column = -40, 200 do
    local top = math.floor(2.5 + 1.5 * math.sin(column / 5))
    Level:fillTerrain(column, top, 1, 6 - top, "stone")
    if top >= 4 then Level:setTile(column, 3, 88) end
  end
end

function update(dt)
  Camera.x += 30 * dt
  if Camera.x > 1400 then Camera.x = 100 end
end
