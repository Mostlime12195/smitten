// Docks around the workspace (DESIGN.md, section 8): panels sit in tabbed
// stacks on the left, right and bottom. Drag a panel's tab onto another
// stack's tabs, or to an edge of the window, to move it; the View menu hides
// and shows panels. Each workspace has its own layout.
//
// layout = { left: [[ids], [ids]], right: [[ids]], bottom: [[ids]],
//            active: { id: true }, sizes: { left, right, bottom } }

import { h, icon, showMenu } from '../ui.js';

const REGIONS = ['left', 'right', 'bottom'];
const MIN = { left: 180, right: 220, bottom: 90 };

export class DockManager extends EventTarget {
  /**
   * panels: [{ id, title, icon, el, region }] — region is where the panel
   * goes when it's shown again from the View menu.
   */
  constructor(shell, center, panels) {
    super();
    this.shell = shell;
    this.center = center;
    this.panels = new Map(panels.map((p) => [p.id, p]));
    this.layout = { left: [], right: [], bottom: [], active: {}, sizes: { left: 270, right: 310, bottom: 200 } };
    this.badges = new Map();

    this.docks = {};
    for (const r of REGIONS) this.docks[r] = h('div', { class: `dock ${r}`, 'data-region': r });
    this.splitters = {
      left: h('div', { class: 'splitter v' }),
      right: h('div', { class: 'splitter v' }),
      bottom: h('div', { class: 'splitter h' }),
    };
    shell.append(this.docks.left, this.splitters.left, center, this.splitters.right, this.docks.right);
    center.append(this.splitters.bottom, this.docks.bottom);
    this.setupSplitter('left', (dx) => this.layout.sizes.left + dx);
    this.setupSplitter('right', (dx) => this.layout.sizes.right - dx);
    this.setupSplitter('bottom', (dx, dy) => this.layout.sizes.bottom - dy);
    this.setupEdgeDrop();
  }

  setupSplitter(region, compute) {
    const el = this.splitters[region];
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
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
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        this.changed();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => {
      this.layout.sizes[region] = { left: 270, right: 310, bottom: 200 }[region];
      this.applySizes();
      this.changed();
    });
  }

  applySizes() {
    const s = this.layout.sizes;
    this.docks.left.style.width = `${s.left}px`;
    this.docks.right.style.width = `${s.right}px`;
    this.docks.bottom.style.height = `${s.bottom}px`;
  }

  setLayout(layout) {
    const clean = { left: [], right: [], bottom: [], active: { ...(layout.active || {}) }, sizes: { ...this.layout.sizes, ...(layout.sizes || {}) } };
    const seen = new Set();
    for (const r of REGIONS) {
      for (const stack of layout[r] || []) {
        const ids = stack.filter((id) => this.panels.has(id) && !seen.has(id));
        ids.forEach((id) => seen.add(id));
        if (ids.length) clean[r].push(ids);
      }
    }
    this.layout = clean;
    this.render();
  }

  getLayout() {
    return JSON.parse(JSON.stringify(this.layout));
  }

  changed() {
    this.dispatchEvent(new Event('change'));
  }

  where(id) {
    for (const r of REGIONS) {
      for (let i = 0; i < this.layout[r].length; i++) {
        if (this.layout[r][i].includes(id)) return { region: r, stack: i };
      }
    }
    return null;
  }

  isVisible(id) {
    return !!this.where(id);
  }

  /** Shows a panel (in its region if it was hidden) and makes it the active tab. */
  show(id, { focus = false } = {}) {
    if (!this.panels.has(id)) return;
    let w = this.where(id);
    if (!w) {
      const region = this.panels.get(id).region || 'left';
      if (!this.layout[region].length) this.layout[region].push([]);
      this.layout[region][this.layout[region].length - 1].push(id);
      w = this.where(id);
    }
    this.activate(id, false);
    this.render();
    this.changed();
    if (focus) this.panels.get(id).el.querySelector('input, [tabindex]')?.focus();
  }

  hide(id) {
    const w = this.where(id);
    if (!w) return;
    const stack = this.layout[w.region][w.stack];
    stack.splice(stack.indexOf(id), 1);
    if (!stack.length) this.layout[w.region].splice(w.stack, 1);
    delete this.layout.active[id];
    this.render();
    this.changed();
  }

  toggle(id) {
    if (this.isVisible(id)) this.hide(id);
    else this.show(id);
  }

  activate(id, render = true) {
    const w = this.where(id);
    if (!w) return;
    for (const other of this.layout[w.region][w.stack]) delete this.layout.active[other];
    this.layout.active[id] = true;
    if (render) {
      this.render();
      this.changed();
    }
  }

  /** Moves a panel to a stack (index) or a new stack (index = -1) of a region. */
  move(id, region, index = -1, position = null) {
    const from = this.where(id);
    if (from) {
      const stack = this.layout[from.region][from.stack];
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) {
        this.layout[from.region].splice(from.stack, 1);
        if (from.region === region && from.stack < index) index--;
      }
    }
    if (index < 0 || index >= this.layout[region].length) {
      this.layout[region].push([id]);
    } else {
      const stack = this.layout[region][index];
      stack.splice(position ?? stack.length, 0, id);
    }
    this.activate(id, false);
    this.render();
    this.changed();
  }

  setBadge(id, text) {
    this.badges.set(id, text);
    const tab = this.shell.querySelector(`.dock-tab[data-panel="${id}"] .badge`);
    if (tab) {
      tab.textContent = text || '';
      tab.hidden = !text;
    }
  }

  render() {
    this.applySizes();
    for (const r of REGIONS) {
      const dock = this.docks[r];
      dock.replaceChildren();
      const stacks = this.layout[r];
      dock.classList.toggle('empty', !stacks.length);
      this.splitters[r].hidden = !stacks.length;
      stacks.forEach((ids, si) => dock.append(this.renderStack(r, si, ids)));
    }
    // Hidden panels keep their elements, just detached.
    this.dispatchEvent(new Event('resize'));
  }

  renderStack(region, si, ids) {
    let activeId = ids.find((id) => this.layout.active[id]) || ids[0];
    this.layout.active[activeId] = true;
    const tabs = h('div', { class: 'dock-tabs', role: 'tablist' });
    const body = h('div', { class: 'dock-body' });
    for (const id of ids) {
      const p = this.panels.get(id);
      const badgeText = this.badges.get(id);
      const tab = h('button', {
        type: 'button', class: 'dock-tab', role: 'tab', draggable: 'true', 'data-panel': id,
        'aria-selected': String(id === activeId), title: `${p.title} (drag to move)`,
        onclick: () => this.activate(id),
      }, p.title, h('span', { class: 'badge', hidden: !badgeText }, badgeText || ''));
      tab.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-smitten-panel', id);
        e.dataTransfer.effectAllowed = 'move';
        tab.classList.add('dragging');
        this.dragging = id;
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        this.dragging = null;
        this.hideDropHint();
      });
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.panelMenu(id, { x: e.clientX, y: e.clientY });
      });
      tabs.append(tab);
      p.el.hidden = id !== activeId;
      body.append(p.el);
    }
    tabs.append(h('span', { class: 'spacer' }));
    const more = h('button', { type: 'button', class: 'icon-btn', title: 'Panel options', 'aria-label': 'Panel options' }, icon('more', 14));
    more.addEventListener('click', () => this.panelMenu(activeId, more));
    tabs.append(more);
    tabs.addEventListener('dragover', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      tabs.classList.add('drop-here');
      this.hideDropHint();
    });
    tabs.addEventListener('dragleave', () => tabs.classList.remove('drop-here'));
    tabs.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-smitten-panel');
      tabs.classList.remove('drop-here');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      this.move(id, region, si);
    });
    return h('div', { class: 'dock-stack' }, tabs, body);
  }

  panelMenu(id, anchor) {
    const w = this.where(id);
    const items = [];
    for (const r of REGIONS) {
      if (w && r === w.region && this.layout[r].length === 1 && this.layout[r][0].length === 1) continue;
      items.push({ label: `Move to the ${r === 'bottom' ? 'bottom' : r}`, action: () => this.move(id, r) });
    }
    items.push('-', { label: `Hide ${this.panels.get(id).title}`, action: () => this.hide(id) });
    showMenu(anchor, items);
  }

  // Dropping a tab near an edge of the window makes a new stack there.
  setupEdgeDrop() {
    this.hint = h('div', { class: 'dock-drop', hidden: true });
    document.body.append(this.hint);
    const regionAt = (e) => {
      const r = this.shell.getBoundingClientRect();
      const edge = 70;
      if (e.clientX < r.left + edge) return 'left';
      if (e.clientX > r.right - edge) return 'right';
      if (e.clientY > r.bottom - edge) return 'bottom';
      return null;
    };
    this.shell.addEventListener('dragover', (e) => {
      if (!this.dragging) return;
      const region = regionAt(e);
      if (!region) return this.hideDropHint();
      e.preventDefault();
      const r = this.shell.getBoundingClientRect();
      const box = region === 'left' ? [r.left, r.top, 260, r.height]
        : region === 'right' ? [r.right - 260, r.top, 260, r.height]
          : [r.left, r.bottom - 180, r.width, 180];
      Object.assign(this.hint.style, { left: `${box[0]}px`, top: `${box[1]}px`, width: `${box[2]}px`, height: `${box[3]}px` });
      this.hint.hidden = false;
    });
    this.shell.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-smitten-panel');
      const region = id && regionAt(e);
      this.hideDropHint();
      if (!region) return;
      e.preventDefault();
      this.move(id, region, -1);
    });
  }

  hideDropHint() {
    if (this.hint) this.hint.hidden = true;
  }
}
