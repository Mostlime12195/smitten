// The map and tileset editors' styles, added to the page once. They use the
// editor's theme variables (editor.css), so light and dark themes work.

const CSS = `
.mt-root {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  background: var(--editor-bg);
  color: var(--fg);
  font-size: 13px;
  outline: none;
}
.mt-toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 40px;
  padding: 0 8px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none;
}
.mt-toolbar .spacer { flex: 1; }
.mt-sep { width: 1px; height: 18px; background: var(--border-strong); margin: 0 6px; flex: none; }
.mt-toolbar .icon-btn[aria-pressed="true"] { color: var(--accent-text); background: var(--accent-soft); }
.mt-zoom { min-width: 46px; text-align: center; font-size: 12px; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
.mt-toolbar .mt-label { font-size: 12px; color: var(--fg-muted); margin: 0 4px 0 2px; white-space: nowrap; }
.mt-toolbar .input.mt-num { width: 52px; }
.mt-toolbar .select { max-width: 200px; }

.mt-viewport { position: relative; overflow: hidden; min-width: 0; min-height: 0; touch-action: none; }
.mt-viewport canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.mt-viewport.panning, .mt-viewport.pan-ready { cursor: grab; }
.mt-viewport.panning:active { cursor: grabbing; }
.mt-viewport.tool-select { cursor: default; }
.mt-viewport.tool-move { cursor: move; }
.mt-viewport.tool-resize { cursor: nwse-resize; }
.mt-viewport.tool-paint { cursor: crosshair; }
.mt-empty {
  position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
  color: var(--fg-muted); text-align: center; padding: 24px; line-height: 1.6;
}
.mt-empty > div { pointer-events: auto; max-width: 360px; }
.mt-empty .btn { margin: 10px 4px 0; }

.mt-status {
  display: flex; align-items: center; gap: 16px; min-height: 24px; padding: 0 10px;
  font-size: 11.5px; color: var(--fg-subtle); background: var(--panel); border-top: 1px solid var(--border);
  white-space: nowrap; overflow: hidden; font-variant-numeric: tabular-nums;
}
.mt-status .mt-hint { margin-left: auto; overflow: hidden; text-overflow: ellipsis; }

.mt-side {
  grid-column: 2; grid-row: 2 / 4;
  display: flex; flex-direction: column; min-height: 0;
  background: var(--panel); border-left: 1px solid var(--border); overflow-y: auto;
}
.mt-section { border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.mt-section.grow { flex: 1 0 auto; }
.mt-section-head {
  display: flex; align-items: center; gap: 2px; height: 34px; padding: 0 6px 0 12px;
  font-size: 12px; font-weight: 600; color: var(--fg-muted);
}
.mt-section-head > span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-section-body { padding: 0 12px; }
.mt-note { font-size: 12px; color: var(--fg-subtle); line-height: 1.5; margin: 2px 0 6px; }
.mt-note.warn { color: var(--warning); }
.mt-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.mt-row > .select, .mt-row > .input { flex: 1; min-width: 0; }

.mt-palette {
  position: relative; max-height: 340px; overflow: auto; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--editor-bg);
}
.mt-palette canvas { display: block; image-rendering: pixelated; cursor: pointer; }
.mt-palette-info { font-size: 11.5px; color: var(--fg-subtle); margin-top: 6px; min-height: 1.4em; font-variant-numeric: tabular-nums; }

.mt-layers { display: flex; flex-direction: column; gap: 1px; padding: 0 6px; }
.mt-layer {
  display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 4px 0 2px;
  border-radius: var(--radius-sm); cursor: pointer; color: var(--fg-muted); user-select: none;
}
.mt-layer:hover { background: var(--hover); color: var(--fg); }
.mt-layer.active { background: var(--accent-soft); color: var(--fg); }
.mt-layer .mt-layer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-layer.hidden-layer .mt-layer-name { opacity: .55; text-decoration: line-through; text-decoration-color: var(--fg-subtle); }
.mt-layer .mt-layer-kind { color: var(--fg-subtle); display: inline-flex; }
.mt-layer .icon-btn { width: 24px; height: 24px; }
.mt-layer-actions { display: flex; gap: 2px; padding: 6px 6px 0; }

.mt-fields { display: grid; grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px 8px; align-items: center; }
.mt-fields label { font-size: 12px; color: var(--fg-muted); }
.mt-fields .input { width: 100%; min-width: 0; }
.mt-fields .wide { grid-column: 2 / -1; }

.mt-props { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.mt-props-title { font-size: 12px; color: var(--fg-muted); margin: 6px 0 2px; }
.mt-prop { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) auto; gap: 4px; align-items: center; }
.mt-prop .input { width: 100%; min-width: 0; }
.mt-prop .icon-btn { width: 26px; height: 26px; }
.mt-props .btn { align-self: flex-start; margin-top: 2px; }

.mt-check { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; margin: 4px 0 6px; user-select: none; }
.mt-check input { width: 15px; height: 15px; accent-color: var(--accent); margin: 0; }

.mt-dialog-grid { display: grid; grid-template-columns: auto 1fr; gap: 10px 14px; align-items: center; min-width: 360px; }
.mt-dialog-grid > label { font-size: 12px; font-weight: 500; color: var(--fg-muted); }
.mt-dialog-grid .mt-pair { display: flex; align-items: center; gap: 6px; }
.mt-dialog-grid .mt-pair .input { width: 80px; }
.mt-dialog-grid .mt-pair span { color: var(--fg-subtle); font-size: 12px; }
.mt-anchor { display: grid; grid-template-columns: repeat(3, 24px); gap: 3px; }
.mt-anchor button {
  width: 24px; height: 24px; border: 1px solid var(--border-strong); border-radius: 4px;
  background: var(--panel-elev); cursor: pointer; padding: 0;
}
.mt-anchor button:hover { background: var(--panel-2); }
.mt-anchor button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); }
.mt-color { width: 40px; height: 30px; padding: 2px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--input-bg); cursor: pointer; }
.mt-color:disabled { opacity: .4; cursor: default; }
`;

export function injectStyle() {
  if (document.getElementById('map-tool-style')) return;
  const style = document.createElement('style');
  style.id = 'map-tool-style';
  style.textContent = CSS;
  document.head.append(style);
}
