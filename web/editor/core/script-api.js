// The short API scripts get without smitten. in front (the engine's side is
// love/src/modules/scene/script.lua). For completions, the docs
// (tools/gen-docs.mjs) and checks (tools/editor-tests).

/** The short API by topic: [name, signature, what it does]. */
export const SCRIPT_API_GROUPS = [
  {
    name: 'Input',
    page: 'input',
    items: [
      ['pressed', 'pressed(action, player?)', 'True on the frame an action (jump, left, fire...) or an input ("space", "mouse:1", "pad:a") is pressed. pressed() alone: any key or button. With a player number, that player only: pressed("jump", 2).'],
      ['down', 'down(action, player?)', 'True while an action or input is held.'],
      ['released', 'released(action, player?)', 'True on the frame an action or input is let go.'],
      ['axis', 'axis(negative, positive, player?)', '-1 to 1 (in between for sticks): axis("left", "right").'],
      ['vector', 'vector(left, right, up, down, player?)', 'x, y of a direction, at most 1 long.'],
      ['mouse', 'mouse()', 'x, y of the mouse in the scene.'],
      ['mouseScreen', 'mouseScreen()', 'x, y of the mouse on the screen, in game pixels (for UI).'],
      ['wheel', 'wheel()', 'How far the mouse wheel turned this frame: x, y (y > 0 is up).'],
      ['touches', 'touches()', 'The fingers on the screen: a list of { id, x, y, worldX, worldY }.'],
      ['stick', 'stick(side, player?)', 'A gamepad stick, "left" or "right": x, y from -1 to 1.'],
      ['trigger', 'trigger(side, player?)', 'A gamepad trigger, "left" or "right": 0 to 1.'],
      ['vibrate', 'vibrate(strength, seconds, player?)', 'Rumbles gamepads: vibrate(0.5, 0.2).'],
      ['typed', 'typed()', 'The text typed this frame ("" if none); turns text input on.'],
    ],
  },
  {
    name: 'Scenes',
    page: 'scenes',
    items: [
      ['go', 'go(scene, ...)', 'Goes to another scene; extra values go to its root\'s ready(...).'],
      ['reload', 'reload()', 'Starts this scene again.'],
      ['transition', 'transition(kind, seconds, color)', 'How go() changes scenes: transition("fade", 0.4) or transition("none").'],
      ['spawn', 'spawn(sceneOrType, properties, parent)', 'Makes a piece and adds it to the scene (self:spawn adds it inside this piece).'],
      ['make', 'make(sceneOrType, properties)', 'Makes a piece without adding it anywhere.'],
      ['tagged', 'tagged(tag)', 'Every piece with a tag.'],
      ['first', 'first(tag)', 'The first piece with a tag, or nil.'],
      ['root', 'root()', 'The scene\'s root piece.'],
      ['camera', 'camera()', 'The camera in use, or nil.'],
      ['game', 'game', 'A table for the whole game, kept when the scene changes: game.score += 1.'],
      ['pauseGame', 'pauseGame()', 'Pauses pieces and physics (pieces with pausable off keep running).'],
      ['resumeGame', 'resumeGame()', 'Unpauses.'],
      ['isPaused', 'isPaused()', 'True while the game is paused.'],
      ['timeScale', 'timeScale(scale)', 'How fast time goes: timeScale(0.5) is slow motion; timeScale() reads it.'],
    ],
  },
  {
    name: 'Sound',
    page: 'sound',
    items: [
      ['sfx', 'sfx(name, volume, pitch)', 'Plays a sound once: sfx("coin") finds coin.sfx (or .wav, .ogg...) anywhere; sfx("hit", { volume = 0.5, pitch = 1.2 }).'],
      ['music', 'music(name, options)', 'Plays music on a loop instead of the music playing: music("theme", { volume = 0.6, fade = 1 }).'],
      ['stopMusic', 'stopMusic(fade)', 'Stops the music, fading out over fade seconds if given.'],
      ['pauseMusic', 'pauseMusic()', 'Pauses the music.'],
      ['resumeMusic', 'resumeMusic()', 'Continues the music.'],
      ['masterVolume', 'masterVolume(volume)', 'Every sound\'s volume, 0 to 1; masterVolume() reads it.'],
    ],
  },
  {
    name: 'Saving',
    page: 'saving',
    items: [
      ['save', 'save(key, value)', 'Keeps a value between plays: save("best", score).'],
      ['load', 'load(key, default)', 'A saved value, or default: load("best", 0).'],
    ],
  },
  {
    name: 'Time',
    page: 'scripts',
    items: [
      ['wait', 'wait(seconds)', 'Pauses ready(), an event or a task for some seconds.'],
      ['task', 'task(function)', 'Runs a function that can wait().'],
      ['after', 'after(seconds, function)', 'Calls a function once, after some seconds.'],
      ['every', 'every(seconds, function)', 'Calls a function every so many seconds, until it returns false.'],
      ['tween', 'tween(target, seconds, values, easing)', 'Changes numbers smoothly: tween(self, 0.3, { y = 100 }).'],
      ['time', 'time()', 'Seconds since the game started.'],
    ],
  },
  {
    name: 'Math',
    page: 'scripts',
    items: [
      ['approach', 'approach(value, target, step)', 'Moves a value towards a target by at most step.'],
      ['lerp', 'lerp(a, b, t)', 'Between a and b: t = 0 is a, 1 is b.'],
      ['clamp', 'clamp(value, min, max)', 'The value, kept between min and max.'],
      ['sign', 'sign(value)', '-1, 0 or 1.'],
      ['round', 'round(value, step)', 'Rounded to the nearest step (default 1).'],
      ['rnd', 'rnd(n)', 'rnd(): 0 to 1. rnd(n): 0 to n. rnd(list): one of its items.'],
      ['choose', 'choose(...)', 'One of its arguments, at random.'],
      ['dist', 'dist(a, b)', 'The distance between two pieces, or dist(x1, y1, x2, y2).'],
      ['jumpSpeed', 'jumpSpeed(height, gravity)', 'How fast to go up to jump this high (with the piece\'s gravity).'],
    ],
  },
  {
    name: 'Physics',
    page: 'physics',
    items: [
      ['raycast', 'raycast(x1, y1, x2, y2, tags)', 'The first body or solid tiles on a line: { piece, x, y, nx, ny, fraction }, or nil. tags (optional) only counts pieces with one of them.'],
      ['raycastAll', 'raycastAll(x1, y1, x2, y2, tags)', 'Everything on a line, nearest first: a list of { piece, x, y, nx, ny, fraction }.'],
      ['piecesAt', 'piecesAt(x, y, tags)', 'The bodies and zones whose shapes contain a point.'],
      ['overlap', 'overlap(kind, x, y, ...)', 'The bodies and zones touching a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, width, height).'],
      ['getGravity', 'getGravity()', 'The scene\'s gravity: x, y in pixels per second per second.'],
      ['setGravity', 'setGravity(x, y)', 'Changes the scene\'s gravity: setGravity(0, 0) floats everything.'],
    ],
  },
  {
    name: 'Screen',
    page: 'settings',
    items: [
      ['screenWidth', 'screenWidth()', 'The game\'s width, in game pixels.'],
      ['screenHeight', 'screenHeight()', 'The game\'s height, in game pixels.'],
      ['fullscreen', 'fullscreen(on)', 'fullscreen(true) fills the screen; fullscreen() is true while it does.'],
    ],
  },
  {
    name: 'Drawing',
    page: 'drawing',
    items: [
      ['pen', 'pen(r, g, b, a)', 'The color to draw with: pen(1, 0, 0), pen({1, 0, 0}), pen("#ff8800").'],
      ['penSize', 'penSize(width)', 'How thick lines and outlines are.'],
      ['clearScreen', 'clearScreen(color)', 'Fills the whole screen with a color (the pen\'s if none).'],
      ['rect', 'rect(x, y, w, h, fill)', 'A rectangle (fill = false for an outline).'],
      ['circle', 'circle(x, y, radius, fill)', 'A circle (fill = false for an outline).'],
      ['oval', 'oval(x, y, rx, ry, fill)', 'An ellipse.'],
      ['poly', 'poly(points, fill)', 'A polygon: poly({x1, y1, x2, y2, x3, y3}).'],
      ['line', 'line(x1, y1, x2, y2, ...)', 'A line through points.'],
      ['dot', 'dot(x, y)', 'One pixel.'],
      ['write', 'write(text, x, y, options)', 'Text; options: a size, or { size, font, align, width }. With rich = true it reads tags like [b]bold[/b]; visible = 5 shows the first 5 characters. Returns the width and height.'],
      ['sprite', 'sprite(image, x, y, options)', 'An image, or a frame of a sheet: sprite("art/hero.sprite", x, y, { frame = 2 }).'],
    ],
  },
];

/** Every name: [name, signature, what it does]. */
export const SCRIPT_API = SCRIPT_API_GROUPS.flatMap((g) => g.items);

export const SCRIPT_API_NAMES = new Set(SCRIPT_API.map(([name]) => name));

/** Callbacks the engine calls on a script, if it has them. */
export const SCRIPT_CALLBACKS = ['ready', 'update', 'physicsUpdate', 'draw', 'removed', 'hit', 'entered', 'exited', 'pressed', 'released', 'tick', 'finished', 'hovered', 'unhovered', 'revealed', 'eachCharacter', 'linkPressed'];
