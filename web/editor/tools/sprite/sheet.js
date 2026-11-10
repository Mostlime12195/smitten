// Cutting a sprite sheet into animation frames: by frame size or by columns
// and rows, with a margin around the sheet and spacing between the cells.

/**
 * The cells of a width×height sheet. opts:
 *   by: 'size' (frameWidth, frameHeight) or 'grid' (columns, rows)
 *   margin: empty pixels before the first cell, at the left and the top.
 *     With 'grid', also at the right and the bottom.
 *   spacing: empty pixels between two cells.
 * Returns {fw, fh, columns, rows, cells: [{x, y}] (left to right, then top
 * to bottom)}, or {error} with a message that says what to change.
 */
export function sheetGrid(width, height, opts) {
  const margin = Math.max(0, Math.floor(opts.margin || 0));
  const spacing = Math.max(0, Math.floor(opts.spacing || 0));
  let fw, fh, columns, rows;
  if (opts.by === 'grid') {
    columns = Math.floor(opts.columns);
    rows = Math.floor(opts.rows);
    if (!(columns >= 1 && rows >= 1)) return { error: 'Columns and rows must be 1 or more.' };
    fw = Math.floor((width - 2 * margin - (columns - 1) * spacing) / columns);
    fh = Math.floor((height - 2 * margin - (rows - 1) * spacing) / rows);
    if (fw < 1 || fh < 1) return { error: `The image (${width}×${height}) is too small for ${columns}×${rows} frames with this margin and spacing.` };
  } else {
    fw = Math.floor(opts.frameWidth);
    fh = Math.floor(opts.frameHeight);
    if (!(fw >= 1 && fh >= 1)) return { error: 'The frame width and height must be 1 or more.' };
    columns = Math.floor((width - margin + spacing) / (fw + spacing));
    rows = Math.floor((height - margin + spacing) / (fh + spacing));
    if (columns < 1 || rows < 1) return { error: `A ${fw}×${fh} frame does not fit in the image (${width}×${height}) with this margin.` };
  }
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) cells.push({ x: margin + c * (fw + spacing), y: margin + r * (fh + spacing) });
  }
  return { fw, fh, columns, rows, cells };
}

/** The pixels of one cell, as a new fw×fh buffer (parts outside the sheet are transparent). */
export function cellPixels(data, width, height, grid, index) {
  const { fw, fh } = grid;
  const { x, y } = grid.cells[index];
  const out = new Uint8ClampedArray(fw * fh * 4);
  for (let row = 0; row < fh; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= height) continue;
    const w = Math.min(fw, width - x);
    if (w <= 0) continue;
    out.set(data.subarray((sy * width + x) * 4, (sy * width + x + w) * 4), row * fw * 4);
  }
  return out;
}

/** True if every pixel of a buffer is fully transparent. */
export function isEmpty(buf) {
  for (let i = 3; i < buf.length; i += 4) if (buf[i]) return false;
  return true;
}

/** The frames for the cells at `indexes` (all cells if not given), in that order. */
export function cutSheet(data, width, height, grid, indexes = null) {
  return (indexes || grid.cells.map((_, i) => i)).map((i) => cellPixels(data, width, height, grid, i));
}

/** The indexes of the cells that have at least one pixel that is not transparent. */
export function filledCells(data, width, height, grid) {
  return grid.cells.map((_, i) => i).filter((i) => !isEmpty(cellPixels(data, width, height, grid, i)));
}
