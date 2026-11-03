// Icons for node types (the "icon" field in nodes.json), colored by kind like
// other engines: 2D blue, 3D orange, UI green, behaviors purple.

import { space, typeDef } from '../core/schema.js';

const P = {
  node: '<circle cx="12" cy="12" r="7"/>',
  node2d: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  node3d: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  sprite: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  shape: '<path d="M12 3 21 19H3Z"/>',
  text: '<path d="M4 7V5h16v2M9 20h6M12 5v15"/>',
  tilemap: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/>',
  particles: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  collision: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>',
  character: '<circle cx="12" cy="6" r="3"/><path d="M12 9v7M8 21l4-5 4 5M7 12h10"/>',
  static: '<rect x="3" y="14" width="18" height="6" rx="1"/><path d="M6 14V9h12v5"/>',
  area: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2"/>',
  rigid: '<circle cx="12" cy="12" r="8"/><path d="M8 9a5 5 0 0 1 4-2"/>',
  joint: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M9 12h6"/>',
  mesh: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  model: '<path d="M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z"/>',
  spot: '<path d="M8 3h8l-2 6h-4Z"/><path d="m10 9-6 12h16L14 9"/>',
  sky: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
  control: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
  label: '<path d="M4 20 10 4h1l6 16M6.5 14h8"/>',
  button: '<rect x="3" y="7" width="18" height="10" rx="5"/><path d="M9 12h6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  progress: '<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M5 12h8" stroke-width="3"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M10 2h4"/>',
  platformer: '<path d="M4 20h16"/><circle cx="9" cy="7" r="2"/><path d="M9 9v5l-3 4M9 14l3 4M12 10l3-2"/>',
  topdown: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  firstperson: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  follow: '<path d="M5 12h14M13 6l6 6-6 6"/><circle cx="5" cy="12" r="1"/>',
  mover: '<path d="M3 12h14M13 7l5 5-5 5"/><path d="M3 7v10"/>',
  spin: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  drag: '<path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3-2.7L8 15"/>',
};

export function nodeIconSvg(name, size = 16) {
  const body = P[name] || P.node;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The color class of a type: c-2d, c-3d, c-ui, c-behavior or c-other. */
export function nodeColorClass(type) {
  const def = typeDef(type);
  if (def?.group === 'behaviors') return 'c-behavior';
  const s = space(type);
  return s === '2d' ? 'c-2d' : s === '3d' ? 'c-3d' : s === 'ui' ? 'c-ui' : 'c-other';
}

/** A <span> with the type's icon in its color. */
export function nodeIcon(type, size = 16) {
  const span = document.createElement('span');
  span.className = `node-icon ${nodeColorClass(type)}`;
  span.innerHTML = nodeIconSvg(typeDef(type)?.icon || 'node', size);
  return span;
}
