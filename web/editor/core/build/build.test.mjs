// Tests for play builds (index.js, png.js):
//   node web/editor/core/build/build.test.mjs
// Every PNG must decode to the same pixels after optimisation; JSON must
// keep its values; tool files go only when nothing names them; the
// project's files never change.

import zlib from 'node:zlib';
import { buildPlay, minifyJSON } from './index.js';
import { optimizePNG, readChunks } from './png.js';
import { decodePNG, encodePNGSync } from '../../tools/sprite/png.js';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else { failed++; console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

const deflate = async (bytes, level) => new Uint8Array(zlib.deflateSync(bytes, { level, memLevel: 9 }));

// A deterministic random generator, so failures repeat.
let seed = 1;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) % n; };

/** An image of w x h with pixels from a list of colours (or any colour when colours is null). */
function image(w, h, colours, pattern = 'random') {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = colours ? colours[pattern === 'stripes' ? Math.floor(i / w) % colours.length : rnd(colours.length)]
      : [rnd(256), rnd(256), rnd(256), 255];
    px.set(c, i * 4);
  }
  return px;
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const kindOf = (png) => ({ depth: readChunks(png)[0].data[8], ctype: readChunks(png)[0].data[9] });

const CASES = [
  ['two colours', 17, 9, [[0, 0, 0, 255], [255, 255, 255, 255]], null],
  ['two colours, bigger', 170, 90, [[0, 0, 0, 255], [255, 255, 255, 255]], { ctype: 3, depth: 1 }],
  ['four colours, one transparent', 131, 70, [[0, 0, 0, 0], [10, 20, 30, 255], [200, 100, 50, 255], [1, 2, 3, 255]], { ctype: 3, depth: 2 }],
  ['transparent pixels keep their colours', 80, 80, [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [9, 9, 9, 128]], { ctype: 3 }],
  ['sixteen colours with alpha', 40, 40, Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, i * 7, i % 3 ? 255 : i * 10]), { ctype: 3, depth: 4 }],
  ['200 colours', 64, 64, Array.from({ length: 200 }, (_, i) => [i, (i * 7) % 256, (i * 13) % 256, 255]), { ctype: 3, depth: 8 }],
  ['256 colours, semi-transparent', 64, 64, Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 3) % 256, (i * 5) % 256]), { ctype: 3, depth: 8 }],
  ['grey, many shades', 50, 30, Array.from({ length: 256 }, (_, i) => [i, i, i, 255]).concat([[7, 7, 7, 255]]), null],
  ['stripes', 300, 200, [[12, 34, 56, 255], [65, 43, 21, 255], [0, 0, 0, 0]], { ctype: 3 }],
  ['one pixel', 1, 1, [[1, 2, 3, 4]], null],
  ['a wide image of one row', 1000, 1, [[0, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255]], null],
];

for (const [name, w, h, colours, want] of CASES) {
  const px = image(w, h, colours, name === 'stripes' ? 'stripes' : 'random');
  const original = encodePNGSync(px, w, h);
  const better = await optimizePNG(original, { deflate });
  if (!better) { check(`${name}: made smaller`, want === null, 'optimizePNG returned null'); continue; }
  const a = await decodePNG(original);
  const b = await decodePNG(better);
  check(`${name}: same size`, a.width === b.width && a.height === b.height);
  check(`${name}: same pixels`, same(a.data, b.data));
  check(`${name}: smaller`, better.length < original.length, `${original.length} -> ${better.length}`);
  if (want) {
    const k = kindOf(better);
    check(`${name}: written as colour type ${want.ctype}${want.depth ? ` at ${want.depth} bits` : ''}`, k.ctype === want.ctype && (!want.depth || k.depth === want.depth), JSON.stringify(k));
  }
}

// Truecolour with more than 256 colours: RGB when opaque, RGBA otherwise; grey with alpha.
for (const [name, alpha, grey] of [['rgb', false, false], ['rgba', true, false], ['grey with alpha', true, true]]) {
  const w = 48, h = 48;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = (i * 37) % 256;
    px.set(grey ? [v, v, v, alpha ? (i * 11) % 256 : 255] : [v, (i * 5) % 256, (i >> 3) % 256, alpha ? (i * 11) % 256 : 255], i * 4);
  }
  // A gradient compresses well even as RGBA; noise in the low bits makes the colour type matter.
  const original = encodePNGSync(px, w, h);
  const better = await optimizePNG(original, { deflate });
  if (!better) { check(`${name}: same pixels when it cannot be made smaller`, true); continue; }
  const b = await decodePNG(better);
  check(`${name}: same pixels`, same((await decodePNG(original)).data, b.data));
  const k = kindOf(better);
  const want = grey ? 4 : alpha ? 6 : 2;
  check(`${name}: colour type ${want}`, k.ctype === want || k.ctype === 3, JSON.stringify(k));
}

// Files it leaves alone.
{
  check('not a PNG: null', (await optimizePNG(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), { deflate })) === null);
  const px = image(4, 4, [[1, 1, 1, 255], [2, 2, 2, 255]]);
  const png = encodePNGSync(px, 4, 4);
  const sixteen = png.slice();
  sixteen[8 + 8 + 8] = 16; // IHDR bit depth (the CRC no longer matches, which the check does not need)
  check('16 bits per channel: left as it is', (await optimizePNG(sixteen, { deflate })) === null);
  const damaged = png.slice(0, png.length - 20);
  check('a damaged file: left as it is', (await optimizePNG(damaged, { deflate })) === null);
}

// Colour chunks: kept only when asked (the splash), always dropped otherwise.
{
  const px = image(16, 16, [[5, 5, 5, 255], [250, 250, 250, 255]]);
  const plain = encodePNGSync(px, 16, 16);
  const gama = new Uint8Array([0, 0, 0, 4, 103, 65, 77, 65, 0, 0, 177, 143, 11, 252, 97, 5]); // gAMA 45455 with its CRC
  const withGama = new Uint8Array(plain.length + gama.length);
  withGama.set(plain.subarray(0, 33));
  withGama.set(gama, 33);
  withGama.set(plain.subarray(33), 33 + gama.length);
  const kept = await optimizePNG(withGama, { deflate, keepColorChunks: true });
  const dropped = await optimizePNG(withGama, { deflate });
  check('the splash keeps gAMA', readChunks(kept).some((c) => c.type === 'gAMA'));
  check('other images lose gAMA', !readChunks(dropped).some((c) => c.type === 'gAMA'));
}

// JSON.
{
  const cases = [
    '{\n  "a": 1,\n  "b": [1, 2, 3]\n}\n',
    '{ "text": "two  spaces and \\" a quote \\\\", "n": -0.5e3 }',
    '[ { "k" : "\\u00e9 \\n" } , null, true ]',
    '{"unicode": "é ü 字", "nested": {"deep": {"x": [ [ ], { } ]}}}',
  ];
  for (const c of cases) {
    const min = minifyJSON(c);
    check(`JSON keeps its values: ${c.slice(0, 20)}`, min !== null && JSON.stringify(JSON.parse(min)) === JSON.stringify(JSON.parse(c)));
    check(`JSON loses its spaces: ${c.slice(0, 20)}`, min !== null && min.length < c.length);
  }
  check('JSON: a string keeps its spaces', minifyJSON('{ "a": "x  y" }') === '{"a":"x  y"}');
  check('not JSON: null', minifyJSON('{ a: 1 }') === null && minifyJSON('{"a": "unfinished') === null);
}

// buildPlay.
{
  const sprite = JSON.stringify({ format: 'smitten.sprite', frameWidth: 8, layers: [{ name: 'a' }] }, null, 2);
  const scene = JSON.stringify({ format: 'smitten.scene', version: 3, root: { name: 'Main', type: 'Group' } }, null, 2);
  const pngBytes = encodePNGSync(image(32, 32, [[0, 0, 0, 255], [9, 9, 9, 255]]), 32, 32);
  const files = {
    'smitten.json': JSON.stringify({ name: 'T', main: 'main.scene', splash: { image: 'art/splash.png' } }, null, 2),
    'main.scene': scene,
    'hero.sprite': sprite,
    'art/hero.png': pngBytes,
    'art/splash.png': pngBytes,
    'tools/make-art.mjs': 'console.log(1)',
    'tools/notes.md': '# notes',
    'tools/named.py': 'print(1)',
    'tools/other.py': 'print(2)',
    'tools/made.sh': 'echo',
    'art/source.aseprite': new Uint8Array([1, 2, 3]),
    'scripts/main.lua': '-- tools/make-art.mjs makes the art.\nlocal t = love.filesystem.read("tools/named.py")\nlocal kind = ".sh"\nlocal f = "x" .. kind',
    'data/levels.txt': 'level 1',
  };
  const copy = { ...files };
  const { files: out, report } = await buildPlay(files, { deflate });
  check('the project files do not change', Object.keys(files).length === Object.keys(copy).length && Object.entries(copy).every(([k, v]) => files[k] === v));
  check('layers are left out', !('layers' in JSON.parse(out['hero.sprite'])) && JSON.parse(out['hero.sprite']).frameWidth === 8);
  check('scenes lose their spaces and keep their values', !out['main.scene'].includes('\n') && JSON.stringify(JSON.parse(out['main.scene'])) === JSON.stringify(JSON.parse(scene)));
  check('strings stay strings', typeof out['main.scene'] === 'string' && typeof out['scripts/main.lua'] === 'string');
  check('scripts stay as they are', out['scripts/main.lua'] === files['scripts/main.lua']);
  check('a tool file named only in a comment is left out', !('tools/make-art.mjs' in out));
  check('a tool file named in a string stays', 'tools/named.py' in out);
  check('another file with the same extension is left out', !('tools/other.py' in out));
  check('tool files of an extension that code names stay', 'tools/made.sh' in out);
  check('art program files are left out', !('art/source.aseprite' in out));
  check('notes and data stay', out['tools/notes.md'] === files['tools/notes.md'] && out['data/levels.txt'] === files['data/levels.txt']);
  check('images get smaller', out['art/hero.png'].length < pngBytes.length);
  check('the report counts each pass', report.layers?.files === 1 && report.tools?.files === 3 && report.png?.files === 2 && report.json?.files >= 2);
  const none = await buildPlay(files, { deflate, passes: { layers: false, tools: false, json: false, png: false } });
  check('with every pass off, the files are the same', Object.entries(files).every(([k, v]) => none.files[k] === v) && Object.keys(none.files).length === Object.keys(files).length);
  const noPng = await buildPlay(files, { deflate, passes: { png: false } });
  check('one pass can be turned off', noPng.files['art/hero.png'] === pngBytes && !('tools/make-art.mjs' in noPng.files));
}

console.log(`play builds: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
