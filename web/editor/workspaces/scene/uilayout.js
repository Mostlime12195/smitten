// How UI pieces are placed: by their anchors, or by the Row, Column, Grid or
// Scroll they are inside. The editor's copy of the engine's rules
// (love/src/modules/scene/uilayout.lua for the containers' arithmetic,
// ui.lua for the walk over the pieces). Both are checked against
// tools/scene-tests/ui/layout-cases.json (uilayout.test.mjs here, the "ui"
// scene test and tools/ui-tests/test.lua there): change one and the other
// must change with it.

const ANCHORS = {
  topLeft: [0, 0], top: [0.5, 0], topRight: [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  bottomLeft: [0, 1], bottom: [0.5, 1], bottomRight: [1, 1],
};

/** The piece types that place the pieces inside them. */
export const CONTAINERS = ['Row', 'Column', 'Grid', 'Scroll'];

const round = (v) => Math.floor(v + 0.5);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const columnsOf = (o) => Math.max(1, Math.floor(num(o.columns, 1)));

/** The size a container needs to hold its items, padding included: [w, h]. */
export function measure(o, items) {
  const n = items.length;
  const gap = num(o.gap);
  const pad = num(o.padding);
  if (n === 0) return [2 * pad, 2 * pad];
  if (o.kind === 'grid') {
    const cols = columnsOf(o);
    const rows = Math.ceil(n / cols);
    let colW = 0;
    let total = 0;
    for (let r = 0; r < rows; r++) {
      let rowH = 0;
      for (let c = 0; c < cols; c++) {
        const it = items[r * cols + c];
        if (it) {
          colW = Math.max(colW, it.w);
          rowH = Math.max(rowH, it.h);
        }
      }
      total += rowH;
    }
    return [2 * pad + cols * colW + gap * (cols - 1), 2 * pad + total + gap * Math.max(0, rows - 1)];
  }
  const row = o.kind === 'row';
  let along = 0;
  let across = 0;
  for (const it of items) {
    along += row ? it.w : it.h;
    across = Math.max(across, row ? it.h : it.w);
  }
  along += gap * Math.max(0, n - 1);
  return row ? [2 * pad + along, 2 * pad + across] : [2 * pad + across, 2 * pad + along];
}

function spread(justify, free, n, gap) {
  if (free <= 0) return [0, gap];
  if (justify === 'center') return [free / 2, gap];
  if (justify === 'end') return [free, gap];
  if (justify === 'spaceBetween' && n > 1) return [0, gap + free / (n - 1)];
  return [0, gap];
}

function acrossRoom(align, start, room, s) {
  if (align === 'stretch') return [start, room];
  if (align === 'center') return [start + (room - s) / 2, s];
  if (align === 'end') return [start + room - s, s];
  return [start, s];
}

function rect(x, y, w, h) {
  const x0 = round(x);
  const y0 = round(y);
  return [x0, y0, Math.max(0, round(x + w) - x0), Math.max(0, round(y + h) - y0)];
}

/**
 * Places the items in a container that is w by h: a list of [x, y, width,
 * height], measured from the container's top-left corner.
 */
export function arrange(o, items, w, h) {
  const n = items.length;
  const gap = num(o.gap);
  const pad = num(o.padding);
  const align = o.align || 'start';
  const justify = o.justify || 'start';
  const innerW = Math.max(0, w - 2 * pad);
  const innerH = Math.max(0, h - 2 * pad);
  const out = [];
  if (o.kind === 'grid') {
    const cols = columnsOf(o);
    const rows = Math.ceil(n / cols);
    const colW = Math.max(0, (innerW - gap * (cols - 1)) / cols);
    const heights = [];
    let total = 0;
    for (let r = 0; r < rows; r++) {
      let rowH = 0;
      for (let c = 0; c < cols; c++) {
        const it = items[r * cols + c];
        if (it) rowH = Math.max(rowH, it.h);
      }
      heights.push(rowH);
      total += rowH;
    }
    const [lead, between] = spread(justify, innerH - total - gap * Math.max(0, rows - 1), rows, gap);
    let y = pad + lead;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const it = items[r * cols + c];
        if (!it) continue;
        const [cx, cw] = acrossRoom(align, pad + c * (colW + gap), colW, it.w);
        const [cy, ch] = acrossRoom(align, y, heights[r], it.h);
        out[r * cols + c] = rect(cx, cy, cw, ch);
      }
      y += heights[r] + between;
    }
    return out;
  }
  const row = o.kind === 'row';
  const room = row ? innerW : innerH;
  const cross = row ? innerH : innerW;
  let total = 0;
  let grow = 0;
  for (const it of items) {
    total += row ? it.w : it.h;
    if (num(it.grow) > 0) grow += it.grow;
  }
  let free = room - total - gap * Math.max(0, n - 1);
  let share = 0;
  if (free > 0 && grow > 0) {
    share = free / grow;
    free = 0;
  }
  const [lead, between] = spread(justify, free, n, gap);
  let at = pad + lead;
  for (const it of items) {
    const g = num(it.grow);
    const size = (row ? it.w : it.h) + (g > 0 ? g * share : 0);
    const [c, cs] = acrossRoom(align, pad, cross, row ? it.h : it.w);
    out.push(row ? rect(at, c, size, cs) : rect(c, at, cs, size));
    at += size + between;
  }
  return out;
}

/** A piece's rectangle from its anchor in its parent's (ui.lua layout). */
export function anchorRect(anchor, x, y, w, h, px, py, pw, ph) {
  if (anchor === 'fill') return [px + x, py + y, Math.max(0, pw - 2 * x), Math.max(0, ph - 2 * y)];
  const a = ANCHORS[anchor] || ANCHORS.topLeft;
  return [px + a[0] * (pw - w) + (a[0] === 1 ? -x : x), py + a[1] * (ph - h) + (a[1] === 1 ? -y : y), w, h];
}

/** A container's settings as measure() and arrange() take them, or null. */
export function containerOptions(type, get) {
  if (type === 'Row' || type === 'Column') {
    return { kind: type === 'Row' ? 'row' : 'column', gap: num(get('gap')), padding: num(get('padding')), align: get('alignItems'), justify: get('justify') };
  }
  if (type === 'Grid') {
    return { kind: 'grid', gap: num(get('gap')), padding: num(get('padding')), align: get('alignItems'), justify: get('justify'), columns: num(get('columns'), 1) };
  }
  if (type === 'Scroll') {
    return { kind: get('direction') === 'horizontal' ? 'row' : 'column', gap: num(get('gap')), padding: num(get('padding')), align: 'stretch', justify: 'start' };
  }
  return null;
}

/**
 * Lays a whole tree out. api reads the tree:
 *   type(n), children(n), isUI(n), visible(n), get(n, property)
 * each(n, rect, parentRect, info) is called for every visible UI piece, in
 * drawing order; info is { slotted: placed by a container, clip: the
 * rectangle of the Scroll it shows through (or null), content: for a
 * Scroll, [width, height] of what's inside it }.
 */
export function layoutTree(root, api, screenW, screenH, each) {
  const prefs = new Map();
  const items = (n) => api.children(n).filter((c) => api.isUI(c) && api.visible(c));
  const optionsOf = (n) => containerOptions(api.type(n), (p) => api.get(n, p));
  // The size a piece asks for: its own, or for a Row, Column or Grid whose
  // width or height is 0, what its pieces need.
  const pref = (n) => {
    let p = prefs.get(n);
    if (p) return p;
    let w = num(api.get(n, 'width'));
    let h = num(api.get(n, 'height'));
    const type = api.type(n);
    if (type !== 'Scroll' && (w <= 0 || h <= 0)) {
      const o = optionsOf(n);
      if (o) {
        const [mw, mh] = measure(o, items(n).map((c) => ({ w: pref(c)[0], h: pref(c)[1] })));
        if (w <= 0) w = mw;
        if (h <= 0) h = mh;
      }
    }
    p = [w, h];
    prefs.set(n, p);
    return p;
  };
  const visit = (n, px, py, pw, ph, slot, clip) => {
    if (api.isUI(n)) {
      if (!api.visible(n)) return;
      const [w, h] = pref(n);
      const r = slot || anchorRect(api.get(n, 'anchor'), num(api.get(n, 'x')), num(api.get(n, 'y')), w, h, px, py, pw, ph);
      const o = optionsOf(n);
      const info = { slotted: !!slot, clip, content: null };
      let slots = null;
      let kids = null;
      if (o) {
        kids = items(n);
        const list = kids.map((c) => ({ w: pref(c)[0], h: pref(c)[1], grow: num(api.get(c, 'grow')) }));
        slots = arrange(o, list, r[2], r[3]);
        if (api.type(n) === 'Scroll') {
          const [cw, ch] = measure(o, list);
          // What's inside it, along the way it scrolls.
          info.content = o.kind === 'row' ? [Math.max(cw, r[2]), r[3]] : [r[2], Math.max(ch, r[3])];
          const sx = o.kind === 'row' ? Math.min(Math.max(0, num(api.get(n, 'scrollX'))), Math.max(0, cw - r[2])) : 0;
          const sy = o.kind === 'column' ? Math.min(Math.max(0, num(api.get(n, 'scrollY'))), Math.max(0, ch - r[3])) : 0;
          for (const s of slots) {
            s[0] -= round(sx);
            s[1] -= round(sy);
          }
        }
      }
      each(n, r, [px, py, pw, ph], info);
      if (api.type(n) === 'Scroll') clip = clip ? intersect(clip, r) : r;
      [px, py, pw, ph] = r;
      for (const c of api.children(n)) {
        const i = kids ? kids.indexOf(c) : -1;
        if (i >= 0) visit(c, px, py, pw, ph, [px + slots[i][0], py + slots[i][1], slots[i][2], slots[i][3]], clip);
        else visit(c, px, py, pw, ph, null, clip);
      }
      return;
    }
    if (!api.visible(n)) return;
    for (const c of api.children(n)) visit(c, px, py, pw, ph, null, clip);
  };
  visit(root, 0, 0, screenW, screenH, null, null);
}

function intersect(a, b) {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  return [x, y, Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - x), Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - y)];
}
