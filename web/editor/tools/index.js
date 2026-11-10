// The editor's built-in tools, in the order they're matched against a file
// path (the first whose match() accepts it opens it). Tile maps are painted
// in the scene view (workspaces/scene/tilemap-panel.js).

import sprite from './sprite/index.js';
import sfx from './sfx/index.js';
import music from './music/index.js';
import wav from './wav/index.js';

export const tools = [sprite, sfx, wav, music];
