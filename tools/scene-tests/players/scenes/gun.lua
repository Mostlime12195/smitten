-- No player of its own: it takes the player of the piece it's inside.
fired = false
aim = 0

function update(dt)
  fired = down("fire")
  aim = axis("left", "right")
end
