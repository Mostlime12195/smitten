# Editor tools

This page is for developers who add tools to the editor. A tool opens some
types of files (for example, the sprite editor and the sound editor). A
tool can also add entries to the **New** menu.

Each tool is an ES module in `web/editor/tools/<id>/index.js`.
`web/editor/tools/index.js` has a list of the tools. The default export of
a tool module is:

```js
export default {
  id: 'sprite',
  label: 'Sprite editor',
  // The files that the tool opens (in place of the code editor or the preview).
  match: (path) => /\.png$/i.test(path),
  // Entries for the "New" menu in the Files panel.
  newAssets: [{
    label: 'Sprite',
    folder: 'sprites',              // the default folder
    extension: '.png',              // the file that the tool opens after this
    files: (base) => ({             // base: the path that the user chose, without the extension
      [`${base}.png`]: pngBytes,
      [`${base}.sprite`]: jsonText,
    }),
  }],
  // Make an instance for one open file.
  open(host) { return instance; },
};
```

`host` (one for each open file):

| Member | Meaning |
| --- | --- |
| `host.path` | The open file |
| `host.read(path)` | The contents of a project file (`string` for text, `Uint8Array` for binary), or `undefined` |
| `host.write(path, data)` | A promise. It makes or replaces a project file |
| `host.exists(path)` | True if the project file exists |
| `host.list()` | All the file paths in the project |
| `host.setDirty(dirty)` | Marks the tab: it has changes that are not saved |
| `host.palette()` | The palette of the project (`['#rrggbb', ...]`) |
| `host.project()` | The parsed `smitten.json` (with the defaults) |
| `host.synth()` | A promise of the synthesizer (see below) |
| `host.toast(message, {type})` | Shows a short message. `type`: `'info'`, `'success'`, `'error'` |
| `host.openFile(path)` | Opens a different file in a tab |
| `host.ui` | The helper functions of `ui.js` (`h`, `icon`, `showMenu`, `promptDialog`, ...) |

`instance`:

| Member | Meaning |
| --- | --- |
| `element` | The root element of the tool. The editor shows it in the editor area |
| `save()` | A promise. It writes the files of the tool with `host.write` |
| `focus()` | Optional |
| `show()` / `hide()` | Optional. The editor calls them when you select the tab of the tool, and when you go to a different tab |
| `reload(path)` | Optional. The editor calls it with the path of a project file that changed outside the tool |
| `destroy()` | The editor calls it when the tab closes |
| `handleKey(event)` | Optional. Return `true` if the tool used the key |

The editor saves tools with changes that are not saved at these times:

- when you press Ctrl+S.
- before the game runs.
- when you close the tab (after a question).

Tools use the CSS variables of the editor (`editor.css`) for their style.
Because of this, light and dark themes work.

### Synthesizer in the editor

`host.synth()` resolves to this object:

```js
synth.renderSfx(params)          // -> Float32Array, 44100 Hz mono
synth.renderSong(song, readSfx)  // readSfx(the path as the song has it) -> params or null; -> Float32Array
synth.play(samples)              // plays through WebAudio; returns {stop()}
synth.sampleRate                 // 44100
```

It is the same C++ code as the code in the engine, compiled to
`synth.mjs`. Because of this, previews sound the same as the game.
