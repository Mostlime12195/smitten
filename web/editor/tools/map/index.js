// Map editor: tile layers, object layers and tilesets (docs/reference.md,
// "Tilesets" and "Maps"). .map.json files open in the map editor and
// .tileset.json files in the tileset editor; tileset images are PNGs, drawn
// in the pixel editor.

import { MapEditor } from './map-editor.js';
import { TilesetEditor } from './tileset-editor.js';
import { newMapText, newTilesetText, relativePath, transparentPng } from './model.js';
import { injectStyle } from './style.js';

/**
 * What a new map needs from the project. newAssets' files(base) is only given
 * the new file's path, so this uses the host-like second argument when the
 * editor passes one, and otherwise the editor's debugging handle.
 */
function projectInfo(ctx) {
  let resolution = [320, 180];
  let files = [];
  try {
    if (ctx?.project) {
      resolution = ctx.project().resolution || resolution;
      files = ctx.list();
    } else {
      const entries = globalThis.studio?.state?.entries;
      if (entries) {
        files = [...entries.values()].filter((e) => e.kind === 'file').map((e) => e.path);
        const text = entries.get('smitten.json')?.data;
        const r = typeof text === 'string' ? JSON.parse(text).resolution : null;
        if (Array.isArray(r) && r.length === 2 && r.every((n) => Number.isInteger(n) && n > 0)) resolution = r;
      }
    }
  } catch { /* defaults */ }
  return { resolution, tilesets: files.filter((p) => /\.tileset\.json$/i.test(p)) };
}

export default {
  id: 'map',
  label: 'Map editor',
  match: (path) => /\.(map|tileset)\.json$/i.test(path),
  newAssets: [
    {
      label: 'Map',
      folder: 'maps',
      extension: '.map.json',
      files: (base, ctx) => {
        const { resolution, tilesets } = projectInfo(ctx);
        const path = `${base}.map.json`;
        // One screen of 16×16 tiles; with exactly one tileset in the project, use it.
        return {
          [path]: newMapText({
            width: Math.ceil(resolution[0] / 16),
            height: Math.ceil(resolution[1] / 16),
            tilesets: tilesets.length === 1 ? [relativePath(path, tilesets[0])] : [],
          }),
        };
      },
    },
    {
      label: 'Tileset',
      folder: 'tiles',
      extension: '.tileset.json',
      files: (base) => {
        const name = base.slice(base.lastIndexOf('/') + 1);
        return {
          [`${base}.tileset.json`]: newTilesetText(`${name}.png`, 16, 16),
          [`${base}.png`]: transparentPng(128, 64),
        };
      },
    },
  ],
  open(host) {
    injectStyle();
    return /\.tileset\.json$/i.test(host.path) ? new TilesetEditor(host) : new MapEditor(host);
  },
};
