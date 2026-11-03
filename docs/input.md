# Input

Read input by **action**: a name like `jump` or `left` that stands for
several keys and buttons at once, so a game works with a keyboard and a
gamepad without extra code. Actions are set in **Project settings › Input**.

```lua
function physicsUpdate(dt)
  vx = axis("left", "right") * speed
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
  if down("fire") then shoot() end
end
```

<!-- api:Input -->
| Call | |
| --- | --- |
| `pressed(action)` | True on the frame an action (jump, left, fire...) or an input ("space", "mouse:1", "pad:a") is pressed. pressed() alone: any key or button. |
| `down(action)` | True while an action or input is held. |
| `released(action)` | True on the frame an action or input is let go. |
| `axis(negative, positive)` | -1 to 1 (in between for sticks): axis("left", "right"). |
| `vector(left, right, up, down)` | x, y of a direction, at most 1 long. |
| `mouse()` | x, y of the mouse in the scene. |
| `mouseScreen()` | x, y of the mouse on the screen, in game pixels (for UI). |
| `wheel()` | How far the mouse wheel turned this frame: x, y (y > 0 is up). |
| `touches()` | The fingers on the screen: a list of { id, x, y, worldX, worldY }. |
| `stick(side, player)` | A gamepad stick, "left" or "right": x, y from -1 to 1. |
| `trigger(side, player)` | A gamepad trigger, "left" or "right": 0 to 1. |
| `vibrate(strength, seconds, player)` | Rumbles gamepads: vibrate(0.5, 0.2). |
| `typed()` | The text typed this frame ("" if none); turns text input on. |
<!-- end -->

## Actions

Every project starts with these; Project settings › Input adds more and
changes them.

| Action | Inputs |
| --- | --- |
| `left`, `right`, `up`, `down` | Arrow keys, WASD, the d-pad, the left stick |
| `jump` | Space, gamepad A |
| `fire` | X, J, left mouse button, gamepad X |
| `accept` | Enter, Space, gamepad A (presses the focused button) |
| `cancel` | Escape, Backspace, gamepad B |
| `pause` | Escape, P, gamepad Start |

`pressed`, `down` and `released` also take a single **input**, for quick
tests: `pressed("space")`, `down("mouse:2")`, `pressed("pad:start")`.
`pressed()` with nothing is true when any key, mouse button or gamepad
button went down this frame ("press any key").

### Input names

| Name | Input |
| --- | --- |
| `"a"`, `"space"`, `"left"`, `"lshift"`, `"return"`, `"escape"`, `"1"` | Keys ([LÖVE's key names](https://love2d.org/wiki/KeyConstant)) |
| `"mouse:1"`, `"mouse:2"`, `"mouse:3"` | Left, right and middle mouse buttons (a touch counts as `mouse:1`) |
| `"wheel:up"`, `"wheel:down"` | The mouse wheel (pressed for one frame) |
| `"pad:a"`, `"pad:b"`, `"pad:x"`, `"pad:y"`, `"pad:start"`, `"pad:back"`, `"pad:leftshoulder"`, `"pad:dpleft"`, ... | Gamepad buttons |
| `"axis:leftx-"`, `"axis:leftx+"`, `"axis:lefty-"`, `"axis:righty+"`, `"axis:triggerleft+"`, ... | Half of a stick or a trigger (counts as pressed past halfway) |

## Changing controls while the game runs

`smitten.input.bind(action, inputs)` adds or replaces an action;
`bindings(action)` lists its inputs and `lastPressed()` is the input pressed
this frame, for a "press a key for jump" screen. Save the choice to keep it:

```lua
-- On a "Jump: [space]" button
local waiting = false

function pressed() waiting = true; text = "Jump: press a key" end

function update(dt)
  if not waiting then return end
  local key = smitten.input.lastPressed()
  if key and key ~= "mouse:1" then
    smitten.input.bind("jump", { key })
    save("jumpKey", key)
    text = `Jump: {key}`
    waiting = false
  end
end
```

## The mouse

`mouse()` is the pointer in the scene, through the camera: use it to aim
or pick things up. `mouseScreen()` is the pointer on the screen, in game
pixels, for UI. `smitten.mouse.pressed(button)`, `released(button)` and
`down(button)` work like the actions (button 1 is the left one);
`smitten.mouse.isOverUI()` is true over a button or panel, so a click meant
for the UI doesn't also shoot. `smitten.mouse.getDelta()` is how far it
moved this frame, also while it's captured with
`smitten.mouse.setRelativeMode(true)`.

```lua
function update(dt)
  local mx, my = mouse()
  lookAt(mx, my)
  if pressed("mouse:1") and not smitten.mouse.isOverUI() then shoot() end
  if pressed("wheel:up") then Camera.zoom *= 1.1 end
end
```

## Touch

A touch also counts as the left mouse button, so most games work on phones
as they are. `touches()` lists every finger, for games that need more than
one: each has an `id`, `x`, `y` (on the screen) and `worldX`, `worldY` (in
the scene).

## Gamepads

The actions already read gamepads. For more: `stick("left")` gives the left
stick's x, y (with a dead zone), `trigger("right")` the right trigger, and
`vibrate(0.6, 0.25)` rumbles. Each takes a player number last for local
multiplayer (`stick("left", 2)`); `smitten.input.gamepads()` is how many
are connected. LÖVE's [`smitten.joystick`](https://love2d.org/wiki/love.joystick)
has the rest.

## Typing

`typed()` is the text typed this frame. The first call turns text input on
(on phones it shows the keyboard); `smitten.keyboard.setTextInput(false)`
turns it off.

```lua
playerName = ""

function update(dt)
  playerName ..= typed()
  if pressed("backspace") then playerName = playerName:sub(1, -2) end
  NameLabel.text = playerName
end
```

## smitten.input

<!-- module:input -->
| Function | |
| --- | --- |
| `smitten.input.pressed(action)` | True on the frame the action went down: smitten.input.pressed("jump"). |
| `smitten.input.down(action)` | True while the action is held. |
| `smitten.input.released(action)` | True on the frame the action went up. |
| `smitten.input.axis(negative, positive)` | From -1 to 1: smitten.input.axis("left", "right"). |
| `smitten.input.vector(left, right, up, down)` | A direction at most 1 long: x, y. |
| `smitten.input.strength(action)` | How far the action is pushed, 0 to 1. |
| `smitten.input.bind(action, inputs)` | Adds an action: smitten.input.bind("dash", { "lshift", "pad:b" }). |
| `smitten.input.unbind(action)` | Removes an action. |
| `smitten.input.bindings(action)` | The inputs bound to an action. |
| `smitten.input.actions()` | Every action's name. |
| `smitten.input.lastPressed()` | The input pressed this frame ("space", "mouse:1", "pad:a"), or nil: for rebinding screens. |
| `smitten.input.isInputName(name)` | True if a name is an input: a key, "mouse:1", "pad:a", "axis:leftx+", "wheel:up". |
| `smitten.input.wheel()` | How far the mouse wheel turned this frame: x, y. |
| `smitten.input.typed()` | The text typed this frame; turns text input on. |
| `smitten.input.touches()` | The fingers on the screen: a list of { id, x, y, worldX, worldY }. |
| `smitten.input.gamepads()` | How many gamepads are connected. |
| `smitten.input.stick(side, player?)` | A gamepad stick ("left" or "right"): x, y from -1 to 1. |
| `smitten.input.trigger(side, player?)` | A gamepad trigger ("left" or "right"): 0 to 1. |
| `smitten.input.vibrate(strength, seconds, player?)` | Rumbles gamepads (all, or one player's). |
<!-- end -->

Also: `smitten.keyboard.pressed(key)` and `released(key)`, next to LÖVE's
`smitten.keyboard.isDown(key)`; `smitten.mouse.x`, `y` (game pixels) and
`worldX`, `worldY` (scene).
