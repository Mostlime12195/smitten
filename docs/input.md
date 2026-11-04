# Input

Most games read input through **actions**: names like `jump` or `left`
that stand for several keys and buttons at once. A game written with
actions works with a keyboard, a gamepad and (for the mouse button)
touch, without extra code. Players can also rebind them.

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
| `"mouse:1"`, `"mouse:2"`, `"mouse:3"` | Left, right and middle mouse buttons. A touch counts as `mouse:1` |
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

A touch works as the left mouse button, so most games run on phones as
they are. For multi-touch, `touches()` lists every finger with its `id`,
its screen position (`x`, `y`) and its position in the scene (`worldX`,
`worldY`).

## Gamepads

Actions already read gamepads. For more control, `stick("left")` gives a
stick's direction, `trigger("right")` how far a trigger is pressed, and
`vibrate(0.5, 0.2)` rumbles. Each takes a player number at the end for
local multiplayer: `stick("left", 2)`.

## Typing

`typed()` returns whatever was typed this frame, and turns on text input
(on phones, that shows the keyboard):

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
