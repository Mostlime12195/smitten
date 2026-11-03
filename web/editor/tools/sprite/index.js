// Sprite and pixel editor: edits a sprite sheet PNG and its .sprite.json
// (frame size, origin, animations). See docs/reference.md ("Sprites",
// "Editor tools").

import { SpriteEditor } from './editor.js';
import { encodePNGSync } from './png.js';

export default {
  id: 'sprite',
  label: 'Sprite editor',
  match: (path) => /\.(png|sprite\.json)$/i.test(path),
  newAssets: [{
    label: 'Sprite',
    folder: 'sprites',
    extension: '.png',
    // One transparent 16×16 frame; frames, origin and animations added in
    // the editor create the .sprite.json when saved.
    files: (base) => ({ [`${base}.png`]: encodePNGSync(new Uint8ClampedArray(16 * 16 * 4), 16, 16) }),
  }],
  open(host) {
    return new SpriteEditor(host);
  },
};
