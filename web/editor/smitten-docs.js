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

/** The functions that smitten.net calls in scripts (docs/online.md): name: [args, doc]. */
export const NET_EVENTS = {
  peerJoined: ['peer', 'The engine calls it when a peer comes into your room, and once for each peer that is in the room when you join.'],
  peerLeft: ['peer', 'The engine calls it when a peer leaves your room.'],
  message: ['from, data', 'The engine calls it when a message from another peer arrives. data is what the peer sent.'],
  disconnected: ['reason', 'The engine calls it when you are not in the room any more, but did not call leave(). reason tells why.'],
};

/** smitten.<module>.<name>: [args, doc]; null for values. */
export const SMITTEN_MODULES = {
  scene: {
    go: ['path, ...', 'Goes to another scene at the end of the frame: smitten.scene.go("scenes/level2.scene").'],
    reload: ['', 'Starts the running scene again from its file.'],
    make: ['sceneOrType, properties?, script?', 'Makes a piece but does not add it to the scene: make("scenes/coin.scene") or make("Sprite", { image = "art/coin.png" }).'],
    spawn: ['sceneOrType, properties?, parent?', 'Makes a piece and adds it to the scene (or to parent): spawn("scenes/bullet.scene", { x = 10 }).'],
    tagged: ['tag', 'Returns every piece with a tag, as a list.'],
    first: ['tag', 'Returns the first piece with a tag, or nil.'],
    find: ['path', 'Returns a piece of the running scene by its path from the root piece.'],
    screenToWorld: ['x, y', 'Takes a point on the screen and returns it as a point in the scene (through the camera).'],
    worldToScreen: ['x, y', 'Takes a point in the scene and returns it as a point on the screen.'],
    setCurrent: ['root', 'Makes a piece that a script builds the running scene.'],
    getDelta: ['', 'Returns the length of the current step: the frame time in update(), the fixed step in physicsUpdate().'],
    transition: ['kind, seconds?, color?', 'Sets how go() and reload() change scenes: transition("fade", 0.4) or transition("none").'],
    isChanging: ['', 'Returns true while the scene is about to change or a transition runs.'],
    runsWhilePaused: ['piece', 'Returns true if a piece keeps running while the game is paused (pausable is off on it, or on a piece that it is inside).'],
    current: null, path: null, args: null, paused: null, timeScale: null, showShapes: null,
  },
  input: {
    pressed: ['action, player?', 'Returns true on the frame when the action goes down: smitten.input.pressed("jump"). With a player, it checks only that player: smitten.input.pressed("jump", 2).'],
    down: ['action, player?', 'Returns true while the action is down.'],
    released: ['action, player?', 'Returns true on the frame when the action goes up.'],
    axis: ['negative, positive, player?', 'Returns a value from -1 to 1: smitten.input.axis("left", "right").'],
    vector: ['left, right, up, down, player?', 'Returns a direction with a length of 1 at most: x, y.'],
    strength: ['action, player?', 'Returns how far down the action is, from 0 to 1.'],
    bind: ['action, inputs, player?', 'Adds an action: smitten.input.bind("dash", { "lshift", "pad:b" }). With a player, the bindings are only for that player: bind("jump", { "return" }, 2).'],
    unbind: ['action, player?', 'Removes an action, or the bindings of one player for it.'],
    bindings: ['action, player?', 'Returns the bindings of an action (with a player: the bindings that the player uses).'],
    actions: ['', 'Returns the names of all actions.'],
    lastPressed: ['player?', 'Returns the input pressed in this frame ("space", "mouse:1", "pad:a"), or nil. Use it for screens that change bindings. With a player, it checks only that player.'],
    lastPressedBy: ['', 'Returns the input pressed in this frame and its device: the input name, "keyboard", "mouse" or "gamepad", and the gamepad number. Use it for "press a button to join" screens.'],
    isInputName: ['name', 'Returns true if a name is an input: a key, "mouse:1", "pad:a", "axis:leftx+", "wheel:up".'],
    press: ['action, player?', 'Presses an action from code, as if its key went down, until release(). Use it for on-screen touch buttons, replays and computer players.'],
    release: ['action, player?', 'Lets go of an action that press() or setStrength() pressed.'],
    setStrength: ['action, value, player?', 'Presses an action part of the way, from 0 to 1, as a stick does. axis() and vector() return the fraction.'],
    players: ['', 'Returns the number of players that have something to play with: the keyboard, their own keys or a gamepad.'],
    gamepadOf: ['player', 'Returns the gamepad of a player: its number and the gamepad, or nil.'],
    assignGamepad: ['player, gamepad', 'Gives a gamepad to a player by its number: assignGamepad(1, 2). false gives none. nil goes back to the default: gamepad 1 for player 1, gamepad 2 for player 2.'],
    assignKeyboard: ['player', 'Gives the keyboard and the mouse to a player (at the start, they belong to player 1). false gives them to no player.'],
    keyboardOf: ['', 'Returns the player who has the keyboard and the mouse, or nil.'],
    on: ['event, fn', 'Calls fn(number, gamepad) on "gamepadadded" or "gamepadremoved". Returns a handle with :off().'],
    hasTouch: ['', 'Returns true on a phone or a tablet, and on any screen after a finger touches it.'],
    wheel: ['', 'Returns how far the mouse wheel turned in this frame: x, y.'],
    typed: ['', 'Returns the text that the player typed in this frame. It also turns text input on.'],
    touches: ['', 'Returns the fingers on the screen: a list of { id, x, y, worldX, worldY }.'],
    gamepads: ['', 'Returns the number of connected gamepads.'],
    stick: ['side, player?', 'Returns the position of a gamepad stick ("left" or "right"): x, y from -1 to 1.'],
    trigger: ['side, player?', 'Returns the position of a gamepad trigger ("left" or "right"): 0 to 1.'],
    vibrate: ['strength, seconds, player?', 'Makes gamepads vibrate (all of them, or the gamepad of one player).'],
  },
  tween: {
    to: ['target, seconds, values, easing?, done?', 'Changes numbers smoothly. smitten.tween(...) does the same.'],
    after: ['seconds, fn', 'Calls fn once, later.'],
    every: ['seconds, fn', 'Calls fn again and again until it returns false.'],
    easingNames: ['', 'Returns the names of all easings (linear, outQuad, outBack, outBounce, ...).'],
  },
  assets: {
    image: ['path', 'Returns an Image. The engine loads each file once and keeps it in a cache.'],
    sprite: ['path', 'Returns a .sprite file: its image, animation frames and animations.'],
    tileset: ['path', 'Returns a .tileset file.'],
    font: ['path, size', 'Returns a font: a .ttf or .otf file, "pixel", or "" for the default font.'],
    audio: ['path', 'Returns a sound that is ready to play: :newSource():play().'],
    scene: ['path', 'Reads a .scene file and returns its data.'],
    script: ['path', 'Runs a script file and returns its table.'],
    load: ['path', 'Loads any file. The extension of the file decides how.'],
    readJSON: ['path', 'Reads a JSON file and returns its Lua values.'],
    clear: ['path?', 'Removes files from the cache, so that they load again.'],
  },
  storage: {
    save: ['key, value', 'Saves a value between plays: smitten.storage.save("best", score).'],
    load: ['key, default?', 'Returns a saved value, or default.'],
    remove: ['key', 'Deletes a saved value.'],
    keys: ['', 'Returns the names of all saved values.'],
  },
  display: {
    toGame: ['x, y', 'Takes window coordinates and returns game coordinates.'],
    toWindow: ['x, y', 'Takes game coordinates and returns window coordinates.'],
    getWindowRect: ['', 'Returns the area of the game in the window: x, y, width, height.'],
    width: null, height: null, viewX: null, viewY: null, viewWidth: null, viewHeight: null, scale: null, stretch: null, filter: null, antialias: null, background: null,
  },
  boards: {
    available: ['', 'Returns true while the game runs on its page on the games site and has leaderboards there. Returns false in the editor and in exported games.'],
    submit: ['key, value, options?, callback?', 'Sends a score to a leaderboard: smitten.boards.submit("best", score). options: { name = "Ada" } for a player who is not signed in. The result is { rank, value, improved }, or nil and the reason.'],
    top: ['key, count?, callback?', 'Returns the best scores, best first: a list of { rank, name, value, me, guest }, or nil and the reason. count is 10 if you leave it out, and 100 at most.'],
    around: ['key, count?, callback?', 'Returns the scores around the score of the player (the top scores, if the player has no score).'],
    list: ['callback?', 'Returns the leaderboards of the game: a list of { key, title, order, format, unit, scores }.'],
  },
  host: {
    name: ['', 'Returns the name of the page that hosts the game: "smitten-games" on the games site. Returns nil when no page hosts the game (in the editor, or an exported game alone).'],
    info: ['', 'Returns { name, version, protocol, features } of the host (a new table each time), or nil when no page hosts the game.'],
    has: ['feature', 'Returns true if the host has a feature: smitten.host.has("cloudSaves"). The features are "cloudSaves", "boards" and "net".'],
    user: ['', 'Returns the name of the player who is signed in on the host, or nil.'],
  },
  cloud: {
    available: ['', 'Returns true if the host keeps cloud saves. On the games site, it is true also when the player is not signed in.'],
    save: ['key, value, callback?', 'Keeps a value on the account of the player: smitten.cloud.save("progress", progress). Waits, then returns true, or nil and the reason.'],
    load: ['key, callback?', 'Returns the value of the cloud save with this key. Returns nil and the reason if it cannot. The reason is "missing" if there is no save.'],
    list: ['callback?', 'Returns the cloud saves of the game: a list of { key, size, time }, sorted by key.'],
    remove: ['key, callback?', 'Deletes a cloud save. Returns true, also if there was no save.'],
  },
  net: {
    available: ['', 'Returns true while the game runs on its page on the games site. Returns false in the editor and in exported games.'],
    join: ['room, options?, callback?', 'Joins a room, and makes it if nobody is in it: smitten.net.join("arena", { maxPlayers = 4 }). options: maxPlayers (2 to 16, 8 if you leave it out) and name (for a player who is not signed in). Waits, then returns your peer, or nil and the reason.'],
    leave: ['', 'Leaves the room. The others get peerLeft(). You get no event.'],
    room: ['', 'Returns the name of the room that you are in, or nil.'],
    me: ['', 'Returns your own peer: { id, name, guest, me = true }, or nil when you are not in a room.'],
    peers: ['', 'Returns all the peers in the room, you too, in the order that they came in: a new list each time.'],
    peer: ['id', 'Returns the peer with this id, or nil.'],
    host: ['', 'Returns the host: the peer that is in the room for the longest time. The games site chooses a new host when the host leaves. The host has no other power.'],
    isHost: ['', 'Returns true if you are the host.'],
    send: ['peer, data', 'Sends data to one peer (a peer or its id). data is a table, text, a number or a boolean. Returns true, or nil and the reason.'],
    broadcast: ['data', 'Sends data to all the other peers in the room. Returns true, or nil and the reason.'],
  },
  json: {
    decode: ['text', 'Changes JSON text into Lua values.'],
    encode: ['value, indent?', 'Changes Lua values into JSON text.'],
    null: null,
  },
  physics: {
    raycast: ['x1, y1, x2, y2, tags?', 'Returns the nearest body or tiles that a line touches: {piece, x, y, nx, ny, fraction}, or nil.'],
    raycastAll: ['x1, y1, x2, y2, tags?', 'Returns every hit along a line, nearest first.'],
    piecesAt: ['x, y, tags?', 'Returns the bodies and zones whose shapes contain a point.'],
    overlap: ['kind, ...', 'Returns the bodies and zones that touch a shape: overlap("circle", x, y, radius) or overlap("rect", x, y, w, h).'],
    getGravity: ['', 'Returns the gravity of the scene: x, y (pixels per second per second).'],
    setGravity: ['x, y', 'Changes the gravity of the scene: setGravity(0, 0) makes everything float.'],
  },
  paths: {
    newGrid: ['columns, rows, options?', 'Makes a grid of open and solid cells to find paths through: newGrid(40, 30, { cellSize = 16, diagonals = "noCorners" }). A Tiles piece makes its own grid with newPathGrid().'],
    newGraph: ['', 'Makes an empty graph: you add points and connect them, and it finds paths along the connections.'],
    newArea: ['areas, holes?', 'Makes a walkable area from polygons, with holes cut out of them: newArea({ { 0, 0, 400, 0, 400, 300, 0, 300 } }, { hole }).'],
    newAgent: ['options?', 'Makes an agent that follows paths: it keeps a target and tells you the next point to go to. options: finder, reach, replan, partial, tags. finder is a grid, graph or area (the Walkable pieces of the scene if you leave it out).'],
    findPath: ['x1, y1, x2, y2, options?', 'Returns a short path between two points through the Walkable pieces of the scene: {x, y, x, y, ...}, or nil. options: tags, partial.'],
    closestPoint: ['x, y, options?', 'Returns the walkable point that is nearest to a point: x, y.'],
    isWalkable: ['x, y, options?', 'Returns true if a point is inside a Walkable piece and not in a hole.'],
    getArea: ['options?', 'Returns the area that the engine makes from the Walkable pieces of the scene.'],
    refresh: ['', 'Makes the walkable area of the scene again. You need it only after you change the points of a Walkable in place.'],
    length: ['path', 'Returns the length of a path, in pixels.'],
    pointAt: ['path, distance', 'Returns the point at a distance along a path from its start: x, y, and true if it is the end.'],
    debugDraw: ['what?, options?', 'Draws a path, the path of an agent or an area, from the draw() function of a script. With no argument, it draws the Walkable pieces of the scene. options: color, width.'],
  },
  text: {
    effect: ['name, fn', 'Adds an effect for rich text. After effect("bounce", fn), [bounce]boing[/bounce] calls fn(c) for each character, every frame. You can change c.x, c.y, c.rotation, c.scale, c.color, c.alpha and c.visible. You can read c.index, c.count, c.char, c.line, c.time, c.since, c.args and c.piece.'],
    effects: ['', 'Returns the names of all effects, sorted.'],
    measure: ['text, options?', 'Returns the size of a text when the engine draws it: width, height, lines. options: font, size, width (wraps), rich, wrap, lineHeight, letterSpacing.'],
    wrap: ['text, options?', 'Returns the lines of a text when it wraps at a width: wrap("a long sentence", { width = 120 }) returns a list of strings.'],
    strip: ['text', 'Returns the text without its text tags: strip("[b]Hi[/b]") is "Hi".'],
    escape: ['text', 'Makes text safe to put inside rich text, for example the name of a player. The engine shows square brackets in it and does not read them as text tags.'],
    color: ['value', 'Returns a color from "#ff8800", "#f80" or a name like "red": {r, g, b, a}, or nil.'],
  },
  synth: {
    sfx: ['path', 'Returns a .sfx sound effect that you make in the Sound workspace. Use :play() to play it.'],
    song: ['path', 'Returns a .song that you make in the Music workspace. Use :play() to play it.'],
    renderSfx: ['params', 'Makes a SoundData from the parameters of a sound effect.'],
    renderSong: ['song, basePath', 'Makes a SoundData from a song table.'],
  },
};

/** Helpers that join the engine's modules: smitten.<module>.<name>. */
export const MODULE_HELPERS = {
  math: {
    chance: ['p', 'Returns true with probability p: chance(0.25) is true one time in four.'],
    pick: ['list', 'Returns a random item of a list.'],
    clamp: ['v, lo, hi', 'Returns v, kept between lo and hi.'],
    lerp: ['a, b, t', 'Returns the value that is t of the way from a to b.'],
    approach: ['v, target, step', 'Returns v, moved towards target by at most step.'],
    sign: ['v', 'Returns 1, 0 or -1.'],
    round: ['v, step?', 'Returns v, rounded to the nearest multiple of step.'],
    distance: ['x1, y1, x2, y2', 'Returns the distance between two points.'],
    angle: ['x1, y1, x2?, y2?', 'Returns the angle in degrees of a direction, angle(x, y), or from one point to another, angle(x1, y1, x2, y2). 0 is right, 90 is down.'],
    direction: ['angle, length?', 'Returns the x, y of a step with a length (1 if you leave it out) at an angle in degrees: vx, vy = smitten.math.direction(rotation, 200).'],
    randomFloat: ['a, b', 'Returns a random number with a fraction, from a to b.'],
    seed: ['n?', 'seed(42) makes random, chance, pick, shuffle, rnd() and choose() give the same numbers after it every time. seed() makes numbers that nobody can guess. Returns the seed.'],
    shuffle: ['list', 'Puts the items of a list in a random order, and returns the same list.'],
    newRandom: ['seed?', 'Returns a random number generator of its own. The same seed gives the same numbers, and the other random numbers of the game do not change. Methods: rnd, choose, random, randomFloat, chance, pick, shuffle, randomNormal, getSeed, getState, setState.'],
    noise: ['x, y?, z?', 'Returns smooth noise from 0 to 1 at a point. The same point always gives the same value.'],
    newNoise: ['options?', 'Returns noise with a seed, for hills and caves: newNoise({ seed = 7, scale = 40, octaves = 4, roughness = 0.5 }). Its get(x, y?, z?) returns a value from 0 to 1.'],
  },
  timer: {
    after: ['seconds, fn', 'Calls fn once, later. Returns a handle with :cancel().'],
    every: ['seconds, fn', 'Calls fn each time the given seconds pass, until it returns false.'],
  },
  mouse: {
    pressed: ['button?', 'Returns true on the frame when a mouse button goes down (1 is the left button).'],
    released: ['button?', 'Returns true on the frame when a mouse button goes up.'],
    down: ['button?', 'Returns true while a mouse button is down.'],
    getDelta: ['', 'Returns how far the mouse moved in this frame: dx, dy.'],
    isOverUI: ['', 'Returns true while the mouse pointer is over a UI button or panel.'],
    x: null, y: null, worldX: null, worldY: null,
  },
  keyboard: {
    pressed: ['key', 'Returns true on the frame when a key goes down.'],
    released: ['key', 'Returns true on the frame when a key goes up.'],
  },
  audio: {
    sfx: ['name, volume?, pitch?', 'Plays a sound once by name or path: smitten.audio.sfx("coin", { volume = 0.5 }).'],
    music: ['name, options?', 'Plays music in a loop, in place of the current music. options: volume, pitch, fade.'],
    stopMusic: ['fade?', 'Stops the music. If you give fade, the music fades out over fade seconds.'],
    pauseMusic: ['', 'Pauses the music.'],
    resumeMusic: ['', 'Continues the music.'],
    getMusic: ['', 'Returns the Source that plays the music, or nil.'],
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
