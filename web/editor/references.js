// Keeping references to assets working when files are renamed or moved:
// paths inside Smitten's JSON files (a map's tilesets, a sprite's image, a
// song's sound effects) and string literals in Lua code that load an asset.

import { dirName } from './file-types.js';

/** Path from the folder of `fromFile` to `target` ("maps/a.map.json", "tiles/t.json" -> "../tiles/t.json"). */
export function relativePath(fromFile, target) {
  const from = dirName(fromFile).split('/').filter(Boolean);
  const to = target.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

/** Resolve `ref` relative to the folder of `file` ("maps/a.map.json", "../t.png" -> "t.png"). */
export function resolvePath(file, ref) {
  if (ref.startsWith('/')) return ref.slice(1);
  const parts = [];
  for (const part of `${dirName(file)}/${ref}`.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** The paths inside a Smitten JSON file that point at other files: [{get, set}] over the parsed object. */
function jsonRefs(path, data) {
  const refs = [];
  const field = (obj, key) => {
    if (obj && typeof obj[key] === 'string') refs.push({ get: () => obj[key], set: (v) => { obj[key] = v; } });
  };
  if (/\.(sprite|tileset)\.json$/i.test(path)) field(data, 'image');
  if (/\.map\.json$/i.test(path) && Array.isArray(data.tilesets)) {
    data.tilesets.forEach((_, i) => field(data.tilesets, i));
  }
  if (/\.song\.json$/i.test(path) && Array.isArray(data.instruments)) {
    for (const inst of data.instruments) field(inst, 'sfx');
  }
  return refs;
}

/**
 * The string literals code may use to load a file, most specific first.
 * Parallel lists for a file's old and new path give the replacements.
 */
export function codeLiterals(path) {
  const m = /^(.*?)(\.sprite\.json|\.tileset\.json|\.map\.json|\.sfx\.json|\.song\.json|\.png)$/i.exec(path);
  if (m) return [path, m[1]];
  if (/\.lua$/i.test(path)) {
    const mod = path.replace(/(\/init)?\.lua$/i, '');
    return [path, mod.replace(/\//g, '.')];
  }
  return [path];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Work out what has to change after files moved.
 * files: {path: data} after the move; moves: [[from, to], ...] of files.
 * Returns {json: {path: text}, code: {path: {text, count}}}: JSON updates keep
 * the project working; code updates are offered to the user.
 */
export function referenceUpdates(files, moves) {
  const moved = new Map(moves);
  const oldPathOf = new Map(moves.map(([from, to]) => [to, from]));
  const json = {};
  const code = {};

  for (const [path, data] of Object.entries(files)) {
    if (typeof data !== 'string') continue;
    if (/\.(sprite|tileset|map|sfx|song)\.json$/i.test(path)) {
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      const oldSelf = oldPathOf.get(path) || path;
      let changed = false;
      for (const ref of jsonRefs(path, parsed)) {
        const target = resolvePath(oldSelf, ref.get());
        const next = relativePath(path, moved.get(target) || target);
        if (next !== ref.get()) {
          ref.set(next);
          changed = true;
        }
      }
      if (changed) json[path] = `${JSON.stringify(parsed, null, 2)}\n`;
    } else if (/\.lua$/i.test(path)) {
      let text = data;
      let count = 0;
      for (const [from, to] of moves) {
        const before = codeLiterals(from);
        const after = codeLiterals(to);
        before.forEach((lit, i) => {
          if (lit === after[i]) return;
          text = text.replace(new RegExp(`(["'])${escapeRe(lit)}\\1`, 'g'), (_, q) => {
            count++;
            return `${q}${after[i]}${q}`;
          });
        });
      }
      if (count) code[path] = { text, count };
    }
  }
  return { json, code };
}

/** Files that should move along with `path`: a PNG's .sprite.json. */
export function companionsOf(path, exists) {
  const m = /^(.*)\.png$/i.exec(path);
  if (m && exists(`${m[1]}.sprite.json`)) return [`${m[1]}.sprite.json`];
  return [];
}
