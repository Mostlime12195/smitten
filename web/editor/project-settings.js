// Project settings: the game's name, resolution and palette (smitten.json).

import { h, icon, openDialog, promptDialog } from './ui.js';
import { DEFAULT_PALETTE } from './project.js';

const RESOLUTIONS = [
  [160, 144, 'Game Boy'],
  [256, 144, 'Tiny'],
  [320, 180, 'Classic'],
  [384, 216, 'Roomy'],
  [480, 270, 'Large'],
  [640, 360, 'HD pixel art'],
];

const HEX = /#?([0-9a-f]{6})\b/gi;

/** Every #rrggbb in a text (Lospec .hex files, CSS, a pasted list). */
export function parsePalette(text) {
  return [...String(text).matchAll(HEX)].map((m) => `#${m[1].toLowerCase()}`);
}

/**
 * Shows the dialog. Resolves with {name, manifest} to save, or null.
 * manifest: the parsed smitten.json (with defaults).
 */
export async function openProjectSettings({ name, manifest }) {
  let [width, height] = manifest.resolution;
  let palette = [...manifest.palette];

  const nameInput = h('input', { class: 'input', type: 'text', value: name, maxlength: '80', spellcheck: 'false', 'aria-label': 'Project name' });

  const wInput = h('input', { class: 'input small', type: 'number', min: '16', max: '4096', value: String(width), 'aria-label': 'Width' });
  const hInput = h('input', { class: 'input small', type: 'number', min: '16', max: '4096', value: String(height), 'aria-label': 'Height' });
  const presetRow = h('div', { class: 'resolution-presets' });
  const renderPresets = () => presetRow.replaceChildren(...RESOLUTIONS.map(([w, hh, label]) => h('button', {
    type: 'button', class: 'resolution-preset', 'aria-pressed': String(w === width && hh === height),
    onclick: () => { width = w; height = hh; wInput.value = w; hInput.value = hh; renderPresets(); },
  }, h('strong', {}, `${w} × ${hh}`), h('span', {}, label))));
  const onSize = () => {
    width = Math.round(Number(wInput.value)) || width;
    height = Math.round(Number(hInput.value)) || height;
    renderPresets();
  };
  wInput.addEventListener('input', onSize);
  hInput.addEventListener('input', onSize);
  renderPresets();

  const swatches = h('div', { class: 'palette-swatches' });
  const colorInput = h('input', { type: 'color', value: '#ffffff', 'aria-label': 'Color to add', class: 'palette-color' });
  const renderPalette = () => swatches.replaceChildren(...palette.map((c, i) => h('div', { class: 'palette-swatch', style: `--c: ${c}`, title: c },
    h('button', {
      type: 'button', class: 'palette-remove', title: `Remove ${c}`, 'aria-label': `Remove ${c}`,
      onclick: () => { palette.splice(i, 1); renderPalette(); },
    }, icon('x', 11)))), h('label', { class: 'palette-add', title: 'Add a color' }, icon('plus', 14), colorInput));
  colorInput.addEventListener('change', () => {
    if (!palette.includes(colorInput.value)) palette.push(colorInput.value);
    renderPalette();
  });
  renderPalette();

  const importPalette = async () => {
    const text = await new Promise((resolve) => {
      const input = h('input', { type: 'file', accept: '.hex,.txt,.gpl,text/plain' });
      input.addEventListener('change', async () => resolve(input.files[0] ? await input.files[0].text() : ''));
      input.click();
    });
    const colors = parsePalette(text);
    if (colors.length) { palette = colors; renderPalette(); }
  };
  const pastePalette = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* not allowed */ }
    if (!parsePalette(text).length) {
      text = await promptDialog({ title: 'Paste colors', label: 'Colors like #1a1c2c, in any format', placeholder: '#1a1c2c #5d275d …', okLabel: 'Use these' }) || '';
    }
    const colors = parsePalette(text);
    if (colors.length) { palette = colors; renderPalette(); }
  };

  const body = h('div', { class: 'project-settings' },
    h('div', { class: 'field' }, h('label', {}, 'Name'), nameInput),
    h('div', { class: 'field' },
      h('label', {}, 'Resolution'),
      h('p', { class: 'field-hint' }, 'The size your game is drawn at with smitten.screen, scaled up to fill the window.'),
      presetRow,
      h('div', { class: 'resolution-custom' }, h('span', {}, 'Custom'), wInput, h('span', {}, '×'), hInput, h('span', {}, 'pixels'))),
    h('div', { class: 'field' },
      h('label', {}, 'Palette'),
      h('p', { class: 'field-hint' }, 'Colors offered first in the pixel and map editors. Any color still works.'),
      swatches,
      h('div', { class: 'palette-actions' },
        h('button', { type: 'button', class: 'btn small', onclick: importPalette }, icon('upload', 14), 'Import .hex'),
        h('button', { type: 'button', class: 'btn small', onclick: pastePalette }, icon('copy', 14), 'Paste colors'),
        h('a', { class: 'btn small ghost', href: 'https://lospec.com/palette-list', target: '_blank', rel: 'noopener' }, icon('globe', 14), 'Find palettes'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { palette = [...DEFAULT_PALETTE]; renderPalette(); } }, 'Reset'))));

  const res = await openDialog({
    title: 'Project settings',
    body,
    className: 'project-settings-dialog',
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Save', value: 'save', primary: true, submit: true },
    ],
    initialFocus: 'input',
  });
  if (res !== 'save') return null;
  width = Math.min(4096, Math.max(16, Math.round(Number(wInput.value)) || width));
  height = Math.min(4096, Math.max(16, Math.round(Number(hInput.value)) || height));
  return {
    name: nameInput.value.trim() || name,
    manifest: { ...manifest, resolution: [width, height], palette: palette.length ? palette : [...DEFAULT_PALETTE] },
  };
}
