// The selection's lifted ("floating") pixels: {x, y, w, h, data}, where x
// and y can be outside the image while you move them. The editor shows them
// over the image until it drops them.

import { extract, stamp, flip, rotate90 } from './draw.js';

/** Take the pixels of rect from a w×h buffer. Without copy, the place they leave becomes transparent. */
export function lift(buf, w, h, rect, copy = false) {
  const data = extract(buf, w, h, rect.x, rect.y, rect.w, rect.h);
  if (!copy) stamp(buf, w, h, new Uint8ClampedArray(rect.w * rect.h * 4), rect.x, rect.y, rect.w, rect.h);
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, data };
}

/** Put floating pixels onto a w×h buffer. Their fully transparent pixels keep what is below. */
export function drop(buf, w, h, f) {
  stamp(buf, w, h, f.data, f.x, f.y, f.w, f.h, true);
}

/** The floating pixels moved by dx, dy. */
export function moved(f, dx, dy) {
  return { ...f, x: f.x + dx, y: f.y + dy };
}

/** The floating pixels turned a quarter turn around their middle. */
export function rotated(f, clockwise = true) {
  return {
    ...f,
    x: f.x + Math.floor((f.w - f.h) / 2),
    y: f.y + Math.floor((f.h - f.w) / 2),
    w: f.h,
    h: f.w,
    data: rotate90(f.data, f.w, f.h, clockwise),
  };
}

/** The floating pixels mirrored (left and right, or top and bottom). */
export function flipped(f, horizontal) {
  const data = f.data.slice();
  flip(data, f.w, f.h, horizontal);
  return { ...f, data };
}

/** Where to paste a clipboard of cw×ch at (cx, cy) in a w×h image: the same place if it fits, else the top-left corner. */
export function pastePosition(cx, cy, cw, ch, w, h) {
  return { x: cx >= 0 && cx + cw <= w ? cx : 0, y: cy >= 0 && cy + ch <= h ? cy : 0 };
}
