# Editor tools

For people extending the editor itself: a tool opens some kinds of files
(the sprite editor, the sound editor) and can add entries to the New menu.

Each tool is an ES module in `web/editor/tools/<id>/index.js`, listed in
`web/editor/tools/index.js`, whose default export is:

```js
export default {
  id: 'sprite',
  label: 'Sprite editor',
  // Which files the tool opens (instead of the code editor or preview).
  match: (path) => /\.png$/i.test(path),
  // Entries for the "New" menu in the file panel.
  newAssets: [{
    label: 'Sprite',
    folder: 'sprites',              // suggested folder
    extension: '.png',              // the file the tool then opens
    files: (base) => ({             // base: chosen path without extension
      [`${base}.png`]: pngBytes,
      [`${base}.sprite`]: jsonText,
    }),
  }],
  // Create an instance for one open file.
  open(host) { return instance; },
};
```

`host` (one per opened file):

| Member | Meaning |
| --- | --- |
| `host.path` | The opened file |
| `host.read(path)` | A project file's contents (`string` for text, `Uint8Array` for binary), or `undefined` |
| `host.write(path, data)` | Promise; creates or replaces a project file |
| `host.exists(path)` | |
| `host.list()` | Every file path in the project |
| `host.setDirty(dirty)` | Marks the tab as having unsaved changes |
| `host.palette()` | The project palette (`['#rrggbb', ...]`) |
| `host.project()` | The parsed `smitten.json` (with defaults) |
| `host.synth()` | Promise of the synthesizer (below) |
| `host.toast(message, {type})` | `type`: `'info'`, `'success'`, `'error'` |
| `host.openFile(path)` | Open another file in a tab |
| `host.ui` | `ui.js`'s helpers (`h`, `icon`, `showMenu`, `promptDialog`, ...) |

`instance`:

| Member | Meaning |
| --- | --- |
| `element` | The tool's root element, shown in the editor area |
| `save()` | Promise; writes the tool's files with `host.write` |
| `focus()` | Optional |
| `show()` / `hide()` | Optional; called when its tab is selected or left |
| `reload(path)` | Optional; called with the path of any project file that changed outside the tool |
| `destroy()` | Called when the tab closes |
| `handleKey(event)` | Optional; return `true` if the tool used the key |

The editor saves dirty tools on Ctrl+S, before running the game, and on
close (after asking). Tools style themselves with the editor's CSS
variables (`editor.css`), so light and dark themes work.

### Synthesizer in the editor

`host.synth()` resolves to:

```js
synth.renderSfx(params)          // -> Float32Array, 44100 Hz mono
synth.renderSong(song, readSfx)  // readSfx(path as written in the song) -> params or null; -> Float32Array
synth.play(samples)              // plays through WebAudio; returns {stop()}
synth.sampleRate                 // 44100
```

It's the same C++ code as the engine's, compiled to `synth.mjs`, so
previews sound exactly like the game.
