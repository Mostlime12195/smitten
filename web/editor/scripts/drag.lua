-- Drag: the player can pick this piece up with the mouse (or a finger) and
-- move it. For card games, puzzles and level editors.
local Draggable = {}

Draggable.grabRadius = 32   -- how close the pointer has to be, if it has no shape

function Draggable:isUnderPointer(wx, wy)
  if self.getSize then
    local w, h = self:getSize()
    if w > 0 then
      local x, y = self:worldPosition()
      return math.abs(wx - x) <= w / 2 and math.abs(wy - y) <= h / 2
    end
  end
  return self:distanceTo(wx, wy) <= self.grabRadius
end

function Draggable:update(dt)
  local mouse = smitten.mouse
  if self.dragging then
    if mouse.down(1) then
      self:setWorldPosition(mouse.worldX + self.grabX, mouse.worldY + self.grabY)
    else
      self.dragging = false
      self:emit("dropped")
    end
  elseif mouse.pressed(1) and not mouse.isOverUI() and self:isUnderPointer(mouse.worldX, mouse.worldY) then
    local x, y = self:worldPosition()
    self.dragging, self.grabX, self.grabY = true, x - mouse.worldX, y - mouse.worldY
    self:emit("pickedUp")
  end
end

return Draggable
