# Pieces

Each piece has its own properties plus its base type's. In its own script:
`x = 10`, `move()`, `function clicked() end`. On another piece: `other.x`,
`other:move()`, `other:on("clicked", fn)`. Angles are degrees, in code and
in the Inspector.

## Basic

### Piece

Everything in a scene is a piece. Pieces nest: a piece's children belong to it.

A base for other types; not added itself.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `pausable` | bool | true | Stops while the game is paused. Off: this piece and its children keep running (pause menus). |

| Method | |
| --- | --- |
| `find(path)` | A child by name, or a deeper piece by path ("UI/Score"); nil if there isn't one. |
| `findDeep(name)` | The first piece with this name anywhere inside this one. |
| `findChildOfType(type)` | The first child of a type ("Sprite"), or nil. |
| `isA(type)` | True if the piece is of a type, or a type made from it. |
| `add(piece)` | Adds a piece as the last child; returns it. |
| `remove()` | Takes the piece out of its parent now, without destroying it. |
| `spawn(sceneOrType, properties?)` | Makes a piece from a scene file or type and adds it as a child. |
| `destroy()` | Removes the piece and everything inside it at the end of the frame. |
| `tag(name)` | Adds a tag. |
| `untag(name)` | Takes a tag away. |
| `hasTag(name)` | True if the piece has the tag. |
| `hasAnyTag(tags)` | True if the piece has any of the tags in a comma-separated list: hasAnyTag("enemy, spikes"). |
| `is(tagOrType)` | True if the piece has the tag or is of the type: other:is("enemy"), other:is("Body"). |
| `on(event, fn)` | Calls fn(...) on an event. Returns a handle with :off(). |
| `emit(event, ...)` | Fires an event: calls the script's function of that name and every listener. |
| `getPath()` | The piece's path from the scene's root, like "Level/Player". |
| `isAlive()` | True while the piece is in the running scene and not destroyed. |

| Event (a function in its script) | |
| --- | --- |
| `function ready(...)` | The piece and its children joined the scene. The scene root gets go()'s extra values. |
| `function update(dt)` | Every frame. dt is the time since the last frame, in seconds. |
| `function physicsUpdate(dt)` | 60 times a second, before bodies move. Use it for movement. |
| `function draw()` | Draw extra things on top of the piece, in its own coordinates. |
| `function removed()` | The piece is leaving the scene. |

### Group

A piece with a position. Use it to hold other pieces (they move with it) or to run a script.

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `x` | number (px) | 0 | Position, measured from the parent. |
| `y` | number (px) | 0 | Position, measured from the parent. y grows downwards. |
| `rotation` | angle (°) | 0° | Turn, clockwise, in degrees: 90 is a quarter turn. |
| `scaleX` | number | 1 | Width multiplier. Negative mirrors it. |
| `scaleY` | number | 1 | Height multiplier. Negative flips it. |
| `visible` | bool | true | Show this piece and everything inside it. |
| `tint` | color | {1, 1, 1, 1} | Multiplies the colors of this piece and everything inside it. |
| `layer` | int | 0 | Higher layers are drawn on top. Pieces on the same layer draw in scene order. |
| `lit` | bool | true | Lights and the Tint change how this piece and everything inside it looks. Off: always at full brightness (glows, lasers, signs). |

| Method | |
| --- | --- |
| `worldPosition()` | Where the piece is in the scene (not measured from its parent): x, y. |
| `setWorldPosition(x, y)` | Moves the piece to a place in the scene. |
| `toWorld(x, y)` | A point measured from this piece, as a point in the scene. |
| `fromWorld(x, y)` | A point in the scene, measured from this piece. |
| `lookAt(x, y)` | Turns the piece to face a point in the scene. |
| `distanceTo(pieceOrX, y?)` | Distance in pixels to another piece or a point. |
| `angleTo(pieceOrX, y?)` | The angle towards another piece or a point, in degrees: rotation = angleTo(target) faces it. |
| `moveToward(x, y, distance)` | Moves at most distance pixels towards a point; true once it's there. |
| `translate(dx, dy)` | Moves the piece by an offset. |

### Timer

Counts down and calls tick().

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `seconds` | number (s) | 1 | Time between ticks. |
| `running` | bool | false | Counting. On in the scene file means it starts with the scene. |
| `loop` | bool | true | Keep ticking; off ticks once and stops. |

`timeLeft`: Seconds until the next tick.

| Method | |
| --- | --- |
| `start(seconds?)` | Starts (or restarts) the countdown. |
| `stop()` | Stops the countdown. |

| Event (a function in its script) | |
| --- | --- |
| `function tick()` | The countdown reached zero. |

## Things you see

### Sprite

Draws a picture, or an animation from a .sprite file or a sprite sheet.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | A picture (.png, .jpg) or a .sprite file with frames and animations. |
| `animation` | animation | "" | The animation to play, from the .sprite file. |
| `playing` | bool | true | Play the animation. |
| `speed` | number | 1 | Animation speed: 2 is twice as fast. |
| `frame` | int | 0 | The frame shown, counting from 0. |
| `columns` | int | 1 | For a sprite sheet without a .sprite file: frames across. |
| `rows` | int | 1 | For a sprite sheet without a .sprite file: frames down. |
| `centered` | bool | true | Center the picture on the piece's position (a .sprite file's origin wins). |
| `flipX` | bool | false | Mirror left to right. |
| `flipY` | bool | false | Mirror top to bottom. |

| Method | |
| --- | --- |
| `play(name?, restart?)` | Plays an animation, or resumes the current one. restart: from the first frame. |
| `pause()` | Stops the animation where it is; play() continues it. |
| `stop()` | Stops the animation and goes back to its first frame. |
| `hasAnimation(name)` | True if the .sprite file has an animation with this name. |
| `animations()` | The names of the .sprite file's animations, sorted. |
| `getSize()` | Width and height of one frame, in pixels. |
| `getRect()` | The rectangle the picture covers, in the piece's own coordinates: x, y, width, height. |

| Event (a function in its script) | |
| --- | --- |
| `function finished(animation)` | A non-looping animation reached its last frame. |

### Shape

Draws a rectangle, circle, polygon or line. Good for prototypes, effects and games without art.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "rectangle" | What to draw. |
| `width` | number (px) | 64 | Rectangle width. |
| `height` | number (px) | 64 | Rectangle height. |
| `radius` | number (px) | 32 | Circle radius. |
| `cornerRadius` | number (px) | 0 | Rounds the rectangle's corners. |
| `points` | points | {0, -32, 32, 32, -32, 32} | Corner points x1, y1, x2, y2, ... |
| `color` | color | {0.36, 0.55, 0.95, 1} | Fill or line color. |
| `filled` | bool | true | Fill the shape; off draws only its outline. |
| `lineWidth` | number (px) | 2 | Outline and line thickness. |
| `centered` | bool | true | Center the rectangle on the piece's position. |

| Method | |
| --- | --- |
| `getRect()` | The rectangle the shape covers, in the piece's own coordinates: x, y, width, height. |

### Text

Words in the game world, like a sign or a damage number. For scores and menus, use Label.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Text" | What it says. |
| `font` | resource | "" | A .ttf/.otf font file, "pixel" for the built-in pixel font, or empty for the default font. |
| `size` | int (px) | 16 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color. |
| `align` | enum | "center" | Lines up the text around the piece's position. justify stretches wrapped lines to the same width. |
| `wrap` | number (px) | 0 | Wrap lines longer than this; 0 never wraps. |
| `wrapBy` | enum | "word" | Where a line that's too long is broken: between words, or after any character (for writing without spaces, like Japanese). |
| `rich` | bool | false | Reads tags in the text: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `outline` | bool | false | A dark outline around the text. |
| `fontBold` | resource | "" | The font file for [b]bold[/b] words. Empty: the font is made thicker instead. |
| `fontItalic` | resource | "" | The font file for [i]italic[/i] words. Empty: the font is slanted instead. |
| `lineHeight` | number | 1 | How far apart lines are: 1 is the font's own spacing, 1.5 leaves half a line between them. |
| `letterSpacing` | number (px) | 0 | Extra room between letters (negative squeezes them together). |
| `outlineWidth` | number (px) | 0 | How thick the outline is. 0 keeps it one screen pixel thin. |
| `outlineColor` | color | {0, 0, 0, 0.8} | The outline's color. |
| `shadow` | bool | false | A shadow behind the text. |
| `shadowColor` | color | {0, 0, 0, 0.5} | The shadow's color. |
| `shadowX` | number (px) | 2 | How far right the shadow falls (negative: left). |
| `shadowY` | number (px) | 2 | How far down the shadow falls (negative: up). |
| `visibleCharacters` | int | -1 | How many characters show, counted from the start: 0 shows nothing, -1 shows them all. reveal() counts this up for a typewriter effect. |
| `visibleRatio` | number | 1 | How much of the text shows: 0 is nothing, 0.5 the first half, 1 all of it. Tween it to reveal the text smoothly. |

| Method | |
| --- | --- |
| `measure()` | How big the text is as it's laid out now: width, height. |
| `lineCount()` | How many lines the text takes. |
| `characterCount()` | How many characters the text has (tags and line breaks don't count). |
| `characterRect(index)` | Where a character is, measured from the piece's position: x, y, width, height. For putting a cursor or a sparkle on it. |
| `characterAt(x, y)` | The number of the character at a point (measured from the piece's position), or nil. |
| `linkAt(x, y)` | The name of the [link=name] at a point (measured from the piece's position), or nil. |
| `reveal(charactersPerSecond?, from?)` | Shows the text a character at a time (30 a second unless you say): a typewriter. Returns a handle with cancel(), after(fn) and wait(seconds). [pause=0.5] and [speed=10] in rich text change the pace. |
| `skip()` | Shows all of the text now, and ends a reveal(). |

| Event (a function in its script) | |
| --- | --- |
| `function revealed(index, char)` | reveal() showed one more character: play a blip, or wait at a full stop. |
| `function finished()` | reveal() has shown the whole text. |
| `function eachCharacter(c)` | Called for every character each time the text is drawn, to move or color it: c.y = math.sin(c.time * 4 + c.index) * 3. c has x, y, rotation, scale, color, alpha, visible to change, and index, count, char, line, time, since to read. It's one table used for every character, so don't keep it. |

### Tiles

A grid of tiles from a tileset. Solid tiles block bodies.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `tileset` | resource | "" | The .tileset file: a picture cut into tiles, with settings such as solid. |
| `solid` | bool | true | Tiles marked solid block bodies. Off makes every tile just decoration. |
| `castShadows` | bool | false | Tiles marked solid block Lights that have shadows on. |
| `animate` | bool | true | Animated tiles play. Off freezes them on the frame they show. |

| Method | |
| --- | --- |
| `getTile(column, row)` | The tile number in a cell, or -1 if it's empty. |
| `setTile(column, row, tile)` | Changes a cell (-1 empties it). |
| `tileInfo(tile)` | The settings of a tile in the tileset (solid, name, ...). |
| `cellAt(x, y)` | The cell under a point in the scene: column, row. |
| `cellPosition(column, row)` | The scene position of a cell's top-left corner. |
| `cellsWith(tile?)` | A list of {column, row, tile} for every painted cell (or every cell with that tile). |
| `fill(column, row, columns, rows, tile)` | Sets a rectangle of cells to one tile (-1 empties them). |
| `clear()` | Empties every cell. |
| `tileAt(x, y)` | The tile number under a point in the scene, or -1. |
| `isSolid(column, row)` | True if the cell's tile is marked solid (and solid is on). |
| `neighbors(column, row, diagonal?)` | Adjacent cells as {column, row, tile}: 4, or 8 with diagonal. |
| `cellCenter(column, row)` | The scene position of a cell's center. |
| `getTileSize()` | The size of one cell in the scene: width, height. |
| `getBounds()` | The painted area in the scene: x, y, width, height (all 0 when empty). |
| `newPathGrid(options?)` | A grid for finding paths through these tiles (solid tiles are solid cells): grid:findPoints(x, y, toX, toY). It follows setTile(). |
| `setTerrain(column, row, terrain)` | Paints a terrain of the tileset (by name; nil erases) in a cell and re-picks the tiles of the 8 cells around it so the edges fit. |
| `getTerrain(column, row)` | The name of the terrain the cell's tile belongs to, or nil. |
| `fillTerrain(column, row, columns, rows, terrain)` | Paints a terrain (nil erases) in a rectangle of cells and fits the edges, also of the cells around it. |
| `terrains()` | The names of the tileset's terrains. |

### Background

Scrolls the pieces inside it slower or faster than the camera, for far hills, clouds and skies (parallax). It can repeat them endlessly.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `scrollX` | number | 0.5 | How much it moves sideways with the scene when the camera moves: 1 like everything else, 0.5 half as fast (far away), 0 stays on the screen, above 1 for things in front. |
| `scrollY` | number | 0.5 | The same, up and down. |
| `repeatWidth` | number (px) | 0 | Draws what's inside again every this many pixels sideways, as far as the view goes (0: once). Use the width of the picture. |
| `repeatHeight` | number (px) | 0 | Draws what's inside again every this many pixels up and down (0: once). |
| `driftX` | number (px/s) | 0 | Slides sideways by itself at this speed, like clouds. Negative goes left. |
| `driftY` | number (px/s) | 0 | Slides down by itself at this speed. Negative goes up. |
| `offsetX` | number (px) | 0 | Shifts what's inside sideways. Change it from a script to scroll by hand. |
| `offsetY` | number (px) | 0 | Shifts what's inside up or down. |
| `left` | number (px) | none | Stops scrolling its own way while the view is left of this: from there it moves with the scene (empty for no edge). |
| `top` | number (px) | none | Stops scrolling its own way while the view is above this. |
| `right` | number (px) | none | Stops scrolling its own way while the view is right of this. |
| `bottom` | number (px) | none | Stops scrolling its own way while the view is below this. |

| Method | |
| --- | --- |
| `getScroll()` | How far it is drawn from where it was placed, right now: x, y. |

### Camera

Decides which part of the scene is on screen. Put it inside the player to follow them.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `active` | bool | true | Use this camera. When several are active, the first in the scene wins. |
| `zoom` | number | 1 | 2 shows everything twice as big. |
| `smoothing` | number | 0 | How gently it catches up: 0 sticks exactly, 5 glides. |
| `target` | piecepath | "" | A piece to follow, wherever the camera is in the scene (empty: the camera's own position). |
| `offsetX` | number (px) | 0 | Looks this far right of what it follows. |
| `offsetY` | number (px) | 0 | Looks this far below what it follows. |
| `left` | number (px) | none | Don't show anything left of this (empty for no edge). |
| `top` | number (px) | none | Don't show anything above this. |
| `right` | number (px) | none | Don't show anything right of this. |
| `bottom` | number (px) | none | Don't show anything below this. |

| Method | |
| --- | --- |
| `shake(strength?, seconds?)` | Shakes the view: shake(6, 0.3). |
| `follow(piece)` | Follows a piece (nil: back to target, or the camera's own position). |
| `snap()` | Jumps straight to what it follows, without smoothing (after a teleport). |
| `setLimits(left, top, right, bottom)` | Sets the edges it doesn't show past (nil for no edge). |
| `limitTo(piece)` | Keeps the view inside the painted part of a Tiles piece. |
| `makeCurrent()` | Makes this the camera in use, turning the others off. |
| `getView()` | The part of the scene on screen: x, y, width, height. |
| `screenToWorld(sx, sy)` | A point on the screen, as a point in the scene. |
| `worldToScreen(x, y)` | A point in the scene, as a point on the screen. |

### Particles

Sprays particles: smoke, sparks, dust, rain, explosions.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `emitting` | bool | true | Make new particles. |
| `rate` | number (/s) | 30 | Particles per second. |
| `burst` | bool | false | Make one burst of rate particles, then stop. |
| `lifetime` | number (s) | 1 | How long each particle lives. |
| `image` | resource | "" | The particle picture; empty draws soft dots. |
| `speed` | number (px/s) | 100 | Starting speed. |
| `speedRandom` | number | 0.5 | How much the speed varies (0 to 1). |
| `direction` | angle (°) | -5156.62° | Direction particles fly in, in degrees: 0 is right, 90 is down, -90 is up. |
| `spread` | angle (°) | 1718.87° | How far directions vary either side, in degrees. |
| `gravityX` | number (px/s²) | 0 | Constant pull, sideways. |
| `gravityY` | number (px/s²) | 0 | Constant pull, down. |
| `sizeStart` | number (px) | 8 | Size when born. |
| `sizeEnd` | number (px) | 2 | Size when it fades. |
| `colorStart` | color | {1, 0.85, 0.4, 1} | Color when born. |
| `colorEnd` | color | {1, 0.3, 0.1, 0} | Color when it fades. |
| `followPiece` | bool | false | Particles move with the piece instead of staying where they were born. |

| Method | |
| --- | --- |
| `emit(count)` | Makes count particles right now. emit("event", ...) still fires an event. |
| `start()` | Starts making particles (a burst makes its particles again). |
| `stop()` | Stops making particles; the ones already out live on. |
| `clear()` | Removes every particle now. |
| `restart()` | Clears every particle and starts again. |
| `getCount()` | How many particles are out now. |

| Event (a function in its script) | |
| --- | --- |
| `function finished()` | The last particle is gone and no more are coming (after a burst or stop()). Good for destroy(). |

## Light and shadow

### Light

Shines on the pieces around it. With a dark Tint in the scene it's a torch at night; on its own it makes things brighter.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "point" | point shines out from where the piece is, as far as radius. sun lights the whole view from one side: it shines the way the piece is turned. |
| `radius` | number (px) | 200 | How far the light reaches. |
| `brightness` | number | 1 | How strong the light is: 0 is dark, 2 is twice as bright. |
| `color` | color | {1, 1, 1, 1} | The light's color. |
| `image` | resource | "" | A picture of the light's shape, white where it shines: a beam, a window. Empty: a soft round glow. |
| `blend` | enum | "add" | add makes what it shines on brighter. subtract makes it darker (a patch of gloom). mix swaps the light that's there for this light's color. |
| `off` | bool | false | Turn this light off. |
| `lights` | tags | "" | Only lights pieces with one of these tags, and what's inside them (empty: every piece). |
| `fromLayer` | number | none | Only lights pieces on this layer and higher (empty: no limit). |
| `toLayer` | number | none | Only lights pieces on this layer and lower (empty: no limit). |
| `shadows` | bool | false | Occluders, and Tiles with castShadows on, block this light. |
| `shadowColor` | color | {0, 0, 0, 1} | What's left of the light inside a shadow: black for nothing. A see-through color makes fainter shadows. |
| `shadowSoftness` | number (px) | 0 | Blurs the edges of the shadows this far. 0 keeps them sharp, and is quickest. |
| `shadowLength` | number (px) | 0 | How long a sun's shadows are; 0 for shadows that never end. |
| `shadowsFrom` | tags | "" | Only Occluders and Tiles with one of these tags block it (empty: all of them). The tag can be on the piece the Occluder is inside. |

### Occluder

Blocks light: Lights with shadows on throw a shadow behind it. Put it inside a piece to fit that piece's Sprite or Shape.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside it or, when it has none, the ones in the piece it is inside. |
| `width` | number (px) | 32 | Rectangle width. |
| `height` | number (px) | 32 | Rectangle height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... of the outline. |
| `off` | bool | false | Let light through. |

### Tint

Colors the whole scene (not the on-screen UI): dark blue for night, orange for sunset. Lights shine on top of it. The first Tint in the scene wins.

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.35, 0.4, 0.6, 1} | Every piece's colors are multiplied by this: white changes nothing, black hides everything that no light reaches. |
| `off` | bool | false | Turn the tint off. |
| `fromLayer` | number | none | Only tints pieces on this layer and higher (empty: no limit). |
| `toLayer` | number | none | Only tints pieces on this layer and lower (empty: no limit). |

## Bodies and zones

### Body

Solid. motion: still (walls), scripted (moved with move()) or physics (simulated). Takes its shape from a Sprite or Shape inside it.

Extends [Group](#group). Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `motion` | enum | "scripted" | still: moves only when a script sets x/y. scripted: moved by move(). physics: simulated. |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside. capsule has round ends. none: Hitboxes only. |
| `width` | number (px) | 32 | Rectangle or capsule width. |
| `height` | number (px) | 32 | Rectangle or capsule height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... (up to 8 corners; a dent is filled in). |
| `vx` | number (px/s) | 0 | Horizontal speed (px/s). |
| `vy` | number (px/s) | 0 | Speed down (negative is up). Scripted: what move() goes by. Physics: its speed now. |
| `spin` | angle (°/s) | 0° | How fast it turns, in degrees a second (clockwise is positive): 360 is a whole turn every second. Scripted: move() turns it this fast. |
| `slope` | angle (°) | 2578.31° | The steepest surface that still counts as ground, in degrees: move() walks up it without sliding back. |
| `mass` | number (kg) | 1 | Kilograms. A scripted body pushes physics bodies by its mass against theirs. |
| `friction` | number | 0.3 | How much it grips what it touches: 0 is ice. |
| `bounce` | number | 0 | How much it bounces: 0 none, 1 forever. |
| `gravityScale` | number | 1 | How strongly gravity pulls it: 1 is normal, 0 floats, -1 falls up. |
| `drag` | number | 0 | Air resistance: slows its movement down. |
| `spinDrag` | number | 0 | Slows its turning down. |
| `fixedRotation` | bool | false | Never tip over or spin. |
| `bullet` | bool | false | Continuous collision against moving bodies, for small fast objects. |
| `asleep` | bool | false | At rest until touched. Physics bodies sleep when they stop. |
| `passThrough` | tags | "" | Tags of things it doesn't bump into, like "ghost, pickup" ("tiles" for solid tiles). |

| Method | |
| --- | --- |
| `move()` | Moves by vx, vy for this step: slides along walls, climbs slopes, rides platforms, pushes physics bodies. |
| `moveBy(dx, dy)` | Moves by an offset and stops at the first thing in the way; returns what it hit, or nil. |
| `onGround()` | True if the last move ended standing on something. |
| `onWall()` | True if the last move ran into a wall. |
| `onCeiling()` | True if the last move ran into a ceiling. |
| `applyImpulse(ix, iy, x?, y?)` | Instant change of velocity by impulse / mass. At a point, also spins. |
| `applyForce(fx, fy, x?, y?)` | Force for this step; call every physicsUpdate. At its center or a point. |
| `applyTorque(torque)` | Turns it steadily for this step (physics bodies). |
| `applyAngularImpulse(impulse)` | A sudden twist (physics bodies). |
| `push(ix, iy)` | The same as applyImpulse(ix, iy). |
| `wake()` | Wakes a sleeping physics body. |
| `grab(x, y, strength?)` | Holds it by a scene point for dragTo(); drop() releases with momentum. |
| `dragTo(x, y)` | Moves the grabbed point towards x, y. |
| `drop()` | Lets go after grab(); a physics body keeps its speed. |
| `touching(tagOrPiece)` | The first body or zone with a tag (or that piece) touching this one, or nil. |
| `isTouching(other)` | True if it touches a piece (a body, zone or Tiles) or anything with a tag. |
| `contacts()` | Current contacts: {piece, x, y, nx, ny, impulse}. |
| `touchingTile(setting)` | The settings of a touching tile that has this setting (like "damage"), or nil. |
| `getSize()` | The size of the box around its shapes: width, height. |

| Event (a function in its script) | |
| --- | --- |
| `function hit(other, contact)` | Started touching a body or solid tiles. contact: x, y, nx, ny (from other to this body), impulse. |
| `function entered(zone)` | It went into a zone. |
| `function exited(zone)` | It left a zone. |

### Zone

An area that detects bodies and zones entering and leaving. Doesn't block. Ignores still bodies.

Extends [Group](#group). Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | Auto fits the Sprites and Shapes inside it. Shapes turn and scale with the Zone. |
| `width` | number (px) | 32 | Rectangle or capsule width. |
| `height` | number (px) | 32 | Rectangle or capsule height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... (up to 8 corners). |
| `detects` | tags | "" | Only notices things with one of these tags (empty: everything). |
| `active` | bool | true | Notice things going in and out. |

| Method | |
| --- | --- |
| `inside()` | A list of the bodies and zones inside it now. |
| `touching(tagOrPiece)` | The first body or zone with a tag (or that piece) inside it, or nil. |
| `isTouching(other)` | True if a piece (or anything with a tag) is inside it. |

| Event (a function in its script) | |
| --- | --- |
| `function entered(other)` | A body or zone came in. |
| `function exited(other)` | A body or zone left. |

### Hitbox

An extra collision shape for the Body or Zone it's inside.

Extends [Group](#group). Goes inside a Body or Zone.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "rectangle" | The shape, placed and turned by the Hitbox's position and rotation. |
| `width` | number (px) | 32 | Rectangle or capsule width. |
| `height` | number (px) | 32 | Rectangle or capsule height. |
| `radius` | number (px) | 16 | Circle radius. |
| `points` | points | {0, -16, 16, 16, -16, 16} | Corner points x1, y1, x2, y2, ... (up to 8 corners). |
| `off` | bool | false | Turn this shape off. |

### Joint

Connects body a to body b, or to its own position.

Extends [Group](#group). Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "pin" | pin, weld, rope, spring, distance, slider (x axis), wheel (y axis spring) or mouse. |
| `a` | piecepath | "" | The body it holds. |
| `b` | piecepath | "" | The body it connects a to (empty: the place where the Joint is). |
| `length` | number (px) | 0 | How far apart; 0 uses the distance when the joint is made. |
| `spring` | bool | false | Springy: a pin or slider pulls back to where it started, a weld wobbles. |
| `stiffness` | number (Hz) | 4 | How stiff the spring is: wobbles per second. |
| `damping` | number | 0.5 | How quickly the spring stops wobbling: 1 doesn't overshoot. |
| `motor` | bool | false | Drive it: turn a pin or wheel, or move a slider, at motorSpeed. |
| `motorSpeed` | number | 90 | Degrees a second (pin, wheel) or pixels a second (slider, distance). |
| `motorStrength` | number | 100000 | The most torque (pin, wheel) or force (slider, distance) the motor uses. |
| `limit` | bool | false | Keep a pin between minAngle and maxAngle, or a slider or wheel between lower and upper. |
| `minAngle` | angle (°) | -2578.31° | The furthest a pin turns anticlockwise, in degrees. |
| `maxAngle` | angle (°) | 2578.31° | The furthest a pin turns clockwise, in degrees. |
| `lower` | number (px) | -50 | The furthest a slider or wheel goes back. |
| `upper` | number (px) | 50 | The furthest a slider or wheel goes forward. |
| `strength` | number | 0 | The most force a mouse joint pulls with; 0 is plenty for the body's mass. |
| `collide` | bool | false | The two bodies still bump into each other. |
| `breakForce` | number | 0 | Breaks (and sends broke) when pulled harder than this; 0 never breaks. |

| Method | |
| --- | --- |
| `getAngle()` | How far a pin has turned, in degrees. |
| `getTranslation()` | How far a slider has slid (pixels). |
| `getLength()` | How far apart a rope, spring or distance joint's ends are. |
| `getSpeed()` | How fast a pin turns (degrees a second) or a slider slides (pixels a second). |
| `getForce()` | How hard the joint pulls now. |
| `getTorque()` | How hard the joint twists now. |
| `isBroken()` | True once breakForce broke it. |

| Event (a function in its script) | |
| --- | --- |
| `function broke()` | It was pulled harder than breakForce and let go. |

### Walkable

A polygon that says where things can walk. smitten.paths.findPath() finds a way through all the Walkable pieces in the scene.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `points` | points | {-100, -60, 100, -60, 100, 60, -100, 60} | Corner points x1, y1, x2, y2, ... in order round the shape. Any number of corners; dents are fine. |
| `hole` | bool | false | Cuts this shape out of the walkable areas it lies on, instead of adding to them: a pillar, a pond, a table. |
| `active` | bool | true | Counts for paths. Turn it off to close an area (or fill a hole) for a while. |

## On-screen UI

### UI

The base of UI pieces: a rectangle on the screen, placed from a corner, an edge or the center.

Extends [Piece](#piece). A base for other types; not added itself.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `anchor` | enum | "topLeft" | What x and y are measured from. fill covers the screen or the parent UI piece. |
| `x` | number (px) | 0 | Distance in from the anchor. |
| `y` | number (px) | 0 | Distance in from the anchor. |
| `width` | number (px) | 160 | Width (ignored with fill). |
| `height` | number (px) | 40 | Height (ignored with fill). |
| `visible` | bool | true | Show this piece and everything inside it. |
| `opacity` | number | 1 | 0 is invisible, 1 is solid. |

| Method | |
| --- | --- |
| `getRect()` | Where it is on the screen now: x, y, width, height. |
| `isHovered()` | True while the mouse is over it. |

| Event (a function in its script) | |
| --- | --- |
| `function hovered()` | The pointer came over it (not Labels). |
| `function unhovered()` | The pointer left it. |

### Label

Words on the screen: scores, timers, titles, dialog.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Label" | What it says. Change it from a script: text = `Score: {score}`. |
| `font` | resource | "" | A .ttf/.otf font, "pixel", or empty for the default font. |
| `size` | int (px) | 20 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color. |
| `align` | enum | "left" | Lines up the text inside its rectangle. justify stretches wrapped lines to the same width. |
| `valign` | enum | "top" | Lines up the text top to bottom. |
| `wrapBy` | enum | "word" | Where a line too long for the rectangle is broken: between words, after any character (for writing without spaces, like Japanese), or not at all. |
| `fit` | enum | "none" | shrink makes the text smaller until it fits inside the rectangle. |
| `rich` | bool | false | Reads tags in the text: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `outline` | bool | false | A dark outline around the text. |
| `fontBold` | resource | "" | The font file for [b]bold[/b] words. Empty: the font is made thicker instead. |
| `fontItalic` | resource | "" | The font file for [i]italic[/i] words. Empty: the font is slanted instead. |
| `lineHeight` | number | 1 | How far apart lines are: 1 is the font's own spacing, 1.5 leaves half a line between them. |
| `letterSpacing` | number (px) | 0 | Extra room between letters (negative squeezes them together). |
| `outlineWidth` | number (px) | 0 | How thick the outline is. 0 keeps it one screen pixel thin. |
| `outlineColor` | color | {0, 0, 0, 0.8} | The outline's color. |
| `shadow` | bool | false | A shadow behind the text. |
| `shadowColor` | color | {0, 0, 0, 0.5} | The shadow's color. |
| `shadowX` | number (px) | 2 | How far right the shadow falls (negative: left). |
| `shadowY` | number (px) | 2 | How far down the shadow falls (negative: up). |
| `visibleCharacters` | int | -1 | How many characters show, counted from the start: 0 shows nothing, -1 shows them all. reveal() counts this up for a typewriter effect. |
| `visibleRatio` | number | 1 | How much of the text shows: 0 is nothing, 0.5 the first half, 1 all of it. Tween it to reveal the text smoothly. |

| Method | |
| --- | --- |
| `measure()` | How big the text is as it's laid out now: width, height. |
| `lineCount()` | How many lines the text takes. |
| `characterCount()` | How many characters the text has (tags and line breaks don't count). |
| `characterRect(index)` | Where a character is, measured from the label's top-left corner: x, y, width, height. For putting a cursor or a sparkle on it. |
| `characterAt(x, y)` | The number of the character at a point (measured from the label's top-left corner), or nil. |
| `linkAt(x, y)` | The name of the [link=name] at a point (measured from the label's top-left corner), or nil. |
| `reveal(charactersPerSecond?, from?)` | Shows the text a character at a time (30 a second unless you say): a typewriter. Returns a handle with cancel(), after(fn) and wait(seconds). [pause=0.5] and [speed=10] in rich text change the pace. |
| `skip()` | Shows all of the text now, and ends a reveal(). |

| Event (a function in its script) | |
| --- | --- |
| `function revealed(index, char)` | reveal() showed one more character: play a blip, or wait at a full stop. |
| `function finished()` | reveal() has shown the whole text. |
| `function eachCharacter(c)` | Called for every character each time the text is drawn, to move or color it: c.y = math.sin(c.time * 4 + c.index) * 3. c has x, y, rotation, scale, color, alpha, visible to change, and index, count, char, line, time, since to read. It's one table used for every character, so don't keep it. |
| `function linkPressed(name)` | A [link=name] in the text was clicked or tapped. |

### Button

A button to click or tap. Its script gets clicked().

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Button" | The button's words. |
| `font` | resource | "" | A font, or empty for the default. |
| `size` | int (px) | 18 | Font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | Background color. |
| `textColor` | color | {1, 1, 1, 1} | Text color. |
| `rich` | bool | false | Reads tags in the text: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `fit` | enum | "none" | shrink makes the words smaller until they fit inside the button. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `disabled` | bool | false | Can't be pressed; drawn faded. |
| `autofocus` | bool | false | Has keyboard focus when the scene starts. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus. |
| `isFocused()` | True while it has the keyboard focus. |
| `isDown()` | True while it's held down. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The button was clicked, tapped, or pressed with accept while focused. |

### Panel

A colored box behind other UI: a dialog, a HUD background.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.08, 0.09, 0.12, 0.85} | Fill color. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |
| `borderColor` | color | {1, 1, 1, 0.15} | Outline color. |
| `borderWidth` | number (px) | 1 | Outline thickness; 0 for none. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The panel was clicked or tapped (not on a button inside it). |

### Picture

A picture on the screen: an icon, a portrait, a logo.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | The picture. |
| `fit` | enum | "contain" | How the picture fills the rectangle. |
| `color` | color | {1, 1, 1, 1} | Tint. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The picture was clicked or tapped. |

### Bar

A bar that fills up: health, loading, a countdown.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `value` | number | 50 | How full it is, between min and max. |
| `min` | number | 0 | The value when empty. |
| `max` | number | 100 | The value when full. |
| `color` | color | {0.3, 0.8, 0.45, 1} | Fill color. |
| `background` | color | {0, 0, 0, 0.45} | Empty color. |
| `cornerRadius` | number (px) | 4 | Rounds the corners. |
| `showValue` | bool | false | Show the value as text. |

### TouchStick

A stick for a thumb on a touch screen. It pushes input actions the way a gamepad's stick does, so axis("left", "right") reads it with no extra code.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `leftAction` | action | "left" | The action it pushes when the thumb goes left (none: it pushes nothing that way). |
| `rightAction` | action | "right" | The action it pushes when the thumb goes right. |
| `upAction` | action | "up" | The action it pushes when the thumb goes up. |
| `downAction` | action | "down" | The action it pushes when the thumb goes down. |
| `player` | int | 0 | Whose actions it pushes: 2 for player 2. 0 takes the player of the piece it's inside, or player 1. |
| `mode` | enum | "fixed" | fixed stays in the middle of its rectangle. floating appears where the thumb lands, anywhere in the rectangle. follow does too, and is dragged along when the thumb goes further than the radius. |
| `radius` | number (px) | 60 | How far the thumb goes for a full push; also the size of the stick's circle. |
| `deadzone` | number | 0.2 | How much of the radius near the middle counts as not pushed at all (0.2 is a fifth). |
| `show` | enum | "touch" | touch draws it on phones and tablets, and on any screen once a finger touches it. always draws it everywhere, and the mouse can work it. never keeps it invisible; fingers still work it. |
| `color` | color | {1, 1, 1, 0.25} | The color of the stick's circle (or a tint for its image). |
| `knobColor` | color | {1, 1, 1, 0.6} | The color of the knob under the thumb (or a tint for its image). |
| `image` | resource | "" | A picture for the stick's circle, instead of the drawn one. |
| `knobImage` | resource | "" | A picture for the knob, instead of the drawn one. |

| Method | |
| --- | --- |
| `getValue()` | Where the stick is pushed: x, y from -1 to 1 (0, 0 when no finger is on it). |
| `isActive()` | True while a finger is on the stick. |

| Event (a function in its script) | |
| --- | --- |
| `function touched()` | A finger landed on the stick. |
| `function untouched()` | The finger let go of the stick. |

### TouchButton

A button for a finger on a touch screen. It holds an input action down while it's held, so pressed("jump") reads it with no extra code.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `action` | action | "jump" | The action it holds down while a finger is on it (none: it only tells its script, with touched() and untouched()). |
| `player` | int | 0 | Whose action it presses: 2 for player 2. 0 takes the player of the piece it's inside, or player 1. |
| `shape` | enum | "circle" | circle is the biggest circle that fits its rectangle. rectangle is the whole rectangle. |
| `text` | text | "" | Words or a letter on the button. |
| `image` | resource | "" | A picture on the button: an arrow, a sword. |
| `show` | enum | "touch" | touch draws it on phones and tablets, and on any screen once a finger touches it. always draws it everywhere, and the mouse can press it. never keeps it invisible; fingers still press it. |
| `color` | color | {1, 1, 1, 0.3} | The button's color. It's drawn stronger while held. |
| `textColor` | color | {1, 1, 1, 0.9} | The color of its words. |
| `font` | resource | "" | A font, or empty for the default. |
| `size` | int (px) | 20 | Font size. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |

| Method | |
| --- | --- |
| `isDown()` | True while a finger holds it down. |

| Event (a function in its script) | |
| --- | --- |
| `function touched()` | A finger pressed the button (or slid onto it). |
| `function untouched()` | The finger let go, or slid off. |

## Sound

### Sound

Plays a sound or music: a .wav, .ogg or .mp3 file, or a .sfx or .song made in Smitten.

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `sound` | resource | "" | The sound file. |
| `autoplay` | bool | false | Play when the scene starts. |
| `loop` | bool | false | Start again at the end. |
| `volume` | number | 1 | Loudness, 0 to 1. |
| `pitch` | number | 1 | 1 is normal; 2 is an octave up. |

| Method | |
| --- | --- |
| `play()` | Plays it and returns its Source (see smitten.audio). Calling it while playing starts another copy (not for .song). |
| `stop()` | Stops every copy. |
| `pause()` | Pauses. |
| `resume()` | Continues after pause(). |
| `isPlaying()` | True while it's playing. |
| `fadeIn(seconds, volume?)` | Plays from silence up to its volume (or volume) over some seconds. |
| `fadeOut(seconds)` | Fades to silence, then stops; volume goes back to what it was. |
| `seek(seconds)` | Jumps to a time in the sound. |
| `tell()` | Where it's playing, in seconds. |
| `getDuration()` | How long the sound is, in seconds. |

| Event (a function in its script) | |
| --- | --- |
| `function finished()` | The sound reached its end (not when looping). |
