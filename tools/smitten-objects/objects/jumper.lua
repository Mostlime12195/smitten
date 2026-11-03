local Jumper = smitten.object {
	behaviors = { "platformer" },
	controls = false,
	color = 7,
	width = 10,
	height = 14,
	landings = 0,
	jumps = 0,
}
function Jumper:landed() self.landings += 1 end
function Jumper:jumped() self.jumps += 1 end
return Jumper
