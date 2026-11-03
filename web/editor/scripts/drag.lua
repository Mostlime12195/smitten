-- Drag: the player can pick this piece up with the mouse (or a finger) and
-- move it. For card games, puzzles and level editors.

grabRadius = 32   -- how close the pointer has to be, if it has no shape

local dragging, grabX, grabY = false, 0, 0

local function underPointer(wx, wy)
  if getSize then
    local w, h = getSize()
    if w > 0 then
      local px, py = worldPosition()
      return math.abs(wx - px) <= w / 2 and math.abs(wy - py) <= h / 2
    end
  end
  return distanceTo(wx, wy) <= grabRadius
end

function update(dt)
  local m = smitten.mouse
  local mx, my = mouse()
  if dragging then
    if m.down(1) then
      setWorldPosition(mx + grabX, my + grabY)
    else
      dragging = false
      emit("dropped")
    end
  elseif m.pressed(1) and not m.isOverUI() and underPointer(mx, my) then
    local px, py = worldPosition()
    dragging, grabX, grabY = true, px - mx, py - my
    emit("pickedUp")
  end
end
