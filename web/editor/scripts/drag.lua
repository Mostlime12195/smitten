-- Drag: the player can pick this piece up with the mouse (or a finger) and
-- move it. A physics Body is held by a spring at the point you grabbed, so
-- it swings, bumps into things and flies off when you let go: throw it!
-- Other pieces follow the pointer exactly. For toys, puzzles, card games
-- and level editors.

grabRadius = 32   -- how close the pointer has to be, if it has no shape
strength = 0      -- how hard a physics body is pulled (0: right for its mass)

local dragging, grabX, grabY = false, 0, 0

local function underPointer(wx, wy)
  if isTouching then
    -- A Body or Zone: is the point inside one of its shapes?
    for _, p in ipairs(piecesAt(wx, wy)) do
      if p == self then return true end
    end
    if getSize then
      local w = getSize()
      if w > 0 then return false end
    end
  end
  return distanceTo(wx, wy) <= grabRadius
end

function update(dt)
  local m = smitten.mouse
  local mx, my = mouse()
  if dragging then
    if m.down(1) then
      if grab then dragTo(mx, my) else setWorldPosition(mx + grabX, my + grabY) end
    else
      dragging = false
      if grab then drop() end
      emit("dropped")
    end
  elseif m.pressed(1) and not m.isOverUI() and underPointer(mx, my) then
    dragging = true
    if grab then
      grab(mx, my, strength > 0 and strength or nil)
    else
      local px, py = worldPosition()
      grabX, grabY = px - mx, py - my
    end
    emit("pickedUp")
  end
end
