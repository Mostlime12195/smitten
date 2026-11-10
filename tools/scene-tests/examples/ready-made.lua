-- The ready-made scripts health.lua, spawner.lua, moving-platform.lua and
-- countdown.lua, in a scene that run.mjs makes.
local hero
local lift
local clock
local events = { damaged = 0, healed = 0, died = 0, arrived = 0, timeUp = 0 }
local maxX, minAfter = -1e9, 1e9


function onPhysics(dt)
  if not lift then return end
  maxX = math.max(maxX, lift.x)
  if maxX >= 599.99 then minAfter = math.min(minAfter, lift.x) end
end

function setup()
  hero = root():find("Hero")
  lift = root():find("Lift")
  clock = root():find("Clock")
  hero:on("damaged", function() events.damaged += 1 end)
  hero:on("healed", function() events.healed += 1 end)
  hero:on("died", function() events.died += 1 end)
  lift:on("arrived", function() events.arrived += 1 end)
  root():on("timeUp", function() events.timeUp += 1 end)
end

steps = {
  { 0.1, function()
    check("countdown: shows the time with tenths", clock.text:find("^Time: 0%.%d$") ~= nil, clock.text)
    check("health: a hit counts", hero:hurt(1) == true and hero.health == 2, hero.health)
    check("health: no damage just after a hit", hero:hurt(1) == false and hero.health == 2, hero.health)
    check("health: the piece blinks", hero:isInvincible())
  end },
  { 0.7, function()
    check("health: hits count again after invincibleTime", hero:hurt(1) == true and hero.health == 1, hero.health)
    hero:heal(5)
    check("health: heal() stops at maxHealth", hero.health == 3, hero.health)
  end },
  { 1.3, function()
    check("health: visible again after the blink", hero.visible)
    hero:hurt(5)
    check("health: 0 sends died and removes the piece", events.died == 1 and not hero:isAlive() and events.damaged == 3 and events.healed == 1,
      ("%d %d %d"):format(events.died, events.damaged, events.healed))
    check("countdown: timeUp at 0", events.timeUp == 1 and clock.text == "Time: 0.0", clock.text)
    check("spawner: stops at maxAlive", #tagged("thing") == 3, #tagged("thing"))
    tagged("thing")[1]:destroy()
  end },
  { 2.0, function()
    check("spawner: makes a new copy when one goes", #tagged("thing") == 3, #tagged("thing"))
    local copy = tagged("thing")[1]
    check("spawner: copies go to its position", near(copy.x, 300) and near(copy.y, 100), copy.x .. ", " .. copy.y)
    check("moving platform: gets to the end of the route", near(maxX, 600, 0.01), maxX)
    check("moving platform: comes back", near(minAfter, 500, 0.01), minAfter)
    check("moving platform: sends arrived", events.arrived >= 2, events.arrived)
    done()
  end },
}
