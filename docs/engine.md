# The engine table

`smitten` holds the engine: drawing (`smitten.graphics`), sound (`smitten.audio`,
`smitten.sound`), input devices (`smitten.keyboard`, `smitten.mouse`, `smitten.joystick`,
`smitten.touch`), files (`smitten.filesystem`), `smitten.math`, `smitten.timer`,
`smitten.window` and the rest, and Smitten's own modules. This page lists Smitten's
modules and the helpers it adds to the others.

## Smitten's modules

### smitten.scene

See [Scenes and pieces](scenes.md).

| Function | |
| --- | --- |
| `smitten.scene.go(path, ...)` | Goes to another scene at the end of the frame: smitten.scene.go("scenes/level2.scene"). |
| `smitten.scene.reload()` | Starts the running scene again from its file. |
| `smitten.scene.make(sceneOrType, properties?, script?)` | Makes a piece without adding it: make("scenes/coin.scene") or make("Sprite", { image = "art/coin.png" }). |
| `smitten.scene.spawn(sceneOrType, properties?, parent?)` | Makes a piece and adds it to the scene (or to parent): spawn("scenes/bullet.scene", { x = 10 }). |
| `smitten.scene.tagged(tag)` | Every piece with a tag, as a list. |
| `smitten.scene.first(tag)` | The first piece with a tag, or nil. |
| `smitten.scene.find(path)` | A piece of the running scene by its path from the root. |
| `smitten.scene.screenToWorld(x, y)` | A point on the screen as a point in the scene (through the camera). |
| `smitten.scene.worldToScreen(x, y)` | A point in the scene as a point on the screen. |
| `smitten.scene.setCurrent(root)` | Makes a piece built in code the running scene. |
| `smitten.scene.getDelta()` | The current step's length: the frame time in update(), the fixed step in physicsUpdate(). |
| `smitten.scene.transition(kind, seconds?, color?)` | How go() and reload() change scenes: transition("fade", 0.4) or transition("none"). |
| `smitten.scene.isChanging()` | True while the scene is about to change or a transition is running. |
| `smitten.scene.runsWhilePaused(piece)` | True if a piece keeps running while the game is paused (pausable off on it or a piece it's inside). |

Fields: `current`, `path`, `args`, `paused`, `timeScale`, `showShapes`.

### smitten.input

See [Input](input.md).

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

### smitten.tween

`smitten.tween(target, seconds, values, easing)`. Easings: [Scripts](scripts.md#waiting).

| Function | |
| --- | --- |
| `smitten.tween.to(target, seconds, values, easing?, done?)` | Changes numbers smoothly; smitten.tween(...) does the same. |
| `smitten.tween.after(seconds, fn)` | Calls fn once, later. |
| `smitten.tween.every(seconds, fn)` | Calls fn repeatedly until it returns false. |
| `smitten.tween.easingNames()` | Every easing's name (linear, outQuad, outBack, outBounce, ...). |

### smitten.assets

Loads and caches files. Paths are relative to the project folder.

| Function | |
| --- | --- |
| `smitten.assets.image(path)` | An Image, cached. |
| `smitten.assets.sprite(path)` | A .sprite file: image, frames and animations. |
| `smitten.assets.tileset(path)` | A .tileset file. |
| `smitten.assets.font(path, size)` | A font: a .ttf/.otf file, "pixel", or "" for the default. |
| `smitten.assets.audio(path)` | A sound ready to play: :newSource():play(). |
| `smitten.assets.scene(path)` | A .scene file, decoded. |
| `smitten.assets.script(path)` | Runs a script file and returns its table. |
| `smitten.assets.load(path)` | Loads any file by its extension. |
| `smitten.assets.readJSON(path)` | Reads and decodes a JSON file. |
| `smitten.assets.clear(path?)` | Forgets cached files so they load again. |

### smitten.storage

See [Saving](saving.md).

| Function | |
| --- | --- |
| `smitten.storage.save(key, value)` | Saves a value between plays: smitten.storage.save("best", score). |
| `smitten.storage.load(key, default?)` | A saved value, or default. |
| `smitten.storage.remove(key)` | Forgets a saved value. |
| `smitten.storage.keys()` | Every saved value's name. |

### smitten.display

See [Project settings](settings.md).

| Function | |
| --- | --- |
| `smitten.display.toGame(x, y)` | Window coordinates to game coordinates. |
| `smitten.display.toWindow(x, y)` | Game coordinates to window coordinates. |
| `smitten.display.getWindowRect()` | The game's area in the window: x, y, width, height. |

Fields: `width`, `height`, `viewX`, `viewY`, `viewWidth`, `viewHeight`, `scale`, `stretch`, `filter`, `antialias`, `background`.

### smitten.boards

Leaderboards on the games site. See [Leaderboards](leaderboards.md).

| Function | |
| --- | --- |
| `smitten.boards.available()` | True while the game runs on its page on the games site and has leaderboards there. False in the editor and in exported games. |
| `smitten.boards.submit(key, value, options?, callback?)` | Sends a score to a leaderboard: smitten.boards.submit("best", score). options: { name = "Ada" } for someone not signed in. Answers { rank, value, improved }, or nil and why. |
| `smitten.boards.top(key, count?, callback?)` | The best scores, best first: a list of { rank, name, value, me, guest } (10 unless count says, 100 at most), or nil and why. |
| `smitten.boards.around(key, count?, callback?)` | The scores around the player's own (the top, if they have none). |
| `smitten.boards.list(callback?)` | The game's leaderboards: a list of { key, title, order, format, unit, scores }. |

### smitten.json

JSON text to Lua values and back.

| Function | |
| --- | --- |
| `smitten.json.decode(text)` | JSON text to Lua values. |
| `smitten.json.encode(value, indent?)` | Lua values to JSON text. |

Fields: `null`.

### smitten.physics

Queries on the running scene's physics. See [Physics](physics.md).

| Function | |
| --- | --- |
| `smitten.physics.raycast(x1, y1, x2, y2, tags?)` | The first body or tiles a line touches, nearest first: {piece, x, y, nx, ny, fraction}, or nil. |
| `smitten.physics.raycastAll(x1, y1, x2, y2, tags?)` | Every hit along a line, nearest first. |
| `smitten.physics.piecesAt(x, y, tags?)` | The bodies and zones whose shapes contain a point. |
| `smitten.physics.overlap(kind, ...)` | The bodies and zones touching a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, w, h). |
| `smitten.physics.getGravity()` | The scene's gravity: x, y (pixels per second per second). |
| `smitten.physics.setGravity(x, y)` | Changes the scene's gravity: setGravity(0, 0) floats. |

### smitten.paths

Finding a way from one place to another. See [Pathfinding](pathfinding.md).

| Function | |
| --- | --- |
| `smitten.paths.newGrid(columns, rows, options?)` | A grid of open and solid cells to find paths through: newGrid(40, 30, { cellSize = 16, diagonals = "noCorners" }). A Tiles piece makes one of itself with newPathGrid(). |
| `smitten.paths.newGraph()` | An empty graph: points you add and connect by hand, and paths along the connections. |
| `smitten.paths.newArea(areas, holes?)` | A walkable area from polygons and holes cut out of them: newArea({ { 0, 0, 400, 0, 400, 300, 0, 300 } }, { hole }). |
| `smitten.paths.newAgent(options?)` | Something that follows paths: it remembers a target and says which point to head for next. options: finder (a grid, graph or area; the scene's Walkable pieces if left out), reach, replan, partial, tags. |
| `smitten.paths.findPath(x1, y1, x2, y2, options?)` | The short way between two points through the scene's Walkable pieces: {x, y, x, y, ...}, or nil. options: tags, partial. |
| `smitten.paths.closestPoint(x, y, options?)` | The walkable point nearest a point: x, y. |
| `smitten.paths.isWalkable(x, y, options?)` | True if a point is inside a Walkable piece and not in a hole. |
| `smitten.paths.getArea(options?)` | The area built from the scene's Walkable pieces. |
| `smitten.paths.refresh()` | Builds the scene's walkable area again; only needed after changing a Walkable's points in place. |
| `smitten.paths.length(path)` | How long a path is, in pixels. |
| `smitten.paths.pointAt(path, distance)` | The point a distance along a path from its start: x, y, and true once it's the end. |
| `smitten.paths.debugDraw(what?, options?)` | Draws a path, an agent's path or an area (with nothing: the scene's Walkable pieces) from a script's draw(). options: color, width. |

### smitten.text

Rich text, measuring and effects. See [Text](text.md).

| Function | |
| --- | --- |
| `smitten.text.effect(name, fn)` | Adds an effect for rich text: after effect("bounce", fn), [bounce]boing[/bounce] calls fn(c) for each character, every frame. Change c.x, c.y, c.rotation, c.scale, c.color, c.alpha, c.visible; read c.index, c.count, c.char, c.line, c.time, c.since, c.args, c.piece. |
| `smitten.text.effects()` | The names of every effect, sorted. |
| `smitten.text.measure(text, options?)` | How big a text is when drawn: width, height, lines. options: font, size, width (wraps), rich, wrap, lineHeight, letterSpacing. |
| `smitten.text.wrap(text, options?)` | The lines a text is broken into at a width: wrap("a long sentence", { width = 120 }) gives a list of strings. |
| `smitten.text.strip(text)` | The text without its tags: strip("[b]Hi[/b]") is "Hi". |
| `smitten.text.escape(text)` | Makes text safe to put inside rich text (a player's name): square brackets are shown, not read as tags. |
| `smitten.text.color(value)` | A color from "#ff8800", "#f80" or a name like "red": {r, g, b, a}, or nil. |

### smitten.synth

See [Sound and music](sound.md).

| Function | |
| --- | --- |
| `smitten.synth.sfx(path)` | A .sfx sound effect made in the Sound workspace; :play() it. |
| `smitten.synth.song(path)` | A .song made in the Music workspace; :play() it. |
| `smitten.synth.renderSfx(params)` | Renders sound effect parameters to a SoundData. |
| `smitten.synth.renderSong(song, basePath)` | Renders a song table to a SoundData. |

## Helpers in the engine's modules

### smitten.math

| Function | |
| --- | --- |
| `smitten.math.chance(p)` | True with probability p: chance(0.25) is true a quarter of the time. |
| `smitten.math.pick(list)` | A random element of a list. |
| `smitten.math.clamp(v, lo, hi)` | v kept between lo and hi. |
| `smitten.math.lerp(a, b, t)` | The value t of the way from a to b. |
| `smitten.math.approach(v, target, step)` | v moved towards target by at most step. |
| `smitten.math.sign(v)` | 1, 0 or -1. |
| `smitten.math.round(v, step?)` | v rounded to the nearest multiple of step. |
| `smitten.math.distance(x1, y1, x2, y2)` | The distance between two points. |
| `smitten.math.angle(x1, y1, x2, y2)` | The angle from one point to another, in radians. |
| `smitten.math.randomFloat(a, b)` | A random number with a fraction, from a to b. |

### smitten.timer

| Function | |
| --- | --- |
| `smitten.timer.after(seconds, fn)` | Calls fn once, later. Returns a handle with :cancel(). |
| `smitten.timer.every(seconds, fn)` | Calls fn every so many seconds, until it returns false. |

### smitten.mouse

| Function | |
| --- | --- |
| `smitten.mouse.pressed(button?)` | True on the frame a mouse button (1 = left) went down. |
| `smitten.mouse.released(button?)` | True on the frame a mouse button went up. |
| `smitten.mouse.down(button?)` | True while a mouse button is held. |
| `smitten.mouse.getDelta()` | How far the mouse moved this frame: dx, dy. |
| `smitten.mouse.isOverUI()` | True while the pointer is over a UI button or panel. |

Fields: `x`, `y`, `worldX`, `worldY`.

### smitten.keyboard

| Function | |
| --- | --- |
| `smitten.keyboard.pressed(key)` | True on the frame a key went down. |
| `smitten.keyboard.released(key)` | True on the frame a key went up. |

### smitten.audio

| Function | |
| --- | --- |
| `smitten.audio.sfx(name, volume?, pitch?)` | Plays a sound once by name or path: smitten.audio.sfx("coin", { volume = 0.5 }). |
| `smitten.audio.music(name, options?)` | Plays music on a loop instead of the music playing; options: volume, pitch, fade. |
| `smitten.audio.stopMusic(fade?)` | Stops the music, fading out over fade seconds if given. |
| `smitten.audio.pauseMusic()` | Pauses the music. |
| `smitten.audio.resumeMusic()` | Continues the music. |
| `smitten.audio.getMusic()` | The Source playing the music, or nil. |
