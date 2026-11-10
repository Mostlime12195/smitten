-- Spawner: makes a copy of a scene at its position, again and again.
-- Use it for enemies, falling rocks or coins.
-- It sends the event "spawned" with each new copy.

sceneFile = ""          -- the scene to copy, for example "scenes/enemy.scene"
interval = 2            -- seconds between two copies
maxAlive = 5            -- it waits while this number of its copies are in the scene (0: no limit)
spreadX = 0             -- each copy goes a random distance to the side, up to this number of pixels
spreadY = 0             -- the same, up and down
startNow = true         -- make the first copy when the scene starts
spawning = true         -- set it to false to stop, and to true to start again

local left = 0
local alive = {}

local function aliveCount()
  for i = #alive, 1, -1 do
    if not alive[i]:isAlive() then table.remove(alive, i) end
  end
  return #alive
end

-- Makes one copy now. Returns the copy, or nil.
function spawnOne()
  if sceneFile == "" then return nil end
  if maxAlive > 0 and aliveCount() >= maxAlive then return nil end
  local px, py = worldPosition()
  local copy = spawn(sceneFile, { x = px + (rnd(2) - 1) * spreadX, y = py + (rnd(2) - 1) * spreadY })
  alive[#alive + 1] = copy
  emit("spawned", copy)
  return copy
end

function ready()
  left = if startNow then 0 else interval
end

function update(dt)
  if not spawning then return end
  left -= dt
  if left <= 0 then
    left = math.max(interval, 0.05)
    spawnOne()
  end
end
