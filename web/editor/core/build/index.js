// Play builds: the files of a game as players get them, made from the
// project's files when you export a game for the web (exporter.js) and when
// you publish it (publish.js). The project itself never changes: the editor,
// project zips, share links and remixes keep the source.
//
//   buildPlay(files, { passes, deflate }) -> { files, report }
//
// files: {path: string | Uint8Array}. The result is a new object; strings
// stay strings. report: {[pass]: {files, before, after}} in bytes.
//
// Passes (each one can be turned off with passes: {name: false}, to find
// out if a pass is the cause of a problem):
//   layers  .sprite files lose their layers (the game draws only the PNG)
//   tools   files the engine cannot use (JavaScript, Python, shell, art
//           program files) are left out, unless a script or scene names them
//   json    scenes, tilesets, sprites, sounds, songs and .json files lose
//           the spaces and line breaks between their values
//   png     images are written again as small as possible, with the same pixels
//
// Not done here, and why (measured on lime's games):
// - Lua bytecode: compiling all 61 scripts of Lamplight takes 14 ms on a
//   slow ARM box, the bytecode is 1.8 times the size of the source, and
//   bytecode from an upload can be unsafe (PUC Lua 5.1's checks of it are
//   known to have holes).
// - Image atlases: Lamplight's first room makes 12 draw calls a frame.
// - Audio: neither game has audio files (their sounds are .sfx and .song).
//   The engine decodes WAV, FLAC, Ogg Vorbis and MP3 by their contents;
//   the browser can encode only Opus, which the engine does not decode.
// - Comments in scripts: about 15 KB of Lamplight's zip, for a lexer of
//   Smitten syntax in JavaScript.

import { withoutLayers } from '../../tools/sprite/doc.js';
import { optimizePNG } from './png.js';

export const PASSES = ['layers', 'tools', 'json', 'png'];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const size = (data) => (typeof data === 'string' ? encoder.encode(data).length : data.length);
const text = (data) => (typeof data === 'string' ? data : decoder.decode(data));

// Files that no engine function reads as they are: code for other programs,
// and the files of art programs (the game uses the PNG they export).
const TOOL_FILE = /\.(m?js|cjs|ts|py|sh|bat|cmd|ps1|aseprite|ase|psd|kra|xcf|blend|pdn)$/i;
// Files that hold JSON.
const JSON_FILE = /\.(scene|tileset|sprite|sfx|song|json)$/i;
// Files whose text can name other files.
const TEXT_FILE = /\.(lua|scene|tileset|sprite|json|txt|md|csv|xml|sfx|song|anim)$/i;

/** JSON text without whitespace between values; null if it is not JSON. */
export function minifyJSON(source) {
  const out = [];
  let start = 0;
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // a backslash: skip the next character
      else if (c === 34) inString = false;
    } else if (c === 34) {
      inString = true;
    } else if (c === 32 || c === 9 || c === 10 || c === 13) {
      if (i > start) out.push(source.slice(start, i));
      start = i + 1;
    }
  }
  if (inString) return null;
  out.push(source.slice(start));
  const min = out.join('');
  try {
    // The same values, or the file stays as it is.
    if (JSON.stringify(JSON.parse(min)) !== JSON.stringify(JSON.parse(source))) return null;
  } catch {
    return null;
  }
  return min;
}

/** For the tools pass: true if the game's text files can name this file. */
function namedBy(corpus, path) {
  const base = path.split('/').pop();
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The file name at the end of a string, or a string that is only its
  // extension (a name made in code: name .. ".mjs").
  const re = new RegExp(`(${esc(base)}|["'\`]${esc(ext)})["'\`\\]]`, 'i');
  return re.test(corpus);
}

export async function buildPlay(files, { passes = {}, deflate = defaultDeflate, onProgress } = {}) {
  const on = (name) => passes[name] !== false;
  const out = { ...files };
  const report = {};
  const note = (pass, before, after) => {
    const r = (report[pass] ??= { files: 0, before: 0, after: 0 });
    r.files++;
    r.before += before;
    r.after += after;
  };

  if (on('layers')) {
    for (const [path, data] of Object.entries(out)) {
      if (!/\.sprite$/i.test(path)) continue;
      const source = text(data);
      const stripped = withoutLayers(source);
      if (stripped !== source) {
        out[path] = stripped;
        note('layers', size(data), size(stripped));
      }
    }
  }

  if (on('tools')) {
    const corpus = Object.entries(out).filter(([p]) => TEXT_FILE.test(p) && !TOOL_FILE.test(p)).map(([, d]) => text(d)).join('\n');
    for (const [path, data] of Object.entries(out)) {
      if (!TOOL_FILE.test(path) || namedBy(corpus, path)) continue;
      delete out[path];
      note('tools', size(data), 0);
    }
  }

  if (on('json')) {
    for (const [path, data] of Object.entries(out)) {
      if (!JSON_FILE.test(path)) continue;
      const source = text(data);
      const min = minifyJSON(source);
      if (min != null && min.length < source.length) {
        out[path] = min;
        note('json', size(data), size(min));
      }
    }
  }

  if (on('png')) {
    const splash = splashImage(out['smitten.json']);
    const images = Object.keys(out).filter((p) => /\.png$/i.test(p) && typeof out[p] !== 'string');
    let done = 0;
    for (const path of images) {
      const data = out[path];
      const better = await optimizePNG(data, { deflate, keepColorChunks: path === splash });
      if (better) {
        out[path] = better;
        note('png', data.length, better.length);
      }
      onProgress?.(++done / images.length);
    }
  }
  return { files: out, report };
}

/** The splash image's path (the player shows it in the browser), or null. */
function splashImage(manifest) {
  if (manifest == null) return null;
  try {
    const path = JSON.parse(text(manifest))?.splash?.image;
    return typeof path === 'string' ? path.replace(/^\/+/, '') : null;
  } catch {
    return null;
  }
}

/** A zlib stream from the browser's CompressionStream (or Node's, which has the same class). */
export async function defaultDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
