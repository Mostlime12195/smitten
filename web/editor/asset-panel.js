// The assets panel: everything in the game, grouped by what it is (scenes,
// objects, art, sounds, music, scripts) rather than by folder, with
// thumbnails, sound previews, search and a "+" per group. "All files" shows
// the plain file tree instead (app.js switches between the two).

import { h, icon } from './ui.js';
import { baseName, dirName, extOf, mimeOf } from './file-types.js';
import { snippetFor, thumbnailUrl } from './file-tree.js';
import { resolvePath } from './references.js';

const AUDIO_EXT = /\.(ogg|oga|opus|wav|mp3|flac|m4a|aac)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;
const SCENE_EXT = /\.(scene|map)\.json$/i;

const parseJSON = (text) => {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
};

const formatTime = (s) => (s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

/** What an object file says about itself: its sprite and behaviors. */
export function objectInfo(text) {
  if (typeof text !== 'string') return {};
  const sprite = /\bsprite\s*=\s*["']([^"']+)["']/.exec(text)?.[1];
  const list = /\bbehaviors\s*=\s*\{([^}]*)\}/.exec(text)?.[1];
  const behaviors = list ? [...list.matchAll(/["']([\w-]+)["']/g)].map((m) => m[1]) : [];
  return { sprite, behaviors };
}

/** The PNG a sprite reference points at ("sprites/hero" -> "sprites/hero.png"). */
function spriteImage(ref, entries) {
  if (!ref) return null;
  const base = ref.replace(/\.(png|sprite\.json)$/i, '');
  return entries.get(`${base}.png`) ? `${base}.png` : null;
}

/**
 * The groups, in order. Each takes the project's files and returns the ones
 * it shows; create: what its "+" makes (see app.js createAsset).
 */
const GROUPS = [
  {
    id: 'scenes', title: 'Scenes', create: 'Scene',
    hint: 'Levels and screens: tiles and the objects placed in them.',
    pick: (files) => {
      const scenes = files.filter((e) => SCENE_EXT.test(e.path));
      const withData = new Set(scenes.map((e) => e.path.replace(SCENE_EXT, '')));
      // A script in scenes/ without a scene file is a scene of its own (a title screen).
      const scriptOnly = files.filter((e) => /^scenes\/.+\.lua$/i.test(e.path) && !withData.has(e.path.replace(/\.lua$/i, '')));
      return [...scenes, ...scriptOnly];
    },
  },
  {
    id: 'objects', title: 'Objects', create: 'Object',
    hint: 'The things in your game: a sprite plus how it behaves.',
    pick: (files) => files.filter((e) => /^objects\/.+\.lua$/i.test(e.path)),
  },
  {
    id: 'art', title: 'Art', create: 'Sprite',
    hint: 'Sprites, animations and tiles, drawn in the pixel editor.',
    pick: (files) => files.filter((e) => IMAGE_EXT.test(e.path) && e.data instanceof Uint8Array),
  },
  {
    id: 'sounds', title: 'Sounds', create: 'Sound effect',
    hint: 'Jumps, coins and explosions from the sound editor.',
    pick: (files) => files.filter((e) => /\.sfx\.json$/i.test(e.path) || (AUDIO_EXT.test(e.path) && !/(^|\/)music\//i.test(e.path))),
  },
  {
    id: 'music', title: 'Music', create: 'Song',
    hint: 'Songs written in the music editor.',
    pick: (files) => files.filter((e) => /\.song\.json$/i.test(e.path) || (AUDIO_EXT.test(e.path) && /(^|\/)music\//i.test(e.path))),
  },
  {
    id: 'scripts', title: 'Scripts', create: 'script',
    hint: 'Other Lua code. main.lua starts the game.',
    pick: (files) => files.filter((e) => /\.(lua|glsl|frag|vert|shader)$/i.test(e.path)
      && !/^objects\//i.test(e.path) && !/^scenes\//i.test(e.path)),
  },
];

const createName = (label) => (label === 'script' ? 'script' : label === 'Sound effect' ? 'sound' : label.toLowerCase());

export class AssetPanel {
  /**
   * ctx: {
   *   entries(): Map<path, entry>, active(): path|null, isDirty(path),
   *   open(path), menu(path, point), create(label), synth(): Promise, toast(message)
   * }
   */
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.query = '';
    try {
      this.collapsed = new Set(JSON.parse(localStorage.getItem('smitten-editor.collapsedGroups') || '[]'));
    } catch {
      this.collapsed = new Set();
    }
    this.imageSizes = new Map(); // path -> {data, w, h}
    this.frameThumbs = new Map(); // path -> {data, key, url}
    this.mapThumbs = new Map(); // path -> {key, url}
    this.playing = null; // {path, stop()}
    this.renderQueued = false;
    this.visible = true;
  }

  show(visible) {
    this.visible = visible;
    if (!visible) this.stopPlaying();
    else this.render();
  }

  /** Re-render soon (several changes in a row cause one render). */
  refresh() {
    if (this.renderQueued || !this.visible) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  toggleGroup(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    try { localStorage.setItem('smitten-editor.collapsedGroups', JSON.stringify([...this.collapsed])); } catch { /* ignore */ }
    this.render();
  }

  render() {
    if (!this.visible) return;
    const files = [...this.ctx.entries().values()].filter((e) => e.kind === 'file')
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));

    const search = h('input', {
      class: 'input small asset-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search assets',
      value: this.query, spellcheck: 'false',
    });
    search.addEventListener('input', () => {
      this.query = search.value;
      this.root.querySelector('.asset-body')?.replaceWith(this.renderBody(files, search.value.trim().toLowerCase()));
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; search.dispatchEvent(new Event('input')); }
    });
    const hadFocus = document.activeElement?.classList.contains('asset-search');
    const scroll = this.root.querySelector('.asset-body')?.scrollTop || 0;
    this.root.replaceChildren(h('div', { class: 'asset-toolbar' }, search), this.renderBody(files, this.query.trim().toLowerCase()));
    this.root.querySelector('.asset-body').scrollTop = scroll;
    if (hadFocus) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  renderBody(files, q) {
    const sections = GROUPS.map((g) => {
      const all = g.pick(files);
      const shown = q ? all.filter((e) => e.path.toLowerCase().includes(q)) : all;
      if (q && !shown.length) return null;
      const open = !!q || !this.collapsed.has(g.id);
      const what = createName(g.create);
      const header = h('div', { class: 'asset-group-header' },
        h('button', {
          type: 'button', class: 'asset-group-toggle', 'aria-expanded': String(open),
          onclick: () => this.toggleGroup(g.id),
        }, h('span', { class: 'chev' }, icon('chevronDown', 12)), h('span', { class: 'asset-group-title' }, g.title),
        all.length ? h('span', { class: 'asset-group-count' }, String(all.length)) : null),
        h('button', {
          type: 'button', class: 'icon-btn small asset-group-add', title: `New ${what}`, 'aria-label': `New ${what}`,
          onclick: () => this.ctx.create(g.create),
        }, icon('plus', 15)));
      let body = null;
      if (open) {
        body = shown.length
          ? h('div', { class: 'asset-rows' }, ...shown.map((e) => this.row(g.id, e)))
          : h('button', { type: 'button', class: 'asset-group-empty', onclick: () => this.ctx.create(g.create) },
            h('span', {}, g.hint), h('strong', {}, icon('plus', 13), `New ${what}`));
      }
      return h('section', { class: `asset-group ${open ? '' : 'collapsed'}` }, header, body);
    }).filter(Boolean);
    return h('div', { class: 'asset-body' }, ...(sections.length ? sections : [h('p', { class: 'asset-none' }, 'Nothing matches your search.')]));
  }

  row(group, entry) {
    const { path, data } = entry;
    const entries = this.ctx.entries();
    let name = baseName(path);
    let meta = '';
    const thumb = h('span', { class: 'asset-thumb' });
    const metaEl = h('span', { class: 'asset-meta' });
    let extra = null;
    const action = (title, iconName, target) => h('button', {
      type: 'button', class: 'asset-row-action', title, 'aria-label': title,
      onclick: (e) => { e.stopPropagation(); this.ctx.open(target); },
    }, icon(iconName, 14));

    if (group === 'scenes') {
      name = name.replace(/\.(scene|map)\.json$|\.lua$/i, '');
      if (SCENE_EXT.test(path)) {
        const map = parseJSON(data);
        const objects = map?.layers?.reduce((n, l) => n + (Array.isArray(l.objects) ? l.objects.length : 0), 0) || 0;
        meta = map ? `${map.width} × ${map.height} tiles · ${objects} object${objects === 1 ? '' : 's'}` : 'Can’t read this scene';
        thumb.classList.add('wide');
        thumb.append(icon('map', 16));
        this.mapThumbnail(path, map).then((url) => { if (url) thumb.replaceChildren(h('img', { src: url, alt: '' })); });
        const script = path.replace(SCENE_EXT, '.lua');
        if (entries.get(script)?.kind === 'file') extra = action(`Open its script (${script})`, 'code', script);
      } else {
        meta = 'Scene made in code';
        thumb.append(icon('code', 16));
      }
    } else if (group === 'objects') {
      name = name.replace(/\.lua$/i, '');
      const info = objectInfo(data);
      meta = info.behaviors.length ? info.behaviors.join(', ') : (info.sprite ? 'Object' : 'Object without a sprite');
      const image = spriteImage(info.sprite, entries);
      if (image) {
        this.spriteThumb(thumb, image);
        extra = action(`Edit its sprite (${image})`, 'image', image);
      } else thumb.append(icon('gamepad', 16));
    } else if (group === 'art') {
      const tileset = this.tilesetFor(path);
      this.spriteThumb(thumb, path, (size, frames, fw, fh) => {
        metaEl.textContent = tileset ? `Tiles · ${size.w} × ${size.h}`
          : frames > 1 ? `${fw} × ${fh} · ${frames} frames` : `${size.w} × ${size.h}`;
      });
      if (tileset) extra = action('Tile properties (which tiles are solid, ...)', 'grid', tileset);
    } else if (group === 'sounds' || group === 'music') {
      const playing = this.playing?.path === path;
      thumb.classList.add('play');
      thumb.append(h('button', {
        type: 'button', class: `asset-play ${playing ? 'playing' : ''}`, title: playing ? 'Stop' : 'Play',
        'aria-label': `${playing ? 'Stop' : 'Play'} ${name}`, onclick: (e) => { e.stopPropagation(); this.togglePlay(path); },
      }, icon(playing ? 'stop' : 'play', 12)));
      name = name.replace(/\.(sfx|song)\.json$/i, '');
      if (/\.sfx\.json$/i.test(path)) {
        const p = parseJSON(data);
        meta = p ? `${formatTime((+p.attack || 0) + (+p.sustain || 0) + (+p.decay || 0))} · ${p.wave || 'square'}` : 'Can’t read this sound';
      } else if (/\.song\.json$/i.test(path)) {
        const s = parseJSON(data);
        if (s) {
          const bpm = +s.bpm || 120;
          const steps = (Array.isArray(s.order) ? s.order.length : 1) * (+s.patternLength || 32);
          meta = `${bpm} bpm · ${formatTime(steps / ((+s.stepsPerBeat || 4) * bpm / 60))}`;
        } else meta = 'Can’t read this song';
      } else {
        meta = `${extOf(path).toUpperCase()} file`;
      }
    } else {
      thumb.append(icon('code', 16));
      const first = typeof data === 'string' ? /^\s*--+\s*(.+)/.exec(data) : null;
      meta = first ? first[1].replace(/^\[\[|\]\]$/g, '').trim() : (path === 'main.lua' ? 'Starts the game' : dirName(path));
    }
    if (meta) metaEl.textContent = meta;

    const el = h('div', { class: 'asset-row', role: 'button', tabindex: '0', title: path, draggable: 'true', dataset: { path } },
      thumb, h('span', { class: 'asset-row-text' }, h('span', { class: 'asset-name' }, name), metaEl), extra);
    const active = this.ctx.active();
    if (active === path || active === path.replace(/\.png$/i, '.sprite.json')) el.classList.add('active');
    if (this.ctx.isDirty(path)) el.classList.add('dirty');
    el.addEventListener('click', () => this.ctx.open(path));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) this.ctx.open(path); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.ctx.menu(path, { x: e.clientX, y: e.clientY }); });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', snippetFor(path));
      e.dataTransfer.effectAllowed = 'copy';
    });
    return el;
  }

  /** The tileset whose image is this PNG, if any. */
  tilesetFor(imagePath) {
    for (const e of this.ctx.entries().values()) {
      if (e.kind !== 'file' || !/\.tileset\.json$/i.test(e.path)) continue;
      const ts = parseJSON(e.data);
      if (ts && typeof ts.image === 'string' && resolvePath(e.path, ts.image) === imagePath) return e.path;
    }
    return null;
  }

  /** Fill thumb with an image's first frame (sprites) or the whole image. */
  spriteThumb(thumb, path, onSize) {
    const data = this.ctx.entries().get(path)?.data;
    if (!(data instanceof Uint8Array)) return;
    const img = h('img', { src: thumbnailUrl(path, data), alt: '', draggable: 'false' });
    thumb.replaceChildren(img);
    this.imageSize(path, data).then((size) => {
      if (!size) return;
      const sprite = parseJSON(this.ctx.entries().get(path.replace(/\.png$/i, '.sprite.json'))?.data);
      const fw = sprite?.frameWidth || size.w;
      const fh = sprite?.frameHeight || size.h;
      const frames = Math.max(1, Math.floor(size.w / fw) * Math.floor(size.h / fh));
      onSize?.(size, frames, fw, fh);
      if (frames > 1) this.firstFrame(path, data, fw, fh).then((url) => { if (url) img.src = url; });
    });
  }

  firstFrame(path, data, fw, fh) {
    const key = `${fw}x${fh}`;
    const cached = this.frameThumbs.get(path);
    if (cached?.data === data && cached.key === key) return Promise.resolve(cached.url);
    return createImageBitmap(new Blob([data], { type: mimeOf(path) }), 0, 0, fw, fh).then((bitmap) => {
      const canvas = document.createElement('canvas');
      canvas.width = fw;
      canvas.height = fh;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      const url = canvas.toDataURL();
      this.frameThumbs.set(path, { data, key, url });
      return url;
    }).catch(() => null);
  }

  imageSize(path, data) {
    const cached = this.imageSizes.get(path);
    if (cached?.data === data) return Promise.resolve(cached);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = { data, w: img.naturalWidth, h: img.naturalHeight };
        this.imageSizes.set(path, size);
        resolve(size);
      };
      img.onerror = () => resolve(null);
      img.src = thumbnailUrl(path, data);
    });
  }

  /** A small picture of a scene's start: its tile layers drawn from their tilesets. */
  async mapThumbnail(path, map) {
    if (!map || !Array.isArray(map.layers)) return null;
    const entries = this.ctx.entries();
    const tilesets = (Array.isArray(map.tilesets) ? map.tilesets : []).map((ref) => {
      const tsPath = resolvePath(path, String(ref));
      const ts = parseJSON(entries.get(tsPath)?.data);
      const imagePath = ts && typeof ts.image === 'string' ? resolvePath(tsPath, ts.image) : null;
      return { ts, imagePath, image: imagePath ? entries.get(imagePath)?.data : null };
    });
    const key = [entries.get(path)?.data, ...tilesets.flatMap((t) => [t.ts && JSON.stringify(t.ts), t.image])];
    const cached = this.mapThumbs.get(path);
    if (cached && cached.key.length === key.length && cached.key.every((k, i) => k === key[i])) return cached.url;

    const tw = map.tileWidth || 16;
    const th = map.tileHeight || 16;
    const pw = (map.width || 1) * tw;
    const ph = (map.height || 1) * th;
    const viewW = Math.min(pw, ph * 2); // the start of the scene, at most 2:1 wide
    const scale = Math.min(1, 96 / viewW, 48 / ph);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewW * scale));
    canvas.height = Math.max(1, Math.round(ph * scale));
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (typeof map.background === 'string') {
      g.fillStyle = map.background;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    let first = 0;
    const sheets = [];
    for (const t of tilesets) {
      let bitmap = null;
      if (t.image instanceof Uint8Array) {
        try { bitmap = await createImageBitmap(new Blob([t.image], { type: mimeOf(t.imagePath) })); } catch { bitmap = null; }
      }
      const stw = t.ts?.tileWidth || 16;
      const sth = t.ts?.tileHeight || 16;
      const cols = bitmap ? Math.max(1, Math.floor(bitmap.width / stw)) : 1;
      const count = bitmap ? cols * Math.max(1, Math.floor(bitmap.height / sth)) : 0;
      sheets.push({ bitmap, stw, sth, cols, first, count });
      first += count;
    }
    for (const layer of map.layers) {
      if (layer?.type !== 'tiles' || layer.visible === false || !Array.isArray(layer.data)) continue;
      layer.data.forEach((tile, i) => {
        if (!(tile >= 0)) return;
        const x = (i % map.width) * tw;
        if (x >= viewW) return;
        const sheet = sheets.find((s) => tile >= s.first && tile < s.first + s.count);
        if (!sheet?.bitmap) return;
        const local = tile - sheet.first;
        const y = Math.floor(i / map.width) * th;
        g.drawImage(sheet.bitmap, (local % sheet.cols) * sheet.stw, Math.floor(local / sheet.cols) * sheet.sth, sheet.stw, sheet.sth,
          x * scale, y * scale, tw * scale, th * scale);
      });
    }
    for (const s of sheets) s.bitmap?.close();
    const url = canvas.toDataURL();
    this.mapThumbs.set(path, { key, url });
    return url;
  }

  stopPlaying() {
    if (!this.playing) return;
    try { this.playing.stop(); } catch { /* already stopped */ }
    this.playing = null;
  }

  async togglePlay(path) {
    const was = this.playing?.path;
    this.stopPlaying();
    if (was === path) { this.render(); return; }
    const entries = this.ctx.entries();
    const data = entries.get(path)?.data;
    const done = () => { if (this.playing?.path === path) { this.playing = null; this.render(); } };
    try {
      if (AUDIO_EXT.test(path)) {
        const url = URL.createObjectURL(new Blob([data], { type: mimeOf(path) }));
        const audio = new Audio(url);
        audio.onended = done;
        await audio.play();
        this.playing = { path, stop: () => { audio.pause(); URL.revokeObjectURL(url); } };
      } else {
        this.playing = { path, stop: () => {} }; // shows as playing while it renders
        this.render();
        const synth = await this.ctx.synth();
        if (this.playing?.path !== path) return;
        let samples;
        if (/\.sfx\.json$/i.test(path)) samples = synth.renderSfx(JSON.parse(data));
        else {
          samples = synth.renderSong(JSON.parse(data), (ref) => {
            const text = entries.get(resolvePath(path, ref))?.data;
            return typeof text === 'string' ? parseJSON(text) : null;
          });
        }
        if (this.playing?.path !== path) return;
        const handle = synth.play(samples);
        const timer = setTimeout(done, samples.length / synth.sampleRate * 1000 + 50);
        this.playing = { path, stop: () => { clearTimeout(timer); handle.stop(); } };
      }
    } catch (e) {
      this.playing = null;
      this.ctx.toast?.(`Couldn’t play ${baseName(path)}: ${e.message}`);
    }
    this.render();
  }
}
