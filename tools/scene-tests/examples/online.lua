-- Online dots, outside the games site (as in the editor): the game says
-- where online play works, and your own dot still moves.

local dot = nil
local status = nil
local x0 = 0

function setup()
  status = root():find("UI/Status")
  dot = root():find("Dot")
end

steps = {
  { 0.1, function()
    check("outside the games site, the game says so", status.text:find("games site", 1, true) ~= nil, status.text)
    check("your dot is there", dot ~= nil and dot:find("Name").text == "You")
    x0 = dot.x
    smitten.input.press("right")
  end },
  { 0.6, function()
    smitten.input.release("right")
    check("the arrow keys move your dot", dot.x > x0 + 50, dot.x - x0)
    check("smitten.net is not available, and no room is joined", smitten.net.available() == false and smitten.net.room() == nil)
    done()
  end },
}
