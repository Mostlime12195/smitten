// The short API scripts get without smitten. in front (the engine's side is
// love/src/modules/scene/script.lua). For completions, docs and checks.

export const SCRIPT_API = [
  // Input
  ['pressed', 'pressed(action)', 'True on the frame an action (jump, left, fire...) is pressed.'],
  ['down', 'down(action)', 'True while an action is held.'],
  ['released', 'released(action)', 'True on the frame an action is let go.'],
  ['axis', 'axis(negative, positive)', '-1, 0 or 1 (or in between, for sticks): axis("left", "right").'],
  ['vector', 'vector(left, right, up, down)', 'x, y of a direction, at most 1 long.'],
  // Scenes
  ['go', 'go(scene, ...)', 'Goes to another scene at the end of the frame.'],
  ['reload', 'reload()', 'Starts this scene again.'],
  ['spawn', 'spawn(sceneOrType, properties, parent)', 'Makes a piece and adds it to the scene (self:spawn adds it inside this piece).'],
  ['make', 'make(sceneOrType, properties)', 'Makes a piece without adding it anywhere.'],
  ['tagged', 'tagged(tag)', 'Every piece with a tag.'],
  ['first', 'first(tag)', 'The first piece with a tag, or nil.'],
  ['root', 'root()', 'The scene\'s root piece.'],
  // Sound
  ['sfx', 'sfx(name, volume, pitch)', 'Plays a sound once: sfx("coin") finds coin.sfx (or .wav, .ogg...) anywhere.'],
  ['music', 'music(name, volume)', 'Plays music on a loop, instead of any music playing.'],
  ['stopMusic', 'stopMusic()', 'Stops the music.'],
  // Time
  ['wait', 'wait(seconds)', 'Pauses ready(), an event or a task for some seconds.'],
  ['task', 'task(function)', 'Runs a function that can wait().'],
  ['after', 'after(seconds, function)', 'Calls a function once, after some seconds.'],
  ['every', 'every(seconds, function)', 'Calls a function every so many seconds, until it returns false.'],
  ['tween', 'tween(target, seconds, values, easing)', 'Changes numbers smoothly: tween(self, 0.3, { y = 100 }).'],
  ['time', 'time()', 'Seconds since the game started.'],
  // Math
  ['approach', 'approach(value, target, step)', 'Moves a value towards a target by at most step.'],
  ['lerp', 'lerp(a, b, t)', 'Between a and b: t = 0 is a, 1 is b.'],
  ['clamp', 'clamp(value, min, max)', 'The value, kept between min and max.'],
  ['sign', 'sign(value)', '-1, 0 or 1.'],
  ['round', 'round(value, step)', 'Rounded to the nearest step (default 1).'],
  ['rnd', 'rnd(n)', 'rnd(): 0 to 1. rnd(n): 0 to n. rnd(list): one of its items.'],
  ['choose', 'choose(...)', 'One of its arguments, at random.'],
  ['dist', 'dist(a, b)', 'The distance between two pieces, or dist(x1, y1, x2, y2).'],
  ['jumpSpeed', 'jumpSpeed(height, gravity)', 'How fast to go up to jump this high (with the piece\'s gravity).'],
  // Screen and mouse
  ['screenWidth', 'screenWidth()', 'The game\'s width, in game pixels.'],
  ['screenHeight', 'screenHeight()', 'The game\'s height, in game pixels.'],
  ['mouse', 'mouse()', 'x, y of the mouse in the scene.'],
  // Drawing, in draw()
  ['pen', 'pen(r, g, b, a)', 'The color to draw with: pen(1, 0, 0), pen({1, 0, 0}), pen("#ff8800").'],
  ['rect', 'rect(x, y, w, h, fill)', 'A rectangle (fill = false for an outline).'],
  ['circle', 'circle(x, y, radius, fill)', 'A circle (fill = false for an outline).'],
  ['line', 'line(x1, y1, x2, y2, ...)', 'A line through points.'],
  ['write', 'write(text, x, y)', 'Text.'],
  ['sprite', 'sprite(image, x, y, rotation, scale)', 'An image file.'],
];

export const SCRIPT_API_NAMES = new Set(SCRIPT_API.map(([name]) => name));

/** Callbacks the engine calls on a script, if it has them. */
export const SCRIPT_CALLBACKS = ['ready', 'update', 'physicsUpdate', 'draw', 'removed', 'hit', 'entered', 'exited', 'pressed', 'tick', 'finished'];
