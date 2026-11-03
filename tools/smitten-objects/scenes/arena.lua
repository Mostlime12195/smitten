local Arena = {}
Arena.enters = 0
function Arena:enter(a, b)
	self.args = { a, b }
	self.updates = 0
	self.heroAtEnter = smitten.find("hero")
	Arena.enters += 1
end
function Arena:update(dt) self.updates += 1 end
function Arena:draw()
	smitten.print(`objects: {#smitten.all()}`, 4, 4, 13)
end
function Arena:keypressed(key) self.lastKey = key end
function Arena:leave() self.left = true end
return Arena
