// The editor's built-in tools, in the order they're matched against a file
// path (the first whose match() accepts it opens it).

import sprite from './sprite/index.js';
import map from './map/index.js';
import sfx from './sfx/index.js';
import music from './music/index.js';

export const tools = [sprite, map, sfx, music];
