local planet
local wind
local ball
local moon
local crate
local ballX, moonD, crateY = 0, 0, 0
-- The crate bobs at the top of the water, so the check takes its highest point.
local crateTop = math.huge
local function watch() crateTop = math.min(crateTop, crate.y) end

function setup()
  planet = root():find("Planet")
  wind = root():find("Wind")
  ball = root():find("Ball2")
  moon = root():find("Moon1")
  crate = root():find("Crate1")
end

steps = {
  { 0.05, function()
    ballX, crateY = ball.x, crate.y
    moonD = dist(moon.x, moon.y, planet.x, planet.y)
  end },
  { 0.5, watch }, { 0.8, watch }, { 1.1, watch }, { 1.4, watch }, { 1.7, watch },
  { 2.0, function()
    check("the wind pushes", ball.x > ballX + 50, ball.x - ballX)
    check("the planet pulls", dist(moon.x, moon.y, planet.x, planet.y) < moonD - 20, dist(moon.x, moon.y, planet.x, planet.y))
    watch()
    check("the water lifts", crateTop < crateY - 20, crateTop - crateY)
    -- The scene has 7 things. The spawner adds a ball at the start, and one every 3 seconds.
    check("the spawner drops balls", #tagged("thing") > 7, #tagged("thing"))
    tap("jump")
  end },
  { 2.2, function()
    check("space turns the wind off", wind.forces == false)
    done()
  end },
}
