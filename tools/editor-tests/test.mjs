// Tests for the editor's core (no browser needed):
//   node tools/editor-tests/test.mjs
//
// The piece schema, scene documents (reading, writing, undo, placed scenes),
// module detection, the templates, the ready-made scripts and script
// variables.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const editor = (p) => pathToFileURL(join(root, 'web', 'editor', p)).href;

const schemaLib = await import(editor('core/schema.js'));
schemaLib.setSchema(JSON.parse(readFileSync(join(root, 'love', 'src', 'modules', 'scene', 'pieces.json'), 'utf8')));
const { SceneDoc } = await import(editor('core/scene-doc.js'));
const { detectModules } = await import(editor('core/modules.js'));
const { TEMPLATES } = await import(editor('core/templates.js'));
const { scriptVariables, isOldStyleScript } = await import(editor('core/script-vars.js'));
const { SCRIPT_API_NAMES } = await import(editor('core/script-api.js'));
const { SCRIPT_LIBRARY } = await import(editor('core/script-library.js'));

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}
// Equal as JSON, ignoring the order of object keys.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// --- Schema -------------------------------------------------------------------
const types = schemaLib.getSchema().types;
for (const [name, def] of Object.entries(types)) {
  if (def.extends) check(`${name} extends a real type`, !!types[def.extends], def.extends);
  check(`${name} has a description`, typeof def.description === 'string' && def.description.length > 10);
  for (const [p, d] of Object.entries(def.properties || {})) {
    check(`${name}.${p} has a type`, typeof d.type === 'string');
    check(`${name}.${p} has a description`, d.hidden || (typeof d.description === 'string' && d.description.length > 3));
    if (d.type === 'enum') check(`${name}.${p} default is an option`, d.options.includes(d.default), String(d.default));
    if (d.when) for (const k of Object.keys(d.when)) check(`${name}.${p} "when" names a property`, !!schemaLib.propertyDef(name, k), k);
  }
}
// The catalogue matches the engine: every method is defined in a scene file,
// every event is emitted, every name of the short API is in script.lua.
const sceneDir = join(root, 'love', 'src', 'modules', 'scene');
const engineLua = readdirSync(sceneDir).filter((f) => f.endsWith('.lua'))
  .map((f) => readFileSync(join(sceneDir, f), 'utf8')).join('\n');
const LIFECYCLE = new Set(['ready', 'update', 'physicsUpdate', 'draw', 'removed', 'eachCharacter']);
for (const [name, def] of Object.entries(types)) {
  for (const m of Object.keys(def.methods || {})) {
    check(`${name}:${m}() is defined in the engine`, new RegExp(`function \\w+[:.]${m}\\(|\\b\\w+\\.${m}\\s*=\\s*\\w`).test(engineLua));
  }
  for (const e of Object.keys(def.events || {})) {
    if (!LIFECYCLE.has(e)) check(`${name} event ${e} is emitted`, engineLua.includes(`emit("${e}"`));
  }
}
// Every piece is in a group of the Add a piece dialog and has an icon, and no
// property hides a method the piece has (a property called "on" would hide
// on(), which is why Light, Occluder and Tint have "off").
{
  const { ICONS } = await import(editor('icons.js'));
  const groupIds = new Set(schemaLib.getSchema().groups.map((g) => g.id));
  for (const [name, def] of Object.entries(types)) {
    check(`${name} is in a group`, groupIds.has(def.group), String(def.group));
    check(`${name} has an icon`, typeof ICONS[def.icon] === 'string', String(def.icon));
    const methods = new Set(schemaLib.lineage(name).flatMap((t) => Object.keys(types[t].methods || {})));
    for (const p of schemaLib.lineage(name).flatMap((t) => Object.keys(types[t].properties || {}))) {
      check(`${name}.${p} doesn't hide a method`, !methods.has(p));
    }
  }
}
// Lights: the renderer reads every property the catalogue gives the pieces.
{
  const lightsLua = readFileSync(join(sceneDir, 'lights.lua'), 'utf8');
  for (const name of ['Light', 'Occluder', 'Tint']) {
    check(`${name} is a piece`, !!types[name] && types[name].group === 'light');
    for (const p of Object.keys(types[name]?.properties || {})) {
      check(`lights.lua reads ${name}.${p}`, new RegExp(`\\.${p}\\b`).test(lightsLua));
    }
  }
  check('every piece with a position has lit', schemaLib.propertyDef('Sprite', 'lit')?.default === true && /\.lit\b/.test(lightsLua));
  check('Tiles has castShadows', schemaLib.propertyDef('Tiles', 'castShadows')?.default === false && /\.castShadows\b/.test(lightsLua));
  check('a scene without lights never reaches lights.lua', /if M\._lights > 0 then return M\._renderLit\(root\) end/.test(
    readFileSync(join(sceneDir, 'nodes2d.lua'), 'utf8')));
}
// Levels: the renderers read every Background property, both of them move
// Backgrounds, and the terrain matcher is the same in Lua and JavaScript.
{
  const nodes2dLua = readFileSync(join(sceneDir, 'nodes2d.lua'), 'utf8');
  const lightsLua = readFileSync(join(sceneDir, 'lights.lua'), 'utf8');
  const tilemapLua = readFileSync(join(sceneDir, 'tilemap.lua'), 'utf8');
  const terrainLua = readFileSync(join(sceneDir, 'terrain.lua'), 'utf8');
  const terrainJs = readFileSync(join(root, 'web', 'editor', 'workspaces', 'scene', 'terrain.js'), 'utf8');
  check('Background is a piece', !!types.Background && types.Background.extends === 'Group' && types.Background.group === 'visual');
  for (const p of Object.keys(types.Background?.properties || {})) {
    check(`nodes2d.lua reads Background.${p}`, new RegExp(`\\.${p}\\b`).test(nodes2dLua));
  }
  check('a scene without a Background skips it', /if backgrounds > 0 and n\._bg then/.test(nodes2dLua));
  check('the lights renderer moves Backgrounds too', /backgroundPlace\(n, /.test(lightsLua) && /backgroundCopies\(n, /.test(lightsLua));
  check('Tiles has animate', schemaLib.propertyDef('Tiles', 'animate')?.default === true && /self\.animate\b/.test(tilemapLua));
  for (const m of ['setTerrain', 'getTerrain', 'fillTerrain', 'terrains']) check(`Tiles has ${m}()`, !!types.Tiles.methods[m]);
  // The numbers the two matchers must agree on.
  for (const n of ['374761', '668265', '12345', '1000003', '48271', '2147483647', '65536']) {
    check(`terrain.lua and terrain.js both use ${n}`, terrainLua.includes(n) && terrainJs.includes(n));
  }
  const terrainLib = await import(editor('workspaces/scene/terrain.js'));
  check('terrain.js: 47 blob masks', terrainLib.blobMasks().length === 47);
  check('terrain.js: three layouts', terrainLib.LAYOUTS.map((l) => l.id).join() === 'sides,corners,blob');
}
const scriptLua = readFileSync(join(sceneDir, 'script.lua'), 'utf8');
const { SCRIPT_API } = await import(editor('core/script-api.js'));
for (const [name] of SCRIPT_API) {
  check(`short API ${name} is in script.lua`, new RegExp(`\\b(?:api|pieceApi)\\.${name}\\b\\s*=|function (?:api|pieceApi)\\.${name}\\(`).test(scriptLua));
}
for (const m of scriptLua.matchAll(/^function api\.(\w+)\(|^api\.(\w+) =/gm)) {
  const name = m[1] || m[2];
  check(`script.lua's ${name} is in script-api.js`, SCRIPT_API.some(([n]) => n === name));
}

check('lineage', eq(schemaLib.lineage('Sprite'), ['Piece', 'Group', 'Sprite']));
check('isA', schemaLib.isA('Body', 'Group') && !schemaLib.isA('Label', 'Group'));
check('space', schemaLib.space('Label') === 'ui' && schemaLib.space('Body') === 'world' && schemaLib.space('Timer') === 'other');
check('moduleOfPiece', schemaLib.moduleOfPiece('Body', { motion: 'physics' }) === 'physics2d' && schemaLib.moduleOfPiece('Body', { motion: 'still' }) === 'physics2d'
  && schemaLib.moduleOfPiece('Zone') === 'physics2d' && schemaLib.moduleOf('Joint') === 'physics2d' && schemaLib.moduleOf('Hitbox') === null && schemaLib.moduleOf('Sprite') === null);
const godot = ['Node2D', 'Node3D', 'Sprite2D', 'CharacterBody2D', 'StaticBody2D', 'RigidBody2D', 'Area2D', 'CollisionShape2D', 'TileMap', 'Control'];
check('no Godot type names', !godot.some((t) => types[t]), godot.filter((t) => types[t]).join(','));

// --- Scene documents ------------------------------------------------------------
const files = new Map();
const ctx = { readScene: (p) => (files.has(p) ? JSON.parse(files.get(p)) : null) };
files.set('coin.scene', JSON.stringify({ format: 'smitten.scene', version: 2, root: { name: 'Coin', type: 'Zone', properties: { layer: 3 }, children: [{ name: 'Look', type: 'Shape' }] } }));
const levelText = JSON.stringify({
  format: 'smitten.scene', version: 2,
  root: { name: 'Level', type: 'Group', children: [
    { name: 'Player', type: 'Body', properties: { x: 10 }, script: 'player.lua', tags: ['player'] },
    { name: 'Coin', scene: 'coin.scene', properties: { x: 50 } },
  ] },
});
files.set('level.scene', levelText);
const doc = SceneDoc.fromText('level.scene', levelText, ctx);
check('round trip', eq(JSON.parse(doc.toText()), JSON.parse(levelText)), doc.toText());
const player = doc.root.children[0];
const coin = doc.root.children[1];
check('get: own value', doc.get(player, 'x') === 10);
check('get: default', doc.get(player, 'y') === 0 && doc.get(player, 'scaleX') === 1);
check('instance type', coin.type === 'Zone');
check('instance base value', doc.get(coin, 'layer') === 3 && doc.get(coin, 'x') === 50);
check('instance children', doc.effectiveChildren(coin).length === 1 && doc.effectiveChildren(coin)[0].readonly === true);

doc.setProp(player, 'x', 20);
doc.setProp(player, 'y', 0); // a default: stays out of the file
check('setProp', doc.get(player, 'x') === 20 && !('y' in player.props));
check('defaults left out', !JSON.parse(doc.toText()).root.children[0].properties.y);
doc.undo();
doc.undo();
check('undo', doc.get(player, 'x') === 10);
doc.redo();
doc.redo();
check('redo', doc.get(player, 'x') === 20);
doc.setProp(player, 'x', 21, { merge: 'drag' });
doc.setProp(player, 'x', 22, { merge: 'drag' });
doc.undo();
check('merged drags undo together', doc.get(player, 'x') === 20, String(doc.get(player, 'x')));

const sprite = doc.createNode('Sprite', { image: 'a.png' }, 'Player');
doc.add(player, sprite);
check('add', player.children.length === 1 && sprite.parent === player);
const dup = doc.createNode('Group', {}, 'Player');
doc.add(doc.root, dup);
check('unique sibling names', dup.name === 'Player2', dup.name);
doc.move(sprite, doc.root, 0);
check('move', doc.root.children[0] === sprite && player.children.length === 0);
doc.undo();
check('undo move', player.children[0] === sprite);
doc.remove([player]);
check('remove', !doc.root.children.includes(player));
doc.undo();
check('undo remove', doc.root.children.includes(player) && player.children[0] === sprite);
const copies = doc.duplicate([player]);
check('duplicate', copies.length === 1 && copies[0] !== player && copies[0].children.length === 1 && copies[0].id !== player.id);
doc.rename(player, 'Hero');
check('rename', player.name === 'Hero' && doc.pathOf(sprite) === 'Hero/Player');
doc.changeType(player, 'Zone');
check('changeType keeps shared properties', player.type === 'Zone' && doc.get(player, 'x') === 20);
doc.undo();
check('undo changeType', player.type === 'Body');
doc.setTags(player, ['player', 'hero']);
check('tags', eq(JSON.parse(doc.toText()).root.children.find((c) => c.name === 'Hero').tags, ['player', 'hero']));
check('wouldLoop', doc.wouldLoop('level.scene') && !doc.wouldLoop('coin.scene'));
let threw = false;
try { doc.add(doc.root, doc.createInstance('level.scene')); } catch { threw = true; }
check('a scene can\'t contain itself', threw);

// --- Templates and module detection ----------------------------------------------
for (const t of TEMPLATES) {
  const out = t.build('Test');
  const project = {
    files: out,
    paths: () => Object.keys(out).sort(),
    readText: (p) => out[p],
    readJSON: (p) => JSON.parse(out[p]),
    settings: () => JSON.parse(out['smitten.json']),
  };
  const settings = project.settings();
  check(`${t.id}: main scene exists`, !settings.main || !!out[settings.main], settings.main);
  for (const p of project.paths().filter((x) => x.endsWith('.scene'))) {
    let d;
    try {
      d = SceneDoc.fromText(p, out[p], { readScene: (q) => (out[q] ? JSON.parse(out[q]) : null) });
    } catch (e) {
      check(`${t.id}: ${p} parses`, false, e.message);
      continue;
    }
    d.walk((n) => {
      check(`${t.id}: ${p}: ${n.name} has a real type`, !!types[n.type], n.type);
      const script = d.scriptOf(n);
      const vars = new Set(script && out[script] ? scriptVariables(out[script]).map((v) => v.name) : []);
      for (const k of Object.keys(n.props)) check(`${t.id}: ${p}: ${n.name}.${k} is a property or script variable`, !!schemaLib.propertyDef(n.type, k) || vars.has(k), `${n.type}.${k}`);
      if (n.instance) check(`${t.id}: ${p}: ${n.name} instance exists`, !!out[n.instance], n.instance);
      if (n.script) check(`${t.id}: ${p}: ${n.name} script exists`, !!out[n.script], n.script);
    });
  }
  const mods = detectModules(project);
  const incl = Object.values(mods).filter((m) => m.included).map((m) => m.id).sort();
  const expected = { empty: [] }[t.id] || ['physics2d'];
  check(`${t.id}: modules`, eq(incl, expected), incl.join(','));
}
const overrides = { paths: () => [], readText: () => '', readJSON: () => null, settings: () => ({ modules: { video: 'always', physics2d: 'never' } }) };
const om = detectModules(overrides);
check('module overrides', om.video.included && !om.physics2d.included && om.video.override === 'always');
const code = { paths: () => ['scripts/a.lua'], readText: () => 'smitten.synth.sfx("a.sfx"):play()\nlove.physics.newWorld(0, 9.81)', readJSON: () => null, settings: () => ({}) };
const cm = detectModules(code);
check('modules from code', !cm.physics2d.included && cm.synth.included && !cm.video.included && !('lovephysics' in cm));
const queries = { paths: () => ['scripts/a.lua'], readText: () => 'local hit = smitten.physics.raycast(0, 0, 10, 0)', readJSON: () => null, settings: () => ({}) };
check('scene physics from a query', detectModules(queries).physics2d.included);
const spawns = { paths: () => ['scripts/a.lua'], readText: () => 'local b = spawn("Body", {})', readJSON: () => null, settings: () => ({}) };
check('scene physics from spawn', detectModules(spawns).physics2d.included);

// --- Ready-made scripts ------------------------------------------------------------
for (const sc of SCRIPT_LIBRARY) {
  check(`${sc.id}: suits real pieces`, sc.suits.every((t) => types[t]), sc.suits.join(','));
  check(`${sc.id}: is the piece's own code`, !isOldStyleScript(sc.source) && !/\bself\./.test(sc.source));
  // Every bare call is the script's own function, a piece method, the short API or Lua's.
  const own = new Set([...sc.source.matchAll(/function (\w+)\(/g)].map((m) => m[1]));
  for (const m of sc.source.matchAll(/(^|[^.:\w])([a-z]\w*)\(/g)) {
    const name = m[2];
    if (['function', 'if', 'return', 'and', 'or', 'not', 'print', 'tostring', 'tonumber', 'pairs', 'ipairs', 'type', 'select', 'unpack'].includes(name)) continue;
    const known = own.has(name) || SCRIPT_API_NAMES.has(name) || Object.values(types).some((d) => d.methods && d.methods[name]);
    check(`${sc.id}: ${name}() exists`, known);
  }
  check(`${sc.id}: has script variables`, scriptVariables(sc.source).length > 0 || sc.id === 'drag');
  for (const m of sc.source.matchAll(/self:(\w+)\(/g)) {
    const known = Object.values(types).some((d) => d.methods && d.methods[m[1]]) || new RegExp(`function \\w+:${m[1]}\\(`).test(sc.source);
    check(`${sc.id}: self:${m[1]}() exists`, known);
  }
}

// --- Script variables ----------------------------------------------------------------
const vars = scriptVariables(`local Player = {}

Player.speed = 140   -- how fast it runs
Player.name = "Hero"
Player.alive = true
Player.tint = {1, 0.5, 0}
Player._hidden = 3
local function helper() end
function Player:update(dt) end
return Player
`);
check('script variables', eq(vars.map((v) => [v.name, v.type]), [['speed', 'number'], ['name', 'string'], ['alive', 'bool'], ['tint', 'color']]), JSON.stringify(vars));
check('script variable comment', vars[0].description === 'how fast it runs');
const newVars = scriptVariables(`-- a script that is the piece
speed = 140   -- how fast it runs
name = "Hero"
alive = true
tint = {1, 0.5, 0}
_hidden = 3
local secret = 4
function update(dt)
  speed = 5
end
`);
check('script variables (a script that is the piece)', eq(newVars.map((v) => [v.name, v.type]), [['speed', 'number'], ['name', 'string'], ['alive', 'bool'], ['tint', 'color']]), JSON.stringify(newVars));
check('script variable comment (new style)', newVars[0].description === 'how fast it runs' && newVars[0].value === 140);
check('script variable color alpha', eq(vars[3].value, [1, 0.5, 0, 1]));

// --- The project: renaming and saving -------------------------------------------------
const { Project } = await import(editor('core/project.js'));
const { uniqueName, shareId } = await import(editor('share.js'));
const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
// Stands in for fs-store.js: writeFiles fails `fail` times, then works.
const fakeStore = () => {
  const st = {
    disk: {}, fail: 0,
    async writeFiles(id, files) {
      if (st.fail > 0) { st.fail--; throw new Error('disk full'); }
      Object.assign(st.disk, files);
    },
    async deleteEntry(id, path) { for (const k of Object.keys(st.disk)) if (k === path || k.startsWith(`${path}/`)) delete st.disk[k]; },
    async renameEntry(id, from, to) {
      for (const k of Object.keys(st.disk)) {
        if (k !== from && !k.startsWith(`${from}/`)) continue;
        st.disk[to + k.slice(from.length)] = st.disk[k];
        delete st.disk[k];
      }
    },
    async createDir() {},
    async updateProject() {},
  };
  return st;
};
const newProject = (files, dirs, st = fakeStore()) => new Project({ id: 'p', name: 'Test' }, files, dirs, st);
{
  const pr = newProject({ 'a.lua': 'A', 'b.lua': 'B', 'art/x.png': 'X', 'old/y.png': 'Y', 'old/deep/z.png': 'Z' }, ['art', 'old', 'old/deep', 'empty']);
  const events = [];
  pr.addEventListener('file', (e) => events.push(e.detail));
  check('rename onto a file is refused', /already a file called "b\.lua"/.test(throws(() => pr.rename('a.lua', 'b.lua'))));
  check('rename onto a file keeps both', pr.read('a.lua') === 'A' && pr.read('b.lua') === 'B' && events.length === 0);
  check('move onto a file in a folder is refused', throws(() => pr.rename('a.lua', 'art/x.png')) !== '' && pr.read('art/x.png') === 'X');
  check('folder onto a folder is refused', /already a folder called "art"/.test(throws(() => pr.rename('old', 'art'))));
  check('folder onto a folder keeps both', pr.read('art/x.png') === 'X' && pr.read('old/y.png') === 'Y' && pr.dirs.has('old'));
  check('folder onto an empty folder is refused', throws(() => pr.rename('old', 'empty')) !== '');
  check('file onto a folder is refused', throws(() => pr.rename('a.lua', 'art')) !== '' && pr.has('a.lua'));
  check('folder onto a file is refused', throws(() => pr.rename('old', 'a.lua')) !== '' && pr.read('a.lua') === 'A');
  check('a folder into itself is refused', throws(() => pr.rename('old', 'old/deep/old')) !== '' && pr.has('old/y.png'));
  check('rename to the same name does nothing', throws(() => pr.rename('a.lua', 'a.lua')) === '' && events.length === 0);
  pr.rename('a.lua', 'c.lua');
  check('rename a file', !pr.has('a.lua') && pr.read('c.lua') === 'A' && eq(events, [{ path: 'c.lua', from: 'a.lua', kind: 'rename' }]));
  pr.rename('c.lua', 'art/c.lua');
  check('move a file into a folder', pr.read('art/c.lua') === 'A' && !pr.has('c.lua'));
  pr.rename('old', 'new');
  check('rename a folder', pr.read('new/y.png') === 'Y' && pr.read('new/deep/z.png') === 'Z' && !pr.has('old/y.png')
    && pr.dirs.has('new') && pr.dirs.has('new/deep') && !pr.dirs.has('old'));
  clearTimeout(pr.timer);
}
{
  // Timers by hand, so the retry can be run without waiting for it.
  const real = [globalThis.setTimeout, globalThis.clearTimeout, console.error];
  const timers = new Map();
  let nextTimer = 1;
  globalThis.setTimeout = (fn, ms) => { timers.set(nextTimer, { fn, ms }); return nextTimer++; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  console.error = () => {};
  try {
    const st = fakeStore();
    const pr = newProject({}, [], st);
    const saves = [];
    pr.addEventListener('save', (e) => saves.push(e.detail.ok));
    pr.write('a.lua', '1');
    pr.write('b.lua', 'b1');
    st.fail = 1;
    await pr.flush();
    check('a failed save is flagged', pr.saveFailed === true && eq(saves, [false]));
    check('a failed save writes nothing', eq(st.disk, {}));
    check('a failed save is queued again', pr.pending.get('a.lua') === '1' && pr.pending.get('b.lua') === 'b1');
    check('a failed save is retried in a few seconds', timers.get(pr.retryTimer)?.ms === 2000);
    pr.write('a.lua', '2');
    timers.get(pr.retryTimer).fn();
    await pr.saving;
    check('the retry saves, and the newer text wins', eq(st.disk, { 'a.lua': '2', 'b.lua': 'b1' }));
    check('the failed flag clears after a save that works', pr.saveFailed === false && pr.retryDelay === 0 && eq(saves, [false, true]) && pr.pending.size === 0);

    // A change made while the failing save is still on its way.
    pr.write('a.lua', '3');
    st.fail = 1;
    const going = pr.flush();
    pr.write('a.lua', '4');
    pr.write('b.lua', 'b2');
    await going;
    check('a failed save does not replace newer changes', pr.pending.get('a.lua') === '4' && pr.pending.get('b.lua') === 'b2');
    await pr.flush();
    check('newer changes are saved', eq(st.disk, { 'a.lua': '4', 'b.lua': 'b2' }) && !pr.saveFailed);

    // A file deleted, or renamed, while its save is failing.
    pr.write('gone.lua', 'x');
    pr.write('was.lua', 'w');
    st.fail = 1;
    const failing = pr.flush();
    pr.remove('gone.lua');
    await failing;
    check('a deleted file is not queued again', !pr.pending.has('gone.lua') && pr.pending.get('was.lua') === 'w');
    pr.rename('was.lua', 'now.lua');
    check('a waiting change follows a rename', !pr.pending.has('was.lua') && pr.pending.get('now.lua') === 'w');
    await pr.flush();
    check('saved under the new name only', st.disk['now.lua'] === 'w' && !('was.lua' in st.disk) && !('gone.lua' in st.disk));

    // Retries slow down, up to half a minute apart.
    pr.write('a.lua', '5');
    st.fail = 8;
    const delays = [];
    for (let i = 0; i < 7; i++) {
      await pr.flush();
      delays.push(pr.retryDelay);
    }
    check('retries back off to 30 s', eq(delays, [2000, 4000, 8000, 16000, 30000, 30000, 30000]), JSON.stringify(delays));
    st.fail = 0;
    await pr.flush();
    check('saved in the end', st.disk['a.lua'] === '5' && !pr.saveFailed && !timers.has(pr.retryTimer));
  } finally {
    [globalThis.setTimeout, globalThis.clearTimeout, console.error] = real;
  }
}

// --- Share links: names and fingerprints ----------------------------------------------
check('a free name is kept', uniqueName('Pong', ['Snake', 'Pong 2']) === 'Pong');
check('a taken name gets (2)', uniqueName('Pong', ['Pong']) === 'Pong (2)');
check('...then (3)', uniqueName('Pong', ['Pong', 'Pong (2)']) === 'Pong (3)');
check('the first free number is used', uniqueName('Pong', ['Pong', 'Pong (3)']) === 'Pong (2)');
check('no names yet', uniqueName('Pong', []) === 'Pong');
check('the same share link has the same id', shareId('abc-DEF_123') === shareId('abc-DEF_123'));
check('different share links have different ids', new Set(['', 'a', 'b', 'ab', 'ba', 'abc-DEF_123', 'abc-DEF_124'].map(shareId)).size === 7);

// --- Rich text in the scene view (core/richtext.js) ------------------------------------
{
  const { parseRich, stripRich, layoutRich, parseColor, RICH_TAGS, RICH_EFFECTS } = await import(editor('core/richtext.js'));
  // The same tags as the engine (love/src/modules/text/init.lua).
  const textLua = readFileSync(join(root, 'love', 'src', 'modules', 'text', 'init.lua'), 'utf8');
  const engineTags = [...textLua.match(/local TAGS = \{([\s\S]*?)\n\}/)[1].matchAll(/(\w+) = true/g)].map((m) => m[1]).sort();
  check('the scene view knows the engine\'s tags', JSON.stringify(engineTags) === JSON.stringify([...RICH_TAGS].sort()), engineTags.join(' '));
  for (const fx of RICH_EFFECTS) check(`the engine has the effect ${fx}`, textLua.includes(`effects.${fx} = function`));
  const engineColors = [...textLua.match(/local COLORS = \{([\s\S]*?)\n\}/)[1].matchAll(/(\w+) = \{/g)].map((m) => m[1]);
  check('and its color names', engineColors.length > 10 && engineColors.every((c) => parseColor(c)), engineColors.filter((c) => !parseColor(c)).join(' '));
  check('rich off keeps the text', parseRich('[b]x[/b]', false)[0].text === '[b]x[/b]');
  const spans = parseRich('a [b]bold[/b] [color=#ff0000]r[/color][size=+4]s[/size]');
  check('bold span', spans[1].text === 'bold' && spans[1].style.bold === true);
  check('color span', spans[3].text === 'r' && spans[3].style.color[0] === 1 && spans[3].style.color[1] === 0);
  check('relative size', spans[4].style.sizeAdd === 4);
  check('strip', stripRich('[b]Hi[/b] [wave amp=2]you[/wave][pause=1]!') === 'Hi you!');
  check('unknown tags are shown', stripRich('press [E] or [color=nope]x') === 'press [E] or [color=nope]x');
  check('a custom effect that closes is a tag', stripRich('[bounce h=2]x[/bounce]') === 'x');
  check('[[ is a bracket', stripRich('[[b]') === '[b]');
  check('an unclosed tag runs to the end', parseRich('[i]all')[0].style.italic === true);
  check('tags closed out of order', (() => { const s = parseRich('[b][i]x[/b]y'); return s[0].style.bold && s[1].style.italic && !s[1].style.bold; })());
  const metrics = (st) => { const size = st.size ?? 10 + (st.sizeAdd || 0); return { size, height: size, spacing: size, base: size * 0.8 }; };
  const width = (m, t) => t.length * m.size / 2;
  let l = layoutRich(parseRich('aaa bbb [size=20]ccc[/size] ddd\n[right]e'), metrics, width, { limit: 50 });
  check('rich lines wrap', l.count === 3 && l.lines[0].width === 35 && l.lines[1].frags[0].text === 'ccc');
  check('the tallest text sets the line', l.lines[1].height === 20 && l.lines[2].y === 30 && l.height === 40);
  check('[right] moves its line', l.lines[2].x === 45);
  l = layoutRich(parseRich('ab\nabcd', false), metrics, width, { align: 'center' });
  check('lines center on the widest', l.lines[0].x === 5 && l.lines[1].x === 0 && l.width === 20);
  l = layoutRich(parseRich('aaaaaaaaaaaa', false), metrics, width, { limit: 20 });
  check('a long word is cut', l.count === 3);
  l = layoutRich(parseRich('aa bb cc', false), metrics, width, { limit: 20, by: 'none' });
  check('wrapBy none', l.count === 1);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
