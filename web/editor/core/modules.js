// Which optional engine modules a project needs (DESIGN.md, section 3): from
// the pieces in its scenes and the APIs its scripts use, plus the overrides
// in smitten.json ("modules": {"physics2d": "always" | "never"}).
//
// physics2d is the scenes' physics (Box2D 3): any Body, Zone or Joint needs
// it. lovephysics is LÖVE's own love.physics API (Box2D 2.4), for code that
// makes its own worlds.

import { moduleOfPiece } from './schema.js';

export const MODULES = [
  { id: 'physics2d', name: 'Physics', what: 'Box2D 3: Bodies, Zones, Joints, and raycasts and other queries' },
  { id: 'lovephysics', name: 'LÖVE physics', what: "LÖVE's love.physics API (Box2D 2.4), for code that makes its own worlds" },
  { id: 'video', name: 'Video', what: 'Theora video playback: smitten.video' },
  { id: 'synth', name: 'Sound generator', what: 'Plays .sfx and .song files made in Smitten' },
];

const CODE_PATTERNS = [
  { id: 'physics2d', re: /\b(?:smitten|love)\.physics\.(?:raycast|raycastAll|piecesAt|overlap|getGravity|setGravity)\b|\b(?:make|spawn)\(\s*["'`](?:Body|Zone|Joint)["'`]/ },
  { id: 'lovephysics', re: /\b(?:smitten|love)\.physics\.(?!(?:raycast|raycastAll|piecesAt|overlap|getGravity|setGravity)\b)\w/ },
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
          const m = moduleOfPiece(e.type, e.properties || {});
          if (m) reasons[m].add(path);
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
