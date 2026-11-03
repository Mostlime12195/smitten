// Completion data for the smitten module (docs/reference.md): functions with
// signatures and short docs, and the methods of the objects it returns.

/** smitten.<name>: [args, doc] for functions, null for namespaces and values. */
export const SMITTEN = {
  sprite: ['path', 'Loads a sprite: a PNG and its .sprite.json (frames, origin, animations). Cached.'],
  tileset: ['path', 'Loads a .tileset.json: its image, tile size and per-tile properties. Cached.'],
  map: ['path', 'Loads a .map.json made in the map editor. Cached.'],
  sfx: ['path', 'Loads a .sfx.json made in the sound editor; :play() it.'],
  song: ['path', 'Loads a .song.json made in the music editor; :play() it.'],
  version: null,
  screen: null, input: null, scene: null, collide: null, synth: null, json: null, assets: null,
};

/** smitten.<namespace>.<name>: [args, doc]. */
export const SMITTEN_NAMESPACES = {
  screen: {
    setup: ['width?, height?', 'Draw the game at this size (default: smitten.json\'s resolution), scaled up by whole numbers.'],
    begin: ['', 'Start drawing at the game\'s size.'],
    finish: ['', 'Stop, and draw the game scaled into the window.'],
    toGame: ['x, y', 'Window coordinates (e.g. the mouse) to game coordinates.'],
    toWindow: ['x, y', 'Game coordinates to window coordinates.'],
    width: null, height: null, scale: null,
  },
  input: {
    bind: ['action, inputs', 'Name an action and the keys ("space"), buttons ("pad:a") and axes ("axis:leftx-") that do it.'],
    down: ['action', 'True while the action is held.'],
    pressed: ['action', 'True on the frame the action went down.'],
    released: ['action', 'True on the frame the action went up.'],
  },
  scene: {
    switch: ['scene, ...', 'Replace the current scene. Calls its enter(...).'],
    push: ['scene, ...', 'Put a scene on top of the current one (e.g. a pause menu).'],
    pop: ['...', 'Go back to the scene below; calls its resume(...).'],
    current: ['', 'The scene that\'s running.'],
  },
  collide: {
    overlaps: ['a, b', 'True if two boxes (x, y, width, height) overlap.'],
    move: ['map, box, dx, dy', 'Move a box through a map\'s solid tiles; returns hit.x, hit.y, hit.ground, hit.ceiling.'],
  },
  synth: {
    renderSfx: ['params', 'Render sound effect parameters to a SoundData.'],
    renderSong: ['song, basePath', 'Render a song table to a SoundData.'],
  },
  json: {
    decode: ['text', 'Parse JSON into Lua values.'],
    encode: ['value, indent?', 'Write a Lua value as JSON.'],
    null: null,
  },
  assets: {
    resolve: ['path, extensions, what', 'Find an asset file, trying each extension.'],
    readJSON: ['path', 'Read and decode a JSON file from the game.'],
    clear: ['kind?', 'Forget cached assets so they load again.'],
  },
};

/** Methods and fields of the objects smitten returns: Type -> {name: [args, doc] | null}. */
export const SMITTEN_TYPES = {
  Sprite: {
    draw: ['frame, x, y, r?, sx?, sy?', 'Draw one frame (from 0) around the sprite\'s origin.'],
    animation: ['name?', 'A new, independent playback of an animation.'],
    quad: ['frame', 'The Quad of a frame.'],
    has: ['name', 'Whether the sprite has this animation.'],
    animationNames: ['', 'The names of the sprite\'s animations.'],
    image: null, width: null, height: null, frameCount: null, originX: null, originY: null,
  },
  Animation: {
    update: ['dt', 'Advance the animation.'],
    draw: ['x, y, r?, sx?, sy?', 'Draw the current frame; a negative sx flips it.'],
    play: ['name, restart?', 'Switch to another animation of the same sprite.'],
    pause: ['', 'Stop advancing.'],
    resume: ['', 'Continue after pause().'],
    getDuration: ['', 'Length of one pass, in seconds.'],
    name: null, frame: null, finished: null, paused: null,
  },
  Map: {
    draw: ['', 'Draw every visible tile layer.'],
    drawLayer: ['name', 'Draw one layer.'],
    getTile: ['layer, tx, ty', 'Tile number at a cell (from 0), or -1.'],
    setTile: ['layer, tx, ty, tile', 'Change a tile.'],
    tileProperties: ['tile', 'The properties set on a tile in its tileset.'],
    isSolid: ['px, py', 'Whether a solid tile covers this pixel.'],
    objects: ['type?', 'The objects placed on object layers.'],
    spawn: ['classes', 'Create an entity for each object: classes[type].new(object).'],
    width: null, height: null, tileWidth: null, tileHeight: null, pixelWidth: null, pixelHeight: null, properties: null,
  },
  Tileset: {
    quad: ['tile', 'The Quad of a tile.'],
    properties: ['tile', 'The properties set on a tile.'],
    image: null, tileWidth: null, tileHeight: null, count: null,
  },
  Sound: {
    play: ['options?', 'Play it ({volume, pitch}); returns the Source. Plays can overlap.'],
    stop: ['', 'Stop every copy that\'s playing.'],
    soundData: null, duration: null,
  },
  Song: {
    play: ['', 'Start the song (it loops if the file says so).'],
    stop: ['', 'Stop and rewind.'],
    pause: ['', 'Pause.'],
    resume: ['', 'Continue after pause().'],
    setVolume: ['volume', 'Volume from 0 to 1.'],
    isPlaying: ['', 'Whether it\'s playing.'],
    duration: null,
  },
};

/** What smitten.<loader>(...) returns, and the file extensions it loads. */
export const SMITTEN_LOADERS = {
  sprite: { type: 'Sprite', ext: /\.(png|sprite\.json)$/i, strip: /\.(sprite\.json|png)$/i },
  tileset: { type: 'Tileset', ext: /\.tileset\.json$/i, strip: /\.tileset\.json$/i },
  map: { type: 'Map', ext: /\.map\.json$/i, strip: /\.map\.json$/i },
  sfx: { type: 'Sound', ext: /\.sfx\.json$/i, strip: /\.sfx\.json$/i },
  song: { type: 'Song', ext: /\.song\.json$/i, strip: /\.song\.json$/i },
};
