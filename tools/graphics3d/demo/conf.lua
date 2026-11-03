function love.conf(t)
	t.identity = "g3ddemo"
	t.window.title = "graphics3d demo"
	t.window.width = 1280
	t.window.height = 720
	t.window.depth = true
	t.window.resizable = false
	-- A file named "gammacorrect" in the game turns on gamma-correct rendering
	-- (for testing). On the web, gammacorrect with msaa shows nothing (the
	-- engine's sRGB multisampled backbuffer can't be blitted), so it goes
	-- without msaa.
	local gamma = love.filesystem.getInfo("gammacorrect") ~= nil
	t.graphics.gammacorrect = gamma
	t.window.msaa = gamma and 0 or 4
end
