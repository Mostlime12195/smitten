-- Basic nodes: Timer (Node itself is in node.lua).

local nodeLib = require("love.scene.node")

local Timer = nodeLib.classes.Timer

function Timer:_enter()
	if self.timeLeft == nil then
		self.timeLeft = 0
		self._running = false
		if self.autostart then self:start() end
	end
end

function Timer:start(seconds)
	self.timeLeft = seconds or self.wait
	self._running = true
end

function Timer:stop()
	self._running = false
end

function Timer:isStopped()
	return not self._running
end

function Timer:_process(dt)
	if not self._running then return end
	self.timeLeft = self.timeLeft - dt
	if self.timeLeft <= 0 then
		if self.oneShot then
			self._running = false
			self.timeLeft = 0
		else
			self.timeLeft = self.timeLeft + math.max(self.wait, 0.0001)
		end
		self:emit("timeout")
	end
end
