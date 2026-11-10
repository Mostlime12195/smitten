# Pieces

Each piece has its own properties and the properties of its base type. In the
script of the piece, use the names directly: `x = 10`, `move()`,
`function clicked() end`. For a different piece, use the piece: `other.x`,
`other:move()`, `other:on("clicked", fn)`. Angles are in degrees, in code and
in the Inspector.

## Basic

### Piece

Everything in a scene is a piece. Pieces nest: the children of a piece belong to it.

A base for other piece types. You do not add it to a scene yourself.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `pausable` | bool | true | When this is on, the piece stops while the game is paused. When it is off, this piece and its children keep running (for pause menus). |

| Method | |
| --- | --- |
| `find(path)` | Returns a child by name, or a piece deeper inside by path ("UI/Score"). Returns nil if there is no such piece. |
| `findDeep(name)` | Returns the first piece with this name at any depth inside this piece. |
| `findChildOfType(type)` | Returns the first child of a piece type ("Sprite"), or nil. |
| `isA(type)` | Returns true if the piece is of a piece type, or of a type that extends it. |
| `add(piece)` | Adds a piece as the last child and returns it. |
| `remove()` | Takes the piece out of its parent now, but does not destroy it. |
| `spawn(sceneOrType, properties?)` | Makes a piece from a scene file or a piece type and adds it as a child. |
| `destroy()` | Removes the piece and everything inside it at the end of the frame. |
| `tag(name)` | Adds a tag. |
| `untag(name)` | Removes a tag. |
| `hasTag(name)` | Returns true if the piece has the tag. |
| `hasAnyTag(tags)` | Returns true if the piece has one or more of the tags in a comma-separated list: hasAnyTag("enemy, spikes"). |
| `is(tagOrType)` | Returns true if the piece has the tag or is of the piece type: other:is("enemy"), other:is("Body"). |
| `on(event, fn)` | Calls fn(...) when the piece sends the event. Returns a handle with :off(). |
| `emit(event, ...)` | Sends an event: it calls the script function with that name and every function that on() added. |
| `getPath()` | Returns the path of the piece from the root piece of the scene, for example "Level/Player". |
| `isAlive()` | Returns true while the piece is in the running scene and destroy() has not removed it. |

| Event (a function in its script) | |
| --- | --- |
| `function ready(...)` | The engine calls it when the piece and its children join the scene. The root piece of the scene gets the extra values of go(). |
| `function update(dt)` | The engine calls it every frame. dt is the time since the last frame, in seconds. |
| `function physicsUpdate(dt)` | The engine calls it 60 times per second, before bodies move. Use it for movement. |
| `function draw()` | The engine calls it every frame. Draw extra things on top of the piece here, in the piece's own coordinates. |
| `function removed()` | The engine calls it when the piece leaves the scene. |

### Group

A piece with a position. Use it to hold other pieces (they move with it) or to run a script.

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `x` | number (px) | 0 | The horizontal position, measured from the parent. |
| `y` | number (px) | 0 | The vertical position, measured from the parent. y increases downwards. |
| `rotation` | angle (°) | 0° | The rotation, clockwise, in degrees: 90 is a quarter turn. |
| `scaleX` | number | 1 | Multiplies the width. A negative value mirrors the piece left to right. |
| `scaleY` | number | 1 | Multiplies the height. A negative value mirrors the piece top to bottom. |
| `visible` | bool | true | When this is on, this piece and everything inside it are visible. |
| `tint` | color | {1, 1, 1, 1} | Multiplies the colors of this piece and everything inside it. |
| `layer` | int | 0 | The engine draws higher layers on top. It draws pieces on the same layer in scene order. |
| `lit` | bool | true | When this is on, Lights and the Tint change how this piece and everything inside it look. When it is off, they always have full brightness (glows, lasers, signs). |

| Method | |
| --- | --- |
| `worldPosition()` | Returns the position of the piece in the scene (not measured from its parent): x, y. |
| `setWorldPosition(x, y)` | Moves the piece to a position in the scene. |
| `toWorld(x, y)` | Takes a point measured from this piece and returns it as a point in the scene. |
| `fromWorld(x, y)` | Takes a point in the scene and returns it measured from this piece. |
| `lookAt(x, y)` | Turns the piece to face a point in the scene. |
| `distanceTo(pieceOrX, y?)` | Returns the distance in pixels to another piece or a point. |
| `angleTo(pieceOrX, y?)` | Returns the angle towards another piece or a point, in degrees. rotation = angleTo(target) turns the piece to face it. |
| `moveToward(x, y, distance)` | Moves at most distance pixels towards a point. Returns true when the piece is at the point. |
| `translate(dx, dy)` | Moves the piece by an offset. |

### Timer

Counts down and calls tick() when the countdown reaches zero.

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `seconds` | number (s) | 1 | The time between ticks, in seconds. |
| `running` | bool | false | When this is on, the timer counts down. If it is on in the scene file, the timer starts with the scene. |
| `loop` | bool | true | When this is on, the timer keeps ticking. When it is off, the timer ticks once and stops. |

`timeLeft`: The time until the next tick, in seconds.

| Method | |
| --- | --- |
| `start(seconds?)` | Starts the countdown, or starts it again from the beginning. |
| `stop()` | Stops the countdown. |

| Event (a function in its script) | |
| --- | --- |
| `function tick()` | The engine calls it when the countdown reaches zero. |

### Animator

Changes properties of pieces over time with keyframes, and calls methods at the times you choose. Put it inside the piece that it animates.

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `autoplay` | animation | "" | The animation to play when the scene starts. If it is empty, no animation plays until a script calls play(). |
| `speed` | number | 1 | How fast animations play: 2 is two times as fast, and -1 plays them backwards. |
| `physicsStep` | bool | false | When this is on, the animation moves on with each physics step (60 times per second), not with each frame. Use it to animate Bodies. |

`playing`: True while an animation plays.

`current`: The name of the current animation (playing or paused), or "" if there is none.

`position`: Where the current animation is, in seconds from its start.

| Method | |
| --- | --- |
| `play(name?, restart?)` | Plays an animation, or continues the current animation. With restart, the animation starts again from its start. |
| `pause()` | Stops the animation where it is. play() continues it. |
| `stop()` | Stops the animation and puts the pieces back to the values at its start. |
| `seek(seconds)` | Moves the current animation to a time and gives the pieces the values of that time. |
| `animate(name?, restart?)` | Plays an animation and waits until it ends (in ready(), events and tasks). Returns true if the animation got to its end, false if it stopped before. |
| `hasAnimation(name)` | Returns true if the Animator has an animation with this name. |
| `getLength(name?)` | Returns the length of an animation in seconds (of the current animation if you give no name). |

| Event (a function in its script) | |
| --- | --- |
| `function finished(animation)` | The engine calls it when an animation that does not loop gets to its end. |

## Things you see

### Sprite

Draws an image, or an animation from a .sprite file or a sprite sheet.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | An image (.png, .jpg), or a .sprite file with animation frames and animations. |
| `animation` | animation | "" | The animation to play, from the .sprite file. |
| `playing` | bool | true | When this is on, the animation plays. |
| `speed` | number | 1 | The animation speed: 2 is twice as fast. |
| `frame` | int | 0 | The animation frame that the sprite shows, counting from 0. |
| `columns` | int | 1 | The number of animation frames across, for a sprite sheet without a .sprite file. |
| `rows` | int | 1 | The number of animation frames down, for a sprite sheet without a .sprite file. |
| `centered` | bool | true | When this is on, the center of the image is at the position of the piece. The origin in a .sprite file has priority over this. |
| `flipX` | bool | false | When this is on, the sprite mirrors the image left to right. |
| `flipY` | bool | false | When this is on, the sprite mirrors the image top to bottom. |

| Method | |
| --- | --- |
| `play(name?, restart?)` | Plays an animation, or continues the current one. With restart, it plays from the first animation frame. |
| `pause()` | Stops the animation where it is. play() continues it. |
| `stop()` | Stops the animation and goes back to its first animation frame. |
| `hasAnimation(name)` | Returns true if the .sprite file has an animation with this name. |
| `animations()` | Returns the names of the animations in the .sprite file, sorted. |
| `getSize()` | Returns the width and height of one animation frame, in pixels. |
| `getRect()` | Returns the rectangle that the image covers, in the piece's own coordinates: x, y, width, height. |

| Event (a function in its script) | |
| --- | --- |
| `function finished(animation)` | The engine calls it when an animation that does not loop reaches its last animation frame. |

### Shape

Draws a rectangle, circle, polygon or line. Use it for prototypes, effects and games without art.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "rectangle" | The shape to draw. |
| `width` | number (px) | 64 | The width of the rectangle. |
| `height` | number (px) | 64 | The height of the rectangle. |
| `radius` | number (px) | 32 | The radius of the circle. |
| `cornerRadius` | number (px) | 0 | Rounds the corners of the rectangle. |
| `points` | points | {0, -32, 32, 32, -32, 32} | The corner points x1, y1, x2, y2, ... |
| `color` | color | {0.36, 0.55, 0.95, 1} | The fill color or the line color. |
| `filled` | bool | true | When this is on, the piece fills the shape. When it is off, the piece draws only the outline. |
| `lineWidth` | number (px) | 2 | The thickness of outlines and lines. |
| `centered` | bool | true | When this is on, the center of the rectangle is at the position of the piece. |

| Method | |
| --- | --- |
| `getRect()` | Returns the rectangle that the shape covers, in the piece's own coordinates: x, y, width, height. |

### Text

Shows words in the scene, for example a sign or a damage number. For scores and menus, use Label.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Text" | The text that the piece shows. |
| `font` | resource | "" | A .ttf or .otf font file, "pixel" for the built-in pixel font, or empty for the default font. |
| `size` | int (px) | 16 | The font size. |
| `color` | color | {1, 1, 1, 1} | The text color. |
| `align` | enum | "center" | Aligns the text around the position of the piece. justify stretches wrapped lines to the same width. |
| `wrap` | number (px) | 0 | The text wraps lines that are longer than this. 0 means that lines never wrap. |
| `wrapBy` | enum | "word" | Where the text breaks lines that are too long: between words, or after any character (for languages without spaces, like Japanese). |
| `rich` | bool | false | When this is on, the text reads text tags: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `outline` | bool | false | When this is on, the text has a dark outline. |
| `fontBold` | resource | "" | The font file for [b]bold[/b] words. If it is empty, the engine makes the font thicker. |
| `fontItalic` | resource | "" | The font file for [i]italic[/i] words. If it is empty, the engine slants the font. |
| `lineHeight` | number | 1 | The distance between lines: 1 is the font's own spacing, 1.5 leaves half a line between them. |
| `letterSpacing` | number (px) | 0 | Extra space between letters. A negative value pushes them closer together. |
| `outlineWidth` | number (px) | 0 | The thickness of the outline. 0 keeps it one screen pixel thin. |
| `outlineColor` | color | {0, 0, 0, 0.8} | The color of the outline. |
| `shadow` | bool | false | When this is on, the text has a shadow behind it. |
| `shadowColor` | color | {0, 0, 0, 0.5} | The color of the shadow. |
| `shadowX` | number (px) | 2 | How far right the shadow is. A negative value moves it left. |
| `shadowY` | number (px) | 2 | How far down the shadow is. A negative value moves it up. |
| `visibleCharacters` | int | -1 | The number of characters that show, counting from the start: 0 shows none, -1 shows all. reveal() increases this for a typewriter effect. |
| `visibleRatio` | number | 1 | The part of the text that shows: 0 is none, 0.5 is the first half, 1 is all of it. Tween it to show the text gradually. |

| Method | |
| --- | --- |
| `measure()` | Returns the size of the text in its current layout: width, height. |
| `lineCount()` | Returns the number of lines in the text. |
| `characterCount()` | Returns the number of characters in the text. Text tags and line breaks do not count. |
| `characterRect(index)` | Returns the position and size of a character, measured from the position of the piece: x, y, width, height. Use it to put a cursor or a sparkle on the character. |
| `characterAt(x, y)` | Returns the number of the character at a point (measured from the position of the piece), or nil. |
| `linkAt(x, y)` | Returns the name of the [link=name] at a point (measured from the position of the piece), or nil. |
| `reveal(charactersPerSecond?, from?)` | Shows the text one character at a time, like a typewriter (30 characters per second if you do not give a speed). Returns a handle with cancel(), after(fn) and wait(seconds). [pause=0.5] and [speed=10] in rich text change the speed. |
| `skip()` | Shows all of the text now and stops a reveal(). |

| Event (a function in its script) | |
| --- | --- |
| `function revealed(index, char)` | The engine calls it when reveal() shows one more character. Use it to play a blip, or to wait at a full stop. |
| `function finished()` | The engine calls it when reveal() has shown all of the text. |
| `function eachCharacter(c)` | The engine calls it for every character each time it draws the text. Use it to move or color the character: c.y = math.sin(c.time * 4 + c.index) * 3. You can change x, y, rotation, scale, color, alpha and visible of c. You can read index, count, char, line, time and since. The engine uses the same table c for every character, so do not keep it. |

### Tiles

A grid of tiles from a tileset. Solid tiles block bodies.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `tileset` | resource | "" | The .tileset file: an image cut into tiles, with tile properties such as solid. |
| `solid` | bool | true | When this is on, tiles that the tileset marks as solid block bodies. When it is off, every tile is only decoration. |
| `castShadows` | bool | false | When this is on, tiles that the tileset marks as solid block the Lights that have shadows on. |
| `animate` | bool | true | When this is on, animated tiles play. When it is off, they stop on the animation frame that they show. |

| Method | |
| --- | --- |
| `getTile(column, row)` | Returns the tile number in a cell, or -1 if the cell is empty. |
| `setTile(column, row, tile)` | Changes the tile in a cell (-1 empties the cell). |
| `tileInfo(tile)` | Returns the tile properties of a tile in the tileset (solid, name, ...). |
| `cellAt(x, y)` | Returns the cell under a point in the scene: column, row. |
| `cellPosition(column, row)` | Returns the scene position of the top-left corner of a cell. |
| `cellsWith(tile?)` | Returns a list of {column, row, tile} for every painted cell (or every cell with that tile). |
| `fill(column, row, columns, rows, tile)` | Sets a rectangle of cells to one tile (-1 empties them). |
| `clear()` | Empties every cell. |
| `tileAt(x, y)` | Returns the tile number under a point in the scene, or -1. |
| `isSolid(column, row)` | Returns true if the tileset marks the tile in the cell as solid (and solid is on). |
| `neighbors(column, row, diagonal?)` | Returns the adjacent cells as {column, row, tile}: 4 cells, or 8 with diagonal. |
| `cellCenter(column, row)` | Returns the scene position of the center of a cell. |
| `getTileSize()` | Returns the size of one cell in the scene: width, height. |
| `getBounds()` | Returns the painted area in the scene: x, y, width, height (all 0 if no cell has a tile). |
| `newPathGrid(options?)` | Returns a grid to find paths through these tiles (solid tiles are solid cells): grid:findPoints(x, y, toX, toY). The grid changes when setTile() changes a tile. |
| `setTerrain(column, row, terrain)` | Paints a terrain of the tileset (by name; nil erases) in a cell. It also changes the tiles of the 8 cells around it so that the edges fit. |
| `getTerrain(column, row)` | Returns the name of the terrain of the tile in the cell, or nil. |
| `fillTerrain(column, row, columns, rows, terrain)` | Paints a terrain (nil erases) in a rectangle of cells. It makes the edges fit, also at the cells around the rectangle. |
| `terrains()` | Returns the names of the terrains in the tileset. |

### Background

Scrolls the pieces inside it slower or faster than the camera (parallax), for far hills, clouds and skies. It can repeat them without end.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `scrollX` | number | 0.5 | How much it moves sideways when the camera moves. 1 moves with the scene, 0.5 moves half as much (far away), and 0 stays on the screen. Use more than 1 for things in front. |
| `scrollY` | number | 0.5 | The same as scrollX, but up and down. |
| `repeatWidth` | number (px) | 0 | The pieces inside repeat sideways at this distance, as far as the view goes. 0 draws them once. Use the width of the image. |
| `repeatHeight` | number (px) | 0 | The pieces inside repeat up and down at this distance. 0 draws them once. |
| `driftX` | number (px/s) | 0 | Moves sideways by itself at this speed, like clouds. A negative value moves it left. |
| `driftY` | number (px/s) | 0 | Moves down by itself at this speed. A negative value moves it up. |
| `offsetX` | number (px) | 0 | Moves the pieces inside sideways. Change it from a script to scroll by hand. |
| `offsetY` | number (px) | 0 | Moves the pieces inside up or down. |
| `left` | number (px) | none | While the view is left of this edge, the background stops its own scrolling and moves with the scene. If it is empty, there is no edge. |
| `top` | number (px) | none | While the view is above this edge, the background stops its own scrolling and moves with the scene. |
| `right` | number (px) | none | While the view is right of this edge, the background stops its own scrolling and moves with the scene. |
| `bottom` | number (px) | none | While the view is below this edge, the background stops its own scrolling and moves with the scene. |

| Method | |
| --- | --- |
| `getScroll()` | Returns the current distance between where the engine draws it and where you put it: x, y. |

### Camera

Decides which part of the scene is on the screen. Put it inside the player piece to follow the player.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `active` | bool | true | When this is on, the game uses this camera. If more than one camera is active, the first in the scene has priority. |
| `zoom` | number | 1 | The zoom: 2 shows everything twice as big. |
| `smoothing` | number | 0 | How gently the camera catches up: 0 follows exactly, 5 glides. |
| `target` | piecepath | "" | A piece to follow, anywhere in the scene. If it is empty, the camera stays at its own position. |
| `offsetX` | number (px) | 0 | The camera looks this far to the right of what it follows. |
| `offsetY` | number (px) | 0 | The camera looks this far below what it follows. |
| `left` | number (px) | none | The camera does not show anything to the left of this edge. If it is empty, there is no edge. |
| `top` | number (px) | none | The camera does not show anything above this edge. |
| `right` | number (px) | none | The camera does not show anything to the right of this edge. |
| `bottom` | number (px) | none | The camera does not show anything below this edge. |

| Method | |
| --- | --- |
| `shake(strength?, seconds?)` | Shakes the view: shake(6, 0.3). |
| `follow(piece)` | Follows a piece. With nil, the camera goes back to target, or to its own position. |
| `snap()` | Moves directly to what it follows, without smoothing (for example, after a teleport). |
| `setLimits(left, top, right, bottom)` | Sets the edges that the camera does not show past (nil for no edge). |
| `limitTo(piece)` | Keeps the view inside the painted part of a Tiles piece. |
| `makeCurrent()` | Makes this the camera in use and turns the other cameras off. |
| `getView()` | Returns the part of the scene that is on the screen: x, y, width, height. |
| `screenToWorld(sx, sy)` | Takes a point on the screen and returns it as a point in the scene. |
| `worldToScreen(x, y)` | Takes a point in the scene and returns it as a point on the screen. |

### Particles

Sprays particles: smoke, sparks, dust, rain, explosions.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `emitting` | bool | true | When this is on, the piece makes new particles. |
| `rate` | number (/s) | 30 | The number of particles per second. |
| `burst` | bool | false | When this is on, the piece makes one burst of rate particles and then stops. |
| `lifetime` | number (s) | 1 | How long each particle lives, in seconds. |
| `image` | resource | "" | The image of each particle. If it is empty, the piece draws soft dots. |
| `speed` | number (px/s) | 100 | The starting speed of each particle. |
| `speedRandom` | number | 0.5 | How much the speed changes from particle to particle (0 to 1). |
| `direction` | angle (°) | -90° | The direction in which particles move, in degrees: 0 is right, 90 is down, -90 is up. |
| `spread` | angle (°) | 30° | How much the direction changes to each side, in degrees. |
| `gravityX` | number (px/s²) | 0 | A constant pull sideways. |
| `gravityY` | number (px/s²) | 0 | A constant pull down. |
| `sizeStart` | number (px) | 8 | The size of a particle when it starts. |
| `sizeEnd` | number (px) | 2 | The size of a particle when it fades out. |
| `colorStart` | color | {1, 0.85, 0.4, 1} | The color of a particle when it starts. |
| `colorEnd` | color | {1, 0.3, 0.1, 0} | The color of a particle when it fades out. |
| `followPiece` | bool | false | When this is on, particles move with the piece. When it is off, they stay where they started. |

| Method | |
| --- | --- |
| `emit(count)` | Makes count particles now. emit("event", ...) still sends an event. |
| `start()` | Starts to make particles (a burst makes its particles again). |
| `stop()` | Stops making particles. The particles that are already out stay until their lifetime ends. |
| `clear()` | Removes every particle now. |
| `restart()` | Removes every particle and starts again. |
| `getCount()` | Returns the number of particles that are out now. |

| Event (a function in its script) | |
| --- | --- |
| `function finished()` | The engine calls it when the last particle is gone and no more particles will come (after a burst or stop()). Use it to destroy() the piece. |

## Light and shadow

### Light

Shines on the pieces around it. With a dark Tint in the scene, it is a torch at night. Without a Tint, it makes things brighter.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "point" | point shines out from the position of the piece, as far as radius. sun lights the whole view from one side, in the direction that the piece points. |
| `radius` | number (px) | 200 | How far the light goes. |
| `brightness` | number | 1 | How strong the light is: 0 is dark, 2 is twice as bright. |
| `color` | color | {1, 1, 1, 1} | The color of the light. |
| `image` | resource | "" | An image of the shape of the light, white where it shines: a beam, a window. If it is empty, the light is a soft round glow. |
| `blend` | enum | "add" | add makes the pieces that it shines on brighter. subtract makes them darker (a dark patch). mix replaces the light that is there with the color of this light. |
| `off` | bool | false | When this is on, the light is off. |
| `lights` | tags | "" | The light shines only on pieces with one of these tags, and on what is inside them. If it is empty, it shines on every piece. |
| `fromLayer` | number | none | The light shines only on pieces on this layer and higher. If it is empty, there is no limit. |
| `toLayer` | number | none | The light shines only on pieces on this layer and lower. If it is empty, there is no limit. |
| `shadows` | bool | false | When this is on, Occluders, and Tiles with castShadows on, block this light. |
| `shadowColor` | color | {0, 0, 0, 1} | The part of the light that stays in a shadow: black is none. A transparent color makes weaker shadows. |
| `shadowSoftness` | number (px) | 0 | Blurs the edges of the shadows by this distance. 0 keeps them sharp and is the fastest. |
| `shadowLength` | number (px) | 0 | The length of the shadows of a sun. 0 makes shadows that never end. |
| `shadowsFrom` | tags | "" | Only Occluders and Tiles with one of these tags block the light. If it is empty, all of them block it. The tag can be on the piece that holds the Occluder. |

### Occluder

Blocks light: Lights with shadows on make a shadow behind it. Put it inside a piece to fit the Sprite or Shape of that piece.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside it. If it has none, it fits the ones in the piece that it is inside. |
| `width` | number (px) | 32 | The width of the rectangle. |
| `height` | number (px) | 32 | The height of the rectangle. |
| `radius` | number (px) | 16 | The radius of the circle. |
| `points` | points | {0, -16, 16, 16, -16, 16} | The corner points x1, y1, x2, y2, ... of the outline. |
| `off` | bool | false | When this is on, light goes through it. |

### Tint

Colors the whole scene, but not the on-screen UI: dark blue for night, orange for sunset. Lights shine on top of it. If there is more than one Tint, the first in the scene has priority.

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.35, 0.4, 0.6, 1} | The engine multiplies the colors of every piece by this color. White changes nothing. Black hides everything that no light reaches. |
| `off` | bool | false | When this is on, the tint is off. |
| `fromLayer` | number | none | The Tint colors only pieces on this layer and higher. If it is empty, there is no limit. |
| `toLayer` | number | none | The Tint colors only pieces on this layer and lower. If it is empty, there is no limit. |

## Bodies and zones

### Body

A solid piece. Its motion is still (walls), scripted (move() moves it) or physics (the physics engine moves it). It takes its shape from a Sprite or Shape inside it.

Extends [Group](#group). Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `motion` | enum | "scripted" | still: it moves only when a script sets x or y. scripted: move() moves it. physics: the physics engine moves it. |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside it. capsule has round ends. none means that only Hitboxes give it a shape. |
| `width` | number (px) | 32 | The width of the rectangle or capsule. |
| `height` | number (px) | 32 | The height of the rectangle or capsule. |
| `radius` | number (px) | 16 | The radius of the circle. |
| `points` | points | {0, -16, 16, 16, -16, 16} | The corner points x1, y1, x2, y2, ... (8 corners at most; the engine fills in dents). |
| `vx` | number (px/s) | 0 | The horizontal speed, in pixels per second. |
| `vy` | number (px/s) | 0 | The speed down (a negative value is up). For scripted motion, move() uses it. For physics motion, it is the current speed. |
| `spin` | angle (°/s) | 0° | How fast it turns, in degrees per second (clockwise is positive): 360 is a full turn every second. For scripted motion, move() turns it at this speed. |
| `slope` | angle (°) | 45° | The steepest surface that is still ground, in degrees. move() walks up it and does not slide back. |
| `mass` | number (kg) | 1 | The mass, in kilograms. A scripted body pushes physics bodies by its mass against their mass. |
| `friction` | number | 0.3 | How much it grips what it touches: 0 is ice. |
| `bounce` | number | 0 | How much it bounces: 0 is no bounce, 1 bounces forever. |
| `gravityScale` | number | 1 | How strongly gravity pulls it: 1 is normal, 0 floats, -1 falls up. |
| `drag` | number | 0 | Air resistance: it slows the movement down. |
| `spinDrag` | number | 0 | Slows the turning down. |
| `fixedRotation` | bool | false | When this is on, the body never tips over or turns. |
| `bullet` | bool | false | When this is on, the physics engine checks collisions continuously against moving bodies. Use it for small, fast bodies. |
| `asleep` | bool | false | When this is on, the body stays at rest until something touches it. Physics bodies go to sleep when they stop. |
| `passThrough` | tags | "" | The tags of things that it does not bump into, for example "ghost, pickup" ("tiles" for solid tiles). |

| Method | |
| --- | --- |
| `move()` | Moves by vx, vy for this physics step. It slides along walls, climbs slopes, rides on platforms and pushes physics bodies. |
| `moveBy(dx, dy)` | Moves by an offset and stops at the first thing in the way. Returns what it hit, or nil. |
| `onGround()` | Returns true if the last move ended on top of something. |
| `onWall()` | Returns true if the last move ran into a wall. |
| `onCeiling()` | Returns true if the last move ran into a ceiling. |
| `applyImpulse(ix, iy, x?, y?)` | Changes the speed immediately by impulse / mass. At a point, it also makes the body spin. |
| `applyForce(fx, fy, x?, y?)` | Pushes with a force for this physics step, at the center or at a point. Call it in every physicsUpdate. |
| `applyTorque(torque)` | Turns a physics body steadily for this physics step. |
| `applyAngularImpulse(impulse)` | Gives a physics body a sudden twist. |
| `push(ix, iy)` | Does the same as applyImpulse(ix, iy). |
| `wake()` | Wakes up a physics body that sleeps. |
| `grab(x, y, strength?)` | Holds the body at a point in the scene for dragTo(). drop() lets it go with its momentum. |
| `dragTo(x, y)` | Moves the point that grab() holds towards x, y. |
| `drop()` | Lets go after grab(). A physics body keeps its speed. |
| `touching(tagOrPiece)` | Returns the first body or zone with a tag (or that piece) that touches this one, or nil. |
| `isTouching(other)` | Returns true if it touches a piece (a body, zone or Tiles) or anything with a tag. |
| `contacts()` | Returns the current contacts: {piece, x, y, nx, ny, impulse}. |
| `touchingTile(setting)` | Returns the tile properties of a touching tile that has this tile property (for example "damage"), or nil. |
| `getSize()` | Returns the size of the box around its shapes: width, height. |

| Event (a function in its script) | |
| --- | --- |
| `function hit(other, contact)` | The engine calls it when the body starts to touch a body or solid tiles. contact has x, y, nx, ny (from other to this body) and impulse. |
| `function entered(zone)` | The engine calls it when the body goes into a zone. |
| `function exited(zone)` | The engine calls it when the body leaves a zone. |

### Zone

An area that detects bodies and zones that go in and out. It does not block them, and it ignores still bodies. When forces is on, it changes the gravity, drag and push of physics bodies inside it.

Extends [Group](#group). Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "auto" | auto fits the Sprites and Shapes inside it. The shapes turn and scale with the Zone. |
| `width` | number (px) | 32 | The width of the rectangle or capsule. |
| `height` | number (px) | 32 | The height of the rectangle or capsule. |
| `radius` | number (px) | 16 | The radius of the circle. |
| `points` | points | {0, -16, 16, 16, -16, 16} | The corner points x1, y1, x2, y2, ... (8 corners at most). |
| `detects` | tags | "" | The Zone notices only things with one of these tags. If it is empty, it notices everything. |
| `active` | bool | true | When this is on, the Zone notices things that go in and out. |
| `forces` | bool | false | When this is on, the Zone changes how physics bodies move inside it: gravity, drag and a steady push. |
| `gravity` | enum | "scene" | scene: bodies feel only the scene's gravity. add: the Zone's gravity adds to the scene's gravity. replace: bodies feel the Zone's gravity instead. |
| `toCenter` | bool | false | When this is on, the Zone pulls towards its position, like a planet, and not in one direction. |
| `gravityX` | number (px/s²) | 0 | The Zone's gravity, to the right (negative is to the left). |
| `gravityY` | number (px/s²) | 0 | The Zone's gravity, down (negative is up). With replace, 0 and 0 make bodies float. |
| `gravityStrength` | number (px/s²) | 980 | How hard the Zone pulls towards its position. The pull is the same everywhere in the Zone. |
| `drag` | number | 0 | Slows down the movement of bodies inside, like water or thick air. It adds to their own drag. |
| `spinDrag` | number | 0 | Slows down the turning of bodies inside. |
| `pushX` | number | 0 | A steady push to the right on each body inside, for wind, currents and conveyor belts. A heavy body speeds up less. |
| `pushY` | number | 0 | A steady push down on each body inside (negative is up). |

| Method | |
| --- | --- |
| `inside()` | Returns a list of the bodies and zones that are inside it now. |
| `touching(tagOrPiece)` | Returns the first body or zone with a tag (or that piece) that is inside it, or nil. |
| `isTouching(other)` | Returns true if a piece (or anything with a tag) is inside it. |

| Event (a function in its script) | |
| --- | --- |
| `function entered(other)` | The engine calls it when a body or zone comes in. |
| `function exited(other)` | The engine calls it when a body or zone leaves. |

### Hitbox

An extra collision shape for the Body or Zone that it is inside.

Extends [Group](#group). Put it inside a Body or Zone.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "rectangle" | The shape. The position and rotation of the Hitbox put it in place and turn it. |
| `width` | number (px) | 32 | The width of the rectangle or capsule. |
| `height` | number (px) | 32 | The height of the rectangle or capsule. |
| `radius` | number (px) | 16 | The radius of the circle. |
| `points` | points | {0, -16, 16, 16, -16, 16} | The corner points x1, y1, x2, y2, ... (8 corners at most). |
| `off` | bool | false | When this is on, this shape is off. |

### Joint

Connects body a to body b, or to the position of the Joint.

Extends [Group](#group). Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "pin" | pin, weld, rope, spring, distance, slider (on the x axis), wheel (a spring on the y axis) or mouse. |
| `a` | piecepath | "" | The body that the joint holds. |
| `b` | piecepath | "" | The body that the joint connects a to. If it is empty, the joint connects a to the position of the Joint. |
| `length` | number (px) | 0 | The distance between the bodies. 0 uses the distance at the time when the engine makes the joint. |
| `spring` | bool | false | When this is on, the joint is springy: a pin or slider pulls back to where it started, and a weld wobbles. |
| `stiffness` | number (Hz) | 4 | How stiff the spring is, in wobbles per second. |
| `damping` | number | 0.5 | How fast the spring stops wobbling: 1 does not overshoot. |
| `motor` | bool | false | When this is on, the joint drives the bodies: it turns a pin or wheel, or moves a slider, at motorSpeed. |
| `motorSpeed` | number | 90 | The speed of the motor, in degrees per second (pin, wheel) or pixels per second (slider, distance). |
| `motorStrength` | number | 100000 | The maximum torque (pin, wheel) or force (slider, distance) that the motor uses. |
| `limit` | bool | false | When this is on, a pin stays between minAngle and maxAngle, and a slider or wheel stays between lower and upper. |
| `minAngle` | angle (°) | -45° | The maximum angle that a pin turns anticlockwise, in degrees. |
| `maxAngle` | angle (°) | 45° | The maximum angle that a pin turns clockwise, in degrees. |
| `lower` | number (px) | -50 | The maximum distance that a slider or wheel moves back. |
| `upper` | number (px) | 50 | The maximum distance that a slider or wheel moves forward. |
| `strength` | number | 0 | The maximum force of the pull of a mouse joint. 0 gives enough force for the mass of the body. |
| `collide` | bool | false | When this is on, the two bodies still bump into each other. |
| `breakForce` | number | 0 | The joint breaks (and sends broke) when a pull is stronger than this. 0 means that it never breaks. |

| Method | |
| --- | --- |
| `getAngle()` | Returns how far a pin has turned, in degrees. |
| `getTranslation()` | Returns how far a slider has moved, in pixels. |
| `getLength()` | Returns the distance between the ends of a rope, spring or distance joint. |
| `getSpeed()` | Returns how fast a pin turns (degrees per second) or a slider moves (pixels per second). |
| `getForce()` | Returns how hard the joint pulls now. |
| `getTorque()` | Returns how hard the joint twists now. |
| `isBroken()` | Returns true after breakForce has broken the joint. |

| Event (a function in its script) | |
| --- | --- |
| `function broke()` | The engine calls it when a pull is stronger than breakForce and the joint lets go. |

### Walkable

A polygon that shows where things can walk. smitten.paths.findPath() finds a way through all the Walkable pieces in the scene.

Extends [Group](#group).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `points` | points | {-100, -60, 100, -60, 100, 60, -100, 60} | The corner points x1, y1, x2, y2, ... in order around the shape. It can have any number of corners, and dents are OK. |
| `hole` | bool | false | When this is on, the shape does not add to the walkable areas below it. It cuts a hole in them: a pillar, a pond, a table. |
| `active` | bool | true | When this is on, paths use it. Turn it off to close an area (or fill a hole) for a time. |

## On-screen UI

### UI

The base of UI pieces: a rectangle on the screen, with its position measured from a corner, an edge or the center.

Extends [Piece](#piece). A base for other piece types. You do not add it to a scene yourself.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `anchor` | enum | "topLeft" | The point from which the piece measures x and y. fill covers the screen or the parent UI piece. Inside a Row, Column, Grid or Scroll, that piece decides the position. |
| `x` | number (px) | 0 | The distance in from the anchor. |
| `y` | number (px) | 0 | The distance in from the anchor. |
| `width` | number (px) | 160 | The width. It has no effect when anchor is fill. |
| `height` | number (px) | 40 | The height. It has no effect when anchor is fill. |
| `grow` | number | 0 | Inside a Row or Column, the part of the remaining space that this piece gets. Two pieces with 1 get half each. 0 keeps its own size. |
| `visible` | bool | true | When this is on, this piece and everything inside it are visible. |
| `opacity` | number | 1 | 0 is invisible, 1 is fully visible. |

| Method | |
| --- | --- |
| `getRect()` | Returns the current position and size on the screen: x, y, width, height. |
| `isHovered()` | Returns true while the mouse pointer is over it. |

| Event (a function in its script) | |
| --- | --- |
| `function hovered()` | The engine calls it when the mouse pointer comes over it (not for Labels). |
| `function unhovered()` | The engine calls it when the mouse pointer leaves it. |

### Label

Shows words on the screen: scores, timers, titles, speech.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Label" | The text that the piece shows. Change it from a script: text = `Score: {score}`. |
| `font` | resource | "" | A .ttf or .otf font file, "pixel" for the built-in pixel font, or empty for the default font. |
| `size` | int (px) | 20 | The font size. |
| `color` | color | {1, 1, 1, 1} | The text color. |
| `align` | enum | "left" | Aligns the text inside its rectangle. justify stretches wrapped lines to the same width. |
| `valign` | enum | "top" | Aligns the text vertically inside its rectangle. |
| `wrapBy` | enum | "word" | Where the text breaks lines that are too long for the rectangle: between words, after any character (for languages without spaces, like Japanese), or never. |
| `fit` | enum | "none" | shrink makes the text smaller until it fits inside the rectangle. |
| `rich` | bool | false | When this is on, the text reads text tags: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `outline` | bool | false | When this is on, the text has a dark outline. |
| `fontBold` | resource | "" | The font file for [b]bold[/b] words. If it is empty, the engine makes the font thicker. |
| `fontItalic` | resource | "" | The font file for [i]italic[/i] words. If it is empty, the engine slants the font. |
| `lineHeight` | number | 1 | The distance between lines: 1 is the font's own spacing, 1.5 leaves half a line between them. |
| `letterSpacing` | number (px) | 0 | Extra space between letters. A negative value pushes them closer together. |
| `outlineWidth` | number (px) | 0 | The thickness of the outline. 0 keeps it one screen pixel thin. |
| `outlineColor` | color | {0, 0, 0, 0.8} | The color of the outline. |
| `shadow` | bool | false | When this is on, the text has a shadow behind it. |
| `shadowColor` | color | {0, 0, 0, 0.5} | The color of the shadow. |
| `shadowX` | number (px) | 2 | How far right the shadow is. A negative value moves it left. |
| `shadowY` | number (px) | 2 | How far down the shadow is. A negative value moves it up. |
| `visibleCharacters` | int | -1 | The number of characters that show, counting from the start: 0 shows none, -1 shows all. reveal() increases this for a typewriter effect. |
| `visibleRatio` | number | 1 | The part of the text that shows: 0 is none, 0.5 is the first half, 1 is all of it. Tween it to show the text gradually. |

| Method | |
| --- | --- |
| `measure()` | Returns the size of the text in its current layout: width, height. |
| `lineCount()` | Returns the number of lines in the text. |
| `characterCount()` | Returns the number of characters in the text. Text tags and line breaks do not count. |
| `characterRect(index)` | Returns the position and size of a character, measured from the top-left corner of the Label: x, y, width, height. Use it to put a cursor or a sparkle on the character. |
| `characterAt(x, y)` | Returns the number of the character at a point (measured from the top-left corner of the Label), or nil. |
| `linkAt(x, y)` | Returns the name of the [link=name] at a point (measured from the top-left corner of the Label), or nil. |
| `reveal(charactersPerSecond?, from?)` | Shows the text one character at a time, like a typewriter (30 characters per second if you do not give a speed). Returns a handle with cancel(), after(fn) and wait(seconds). [pause=0.5] and [speed=10] in rich text change the speed. |
| `skip()` | Shows all of the text now and stops a reveal(). |

| Event (a function in its script) | |
| --- | --- |
| `function revealed(index, char)` | The engine calls it when reveal() shows one more character. Use it to play a blip, or to wait at a full stop. |
| `function finished()` | The engine calls it when reveal() has shown all of the text. |
| `function eachCharacter(c)` | The engine calls it for every character each time it draws the text. Use it to move or color the character: c.y = math.sin(c.time * 4 + c.index) * 3. You can change x, y, rotation, scale, color, alpha and visible of c. You can read index, count, char, line, time and since. The engine uses the same table c for every character, so do not keep it. |
| `function linkPressed(name)` | The engine calls it when the player clicks or taps a [link=name] in the text. |

### Button

A button to click or tap. The engine calls clicked() in its script.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Button" | The words on the button. |
| `font` | resource | "" | A font, or empty for the default font. |
| `size` | int (px) | 18 | The font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | The background color. |
| `textColor` | color | {1, 1, 1, 1} | The text color. |
| `rich` | bool | false | When this is on, the text reads text tags: [b]bold[/b], [color=red]red[/color], [wave]wavy[/wave] and more (see the Text page of the docs). Type [[ for a real square bracket. |
| `fit` | enum | "none" | shrink makes the words smaller until they fit inside the button. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `disabled` | bool | false | When this is on, the player cannot press the button, and it looks faded. |
| `autofocus` | bool | false | When this is on, the button has keyboard focus when the scene starts. |
| `skin` | resource | "" | An image to draw instead of the colored box. Its corners keep their size and its middle stretches. It is lighter under the mouse pointer and darker while the player holds it down, unless skinHover and skinDown give other images. |
| `skinHover` | resource | "" | The image while the mouse pointer is over the button or the button has keyboard focus. If it is empty, the button uses the skin, a little lighter. |
| `skinDown` | resource | "" | The image while the player holds the button down. If it is empty, the button uses the skin, a little darker. |
| `skinEdges` | string | "8" | The number of pixels at the edges of the image that keep their size while the middle stretches. Give one number for all four edges, or four: left, top, right, bottom. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus. |
| `isFocused()` | Returns true while it has keyboard focus. |
| `isDown()` | Returns true while the player holds it down. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The engine calls it when the player clicks or taps the button, or presses the accept action while the button has keyboard focus. |

### Panel

A colored box behind other UI: a dialog box, the background of a HUD.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.08, 0.09, 0.12, 0.85} | The fill color. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |
| `borderColor` | color | {1, 1, 1, 0.15} | The color of the outline. |
| `borderWidth` | number (px) | 1 | The thickness of the outline. 0 means no outline. |
| `skin` | resource | "" | An image to draw instead of the colored box. Its corners keep their size and its middle stretches, so one small image makes a panel of any size. |
| `skinEdges` | string | "8" | The number of pixels at the edges of the image that keep their size while the middle stretches. Give one number for all four edges, or four: left, top, right, bottom. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The engine calls it when the player clicks or taps the panel (but not a button inside it). |

### Picture

An image on the screen: an icon, a portrait, a logo.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | The image. |
| `fit` | enum | "contain" | How the image fills the rectangle. |
| `color` | color | {1, 1, 1, 1} | The tint of the image. |

| Event (a function in its script) | |
| --- | --- |
| `function clicked()` | The engine calls it when the player clicks or taps the Picture. |

### Bar

A bar that fills up: health, loading, a countdown.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `value` | number | 50 | How full it is, between min and max. |
| `min` | number | 0 | The value when the bar is empty. |
| `max` | number | 100 | The value when the bar is full. |
| `color` | color | {0.3, 0.8, 0.45, 1} | The fill color. |
| `background` | color | {0, 0, 0, 0.45} | The color of the empty part. |
| `cornerRadius` | number (px) | 4 | Rounds the corners. |
| `showValue` | bool | false | When this is on, the bar shows the value as text. |

### TouchStick

A stick for a thumb on a touch screen. It presses input actions as a gamepad stick does, so axis("left", "right") reads it with no extra code.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `leftAction` | action | "left" | The action that it presses when the thumb moves left. With none, it presses nothing in that direction. |
| `rightAction` | action | "right" | The action that it presses when the thumb moves right. |
| `upAction` | action | "up" | The action that it presses when the thumb moves up. |
| `downAction` | action | "down" | The action that it presses when the thumb moves down. |
| `player` | int | 0 | The player whose actions it presses: 2 for player 2. 0 uses the player of the piece that it is inside, or player 1. |
| `mode` | enum | "fixed" | fixed stays in the middle of its rectangle. floating comes to where the thumb touches, anywhere in the rectangle. follow does the same, and moves with the thumb when the thumb goes past the radius. |
| `radius` | number (px) | 60 | How far the thumb moves for a full push. It is also the size of the circle of the stick. |
| `deadzone` | number | 0.2 | The part of the radius near the middle that does not count as a push (0.2 is a fifth). |
| `show` | enum | "touch" | touch shows it on phones and tablets, and on any screen after a finger touches it. always shows it everywhere, and the mouse can use it. never keeps it invisible, but fingers can still use it. |
| `color` | color | {1, 1, 1, 0.25} | The color of the circle of the stick (or a tint for its image). |
| `knobColor` | color | {1, 1, 1, 0.6} | The color of the knob under the thumb (or a tint for its image). |
| `image` | resource | "" | An image for the circle of the stick, instead of the drawn circle. |
| `knobImage` | resource | "" | An image for the knob, instead of the drawn knob. |

| Method | |
| --- | --- |
| `getValue()` | Returns the direction and size of the push: x, y from -1 to 1 (0, 0 when no finger is on the stick). |
| `isActive()` | Returns true while a finger is on the stick. |

| Event (a function in its script) | |
| --- | --- |
| `function touched()` | The engine calls it when a finger touches the stick. |
| `function untouched()` | The engine calls it when the finger lets go of the stick. |

### TouchButton

A button for a finger on a touch screen. It holds an input action down while a finger holds it, so pressed("jump") reads it with no extra code.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `action` | action | "jump" | The action that it holds down while a finger is on it. With none, it only tells its script, with touched() and untouched(). |
| `player` | int | 0 | The player whose action it presses: 2 for player 2. 0 uses the player of the piece that it is inside, or player 1. |
| `shape` | enum | "circle" | circle is the largest circle that fits in its rectangle. rectangle is the whole rectangle. |
| `text` | text | "" | Words or a letter on the button. |
| `image` | resource | "" | An image on the button: an arrow, a sword. |
| `show` | enum | "touch" | touch shows it on phones and tablets, and on any screen after a finger touches it. always shows it everywhere, and the mouse can press it. never keeps it invisible, but fingers can still press it. |
| `color` | color | {1, 1, 1, 0.3} | The color of the button. The color is stronger while a finger holds the button. |
| `textColor` | color | {1, 1, 1, 0.9} | The color of its words. |
| `font` | resource | "" | A font, or empty for the default font. |
| `size` | int (px) | 20 | The font size. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |

| Method | |
| --- | --- |
| `isDown()` | Returns true while a finger holds it down. |

| Event (a function in its script) | |
| --- | --- |
| `function touched()` | The engine calls it when a finger presses the button (or slides onto it). |
| `function untouched()` | The engine calls it when the finger lets go or slides off. |

### TextInput

A box to type in: a name, a chat line, a number. The player clicks or taps it and types. On phones, the on-screen keyboard opens.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 200 | The width. It has no effect when anchor is fill. |
| `height` | number (px) | 36 | The height. It has no effect when anchor is fill. |
| `text` | text | "" | The text in the box. Read it from a script, or set it. |
| `placeholder` | string | "" | Pale words that show while the box is empty: "Your name". |
| `multiline` | bool | false | When this is on, the box has more than one line: Enter starts a new line, and long lines wrap. |
| `maxLength` | int | 0 | The maximum number of characters that it accepts. 0 means no limit. |
| `secret` | bool | false | When this is on, the box shows dots instead of the characters, for passwords. |
| `allow` | enum | "anything" | What the player can type. numbers: digits, a minus sign at the start and one decimal point. letters: letters and digits, but no spaces or symbols. only: the characters that you list. |
| `allowCharacters` | string | "" | The characters that the player can type, for example abcdef0123456789. |
| `disabled` | bool | false | When this is on, the player cannot type in it, and it looks faded. |
| `autofocus` | bool | false | When this is on, the box has keyboard focus when the scene starts. |
| `font` | resource | "" | A .ttf or .otf font file, "pixel" for the built-in pixel font, or empty for the default font. |
| `size` | int (px) | 18 | The font size. |
| `color` | color | {1, 1, 1, 1} | The text color (also the color of the blinking text cursor). |
| `placeholderColor` | color | {1, 1, 1, 0.4} | The color of the placeholder. |
| `background` | color | {0.05, 0.06, 0.09, 0.9} | The color of the box. |
| `borderColor` | color | {1, 1, 1, 0.3} | The color of the outline. While the box has keyboard focus, the outline has the selection color. |
| `selectionColor` | color | {0.25, 0.47, 0.95, 1} | The color behind selected text. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `skin` | resource | "" | An image to draw instead of the colored box. Its corners keep their size and its middle stretches. |
| `skinEdges` | string | "8" | The number of pixels at the edges of the image that keep their size while the middle stretches. Give one number for all four edges, or four: left, top, right, bottom. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus, as a click does, so the player can type in it. |
| `blur()` | Takes keyboard focus away from it, so typing in it stops. |
| `isFocused()` | Returns true while it has keyboard focus. |
| `selectAll()` | Selects all of its text, so the next typing replaces it. |

| Event (a function in its script) | |
| --- | --- |
| `function changed(text)` | The engine calls it when the player changes the text by typing, deleting or pasting (not when a script sets the text). |
| `function submitted(text)` | The engine calls it when the player presses Enter (in a multiline box: Ctrl+Enter). |
| `function focused()` | The engine calls it when the box gets keyboard focus. |
| `function blurred()` | The engine calls it when the box loses keyboard focus: the focus goes to something else, or the player presses Escape. |

### Slider

A knob that the player drags along a track to choose a number: volume, brightness, speed.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `height` | number (px) | 24 | The height. It has no effect when anchor is fill. |
| `value` | number | 50 | The current number, between min and max. |
| `min` | number | 0 | The value at the left end (at the bottom end, if vertical is on). |
| `max` | number | 100 | The value at the right end (at the top end, if vertical is on). |
| `step` | number | 0 | The value changes in steps of this size: 1 for whole numbers, 10 for tens. 0 changes it smoothly. |
| `vertical` | bool | false | When this is on, the slider goes from bottom to top, not from left to right. |
| `disabled` | bool | false | When this is on, the player cannot move it, and it looks faded. |
| `autofocus` | bool | false | When this is on, the slider has keyboard focus when the scene starts. |
| `color` | color | {0.25, 0.47, 0.95, 1} | The color of the filled part of the track. |
| `background` | color | {0, 0, 0, 0.45} | The color of the remaining part of the track. |
| `knobColor` | color | {1, 1, 1, 1} | The color of the knob (or a tint for its image). |
| `skin` | resource | "" | An image for the track, instead of the drawn track. Its ends keep their size and its middle stretches. |
| `skinEdges` | string | "8" | The number of pixels at the edges of the image that keep their size while the middle stretches. Give one number for all four edges, or four: left, top, right, bottom. |
| `knobImage` | resource | "" | An image for the knob, instead of the drawn knob. |

| Method | |
| --- | --- |
| `focus()` | Gives it keyboard focus. Then the arrow keys or a stick move it. |
| `isFocused()` | Returns true while it has keyboard focus. |

| Event (a function in its script) | |
| --- | --- |
| `function changed(value)` | The engine calls it when the player moves the slider (not when a script sets value). |

### Checkbox

A box to tick, or a switch to turn on and off, with words next to it. If more than one checkbox has the same group, only one of them can be on: a choice.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `height` | number (px) | 28 | The height. It has no effect when anchor is fill. |
| `checked` | bool | false | When this is on, the box has a tick (or the switch is on). |
| `text` | text | "Checkbox" | The words next to it. |
| `look` | enum | "box" | box is a square with a tick. switch slides left and right. In a group, the engine draws a box as a circle. |
| `group` | string | "" | Checkboxes inside the same piece with the same group name are a choice: when one gets a tick, the others lose theirs. If it is empty, the checkbox is alone. |
| `disabled` | bool | false | When this is on, the player cannot change it, and it looks faded. |
| `autofocus` | bool | false | When this is on, the checkbox has keyboard focus when the scene starts. |
| `font` | resource | "" | A font, or empty for the default font. |
| `size` | int (px) | 18 | The font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | The color of the box when it has a tick. |
| `background` | color | {0, 0, 0, 0.45} | The color of the box when it has no tick. |
| `textColor` | color | {1, 1, 1, 1} | The color of the words and the tick. |
| `skin` | resource | "" | An image for the box when it has no tick, instead of the drawn box. |
| `skinChecked` | resource | "" | An image for the box when it has a tick. |

| Method | |
| --- | --- |
| `toggle()` | Adds or removes the tick, as a click does (the engine calls toggled()). |
| `focus()` | Gives it keyboard focus. Then the accept action adds or removes the tick. |
| `isFocused()` | Returns true while it has keyboard focus. |

| Event (a function in its script) | |
| --- | --- |
| `function toggled(checked)` | The engine calls it when the tick goes on or off. The cause can be the player, toggle(), or a tick on another checkbox in its group. |

### Row

Puts the UI pieces inside it in a line from left to right, so you do not have to place each one by hand.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | The width. 0 fits the pieces inside it. |
| `height` | number (px) | 0 | The height. 0 fits the pieces inside it. |
| `gap` | number (px) | 8 | The space between one piece and the next. |
| `padding` | number (px) | 0 | The space between its edges and the pieces inside. |
| `alignItems` | enum | "center" | From top to bottom: start puts the pieces at the top, end at the bottom, and stretch makes them all as tall as the Row. |
| `justify` | enum | "start" | Where the pieces go when the Row is wider than they are: start (left), end (right) or spaceBetween (spread from edge to edge). |

### Column

Puts the UI pieces inside it from top to bottom: a menu, a list of choices.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | The width. 0 fits the pieces inside it. |
| `height` | number (px) | 0 | The height. 0 fits the pieces inside it. |
| `gap` | number (px) | 8 | The space between one piece and the next. |
| `padding` | number (px) | 0 | The space between its edges and the pieces inside. |
| `alignItems` | enum | "stretch" | From left to right: start puts the pieces at the left, end at the right, and stretch makes them all as wide as the Column. |
| `justify` | enum | "start" | Where the pieces go when the Column is taller than they are: start (top), end (bottom) or spaceBetween (spread from edge to edge). |

### Grid

Puts the UI pieces inside it in columns, row after row: an inventory, a level select screen.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 0 | The width, which the columns share. 0 fits the pieces inside it. |
| `height` | number (px) | 0 | The height. 0 fits the pieces inside it. |
| `columns` | int | 2 | The number of pieces in a row before the next row starts. |
| `gap` | number (px) | 8 | The space between one piece and the next, in both directions. |
| `padding` | number (px) | 0 | The space between its edges and the pieces inside. |
| `alignItems` | enum | "stretch" | Where each piece is in its cell: start is the top-left corner, end is the bottom-right corner, and stretch fills the cell. |
| `justify` | enum | "start" | Where the rows go when the Grid is taller than they are: start (top), end (bottom) or spaceBetween (spread from edge to edge). |

### Scroll

A rectangle that shows part of a list that is too long for it. It puts the UI pieces inside it in a line and scrolls them with the mouse wheel, a drag or a flick.

Extends [UI](#ui).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `width` | number (px) | 240 | The width. It has no effect when anchor is fill. |
| `height` | number (px) | 160 | The height. It has no effect when anchor is fill. |
| `direction` | enum | "vertical" | vertical puts the pieces from top to bottom, each as wide as the Scroll, and scrolls up and down. horizontal puts them from left to right and scrolls sideways. |
| `gap` | number (px) | 8 | The space between one piece and the next. |
| `padding` | number (px) | 0 | The space between its edges and the pieces inside. |
| `scrollX` | number (px) | 0 | How far it has scrolled sideways (when direction is horizontal). |
| `scrollY` | number (px) | 0 | How far it has scrolled down. |
| `scrollbar` | bool | true | When this is on, a thin bar shows at the edge while some pieces do not fit. |
| `barColor` | color | {1, 1, 1, 0.4} | The color of the scrollbar. |

| Method | |
| --- | --- |
| `scrollTo(piece)` | Scrolls only as far as necessary to show a piece inside it: List:scrollTo(List.Item20). |
| `scrollLimit()` | Returns how far it can scroll: the largest scrollX and scrollY. |

| Event (a function in its script) | |
| --- | --- |
| `function scrolled(x, y)` | The engine calls it when the player scrolls it. |

## Sound

### Sound

Plays a sound or music: a .wav, .ogg or .mp3 file, or a .sfx or .song file that you make in Smitten.

Extends [Piece](#piece).

| Property | Type | Default | |
| --- | --- | --- | --- |
| `sound` | resource | "" | The sound file. |
| `autoplay` | bool | false | When this is on, the sound plays when the scene starts. |
| `loop` | bool | false | When this is on, the sound starts again at the end. |
| `volume` | number | 1 | The loudness, from 0 to 1. |
| `pitch` | number | 1 | 1 is normal, 2 is one octave higher. |

| Method | |
| --- | --- |
| `play()` | Plays the sound and returns its Source (see smitten.audio). If you call it while the sound plays, another copy starts (not for .song files). |
| `stop()` | Stops every copy. |
| `pause()` | Pauses the sound. |
| `resume()` | Continues the sound after pause(). |
| `isPlaying()` | Returns true while the sound plays. |
| `fadeIn(seconds, volume?)` | Plays the sound from silence up to its volume property (or to the volume that you give) over some seconds. |
| `fadeOut(seconds)` | Makes the sound quieter until it is silent, then stops it. Then the volume property goes back to its old value. |
| `seek(seconds)` | Moves to a time in the sound. |
| `tell()` | Returns the current play position, in seconds. |
| `getDuration()` | Returns the length of the sound, in seconds. |

| Event (a function in its script) | |
| --- | --- |
| `function finished()` | The engine calls it when the sound reaches its end (not when it loops). |
