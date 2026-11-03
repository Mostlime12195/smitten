# Input

Read input through **actions**: named groups of keys and buttons, set in
**Project settings › Input**.

```lua
function physicsUpdate(dt)
  vx = axis("left", "right") * speed
  if pressed("jump") and onGround() then vy = -jumpSpeed(96) end
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

| Action | Default inputs |
| --- | --- |
| `left`, `right`, `up`, `down` | Arrow keys, WASD, d-pad, left stick |
| `jump` | Space, gamepad A |
| `fire` | X, J, left mouse button, gamepad X |
| `accept` | Enter, Space, gamepad A |
| `cancel` | Escape, Backspace, gamepad B |
| `pause` | Escape, P, gamepad Start |

`pressed`, `down` and `released` also take a single input name:
`pressed("space")`. `pressed()` with no argument means any input.

### Input names

| Name | Input |
| --- | --- |
| `"a"`, `"space"`, `"left"`, `"return"`, ... | Keys ([LÖVE key names](https://love2d.org/wiki/KeyConstant)) |
| `"mouse:1"`, `"mouse:2"`, `"mouse:3"` | Left, right, middle button; a touch is `mouse:1` |
| `"wheel:up"`, `"wheel:down"` | Mouse wheel, pressed for one frame |
| `"pad:a"`, `"pad:start"`, `"pad:dpleft"`, ... | Gamepad buttons |
| `"axis:leftx-"`, `"axis:triggerleft+"`, ... | Half a stick or a trigger, pressed past halfway |

## Rebinding

`smitten.input.bind(action, inputs)` replaces an action's inputs.
`lastPressed()` returns the input pressed this frame.

```lua
local key = smitten.input.lastPressed()
if key then
  smitten.input.bind("jump", { key })
  save("jumpKey", key)
end
```

## Mouse

`mouse()` is the pointer in the scene; `mouseScreen()` is on the screen,
for UI. `smitten.mouse.isOverUI()` is true over a button or panel.

```lua
if pressed("mouse:1") and not smitten.mouse.isOverUI() then shoot() end
```

## Touch

`touches()` returns each finger: `id`, `x`, `y` (screen) and `worldX`,
`worldY` (scene).

## Gamepads

`stick(side, player)`, `trigger(side, player)` and
`vibrate(strength, seconds, player)`. `smitten.input.gamepads()` is the
number connected.

## Typing

`typed()` returns the text typed this frame and turns text input on (the
on-screen keyboard on phones).

```lua
name ..= typed()
if pressed("backspace") then name = name:sub(1, -2) end
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
