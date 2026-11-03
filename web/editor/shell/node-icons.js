// Icons for piece types (the "icon" field in pieces.json, from Lucide via
// icons.js), colored by what the piece is for: things you see, bodies and
// zones, on-screen UI, sound and timers.

import { icon } from '../ui.js';
import { typeDef } from '../core/schema.js';

const COLOR = { visual: 'c-visual', physics: 'c-physics', ui: 'c-ui', sound: 'c-sound', basic: 'c-basic' };
const BODY_ICONS = { still: 'bodyStill', scripted: 'body', physics: 'bodyPhysics' };

/** The color class of a type: c-visual, c-physics, c-ui, c-sound or c-basic. */
export function nodeColorClass(type) {
  return COLOR[typeDef(type)?.group] || 'c-basic';
}

/**
 * A <span> with a type's icon in its color. motion (a Body's) picks the icon:
 * a wall, a figure or a crate.
 */
export function nodeIcon(type, size = 16, motion = null) {
  const name = type === 'Body' && motion ? BODY_ICONS[motion] : typeDef(type)?.icon || 'piece';
  const span = icon(name, size);
  span.className = `node-icon ${nodeColorClass(type)}`;
  return span;
}
