// Project templates: the built-in blank project plus the examples listed in
// examples/index.json (plain folders of files next to the editor).

import { classifyBytes } from './file-types.js';
import { manifestText } from './project.js';

export const BLANK = {
  id: 'blank',
  name: 'Blank',
  description: 'A small Smitten game: a square you move with the arrow keys or a gamepad, at 320×180 pixels.',
  files: {
    'main.lua': `-- A new Smitten game. Press F5 to run it.
--
-- Make art with New › Sprite in the file panel, then drag the file into
-- this code to load it. smitten.json sets the game's size and palette.

function love.load()
  -- Draw at the size in smitten.json (320×180), scaled up to fill the window.
  smitten.screen.setup()

  -- Name the actions the game uses; each works with several keys and buttons.
  smitten.input.bind("left", { "left", "a", "pad:dpleft", "axis:leftx-" })
  smitten.input.bind("right", { "right", "d", "pad:dpright", "axis:leftx+" })
  smitten.input.bind("up", { "up", "w", "pad:dpup", "axis:lefty-" })
  smitten.input.bind("down", { "down", "s", "pad:dpdown", "axis:lefty+" })

  player = { x = 152, y = 82, size = 16, speed = 90 }
end

function love.update(dt)
  local step = player.speed * dt
  if smitten.input.down("left") then player.x -= step end
  if smitten.input.down("right") then player.x += step end
  if smitten.input.down("up") then player.y -= step end
  if smitten.input.down("down") then player.y += step end
end

function love.draw()
  smitten.screen.begin()
  love.graphics.clear(0.1, 0.11, 0.17)
  love.graphics.setColor(0.94, 0.49, 0.34)
  love.graphics.rectangle("fill", math.floor(player.x), math.floor(player.y), player.size, player.size)
  love.graphics.setColor(1, 1, 1)
  love.graphics.print(\`Smitten {smitten.version}\`, 4, 4)
  smitten.screen.finish()
end

function love.keypressed(key)
  if key == "escape" then
    love.event.quit()
  end
end
`,
    'conf.lua': `function love.conf(t)
  t.identity = "my-game"       -- save folder name
  t.window.title = "My Game"
  t.window.width = 960         -- 3 × the game's 320×180
  t.window.height = 540
  t.window.resizable = true
end
`,
    'smitten.json': manifestText(),
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
