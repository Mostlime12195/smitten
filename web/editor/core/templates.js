// New-project templates. Each builds a project's files. None needs art: they
// use Shape pieces, so a game can start right away and get art later. Their
// scripts are copies of the ready-made scripts (script-library.js), the
// project's own to change.

import { SCRIPT_LIBRARY } from './script-library.js';

const json = (v) => JSON.stringify(v, null, 2) + '\n';
const scene = (root) => json({ format: 'smitten.scene', version: 2, root });
const settings = (name, main, display = {}) => json({
  format: 'smitten.project', version: 2, name, main,
  display: { width: 1280, height: 720, stretch: 'fit', filter: 'smooth', ...display },
});

/** The source of a ready-made script. */
export function libraryScript(id) {
  const s = SCRIPT_LIBRARY.find((x) => x.id === id);
  if (!s) throw new Error(`no ready-made script called ${id}`);
  return s.source;
}

/** A ready-made script with extra functions added before its return. */
function extend(id, extra) {
  const src = libraryScript(id);
  const i = src.lastIndexOf('\nreturn ');
  return `${src.slice(0, i)}\n${extra.trim()}\n${src.slice(i)}`;
}

const p = (name, type, properties, children, extra = {}) => ({
  name, type, ...(properties && Object.keys(properties).length ? { properties } : {}), ...extra,
  ...(children && children.length ? { children } : {}),
});
const look = (w, h, color, extra = {}) => p('Look', 'Shape', { width: w, height: h, color, ...extra });

// ---------------------------------------------------------------------------

function empty(name) {
  return {
    'smitten.json': settings(name, 'scenes/main.scene'),
    'scenes/main.scene': scene(p('Main', 'Group', null, [
      p('Camera', 'Camera', { x: 640, y: 360 }),
      p('Hello', 'Text', { x: 640, y: 360, text: 'Hello! Add pieces with the + in the Scene panel.', size: 28 }),
    ])),
  };
}

function platformer(name, display) {
  const wall = (pname, x, y, w) => p(pname, 'Body', { x, y, motion: 'still' }, [look(w, 32, [0.3, 0.33, 0.4, 1], { cornerRadius: 4 })]);
  const coins = [[420, 480], [470, 480], [520, 480], [820, 360], [870, 360], [1180, 260], [1500, 420]]
    .map(([x, y], i) => ({ name: `Coin${i + 1}`, scene: 'scenes/coin.scene', properties: { x, y } }));
  return {
    'smitten.json': settings(name, 'scenes/level.scene', display),
    'scenes/player.scene': scene(p('Player', 'Body', null, [
      look(28, 44, [0.36, 0.55, 0.95, 1], { cornerRadius: 6 }),
      p('Eye', 'Shape', { shape: 'circle', radius: 4, x: 6, y: -10, color: [1, 1, 1, 1] }),
      p('Camera', 'Camera', { smoothing: 6, left: 0, bottom: 720 }),
    ], { script: 'scripts/player.lua', tags: ['player'] })),
    'scenes/coin.scene': scene(p('Coin', 'Zone', null, [
      p('Look', 'Shape', { shape: 'circle', radius: 12, color: [1, 0.8, 0.25, 1] }, null, { script: 'scripts/bob.lua' }),
    ], { script: 'scripts/pickup.lua', tags: ['coin'] })),
    'scenes/enemy.scene': scene(p('Enemy', 'Body', null, [
      look(32, 28, [0.92, 0.36, 0.4, 1], { cornerRadius: 10 }),
    ], { script: 'scripts/patrol.lua', tags: ['enemy'] })),
    'scenes/level.scene': scene(p('Level', 'Group', null, [
      wall('Ground', 900, 620, 1800),
      wall('Step', 450, 520, 260),
      wall('Ledge', 850, 400, 220),
      wall('High', 1180, 300, 200),
      wall('Far', 1500, 460, 260),
      { name: 'Player', scene: 'scenes/player.scene', properties: { x: 120, y: 560 } },
      { name: 'Enemy', scene: 'scenes/enemy.scene', properties: { x: 1100, y: 580 } },
      p('Coins', 'Group', null, coins),
      p('UI', 'Group', null, [
        p('Score', 'Label', { x: 24, y: 18, width: 400, text: 'Coins: 0', size: 24, outline: true }),
        p('Help', 'Label', { anchor: 'bottomLeft', x: 24, y: 18, width: 700, text: 'Arrows or A/D to run, space to jump', color: [1, 1, 1, 0.7] }),
      ]),
    ], { script: 'scripts/level.lua' })),
    'scripts/player.lua': extend('platformer', `
-- Touching an enemy starts the level again.
function Player:hit(other)
  if other:hasTag("enemy") then smitten.scene.reload() end
end`),
    'scripts/level.lua': `-- The level: counts the coins the player collects (pickup.lua tells the
-- scene with a "collected" event).
local Level = {}

function Level:ready()
  self.coins = 0
  self.total = #smitten.scene.tagged("coin")
end

-- Fell off the level? Start again.
function Level:update(dt)
  local player = smitten.scene.first("player")
  if player and player.y > 900 then smitten.scene.reload() end
end

function Level:collected(coin)
  self.coins += 1
  self:find("UI/Score").text = \`Coins: {self.coins} / {self.total}\`
  if self.coins == self.total then
    self:find("UI/Help").text = "You got them all!"
  end
end

return Level
`,
    'scripts/pickup.lua': libraryScript('pickup'),
    'scripts/patrol.lua': libraryScript('patrol'),
    'scripts/bob.lua': libraryScript('bob'),
  };
}

function topdown(name) {
  const wall = (wname, x, y, w, h) => p(wname, 'Body', { x, y, motion: 'still' }, [look(w, h, [0.28, 0.3, 0.36, 1])]);
  return {
    'smitten.json': settings(name, 'scenes/arena.scene'),
    'scenes/enemy.scene': scene(p('Enemy', 'Body', { stopDistance: 0 }, [
      look(30, 30, [0.92, 0.36, 0.4, 1], { cornerRadius: 15 }),
    ], { script: 'scripts/chase.lua', tags: ['enemy'] })),
    'scenes/arena.scene': scene(p('Arena', 'Group', null, [
      wall('Top', 640, 20, 1240, 40), wall('Bottom', 640, 700, 1240, 40),
      wall('Left', 20, 360, 40, 720), wall('Right', 1260, 360, 40, 720),
      wall('Block', 640, 360, 160, 160),
      p('Player', 'Body', { x: 200, y: 360, speed: 240 }, [look(32, 32, [0.36, 0.75, 0.55, 1], { cornerRadius: 8 })],
        { tags: ['player'], script: 'scripts/player.lua' }),
      { name: 'Enemy1', scene: 'scenes/enemy.scene', properties: { x: 1100, y: 140, speed: 90 } },
      { name: 'Enemy2', scene: 'scenes/enemy.scene', properties: { x: 1100, y: 580, speed: 90 } },
      p('UI', 'Group', null, [p('Time', 'Label', { x: 60, y: 54, width: 400, text: 'Survive!', size: 24, outline: true })]),
    ])),
    'scripts/player.lua': extend('topdown', `
function Walker:ready()
  self.time = 0
end

function Walker:update(dt)
  self.time += dt
  smitten.scene.find("UI/Time").text = \`Survived {math.floor(self.time)} s\`
end

-- Bumping into an enemy starts again.
function Walker:hit(other)
  if other:hasTag("enemy") then smitten.scene.reload() end
end`),
    'scripts/chase.lua': libraryScript('chase'),
  };
}

function physicsToy(name) {
  const crates = [];
  for (let i = 0; i < 10; i++) {
    crates.push(p(`Crate${i + 1}`, 'Body', { motion: 'physics', x: 520 + (i % 5) * 52, y: 120 + Math.floor(i / 5) * 60, rotation: 0.1 * i, bounce: 0.1 },
      [look(48, 48, [0.82, 0.58 + (i % 3) * 0.06, 0.34, 1], { cornerRadius: 4 })], { script: 'scripts/drag.lua', tags: ['crate'] }));
  }
  return {
    'smitten.json': settings(name, 'scenes/toy.scene'),
    'scenes/toy.scene': scene(p('Toy', 'Group', null, [
      p('Floor', 'Body', { x: 640, y: 690, motion: 'still' }, [look(1280, 60, [0.3, 0.33, 0.4, 1])]),
      p('Ramp', 'Body', { x: 300, y: 520, rotation: 0.35, motion: 'still' }, [look(420, 24, [0.4, 0.43, 0.5, 1])]),
      ...crates,
      p('Ball', 'Body', { motion: 'physics', x: 200, y: 100, bounce: 0.7 },
        [p('Look', 'Shape', { shape: 'circle', radius: 26, color: [0.4, 0.8, 1, 1] })], { script: 'scripts/drag.lua' }),
      p('UI', 'Group', null, [p('Help', 'Label', { anchor: 'top', y: 20, width: 600, align: 'center', text: 'Drag the crates and the ball with the mouse', outline: true })]),
    ])),
    'scripts/drag.lua': libraryScript('drag'),
  };
}

export const TEMPLATES = [
  { id: 'empty', name: 'Empty', description: 'A scene with a camera, ready for your pieces.', icon: 'square', build: empty },
  { id: 'platformer', name: 'Platformer', description: 'Run, jump, collect coins and dodge a patrolling enemy. Shows scenes inside scenes.', icon: 'footprints', build: platformer },
  { id: 'topdown', name: 'Top-down', description: 'Move in any direction and survive enemies that chase you.', icon: 'gamepad', build: topdown },
  { id: 'physics', name: 'Physics toy', description: 'Crates and a ball that fall, stack and tumble. Drag them around.', icon: 'bodyPhysics', build: physicsToy },
  { id: 'pixel', name: 'Pixel art platformer', description: 'The platformer at 320×180, scaled up with crisp pixels.', icon: 'grid', build: (name) => pixelPlatformer(name) },
];

function pixelPlatformer(name) {
  // The platformer's pieces, a quarter the size, on a 320×180 screen.
  const files = platformer(name, { width: 320, height: 180, stretch: 'pixel', filter: 'pixel' });
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.scene')) continue;
    const data = JSON.parse(text);
    const shrink = (e) => {
      const props = e.properties || {};
      for (const k of ['x', 'y', 'width', 'height', 'radius', 'cornerRadius', 'size']) {
        if (typeof props[k] === 'number') props[k] = Math.round(props[k] / 4);
      }
      if (props.bottom) props.bottom = 180;
      if (props.size !== undefined) {
        props.font = 'pixel';
        props.size = 10;
      }
      (e.children || []).forEach(shrink);
    };
    shrink(data.root);
    files[path] = json(data);
  }
  files['scripts/player.lua'] = files['scripts/player.lua']
    .replace('Player.speed = 220', 'Player.speed = 70').replace('Player.acceleration = 2400', 'Player.acceleration = 700')
    .replace('Player.jumpHeight = 96', 'Player.jumpHeight = 28').replace('Player.gravity = 1800', 'Player.gravity = 600')
    .replace('Player.maxFallSpeed = 1000', 'Player.maxFallSpeed = 300');
  files['scripts/level.lua'] = files['scripts/level.lua'].replace('player.y > 900', 'player.y > 230');
  files['scripts/patrol.lua'] = files['scripts/patrol.lua'].replace('Patrol.speed = 80', 'Patrol.speed = 25').replace('Patrol.gravity = 1800', 'Patrol.gravity = 600');
  return files;
}
