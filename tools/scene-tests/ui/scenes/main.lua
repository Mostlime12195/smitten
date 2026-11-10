-- Checks the UI pieces that are worked and that lay others out: TextInput,
-- Slider, Checkbox, Row, Column, Grid, Scroll, and skins.
--
-- Layout is compared with layout-cases.json, the cases the editor's layout
-- is checked with too. The mouse, the wheel, keys and typed text are events
-- pushed onto the engine's own queue, so they travel the way real ones do;
-- what's drawn is read back from a canvas. Prints PASS or FAIL for each
-- check, then DONE (tools/scene-tests/run.mjs reads them). After DONE it
-- leaves a TextInput, a Slider and a Checkbox on the screen and prints a
-- LIVE line whenever one changes, for the runner's real mouse and keyboard.

local input = smitten.input
local ui = require("love.scene.ui")
local uilayout = require("love.scene.uilayout")
local g = smitten.graphics

local passed, failed = 0, 0
local stage, canvas

local function check(name, ok, why)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. ": " .. tostring(why == nil and "not so" or why))
  end
end

local function near(a, b, tolerance)
  return type(a) == "number" and math.abs(a - b) <= (tolerance or 0.05)
end

-- Waits for the next frame (update() resumes this once a frame).
local function frame(n)
  for i = 1, n or 1 do coroutine.yield() end
end

local function clear()
  for i = #stage.children, 1, -1 do stage.children[i]:remove() end
  frame()
end

local function add(kind, props, parent)
  local n = (parent or stage):add(make(kind, props))
  if props and props.name then n.name = props.name end
  return n
end

-- The mouse: "pressed", "released" or "moved", at a place in game coordinates.
local function mouse(what, x, y)
  local wx, wy = smitten.display.toWindow(x, y)
  if what == "moved" then
    smitten.event.push("mousemoved", wx, wy, 0, 0, false)
  else
    smitten.event.push("mouse" .. what, wx, wy, 1, false, 1)
  end
end

local function click(x, y)
  mouse("moved", x, y)
  mouse("pressed", x, y)
  frame()
  mouse("released", x, y)
  frame()
end

local function key(name, isDown)
  smitten.event.push(isDown == false and "keyreleased" or "keypressed", name, name, false)
end

local function tap(name)
  key(name)
  frame()
  key(name, false)
  frame()
end

local function typeText(text)
  smitten.event.push("textinput", text)
  frame()
end

local function heard(n, event)
  local log = {}
  n:on(event, function(...) log[#log + 1] = { ... } end)
  return log
end

local function focusName()
  return ui.focused and ui.focused.name or "nothing"
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

-- "red", "green", "blue", "white", "black" or the numbers.
local function colorAt(data, x, y)
  local r, gr, b = data:getPixel(x, y)
  local hi, lo = 0.6, 0.3
  if r > hi and gr > hi and b > hi then return "white" end
  if r > hi and gr < lo and b < lo then return "red" end
  if gr > hi and r < lo and b < lo then return "green" end
  if b > hi and r < lo and gr < lo then return "blue" end
  if r < 0.1 and gr < 0.1 and b < 0.1 then return "black" end
  return ("%.2f %.2f %.2f"):format(r, gr, b)
end

local function lit(data, x, y)
  local r, gr, b = data:getPixel(x, y)
  return r + gr + b > 0.3
end

---------------------------------------------------------------------------

-- A tree of pieces from the fixture's { name, type, props, children }.
local function build(def, parent, byName)
  local n = parent:add(make(def.type, def.props))
  n.name = def.name
  byName[def.name] = n
  for _, c in ipairs(def.children or {}) do build(c, n, byName) end
end

local function layout()
  local fixture = smitten.assets.readJSON("layout-cases.json")
  check("layout: the screen is the fixture's", screenWidth() == fixture.screen[1] and screenHeight() == fixture.screen[2],
    screenWidth() .. " x " .. screenHeight())
  local wrong, count = 0, 0
  for _, case in ipairs(fixture.cases) do
    local byName = {}
    for _, def in ipairs(case.pieces) do build(def, stage, byName) end
    frame()
    local bad = nil
    for name, want in pairs(case.expect) do
      count += 1
      local x, y, w, h = byName[name]:getRect()
      if x ~= want[1] or y ~= want[2] or w ~= want[3] or h ~= want[4] then
        bad = `{name} is at {x}, {y}, {w} x {h}, not {want[1]}, {want[2]}, {want[3]} x {want[4]}`
      end
    end
    if bad then wrong += 1 end
    check("layout: " .. case.name, not bad, bad)
    clear()
  end
  check("layout: every case ran", #fixture.cases >= 25 and count > 100, #fixture.cases .. " cases, " .. count .. " pieces")

  -- Laid out again only when something changed.
  local row = add("Row", { x = 20, y = 20 })
  local a = add("Panel", { width = 50, height = 20 }, row)
  local b = add("Panel", { width = 50, height = 20 }, row)
  local arranges = 0
  local arrange = uilayout.arrange
  uilayout.arrange = function(...)
    arranges += 1
    return arrange(...)
  end
  frame(3)
  check("dirty: laid out once, then left alone", arranges == 1, arranges)
  a.width = 80
  frame(2)
  check("dirty: again when a piece's size changes", arranges == 2 and (b:getRect()) == 20 + 88, arranges)
  row.x = 40
  frame(2)
  check("dirty: not when the row only moves", arranges == 2 and (b:getRect()) == 40 + 88, arranges)
  local c = add("Panel", { width = 10, height = 10 }, row)
  frame(2)
  local _, _, rowW = row:getRect()
  check("dirty: a piece added while the game runs is placed", arranges == 3 and (c:getRect()) == 40 + 80 + 8 + 50 + 8 and rowW == 80 + 8 + 50 + 8 + 10, arranges)
  uilayout.arrange = arrange
  clear()
end

local function slider()
  local s = add("Slider", { name = "S", x = 100, y = 100, width = 200, height = 20 })
  local below = add("Button", { name = "Below", x = 100, y = 200 })
  local changes = heard(s, "changed")
  frame()
  -- The knob's middle runs from x = 110 to 290.
  mouse("moved", 155, 110)
  mouse("pressed", 155, 110)
  frame()
  check("slider: a press jumps to the pointer", near(s.value, 25), s.value)
  mouse("moved", 200, 110)
  frame()
  check("slider: a drag follows it", near(s.value, 50), s.value)
  mouse("moved", 245, 300)
  frame()
  check("slider: wherever the pointer goes", near(s.value, 75), s.value)
  mouse("released", 245, 300)
  frame()
  mouse("moved", 120, 110)
  frame()
  check("slider: let go, it stays", near(s.value, 75) and #changes == 3, s.value)
  check("slider: changed() gets the value", near(changes[3][1], 75))

  local data = shot()
  check("slider: the knob is drawn where the value is", colorAt(data, 110 + 135, 110) ~= "black" and colorAt(data, 110 + 135, 112) == colorAt(data, 110 + 135, 108))
  check("slider: no focus ring yet", not lit(data, 97, 110))

  s.step = 10
  mouse("pressed", 163, 110)
  frame()
  mouse("released", 163, 110)
  frame()
  check("slider: step snaps", s.value == 30, s.value)

  s:focus()
  frame()
  data = shot()
  check("slider: focused, it has a ring", s:isFocused() and lit(data, 97, 110))
  tap("right")
  check("slider: the right key adds a step", s.value == 40, s.value)
  tap("left")
  tap("left")
  check("slider: the left key takes one", s.value == 20, s.value)
  input.setStrength("right", 1)
  frame()
  input.setStrength("right", 0)
  frame()
  check("slider: so does a stick", s.value == 30, s.value)
  tap("down")
  check("slider: down goes to the piece below", focusName() == "Below", focusName())
  tap("up")
  check("slider: up comes back", s:isFocused())
  s.disabled = true
  mouse("pressed", 250, 110)
  frame()
  mouse("released", 250, 110)
  frame()
  check("slider: disabled doesn't move", s.value == 30, s.value)
  ui.setFocus(nil)
  clear()
end

local function checkbox()
  local c = add("Checkbox", { name = "C", x = 40, y = 40, text = "Music" })
  local choice = add("Column", { x = 40, y = 100 })
  local easy = add("Checkbox", { name = "Easy", group = "level", checked = true }, choice)
  local normal = add("Checkbox", { name = "Normal", group = "level" }, choice)
  local hard = add("Checkbox", { name = "Hard", group = "level" }, choice)
  local toggles = heard(c, "toggled")
  frame()
  local before = shot()
  click(50, 54)
  check("checkbox: a click ticks it", c.checked == true and #toggles == 1 and toggles[1][1] == true)
  local after = shot()
  check("checkbox: ticked, the box is its color", colorAt(before, 42, 50) ~= colorAt(after, 42, 50) and lit(after, 42, 50),
    colorAt(before, 42, 50) .. " then " .. colorAt(after, 42, 50))
  check("checkbox: its words are drawn", (function()
    for x = 70, 130 do
      for y = 44, 64 do
        if lit(after, x, y) then return true end
      end
    end
    return false
  end)())
  click(50, 54)
  check("checkbox: another click unticks it", c.checked == false and toggles[2][1] == false)
  mouse("pressed", 50, 54)
  frame()
  mouse("released", 400, 300)
  frame()
  check("checkbox: let go somewhere else, nothing happens", c.checked == false and #toggles == 2)

  local easyLog, normalLog = heard(easy, "toggled"), heard(normal, "toggled")
  local x, y = normal:getRect()
  click(x + 6, y + 6)
  check("group: ticking one unticks the other", normal.checked == true and easy.checked == false and hard.checked == false)
  check("group: both hear about it", #normalLog == 1 and normalLog[1][1] == true and #easyLog == 1 and easyLog[1][1] == false)
  click(x + 6, y + 6)
  check("group: the chosen one can't be unticked", normal.checked == true and #normalLog == 1)
  hard.checked = true
  frame(2)
  check("group: ticked by a script, the others go off", hard.checked == true and normal.checked == false)

  c:focus()
  frame()
  tap("return")
  check("checkbox: accept flips it", c.checked == true)
  tap("down")
  check("checkbox: down reaches the group", focusName() == "Easy", focusName())
  tap("space")
  check("group: accept chooses", easy.checked == true and hard.checked == false)
  ui.setFocus(nil)
  clear()
end

local function textInput()
  local above = add("Button", { name = "Above", x = 20, y = 10 })
  local t = add("TextInput", { name = "T", x = 20, y = 60, width = 200, height = 36 })
  local below = add("Button", { name = "Below", x = 20, y = 110 })
  local n = add("TextInput", { name = "N", x = 20, y = 160, allow = "numbers", maxLength = 6 })
  local changes, submits = heard(t, "changed"), heard(t, "submitted")
  local focuses, blurs = heard(t, "focused"), heard(t, "blurred")
  frame()

  click(120, 78)
  check("text: a click focuses it", t:isFocused() and #focuses == 1)
  check("text: text input is on", smitten.keyboard.hasTextInput() == true)
  typeText("Hello")
  check("text: typing", t.text == "Hello" and #changes == 1 and changes[1][1] == "Hello", t.text)
  check("text: it isn't the game's typing", typed() == "")
  key("w")
  frame()
  check("text: the game doesn't see keys typed into it", not pressed("up") and not down("up") and not smitten.keyboard.pressed("w"))
  key("w", false)
  key("backspace")
  frame()
  check("text: backspace", t.text == "Hell", t.text)
  key("left")
  key("left")
  frame()
  typeText("y")
  check("text: the arrows move the caret", t.text == "Heyll" and t:isFocused(), t.text)
  key("home")
  frame()
  typeText("¡")
  key("end")
  frame()
  typeText("é")
  check("text: Home, End and characters of several bytes", t.text == "¡Heyllé", t.text)
  key("backspace")
  frame()
  check("text: backspace takes a whole character", t.text == "¡Heyll", t.text)

  -- Selecting with Shift and the arrows; typing replaces it.
  key("lshift")
  key("left")
  key("left")
  key("lshift", false)
  frame()
  local data = shot()
  typeText("y!")
  check("text: typing replaces the selection", t.text == "¡Heyy!", t.text)
  key("lctrl")
  key("a")
  key("lctrl", false)
  frame()
  typeText("Ada")
  check("text: Ctrl+A selects everything", t.text == "Ada", t.text)
  data = shot()
  check("text: its words are drawn inside it", (function()
    for x = 28, 70 do
      for y = 66, 90 do
        local r, gr, b = data:getPixel(x, y)
        if r > 0.7 and gr > 0.7 and b > 0.7 then return true end
      end
    end
    return false
  end)())

  key("return")
  frame()
  check("text: Enter submits", #submits == 1 and submits[1][1] == "Ada" and t:isFocused())
  frame()
  check("text: Enter wasn't the game's accept", not pressed("accept") and not down("accept"))
  key("return", false)

  t.maxLength = 5
  typeText("Lovelace")
  check("text: maxLength", t.text == "AdaLo", t.text)
  t:selectAll()
  typeText("Countess")
  check("text: selectAll(), and a selection makes room", t.text == "Count", t.text)
  t.maxLength = 0

  -- Leaving.
  key("down")
  frame()
  key("down", false)
  check("text: Down leaves for the piece below", focusName() == "Below" and #blurs == 1, focusName())
  frame()
  tap("up")
  check("text: the arrows come back to it", t:isFocused() and #focuses == 2, focusName())
  key("tab")
  frame()
  key("tab", false)
  check("text: Tab goes to the next piece", focusName() == "Below", focusName())
  frame()
  tap("tab")
  check("text: and on to the next", focusName() == "N", focusName())
  typeText("a1b2")
  check("numbers: only digits", n.text == "12", n.text)
  typeText("-")
  typeText(".5.5")
  check("numbers: one decimal point, a minus only in front", n.text == "12.55", n.text)
  key("home")
  frame()
  typeText("-")
  typeText("9")
  check("numbers: a minus in front, and maxLength", n.text == "-12.55", n.text)
  key("escape")
  frame()
  check("text: Escape ends typing", ui.focused == nil and not pressed("pause") and not pressed("cancel"))
  key("escape", false)
  frame()
  typeText("x")
  check("text: nothing takes typing now", n.text == "-12.55" and t.text == "Count")
  click(120, 78)
  click(500, 300)
  check("text: a click elsewhere ends typing", ui.focused == nil and #blurs == 3, #blurs)
  t:focus()
  frame()
  t:blur()
  check("text: focus() and blur()", #focuses == 4 and #blurs == 4 and not t:isFocused())
  t.secret = true
  t.text = "pw"
  frame()
  check("text: a secret keeps its text", t.text == "pw")
  ui.setFocus(nil)
  clear()
end

local function focus()
  local menu = add("Column", { x = 20, y = 20 })
  add("Button", { name = "Play", autofocus = true }, menu)
  add("Slider", { name = "Volume" }, menu)
  add("Checkbox", { name = "Full" }, menu)
  add("TextInput", { name = "Name" }, menu)
  add("Button", { name = "Off", disabled = true }, menu)
  add("Button", { name = "Quit" }, menu)
  frame(2)
  local names = {}
  for i = 1, 5 do
    names[#names + 1] = focusName()
    tap("down")
  end
  check("focus: down reaches every piece and leaves the TextInput", table.concat(names, " ") == "Play Volume Full Name Quit", table.concat(names, " "))
  names = {}
  for i = 1, 5 do
    names[#names + 1] = focusName()
    tap("up")
  end
  check("focus: and up goes back", table.concat(names, " ") == "Quit Name Full Volume Play", table.concat(names, " "))
  local play = menu:find("Play")
  local presses = heard(play, "pressed")
  tap("return")
  check("focus: accept still presses a Button", #presses == 1)
  -- A gamepad's d-pad, as player 2's, on a menu that is player 2's.
  menu.player = 2
  input.press("down", 1)
  frame()
  input.release("down", 1)
  frame()
  check("focus: a menu with a player ignores the others", focusName() == "Play", focusName())
  input.press("down", 2)
  frame()
  input.release("down", 2)
  frame()
  check("focus: and follows its own", focusName() == "Volume", focusName())
  ui.setFocus(nil)
  clear()
end

local function skins()
  local panel = add("Panel", { x = 300, y = 200, width = 60, height = 40, skin = "art/skin.png", skinEdges = "4" })
  local button = add("Button", { x = 400, y = 200, width = 80, height = 30, text = "", skin = "art/skin.png", skinEdges = 4 })
  local wide = add("Panel", { x = 300, y = 260, width = 60, height = 40, skin = "art/skin.png", skinEdges = "2, 4, 6, 4" })
  frame()
  local data = shot()
  local function at(x, y) return colorAt(data, 300 + x, 200 + y) end
  check("skin: the corners keep their size", at(1, 1) == "red" and at(3, 3) == "red" and at(58, 38) == "red" and at(56, 36) == "red"
    and at(58, 1) == "red" and at(1, 38) == "red", at(1, 1) .. ", " .. at(3, 3) .. ", " .. at(58, 38))
  check("skin: the middle stretches between them", at(6, 6) == "white" and at(30, 20) == "white" and at(53, 33) == "white",
    at(6, 6) .. ", " .. at(30, 20) .. ", " .. at(53, 33))
  check("skin: the edges stretch along themselves only", at(30, 1) == "green" and at(30, 38) == "green" and at(6, 2) == "green"
    and at(1, 20) == "blue" and at(58, 20) == "blue" and at(2, 6) == "blue", at(30, 1) .. ", " .. at(1, 20))
  check("skin: nothing is drawn outside the piece", colorAt(data, 299, 220) == "black" and colorAt(data, 361, 220) == "black")
  check("skin: a Button's, with edges as a number", colorAt(data, 401, 201) == "red" and colorAt(data, 478, 228) == "red"
    and colorAt(data, 440, 215) == "white" and colorAt(data, 440, 201) == "green", colorAt(data, 401, 201) .. ", " .. colorAt(data, 440, 215))
  -- left 2, top 4, right 6, bottom 4: the picture's left 2 pixels are all corner.
  -- (The picture's top edge between them holds red and green; its right 6
  -- pixels, drawn as they are, hold 2 of green then 4 of red.)
  check("skin: four different edges", colorAt(data, 301, 261) == "red" and colorAt(data, 345, 261) == "green"
    and colorAt(data, 355, 262) == "green" and colorAt(data, 357, 262) == "red", colorAt(data, 345, 261) .. ", " .. colorAt(data, 355, 262) .. ", " .. colorAt(data, 357, 262))
  panel.skin = ""
  panel.color = { 0, 1, 0, 1 }
  panel.borderWidth = 0
  frame()
  data = shot()
  check("skin: without one, a Panel is its color as before", colorAt(data, 330, 220) == "green", colorAt(data, 330, 220))
  clear()
end

local function scroll()
  local list = add("Scroll", { name = "List", x = 400, y = 100, width = 100, height = 60, gap = 0 })
  local colors = { { 1, 0, 0, 1 }, { 0, 1, 0, 1 }, { 0, 0, 1, 1 } }
  local items = {}
  for i = 1, 3 do
    items[i] = add("Panel", { name = "Item" .. i, height = 40, color = colors[i], cornerRadius = 0, borderWidth = 0 }, list)
  end
  local scrolls = heard(list, "scrolled")
  frame()
  local data = shot()
  check("scroll: shows the top of its list", colorAt(data, 450, 110) == "red" and colorAt(data, 450, 150) == "green",
    colorAt(data, 450, 110) .. ", " .. colorAt(data, 450, 150))
  check("scroll: cuts off what doesn't fit", colorAt(data, 450, 165) == "black" and colorAt(data, 450, 95) == "black", colorAt(data, 450, 165))
  local _, limit = list:scrollLimit()
  check("scroll: how far it can go", limit == 60, limit)

  mouse("moved", 450, 130)
  smitten.event.push("wheelmoved", 0, -1)
  frame(2)
  check("scroll: the wheel scrolls it", list.scrollY == 48 and #scrolls == 1 and scrolls[1][2] == 48, list.scrollY)
  data = shot()
  check("scroll: the list moved up", colorAt(data, 450, 101) == "green" and colorAt(data, 450, 155) == "blue" and colorAt(data, 450, 165) == "black",
    colorAt(data, 450, 101) .. ", " .. colorAt(data, 450, 155))
  local presses = heard(items[1], "pressed")
  click(450, 90)
  check("scroll: a piece scrolled out of sight can't be clicked", #presses == 0)
  mouse("moved", 100, 300)
  smitten.event.push("wheelmoved", 0, -1)
  frame(2)
  check("scroll: the wheel elsewhere leaves it", list.scrollY == 48, list.scrollY)

  -- A drag scrolls and doesn't click.
  list.scrollY = 0
  frame()
  local clicks = heard(items[2], "pressed")
  mouse("moved", 450, 150)
  mouse("pressed", 450, 150)
  frame()
  mouse("moved", 450, 120)
  frame(2)
  check("scroll: a drag moves it with the pointer", near(list.scrollY, 30, 0.5), list.scrollY)
  mouse("released", 450, 120)
  frame(2)
  check("scroll: and nothing was clicked", #clicks == 0)
  frame(30)
  list.scrollY = 0
  frame()
  click(450, 150)
  check("scroll: a click inside still clicks", #clicks == 1, #clicks)

  -- scrollTo, and the focus brings a piece into sight.
  list:scrollTo(items[3])
  frame(2)
  local _, y, _, h = items[3]:getRect()
  check("scroll: scrollTo() shows a piece", y >= 100 and y + h <= 160, y)
  clear()
  list = add("Scroll", { x = 400, y = 100, width = 120, height = 80 })
  for i = 1, 8 do add("Button", { name = "B" .. i, height = 30 }, list) end
  frame()
  list:find("B1"):focus()
  frame()
  for i = 1, 5 do tap("down") end
  local f = ui.focused
  _, y, _, h = f:getRect()
  check("scroll: the focus goes down the list and the list follows", f.name == "B6" and y >= 100 and y + h <= 180, f.name .. " at " .. y)
  ui.setFocus(nil)
  clear()
end

-- Label, Button, Panel, Picture and Bar as they always were.
local function asBefore()
  local panel = add("Panel", { x = 20, y = 20, width = 300, height = 200 })
  local a = add("Button", { name = "A", x = 10, y = 10 }, panel)
  local b = add("Button", { name = "B", x = 10, y = 60, autofocus = true }, panel)
  local bar = add("Bar", { anchor = "bottomRight", x = 8, y = 8, width = 100, height = 12 }, panel)
  local pa, pb, pp = heard(a, "pressed"), heard(b, "pressed"), heard(panel, "pressed")
  frame(2)
  local x, y, w, h = bar:getRect()
  check("before: anchors inside a Panel", x == 20 + 300 - 8 - 100 and y == 20 + 200 - 8 - 12 and w == 100 and h == 12, `{x}, {y}`)
  check("before: autofocus", b:isFocused())
  click(40, 40)
  check("before: a click presses a Button and takes the focus", #pa == 1 and a:isFocused())
  click(280, 150)
  check("before: a click on the Panel is the Panel's", #pp == 1 and #pa == 1)
  mouse("pressed", 40, 40)
  frame()
  check("before: held down", a:isDown())
  mouse("released", 40, 90)
  frame()
  check("before: let go over another, neither is pressed", #pa == 1 and #pb == 0 and not a:isDown())
  tap("down")
  check("before: arrows move the focus", b:isFocused())
  tap("space")
  check("before: accept presses", #pb == 1)
  ui.setFocus(nil)
  clear()
end

---------------------------------------------------------------------------

local run, finished, live
local last = ""

local function all()
  stage = find("Stage")
  canvas = g.newCanvas(640, 360, { dpiscale = 1 })
  frame()
  for _, part in ipairs({ { "layout", layout }, { "slider", slider }, { "checkbox", checkbox }, { "text", textInput },
    { "focus", focus }, { "skins", skins }, { "scroll", scroll }, { "before", asBefore } }) do
    local ok, err = pcall(part[2])
    if not ok then
      check("the " .. part[1] .. " checks stopped", false, err)
      ui.setFocus(nil)
      for i = #stage.children, 1, -1 do stage.children[i]:remove() end
    end
  end
  print(`DONE {passed} passed, {failed} failed`)
  -- For the runner's real mouse and keyboard.
  live = {
    text = add("TextInput", { name = "LiveText", x = 20, y = 20, width = 200, height = 36 }),
    slider = add("Slider", { name = "LiveSlider", x = 20, y = 80, width = 200, height = 24 }),
    check = add("Checkbox", { name = "LiveCheck", x = 20, y = 130 }),
  }
  finished = true
end

function update(dt)
  if not run then run = coroutine.wrap(all) end
  if not finished then
    run()
    return
  end
  local line = ("LIVE text=[%s] slider=%d check=%s focus=%s"):format(live.text.text, math.floor(live.slider.value + 0.5), tostring(live.check.checked), focusName())
  if line ~= last then
    last = line
    print(line)
  end
end
