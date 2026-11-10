# Script API

Names a script can use without `smitten.`. How names resolve: [Scripts](scripts.md#names).

## Input

See [Input](input.md).

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

## Scenes

See [Scenes and pieces](scenes.md).

| Call | |
| --- | --- |
| `go(scene, ...)` | Goes to another scene. The extra values go to ready(...) of its root piece. |
| `reload()` | Starts this scene again. |
| `transition(kind, seconds, color)` | Sets how go() changes scenes: transition("fade", 0.4) or transition("none"). |
| `spawn(sceneOrType, properties, parent)` | Makes a piece and adds it to the scene (self:spawn adds it inside this piece). |
| `make(sceneOrType, properties)` | Makes a piece but does not add it to the scene. |
| `tagged(tag)` | Returns every piece with a tag. |
| `first(tag)` | Returns the first piece with a tag, or nil. |
| `root()` | Returns the root piece of the scene. |
| `camera()` | Returns the camera in use, or nil. |
| `game` | A table for the whole game. It stays when the scene changes: game.score += 1. |
| `pauseGame()` | Pauses pieces and physics (pieces with pausable off keep running). |
| `resumeGame()` | Ends the pause: pieces and physics continue. |
| `isPaused()` | Returns true while the game is paused. |
| `timeScale(scale)` | Sets how fast time goes: timeScale(0.5) is slow motion. timeScale() returns the current value. |

## Sound

See [Sound and music](sound.md).

| Call | |
| --- | --- |
| `sfx(name, volume, pitch)` | Plays a sound once. sfx("coin") finds coin.sfx (or .wav, .ogg...) anywhere in the project. You can also give options: sfx("hit", { volume = 0.5, pitch = 1.2 }). |
| `music(name, options)` | Plays music in a loop, in place of the current music: music("theme", { volume = 0.6, fade = 1 }). |
| `stopMusic(fade)` | Stops the music. If you give fade, the music fades out over fade seconds. |
| `pauseMusic()` | Pauses the music. |
| `resumeMusic()` | Continues the music. |
| `masterVolume(volume)` | Sets the volume of every sound, 0 to 1. masterVolume() returns the current value. |

## Saving

See [Saving](saving.md).

| Call | |
| --- | --- |
| `save(key, value)` | Keeps a value between plays: save("best", score). |
| `load(key, default)` | Returns a saved value, or default: load("best", 0). |

## Time

See [Scripts](scripts.md).

| Call | |
| --- | --- |
| `wait(seconds)` | Pauses ready(), an event function or a task for some seconds. |
| `task(function)` | Runs a function that can wait(). |
| `after(seconds, function)` | Calls a function once, after some seconds. |
| `every(seconds, function)` | Calls a function each time the given seconds pass, until it returns false. |
| `tween(target, seconds, values, easing)` | Changes numbers smoothly: tween(self, 0.3, { y = 100 }). |
| `time()` | Returns the seconds since the game started. |

## Math

See [Scripts](scripts.md).

| Call | |
| --- | --- |
| `approach(value, target, step)` | Returns value, moved towards target by at most step. |
| `lerp(a, b, t)` | Returns a value between a and b: t = 0 gives a, 1 gives b. |
| `clamp(value, min, max)` | Returns value, kept between min and max. |
| `sign(value)` | Returns -1, 0 or 1. |
| `round(value, step)` | Returns value, rounded to the nearest step (1 if you leave it out). |
| `rnd(n)` | rnd() returns 0 to 1. rnd(n) returns 0 to n. rnd(list) returns one of its items. |
| `choose(...)` | Returns one of its arguments, at random. |
| `dist(a, b)` | Returns the distance between two pieces, or between two points: dist(x1, y1, x2, y2). |
| `jumpSpeed(height, gravity)` | Returns the upward speed for a jump of this height. It uses the gravity variable of the script, or the gravity that you give, or 1800 if there is neither. |

## Physics

See [Physics](physics.md).

| Call | |
| --- | --- |
| `raycast(x1, y1, x2, y2, tags)` | Returns the first body or solid tiles on a line: { piece, x, y, nx, ny, fraction }, or nil. If you give tags, it counts only pieces with one of them. |
| `raycastAll(x1, y1, x2, y2, tags)` | Returns everything on a line, nearest first: a list of { piece, x, y, nx, ny, fraction }. |
| `piecesAt(x, y, tags)` | Returns the bodies and zones whose shapes contain a point. |
| `overlap(kind, x, y, ...)` | Returns the bodies and zones that touch a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, width, height). |
| `getGravity()` | Returns the gravity of the scene: x, y in pixels per second per second. |
| `setGravity(x, y)` | Changes the gravity of the scene: setGravity(0, 0) makes everything float. |

## Screen

See [Project settings](settings.md).

| Call | |
| --- | --- |
| `screenWidth()` | Returns the width of the game, in game pixels. |
| `screenHeight()` | Returns the height of the game, in game pixels. |
| `fullscreen(on)` | fullscreen(true) fills the screen. fullscreen() returns true while the game fills the screen. |

## Drawing

See [Drawing](drawing.md).

| Call | |
| --- | --- |
| `pen(r, g, b, a)` | Sets the color to draw with: pen(1, 0, 0), pen({1, 0, 0}), pen("#ff8800"). |
| `penSize(width)` | Sets the thickness of lines and outlines. |
| `clearScreen(color)` | Fills the whole screen with a color (with the pen color if you give none). |
| `rect(x, y, w, h, fill)` | Draws a rectangle (fill = false for an outline). |
| `circle(x, y, radius, fill)` | Draws a circle (fill = false for an outline). |
| `oval(x, y, rx, ry, fill)` | Draws an ellipse. |
| `poly(points, fill)` | Draws a polygon: poly({x1, y1, x2, y2, x3, y3}). |
| `line(x1, y1, x2, y2, ...)` | Draws a line through points. |
| `dot(x, y)` | Draws one pixel. |
| `write(text, x, y, options)` | Draws text. options is a size, or { size, font, align, width }. With rich = true, it reads markup like [b]bold[/b]. visible = 5 shows the first 5 characters. Returns the width and height. |
| `sprite(image, x, y, options)` | Draws an image, or an animation frame of a sprite sheet: sprite("art/hero.sprite", x, y, { frame = 2, rotation = 90 }). rotation is in degrees. |

## Script functions

Called by the engine when a script defines them.

| Function | Pieces | |
| --- | --- | --- |
| `function ready(...)` | Piece | The engine calls it when the piece and its children join the scene. The root piece of the scene gets the extra values of go(). |
| `function update(dt)` | Piece | The engine calls it every frame. dt is the time since the last frame, in seconds. |
| `function physicsUpdate(dt)` | Piece | The engine calls it 60 times a second, before bodies move. Use it for movement. |
| `function draw()` | Piece | The engine calls it every frame. Draw extra things on top of the piece here, in the piece's own coordinates. |
| `function removed()` | Piece | The engine calls it when the piece leaves the scene. |
| `function hit(other, contact)` | Body | The engine calls it when the body starts to touch a body or solid tiles. contact has x, y, nx, ny (from other to this body) and impulse. |
| `function entered(zone)` | Body, Zone | Body: The engine calls it when the body goes into a zone. Zone: The engine calls it when a body or zone comes in. |
| `function exited(zone)` | Body, Zone | Body: The engine calls it when the body leaves a zone. Zone: The engine calls it when a body or zone leaves. |
| `function clicked()` | Button, Panel, Picture | Button: The engine calls it when the player clicks or taps the button, or presses the accept action while the button has keyboard focus. Panel: The engine calls it when the player clicks or taps the panel (but not a button inside it). Picture: The engine calls it when the player clicks or taps the Picture. |
| `function touched()` | TouchStick, TouchButton | TouchStick: The engine calls it when a finger touches the stick. TouchButton: The engine calls it when a finger presses the button (or slides onto it). |
| `function untouched()` | TouchStick, TouchButton | TouchStick: The engine calls it when the finger lets go of the stick. TouchButton: The engine calls it when the finger lets go or slides off. |
| `function tick()` | Timer | The engine calls it when the countdown reaches zero. |
| `function finished(animation)` | Sprite, Text, Particles, Label, Sound | Sprite: The engine calls it when an animation that does not loop reaches its last animation frame. Text: The engine calls it when reveal() has shown all of the text. Particles: The engine calls it when the last particle is gone and no more particles will come (after a burst or stop()). Use it to destroy() the piece. Label: The engine calls it when reveal() has shown all of the text. Sound: The engine calls it when the sound reaches its end (not when it loops). |
| `function hovered()` | UI | The engine calls it when the mouse pointer comes over it (not for Labels). |
| `function unhovered()` | UI | The engine calls it when the mouse pointer leaves it. |
| `function revealed(index, char)` | Text, Label | Text: The engine calls it when reveal() shows one more character. Use it to play a blip, or to wait at a full stop. Label: The engine calls it when reveal() shows one more character. Use it to play a blip, or to wait at a full stop. |
| `function eachCharacter(c)` | Text, Label | Text: The engine calls it for every character each time it draws the text. Use it to move or color the character: c.y = math.sin(c.time * 4 + c.index) * 3. You can change x, y, rotation, scale, color, alpha and visible of c. You can read index, count, char, line, time and since. The engine uses the same table c for every character, so do not keep it. Label: The engine calls it for every character each time it draws the text. Use it to move or color the character: c.y = math.sin(c.time * 4 + c.index) * 3. You can change x, y, rotation, scale, color, alpha and visible of c. You can read index, count, char, line, time and since. The engine uses the same table c for every character, so do not keep it. |
| `function linkPressed(name)` | Label | The engine calls it when the player clicks or taps a [link=name] in the text. |
| `function changed(text)` | TextInput, Slider | TextInput: The engine calls it when the player changes the text by typing, deleting or pasting (not when a script sets the text). Slider: The engine calls it when the player moves the slider (not when a script sets value). |
| `function toggled(checked)` | Checkbox | The engine calls it when the tick goes on or off. The cause can be the player, toggle(), or a tick on another checkbox in its group. |
| `function submitted(text)` | TextInput | The engine calls it when the player presses Enter (in a multiline box: Ctrl+Enter). |
| `function focused()` | TextInput | The engine calls it when the box gets keyboard focus. |
| `function blurred()` | TextInput | The engine calls it when the box loses keyboard focus: the focus goes to something else, or the player presses Escape. |
| `function scrolled(x, y)` | Scroll | The engine calls it when the player scrolls it. |
