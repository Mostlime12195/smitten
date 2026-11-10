// Completion data for Smitten's own modules (smitten.scene, smitten.input,
// ...), the helpers that join the engine's modules (smitten.math.chance,
// ...), and the path arguments the editor can complete. Piece methods and
// script callbacks come from the piece schema (core/schema.js); the rest of
// smitten.* from engine-api.json and engine-docs.js.

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
    pressed: ['action, player?', 'True on the frame the action went down: smitten.input.pressed("jump"). With a player, that player only: smitten.input.pressed("jump", 2).'],
    down: ['action, player?', 'True while the action is held.'],
    released: ['action, player?', 'True on the frame the action went up.'],
    axis: ['negative, positive, player?', 'From -1 to 1: smitten.input.axis("left", "right").'],
    vector: ['left, right, up, down, player?', 'A direction at most 1 long: x, y.'],
    strength: ['action, player?', 'How far the action is pushed, 0 to 1.'],
    bind: ['action, inputs, player?', 'Adds an action: smitten.input.bind("dash", { "lshift", "pad:b" }). With a player, the inputs are that player\'s own: bind("jump", { "return" }, 2).'],
    unbind: ['action, player?', 'Removes an action, or a player\'s own inputs for it.'],
    bindings: ['action, player?', 'The inputs bound to an action (with a player: the ones that player uses).'],
    actions: ['', 'Every action\'s name.'],
    lastPressed: ['player?', 'The input pressed this frame ("space", "mouse:1", "pad:a"), or nil: for rebinding screens. With a player, only what that player pressed.'],
    lastPressedBy: ['', 'What was pressed this frame and where: the input\'s name, "keyboard", "mouse" or "gamepad", and the gamepad\'s number. For "press a button to join" screens.'],
    isInputName: ['name', 'True if a name is an input: a key, "mouse:1", "pad:a", "axis:leftx+", "wheel:up".'],
    press: ['action, player?', 'Presses an action from code, as if its key went down, until release(): for touch controls, replays and computer players.'],
    release: ['action, player?', 'Lets go of an action pressed with press() or setStrength().'],
    setStrength: ['action, value, player?', 'Pushes an action part of the way, 0 to 1, as a stick would: axis() and vector() give the fraction back.'],
    players: ['', 'How many players have something to play with: the keyboard, keys of their own or a gamepad.'],
    gamepadOf: ['player', 'A player\'s gamepad: its number and the gamepad itself, or nil.'],
    assignGamepad: ['player, gamepad', 'Gives a player a gamepad by its number: assignGamepad(1, 2). false: none. nil: back to gamepad 1 for player 1, 2 for player 2.'],
    assignKeyboard: ['player', 'Gives a player the keyboard and the mouse (they start as player 1\'s). false: nobody\'s.'],
    keyboardOf: ['', 'The player with the keyboard and the mouse, or nil.'],
    on: ['event, fn', 'Calls fn(number, gamepad) on "gamepadadded" or "gamepadremoved". Returns a handle with :off().'],
    hasTouch: ['', 'True on a phone or a tablet, and on any screen once a finger has touched it.'],
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
  boards: {
    available: ['', 'True while the game runs on its page on the games site and has leaderboards there. False in the editor and in exported games.'],
    submit: ['key, value, options?, callback?', 'Sends a score to a leaderboard: smitten.boards.submit("best", score). options: { name = "Ada" } for someone not signed in. Answers { rank, value, improved }, or nil and why.'],
    top: ['key, count?, callback?', 'The best scores, best first: a list of { rank, name, value, me, guest } (10 unless count says, 100 at most), or nil and why.'],
    around: ['key, count?, callback?', 'The scores around the player\'s own (the top, if they have none).'],
    list: ['callback?', 'The game\'s leaderboards: a list of { key, title, order, format, unit, scores }.'],
  },
  json: {
    decode: ['text', 'JSON text to Lua values.'],
    encode: ['value, indent?', 'Lua values to JSON text.'],
    null: null,
  },
  physics: {
    raycast: ['x1, y1, x2, y2, tags?', 'The first body or tiles a line touches, nearest first: {piece, x, y, nx, ny, fraction}, or nil.'],
    raycastAll: ['x1, y1, x2, y2, tags?', 'Every hit along a line, nearest first.'],
    piecesAt: ['x, y, tags?', 'The bodies and zones whose shapes contain a point.'],
    overlap: ['kind, ...', 'The bodies and zones touching a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, w, h).'],
    getGravity: ['', 'The scene\'s gravity: x, y (pixels per second per second).'],
    setGravity: ['x, y', 'Changes the scene\'s gravity: setGravity(0, 0) floats.'],
  },
  paths: {
    newGrid: ['columns, rows, options?', 'A grid of open and solid cells to find paths through: newGrid(40, 30, { cellSize = 16, diagonals = "noCorners" }). A Tiles piece makes one of itself with newPathGrid().'],
    newGraph: ['', 'An empty graph: points you add and connect by hand, and paths along the connections.'],
    newArea: ['areas, holes?', 'A walkable area from polygons and holes cut out of them: newArea({ { 0, 0, 400, 0, 400, 300, 0, 300 } }, { hole }).'],
    newAgent: ['options?', 'Something that follows paths: it remembers a target and says which point to head for next. options: finder (a grid, graph or area; the scene\'s Walkable pieces if left out), reach, replan, partial, tags.'],
    findPath: ['x1, y1, x2, y2, options?', 'The short way between two points through the scene\'s Walkable pieces: {x, y, x, y, ...}, or nil. options: tags, partial.'],
    closestPoint: ['x, y, options?', 'The walkable point nearest a point: x, y.'],
    isWalkable: ['x, y, options?', 'True if a point is inside a Walkable piece and not in a hole.'],
    getArea: ['options?', 'The area built from the scene\'s Walkable pieces.'],
    refresh: ['', 'Builds the scene\'s walkable area again; only needed after changing a Walkable\'s points in place.'],
    length: ['path', 'How long a path is, in pixels.'],
    pointAt: ['path, distance', 'The point a distance along a path from its start: x, y, and true once it\'s the end.'],
    debugDraw: ['what?, options?', 'Draws a path, an agent\'s path or an area (with nothing: the scene\'s Walkable pieces) from a script\'s draw(). options: color, width.'],
  },
  text: {
    effect: ['name, fn', 'Adds an effect for rich text: after effect("bounce", fn), [bounce]boing[/bounce] calls fn(c) for each character, every frame. Change c.x, c.y, c.rotation, c.scale, c.color, c.alpha, c.visible; read c.index, c.count, c.char, c.line, c.time, c.since, c.args, c.piece.'],
    effects: ['', 'The names of every effect, sorted.'],
    measure: ['text, options?', 'How big a text is when drawn: width, height, lines. options: font, size, width (wraps), rich, wrap, lineHeight, letterSpacing.'],
    wrap: ['text, options?', 'The lines a text is broken into at a width: wrap("a long sentence", { width = 120 }) gives a list of strings.'],
    strip: ['text', 'The text without its tags: strip("[b]Hi[/b]") is "Hi".'],
    escape: ['text', 'Makes text safe to put inside rich text (a player\'s name): square brackets are shown, not read as tags.'],
    color: ['value', 'A color from "#ff8800", "#f80" or a name like "red": {r, g, b, a}, or nil.'],
  },
  synth: {
    sfx: ['path', 'A .sfx sound effect made in the Sound workspace; :play() it.'],
    song: ['path', 'A .song made in the Music workspace; :play() it.'],
    renderSfx: ['params', 'Renders sound effect parameters to a SoundData.'],
    renderSong: ['song, basePath', 'Renders a song table to a SoundData.'],
  },
};

/** Helpers that join the engine's modules: smitten.<module>.<name>. */
export const MODULE_HELPERS = {
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
