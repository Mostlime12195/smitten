// The short API scripts get without smitten. in front (the engine's side is
// love/src/modules/scene/script.lua). For completions, the docs
// (tools/gen-docs.mjs) and checks (tools/editor-tests).

/** The short API by topic: [name, signature, what it does]. */
export const SCRIPT_API_GROUPS = [
  {
    name: 'Input',
    page: 'input',
    items: [
      ['pressed', 'pressed(action, player?)', 'Returns true on the frame when the player presses an action (jump, left, fire...) or an input ("space", "mouse:1", "pad:a"). pressed() alone checks every key and button. With a player number, it checks only that player: pressed("jump", 2).'],
      ['down', 'down(action, player?)', 'Returns true while the player holds an action or an input down.'],
      ['released', 'released(action, player?)', 'Returns true on the frame when the player lets go of an action or an input.'],
      ['axis', 'axis(negative, positive, player?)', 'Returns a value from -1 to 1 (values in between for sticks): axis("left", "right").'],
      ['vector', 'vector(left, right, up, down, player?)', 'Returns the x, y of a direction, with a length of 1 at most.'],
      ['mouse', 'mouse()', 'Returns the x, y of the mouse in the scene.'],
      ['mouseScreen', 'mouseScreen()', 'Returns the x, y of the mouse on the screen, in game pixels (for UI).'],
      ['wheel', 'wheel()', 'Returns how far the mouse wheel turned in this frame: x, y (y > 0 is up).'],
      ['touches', 'touches()', 'Returns the fingers on the screen: a list of { id, x, y, worldX, worldY }.'],
      ['stick', 'stick(side, player?)', 'Returns the position of a gamepad stick, "left" or "right": x, y from -1 to 1.'],
      ['trigger', 'trigger(side, player?)', 'Returns the position of a gamepad trigger, "left" or "right": 0 to 1.'],
      ['vibrate', 'vibrate(strength, seconds, player?)', 'Makes gamepads vibrate: vibrate(0.5, 0.2).'],
      ['typed', 'typed()', 'Returns the text that the player typed in this frame ("" if none). It also turns text input on.'],
    ],
  },
  {
    name: 'Scenes',
    page: 'scenes',
    items: [
      ['go', 'go(scene, ...)', 'Goes to another scene. The extra values go to ready(...) of its root piece.'],
      ['reload', 'reload()', 'Starts this scene again.'],
      ['transition', 'transition(kind, seconds, color)', 'Sets how go() changes scenes: transition("fade", 0.4) or transition("none").'],
      ['spawn', 'spawn(sceneOrType, properties, parent)', 'Makes a piece and adds it to the scene (self:spawn adds it inside this piece).'],
      ['make', 'make(sceneOrType, properties)', 'Makes a piece but does not add it to the scene.'],
      ['tagged', 'tagged(tag)', 'Returns every piece with a tag.'],
      ['first', 'first(tag)', 'Returns the first piece with a tag, or nil.'],
      ['root', 'root()', 'Returns the root piece of the scene.'],
      ['camera', 'camera()', 'Returns the camera in use, or nil.'],
      ['game', 'game', 'A table for the whole game. It stays when the scene changes: game.score += 1.'],
      ['pauseGame', 'pauseGame()', 'Pauses pieces and physics (pieces with pausable off keep running).'],
      ['resumeGame', 'resumeGame()', 'Ends the pause: pieces and physics continue.'],
      ['isPaused', 'isPaused()', 'Returns true while the game is paused.'],
      ['timeScale', 'timeScale(scale)', 'Sets how fast time goes: timeScale(0.5) is slow motion. timeScale() returns the current value.'],
    ],
  },
  {
    name: 'Sound',
    page: 'sound',
    items: [
      ['sfx', 'sfx(name, volume, pitch)', 'Plays a sound once. sfx("coin") finds coin.sfx (or .wav, .ogg...) anywhere in the project. You can also give options: sfx("hit", { volume = 0.5, pitch = 1.2 }).'],
      ['music', 'music(name, options)', 'Plays music in a loop, in place of the current music: music("theme", { volume = 0.6, fade = 1 }).'],
      ['stopMusic', 'stopMusic(fade)', 'Stops the music. If you give fade, the music fades out over fade seconds.'],
      ['pauseMusic', 'pauseMusic()', 'Pauses the music.'],
      ['resumeMusic', 'resumeMusic()', 'Continues the music.'],
      ['masterVolume', 'masterVolume(volume)', 'Sets the volume of every sound, 0 to 1. masterVolume() returns the current value.'],
    ],
  },
  {
    name: 'Saving',
    page: 'saving',
    items: [
      ['save', 'save(key, value)', 'Keeps a value between plays: save("best", score).'],
      ['load', 'load(key, default)', 'Returns a saved value, or default: load("best", 0).'],
    ],
  },
  {
    name: 'Time',
    page: 'scripts',
    items: [
      ['wait', 'wait(seconds)', 'Pauses ready(), an event function or a task for some seconds.'],
      ['task', 'task(function)', 'Runs a function that can wait().'],
      ['after', 'after(seconds, function)', 'Calls a function once, after some seconds.'],
      ['every', 'every(seconds, function)', 'Calls a function each time the given seconds pass, until it returns false.'],
      ['tween', 'tween(target, seconds, values, easing)', 'Changes numbers smoothly: tween(self, 0.3, { y = 100 }).'],
      ['time', 'time()', 'Returns the seconds since the game started.'],
    ],
  },
  {
    name: 'Math',
    page: 'scripts',
    items: [
      ['approach', 'approach(value, target, step)', 'Returns value, moved towards target by at most step.'],
      ['lerp', 'lerp(a, b, t)', 'Returns a value between a and b: t = 0 gives a, 1 gives b.'],
      ['clamp', 'clamp(value, min, max)', 'Returns value, kept between min and max.'],
      ['sign', 'sign(value)', 'Returns -1, 0 or 1.'],
      ['round', 'round(value, step)', 'Returns value, rounded to the nearest step (1 if you leave it out).'],
      ['rnd', 'rnd(n)', 'rnd() returns 0 to 1. rnd(n) returns 0 to n. rnd(list) returns one of its items.'],
      ['choose', 'choose(...)', 'Returns one of its arguments, at random.'],
      ['dist', 'dist(a, b)', 'Returns the distance between two pieces, or between two points: dist(x1, y1, x2, y2).'],
      ['jumpSpeed', 'jumpSpeed(height, gravity)', 'Returns the upward speed for a jump of this height. It uses the gravity variable of the script, or the gravity that you give, or 1800 if there is neither.'],
    ],
  },
  {
    name: 'Physics',
    page: 'physics',
    items: [
      ['raycast', 'raycast(x1, y1, x2, y2, tags)', 'Returns the first body or solid tiles on a line: { piece, x, y, nx, ny, fraction }, or nil. If you give tags, it counts only pieces with one of them.'],
      ['raycastAll', 'raycastAll(x1, y1, x2, y2, tags)', 'Returns everything on a line, nearest first: a list of { piece, x, y, nx, ny, fraction }.'],
      ['piecesAt', 'piecesAt(x, y, tags)', 'Returns the bodies and zones whose shapes contain a point.'],
      ['overlap', 'overlap(kind, x, y, ...)', 'Returns the bodies and zones that touch a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, width, height).'],
      ['getGravity', 'getGravity()', 'Returns the gravity of the scene: x, y in pixels per second per second.'],
      ['setGravity', 'setGravity(x, y)', 'Changes the gravity of the scene: setGravity(0, 0) makes everything float.'],
    ],
  },
  {
    name: 'Screen',
    page: 'settings',
    items: [
      ['screenWidth', 'screenWidth()', 'Returns the width of the game, in game pixels.'],
      ['screenHeight', 'screenHeight()', 'Returns the height of the game, in game pixels.'],
      ['fullscreen', 'fullscreen(on)', 'fullscreen(true) fills the screen. fullscreen() returns true while the game fills the screen.'],
    ],
  },
  {
    name: 'Drawing',
    page: 'drawing',
    items: [
      ['pen', 'pen(r, g, b, a)', 'Sets the color to draw with: pen(1, 0, 0), pen({1, 0, 0}), pen("#ff8800").'],
      ['penSize', 'penSize(width)', 'Sets the thickness of lines and outlines.'],
      ['clearScreen', 'clearScreen(color)', 'Fills the whole screen with a color (with the pen color if you give none).'],
      ['rect', 'rect(x, y, w, h, fill)', 'Draws a rectangle (fill = false for an outline).'],
      ['circle', 'circle(x, y, radius, fill)', 'Draws a circle (fill = false for an outline).'],
      ['oval', 'oval(x, y, rx, ry, fill)', 'Draws an ellipse.'],
      ['poly', 'poly(points, fill)', 'Draws a polygon: poly({x1, y1, x2, y2, x3, y3}).'],
      ['line', 'line(x1, y1, x2, y2, ...)', 'Draws a line through points.'],
      ['dot', 'dot(x, y)', 'Draws one pixel.'],
      ['write', 'write(text, x, y, options)', 'Draws text. options is a size, or { size, font, align, width }. With rich = true, it reads markup like [b]bold[/b]. visible = 5 shows the first 5 characters. Returns the width and height.'],
      ['sprite', 'sprite(image, x, y, options)', 'Draws an image, or an animation frame of a sprite sheet: sprite("art/hero.sprite", x, y, { frame = 2, rotation = 90 }). rotation is in degrees.'],
    ],
  },
];

/** Every name: [name, signature, what it does]. */
export const SCRIPT_API = SCRIPT_API_GROUPS.flatMap((g) => g.items);

export const SCRIPT_API_NAMES = new Set(SCRIPT_API.map(([name]) => name));

/** Callbacks the engine calls on a script, if it has them. */
export const SCRIPT_CALLBACKS = ['ready', 'update', 'physicsUpdate', 'draw', 'removed', 'hit', 'entered', 'exited', 'clicked', 'touched', 'untouched', 'tick', 'finished', 'hovered', 'unhovered', 'revealed', 'eachCharacter', 'linkPressed', 'changed', 'toggled', 'submitted', 'focused', 'blurred', 'scrolled'];
