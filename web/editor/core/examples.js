// Example projects for the home screen: one small project for each part of
// the engine, to show how its pieces and functions work together. They are
// not templates for a type of game. Each builds its own art and sounds
// (example-media.js), so nothing comes from the network. Their scripts are
// short, and their comments tell what to look at.

import { json, scene, p, look, libraryScript } from './templates.js';
import { image, wav, randomFrom, samplesOf } from './example-media.js';
import { LAYOUTS, layoutTiles, compileAll, fill, place } from '../workspaces/scene/terrain.js';

const project = (name, main, display, extra = {}) => json({
  format: 'smitten.project', version: 3, name, main, display: { stretch: 'expand', ...display }, ...extra,
});
const SMALL = { width: 640, height: 360, filter: 'pixel' };
const LARGE = { width: 1280, height: 720 };

const wall = (name, x, y, w, h, color = [0.3, 0.32, 0.38, 1], extra = {}) =>
  p(name, 'Body', { x, y, motion: 'still' }, [look(w, h, color)], extra);
// Changes in a ready-made script: from, to, from, to... Each "from" must be in it.
function swap(source, ...pairs) {
  for (let i = 0; i < pairs.length; i += 2) {
    if (!source.includes(pairs[i])) throw new Error(`a ready-made script has no "${pairs[i]}" to change`);
    source = source.replace(pairs[i], pairs[i + 1]);
  }
  return source;
}
const circle = (name, radius, color, extra = {}) => p(name, 'Shape', { shape: 'circle', radius, color, ...extra });

// ---------------------------------------------------------------------------
// A tileset: 16-pixel tiles, 8 in a row. Tiles 0 to 31 are two terrains in
// the usual 16-tile layout ("sides"): ground (grass on dirt) and rock.
// Tiles 32 to 35 are four animation frames of water, and 36 is deep water.

const TILE = 16;
const COLUMNS = 8;
const SIDES = LAYOUTS.find((l) => l.id === 'sides');
const GROUND_TILES = layoutTiles(SIDES, 0, COLUMNS, 40);
const ROCK_TILES = layoutTiles(SIDES, 4, COLUMNS, 40);
export const WATER = 32;
const DEEP_WATER = 36;
const [N, E, S, W] = [1, 4, 16, 64];

function tilesetImage() {
  const img = image(COLUMNS * TILE, 5 * TILE);
  const rand = randomFrom(7);
  const at = (tile) => [(tile % COLUMNS) * TILE, Math.floor(tile / COLUMNS) * TILE];
  const speckle = (x0, y0, color, count) => {
    for (let i = 0; i < count; i++) img.rect(x0 + 1 + Math.floor(rand() * 14), y0 + 2 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 2), 1, color);
  };
  for (const [key, mask] of Object.entries(GROUND_TILES)) {
    const [x0, y0] = at(Number(key));
    img.rect(x0, y0, TILE, TILE, [0.47, 0.32, 0.2, 1]);
    speckle(x0, y0, [0.36, 0.24, 0.14, 1], 7);
    if (!(mask & W)) img.rect(x0, y0, 1, TILE, [0.3, 0.2, 0.12, 1]);
    if (!(mask & E)) img.rect(x0 + TILE - 1, y0, 1, TILE, [0.3, 0.2, 0.12, 1]);
    if (!(mask & S)) img.rect(x0, y0 + TILE - 2, TILE, 2, [0.3, 0.2, 0.12, 1]);
    if (!(mask & N)) {
      img.rect(x0, y0, TILE, 4, [0.36, 0.68, 0.3, 1]);
      img.rect(x0, y0, TILE, 1, [0.55, 0.82, 0.42, 1]);
      for (let i = 0; i < 4; i++) img.rect(x0 + Math.floor(rand() * 15), y0 + 4, 1, 1 + Math.floor(rand() * 2), [0.36, 0.68, 0.3, 1]);
    }
  }
  for (const [key, mask] of Object.entries(ROCK_TILES)) {
    const [x0, y0] = at(Number(key));
    img.rect(x0, y0, TILE, TILE, [0.42, 0.43, 0.5, 1]);
    speckle(x0, y0, [0.34, 0.35, 0.42, 1], 6);
    speckle(x0, y0, [0.52, 0.53, 0.6, 1], 4);
    if (!(mask & N)) img.rect(x0, y0, TILE, 2, [0.64, 0.65, 0.72, 1]);
    if (!(mask & W)) img.rect(x0, y0, 2, TILE, [0.55, 0.56, 0.63, 1]);
    if (!(mask & E)) img.rect(x0 + TILE - 2, y0, 2, TILE, [0.3, 0.3, 0.37, 1]);
    if (!(mask & S)) img.rect(x0, y0 + TILE - 3, TILE, 3, [0.24, 0.24, 0.3, 1]);
  }
  // Water: a wave that moves a quarter of a tile in each animation frame,
  // and deep water under it.
  const [dx, dy] = at(DEEP_WATER);
  img.rect(dx, dy, TILE, TILE, [0.16, 0.38, 0.75, 0.9]);
  for (let f = 0; f < 4; f++) {
    const [x0, y0] = at(WATER + f);
    img.rect(x0, y0, TILE, TILE, [0.2, 0.45, 0.85, 0.85]);
    img.rect(x0, y0 + 10, TILE, 6, [0.16, 0.38, 0.75, 0.9]);
    for (let x = 0; x < TILE; x++) {
      const y = 3 + Math.round(Math.sin((x / TILE + f / 4) * Math.PI * 2) * 1.5);
      img.rect(x0 + x, y0 + y, 1, 2, [0.65, 0.85, 1, 0.95]);
    }
  }
  return img.toPNG();
}

function tilesetFile() {
  const tiles = {};
  for (const t of [...Object.keys(GROUND_TILES), ...Object.keys(ROCK_TILES)]) tiles[t] = { solid: true };
  return {
    format: 'smitten.tileset', version: 1, image: 'tiles.png', tileWidth: TILE, tileHeight: TILE, tiles,
    terrains: [
      { name: 'ground', match: 'sides', color: '#8d5a34', tiles: GROUND_TILES },
      { name: 'rock', match: 'sides', color: '#70727f', tiles: ROCK_TILES },
    ],
    animations: { [WATER]: { frames: [WATER, WATER + 1, WATER + 2, WATER + 3], fps: 5 } },
  };
}

const tilesetFiles = () => ({ 'art/tiles.png': tilesetImage(), 'art/tiles.tileset': json(tilesetFile()) });

// Cells painted with terrains, as the Terrain brush of the editor paints them.
function painter() {
  const terrains = compileAll(tilesetFile().terrains);
  const cells = new Map();
  const key = (x, y) => `${x},${y}`;
  const get = (x, y) => (cells.has(key(x, y)) ? cells.get(key(x, y)) : -1);
  const set = (x, y, t) => (t < 0 ? cells.delete(key(x, y)) : cells.set(key(x, y), t));
  const of = (name) => terrains.byName.get(name) || null;
  return {
    fill: (name, x, y, w, h) => fill(get, set, terrains.of, x, y, w, h, of(name)),
    place: (name, x, y) => place(get, set, terrains.of, x, y, of(name)),
    tile: (x, y, t) => set(x, y, t),
    // The "cells" property of a Tiles piece: one rectangle, row by row, "n*k" for k cells of n.
    cells() {
      const xs = [...cells.keys()].map((k) => Number(k.split(',')[0]));
      const ys = [...cells.keys()].map((k) => Number(k.split(',')[1]));
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const w = Math.max(...xs) - x0 + 1;
      const h = Math.max(...ys) - y0 + 1;
      const runs = [];
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const t = get(x, y);
          const last = runs[runs.length - 1];
          if (last && last[0] === t) last[1]++;
          else runs.push([t, 1]);
        }
      }
      return { x: x0, y: y0, w, h, data: runs.map(([t, k]) => (k > 1 ? `${t}*${k}` : String(t))).join(',') };
    },
  };
}

// ---------------------------------------------------------------------------
// Sounds, made from numbers.

function pluckSound() {
  // A plucked string (Karplus-Strong): noise that goes round a short loop and gets softer.
  const rate = 22050;
  const rand = randomFrom(3);
  const loop = new Float32Array(Math.round(rate / 261.63)).map(() => rand() * 2 - 1);
  let at = 0;
  return wav(samplesOf(0.9, (t) => {
    const next = (at + 1) % loop.length;
    const v = loop[at];
    loop[at] = (loop[at] + loop[next]) * 0.4975;
    at = next;
    return v * 0.7 * Math.min(1, (0.9 - t) * 20);
  }, rate), rate);
}

function drumSound() {
  const rand = randomFrom(5);
  let phase = 0;
  return wav(samplesOf(0.35, (t) => {
    phase += (55 + 120 * Math.exp(-t * 18)) / 22050;
    const body = Math.sin(phase * Math.PI * 2) * Math.exp(-t * 9);
    const click = (rand() * 2 - 1) * Math.exp(-t * 90) * 0.5;
    return (body + click) * 0.8;
  }));
}

function blipSound() {
  return wav(samplesOf(0.05, (t) => (Math.sin(t * 900 * Math.PI * 2) > 0 ? 0.25 : -0.25) * (1 - t / 0.05)));
}

function creakSound() {
  let phase = 0;
  return wav(samplesOf(0.6, (t) => {
    phase += (140 - 50 * t + 12 * Math.sin(t * 40)) / 22050;
    const saw = (phase % 1) * 2 - 1;
    const wobble = 0.5 + 0.5 * Math.sin(t * 55);
    return saw * wobble * 0.35 * Math.min(1, t * 30) * Math.min(1, (0.6 - t) * 8);
  }));
}

// ---------------------------------------------------------------------------
// Lights

function lights(name) {
  const rock = (rname, x, y, w, h, extra = {}) => p(rname, 'Body', { x, y, motion: 'still', ...extra }, [
    look(w, h, [0.45, 0.42, 0.4, 1], { cornerRadius: 10 }),
    p('Shadow', 'Occluder'),
  ]);
  const crystal = (cname, x, y) => p(cname, 'Group', { x, y }, [
    p('Look', 'Shape', { shape: 'polygon', points: [0, -22, 12, 0, 0, 22, -12, 0], color: [0.45, 0.9, 1, 1], lit: false }),
    p('Glow', 'Light', { radius: 140, color: [0.35, 0.8, 1, 1], brightness: 0.7 }),
  ]);
  return {
    'smitten.json': project(name, 'scenes/cave.scene', LARGE),
    'scenes/cave.scene': scene(p('Cave', 'Group', null, [
      p('Dark', 'Tint', { color: [0.06, 0.06, 0.1, 1] }),
      p('Floor', 'Shape', { x: 640, y: 360, width: 1280, height: 720, color: [0.42, 0.38, 0.34, 1] }),
      wall('Top', 640, 10, 1280, 20, [0.25, 0.23, 0.22, 1]), wall('Bottom', 640, 710, 1280, 20, [0.25, 0.23, 0.22, 1]),
      wall('Left', 10, 360, 20, 720, [0.25, 0.23, 0.22, 1]), wall('Right', 1270, 360, 20, 720, [0.25, 0.23, 0.22, 1]),
      rock('Rock1', 380, 220, 90, 160), rock('Rock2', 560, 500, 200, 70), rock('Rock3', 820, 260, 120, 120, { rotation: 20 }),
      rock('Rock4', 1040, 520, 80, 220), rock('Rock5', 300, 560, 70, 70),
      p('Pillar', 'Body', { x: 700, y: 380, motion: 'still' }, [circle('Look', 34, [0.45, 0.42, 0.4, 1]), p('Shadow', 'Occluder')]),
      crystal('Crystal1', 1160, 140), crystal('Crystal2', 180, 660),
      p('Player', 'Body', { x: 160, y: 360, speed: 220 }, [
        circle('Look', 14, [0.95, 0.8, 0.55, 1]),
        p('Torch', 'Light', { radius: 420, color: [1, 0.72, 0.42, 1], shadows: true, shadowSoftness: 2 }, null, { script: 'scripts/torch.lua' }),
      ], { tags: ['player'], script: 'scripts/player.lua' }),
      p('UI', 'Group', null, [
        p('Help', 'Label', { x: 30, y: 26, width: 900, text: 'Arrows or WASD: walk. X or click: torch on and off.', outline: true }),
      ]),
    ])),
    'scripts/player.lua': libraryScript('topdown'),
    'scripts/torch.lua': `-- The torch: a Light inside the player, so it moves with the player.
-- Its shadows property is on. Because of this, the Occluders inside the
-- rocks stop its light and make shadows.
-- The Tint "Dark" makes the cave dark where no light shines. The crystals
-- have lit off, so they always show at full brightness.

flicker = 0.15          -- how much the brightness changes

local start = 1

function ready()
  start = brightness
end

function update(dt)
  -- noise() changes smoothly, so the flame does not jump.
  brightness = start + (noise(time() * 4) - 0.5) * 2 * flicker
  if pressed("fire") then off = not off end
end
`,
  };
}

// ---------------------------------------------------------------------------
// Levels

function levels(name) {
  const paint = painter();
  paint.fill('ground', 0, 19, 120, 4);
  paint.fill('ground', 12, 15, 6, 1);
  paint.fill('ground', 24, 12, 4, 2);
  paint.fill('ground', 55, 16, 10, 3);
  paint.fill('ground', 58, 13, 4, 3);
  paint.fill('ground', 70, 14, 4, 5);
  paint.fill('ground', 80, 11, 7, 1);
  paint.fill('ground', 95, 14, 6, 1);
  paint.fill('ground', 104, 10, 3, 1);
  // A pond: the ground is gone, and an animated tile is in its place.
  paint.fill(null, 38, 19, 10, 2);
  for (let x = 38; x < 48; x++) {
    paint.tile(x, 19, WATER);
    paint.tile(x, 20, DEEP_WATER);
  }

  const mountain = (mname, x, w, h, color) => p(mname, 'Shape', { shape: 'polygon', x, y: 320, points: [-w / 2, 0, 0, -h, w / 2, 0], color });
  const cloud = (cname, x, y) => p(cname, 'Group', { x, y }, [
    circle('A', 16, [1, 1, 1, 0.9]), circle('B', 22, [1, 1, 1, 0.9], { x: 20, y: -6 }), circle('C', 14, [1, 1, 1, 0.9], { x: 42 }),
  ]);
  return {
    'smitten.json': project(name, 'scenes/level.scene', { ...SMALL, background: [0.55, 0.75, 0.95, 1] }),
    ...tilesetFiles(),
    'scenes/level.scene': scene(p('Level', 'Group', null, [
      p('Mountains', 'Background', { scrollX: 0.15, scrollY: 0, repeatWidth: 640 }, [
        mountain('Peak1', 100, 320, 120, [0.5, 0.56, 0.75, 1]),
        mountain('Peak2', 330, 400, 90, [0.44, 0.5, 0.7, 1]),
        mountain('Peak3', 540, 300, 140, [0.5, 0.56, 0.75, 1]),
      ]),
      p('Clouds', 'Background', { scrollX: 0.3, scrollY: 0, repeatWidth: 640, driftX: -8 }, [
        cloud('Cloud1', 80, 60), cloud('Cloud2', 330, 100), cloud('Cloud3', 520, 40),
      ]),
      p('Hills', 'Background', { scrollX: 0.5, scrollY: 0, repeatWidth: 320 }, [
        circle('Hill1', 90, [0.3, 0.55, 0.35, 1], { x: 80, y: 340 }),
        circle('Hill2', 110, [0.26, 0.5, 0.32, 1], { x: 250, y: 360 }),
      ]),
      p('Ground', 'Tiles', { tileset: 'art/tiles.tileset', cells: paint.cells() }),
      p('Player', 'Body', { x: 40, y: 280 }, [
        look(12, 20, [0.95, 0.4, 0.35, 1], { cornerRadius: 3 }),
        p('Camera', 'Camera', { smoothing: 8, left: 0, top: 0, right: 1920, bottom: 368 }),
      ], { tags: ['player'], script: 'scripts/player.lua' }),
      p('UI', 'Group', null, [
        p('Help', 'Label', { x: 10, y: 8, width: 620, size: 14, outline: true, text: 'Arrows: run. Space: jump. Click: dig. Right-click: add ground.' }),
      ]),
    ], { script: 'scripts/level.lua' })),
    'scripts/player.lua': swap(libraryScript('platformer'), 'speed = 220', 'speed = 140', 'acceleration = 2400', 'acceleration = 1400',
      'jumpHeight = 96', 'jumpHeight = 72', 'gravity = 1800', 'gravity = 1400', 'maxFallSpeed = 1000', 'maxFallSpeed = 700'),
    'scripts/level.lua': `-- The level. Select "Ground" to see the parts of a level:
-- - The Tiles piece "Ground" uses the terrain "ground" of art/tiles.tileset.
--   When you paint with a terrain, each cell gets the tile that fits the
--   cells next to it.
-- - The water is an animated tile: open Animation in the Tiles panel.
-- - "Mountains", "Clouds" and "Hills" are Backgrounds. Each one scrolls at
--   its own speed (scrollX) when the camera moves.

function update(dt)
  -- setTerrain() changes a cell, and the cells around it get new edges.
  local column, row = Ground:cellAt(mouse())
  if down("mouse:1") then Ground:setTerrain(column, row, nil) end
  if down("mouse:2") then Ground:setTerrain(column, row, "ground") end

  -- The player fell out of the level: start again.
  local player = first("player")
  if player and player.y > 420 then reload() end
end
`,
  };
}

// ---------------------------------------------------------------------------
// Pathfinding

// A maze of 2-cell paths with walls of 1 cell: true where a wall is.
// The same seed always makes the same maze.
function maze(columns, rows, seed) {
  const rand = randomFrom(seed);
  const w = columns * 3 + 1;
  const h = rows * 3 + 1;
  const walls = Array.from({ length: h }, () => Array(w).fill(true));
  const open = (x, y, cw, ch) => { for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) walls[y + j][x + i] = false; };
  const seen = new Set(['0,0']);
  const stack = [[0, 0]];
  open(1, 1, 2, 2);
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [cx + dx, cy + dy])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < columns && y < rows && !seen.has(`${x},${y}`));
    if (!next.length) { stack.pop(); continue; }
    const [nx, ny] = next[Math.floor(rand() * next.length)];
    seen.add(`${nx},${ny}`);
    open(nx * 3 + 1, ny * 3 + 1, 2, 2);
    open(Math.min(cx, nx) * 3 + 1 + (nx !== cx ? 2 : 0), Math.min(cy, ny) * 3 + 1 + (ny !== cy ? 2 : 0), nx !== cx ? 1 : 2, ny !== cy ? 1 : 2);
    stack.push([nx, ny]);
  }
  // Some more openings, so that there is more than one way.
  for (let i = 0; i < 14; i++) {
    const cx = Math.floor(rand() * (columns - 1));
    const cy = Math.floor(rand() * (rows - 1));
    if (rand() < 0.5) open(cx * 3 + 3, cy * 3 + 1, 1, 2);
    else open(cx * 3 + 1, cy * 3 + 3, 2, 1);
  }
  return walls;
}

function pathfinding(name) {
  const walls = maze(13, 7, 11);
  const paint = painter();
  walls.forEach((row, y) => row.forEach((isWall, x) => { if (isWall) paint.place('rock', x, y); }));
  return {
    'smitten.json': project(name, 'scenes/maze.scene', { ...SMALL, background: [0.12, 0.13, 0.17, 1] }),
    ...tilesetFiles(),
    'scenes/maze.scene': scene(p('Level', 'Group', null, [
      p('Maze', 'Tiles', { tileset: 'art/tiles.tileset', cells: paint.cells() }),
      p('Player', 'Body', { x: 32, y: 32, speed: 110, acceleration: 1200 }, [circle('Look', 6, [0.45, 0.9, 0.55, 1])],
        { tags: ['player'], script: 'scripts/player.lua' }),
      p('Ghost', 'Body', { x: 608, y: 320 }, [
        circle('Look', 6, [1, 0.45, 0.5, 1]),
        circle('Eye', 1.5, [1, 1, 1, 1], { x: 2, y: -1 }),
      ], { tags: ['enemy'], script: 'scripts/ghost.lua' }),
      p('UI', 'Group', null, [
        p('Help', 'Label', { anchor: 'bottomLeft', x: 8, y: 2, width: 620, size: 12, outline: true, text: 'Arrows or WASD: run. The ghost finds its way to you.' }),
      ]),
    ])),
    'scripts/player.lua': libraryScript('topdown'),
    'scripts/ghost.lua': `-- The ghost: it finds its way to the player through the maze.
-- newPathGrid() makes a grid from the Tiles piece "Maze". The solid tiles
-- are the walls of the grid. The agent keeps the path to its target, and
-- next() gives the point to go to now.

speed = 60              -- pixels per second
showPath = true         -- draw the path that the ghost follows

local agent

function ready()
  local grid = parent:find("Maze"):newPathGrid({ diagonals = "noCorners" })
  agent = smitten.paths.newAgent({ finder = grid })
end

function physicsUpdate(dt)
  local player = first("player")
  if not player then return end
  agent:setTarget(player.x, player.y)     -- the agent plans again when the player moves away
  local nextX, nextY = agent:next(x, y)
  local dx, dy = nextX - x, nextY - y
  local d = math.sqrt(dx * dx + dy * dy)
  if agent:isDone() or d == 0 then
    vx, vy = 0, 0
  else
    vx, vy = dx / d * speed, dy / d * speed
  end
  move()
end

function draw()
  if showPath then smitten.paths.debugDraw(agent, { color = { 1, 0.45, 0.5, 0.7 } }) end
end

-- The ghost touched the player: start again.
function hit(other)
  if other:is("player") then reload() end
end
`,
  };
}

// ---------------------------------------------------------------------------
// Two players

// The keys of "Two players on one keyboard" in Project settings › Input.
const TWO_ON_ONE_KEYBOARD = {
  1: {
    left: ['a', 'pad:dpleft', 'axis:leftx-'], right: ['d', 'pad:dpright', 'axis:leftx+'],
    up: ['w', 'pad:dpup', 'axis:lefty-'], down: ['s', 'pad:dpdown', 'axis:lefty+'],
    jump: ['space', 'pad:a'], fire: ['f', 'pad:x'],
  },
  2: {
    left: ['left', 'pad:dpleft', 'axis:leftx-'], right: ['right', 'pad:dpright', 'axis:leftx+'],
    up: ['up', 'pad:dpup', 'axis:lefty-'], down: ['down', 'pad:dpdown', 'axis:lefty+'],
    jump: ['return', 'pad:a'], fire: ['rshift', 'pad:x'],
  },
};

function twoPlayers(name) {
  const ledge = (lname, x, y, w) => wall(lname, x, y, w, 24, [0.3, 0.33, 0.4, 1]);
  const touch = (side, n) => {
    const anchor = side === 'left' ? 'bottomLeft' : 'bottomRight';
    return [
      p(`Stick${n}`, 'TouchStick', { anchor, x: 30, y: 30, width: 150, height: 150, player: n }),
      p(`Jump${n}`, 'TouchButton', { anchor, x: 210, y: 50, width: 90, height: 90, player: n, text: 'Jump' }),
    ];
  };
  return {
    'smitten.json': project(name, 'scenes/arena.scene', LARGE, { input: { players: TWO_ON_ONE_KEYBOARD } }),
    'scenes/player.scene': scene(p('Player', 'Body', null, [
      look(28, 44, [1, 1, 1, 1], { cornerRadius: 6 }),
      p('Eye', 'Shape', { shape: 'circle', radius: 4, x: 6, y: -10, color: [0.1, 0.1, 0.15, 1] }),
      p('Tag', 'Text', { y: -40, text: 'P1', size: 18, outline: true }),
    ], { script: 'scripts/player.lua', tags: ['player'] })),
    'scenes/arena.scene': scene(p('Arena', 'Group', null, [
      wall('Ground', 640, 700, 1280, 40), wall('Left', -20, 360, 40, 720), wall('Right', 1300, 360, 40, 720),
      ledge('LedgeLeft', 380, 540, 220), ledge('LedgeRight', 900, 540, 220), ledge('High', 640, 380, 260), ledge('Perch', 330, 280, 140),
      p('Lift', 'Body', { x: 130, y: 640, motion: 'still', route: '0, -340', speed: 90, stopTime: 1 },
        [look(140, 20, [0.85, 0.7, 0.3, 1], { cornerRadius: 4 })], { script: 'scripts/moving-platform.lua' }),
      { name: 'Player1', scene: 'scenes/player.scene', properties: { x: 260, y: 640, player: 1, tint: [0.45, 0.65, 1, 1] } },
      { name: 'Player2', scene: 'scenes/player.scene', properties: { x: 1020, y: 640, player: 2, tint: [1, 0.55, 0.45, 1] } },
      p('Coin', 'Zone', { x: 640, y: 340 }, [circle('Look', 12, [1, 0.8, 0.25, 1])], { script: 'scripts/coin.lua' }),
      p('UI', 'Group', null, [
        p('Score1', 'Label', { x: 24, y: 18, width: 300, size: 26, outline: true, text: 'Player 1: 0', color: [0.6, 0.75, 1, 1] }),
        p('Score2', 'Label', { anchor: 'topRight', x: 24, y: 18, width: 300, size: 26, outline: true, align: 'right', text: 'Player 2: 0', color: [1, 0.7, 0.6, 1] }),
        p('Clock', 'Label', { anchor: 'top', y: 18, width: 300, size: 26, outline: true, align: 'center', text: 'Time: 60' }, null, { script: 'scripts/countdown.lua' }),
        p('Help', 'Label', { anchor: 'top', y: 60, width: 900, align: 'center', outline: true, color: [1, 1, 1, 0.75],
          text: 'Player 1: WASD and Space. Player 2: arrow keys and Enter. Gamepads also work.' }),
        ...touch('left', 1), ...touch('right', 2),
      ]),
    ], { script: 'scripts/game.lua' })),
    'scripts/player.lua': `-- A player. The arena has this scene two times: Player1 has player = 1,
-- and Player2 has player = 2 (select them to see it in the Inspector).
-- Input functions without a player number read the keys of this player:
-- see Project settings › Input. Gamepad 2 is player 2.

player = 1

${swap(libraryScript('platformer'), 'function ready()\n  airLeft = airJumps\nend', 'function ready()\n  airLeft = airJumps\n  Tag.text = `P{player}`   -- the tag over the head shows the number\nend')}`,
    'scripts/coin.lua': `-- The coin: a Zone. When a player touches it, the arena gets the event
-- "scored" with the number of the player. Then the coin goes to a
-- different place.

local places = { { 640, 340 }, { 380, 500 }, { 900, 500 }, { 330, 240 }, { 1120, 650 }, { 180, 300 }, { 640, 650 } }
local at = 1

function entered(other)
  if not other:is("player") then return end
  root():emit("scored", other.player)
  at = at % #places + 1
  x, y = places[at][1], places[at][2]
end
`,
    'scripts/game.lua': `-- The arena counts the coins of each player for one round. The Label
-- "Clock" has the ready-made script countdown.lua. At 0 it sends the
-- event "timeUp" to this piece.

local scores = { 0, 0 }
local playing = true

function scored(who)
  if not playing then return end
  scores[who] += 1
  find(\`UI/Score{who}\`).text = \`Player {who}: {scores[who]}\`
end

function timeUp()
  playing = false
  local help = find("UI/Help")
  if scores[1] == scores[2] then help.text = "A draw!"
  elseif scores[1] > scores[2] then help.text = "Player 1 wins!"
  else help.text = "Player 2 wins!" end
  wait(4)
  reload()
end
`,
    'scripts/moving-platform.lua': libraryScript('moving-platform'),
    'scripts/countdown.lua': libraryScript('countdown'),
  };
}

// ---------------------------------------------------------------------------
// Text

function text(name) {
  return {
    'smitten.json': project(name, 'scenes/room.scene', LARGE),
    'sounds/blip.wav': blipSound(),
    'scenes/room.scene': scene(p('Room', 'Group', null, [
      p('Floor', 'Shape', { x: 640, y: 360, width: 1280, height: 720, color: [0.18, 0.2, 0.26, 1] }),
      p('Ada', 'Group', { x: 640, y: 300 }, [
        look(70, 90, [0.55, 0.4, 0.8, 1], { cornerRadius: 20, y: 40 }),
        circle('Head', 30, [0.96, 0.82, 0.68, 1], { y: -30 }),
        p('Name', 'Text', { y: -84, text: 'Ada', size: 24, outline: true }),
      ]),
      p('UI', 'Group', null, [
        p('Prompt', 'Label', { anchor: 'top', y: 40, width: 800, align: 'center', size: 26, outline: true, text: 'Press Space or Enter to talk to Ada.', visible: false }),
        p('Box', 'Panel', { anchor: 'bottom', y: 30, width: 1000, height: 190, visible: false }, [
          p('Words', 'Label', { anchor: 'fill', x: 28, y: 22, size: 30, rich: true, text: '' }, null, { script: 'scripts/dialogue.lua' }),
          p('Next', 'Label', { anchor: 'bottomRight', x: 18, y: 10, width: 200, height: 24, size: 16, align: 'right', color: [1, 1, 1, 0.5], text: 'Space: next' }),
        ]),
      ]),
    ], { script: 'scripts/talk.lua' })),
    'scripts/dialogue.lua': `-- The dialogue box: a Panel ("Box") with this Label ("Words") in it.
-- There is no dialogue system: say() puts a line in text, and reveal()
-- shows it one letter after the other. A key press shows the remaining
-- part of the line, and the next key press goes to the next line.

speed = 40              -- letters per second

local lines, at = {}, 0

local function show()
  text = lines[at]
  reveal(speed)
end

function say(list)
  lines, at = list, 1
  parent.visible = true
  show()
end

-- The engine calls revealed() for each letter that comes onto the screen.
function revealed(index, char)
  if char ~= " " then sfx("blip", { volume = 0.3, pitch = 0.9 + rnd(0.2) }) end
end

function update(dt)
  if not parent.visible or not pressed("accept") then return end
  if visibleCharacters >= 0 then
    skip()                -- the line is not complete: show all of it
  elseif at < #lines then
    at += 1
    show()
  else
    parent.visible = false
    root():emit("dialogueEnded")
  end
end
`,
    'scripts/talk.lua': `-- The room: it gives the lines to the dialogue box.
-- The words in square brackets are text tags. The Label has rich on, so
-- it reads them. [bounce] is an effect that this script adds.

local lines = {
  "Hello! I am [b]Ada[/b]. Welcome to the [color=gold]text[/color] example.",
  "Text tags change how words look: [wave]wave[/wave], [shake]shake[/shake] and [rainbow]rainbow[/rainbow].",
  "Some text tags change the speed. Well...[pause=0.6] [speed=8]this part is slow.[/speed]",
  "This effect is my own: [bounce]bounce, bounce[/bounce]. Look at talk.lua.",
}

-- An effect changes each letter in each frame. c.index is the number of the letter.
smitten.text.effect("bounce", function(c)
  c.y = c.y - math.abs(math.sin(c.time * 6 + c.index * 0.4)) * 6
end)

function ready()
  wait(0.5)
  find("UI/Box/Words"):say(lines)
end

-- The dialogue box sends this event when its last line closes.
function dialogueEnded()
  wait(0.3)
  find("UI/Prompt").visible = true
end

function update(dt)
  local prompt = find("UI/Prompt")
  if prompt.visible and pressed("accept") then
    prompt.visible = false
    find("UI/Box/Words"):say(lines)
  end
end
`,
  };
}

// ---------------------------------------------------------------------------
// UI

function ui(name) {
  const label = (lname, t) => p(lname, 'Label', { width: 110, height: 30, text: t, valign: 'middle' });
  const choice = (cname, t, checked) => p(cname, 'Checkbox', { width: 110, text: t, group: 'difficulty', checked });
  return {
    'smitten.json': project(name, 'scenes/settings.scene', LARGE),
    'sounds/blip.wav': blipSound(),
    'scenes/settings.scene': scene(p('Screen', 'Group', null, [
      p('Back', 'Shape', { x: 640, y: 360, width: 1280, height: 720, color: [0.14, 0.17, 0.24, 1] }),
      p('UI', 'Group', null, [
        p('Greeting', 'Label', { anchor: 'top', y: 40, width: 1000, align: 'center', size: 28, outline: true, text: 'Hello!' }),
        p('Settings', 'Panel', { anchor: 'center', width: 520, height: 330 }, [
          p('Menu', 'Column', { anchor: 'fill', x: 24, y: 22, gap: 16 }, [
            p('Title', 'Label', { height: 36, size: 28, text: 'Settings' }),
            p('VolumeRow', 'Row', null, [label('VolumeLabel', 'Volume'), p('Volume', 'Slider', { min: 0, max: 1, step: 0.05, value: 0.8, grow: 1 }, null, { script: 'scripts/volume.lua' })]),
            p('Fullscreen', 'Checkbox', { text: 'Fullscreen', look: 'switch', width: 200 }),
            p('NameRow', 'Row', null, [label('NameLabel', 'Name'), p('Name', 'TextInput', { placeholder: 'Your name', maxLength: 12, grow: 1 }, null, { script: 'scripts/name.lua' })]),
            p('Difficulty', 'Row', null, [choice('Easy', 'Easy', false), choice('Normal', 'Normal', true), choice('Hard', 'Hard', false)]),
            p('Reset', 'Button', { text: 'Reset', width: 140, autofocus: true }),
          ]),
        ]),
      ]),
    ], { script: 'scripts/settings.lua' })),
    'scripts/volume.lua': `-- The volume Slider. load() gets the value that save() kept the last
-- time. Because of this, the volume stays the same when the game starts again.

function ready()
  value = load("volume", 0.8)
  masterVolume(value)
end

-- The engine calls changed() when the player moves the Slider.
function changed(value)
  masterVolume(value)
  save("volume", value)
  sfx("blip")             -- so that you hear the new volume
end
`,
    'scripts/name.lua': `-- The name box: a TextInput. The engine calls blurred() when typing
-- stops (Enter, Escape, Tab or a click on a different place).

function ready()
  text = load("name", "")
end

function blurred()
  save("name", text)
  root():emit("settingsChanged")
end

function submitted()
  blur()
end
`,
    'scripts/settings.lua': `-- The settings screen. The pieces are in a Column, and the Column puts
-- them one under the other. The Rows put a Label next to a Slider or a
-- TextInput. Use the arrow keys, Tab or a gamepad to move the keyboard
-- focus between them.
-- This script listens to the events of the Checkboxes and the Button.

local menu = "UI/Settings/Menu"
local levels = { "Easy", "Normal", "Hard" }

local function greet()
  local who = find(menu .. "/NameRow/Name").text
  if who == "" then who = "player" end
  local volume = math.floor(find(menu .. "/VolumeRow/Volume").value * 100 + 0.5)
  find("UI/Greeting").text = \`Hello, {who}! Volume {volume}%, {load("difficulty", "Normal")}.\`
end

function ready()
  local fs = find(menu .. "/Fullscreen")
  fs.checked = fullscreen()
  fs:on("toggled", function(checked) fullscreen(checked) end)

  -- The three Checkboxes have the same group. Because of this, when the
  -- player ticks one, the engine unticks the other two.
  local saved = load("difficulty", "Normal")
  for _, level in ipairs(levels) do
    local box = find(\`{menu}/Difficulty/{level}\`)
    box.checked = level == saved
    box:on("toggled", function(checked)
      if checked then save("difficulty", level) end
      greet()
    end)
  end

  find(menu .. "/VolumeRow/Volume"):on("changed", greet)
  find(menu .. "/Reset"):on("clicked", function()
    save("volume", 0.8)
    save("name", "")
    save("difficulty", "Normal")
    reload()
  end)
  greet()
end

function settingsChanged()
  greet()
end
`,
  };
}

// ---------------------------------------------------------------------------
// Forces

function forces(name) {
  const drag = { script: 'scripts/drag.lua', tags: ['thing'] };
  const crate = (cname, x, y, size = 44) => p(cname, 'Body', { motion: 'physics', x, y, friction: 0.5 }, [look(size, size, [0.82, 0.6, 0.34, 1], { cornerRadius: 4 })], drag);
  const ball = (bname, x, y, radius = 20, color = [0.4, 0.8, 1, 1]) => p(bname, 'Body', { motion: 'physics', x, y, bounce: 0.4, mass: 0.6 }, [circle('Look', radius, color)], drag);
  const sign = (sname, x, y, t) => p(sname, 'Text', { x, y, text: t, size: 20, outline: true });
  return {
    'smitten.json': project(name, 'scenes/forces.scene', LARGE),
    'scenes/ball.scene': scene(p('Ball', 'Body', { motion: 'physics', bounce: 0.4, mass: 0.6 }, [circle('Look', 18, [0.95, 0.5, 0.7, 1])], drag)),
    'scenes/forces.scene': scene(p('Forces', 'Group', null, [
      wall('Floor', 640, 700, 1280, 40), wall('Left', -20, 360, 40, 720), wall('Right', 1300, 360, 40, 720), wall('Ceiling', 640, -20, 1280, 40),
      p('Planet', 'Body', { x: 1030, y: 300, motion: 'still' }, [circle('Look', 70, [0.55, 0.45, 0.75, 1])]),
      p('Orbit', 'Zone', { x: 1030, y: 300, forces: true, gravity: 'replace', toCenter: true, gravityStrength: 900 }, [circle('Look', 230, [0.6, 0.5, 0.9, 0.12])]),
      p('Wind', 'Zone', { x: 640, y: 400, forces: true, pushX: 500 }, [look(220, 560, [0.8, 0.9, 1, 0.1])]),
      crate('Crate1', 160, 540), crate('Crate2', 330, 600, 36), ball('Ball1', 260, 500),
      ball('Ball2', 600, 200), crate('Crate3', 680, 640),
      ball('Moon1', 1030, 120, 14, [0.85, 0.85, 0.9, 1]), ball('Moon2', 1210, 300, 12, [0.85, 0.85, 0.9, 1]),
      // The water is after the things, so they show behind it.
      p('Water', 'Zone', { x: 230, y: 570, forces: true, gravity: 'add', gravityY: -1200, drag: 3 }, [look(420, 220, [0.2, 0.5, 0.9, 0.4])]),
      p('Spawner', 'Group', { x: 400, y: 60, sceneFile: 'scenes/ball.scene', interval: 3, maxAlive: 4, spreadX: 300 }, null, { script: 'scripts/spawner.lua' }),
      p('Signs', 'Group', null, [
        sign('WaterSign', 230, 400, 'Water: more gravity up, and drag'),
        sign('WindSign', 640, 100, 'Wind: a push to the right'),
        sign('PlanetSign', 1030, 40, 'Planet: a pull to its center'),
      ]),
      p('UI', 'Group', null, [
        p('Help', 'Label', { anchor: 'bottom', y: 50, width: 1000, align: 'center', outline: true, text: 'Drag and throw things with the mouse. Space: wind off.' }),
      ]),
    ], { script: 'scripts/forces.lua' })),
    'scripts/forces.lua': `-- Three Zones have forces on. Select each one to see its properties:
-- - Water: gravity "add" with gravityY -1200 (up), and drag.
-- - Wind: pushX, a steady push to the right.
-- - Orbit: gravity "replace" with toCenter, a pull to the planet.
-- Only bodies with motion "physics" feel the forces.
-- The Spawner (spawner.lua) drops a new ball every 3 seconds.

function update(dt)
  -- Scripts can change the forces while the game runs.
  if pressed("jump") then
    Wind.forces = not Wind.forces
    find("UI/Help").text = if Wind.forces then "Drag and throw things with the mouse. Space: wind off."
      else "Drag and throw things with the mouse. Space: wind on."
  end
end
`,
    'scripts/drag.lua': libraryScript('drag'),
    'scripts/spawner.lua': libraryScript('spawner'),
  };
}

// ---------------------------------------------------------------------------
// Random

function random(name) {
  // The edge of the cave, so that the scene view shows where it goes. The
  // script makes the cave when the game starts.
  const paint = painter();
  paint.fill('rock', 0, 0, 40, 1);
  paint.fill('rock', 0, 21, 40, 1);
  paint.fill('rock', 0, 1, 1, 20);
  paint.fill('rock', 39, 1, 1, 20);
  return {
    'smitten.json': project(name, 'scenes/cave.scene', { ...SMALL, background: [0.1, 0.09, 0.12, 1] },
      { input: { newCave: ['r', 'pad:y'] } }),
    ...tilesetFiles(),
    'scenes/cave.scene': scene(p('Level', 'Group', null, [
      p('Cave', 'Tiles', { tileset: 'art/tiles.tileset', cells: paint.cells(), caveSeed: 1 }, null, { script: 'scripts/cave.lua' }),
      p('Player', 'Body', { x: 320, y: 176, speed: 120, acceleration: 1200 }, [circle('Look', 5, [1, 0.85, 0.4, 1])],
        { tags: ['player'], script: 'scripts/player.lua' }),
      p('UI', 'Group', null, [
        p('Seed', 'Label', { x: 8, y: 2, width: 620, size: 14, outline: true, text: 'Seed: 1' }),
      ]),
    ])),
    'scripts/player.lua': libraryScript('topdown'),
    'scripts/cave.lua': `-- The cave: this script fills the Tiles piece from a seed.
-- The same seed always makes the same cave. Press R (the input action
-- "newCave" in Project settings › Input) for a new seed.

caveSeed = 1            -- change it in the Inspector for a different cave
rockAmount = 0.5        -- from 0 to 1: more makes more rock
caveWidth = 40          -- cells
caveHeight = 22

function makeCave()
  -- Noise gives smooth random values: air where it is high, rock where it is low.
  local noise = smitten.math.newNoise({ seed = caveSeed, scale = 6, octaves = 3 })
  clear()
  fillTerrain(0, 0, caveWidth, caveHeight, "rock")
  for column = 1, caveWidth - 2 do
    for row = 1, caveHeight - 2 do
      if noise:get(column, row) > rockAmount then setTerrain(column, row, nil) end
    end
  end

  -- Random numbers of its own, from the same seed, choose where the player starts.
  local r = smitten.math.newRandom(caveSeed)
  for i = 1, 500 do
    local column, row = r:random(1, caveWidth - 2), r:random(1, caveHeight - 2)
    if not isSolid(column, row) then
      local player = first("player")
      if player then player.x, player.y = cellCenter(column, row) end
      break
    end
  end
  root():find("UI/Seed").text = \`Seed: {caveSeed}. R: a new cave.\`
end

function ready()
  makeCave()
end

function update(dt)
  if pressed("newCave") then
    caveSeed = math.floor(rnd(100000))
    makeCave()
  end
end
`,
  };
}

// ---------------------------------------------------------------------------
// Animation

function animation(name) {
  const dark = [0.32, 0.34, 0.4, 1];
  return {
    'smitten.json': project(name, 'scenes/rooms.scene', LARGE),
    'sounds/creak.wav': creakSound(),
    'scenes/door.scene': scene(p('Door', 'Zone', { shape: 'rectangle', width: 360, height: 260, detects: 'player' }, [
      p('Slab', 'Body', { motion: 'still' }, [look(30, 120, [0.62, 0.42, 0.25, 1], { cornerRadius: 3 })]),
      p('Sign', 'Text', { y: -90, text: 'Closed', size: 18, outline: true }),
      p('Creak', 'Sound', { sound: 'sounds/creak.wav', volume: 0.7 }),
      p('Anim', 'Animator', {
        physicsStep: true,
        animations: {
          open: {
            length: 0.6,
            tracks: [
              { piece: 'Slab', property: 'scaleY', keys: [{ time: 0, value: 1 }, { time: 0.6, value: 0.05, easing: 'outQuad' }] },
              { piece: 'Slab', property: 'y', keys: [{ time: 0, value: 0 }, { time: 0.6, value: -57, easing: 'outQuad' }] },
              { piece: 'Creak', calls: [{ time: 0, method: 'play' }] },
            ],
          },
        },
      }),
    ], { script: 'scripts/door.lua' })),
    'scenes/rooms.scene': scene(p('Rooms', 'Group', null, [
      p('Floor', 'Shape', { x: 640, y: 360, width: 1280, height: 720, color: [0.2, 0.22, 0.27, 1] }),
      wall('Top', 640, 10, 1280, 20, dark), wall('Bottom', 640, 710, 1280, 20, dark),
      wall('Left', 10, 360, 20, 720, dark), wall('Right', 1270, 360, 20, 720, dark),
      wall('WallUp', 760, 150, 40, 300, dark), wall('WallDown', 760, 570, 40, 300, dark),
      { name: 'Door', scene: 'scenes/door.scene', properties: { x: 760, y: 360 } },
      p('Prize', 'Shape', { x: 1030, y: 360, shape: 'polygon', points: [0, -40, 12, -12, 40, -12, 18, 6, 26, 36, 0, 18, -26, 36, -18, 6, -40, -12, -12, -12], color: [1, 0.85, 0.3, 1] }),
      p('Player', 'Body', { x: 300, y: 360 }, [look(30, 30, [0.36, 0.75, 0.55, 1], { cornerRadius: 8 })], { tags: ['player'], script: 'scripts/player.lua' }),
      p('UI', 'Group', null, [
        p('Help', 'Label', { x: 30, y: 26, width: 900, outline: true, text: 'Arrows or WASD: walk. Go near the door.' }),
      ]),
    ])),
    'scripts/player.lua': libraryScript('topdown'),
    'scripts/door.lua': `-- The door: a Zone that sees the player come near.
-- Its Animator "Anim" has the animation "open". It has keys for the y and
-- the scaleY of the Slab, and a call key that plays the Sound "Creak".
-- Select Anim and open the Animate panel to see the keys.

closeDelay = 0.5        -- seconds before the door closes after the player goes away

local near, isOpen = false, false

-- The engine calls entered() and exited() as tasks. Because of this, they
-- can wait, and animate() waits until the animation ends.
function entered(other)
  near = true
  if isOpen or Anim.playing then return end
  Sign.text = "Opening"
  Anim.speed = 1
  Anim:animate("open")
  isOpen = true
  Sign.text = "Open"
  if not near then exited(other) end
end

function exited(other)
  near = false
  wait(closeDelay)
  if near or not isOpen or Anim.playing then return end
  Sign.text = "Closing"
  Anim.speed = -1         -- the same animation, backwards
  Anim:animate("open")
  isOpen = false
  Sign.text = "Closed"
  if near then entered(other) end
end
`,
  };
}

// ---------------------------------------------------------------------------
// Sound

function sound(name) {
  const melody = [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 79, 76, 74, 72];
  const song = {
    format: 'smitten.song', version: 1, bpm: 120, stepsPerBeat: 2, patternLength: 16, loop: true, loopStart: 0,
    channels: [
      { name: 'Pluck', instrument: 0, volume: 0.8 },
      { name: 'Bass', instrument: 1, volume: 0.6 },
      { name: 'Drum', instrument: 2, volume: 0.8 },
    ],
    instruments: [
      { name: 'Pluck', type: 'sample', sample: '../sounds/pluck.wav', baseNote: 60, playToEnd: false, release: 0.15 },
      { name: 'Bass', type: 'synth', wave: 'triangle', volume: 0.6, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.1, duty: 0.5, vibratoDepth: 0, vibratoSpeed: 5, lowpass: 1 },
      { name: 'Drum', type: 'sample', sample: '../sounds/drum.wav', baseNote: 60, pitched: false },
    ],
    patterns: [{
      name: 'Tune',
      notes: [
        ...melody.map((note, step) => ({ channel: 0, step, length: 1, note })),
        ...[48, 53, 55, 48].map((note, i) => ({ channel: 1, step: i * 4, length: 4, note })),
        ...[0, 4, 8, 12].map((step) => ({ channel: 2, step, length: 1, note: 60 })),
      ],
    }],
    order: [0],
  };
  const pad = (pname, t, sample, pitch) => p(pname, 'Button', { width: 200, height: 120, size: 24, text: t, sample, basePitch: pitch, ...(pname === 'Drum' ? { autofocus: true } : {}) }, null, { script: 'scripts/pad.lua' });
  return {
    'smitten.json': project(name, 'scenes/music.scene', LARGE),
    'sounds/pluck.wav': pluckSound(),
    'sounds/drum.wav': drumSound(),
    'music/tune.song': json(song),
    'scenes/music.scene': scene(p('Music', 'Group', null, [
      p('Back', 'Shape', { x: 640, y: 360, width: 1280, height: 720, color: [0.16, 0.14, 0.22, 1] }),
      p('UI', 'Group', null, [
        p('Title', 'Label', { anchor: 'top', y: 60, width: 1000, align: 'center', size: 32, outline: true, text: 'Click a pad. Each click has a different pitch.' }),
        p('Pads', 'Row', { anchor: 'center', gap: 24 }, [pad('Drum', 'Drum', 'drum', 1), pad('Pluck', 'Pluck', 'pluck', 1), pad('Low', 'Low pluck', 'pluck', 0.5)]),
        p('MusicButton', 'Button', { anchor: 'bottom', y: 70, width: 260, height: 50, text: 'Stop the music', musicOn: true }, null, { script: 'scripts/music.lua' }),
      ]),
    ])),
    'scripts/pad.lua': `-- A pad: a Button that plays a sound with sfx() when you click it.
-- The pitch is a little different each time, so the sound does not
-- become boring. A pitch of 2 is one octave higher.

sample = "drum"         -- the name of a sound file in the project
basePitch = 1           -- the pitch with no change: 1 is the pitch of the file
pitchSpread = 0.15      -- each click goes up to this much higher or lower

function clicked()
  sfx(sample, { volume = 0.9, pitch = basePitch + (rnd(2) - 1) * pitchSpread })
end
`,
    'scripts/music.lua': `-- The music button. music/tune.song is a song. Its Pluck instrument is a
-- sample instrument: it plays sounds/pluck.wav at the pitch of each note.
-- Open the song in the Music workspace to see its notes.

musicOn = true
song = "music/tune.song"

function ready()
  if musicOn then music(song, { volume = 0.7 }) end
end

function clicked()
  musicOn = not musicOn
  if musicOn then music(song, { volume = 0.7 }) else stopMusic(0.5) end
  text = if musicOn then "Stop the music" else "Play the music"
end
`,
  };
}

// ---------------------------------------------------------------------------

/**
 * The examples: { id, name, description, icon, page (the docs page of the
 * feature), build(name) -> files }. Files are text, or bytes (Uint8Array)
 * for images and sounds.
 */
export const EXAMPLES = [
  { id: 'lights', name: 'Lights', page: 'lights', icon: 'light', description: 'A dark cave. A torch moves with the player, and Occluders in the rocks make shadows.', build: lights },
  { id: 'levels', name: 'Levels', page: 'tiles', icon: 'tiles', description: 'A level of tiles with a terrain, an animated water tile, and Backgrounds that scroll at different speeds.', build: levels },
  { id: 'pathfinding', name: 'Pathfinding', page: 'pathfinding', icon: 'walkable', description: 'A ghost finds its way to the player through a maze of tiles.', build: pathfinding },
  { id: 'players', name: 'Two players', page: 'input', icon: 'gamepad', description: 'Two players on one keyboard or two gamepads collect coins. On a phone, touch pieces show.', build: twoPlayers },
  { id: 'text', name: 'Text', page: 'text', icon: 'text', description: 'A dialogue box from a Panel, a Label and reveal(), with text tags and an effect of its own.', build: text },
  { id: 'ui', name: 'UI', page: 'ui', icon: 'sliders', description: 'A settings screen from a Slider, Checkboxes, a TextInput, Rows and a Column. save() keeps the values.', build: ui },
  { id: 'forces', name: 'Forces', page: 'physics', icon: 'zone', description: 'Water, wind and a small planet: Zones with forces. Throw the physics bodies into them.', build: forces },
  { id: 'random', name: 'Random', page: 'random', icon: 'hash', description: 'A cave that a script makes into Tiles from a seed. Press R for a new cave.', build: random },
  { id: 'animation', name: 'Animation', page: 'animation', icon: 'animator', description: 'A door with an Animator. It opens when the player comes near, and it plays a sound.', build: animation },
  { id: 'sound', name: 'Sound', page: 'sound', icon: 'music', description: 'A short song with a sample instrument, and pads that play sounds with a different pitch each time.', build: sound },
];
