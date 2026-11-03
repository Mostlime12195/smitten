// A TileMap's "cells" property, in the same format as tilemap.lua:
//
//   { "x": 0, "y": 0, "w": 64, "h": 12, "data": "-1*130,3*5,..." }
//
// One rectangle of tile numbers listed row by row (-1 is empty), where "n*k"
// repeats n k times. Decoded, it's a Map from "cx,cy" to the tile number.
// No DOM here, so node can run the tests.

// Lua's tonumber() on a token: decimal or hex, spaces around allowed;
// anything else is nil (here NaN).
function luaNumber(token) {
  const t = token.trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  const hex = /^([-+]?)0[xX]([0-9a-fA-F]+)$/.exec(t);
  if (hex) return (hex[1] === '-' ? -1 : 1) * parseInt(hex[2], 16);
  return NaN;
}

export const cellKey = (cx, cy) => `${cx},${cy}`;

export function parseKey(key) {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/** cells (or null) -> Map("cx,cy" -> tile), as tilemap.lua decodes it. */
export function decodeCells(cells) {
  const grid = new Map();
  if (!cells || typeof cells !== 'object' || typeof cells.data !== 'string') return grid;
  const x0 = Number(cells.x) || 0;
  const y0 = Number(cells.y) || 0;
  const w = Number(cells.w) || 0;
  let i = 0;
  for (const token of cells.data.split(',')) {
    if (!token) continue; // gmatch("[^,]+") skips empty tokens
    const m = /^(-?\d+)\*(\d+)$/.exec(token);
    const v = luaNumber(m ? m[1] : token);
    const n = m ? Number(m[2]) : 1;
    for (let k = 0; k < n; k++) {
      if (Number.isFinite(v) && v >= 0 && w > 0) {
        grid.set(cellKey(x0 + (i % w), y0 + Math.floor(i / w)), v);
      }
      i++;
    }
  }
  return grid;
}

/** Map("cx,cy" -> tile) -> cells, as TileMap.encodeCells writes it. */
export function encodeCells(grid) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [key, v] of grid) {
    if (!(v >= 0)) continue;
    const [cx, cy] = parseKey(key);
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy;
    if (cy > y1) y1 = cy;
  }
  if (x0 > x1) return { x: 0, y: 0, w: 0, h: 0, data: '' };
  const out = [];
  let last = null;
  let run = 0;
  const flush = () => {
    if (run > 0) out.push(run > 1 ? `${last}*${run}` : String(last));
  };
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const t = grid.get(cellKey(cx, cy));
      const v = t >= 0 ? t : -1;
      if (v === last) run++;
      else {
        flush();
        last = v;
        run = 1;
      }
    }
  }
  flush();
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, data: out.join(',') };
}

/** The value to store in the property: null (the default) when there are no tiles. */
export function cellsValue(grid) {
  const c = encodeCells(grid);
  return c.w === 0 ? null : c;
}

/** The bounds of the used cells, {x0, y0, x1, y1} inclusive, or null. */
export function cellBounds(grid) {
  let b = null;
  for (const [key, v] of grid) {
    if (!(v >= 0)) continue;
    const [cx, cy] = parseKey(key);
    if (!b) b = { x0: cx, y0: cy, x1: cx, y1: cy };
    else {
      if (cx < b.x0) b.x0 = cx;
      if (cx > b.x1) b.x1 = cx;
      if (cy < b.y0) b.y0 = cy;
      if (cy > b.y1) b.y1 = cy;
    }
  }
  return b;
}
