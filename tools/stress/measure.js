// Paste into the console of a page running Smitten (the player, or the
// editor) to time what the page does each frame. It wraps
// requestAnimationFrame, so every callback (the engine's frame, the editor's
// redraws) is timed with performance.now(); the time is CPU work in the
// page, not capped by the display's refresh rate.
//
//   __stress.reset()        start a new sample
//   __stress.report()       {frames, fps, avgMs, p95Ms, maxMs, heapMB}
//   await __stress.time(fn) ms from calling fn to the next painted frame
//
// To open a stress .love in the editor (on the editor's home page):
//   const store = await import('./fs-store.js');
//   const { unzipToProjectFiles } = await import('./exporter.js');
//   const bytes = new Uint8Array(await (await fetch('/stress/editor-big.love')).arrayBuffer());
//   const p = await store.createProject('editor-big', await unzipToProjectFiles(bytes));
//   location.hash = `project=${p.id}`;

(() => {
  if (window.__stress) return;
  const raf = window.requestAnimationFrame.bind(window);
  let samples = [];
  let since = performance.now();
  let frameStart = 0;
  let frameWork = 0;
  window.requestAnimationFrame = (cb) => raf((t) => {
    const t0 = performance.now();
    if (t0 - frameStart > 4) {
      // A new frame: callbacks within a few ms of each other belong together.
      if (frameStart) samples.push(frameWork);
      frameStart = t0;
      frameWork = 0;
    }
    try {
      cb(t);
    } finally {
      frameWork += performance.now() - t0;
    }
  });
  window.__stress = {
    reset() {
      samples = [];
      since = performance.now();
    },
    report() {
      const s = [...samples].sort((a, b) => a - b);
      const n = s.length;
      const secs = (performance.now() - since) / 1000;
      const r = (v) => Math.round(v * 100) / 100;
      return {
        frames: n,
        fps: r(n / secs),
        avgMs: r(s.reduce((a, b) => a + b, 0) / (n || 1)),
        p95Ms: r(s[Math.floor(n * 0.95)] || 0),
        maxMs: r(s[n - 1] || 0),
        heapMB: performance.memory ? r(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    },
    time(fn) {
      const t0 = performance.now();
      fn();
      const sync = performance.now() - t0;
      return new Promise((resolve) => raf(() => setTimeout(() => resolve({ syncMs: Math.round(sync * 10) / 10, paintedMs: Math.round((performance.now() - t0) * 10) / 10 }))));
    },
  };
})();
