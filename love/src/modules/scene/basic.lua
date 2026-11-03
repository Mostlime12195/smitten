-- Timer: counts down and calls tick() (Piece and Group are in node.lua and
-- nodes2d.lua).

local nodeLib = require("love.scene.node")

local Timer = nodeLib.classes.Timer

function Timer:_enter()
	if self.timeLeft == nil then self.timeLeft = self.running and self.seconds or 0 end
end

function Timer:start(seconds)
	self.timeLeft = seconds or self.seconds
	self.running = true
end

function Timer:stop()
	self.running = false
end

function Timer:_process(dt)
	if not self.running then return end
	self.timeLeft = self.timeLeft - dt
	if self.timeLeft <= 0 then
		if self.loop then
			self.timeLeft = self.timeLeft + math.max(self.seconds, 0.0001)
		else
			self.running = false
			self.timeLeft = 0
		end
		self:emit("tick")
	end
end
