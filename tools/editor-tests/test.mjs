// Tests for the editor's core (no browser needed):
//   node tools/editor-tests/test.mjs
//
// The node schema, scene documents (reading, writing, undo, instances),
// module detection, the templates and script variables.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const editor = (p) => pathToFileURL(join(root, 'web', 'editor', p)).href;

const schemaLib = await import(editor('core/schema.js'));
schemaLib.setSchema(JSON.parse(readFileSync(join(root, 'love', 'src', 'modules', 'scene', 'nodes.json'), 'utf8')));
const { SceneDoc } = await import(editor('core/scene-doc.js'));
const { detectModules } = await import(editor('core/modules.js'));
const { TEMPLATES } = await import(editor('core/templates.js'));
const { scriptVariables } = await import(editor('core/script-vars.js'));

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
check('lineage', eq(schemaLib.lineage('Sprite2D'), ['Node', 'Node2D', 'Sprite2D']));
check('isA', schemaLib.isA('CharacterBody3D', 'Node3D') && !schemaLib.isA('Sprite2D', 'Node3D'));
check('space', schemaLib.space('Label') === 'ui' && schemaLib.space('Camera3D') === '3d' && schemaLib.space('Timer') === 'other');
check('moduleOf', schemaLib.moduleOf('RigidBody2D') === 'physics2d' && schemaLib.moduleOf('MeshInstance3D') === '3d' && schemaLib.moduleOf('Sprite2D') === null);

// --- Scene documents ------------------------------------------------------------
const files = new Map();
const ctx = { readScene: (p) => (files.has(p) ? JSON.parse(files.get(p)) : null) };
files.set('coin.scene', JSON.stringify({ format: 'smitten.scene', version: 2, root: { name: 'Coin', type: 'Area2D', properties: { z: 3 }, children: [{ name: 'Shape', type: 'CollisionShape2D' }] } }));
const levelText = JSON.stringify({
  format: 'smitten.scene', version: 2,
  root: { name: 'Level', type: 'Node2D', children: [
    { name: 'Player', type: 'CharacterBody2D', properties: { x: 10 }, script: 'player.lua', groups: ['player'] },
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
check('instance type', coin.type === 'Area2D');
check('instance base value', doc.get(coin, 'z') === 3 && doc.get(coin, 'x') === 50);
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

const sprite = doc.createNode('Sprite2D', { image: 'a.png' }, 'Player');
doc.add(player, sprite);
check('add', player.children.length === 1 && sprite.parent === player);
const dup = doc.createNode('Node2D', {}, 'Player');
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
doc.changeType(player, 'StaticBody2D');
check('changeType keeps shared properties', player.type === 'StaticBody2D' && doc.get(player, 'x') === 20);
doc.undo();
check('undo changeType', player.type === 'CharacterBody2D');
check('wouldLoop', doc.wouldLoop('level.scene') && !doc.wouldLoop('coin.scene'));
let threw = false;
try { doc.add(doc.root, doc.createInstance('level.scene')); } catch { threw = true; }
check('a scene can\'t contain itself', threw);
check('dimension', doc.dimension() === '2d' && SceneDoc.empty('a.scene', 'Node3D').dimension() === '3d');

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
      for (const k of Object.keys(n.props)) check(`${t.id}: ${p}: ${n.name}.${k} is a property`, !!schemaLib.propertyDef(n.type, k), `${n.type}.${k}`);
      if (n.instance) check(`${t.id}: ${p}: ${n.name} instance exists`, !!out[n.instance], n.instance);
      if (n.script) check(`${t.id}: ${p}: ${n.name} script exists`, !!out[n.script], n.script);
    });
  }
  const mods = detectModules(project);
  const incl = Object.values(mods).filter((m) => m.included).map((m) => m.id).sort();
  const expected = { walker3d: ['3d', 'physics3d'], empty3d: ['3d'] }[t.id] || [];
  check(`${t.id}: modules`, eq(incl, expected), incl.join(','));
}
const overrides = { paths: () => [], readText: () => '', readJSON: () => null, settings: () => ({ modules: { video: 'always', '3d': 'never' } }) };
const om = detectModules(overrides);
check('module overrides', om.video.included && !om['3d'].included && om.video.override === 'always');
const code = { paths: () => ['main.lua'], readText: () => 'local w = smitten.physics.newWorld(0, 9.81)\nsmitten.synth.sfx("a.sfx"):play()', readJSON: () => null, settings: () => ({}) };
const cm = detectModules(code);
check('modules from code', cm.physics2d.included && cm.synth.included && !cm['3d'].included);

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
check('script variable color alpha', eq(vars[3].value, [1, 0.5, 0, 1]));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
