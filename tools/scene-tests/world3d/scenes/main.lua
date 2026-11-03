local World = {}
function World:ready()
  self.got = 0
  self:find("Pickup"):on("entered", function(other) if other:inGroup("player") then self.got += 1 end end)
end
function World:update(dt)
  local p = self:find("Player")
  -- Walk forward for the test (as if holding W).
  p.vz = p.vz
  local c = self:find("Crate0")
  self:find("Info").text = `player {math.floor(p.x*10)/10},{math.floor(p.y*100)/100},{math.floor(p.z*10)/10} floor {p:isOnFloor()} crate0 y {math.floor(c.y*100)/100} pickups {self.got}`
end
function World:physicsUpdate(dt)
  local p = self:find("Player")
  if smitten.timer.getTime() > 2 then p.z -= 2 * dt end
end
return World
