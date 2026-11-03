// Project settings (smitten.json): name and main scene, display, input
// actions and engine modules.

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
    input: ['Input', 'gamepad', inputTab],
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
  if (!Object.keys(modules).length) next.modules = undefined;
  project.updateSettings(next);
  return true;
}
