// Music editor: opens .song.json files (docs/reference.md, "Songs"). A piano
// roll for one channel of one pattern at a time, with the channels,
// patterns, instruments and the arrangement (order list) around it.
// Playback renders the song with the editor's synthesizer (host.synth()), so
// it sounds exactly like the game.

import { WAVES, noteName, normalizeSfx } from '../sfx/params.js';
import {
  loadStyle, SynthState, synthBanner, Player, cssVar, onThemeChange, fitCanvas, History,
  modHeld, typingTarget, dirName, resolvePath, relativePath, waveIcon, isMac, createSlider, disclosure, SHARED_STYLE,
} from '../sfx/audio.js';
import {
  SYNTH_PARAMS, SYNTH_DEFAULTS, LIMITS, parseSong, songText, defaultSong, normalizeInstrument,
} from './song.js';

loadStyle(SHARED_STYLE);
loadStyle(new URL('./music.css', import.meta.url));

const LOW = 24; // C1, the lowest row shown
const HIGH = 108; // C8
const KEY_W = 46;
const RULER_H = 22;
const VEL_H = 56;
const EDGE = 6; // px at a note's right end that resize it
const ZOOM_X = [8, 64];
const ZOOM_Y = [7, 24];

// Data colors come from the project's default palette (Sweetie 16).
const INK = '#1a1c2c'; // Sweetie 16 black: shading, outlines and note labels
const CHANNEL_COLORS = ['#41a6f6', '#ef7d57', '#38b764', '#ffcd75', '#b13e53', '#73eff7', '#a7f070', '#3b5dc9'];
const channelColor = (i) => CHANNEL_COLORS[i % CHANNEL_COLORS.length];

/** True when the editor background is dark (for piano key shading). */
function darkBackground(el) {
  const m = cssVar(el, '--editor-bg', '#000').match(/^#([0-9a-f]{6})$/i);
  let rgb;
  if (m) rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  else rgb = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128;
}
const isBlack = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Notes copied with Ctrl+C, shared between open songs. */
let clipboard = null;

// Small icons the shared set doesn't have.
function svgIcon(body, size = 16) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return span;
}
const ICON = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  select: '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  loop: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
};
const ico = (name, size) => svgIcon(ICON[name], size);

class MusicEditor {
  constructor(host) {
    this.host = host;
    this.ui = host.ui;
    const text = host.read(host.path);
    this.song = parseSong(typeof text === 'string' ? text : '');
    this.savedText = songText(this.song);

    this.slot = 0;
    this.pattern = this.song.order[0] ?? 0;
    this.channel = 0;
    this.selection = new Set();
    this.mode = 'draw';
    this.stepW = 24;
    this.rowH = 12;
    this.lastLength = 2;
    this.cursorStep = null;
    this.hover = null; // {midi, step}
    this.drag = null;
    this.box = null;
    this.muted = new Set();
    this.solo = new Set();
    this.playing = null; // {mode, seg, start, next}
    this.playStep = null;
    this.playSlot = null;
    this.handled = new WeakSet();
    this.previewSeq = 0;

    this.history = new History({
      snapshot: () => JSON.stringify(this.song),
      restore: (s) => {
        this.song = JSON.parse(s);
        this.selection.clear();
        this.clampView();
        this.refreshAll();
        this.updateDirty();
      },
    });

    this.synth = new SynthState(host, () => this.onSynthStatus());
    this.player = new Player(this.synth);
    this.notePlayer = new Player(this.synth);
    this.build();
    this.unwatchTheme = onThemeChange(() => this.draw());
  }

  get pat() { return this.song.patterns[this.pattern]; }
  get L() { return this.song.patternLength; }
  get stepDur() { return 60 / this.song.bpm / this.song.stepsPerBeat; }

  clampView() {
    const s = this.song;
    this.pattern = clamp(this.pattern, 0, s.patterns.length - 1);
    this.channel = clamp(this.channel, 0, s.channels.length - 1);
    this.slot = clamp(this.slot, 0, s.order.length - 1);
    s.loopStart = clamp(s.loopStart, 0, s.order.length - 1);
  }

  // -------------------------------------------------------------------------
  // Building the UI

  build() {
    const { h, icon } = this.ui;
    const mod = isMac ? '⌘' : 'Ctrl+';

    this.btnPlaySong = h('button', { type: 'button', class: 'btn small mus-play mus-play-song', onclick: () => this.togglePlay('song') });
    this.btnPlayPattern = h('button', { type: 'button', class: 'btn small ghost mus-play', onclick: () => this.togglePlay('pattern') });

    const numField = (label, key, title) => {
      const [min, max] = LIMITS[key];
      const input = h('input', { type: 'number', class: 'input small mus-num', min, max, step: '1', title, 'aria-label': label });
      input.addEventListener('change', () => this.setSongField(key, input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { input.blur(); this.element.focus(); } });
      return { input, el: h('label', { class: 'mus-field', title }, h('span', {}, label), input) };
    };
    this.fBpm = numField('Tempo', 'bpm', 'Tempo in beats per minute (BPM)');

    this.modeButtons = {
      draw: h('button', { type: 'button', title: 'Draw notes: click to add, drag to set the length, right-click to erase (B)', onclick: () => this.setMode('draw') }, icon('pencil', 13), 'Draw'),
      select: h('button', { type: 'button', title: 'Select notes: drag a box around them, or Shift+drag in Draw (S)', onclick: () => this.setMode('select') }, ico('select', 13), 'Select'),
    };
    this.btnUndo = h('button', { type: 'button', class: 'icon-btn small', title: `Undo (${mod}Z)`, 'aria-label': 'Undo', onclick: () => this.history.undo() }, ico('undo'));
    this.btnRedo = h('button', { type: 'button', class: 'icon-btn small', title: `Redo (${mod}Shift+Z)`, 'aria-label': 'Redo', onclick: () => this.history.redo() }, ico('redo'));

    const moreBtn = h('button', {
      type: 'button', class: 'icon-btn small', title: 'More: pattern length, grid, zoom', 'aria-label': 'More song settings',
      onclick: () => this.songMenu(moreBtn),
    }, icon('more', 16));

    const toolbar = h('div', { class: 'snd-toolbar mus-toolbar' },
      this.btnPlaySong, this.btnPlayPattern,
      h('span', { class: 'snd-sep' }),
      this.fBpm.el,
      h('span', { class: 'snd-sep' }),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Mouse mode' }, this.modeButtons.draw, this.modeButtons.select),
      h('span', { class: 'snd-spacer' }),
      this.btnUndo, this.btnRedo,
      h('span', { class: 'snd-sep' }),
      h('button', { type: 'button', class: 'icon-btn small', title: 'Zoom out (Ctrl+wheel)', 'aria-label': 'Zoom out', onclick: () => this.zoom(1 / 1.25) }, ico('zoomOut')),
      h('button', { type: 'button', class: 'icon-btn small', title: 'Zoom in (Ctrl+wheel)', 'aria-label': 'Zoom in', onclick: () => this.zoom(1.25) }, ico('zoomIn')),
      moreBtn,
    );

    this.banner = synthBanner(this.ui, this.synth);

    // Sidebar
    this.channelList = h('div', { class: 'mus-list' });
    this.patternList = h('div', { class: 'mus-list' });
    this.instrumentPanel = h('div', { class: 'mus-instrument' });
    const section = (title, actions, body) => h('section', { class: 'mus-section' },
      h('div', { class: 'mus-section-head' }, h('span', { class: 'snd-heading' }, title), h('span', { class: 'snd-spacer' }), ...actions),
      body);
    const addBtn = (title, onclick) => h('button', { type: 'button', class: 'icon-btn small', title, 'aria-label': title, onclick }, icon('plus', 14));
    this.instrumentMore = h('button', {
      type: 'button', class: 'icon-btn small', title: 'New, duplicate or delete instruments', 'aria-label': 'Instrument actions',
      onclick: (e) => this.instrumentMenu(e.currentTarget),
    }, icon('more', 14));
    this.insDisclosure = disclosure(this.ui, {
      key: 'smitten.music.instrument',
      label: 'Edit instrument',
      body: this.instrumentPanel,
      onToggle: (open) => { this.instrumentMore.hidden = !open; },
    });
    this.insDisclosure.button.title = 'Change how the selected channel’s instrument sounds';
    const sidebar = h('div', { class: 'mus-sidebar' },
      section('Channels', [addBtn('Add a channel', () => this.addChannel())], this.channelList),
      section('Patterns', [addBtn('Add a pattern', () => this.addPattern())], this.patternList),
      h('section', { class: 'mus-section mus-ins-section' },
        h('div', { class: 'mus-section-head' }, this.insDisclosure.button, this.instrumentMore),
        this.instrumentPanel),
    );

    // Piano roll
    this.canvas = h('canvas', { class: 'mus-canvas' });
    this.sizer = h('div', { class: 'mus-sizer' });
    this.scroller = h('div', { class: 'mus-scroll' }, this.sizer);
    this.scroller.style.left = `${KEY_W}px`;
    this.scroller.style.top = `${RULER_H}px`;
    this.scroller.style.bottom = `${VEL_H}px`;
    this.emptyHint = h('div', { class: 'mus-empty-hint' }, h('div', { class: 'mus-empty-card' },
      h('strong', {}, 'Click the grid to add notes'),
      h('span', {}, 'Drag to make a note longer · right-click to erase · Space to play')));
    this.emptyHint.style.left = `${KEY_W}px`;
    this.emptyHint.style.top = `${RULER_H}px`;
    this.emptyHint.style.bottom = `${VEL_H}px`;
    this.roll = h('div', { class: 'mus-roll' }, this.canvas, this.scroller, this.emptyHint);

    // Status bar under the roll: hover info and the selection's volume.
    this.hoverInfo = h('span', { class: 'mus-hover' });
    this.selInfo = h('span', { class: 'mus-sel-info' });
    this.selVolume = h('input', { type: 'range', class: 'snd-range mus-sel-volume', min: '0', max: '100', step: '1', 'aria-label': 'Volume of the selected notes' });
    this.selVolumeText = h('span', { class: 'mus-sel-text' });
    this.selVolume.addEventListener('input', () => {
      this.history.record('selVolume');
      const v = Number(this.selVolume.value) / 100;
      for (const n of this.selection) n.volume = v;
      this.selVolumeText.textContent = `${Math.round(v * 100)}%`;
      this.touch();
    });
    this.selVolume.addEventListener('change', () => this.history.settle());
    this.selBox = h('span', { class: 'mus-sel' }, this.selInfo, h('span', { class: 'mus-sel-label' }, 'Volume'), this.selVolume, this.selVolumeText);
    this.channelInfo = h('span', { class: 'mus-channel-info' });
    const status = h('div', { class: 'mus-status' }, this.channelInfo, this.hoverInfo, h('span', { class: 'snd-spacer' }), this.selBox);

    // Arrangement
    this.loopBtn = h('button', { type: 'button', class: 'btn small ghost mus-loop', title: 'Loop the song when it ends (right-click a slot to choose where it loops back to)', onclick: () => this.toggleLoop() }, ico('loop', 14), 'Loop');
    this.slotList = h('div', { class: 'mus-slots' });
    const arrange = h('div', { class: 'mus-arrange' },
      h('div', { class: 'mus-arrange-head' }, h('span', { class: 'snd-heading' }, 'Arrangement'), this.loopBtn),
      this.slotList);

    const main = h('div', { class: 'mus-main' }, this.roll, status, arrange);
    const body = h('div', { class: 'mus-body' }, sidebar, main);
    this.element = h('div', { class: 'snd-tool mus-tool', tabindex: '-1' }, toolbar, this.banner.element, body);

    this.element.addEventListener('keydown', (e) => { if (this.handleKey(e)) { e.preventDefault(); e.stopPropagation(); } });
    this.scroller.addEventListener('scroll', () => this.draw());
    this.scroller.addEventListener('pointerdown', (e) => this.gridDown(e));
    this.scroller.addEventListener('pointermove', (e) => this.gridMove(e));
    this.scroller.addEventListener('pointerup', (e) => this.gridUp(e));
    this.scroller.addEventListener('pointercancel', (e) => this.gridUp(e));
    this.scroller.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.renderHover(); this.draw(); } });
    this.scroller.addEventListener('contextmenu', (e) => e.preventDefault());
    this.scroller.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => this.canvasDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.canvasMove(e));
    this.canvas.addEventListener('pointerup', () => this.canvasUp());
    this.canvas.addEventListener('pointercancel', () => this.canvasUp());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.altKey) { this.onWheel(e); return; }
      this.scroller.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX;
      this.scroller.scrollTop += e.shiftKey ? 0 : e.deltaY;
    }, { passive: false });

    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.roll);

    this.setMode('draw');
    this.refreshAll();
    this.onSynthStatus();
    this.scrollToNotes();
  }

  refreshAll() {
    this.renderToolbar();
    this.renderChannels();
    this.renderPatterns();
    this.renderInstrument();
    this.renderOrder();
    this.renderStatus();
    this.updateSizer();
    this.draw();
  }

  renderToolbar() {
    const s = this.song;
    if (document.activeElement !== this.fBpm.input) this.fBpm.input.value = String(s.bpm);
    this.btnUndo.disabled = !this.history.canUndo;
    this.btnRedo.disabled = !this.history.canRedo;
    const ready = this.synth.ready;
    this.btnPlayPattern.disabled = !ready;
    this.btnPlaySong.disabled = !ready;
    const { icon } = this.ui;
    const songOn = this.playing?.mode === 'song';
    const patOn = this.playing?.mode === 'pattern';
    if (this.btnPlaySong.dataset.state !== String(songOn)) {
      this.btnPlaySong.dataset.state = String(songOn);
      this.btnPlaySong.replaceChildren(icon(songOn ? 'stop' : 'play', 13), songOn ? 'Stop' : 'Play song');
      this.btnPlaySong.title = songOn ? 'Stop (Escape)' : 'Play the whole song from the start (Shift+Space)';
    }
    if (this.btnPlayPattern.dataset.state !== String(patOn)) {
      this.btnPlayPattern.dataset.state = String(patOn);
      this.btnPlayPattern.replaceChildren(icon(patOn ? 'stop' : 'play', 13), patOn ? 'Stop' : 'Play pattern');
      this.btnPlayPattern.title = patOn ? 'Stop (Escape)' : 'Loop the pattern you are editing (Space)';
    }
    this.btnPlaySong.classList.toggle('active', songOn);
    this.btnPlayPattern.classList.toggle('active', patOn);
    this.loopBtn.setAttribute('aria-pressed', String(!!s.loop));
  }

  songMenu(anchor) {
    const s = this.song;
    this.ui.showMenu(anchor, [
      { label: `Pattern length: ${s.patternLength} steps…`, icon: 'sliders', action: () => this.songSettingsDialog() },
      { label: `Grid: ${s.stepsPerBeat} steps per beat…`, icon: 'grid', action: () => this.songSettingsDialog() },
      '-',
      { label: 'Zoom in', icon: 'search', shortcut: 'Ctrl+wheel', action: () => this.zoom(1.25) },
      { label: 'Zoom out', shortcut: 'Ctrl+wheel', action: () => this.zoom(1 / 1.25) },
      { label: 'Taller rows', shortcut: 'Alt+wheel', action: () => this.zoomY(1.25) },
      { label: 'Shorter rows', shortcut: 'Alt+wheel', action: () => this.zoomY(1 / 1.25) },
    ]);
  }

  /** Steps per beat and pattern length, which beginners rarely need. */
  async songSettingsDialog() {
    const { h } = this.ui;
    const s = this.song;
    const field = (label, key, hint) => {
      const [min, max] = LIMITS[key];
      const input = h('input', { type: 'number', class: 'input', min, max, step: '1', value: String(s[key]) });
      return { key, input, el: h('label', { class: 'field' }, h('span', { class: 'mus-form-label' }, label), input, h('span', { class: 'mus-form-hint' }, hint)) };
    };
    const fields = [
      field('Pattern length (steps)', 'patternLength', 'How many steps each pattern has.'),
      field('Steps per beat', 'stepsPerBeat', 'The grid: 4 means each beat is split into four steps.'),
    ];
    const res = await this.ui.openDialog({
      title: 'Song settings',
      body: h('div', { class: 'mus-form' }, ...fields.map((f) => f.el)),
      actions: [
        { label: 'Cancel', value: null, ghost: true },
        { label: 'Apply', value: 'ok', primary: true, submit: true },
      ],
      onOpen: () => { fields[0].input.focus(); fields[0].input.select(); },
    });
    if (res === 'ok') for (const f of fields) this.setSongField(f.key, f.input.value);
    this.element.focus({ preventScroll: true });
  }

  setMode(mode) {
    this.mode = mode;
    for (const [m, b] of Object.entries(this.modeButtons)) b.setAttribute('aria-pressed', String(m === mode));
    this.scroller.classList.toggle('select-mode', mode === 'select');
  }

  // ---- Channels

  renderChannels() {
    const { h, icon } = this.ui;
    const s = this.song;
    this.channelList.replaceChildren(...s.channels.map((ch, i) => {
      const audible = this.audible(i);
      const mute = h('button', {
        type: 'button', class: 'mus-ms', title: 'Mute this channel while you listen here (the song file is not changed)', 'aria-label': 'Mute', 'aria-pressed': String(this.muted.has(i)),
        onclick: (e) => { e.stopPropagation(); this.toggleSet(this.muted, i); },
      }, 'M');
      const solo = h('button', {
        type: 'button', class: 'mus-ms solo', title: 'Solo: hear only this channel while you listen here', 'aria-label': 'Solo', 'aria-pressed': String(this.solo.has(i)),
        onclick: (e) => { e.stopPropagation(); this.toggleSet(this.solo, i); },
      }, 'S');
      const select = h('select', { class: 'select small mus-ch-ins', 'aria-label': `${ch.name} instrument`, title: 'Instrument this channel plays' },
        ...s.instruments.map((ins, j) => h('option', { value: String(j), selected: j === ch.instrument }, ins.name || `Instrument ${j + 1}`)));
      select.addEventListener('click', (e) => e.stopPropagation());
      select.addEventListener('change', () => {
        this.edit(() => { ch.instrument = Number(select.value); });
        this.channel = i;
        this.refreshAll();
      });
      const vol = h('input', { type: 'range', class: 'snd-range mus-ch-vol', min: '0', max: '100', step: '1', value: String(Math.round(ch.volume * 100)), 'aria-label': `${ch.name} volume`, title: `Volume ${Math.round(ch.volume * 100)}%` });
      vol.addEventListener('click', (e) => e.stopPropagation());
      vol.addEventListener('input', () => {
        this.history.record(`chvol:${i}`);
        ch.volume = Number(vol.value) / 100;
        vol.title = `Volume ${vol.value}%`;
        this.updateDirty();
      });
      vol.addEventListener('change', () => this.history.settle());
      vol.addEventListener('dblclick', () => { this.edit(() => { ch.volume = 0.8; }); this.renderChannels(); });
      vol.title = `Channel volume ${Math.round(ch.volume * 100)}% (double-click to reset)`;
      const more = h('button', {
        type: 'button', class: 'icon-btn small mus-more', title: 'Rename, move or remove this channel', 'aria-label': 'Channel actions',
        onclick: (e) => { e.stopPropagation(); this.channelMenu(i, e.currentTarget); },
      }, icon('more', 14));
      const count = this.pat.notes.filter((n) => n.channel === i).length;
      const row = h('div', {
        class: `mus-ch ${i === this.channel ? 'selected' : ''} ${audible ? '' : 'silent'} ${this.muted.has(i) || this.solo.has(i) ? 'ms-on' : ''}`,
        style: { '--ch': channelColor(i) },
        onclick: () => this.selectChannel(i),
        oncontextmenu: (e) => { e.preventDefault(); this.channelMenu(i, { x: e.clientX, y: e.clientY }); },
      },
      h('div', { class: 'mus-ch-top' },
        h('span', { class: 'mus-swatch' }),
        h('span', { class: 'mus-ch-name', title: 'Double-click to rename', ondblclick: () => this.renameChannel(i) }, ch.name),
        h('span', { class: 'mus-count', title: 'Notes in this pattern' }, count || ''),
        mute, solo, more),
      h('div', { class: 'mus-ch-bottom' }, select, i === this.channel ? vol : null));
      return row;
    }));
  }

  selectChannel(i) {
    if (i === this.channel) return;
    this.channel = i;
    this.selection.clear();
    this.renderChannels();
    this.renderInstrument();
    this.renderStatus();
    this.draw();
  }

  toggleSet(set, i) {
    if (set.has(i)) set.delete(i);
    else set.add(i);
    this.renderChannels();
    this.draw();
  }

  audible(i) {
    return this.solo.size ? this.solo.has(i) : !this.muted.has(i);
  }

  channelMenu(i, anchor) {
    const s = this.song;
    this.ui.showMenu(anchor, [
      { label: 'Rename…', icon: 'pencil', action: () => this.renameChannel(i) },
      { label: 'Move up', disabled: i === 0, action: () => this.moveChannel(i, -1) },
      { label: 'Move down', disabled: i === s.channels.length - 1, action: () => this.moveChannel(i, 1) },
      { label: 'Clear notes in this pattern', disabled: !this.pat.notes.some((n) => n.channel === i), action: () => this.edit(() => { this.pat.notes = this.pat.notes.filter((n) => n.channel !== i); this.selection.clear(); }) },
      '-',
      { label: 'Remove channel', icon: 'trash', danger: true, disabled: s.channels.length <= 1, action: () => this.removeChannel(i) },
    ]);
  }

  async renameChannel(i) {
    const ch = this.song.channels[i];
    const name = await this.ui.promptDialog({ title: 'Rename channel', label: 'Name', value: ch.name, okLabel: 'Rename' });
    if (name && name !== ch.name) this.edit(() => { ch.name = name; });
    this.element.focus();
  }

  addChannel() {
    const s = this.song;
    this.edit(() => {
      s.channels.push({ name: `Channel ${s.channels.length + 1}`, instrument: 0, volume: 0.8 });
    });
    this.channel = s.channels.length - 1;
    this.selection.clear();
    this.refreshAll();
  }

  moveChannel(i, dir) {
    const s = this.song;
    const j = i + dir;
    if (j < 0 || j >= s.channels.length) return;
    this.edit(() => {
      [s.channels[i], s.channels[j]] = [s.channels[j], s.channels[i]];
      for (const p of s.patterns) for (const n of p.notes) {
        if (n.channel === i) n.channel = j;
        else if (n.channel === j) n.channel = i;
      }
    });
    this.muted.clear();
    this.solo.clear();
    if (this.channel === i) this.channel = j;
    else if (this.channel === j) this.channel = i;
    this.refreshAll();
  }

  async removeChannel(i) {
    const s = this.song;
    if (s.channels.length <= 1) return;
    const used = s.patterns.reduce((a, p) => a + p.notes.filter((n) => n.channel === i).length, 0);
    if (used && !await this.ui.confirmDialog({
      title: 'Remove channel?', message: `“${s.channels[i].name}” has ${used} note${used === 1 ? '' : 's'}, which will be deleted too.`, okLabel: 'Remove', danger: true,
    })) return;
    this.edit(() => {
      s.channels.splice(i, 1);
      for (const p of s.patterns) {
        p.notes = p.notes.filter((n) => n.channel !== i);
        for (const n of p.notes) if (n.channel > i) n.channel--;
      }
    });
    this.muted.clear();
    this.solo.clear();
    this.selection.clear();
    this.clampView();
    this.refreshAll();
  }

  // ---- Patterns

  renderPatterns() {
    const { h, icon } = this.ui;
    const s = this.song;
    this.patternList.replaceChildren(...s.patterns.map((p, i) => h('div', {
      class: `mus-pat ${i === this.pattern ? 'selected' : ''}`,
      onclick: () => this.selectPattern(i),
      ondblclick: () => this.renamePattern(i),
      oncontextmenu: (e) => { e.preventDefault(); this.patternMenu(i, { x: e.clientX, y: e.clientY }); },
      title: 'Click to edit, double-click to rename',
    },
    h('span', { class: 'mus-pat-num' }, String(i + 1)),
    h('span', { class: 'mus-pat-name' }, p.name),
    h('span', { class: 'mus-count' }, p.notes.length ? `${p.notes.length}` : ''),
    h('button', {
      type: 'button', class: 'icon-btn small mus-more', title: 'Rename, duplicate or delete this pattern', 'aria-label': 'Pattern actions',
      onclick: (e) => { e.stopPropagation(); this.patternMenu(i, e.currentTarget); },
    }, icon('more', 14)))));
  }

  selectPattern(i) {
    if (i === this.pattern) return;
    this.pattern = i;
    if (this.song.order[this.slot] !== i) {
      const slot = this.song.order.indexOf(i);
      if (slot >= 0) this.slot = slot;
    }
    this.selection.clear();
    this.renderPatterns();
    this.renderChannels();
    this.renderOrder();
    this.renderStatus();
    this.draw();
  }

  patternMenu(i, anchor) {
    const s = this.song;
    this.ui.showMenu(anchor, [
      { label: 'Rename…', icon: 'pencil', action: () => this.renamePattern(i) },
      { label: 'Duplicate', icon: 'copy', action: () => this.duplicatePattern(i) },
      { label: 'Add to the arrangement', icon: 'plus', action: () => this.addSlot(i) },
      '-',
      { label: 'Delete pattern', icon: 'trash', danger: true, disabled: s.patterns.length <= 1, action: () => this.deletePattern(i) },
    ]);
  }

  uniquePatternName(base) {
    const names = new Set(this.song.patterns.map((p) => p.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  addPattern() {
    const s = this.song;
    this.edit(() => {
      s.patterns.push({ name: this.uniquePatternName(`Pattern ${s.patterns.length + 1}`), notes: [] });
    });
    this.selectPattern(s.patterns.length - 1);
    this.refreshAll();
  }

  duplicatePattern(i) {
    const s = this.song;
    const src = s.patterns[i];
    this.edit(() => {
      const copy = JSON.parse(JSON.stringify(src));
      copy.name = this.uniquePatternName(`${src.name} copy`);
      s.patterns.splice(i + 1, 0, copy);
      s.order = s.order.map((v) => (v > i ? v + 1 : v));
    });
    this.pattern = i + 1;
    this.selection.clear();
    this.refreshAll();
  }

  async renamePattern(i) {
    const p = this.song.patterns[i];
    const name = await this.ui.promptDialog({ title: 'Rename pattern', label: 'Name', value: p.name, okLabel: 'Rename' });
    if (name && name !== p.name) this.edit(() => { p.name = name; });
    this.element.focus();
  }

  async deletePattern(i) {
    const s = this.song;
    if (s.patterns.length <= 1) return;
    const p = s.patterns[i];
    const slots = s.order.filter((v) => v === i).length;
    if ((p.notes.length || slots) && !await this.ui.confirmDialog({
      title: 'Delete pattern?',
      message: `“${p.name}” has ${p.notes.length} note${p.notes.length === 1 ? '' : 's'}${slots ? ` and is used ${slots} time${slots === 1 ? '' : 's'} in the arrangement` : ''}.`,
      okLabel: 'Delete', danger: true,
    })) return;
    this.edit(() => {
      s.patterns.splice(i, 1);
      const before = s.order.slice(0, s.loopStart).filter((v) => v === i).length;
      s.order = s.order.filter((v) => v !== i).map((v) => (v > i ? v - 1 : v));
      s.loopStart = Math.max(0, s.loopStart - before);
      if (!s.order.length) s.order.push(0);
      if (this.pattern >= i) this.pattern = Math.max(0, this.pattern - 1);
    });
    this.selection.clear();
    this.clampView();
    this.refreshAll();
  }

  // ---- Arrangement (order list)

  renderOrder() {
    const { h, icon } = this.ui;
    const s = this.song;
    const slots = s.order.map((pi, i) => {
      const p = s.patterns[pi];
      const el = h('button', {
        type: 'button',
        class: `mus-slot ${i === this.slot && pi === this.pattern ? 'selected' : ''} ${this.playSlot === i && this.playing?.mode === 'song' ? 'playing' : ''}`,
        draggable: 'true',
        title: `${p?.name ?? '?'} — click to edit, drag to reorder, right-click for more`,
        style: { '--slot-color': CHANNEL_COLORS[pi % CHANNEL_COLORS.length] },
        onclick: () => { this.slot = i; this.selectPattern(pi); this.renderOrder(); },
        oncontextmenu: (e) => { e.preventDefault(); this.slotMenu(i, { x: e.clientX, y: e.clientY }); },
      },
      i === s.loopStart ? h('span', { class: 'mus-slot-flag', title: s.loop ? 'The song loops back to here' : 'Loop start (looping is off)' }, ico('flag', 11)) : null,
      h('span', { class: 'mus-slot-num' }, String(pi + 1)),
      h('span', { class: 'mus-slot-name' }, p?.name ?? '?'));
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-smitten-slot', String(i));
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.types].includes('application/x-smitten-slot')) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        el.classList.toggle('drop-before', e.clientX < r.left + r.width / 2);
        el.classList.toggle('drop-after', e.clientX >= r.left + r.width / 2);
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('application/x-smitten-slot'));
        const r = el.getBoundingClientRect();
        const to = e.clientX < r.left + r.width / 2 ? i : i + 1;
        el.classList.remove('drop-before', 'drop-after');
        this.moveSlot(from, to);
      });
      return el;
    });
    const add = h('button', { type: 'button', class: 'mus-slot-add', title: 'Add the current pattern to the arrangement', 'aria-label': 'Add to the arrangement', onclick: () => this.addSlot(this.pattern) }, icon('plus', 14));
    this.slotList.replaceChildren(...slots, add);
  }

  slotMenu(i, anchor) {
    const s = this.song;
    this.ui.showMenu(anchor, [
      { label: 'Loop back to here', icon: 'restart', disabled: s.loopStart === i, action: () => this.edit(() => { s.loopStart = i; s.loop = true; }) },
      { label: 'Duplicate slot', icon: 'copy', action: () => { this.edit(() => { s.order.splice(i + 1, 0, s.order[i]); if (s.loopStart > i) s.loopStart++; }); } },
      { label: 'Move left', disabled: i === 0, action: () => this.moveSlot(i, i - 1) },
      { label: 'Move right', disabled: i === s.order.length - 1, action: () => this.moveSlot(i, i + 2) },
      { heading: 'Play pattern' },
      ...s.patterns.map((p, pi) => ({
        label: `${pi + 1}  ${p.name}`, icon: s.order[i] === pi ? 'check' : undefined,
        action: () => { this.edit(() => { s.order[i] = pi; }); if (i === this.slot) this.selectPattern(pi); },
      })),
      '-',
      { label: 'Remove from the arrangement', icon: 'trash', danger: true, disabled: s.order.length <= 1, action: () => this.removeSlot(i) },
    ]);
  }

  addSlot(pi) {
    const s = this.song;
    const at = this.slot + 1 <= s.order.length ? this.slot + 1 : s.order.length;
    this.edit(() => {
      s.order.splice(at, 0, pi);
      if (at <= s.loopStart) s.loopStart++;
    });
    this.slot = at;
    this.selectPattern(pi);
    this.renderOrder();
    requestAnimationFrame(() => this.slotList.children[at]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  removeSlot(i) {
    const s = this.song;
    if (s.order.length <= 1) return;
    this.edit(() => {
      s.order.splice(i, 1);
      if (s.loopStart > i) s.loopStart--;
      s.loopStart = clamp(s.loopStart, 0, s.order.length - 1);
    });
    this.slot = clamp(this.slot > i ? this.slot - 1 : this.slot, 0, s.order.length - 1);
    this.renderOrder();
  }

  /** Move slot `from` so it lands before index `to` (0..length). */
  moveSlot(from, to) {
    const s = this.song;
    if (!(from >= 0 && from < s.order.length)) return;
    if (to === from || to === from + 1) return;
    this.edit(() => {
      const loopPattern = s.loopStart;
      const ids = s.order.map((v, i) => ({ v, i }));
      const [item] = ids.splice(from, 1);
      ids.splice(to > from ? to - 1 : to, 0, item);
      s.order = ids.map((x) => x.v);
      s.loopStart = ids.findIndex((x) => x.i === loopPattern);
      this.slot = ids.findIndex((x) => x.i === this.slot);
    });
    this.renderOrder();
  }

  toggleLoop() {
    this.edit(() => { this.song.loop = !this.song.loop; });
  }

  // ---- Instruments

  renderInstrument() {
    const { h } = this.ui;
    const s = this.song;
    const ch = s.channels[this.channel];
    const idx = ch.instrument;
    const ins = s.instruments[idx];
    this.insDisclosure.note.textContent = ins ? ins.name || `Instrument ${idx + 1}` : '';
    if (!ins) {
      this.instrumentPanel.replaceChildren(h('div', { class: 'mus-empty' }, 'No instrument.'));
      return;
    }
    const users = s.channels.filter((c) => c.instrument === idx).map((c) => c.name);
    const name = h('input', { type: 'text', class: 'input small mus-ins-name', value: ins.name, 'aria-label': 'Instrument name', spellcheck: 'false' });
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v && v !== ins.name) { this.edit(() => { ins.name = v; }); this.renderChannels(); }
      else name.value = ins.name;
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { name.blur(); this.element.focus(); } });

    const typeSeg = h('div', { class: 'segmented mus-ins-type', role: 'group', 'aria-label': 'Instrument type' },
      h('button', { type: 'button', 'aria-pressed': String(ins.type === 'synth'), onclick: () => this.setInstrumentType(idx, 'synth') }, 'Synth'),
      h('button', { type: 'button', 'aria-pressed': String(ins.type === 'sfx'), onclick: () => this.setInstrumentType(idx, 'sfx') }, 'Sound effect'));

    const parts = [
      h('div', { class: 'mus-ins-head' }, name),
      h('div', { class: 'mus-ins-meta' }, typeSeg),
      h('div', { class: 'mus-ins-users' }, `Used by ${users.join(', ')}`),
    ];

    if (ins.type === 'sfx') {
      const files = this.host.list().filter((p) => /\.sfx\.json$/i.test(p)).sort();
      const dir = dirName(this.host.path);
      const current = ins.sfx ? this.resolveSfxPath(ins.sfx) : '';
      const select = h('select', { class: 'select small mus-sfx-select', 'aria-label': 'Sound effect file' },
        h('option', { value: '', selected: !ins.sfx }, files.length ? 'Choose a sound effect…' : 'No .sfx.json files in the project'),
        ...files.map((f) => h('option', { value: f, selected: f === current }, f)),
        ins.sfx && !files.includes(current) ? h('option', { value: `missing:${ins.sfx}`, selected: true }, `${ins.sfx} (missing)`) : null);
      select.addEventListener('change', () => {
        if (select.value.startsWith('missing:')) return;
        this.edit(() => { ins.sfx = select.value ? relativePath(dir, select.value) : ''; });
        this.renderInstrument();
        if (select.value) this.previewNote(60);
      });
      const open = h('button', {
        type: 'button', class: 'btn small', disabled: !current || !this.host.exists(current), title: 'Open the sound effect in its editor',
        onclick: () => this.host.openFile(current),
      }, 'Open');
      const pitched = h('button', {
        type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!ins.pitched), 'aria-label': 'Pitched',
        onclick: () => { this.edit(() => { ins.pitched = !ins.pitched; }); this.renderInstrument(); },
      });
      const volParam = SYNTH_PARAMS.find((p) => p.key === 'volume');
      const vol = createSlider(this.ui, volParam, {
        get: () => ins.volume ?? 1,
        set: (v, gesture) => {
          this.history.record(gesture ? `ins:${idx}:volume` : null);
          ins.volume = v;
          vol.sync();
          this.updateDirty();
        },
        end: () => { this.history.settle(); this.previewNote(60); },
        reset: 1,
        escape: () => this.element.focus(),
      });
      parts.push(
        h('div', { class: 'mus-sfx-row' }, select, open),
        h('div', { class: 'mus-ins-sliders' }, vol.element),
        h('label', { class: 'mus-switch-row' }, pitched, h('span', {}, 'Pitched'),
          h('span', { class: 'mus-hint' }, ins.pitched ? 'shifted by the note’s distance from C4' : 'plays as is for every note')),
      );
    } else {
      const waves = h('div', { class: 'snd-waves', role: 'group', 'aria-label': 'Wave' },
        ...WAVES.map((w) => h('button', {
          type: 'button', title: w, 'aria-pressed': String(ins.wave === w),
          onclick: () => { if (ins.wave !== w) { this.edit(() => { ins.wave = w; }); this.renderInstrument(); this.previewNote(this.hover?.midi ?? 60); } },
        }, waveIcon(w), h('span', {}, w))));
      parts.push(waves);
      this.insSliders = SYNTH_PARAMS.map((p) => {
        const slider = createSlider(this.ui, p, {
          get: () => ins[p.key],
          set: (v, gesture) => {
            if (gesture) this.history.record(`ins:${idx}:${p.key}`);
            else this.history.record();
            ins[p.key] = v;
            slider.sync();
            this.updateDirty();
            this.renderToolbar();
          },
          end: () => { this.history.settle(); this.previewNote(this.hover?.midi ?? 60); },
          reset: p.off ?? SYNTH_DEFAULTS[p.key],
          escape: () => this.element.focus(),
        });
        if (p.key === 'duty' && ins.wave !== 'square') slider.element.classList.add('inactive');
        return slider;
      });
      parts.push(h('div', { class: 'mus-ins-sliders' }, ...this.insSliders.map((sl) => sl.element)));
    }
    this.instrumentPanel.replaceChildren(...parts);
  }

  instrumentMenu(anchor) {
    const s = this.song;
    const idx = s.channels[this.channel].instrument;
    this.ui.showMenu(anchor, [
      { label: 'New synth instrument', icon: 'plus', action: () => this.newInstrument({ name: 'Synth', type: 'synth', ...SYNTH_DEFAULTS }) },
      { label: 'New sound effect instrument', icon: 'plus', action: () => this.newInstrument({ name: 'Sound effect', type: 'sfx', sfx: '', pitched: false }) },
      { label: 'Duplicate instrument', icon: 'copy', action: () => this.newInstrument({ ...JSON.parse(JSON.stringify(s.instruments[idx])), name: `${s.instruments[idx].name} copy` }) },
      '-',
      { label: 'Delete instrument', icon: 'trash', danger: true, disabled: s.instruments.length <= 1, action: () => this.deleteInstrument(idx) },
    ]);
  }

  newInstrument(ins) {
    const s = this.song;
    this.edit(() => {
      s.instruments.push(normalizeInstrument(ins, s.instruments.length));
      s.channels[this.channel].instrument = s.instruments.length - 1;
    });
    this.refreshAll();
  }

  async deleteInstrument(idx) {
    const s = this.song;
    if (s.instruments.length <= 1) return;
    const users = s.channels.filter((c) => c.instrument === idx);
    if (users.length > 1 && !await this.ui.confirmDialog({
      title: 'Delete instrument?', message: `“${s.instruments[idx].name}” is used by ${users.map((c) => c.name).join(', ')}. They will use the first instrument instead.`, okLabel: 'Delete', danger: true,
    })) return;
    this.edit(() => {
      s.instruments.splice(idx, 1);
      for (const c of s.channels) {
        if (c.instrument === idx) c.instrument = 0;
        else if (c.instrument > idx) c.instrument--;
      }
    });
    this.refreshAll();
  }

  setInstrumentType(idx, type) {
    const s = this.song;
    const ins = s.instruments[idx];
    if (ins.type === type) return;
    this.edit(() => {
      if (type === 'sfx') {
        const first = this.host.list().filter((p) => /\.sfx\.json$/i.test(p)).sort()[0];
        s.instruments[idx] = normalizeInstrument({ name: ins.name, type: 'sfx', sfx: first ? relativePath(dirName(this.host.path), first) : '', pitched: false }, idx);
      } else {
        s.instruments[idx] = normalizeInstrument({ name: ins.name, type: 'synth', ...SYNTH_DEFAULTS }, idx);
      }
    });
    this.renderInstrument();
  }

  // -------------------------------------------------------------------------
  // Editing helpers

  /** Make a change to the song as one undo step. */
  edit(fn) {
    this.history.record();
    fn();
    this.touch();
  }

  /** After the song changed: dirty state, toolbar, canvas, counts. */
  touch() {
    this.clampView();
    this.updateDirty();
    this.renderToolbar();
    this.renderStatus();
    if (!this.drag) {
      this.renderPatterns();
      this.renderChannels();
      this.renderOrder();
    }
    this.draw();
  }

  updateDirty() {
    this.host.setDirty(songText(this.song) !== this.savedText);
    this.btnUndo.disabled = !this.history.canUndo;
    this.btnRedo.disabled = !this.history.canRedo;
  }

  setSongField(key, raw) {
    const [min, max] = LIMITS[key];
    let v = Number(raw);
    if (!Number.isFinite(v)) { this.renderToolbar(); return; }
    v = clamp(key === 'bpm' ? Math.round(v * 100) / 100 : Math.round(v), min, max);
    if (v !== this.song[key]) {
      this.edit(() => { this.song[key] = v; });
      this.updateSizer();
    }
    this.renderToolbar();
    this.draw();
  }

  // -------------------------------------------------------------------------
  // Piano roll geometry

  updateSizer() {
    this.sizer.style.width = `${this.L * this.stepW}px`;
    this.sizer.style.height = `${(HIGH - LOW + 1) * this.rowH}px`;
  }

  /** Content coordinates of a pointer event over the grid. */
  gridPoint(e) {
    const r = this.scroller.getBoundingClientRect();
    return { x: e.clientX - r.left + this.scroller.scrollLeft, y: e.clientY - r.top + this.scroller.scrollTop };
  }

  stepAt(x) { return Math.floor(x / this.stepW); }
  midiAt(y) { return HIGH - Math.floor(y / this.rowH); }
  noteY(midi) { return (HIGH - midi) * this.rowH; }

  channelNotes(ch = this.channel) {
    return this.pat.notes.filter((n) => n.channel === ch);
  }

  /** The current channel's note under content point (x, y), and whether it's at its resize edge. */
  noteAt(x, y) {
    const midi = this.midiAt(y);
    const step = x / this.stepW;
    let found = null;
    for (const n of this.pat.notes) {
      if (n.channel !== this.channel || n.note !== midi) continue;
      if (step >= n.step && step < n.step + n.length) {
        if (!found || this.selection.has(n)) found = n;
      }
    }
    if (!found) return null;
    const right = (found.step + found.length) * this.stepW;
    const edge = Math.min(EDGE, (found.length * this.stepW) / 3);
    return { note: found, edge: x >= right - edge };
  }

  scrollToNotes() {
    requestAnimationFrame(() => {
      const notes = this.channelNotes();
      const pitches = notes.length ? notes.map((n) => n.note) : [60, 72];
      const mid = (Math.min(...pitches) + Math.max(...pitches)) / 2;
      this.scroller.scrollTop = Math.max(0, this.noteY(Math.round(mid)) - this.scroller.clientHeight / 2);
    });
  }

  zoom(factor, anchorX = null) {
    const old = this.stepW;
    const next = clamp(Math.round(old * factor), ...ZOOM_X);
    if (next === old) return;
    const ax = anchorX ?? this.scroller.clientWidth / 2;
    const contentX = (this.scroller.scrollLeft + ax) / old;
    this.stepW = next;
    this.updateSizer();
    this.scroller.scrollLeft = contentX * next - ax;
    this.draw();
  }

  zoomY(factor, anchorY = null) {
    const old = this.rowH;
    const next = clamp(Math.round(old * factor), ...ZOOM_Y);
    if (next === old) return;
    const ay = anchorY ?? this.scroller.clientHeight / 2;
    const contentY = (this.scroller.scrollTop + ay) / old;
    this.rowH = next;
    this.updateSizer();
    this.scroller.scrollTop = contentY * next - ay;
    this.draw();
  }

  onWheel(e) {
    if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
    e.preventDefault();
    const r = this.scroller.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    if (e.altKey) this.zoomY(factor, e.clientY - r.top);
    else this.zoom(factor, e.clientX - r.left);
  }

  // -------------------------------------------------------------------------
  // Mouse on the grid

  gridDown(e) {
    if (e.target !== this.scroller && e.target !== this.sizer) return;
    // Clicks on the scroll bars.
    const sr = this.scroller.getBoundingClientRect();
    if (e.clientX - sr.left >= this.scroller.clientWidth || e.clientY - sr.top >= this.scroller.clientHeight) return;
    const p = this.gridPoint(e);
    if (p.x >= this.L * this.stepW) return;
    this.element.focus({ preventScroll: true });
    e.preventDefault();
    try { this.scroller.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    const hit = this.noteAt(p.x, p.y);
    const step = clamp(this.stepAt(p.x), 0, this.L - 1);
    const midi = clamp(this.midiAt(p.y), LOW, HIGH);

    if (e.button === 2) {
      this.drag = { type: 'erase', recorded: false };
      this.eraseAt(p);
      return;
    }
    if (e.button !== 0) return;

    if (hit) {
      const n = hit.note;
      if (e.shiftKey && !hit.edge) {
        if (this.selection.has(n)) this.selection.delete(n);
        else this.selection.add(n);
        this.drag = { type: 'none' };
        this.touch();
        return;
      }
      if (!this.selection.has(n)) {
        this.selection.clear();
        this.selection.add(n);
      }
      this.drag = {
        type: hit.edge ? 'resize' : 'move',
        start: p,
        anchor: n,
        lastPitch: n.note,
        recorded: false,
        orig: new Map([...this.selection].map((m) => [m, { step: m.step, note: m.note, length: m.length }])),
      };
      if (e.altKey && !hit.edge) this.drag.duplicate = true;
      this.cursorStep = n.step;
      this.previewNote(n.note, this.channel, n.length, n.volume);
      this.touch();
      return;
    }

    if (this.mode === 'select' || e.shiftKey) {
      this.drag = { type: 'box', start: p, base: e.shiftKey ? new Set(this.selection) : new Set() };
      if (!e.shiftKey) this.selection.clear();
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      this.cursorStep = step;
      this.touch();
      return;
    }

    // Draw a new note.
    this.history.record();
    const length = clamp(this.lastLength, 1, this.L - step);
    const note = { channel: this.channel, step, length, note: midi, volume: 1 };
    this.pat.notes.push(note);
    this.selection.clear();
    this.selection.add(note);
    this.cursorStep = step;
    this.drag = { type: 'draw', note, start: p, moved: false };
    this.previewNote(midi, this.channel, length);
    this.touch();
  }

  gridMove(e) {
    const p = this.gridPoint(e);
    const d = this.drag;
    this.hover = { midi: clamp(this.midiAt(p.y), LOW, HIGH), step: this.stepAt(p.x) };
    if (!d) {
      const hit = p.x < this.L * this.stepW ? this.noteAt(p.x, p.y) : null;
      this.scroller.style.cursor = hit ? (hit.edge ? 'ew-resize' : 'grab') : '';
      this.renderHover();
      this.draw();
      return;
    }
    if (d.type === 'erase') { this.eraseAt(p); return; }
    if (d.type === 'box') {
      this.box.x1 = p.x;
      this.box.y1 = p.y;
      const x0 = Math.min(this.box.x0, p.x);
      const x1 = Math.max(this.box.x0, p.x);
      const y0 = Math.min(this.box.y0, p.y);
      const y1 = Math.max(this.box.y0, p.y);
      this.selection = new Set(d.base);
      for (const n of this.channelNotes()) {
        const nx0 = n.step * this.stepW;
        const nx1 = (n.step + n.length) * this.stepW;
        const ny0 = this.noteY(n.note);
        const ny1 = ny0 + this.rowH;
        if (nx1 > x0 && nx0 < x1 && ny1 > y0 && ny0 < y1) this.selection.add(n);
      }
      this.renderStatus();
      this.draw();
      return;
    }
    if (d.type === 'draw') {
      const end = clamp(this.stepAt(p.x), d.note.step, this.L - 1);
      const length = end - d.note.step + 1;
      if (length !== d.note.length) {
        d.note.length = length;
        d.moved = true;
        this.touch();
      }
      return;
    }
    const dx = Math.round((p.x - d.start.x) / this.stepW);
    if (d.type === 'resize') {
      let delta = dx;
      for (const [n, o] of d.orig) delta = Math.max(delta, 1 - o.length);
      for (const [n, o] of d.orig) delta = Math.min(delta, this.L - o.step - o.length);
      if (!d.recorded && delta === 0) return;
      this.beginDragEdit();
      for (const [n, o] of d.orig) n.length = o.length + delta;
      this.touch();
      return;
    }
    if (d.type === 'move') {
      let ds = dx;
      let dp = Math.round(-(p.y - d.start.y) / this.rowH);
      for (const [, o] of d.orig) {
        ds = clamp(ds, -o.step, this.L - o.step - o.length);
        dp = clamp(dp, LOW - o.note, HIGH - o.note);
      }
      if (!d.recorded && ds === 0 && dp === 0) return;
      this.beginDragEdit();
      if (d.duplicate && !d.copied) {
        // Alt+drag: leave copies behind.
        d.copied = true;
        for (const [, o] of d.orig) this.pat.notes.push({ channel: this.channel, step: o.step, length: o.length, note: o.note, volume: 1 });
        const copies = this.pat.notes.slice(-d.orig.size);
        let k = 0;
        for (const [n] of d.orig) copies[k++].volume = n.volume;
      }
      for (const [n, o] of d.orig) {
        n.step = o.step + ds;
        n.note = o.note + dp;
      }
      this.scroller.style.cursor = 'grabbing';
      if (d.anchor.note !== d.lastPitch) {
        d.lastPitch = d.anchor.note;
        this.previewNote(d.anchor.note, this.channel, d.anchor.length, d.anchor.volume);
      }
      this.touch();
    }
  }

  beginDragEdit() {
    if (this.drag.recorded) return;
    this.drag.recorded = true;
    this.history.record();
  }

  gridUp(e) {
    const d = this.drag;
    if (!d) return;
    if (this.scroller.hasPointerCapture?.(e.pointerId)) this.scroller.releasePointerCapture(e.pointerId);
    if (d.type === 'draw') this.lastLength = d.note.length;
    if (d.type === 'resize' && d.recorded) this.lastLength = d.anchor.length;
    if (d.type === 'move' || d.type === 'resize') this.scroller.style.cursor = '';
    this.drag = null;
    this.box = null;
    this.sortNotes();
    this.touch();
  }

  eraseAt(p) {
    const hit = this.noteAt(p.x, p.y);
    if (!hit) return;
    const doomed = this.selection.has(hit.note) ? new Set(this.selection) : new Set([hit.note]);
    if (!this.drag.recorded) {
      this.drag.recorded = true;
      this.history.record();
    }
    this.pat.notes = this.pat.notes.filter((n) => !doomed.has(n));
    for (const n of doomed) this.selection.delete(n);
    this.touch();
  }

  sortNotes() {
    this.pat.notes.sort((a, b) => a.step - b.step || a.channel - b.channel || a.note - b.note);
  }

  // ---- Mouse on the keys, ruler and velocity lane (the canvas outside the grid)

  canvasDown(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const H = r.height;
    this.element.focus({ preventScroll: true });
    if (e.button !== 0) return;
    if (y >= H - VEL_H && x >= KEY_W) {
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
      this.canvasDrag = { type: 'velocity', recorded: false };
      this.velocityAt(x, y, H);
    } else if (y < RULER_H && x >= KEY_W) {
      const step = this.stepAt(x - KEY_W + this.scroller.scrollLeft);
      this.cursorStep = clamp(step, 0, this.L - 1);
      this.draw();
    } else if (x < KEY_W && y >= RULER_H && y < H - VEL_H) {
      const midi = this.midiAt(y - RULER_H + this.scroller.scrollTop);
      if (midi >= LOW && midi <= HIGH) {
        this.keyDown = midi;
        this.previewNote(midi, this.channel, this.song.stepsPerBeat);
        this.draw();
      }
    }
  }

  canvasMove(e) {
    if (this.canvasDrag?.type === 'velocity') {
      const r = this.canvas.getBoundingClientRect();
      this.velocityAt(e.clientX - r.left, e.clientY - r.top, r.height);
    }
  }

  canvasUp() {
    this.canvasDrag = null;
    if (this.keyDown != null) { this.keyDown = null; this.draw(); }
    this.renderPatterns();
  }

  velocityAt(x, y, H) {
    const step = this.stepAt(x - KEY_W + this.scroller.scrollLeft);
    const top = H - VEL_H + 6;
    const v = Math.round(clamp(1 - (y - top) / (VEL_H - 12), 0, 1) * 100) / 100;
    let targets = this.channelNotes().filter((n) => n.step === step);
    const sel = targets.filter((n) => this.selection.has(n));
    if (sel.length) targets = sel;
    if (!targets.length || targets.every((n) => n.volume === v)) return;
    if (!this.canvasDrag.recorded) {
      this.canvasDrag.recorded = true;
      this.history.record();
    }
    for (const n of targets) n.volume = v;
    this.touch();
  }

  // -------------------------------------------------------------------------
  // Drawing

  draw() {
    if (!this.element || this.element.hidden) return;
    if (!this.pat) this.clampView();
    const W = this.roll.clientWidth;
    const H = this.roll.clientHeight;
    if (!W || !H) return;
    const ctx = fitCanvas(this.canvas, W, H);
    const el = this.element;
    const dark = darkBackground(el);
    const c = {
      bg: cssVar(el, '--editor-bg'),
      panel: cssVar(el, '--panel'),
      panel2: cssVar(el, '--panel-2'),
      elev: cssVar(el, '--panel-elev'),
      border: cssVar(el, '--border'),
      strong: cssVar(el, '--border-strong'),
      fg: cssVar(el, '--fg'),
      muted: cssVar(el, '--fg-muted'),
      subtle: cssVar(el, '--fg-subtle'),
      accent: cssVar(el, '--accent'),
      accentSoft: cssVar(el, '--accent-soft'),
      // Black-key rows and the area past the pattern's end: palette black, faint.
      blackRowAlpha: dark ? 0.24 : 0.04,
      outsideAlpha: dark ? 0.35 : 0.07,
      whiteKey: dark ? cssVar(el, '--border-strong') : cssVar(el, '--panel-elev'),
    };
    const sx = this.scroller.scrollLeft;
    const sy = this.scroller.scrollTop;
    const gw = this.scroller.clientWidth;
    const gh = this.scroller.clientHeight;
    const gx = KEY_W;
    const gy = RULER_H;
    const sw = this.stepW;
    const rh = this.rowH;
    const L = this.L;
    const spb = this.song.stepsPerBeat;
    const bar = spb * 4;
    const firstStep = Math.max(0, Math.floor(sx / sw));
    const lastStep = Math.min(L, Math.ceil((sx + gw) / sw));
    const firstMidi = Math.min(HIGH, this.midiAt(sy));
    const lastMidi = Math.max(LOW, this.midiAt(sy + gh));

    ctx.clearRect(0, 0, W, H);
    this.emptyHint.hidden = this.pat.notes.some((n) => n.channel === this.channel) || !!this.drag;

    // --- Grid
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, gy, gw, gh);
    ctx.clip();
    ctx.fillStyle = c.bg;
    ctx.fillRect(gx, gy, gw, gh);
    for (let m = firstMidi; m >= lastMidi; m--) {
      const y = gy + this.noteY(m) - sy;
      if (isBlack(m)) {
        ctx.fillStyle = INK;
        ctx.globalAlpha = c.blackRowAlpha;
        ctx.fillRect(gx, y, gw, rh);
        ctx.globalAlpha = 1;
      }
      if (this.hover && this.hover.midi === m && !this.drag) {
        ctx.fillStyle = c.accentSoft;
        ctx.fillRect(gx, y, gw, rh);
      }
      if (m % 12 === 0) {
        ctx.fillStyle = c.strong;
        ctx.fillRect(gx, y + rh - 1, gw, 1);
      }
    }
    for (let s = firstStep; s <= lastStep; s++) {
      const x = gx + s * sw - sx;
      ctx.fillStyle = s % bar === 0 ? c.muted : s % spb === 0 ? c.strong : c.border;
      if (s % bar === 0) ctx.globalAlpha = 0.6;
      ctx.fillRect(Math.round(x), gy, 1, gh);
      ctx.globalAlpha = 1;
    }
    const endX = gx + L * sw - sx;
    if (endX < gx + gw) {
      ctx.fillStyle = INK;
      ctx.globalAlpha = c.outsideAlpha;
      ctx.fillRect(endX, gy, gx + gw - endX, gh);
      ctx.globalAlpha = 1;
    }

    // Other channels, faint.
    const notes = this.pat.notes;
    for (const n of notes) {
      if (n.channel === this.channel || n.note > firstMidi || n.note < lastMidi) continue;
      const x = gx + n.step * sw - sx;
      const y = gy + this.noteY(n.note) - sy;
      ctx.globalAlpha = this.audible(n.channel) ? 0.22 : 0.08;
      ctx.fillStyle = channelColor(n.channel);
      ctx.fillRect(x + 1, y + 1, n.length * sw - 2, rh - 2);
    }
    ctx.globalAlpha = 1;
    // The current channel.
    const color = channelColor(this.channel);
    for (const n of notes) {
      if (n.channel !== this.channel || n.note > firstMidi || n.note < lastMidi) continue;
      const x = gx + n.step * sw - sx;
      const y = gy + this.noteY(n.note) - sy;
      const w = n.length * sw;
      const selected = this.selection.has(n);
      ctx.globalAlpha = 0.45 + 0.55 * n.volume;
      ctx.fillStyle = color;
      roundRect(ctx, x + 1, y + 1, w - 2, rh - 2, Math.min(3, rh / 4));
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!dark) {
        // Pale palette colors need an edge on a light background.
        ctx.strokeStyle = INK;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1;
        roundRect(ctx, x + 1.5, y + 1.5, w - 3, rh - 3, Math.min(3, rh / 4));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (selected) {
        ctx.strokeStyle = c.fg;
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, w - 2, rh - 2, Math.min(3, rh / 4));
        ctx.stroke();
      }
      // A notch marking the resize handle.
      if (w >= 14 && rh >= 9) {
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x + w - 4, y + 3, 1, rh - 6);
        ctx.globalAlpha = 1;
      }
      if (rh >= 11 && w >= 30) {
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.75;
        ctx.font = `600 ${Math.min(10, rh - 3)}px ${cssVar(el, '--font-ui', 'sans-serif')}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(noteName(n.note), x + 4, y + rh / 2 + 0.5);
        ctx.globalAlpha = 1;
      }
    }

    // Paste cursor and playhead.
    if (this.cursorStep != null) {
      const x = gx + this.cursorStep * sw - sx;
      ctx.fillStyle = c.accent;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.round(x), gy, 1, gh);
      ctx.globalAlpha = 1;
    }
    if (this.playStep != null && this.playingThisPattern()) {
      const x = gx + this.playStep * sw - sx;
      ctx.fillStyle = c.fg;
      ctx.fillRect(Math.round(x), gy, 2, gh);
    }
    if (this.box) {
      const x = gx + Math.min(this.box.x0, this.box.x1) - sx;
      const y = gy + Math.min(this.box.y0, this.box.y1) - sy;
      const w = Math.abs(this.box.x1 - this.box.x0);
      const hh = Math.abs(this.box.y1 - this.box.y0);
      ctx.fillStyle = c.accentSoft;
      ctx.fillRect(x, y, w, hh);
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, hh);
    }
    ctx.restore();

    // --- Keys
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, gy, KEY_W, gh);
    ctx.clip();
    ctx.fillStyle = c.whiteKey;
    ctx.fillRect(0, gy, KEY_W, gh);
    ctx.font = `10px ${cssVar(el, '--font-ui', 'sans-serif')}`;
    ctx.textBaseline = 'middle';
    for (let m = firstMidi; m >= lastMidi; m--) {
      const y = gy + this.noteY(m) - sy;
      const active = this.keyDown === m || (this.hover?.midi === m);
      if (isBlack(m)) {
        ctx.fillStyle = INK;
        ctx.globalAlpha = dark ? 0.9 : 0.8;
        ctx.fillRect(0, y, KEY_W * 0.62, rh);
        ctx.globalAlpha = 1;
      }
      if (active) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, y, KEY_W, rh);
        ctx.globalAlpha = 1;
      }
      if (!isBlack(m) && ((m + 1) % 12 === 0 || m % 12 === 4)) {
        ctx.fillStyle = c.border;
        ctx.fillRect(0, y, KEY_W, 1);
      }
      if (m % 12 === 0 && rh >= 8) {
        ctx.fillStyle = c.muted;
        ctx.textAlign = 'right';
        ctx.fillText(noteName(m), KEY_W - 5, y + rh / 2 + 0.5);
        ctx.textAlign = 'left';
      }
    }
    ctx.restore();
    ctx.fillStyle = c.strong;
    ctx.fillRect(KEY_W - 1, gy, 1, gh);

    // --- Ruler
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.fillStyle = c.border;
    ctx.fillRect(0, RULER_H - 1, W, 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, 0, gw, RULER_H);
    ctx.clip();
    ctx.font = `600 10px ${cssVar(el, '--font-ui', 'sans-serif')}`;
    ctx.textBaseline = 'middle';
    for (let s = firstStep; s <= lastStep; s++) {
      const x = Math.round(gx + s * sw - sx);
      if (s % bar === 0) {
        ctx.fillStyle = c.muted;
        ctx.fillRect(x, 4, 1, RULER_H - 5);
        if (s < L) ctx.fillText(String(s / bar + 1), x + 4, RULER_H / 2);
      } else if (s % spb === 0 && sw * spb >= 14) {
        ctx.fillStyle = c.strong;
        ctx.fillRect(x, RULER_H - 7, 1, 6);
      }
    }
    if (this.cursorStep != null) {
      const x = gx + this.cursorStep * sw - sx;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.moveTo(x - 4, RULER_H - 6);
      ctx.lineTo(x + 4, RULER_H - 6);
      ctx.lineTo(x, RULER_H - 1);
      ctx.fill();
    }
    if (this.playStep != null && this.playingThisPattern()) {
      const x = gx + this.playStep * sw - sx;
      ctx.fillStyle = c.fg;
      ctx.beginPath();
      ctx.moveTo(x - 5, 2);
      ctx.lineTo(x + 6, 2);
      ctx.lineTo(x + 0.5, RULER_H - 3);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, 0, KEY_W, RULER_H);

    // --- Velocity lane
    const vy = H - VEL_H;
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, vy, W, VEL_H);
    ctx.fillStyle = c.border;
    ctx.fillRect(0, vy, W, 1);
    ctx.fillStyle = c.subtle;
    ctx.font = `10px ${cssVar(el, '--font-ui', 'sans-serif')}`;
    ctx.textBaseline = 'top';
    ctx.fillText('Volume', 6, vy + 6);
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, vy + 1, gw, VEL_H - 1);
    ctx.clip();
    for (let s = firstStep; s <= lastStep; s++) {
      if (s % spb) continue;
      ctx.fillStyle = s % bar === 0 ? c.strong : c.border;
      ctx.fillRect(Math.round(gx + s * sw - sx), vy + 1, 1, VEL_H);
    }
    const top = vy + 6;
    const span = VEL_H - 12;
    for (const n of notes) {
      if (n.channel !== this.channel) continue;
      const x = gx + n.step * sw - sx;
      const hh = Math.max(2, n.volume * span);
      ctx.fillStyle = color;
      ctx.globalAlpha = this.selection.has(n) ? 1 : 0.6;
      ctx.fillRect(x + 2, top + span - hh, Math.max(3, Math.min(sw - 4, 10)), hh);
      ctx.fillRect(x + 2, top + span - hh, Math.max(3, Math.min(sw - 4, 10)) + 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  playingThisPattern() {
    if (!this.playing) return false;
    if (this.playing.mode === 'pattern') return this.playing.pattern === this.pattern;
    return this.song.order[this.playSlot] === this.pattern;
  }

  renderHover() {
    const hv = this.hover;
    if (!hv || hv.step < 0 || hv.step >= this.L) {
      this.hoverInfo.textContent = '';
      return;
    }
    const spb = this.song.stepsPerBeat;
    const barN = Math.floor(hv.step / (spb * 4)) + 1;
    const beat = Math.floor(hv.step / spb) % 4 + 1;
    this.hoverInfo.textContent = `${noteName(hv.midi)} · step ${hv.step + 1} · bar ${barN} beat ${beat}`;
  }

  renderStatus() {
    const ch = this.song.channels[this.channel];
    this.channelInfo.textContent = `${ch.name} · ${this.pat.name}`;
    this.channelInfo.style.setProperty('--ch', channelColor(this.channel));
    const n = this.selection.size;
    this.selBox.hidden = n === 0;
    if (n) {
      const avg = [...this.selection].reduce((a, x) => a + x.volume, 0) / n;
      this.selInfo.textContent = `${n} note${n === 1 ? '' : 's'} selected`;
      if (document.activeElement !== this.selVolume) this.selVolume.value = String(Math.round(avg * 100));
      this.selVolumeText.textContent = `${Math.round(avg * 100)}%`;
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard commands

  selectAll() {
    this.selection = new Set(this.channelNotes());
    this.touch();
  }

  deleteSelected() {
    if (!this.selection.size) return false;
    this.edit(() => {
      const doomed = this.selection;
      this.pat.notes = this.pat.notes.filter((n) => !doomed.has(n));
      this.selection = new Set();
    });
    return true;
  }

  copySelected() {
    if (!this.selection.size) return false;
    const notes = [...this.selection].sort((a, b) => a.step - b.step || a.note - b.note);
    const min = notes[0].step;
    clipboard = notes.map((n) => ({ ...n, step: n.step - min }));
    this.host.toast(`Copied ${notes.length} note${notes.length === 1 ? '' : 's'}.`, { type: 'info', timeout: 1600 });
    return true;
  }

  paste() {
    if (!clipboard?.length) return false;
    const at = this.cursorStep ?? Math.min(...[...this.selection].map((n) => n.step), 0);
    const added = [];
    this.edit(() => {
      for (const c of clipboard) {
        const step = at + c.step;
        if (step >= this.L) continue;
        const n = { ...c, channel: this.channel, step, length: Math.min(c.length, this.L - step) };
        this.pat.notes.push(n);
        added.push(n);
      }
      this.sortNotes();
      this.selection = new Set(added);
    });
    const span = Math.max(...clipboard.map((c) => c.step + c.length));
    this.cursorStep = Math.min(this.L - 1, at + span);
    this.draw();
    return true;
  }

  duplicateSelected() {
    if (!this.selection.size) return false;
    const sel = [...this.selection];
    const min = Math.min(...sel.map((n) => n.step));
    const max = Math.max(...sel.map((n) => n.step + n.length));
    const span = max - min;
    const added = [];
    this.edit(() => {
      for (const n of sel) {
        const step = n.step + span;
        if (step >= this.L) continue;
        const copy = { ...n, step, length: Math.min(n.length, this.L - step) };
        this.pat.notes.push(copy);
        added.push(copy);
      }
      this.sortNotes();
      this.selection = new Set(added);
    });
    if (!added.length) this.host.toast('No room after the selection in this pattern.', { type: 'info' });
    return true;
  }

  nudge(ds, dp) {
    if (!this.selection.size) return false;
    const sel = [...this.selection];
    for (const n of sel) {
      ds = clamp(ds, -n.step, this.L - n.step - n.length);
      dp = clamp(dp, LOW - n.note, HIGH - n.note);
    }
    if (!ds && !dp) return true;
    this.history.record(`nudge`);
    for (const n of sel) {
      n.step += ds;
      n.note += dp;
    }
    this.sortNotes();
    if (dp && sel.length === 1) this.previewNote(sel[0].note, this.channel, sel[0].length, sel[0].volume);
    this.touch();
    return true;
  }

  handleKey(e) {
    if (this.handled.has(e)) return false;
    this.handled.add(e);
    if (typingTarget(e)) return false;
    const k = e.key.toLowerCase();
    if (modHeld(e)) {
      if (k === 'z' && !e.shiftKey) { this.history.undo(); return true; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { this.history.redo(); return true; }
      if (k === 'c') return this.copySelected();
      if (k === 'x') { if (this.copySelected()) this.deleteSelected(); return true; }
      if (k === 'v') return this.paste();
      if (k === 'd') { this.duplicateSelected(); return true; }
      if (k === 'a') { this.selectAll(); return true; }
      return false;
    }
    if (e.altKey) return false;
    // Keys on focused buttons and sliders keep their own meaning.
    const t = e.target;
    const onControl = t instanceof Element && t !== this.element && t.matches('button, input, select');
    if (e.key === ' ') {
      if (!e.repeat) this.togglePlay(e.shiftKey ? 'song' : 'pattern');
      return true;
    }
    if (e.key === 'Escape') {
      if (this.playing) this.stopPlayback();
      else if (this.selection.size) { this.selection.clear(); this.touch(); }
      else return false;
      return true;
    }
    if (onControl) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') return this.deleteSelected();
    const spb = this.song.stepsPerBeat;
    if (e.key === 'ArrowLeft') return this.nudge(e.shiftKey ? -spb : -1, 0);
    if (e.key === 'ArrowRight') return this.nudge(e.shiftKey ? spb : 1, 0);
    if (e.key === 'ArrowUp') return this.nudge(0, e.shiftKey ? 12 : 1);
    if (e.key === 'ArrowDown') return this.nudge(0, e.shiftKey ? -12 : -1);
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= this.song.channels.length) { this.selectChannel(Number(e.key) - 1); return true; }
    if (k === 'b' || k === 'd') { this.setMode('draw'); return true; }
    if (k === 's' || k === 'v') { this.setMode('select'); return true; }
    return false;
  }

  // -------------------------------------------------------------------------
  // Synthesizer and playback

  onSynthStatus() {
    if (!this.element) return;
    this.banner.update();
    this.element.classList.toggle('no-synth', !this.synth.ready);
    if (!this.synth.ready) this.stopPlayback();
    this.renderToolbar();
  }

  /** Project path of an instrument's sfx reference (relative to the song's folder). */
  resolveSfxPath(ref) {
    const rel = resolvePath(dirName(this.host.path), ref);
    if (this.host.exists(rel)) return rel;
    if (this.host.exists(ref)) return ref;
    return rel;
  }

  /** For renderSong: decoded sound effect params for a path in the song, or null. */
  readSfx(ref) {
    const path = this.resolveSfxPath(String(ref || ''));
    const text = this.host.read(path);
    if (typeof text !== 'string') return null;
    try {
      return { format: 'smitten.sfx', version: 1, ...normalizeSfx(JSON.parse(text)) };
    } catch {
      return null;
    }
  }

  /** A copy of the song for previews, with order replaced and muted channels left out. */
  previewSong(order) {
    const s = JSON.parse(JSON.stringify(this.song));
    s.order = order;
    s.loop = false;
    s.loopStart = 0;
    s.patterns = s.patterns.map((p) => ({ ...p, notes: p.notes.filter((n) => this.audible(n.channel)) }));
    return s;
  }

  async renderSong(song) {
    const samples = await this.synth.synth.renderSong(song, (p) => this.readSfx(p));
    return samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  }

  /** Play one note with a channel's instrument. */
  async previewNote(midi, channel = this.channel, length = this.lastLength, volume = 1) {
    if (!this.synth.ready) return;
    const seq = ++this.previewSeq;
    const len = clamp(length, 1, this.song.stepsPerBeat * 2);
    const s = JSON.parse(JSON.stringify(this.song));
    s.patterns = [{ name: 'Preview', notes: [{ channel, step: 0, length: len, note: midi, volume }] }];
    s.order = [0];
    s.patternLength = Math.max(len, 1);
    s.loop = false;
    s.loopStart = 0;
    let samples;
    try {
      samples = await this.renderSong(s);
    } catch (e) {
      console.error(e);
      return;
    }
    if (seq !== this.previewSeq || this.destroyed) return;
    this.notePlayer.stop();
    this.notePlayer.play(samples);
  }

  togglePlay(mode) {
    if (this.playing && this.playing.mode === mode) this.stopPlayback();
    else this.play(mode);
  }

  /** The order list a playback segment plays, and the slot it starts at. */
  segment(mode, first) {
    if (mode === 'pattern') return { order: [this.playing.pattern], offset: 0 };
    const s = this.song;
    const offset = first ? 0 : clamp(s.loopStart, 0, s.order.length - 1);
    return { order: s.order.slice(offset), offset };
  }

  async play(mode) {
    if (!this.synth.ready) return;
    this.stopPlayback();
    const run = { mode, pattern: this.pattern, start: 0, next: null };
    this.playing = run;
    this.renderToolbar();
    const seg = this.segment(mode, true);
    try {
      seg.samples = await this.renderSong(this.previewSong(seg.order));
    } catch (e) {
      console.error(e);
      this.host.toast(`Could not play the song: ${e.message}`, { type: 'error' });
      if (this.playing === run) this.stopPlayback();
      return;
    }
    if (this.playing !== run) return;
    this.startSegment(run, seg);
  }

  startSegment(run, seg) {
    run.seg = seg;
    run.next = null;
    run.duration = seg.order.length * this.L * this.stepDur;
    run.stepDur = this.stepDur;
    run.L = this.L;
    this.player.play(seg.samples);
    run.start = performance.now();
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.playing !== run || this.destroyed) return;
      const elapsed = (performance.now() - run.start) / 1000;
      const loops = run.mode === 'pattern' || this.song.loop;
      if (elapsed >= run.duration) {
        if (!loops) {
          // Let the last notes ring out; just stop following.
          this.player.handles.clear();
          this.playing = null;
          this.playStep = null;
          this.playSlot = null;
          this.renderToolbar();
          this.renderOrder();
          this.draw();
          return;
        }
        if (run.nextSamples) {
          const next = run.nextSeg;
          next.samples = run.nextSamples;
          this.startSegment(run, next);
          return;
        }
      } else if (loops && !run.next && elapsed >= run.duration * 0.6) {
        // Render the next pass ahead of time so the loop doesn't stall;
        // edits made before this point are heard in it.
        const nextSeg = this.segment(run.mode, false);
        run.nextSeg = nextSeg;
        run.next = this.renderSong(this.previewSong(nextSeg.order)).then((s) => { run.nextSamples = s; }).catch((e) => {
          console.error(e);
          if (this.playing === run) this.stopPlayback();
        });
      }
      const pos = Math.min(elapsed, run.duration - 1e-6) / run.stepDur;
      const slotInSeg = Math.floor(pos / run.L);
      this.playStep = pos - slotInSeg * run.L;
      if (run.mode === 'song') {
        const slot = run.seg.offset + slotInSeg;
        if (slot !== this.playSlot) {
          this.playSlot = slot;
          // Follow the song: show the pattern that is playing.
          const pi = this.song.order[slot];
          if (pi != null && !this.drag) {
            this.slot = slot;
            if (pi !== this.pattern) this.selectPattern(pi);
          }
          this.renderOrder();
        }
      }
      this.followPlayhead();
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  followPlayhead() {
    if (this.playStep == null || this.drag || !this.playingThisPattern()) return;
    const x = this.playStep * this.stepW;
    const left = this.scroller.scrollLeft;
    const w = this.scroller.clientWidth;
    if (x < left || x > left + w - 20) this.scroller.scrollLeft = Math.max(0, x - 20);
  }

  stopPlayback() {
    cancelAnimationFrame(this.raf);
    this.player.stop();
    const was = !!this.playing;
    this.playing = null;
    this.playStep = null;
    this.playSlot = null;
    if (was && this.element) {
      this.renderToolbar();
      this.renderOrder();
      this.draw();
    }
  }

  // -------------------------------------------------------------------------
  // Tool interface

  async save() {
    const text = songText(this.song);
    await this.host.write(this.host.path, text);
    this.savedText = text;
    this.host.setDirty(false);
  }

  focus() {
    if (!this.element.contains(document.activeElement)) this.element.focus({ preventScroll: true });
  }

  show() {
    requestAnimationFrame(() => this.draw());
  }

  hide() {
    this.stopPlayback();
    this.notePlayer.stop();
  }

  reload(path) {
    if (/\.sfx\.json$/i.test(path)) {
      // The sound effect list or an instrument's sound changed.
      if (this.song.instruments[this.song.channels[this.channel]?.instrument]?.type === 'sfx') this.renderInstrument();
      return;
    }
    if (path !== this.host.path) return;
    if (songText(this.song) !== this.savedText) return; // unsaved edits win
    const text = this.host.read(this.host.path);
    if (typeof text !== 'string') return;
    let song;
    try { song = parseSong(text); } catch { return; }
    const next = songText(song);
    if (next === this.savedText) return;
    this.song = song;
    this.savedText = next;
    this.selection.clear();
    this.history.clear();
    this.clampView();
    this.refreshAll();
    this.host.setDirty(false);
  }

  destroy() {
    this.destroyed = true;
    this.synth.destroyed = true;
    this.stopPlayback();
    this.notePlayer.stop();
    this.resizeObserver.disconnect();
    this.unwatchTheme();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
  else ctx.rect(x, y, Math.max(0, w), Math.max(0, h));
}

export default {
  id: 'music',
  label: 'Music editor',
  match: (path) => /\.song\.json$/i.test(path),
  newAssets: [{
    label: 'Song',
    folder: 'music',
    extension: '.song.json',
    files: (base) => ({ [`${base}.song.json`]: songText(defaultSong()) }),
  }],
  open(host) {
    return new MusicEditor(host);
  },
};
