// Project settings (smitten.json): name and main scene, display, splash,
// input actions, physics and engine modules.

import { h, icon, openDialog, formatBytes } from '../ui.js';
import { detectModules, moduleSize, MODULES } from '../core/modules.js';

const DEFAULT_ACTIONS = {
  left: ['left', 'a', 'pad:dpleft', 'axis:leftx-'],
  right: ['right', 'd', 'pad:dpright', 'axis:leftx+'],
  up: ['up', 'w', 'pad:dpup', 'axis:lefty-'],
  down: ['down', 's', 'pad:dpdown', 'axis:lefty+'],
  jump: ['space', 'up', 'w', 'pad:a'],
  fire: ['x', 'j', 'mouse:1', 'pad:x'],
  accept: ['return', 'space', 'pad:a'],
  cancel: ['escape', 'backspace', 'pad:b'],
  pause: ['escape', 'p', 'pad:start'],
};

export function inputActions(project) {
  return Object.keys({ ...DEFAULT_ACTIONS, ...(project.settings().input || {}) }).sort();
}

/** True for a "#rrggbb" light enough to want dark text on it. */
export function lightColor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

const STRETCH = [
  ['fit', 'Fit: scale to fit, with bars if the shapes differ'],
  ['expand', 'Expand: scale to fit and show more of the world instead of bars'],
  ['stretch', 'Stretch: fill the window, even if it distorts'],
  ['pixel', 'Pixel perfect: whole-number scaling only, for pixel art'],
];

export async function projectSettingsDialog(project, { tab = 'general' } = {}) {
  const s = project.settings();
  const display = { width: 1280, height: 720, stretch: 'fit', filter: 'smooth', ...(s.display || {}) };
  const input = { ...DEFAULT_ACTIONS, ...(s.input || {}) };
  const modules = { ...(s.modules || {}) };

  const field = (label, el, hint) => [h('label', {}, label), el, hint ? h('div', { class: 'hint' }, hint) : null];
  const text = (value, attrs = {}) => h('input', { class: 'input', value: value ?? '', ...attrs });
  const select = (value, options) => h('select', { class: 'input' }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

  // General
  const name = text(s.name);
  const scenes = project.paths().filter((p) => p.endsWith('.scene'));
  const main = select(s.main || '', [['', scenes.length ? '(none: main.lua runs the game)' : '(no scenes yet)'], ...scenes.map((p) => [p, p])]);
  const general = h('div', { class: 'settings-grid' },
    ...field('Name', name),
    ...field('Main scene', main, 'The scene the game starts with. Play (F5) runs it; Play scene (F6) runs the one you have open.'));

  // Display
  const width = text(display.width, { type: 'number', min: 16, max: 7680 });
  const height = text(display.height, { type: 'number', min: 16, max: 4320 });
  const stretch = select(display.stretch, STRETCH);
  const filter = select(display.filter, [['smooth', 'Smooth: for drawn and photographic art'], ['pixel', 'Pixel: sharp pixels, for pixel art']]);
  const presets = h('div', { style: 'display: flex; gap: 4px; flex-wrap: wrap' },
    ...[['1280×720', 1280, 720], ['1920×1080', 1920, 1080], ['960×540', 960, 540], ['640×360', 640, 360], ['320×180 pixel art', 320, 180, true], ['Phone 720×1280', 720, 1280]].map(([label, w, hh, pixel]) => {
      const b = h('button', { type: 'button', class: 'btn small' }, label);
      b.addEventListener('click', () => {
        width.value = w;
        height.value = hh;
        if (pixel) {
          stretch.value = 'pixel';
          filter.value = 'pixel';
        }
      });
      return b;
    }));
  const displayTab = h('div', { class: 'settings-grid' },
    ...field('Presets', presets),
    ...field('Resolution', h('div', { style: 'display: flex; gap: 6px; align-items: center' }, width, '×', height), 'The size your game is designed for, in pixels. It scales to any window.'),
    ...field('Fit to window', stretch),
    ...field('Texture filter', filter));

  // Splash: what the player shows while the game loads (web/player/player.js).
  const splash = { image: '', background: '', duration: 1, madeWith: true, ...(s.splash || {}) };
  const images = project.paths().filter((p) => /\.(png|jpe?g|webp|gif|svg)$/i.test(p));
  const splashImage = select(splash.image, [['', '(none)'], ...images.map((p) => [p, p])]);
  const toHex = (c) => Array.isArray(c) ? `#${c.slice(0, 3).map((n) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0')).join('')}` : /^#[0-9a-f]{6}$/i.test(c) ? c : '#0b0c0f';
  const splashBackground = h('input', { type: 'color', value: toHex(splash.background), 'aria-label': 'Splash background' });
  const splashDuration = text(splash.duration, { type: 'number', min: 0, max: 10, step: 0.5, style: 'width: 90px' });
  const madeWith = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(splash.madeWith !== false), 'aria-label': 'Made with Smitten' });
  madeWith.addEventListener('click', () => {
    madeWith.setAttribute('aria-checked', String(madeWith.getAttribute('aria-checked') !== 'true'));
    drawPreview();
  });
  const preview = h('div', { class: 'splash-preview', 'aria-hidden': 'true' });
  let previewUrl = '';
  const drawPreview = () => {
    URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    const bytes = splashImage.value && project.readBytes(splashImage.value);
    if (bytes) previewUrl = URL.createObjectURL(new Blob([bytes], { type: splashImage.value.endsWith('.svg') ? 'image/svg+xml' : '' }));
    const showMadeWith = madeWith.getAttribute('aria-checked') === 'true';
    preview.style.background = splashBackground.value;
    preview.classList.toggle('light', lightColor(splashBackground.value));
    preview.style.aspectRatio = `${Number(width.value) || 16} / ${Number(height.value) || 9}`;
    preview.replaceChildren(
      previewUrl ? h('img', { src: previewUrl, alt: '', class: filter.value === 'pixel' ? 'pixel' : '' }) : showMadeWith ? icon('heart', 28) : '',
      showMadeWith ? h('span', {}, 'Made with Smitten') : '');
  };
  splashImage.addEventListener('change', drawPreview);
  splashBackground.addEventListener('input', drawPreview);
  drawPreview();
  const splashTab = h('div', {},
    h('p', { class: 'settings-intro' }, 'Shown while your game loads in a browser, then it fades into your main scene.'),
    preview,
    h('div', { class: 'settings-grid' },
      ...field('Image', splashImage, 'A logo or title picture from your project. Leave it empty for Smitten\'s heart.'),
      ...field('Background', splashBackground),
      ...field('Show for at least', h('div', { style: 'display: flex; gap: 6px; align-items: center' }, splashDuration, 'seconds'), 'It stays up longer if the game is still loading.'),
      ...field('“Made with Smitten”', madeWith)));

  // Input
  const inputRows = h('div', { class: 'input-map' });
  const renderInput = () => {
    inputRows.replaceChildren();
    for (const [action, list] of Object.entries(input)) {
      const keys = text(list.join(', '), { 'aria-label': `Inputs for ${action}` });
      keys.addEventListener('change', () => { input[action] = keys.value.split(',').map((k) => k.trim()).filter(Boolean); });
      const del = h('button', { type: 'button', class: 'btn small ghost', title: `Remove ${action}` }, 'Remove');
      del.addEventListener('click', () => { delete input[action]; renderInput(); });
      inputRows.append(h('div', { class: 'input-row' }, h('strong', {}, action), keys, del));
    }
    const newName = text('', { placeholder: 'New action name (dash, interact…)' });
    const add = h('button', { type: 'button', class: 'btn small' }, 'Add action');
    add.addEventListener('click', () => {
      const n = newName.value.trim();
      if (n && !input[n]) {
        input[n] = [];
        renderInput();
      }
    });
    inputRows.append(h('div', { class: 'input-row' }, newName, h('span'), add));
  };
  renderInput();
  const inputTab = h('div', {},
    h('p', { class: 'settings-intro' }, 'Actions name what the player does; scripts ask for them with smitten.input.pressed("jump"). List keys (space, a, left), mouse buttons (mouse:1), gamepad buttons (pad:a) and stick directions (axis:leftx-).'),
    inputRows);

  // Physics
  const physics = s.physics || {};
  const gravity = Array.isArray(physics.gravity) ? physics.gravity : [0, 980];
  const gravityX = text(gravity[0], { type: 'number', step: 10, 'aria-label': 'Gravity sideways' });
  const gravityY = text(gravity[1], { type: 'number', step: 10, 'aria-label': 'Gravity down' });
  const gravityPresets = h('div', { style: 'display: flex; gap: 4px; flex-wrap: wrap' },
    ...[['Normal (980)', 0, 980], ['Floaty (400)', 0, 400], ['Heavy (2000)', 0, 2000], ['None (top-down, space)', 0, 0]].map(([label, gx, gy]) => {
      const b = h('button', { type: 'button', class: 'btn small' }, label);
      b.addEventListener('click', () => {
        gravityX.value = gx;
        gravityY.value = gy;
      });
      return b;
    }));
  const physicsTab = h('div', { class: 'settings-grid' },
    ...field('Gravity', h('div', { style: 'display: flex; gap: 6px; align-items: center' }, gravityX, '×', gravityY),
      'How fast physics bodies fall, in pixels per second per second: sideways, then down. Scripts can change it with setGravity(x, y).'),
    ...field('Presets', gravityPresets));

  // Modules
  const moduleList = h('div', { class: 'module-list' });
  const renderModules = async () => {
    const saved = project.settings().modules;
    const probe = { ...project, settings: () => ({ ...project.settings(), modules }), paths: () => project.paths(), readJSON: (p) => project.readJSON(p), readText: (p) => project.readText(p) };
    const det = detectModules(probe);
    moduleList.replaceChildren();
    for (const m of MODULES) {
      const d = det[m.id];
      const sel = select(modules[m.id] || 'auto', [['auto', 'Automatic'], ['always', 'Always include'], ['never', 'Never include']]);
      sel.addEventListener('change', () => {
        if (sel.value === 'auto') delete modules[m.id]; else modules[m.id] = sel.value;
        renderModules();
      });
      const size = h('span', { class: 'size' }, '');
      moduleSize(m.id).then((n) => { size.textContent = n ? formatBytes(n) : ''; });
      const why = d.reasons.length ? `Used by ${d.reasons.slice(0, 3).join(', ')}${d.reasons.length > 3 ? ` and ${d.reasons.length - 3} more` : ''}` : 'Not used by this project';
      moduleList.append(h('div', { class: `module-row ${d.included ? 'included' : ''}` },
        h('div', {}, h('strong', {}, `${m.name} `), h('span', { class: 'insp-desc' }, d.included ? '· included' : '· left out'), h('div', { class: 'why' }, `${m.what}. ${why}.`)),
        size, sel));
    }
    void saved;
  };
  renderModules();
  const modulesTab = h('div', {},
    h('p', { class: 'settings-intro' }, 'Your game only downloads the parts of the engine it uses. Smitten works out which from your scenes and scripts; change that here if you load things in unusual ways.'),
    moduleList);

  // The same layout as the editor's settings: sections on the left, a dialog
  // that keeps its size whichever section is open.
  const sections = {
    general: ['General', 'sliders', general],
    display: ['Display', 'monitor', displayTab],
    splash: ['Splash', 'image', splashTab],
    input: ['Input', 'gamepad', inputTab],
    physics: ['Physics', 'bodyPhysics', physicsTab],
    modules: ['Modules', 'package', modulesTab],
  };
  const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Project settings sections' });
  const content = h('div', { class: 'settings-content' });
  const showSection = (id) => {
    for (const b of nav.children) b.setAttribute('aria-current', String(b.dataset.id === id));
    content.replaceChildren(h('div', { class: 'settings-section' }, h('h3', {}, sections[id][0]), sections[id][2]));
    content.scrollTop = 0;
  };
  for (const [id, [label, iconName]] of Object.entries(sections)) {
    nav.append(h('button', { type: 'button', 'data-id': id, onclick: () => showSection(id) }, icon(iconName, 15), label));
  }
  showSection(sections[tab] ? tab : 'general');

  const ok = await openDialog({
    title: 'Project settings',
    className: 'settings-dialog',
    body: h('div', { class: 'settings-layout' }, nav, content),
    actions: [{ label: 'Cancel', value: false, ghost: true }, { label: 'Save', value: true, primary: true }],
  });
  URL.revokeObjectURL(previewUrl);
  if (!ok) return false;
  const next = {
    name: name.value.trim() || s.name,
    main: main.value,
    display: {
      width: Math.max(16, Number(width.value) || 1280),
      height: Math.max(16, Number(height.value) || 720),
      stretch: stretch.value,
      filter: filter.value,
    },
    modules,
  };
  const changedInput = Object.keys(input).some((k) => JSON.stringify(input[k]) !== JSON.stringify(DEFAULT_ACTIONS[k])) || Object.keys(DEFAULT_ACTIONS).some((k) => !input[k]);
  next.input = changedInput ? input : undefined;
  const gx = Number(gravityX.value) || 0;
  const gy = gravityY.value === '' ? 980 : Number(gravityY.value) || 0;
  next.physics = gx === 0 && gy === 980 ? undefined : { ...physics, gravity: [gx, gy] };
  if (!Object.keys(modules).length) next.modules = undefined;
  const nextSplash = {
    image: splashImage.value,
    background: splashBackground.value === '#0b0c0f' ? '' : splashBackground.value,
    duration: Math.max(0, Math.min(10, Number(splashDuration.value) || 0)),
    madeWith: madeWith.getAttribute('aria-checked') === 'true',
  };
  // Only what differs from Smitten's own splash is written down.
  for (const [k, v] of Object.entries({ image: '', background: '', duration: 1, madeWith: true })) if (nextSplash[k] === v) delete nextSplash[k];
  next.splash = Object.keys(nextSplash).length ? { ...(s.splash || {}), ...nextSplash } : undefined;
  project.updateSettings(next);
  return true;
}
