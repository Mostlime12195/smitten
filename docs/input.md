# Input

Most games read input through **input actions** (short: **actions**). An
action is a name, for example `jump` or `left`, for a set of keys and
buttons. If you write a game with actions, it works with a keyboard, a
gamepad and [touch pieces](#touch), without more code. Players can also
change the bindings of actions. Each input function can also take a player
number, for [games with more than one player](#more-than-one-player).

```lua
function physicsUpdate(dt)
  vx = axis("left", "right") * speed
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
end
```

<!-- api:Input -->
| Call | |
| --- | --- |
| `pressed(action, player?)` | Returns true on the frame when the player presses an action (jump, left, fire...) or an input ("space", "mouse:1", "pad:a"). pressed() alone checks every key and button. With a player number, it checks only that player: pressed("jump", 2). |
| `down(action, player?)` | Returns true while the player holds an action or an input down. |
| `released(action, player?)` | Returns true on the frame when the player lets go of an action or an input. |
| `axis(negative, positive, player?)` | Returns a value from -1 to 1 (values in between for sticks): axis("left", "right"). |
| `vector(left, right, up, down, player?)` | Returns the x, y of a direction, with a length of 1 at most. |
| `mouse()` | Returns the x, y of the mouse in the scene. |
| `mouseScreen()` | Returns the x, y of the mouse on the screen, in game pixels (for UI). |
| `wheel()` | Returns how far the mouse wheel turned in this frame: x, y (y > 0 is up). |
| `touches()` | Returns the fingers on the screen: a list of { id, x, y, worldX, worldY }. |
| `stick(side, player?)` | Returns the position of a gamepad stick, "left" or "right": x, y from -1 to 1. |
| `trigger(side, player?)` | Returns the position of a gamepad trigger, "left" or "right": 0 to 1. |
| `vibrate(strength, seconds, player?)` | Makes gamepads vibrate: vibrate(0.5, 0.2). |
| `typed()` | Returns the text that the player typed in this frame ("" if none). It also turns text input on. |
<!-- end -->

## Actions

All projects start with these actions. To change them, or to add your own
actions, go to **Project settings › Input**.

| Action | Default bindings |
| --- | --- |
| `left`, `right`, `up`, `down` | Arrow keys, WASD, d-pad, left stick |
| `jump` | Space, gamepad A |
| `fire` | X, J, left mouse button, gamepad X |
| `accept` | Enter, Space, gamepad A |
| `cancel` | Escape, Backspace, gamepad B |
| `pause` | Escape, P, gamepad Start |

`pressed`, `down` and `released` also accept one input name. This is
useful for quick tests: `pressed("space")`, `down("mouse:2")`. If you call
`pressed()` with no input name, it is true when the player pressed any key
or button. Use this for "press any key" screens.

### Input names

| Name | Input |
| --- | --- |
| `"a"`, `"space"`, `"left"`, `"return"`, `"escape"`, ... | Keys |
| `"mouse:1"`, `"mouse:2"`, `"mouse:3"` | Left, right and middle mouse buttons. A touch is also `mouse:1`, but not if it is on a touch piece |
| `"wheel:up"`, `"wheel:down"` | The mouse wheel |
| `"pad:a"`, `"pad:start"`, `"pad:dpleft"`, ... | Gamepad buttons |
| `"axis:leftx-"`, `"axis:triggerleft+"`, ... | Half of a stick or a trigger, when the player pushes it more than halfway |

## Rebinding actions

`smitten.input.bind(action, inputs)` changes the bindings of an action
while the game runs. `smitten.input.lastPressed()` tells you the input
that the player pressed last. With these two functions, you can make a
"press a key for jump" screen:

```lua
local key = smitten.input.lastPressed()
if key then
  smitten.input.bind("jump", { key })
  save("jumpKey", key)   -- keep the key for the next time that the game starts
end
```

## The mouse

`mouse()` gives the position of the pointer in the scene. Use it to aim, or
to click on things in the world. `mouseScreen()` gives the position on the
screen, for UI. `smitten.mouse.isOverUI()` is true when the pointer is on
a button or a panel. Use it so that a click on the UI does not also shoot:

```lua
if pressed("mouse:1") and not smitten.mouse.isOverUI() then shoot() end
```

## Touch

A touch works as the left mouse button. Because of this, menus and games that you play
with clicks work on phones with no changes. A game that you play with keys
needs something on the screen to press. Add **TouchStick** and
**TouchButton** pieces (Add a piece › On-screen UI). These are UI pieces,
as the other UI pieces are. You can put them in position with anchors, and
put them in Panels. Make the layout of touch pieces that your game needs.

A TouchStick pushes four actions. By default, these are `left`, `right`,
`up` and `down`, but you can choose different actions. A TouchButton holds
one action down. By default, this is `jump`. The touch pieces push actions
as a gamepad does. If the thumb pushes the stick part of the way, the
action is also part of the way down. Because of this, a script that reads the keyboard also reads
the touch pieces:

```lua
vx = axis("left", "right") * speed      -- keys, a gamepad or a thumb
if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
```

To make a simple layout without code:

1. Add a **TouchStick**. It starts in the bottom-left corner.
2. Add a **TouchButton**. It starts in the bottom-right corner, and it
   presses `jump`.
3. For one more button, add one more TouchButton.
4. Choose the **action** of the new button (for example, `fire`).
5. To show what a button does, type a letter in **text**, or choose an
   **image**.
6. Use **anchor**, **x** and **y** to move the pieces. Then they stay in
   their corners on all screens.
7. Play the game on a phone. On a computer, Smitten hides the touch pieces.
   To see them on a computer and use them with the mouse, set **show** to
   `always`.

`show` sets when Smitten draws a touch piece:

- `touch`: on phones and tablets, and on all screens after a finger
  touches the screen.
- `always`.
- `never`: Smitten does not draw the piece, but fingers can use it.

`smitten.input.hasTouch()` gives the same information to a script. For
example, use it to hide a "Press Space" Label.

### Sticks

The **mode** of a stick is one of these:

- `fixed`: the stick stays where you put it.
- `floating`: the stick comes under the thumb, at the position where the
  thumb touches the rectangle of the stick. Make the rectangle the left
  half of the screen.
- `follow`: the same as `floating`, but if the thumb goes farther than
  **radius**, the stick moves with the thumb.

**deadzone** is the part of the middle where the stick does not push.

A stick does not have to push actions. For example, for a second stick to
aim, clear the four action boxes. Then read the stick in a script:

```lua
local x, y = Aim:getValue()          -- -1 to 1 on each axis; 0, 0 when the thumb is off the stick
if Aim:isActive() then rotation = smitten.math.angle(x, y) end
```

### Buttons

A TouchButton holds its **action** down while a finger is on it. The engine
also calls `touched()` and `untouched()` in its script. Because of this, a button with
no action can do any task:

```lua
-- On a TouchButton
function touched()
  pauseGame()
end
```

If a finger slides off a button, the button releases its action. If a finger
slides from one button onto a different button, it presses the second
button. Because of this, four buttons in a cross make a d-pad.

### Several fingers

Smitten follows each finger separately. Because of this, one thumb can hold the stick
while a different finger taps buttons. A finger on a touch piece belongs
to that piece. The game does not see it as `mouse:1`, and it does not
click the things under it. All other fingers are the mouse. Because of this, a game
can have a stick on the left, and a tap on all other positions can shoot.

Touch pieces have a **player** property. For example, put two sticks and
two sets of buttons at opposite ends of a tablet, with `player` 1 and 2.
This makes a game for two players on one screen (see below).

For all other uses, `touches()` gives a list of all the fingers. For each
finger, it gives its `id`, its position on the screen (`x`, `y`) and its
position in the scene (`worldX`, `worldY`).

### Pressing actions from code

The touch pieces use three functions. All scripts can use them too:

```lua
smitten.input.press("jump")             -- the action stays down until release("jump")
smitten.input.release("jump")
smitten.input.setStrength("right", 0.5) -- half a push: axis() gives 0.5
```

Each of these functions can take a player number at the end. Without a
number, it is player 1. Use these functions for these tasks:

- to make your own input pieces (for example, a steering wheel, or tilt).
- to play back a recording.
- to let the computer play a character with the same script that a person
  uses.

`pressed()` is true for the remaining part of the frame in which a script
called `press()`. Because of this, call `press()` before the pieces that read it
update. Call it from a piece that is before them in the scene, or from an
event.

## Gamepads

Actions already read gamepads. To read more from a gamepad, use these
functions:

- `stick("left")` gives the direction of a stick.
- `trigger("right")` gives how far the player pushes a trigger.
- `vibrate(0.5, 0.2)` makes the gamepad vibrate.

Each of these functions can take a player number at the end.
`stick("left", 2)` reads the stick of the second gamepad.

Smitten gives each gamepad a number when it connects, and the gamepad
keeps this number. If you disconnect gamepad 1, gamepad 2 is still
gamepad 2. The next gamepad that you connect becomes gamepad 1. (In a
browser, Smitten sees a gamepad only after a player presses a button on
it.)

## More than one player

Each action function can take a player number at the end:

```lua
vx = axis("left", "right", 2) * speed
if pressed("jump", 2) then ... end
```

With a number, the function reads only the inputs of that player. Without
a number, it reads all inputs, as before. Because of this, a game for one player does
not have to know about players. In a game for two players,
`pressed("pause")` works for the player who presses it.

Which player has which input:

- **Gamepads:** player 1 has gamepad 1, player 2 has gamepad 2, and so on.
  `pad:a` in an action means the gamepad of the player. Two gamepads and
  the functions above make a game for two players, with no setup.
- **The keyboard and mouse** belong to player 1. (`assignKeyboard(2)`
  gives them to player 2.) Other players have only the keys that you give
  them in **Project settings › Input**. Set **Players** to 2. Then each
  player gets a tab for their own inputs. **Two players on one keyboard**
  fills in the tabs. Player 1 gets WASD, Space and F. Player 2 gets the
  arrow keys, Enter and Right Shift.

Keyboards have a limit. Many keyboards cannot see all combinations of
keys. When a player holds three or four keys at the same time, the
keyboard can lose one key. The two sets of keys above are far apart. Most
keyboards can see them together. But with two players on one keyboard,
the keyboard sometimes loses a key press. Three players do not fit on one keyboard.
For more players, use gamepads.

### One player scene for everyone

You do not have to write the number in each function. In the script of a
piece, an input function with no player number uses the `player` variable
of the piece. If the piece does not have one, it uses the `player` of the
nearest piece above it that has one. Because of this, write the player one time:

```lua
-- scenes/player.lua, on the Body of player.scene
player = 1
speed = 220

function physicsUpdate(dt)
  vx = axis("left", "right") * speed       -- the player of this piece
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
  move()
end
```

1. Put `player.scene` in the scene two times.
2. In the Inspector, set **player** to 1 on the first placed scene.
3. Set **player** to 2 on the second placed scene.

A script on a piece inside it (for example, a gun) reads the same player.
It does not need its own variable. To read all devices from such a script,
use the module: `smitten.input.pressed("pause")`.

### Press a button to join

`smitten.input.lastPressedBy()` tells you the input that the player
pressed in this frame, and where it came from. It gives the name of the
input, then `"keyboard"`, `"mouse"` or `"gamepad"`, then the number of the
gamepad.

```lua
-- A lobby: each device that presses an input gets the next player number.
local joined = {}     -- "keyboard" or the number of a gamepad -> true
local count = 0

function update(dt)
  local name, device, pad = smitten.input.lastPressedBy()
  if not name or device == "mouse" then return end
  local who = pad or "keyboard"
  if joined[who] then return end
  joined[who] = true
  count += 1
  if pad then
    smitten.input.assignGamepad(count, pad)     -- give this player the gamepad that joined
  else
    smitten.input.assignKeyboard(count)         -- give this player the keyboard
    smitten.input.assignGamepad(count, false)   -- and no gamepad
  end
  spawn("scenes/player.scene", { player = count, x = 200 * count, y = 300 })
end
```

- `assignGamepad(player, number)` gives a gamepad to a player, in any
  order of connection.
- `assignKeyboard(player)` gives the keyboard and mouse to a player.
- `gamepadOf(player)` tells you which gamepad a player has.
- `players()` tells you how many players have a device to play with.

Gamepads can disconnect and connect while the game runs. To know about
this, look at `gamepadOf(player)` in each frame (if it is nil, show
"reconnect your gamepad"). Or listen for the event:

```lua
local listener = smitten.input.on("gamepadremoved", function(number)
  pauseGame()
end)

function removed()
  listener:off()    -- when this piece goes out of the scene, stop listening
end
```

For a rebinding screen with a column for each player:

- `smitten.input.bind("jump", { "return" }, 2)` changes the bindings of
  one player while the game runs.
- `bindings("jump", 2)` reads them.
- `lastPressed(2)` is the input that player 2 pressed last.

On a tablet, give the TouchStick and TouchButtons of each player their
`player` number. Or put them in a Panel with the script line
`player = 2`.

## Typing

`typed()` gives the text that the player typed in this frame. It also
turns on text input (on phones, this shows the keyboard):

```lua
name ..= typed()
if pressed("backspace") then name = name:sub(1, -2) end
```

For a box to type in, with a caret, selection, copy and paste, use the
[TextInput](ui.md#typing-boxes) piece. In a browser, text that the player
pastes with Ctrl+V also comes through `typed()`.

## smitten.input

<!-- module:input -->
| Function | |
| --- | --- |
| `smitten.input.pressed(action, player?)` | Returns true on the frame when the action goes down: smitten.input.pressed("jump"). With a player, it checks only that player: smitten.input.pressed("jump", 2). |
| `smitten.input.down(action, player?)` | Returns true while the action is down. |
| `smitten.input.released(action, player?)` | Returns true on the frame when the action goes up. |
| `smitten.input.axis(negative, positive, player?)` | Returns a value from -1 to 1: smitten.input.axis("left", "right"). |
| `smitten.input.vector(left, right, up, down, player?)` | Returns a direction with a length of 1 at most: x, y. |
| `smitten.input.strength(action, player?)` | Returns how far down the action is, from 0 to 1. |
| `smitten.input.bind(action, inputs, player?)` | Adds an action: smitten.input.bind("dash", { "lshift", "pad:b" }). With a player, the bindings are only for that player: bind("jump", { "return" }, 2). |
| `smitten.input.unbind(action, player?)` | Removes an action, or the bindings of one player for it. |
| `smitten.input.bindings(action, player?)` | Returns the bindings of an action (with a player: the bindings that the player uses). |
| `smitten.input.actions()` | Returns the names of all actions. |
| `smitten.input.lastPressed(player?)` | Returns the input pressed in this frame ("space", "mouse:1", "pad:a"), or nil. Use it for screens that change bindings. With a player, it checks only that player. |
| `smitten.input.lastPressedBy()` | Returns the input pressed in this frame and its device: the input name, "keyboard", "mouse" or "gamepad", and the gamepad number. Use it for "press a button to join" screens. |
| `smitten.input.isInputName(name)` | Returns true if a name is an input: a key, "mouse:1", "pad:a", "axis:leftx+", "wheel:up". |
| `smitten.input.press(action, player?)` | Presses an action from code, as if its key went down, until release(). Use it for on-screen touch buttons, replays and computer players. |
| `smitten.input.release(action, player?)` | Lets go of an action that press() or setStrength() pressed. |
| `smitten.input.setStrength(action, value, player?)` | Presses an action part of the way, from 0 to 1, as a stick does. axis() and vector() return the fraction. |
| `smitten.input.players()` | Returns the number of players that have something to play with: the keyboard, their own keys or a gamepad. |
| `smitten.input.gamepadOf(player)` | Returns the gamepad of a player: its number and the gamepad, or nil. |
| `smitten.input.assignGamepad(player, gamepad)` | Gives a gamepad to a player by its number: assignGamepad(1, 2). false gives none. nil goes back to the default: gamepad 1 for player 1, gamepad 2 for player 2. |
| `smitten.input.assignKeyboard(player)` | Gives the keyboard and the mouse to a player (at the start, they belong to player 1). false gives them to no player. |
| `smitten.input.keyboardOf()` | Returns the player who has the keyboard and the mouse, or nil. |
| `smitten.input.on(event, fn)` | Calls fn(number, gamepad) on "gamepadadded" or "gamepadremoved". Returns a handle with :off(). |
| `smitten.input.hasTouch()` | Returns true on a phone or a tablet, and on any screen after a finger touches it. |
| `smitten.input.wheel()` | Returns how far the mouse wheel turned in this frame: x, y. |
| `smitten.input.typed()` | Returns the text that the player typed in this frame. It also turns text input on. |
| `smitten.input.touches()` | Returns the fingers on the screen: a list of { id, x, y, worldX, worldY }. |
| `smitten.input.gamepads()` | Returns the number of connected gamepads. |
| `smitten.input.stick(side, player?)` | Returns the position of a gamepad stick ("left" or "right"): x, y from -1 to 1. |
| `smitten.input.trigger(side, player?)` | Returns the position of a gamepad trigger ("left" or "right"): 0 to 1. |
| `smitten.input.vibrate(strength, seconds, player?)` | Makes gamepads vibrate (all of them, or the gamepad of one player). |
<!-- end -->
