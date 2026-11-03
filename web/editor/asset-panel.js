// The side panel's asset views (Code, Art, Maps, Sounds, Music): the project's
// files of one kind as cards or rows, with thumbnails, map previews, sound
// previews, search and quick-create. The Files view is the file tree itself.

import { h, icon, showMenu } from './ui.js';
import { baseName, dirName, extOf, kindOf, mimeOf } from './file-types.js';
import { snippetFor, thumbnailUrl } from './file-tree.js';
import { resolvePath } from './references.js';

const AUDIO_EXT = /\.(ogg|oga|opus|wav|mp3|flac|m4a|aac)$/i;
const CODE_EXT = /\.(lua|glsl|frag|vert|fs|vs|shader|hlsl)$/i;

/**
 * Each view: which files it lists, how (cards or rows), what "+ New" makes
 * (labels of tools' newAssets, or 'script'), and what to say when it's empty.
 */
export const VIEWS = {
  files: { title: 'Files', icon: 'folder' },
  code: {
    title: 'Code', icon: 'code', layout: 'rows', create: ['script'], byFolder: true,
    match: (p) => CODE_EXT.test(p),
    empty: ['No scripts yet', 'Lua files hold your game’s logic. main.lua runs first.'],
  },
  art: {
    title: 'Art', icon: 'image', layout: 'cards', create: ['Sprite'],
    match: (p, data) => data instanceof Uint8Array && kindOf(p, data) === 'image',
    empty: ['No art yet', 'Draw characters, items and tiles in the pixel editor.'],
  },
  maps: {
    title: 'Maps', icon: 'map', layout: 'cards', create: ['Map', 'Tileset'],
    match: (p) => /\.(map|tileset)\.json$/i.test(p),
    groups: [['Maps', (p) => /\.map\.json$/i.test(p)], ['Tilesets', (p) => /\.tileset\.json$/i.test(p)]],
    empty: ['No maps yet', 'Make a tileset from your art, then paint levels with it.'],
  },
  sounds: {
    title: 'Sounds', icon: 'wave', layout: 'rows', create: ['Sound effect'], importable: true,
    match: (p) => /\.sfx\.json$/i.test(p) || (AUDIO_EXT.test(p) && !/(^|\/)music\//i.test(p)),
    empty: ['No sounds yet', 'Make jumps, coins and explosions with the sound effect editor.'],
  },
  music: {
    title: 'Music', icon: 'music', layout: 'rows', create: ['Song'], importable: true,
    match: (p) => /\.song\.json$/i.test(p) || (AUDIO_EXT.test(p) && /(^|\/)music\//i.test(p)),
    empty: ['No music yet', 'Write songs with the music editor: patterns, instruments and an arrangement.'],
  },
};

const CREATE_LABELS = { script: 'Script', Sprite: 'Sprite', Map: 'Map', Tileset: 'Tileset', 'Sound effect': 'Sound', Song: 'Song' };

const parseJSON = (text) => {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
};

const formatTime = (s) => (s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export class AssetPanel {
  /**
   * ctx: {
   *   entries(): Map<path, entry>, active(): path|null, isDirty(path),
   *   open(path), menu(path, point), create(label), importFiles(), synth(): Promise
   * }
   */
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.view = null;
    this.queries = {};
    this.imageSizes = new Map(); // path -> {data, w, h}
    this.mapThumbs = new Map(); // path -> {key, url}
    this.playing = null; // {path, stop()}
    this.renderQueued = false;
  }

  setView(view) {
    if (this.view === view) return;
    this.stopPlaying();
    this.view = view;
    this.render();
  }

  /** Re-render soon (several changes in a row cause one render). */
  refresh() {
    if (this.renderQueued || !this.view || this.view === 'files') return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  files() {
    const spec = VIEWS[this.view];
    const q = (this.queries[this.view] || '').trim().toLowerCase();
    return [...this.ctx.entries().values()]
      .filter((e) => e.kind === 'file' && spec.match(e.path, e.data))
      .filter((e) => !q || e.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  }

  render() {
    const spec = VIEWS[this.view];
    if (!spec || this.view === 'files') return;
    const all = [...this.ctx.entries().values()].filter((e) => e.kind === 'file' && spec.match(e.path, e.data));
    const files = this.files();

    const search = h('input', {
      class: 'input small asset-search', type: 'search', placeholder: `Search ${spec.title.toLowerCase()}`,
      'aria-label': `Search ${spec.title.toLowerCase()}`, value: this.queries[this.view] || '', spellcheck: 'false',
    });
    search.addEventListener('input', () => {
      this.queries[this.view] = search.value;
      const body = this.root.querySelector('.asset-body');
      body?.replaceWith(this.renderBody(this.files(), all.length));
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; search.dispatchEvent(new Event('input')); }
    });

    const nameOf = (label) => CREATE_LABELS[label] || label;
    const createButtons = spec.create.length === 1
      ? [h('button', {
        type: 'button', class: 'btn small asset-create', title: `New ${nameOf(spec.create[0]).toLowerCase()}`,
        onclick: () => this.ctx.create(spec.create[0]),
      }, icon('plus', 14), nameOf(spec.create[0]))]
      : [h('button', {
        type: 'button', class: 'btn small asset-create', title: 'New', 'aria-haspopup': 'menu',
        onclick: (e) => showMenu(e.currentTarget, spec.create.map((label) => ({
          label: nameOf(label), icon: label === 'Tileset' ? 'grid' : spec.icon, action: () => this.ctx.create(label),
        }))),
      }, icon('plus', 14), 'New', icon('chevronDown', 12))];
    const importBtn = spec.importable ? h('button', {
      type: 'button', class: 'icon-btn small', title: 'Import audio files', 'aria-label': 'Import audio files',
      onclick: () => this.ctx.importFiles(),
    }, icon('upload', 15)) : null;

    const hadFocus = document.activeElement?.classList.contains('asset-search');
    this.root.replaceChildren(
      h('div', { class: 'asset-toolbar' }, search, ...createButtons, importBtn),
      this.renderBody(files, all.length),
    );
    if (hadFocus) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  renderBody(files, total) {
    const spec = VIEWS[this.view];
    if (!total) {
      return h('div', { class: 'asset-body asset-empty' },
        h('span', { class: 'asset-empty-icon' }, icon(spec.icon, 28)),
        h('strong', {}, spec.empty[0]),
        h('p', {}, spec.empty[1]),
        ...spec.create.map((label) => h('button', { type: 'button', class: 'btn primary small', onclick: () => this.ctx.create(label) },
          icon('plus', 14), `New ${(CREATE_LABELS[label] || label).toLowerCase()}`)));
    }
    if (!files.length) return h('div', { class: 'asset-body asset-empty' }, h('p', {}, 'Nothing matches your search.'));

    let groups = [[null, files]];
    if (spec.groups) {
      groups = spec.groups.map(([title, test]) => [title, files.filter((e) => test(e.path))]).filter(([, list]) => list.length);
    } else if (spec.byFolder) {
      const folders = new Map();
      for (const e of files) {
        const dir = dirName(e.path);
        if (!folders.has(dir)) folders.set(dir, []);
        folders.get(dir).push(e);
      }
      // Top-level files first, then folders in order.
      groups = [...folders].sort(([a], [b]) => (b === '') - (a === '') || a.localeCompare(b))
        .map(([dir, list]) => [folders.size > 1 ? (dir ? `${dir}/` : 'Top level') : null, list]);
    }
    return h('div', { class: 'asset-body' }, ...groups.map(([title, list]) => h('section', { class: 'asset-group' },
      title ? h('h3', { class: 'asset-group-title' }, title, h('span', {}, String(list.length))) : null,
      h('div', { class: spec.layout === 'cards' ? 'asset-grid' : 'asset-rows' },
        ...list.map((e) => (spec.layout === 'cards' ? this.card(e) : this.row(e)))))));
  }

  /** Common behaviour of a card or row: open, context menu, drag into code. */
  item(el, entry) {
    const { path } = entry;
    el.dataset.path = path;
    el.title = path;
    el.draggable = true;
    const active = this.ctx.active();
    if (active === path || active === path.replace(/\.png$/i, '.sprite.json')) el.classList.add('active');
    if (this.ctx.isDirty(path)) el.classList.add('dirty');
    el.addEventListener('click', (e) => { if (!e.target.closest('.asset-play')) this.ctx.open(path); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) this.ctx.open(path); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.ctx.menu(path, { x: e.clientX, y: e.clientY }); });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', snippetFor(path));
      e.dataTransfer.effectAllowed = 'copy';
    });
    return el;
  }

  card(entry) {
    const { path, data } = entry;
    const name = baseName(path).replace(/\.(map|tileset)\.json$/i, '');
    const thumb = h('div', { class: 'asset-thumb' });
    const meta = h('span', { class: 'asset-meta' });
    const el = h('div', { class: 'asset-card', role: 'button', tabindex: '0' }, thumb,
      h('span', { class: 'asset-name' }, name), meta);

    if (/\.map\.json$/i.test(path)) {
      const map = parseJSON(data);
      meta.textContent = map ? `${map.width} × ${map.height} tiles` : 'Invalid map';
      this.mapThumbnail(path, map).then((url) => {
        if (url) thumb.append(h('img', { src: url, alt: '', draggable: 'false' }));
        else thumb.append(icon('map', 22));
      });
    } else if (/\.tileset\.json$/i.test(path)) {
      const ts = parseJSON(data);
      const imagePath = ts && typeof ts.image === 'string' ? resolvePath(path, ts.image) : null;
      const image = imagePath && this.ctx.entries().get(imagePath)?.data;
      if (image instanceof Uint8Array) thumb.append(h('img', { src: thumbnailUrl(imagePath, image), alt: '', draggable: 'false' }));
      else thumb.append(icon('grid', 22));
      meta.textContent = ts ? `${ts.tileWidth || 16} × ${ts.tileHeight || 16} tiles` : 'Invalid tileset';
    } else {
      thumb.append(h('img', { src: thumbnailUrl(path, data), alt: '', draggable: 'false' }));
      this.imageSize(path, data).then((size) => {
        if (!size) return;
        const sprite = parseJSON(this.ctx.entries().get(path.replace(/\.png$/i, '.sprite.json'))?.data);
        const fw = sprite?.frameWidth || size.w;
        const fh = sprite?.frameHeight || size.h;
        const frames = Math.max(1, Math.floor(size.w / fw) * Math.floor(size.h / fh));
        meta.textContent = frames > 1 ? `${fw} × ${fh} · ${frames} frames` : `${size.w} × ${size.h}`;
        if (frames > 1) {
          const img = thumb.querySelector('img');
          this.firstFrame(path, data, fw, fh).then((url) => { if (url && img) img.src = url; });
        }
      });
    }
    return this.item(el, entry);
  }

  row(entry) {
    const { path, data } = entry;
    const isSfx = /\.sfx\.json$/i.test(path);
    const isSong = /\.song\.json$/i.test(path);
    const isAudio = AUDIO_EXT.test(path);
    let lead;
    let name = baseName(path);
    let meta = dirName(path);
    if (isSfx || isSong || isAudio) {
      const playing = this.playing?.path === path;
      lead = h('button', {
        type: 'button', class: `asset-play ${playing ? 'playing' : ''}`, title: playing ? 'Stop' : 'Play',
        'aria-label': `${playing ? 'Stop' : 'Play'} ${name}`, onclick: () => this.togglePlay(path),
      }, icon(playing ? 'stop' : 'play', 13));
      name = name.replace(/\.(sfx|song)\.json$/i, '');
      if (isSfx) {
        const p = parseJSON(data);
        meta = p ? `${formatTime((+p.attack || 0) + (+p.sustain || 0) + (+p.decay || 0))} · ${p.wave || 'square'}` : 'Invalid sound';
      } else if (isSong) {
        const s = parseJSON(data);
        if (s) {
          const bpm = +s.bpm || 120;
          const steps = (Array.isArray(s.order) ? s.order.length : 1) * (+s.patternLength || 32);
          meta = `${bpm} bpm · ${formatTime(steps / ((+s.stepsPerBeat || 4) * bpm / 60))}`;
        } else meta = 'Invalid song';
      } else {
        meta = `${extOf(path).toUpperCase()} · ${(data.byteLength / 1024).toFixed(0)} KB`;
      }
    } else {
      lead = h('span', { class: 'asset-row-icon' }, icon('code', 16));
      // A script's first comment says what it is.
      const first = typeof data === 'string' ? /^\s*--+\s*(.+)/.exec(data) : null;
      const dir = dirName(path);
      meta = first ? first[1].replace(/^\[\[|\]\]$/g, '').trim() : (dir ? `${dir}/` : `${data.split('\n').length} lines`);
    }
    const el = h('div', { class: 'asset-row', role: 'button', tabindex: '0' }, lead,
      h('span', { class: 'asset-row-text' }, h('span', { class: 'asset-name' }, name), h('span', { class: 'asset-meta' }, meta)));
    return this.item(el, entry);
  }

  /** A sprite sheet's first frame, as a data URL (cached per image data). */
  firstFrame(path, data, fw, fh) {
    const key = `${fw}x${fh}`;
    const cached = this.frameThumbs?.get(path);
    if (cached?.data === data && cached.key === key) return Promise.resolve(cached.url);
    this.frameThumbs ??= new Map();
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

  /** A small picture of a map: every visible tile layer drawn from its tilesets. */
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
    const scale = Math.min(1, 240 / pw, 135 / ph);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(pw * scale));
    canvas.height = Math.max(1, Math.round(ph * scale));
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = scale < 0.5;
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
        const sheet = sheets.find((s) => tile >= s.first && tile < s.first + s.count);
        if (!sheet?.bitmap) return;
        const local = tile - sheet.first;
        const x = (i % map.width) * tw;
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
