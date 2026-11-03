// Renders this folder's sound effects and songs with the editor's synthesizer
// (dist/synth.js + dist/synth.mjs) and prints a checksum per file, in the
// same format as main.lua prints from the engine. Given the game's output
// (copied from the console into a file), it compares the two:
//
//   node tools/smitten-audio/check.mjs                 # print checksums
//   node tools/smitten-audio/check.mjs game-output.txt # compare with the engine
//   node tools/smitten-audio/check.mjs --wav out/      # also write .wav files
//
// Run python3 build.py first.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { loadSynth } = await import(pathToFileURL(join(root, 'dist', 'synth.js')).href);

const args = process.argv.slice(2);
let wavDir = null;
let gameOutput = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--wav') wavDir = args[++i];
  else gameOutput = args[i];
}

const hex = (n) => n.toString(16).padStart(8, '0');

function writeWav(path, samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(44100, 24); data.writeUInt32LE(88200, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.floor(v * 32767 + 0.5), 44 + i * 2);
  }
  writeFileSync(path, data);
}

const synth = await loadSynth();
const lines = [];
const report = (name, samples, ms) => {
  const line = `checksum ${name} ${hex(synth.checksum(samples))} ${samples.length}`;
  lines.push(line);
  console.log(`${line}  (${ms.toFixed(1)} ms, peak ${peak(samples).toFixed(3)})`);
  if (wavDir) {
    mkdirSync(wavDir, { recursive: true });
    writeWav(join(wavDir, name.replace(/[/]/g, '_') + '.wav'), samples);
  }
};
const peak = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

for (const file of readdirSync(join(here, 'sfx')).filter((f) => f.endsWith('.sfx.json')).sort()) {
  const params = JSON.parse(readFileSync(join(here, 'sfx', file), 'utf8'));
  const t = performance.now();
  const samples = synth.renderSfx(params);
  report(`sfx/${file}`, samples, performance.now() - t);
}

for (const file of readdirSync(join(here, 'music')).filter((f) => f.endsWith('.song.json')).sort()) {
  const song = JSON.parse(readFileSync(join(here, 'music', file), 'utf8'));
  const readSfx = (path) => {
    let p = resolve(here, 'music', path);
    if (!existsSync(p)) p += '.sfx.json';
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
  };
  synth.renderSong(song, readSfx); // warm up
  const t = performance.now();
  const samples = synth.renderSong(song, readSfx);
  report(`music/${file}`, samples, performance.now() - t);
}

if (gameOutput) {
  const engine = new Map();
  for (const m of readFileSync(gameOutput, 'utf8').matchAll(/checksum (\S+) ([0-9a-f]{8}) (\d+)/g)) {
    engine.set(m[1], `${m[2]} ${m[3]}`);
  }
  let failed = 0;
  for (const line of lines) {
    const [, name, sum, count] = line.split(' ');
    const other = engine.get(name);
    const ok = other === `${sum} ${count}`;
    if (!ok) failed++;
    console.log(`${ok ? 'same' : 'DIFFERENT'}  ${name}  editor ${sum} ${count}  engine ${other ?? 'missing'}`);
  }
  console.log(failed ? `${failed} file(s) differ` : 'engine and editor render identical samples');
  process.exitCode = failed ? 1 : 0;
}

