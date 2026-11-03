// The Home tab: what the project is, the ways to make something new, and
// (until it's done or hidden) a short checklist that walks a beginner
// through making a first game.

import { h, icon, timeAgo } from './ui.js';

const CREATE = [
  { label: 'Object', title: 'Object', icon: 'gamepad', desc: 'A player, a coin, an enemy' },
  { label: 'Scene', title: 'Scene', icon: 'map', desc: 'A level or a screen' },
  { label: 'Sprite', title: 'Sprite', icon: 'image', desc: 'Pixel art and animations' },
  { label: 'Sound effect', title: 'Sound', icon: 'wave', desc: 'Jumps, coins, explosions' },
  { label: 'Song', title: 'Song', icon: 'music', desc: 'Background music' },
  { label: 'script', title: 'Script', icon: 'code', desc: 'Your own Lua code' },
];

/**
 * ctx: {
 *   project, manifest, entries: Map, flags: {played, shared, hideChecklist},
 *   run(), share(), create(label), projectSettings(), openProjects(),
 *   showApi(), showShortcuts(), setFlag(name, value)
 * }
 */
export function renderHome(root, ctx) {
  const files = [...ctx.entries.values()].filter((e) => e.kind === 'file');
  const has = (re) => files.some((e) => re.test(e.path));
  const [w, hgt] = ctx.manifest.resolution;

  const steps = [
    { done: has(/^objects\/.+\.lua$/i), title: 'Make your hero', desc: 'Create an object and draw its sprite.', action: ['New object', () => ctx.create('Object')] },
    { done: has(/\.(scene|map)\.json$/i), title: 'Build a level', desc: 'Make a scene, paint tiles and place your objects.', action: ['New scene', () => ctx.create('Scene')] },
    { done: !!ctx.flags.played, title: 'Play it', desc: 'Press F5 any time to try your game.', action: ['Play', () => ctx.run()] },
    { done: has(/\.(sfx|song)\.json$/i), title: 'Add sound', desc: 'Make a jump sound or a song.', action: ['New sound', () => ctx.create('Sound effect')] },
    { done: !!ctx.flags.shared, title: 'Share it', desc: 'Send a link, or export it for itch.io.', action: ['Share', () => ctx.share()] },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const showChecklist = !ctx.flags.hideChecklist && doneCount < steps.length;

  const hero = h('div', { class: 'home-hero' },
    h('div', { class: 'home-hero-text' },
      h('h1', {}, ctx.project.name),
      h('p', {}, `${w} × ${hgt} pixels · edited ${timeAgo(ctx.project.updated)}`)),
    h('div', { class: 'home-hero-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.run() }, icon('play', 14), 'Play'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.projectSettings() }, icon('sliders', 15), 'Settings')));

  const create = h('section', { class: 'home-section' },
    h('h2', {}, 'Make something'),
    h('div', { class: 'home-create' }, ...CREATE.map((c) => h('button', { type: 'button', class: 'create-card', onclick: () => ctx.create(c.label) },
      h('span', { class: 'create-icon' }, icon(c.icon, 20)),
      h('strong', {}, c.title),
      h('span', {}, c.desc)))));

  const checklist = showChecklist ? h('section', { class: 'home-section home-card' },
    h('div', { class: 'home-card-header' },
      h('h2', {}, 'Your first game'),
      h('span', { class: 'home-progress', title: `${doneCount} of ${steps.length} done` },
        h('span', { class: 'home-progress-bar', style: `width: ${(doneCount / steps.length) * 100}%` })),
      h('span', { class: 'home-progress-label' }, `${doneCount}/${steps.length}`),
      h('button', { type: 'button', class: 'icon-btn small', title: 'Hide this', 'aria-label': 'Hide the checklist', onclick: () => ctx.setFlag('hideChecklist', true) }, icon('x', 14))),
    h('ol', { class: 'checklist' }, ...steps.map((s) => h('li', { class: s.done ? 'done' : '' },
      h('span', { class: 'check' }, icon(s.done ? 'checkCircle' : 'circle', 18)),
      h('span', { class: 'check-text' }, h('strong', {}, s.title), h('span', {}, s.desc)),
      s.done ? null : h('button', { type: 'button', class: 'btn small', onclick: s.action[1] }, s.action[0]))))) : null;

  const learn = h('section', { class: 'home-section' },
    h('h2', {}, 'Learn'),
    h('div', { class: 'home-links' },
      h('button', { type: 'button', class: 'home-link', onclick: () => ctx.openProjects() }, icon('gamepad', 16),
        h('span', {}, h('strong', {}, 'Examples'), h('span', {}, 'Open a finished game and see how it works'))),
      h('button', { type: 'button', class: 'home-link', onclick: () => ctx.showApi() }, icon('book', 16),
        h('span', {}, h('strong', {}, 'Cheat sheet'), h('span', {}, 'Every smitten function on one page'))),
      h('button', { type: 'button', class: 'home-link', onclick: () => ctx.showShortcuts() }, icon('keyboard', 16),
        h('span', {}, h('strong', {}, 'Shortcuts'), h('span', {}, 'F5 plays, F6 plays the open scene, Ctrl+P finds a file'))),
      h('a', { class: 'home-link', href: 'https://love2d.org/wiki/Main_Page', target: '_blank', rel: 'noopener' }, icon('globe', 16),
        h('span', {}, h('strong', {}, 'LÖVE wiki'), h('span', {}, 'Everything the love.* functions can do')))));

  root.replaceChildren(h('div', { class: 'home' }, hero, checklist, create, learn));
}
