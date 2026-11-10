# Script API

A script can use these names without `smitten.`. [Scripts](scripts.md#how-names-are-found) tells
how the engine finds a name.

## Input

See [Input](input.md).

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

## Scenes

See [Scenes and pieces](scenes.md).

| Call | |
| --- | --- |
| `go(scene, ...)` | Goes to another scene; extra values go to its root's ready(...). |
| `reload()` | Starts this scene again. |
| `transition(kind, seconds, color)` | How go() changes scenes: transition("fade", 0.4) or transition("none"). |
| `spawn(sceneOrType, properties, parent)` | Makes a piece and adds it to the scene (self:spawn adds it inside this piece). |
| `make(sceneOrType, properties)` | Makes a piece without adding it anywhere. |
| `tagged(tag)` | Every piece with a tag. |
| `first(tag)` | The first piece with a tag, or nil. |
| `root()` | The scene's root piece. |
| `camera()` | The camera in use, or nil. |
| `game` | A table for the whole game, kept when the scene changes: game.score += 1. |
| `pauseGame()` | Pauses pieces and physics (pieces with pausable off keep running). |
| `resumeGame()` | Unpauses. |
| `isPaused()` | True while the game is paused. |
| `timeScale(scale)` | How fast time goes: timeScale(0.5) is slow motion; timeScale() reads it. |

## Sound

See [Sound and music](sound.md).

| Call | |
| --- | --- |
| `sfx(name, volume, pitch)` | Plays a sound once: sfx("coin") finds coin.sfx (or .wav, .ogg...) anywhere; sfx("hit", { volume = 0.5, pitch = 1.2 }). |
| `music(name, options)` | Plays music on a loop instead of the music playing: music("theme", { volume = 0.6, fade = 1 }). |
| `stopMusic(fade)` | Stops the music, fading out over fade seconds if given. |
| `pauseMusic()` | Pauses the music. |
| `resumeMusic()` | Continues the music. |
| `masterVolume(volume)` | Every sound's volume, 0 to 1; masterVolume() reads it. |

## Saving

See [Saving](saving.md).

| Call | |
| --- | --- |
| `save(key, value)` | Keeps a value between plays: save("best", score). |
| `load(key, default)` | A saved value, or default: load("best", 0). |

## Time

See [Scripts](scripts.md).

| Call | |
| --- | --- |
| `wait(seconds)` | Pauses ready(), an event or a task for some seconds. |
| `task(function)` | Runs a function that can wait(). |
| `after(seconds, function)` | Calls a function once, after some seconds. |
| `every(seconds, function)` | Calls a function every so many seconds, until it returns false. |
| `tween(target, seconds, values, easing)` | Changes numbers smoothly: tween(self, 0.3, { y = 100 }). |
| `time()` | Seconds since the game started. |

## Math

See [Scripts](scripts.md).

| Call | |
| --- | --- |
| `approach(value, target, step)` | Moves a value towards a target by at most step. |
| `lerp(a, b, t)` | Between a and b: t = 0 is a, 1 is b. |
| `clamp(value, min, max)` | The value, kept between min and max. |
| `sign(value)` | -1, 0 or 1. |
| `round(value, step)` | Rounded to the nearest step (default 1). |
| `rnd(n)` | rnd(): 0 to 1. rnd(n): 0 to n. rnd(list): one of its items. |
| `choose(...)` | One of its arguments, at random. |
| `dist(a, b)` | The distance between two pieces, or dist(x1, y1, x2, y2). |
| `jumpSpeed(height, gravity)` | How fast to go up to jump this high, with the script's gravity variable (or the gravity given; 1800 if there is neither). |

## Physics

See [Physics](physics.md).

| Call | |
| --- | --- |
| `raycast(x1, y1, x2, y2, tags)` | The first body or solid tiles on a line: { piece, x, y, nx, ny, fraction }, or nil. tags (optional) only counts pieces with one of them. |
| `raycastAll(x1, y1, x2, y2, tags)` | Everything on a line, nearest first: a list of { piece, x, y, nx, ny, fraction }. |
| `piecesAt(x, y, tags)` | The bodies and zones whose shapes contain a point. |
| `overlap(kind, x, y, ...)` | The bodies and zones touching a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, width, height). |
| `getGravity()` | The scene's gravity: x, y in pixels per second per second. |
| `setGravity(x, y)` | Changes the scene's gravity: setGravity(0, 0) floats everything. |

## Screen

See [Project settings](settings.md).

| Call | |
| --- | --- |
| `screenWidth()` | The game's width, in game pixels. |
| `screenHeight()` | The game's height, in game pixels. |
| `fullscreen(on)` | fullscreen(true) fills the screen; fullscreen() is true while it does. |

## Drawing

See [Drawing](drawing.md).

| Call | |
| --- | --- |
| `pen(r, g, b, a)` | The color to draw with: pen(1, 0, 0), pen({1, 0, 0}), pen("#ff8800"). |
| `penSize(width)` | How thick lines and outlines are. |
| `clearScreen(color)` | Fills the whole screen with a color (the pen's if none). |
| `rect(x, y, w, h, fill)` | A rectangle (fill = false for an outline). |
| `circle(x, y, radius, fill)` | A circle (fill = false for an outline). |
| `oval(x, y, rx, ry, fill)` | An ellipse. |
| `poly(points, fill)` | A polygon: poly({x1, y1, x2, y2, x3, y3}). |
| `line(x1, y1, x2, y2, ...)` | A line through points. |
| `dot(x, y)` | One pixel. |
| `write(text, x, y, options)` | Text; options: a size, or { size, font, align, width }. With rich = true it reads tags like [b]bold[/b]; visible = 5 shows the first 5 characters. Returns the width and height. |
| `sprite(image, x, y, options)` | An image, or a frame of a sheet: sprite("art/hero.sprite", x, y, { frame = 2, rotation = 90 }). rotation is in degrees. |

## Script functions

The engine calls these functions when a script has them.

| Function | Pieces | |
| --- | --- | --- |
| `function ready(...)` | Piece | The piece and its children joined the scene. The scene root gets go()'s extra values. |
| `function update(dt)` | Piece | Every frame. dt is the time since the last frame, in seconds. |
| `function physicsUpdate(dt)` | Piece | 60 times a second, before bodies move. Use it for movement. |
| `function draw()` | Piece | Draw extra things on top of the piece, in its own coordinates. |
| `function removed()` | Piece | The piece is leaving the scene. |
| `function hit(other, contact)` | Body | Started touching a body or solid tiles. contact: x, y, nx, ny (from other to this body), impulse. |
| `function entered(zone)` | Body, Zone | Body: It went into a zone. Zone: A body or zone came in. |
| `function exited(zone)` | Body, Zone | Body: It left a zone. Zone: A body or zone left. |
| `function clicked()` | Button, Panel, Picture | Button: The button was clicked, tapped, or pressed with accept while focused. Panel: The panel was clicked or tapped (not on a button inside it). Picture: The picture was clicked or tapped. |
| `function touched()` | TouchStick, TouchButton | TouchStick: A finger landed on the stick. TouchButton: A finger pressed the button (or slid onto it). |
| `function untouched()` | TouchStick, TouchButton | TouchStick: The finger let go of the stick. TouchButton: The finger let go, or slid off. |
| `function tick()` | Timer | The countdown reached zero. |
| `function finished(animation)` | Sprite, Text, Particles, Label, Sound | Sprite: A non-looping animation reached its last frame. Text: reveal() has shown the whole text. Particles: The last particle is gone and no more are coming (after a burst or stop()). Good for destroy(). Label: reveal() has shown the whole text. Sound: The sound reached its end (not when looping). |
| `function hovered()` | UI | The pointer came over it (not Labels). |
| `function unhovered()` | UI | The pointer left it. |
| `function revealed(index, char)` | Text, Label | Text: reveal() showed one more character: play a blip, or wait at a full stop. Label: reveal() showed one more character: play a blip, or wait at a full stop. |
| `function eachCharacter(c)` | Text, Label | Text: Called for every character each time the text is drawn, to move or color it: c.y = math.sin(c.time * 4 + c.index) * 3. c has x, y, rotation, scale, color, alpha, visible to change, and index, count, char, line, time, since to read. It's one table used for every character, so don't keep it. Label: Called for every character each time the text is drawn, to move or color it: c.y = math.sin(c.time * 4 + c.index) * 3. c has x, y, rotation, scale, color, alpha, visible to change, and index, count, char, line, time, since to read. It's one table used for every character, so don't keep it. |
| `function linkPressed(name)` | Label | A [link=name] in the text was clicked or tapped. |
| `function changed(text)` | TextInput, Slider | TextInput: The text changed by typing, deleting or pasting (not when a script sets it). Slider: The player moved the slider (not when a script sets value). |
| `function toggled(checked)` | Checkbox | It was ticked or unticked: by the player, by toggle(), or because another one in its group was ticked. |
| `function submitted(text)` | TextInput | Enter was pressed (in a multiline one: Ctrl+Enter). |
| `function focused()` | TextInput | It began being typed in. |
| `function blurred()` | TextInput | It stopped being typed in: the focus went elsewhere, or Escape was pressed. |
| `function scrolled(x, y)` | Scroll | The player scrolled it. |
