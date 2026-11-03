-- The smoke test's root: counts coins and ticks, and tries the script API.
-- (scripts/spin.lua stays in the old style, to check that it still works.)
-- Every line it prints should read as expected; "catalogue ok" means every
-- method in pieces.json exists on a piece of its type.

local ticks, coins = 0, 0
step = "start"

function score() return coins end

-- Every method in the piece catalogue, own and inherited, is a function on
-- a piece of that type.
local function checkCatalogue()
  local schema = require("love.scene.schema")
  local missing = {}
  for t, def in pairs(schema.types) do
    if not def.abstract and t ~= "Joint" then
      local p = make(t)
      local d = def
      while d do
        for m in pairs(d.methods or {}) do
          if type(p[m]) ~= "function" then missing[#missing + 1] = t .. ":" .. m end
        end
        d = d.extends and schema.types[d.extends]
      end
    end
  end
  table.sort(missing)
  return #missing == 0 and "ok" or table.concat(missing, " ")
end

function ready(...)
  print("ready", name, Player.type, Player.motion, love == nil, smitten.version, Player:getSize())
  print("ready values", select("#", ...), game.visits)
  Tick:on("tick", function() ticks += 1 end)
  find("UI/Restart"):on("pressed", function() reload() end)
  local spawned = spawn("Shape", { x = 500, y = 200, shape = "circle", radius = 6 })
  print("spawned", spawned.type, spawned.parent == self, #tagged("coin"), Coin:is("coin"), Coin:is("Zone"), Coin:is("enemy"))
  print("api", clamp(5, 0, 3), sign(-2), round(2.6), lerp(0, 10, 0.5), choose(7), dist(0, 0, 3, 4), screenWidth(), rnd({ "only" }))
  print("own function", score(), self:score())
  print("catalogue", checkCatalogue())

  -- Input: actions, single inputs, any press
  print("input", pressed(), pressed("space"), down("mouse:1"), released("pad:a"), axis("left", "right"), (wheel()), #touches(), (stick("left")), trigger("left"))
  print("typed", typed() == "")
  smitten.keyboard.setTextInput(false)
  local ok, err = pcall(pressed, "jupm")
  print("unknown input", ok, (tostring(err):gsub("^.-: ", "")))

  -- Tiles
  Ground.solid = true
  Ground:setTile(5, 0, 0)
  Ground:fill(0, 1, 3, 2, 1)
  local gx, gy, gw, gh = Ground:getBounds()
  print("tiles", Ground:getTile(5, 0), Ground:getTile(2, 2), Ground:isSolid(5, 0), Ground:isSolid(0, 0), #Ground:neighbors(1, 1), #Ground:neighbors(1, 1, true), Ground:tileAt(16 + 5 * 16 + 1, 41))
  print("tiles bounds", gx, gy, gw, gh, Ground:getTileSize())
  print("tiles center", Ground:cellCenter(0, 0))
  Ground:fill(0, 2, 3, 1, -1)
  print("tiles after", #Ground:cellsWith(1), #Ground:cellsWith())

  -- Camera
  Camera.smoothing = 5
  Camera:follow(Player)
  Camera:setLimits(0, 0, 640, 360)
  Camera:snap()
  local other = make("Camera")
  other:limitTo(Ground)
  print("camera", camera() == Camera, other.left, other.top, other.right, other.bottom)
  print("camera view", Camera:getView())

  -- Sprites and particles
  Pic:play()
  Pic:pause()
  print("sprite", Pic.playing, #Pic:animations(), Pic:getSize())
  Pic:stop()
  Sparks:on("custom", function(v) print("particles event", v) end)
  Sparks:emit("custom", 5)
  Sparks:emit(3)
  print("particles", Sparks:getCount() > 0)

  -- Sound
  print("master volume", masterVolume(0.8))
  sfx("blip", { volume = 0.2, pitch = 1.5 })
  local src = Beep:play()
  print("sound", src ~= nil, Beep:isPlaying(), Beep:getDuration() > 0)
  Beep:fadeOut(0.2)
  music("blip", { volume = 0.3, fade = 0.2 })
  print("music again", music("blip") == smitten.audio.getMusic())

  -- Saving
  save("smoke", 42)
  print("saved", load("smoke"), load("nothing", "default"))

  -- Time
  timeScale(0.5)
  print("time scale", timeScale())
  timeScale(1)
  after(0.3, function() print("after 0.3", step) end)
  wait(0.5)
  step = "waited"
  print("ready went on after wait(0.5)")
  print("focus", find("UI/Restart"):isFocused(), find("UI/Other"):isFocused())
  stopMusic(0.2)

  -- Pause: Menu (pausable off) runs, Walker waits.
  local menu0, walk0 = Menu.count, Walker.count
  pauseGame()
  smitten.timer.after(0.3, function()
    print("paused", isPaused(), Menu.count > menu0, Walker.count == walk0)
    resumeGame()
  end)
  wait(0.5)
  print("resumed", isPaused(), Walker.count > walk0)

  -- Scenes: a fade to the second scene, which comes back once.
  if not game.visits then
    game.visits = 1
    transition("fade", 0.2)
    go("scenes/second.scene", "hello", 7)
  end
end

function collected(item)
  coins += 1
  print("coin collected", item.name, score())
end

function update(dt)
  find("UI/Score").text = `Coins: {coins}  ticks: {ticks}  ground: {Player:onGround()}`
end

function physicsUpdate(dt)
  -- Walk right for the test, as if holding the right action.
  if Player:onGround() then Player.vx = 80 end
end

function draw()
  pen("#ff4060")
  rect(4, 340, 12, 12)
  circle(30, 346, 6, false)
  write(step, 44, 338)
  penSize(2)
  pen(0.4, 0.8, 1)
  oval(100, 346, 10, 6, false)
  poly({ 120, 352, 130, 338, 140, 352 })
  dot(150, 346)
  write("centered", 320, 300, { size = 12, align = "center" })
  sprite("art/tiles.png", 160, 338, { columns = 2, frame = 0 })
end
