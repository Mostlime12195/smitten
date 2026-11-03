// Tests for the editor's core (no browser needed):
//   node tools/editor-tests/test.mjs
//
// The piece schema, scene documents (reading, writing, undo, placed scenes),
// module detection, the templates, the ready-made scripts and script
// variables.

import { readFileSync } from 'node:fs';
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
check('lineage', eq(schemaLib.lineage('Sprite'), ['Piece', 'Group', 'Sprite']));
check('isA', schemaLib.isA('Body', 'Group') && !schemaLib.isA('Label', 'Group'));
check('space', schemaLib.space('Label') === 'ui' && schemaLib.space('Body') === 'world' && schemaLib.space('Timer') === 'other');
check('moduleOfPiece', schemaLib.moduleOfPiece('Body', { motion: 'physics' }) === 'physics2d' && schemaLib.moduleOfPiece('Body', { motion: 'still' }) === null && schemaLib.moduleOf('Joint') === 'physics2d');
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
  const expected = { physics: ['physics2d'] }[t.id] || [];
  check(`${t.id}: modules`, eq(incl, expected), incl.join(','));
}
const overrides = { paths: () => [], readText: () => '', readJSON: () => null, settings: () => ({ modules: { video: 'always', physics2d: 'never' } }) };
const om = detectModules(overrides);
check('module overrides', om.video.included && !om.physics2d.included && om.video.override === 'always');
const code = { paths: () => ['main.lua'], readText: () => 'local w = smitten.physics.newWorld(0, 9.81)\nsmitten.synth.sfx("a.sfx"):play()', readJSON: () => null, settings: () => ({}) };
const cm = detectModules(code);
check('modules from code', cm.physics2d.included && cm.synth.included && !cm.video.included);

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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
