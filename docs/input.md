# Input

Most games read input through **actions**: names like `jump` or `left`
that stand for several keys and buttons at once. A game written with
actions works with a keyboard, a gamepad and [touch controls](#touch),
without extra code. Players can also rebind them, and every call takes a
player number for [games with more than one player](#more-than-one-player).

```lua
function physicsUpdate(dt)
  vx = axis("left", "right") * speed
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
end
```

<!-- api:Input -->
| Call | |
| --- | --- |
| `pressed(action, player?)` | True on the frame an action (jump, left, fire...) or an input ("space", "mouse:1", "pad:a") is pressed. pressed() alone: any key or button. With a player number, that player only: pressed("jump", 2). |
| `down(action, player?)` | True while an action or input is held. |
| `released(action, player?)` | True on the frame an action or input is let go. |
| `axis(negative, positive, player?)` | -1 to 1 (in between for sticks): axis("left", "right"). |
| `vector(left, right, up, down, player?)` | x, y of a direction, at most 1 long. |
| `mouse()` | x, y of the mouse in the scene. |
| `mouseScreen()` | x, y of the mouse on the screen, in game pixels (for UI). |
| `wheel()` | How far the mouse wheel turned this frame: x, y (y > 0 is up). |
| `touches()` | The fingers on the screen: a list of { id, x, y, worldX, worldY }. |
| `stick(side, player?)` | A gamepad stick, "left" or "right": x, y from -1 to 1. |
| `trigger(side, player?)` | A gamepad trigger, "left" or "right": 0 to 1. |
| `vibrate(strength, seconds, player?)` | Rumbles gamepads: vibrate(0.5, 0.2). |
| `typed()` | The text typed this frame ("" if none); turns text input on. |
<!-- end -->

## Actions

Every project starts with these. Change them, or add your own, in
**Project settings › Input**.

| Action | Default inputs |
| --- | --- |
| `left`, `right`, `up`, `down` | Arrow keys, WASD, d-pad, left stick |
| `jump` | Space, gamepad A |
| `fire` | X, J, left mouse button, gamepad X |
| `accept` | Enter, Space, gamepad A |
| `cancel` | Escape, Backspace, gamepad B |
| `pause` | Escape, P, gamepad Start |

`pressed`, `down` and `released` also accept a single input, which is
handy for quick tests: `pressed("space")`, `down("mouse:2")`. And
`pressed()` with nothing in the brackets is true when anything at all was
pressed, for "press any key" screens.

### Input names

| Name | Input |
| --- | --- |
| `"a"`, `"space"`, `"left"`, `"return"`, `"escape"`, ... | Keys |
| `"mouse:1"`, `"mouse:2"`, `"mouse:3"` | Left, right and middle mouse buttons. A touch counts as `mouse:1`, unless it's on a touch piece |
| `"wheel:up"`, `"wheel:down"` | The mouse wheel |
| `"pad:a"`, `"pad:start"`, `"pad:dpleft"`, ... | Gamepad buttons |
| `"axis:leftx-"`, `"axis:triggerleft+"`, ... | Half of a stick or a trigger, pushed past halfway |

## Rebinding controls

`smitten.input.bind(action, inputs)` changes an action's inputs while the
game runs, and `smitten.input.lastPressed()` tells you what was just
pressed. Together they make a "press a key for jump" screen:

```lua
local key = smitten.input.lastPressed()
if key then
  smitten.input.bind("jump", { key })
  save("jumpKey", key)   -- remember it next time
end
```

## The mouse

`mouse()` gives the pointer's position in the scene, which is what you
want for aiming or clicking on things in the world. `mouseScreen()` gives
it on the screen, for UI. `smitten.mouse.isOverUI()` is true when the
pointer is over a button or panel, so a click meant for the UI doesn't
also fire a shot:

```lua
if pressed("mouse:1") and not smitten.mouse.isOverUI() then shoot() end
```

## Touch

A touch works as the left mouse button, so menus and click-to-play games
run on phones as they are. A game played with keys needs something to
press: add **TouchStick** and **TouchButton** pieces (Add a piece ›
On-screen UI). They are UI pieces like any other, so you place them with
anchors, put them in Panels, and lay out the controls your game needs.

A TouchStick pushes four actions (`left`, `right`, `up` and `down` unless
you choose others) and a TouchButton holds one down (`jump` to start
with). They push them the way a gamepad does, part of the way for a stick
pushed part of the way, so the script that reads the keyboard already
reads them:

```lua
vx = axis("left", "right") * speed      -- keys, a gamepad or a thumb
if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
```

A simple layout, with no code at all:

1. Add a **TouchStick**. It starts in the bottom-left corner.
2. Add a **TouchButton**. It starts bottom right, pressing `jump`.
3. For another button, add one more and choose its **action** (`fire`).
4. Type a letter in **text**, or pick an **image**, to say what it does.
5. Move them with **anchor**, **x** and **y**, so they stay in their
   corners on every screen.
6. Play on a phone. On a computer they stay hidden; set **show** to
   `always` to see them and work them with the mouse.

`show` decides when a touch piece is drawn: `touch` (phones and tablets,
and any screen once a finger touches it), `always`, or `never` (invisible,
but fingers still work it). `smitten.input.hasTouch()` tells a script the
same thing, to hide a "Press Space" label, say.

### Sticks

A stick's **mode** is `fixed` (it stays where you put it), `floating` (it
appears under the thumb, wherever it lands in the stick's rectangle: make
the rectangle the left half of the screen) or `follow` (floating, and
dragged along when the thumb goes further than **radius**). **deadzone**
is how much of the middle counts as no push.

A stick doesn't have to push actions. Clear the four action boxes and
read it yourself, for a second stick that aims:

```lua
local x, y = Aim:getValue()          -- -1 to 1 each way; 0, 0 when let go
if Aim:isActive() then rotation = smitten.math.angle(x, y) end
```

### Buttons

A TouchButton holds its **action** down while a finger is on it. Its
script also gets `touched()` and `untouched()`, so a button with no action
can do anything:

```lua
-- On a TouchButton
function touched()
  pauseGame()
end
```

A finger that slides off a button lets go of it, and one that slides
from one button onto the next presses that one: four buttons in a cross
make a d-pad.

### Several fingers

Each finger is followed on its own, so a thumb can hold the stick while
another taps buttons. A finger on a touch piece belongs to that piece: the
game doesn't see it as `mouse:1`, and it doesn't click what's under it.
Any other finger is still the mouse, so a game can have a stick on the
left and tap-to-shoot everywhere else.

Touch pieces have a **player** setting. Two sticks and two sets of
buttons at opposite ends of a tablet, with `player` 1 and 2, make a
two-player game on one screen (see below).

For anything else, `touches()` lists every finger with its `id`, its
screen position (`x`, `y`) and its position in the scene (`worldX`,
`worldY`).

### Pressing actions from code

The touch pieces are built on three functions any script can use:

```lua
smitten.input.press("jump")             -- held until release("jump")
smitten.input.release("jump")
smitten.input.setStrength("right", 0.5) -- half a push: axis() gives 0.5
```

Each takes a player number at the end (player 1 without one). They are
the way to make your own controls (a steering wheel, tilt), to play back
a recording, or to let the computer play a character through the same
script a person would use. `pressed()` is true for the rest of the frame
`press()` was called in, so press before the pieces that read it update:
from a piece earlier in the scene, or from an event.

## Gamepads

Actions already read gamepads. For more control, `stick("left")` gives a
stick's direction, `trigger("right")` how far a trigger is pressed, and
`vibrate(0.5, 0.2)` rumbles. Each takes a player number at the end:
`stick("left", 2)` is the second gamepad's.

Gamepads are numbered as they connect, and keep their number: if gamepad
1 is unplugged, gamepad 2 is still gamepad 2, and the next one plugged in
becomes 1. (In a browser a gamepad only shows up once a button on it is
pressed.)

## More than one player

Every action call takes a player number at the end:

```lua
vx = axis("left", "right", 2) * speed
if pressed("jump", 2) then ... end
```

With a number, a call reads that player's inputs only. Without one it
reads everything, as always, so a one-player game never thinks about
players, and `pressed("pause")` in a two-player game works for whoever
presses it.

Who has what:

- **Gamepads:** player 1 has gamepad 1, player 2 gamepad 2, and so on.
  `pad:a` in an action means the player's own gamepad. Two gamepads and
  the calls above are a two-player game, with nothing to set up.
- **The keyboard and mouse** are player 1's (`assignKeyboard(2)` hands
  them to player 2). Other players only have
  the keys you give them, in **Project settings › Input**: set
  **Players** to 2 and each player gets a tab for inputs of their own.
  **Two players on one keyboard** fills them in: WASD, Space and F for
  player 1; the arrow keys, Enter and Right Shift for player 2.

Keyboards have a limit: many can't tell every combination of keys apart,
and drop a key when three or four are held at once. The two sets above
are far apart and use keys that mostly survive it, but two players on one
keyboard will sometimes lose a press, and three won't fit. For more
players, use gamepads.

### One player scene for everyone

You don't write the number in every call. In a piece's script, an input
call with no player uses the piece's `player` variable, or the `player`
of the nearest piece above it that has one. So write the player once:

```lua
-- scenes/player.lua, on the Body of player.scene
player = 1
speed = 220

function physicsUpdate(dt)
  vx = axis("left", "right") * speed       -- this piece's player
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
  move()
end
```

Place `player.scene` twice and set **player** to 1 and 2 in the
Inspector. A script on a piece inside (a gun, say) reads the same player
without a variable of its own. To read every device from such a script,
ask the module: `smitten.input.pressed("pause")`.

### Press a button to join

`smitten.input.lastPressedBy()` says what was pressed this frame and
where it came from: the input's name, then `"keyboard"`, `"mouse"` or
`"gamepad"`, then the gamepad's number.

```lua
-- A lobby: each device that presses something gets the next player.
local joined = {}     -- "keyboard" or a gamepad's number -> true
local count = 0

function update(dt)
  local name, device, pad = smitten.input.lastPressedBy()
  if not name or device == "mouse" then return end
  local who = pad or "keyboard"
  if joined[who] then return end
  joined[who] = true
  count += 1
  if pad then
    smitten.input.assignGamepad(count, pad)     -- the gamepad that joined
  else
    smitten.input.assignKeyboard(count)         -- the keyboard is theirs
    smitten.input.assignGamepad(count, false)   -- and no gamepad
  end
  spawn("scenes/player.scene", { player = count, x = 200 * count, y = 300 })
end
```

`assignGamepad(player, number)` gives a player a gamepad, whatever order
they were plugged in, and `assignKeyboard(player)` the keyboard and
mouse; `gamepadOf(player)` tells you which gamepad they have, and
`players()` how many players have something to play with. For gamepads
that come and go, either look at `gamepadOf(player)` each frame (nil: show
"reconnect your gamepad") or listen:

```lua
local listener = smitten.input.on("gamepadremoved", function(number)
  pauseGame()
end)

function removed()
  listener:off()    -- when this piece goes, stop listening
end
```

`smitten.input.bind("jump", { "return" }, 2)` changes one player's inputs
while the game runs, `bindings("jump", 2)` reads them, and
`lastPressed(2)` is what player 2 just pressed, for a rebinding screen
with a column for each player.

On a tablet, give each player's TouchStick and TouchButtons their
`player` number, or put them inside a Panel whose script says
`player = 2`.

## Typing

`typed()` returns whatever was typed this frame, and turns on text input
(on phones, that shows the keyboard):

```lua
name ..= typed()
if pressed("backspace") then name = name:sub(1, -2) end
```

For a box to type in, with a caret, selecting, copy and paste, there's a
piece: [TextInput](ui.md#typing-boxes). In a browser, text pasted with
Ctrl+V arrives through `typed()` too.

## smitten.input

<!-- module:input -->
| Function | |
| --- | --- |
| `smitten.input.pressed(action, player?)` | True on the frame the action went down: smitten.input.pressed("jump"). With a player, that player only: smitten.input.pressed("jump", 2). |
| `smitten.input.down(action, player?)` | True while the action is held. |
| `smitten.input.released(action, player?)` | True on the frame the action went up. |
| `smitten.input.axis(negative, positive, player?)` | From -1 to 1: smitten.input.axis("left", "right"). |
| `smitten.input.vector(left, right, up, down, player?)` | A direction at most 1 long: x, y. |
| `smitten.input.strength(action, player?)` | How far the action is pushed, 0 to 1. |
| `smitten.input.bind(action, inputs, player?)` | Adds an action: smitten.input.bind("dash", { "lshift", "pad:b" }). With a player, the inputs are that player's own: bind("jump", { "return" }, 2). |
| `smitten.input.unbind(action, player?)` | Removes an action, or a player's own inputs for it. |
| `smitten.input.bindings(action, player?)` | The inputs bound to an action (with a player: the ones that player uses). |
| `smitten.input.actions()` | Every action's name. |
| `smitten.input.lastPressed(player?)` | The input pressed this frame ("space", "mouse:1", "pad:a"), or nil: for rebinding screens. With a player, only what that player pressed. |
| `smitten.input.lastPressedBy()` | What was pressed this frame and where: the input's name, "keyboard", "mouse" or "gamepad", and the gamepad's number. For "press a button to join" screens. |
| `smitten.input.isInputName(name)` | True if a name is an input: a key, "mouse:1", "pad:a", "axis:leftx+", "wheel:up". |
| `smitten.input.press(action, player?)` | Presses an action from code, as if its key went down, until release(): for touch controls, replays and computer players. |
| `smitten.input.release(action, player?)` | Lets go of an action pressed with press() or setStrength(). |
| `smitten.input.setStrength(action, value, player?)` | Pushes an action part of the way, 0 to 1, as a stick would: axis() and vector() give the fraction back. |
| `smitten.input.players()` | How many players have something to play with: the keyboard, keys of their own or a gamepad. |
| `smitten.input.gamepadOf(player)` | A player's gamepad: its number and the gamepad itself, or nil. |
| `smitten.input.assignGamepad(player, gamepad)` | Gives a player a gamepad by its number: assignGamepad(1, 2). false: none. nil: back to gamepad 1 for player 1, 2 for player 2. |
| `smitten.input.assignKeyboard(player)` | Gives a player the keyboard and the mouse (they start as player 1's). false: nobody's. |
| `smitten.input.keyboardOf()` | The player with the keyboard and the mouse, or nil. |
| `smitten.input.on(event, fn)` | Calls fn(number, gamepad) on "gamepadadded" or "gamepadremoved". Returns a handle with :off(). |
| `smitten.input.hasTouch()` | True on a phone or a tablet, and on any screen once a finger has touched it. |
| `smitten.input.wheel()` | How far the mouse wheel turned this frame: x, y. |
| `smitten.input.typed()` | The text typed this frame; turns text input on. |
| `smitten.input.touches()` | The fingers on the screen: a list of { id, x, y, worldX, worldY }. |
| `smitten.input.gamepads()` | How many gamepads are connected. |
| `smitten.input.stick(side, player?)` | A gamepad stick ("left" or "right"): x, y from -1 to 1. |
| `smitten.input.trigger(side, player?)` | A gamepad trigger ("left" or "right"): 0 to 1. |
| `smitten.input.vibrate(strength, seconds, player?)` | Rumbles gamepads (all, or one player's). |
<!-- end -->
