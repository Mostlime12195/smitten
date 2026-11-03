// Hackatime (https://hackatime.hackclub.com), Hack Club's time tracker. With
// an API key in Settings › Hackatime, the editor sends WakaTime-style
// heartbeats while you work, and the status bar shows today's total.
//
// Only real work counts, as Hack Club asks: a heartbeat goes out when you
// type, click or drag in a workspace, at most every 2 minutes for the same
// file (plus one when the file is saved). Nothing goes out while you're idle
// or only playing the game.
//
// What counts as what (WakaTime categories):
//   scripts                      coding
//   scenes and tiles (levels)    coding, like WakaTime's Godot and Unity plugins
//                                (Settings can turn this off)
//   paint, sound and music       designing, off unless Settings turns it on:
//                                Hack Club programs usually log art and music
//                                with a journal or a Lapse timelapse instead
//
// Heartbeats wait in localStorage when Hackatime can't be reached and go out
// later; they're sent in batches.

import { settings } from './settings.js';

const QUEUE_KEY = 'smitten-editor.hackatime-queue';
const MAX_QUEUE = 2000;
const SAME_FILE_EVERY = 120; // seconds, as WakaTime plugins do
const SEND_EVERY = 15_000;
const VERSION = '0.2.0';

const LANGUAGES = {
  lua: 'Lua', scene: 'Smitten Scene', tileset: 'Smitten Tileset', json: 'JSON', md: 'Markdown', txt: 'Text',
  png: 'Image', sprite: 'Smitten Sprite', sfx: 'Smitten Sound', song: 'Smitten Music', wav: 'Audio', ogg: 'Audio',
};
const ART = new Set(['png', 'sprite', 'jpg', 'jpeg', 'gif', 'sfx', 'song', 'wav', 'ogg', 'mp3']);
const LEVELS = new Set(['scene', 'tileset']);

const extOf = (path) => (/\.([^./]+)$/.exec(path || '')?.[1] || '').toLowerCase();

export function hackatimeUrl() {
  return String(settings.get('hackatimeUrl') || 'https://hackatime.hackclub.com/api/hackatime/v1').replace(/\/+$/, '');
}

export function hackatimeKey() {
  return String(settings.get('hackatimeKey') || '').trim();
}

/** What Hackatime gets for a file: {category, language}, or null if it isn't tracked. */
export function classify(path) {
  const ext = extOf(path);
  if (ART.has(ext)) return settings.get('hackatimeArt') ? { category: 'designing', language: LANGUAGES[ext] || 'Asset' } : null;
  if (LEVELS.has(ext)) return settings.get('hackatimeLevels') ? { category: 'coding', language: LANGUAGES[ext] } : null;
  return { category: 'coding', language: LANGUAGES[ext] || 'Text' };
}

/** Asks Hackatime for today's total with a key: {ok, text} or {ok: false, error}. */
export async function checkKey(key = hackatimeKey()) {
  if (!key) return { ok: false, error: 'No API key yet.' };
  try {
    const res = await fetch(`${hackatimeUrl()}/users/current/statusbar/today`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Hackatime didn't accept that key. Copy it again from your Hackatime settings." };
    if (!res.ok) return { ok: false, error: `Hackatime answered ${res.status}. Try again in a moment.` };
    const data = await res.json();
    return { ok: true, text: data?.data?.grand_total?.text || '0 mins', seconds: data?.data?.grand_total?.total_seconds || 0 };
  } catch {
    return { ok: false, error: "Couldn't reach Hackatime. Check your connection." };
  }
}

function readQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

function writeQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch { /* storage full: the oldest heartbeats are lost */ }
}

/**
 * Starts tracking for an open project.
 *   root: the element whose input counts as work (the editor)
 *   current(): the file you're working on right now: a project path, or null
 *   onToday(text): today's total, after heartbeats go out (for the status bar)
 * Returns { stop() }.
 */
export function startHackatime({ project, root, current, onToday }) {
  let last = { entity: null, time: 0 };
  let timer = null;
  let sending = false;

  const enabled = () => !!hackatimeKey();

  const beat = (path, { isWrite = false } = {}) => {
    if (!enabled() || !path) return;
    const kind = classify(path);
    if (!kind) return;
    const time = Date.now() / 1000;
    if (!isWrite && last.entity === path && time - last.time < SAME_FILE_EVERY) return;
    last = { entity: path, time };
    const q = readQueue();
    q.push({
      entity: path, type: 'file', time, project: project.name,
      category: kind.category, language: kind.language, is_write: isWrite,
      editor: 'Smitten', plugin: `smitten-hackatime/${VERSION}`, operating_system: 'Web',
      user_agent: `wakatime/v1 (web) Smitten/${VERSION} smitten-hackatime/${VERSION}`,
    });
    writeQueue(q);
  };

  const flush = async () => {
    if (sending || !enabled()) return;
    const q = readQueue();
    if (!q.length) return;
    sending = true;
    const batch = q.slice(0, 25);
    try {
      const res = await fetch(`${hackatimeUrl()}/users/current/heartbeats.bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${hackatimeKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      // Sent, or refused for good (a bad heartbeat): either way they're done.
      // A bad key keeps them for when it's fixed.
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 && res.status !== 429)) {
        writeQueue(readQueue().slice(batch.length));
        if (res.ok && onToday) checkKey().then((r) => r.ok && onToday(r.text));
      }
    } catch { /* offline: try again later */ }
    sending = false;
  };

  // Typing, clicking and dragging in the editor is work on the current file.
  const onInput = (e) => {
    if (e.target.closest?.('.game-view, .dialog, .menu')) return;
    beat(current());
  };
  const onFile = (e) => {
    if (e.detail.kind === 'write' && e.detail.path === current()) beat(e.detail.path, { isWrite: true });
  };
  root.addEventListener('keydown', onInput, true);
  root.addEventListener('pointerdown', onInput, true);
  project.addEventListener('file', onFile);
  timer = setInterval(flush, SEND_EVERY);
  if (enabled() && onToday) checkKey().then((r) => r.ok && onToday(r.text));

  return {
    stop() {
      clearInterval(timer);
      root.removeEventListener('keydown', onInput, true);
      root.removeEventListener('pointerdown', onInput, true);
      project.removeEventListener('file', onFile);
      flush();
    },
  };
}
