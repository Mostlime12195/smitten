// The sprite editor (the Sprites workspace): paints a PNG (one image, or a sheet of frames) and its
// .sprite file (frame size, origin, animations). Opens .png, .sprite and the
// older .sprite.json. See docs/formats.md ("Sprites") and docs/editor-tools.md.

import { SpriteEditor } from './editor.js';
import { encodePNGSync } from './png.js';

export const NEW_IMAGE_SIZE = 256;

export default {
  id: 'sprite',
  label: 'Sprite editor',
  match: (path) => /\.(png|sprite|sprite\.json)$/i.test(path),
  newAssets: [{
    label: 'Sprite',
    folder: 'sprites',
    extension: '.png',
    // One transparent 256×256 image; frames, an origin or animations added
    // in the editor create the .sprite file when saved.
    files: (base) => ({ [`${base}.png`]: encodePNGSync(new Uint8ClampedArray(NEW_IMAGE_SIZE * NEW_IMAGE_SIZE * 4), NEW_IMAGE_SIZE, NEW_IMAGE_SIZE) }),
  }],
  open(host) {
    return new SpriteEditor(host);
  },
};
