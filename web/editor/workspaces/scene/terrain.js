// Terrains: picking the tile that fits a cell's neighbours (autotiling).
//
// The same thing as love/src/modules/scene/terrain.lua (read its header for
// what a terrain, a mask and a match mode are), in JavaScript for the
// editor's Terrain brush. Both are checked against
// tools/scene-tests/levels/terrain-cases.json, so a change here needs the
// same change there. No DOM here, so node can run the tests.

export const N = 1;
export const NE = 2;
export const E = 4;
export const SE = 8;
export const S = 16;
export const SW = 32;
export const W = 64;
export const NW = 128;

/** The eight neighbours, clockwise from up: [dx, dy, bit]. */
export const AROUND = [
  [0, -1, N], [1, -1, NE], [1, 0, E], [1, 1, SE],
  [0, 1, S], [-1, 1, SW], [-1, 0, W], [-1, -1, NW],
];

// Each corner with the two sides next to it.
const CORNERS = [[NE, N, E], [SE, S, E], [SW, S, W], [NW, N, W]];

export const MATCHES = [
  { id: 'all', label: 'Sides and corners', hint: 'Sides, and a corner when both sides next to it are in too: 47 different tiles (a "blob" set)' },
  { id: 'sides', label: 'Sides', hint: 'Only up, right, down and left count: 16 different tiles' },
  { id: 'corners', label: 'Corners', hint: 'A corner is in when the three cells around it all are: 16 different tiles (a 2×2 or "wang corner" set)' },
];

export const matchOf = (m) => (m === 'sides' || m === 'corners' ? m : 'all');

/**
 * What a mask means under a match mode: the bits that mode looks at. For a
 * cell, mask has a bit for every neighbour in the terrain; for a tile it's
 * the mask from the file (tile = true keeps its corners as painted).
 */
export function reduce(mask, match, tile = false) {
  mask = (Math.floor(Number(mask) || 0) % 256 + 256) % 256;
  const sides = mask & (N | E | S | W);
  if (match === 'sides') return sides;
  const corners = match === 'corners';
  let out = corners ? 0 : sides;
  for (const [c, a, b] of CORNERS) {
    if ((mask & c) && ((corners && tile) || ((mask & a) && (mask & b)))) out |= c;
  }
  return out;
}

// How far apart two masks are: a side that differs counts 4, a corner 1.
function distance(p, q) {
  let d = 0;
  const x = p ^ q;
  for (let i = 0; i < 8; i++) if (x & AROUND[i][2]) d += i % 2 === 0 ? 4 : 1;
  return d;
}

const mod = (a, m) => ((a % m) + m) % m;

/** A number from a cell's position that is always the same for that cell (and the same in terrain.lua). */
export function hash(cx, cy) {
  const x = mod(cx, 65536);
  const y = mod(cy, 65536);
  let h = (x * 374761 + y * 668265 + 12345) % 1000003;
  h = (h * h + x * 31 + y * 17) % 1000003;
  return (h * 48271) % 2147483647;
}

/** Makes a terrain ready to use from its entry in the .tileset file. */
export function compile(def, index = 1) {
  const match = matchOf(def?.match);
  const t = {
    name: String(def?.name ?? `terrain${index}`),
    match,
    color: typeof def?.color === 'string' ? def.color : null,
    tiles: new Map(), // tile -> its mask (reduced)
    byMask: new Map(), // mask -> the tiles with it, lowest first
    masks: [], // the masks in use, lowest first
    first: null, // the lowest tile
  };
  const list = [];
  const tiles = def && typeof def.tiles === 'object' && def.tiles ? def.tiles : {};
  for (const [k, v] of Object.entries(tiles)) {
    const tile = Number(k);
    if (k.trim() !== '' && Number.isInteger(tile) && tile >= 0 && Number.isFinite(Number(v)) && v !== null && typeof v !== 'boolean') list.push([tile, reduce(v, match, true)]);
  }
  list.sort((p, q) => p[0] - q[0]);
  for (const [tile, mask] of list) {
    t.tiles.set(tile, mask);
    let same = t.byMask.get(mask);
    if (!same) {
      same = [];
      t.byMask.set(mask, same);
      t.masks.push(mask);
    }
    same.push(tile);
    if (t.first === null) t.first = tile;
  }
  t.masks.sort((a, b) => a - b);
  return t;
}

/**
 * Makes every terrain of a tileset ready: {list (in file order), byName,
 * of: Map(tile -> terrain)}. A tile in two terrains belongs to the first.
 */
export function compileAll(defs) {
  const out = { list: [], byName: new Map(), of: new Map() };
  if (!Array.isArray(defs)) return out;
  defs.forEach((def, i) => {
    if (!def || typeof def !== 'object') return;
    const t = compile(def, i + 1);
    if (out.byName.has(t.name)) return;
    out.list.push(t);
    out.byName.set(t.name, t);
    for (const tile of t.tiles.keys()) if (!out.of.has(tile)) out.of.set(tile, t);
  });
  return out;
}

/** The tile of a terrain for a mask (already reduced) in cell cx, cy; null when the terrain has no tiles. */
export function pick(t, mask, cx, cy) {
  let same = t.byMask.get(mask);
  if (!same) {
    let best = null;
    let bestD = null;
    for (const m of t.masks) {
      const d = distance(m, mask);
      if (bestD === null || d < bestD) {
        best = m;
        bestD = d;
      }
    }
    if (best === null) return null;
    same = t.byMask.get(best);
  }
  if (same.length === 1) return same[0];
  return same[hash(cx, cy) % same.length];
}

const tileIn = (tile) => tile !== undefined && tile !== null && tile >= 0;

/** The mask a cell of terrain t should have, from its neighbours. get(cx, cy) is the tile in a cell (undefined or -1: empty). */
export function wanted(t, get, of, cx, cy) {
  let mask = 0;
  for (const [dx, dy, bit] of AROUND) {
    const tile = get(cx + dx, cy + dy);
    if (tileIn(tile) && of.get(tile) === t) mask |= bit;
  }
  return reduce(mask, t.match);
}

/**
 * Picks the cell's tile again if it belongs to a terrain. With force, also
 * when the tile it has fits already (a variant is picked afresh). Returns
 * true if the cell changed.
 */
export function refresh(get, set, of, cx, cy, force = false) {
  const tile = get(cx, cy);
  const t = tileIn(tile) ? of.get(tile) : null;
  if (!t) return false;
  const mask = wanted(t, get, of, cx, cy);
  if (!force && t.tiles.get(tile) === mask) return false;
  const next = pick(t, mask, cx, cy);
  if (next === null || next === tile) return false;
  set(cx, cy, next);
  return true;
}

/** Puts terrain t in a cell (null: empties the cell) and fits the cell and its eight neighbours. */
export function place(get, set, of, cx, cy, t) {
  if (t) {
    if (t.first === null) return;
    set(cx, cy, t.first);
    refresh(get, set, of, cx, cy, true);
  } else set(cx, cy, -1);
  for (const [dx, dy] of AROUND) refresh(get, set, of, cx + dx, cy + dy, false);
}

/** Puts terrain t (null: nothing) in a rectangle of cells and fits them and the cells around the rectangle. */
export function fill(get, set, of, cx, cy, columns, rows, t) {
  if (t && t.first === null) return;
  const x1 = cx + columns - 1;
  const y1 = cy + rows - 1;
  for (let y = cy; y <= y1; y++) for (let x = cx; x <= x1; x++) set(x, y, t ? t.first : -1);
  for (let y = cy - 1; y <= y1 + 1; y++) {
    for (let x = cx - 1; x <= x1 + 1; x++) refresh(get, set, of, x, y, x >= cx && x <= x1 && y >= cy && y <= y1);
  }
}

// ---------------------------------------------------------------------------
// Sheet layouts: where each mask sits in a picture drawn for a common
// arrangement (docs/tiles.md draws them). A layout is rows of masks, null
// for a square that isn't used.

/** Every mask a "sides and corners" terrain can ask for, lowest first: 47 of them. */
export function blobMasks() {
  const out = [];
  for (let m = 0; m < 256; m++) if (reduce(m, 'all') === m) out.push(m);
  return out;
}

function rowsOf(list, columns) {
  const rows = [];
  for (let i = 0; i < list.length; i += columns) {
    const row = list.slice(i, i + columns);
    while (row.length < columns) row.push(null);
    rows.push(row);
  }
  return rows;
}

export const LAYOUTS = [
  {
    id: 'sides',
    match: 'sides',
    label: '16 tiles, 4 × 4 (sides)',
    hint: 'A column, a 3 × 3 block and a row: the usual 16-tile sheet',
    rows: [
      [S, E | S, E | S | W, S | W],
      [N | S, N | E | S, N | E | S | W, N | S | W],
      [N, N | E, N | E | W, N | W],
      [0, E, E | W, W],
    ],
  },
  {
    id: 'corners',
    match: 'corners',
    label: '16 tiles, 4 × 4 (corners)',
    hint: 'Counted by corner: up-right 1, down-right 2, down-left 4, up-left 8',
    rows: rowsOf(Array.from({ length: 16 }, (_, i) => (i & 1 ? NE : 0) | (i & 2 ? SE : 0) | (i & 4 ? SW : 0) | (i & 8 ? NW : 0)), 4),
  },
  {
    id: 'blob',
    match: 'all',
    label: '47 tiles, 8 × 6 (sides and corners)',
    hint: 'The 47 "blob" tiles in the order of their mask number',
    rows: rowsOf(blobMasks(), 8),
  },
];

/**
 * The tiles a layout gives when its top-left square is tile `first` of a
 * sheet with `columns` tiles a row: {tile: mask}, or null if the layout
 * doesn't fit in the sheet there.
 */
export function layoutTiles(layout, first, columns, count) {
  const ox = first % columns;
  const oy = Math.floor(first / columns);
  if (ox + layout.rows[0].length > columns) return null;
  const out = {};
  for (let j = 0; j < layout.rows.length; j++) {
    for (let i = 0; i < layout.rows[j].length; i++) {
      const mask = layout.rows[j][i];
      if (mask === null) continue;
      const tile = (oy + j) * columns + ox + i;
      if (count && tile >= count) return null;
      out[tile] = mask;
    }
  }
  return out;
}
