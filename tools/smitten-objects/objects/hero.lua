-- The placed player: a sprite with the platformer behavior, driven from code.
return smitten.object {
	sprite = "sprites/hero",
	behaviors = { "platformer" },
	camera = true,
	controls = false,
	width = 10,
	height = 14,
}
