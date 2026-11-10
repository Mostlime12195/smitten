-- Moving platform: moves along a route of points, and stops for a time at
-- each point. Attach it to a Body whose motion is "still". The bodies that
-- stand on it move with it. It also moves pieces of other types.
-- It sends the event "arrived" with the number of the point.

route = "200, 0"        -- the points, as x, y pairs from its start position: "200, 0, 200, -120"
speed = 80              -- pixels per second
stopTime = 0.5          -- seconds that it stops at each point
backAndForth = true     -- true: it goes back along the route. false: from the last point, it goes to the start

local stops = {}
local target, direction, waiting = 2, 1, 0

function ready()
  stops = { { x, y } }
  local numbers = {}
  for n in route:gmatch("-?%d+%.?%d*") do numbers[#numbers + 1] = tonumber(n) end
  for i = 1, #numbers - 1, 2 do
    stops[#stops + 1] = { stops[1][1] + numbers[i], stops[1][2] + numbers[i + 1] }
  end
end

local function nextStop()
  if backAndForth then
    if target + direction > #stops or target + direction < 1 then direction = -direction end
    target += direction
  else
    target = target % #stops + 1
  end
end

-- Physics steps move it, so that the bodies on it move at the same time.
function physicsUpdate(dt)
  if #stops < 2 then return end
  if waiting > 0 then
    waiting -= dt
    return
  end
  local tx, ty = stops[target][1], stops[target][2]
  local dx, dy = tx - x, ty - y
  local d = math.sqrt(dx * dx + dy * dy)
  local length = speed * dt
  if d <= length then
    x, y = tx, ty
    waiting = stopTime
    emit("arrived", target)
    nextStop()
  else
    x += dx / d * length
    y += dy / d * length
  end
end
