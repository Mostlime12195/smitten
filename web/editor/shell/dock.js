// Windows and docks (DESIGN.md, section 8). Panels live in stacks, with a tab
// for each panel. A stack is docked at the left, right or bottom of the
// stage, or floats over it as a window you can move and resize anywhere.
//
// Drag a tab and its panel comes away as a window that follows the pointer.
// Let go over another stack's tabs to join it, over the top or bottom half
// (left or right half, at the bottom) of a docked stack to sit beside it,
// near an edge of the editor to dock there, or anywhere else to leave it
// floating. Drag a window by its header to move it, by its edges to resize
// it; double-click a tab to float or dock it. Each workspace has its own
// layout.
//
// layout = { left: [[ids]], right: [[ids]], bottom: [[ids]],
//            floating: [{ ids, x, y, w, h }], active: { id: true },
//            sizes: { left, right, bottom }, weights: { left: [n], ... } }

import { h, icon, showMenu } from '../ui.js';

const REGIONS = ['left', 'right', 'bottom'];
const MIN = { left: 200, right: 220, bottom: 96 };
const DEFAULT_SIZES = { left: 270, right: 320, bottom: 200 };
const FLOAT_MIN = { w: 220, h: 140 };
const EDGE = 48; // how near an edge of the editor a drop docks there
const REGION_NAMES = { left: 'left', right: 'right', bottom: 'bottom' };

const emptyLayout = () => ({
  left: [], right: [], bottom: [], floating: [], active: {},
  sizes: { ...DEFAULT_SIZES }, weights: { left: [], right: [], bottom: [] },
});

export class DockManager extends EventTarget {
  /**
   * panels: [{ id, title, icon, el, region }] — region is where the panel
   * docks when it's shown again or docked from a window.
   */
  constructor(shell, center, panels) {
    super();
    this.shell = shell;
    this.center = center;
    this.panels = new Map(panels.map((p) => [p.id, p]));
    this.layout = emptyLayout();
    this.badges = new Map();

    this.docks = {};
    for (const r of REGIONS) this.docks[r] = h('div', { class: `dock ${r}`, 'data-region': r });
    this.splitters = {
      left: h('div', { class: 'splitter v', title: 'Drag to resize, double-click to reset' }),
      right: h('div', { class: 'splitter v', title: 'Drag to resize, double-click to reset' }),
      bottom: h('div', { class: 'splitter h', title: 'Drag to resize, double-click to reset' }),
    };
    this.floatLayer = h('div', { class: 'float-layer' });
    this.hint = h('div', { class: 'dock-hint' });
    shell.append(this.docks.left, this.splitters.left, center, this.splitters.right, this.docks.right, this.floatLayer);
    center.append(this.splitters.bottom, this.docks.bottom);
    this.floatLayer.append(this.hint);
    this.setupSplitter('left', (dx) => this.layout.sizes.left + dx);
    this.setupSplitter('right', (dx) => this.layout.sizes.right - dx);
    this.setupSplitter('bottom', (dx, dy) => this.layout.sizes.bottom - dy);
    this.onWindowResize = () => this.clampFloating();
    window.addEventListener('resize', this.onWindowResize);
  }

  dispose() {
    window.removeEventListener('resize', this.onWindowResize);
  }

  // Sizes ---------------------------------------------------------------------

  setupSplitter(region, compute) {
    const el = this.splitters[region];
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      document.body.classList.add(region === 'bottom' ? 'resizing-row' : 'resizing-col');
      const start = { x: e.clientX, y: e.clientY, size: this.layout.sizes[region] };
      const move = (ev) => {
        this.layout.sizes[region] = start.size;
        const next = compute(ev.clientX - start.x, ev.clientY - start.y);
        const max = region === 'bottom' ? window.innerHeight * 0.7 : window.innerWidth * 0.45;
        this.layout.sizes[region] = Math.round(Math.max(MIN[region], Math.min(max, next)));
        this.applySizes();
        this.dispatchEvent(new Event('resize'));
      };
      const up = () => {
        el.classList.remove('dragging');
        document.body.classList.remove('resizing-row', 'resizing-col');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        this.changed();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => {
      this.layout.sizes[region] = DEFAULT_SIZES[region];
      this.applySizes();
      this.dispatchEvent(new Event('resize'));
      this.changed();
    });
  }

  applySizes() {
    const s = this.layout.sizes;
    this.docks.left.style.width = `${s.left}px`;
    this.docks.right.style.width = `${s.right}px`;
    this.docks.bottom.style.height = `${s.bottom}px`;
  }

  // Layout state --------------------------------------------------------------

  setLayout(layout) {
    const clean = emptyLayout();
    clean.active = { ...(layout.active || {}) };
    clean.sizes = { ...clean.sizes, ...(layout.sizes || {}) };
    const seen = new Set();
    const take = (ids) => {
      const out = (ids || []).filter((id) => this.panels.has(id) && !seen.has(id));
      out.forEach((id) => seen.add(id));
      return out;
    };
    for (const r of REGIONS) {
      for (const stack of layout[r] || []) {
        const ids = take(stack);
        if (ids.length) clean[r].push(ids);
      }
      const w = layout.weights?.[r];
      clean.weights[r] = Array.isArray(w) && w.length === clean[r].length ? [...w] : clean[r].map(() => 1);
    }
    for (const f of layout.floating || []) {
      const ids = take(f.ids);
      if (ids.length) clean.floating.push({ ids, x: f.x, y: f.y, w: f.w, h: f.h });
    }
    this.layout = clean;
    this.render();
    this.clampFloating();
  }

  getLayout() {
    return JSON.parse(JSON.stringify(this.layout));
  }

  changed() {
    this.dispatchEvent(new Event('change'));
  }

  /** Where a panel is: { region, stack } when docked, { float } when in a window, or null. */
  where(id) {
    for (const r of REGIONS) {
      for (let i = 0; i < this.layout[r].length; i++) {
        if (this.layout[r][i].includes(id)) return { region: r, stack: i };
      }
    }
    const f = this.layout.floating.findIndex((x) => x.ids.includes(id));
    return f >= 0 ? { float: f } : null;
  }

  stackOf(id) {
    const w = this.where(id);
    if (!w) return null;
    return w.region ? this.layout[w.region][w.stack] : this.layout.floating[w.float].ids;
  }

  isVisible(id) {
    return !!this.where(id);
  }

  isFloating(id) {
    return this.where(id)?.float !== undefined;
  }

  /** Takes a panel out of its stack, dropping the stack if it's left empty. */
  detach(id) {
    const w = this.where(id);
    if (!w) return;
    if (w.region) {
      const stack = this.layout[w.region][w.stack];
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) this.removeStack(w.region, w.stack);
    } else {
      const f = this.layout.floating[w.float];
      f.ids.splice(f.ids.indexOf(id), 1);
      if (!f.ids.length) this.layout.floating.splice(w.float, 1);
    }
  }

  removeStack(region, index) {
    this.layout[region].splice(index, 1);
    this.layout.weights[region].splice(index, 1);
  }

  insertStack(region, index, ids) {
    const i = Math.max(0, Math.min(index, this.layout[region].length));
    this.layout[region].splice(i, 0, ids);
    const w = this.layout.weights[region];
    w.splice(i, 0, w.length ? w.reduce((a, b) => a + b, 0) / w.length : 1);
  }

  // Showing, hiding, moving -----------------------------------------------------

  /** Shows a panel (where it docks, if it was hidden) and makes it the active tab. */
  show(id, { focus = false } = {}) {
    if (!this.panels.has(id)) return;
    if (!this.where(id)) {
      const region = this.panels.get(id).region || 'left';
      if (!this.layout[region].length) this.insertStack(region, 0, []);
      this.layout[region][this.layout[region].length - 1].push(id);
    }
    const w = this.where(id);
    if (w.float !== undefined) this.raise(w.float, false);
    this.activate(id, false);
    this.render();
    this.changed();
    if (focus) this.panels.get(id).el.querySelector('input, [tabindex]')?.focus();
  }

  hide(id) {
    if (!this.where(id)) return;
    this.detach(id);
    delete this.layout.active[id];
    this.render();
    this.changed();
  }

  toggle(id) {
    if (this.isVisible(id)) this.hide(id);
    else this.show(id);
  }

  activate(id, render = true) {
    const stack = this.stackOf(id);
    if (!stack) return;
    for (const other of stack) delete this.layout.active[other];
    this.layout.active[id] = true;
    if (render) {
      this.render();
      this.changed();
    }
  }

  /** Docks a panel: in a stack of a region (index), or a new stack there (index = -1). */
  move(id, region, index = -1, position = null) {
    const target = index >= 0 ? this.layout[region][index] : null;
    this.detach(id);
    const at = target ? this.layout[region].indexOf(target) : -1;
    if (at < 0) this.insertStack(region, this.layout[region].length, [id]);
    else target.splice(position ?? target.length, 0, id);
    this.activate(id, false);
    this.render();
    this.changed();
  }

  /** Puts a panel in a window of its own (at rect, else near the middle of the editor). */
  float(id, rect = null) {
    const from = this.panels.get(id).el.getBoundingClientRect();
    const box = this.shell.getBoundingClientRect();
    this.detach(id);
    const w = Math.round(Math.max(FLOAT_MIN.w, Math.min(rect?.w ?? from.width ?? 320, 420)));
    const hh = Math.round(Math.max(FLOAT_MIN.h, Math.min(rect?.h ?? from.height ?? 360, 520)));
    const entry = {
      ids: [id],
      x: Math.round(rect?.x ?? (box.width - w) / 2 + this.layout.floating.length * 24),
      y: Math.round(rect?.y ?? Math.max(16, (box.height - hh) / 3) + this.layout.floating.length * 24),
      w, h: hh,
    };
    this.layout.floating.push(entry);
    this.activate(id, false);
    this.render();
    this.clampFloating();
    this.changed();
    return entry;
  }

  /** Docks a panel in the region it belongs to. */
  dock(id) {
    this.move(id, this.panels.get(id).region || 'left');
  }

  raise(index, render = true) {
    const [entry] = this.layout.floating.splice(index, 1);
    this.layout.floating.push(entry);
    if (render) {
      // Moving the window's element to the end keeps the panels where they are.
      const win = [...this.floatLayer.querySelectorAll('.float-win')].find((x) => x.entry === entry);
      if (win) this.floatLayer.insertBefore(win, this.hint);
      this.changed();
    }
  }

  /** Keeps every window at least partly inside the editor. */
  clampFloating() {
    const box = this.shell.getBoundingClientRect();
    if (!box.width) return;
    for (const f of this.layout.floating) {
      f.w = Math.min(Math.max(FLOAT_MIN.w, f.w), box.width);
      f.h = Math.min(Math.max(FLOAT_MIN.h, f.h), box.height);
      f.x = Math.round(Math.max(-f.w + 96, Math.min(f.x, box.width - 96)));
      f.y = Math.round(Math.max(0, Math.min(f.y, box.height - 36)));
    }
    for (const win of this.floatLayer.querySelectorAll('.float-win')) placeWindow(win, win.entry);
  }

  setBadge(id, text) {
    this.badges.set(id, text);
    for (const badge of this.shell.querySelectorAll(`.dock-tab[data-panel="${id}"] .badge`)) {
      badge.textContent = text || '';
      badge.hidden = !text;
    }
  }

  // Drawing -------------------------------------------------------------------

  render() {
    this.applySizes();
    for (const r of REGIONS) {
      const dock = this.docks[r];
      dock.replaceChildren();
      const stacks = this.layout[r];
      dock.classList.toggle('empty', !stacks.length);
      this.splitters[r].hidden = !stacks.length;
      stacks.forEach((ids, si) => {
        if (si) dock.append(this.stackSplitter(r, si));
        const el = this.renderStack(ids, { region: r });
        el.style.flexGrow = String(this.layout.weights[r][si] ?? 1);
        dock.append(el);
      });
    }
    for (const win of [...this.floatLayer.querySelectorAll('.float-win')]) win.remove();
    for (const entry of this.layout.floating) this.floatLayer.insertBefore(this.renderWindow(entry), this.hint);
    // Hidden panels keep their elements, just detached.
    this.dispatchEvent(new Event('resize'));
  }

  renderStack(ids, { region = null, entry = null } = {}) {
    const activeId = ids.find((id) => this.layout.active[id]) || ids[0];
    this.layout.active[activeId] = true;
    const tabs = h('div', { class: 'dock-tabs', role: 'tablist' });
    const body = h('div', { class: 'dock-body' });
    for (const id of ids) {
      const p = this.panels.get(id);
      const badgeText = this.badges.get(id);
      const tab = h('button', {
        type: 'button', class: 'dock-tab', role: 'tab', 'data-panel': id,
        'aria-selected': String(id === activeId),
        title: `${p.title}: drag to move, double-click to ${entry ? 'dock' : 'float'}`,
      }, p.title, h('span', { class: 'badge', hidden: !badgeText }, badgeText || ''));
      tab.addEventListener('pointerdown', (e) => this.pointerDown(e, { id, entry }));
      tab.addEventListener('dblclick', () => (entry ? this.dock(id) : this.float(id)));
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') this.activate(id);
      });
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.panelMenu(id, { x: e.clientX, y: e.clientY });
      });
      tabs.append(tab);
      p.el.hidden = id !== activeId;
      body.append(p.el);
    }
    const grip = h('span', { class: 'spacer' });
    if (entry) grip.addEventListener('pointerdown', (e) => this.pointerDown(e, { entry }));
    tabs.append(grip);
    const more = h('button', { type: 'button', class: 'icon-btn small', title: 'Panel options', 'aria-label': 'Panel options' }, icon('more', 15));
    more.addEventListener('click', () => this.panelMenu(activeId, more));
    tabs.append(more);
    if (entry) {
      const dockBtn = h('button', { type: 'button', class: 'icon-btn small', title: 'Dock', 'aria-label': 'Dock this window' }, icon(dockIcon(this.panels.get(activeId).region), 15));
      dockBtn.addEventListener('click', () => this.dock(activeId));
      const close = h('button', { type: 'button', class: 'icon-btn small', title: 'Close', 'aria-label': 'Close this window' }, icon('x', 15));
      close.addEventListener('click', () => {
        for (const id of [...entry.ids]) this.detach(id);
        this.render();
        this.changed();
      });
      tabs.append(dockBtn, close);
    }
    const stack = h('div', { class: 'dock-stack' }, tabs, body);
    stack.ids = ids;
    stack.region = region;
    return stack;
  }

  renderWindow(entry) {
    const stack = this.renderStack(entry.ids, { entry });
    const win = h('div', { class: 'float-win', role: 'dialog', 'aria-label': entry.ids.map((id) => this.panels.get(id).title).join(', ') }, stack);
    win.entry = entry;
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const handle = h('div', { class: `win-resize ${dir}` });
      handle.addEventListener('pointerdown', (e) => this.resizeWindow(e, win, dir));
      win.append(handle);
    }
    win.addEventListener('pointerdown', () => {
      const i = this.layout.floating.indexOf(entry);
      if (i >= 0 && i < this.layout.floating.length - 1) this.raise(i);
    }, true);
    placeWindow(win, entry);
    return win;
  }

  stackSplitter(region, index) {
    const el = h('div', { class: `splitter ${region === 'bottom' ? 'v' : 'h'} inner` });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const before = el.previousElementSibling;
      const after = el.nextElementSibling;
      const horizontal = region === 'bottom';
      const size = (x) => (horizontal ? x.getBoundingClientRect().width : x.getBoundingClientRect().height);
      const start = { p: horizontal ? e.clientX : e.clientY, a: size(before), b: size(after) };
      const w = this.layout.weights[region];
      const total = w[index - 1] + w[index];
      const move = (ev) => {
        const d = (horizontal ? ev.clientX : ev.clientY) - start.p;
        const a = Math.max(60, Math.min(start.a + start.b - 60, start.a + d));
        w[index - 1] = (total * a) / (start.a + start.b);
        w[index] = total - w[index - 1];
        before.style.flexGrow = String(w[index - 1]);
        after.style.flexGrow = String(w[index]);
      };
      const up = () => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        this.changed();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => {
      this.layout.weights[region] = this.layout[region].map(() => 1);
      this.render();
      this.changed();
    });
    return el;
  }

  panelMenu(id, anchor) {
    const w = this.where(id);
    const p = this.panels.get(id);
    const items = [];
    if (w?.float !== undefined) items.push({ label: 'Dock', icon: dockIcon(p.region), action: () => this.dock(id) });
    else items.push({ label: 'Float in a window', icon: 'floatWin', action: () => this.float(id) });
    for (const r of REGIONS) {
      if (w?.region === r && this.layout[r].length === 1 && this.layout[r][0].length === 1) continue;
      items.push({ label: `Dock on the ${REGION_NAMES[r]}`, icon: dockIcon(r), action: () => this.move(id, r) });
    }
    items.push('-', { label: `Hide ${p.title}`, icon: 'eyeOff', action: () => this.hide(id) });
    showMenu(anchor, items);
  }

  // Dragging -------------------------------------------------------------------

  /**
   * A press on a tab ({id}) or on a window's header ({entry}). It becomes a
   * drag once the pointer moves a few pixels; otherwise it's a click.
   */
  pointerDown(e, { id = null, entry = null }) {
    if (e.button !== 0 || e.target.closest('.icon-btn')) return;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const move = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        dragging = true;
        this.beginDrag(ev, start, { id, entry });
      }
      this.dragMove(ev);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (dragging) this.endDrag(ev);
      else if (id) this.activate(id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  beginDrag(e, start, { id, entry }) {
    const box = this.shell.getBoundingClientRect();
    // A tab taken from a stack with other tabs, or from the docks, comes away
    // as a window of its own under the pointer.
    if (id && !(entry && entry.ids.length === 1)) {
      const tab = e.target.closest?.('.dock-tab') || null;
      const from = this.panels.get(id).el.closest('.dock-stack')?.getBoundingClientRect();
      const w = Math.round(Math.max(FLOAT_MIN.w, Math.min(from?.width || 320, 380)));
      const hh = Math.round(Math.max(200, Math.min(from?.height || 360, 460)));
      const tabX = tab ? start.x - tab.getBoundingClientRect().left : 40;
      entry = this.float(id, { x: start.x - box.left - Math.min(tabX + 8, w / 2), y: start.y - box.top - 16, w, h: hh });
    } else if (!entry) {
      entry = this.layout.floating.find((f) => f.ids.includes(id));
    }
    const i = this.layout.floating.indexOf(entry);
    if (i < this.layout.floating.length - 1) this.raise(i);
    const win = [...this.floatLayer.querySelectorAll('.float-win')].find((x) => x.entry === entry);
    this.drag = { entry, win, offX: start.x - box.left - entry.x, offY: start.y - box.top - entry.y, target: null };
    win.classList.add('dragging');
    document.body.classList.add('moving-window');
  }

  dragMove(e) {
    const d = this.drag;
    if (!d) return;
    const box = this.shell.getBoundingClientRect();
    d.entry.x = Math.round(e.clientX - box.left - d.offX);
    d.entry.y = Math.round(Math.max(0, e.clientY - box.top - d.offY));
    placeWindow(d.win, d.entry);
    d.target = this.dropTarget(e, box);
    this.showHint(d.target, box);
  }

  endDrag() {
    const d = this.drag;
    this.drag = null;
    document.body.classList.remove('moving-window');
    this.hint.classList.remove('show');
    if (!d) return;
    d.win.classList.remove('dragging');
    const t = d.target;
    if (!t) {
      this.clampFloating();
      this.changed();
      return;
    }
    const ids = d.entry.ids;
    this.layout.floating.splice(this.layout.floating.indexOf(d.entry), 1);
    if (t.type === 'join') {
      t.stack.push(...ids);
    } else if (t.type === 'split') {
      const at = this.layout[t.region].indexOf(t.stack);
      this.insertStack(t.region, at + (t.after ? 1 : 0), [...ids]);
    } else if (t.type === 'edge') {
      this.insertStack(t.region, t.region === 'left' ? 0 : this.layout[t.region].length, [...ids]);
    }
    this.activate(ids[0], false);
    this.render();
    this.changed();
    // A short flash where it landed.
    const landed = this.panels.get(ids[0]).el.closest('.dock-stack');
    landed?.classList.add('landed');
    setTimeout(() => landed?.classList.remove('landed'), 400);
  }

  /** What the dragged window would join or dock beside at the pointer. */
  dropTarget(e, box) {
    const d = this.drag;
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (d.win.contains(el)) continue;
      const tabs = el.closest?.('.dock-tabs');
      if (tabs && this.shell.contains(tabs)) {
        const stack = tabs.parentElement.ids;
        return { type: 'join', stack, rect: tabs.parentElement.getBoundingClientRect() };
      }
      const stackEl = el.closest?.('.dock-stack');
      if (stackEl?.region) {
        const r = stackEl.getBoundingClientRect();
        const horizontal = stackEl.region === 'bottom';
        const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        const rect = horizontal
          ? { left: after ? r.left + r.width / 2 : r.left, top: r.top, width: r.width / 2, height: r.height }
          : { left: r.left, top: after ? r.top + r.height / 2 : r.top, width: r.width, height: r.height / 2 };
        return { type: 'split', region: stackEl.region, stack: stackEl.ids, after, rect };
      }
      if (el === this.floatLayer || el.closest?.('.float-win')) break;
    }
    const region = e.clientX < box.left + EDGE ? 'left'
      : e.clientX > box.right - EDGE ? 'right'
        : e.clientY > box.bottom - EDGE ? 'bottom' : null;
    if (!region) return null;
    const size = this.layout[region].length ? Math.min(this.layout.sizes[region], 240) : this.layout.sizes[region];
    const rect = region === 'left' ? { left: box.left, top: box.top, width: size, height: box.height }
      : region === 'right' ? { left: box.right - size, top: box.top, width: size, height: box.height }
        : { left: box.left, top: box.bottom - size, width: box.width, height: size };
    return { type: 'edge', region, rect };
  }

  showHint(target, box) {
    if (!target) {
      this.hint.classList.remove('show');
      return;
    }
    const r = target.rect;
    Object.assign(this.hint.style, {
      left: `${r.left - box.left}px`, top: `${r.top - box.top}px`,
      width: `${r.width}px`, height: `${target.type === 'join' ? Math.min(r.height, 40) : r.height}px`,
    });
    this.hint.classList.toggle('join', target.type === 'join');
    this.hint.classList.add('show');
  }

  resizeWindow(e, win, dir) {
    e.preventDefault();
    e.stopPropagation();
    const entry = win.entry;
    const pointer = { x: e.clientX, y: e.clientY };
    const was = { x: entry.x, y: entry.y, w: entry.w, h: entry.h };
    win.classList.add('resizing');
    const move = (ev) => {
      const dx = ev.clientX - pointer.x;
      const dy = ev.clientY - pointer.y;
      if (dir.includes('e')) entry.w = Math.max(FLOAT_MIN.w, was.w + dx);
      if (dir.includes('s')) entry.h = Math.max(FLOAT_MIN.h, was.h + dy);
      if (dir.includes('w')) {
        entry.w = Math.max(FLOAT_MIN.w, was.w - dx);
        entry.x = was.x + was.w - entry.w;
      }
      if (dir.includes('n')) {
        entry.h = Math.max(FLOAT_MIN.h, Math.min(was.h - dy, was.y + was.h));
        entry.y = was.y + was.h - entry.h;
      }
      placeWindow(win, entry);
    };
    const up = () => {
      win.classList.remove('resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.clampFloating();
      this.changed();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}

function placeWindow(win, entry) {
  win.style.transform = `translate(${entry.x}px, ${entry.y}px)`;
  win.style.width = `${entry.w}px`;
  win.style.height = `${entry.h}px`;
}

function dockIcon(region) {
  return { left: 'dockLeft', right: 'dockRight', bottom: 'dockBottom' }[region] || 'dockLeft';
}
