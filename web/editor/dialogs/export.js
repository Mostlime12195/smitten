// The Export dialog: a web build for itch.io (with only the engine modules
// the game uses), the project as a zip, or a .love file.

import { h, openDialog, downloadBlob, formatBytes, toast } from '../ui.js';
import { buildWebExport, zipFiles, buildLove, slugify } from '../exporter.js';
import { detectModules, moduleSize } from '../core/modules.js';

export async function exportDialog(project) {
  const det = detectModules(project);
  const included = Object.values(det).filter((m) => m.included);
  const sizes = await Promise.all(included.map((m) => moduleSize(m.id)));
  let core = null;
  try {
    const res = await fetch('smitten.wasm', { method: 'HEAD' });
    core = Number(res.headers.get('content-length')) || null;
  } catch { /* offline */ }
  const total = (core || 0) + sizes.reduce((a, b) => a + (b || 0), 0);

  const format = (id, title, desc, checked) => h('label', { class: 'module-row', style: 'grid-template-columns: auto 1fr; cursor: pointer' },
    h('input', { type: 'radio', name: 'export-format', value: id, checked }),
    h('div', {}, h('strong', {}, title), h('div', { class: 'why' }, desc)));
  const formats = h('div', { class: 'module-list' },
    format('web', 'Web game (zip)', 'Upload it to itch.io as an HTML game, or put it on any website. Plays in any modern browser.', true),
    format('project', 'Project (zip)', 'Every file of the project, to back it up or open it in Smitten elsewhere.'),
    format('love', '.love file', 'For LÖVE 12 on desktop. Only works if the game uses LÖVE\'s API and plain Lua, not Smitten\'s scenes or syntax.'));
  const modulesNote = h('div', { class: 'insp-desc', style: 'margin-top: 12px' },
    included.length
      ? `Includes the engine${core ? ` (${formatBytes(core)})` : ''} and ${included.map((m, i) => `${m.name.toLowerCase()}${sizes[i] ? ` (${formatBytes(sizes[i])})` : ''}`).join(', ')}.`
      : `Includes only the engine core${core ? ` (${formatBytes(core)})` : ''}: this game needs no optional modules.`,
    total ? ` About ${formatBytes(total)} before compression.` : '',
    ' Change what\'s included in Project settings › Modules.');

  const choice = await openDialog({
    title: 'Export',
    body: h('div', {}, formats, modulesNote),
    actions: [{ label: 'Cancel', value: null, ghost: true }, { label: 'Export', value: 'go', primary: true }],
  });
  if (!choice) return;
  const kind = document.querySelector('input[name="export-format"]:checked')?.value || formats.querySelector('input:checked')?.value || 'web';
  const name = slugify(project.name);
  try {
    if (kind === 'web') {
      const zip = await buildWebExport(project.snapshot(), project.name, included.map((m) => m.id));
      downloadBlob(new Blob([zip], { type: 'application/zip' }), `${name}-web.zip`);
    } else if (kind === 'project') {
      const zip = await zipFiles(project.snapshot());
      downloadBlob(new Blob([zip], { type: 'application/zip' }), `${name}.zip`);
    } else {
      const love = await buildLove(project.snapshot());
      downloadBlob(new Blob([love], { type: 'application/zip' }), `${name}.love`);
    }
    toast('Exported. Check your downloads.', { type: 'success' });
  } catch (e) {
    toast(`Export failed: ${e.message}`, { type: 'error', timeout: 7000 });
  }
}
