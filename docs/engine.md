# The engine table

`smitten` and `love` are the same table, so [LÖVE 12's API](https://love2d.org/wiki/Main_Page)
is all there. This page lists what Smitten adds.

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

### smitten.json

JSON text to Lua values and back.

| Function | |
| --- | --- |
| `smitten.json.decode(text)` | JSON text to Lua values. |
| `smitten.json.encode(value, indent?)` | Lua values to JSON text. |

Fields: `null`.

### smitten.synth

See [Sound and music](sound.md).

| Function | |
| --- | --- |
| `smitten.synth.sfx(path)` | A .sfx sound effect made in the Sound workspace; :play() it. |
| `smitten.synth.song(path)` | A .song made in the Music workspace; :play() it. |
| `smitten.synth.renderSfx(params)` | Renders sound effect parameters to a SoundData. |
| `smitten.synth.renderSong(song, basePath)` | Renders a song table to a SoundData. |

## Added to LÖVE's modules

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
