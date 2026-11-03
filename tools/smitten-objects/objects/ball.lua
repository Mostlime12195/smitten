-- For the 500-object timing: a mover kept inside the arena (whose top and
-- sides have no walls).
local Ball = smitten.object { behaviors = { "mover" }, bounce = true, width = 4, height = 4, color = 12 }
function Ball:update()
	if self.y < 0 and self.vy < 0 then self.vy = -self.vy end
	if self.x < 0 and self.vx < 0 then self.vx = -self.vx end
	if self.x > 636 and self.vx > 0 then self.vx = -self.vx end
end
return Ball
