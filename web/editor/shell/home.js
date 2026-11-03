// Home: your games, new games from templates, and importing.

import { h, icon, showMenu, timeAgo, promptDialog, confirmDialog, toast } from '../ui.js';
import * as store from '../fs-store.js';
import { TEMPLATES } from '../core/templates.js';

/** ctx: { openProject(id), importZip(file) } */
export async function renderHome(root, ctx) {
  const projects = await store.listProjects();
  const create = async (template) => {
    const name = await promptDialog({ title: `New ${template.name.toLowerCase()} game`, label: 'Name', value: template.id === 'empty' ? 'My game' : `My ${template.name.toLowerCase()} game`, okLabel: 'Create' });
    if (!name) return;
    const p = await store.createProject(name, template.build(name), ['art', 'sounds', 'scripts']);
    ctx.openProject(p.id);
  };

  const newCards = TEMPLATES.map((t) => {
    const card = h('button', { type: 'button', class: 'card' },
      h('span', { class: 'card-title' }, icon(t.icon, 16), t.name),
      h('span', { class: 'card-desc' }, t.description));
    card.addEventListener('click', () => create(t));
    return card;
  });

  const projectCards = projects.map((p) => {
    const more = h('span', { class: 'icon-btn card-more', role: 'button', title: 'More', 'aria-label': `More for ${p.name}` }, icon('more', 16));
    const card = h('button', { type: 'button', class: 'card' },
      h('span', { class: 'card-title' }, icon('heart', 14), p.name),
      h('span', { class: 'card-meta' }, `Edited ${timeAgo(p.updated)}`), more);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-more')) {
        e.stopPropagation();
        showMenu(more, [
          { label: 'Open', action: () => ctx.openProject(p.id) },
          { label: 'Rename…', icon: 'pencil', action: async () => {
            const name = await promptDialog({ title: 'Rename project', label: 'Name', value: p.name, okLabel: 'Rename' });
            if (name) {
              await store.updateProject(p.id, { name });
              renderHome(root, ctx);
            }
          } },
          { label: 'Duplicate', icon: 'copy', action: async () => { await store.duplicateProject(p.id); renderHome(root, ctx); } },
          '-',
          { label: 'Delete…', icon: 'trash', danger: true, action: async () => {
            if (await confirmDialog({ title: 'Delete project?', message: `"${p.name}" and all its files will be deleted from this browser. This can't be undone.`, okLabel: 'Delete', danger: true })) {
              await store.deleteProject(p.id);
              renderHome(root, ctx);
            }
          } },
        ]);
        return;
      }
      ctx.openProject(p.id);
    });
    return card;
  });

  const importInput = h('input', { type: 'file', accept: '.zip,.love', hidden: true });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      await ctx.importZip(file);
    } catch (e) {
      toast(`Couldn't import: ${e.message}`, { type: 'error' });
    }
  });
  const importBtn = h('button', { type: 'button', class: 'btn' }, icon('upload', 15), 'Import');
  importBtn.addEventListener('click', () => importInput.click());

  root.replaceChildren(h('div', { class: 'home' }, h('div', { class: 'home-inner' },
    h('div', { class: 'home-header' },
      h('h1', {}, h('span', { class: 'brand-mark' }, icon('heart', 22)), 'Smitten'),
      h('span', { class: 'spacer' }), importBtn, importInput),
    h('section', {}, h('h2', {}, 'Start a new game'), h('div', { class: 'card-grid' }, ...newCards)),
    h('section', {}, h('h2', {}, projects.length ? 'Your games' : 'Your games will appear here'),
      projects.length ? h('div', { class: 'card-grid' }, ...projectCards)
        : h('p', { class: 'insp-desc' }, 'Projects are saved in this browser. Export them as a zip to keep a copy.')),
  )));
}
