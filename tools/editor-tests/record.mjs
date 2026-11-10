// The sound file editor in the real editor, in headless Chrome with a fake
// microphone: record, trim with the handles, normalize, save; then a song
// with the recording as a sample instrument; then the messages for a
// microphone that the browser blocks and for a page that is not secure.
//
//   node tools/editor-tests/record.mjs [--shots dir]
//
// Needs a built dist/ (python3 build.py). It serves dist/ itself on PORT
// (default 8774). CHROME and CHROME_FLAGS are as in tools/stress/run.mjs;
// the fake microphone's flags are added here. Prints PASS or FAIL for each
// check and exits with 1 if one failed.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav, peak, RECORD_RATE } from '../../web/editor/tools/wav/wav.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT) || 8774;
const BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2);
const shots = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : null;

// A microphone that the browser allows without asking, which sends a beep.
process.env.CHROME_FLAGS = `${process.env.CHROME_FLAGS || ''} --use-fake-ui-for-media-stream --use-fake-device-for-media-stream`;
const { launch, sleep } = await import('../stress/run.mjs');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail !== undefined ? `: ${detail}` : ''}`);
  }
  return ok;
}

if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('dist/ has no editor: run python3 build.py first');
const server = spawn('python3', [join(root, 'serve.py'), String(PORT), '--dir', join(root, 'dist')], { stdio: 'ignore' });
let page = null;
const problems = [];

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  page = await launch();
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const until = async (expr, what, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.eval(`!!(${expr})`)) return true;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const shot = async (name) => {
    if (!shots) return;
    mkdirSync(shots, { recursive: true });
    await sleep(300);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`     ${join(shots, `${name}.png`)}`);
  };
  const click = (expr) => page.eval(`(${expr}).click()`);
  const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`;
  const tool = `document.querySelector('.wav-tool:not([hidden])')`;
  const mouse = (type, x, y, buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1 });
  const rect = (expr) => page.eval(`(() => { const r = (${expr}).getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`).then(JSON.parse);
  const drag = async (expr, toX) => {
    const [l, t, w, hh] = await rect(expr);
    const x = l + w / 2;
    const y = t + hh / 2;
    await mouse('mouseMoved', x, y, 0);
    await mouse('mousePressed', x, y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', x + ((toX - x) * i) / 8, y);
    await mouse('mouseReleased', toX, y, 0);
  };
  const handleValue = (which) => page.eval(`Number(${tool}.querySelector('.wav-handle-${which}').getAttribute('aria-valuenow'))`);
  // A project file, from the editor's IndexedDB, as base64 (or null).
  const readFile = (path) => page.eval(`new Promise((resolve) => {
    const req = indexedDB.open('smitten');
    req.onsuccess = () => {
      const tx = req.result.transaction('entries');
      const all = tx.objectStore('entries').getAll();
      all.onsuccess = () => {
        const e = all.result.find((x) => x.path === ${JSON.stringify(path)});
        if (!e) return resolve(null);
        const d = e.data;
        if (typeof d === 'string') return resolve('text:' + d);
        const u8 = d instanceof Uint8Array ? d : new Uint8Array(d);
        let s = '';
        for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
        resolve(btoa(s));
      };
      all.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  })`);
  const waitFile = async (path, test, ms = 8000) => {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
      last = await readFile(path);
      if (last && test(last)) return last;
      await sleep(250);
    }
    return last;
  };

  // A new, empty project.
  await page.goto(`${BASE}/`);
  await until(byText('.card .card-title', 'Empty'), 'the home screen');
  await click(`${byText('.card .card-title', 'Empty')}.closest('.card')`);
  await until(`document.querySelector('dialog[open] input')`, 'the name dialog');
  await page.eval(`(() => { const i = document.querySelector('dialog[open] input'); i.value = 'Recording test'; i.dispatchEvent(new Event('input')); })()`);
  await click(`document.querySelector('dialog[open] button[type=submit]')`);
  await until(`document.querySelector('.titlebar')`, 'the editor');
  await sleep(1000);

  // The Sound workspace, then Record (in the sound effect editor's list).
  await click(`document.querySelector('.workspace-switch button[data-ws="sound"]')`);
  await until(`document.querySelector('.sfx-tool:not([hidden]) .sfx-record')`, 'the Record entry of the sound effect editor');
  await click(`document.querySelector('.sfx-tool:not([hidden]) .sfx-record')`);
  await until(`${tool}?.querySelector('.wav-wave.recording')`, 'the recorder');
  check('Record opens a new recording tab', await page.eval(`!!${byText('.doc-tab .doc-name', 'New recording')}`));
  await sleep(2600);
  check('the live waveform counts the time', /s of 10 s/.test(await page.eval(`${tool}.querySelector('.sfx-wave-info').textContent`)));
  await shot('recording');
  await click(`${tool}.querySelector('.wav-record.recording')`);
  await until(`${tool}?.querySelector('.wav-handle-start:not([hidden])')`, 'the waveform after recording');
  await sleep(300);
  const length = await page.eval(`Number(${tool}.querySelector('.wav-handle-end').getAttribute('aria-valuemax'))`);
  check('the recording is about as long as the time recorded', length > 2 && length < 4, length);

  // Trim: the start handle to 20% of the waveform, the end handle to 70%.
  await click(`${byText('.wav-tool:not([hidden]) button', 'Use all')}`);
  const [wl, , ww] = await rect(`${tool}.querySelector('.wav-wave')`);
  await drag(`${tool}.querySelector('.wav-handle-start')`, wl + ww * 0.2);
  await drag(`${tool}.querySelector('.wav-handle-end')`, wl + ww * 0.7);
  const start = await handleValue('start');
  const end = await handleValue('end');
  check('the start handle moved to 20%', Math.abs(start - length * 0.2) < 0.05, `${start} of ${length}`);
  check('the end handle moved to 70%', Math.abs(end - length * 0.7) < 0.05, `${end} of ${length}`);
  await click(`${byText('.wav-tool:not([hidden]) button', 'Normalize')}`);
  const volume = await page.eval(`${tool}.querySelector('.snd-readout').value`);
  check('Normalize changes the volume', volume !== '100%', volume);
  // The arrow keys move a focused handle by 10 ms.
  await page.eval(`${tool}.querySelector('.wav-handle-end').focus()`);
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  const end2 = await handleValue('end');
  check('ArrowLeft moves the end handle 10 ms', Math.abs(end - 0.01 - end2) < 0.0006, `${end} -> ${end2}`);
  await shot('recorder');

  // Saved by itself as sounds/recording.wav: a valid WAV of the trimmed length.
  const b64 = await waitFile('sounds/recording.wav', (d) => !d.startsWith('text:') && d.length > 100);
  if (check('the recording is saved as sounds/recording.wav', !!b64)) {
    let wav = null;
    try { wav = decodeWav(Buffer.from(b64, 'base64')); } catch (e) { check('the saved file is a valid WAV file', false, e.message); }
    if (wav) {
      check('the saved file is a valid WAV file', true);
      check('it is mono', wav.channels.length === 1, wav.channels.length);
      check(`it is ${RECORD_RATE} Hz`, wav.sampleRate === RECORD_RATE, wav.sampleRate);
      const seconds = wav.channels[0].length / wav.sampleRate;
      check('it is as long as the trim', Math.abs(seconds - (end2 - start)) < 0.002, `${seconds} s, trim ${end2 - start} s`);
      const p = peak(wav.channels);
      check(`it is normalized (or silent): peak ${p.toFixed(3)}`, p === 0 || (p > 0.9 && p <= 1), p);
    }
  }
  check('the tab now has the file name', await page.eval(`!!${byText('.doc-tab .doc-name', 'recording.wav')}`));

  // Undo puts the handles back.
  await page.eval(`${tool}.focus()`);
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  check('Undo works', Math.abs((await handleValue('end')) - end) < 0.0006, await handleValue('end'));

  // A song with the recording as a sample instrument.
  await click(`document.querySelector('.workspace-switch button[data-ws="music"]')`);
  await until(`document.querySelector('.mus-tool:not([hidden])')`, 'the Music workspace');
  const mus = `document.querySelector('.mus-tool:not([hidden])')`;
  await page.eval(`(() => { const b = ${mus}.querySelector('.mus-ins-section .snd-disclosure'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); })()`);
  await click(`${byText('.mus-tool:not([hidden]) .mus-ins-type button', 'Sound file')}`);
  await until(`${mus}.querySelector('.mus-sample-select')`, 'the sound file controls');
  check('the first sound file is chosen', await page.eval(`${mus}.querySelector('.mus-sample-select').value`) === 'sounds/recording.wav',
    await page.eval(`${mus}.querySelector('.mus-sample-select').value`));
  await page.eval(`(() => { const s = ${mus}.querySelector('.mus-base-note'); s.value = '67'; s.dispatchEvent(new Event('change')); })()`);
  await click(`${mus}.querySelector('.mus-play-song')`);
  await sleep(1500);
  check('the song plays', await page.eval(`${mus}.querySelector('.mus-play-song').textContent`).then((t) => /stop/i.test(t)),
    await page.eval(`${mus}.querySelector('.mus-play-song').textContent`));
  await shot('music-sample');
  await click(`${mus}.querySelector('.mus-play-song')`);
  const song = await waitFile('music/song.song', (d) => d.includes('"type": "sample"'));
  check('the song file has the sample instrument', !!song && song.includes('"sample": "../sounds/recording.wav"') && song.includes('"baseNote": 67'),
    song?.slice(0, 400));

  // A microphone that the browser blocks: a message that says what to do.
  await click(`document.querySelector('.workspace-switch button[data-ws="sound"]')`);
  await until(tool, 'the recording again');
  await page.eval(`navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))`);
  await click(`${tool}.querySelector('.wav-record-again')`);
  await until(`!${tool}.querySelector('.wav-message').hidden`, 'the message');
  const blocked = await page.eval(`${tool}.querySelector('.wav-message').textContent`);
  check('blocked microphone: says so', /microphone is blocked/.test(blocked) && /Allow the microphone/.test(blocked), blocked);
  check('blocked microphone: the recording is kept', await page.eval(`!${tool}.querySelector('.wav-handle-start').hidden`));
  await shot('blocked');

  // A page that is not secure (http on another computer): the Record button says why it is off.
  await page.eval(`void Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })`);
  await click(`document.querySelector('.workspace-switch button[data-ws="sound"]')`);
  await page.eval(`document.querySelector('.doc-new') && document.querySelector('.workspace[data-ws="sound"] .doc-new').click()`);
  await until(`document.querySelector('.menu')`, 'the New menu');
  await click(byText('.menu button, .menu [role=menuitem], .menu .menu-item', 'Record a sound'));
  await until(`${tool}?.querySelector('.wav-record:disabled')`, 'a recording tab with the Record button off');
  const why = await page.eval(`${tool}.querySelector('.wav-empty-text').textContent + ' | ' + ${tool}.querySelector('.wav-message').textContent`);
  check('not secure: says https', /secure pages/.test(why) && /https/.test(why), why);
  await shot('not-secure');

  check('no errors in the page', problems.length === 0, problems.join('\n'));
} catch (e) {
  check('the test ran to the end', false, e.message || e);
  if (problems.length) console.log(problems.join('\n'));
} finally {
  page?.close();
  server.kill();
}
console.log(`DONE ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
