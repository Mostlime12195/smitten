# Pieces

Every piece type, generated from `love/src/modules/scene/pieces.json` by
`tools/gen-docs.mjs`. A piece has its own properties and everything its
base type has. Properties are fields: `x = 10` in its own script,
`Player.x = 10` or `other.x = 10` from another. Methods are called as
`move()` in the piece's own script and `piece:move()` on another piece.
Events are functions its script defines (`function pressed() ... end`),
or listeners added with `piece:on("pressed", fn)`. Angles are radians in
code and degrees in the inspector.

## Basic

### Piece

Everything in a scene is a piece. Pieces nest: a piece's children belong to it.

A base for other types; not added itself.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `pausable` | bool | true | Stops while the game is paused (pauseGame()). Turn it off for pause menus: this piece and everything inside it keep running. |

| Method | |
| --- | --- |
| `find(path)` | A child by name, or a deeper piece by path ("UI/Score"); nil if there isn't one. |
| `findDeep(name)` | The first piece with this name anywhere inside this one. |
| `findChildOfType(type)` | The first child of a type ("Sprite"), or nil. |
| `isA(type)` | True if the piece is of a type, or a type made from it. |
| `add(piece)` | Adds a piece as the last child; returns it. |
| `remove()` | Takes the piece out of its parent now, without destroying it, so it can be added somewhere else. |
| `spawn(sceneOrType, properties?)` | Makes a piece from a scene file or a piece type and adds it as a child: self:spawn("scenes/bullet.scene", { x = 10 }). |
| `destroy()` | Removes the piece and everything inside it at the end of the frame. |
| `tag(name)` | Gives the piece a tag, so smitten.scene.tagged(name) finds it and collisions can filter by it. |
| `untag(name)` | Takes a tag away. |
| `hasTag(name)` | True if the piece has the tag. |
| `hasAnyTag(tags)` | True if the piece has any of the tags in a comma-separated list: hasAnyTag("enemy, spikes"). |
| `is(tagOrType)` | True if the piece has the tag or is of the type: other:is("enemy"), other:is("Body"). |
| `on(event, fn)` | Calls fn(...) whenever the piece's event happens ("pressed", "entered", ...). Returns a handle with :off(). |
| `emit(event, ...)` | Fires an event: calls the script's function of that name and every listener. |
| `getPath()` | The piece's path from the scene's root, like "Level/Player". |
| `isAlive()` | True while the piece is in the running scene and not destroyed. |

| Event (a function in its script) | |
| --- | --- |
| `function ready(...)` | The piece and everything inside it have joined the scene. The scene's root gets go()'s extra values. |
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
| `rotation` | angle | 0° | Turn, clockwise: radians in code, degrees in the inspector. |
| `scaleX` | number | 1 | Width multiplier. Negative mirrors it. |
| `scaleY` | number | 1 | Height multiplier. Negative flips it. |
| `visible` | bool | true | Show this piece and everything inside it. |
| `tint` | color | {1, 1, 1, 1} | Multiplies the colors of this piece and everything inside it. |
| `layer` | int | 0 | Higher layers are drawn on top. Pieces on the same layer draw in scene order. |

| Method | |
| --- | --- |
| `worldPosition()` | Where the piece is in the scene (not measured from its parent): x, y. |
| `setWorldPosition(x, y)` | Moves the piece to a place in the scene. |
| `toWorld(x, y)` | A point measured from this piece, as a point in the scene. |
| `fromWorld(x, y)` | A point in the scene, measured from this piece. |
| `lookAt(x, y)` | Turns the piece to face a point in the scene. |
| `distanceTo(pieceOrX, y?)` | Distance in pixels to another piece or a point. |
| `angleTo(pieceOrX, y?)` | Angle in radians towards another piece or a point. |
| `moveToward(x, y, distance)` | Moves at most distance pixels towards a point; true once it's there. |
| `translate(dx, dy)` | Moves the piece by an offset. |

### Timer

Counts down and calls tick() on its script and listeners. For spawn waves, cooldowns and delays.

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
| `play(name?, restart?)` | Plays an animation (or resumes the current one). restart starts it again from its first frame even if it's playing. |
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
| `align` | enum | "center" | Lines up the text around the piece's position. |
| `wrap` | number (px) | 0 | Wrap lines longer than this; 0 never wraps. |

### Tiles

A grid of tiles from a tileset, painted in the scene view. Tiles marked solid are walls and floors that bodies can't pass.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `tileset` | resource | "" | The .tileset file: a picture cut into tiles, with settings such as solid. |
| `solid` | bool | true | Tiles marked solid block bodies. Off makes every tile just decoration. |

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
| `neighbors(column, row, diagonal?)` | The cells around one, as {column, row, tile} (tile -1 when empty): up, right, down, left, or all eight with diagonal. |
| `cellCenter(column, row)` | The scene position of a cell's center. |
| `getTileSize()` | The size of one cell in the scene: width, height. |
| `getBounds()` | The painted area in the scene: x, y, width, height (all 0 when empty). |

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
| `direction` | angle | -90° | Direction particles fly in. |
| `spread` | angle | 28.65° | How far directions vary either side. |
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

## Bodies and zones

### Body

Something solid: it bumps into other bodies and solid tiles. Pick how it moves: still (walls and floors), scripted (players and enemies you move in code) or physics (crates that fall and tumble). Put a Sprite or Shape inside it and its shape fits itself.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `motion` | enum | "scripted" | Still never moves on its own; scripted moves when its script calls move(); physics falls, bounces and gets pushed. |
| `shape` | enum | "auto" | Auto fits the Sprites and Shapes inside it. None uses only its Hitboxes. Physics turns shapes with the Body; scripted Bodies and Zones collide as if unturned. |
| `width` | number (px) | 32 | Rectangle width. |
| `height` | number (px) | 32 | Rectangle height. |
| `radius` | number (px) | 16 | Circle radius. |
| `vx` | number (px/s) | 0 | Speed sideways, used by move() (scripted) or physics. |
| `vy` | number (px/s) | 0 | Speed down, used by move() (scripted) or physics. |
| `slope` | angle | 45° | The steepest surface that still counts as ground. |
| `mass` | number (kg) | 1 | How heavy it is. |
| `friction` | number | 0.3 | How much it grips what it touches. |
| `bounce` | number | 0 | How much it bounces: 0 none, 1 forever. |
| `gravity` | number | 1 | How strongly gravity pulls it; 0 floats. |
| `drag` | number | 0 | Air resistance. |
| `fixedRotation` | bool | false | Never tip over or spin. |
| `passThrough` | tags | "" | Tags of things it doesn't bump into, like "ghost, pickup". |

| Method | |
| --- | --- |
| `move()` | Moves by vx, vy for this step, sliding along walls and floors (scripted bodies). |
| `moveBy(dx, dy)` | Moves by an offset and stops at the first thing in the way; returns what it hit, or nil. |
| `onGround()` | True if the last move ended standing on something. |
| `onWall()` | True if the last move hit a wall. |
| `onCeiling()` | True if the last move hit a ceiling. |
| `touching(tagOrPiece)` | The first body or zone with a tag (or that piece) touching this one, or nil. |
| `touchingTile(setting)` | The settings of a touching tile that has this setting (like "damage"), or nil. |
| `push(ix, iy)` | A sudden kick, like a jump or a hit (physics bodies). |
| `applyForce(fx, fy)` | Pushes steadily this frame (physics bodies). |
| `getSize()` | The size of its shape: width, height. |

| Event (a function in its script) | |
| --- | --- |
| `function hit(other)` | It bumped into another body or solid tiles. |
| `function entered(zone)` | It went into a zone. |
| `function exited(zone)` | It left a zone. |

### Zone

An area that notices bodies and zones going in and out: pickups, checkpoints, danger. Nothing bumps into it.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | Auto fits the Sprites and Shapes inside it. |
| `width` | number (px) | 32 | Rectangle width. |
| `height` | number (px) | 32 | Rectangle height. |
| `radius` | number (px) | 16 | Circle radius. |
| `detects` | tags | "" | Only notices things with one of these tags (empty: everything). |
| `active` | bool | true | Notice things going in and out. |

| Method | |
| --- | --- |
| `inside()` | A list of the bodies and zones inside it now. |
| `touching(tagOrPiece)` | The first body or zone with a tag (or that piece) inside it, or nil. |

| Event (a function in its script) | |
| --- | --- |
| `function entered(other)` | A body or zone came in. |
| `function exited(other)` | A body or zone left. |

### Hitbox

An extra collision shape for the Body or Zone it's inside, for shapes auto can't make: an L shape, a sword's reach.

Extends [Group](#group). Goes inside a Body or Zone.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "rectangle" | Shapes move and scale with their piece. They turn with it only for physics (Bodies moved by physics, and what they land on). |
| `width` | number (px) | 32 | Rectangle width. |
| `height` | number (px) | 32 | Rectangle height. |
| `radius` | number (px) | 16 | Circle radius. |
| `off` | bool | false | Turn this shape off. |

### Joint

Connects two physics bodies: a pin, a rope, a spring or a weld.

Extends [Group](#group). Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "pin" | How the bodies are connected. |
| `a` | piecepath | "" | The first body. |
| `b` | piecepath | "" | The second body (empty: pinned in place). |
| `length` | number (px) | 0 | Rope and spring length; 0 uses the distance when the scene starts. |
| `stiffness` | number | 4 | Spring stiffness (wobbles per second). |
| `damping` | number | 0.5 | How quickly a spring stops wobbling. |

## On-screen UI

### UI

The base of UI pieces: a rectangle on the screen, placed from a corner, an edge or the center.

Extends [Piece](#piece). A base for other types; not added itself.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `anchor` | enum | "topLeft" | What its position is measured from. Fill stretches over the whole screen (or the UI piece it's inside). |
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
| `align` | enum | "left" | Lines up the text inside its rectangle. |
| `valign` | enum | "top" | Lines up the text top to bottom. |
| `outline` | bool | false | A dark outline, so it reads on any background. |

### Button

A button to click or tap. Its script gets pressed().

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Button" | The button's words. |
| `font` | resource | "" | A font, or empty for the default. |
| `size` | int (px) | 18 | Font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | Background color. |
| `textColor` | color | {1, 1, 1, 1} | Text color. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `disabled` | bool | false | Can't be pressed; drawn faded. |
| `autofocus` | bool | false | Has the keyboard focus when the scene starts: arrow keys and the d-pad move between buttons, accept presses. For menus. |

| Method | |
| --- | --- |
| `focus()` | Gives it the keyboard focus (arrow keys and the d-pad then move it between buttons; accept presses). |
| `isFocused()` | True while it has the keyboard focus. |
| `isDown()` | True while it's held down. |

| Event (a function in its script) | |
| --- | --- |
| `function pressed()` | The button was clicked, tapped, or pressed with accept while focused. |

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
| `function pressed()` | The panel was clicked or tapped (not on a button inside it). |

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
| `function pressed()` | The picture was clicked or tapped. |

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
| `play()` | Plays the sound and returns the LÖVE Source playing it. Calling it again while it plays starts another copy (good for effects); a .song has one. |
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
