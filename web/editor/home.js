// The Home tab: the project at a glance, quick ways to make things, a
// getting-started checklist, recent files and where to learn more.

import { h, icon, timeAgo } from './ui.js';
import { baseName, dirName, iconFor, kindOf } from './file-types.js';
import { thumbnailUrl } from './file-tree.js';

const CREATE = [
  { label: 'script', title: 'Script', icon: 'code', desc: 'Game logic in Lua' },
  { label: 'Sprite', title: 'Sprite', icon: 'image', desc: 'Characters, items, animations' },
  { label: 'Tileset', title: 'Tileset', icon: 'grid', desc: 'Tiles to build levels from' },
  { label: 'Map', title: 'Map', icon: 'map', desc: 'Paint a level with tiles' },
  { label: 'Sound effect', title: 'Sound', icon: 'wave', desc: 'Jumps, coins, explosions' },
  { label: 'Song', title: 'Song', icon: 'music', desc: 'Music with a piano roll' },
];

/**
 * ctx: {
 *   project, manifest, entries: Map, recent: [path], flags: {played, shared, hideChecklist},
 *   run(), share(), open(path), create(label), projectSettings(), openProjects(),
 *   showApi(), showShortcuts(), setFlag(name, value), showView(view)
 * }
 */
export function renderHome(root, ctx) {
  const files = [...ctx.entries.values()].filter((e) => e.kind === 'file');
  const has = (re) => files.some((e) => re.test(e.path));
  const count = (re) => files.filter((e) => re.test(e.path)).length;
  const [w, hgt] = ctx.manifest.resolution;

  const steps = [
    { done: has(/\.png$/i), title: 'Draw a sprite', desc: 'Open the pixel editor and draw your hero.', action: ['New sprite', () => ctx.create('Sprite')] },
    { done: has(/\.map\.json$/i), title: 'Build a level', desc: 'Make a tileset, then paint a map with it.', action: ['New map', () => ctx.create('Map')] },
    { done: has(/\.sfx\.json$/i), title: 'Make a sound effect', desc: 'Pick a preset like Jump or Coin and tweak it.', action: ['New sound', () => ctx.create('Sound effect')] },
    { done: has(/\.song\.json$/i), title: 'Write some music', desc: 'Place notes in the piano roll and press Space.', action: ['New song', () => ctx.create('Song')] },
    { done: !!ctx.flags.played, title: 'Play your game', desc: 'Press F5 any time to see your changes.', action: ['Play', () => ctx.run()] },
    { done: !!ctx.flags.shared, title: 'Share it', desc: 'Send a link, or export it for itch.io.', action: ['Share', () => ctx.share()] },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  const stat = (view, label, n, iconName) => h('button', { type: 'button', class: 'home-stat', title: `Show ${label}`, onclick: () => ctx.showView(view) },
    h('span', { class: 'home-stat-top' }, h('strong', {}, String(n)), icon(iconName, 16)), h('span', {}, label));

  const hero = h('div', { class: 'home-hero' },
    h('div', { class: 'home-hero-text' },
      h('h1', {}, ctx.project.name),
      h('p', {}, `${w} × ${hgt} pixels · ${files.length} file${files.length === 1 ? '' : 's'} · edited ${timeAgo(ctx.project.updated)}`)),
    h('div', { class: 'home-hero-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.run() }, icon('play', 14), 'Play'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.projectSettings() }, icon('sliders', 15), 'Project settings'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.share() }, icon('link', 15), 'Share')));

  const stats = h('div', { class: 'home-stats' },
    stat('code', 'scripts', count(/\.lua$/i), 'code'),
    stat('art', 'images', count(/\.png$/i), 'image'),
    stat('maps', 'maps', count(/\.map\.json$/i), 'map'),
    stat('sounds', 'sounds', count(/\.sfx\.json$/i), 'wave'),
    stat('music', 'songs', count(/\.song\.json$/i), 'music'));

  const create = h('section', { class: 'home-section' },
    h('h2', {}, 'Create'),
    h('div', { class: 'home-create' }, ...CREATE.map((c) => h('button', { type: 'button', class: 'create-card', onclick: () => ctx.create(c.label) },
      h('span', { class: 'create-icon' }, icon(c.icon, 20)),
      h('strong', {}, c.title),
      h('span', {}, c.desc)))));

  const checklist = ctx.flags.hideChecklist ? null : h('section', { class: 'home-section home-card' },
    h('div', { class: 'home-card-header' },
      h('h2', {}, 'Getting started'),
      h('span', { class: 'home-progress', title: `${doneCount} of ${steps.length} done` },
        h('span', { class: 'home-progress-bar', style: `width: ${(doneCount / steps.length) * 100}%` })),
      h('span', { class: 'home-progress-label' }, `${doneCount}/${steps.length}`),
      h('button', { type: 'button', class: 'icon-btn small', title: 'Hide the checklist', 'aria-label': 'Hide the checklist', onclick: () => ctx.setFlag('hideChecklist', true) }, icon('x', 14))),
    h('ol', { class: 'checklist' }, ...steps.map((s) => h('li', { class: s.done ? 'done' : '' },
      h('span', { class: 'check' }, icon(s.done ? 'checkCircle' : 'circle', 18)),
      h('span', { class: 'check-text' }, h('strong', {}, s.title), h('span', {}, s.desc)),
      s.done ? null : h('button', { type: 'button', class: 'btn small', onclick: s.action[1] }, s.action[0])))));

  const recentPaths = ctx.recent.filter((p) => ctx.entries.get(p)?.kind === 'file').slice(0, 8);
  const recent = h('section', { class: 'home-section home-card' },
    h('div', { class: 'home-card-header' }, h('h2', {}, 'Recent files')),
    recentPaths.length
      ? h('div', { class: 'recent-list' }, ...recentPaths.map((p) => {
        const data = ctx.entries.get(p).data;
        const isImage = data instanceof Uint8Array && kindOf(p, data) === 'image';
        return h('button', { type: 'button', class: 'recent-item', title: p, onclick: () => ctx.open(p) },
          isImage ? h('img', { class: 'thumb', src: thumbnailUrl(p, data), alt: '' }) : icon(iconFor(p, data), 16),
          h('span', { class: 'recent-name' }, baseName(p)),
          h('span', { class: 'recent-dir' }, dirName(p)));
      }))
      : h('p', { class: 'home-muted' }, 'Files you open show up here.'));

  const learn = h('section', { class: 'home-section' },
    h('h2', {}, 'Learn'),
    h('div', { class: 'home-links' },
      h('button', { type: 'button', class: 'home-link', onclick: () => ctx.showApi() }, icon('book', 16),
        h('span', {}, h('strong', {}, 'smitten cheat sheet'), h('span', {}, 'Every function for sprites, maps, sound and input'))),
      h('button', { type: 'button', class: 'home-link', onclick: () => ctx.openProjects() }, icon('gamepad', 16),
        h('span', {}, h('strong', {}, 'Examples'), h('span', {}, 'Open the Platformer and other example games'))),
      h('a', { class: 'home-link', href: 'https://love2d.org/wiki/Main_Page', target: '_blank', rel: 'noopener' }, icon('globe', 16),
        h('span', {}, h('strong', {}, 'LÖVE wiki'), h('span', {}, 'The love.* functions Smitten is built on'))),
      h('button', { type: 'button', class: 'home-link', onclick: () => ctx.showShortcuts() }, icon('keyboard', 16),
        h('span', {}, h('strong', {}, 'Keyboard shortcuts'), h('span', {}, 'F5 plays, Ctrl+P finds files, and more')))));

  root.replaceChildren(h('div', { class: 'home' },
    hero, stats, create,
    h('div', { class: `home-columns ${checklist ? '' : 'single'}` }, checklist, recent),
    learn));
}
