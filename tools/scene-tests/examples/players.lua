local one
local two
local lift
local coin
local x1, x2 = 0, 0

function setup()
  one = root():find("Player1")
  two = root():find("Player2")
  lift = root():find("Lift")
  coin = root():find("Coin")
end

steps = {
  { 0.6, function()
    check("each player has its number", one.player == 1 and two.player == 2)
    check("the tags show the numbers", one:find("Tag").text == "P1" and two:find("Tag").text == "P2")
    x1, x2 = one.x, two.x
    smitten.input.press("left", 2)
  end },
  { 1.4, function()
    smitten.input.release("left", 2)
    check("player 2 runs with the inputs of player 2", two.x < x2 - 30, two.x - x2)
    check("player 1 stays", near(one.x, x1, 2), one.x - x1)
    check("the lift moves up", lift.y < 630, lift.y)
    check("the clock counts down", root():find("UI/Clock").text ~= "Time: 60", root():find("UI/Clock").text)
    one.x, one.y = coin.x, coin.y
  end },
  { 1.8, function()
    check("player 1 gets the coin", root():find("UI/Score1").text == "Player 1: 1", root():find("UI/Score1").text)
    check("the coin goes to a different place", not (near(coin.x, 640) and near(coin.y, 340)))
    done()
  end },
}
