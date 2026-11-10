// User preferences: defaults, persistence and change notifications.

const KEY = 'smitten-editor.settings';

export const DEFAULTS = {
  // Appearance
  theme: 'system',          // 'system' | 'light' | 'dark'
  contrast: 'system',       // 'system' | 'standard' | 'more'
  uiScale: 100,             // interface size, percent
  editorFontSize: 13,       // px
  // Editor
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: true,
  highlightActiveLine: true,
  closeBrackets: true,
  autocomplete: true,
  showWhitespace: false,
  autoSave: 'delay',        // 'off' | 'delay' | 'blur'
  trimWhitespaceOnSave: true,
  finalNewlineOnSave: true,
  // Running
  autorun: false,
  focusGameOnRun: true,
  clearConsoleOnRun: true,
  scaleMode: 'fit',         // 'fit' | 'integer' | 'none'
  jit: true,
  clipRecord: false,        // the game bar's Record: keep the last seconds for a clip
  clipSeconds: 10,
  // Console
  consoleTimestamps: false,
  consoleWrap: true,
  // Publishing
  // The game-sharing site (platform/); a hosted editor's config.js names its own.
  platformUrl: globalThis.SMITTEN_CONFIG?.platformUrl || 'http://localhost:8787',
  // Hackatime (hackatime.js)
  hackatimeKey: '',
  hackatimeLevels: true,     // scenes and tiles count as coding
  hackatimeArt: false,       // paint, sound and music count as designing
  hackatimeUrl: 'https://hackatime.hackclub.com/api/hackatime/v1',
};

let values = load();
const listeners = new Set();

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch { /* ignore */ }
  const v = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) v[k] = saved[k];
  return v;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* ignore */ }
}

export const settings = {
  get(key) { return values[key]; },
  all() { return { ...values }; },
  set(key, value) {
    if (!(key in DEFAULTS) || values[key] === value) return;
    values[key] = value;
    persist();
    for (const fn of listeners) fn(key, value);
  },
  reset() {
    const old = values;
    values = { ...DEFAULTS };
    persist();
    for (const k of Object.keys(DEFAULTS)) if (old[k] !== values[k]) for (const fn of listeners) fn(k, values[k]);
  },
  /** fn(key, value) runs after every change. Returns an unsubscribe function. */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// ---------------------------------------------------------------------------
// Theme

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme() {
  const t = values.theme;
  return t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t;
}

const contrastQuery = matchMedia('(prefers-contrast: more)');

export function resolvedContrast() {
  const c = values.contrast;
  return c === 'system' ? (contrastQuery.matches ? 'more' : 'standard') : c;
}

export function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.dataset.contrast = resolvedContrast();
  applyScale();
}

/** The interface size: everything in the editor grows or shrinks together. */
export function applyScale() {
  const scale = Math.min(150, Math.max(75, Number(values.uiScale) || 100)) / 100;
  document.documentElement.style.zoom = scale === 1 ? '' : String(scale);
  window.dispatchEvent(new Event('resize'));
}

darkQuery.addEventListener('change', () => { if (values.theme === 'system') applyTheme(); });
contrastQuery.addEventListener('change', () => { if (values.contrast === 'system') applyTheme(); });
settings.onChange((key) => {
  if (key === 'theme' || key === 'contrast') applyTheme();
  if (key === 'uiScale') applyScale();
});
