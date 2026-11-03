// New-project templates. Each builds a project's files. None needs art:
// they use Shape2D and MeshInstance3D, so a game can start right away and get
// art later.

const json = (v) => JSON.stringify(v, null, 2) + '\n';

const scene = (root) => json({ format: 'smitten.scene', version: 2, root });
const settings = (name, main, display = {}) => json({
  format: 'smitten.project', version: 2, name, main,
  display: { width: 1280, height: 720, stretch: 'fit', filter: 'smooth', ...display },
});

const n = (name, type, properties, children, extra = {}) => ({
  name, type, ...(properties && Object.keys(properties).length ? { properties } : {}), ...extra,
  ...(children && children.length ? { children } : {}),
});
const box2d = (w, hh) => n('Shape', 'CollisionShape2D', { width: w, height: hh });
const look2d = (w, hh, color, extra = {}) => n('Look', 'Shape2D', { width: w, height: hh, color, ...extra });

// ---------------------------------------------------------------------------

function empty2d(name) {
  return {
    'smitten.json': settings(name, 'scenes/main.scene'),
    'scenes/main.scene': scene(n('Main', 'Node2D', null, [
      n('Camera', 'Camera2D', { x: 640, y: 360 }),
      n('Hello', 'Text2D', { x: 640, y: 360, text: 'Hello! Add nodes with the + in the Scene panel.', size: 28 }),
    ])),
  };
}

function empty3d(name) {
  return {
    'smitten.json': settings(name, 'scenes/main.scene'),
    'scenes/main.scene': scene(n('Main', 'Node3D', null, [
      n('Environment', 'Environment3D'),
      n('Sun', 'DirectionalLight3D', { rotationX: -0.9, rotationY: 0.5 }),
      n('Camera', 'Camera3D', { y: 2, z: 6, rotationX: -0.25 }),
      n('Ground', 'MeshInstance3D', { mesh: 'plane', width: 20, depth: 20, color: [0.45, 0.6, 0.42, 1] }),
      n('Cube', 'MeshInstance3D', { y: 0.5, color: [0.35, 0.55, 0.95, 1] }, [n('Spin', 'Spin', { speed: 0.8 })]),
    ])),
  };
}

function platformer(name) {
  const platform = (pname, x, y, w) => n(pname, 'StaticBody2D', { x, y }, [box2d(w, 32), look2d(w, 32, [0.3, 0.33, 0.4, 1], { cornerRadius: 4 })]);
  const coins = [];
  [[420, 480], [470, 480], [520, 480], [820, 360], [870, 360], [1180, 260], [1500, 420]].forEach(([x, y], i) => {
    coins.push({ name: `Coin${i + 1}`, scene: 'scenes/coin.scene', properties: { x, y } });
  });
  return {
    'smitten.json': settings(name, 'scenes/level.scene'),
    'scenes/player.scene': scene(n('Player', 'CharacterBody2D', null, [
      box2d(28, 44),
      look2d(28, 44, [0.36, 0.55, 0.95, 1], { cornerRadius: 6 }),
      n('Eye', 'Shape2D', { shape: 'circle', radius: 4, x: 6, y: -10, color: [1, 1, 1, 1] }),
      n('Controls', 'Platformer'),
      n('Camera', 'Camera2D', { smoothing: 6, limitLeft: 0, limitBottom: 720 }),
    ], { script: 'scripts/player.lua', groups: ['player'] })),
    'scenes/coin.scene': scene(n('Coin', 'Area2D', null, [
      n('Shape', 'CollisionShape2D', { shape: 'circle', radius: 12 }),
      n('Look', 'Shape2D', { shape: 'circle', radius: 12, color: [1, 0.8, 0.25, 1] }),
    ], { groups: ['coins'] })),
    'scenes/level.scene': scene(n('Level', 'Node2D', null, [
      platform('Ground', 900, 620, 1800),
      platform('Step', 450, 520, 260),
      platform('Ledge', 850, 400, 220),
      platform('High', 1180, 300, 200),
      platform('Far', 1500, 460, 260),
      { name: 'Player', scene: 'scenes/player.scene', properties: { x: 120, y: 540 } },
      n('Coins', 'Node2D', null, coins),
      n('UI', 'Node', null, [
        n('Score', 'Label', { x: 24, y: 18, width: 400, text: 'Coins: 0', size: 24, outline: true }),
        n('Help', 'Label', { anchor: 'bottomLeft', x: 24, y: 18, width: 700, text: 'Arrows or WASD to move, space to jump', color: [1, 1, 1, 0.7] }),
      ]),
    ], { script: 'scripts/level.lua' })),
    'scripts/player.lua': `-- The player: the Platformer behavior moves it; this script collects coins.
local Player = {}

Player.coinSound = ""   -- a sound file to play when collecting a coin (optional)

function Player:ready()
  self.coins = 0
end

-- Called when the player starts touching an Area2D.
function Player:entered(area)
  if area:inGroup("coins") then
    self.coins += 1
    area:destroy()
    smitten.scene.current:emit("coinCollected", self.coins)
  end
end

function Player:update(dt)
  -- Fell off the level? Start again.
  if self.y > 900 then
    smitten.scene.reload()
  end
end

return Player
`,
    'scripts/level.lua': `-- The level: keeps the score label up to date.
local Level = {}

function Level:ready()
  self.total = #smitten.scene.group("coins")
end

function Level:coinCollected(count)
  self:find("UI/Score").text = \`Coins: {count} / {self.total}\`
  if count == self.total then
    self:find("UI/Help").text = "You got them all!"
  end
end

return Level
`,
  };
}

function topdown(name) {
  const wall = (wname, x, y, w, hh) => n(wname, 'StaticBody2D', { x, y }, [box2d(w, hh), look2d(w, hh, [0.28, 0.3, 0.36, 1])]);
  return {
    'smitten.json': settings(name, 'scenes/arena.scene'),
    'scenes/enemy.scene': scene(n('Enemy', 'CharacterBody2D', null, [
      box2d(30, 30),
      look2d(30, 30, [0.92, 0.36, 0.4, 1], { cornerRadius: 15 }),
      n('Chase', 'Follow', { speed: 90 }),
    ], { groups: ['enemies'] })),
    'scenes/arena.scene': scene(n('Arena', 'Node2D', null, [
      wall('Top', 640, 20, 1240, 40), wall('Bottom', 640, 700, 1240, 40),
      wall('Left', 20, 360, 40, 720), wall('Right', 1260, 360, 40, 720),
      wall('Block', 640, 360, 160, 160),
      n('Player', 'CharacterBody2D', { x: 200, y: 360 }, [
        box2d(32, 32), look2d(32, 32, [0.36, 0.75, 0.55, 1], { cornerRadius: 8 }), n('Controls', 'TopDown', { speed: 240 }),
      ], { groups: ['player'], script: 'scripts/player.lua' }),
      { name: 'Enemy1', scene: 'scenes/enemy.scene', properties: { x: 1100, y: 140 } },
      { name: 'Enemy2', scene: 'scenes/enemy.scene', properties: { x: 1100, y: 580 } },
      n('UI', 'Node', null, [n('Time', 'Label', { x: 60, y: 54, width: 400, text: 'Survive!', size: 24, outline: true })]),
    ])),
    'scripts/player.lua': `-- The player survives as long as possible; enemies chase it (the Follow behavior).
local Player = {}

function Player:ready()
  self.time = 0
end

function Player:update(dt)
  self.time += dt
  smitten.scene.find("UI/Time").text = \`Survived {math.floor(self.time)} s\`
end

-- Called when the player bumps into another body.
function Player:collided(other)
  if other:inGroup("enemies") then
    smitten.scene.reload()
  end
end

return Player
`,
  };
}

function walker3d(name) {
  const crates = [];
  for (let i = 0; i < 6; i++) {
    crates.push(n(`Crate${i + 1}`, 'RigidBody3D', { x: -2 + (i % 3) * 1.05, y: 0.5 + Math.floor(i / 3) * 1.05, z: -4 }, [
      n('Shape', 'CollisionShape3D'),
      n('Mesh', 'MeshInstance3D', { color: [0.78, 0.55, 0.32, 1] }),
    ]));
  }
  return {
    'smitten.json': settings(name, 'scenes/world.scene'),
    'scenes/world.scene': scene(n('World', 'Node3D', null, [
      n('Environment', 'Environment3D', { fog: true, fogStart: 25, fogEnd: 90 }),
      n('Sun', 'DirectionalLight3D', { rotationX: -0.9, rotationY: 0.6 }),
      n('Ground', 'StaticBody3D', null, [
        n('Shape', 'CollisionShape3D', { width: 60, height: 1, depth: 60, y: -0.5 }),
        n('Mesh', 'MeshInstance3D', { width: 60, height: 1, depth: 60, y: -0.5, color: [0.42, 0.58, 0.4, 1] }),
      ]),
      n('Ramp', 'StaticBody3D', { x: 4, y: 0.6, z: -3, rotationX: 0.25 }, [
        n('Shape', 'CollisionShape3D', { width: 2, height: 0.2, depth: 5 }),
        n('Mesh', 'MeshInstance3D', { width: 2, height: 0.2, depth: 5, color: [0.6, 0.6, 0.65, 1] }),
      ]),
      n('Player', 'CharacterBody3D', { y: 1, z: 4 }, [
        n('Shape', 'CollisionShape3D', { shape: 'capsule', radius: 0.4, height: 1.8 }),
        n('Camera', 'Camera3D', { y: 0.65 }),
        n('Controls', 'FirstPerson'),
      ], { groups: ['player'] }),
      ...crates,
      n('UI', 'Node', null, [n('Help', 'Label', { anchor: 'bottomLeft', x: 20, y: 16, width: 720, text: 'Click to look around with the mouse · WASD to walk · space to jump · Esc frees the mouse', outline: true })]),
    ])),
  };
}

function pixel(name) {
  return {
    'smitten.json': settings(name, 'scenes/main.scene', { width: 320, height: 180, stretch: 'pixel', filter: 'pixel' }),
    'scenes/main.scene': scene(n('Main', 'Node2D', null, [
      n('Ground', 'StaticBody2D', { x: 160, y: 172 }, [box2d(320, 16), look2d(320, 16, [0.2, 0.17, 0.3, 1])]),
      n('Player', 'CharacterBody2D', { x: 60, y: 140 }, [
        box2d(10, 14), look2d(10, 14, [1, 0.8, 0.45, 1]), n('Controls', 'Platformer', { speed: 90, jumpHeight: 40, gravity: 700, acceleration: 900 }),
      ]),
      n('Title', 'Label', { anchor: 'top', y: 8, width: 200, height: 16, text: 'PIXEL ART', font: 'pixel', size: 10, align: 'center' }),
    ])),
  };
}

function codeOnly(name) {
  return {
    'smitten.json': json({ format: 'smitten.project', version: 2, name }),
    'main.lua': `-- A game written in code only, the way LÖVE games are.
-- smitten and love are the same thing: love.update works too.

local x, y = 400, 300

function smitten.update(dt)
  local dx, dy = smitten.input.vector("left", "right", "up", "down")
  x += dx * 300 * dt
  y += dy * 300 * dt
end

function smitten.draw()
  smitten.graphics.setColor(0.36, 0.55, 0.95)
  smitten.graphics.circle("fill", x, y, 24)
  smitten.graphics.setColor(1, 1, 1)
  smitten.graphics.print("Arrows or WASD to move", 16, 16)
end
`,
  };
}

export const TEMPLATES = [
  { id: 'empty2d', name: 'Empty 2D', description: 'A 2D scene with a camera, ready for your nodes.', icon: 'square', build: empty2d },
  { id: 'empty3d', name: 'Empty 3D', description: 'A 3D scene with light, sky, a camera and a cube.', icon: 'box', build: empty3d },
  { id: 'platformer', name: 'Platformer', description: 'Run and jump between platforms collecting coins. Shows scenes inside scenes.', icon: 'gamepad', build: platformer },
  { id: 'topdown', name: 'Top-down', description: 'Move in any direction and dodge enemies that chase you.', icon: 'gamepad', build: topdown },
  { id: 'walker3d', name: '3D walk-around', description: 'Walk and jump in first person, and knock over physics crates.', icon: 'box', build: walker3d },
  { id: 'pixel', name: 'Pixel art', description: 'A 320×180 game scaled up with crisp pixels.', icon: 'grid', build: pixel },
  { id: 'code', name: 'Code only', description: 'No scenes: a main.lua with update and draw, like LÖVE.', icon: 'code', build: codeOnly },
];
