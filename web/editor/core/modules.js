// Which optional engine modules a project needs (DESIGN.md, section 3): from
// the node types in its scenes and the APIs its scripts use, plus the
// overrides in smitten.json ("modules": {"physics3d": "always" | "never"}).

import { moduleOf } from './schema.js';

export const MODULES = [
  { id: 'physics2d', name: '2D physics', what: 'Box2D: RigidBody2D, Joint2D and smitten.physics' },
  { id: '3d', name: '3D graphics', what: 'The 3D renderer and glTF models: every 3D node' },
  { id: 'physics3d', name: '3D physics', what: 'Jolt: 3D bodies, areas and characters' },
  { id: 'video', name: 'Video', what: 'Theora video playback: smitten.video' },
  { id: 'synth', name: 'Sound generator', what: 'Plays .sfx and .song files made in Smitten' },
];

const CODE_PATTERNS = [
  { id: 'physics2d', re: /\b(?:smitten|love)\.physics\.|\bRigidBody2D\b|\bJoint2D\b/ },
  { id: 'physics3d', re: /\b(?:smitten|love)\.physics3d\b|\b(?:RigidBody3D|StaticBody3D|CharacterBody3D|Area3D|CollisionShape3D)\b/ },
  { id: '3d', re: /\b(?:smitten|love)\.graphics3d\b|\b(?:Node3D|MeshInstance3D|Model3D|Camera3D|Sprite3D)\b/ },
  { id: 'video', re: /\b(?:smitten|love)\.video\b|\bnewVideo\s*\(/ },
  { id: 'synth', re: /\b(?:smitten|love)\.synth\b|\.(?:sfx|song)["'`]/ },
];

/**
 * Returns { id: { included, reasons: [text], override } } for every module.
 * project: a Project (core/project.js).
 */
export function detectModules(project) {
  const reasons = Object.fromEntries(MODULES.map((m) => [m.id, new Set()]));
  for (const path of project.paths()) {
    if (path.endsWith('.scene')) {
      let data;
      try {
        data = project.readJSON(path);
      } catch {
        continue;
      }
      const visit = (e) => {
        if (!e) return;
        if (e.type) {
          const m = moduleOf(e.type);
          if (m) reasons[m].add(path);
          if (m === 'physics3d') reasons['3d'].add(path);
        }
        const sound = e.properties?.sound;
        if (typeof sound === 'string' && /\.(sfx|song)$/.test(sound)) reasons.synth.add(path);
        (e.children || []).forEach(visit);
      };
      visit(data?.root);
    } else if (/\.lua$/.test(path)) {
      const text = project.readText(path) || '';
      for (const p of CODE_PATTERNS) if (p.re.test(text)) reasons[p.id].add(path);
    }
  }
  const overrides = project.settings().modules || {};
  const out = {};
  for (const m of MODULES) {
    const override = overrides[m.id] || 'auto';
    const auto = reasons[m.id].size > 0;
    out[m.id] = {
      ...m,
      override,
      auto,
      included: override === 'always' || (override !== 'never' && auto),
      reasons: [...reasons[m.id]].sort(),
    };
  }
  // 3D physics nodes are 3D nodes.
  if (out.physics3d.included && !out['3d'].included && out['3d'].override !== 'never') out['3d'].included = true;
  return out;
}

/** The ids of the modules a project includes. */
export function includedModules(project) {
  return Object.values(detectModules(project)).filter((m) => m.included).map((m) => m.id);
}

const sizeCache = new Map();

/** Download size of a module's file in bytes (null if unknown). */
export async function moduleSize(id) {
  if (sizeCache.has(id)) return sizeCache.get(id);
  try {
    const res = await fetch(new URL(`../modules/${id}.wasm`, import.meta.url), { method: 'HEAD' });
    const n = Number(res.headers.get('content-length')) || null;
    sizeCache.set(id, n);
    return n;
  } catch {
    return null;
  }
}
