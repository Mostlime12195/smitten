// Completion data for what Smitten adds to the engine table (smitten is love):
// its own modules, the helpers that join LÖVE's modules, and the path
// arguments the editor can complete. Node methods and script callbacks come
// from the piece schema (core/schema.js).

/**
 * A page of the docs on the sharing site (platform/public/docs, made by
 * tools/gen-docs.mjs): docsUrl(site, 'pieces', 'camera').
 */
export function docsUrl(site, page = '', anchor = '') {
  const base = String(site || '').replace(/\/+$/, '');
  return `${base}/docs/${page}${anchor ? `#${anchor.toLowerCase()}` : ''}`;
}

/** smitten.<module>.<name>: [args, doc]; null for values. */
export const SMITTEN_MODULES = {
  scene: {
    go: ['path, ...', 'Goes to another scene at the end of the frame: smitten.scene.go("scenes/level2.scene").'],
    reload: ['', 'Starts the running scene again from its file.'],
    make: ['sceneOrType, properties?, script?', 'Makes a piece without adding it: make("scenes/coin.scene") or make("Sprite", { image = "art/coin.png" }).'],
    spawn: ['sceneOrType, properties?, parent?', 'Makes a piece and adds it to the scene (or to parent): spawn("scenes/bullet.scene", { x = 10 }).'],
    tagged: ['tag', 'Every piece with a tag, as a list.'],
    first: ['tag', 'The first piece with a tag, or nil.'],
    find: ['path', 'A piece of the running scene by its path from the root.'],
    screenToWorld: ['x, y', 'A point on the screen as a point in the scene (through the camera).'],
    worldToScreen: ['x, y', 'A point in the scene as a point on the screen.'],
    setCurrent: ['root', 'Makes a piece built in code the running scene.'],
    getDelta: ['', 'The current step\'s length: the frame time in update(), the fixed step in physicsUpdate().'],
    transition: ['kind, seconds?, color?', 'How go() and reload() change scenes: transition("fade", 0.4) or transition("none").'],
    isChanging: ['', 'True while the scene is about to change or a transition is running.'],
    runsWhilePaused: ['piece', 'True if a piece keeps running while the game is paused (pausable off on it or a piece it\'s inside).'],
    current: null, path: null, args: null, paused: null, timeScale: null, showShapes: null,
  },
  input: {
    pressed: ['action', 'True on the frame the action went down: smitten.input.pressed("jump").'],
    down: ['action', 'True while the action is held.'],
    released: ['action', 'True on the frame the action went up.'],
    axis: ['negative, positive', 'From -1 to 1: smitten.input.axis("left", "right").'],
    vector: ['left, right, up, down', 'A direction at most 1 long: x, y.'],
    strength: ['action', 'How far the action is pushed, 0 to 1.'],
    bind: ['action, inputs', 'Adds an action: smitten.input.bind("dash", { "lshift", "pad:b" }).'],
    unbind: ['action', 'Removes an action.'],
    bindings: ['action', 'The inputs bound to an action.'],
    actions: ['', 'Every action\'s name.'],
    lastPressed: ['', 'The input pressed this frame ("space", "mouse:1", "pad:a"), or nil: for rebinding screens.'],
    isInputName: ['name', 'True if a name is an input: a key, "mouse:1", "pad:a", "axis:leftx+", "wheel:up".'],
    wheel: ['', 'How far the mouse wheel turned this frame: x, y.'],
    typed: ['', 'The text typed this frame; turns text input on.'],
    touches: ['', 'The fingers on the screen: a list of { id, x, y, worldX, worldY }.'],
    gamepads: ['', 'How many gamepads are connected.'],
    stick: ['side, player?', 'A gamepad stick ("left" or "right"): x, y from -1 to 1.'],
    trigger: ['side, player?', 'A gamepad trigger ("left" or "right"): 0 to 1.'],
    vibrate: ['strength, seconds, player?', 'Rumbles gamepads (all, or one player\'s).'],
  },
  tween: {
    to: ['target, seconds, values, easing?, done?', 'Changes numbers smoothly; smitten.tween(...) does the same.'],
    after: ['seconds, fn', 'Calls fn once, later.'],
    every: ['seconds, fn', 'Calls fn repeatedly until it returns false.'],
    easingNames: ['', 'Every easing\'s name (linear, outQuad, outBack, outBounce, ...).'],
  },
  assets: {
    image: ['path', 'An Image, cached.'],
    sprite: ['path', 'A .sprite file: image, frames and animations.'],
    tileset: ['path', 'A .tileset file.'],
    font: ['path, size', 'A font: a .ttf/.otf file, "pixel", or "" for the default.'],
    audio: ['path', 'A sound ready to play: :newSource():play().'],
    scene: ['path', 'A .scene file, decoded.'],
    script: ['path', 'Runs a script file and returns its table.'],
    load: ['path', 'Loads any file by its extension.'],
    readJSON: ['path', 'Reads and decodes a JSON file.'],
    clear: ['path?', 'Forgets cached files so they load again.'],
  },
  storage: {
    save: ['key, value', 'Saves a value between plays: smitten.storage.save("best", score).'],
    load: ['key, default?', 'A saved value, or default.'],
    remove: ['key', 'Forgets a saved value.'],
    keys: ['', 'Every saved value\'s name.'],
  },
  display: {
    toGame: ['x, y', 'Window coordinates to game coordinates.'],
    toWindow: ['x, y', 'Game coordinates to window coordinates.'],
    getWindowRect: ['', 'The game\'s area in the window: x, y, width, height.'],
    width: null, height: null, viewX: null, viewY: null, viewWidth: null, viewHeight: null, scale: null, stretch: null, filter: null, antialias: null, background: null,
  },
  json: {
    decode: ['text', 'JSON text to Lua values.'],
    encode: ['value, indent?', 'Lua values to JSON text.'],
    null: null,
  },
  synth: {
    sfx: ['path', 'A .sfx sound effect made in the Sound workspace; :play() it.'],
    song: ['path', 'A .song made in the Music workspace; :play() it.'],
    renderSfx: ['params', 'Renders sound effect parameters to a SoundData.'],
    renderSong: ['song, basePath', 'Renders a song table to a SoundData.'],
  },
};

/** Helpers that join LÖVE's modules: smitten.<module>.<name>. */
export const LOVE_ADDITIONS = {
  math: {
    chance: ['p', 'True with probability p: chance(0.25) is true a quarter of the time.'],
    pick: ['list', 'A random element of a list.'],
    clamp: ['v, lo, hi', 'v kept between lo and hi.'],
    lerp: ['a, b, t', 'The value t of the way from a to b.'],
    approach: ['v, target, step', 'v moved towards target by at most step.'],
    sign: ['v', '1, 0 or -1.'],
    round: ['v, step?', 'v rounded to the nearest multiple of step.'],
    distance: ['x1, y1, x2, y2', 'The distance between two points.'],
    angle: ['x1, y1, x2, y2', 'The angle from one point to another, in radians.'],
    randomFloat: ['a, b', 'A random number with a fraction, from a to b.'],
  },
  timer: {
    after: ['seconds, fn', 'Calls fn once, later. Returns a handle with :cancel().'],
    every: ['seconds, fn', 'Calls fn every so many seconds, until it returns false.'],
  },
  mouse: {
    pressed: ['button?', 'True on the frame a mouse button (1 = left) went down.'],
    released: ['button?', 'True on the frame a mouse button went up.'],
    down: ['button?', 'True while a mouse button is held.'],
    getDelta: ['', 'How far the mouse moved this frame: dx, dy.'],
    isOverUI: ['', 'True while the pointer is over a UI button or panel.'],
    x: null, y: null, worldX: null, worldY: null,
  },
  keyboard: {
    pressed: ['key', 'True on the frame a key went down.'],
    released: ['key', 'True on the frame a key went up.'],
  },
  audio: {
    sfx: ['name, volume?, pitch?', 'Plays a sound once by name or path: smitten.audio.sfx("coin", { volume = 0.5 }).'],
    music: ['name, options?', 'Plays music on a loop instead of the music playing; options: volume, pitch, fade.'],
    stopMusic: ['fade?', 'Stops the music, fading out over fade seconds if given.'],
    pauseMusic: ['', 'Pauses the music.'],
    resumeMusic: ['', 'Continues the music.'],
    getMusic: ['', 'The Source playing the music, or nil.'],
  },
};

export const ENGINE_FIELDS = { version: null };

/** Functions whose first argument is a project path, and which files fit. */
export const PATH_ARGS = [
  { re: /\bscene\.(?:go|make|spawn)\s*\(\s*["']([^"']*)$/, ext: /\.scene$/ },
  // The short API in scripts: go("scenes/..."), sfx("sounds/..."), sprite("art/...").
  { re: /(?:^|[^\w.:])(?:go|make|spawn)\s*\(\s*["']([^"']*)$/, ext: /\.scene$/ },
  { re: /(?:^|[^\w.:])(?:sfx|music)\s*\(\s*["']([^"']*)$/, ext: /\.(wav|ogg|mp3|flac|sfx|song)$/i },
  { re: /\baudio\.(?:sfx|music)\s*\(\s*["']([^"']*)$/, ext: /\.(wav|ogg|mp3|flac|sfx|song)$/i },
  { re: /(?:^|[^\w.:])sprite\s*\(\s*["']([^"']*)$/, ext: /\.(png|jpe?g|bmp|sprite)$/i },
  { re: /\bassets\.(?:image)\s*\(\s*["']([^"']*)$/, ext: /\.(png|jpe?g|bmp)$/i },
  { re: /\bassets\.sprite\s*\(\s*["']([^"']*)$/, ext: /\.sprite$/ },
  { re: /\bassets\.tileset\s*\(\s*["']([^"']*)$/, ext: /\.tileset$/ },
  { re: /\bassets\.font\s*\(\s*["']([^"']*)$/, ext: /\.(ttf|otf)$/i },
  { re: /\bassets\.(?:audio)\s*\(\s*["']([^"']*)$/, ext: /\.(wav|ogg|mp3|flac|sfx|song)$/i },
  { re: /\bsynth\.sfx\s*\(\s*["']([^"']*)$/, ext: /\.sfx$/ },
  { re: /\bsynth\.song\s*\(\s*["']([^"']*)$/, ext: /\.song$/ },
  { re: /\bassets\.(?:load|readJSON|scene|script)\s*\(\s*["']([^"']*)$/, ext: /./ },
];
