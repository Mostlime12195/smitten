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
    // Sent by name, or under the name the project's rules give it (engine/compat.lua).
    if (!LIFECYCLE.has(e)) check(`${name} event ${e} is emitted`, engineLua.includes(`emit("${e}"`) || engineLua.includes(`.event("${e}")`));
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
files.set('coin.scene', JSON.stringify({ format: 'smitten.scene', version: 3, root: { name: 'Coin', type: 'Zone', properties: { layer: 3 }, children: [{ name: 'Look', type: 'Shape' }] } }));
const levelText = JSON.stringify({
  format: 'smitten.scene', version: 3,
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

// --- Older projects: the rules of before version 3, and updating ---------------
{
  const up = await import(editor('core/update-project.js'));
  const { libraryScript } = await import(editor('core/templates.js'));
  const schema = schemaLib.getSchema();
  const scene = (root, version = 2) => JSON.stringify({ format: 'smitten.scene', version, root });

  // Degrees from radians: round numbers stay round.
  check('toDegrees: 1.5708 is 90', up.toDegrees(1.5708) === 90);
  check('toDegrees: pi is 180', up.toDegrees(Math.PI) === 180);
  check('toDegrees: 0.7854 is 45', up.toDegrees(0.7854) === 45 && up.toDegrees(-0.7854) === -45);
  check('toDegrees: 0.42 keeps its fraction', up.toDegrees(0.42) === 24.064227, String(up.toDegrees(0.42)));
  check('toDegrees: 0 is 0', up.toDegrees(0) === 0);
  check('isOldProject', up.isOldProject({ version: 2 }) && up.isOldProject({}) && !up.isOldProject({ version: 3 }) && !up.isOldProject({ version: 4 }));

  // A scene: angles, gravity, defaults that changed.
  const oldRoot = () => ({ name: 'R', type: 'Group', properties: { rotation: 1.5708, x: 4 }, children: [
    { name: 'Crate', type: 'Body', properties: { motion: 'physics', gravity: 0.5, spin: 3.14159265, slope: 1 } },
    { name: 'Hero', type: 'Body', script: 'scripts/p.lua', properties: { gravity: 1800 } },
    { name: 'Dust', type: 'Particles' },
    { name: 'Smoke', type: 'Particles', properties: { direction: 0.7854, spread: 0.2 } },
    { name: 'Hinge', type: 'Joint', properties: { motor: true, minAngle: -0.5 } },
    { name: 'Fast', type: 'Joint', properties: { kind: 'wheel', motorSpeed: 3.14159265 } },
    { name: 'Rail', type: 'Joint', properties: { kind: 'slider', motorSpeed: 30 } },
    { name: 'Rod', type: 'Joint', properties: { kind: 'distance' } },
    { name: 'Label', type: 'Label', properties: { x: 1.5708 } },
    { name: 'Placed', scene: 'other.scene', properties: { rotation: 0.7854, gravity: 2 } },
  ] });
  const data = JSON.parse(scene(oldRoot()));
  const other = JSON.parse(scene({ name: 'Other', type: 'Body' }));
  const count = up.upgradeScene(data, schema, (path) => (path === 'other.scene' ? other : null));
  const kid = (name) => data.root.children.find((c) => c.name === name).properties;
  check('upgradeScene: version 3', data.version === 3 && !up.isOldScene(data));
  check('upgradeScene: rotation to degrees', data.root.properties.rotation === 90 && data.root.properties.x === 4);
  check('upgradeScene: a Body\'s gravity is gravityScale', eq(kid('Crate'), { motion: 'physics', gravityScale: 0.5, spin: 180, slope: 57.29578 }), JSON.stringify(kid('Crate')));
  check('upgradeScene: a big gravity is a script\'s variable', eq(kid('Hero'), { gravity: 1800 }), JSON.stringify(kid('Hero')));
  check('upgradeScene: an old default that changed is written out', eq(kid('Dust'), { spread: 28.64789 }), JSON.stringify(kid('Dust')));
  check('upgradeScene: set values are converted', eq(kid('Smoke'), { direction: 45, spread: 11.459156 }), JSON.stringify(kid('Smoke')));
  check('upgradeScene: a pin\'s angles and motor', eq(kid('Hinge'), { motor: true, minAngle: -28.64789, motorSpeed: 114.591559 }), JSON.stringify(kid('Hinge')));
  check('upgradeScene: a wheel\'s motor turns', eq(kid('Fast'), { kind: 'wheel', motorSpeed: 180 }), JSON.stringify(kid('Fast')));
  check('upgradeScene: a slider\'s motor is pixels', eq(kid('Rail'), { kind: 'slider', motorSpeed: 30 }), JSON.stringify(kid('Rail')));
  check('upgradeScene: a distance joint keeps its old motor speed', eq(kid('Rod'), { kind: 'distance', motorSpeed: 2 }), JSON.stringify(kid('Rod')));
  check('upgradeScene: other numbers are left alone', eq(kid('Label'), { x: 1.5708 }));
  check('upgradeScene: a placed scene\'s values go by its root\'s type', eq(kid('Placed'), { rotation: 45, gravityScale: 2 }), JSON.stringify(kid('Placed')));
  check('upgradeScene: counts', count.angles === 8 && count.renamed === 2, JSON.stringify(count));
  const before = JSON.stringify(data);
  const again = up.upgradeScene(data, schema, () => null);
  check('upgradeScene: a version 3 scene is left alone', JSON.stringify(data) === before && again.angles === 0);

  // The editor works on an old scene in the new rules, and saves it as version 3.
  const texts = { 'old.scene': scene(oldRoot()), 'other.scene': scene({ name: 'Other', type: 'Body', properties: { gravity: 3, rotation: 1.5708 } }) };
  const parsed = {};
  const ctx2 = { readScene: (path) => (texts[path] ? (parsed[path] ||= JSON.parse(texts[path])) : null) };
  const oldDoc = SceneDoc.fromText('old.scene', texts['old.scene'], ctx2);
  const node = (name) => oldDoc.root.children.find((c) => c.name === name);
  check('an old scene opens in degrees', oldDoc.get(oldDoc.root, 'rotation') === 90 && oldDoc.get(node('Crate'), 'spin') === 180);
  check('an old scene opens with gravityScale', oldDoc.get(node('Crate'), 'gravityScale') === 0.5 && oldDoc.get(node('Crate'), 'gravity') === undefined);
  check('an old scene keeps its old defaults', oldDoc.get(node('Dust'), 'spread') === 28.64789 && oldDoc.get(node('Dust'), 'direction') === -90);
  check('an old placed scene\'s own values are converted', oldDoc.get(node('Placed'), 'rotation') === 45 && oldDoc.get(node('Placed'), 'gravityScale') === 2);
  const placedDoc = SceneDoc.fromText('level.scene', scene({ name: 'L', type: 'Group', children: [{ name: 'P', scene: 'other.scene' }] }, 3), ctx2);
  check('an old scene placed in a new one is read in the new rules', placedDoc.get(placedDoc.root.children[0], 'gravityScale') === 3
    && placedDoc.get(placedDoc.root.children[0], 'rotation') === 90);
  check('opening doesn\'t change the file', !oldDoc.dirty && JSON.parse(texts['old.scene']).version === 2 && parsed['other.scene'].root.properties.gravity === 3);
  const saved = JSON.parse(oldDoc.toText());
  check('an old scene is saved as version 3', saved.version === 3 && saved.root.properties.rotation === 90
    && saved.root.children[0].properties.gravityScale === 0.5);
  check('a new scene is version 3', JSON.parse(SceneDoc.empty('n.scene').toText()).version === 3);

  // Where a script assigns names.
  const lua = [
    '-- header',
    'speed = 5',
    'local facing, t = 1, 0',
    'function update(dt)',
    '  local a, b = 1, 2',
    '  score = (score or 0) + 1',
    '  vx = if dt > 0 then 3 else if dt < 0 then 2 else 1',
    '  for i = 1, 3 do q = i end',
    '  for k, v in pairs({}) do w.x = 1 end',
    '  t += dt',
    '  if a == b then z, a = 1, 2 else y = 3 end',
    '  after(1, function(arg) inner = arg; arg = 2 end)',
    '  local t2 = { field = 1, other = function() deep = 1 end }',
    '  repeat r = 1 until r',
    '  while a ~= b do a = b end',
    '  s = `hi {name = 3}`',
    '  self.thing, self.other = 4, 5',
    '  call(named == 1, [[ x = 1 ]]) -- gone = 1',
    '  --[[ lost = 1',
    '  ]] kept = 2',
    'end',
    'late = 1',
    'function Thing:method() self = nil; inMethod = 1 end',
    'local function helper(p) p = 1; viaHelper = 2 end',
    'if late then topIf = 1 end',
  ].join('\n');
  const found = up.luaAssignments(lua);
  check('luaAssignments: declared at the top level', eq([...found.declared.keys()].sort(), ['late', 'speed', 'topIf', 'update']), [...found.declared.keys()].join(' '));
  check('luaAssignments: assigned inside functions', eq([...found.inside.keys()].sort(),
    ['deep', 'inMethod', 'inner', 'kept', 'q', 'r', 's', 'score', 'viaHelper', 'vx', 'y', 'z']), [...found.inside.keys()].sort().join(' '));
  check('luaAssignments: the line', found.inside.get('score')[0] === 6 && found.inside.get('kept')[0] === 20 && found.declared.get('late') === 22);
  check('angleLines', eq(up.angleLines('a = 1\nrotation = math.pi -- turn\n-- rotation here\nx = other.spread\nlocal direction = 1\n').map((l) => l.line), [2, 4]));
  check('insertDeclarations: after the comment at the top', up.insertDeclarations('-- A script.\n-- More.\n\nspeed = 1\n', ['a', 'b'])
    === '-- A script.\n-- More.\n\n-- Variables the script makes later on (added when the project was updated).\na = nil\nb = nil\n\nspeed = 1\n');
  check('insertDeclarations: with no comment', up.insertDeclarations('speed = 1\n', ['a']).startsWith('-- Variables the script makes later on (added when the project was updated).\na = nil\n\nspeed = 1'));
  check('insertDeclarations: nothing to add', up.insertDeclarations('speed = 1\n', []) === 'speed = 1\n');

  // A whole project.
  const project = () => ({
    'smitten.json': JSON.stringify({ format: 'smitten.project', version: 2, name: 'Old', main: 'scenes/a.scene' }),
    'scenes/a.scene': scene({ name: 'R', type: 'Group', script: 'scripts/menu.lua', children: [
      { name: 'Play', type: 'Button', script: 'scripts/btn.lua' },
      { name: 'Pad', type: 'TouchButton', script: 'scripts/pad.lua' },
      { name: 'Hero', type: 'Body', script: 'scripts/p.lua', properties: { gravity: 0.5, rotation: 1.5708, lives: 3 } },
      { name: 'Twin', type: 'Body', script: 'scripts/p.lua', properties: { lives: 2 } },
      { name: 'Both', type: 'Group', script: 'scripts/both.lua' },
      { name: 'Also', type: 'Button', script: 'scripts/both.lua' },
    ] }),
    'scenes/done.scene': scene({ name: 'D', type: 'Group', properties: { rotation: 90 } }, 3),
    'scripts/btn.lua': 'function pressed()\n  on("pressed", f)\n  self:on("pressed", f)\n  count = 1\nend\n',
    'scripts/pad.lua': 'function pressed() end\nfunction released() end\n',
    'scripts/p.lua': 'speed = 1\nfunction update(dt)\n  rotation = rotation + math.pi * dt\n  vx = 3\n  lives = lives - 1\n  scroe = 2\n  if pressed("jump") then vy = -1 end\nend\n',
    'scripts/menu.lua': '-- menu\nfunction ready()\n  Play:on("pressed", go)\n  find("Pad"):on("released", go)\n  find("Hero"):on("pressed", go)\n  other:on("pressed", go)\n  t.on("pressed")\nend\n',
    'scripts/both.lua': 'function pressed() end\n',
    'scripts/lib.lua': 'local M = {}\nfunction M.f() made = 1 end\nreturn M\n',
    'notes.txt': 'rotation = math.pi',
  });
  const first = up.updateProject(project(), schema, { declare: true });
  const r = first.report;
  check('update: the version', JSON.parse(first.files['smitten.json']).version === 3 && JSON.parse(first.files['smitten.json']).name === 'Old');
  check('update: old scenes are converted, new ones left', eq(r.scenes.map((x) => x.path), ['scenes/a.scene']) && !('scenes/done.scene' in first.files));
  const hero = JSON.parse(first.files['scenes/a.scene']).root.children[2].properties;
  check('update: the scene', JSON.parse(first.files['scenes/a.scene']).version === 3 && eq(hero, { gravityScale: 0.5, rotation: 90, lives: 3 }), JSON.stringify(hero));
  check('update: a Button\'s pressed() is clicked()', first.files['scripts/btn.lua'].includes('function clicked()\n  on("clicked", f)\n  self:on("clicked", f)\n'), first.files['scripts/btn.lua']);
  check('update: a TouchButton\'s events', first.files['scripts/pad.lua'] === 'function touched() end\nfunction untouched() end\n', first.files['scripts/pad.lua']);
  check('update: on() on a child that\'s a Button', first.files['scripts/menu.lua'].includes('Play:on("clicked", go)') && first.files['scripts/menu.lua'].includes('find("Pad"):on("untouched", go)'));
  check('update: on() it can\'t place is left', first.files['scripts/menu.lua'].includes('find("Hero"):on("pressed", go)') && first.files['scripts/menu.lua'].includes('other:on("pressed", go)')
    && first.files['scripts/menu.lua'].includes('t.on("pressed")'));
  check('update: the input call is left alone', first.files['scripts/p.lua'].includes('if pressed("jump") then'));
  check('update: a script on a Button and something else is left', !('scripts/both.lua' in first.files));
  const look = (why) => r.look.filter((l) => l.why === why).map((l) => `${l.path}:${l.line}`);
  check('update: events to look at', eq(look('event'), ['scripts/both.lua:1', 'scripts/menu.lua:6']), look('event').join(' '));
  check('update: angles to look at', eq(look('angle'), ['scripts/p.lua:3']), look('angle').join(' '));
  check('update: undeclared names', eq(r.undeclared, [{ path: 'scripts/btn.lua', names: [{ name: 'count', line: 4 }] }, { path: 'scripts/p.lua', names: [{ name: 'scroe', line: 6 }] }]), JSON.stringify(r.undeclared));
  check('update: properties and Inspector values aren\'t undeclared', !JSON.stringify(r.undeclared).includes('vx') && !JSON.stringify(r.undeclared).includes('lives'));
  check('update: old-style scripts and modules are left', !('scripts/lib.lua' in first.files) && !JSON.stringify(r.undeclared).includes('made'));
  check('update: declarations are added', first.files['scripts/p.lua'].startsWith('-- Variables the script makes later on (added when the project was updated).\nscroe = nil\n\nspeed = 1\n')
    && first.files['scripts/btn.lua'].includes('count = nil\n'), first.files['scripts/p.lua']);
  check('update: other files are left', !('notes.txt' in first.files));
  const plain = up.updateProject(project(), schema);
  check('update: declarations only when asked', !('scripts/p.lua' in plain.files) && plain.report.undeclared.length === 2 && !plain.report.declared);
  const text = up.reportText(r);
  check('update: the report in words', text.includes('1 scene converted') && text.includes('scripts/btn.lua:1: function pressed() is now function clicked()')
    && text.includes('scripts/p.lua:3: rotation = rotation + math.pi * dt') && text.includes('scripts/p.lua:6: scroe') && text.includes('scripts/menu.lua:6: other:on("pressed", go)'), text);
  const ahead = up.reportText(r, { preview: true });
  check('update: the report before it happens', ahead.includes('1 scene will be converted') && ahead.includes('function pressed() becomes function clicked()')
    && ahead.includes('each needs a line at the top of its script') && !ahead.includes('was added'), ahead);
  // Updated once, there is nothing more to do, and nothing left undeclared.
  const updated = { ...project(), ...first.files };
  const second = up.updateProject(updated, schema, { declare: true });
  check('update: doing it again changes nothing', !second.report.old && Object.keys(second.files).length === 0);
  const recheck = up.updateProject({ ...updated, 'smitten.json': project()['smitten.json'] }, schema, { declare: true });
  check('update: an updated project has nothing left to change', recheck.report.undeclared.length === 0 && recheck.report.events.length === 0
    && recheck.report.scenes.length === 0 && eq(Object.keys(recheck.files), ['smitten.json']), JSON.stringify(recheck.report));

  // Updating an open project keeps a copy first.
  {
    const st = fakeStore();
    const pr = new Project({ id: 'p', name: 'Old' }, project(), [], st);
    const copies = [];
    const duplicate = async (id, name) => { copies.push({ id, name, files: pr.snapshot(), disk: { ...st.disk } }); return { id: 'copy' }; };
    const done = await up.applyUpdate(pr, schema, { declare: true, backupName: 'Old (before update)', duplicate });
    check('applyUpdate: a copy is kept, as it was', copies.length === 1 && copies[0].id === 'p' && copies[0].name === 'Old (before update)'
      && JSON.parse(copies[0].files['smitten.json']).version === 2 && copies[0].files['scripts/btn.lua'].startsWith('function pressed()'));
    check('applyUpdate: the project is updated and saved', pr.settings().version === 3 && pr.readText('scripts/btn.lua').includes('function clicked()')
      && JSON.parse(st.disk['smitten.json']).version === 3 && done.backup.id === 'copy' && done.report.old);
    const twice = await up.applyUpdate(pr, schema, { declare: true, backupName: 'x', duplicate });
    check('applyUpdate: nothing to do the second time', copies.length === 1 && twice.backup === null && !twice.report.old);
    const pr2 = new Project({ id: 'q', name: 'Old' }, project(), [], fakeStore());
    let failedWith = '';
    try { await up.applyUpdate(pr2, schema, { duplicate: async () => { throw new Error('no room'); } }); } catch (e) { failedWith = e.message; }
    check('applyUpdate: no copy, no update', failedWith === 'no room' && pr2.settings().version === 2 && pr2.readText('scripts/btn.lua').startsWith('function pressed()'));
  }

  // New projects play by the new rules, with scripts written for them.
  for (const t of TEMPLATES) {
    const out = t.build('Test');
    check(`${t.id}: is version 3`, JSON.parse(out['smitten.json']).version === 3);
    check(`${t.id}: its scenes are version 3`, Object.keys(out).filter((x) => x.endsWith('.scene')).every((x) => !up.isOldScene(JSON.parse(out[x]))));
    const asOld = { ...out, 'smitten.json': out['smitten.json'].replace('"version": 3', '"version": 2') };
    const rep = up.updateProject(asOld, schema).report;
    check(`${t.id}: its scripts make their variables at the top`, rep.undeclared.length === 0, JSON.stringify(rep.undeclared));
    check(`${t.id}: its scripts use the new event names`, rep.events.length === 0 && rep.look.every((l) => l.why !== 'event'));
    for (const [path, src] of Object.entries(out)) {
      if (path.endsWith('.lua')) check(`${t.id}: ${path} has no radians`, !/math\.pi|math\.atan2|fallGravity/.test(src) || path === 'scripts/bob.lua', path);
    }
  }
  for (const sc of SCRIPT_LIBRARY) {
    const found2 = up.luaAssignments(sc.source);
    const stray = [...found2.inside.keys()].filter((n) => !found2.declared.has(n) && !Object.values(schema.types).some((d) => d.properties && n in d.properties));
    check(`${sc.file}: makes its variables at the top`, stray.length === 0, stray.join(' '));
  }
  check('the spin script turns in degrees', libraryScript('spin').includes('turnsPerSecond * 360 * dt') && libraryScript('spin', 3) === libraryScript('spin'));
  check('...and in radians for a project with the old rules', libraryScript('spin', 2).includes('turnsPerSecond * math.pi * 2 * dt') && !libraryScript('spin', 2).includes('360'));
  check('other ready-made scripts are the same under both rules', SCRIPT_LIBRARY.filter((x) => x.id !== 'spin').every((x) => libraryScript(x.id, 2) === libraryScript(x.id, 3)));

  // The two rules tests are the same project apart from its version.
  const tree = (dir, base = dir, out = {}) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) tree(full, base, out);
      else out[full.slice(base.length + 1)] = readFileSync(full).toString('base64');
    }
    return out;
  };
  const rules3 = tree(join(root, 'tools', 'scene-tests', 'rules3'));
  const rules2 = tree(join(root, 'tools', 'scene-tests', 'rules2'));
  const differing = Object.keys({ ...rules3, ...rules2 }).filter((k) => rules3[k] !== rules2[k]);
  check('rules2 and rules3 differ only in smitten.json', eq(differing, ['smitten.json']), differing.join(' '));
  const v = (files) => JSON.parse(Buffer.from(files['smitten.json'], 'base64').toString()).version;
  check('rules2 is version 2 and rules3 version 3', v(rules2) === 2 && v(rules3) === 3);
  const smoke = JSON.parse(readFileSync(join(root, 'tools', 'scene-tests', 'smoke', 'smitten.json'), 'utf8'));
  check('the smoke test stays a version 2 project', smoke.version === 2);

  // The engine's own table of old defaults says the same as the editor's.
  const compatLua = readFileSync(join(root, 'love', 'src', 'modules', 'engine', 'compat.lua'), 'utf8');
  for (const [type, olds] of Object.entries(up.OLD_DEFAULTS)) {
    const line = compatLua.split('\n').find((l) => l.trim().startsWith(`${type} = {`)) || '';
    for (const [prop, value] of Object.entries(olds)) check(`compat.lua has ${type}.${prop} = ${value}`, line.includes(`${prop} = ${value}`), line);
  }
}

// --- Animations: the Animate panel's edits (core/animations.js) ----------------
{
  const A = await import(editor('core/animations.js'));
  files.set('lamp.scene', JSON.stringify({ format: 'smitten.scene', version: 3, root: { name: 'Lamp', type: 'Group', children: [{ name: 'Glow', type: 'Shape' }] } }));
  const text = JSON.stringify({
    format: 'smitten.scene', version: 3,
    root: { name: 'Room', type: 'Group', children: [
      { name: 'Door', type: 'Group', children: [
        { name: 'Panel', type: 'Shape', properties: { y: 4 } },
        { name: 'Creak', type: 'Sound' },
        { name: 'Lamp', scene: 'lamp.scene' },
        { name: 'Anim', type: 'Animator' },
      ] },
      { name: 'Outside', type: 'Shape' },
    ] },
  });
  const d = SceneDoc.fromText('room.scene', text, ctx);
  const door = d.root.children[0];
  const [panel, , lamp, anim] = door.children;
  const outside = d.root.children[1];
  const data = () => d.get(anim, 'animations');
  const keysOf = (i = 0) => data().open.tracks[i].keys;

  check('anim: an Animator has no animations at first', eq(A.animationsOf(d, anim), {}) && d.get(anim, 'animations') === null);
  const name = A.addAnimation(d, anim, 'open');
  check('anim: add an animation', name === 'open' && eq(data(), { open: { length: 1, loop: false, tracks: [] } }));
  check('anim: the first animation becomes the autoplay', d.get(anim, 'autoplay') === 'open');
  check('anim: a name that is taken gets a number', A.uniqueAnimationName(d, anim, 'open') === 'open2');
  d.undo();
  check('anim: undo the new animation', d.get(anim, 'animations') === null && d.get(anim, 'autoplay') === '');
  d.redo();

  check('anim: paths from the parent', A.pathTo(d, anim, door) === '.' && A.pathTo(d, anim, panel) === 'Panel' && A.pathTo(d, anim, outside) === null);
  check('anim: resolve a path', A.resolve(d, anim, 'Panel') === panel && A.resolve(d, anim, '.') === door && A.resolve(d, anim, 'Lamp/Glow')?.readonly === true && A.resolve(d, anim, 'Nope') === null);
  check('anim: targets', eq(A.targetsOf(d, anim).map((t) => t.path), ['.', 'Panel', 'Creak', 'Lamp', 'Lamp/Glow', 'Anim']));
  check('anim: the hidden properties are not animatable', !A.animatable('Animator').some((p) => p.name === 'animations') && A.animatable('Shape').some((p) => p.name === 'color'));

  const ti = A.addTrack(d, anim, 'open', 'Panel', 'y');
  check('anim: add a track', ti === 0 && eq(data().open.tracks[0], { piece: 'Panel', property: 'y', keys: [] }));
  check('anim: the same track again is the same track', A.addTrack(d, anim, 'open', 'Panel', 'y') === 0 && data().open.tracks.length === 1);
  A.setKey(d, anim, 'open', 0, 0, 4);
  A.setKey(d, anim, 'open', 0, 1, -60, { easing: 'outQuad' });
  A.setKey(d, anim, 'open', 0, 0.5, -20);
  check('anim: keys go in time order', eq(keysOf(), [{ time: 0, value: 4 }, { time: 0.5, value: -20 }, { time: 1, value: -60, easing: 'outQuad' }]));
  A.setKey(d, anim, 'open', 0, 0.5, -30);
  check('anim: a key at the same time changes it', keysOf().length === 3 && keysOf()[1].value === -30);
  d.undo();
  check('anim: undo a key change', keysOf()[1].value === -20);

  A.moveKeys(d, anim, 'open', [{ track: 0, index: 1 }], [0.5], 0.33, { snap: 0.25, merge: 'drag1' });
  A.moveKeys(d, anim, 'open', [{ track: 0, index: 1 }], [0.5], 0.61, { snap: 0.25, merge: 'drag1' });
  check('anim: move a key (snapped)', keysOf()[1].time === 1);
  const refs = A.sortKeys(d, anim, 'open', [{ track: 0, index: 1 }], { merge: 'drag1' });
  check('anim: moving keys stays one undo step', (d.undo(), keysOf()[1].time === 0.5));
  d.redo();
  check('anim: in order after the move, and the selection follows', keysOf()[1].time === 1 && keysOf()[2].time === 1 && eq(refs, [{ track: 0, index: 1 }]) && keysOf()[1].value === -20, JSON.stringify(keysOf()));
  A.moveKeys(d, anim, 'open', [{ track: 0, index: 0 }], [0], -5);
  check('anim: keys stay at 0 or after', keysOf()[0].time === 0);
  A.changeKey(d, anim, 'open', { track: 0, index: 2 }, { easing: 'linear', time: 0.75 });
  check('anim: change a key; linear is left out', keysOf()[2].time === 0.75 && !('easing' in keysOf()[2]));
  A.deleteKeys(d, anim, 'open', [{ track: 0, index: 2 }, { track: 0, index: 0 }]);
  check('anim: delete keys', eq(keysOf().map((k) => k.value), [-20]));
  d.undo();
  check('anim: undo the delete', keysOf().length === 3);
  A.sortKeys(d, anim, 'open');
  check('anim: sort keys', eq(keysOf().map((k) => k.time), [0, 0.75, 1]));

  const ci = A.addTrack(d, anim, 'open', 'Creak', null);
  A.addCall(d, anim, 'open', ci, 0.5, A.defaultCall('Sound').method);
  check('anim: call keys play a Sound', eq(data().open.tracks[ci], { piece: 'Creak', calls: [{ time: 0.5, method: 'play' }] }));
  check('anim: on other pieces a call key sends an event', eq(A.defaultCall('Group', 'open'), { method: 'emit', args: ['open'] }) && A.callable('Sound').includes('fadeOut'));
  A.setAnimation(d, anim, 'open', { length: 2, loop: true });
  check('anim: length and loop', data().open.length === 2 && data().open.loop === true);

  // Recording: Inspector and scene view edits become keys at the playhead.
  const before = JSON.stringify(panel.props);
  const undoDepth = d.undoStack.length;
  d.recorder = (entries, opts) => A.record(d, anim, 'open', 1.5, entries, opts);
  d.setProps(panel, { rotation: 0, scaleX: 1 }, { merge: 'move0' });
  check('anim: record makes no track for a value that stays the same', !data().open.tracks.some((t) => t.property === 'rotation' || t.property === 'scaleX'));
  d.setProps(panel, { x: 30, y: -80 }, { merge: 'move1', label: 'Move' });
  d.setProps(panel, { x: 32, y: -82 }, { merge: 'move1', label: 'Move' });
  check('anim: record leaves the piece as it is', JSON.stringify(panel.props) === before);
  const xTrack = data().open.tracks.find((t) => t.property === 'x');
  check('anim: record makes a track with a key at 0 (the piece as it was) and at the playhead', eq(xTrack, { piece: 'Panel', property: 'x', keys: [{ time: 0, value: 0 }, { time: 1.5, value: 32 }] }), JSON.stringify(xTrack));
  check('anim: record adds to a track that is there', keysOf().some((k) => k.time === 1.5 && k.value === -82));
  check('anim: a recorded drag is one undo step', d.undoStack.length === undoDepth + 1);
  d.setProps(outside, { x: 5 });
  check('anim: a piece outside the parent is set as usual', d.get(outside, 'x') === 5);
  d.setProps(anim, { speed: 2 });
  check('anim: the Animator itself is set as usual', d.get(anim, 'speed') === 2);
  d.recorder = null;
  d.undo();
  d.undo();
  d.undo();
  check('anim: undo the recording', !data().open.tracks.some((t) => t.property === 'x') && !keysOf().some((k) => k.time === 1.5));

  // The preview: values at a time, without touching the scene.
  A.setKey(d, anim, 'open', 0, 1, -60);
  const dirty = d.dirty;
  d.dirty = false;
  const depth = d.undoStack.length;
  const p = A.previewAt(d, anim, 'open', 0.25);
  check('anim: preview values', Math.abs(p.nodes.get(panel).y - (4 + (-60 - 4) / 3)) < 1e-9, JSON.stringify([...p.nodes.values()]));
  let heard = 0;
  d.addEventListener('preview', () => heard++);
  d.setPreview(p);
  check('anim: the preview shows in get()', Math.abs(d.get(panel, 'y') - (4 + (-60 - 4) / 3)) < 1e-9 && heard === 1);
  check('anim: the preview is not saved, undone or dirty', JSON.parse(d.toText()).root.children[0].children[0].properties.y === 4 && !d.dirty && d.undoStack.length === depth);
  A.addTrack(d, anim, 'open', 'Lamp/Glow', 'x');
  A.setKey(d, anim, 'open', data().open.tracks.length - 1, 0, 7);
  d.setPreview(A.previewAt(d, anim, 'open', 0.25));
  const glow = d.effectiveChildren(lamp)[0];
  check('anim: a placed scene\'s piece shows the preview too', d.get(glow, 'x') === 7);
  d.setPreview(null);
  check('anim: no preview, the scene again', d.get(panel, 'y') === 4 && d.get(glow, 'x') === 0);
  d.dirty = dirty;

  A.renameAnimation(d, anim, 'open', 'swing');
  check('anim: rename keeps the autoplay', d.get(anim, 'autoplay') === 'swing' && !!data().swing);
  A.deleteAnimation(d, anim, 'swing');
  check('anim: delete clears the autoplay', d.get(anim, 'autoplay') === '' && eq(data(), {}));
  check('anim: the file keeps the animations as data', (d.undo(), JSON.parse(d.toText()).root.children[0].children[3].properties.animations.swing.tracks.length === 3));
  check('anim: values for a call key', eq(A.parseArgs('"opened", 2, true, word'), ['opened', 2, true, 'word']));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
