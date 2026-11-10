-- Checks local multiplayer input and the touch pieces.
--
-- Actions are pressed with smitten.input.press() and friends, keys with
-- keypressed events, and fingers with touchpressed/touchmoved/touchreleased
-- events pushed onto the engine's own event queue, so they travel the way
-- real ones do. Prints PASS or FAIL for each check, then DONE
-- (tools/scene-tests/run.mjs reads them). After DONE it prints a line each
-- time the stick, the button or the mouse changes, for the runner's real
-- touches.

local input = smitten.input
local ui = require("love.scene.ui")
local g = smitten.graphics

local passed, failed = 0, 0
local stage, canvas

local function check(name, ok, why)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. ": " .. tostring(why or "not so"))
  end
end

local function near(a, b, tolerance)
  return type(a) == "number" and math.abs(a - b) <= (tolerance or 0.02)
end

-- Waits for the next frame (update() resumes this once a frame).
local function frame(n)
  for i = 1, n or 1 do coroutine.yield() end
end

local function key(name, isDown)
  smitten.event.push(isDown == false and "keyreleased" or "keypressed", name, name, false)
end

-- A finger, at a place in game coordinates.
local function finger(what, id, x, y)
  local wx, wy = smitten.display.toWindow(x, y)
  smitten.event.push("touch" .. what, id, wx, wy, 0, 0, 1)
end

-- The mouse SDL makes from the first finger (istouch is true).
local function fingerMouse(what, x, y)
  local wx, wy = smitten.display.toWindow(x, y)
  smitten.event.push("mouse" .. what, wx, wy, 1, true, 1)
end

local function add(kind, props, parent)
  return (parent or stage):add(make(kind, props))
end

-- Draws the stage's UI to a canvas and returns its pixels.
local function shot()
  g.push("all")
  g.setCanvas(canvas)
  g.setScissor()
  g.origin()
  g.clear(0, 0, 0, 1)
  ui.render(stage)
  g.pop()
  return g.readbackTexture(canvas)
end

local function lit(data, x, y)
  local r, gr, b = data:getPixel(x, y)
  return r + gr + b > 0.3
end

---------------------------------------------------------------------------

local function players()
  local one, two = find("One"), find("Two")
  local oneGun, twoGun = one:find("Gun"), two:find("Gun")

  -- Pressed by code: for one player, seen by calls with no player.
  input.press("jump", 2)
  check("press: no player sees it", pressed("jump") and down("jump"))
  check("press: player 2 sees it", pressed("jump", 2) and input.pressed("jump", 2))
  check("press: player 1 doesn't", not pressed("jump", 1) and not down("jump", 1))
  check("press: counts as any press", pressed() and pressed(nil, 2) and not pressed(nil, 1))
  frame()
  -- The pieces updated after the press, in the same frame.
  check("piece: player 2's scene saw its player jump", two.jumped == true and two.held == true)
  check("piece: player 1's scene didn't", one.jumped == false and one.held == false)
  check("piece: a number still wins", one.other == true and two.other == false)
  check("piece: the module reads everyone", one.anyone == true and two.anyone == true)
  check("press: pressed for exactly one frame", not pressed("jump") and not pressed("jump", 2) and down("jump", 2))
  input.release("jump", 2)
  check("release: released, this frame", released("jump") and released("jump", 2) and not released("jump", 1) and not down("jump"))
  frame()
  check("release: for exactly one frame", not released("jump") and not released("jump", 2))
  check("piece: let go", two.held == false and two.jumped == false)

  -- Player 1 by default.
  input.press("fire")
  check("press: player 1 without a number", down("fire", 1) and not down("fire", 2) and down("fire"))
  frame()
  check("piece: a child takes the player above it", oneGun.fired == true and twoGun.fired == false)
  input.press("fire", 2)
  frame()
  check("no player: sees every player's input", down("fire") and oneGun.fired and twoGun.fired)
  input.release("fire")
  check("no player: still held by player 2", down("fire") and not released("fire") and not down("fire", 1))
  input.release("fire", 2)
  check("no player: released when the last lets go", released("fire") and not down("fire"))
  frame()

  -- Part of the way, like a stick.
  input.setStrength("right", 0.5, 2)
  check("strength: a fraction through axis", near(axis("left", "right", 2), 0.5) and axis("left", "right", 1) == 0
    and near(axis("left", "right"), 0.5), axis("left", "right", 2))
  check("strength: strength()", near(input.strength("right", 2), 0.5) and near(input.strength("right"), 0.5))
  input.setStrength("up", 1, 2)
  local vx, vy = vector("left", "right", "up", "down", 2)
  check("strength: vector", near(vx, 0.5 / math.sqrt(1.25)) and near(vy, -1 / math.sqrt(1.25)), vx .. ", " .. vy)
  frame()
  check("piece: axis and vector for its player", near(two.move, 0.5) and one.move == 0 and near(two.dirY, -1 / math.sqrt(1.25))
    and near(twoGun.aim, 0.5) and oneGun.aim == 0, two.move)
  input.setStrength("left", 1, 2)
  check("strength: both ways cancel", near(axis("left", "right", 2), -0.5))
  input.setStrength("left", 0, 2)
  input.setStrength("right", 0, 2)
  input.setStrength("up", 0, 2)

  -- The piece's player can change while the game runs.
  one.player = 2
  input.press("jump", 2)
  frame()
  check("piece: player changed from outside", one.jumped == true and one.held == true)
  one.player = 1
  input.release("jump", 2)
  frame()

  -- smitten.json: player 2 has Enter for jump; the keyboard's other keys
  -- are player 1's.
  check("settings: bindings()", input.bindings("jump", 2)[1] == "return" and input.bindings("jump")[1] == "space"
    and input.bindings("jump", 1)[1] == "space" and input.bindings("dash")[1] == "k")
  key("return")
  frame()
  check("settings: player 2's own key", pressed("jump", 2) and not pressed("jump", 1) and pressed("jump"))
  local name, device, pad = input.lastPressedBy()
  check("lastPressedBy: the key and the keyboard", name == "return" and device == "keyboard" and pad == nil, tostring(name))
  check("lastPressed: for each player", input.lastPressed() == "return" and input.lastPressed(2) == "return")
  frame()
  check("piece: reads its player's key", two.jumped == true and one.jumped == false)
  key("return", false)
  key("space")
  frame()
  check("settings: shared keys are player 1's", pressed("jump", 1) and not pressed("jump", 2) and released("jump", 2))
  key("space", false)
  key("k")
  frame()
  check("settings: a shared action", pressed("dash", 1) and not pressed("dash", 2) and pressed("dash"))
  key("k", false)
  key("left")
  frame()
  check("settings: one key, two meanings", down("left", 2) and down("left", 1) and near(axis("left", "right", 2), -1))
  key("left", false)
  frame()

  -- Changing inputs while the game runs.
  input.bind("dash", { "k" }, 3)
  key("k")
  frame()
  check("bind: a player's own input", pressed("dash", 3) and pressed("dash", 1) and not pressed("dash", 2))
  key("k", false)
  input.unbind("dash", 3)
  frame()
  check("bind: bindings follow", input.bindings("dash", 3)[1] == "k" and #input.bindings("dash", 3) == 2)
  input.assignKeyboard(2)
  key("k")
  frame()
  check("assignKeyboard: the keyboard changes hands", pressed("dash", 2) and not pressed("dash", 1) and pressed("dash") and input.keyboardOf() == 2)
  key("k", false)
  input.assignKeyboard(1)
  frame()

  -- Devices.
  check("players(): the keyboard and player 2's keys", input.gamepads() > 0 or input.players() == 2, input.players())
  check("gamepadOf: none without a gamepad", input.gamepads() > 0 or input.gamepadOf(1) == nil)
  input.assignGamepad(1, 2)
  check("assignGamepad", input.gamepads() > 1 or input.gamepadOf(1) == nil)
  input.assignGamepad(1, nil)
  local handle = input.on("gamepadadded", function() end)
  handle:off()

  -- Mistakes say what's wrong.
  local ok, err = pcall(input.press, "jmup")
  check("error: unknown action", not ok and tostring(err):find("no input action or key called \"jmup\"", 1, true), err)
  ok, err = pcall(pressed, "jump", 0)
  check("error: player 0", not ok and tostring(err):find("a player is a number from 1 up", 1, true), err)
  ok, err = pcall(input.on, "gamepadaded", print)
  check("error: unknown event", not ok and tostring(err):find("gamepadadded", 1, true), err)
end

---------------------------------------------------------------------------

local function touch()
  local events = {}
  local function listen(piece, name)
    events[name] = { pressed = 0, released = 0 }
    piece:on("touched", function() events[name].pressed += 1 end)
    piece:on("untouched", function() events[name].released += 1 end)
  end

  -- A stick in the bottom left (its middle is at 80, 280), two buttons
  -- side by side on the right, and an ordinary Button at the top.
  local stick = add("TouchStick", { anchor = "bottomLeft", x = 20, y = 20, width = 120, height = 120, radius = 50, deadzone = 0 })
  local jump = add("TouchButton", { anchor = "topLeft", x = 400, y = 240, width = 80, height = 80 })
  local fire = add("TouchButton", { anchor = "topLeft", x = 480, y = 240, width = 80, height = 80, action = "fire", player = 2, shape = "rectangle", text = "F" })
  local plain = add("Button", { x = 280, y = 20, width = 100, height = 40 })
  local clicks = 0
  plain:on("clicked", function() clicks += 1 end)
  listen(stick, "stick")
  listen(jump, "jump")
  listen(fire, "fire")

  -- show = "touch": nothing drawn where there's no touch screen.
  input._setTouch(false)
  local d = shot()
  check("show: hidden without a touch screen", not input.hasTouch() and not lit(d, 80, 280) and not lit(d, 440, 280) and not lit(d, 520, 280))
  check("show: other UI still drawn", lit(d, 330, 40))
  stick.show = "always"
  d = shot()
  check("show: always", lit(d, 80, 280) and not lit(d, 440, 280))
  stick.show = "never"
  input._setTouch(true)
  d = shot()
  check("show: never, even on a touch screen", not lit(d, 80, 280) and lit(d, 440, 280) and lit(d, 520, 280))
  stick.show = "touch"
  d = shot()
  check("show: drawn on a touch screen", input.hasTouch() and lit(d, 80, 280) and lit(d, 80, 235) and not lit(d, 80, 215))
  input._setTouch(false)
  frame()

  -- A thumb on the stick: SDL sends the mouse it makes from the first
  -- finger, then the finger.
  fingerMouse("pressed", 80, 280)
  finger("pressed", 1, 80, 280)
  frame()
  check("stick: touched", stick:isActive() and events.stick.pressed == 1 and axis("left", "right") == 0)
  check("stick: the touch isn't a click as well", not down("mouse:1") and not pressed("mouse:1"))
  check("show: a touch makes it a touch screen", input.hasTouch() and lit(shot(), 440, 280))
  frame()
  finger("moved", 1, 105, 280)
  frame()
  local x, y = stick:getValue()
  check("stick: halfway is half", near(axis("left", "right"), 0.5) and near(x, 0.5) and near(y, 0), axis("left", "right"))
  check("stick: it's player 1's", near(axis("left", "right", 1), 0.5) and axis("left", "right", 2) == 0)
  check("stick: strength()", near(input.strength("right"), 0.5) and input.strength("left") == 0)
  frame()
  check("piece: a player scene reads the stick", near(find("One").move, 0.5) and find("Two").move == 0)
  finger("moved", 1, 80, 180)
  frame()
  x, y = stick:getValue()
  check("stick: no further than its radius", near(x, 0) and near(y, -1) and near(axis("up", "down"), -1), y)
  finger("moved", 1, 105, 280)
  frame()

  -- A second finger on a button, while the first holds the stick.
  finger("pressed", 2, 440, 280)
  frame()
  check("two fingers: the button and the stick", jump:isDown() and pressed("jump") and down("jump", 1)
    and near(axis("left", "right"), 0.5) and events.jump.pressed == 1)
  check("two fingers: no click", not down("mouse:1"))
  frame()
  check("button: pressed for one frame, then held", not pressed("jump") and down("jump"))

  -- Sliding off lets go; back on presses again; onto the next button
  -- hands the finger over.
  finger("moved", 2, 440, 200)
  frame()
  check("button: sliding off releases", not jump:isDown() and released("jump") and not down("jump") and events.jump.released == 1)
  finger("moved", 2, 440, 280)
  frame()
  check("button: sliding back on presses", jump:isDown() and pressed("jump") and events.jump.pressed == 2)
  finger("moved", 2, 520, 280)
  frame()
  check("button: sliding onto the next one", not jump:isDown() and fire:isDown() and not down("jump"))
  check("button: its player", down("fire", 2) and not down("fire", 1) and down("fire"))
  frame()
  check("piece: a child reads its player's button", find("Two"):find("Gun").fired and not find("One"):find("Gun").fired)

  -- A third finger away from the touch pieces is the mouse: it presses
  -- the ordinary Button.
  finger("pressed", 3, 330, 40)
  frame()
  check("third finger: it's the mouse", down("mouse:1") and pressed("mouse:1"))
  local mx, my = mouseScreen()
  check("third finger: the mouse is where it is", near(mx, 330, 1) and near(my, 40, 1), mx .. ", " .. my)
  finger("released", 3, 330, 40)
  frame()
  check("third finger: clicks UI", clicks == 1 and not down("mouse:1"), clicks)

  finger("released", 2, 520, 280)
  fingerMouse("released", 105, 280)
  finger("released", 1, 105, 280)
  frame()
  check("let go: everything back", not stick:isActive() and axis("left", "right") == 0 and not fire:isDown() and not down("fire")
    and events.stick.released == 1 and events.fire.released == 1 and not down("mouse:1"))
  x, y = stick:getValue()
  check("let go: the stick is in the middle", x == 0 and y == 0)

  -- A touch anywhere else is the mouse, as it always was.
  fingerMouse("pressed", 200, 100)
  finger("pressed", 4, 200, 100)
  frame()
  check("elsewhere: a touch is mouse:1", pressed("mouse:1") and down("mouse:1") and not stick:isActive())
  fingerMouse("released", 200, 100)
  finger("released", 4, 200, 100)
  frame()
  check("elsewhere: let go", released("mouse:1") and not down("mouse:1"))

  -- A real mouse works touch pieces that are always shown, and no others.
  local wx, wy = smitten.display.toWindow(440, 280)
  smitten.event.push("mousepressed", wx, wy, 1, false, 1)
  frame()
  check("mouse: not on a piece for touch only", not jump:isDown() and down("mouse:1"))
  smitten.event.push("mousereleased", wx, wy, 1, false, 1)
  jump.show = "always"
  frame()
  smitten.event.push("mousepressed", wx, wy, 1, false, 1)
  frame()
  check("mouse: works an always-shown piece", jump:isDown() and down("jump") and not down("mouse:1"))
  smitten.event.push("mousereleased", wx, wy, 1, false, 1)
  frame()
  check("mouse: lets go", not jump:isDown() and not down("jump"))
  jump.show = "touch"

  -- A floating stick starts where the thumb lands; a following one comes along.
  stick.mode = "floating"
  stick.deadzone = 0.2
  finger("pressed", 1, 40, 250)
  frame()
  finger("moved", 1, 40, 280)
  frame()
  x, y = stick:getValue()
  -- 30 of 50 is 0.6; with a dead zone of 0.2 that's (0.6 - 0.2) / 0.8.
  check("floating: from where it landed, with a dead zone", near(x, 0) and near(y, 0.5) and near(axis("up", "down"), 0.5), y)
  finger("moved", 1, 40, 255)
  frame()
  check("dead zone: nothing near the middle", axis("up", "down") == 0 and stick:isActive())
  finger("released", 1, 40, 255)
  frame()
  stick.mode = "follow"
  finger("pressed", 1, 40, 250)
  frame()
  finger("moved", 1, 130, 250)
  frame()
  finger("moved", 1, 105, 250)
  frame()
  -- Dragged 90: the base followed to 80, so 105 is 25 of 50 to its right.
  x = stick:getValue()
  check("follow: the base comes along", near(x, (0.5 - 0.2) / 0.8), x)
  finger("released", 1, 105, 250)
  frame()

  -- Touch pieces inside a player's piece are that player's; a stick read
  -- by hand pushes no actions.
  local theirs = add("TouchButton", { anchor = "topLeft", x = 400, y = 100, width = 60, height = 60 }, find("Two"))
  local aim = add("TouchStick", { anchor = "topLeft", x = 500, y = 60, width = 100, height = 100, radius = 40, deadzone = 0,
    leftAction = "", rightAction = "", upAction = "", downAction = "" })
  frame()
  finger("pressed", 1, 430, 130)
  finger("pressed", 2, 550, 110)
  frame()
  finger("moved", 2, 570, 110)
  frame()
  check("player: a button inside player 2's piece", theirs:isDown() and down("jump", 2) and not down("jump", 1))
  x = aim:getValue()
  check("stick: read by hand", near(x, 0.5) and axis("left", "right") == 0 and aim:isActive(), x)

  -- A piece that goes while it's held lets go of its action.
  theirs:destroy()
  aim:destroy()
  frame()
  check("removed: lets go", not down("jump", 2) and not down("jump"))
  finger("released", 1, 430, 130)
  finger("released", 2, 570, 110)
  frame()

  -- As they were, for the runner's real fingers.
  stick.mode = "fixed"
  stick.deadzone = 0
  return stick, jump
end

---------------------------------------------------------------------------

local run, finished, live
local last = ""

local function all()
  stage = find("Stage")
  canvas = g.newCanvas(640, 360, { dpiscale = 1 })
  frame()
  local ok, err = pcall(players)
  if not ok then check("the player checks stopped", false, err) end
  local stick, jump
  ok, stick, jump = pcall(touch)
  if not ok then check("the touch checks stopped", false, stick) end
  print(`DONE {passed} passed, {failed} failed`)
  finished = true
  live = ok
end

function update(dt)
  if not run then run = coroutine.wrap(all) end
  if not finished then
    run()
    return
  end
  if live then
    -- For real fingers (the runner's): say what the controls read.
    local line = ("LIVE axis=%.2f jump=%s mouse=%s touch=%s"):format(
      axis("left", "right"), tostring(down("jump")), tostring(down("mouse:1")), tostring(input.hasTouch()))
    if line ~= last then
      last = line
      print(line)
    end
  end
end
