-- A scene that's only a script.
local Menu = { background = 2 }
function Menu:enter() self.entered = true end
function Menu:draw() smitten.printCentered("MENU", 80, 13) end
return Menu
