# The engine table

`smitten` holds the engine. It has drawing (`smitten.graphics`), sound
(`smitten.audio`, `smitten.sound`), input devices (`smitten.keyboard`, `smitten.mouse`,
`smitten.joystick`, `smitten.touch`) and files (`smitten.filesystem`). It also has
`smitten.math`, `smitten.timer`, `smitten.window`, the other modules, and Smitten's own
modules. This page gives Smitten's own modules, and the helpers that Smitten adds to
the other modules.

## Smitten's modules

### smitten.scene

See [Scenes and pieces](scenes.md).

| Function | |
| --- | --- |
| `smitten.scene.go(path, ...)` | Goes to another scene at the end of the frame: smitten.scene.go("scenes/level2.scene"). |
| `smitten.scene.reload()` | Starts the running scene again from its file. |
| `smitten.scene.make(sceneOrType, properties?, script?)` | Makes a piece but does not add it to the scene: make("scenes/coin.scene") or make("Sprite", { image = "art/coin.png" }). |
| `smitten.scene.spawn(sceneOrType, properties?, parent?)` | Makes a piece and adds it to the scene (or to parent): spawn("scenes/bullet.scene", { x = 10 }). |
| `smitten.scene.tagged(tag)` | Returns every piece with a tag, as a list. |
| `smitten.scene.first(tag)` | Returns the first piece with a tag, or nil. |
| `smitten.scene.find(path)` | Returns a piece of the running scene by its path from the root piece. |
| `smitten.scene.screenToWorld(x, y)` | Takes a point on the screen and returns it as a point in the scene (through the camera). |
| `smitten.scene.worldToScreen(x, y)` | Takes a point in the scene and returns it as a point on the screen. |
| `smitten.scene.setCurrent(root)` | Makes a piece that a script builds the running scene. |
| `smitten.scene.getDelta()` | Returns the length of the current step: the frame time in update(), the fixed step in physicsUpdate(). |
| `smitten.scene.transition(kind, seconds?, color?)` | Sets how go() and reload() change scenes: transition("fade", 0.4) or transition("none"). |
| `smitten.scene.isChanging()` | Returns true while the scene is about to change or a transition runs. |
| `smitten.scene.runsWhilePaused(piece)` | Returns true if a piece keeps running while the game is paused (pausable is off on it, or on a piece that it is inside). |

Fields: `current`, `path`, `args`, `paused`, `timeScale`, `showShapes`.

### smitten.input

See [Input](input.md).

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

### smitten.tween

`smitten.tween(target, seconds, values, easing)`. The easings are in [Scripts](scripts.md#waiting).

| Function | |
| --- | --- |
| `smitten.tween.to(target, seconds, values, easing?, done?)` | Changes numbers smoothly. smitten.tween(...) does the same. |
| `smitten.tween.after(seconds, fn)` | Calls fn once, later. |
| `smitten.tween.every(seconds, fn)` | Calls fn again and again until it returns false. |
| `smitten.tween.easingNames()` | Returns the names of all easings (linear, outQuad, outBack, outBounce, ...). |

### smitten.assets

Loads files and keeps them in memory. Paths are relative to the project folder.

| Function | |
| --- | --- |
| `smitten.assets.image(path)` | Returns an Image. The engine loads each file once and keeps it in a cache. |
| `smitten.assets.sprite(path)` | Returns a .sprite file: its image, animation frames and animations. |
| `smitten.assets.tileset(path)` | Returns a .tileset file. |
| `smitten.assets.font(path, size)` | Returns a font: a .ttf or .otf file, "pixel", or "" for the default font. |
| `smitten.assets.audio(path)` | Returns a sound that is ready to play: :newSource():play(). |
| `smitten.assets.scene(path)` | Reads a .scene file and returns its data. |
| `smitten.assets.script(path)` | Runs a script file and returns its table. |
| `smitten.assets.load(path)` | Loads any file. The extension of the file decides how. |
| `smitten.assets.readJSON(path)` | Reads a JSON file and returns its Lua values. |
| `smitten.assets.clear(path?)` | Removes files from the cache, so that they load again. |

### smitten.storage

See [Saving](saving.md).

| Function | |
| --- | --- |
| `smitten.storage.save(key, value)` | Saves a value between plays: smitten.storage.save("best", score). |
| `smitten.storage.load(key, default?)` | Returns a saved value, or default. |
| `smitten.storage.remove(key)` | Deletes a saved value. |
| `smitten.storage.keys()` | Returns the names of all saved values. |

### smitten.display

See [Project settings](settings.md).

| Function | |
| --- | --- |
| `smitten.display.toGame(x, y)` | Takes window coordinates and returns game coordinates. |
| `smitten.display.toWindow(x, y)` | Takes game coordinates and returns window coordinates. |
| `smitten.display.getWindowRect()` | Returns the area of the game in the window: x, y, width, height. |

Fields: `width`, `height`, `viewX`, `viewY`, `viewWidth`, `viewHeight`, `scale`, `stretch`, `filter`, `antialias`, `background`.

### smitten.boards

Leaderboards on the games site. See [Leaderboards](leaderboards.md).

| Function | |
| --- | --- |
| `smitten.boards.available()` | Returns true while the game runs on its page on the games site and has leaderboards there. Returns false in the editor and in exported games. |
| `smitten.boards.submit(key, value, options?, callback?)` | Sends a score to a leaderboard: smitten.boards.submit("best", score). options: { name = "Ada" } for a player who is not signed in. The result is { rank, value, improved }, or nil and the reason. |
| `smitten.boards.top(key, count?, callback?)` | Returns the best scores, best first: a list of { rank, name, value, me, guest }, or nil and the reason. count is 10 if you leave it out, and 100 at most. |
| `smitten.boards.around(key, count?, callback?)` | Returns the scores around the score of the player (the top scores, if the player has no score). |
| `smitten.boards.list(callback?)` | Returns the leaderboards of the game: a list of { key, title, order, format, unit, scores }. |

### smitten.json

Changes JSON text to Lua values, and Lua values to JSON text.

| Function | |
| --- | --- |
| `smitten.json.decode(text)` | Changes JSON text into Lua values. |
| `smitten.json.encode(value, indent?)` | Changes Lua values into JSON text. |

Fields: `null`.

### smitten.physics

Queries about the physics of the scene that runs. See [Physics](physics.md).

| Function | |
| --- | --- |
| `smitten.physics.raycast(x1, y1, x2, y2, tags?)` | Returns the nearest body or tiles that a line touches: {piece, x, y, nx, ny, fraction}, or nil. |
| `smitten.physics.raycastAll(x1, y1, x2, y2, tags?)` | Returns every hit along a line, nearest first. |
| `smitten.physics.piecesAt(x, y, tags?)` | Returns the bodies and zones whose shapes contain a point. |
| `smitten.physics.overlap(kind, ...)` | Returns the bodies and zones that touch a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, w, h). |
| `smitten.physics.getGravity()` | Returns the gravity of the scene: x, y (pixels per second per second). |
| `smitten.physics.setGravity(x, y)` | Changes the gravity of the scene: setGravity(0, 0) makes everything float. |

### smitten.paths

Finds a way from one place to another. See [Pathfinding](pathfinding.md).

| Function | |
| --- | --- |
| `smitten.paths.newGrid(columns, rows, options?)` | Makes a grid of open and solid cells to find paths through: newGrid(40, 30, { cellSize = 16, diagonals = "noCorners" }). A Tiles piece makes its own grid with newPathGrid(). |
| `smitten.paths.newGraph()` | Makes an empty graph: you add points and connect them, and it finds paths along the connections. |
| `smitten.paths.newArea(areas, holes?)` | Makes a walkable area from polygons, with holes cut out of them: newArea({ { 0, 0, 400, 0, 400, 300, 0, 300 } }, { hole }). |
| `smitten.paths.newAgent(options?)` | Makes an agent that follows paths: it keeps a target and tells you the next point to go to. options: finder, reach, replan, partial, tags. finder is a grid, graph or area (the Walkable pieces of the scene if you leave it out). |
| `smitten.paths.findPath(x1, y1, x2, y2, options?)` | Returns a short path between two points through the Walkable pieces of the scene: {x, y, x, y, ...}, or nil. options: tags, partial. |
| `smitten.paths.closestPoint(x, y, options?)` | Returns the walkable point that is nearest to a point: x, y. |
| `smitten.paths.isWalkable(x, y, options?)` | Returns true if a point is inside a Walkable piece and not in a hole. |
| `smitten.paths.getArea(options?)` | Returns the area that the engine makes from the Walkable pieces of the scene. |
| `smitten.paths.refresh()` | Makes the walkable area of the scene again. You need it only after you change the points of a Walkable in place. |
| `smitten.paths.length(path)` | Returns the length of a path, in pixels. |
| `smitten.paths.pointAt(path, distance)` | Returns the point at a distance along a path from its start: x, y, and true if it is the end. |
| `smitten.paths.debugDraw(what?, options?)` | Draws a path, the path of an agent or an area, from the draw() function of a script. With no argument, it draws the Walkable pieces of the scene. options: color, width. |

### smitten.text

Rich text, text measurement and text effects. See [Text](text.md).

| Function | |
| --- | --- |
| `smitten.text.effect(name, fn)` | Adds an effect for rich text. After effect("bounce", fn), [bounce]boing[/bounce] calls fn(c) for each character, every frame. You can change c.x, c.y, c.rotation, c.scale, c.color, c.alpha and c.visible. You can read c.index, c.count, c.char, c.line, c.time, c.since, c.args and c.piece. |
| `smitten.text.effects()` | Returns the names of all effects, sorted. |
| `smitten.text.measure(text, options?)` | Returns the size of a text when the engine draws it: width, height, lines. options: font, size, width (wraps), rich, wrap, lineHeight, letterSpacing. |
| `smitten.text.wrap(text, options?)` | Returns the lines of a text when it wraps at a width: wrap("a long sentence", { width = 120 }) returns a list of strings. |
| `smitten.text.strip(text)` | Returns the text without its markup: strip("[b]Hi[/b]") is "Hi". |
| `smitten.text.escape(text)` | Makes text safe to put inside rich text, for example the name of a player. The engine shows square brackets in it and does not read them as markup. |
| `smitten.text.color(value)` | Returns a color from "#ff8800", "#f80" or a name like "red": {r, g, b, a}, or nil. |

### smitten.synth

See [Sound and music](sound.md).

| Function | |
| --- | --- |
| `smitten.synth.sfx(path)` | Returns a .sfx sound effect that you make in the Sound workspace. Use :play() to play it. |
| `smitten.synth.song(path)` | Returns a .song that you make in the Music workspace. Use :play() to play it. |
| `smitten.synth.renderSfx(params)` | Makes a SoundData from the parameters of a sound effect. |
| `smitten.synth.renderSong(song, basePath)` | Makes a SoundData from a song table. |

## Helpers in the engine's modules

### smitten.math

| Function | |
| --- | --- |
| `smitten.math.chance(p)` | Returns true with probability p: chance(0.25) is true one time in four. |
| `smitten.math.pick(list)` | Returns a random item of a list. |
| `smitten.math.clamp(v, lo, hi)` | Returns v, kept between lo and hi. |
| `smitten.math.lerp(a, b, t)` | Returns the value that is t of the way from a to b. |
| `smitten.math.approach(v, target, step)` | Returns v, moved towards target by at most step. |
| `smitten.math.sign(v)` | Returns 1, 0 or -1. |
| `smitten.math.round(v, step?)` | Returns v, rounded to the nearest multiple of step. |
| `smitten.math.distance(x1, y1, x2, y2)` | Returns the distance between two points. |
| `smitten.math.angle(x1, y1, x2?, y2?)` | Returns the angle in degrees of a direction, angle(x, y), or from one point to another, angle(x1, y1, x2, y2). 0 is right, 90 is down. |
| `smitten.math.direction(angle, length?)` | Returns the x, y of a step with a length (1 if you leave it out) at an angle in degrees: vx, vy = smitten.math.direction(rotation, 200). |
| `smitten.math.randomFloat(a, b)` | Returns a random number with a fraction, from a to b. |

### smitten.timer

| Function | |
| --- | --- |
| `smitten.timer.after(seconds, fn)` | Calls fn once, later. Returns a handle with :cancel(). |
| `smitten.timer.every(seconds, fn)` | Calls fn each time the given seconds pass, until it returns false. |

### smitten.mouse

| Function | |
| --- | --- |
| `smitten.mouse.pressed(button?)` | Returns true on the frame when a mouse button goes down (1 is the left button). |
| `smitten.mouse.released(button?)` | Returns true on the frame when a mouse button goes up. |
| `smitten.mouse.down(button?)` | Returns true while a mouse button is down. |
| `smitten.mouse.getDelta()` | Returns how far the mouse moved in this frame: dx, dy. |
| `smitten.mouse.isOverUI()` | Returns true while the mouse pointer is over a UI button or panel. |

Fields: `x`, `y`, `worldX`, `worldY`.

### smitten.keyboard

| Function | |
| --- | --- |
| `smitten.keyboard.pressed(key)` | Returns true on the frame when a key goes down. |
| `smitten.keyboard.released(key)` | Returns true on the frame when a key goes up. |

### smitten.audio

| Function | |
| --- | --- |
| `smitten.audio.sfx(name, volume?, pitch?)` | Plays a sound once by name or path: smitten.audio.sfx("coin", { volume = 0.5 }). |
| `smitten.audio.music(name, options?)` | Plays music in a loop, in place of the current music. options: volume, pitch, fade. |
| `smitten.audio.stopMusic(fade?)` | Stops the music. If you give fade, the music fades out over fade seconds. |
| `smitten.audio.pauseMusic()` | Pauses the music. |
| `smitten.audio.resumeMusic()` | Continues the music. |
| `smitten.audio.getMusic()` | Returns the Source that plays the music, or nil. |
