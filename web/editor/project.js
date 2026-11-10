// smitten.json: the project manifest (see docs/settings.md).

// "Sweetie 16" by GrafxKid (lospec.com/palette-list/sweetie-16).
export const DEFAULT_PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
];

// One version for the editor: core/project.js has it.
import { ENGINE_VERSION } from './core/project.js';
export { ENGINE_VERSION };

export const DEFAULT_MANIFEST = {
  format: 'smitten.project',
  version: 1,
  engine: ENGINE_VERSION,
  resolution: [320, 180],
  palette: DEFAULT_PALETTE,
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Parse smitten.json's text (or undefined) into a manifest with defaults filled in. */
export function parseManifest(text) {
  let data = {};
  if (typeof text === 'string') {
    try { data = JSON.parse(text) || {}; } catch { data = {}; }
  }
  const m = { ...DEFAULT_MANIFEST, ...data };
  if (!Array.isArray(m.resolution) || m.resolution.length !== 2 || !m.resolution.every((n) => Number.isInteger(n) && n > 0)) {
    m.resolution = DEFAULT_MANIFEST.resolution;
  }
  const palette = Array.isArray(m.palette) ? m.palette.filter((c) => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase()) : [];
  m.palette = palette.length ? palette : DEFAULT_PALETTE;
  return m;
}

export function manifestText(manifest = DEFAULT_MANIFEST) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
