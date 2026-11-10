-- Tests for the UI pieces' own logic under plain Lua 5.1: the engine's real
-- ui.lua, uilayout.lua, widgets.lua and textinput.lua, with drawing stubbed
-- out and a made-up font (every character half its size wide). From the
-- repository's root:
--
--   lua5.1 tools/ui-tests/test.lua
--
-- Layout is checked against tools/scene-tests/ui/layout-cases.json, the
-- cases the editor's copy (uilayout.js) and the built engine (the "ui"
-- scene test) are checked with too.

local root = (arg and arg[0] or ""):match("^(.*)tools[/\\]ui%-tests[/\\]") or ""
local modules = root .. "love/src/modules/"

local function read(path)
	local f = assert(io.open(path, "rb"), "can't open " .. path)
	local s = f:read("*a")
	f:close()
	return s
end

table.insert(package.loaders, 2, function(name)
	local dir, file = name:match("^love%.(%w+)%.?(%w*)$")
	if not dir then return nil end
	if file == "" then file = "init" end
	local path = modules .. dir .. "/" .. file .. ".lua"
	local f = io.open(path, "r")
	if not f then return "\n\tno file " .. path end
	f:close()
	return assert(loadfile(path))
end)

-- The engine, as far as the UI's logic needs it ---------------------------

local now = 0
local mouseX, mouseY = 0, 0
local textInput, textArea, keyRepeat = false, nil, false
local clipboardText = ""
local osName = "Linux"

local noop = function() end
local graphics = setmetatable({
	getScissor = function() return nil end,
	transformPoint = function(x, y) return x, y end,
	newQuad = function() return {} end,
}, { __index = function() return noop end })

love = {
	graphics = graphics,
	timer = { getTime = function() return now end },
	mouse = { getPosition = function() return mouseX, mouseY end },
	keyboard = {
		hasTextInput = function() return textInput end,
		setTextInput = function(on, x, y, w, h)
			textInput = on
			textArea = on and x and { x, y, w, h } or nil
		end,
		hasKeyRepeat = function() return keyRepeat end,
		setKeyRepeat = function(on) keyRepeat = on end,
		isDown = function() return false end,
	},
	system = {
		getOS = function() return osName end,
		getClipboardText = function() return clipboardText end,
		setClipboardText = function(t) clipboardText = t end,
	},
}

local fonts = {}
local function font(path, size)
	local key = tostring(path) .. "#" .. size
	local f = fonts[key]
	if not f then
		f = { size = size }
		function f:getWidth(s)
			local n = 0
			for _ in s:gmatch("[%z\1-\127\194-\244][\128-\191]*") do n = n + 1 end
			return n * self.size / 2
		end
		function f:getHeight() return self.size end
		function f:getWrap(s) return self:getWidth(s), { s } end
		function f:hasGlyphs() return true end
		fonts[key] = f
	end
	return f, 1
end

package.loaded["love.assets"] = {
	font = font,
	image = function(path)
		return { path = path, getDimensions = function() return 24, 24 end }
	end,
}
package.loaded["love.display"] = {
	viewX = 0, viewY = 0, viewWidth = 640, viewHeight = 360, scale = 1,
	toGame = function(x, y) return x, y end,
	toWindow = function(x, y) return x * 2, y * 2 end,
}
package.loaded["love.scene.nodes2d"] = { textScale = 1 }
package.loaded["love.scene.script"] = { playerOf = function(n) return n.testPlayer end }
local json = require("love.json")
package.loaded["love.scene.schema"] = json.decode(read(modules .. "scene/pieces.json"))

local nodeLib = require("love.scene.node")
local ui = require("love.scene.ui")
require("love.scene.widgets")
require("love.scene.textinput")
local uilayout = require("love.scene.uilayout")
local input = require("love.input")
input._configure(nil)

local passed, failed = 0, 0
local function check(name, ok, detail)
	if ok then
		passed = passed + 1
	else
		failed = failed + 1
		print("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
	end
end
local function eq(name, got, want)
	check(name, got == want, ("got %s, wanted %s"):format(tostring(got), tostring(want)))
end

-- A tree of pieces from { name, type, props, children }.
local function build(def, parent)
	local props = {}
	for k, v in pairs(def.props or {}) do props[k] = v end
	local n = nodeLib.new(def.type, nil, props)
	n.name = def.name
	if parent then parent:add(n) end
	for _, c in ipairs(def.children or {}) do build(c, n) end
	return n
end

local function byName(n, name)
	if n.name == name then return n end
	for _, c in ipairs(n.children) do
		local found = byName(c, name)
		if found then return found end
	end
end

local function stage(pieces)
	ui.setFocus(nil)
	local top = nodeLib.new("Group")
	top.name = "Screen"
	for _, def in ipairs(pieces) do build(def, top) end
	nodeLib.enterTree(top)
	return top
end

local function rectText(r)
	return r and ("[%s, %s, %s, %s]"):format(tostring(r[1]), tostring(r[2]), tostring(r[3]), tostring(r[4])) or "nothing"
end

-- One frame: draw (which places everything), then the UI's update.
local function frame(top, seconds)
	now = now + (seconds or 1 / 60)
	ui.render(top)
	ui.update(top)
	input._endFrame()
end

local function key(name, isDown)
	local kind = isDown == false and "keyreleased" or "keypressed"
	-- As love.engine does: a TextInput with the focus takes keys first.
	if kind == "keypressed" and ui.focused and ui.keyEvent(kind, name, name, false) then return end
	input._event(kind, name, name, false)
end

local function tap(top, name)
	key(name)
	frame(top)
	key(name, false)
	frame(top)
end

local function typeText(str)
	if not (ui.focused and ui.keyEvent("textinput", str)) then input._event("textinput", str) end
end

local function click(top, x, y)
	mouseX, mouseY = x, y
	ui.render(top)
	ui.input(top, "pressed", x, y, 1)
	frame(top)
	ui.input(top, "released", x, y, 1)
	frame(top)
end

local function heard(n, event)
	local log = {}
	n:on(event, function(...) log[#log + 1] = { ... } end)
	return log
end

-- Layout: the shared cases -------------------------------------------------

local fixture = json.decode(read(root .. "tools/scene-tests/ui/layout-cases.json"))
for _, case in ipairs(fixture.cases) do
	local top = stage(case.pieces)
	ui.render(top)
	local count = 0
	for name, want in pairs(case.expect) do
		count = count + 1
		local n = byName(top, name)
		local got = n and n._rect
		check("layout: " .. case.name .. ": " .. name, got ~= nil and got[1] == want[1] and got[2] == want[2] and got[3] == want[3] and got[4] == want[4],
			"got " .. rectText(got) .. ", wanted " .. rectText(want))
	end
	check("layout: " .. case.name .. " has pieces", count > 0)
	-- A second frame changes nothing, and lays nothing out again.
	local arranges = 0
	local arrange = uilayout.arrange
	uilayout.arrange = function(...)
		arranges = arranges + 1
		return arrange(...)
	end
	ui.render(top)
	uilayout.arrange = arrange
	eq("layout: " .. case.name .. ": nothing is laid out again when nothing changed", arranges, 0)
end

-- Layout runs again when something changes, and only then.
do
	local top = stage({ { name = "Row", type = "Row", props = {}, children = {
		{ name = "A", type = "Panel", props = { width = 50, height = 20 } },
		{ name = "B", type = "Panel", props = { width = 50, height = 20 } },
	} } })
	local row, a, b = byName(top, "Row"), byName(top, "A"), byName(top, "B")
	local arranges = 0
	local arrange = uilayout.arrange
	uilayout.arrange = function(...)
		arranges = arranges + 1
		return arrange(...)
	end
	ui.render(top)
	eq("dirty: the first frame lays out once", arranges, 1)
	ui.render(top)
	ui.render(top)
	eq("dirty: quiet frames don't", arranges, 1)
	a.width = 80
	ui.render(top)
	eq("dirty: a piece's size does", arranges, 2)
	eq("dirty: the next piece moved", b._rect[1], 88)
	row.gap = 0
	ui.render(top)
	eq("dirty: the container's setting does", b._rect[1], 80)
	local c = row:add(nodeLib.new("Panel", nil, { width = 10, height = 10 }))
	ui.render(top)
	eq("dirty: a new piece is placed", c._rect[1], 130)
	eq("dirty: the row grew to hold it", row._rect[3], 140)
	a.visible = false
	ui.render(top)
	eq("dirty: hiding a piece closes the gap", b._rect[1], 0)
	a.visible = true
	b:remove()
	ui.render(top)
	eq("dirty: removing one too", c._rect[1], 80)
	local before = arranges
	row.x = 30
	ui.render(top)
	eq("dirty: moving the row doesn't lay it out again", arranges, before)
	eq("dirty: but its pieces move with it", c._rect[1], 110)
	uilayout.arrange = arrange
end

-- Slider -------------------------------------------------------------------

do
	local top = stage({
		{ name = "S", type = "Slider", props = { x = 100, y = 100, width = 200, height = 20 } },
		{ name = "V", type = "Slider", props = { x = 400, y = 50, width = 20, height = 200, vertical = true, min = 0, max = 10, step = 1, value = 0 } },
		{ name = "B", type = "Button", props = { x = 100, y = 200 } },
	})
	local s, v, b = byName(top, "S"), byName(top, "V"), byName(top, "B")
	local changes = heard(s, "changed")
	frame(top)
	-- The knob's middle runs from x = 110 to 290.
	mouseX, mouseY = 155, 110
	ui.input(top, "pressed", 155, 110, 1)
	eq("slider: a press jumps to the pointer", s.value, 25)
	mouseX = 200
	frame(top)
	eq("slider: a drag follows it", s.value, 50)
	mouseX, mouseY = 900, 300
	frame(top)
	eq("slider: and stops at the end", s.value, 100)
	ui.input(top, "released", 900, 300, 1)
	mouseX = 100
	frame(top)
	eq("slider: let go, it stays", s.value, 100)
	eq("slider: changed() for each change", #changes, 3)
	eq("slider: changed() gets the value", changes[3][1], 100)

	s.step = 10
	ui.input(top, "pressed", 163, 110, 1)
	eq("slider: step snaps", s.value, 30)
	ui.input(top, "released", 163, 110, 1)

	ui.input(top, "pressed", 410, 132, 1)
	eq("slider: vertical, up is more", v.value, 6)
	ui.input(top, "released", 410, 132, 1)

	s.disabled = true
	ui.input(top, "pressed", 250, 110, 1)
	frame(top)
	eq("slider: disabled doesn't move", s.value, 30)
	ui.input(top, "released", 250, 110, 1)
	s.disabled = false

	-- The keyboard: along the slider moves it, across it moves the focus.
	s:focus()
	frame(top)
	check("slider: focus()", s:isFocused())
	tap(top, "right")
	eq("slider: right adds a step", s.value, 40)
	tap(top, "left")
	tap(top, "left")
	eq("slider: left takes one", s.value, 20)
	key("right")
	frame(top)
	for i = 1, 60 do frame(top) end
	key("right", false)
	frame(top)
	check("slider: a held key repeats", s.value > 60 and s.value <= 100, s.value)
	tap(top, "down")
	check("slider: down goes to the piece below", b:isFocused())
	tap(top, "up")
	check("slider: and up comes back", s:isFocused())
	s.step = 0
	s.value = 50
	tap(top, "right")
	eq("slider: with no step, a key moves a twentieth", s.value, 55)
	v:focus()
	tap(top, "up")
	eq("slider: vertical, up adds", v.value, 7)
	tap(top, "left")
	check("slider: vertical, left leaves", s:isFocused() or b:isFocused())
end

-- Checkbox -----------------------------------------------------------------

do
	local top = stage({
		{ name = "C", type = "Checkbox", props = { x = 10, y = 10 } },
		{ name = "Choice", type = "Column", props = { x = 10, y = 100 }, children = {
			{ name = "Easy", type = "Checkbox", props = { group = "level", checked = true } },
			{ name = "Normal", type = "Checkbox", props = { group = "level" } },
			{ name = "Hard", type = "Checkbox", props = { group = "level" } },
			{ name = "Other", type = "Checkbox", props = { group = "other", checked = true } },
			{ name = "Alone", type = "Checkbox", props = {} },
		} },
	})
	local c = byName(top, "C")
	local easy, normal, hard, other = byName(top, "Easy"), byName(top, "Normal"), byName(top, "Hard"), byName(top, "Other")
	local toggles = heard(c, "toggled")
	frame(top)
	click(top, 20, 20)
	check("checkbox: a click ticks it", c.checked == true)
	eq("checkbox: toggled(true)", toggles[1] and toggles[1][1], true)
	click(top, 20, 20)
	check("checkbox: another unticks it", c.checked == false and toggles[2][1] == false)
	mouseX, mouseY = 20, 20
	ui.input(top, "pressed", 20, 20, 1)
	ui.input(top, "released", 400, 300, 1)
	check("checkbox: let go somewhere else, nothing happens", c.checked == false)
	c.disabled = true
	click(top, 20, 20)
	check("checkbox: disabled doesn't tick", c.checked == false)
	c.disabled = false
	c:toggle()
	check("checkbox: toggle()", c.checked == true and #toggles == 3)

	-- A group is a choice.
	local easyLog, normalLog = heard(easy, "toggled"), heard(normal, "toggled")
	local r = normal._rect
	click(top, r[1] + 5, r[2] + 5)
	check("group: ticking one unticks the other", normal.checked == true and easy.checked == false and hard.checked == false)
	check("group: both hear about it", #normalLog == 1 and normalLog[1][1] == true and #easyLog == 1 and easyLog[1][1] == false)
	check("group: another group is left alone", other.checked == true)
	click(top, r[1] + 5, r[2] + 5)
	check("group: the chosen one can't be unticked", normal.checked == true and #normalLog == 1)
	hard.checked = true
	frame(top)
	check("group: ticked by a script, the others go off", hard.checked == true and normal.checked == false and #normalLog == 2)

	-- The keyboard.
	c:focus()
	frame(top)
	tap(top, "return")
	check("checkbox: accept flips it", c.checked == false)
	tap(top, "down")
	check("checkbox: down reaches the group", easy:isFocused(), ui.focused and ui.focused.name)
	tap(top, "space")
	check("group: accept chooses", easy.checked == true and hard.checked == false)
end

-- TextInput ----------------------------------------------------------------

do
	local top = stage({
		{ name = "Above", type = "Button", props = { x = 20, y = 10 } },
		{ name = "T", type = "TextInput", props = { x = 20, y = 60, width = 200, height = 36, size = 20 } },
		{ name = "Below", type = "Button", props = { x = 20, y = 110 } },
		{ name = "N", type = "TextInput", props = { x = 20, y = 160, allow = "numbers", maxLength = 6 } },
		{ name = "M", type = "TextInput", props = { x = 300, y = 10, width = 116, height = 120, size = 20, multiline = true } },
	})
	local t, n, m = byName(top, "T"), byName(top, "N"), byName(top, "M")
	local above, below = byName(top, "Above"), byName(top, "Below")
	local changes, submits = heard(t, "changed"), heard(t, "submitted")
	local focuses, blurs = heard(t, "focused"), heard(t, "blurred")
	frame(top)
	check("text: typing goes to the game while nothing has the focus", not ui.keyEvent("textinput", "x"))

	click(top, 30, 70)
	check("text: a click focuses it", t:isFocused() and #focuses == 1)
	check("text: and turns text input on, over the box", textInput == true and textArea ~= nil and textArea[1] == 40 and textArea[2] == 120
		and textArea[3] == 400 and textArea[4] == 72, textArea and table.concat(textArea, ","))
	check("text: keys repeat while typing", keyRepeat == true)
	typeText("Hello")
	eq("text: typing", t.text, "Hello")
	eq("text: changed() for each", #changes, 1)
	eq("text: changed() gets the text", changes[1][1], "Hello")
	key("w")
	frame(top)
	check("text: the game doesn't see keys typed into it", not input.pressed("up") and not input._rawDown("w"))
	key("w", false)
	key("backspace")
	eq("text: backspace", t.text, "Hell")
	key("left")
	key("left")
	typeText("y")
	eq("text: typing at the caret", t.text, "Heyll")
	key("delete")
	eq("text: delete", t.text, "Heyl")
	key("home")
	typeText("¡")
	key("end")
	typeText("é!")
	eq("text: home and end, and characters of several bytes", t.text, "¡Heylé!")
	key("backspace")
	key("backspace")
	eq("text: backspace takes a whole character", t.text, "¡Heyl")

	-- Selecting with Shift and the arrows; typing replaces it.
	key("lshift")
	key("left")
	key("left")
	key("lshift", false)
	typeText("LLO")
	eq("text: typing replaces the selection", t.text, "¡HeLLO")
	key("lctrl")
	key("a")
	key("lctrl", false)
	typeText("one two  three")
	eq("text: Ctrl+A selects everything", t.text, "one two  three")
	key("lctrl")
	key("left")
	key("lshift")
	key("left")
	key("lshift", false)
	key("c")
	eq("text: Ctrl+Left jumps a word, Ctrl+C copies the selection", clipboardText, "two  ")
	key("x")
	eq("text: Ctrl+X cuts", t.text, "one three")
	key("end")
	key("v")
	eq("text: Ctrl+V pastes", t.text, "one threetwo  ")
	key("backspace")
	eq("text: Ctrl+Backspace takes a word", t.text, "one ")
	key("lctrl", false)
	t:selectAll()
	key("backspace")
	eq("text: selectAll()", t.text, "")

	-- The mouse: a click puts the caret, a drag selects. Characters are 10
	-- wide and the text starts 8 in.
	typeText("0123456789")
	click(top, 20 + 8 + 31, 75)
	typeText("x")
	eq("text: a click puts the caret", t.text, "012x3456789")
	mouseX, mouseY = 20 + 8 + 10, 75
	ui.input(top, "pressed", mouseX, mouseY, 1)
	mouseX = 20 + 8 + 40
	frame(top)
	ui.input(top, "released", mouseX, mouseY, 1)
	typeText("-")
	eq("text: a drag selects", t.text, "0-3456789")

	-- Enter, and leaving.
	key("return")
	check("text: Enter submits", #submits == 1 and submits[1][1] == "0-3456789")
	key("down")
	frame(top)
	check("text: Down leaves for the piece below", below:isFocused() and #blurs == 1, ui.focused and ui.focused.name)
	check("text: text input goes back to how it was", textInput == false and keyRepeat == false)
	tap(top, "up")
	check("text: the arrows come back to it", t:isFocused() and #focuses == 2)
	key("up")
	frame(top)
	check("text: Up leaves for the piece above", above:isFocused())
	t:focus()
	key("escape")
	check("text: Escape ends typing", ui.focused == nil and #blurs == 3)
	frame(top)
	check("text: Escape wasn't the game's", not input._rawDown("escape"))
	key("escape", false)
	t:focus()
	key("tab")
	check("text: Tab goes to the next piece", below:isFocused(), ui.focused and ui.focused.name)
	tap(top, "tab")
	check("text: and on to the next", n:isFocused(), ui.focused and ui.focused.name)
	key("lshift")
	key("tab")
	key("tab")
	frame(top)
	key("lshift", false)
	key("tab", false)
	check("text: Shift+Tab goes back", t:isFocused(), ui.focused and ui.focused.name)
	t:blur()
	check("text: blur()", not t:isFocused())
	click(top, 30, 70)
	click(top, 600, 300)
	check("text: a click elsewhere ends typing", ui.focused == nil)
	t:focus()
	input.press("cancel")
	frame(top)
	input.release("cancel")
	frame(top)
	check("text: cancel (gamepad B) ends typing", ui.focused == nil)

	-- What it takes.
	t.text = ""
	t.maxLength = 5
	t:focus()
	typeText("abcdefgh")
	eq("text: maxLength cuts what's typed", t.text, "abcde")
	typeText("z")
	eq("text: and takes no more", t.text, "abcde")
	t:selectAll()
	typeText("12345678")
	eq("text: but a selection makes room", t.text, "12345")
	t.maxLength = 0
	t.text = ""
	typeText("a\nb\tc")
	eq("text: one line takes no line breaks or tabs", t.text, "abc")
	t.text = "set"
	typeText("!")
	eq("text: set by a script, the caret stays in it", t.text, "set!")
	t.secret = true
	t:selectAll()
	clipboardText = "kept"
	key("lctrl")
	key("c")
	key("lctrl", false)
	eq("text: a secret isn't copied", clipboardText, "kept")
	t.secret = false
	t.disabled = true
	frame(top)
	check("text: disabled can't be typed in", not ui.keyEvent("textinput", "x") and t.text == "set!")
	t.disabled = false

	n:focus()
	typeText("a1b2")
	eq("numbers: only digits", n.text, "12")
	typeText("-")
	eq("numbers: a minus only in front", n.text, "12")
	typeText(".5.5")
	eq("numbers: one decimal point", n.text, "12.55")
	key("home")
	typeText("-")
	eq("numbers: a minus in front", n.text, "-12.55")
	typeText("9")
	eq("numbers: maxLength", n.text, "-12.55")
	n.allow = "letters"
	n.text = ""
	n.maxLength = 0
	typeText("a b-c_9é")
	eq("letters: letters and digits", n.text, "abc9é")
	n.allow = "only"
	n.allowCharacters = "abc"
	n.text = ""
	typeText("cabbage")
	eq("only: the characters listed", n.text, "cabba")

	-- Several lines: 100 wide inside, so 10 characters to a line.
	m:focus()
	typeText("one two three four")
	key("return")
	typeText("x")
	eq("multiline: Enter is a line break", m.text, "one two three four\nx")
	local submitted = heard(m, "submitted")
	key("lctrl")
	key("return")
	key("lctrl", false)
	eq("multiline: Ctrl+Enter submits", #submitted, 1)
	key("up")
	key("home")
	typeText("_")
	eq("multiline: Up and Home go to the start of the wrapped line above", m.text, "one two _three four\nx")
	key("up")
	check("multiline: Up moves between its lines", m:isFocused())
	key("lctrl")
	key("end")
	key("lctrl", false)
	typeText("!")
	eq("multiline: Ctrl+End", m.text, "one two _three four\nx!")
	click(top, 300 + 8 + 21, 10 + 6 + 30)
	typeText("#")
	eq("multiline: a click on the second line", m.text, "one two _t#hree four\nx!")

	-- Leaving the scene with the focus.
	m:focus()
	local gone = heard(m, "blurred")
	m:destroy()
	m:remove()
	check("text: removed while typing, text input goes off", textInput == false and ui.focused == nil and #gone == 0)
end

-- Focus --------------------------------------------------------------------

do
	local top = stage({
		{ name = "Menu", type = "Column", props = { x = 20, y = 20 }, children = {
			{ name = "Play", type = "Button", props = { autofocus = true } },
			{ name = "Volume", type = "Slider", props = {} },
			{ name = "Full", type = "Checkbox", props = {} },
			{ name = "Name", type = "TextInput", props = {} },
			{ name = "Off", type = "Button", props = { disabled = true } },
			{ name = "Quit", type = "Button", props = {} },
		} },
	})
	local names = {}
	frame(top)
	frame(top)
	for i = 1, 5 do
		names[#names + 1] = ui.focused and ui.focused.name or "nothing"
		if ui.focused and ui.focused.type == "TextInput" then
			key("down")
			frame(top)
		else
			tap(top, "down")
		end
	end
	eq("focus: down reaches every piece that can have it", table.concat(names, " "), "Play Volume Full Name Quit")
	local play = byName(top, "Play")
	local presses = heard(play, "pressed")
	play:focus()
	tap(top, "return")
	eq("focus: accept still presses a Button", #presses, 1)
	-- With a player on the piece, only that player works it.
	play.testPlayer = 2
	input.press("down", 1)
	frame(top)
	input.release("down", 1)
	frame(top)
	check("focus: another player's input is ignored", play:isFocused())
	input.press("down", 2)
	frame(top)
	input.release("down", 2)
	frame(top)
	check("focus: the piece's player moves it", byName(top, "Volume"):isFocused())
end

-- Scroll -------------------------------------------------------------------

do
	local items = {}
	for i = 1, 10 do items[i] = { name = "Item" .. i, type = "Button", props = { height = 30 } } end
	local top = stage({ { name = "List", type = "Scroll", props = { x = 100, y = 100, width = 200, height = 100, gap = 10 }, children = items } })
	local list = byName(top, "List")
	local scrolls = heard(list, "scrolled")
	frame(top)
	local _, limit = list:scrollLimit()
	eq("scroll: how far it goes", limit, 10 * 30 + 9 * 10 - 100)
	mouseX, mouseY = 150, 150
	frame(top)
	check("scroll: the wheel scrolls it", ui.wheel(0, -1) and list.scrollY == 48 and #scrolls == 1)
	frame(top)
	eq("scroll: the pieces move up", byName(top, "Item1")._rect[2], 100 - 48)
	mouseX, mouseY = 500, 300
	frame(top)
	check("scroll: not when the pointer is elsewhere", not ui.wheel(0, -1) and list.scrollY == 48)
	-- Only what shows answers the pointer.
	check("scroll: a piece scrolled out of sight can't be clicked", ui.pick(150, 90, false) == nil)
	eq("scroll: one in sight can", ui.pick(150, 105, false), byName(top, "Item2"))
	local item3 = byName(top, "Item3")
	local presses = heard(item3, "pressed")
	local r = item3._rect
	click(top, 150, r[2] + 5)
	eq("scroll: a click inside still clicks", #presses, 1)
	-- A drag scrolls instead of clicking.
	list.scrollY = 0
	frame(top)
	mouseX, mouseY = 150, 190
	ui.input(top, "pressed", 150, 190, 1)
	frame(top)
	mouseY = 150
	frame(top)
	mouseY = 140
	frame(top)
	eq("scroll: a drag moves it with the pointer", list.scrollY, 50)
	ui.input(top, "released", 150, 140, 1)
	eq("scroll: and nothing was clicked", #presses, 1)
	for i = 1, 200 do frame(top) end
	check("scroll: let go while moving, it glides on and stops", list.scrollY > 50 and list.scrollY <= limit, list.scrollY)
	-- scrollTo, and the focus.
	list.scrollY = 0
	frame(top)
	list:scrollTo(byName(top, "Item9"))
	frame(top)
	local r9 = byName(top, "Item9")._rect
	check("scroll: scrollTo() brings a piece into sight", r9[2] >= 100 and r9[2] + r9[4] <= 200, rectText(r9))
	list.scrollY = 0
	byName(top, "Item1"):focus()
	frame(top)
	for i = 1, 6 do tap(top, "down") end
	local f = ui.focused
	check("scroll: the focus goes down the list and the list follows", f == byName(top, "Item7") and f._rect[2] >= 100 and f._rect[2] + f._rect[4] <= 200,
		f and (f.name .. " " .. rectText(f._rect)))
	local ok, err = pcall(list.scrollTo, list, top)
	check("scroll: scrollTo() says when the piece isn't inside", not ok and tostring(err):find("isn't inside", 1, true) ~= nil, err)
end

-- Buttons, Panels and Pictures as they always were --------------------------

do
	local top = stage({
		{ name = "Panel", type = "Panel", props = { x = 0, y = 0, width = 300, height = 200 }, children = {
			{ name = "A", type = "Button", props = { x = 10, y = 10 } },
			{ name = "B", type = "Button", props = { x = 10, y = 60, autofocus = true } },
		} },
	})
	local panel, a, b = byName(top, "Panel"), byName(top, "A"), byName(top, "B")
	local pa, pb, pp = heard(a, "pressed"), heard(b, "pressed"), heard(panel, "pressed")
	frame(top)
	frame(top)
	check("button: autofocus", b:isFocused())
	click(top, 20, 20)
	check("button: a click presses it and takes the focus", #pa == 1 and a:isFocused())
	click(top, 250, 150)
	check("panel: a click on the panel is the panel's", #pp == 1 and #pa == 1)
	mouseX, mouseY = 20, 20
	ui.input(top, "pressed", 20, 20, 1)
	check("button: held down", a:isDown())
	ui.input(top, "released", 20, 70, 1)
	check("button: let go over another, neither is pressed", #pa == 1 and #pb == 0 and not a:isDown())
	tap(top, "down")
	check("button: arrows move the focus", b:isFocused())
	tap(top, "space")
	eq("button: accept presses", #pb, 1)
	b.disabled = true
	tap(top, "space")
	check("button: a disabled one keeps the focus but isn't pressed", #pb == 1 and b:isFocused())
end

print(("DONE %d passed, %d failed"):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
