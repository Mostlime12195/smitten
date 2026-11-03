// Project templates: the built-in blank project plus the examples listed in
// examples/index.json (plain folders of files next to the editor).

import { classifyBytes } from './file-types.js';
import { manifestText } from './project.js';

export const BLANK = {
  id: 'blank',
  name: 'Blank',
  description: 'A small game to start from: a player that runs and jumps on a few platforms, in a scene at 320×180 pixels.',
  files: {
    'main.lua': `function love.load() smitten.start() end
`,
    'conf.lua': `function love.conf(t)
  t.identity = "my-game"       -- save folder name
  t.window.title = "My Game"
  t.window.width = 960         -- 3 × the game's 320×180
  t.window.height = 540
  t.window.resizable = true
end
`,
    'objects/player.lua': `-- The player: it runs and jumps with the platformer behavior
-- (arrow keys or A/D to run, Space or Z to jump).
--
-- Draw it with New › Sprite, saved as sprites/player.png. Until then it's
-- a box in palette color 4.

return smitten.object {
  sprite = "sprites/player",
  behaviors = { "platformer" },
  camera = true,
  color = 4,
}
`,
    'objects/ground.lua': `-- Solid ground and platforms. Each one is as big as the box placed in
-- the scene; nothing can move through it.

return smitten.object {
  solid = true,
  color = 8,
}
`,
    'scenes/level1.lua': `-- The scene's script. Its objects (the player and the ground) are placed
-- in level1.scene.json; open it to add more.

local Level = {}

function Level:draw() -- on top of the scene, in screen pixels
  smitten.print("Arrows to run, Space to jump", 4, 4, 13)
end

return Level
`,
    'scenes/level1.scene.json': `${JSON.stringify({
      format: 'smitten.scene',
      version: 1,
      width: 20,
      height: 12,
      tileWidth: 16,
      tileHeight: 16,
      tilesets: [],
      layers: [
        { name: 'ground', type: 'tiles', visible: true, data: new Array(20 * 12).fill(-1) },
        {
          name: 'objects',
          type: 'objects',
          visible: true,
          objects: [
            { id: 1, type: 'player', x: 40, y: 144, properties: {} },
            { id: 2, type: 'ground', x: 0, y: 160, width: 320, height: 32, properties: {} },
            { id: 3, type: 'ground', x: 112, y: 120, width: 64, height: 8, properties: {} },
            { id: 4, type: 'ground', x: 208, y: 88, width: 64, height: 8, properties: {} },
          ],
        },
      ],
      properties: {},
    }, null, 2)}\n`,
    // smitten.json with the scene to start with.
    'smitten.json': manifestText({ ...JSON.parse(manifestText()), start: 'level1' }),
  },
};

let examplesPromise = null;

export function loadExampleIndex() {
  if (!examplesPromise) {
    examplesPromise = fetch('examples/index.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return examplesPromise;
}

/** Fetch an example's files: {path: string | Uint8Array}. */
export async function loadTemplateFiles(template) {
  if (template.id === 'blank') return { ...BLANK.files };
  const files = {};
  await Promise.all(template.files.map(async (path) => {
    const url = `examples/${encodeURIComponent(template.id)}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    files[path] = classifyBytes(path, new Uint8Array(await res.arrayBuffer()));
  }));
  return files;
}
