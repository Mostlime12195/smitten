local Coin = smitten.object { color = 6, width = 8, height = 8, value = 1 }
function Coin:create()
	self.created = true
	self.touches, self.untouches = 0, 0
end
function Coin:touch(other)
	self.touches += 1
	self.lastTouched = other
	if self.vanish then self:destroy() end
end
function Coin:untouch(other) self.untouches += 1 end
function Coin:destroyed() Coin.destroyedCount = (Coin.destroyedCount or 0) + 1 end
return Coin
