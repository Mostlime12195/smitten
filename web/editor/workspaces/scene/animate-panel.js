// The Animate panel (docked under the scene view, next to Output): an
// Animator's animations on a timeline. Pick an animation, drag the playhead
// on the ruler, add tracks (a property of a piece, or call keys), and
// select, drag and delete the keys (diamonds). With Record on, a property
// changed in the Inspector or dragged in the scene view becomes a key at the
// playhead.
//
// The scene view shows the animation at the playhead: the panel gives the
// SceneDoc a preview (SceneDoc.setPreview), which only changes what is
// shown; the scene's file, the undo history and "unsaved" never see it. It
// goes away when the panel is hidden, another scene opens or Stop is pressed.
// Every change to the animations is an undoable edit of the Animator's
// `animations` property (core/animations.js).

import { h, icon, showMenu, promptDialog, confirmDialog } from '../../ui.js';
import { nodeIcon } from '../../shell/node-icons.js';
import { propertyDef } from '../../core/schema.js';
import * as A from '../../core/animations.js';
import { EASING_NAMES, sorted, sample, lengthOf } from './keyframes.js';

const ROW = 24; // a track's height, CSS px
const RULER = 24; // the time ruler's height
const KEY_R = 5; // a diamond's half size
const SNAPS = [0, 0.01, 0.05, 0.1, 0.25, 0.5];
const SNAP_KEY = 'smitten-editor.animate-snap';

const fmt = (t) => String(Math.round(t * 1000) / 1000);

export class AnimatePanel {
  /** ctx: { showPanel() } (shows the panel when an Animator is selected). */
  constructor(container, ctx = {}) {
    this.ctx = ctx;
    this.doc = null;
    this.animator = null;
    this.anim = null; // the animation's name
    this.time = 0;
    this.sel = []; // selected keys: [{ track, index }]
    this.recordOn = false;
    this.previewOn = false;
    this.playing = false;
    this.pps = 0; // pixels per second; 0: fit the animation's length
    this.scrollX = 0; // seconds at the left edge
    this.scrollY = 0;
    this.visible = false;
    this.drag = null;
    this.dragSeq = 0;
    this.raf = 0;
    try {
      this.snap = Number(localStorage.getItem(SNAP_KEY) ?? 0.05);
    } catch {
      this.snap = 0.05;
    }
    if (!SNAPS.includes(this.snap)) this.snap = 0.05;

    this.root = h('div', { class: 'anp', tabindex: '-1' });
    container.append(this.root);
    this.onChange = () => this.refresh();
    this.onSelect = () => this.followSelection();
    this.root.addEventListener('keydown', (e) => this.key(e));
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => {
        const r = this.root.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0;
        if (visible !== this.visible) {
          this.visible = visible;
          if (!visible) this.leave();
          else this.updatePreview();
        }
        this.draw();
      });
      this.ro.observe(this.root);
    }
    this.render();
  }

  // -------------------------------------------------------------------------
  // The scene and the Animator

  setDoc(doc) {
    if (doc === this.doc) return;
    this.leave();
    if (this.doc) {
      this.doc.removeEventListener('change', this.onChange);
      this.doc.removeEventListener('select', this.onSelect);
    }
    this.doc = doc && !doc.live ? doc : null;
    this.animator = null;
    this.anim = null;
    this.sel = [];
    if (this.doc) {
      this.doc.addEventListener('change', this.onChange);
      this.doc.addEventListener('select', this.onSelect);
      this.followSelection(false);
    }
    this.render();
  }

  /** The Animator to edit: a selected one, or one inside the selected piece; else the one before. */
  followSelection(show = true) {
    const doc = this.doc;
    if (!doc) return;
    const sel = doc.selected();
    let found = null;
    if (sel.length === 1) {
      const n = sel[0];
      if (n.type === 'Animator') found = n;
      else found = (n.readonly ? [] : n.children).find((c) => c.type === 'Animator') || null;
    }
    if (found && found !== this.animator) {
      this.setAnimator(found);
      if (show && sel[0] === found) this.ctx.showPanel?.();
    } else if (!this.animator || !this.inDoc(this.animator)) {
      this.setAnimator(null);
    } else {
      this.renderEmptyHint();
    }
  }

  inDoc(node) {
    for (let n = node; n; n = n.parent) if (n === this.doc?.root) return true;
    return false;
  }

  setAnimator(node) {
    this.stopPlaying();
    this.setRecord(false);
    this.animator = node;
    this.sel = [];
    this.time = 0;
    this.scrollX = 0;
    this.pps = 0;
    const names = node ? A.animationNames(this.doc, node) : [];
    const auto = node ? this.doc.get(node, 'autoplay') : '';
    this.anim = names.includes(auto) ? auto : names[0] || null;
    this.previewOn = !!this.anim;
    this.render();
    this.updatePreview();
  }

  /** The scene changed (an edit, undo or redo): show it. */
  refresh() {
    if (!this.doc) return;
    if (this.animator && !this.inDoc(this.animator)) {
      this.setAnimator(null);
      return;
    }
    if (this.animator) {
      const names = A.animationNames(this.doc, this.animator);
      if (this.anim && !names.includes(this.anim)) this.anim = names[0] || null;
      if (!this.anim && names.length) this.anim = names[0];
      const tracks = this.tracks();
      this.sel = this.sel.filter((r) => r.track < tracks.length && r.index < A.keysOf(tracks[r.track]).length);
    }
    if (this.drag?.kind === 'keys') {
      // Dragging: only the timeline and the key bar change.
      this.draw();
      this.renderKeyBar();
    } else {
      this.render();
    }
    this.updatePreview();
  }

  animation() {
    return this.animator && this.anim ? A.animationsOf(this.doc, this.animator)[this.anim] || null : null;
  }

  tracks() {
    return this.animation()?.tracks || [];
  }

  length() {
    const a = this.animation();
    return a ? Math.max(lengthOf(a), 0.01) : 1;
  }

  // -------------------------------------------------------------------------
  // Preview and recording

  /** What the scene view shows: the animation at the playhead, while that's on. */
  updatePreview() {
    const doc = this.doc;
    if (!doc) return;
    if (!this.visible || !this.previewOn || !this.animation()) {
      doc.previewNote = null;
      doc.setPreview(null);
      return;
    }
    doc.previewNote = this.recordOn
      ? { recording: true, text: `Recording "${this.anim}" at ${fmt(this.time)} seconds: a property you change here becomes a key.` }
      : { recording: false, text: `Showing "${this.anim}" at ${fmt(this.time)} seconds. Animated properties show the values of the animation.` };
    doc.setPreview(A.previewAt(doc, this.animator, this.anim, this.time));
  }

  /** Back to the scene as it is saved: no preview, no recording, no playing. */
  leave() {
    this.stopPlaying();
    this.setRecord(false);
    if (this.doc) {
      this.doc.previewNote = null;
      this.doc.setPreview(null);
    }
  }

  setRecord(on) {
    on = !!on && !!this.animation() && !!this.doc;
    this.recordOn = on;
    if (this.doc) {
      if (on) {
        this.doc.recorder = (entries, opts) => A.record(this.doc, this.animator, this.anim, this.time, entries, opts);
        this.previewOn = true;
      } else if (this.doc.recorder) {
        this.doc.recorder = null;
      }
    }
    this.recordBtn?.setAttribute('aria-pressed', String(on));
    this.root.classList.toggle('recording', on);
    this.updatePreview();
    this.draw();
  }

  setTime(t, { snap = true } = {}) {
    const len = this.length();
    if (snap && this.snap > 0) t = Math.round(t / this.snap) * this.snap;
    this.time = Math.max(0, Math.min(len, Math.round(t * 1e6) / 1e6));
    this.previewOn = true;
    if (this.timeInput && document.activeElement !== this.timeInput) this.timeInput.value = fmt(this.time);
    this.updatePreview();
    this.draw();
  }

  togglePlay() {
    if (this.playing) {
      this.stopPlaying();
      return;
    }
    if (!this.animation()) return;
    if (this.time >= this.length() - 1e-6 && !this.animation().loop) this.time = 0;
    this.playing = true;
    this.previewOn = true;
    let last = performance.now();
    const step = (now) => {
      if (!this.playing) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const a = this.animation();
      if (!a) return this.stopPlaying();
      let t = this.time + dt * (Number(this.doc.get(this.animator, 'speed')) || 1);
      const len = this.length();
      if (a.loop) t = ((t % len) + len) % len;
      else if (t >= len || t <= 0) {
        t = Math.max(0, Math.min(len, t));
        this.setTime(t, { snap: false });
        return this.stopPlaying();
      }
      this.setTime(t, { snap: false });
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    this.updateButtons();
  }

  stopPlaying() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.updateButtons();
  }

  /** Stop: no playing, the playhead at 0, and the scene as it is saved. */
  stopPreview() {
    this.stopPlaying();
    this.setRecord(false);
    this.previewOn = false;
    this.time = 0;
    if (this.timeInput) this.timeInput.value = '0';
    this.updatePreview();
    this.draw();
  }

  // -------------------------------------------------------------------------
  // Drawing the panel

  render() {
    this.root.replaceChildren();
    this.canvas = null;
    this.timeInput = null;
    this.recordBtn = null;
    this.playBtn = null;
    const doc = this.doc;
    if (!doc) {
      this.root.append(this.empty('Open a scene to animate its pieces.'));
      return;
    }
    if (!this.animator) {
      this.root.append(this.emptyHintEl = this.empty(...this.noAnimatorText()));
      return;
    }
    this.root.append(this.toolbar());
    this.keyBar = h('div', { class: 'anp-keybar', hidden: true });
    this.root.append(this.keyBar);
    if (!this.anim) {
      this.root.append(this.empty('Make an animation, then add a track for each property that it changes.',
        h('button', { type: 'button', class: 'btn small primary', onclick: () => this.newAnimation() }, icon('plus', 14), 'New animation')));
      return;
    }
    this.labels = h('div', { class: 'anp-labels' });
    this.canvas = h('canvas', { class: 'anp-canvas', tabindex: '-1' });
    const header = h('div', { class: 'anp-head' },
      h('button', { type: 'button', class: 'btn small', title: 'Add a track: a property of a piece, or call keys', onclick: (e) => this.addTrackMenu(e.currentTarget) }, icon('plus', 13), 'Track'));
    this.labelCol = h('div', { class: 'anp-labelcol' }, header, h('div', { class: 'anp-labelscroll' }, this.labels));
    this.timeCol = h('div', { class: 'anp-timecol' }, this.canvas);
    this.root.append(h('div', { class: 'anp-body' }, this.labelCol, this.timeCol));
    this.renderLabels();
    this.renderKeyBar();
    this.bindCanvas();
    this.draw();
  }

  empty(text, ...extra) {
    return h('div', { class: 'anp-empty' }, h('p', {}, text), ...extra);
  }

  noAnimatorText() {
    const sel = this.doc.selected();
    const node = sel.length === 1 && !sel[0].readonly ? sel[0] : null;
    if (!node) return ['An Animator piece holds animations. Select an Animator in the Scene panel, or select a piece to add one to.'];
    const add = h('button', { type: 'button', class: 'btn small primary', onclick: () => this.addAnimator(node) }, icon('animator', 14), `Add an Animator to ${node.name}`);
    return [`An Animator can change the properties of ${node.name} and of the pieces inside it.`, add];
  }

  renderEmptyHint() {
    if (this.animator || !this.emptyHintEl) return;
    const el = this.empty(...this.noAnimatorText());
    this.emptyHintEl.replaceWith(el);
    this.emptyHintEl = el;
  }

  addAnimator(parent) {
    const doc = this.doc;
    const node = doc.add(parent, doc.createNode('Animator', {}, 'Animator'));
    doc.select([node]);
    this.setAnimator(node);
  }

  toolbar() {
    const doc = this.doc;
    const names = A.animationNames(doc, this.animator);
    const bar = h('div', { class: 'anp-bar' });
    const who = h('button', { type: 'button', class: 'anp-who', title: 'Select this Animator in the Scene panel', onclick: () => doc.select([this.animator]) },
      nodeIcon('Animator', 14), h('span', {}, this.animator.name));
    bar.append(who);
    if (names.length) {
      const pick = h('select', { class: 'input anp-pick', 'aria-label': 'Animation', title: 'The animation to edit' },
        ...names.map((n) => h('option', { value: n, selected: n === this.anim }, n)));
      pick.addEventListener('change', () => {
        this.stopPlaying();
        this.anim = pick.value;
        this.sel = [];
        this.time = Math.min(this.time, this.length());
        this.setRecord(this.recordOn);
        this.render();
        this.updatePreview();
      });
      bar.append(pick);
    }
    bar.append(this.iconBtn('plus', 'New animation', () => this.newAnimation()));
    if (this.anim) {
      bar.append(this.iconBtn('more', 'Rename or delete this animation', (e) => showMenu(e.currentTarget, [
        { label: 'Rename…', icon: 'pencil', action: () => this.renameAnimation() },
        { label: 'Delete', icon: 'trash', danger: true, action: () => this.deleteAnimation() },
      ])));
      bar.append(h('span', { class: 'anp-sep' }));
      bar.append(this.iconBtn('skipBack', 'Go to the start (Home)', () => this.setTime(0)));
      this.playBtn = this.iconBtn('play', 'Play the animation here (Space)', () => this.togglePlay());
      this.stopBtn = this.iconBtn('stop', 'Stop: go back to the start and show the saved scene', () => this.stopPreview());
      bar.append(this.playBtn, this.stopBtn);
      this.timeInput = h('input', { class: 'input num-input anp-time', value: fmt(this.time), 'aria-label': 'Playhead time in seconds', title: 'The time of the playhead, in seconds' });
      this.timeInput.addEventListener('change', () => this.setTime(Number(this.timeInput.value) || 0, { snap: false }));
      this.timeInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.timeInput.blur(); });
      bar.append(this.timeInput, h('span', { class: 'num-unit' }, 's'));
      bar.append(h('span', { class: 'anp-sep' }));
      const anim = this.animation();
      const len = h('input', { class: 'input num-input anp-len', value: fmt(lengthOf(anim) || 1), 'aria-label': 'Length in seconds', title: 'How long the animation is, in seconds' });
      len.addEventListener('change', () => {
        const v = Number(len.value);
        if (Number.isFinite(v) && v > 0) A.setAnimation(doc, this.animator, this.anim, { length: v }, { label: 'Change the length' });
        else len.value = fmt(lengthOf(anim));
      });
      len.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') len.blur(); });
      bar.append(h('label', { class: 'anp-field' }, 'Length', len, h('span', { class: 'num-unit' }, 's')));
      const loop = h('button', { type: 'button', class: 'tool-btn anp-loop', 'aria-pressed': String(!!anim.loop), 'aria-label': 'Loop',
        title: anim.loop ? 'Loop is on: the animation starts again at the end' : 'Loop is off: the animation stops at the end' }, icon('repeat', 14));
      loop.addEventListener('click', () => A.setAnimation(doc, this.animator, this.anim, { loop: !anim.loop }, { label: anim.loop ? 'Stop looping' : 'Loop' }));
      bar.append(loop);
      const snap = h('select', { class: 'input anp-snap', 'aria-label': 'Snap', title: 'Keys and the playhead snap to this step (hold Alt to not snap)' },
        ...SNAPS.map((s) => h('option', { value: String(s), selected: s === this.snap }, s ? `${s} s` : 'Off')));
      snap.addEventListener('change', () => {
        this.snap = Number(snap.value);
        try { localStorage.setItem(SNAP_KEY, String(this.snap)); } catch { /* private mode */ }
      });
      bar.append(h('label', { class: 'anp-field' }, icon('magnet', 13), snap));
      bar.append(h('span', { class: 'spacer' }));
      this.recordBtn = h('button', { type: 'button', class: 'tool-btn anp-record', 'aria-pressed': String(this.recordOn),
        title: 'Record: a property you change in the Inspector or the scene view becomes a key at the playhead' }, icon('record', 14), 'Record');
      this.recordBtn.addEventListener('click', () => this.setRecord(!this.recordOn));
      bar.append(this.recordBtn);
    }
    this.updateButtons();
    return bar;
  }

  iconBtn(name, title, onclick) {
    return h('button', { type: 'button', class: 'icon-btn', title, 'aria-label': title, onclick }, icon(name, 15));
  }

  updateButtons() {
    if (!this.playBtn) return;
    this.playBtn.replaceChildren(icon(this.playing ? 'pause' : 'play', 15));
    this.playBtn.title = this.playing ? 'Pause (Space)' : 'Play the animation here (Space)';
    this.playBtn.setAttribute('aria-label', this.playBtn.title);
  }

  renderLabels() {
    const doc = this.doc;
    this.labels.replaceChildren();
    this.tracks().forEach((tr, i) => {
      const node = A.resolve(doc, this.animator, tr.piece);
      const what = tr.calls ? 'calls' : tr.property;
      const remove = h('button', { type: 'button', class: 'anp-remove', title: 'Delete this track', 'aria-label': 'Delete this track' }, icon('x', 12));
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sel = [];
        A.removeTrack(doc, this.animator, this.anim, i);
      });
      const name = tr.piece === '.' ? (node?.name || 'parent') : tr.piece;
      const row = h('div', {
        class: `anp-label${node ? '' : ' missing'}`,
        title: node ? `${tr.piece}: ${what}. Click to select the piece.` : `There is no piece "${tr.piece}" next to the Animator, so this track does nothing.`,
      }, node ? nodeIcon(node.type, 13) : icon('alert', 13), h('span', { class: 'anp-piece' }, name), h('span', { class: 'anp-prop' }, what), remove);
      row.addEventListener('click', () => { if (node) doc.select([node]); });
      this.labels.append(row);
    });
    this.labels.style.transform = `translateY(${-this.scrollY}px)`;
  }

  // The bar for the selected keys: time, value and easing (or the method to call).
  renderKeyBar() {
    const bar = this.keyBar;
    if (!bar) return;
    if (document.activeElement && bar.contains(document.activeElement) && this.drag?.kind !== 'keys') return;
    bar.replaceChildren();
    const doc = this.doc;
    const tracks = this.tracks();
    const refs = this.sel.filter((r) => tracks[r.track]);
    bar.hidden = !refs.length;
    if (!refs.length) return;
    const del = h('button', { type: 'button', class: 'btn small', title: 'Delete the selected keys (Delete)', onclick: () => this.deleteSelected() }, icon('trash', 13), 'Delete');
    if (refs.length > 1) {
      const props = refs.filter((r) => !tracks[r.track].calls);
      bar.append(h('span', { class: 'anp-keyname' }, `${refs.length} keys`));
      if (props.length) bar.append(this.easingField(undefined, (e) => this.forSelected('Change the easing', (key, tr) => { if (!tr.calls) setEase(key, e); })));
      bar.append(h('span', { class: 'spacer' }), del);
      return;
    }
    const r = refs[0];
    const tr = tracks[r.track];
    const key = A.keysOf(tr)[r.index];
    if (!key) return;
    const node = A.resolve(doc, this.animator, tr.piece);
    bar.append(h('span', { class: 'anp-keyname' }, icon('keyframe', 12), `${tr.piece === '.' ? node?.name || 'parent' : tr.piece} · ${tr.calls ? 'call' : tr.property}`));
    const time = this.numField('Time', key.time, 's', (v) => {
      A.changeKey(doc, this.animator, this.anim, r, { time: v });
      this.sel = A.sortKeys(doc, this.animator, this.anim, this.sel);
    });
    bar.append(time);
    if (tr.calls) {
      const list = `anp-methods-${r.track}`;
      const method = h('input', { class: 'input anp-method', value: key.method || '', list, spellcheck: 'false', 'aria-label': 'Method', title: 'The method or script function to call on the piece' });
      const options = h('datalist', { id: list }, ...(node ? A.callable(node.type) : []).map((m) => h('option', { value: m })));
      method.addEventListener('change', () => A.changeKey(doc, this.animator, this.anim, r, { method: method.value.trim() }));
      method.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') method.blur(); });
      const args = h('input', { class: 'input anp-args', value: (key.args || []).map((a) => JSON.stringify(a)).join(', '), spellcheck: 'false', 'aria-label': 'Values',
        title: 'The values to give the method, with commas between them: "opened", 2, true' });
      args.addEventListener('change', () => A.changeKey(doc, this.animator, this.anim, r, { args: A.parseArgs(args.value) }));
      args.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') args.blur(); });
      bar.append(h('label', { class: 'anp-field' }, 'Call', method, options), h('label', { class: 'anp-field grow' }, 'With', args));
    } else {
      const def = node ? propertyDef(node.type, tr.property) : null;
      bar.append(h('label', { class: 'anp-field grow' }, 'Value', this.valueEditor(def, key.value, (v) => A.changeKey(doc, this.animator, this.anim, r, { value: v }))));
      const first = sorted(tr.keys.map((k, i) => ({ time: k.time, i })))[0]?.i === r.index;
      bar.append(this.easingField(key.easing || 'linear', (e) => A.changeKey(doc, this.animator, this.anim, r, { easing: e }), first));
    }
    bar.append(h('span', { class: 'spacer' }), del);
  }

  numField(label, value, unit, set) {
    const input = h('input', { class: 'input num-input', value: fmt(value), 'aria-label': label });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) set(v);
      else input.value = fmt(value);
    });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
    return h('label', { class: 'anp-field' }, label, input, unit ? h('span', { class: 'num-unit' }, unit) : null);
  }

  easingField(value, set, first = false) {
    const sel = h('select', { class: 'input', 'aria-label': 'Easing', disabled: first,
      title: first ? 'The first key has no easing: an easing shapes the change to a key from the key before it'
        : 'How the value gets to this key from the key before it. Step: no change until this key' },
    ...(value === undefined ? [h('option', { value: '', selected: true }, '(easing)')] : []),
    ...EASING_NAMES.map((e) => h('option', { value: e, selected: e === value }, e)));
    sel.addEventListener('change', () => { if (sel.value) set(sel.value); });
    return h('label', { class: 'anp-field' }, 'Easing', sel);
  }

  valueEditor(def, value, set) {
    const type = def?.type;
    const done = (el) => {
      el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName !== 'TEXTAREA') el.blur(); });
      return el;
    };
    if (typeof value === 'boolean' || type === 'bool') {
      const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!value), 'aria-label': 'Value' });
      sw.addEventListener('click', () => set(!value));
      return sw;
    }
    if (type === 'enum' && def.options) {
      const sel = h('select', { class: 'input' }, ...def.options.map((o) => h('option', { value: o, selected: o === value }, o)));
      sel.addEventListener('change', () => set(sel.value));
      return sel;
    }
    if (type === 'color' && Array.isArray(value)) {
      const hex = '#' + value.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
      const picker = h('input', { type: 'color', value: hex, 'aria-label': 'Color' });
      picker.addEventListener('change', () => {
        const n = parseInt(picker.value.slice(1), 16);
        set([(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, value[3] ?? 1]);
      });
      const alpha = done(h('input', { class: 'input num-input', value: String(Math.round((value[3] ?? 1) * 100)), title: 'Opacity (%)', style: 'width: 48px' }));
      alpha.addEventListener('change', () => set([value[0], value[1], value[2], Math.max(0, Math.min(100, Number(alpha.value) || 0)) / 100]));
      return h('span', { class: 'anp-color' }, h('span', { class: 'color-swatch', style: `background: ${hex}` }, picker), alpha, h('span', { class: 'num-unit' }, '%'));
    }
    if (typeof value === 'number' || ['number', 'int', 'angle'].includes(type)) {
      const input = done(h('input', { class: 'input num-input', value: fmt(Number(value) || 0), 'aria-label': 'Value' }));
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) set(type === 'int' ? Math.round(v) : v);
      });
      return h('span', { class: 'anp-num' }, input, type === 'angle' ? h('span', { class: 'num-unit' }, '°') : null);
    }
    if (Array.isArray(value)) {
      const input = done(h('input', { class: 'input', value: value.join(', '), spellcheck: 'false', 'aria-label': 'Value' }));
      input.addEventListener('change', () => set(input.value.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n))));
      return input;
    }
    const input = done(h('input', { class: 'input', value: String(value ?? ''), spellcheck: 'false', 'aria-label': 'Value' }));
    input.addEventListener('change', () => set(input.value));
    return input;
  }

  // -------------------------------------------------------------------------
  // Animations and tracks

  async newAnimation() {
    const name = await promptDialog({ title: 'New animation', label: 'Name', value: A.uniqueAnimationName(this.doc, this.animator, 'animation'), okLabel: 'Make', selectBase: true,
      validate: (v) => (!v.trim() ? 'Give it a name.' : A.animationNames(this.doc, this.animator).includes(v.trim()) ? 'There is an animation with this name.' : null) });
    if (!name) return;
    this.anim = A.addAnimation(this.doc, this.animator, name.trim());
    this.sel = [];
    this.time = 0;
    this.previewOn = true;
    this.render();
    this.updatePreview();
  }

  async renameAnimation() {
    const name = await promptDialog({ title: 'Rename the animation', label: 'Name', value: this.anim, okLabel: 'Rename',
      validate: (v) => (!v.trim() ? 'Give it a name.' : v.trim() !== this.anim && A.animationNames(this.doc, this.animator).includes(v.trim()) ? 'There is an animation with this name.' : null) });
    if (!name || name.trim() === this.anim) return;
    const from = this.anim;
    this.anim = name.trim();
    if (!A.renameAnimation(this.doc, this.animator, from, this.anim)) this.anim = from;
    this.render();
  }

  async deleteAnimation() {
    const ok = await confirmDialog({ title: `Delete "${this.anim}"?`, message: 'The animation and its keys go. Undo brings them back.', okLabel: 'Delete', danger: true });
    if (!ok) return;
    this.sel = [];
    A.deleteAnimation(this.doc, this.animator, this.anim);
  }

  addTrackMenu(anchor) {
    const doc = this.doc;
    const targets = A.targetsOf(doc, this.animator).filter(({ node }) => node !== this.animator);
    showMenu(anchor, [
      { heading: 'Animate a piece' },
      ...targets.map(({ node, path }) => ({
        label: path === '.' ? `${node.name} (the parent)` : path,
        action: () => this.propertyMenu(anchor, node, path),
      })),
    ]);
  }

  propertyMenu(anchor, node, path) {
    const tracks = this.tracks();
    const has = (p) => tracks.some((t) => t.piece === path && (p ? t.property === p : !!t.calls));
    const items = [{ heading: `${path === '.' ? node.name : path}: what to change` },
      { label: 'Call keys (call a method at a time)', icon: 'zap', disabled: has(null), action: () => this.addTrack(node, path, null) }, '-'];
    for (const { name } of A.animatable(node.type)) items.push({ label: name, disabled: has(name), action: () => this.addTrack(node, path, name) });
    requestAnimationFrame(() => showMenu(anchor, items));
  }

  /** A new track, with a key at the playhead: the piece's value now, or a call. */
  addTrack(node, path, property) {
    const doc = this.doc;
    const t = Math.round(this.time * 1e6) / 1e6;
    let index = -1;
    A.editAnimations(doc, this.animator, property ? `Add a track for ${path}.${property}` : `Add call keys for ${path}`, (a) => {
      const anim = a[this.anim];
      if (!anim) return false;
      anim.tracks = anim.tracks || [];
      if (property) {
        anim.tracks.push({ piece: path, property, keys: [{ time: t, value: doc.get(node, property) }] });
      } else {
        const { method, args } = A.defaultCall(node.type, this.anim);
        anim.tracks.push({ piece: path, calls: [args.length ? { time: t, method, args } : { time: t, method }] });
      }
      index = anim.tracks.length - 1;
    });
    if (index >= 0) this.sel = [{ track: index, index: 0 }];
    this.render();
  }

  forSelected(label, fn) {
    const refs = this.sel;
    A.editAnimations(this.doc, this.animator, label, (a) => {
      const anim = a[this.anim];
      if (!anim) return false;
      for (const r of refs) {
        const tr = anim.tracks?.[r.track];
        const key = tr && A.keysOf(tr)[r.index];
        if (key) fn(key, tr);
      }
    });
  }

  deleteSelected() {
    if (!this.sel.length) return;
    const refs = this.sel;
    this.sel = [];
    A.deleteKeys(this.doc, this.animator, this.anim, refs);
  }

  /** A key at the playhead (or at t) on a track: the value there now, or a call. */
  addKeyAt(trackIndex, t) {
    const doc = this.doc;
    const tr = this.tracks()[trackIndex];
    if (!tr) return;
    const node = A.resolve(doc, this.animator, tr.piece);
    let index;
    if (tr.calls) {
      const { method, args } = A.defaultCall(node?.type || 'Group', this.anim);
      index = A.addCall(doc, this.animator, this.anim, trackIndex, t, method, args);
    } else {
      const keys = sorted(tr.keys || []);
      const value = keys.length ? sample(keys, t) : node ? doc.get(node, tr.property) : 0;
      index = A.setKey(doc, this.animator, this.anim, trackIndex, t, value, { label: 'Add a key' });
    }
    if (index >= 0) this.sel = [{ track: trackIndex, index }];
    this.renderKeyBar();
    this.draw();
  }

  // -------------------------------------------------------------------------
  // The timeline

  /** Pixels per second now (fit: the length fills the width). */
  scale() {
    const w = Math.max(50, (this.canvas?.clientWidth || 300) - 24);
    return this.pps || Math.max(20, w / this.length());
  }

  xOf(t) {
    return 12 + (t - this.scrollX) * this.scale();
  }

  tOf(x) {
    return (x - 12) / this.scale() + this.scrollX;
  }

  draw() {
    const c = this.canvas;
    if (!c || !this.visible) return;
    const w = c.clientWidth;
    const hh = c.clientHeight;
    if (!w || !hh) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hh * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.root);
    const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const fg = color('--fg', '#ececee');
    const muted = color('--fg-muted', '#a2a5ad');
    const subtle = color('--fg-subtle', '#6b6f78');
    const accent = color('--accent', '#4b8bff');
    const danger = color('--danger-solid', '#e5484d');
    const panel2 = color('--panel-2', '#232428');
    const border = color('--border-strong', 'rgba(255,255,255,0.11)');
    g.clearRect(0, 0, w, hh);
    const len = this.length();
    const tracks = this.tracks();
    const pps = this.scale();
    const x0 = this.xOf(0);
    const xEnd = this.xOf(len);

    // Rows.
    g.save();
    g.beginPath();
    g.rect(0, RULER, w, hh - RULER);
    g.clip();
    tracks.forEach((tr, i) => {
      const y = RULER + i * ROW - this.scrollY;
      if (y + ROW < RULER || y > hh) return;
      if (i % 2) {
        g.fillStyle = panel2;
        g.globalAlpha = 0.5;
        g.fillRect(0, y, w, ROW);
        g.globalAlpha = 1;
      }
    });
    // Past the end.
    g.fillStyle = 'rgba(0, 0, 0, 0.22)';
    g.fillRect(xEnd, RULER, w - xEnd, hh - RULER);
    if (x0 > 0) g.fillRect(0, RULER, x0, hh - RULER);
    g.strokeStyle = border;
    g.beginPath();
    g.moveTo(Math.round(xEnd) + 0.5, RULER);
    g.lineTo(Math.round(xEnd) + 0.5, hh);
    g.stroke();
    // Keys.
    const selected = new Set(this.sel.map((r) => `${r.track}:${r.index}`));
    tracks.forEach((tr, ti) => {
      const y = RULER + ti * ROW - this.scrollY + ROW / 2;
      if (y < RULER - ROW || y > hh + ROW) return;
      const node = A.resolve(this.doc, this.animator, tr.piece);
      const keys = A.keysOf(tr);
      const order = sorted(keys.map((k, i) => ({ time: k.time, i })));
      // What happens between keys: a line where the value changes, a step
      // where it jumps.
      g.strokeStyle = muted;
      g.globalAlpha = node ? 0.5 : 0.25;
      g.lineWidth = 1.5;
      if (!tr.calls) {
        for (let j = 1; j < order.length; j++) {
          const a = keys[order[j - 1].i];
          const b = keys[order[j].i];
          const xa = this.xOf(a.time);
          const xb = this.xOf(b.time);
          g.setLineDash(b.easing === 'step' || (typeof a.value !== 'number' && !Array.isArray(a.value)) ? [3, 3] : []);
          g.beginPath();
          g.moveTo(xa + KEY_R, y);
          g.lineTo(xb - KEY_R, y);
          g.stroke();
        }
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
      keys.forEach((k, ki) => {
        const x = this.xOf(k.time);
        if (x < -KEY_R || x > w + KEY_R) return;
        const on = selected.has(`${ti}:${ki}`);
        g.fillStyle = on ? accent : node ? fg : subtle;
        g.strokeStyle = on ? fg : 'rgba(0, 0, 0, 0.55)';
        g.lineWidth = 1;
        g.beginPath();
        if (tr.calls) {
          g.arc(x, y, KEY_R - 0.5, 0, Math.PI * 2);
        } else {
          g.moveTo(x, y - KEY_R - 1);
          g.lineTo(x + KEY_R + 1, y);
          g.lineTo(x, y + KEY_R + 1);
          g.lineTo(x - KEY_R - 1, y);
          g.closePath();
        }
        g.fill();
        g.stroke();
      });
    });
    g.restore();

    // The ruler: a mark every step, a number every few.
    g.fillStyle = color('--panel', '#18191c');
    g.fillRect(0, 0, w, RULER);
    g.strokeStyle = border;
    g.beginPath();
    g.moveTo(0, RULER - 0.5);
    g.lineTo(w, RULER - 0.5);
    g.stroke();
    const steps = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
    const minor = steps.find((s) => s * pps >= 8) || 60;
    const major = steps.find((s) => s * pps >= 56 && s >= minor * 2) || minor * 5;
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'top';
    const tStart = Math.max(0, Math.floor(this.tOf(0) / minor) * minor);
    for (let t = tStart; this.xOf(t) <= w; t = Math.round((t + minor) * 1e6) / 1e6) {
      const x = Math.round(this.xOf(t)) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      g.strokeStyle = t > len + 1e-6 ? subtle : muted;
      g.globalAlpha = isMajor ? 0.9 : 0.45;
      g.beginPath();
      g.moveTo(x, isMajor ? RULER - 10 : RULER - 5);
      g.lineTo(x, RULER - 1);
      g.stroke();
      if (isMajor) {
        g.fillStyle = t > len + 1e-6 ? subtle : muted;
        g.fillText(t === 0 ? '0 s' : fmt(t), x + 3, 4);
      }
      g.globalAlpha = 1;
    }

    // The playhead.
    const px = Math.round(this.xOf(this.time)) + 0.5;
    const head = this.recordOn ? danger : accent;
    g.strokeStyle = head;
    g.lineWidth = 1.5;
    g.globalAlpha = this.previewOn ? 1 : 0.45;
    g.beginPath();
    g.moveTo(px, RULER - 2);
    g.lineTo(px, hh);
    g.stroke();
    g.fillStyle = head;
    g.beginPath();
    g.moveTo(px - 6, 2);
    g.lineTo(px + 6, 2);
    g.lineTo(px + 6, RULER - 10);
    g.lineTo(px, RULER - 3);
    g.lineTo(px - 6, RULER - 10);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    if (!tracks.length) {
      g.fillStyle = muted;
      g.font = '12px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillText('No tracks yet. Add one with "+ Track", or turn on Record and change a piece.', 12, RULER + 20);
    }
  }

  /** The key under a point of the canvas: { track, index } or null. */
  keyAt(x, y) {
    const tracks = this.tracks();
    const ti = Math.floor((y - RULER + this.scrollY) / ROW);
    if (y < RULER || ti < 0 || ti >= tracks.length) return null;
    const keys = A.keysOf(tracks[ti]);
    let best = null;
    let bestD = KEY_R + 3;
    keys.forEach((k, i) => {
      const d = Math.abs(this.xOf(k.time) - x);
      if (d <= bestD) {
        best = { track: ti, index: i };
        bestD = d;
      }
    });
    return best;
  }

  bindCanvas() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.root.focus({ preventScroll: true });
      const [x, y] = pos(e);
      if (y < RULER) {
        this.stopPlaying();
        this.drag = { kind: 'scrub' };
        this.setTime(this.tOf(x), { snap: !e.altKey });
        c.setPointerCapture(e.pointerId);
        return;
      }
      const hit = this.keyAt(x, y);
      if (!hit) {
        if (!e.shiftKey) this.sel = [];
        this.renderKeyBar();
        this.draw();
        return;
      }
      const has = this.sel.some((r) => r.track === hit.track && r.index === hit.index);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        this.sel = has ? this.sel.filter((r) => !(r.track === hit.track && r.index === hit.index)) : [...this.sel, hit];
      } else if (!has) {
        this.sel = [hit];
      }
      const tracks = this.tracks();
      const from = this.sel.map((r) => A.keysOf(tracks[r.track])[r.index]?.time ?? 0);
      const pressed = A.keysOf(tracks[hit.track])[hit.index]?.time ?? 0;
      this.drag = { kind: 'keys', x, from, pressed, moved: false, merge: `anim-drag-${++this.dragSeq}`, refs: [...this.sel] };
      c.setPointerCapture(e.pointerId);
      this.renderKeyBar();
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const [x] = pos(e);
      if (d.kind === 'scrub') {
        this.setTime(this.tOf(x), { snap: !e.altKey });
        return;
      }
      if (!d.moved && Math.abs(x - d.x) < 3) return;
      d.moved = true;
      let dt = (x - d.x) / this.scale();
      // The pressed key lands on the snap step; the others keep their distance.
      const snap = e.altKey ? 0 : this.snap;
      if (snap > 0) dt = Math.round((d.pressed + dt) / snap) * snap - d.pressed;
      dt = Math.max(dt, -Math.min(...d.from));
      A.moveKeys(this.doc, this.animator, this.anim, d.refs, d.from, dt, { merge: d.merge });
    });
    const end = () => {
      const d = this.drag;
      this.drag = null;
      if (d?.kind === 'keys' && d.moved) {
        this.sel = A.sortKeys(this.doc, this.animator, this.anim, d.refs, { merge: d.merge });
        this.renderKeyBar();
        this.draw();
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      const [x, y] = pos(e);
      if (y < RULER) return;
      const ti = Math.floor((y - RULER + this.scrollY) / ROW);
      if (ti < 0 || ti >= this.tracks().length || this.keyAt(x, y)) return;
      let t = Math.max(0, this.tOf(x));
      if (!e.altKey && this.snap > 0) t = Math.round(t / this.snap) * this.snap;
      this.addKeyAt(ti, t);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom around the mouse pointer.
        const [x] = pos(e);
        const t = this.tOf(x);
        this.pps = Math.max(10, Math.min(4000, this.scale() * Math.exp(-e.deltaY * 0.002)));
        this.scrollX = Math.max(0, t - (x - 12) / this.pps);
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.scrollX = Math.max(0, this.scrollX + (e.deltaX || e.deltaY) / this.scale());
      } else {
        const max = Math.max(0, this.tracks().length * ROW - (c.clientHeight - RULER) + 8);
        this.scrollY = Math.max(0, Math.min(max, this.scrollY + e.deltaY));
        this.labels.style.transform = `translateY(${-this.scrollY}px)`;
      }
      this.draw();
    }, { passive: false });
    this.labelCol.addEventListener('wheel', (e) => {
      const max = Math.max(0, this.tracks().length * ROW - (c.clientHeight - RULER) + 8);
      this.scrollY = Math.max(0, Math.min(max, this.scrollY + e.deltaY));
      this.labels.style.transform = `translateY(${-this.scrollY}px)`;
      this.draw();
    }, { passive: true });
  }

  key(e) {
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!this.anim) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    } else if (e.key === ' ') {
      this.togglePlay();
    } else if (e.key === 'Home') {
      this.setTime(0);
    } else if (e.key === 'End') {
      this.setTime(this.length());
    } else if (e.key === 'Escape') {
      this.sel = [];
      this.renderKeyBar();
      this.draw();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}

function setEase(key, easing) {
  if (!easing || easing === 'linear') delete key.easing;
  else key.easing = easing;
}
