# Nodes

Every node type, generated from `love/src/modules/scene/nodes.json` by
`tools/gen-node-docs.mjs`. A node has its own properties and everything its
parent type has ("extends"). Properties are fields: `self.x = 10`. Angles
are radians in code and degrees in the inspector.

## Basic

### Node

The simplest node. Use it to group other nodes, or to run a script that doesn't need a position.

Methods:

- `self:find(path)`: A child by name, or a descendant by path ("UI/Score"); nil if there isn't one.
- `self:add(node)`: Adds a node as the last child; returns it.
- `self:destroy()`: Removes the node and its children from the scene at the end of the frame.
- `self:addToGroup(name)`: Puts the node in a group, so smitten.scene.group(name) finds it.
- `self:removeFromGroup(name)`: Takes the node out of a group.
- `self:inGroup(name)`: True if the node is in the group.
- `self:on(event, fn)`: Calls fn(...) whenever the node's event happens ("pressed", "entered", ...). Returns a handle with :off().
- `self:emit(event, ...)`: Fires an event: calls the script's function of that name and every listener.
- `self:getPath()`: The node's path from the scene's root, e.g. "Level1/Player".
- `self:isInside()`: True while the node is in the running scene.

Script functions it calls:

- `function Script:ready()`: The node and its children have entered the scene.
- `function Script:update(dt)`: Every frame. dt is the time since the last frame, in seconds.
- `function Script:physicsUpdate(dt)`: 60 times a second, before physics moves bodies. Use it for movement.
- `function Script:draw()`: 2D only: draw extra things on top of the node, in its own coordinates.
- `function Script:removed()`: The node is leaving the scene.

### Timer

Counts down and fires timeout(). Use it for spawn waves, cooldowns and delays.

Extends Node.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `wait` | number (s) | 1 | Seconds from start() to timeout(). |
| `autostart` | bool | false | Start counting as soon as the scene starts. |
| `oneShot` | bool | false | Stop after the first timeout instead of repeating. |

Methods:

- `self:start(seconds?)`: Starts (or restarts) the countdown.
- `self:stop()`: Stops the countdown.
- `self:isStopped()`: True if it isn't counting.

Script functions it calls:

- `function Script:timeout()`: The countdown reached zero.

## 2D

### Node2D

A node with a 2D position, rotation and scale. Its children move with it.

Extends Node.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `x` | number (px) | 0 | Position, relative to the parent. |
| `y` | number (px) | 0 | Position, relative to the parent. y grows downwards. |
| `rotation` | angle | 0° | Rotation in radians (degrees in the inspector), clockwise. |
| `scaleX` | number | 1 | Horizontal scale. Negative flips. |
| `scaleY` | number | 1 | Vertical scale. Negative flips. |
| `visible` | bool | true | Draw this node and its children. |
| `tint` | color | {1, 1, 1, 1} | Multiplies the colors of this node and its children. |
| `z` | int | 0 | Draw order: higher is drawn on top. Equal z keeps the order of the scene tree. |

Methods:

- `self:getGlobalPosition()`: Position in the scene (not relative to the parent): x, y.
- `self:setGlobalPosition(x, y)`: Moves the node to a position in the scene.
- `self:toGlobal(x, y)`: A point in this node's coordinates, in scene coordinates.
- `self:toLocal(x, y)`: A point in scene coordinates, in this node's coordinates.
- `self:lookAt(x, y)`: Rotates the node to face a point in the scene.
- `self:distanceTo(nodeOrX, y?)`: Distance in pixels to another node or a point.
- `self:angleTo(nodeOrX, y?)`: Angle in radians towards another node or a point.
- `self:moveToward(x, y, distance)`: Moves at most distance pixels towards a point; true once it's there.
- `self:translate(dx, dy)`: Moves the node by an offset.

### Sprite2D

Draws an image, or an animation from a .sprite file or a sprite sheet.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | An image (.png, .jpg) or a .sprite file with frames and animations. |
| `animation` | animation | "" | The animation to play, from the .sprite file. |
| `playing` | bool | true | Play the animation. |
| `speed` | number | 1 | Animation speed: 2 is twice as fast. |
| `frame` | int | 0 | The frame shown (from 0). |
| `hframes` | int | 1 | Columns in a sprite sheet image without a .sprite file. |
| `vframes` | int | 1 | Rows in a sprite sheet image without a .sprite file. |
| `centered` | bool | true | Center the image on the node's position (a .sprite file's origin wins). |
| `flipX` | bool | false | Mirror left to right. |
| `flipY` | bool | false | Mirror top to bottom. |

Methods:

- `self:play(name?)`: Plays an animation (or resumes the current one).
- `self:stop()`: Stops the animation on the current frame.
- `self:getSize()`: Width and height of one frame, in pixels.

Script functions it calls:

- `function Script:finished(animation)`: A non-looping animation reached its last frame.

### Shape2D

Draws a rectangle, circle, polygon or line. Good for prototypes, effects and games without art.

Extends Node2D.

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
| `centered` | bool | true | Center the rectangle on the node's position. |

### Text2D

Text in the game world, like a sign or a damage number. For menus and scores, use Label.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Text" | What it says. |
| `font` | resource | "" | A .ttf/.otf font file, "pixel" for the built-in pixel font, or empty for the default font. |
| `size` | int (px) | 16 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color. |
| `align` | enum | "center" | Horizontal alignment around the node's position. |
| `wrap` | number (px) | 0 | Wrap lines longer than this; 0 never wraps. |

### TileMap

A grid of tiles from a tileset, painted in the scene view. Tiles marked solid in the tileset are walls and floors.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `tileset` | resource | "" | The .tileset file: an image cut into tiles, with properties such as solid. |
| `collision` | bool | true | Solid tiles block bodies. |
| `layer` | layers | 1 | Collision layers the solid tiles are on. |

Methods:

- `self:getTile(cx, cy)`: The tile number at a cell, or -1 if it's empty.
- `self:setTile(cx, cy, tile)`: Changes a cell (-1 empties it).
- `self:getTileProperties(tile)`: The properties set on a tile in the tileset (solid, name, ...).
- `self:worldToCell(x, y)`: The cell under a point in the scene: cx, cy.
- `self:cellToWorld(cx, cy)`: The scene position of a cell's top-left corner.
- `self:getUsedCells(tile?)`: A list of {cx, cy, tile} for every painted cell (or every cell with that tile).

### Camera2D

Decides which part of a 2D scene is on screen. Put it inside the player to follow them.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `current` | bool | true | Use this camera. Only one camera is current at a time. |
| `zoom` | number | 1 | 2 shows everything twice as big. |
| `smoothing` | number | 0 | How slowly the camera catches up: 0 sticks exactly, 5 is smooth. |
| `limitLeft` | number (px) | none | The camera doesn't show anything left of this (empty for no limit). |
| `limitTop` | number (px) | none | The camera doesn't show anything above this. |
| `limitRight` | number (px) | none | The camera doesn't show anything right of this. |
| `limitBottom` | number (px) | none | The camera doesn't show anything below this. |

Methods:

- `self:shake(strength?, seconds?)`: Shakes the view: shake(6, 0.3).
- `self:toWorld(sx, sy)`: A point on the screen, in scene coordinates.
- `self:toScreen(x, y)`: A point in the scene, in screen coordinates.

### Particles2D

Sprays particles: smoke, sparks, dust, rain, explosions.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `emitting` | bool | true | Make new particles. |
| `rate` | number (/s) | 30 | Particles per second. |
| `oneShot` | bool | false | Emit one burst of rate particles, then stop. |
| `lifetime` | number (s) | 1 | How long each particle lives. |
| `image` | resource | "" | The particle image; empty draws soft dots. |
| `speed` | number (px/s) | 100 | Starting speed. |
| `speedRandom` | number | 0.5 | How much the speed varies (0 to 1). |
| `direction` | angle | -90° | Direction particles fly in. |
| `spread` | angle | 28.65° | How far directions vary either side. |
| `gravityX` | number (px/s²) | 0 | Constant pull, horizontally. |
| `gravityY` | number (px/s²) | 0 | Constant pull, vertically. |
| `sizeStart` | number (px) | 8 | Size when born. |
| `sizeEnd` | number (px) | 2 | Size when it dies. |
| `colorStart` | color | {1, 0.85, 0.4, 1} | Color when born. |
| `colorEnd` | color | {1, 0.3, 0.1, 0} | Color when it dies. |
| `localCoords` | bool | false | Particles move with the node instead of staying where they were born. |

Methods:

- `self:emit(count)`: Emits count particles right now.
- `self:restart()`: Clears all particles and starts again.

## 2D physics

### CollisionShape2D

Gives its parent body or area a shape. A body without one doesn't collide.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "rectangle" | The shape's kind. Shapes move and scale with their node but don't rotate. |
| `width` | number (px) | 32 | Rectangle width. |
| `height` | number (px) | 32 | Rectangle height. |
| `radius` | number (px) | 16 | Circle radius. |
| `disabled` | bool | false | Turn the shape off. |

### CharacterBody2D

A body you move with code or a behavior: players and enemies. moveAndSlide() moves it and stops at walls.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `vx` | number (px/s) | 0 | Horizontal velocity, used by moveAndSlide(). |
| `vy` | number (px/s) | 0 | Vertical velocity, used by moveAndSlide(). |
| `floorAngle` | angle | 45° | The steepest slope that still counts as floor. |
| `layer` | layers | 1 | Layers this body is on. |
| `mask` | layers | 1 | Layers this body collides with. |

Methods:

- `self:moveAndSlide()`: Moves by vx, vy for this frame, sliding along walls and floors.
- `self:moveAndCollide(dx, dy)`: Moves by an offset and stops at the first hit; returns what it hit or nil.
- `self:isOnFloor()`: True if the last move ended standing on something.
- `self:isOnWall()`: True if the last move hit a wall.
- `self:isOnCeiling()`: True if the last move hit a ceiling.
- `self:overlaps(groupOrNode)`: The first area or body of a group (or that node) touching this one, or nil.
- `self:touchingTile(property)`: The properties of a touching tile that has this property ("damage"), or nil.

Script functions it calls:

- `function Script:collided(other)`: The body ran into another body or a tile map.
- `function Script:entered(area)`: The body started touching an area.
- `function Script:exited(area)`: The body stopped touching an area.

### StaticBody2D

A body that doesn't move by itself: walls, floors, platforms. Moving it with code carries characters standing on it.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `layer` | layers | 1 | Layers this body is on. |
| `mask` | layers | 1 | Layers this body collides with. |
| `friction` | number | 0.3 | How much rigid bodies grip it (physics2d). |
| `bounce` | number | 0 | How much rigid bodies bounce off it (physics2d). |

### Area2D

A region that notices bodies and areas entering and leaving: pickups, triggers, danger zones.

Extends Node2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `layer` | layers | 1 | Layers this area is on. |
| `mask` | layers | 1 | Layers this area notices. |
| `monitoring` | bool | true | Notice bodies and areas. |

Methods:

- `self:getOverlapping()`: A list of the bodies and areas inside it now.
- `self:overlaps(groupOrNode)`: The first body or area of a group (or that node) inside it, or nil.

Script functions it calls:

- `function Script:entered(other)`: A body or area came in.
- `function Script:exited(other)`: A body or area left.

### RigidBody2D

A body moved by physics: it falls, bounces, tumbles and pushes. Uses the physics2d module (Box2D).

Extends Node2D. Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `mass` | number (kg) | 1 | How heavy it is. |
| `friction` | number | 0.3 | How much it grips other bodies. |
| `bounce` | number | 0 | How much it bounces: 0 none, 1 forever. |
| `gravityScale` | number | 1 | How much gravity pulls it; 0 floats. |
| `linearDamping` | number | 0 | Air resistance for moving. |
| `angularDamping` | number | 0.05 | Air resistance for spinning. |
| `lockRotation` | bool | false | Never rotate. |
| `vx` | number (px/s) | 0 | Horizontal velocity. |
| `vy` | number (px/s) | 0 | Vertical velocity. |
| `spin` | number (rad/s) | 0 | Angular velocity. |
| `layer` | layers | 1 | Layers this body is on. |
| `mask` | layers | 1 | Layers this body collides with. |

Methods:

- `self:applyForce(fx, fy)`: Pushes the body this frame.
- `self:applyImpulse(ix, iy)`: A sudden kick, like a jump or a hit.
- `self:applyTorque(torque)`: Twists the body this frame.

Script functions it calls:

- `function Script:collided(other)`: The body hit another body.

### Joint2D

Connects two rigid bodies: a pin, a rope, a spring or a weld. Uses the physics2d module.

Extends Node2D. Uses the physics2d (Box2D) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `kind` | enum | "pin" | How the bodies are connected. |
| `nodeA` | nodepath | "" | The first body. |
| `nodeB` | nodepath | "" | The second body (empty: pinned to the world). |
| `length` | number (px) | 0 | Rope and spring length; 0 uses the distance when the scene starts. |
| `stiffness` | number | 4 | Spring stiffness (oscillations per second). |
| `damping` | number | 0.5 | Spring damping. |

## 3D

### Node3D

A node with a 3D position, rotation and scale. Its children move with it.

Extends Node. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `x` | number (m) | 0 | Position, relative to the parent. |
| `y` | number (m) | 0 | Position, relative to the parent. y is up. |
| `z` | number (m) | 0 | Position, relative to the parent. -z is forward. |
| `rotationX` | angle | 0° | Pitch: rotation around x. |
| `rotationY` | angle | 0° | Yaw: rotation around y. |
| `rotationZ` | angle | 0° | Roll: rotation around z. |
| `scaleX` | number | 1 | Scale along x. |
| `scaleY` | number | 1 | Scale along y. |
| `scaleZ` | number | 1 | Scale along z. |
| `visible` | bool | true | Draw this node and its children. |

Methods:

- `self:getGlobalPosition()`: Position in the scene: x, y, z.
- `self:setGlobalPosition(x, y, z)`: Moves the node to a position in the scene.
- `self:lookAt(x, y, z)`: Turns the node so its forward (-z) faces a point.
- `self:translate(dx, dy, dz)`: Moves the node by an offset, in its parent's coordinates.
- `self:moveLocal(right, up, forward)`: Moves the node along its own axes.
- `self:forward()`: The direction the node faces (its -z), in the scene: x, y, z.
- `self:right()`: The node's right (+x) direction in the scene.
- `self:distanceTo(nodeOrX, y?, z?)`: Distance in meters to another node or a point.

### MeshInstance3D

Draws a built-in shape: a box, sphere, cylinder, capsule or plane, with a material.

Extends Node3D. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `mesh` | enum | "box" | The shape. |
| `width` | number (m) | 1 | Size along x. |
| `height` | number (m) | 1 | Size along y. |
| `depth` | number (m) | 1 | Size along z. |
| `radius` | number (m) | 0.5 | Radius. |
| `color` | color | {0.8, 0.8, 0.8, 1} | Base color. Alpha below 1 makes it see-through. |
| `texture` | resource | "" | An image wrapped around the shape. |
| `roughness` | number | 0.6 | 0 is shiny, 1 is matte. |
| `metallic` | number | 0 | How metal-like the surface is. |
| `emission` | color | {0, 0, 0, 1} | Light the surface gives off (glows in the dark). |
| `unshaded` | bool | false | Ignore lights; show the color as it is. |
| `castShadows` | bool | true | Cast shadows from lights that have shadows. |

### Model3D

Draws a 3D model from a glTF (.glb or .gltf) file, with its own materials.

Extends Node3D. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `model` | resource | "" | The .glb or .gltf file. |
| `castShadows` | bool | true | Cast shadows from lights that have shadows. |

### Camera3D

The point of view of a 3D scene. It looks along its -z axis.

Extends Node3D. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `current` | bool | true | Use this camera. Only one camera is current at a time. |
| `fov` | number (°) | 70 | Vertical field of view. |
| `near` | number (m) | 0.05 | Nothing closer than this is drawn. |
| `far` | number (m) | 500 | Nothing farther than this is drawn. |
| `projection` | enum | "perspective" | Perspective makes far things smaller. |
| `size` | number (m) | 10 | Height of the view (orthographic only). |

Methods:

- `self:screenToRay(sx, sy)`: The ray through a point on the screen: ox, oy, oz, dx, dy, dz.
- `self:worldToScreen(x, y, z)`: Where a point in the scene is on screen: sx, sy (nil if behind the camera).

### DirectionalLight3D

Light from far away, like the sun. Only its rotation matters: it shines along its -z axis.

Extends Node3D. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {1, 0.97, 0.92, 1} | Light color. |
| `energy` | number | 1 | Brightness. |
| `shadows` | bool | true | Cast shadows. |

### PointLight3D

Light shining in every direction from a point, like a lamp or a torch.

Extends Node3D. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {1, 0.9, 0.75, 1} | Light color. |
| `energy` | number | 1 | Brightness. |
| `range` | number (m) | 8 | How far the light reaches. |

### SpotLight3D

A cone of light, like a flashlight. It shines along its -z axis.

Extends Node3D. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {1, 1, 1, 1} | Light color. |
| `energy` | number | 1.5 | Brightness. |
| `range` | number (m) | 12 | How far the light reaches. |
| `angle` | angle | 30° | Half the cone's width. |

### Environment3D

The sky, ambient light and fog of a 3D scene. Use one per scene.

Extends Node. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `background` | enum | "sky" | A sky gradient or a flat color. |
| `color` | color | {0.2, 0.22, 0.28, 1} | Background color. |
| `skyTop` | color | {0.32, 0.55, 0.9, 1} | Sky color overhead. |
| `skyHorizon` | color | {0.75, 0.85, 0.95, 1} | Sky color at the horizon. |
| `skyBottom` | color | {0.35, 0.33, 0.3, 1} | Color below the horizon. |
| `ambient` | color | {0.55, 0.6, 0.7, 1} | Light that reaches everywhere, even in shadow. |
| `ambientEnergy` | number | 0.4 | Ambient brightness. |
| `fog` | bool | false | Fade distant things into the fog color. |
| `fogColor` | color | {0.75, 0.85, 0.95, 1} | Fog color. |
| `fogStart` | number (m) | 20 | Where the fog begins. |
| `fogEnd` | number (m) | 120 | Where the fog is complete. |

### Sprite3D

An image in the 3D world, like a tree in a retro shooter or a health bar over an enemy.

Extends Node3D. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | The image. |
| `pixelSize` | number (m) | 0.01 | Meters per image pixel. |
| `billboard` | bool | true | Always face the camera. |
| `color` | color | {1, 1, 1, 1} | Tint. |
| `unshaded` | bool | true | Ignore lights. |

## 3D physics

### CollisionShape3D

Gives its parent 3D body or area a shape. A body without one doesn't collide.

Extends Node3D. Uses the physics3d (Jolt) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `shape` | enum | "box" | The shape's kind. Mesh uses the model or mesh of the parent (static bodies only). |
| `width` | number (m) | 1 | Box size along x. |
| `height` | number (m) | 1 | Size along y. |
| `depth` | number (m) | 1 | Box size along z. |
| `radius` | number (m) | 0.5 | Radius. |
| `disabled` | bool | false | Turn the shape off. |

### CharacterBody3D

A body you move with code or a behavior: a player that walks, jumps and climbs stairs.

Extends Node3D. Uses the physics3d (Jolt) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `vx` | number (m/s) | 0 | Velocity along x. |
| `vy` | number (m/s) | 0 | Velocity along y (up). |
| `vz` | number (m/s) | 0 | Velocity along z. |
| `maxSlope` | angle | 50° | The steepest slope it can walk up. |
| `stepHeight` | number (m) | 0.3 | The highest step it climbs without jumping. |
| `layer` | layers | 1 | Layers this body is on. |
| `mask` | layers | 1 | Layers this body collides with. |

Methods:

- `self:moveAndSlide()`: Moves by vx, vy, vz for this frame, sliding along walls and up steps.
- `self:isOnFloor()`: True if it's standing on something.

Script functions it calls:

- `function Script:collided(other)`: The body ran into another body.
- `function Script:entered(area)`: The body started touching an area.
- `function Script:exited(area)`: The body stopped touching an area.

### RigidBody3D

A body moved by physics: crates that fall, roll, stack and get knocked over.

Extends Node3D. Uses the physics3d (Jolt) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `mass` | number (kg) | 1 | How heavy it is. |
| `friction` | number | 0.5 | How much it grips other bodies. |
| `bounce` | number | 0 | How much it bounces. |
| `gravityScale` | number | 1 | How much gravity pulls it. |
| `linearDamping` | number | 0.05 | Air resistance for moving. |
| `angularDamping` | number | 0.05 | Air resistance for spinning. |
| `lockRotation` | bool | false | Never rotate. |
| `vx` | number (m/s) | 0 | Velocity along x. |
| `vy` | number (m/s) | 0 | Velocity along y. |
| `vz` | number (m/s) | 0 | Velocity along z. |
| `layer` | layers | 1 | Layers this body is on. |
| `mask` | layers | 1 | Layers this body collides with. |

Methods:

- `self:applyForce(fx, fy, fz)`: Pushes the body this frame.
- `self:applyImpulse(ix, iy, iz)`: A sudden kick.
- `self:applyTorque(tx, ty, tz)`: Twists the body this frame.

Script functions it calls:

- `function Script:collided(other)`: The body hit another body.

### StaticBody3D

A 3D body that doesn't move by itself: floors, walls, the level.

Extends Node3D. Uses the physics3d (Jolt) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `friction` | number | 0.5 | How much bodies grip it. |
| `bounce` | number | 0 | How much bodies bounce off it. |
| `layer` | layers | 1 | Layers this body is on. |
| `mask` | layers | 1 | Layers this body collides with. |

### Area3D

A 3D region that notices bodies entering and leaving: pickups, checkpoints, triggers.

Extends Node3D. Uses the physics3d (Jolt) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `layer` | layers | 1 | Layers this area is on. |
| `mask` | layers | 1 | Layers this area notices. |

Methods:

- `self:getOverlapping()`: A list of the bodies inside it now.

Script functions it calls:

- `function Script:entered(other)`: A body came in.
- `function Script:exited(other)`: A body left.

## UI

### Control

The base of UI nodes: a rectangle placed relative to a corner, an edge or the center of the screen.

Extends Node. A base for other types; not added itself.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `anchor` | enum | "topLeft" | What the position is measured from. "full" stretches over the whole parent. |
| `x` | number (px) | 0 | Offset from the anchor. |
| `y` | number (px) | 0 | Offset from the anchor. |
| `width` | number (px) | 160 | Width (ignored when the anchor is full). |
| `height` | number (px) | 40 | Height (ignored when the anchor is full). |
| `visible` | bool | true | Show this node and its children. |
| `opacity` | number | 1 | 0 is invisible, 1 is solid. |

Methods:

- `self:getRect()`: Where it is on screen now: x, y, width, height.
- `self:isHovered()`: True while the mouse is over it.

### Label

Text on the screen: scores, timers, titles, dialog.

Extends Control.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Label" | What it says. Change it from a script: self.text = `Score: {score}`. |
| `font` | resource | "" | A .ttf/.otf font, "pixel", or empty for the default font. |
| `size` | int (px) | 20 | Font size. |
| `color` | color | {1, 1, 1, 1} | Text color. |
| `align` | enum | "left" | Horizontal alignment in the rectangle. |
| `valign` | enum | "top" | Vertical alignment in the rectangle. |
| `outline` | bool | false | A dark outline, so it reads on any background. |

### Button

A button to click or tap. Its script gets pressed().

Extends Control.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `text` | text | "Button" | The button's label. |
| `font` | resource | "" | A font, or empty for the default. |
| `size` | int (px) | 18 | Font size. |
| `color` | color | {0.25, 0.47, 0.95, 1} | Background color. |
| `textColor` | color | {1, 1, 1, 1} | Text color. |
| `cornerRadius` | number (px) | 6 | Rounds the corners. |
| `disabled` | bool | false | Can't be pressed; drawn faded. |

Script functions it calls:

- `function Script:pressed()`: The button was clicked or tapped.

### Panel

A colored rectangle behind other UI: a dialog box, a HUD backdrop.

Extends Control.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `color` | color | {0.08, 0.09, 0.12, 0.85} | Fill color. |
| `cornerRadius` | number (px) | 8 | Rounds the corners. |
| `borderColor` | color | {1, 1, 1, 0.15} | Outline color. |
| `borderWidth` | number (px) | 1 | Outline thickness; 0 for none. |

### ImageRect

An image on the screen: an icon, a portrait, a logo.

Extends Control.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `image` | resource | "" | The image. |
| `fit` | enum | "contain" | How the image fills the rectangle. |
| `color` | color | {1, 1, 1, 1} | Tint. |

### ProgressBar

A bar that fills up: health, loading, a timer.

Extends Control.

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

### AudioPlayer

Plays a sound or music: a .wav, .ogg or .mp3 file, or a .sfx or .song made in Smitten.

Extends Node.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `sound` | resource | "" | The sound file. |
| `autoplay` | bool | false | Play when the scene starts. |
| `loop` | bool | false | Start again at the end. |
| `volume` | number | 1 | Loudness, 0 to 1. |
| `pitch` | number | 1 | 1 is normal; 2 is an octave up. |

Methods:

- `self:play()`: Plays the sound. Calling it again while playing starts another copy (good for effects).
- `self:stop()`: Stops every copy.
- `self:pause()`: Pauses.
- `self:resume()`: Continues after pause().
- `self:isPlaying()`: True while it's playing.

Script functions it calls:

- `function Script:finished()`: The sound reached its end (not when looping).

### AudioPlayer3D

A sound that comes from a place in a 3D scene: louder when the camera is near, and from the left or right.

Extends Node3D. Uses the 3d module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `sound` | resource | "" | The sound file (mono files work best). |
| `autoplay` | bool | false | Play when the scene starts. |
| `loop` | bool | false | Start again at the end. |
| `volume` | number | 1 | Loudness, 0 to 1. |
| `range` | number (m) | 20 | Beyond this distance it can't be heard. |

Methods:

- `self:play()`: Plays the sound.
- `self:stop()`: Stops it.
- `self:isPlaying()`: True while it's playing.

Script functions it calls:

- `function Script:finished()`: The sound reached its end.

## Behaviors

### Platformer

Makes its parent CharacterBody2D run and jump with the arrow keys or a gamepad, with gravity.

Extends Node. Goes inside a CharacterBody2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `speed` | number (px/s) | 220 | Top running speed. |
| `acceleration` | number (px/s²) | 2400 | How fast it gets up to speed (and stops). |
| `jumpHeight` | number (px) | 96 | How high a full jump goes. |
| `gravity` | number (px/s²) | 1800 | How fast it falls. |
| `maxFallSpeed` | number (px/s) | 1000 | The fastest it falls. |
| `airJumps` | int | 0 | Extra jumps in the air (1 is a double jump). |
| `coyoteTime` | number (s) | 0.1 | Time after running off a ledge when a jump still works. |
| `controls` | bool | true | Read the left, right and jump actions; off lets a script drive it. |
| `leftAction` | action | "left" | Input action for moving left. |
| `rightAction` | action | "right" | Input action for moving right. |
| `jumpAction` | action | "jump" | Input action for jumping. |

Methods:

- `self:jump()`: Jumps now (if it's allowed to).

Script functions it calls:

- `function Script:jumped()`: Sent to the parent: it jumped.
- `function Script:landed()`: Sent to the parent: it landed.

### TopDown

Makes its parent CharacterBody2D walk in any direction with the arrow keys or a gamepad.

Extends Node. Goes inside a CharacterBody2D.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `speed` | number (px/s) | 200 | Top speed. |
| `acceleration` | number (px/s²) | 2000 | How fast it gets up to speed (and stops). |
| `rotate` | bool | false | Turn the parent to face the way it moves. |
| `controls` | bool | true | Read the left, right, up and down actions. |

### FirstPerson

Makes its parent CharacterBody3D walk with WASD, look with the mouse and jump with space. Put a Camera3D in the parent too.

Extends Node. Goes inside a CharacterBody3D. Uses the physics3d (Jolt) module.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `speed` | number (m/s) | 5 | Walking speed. |
| `sprintSpeed` | number (m/s) | 8.5 | Speed while holding shift. |
| `jumpHeight` | number (m) | 1.2 | How high a jump goes. |
| `gravity` | number (m/s²) | 20 | How fast it falls. |
| `mouseLook` | bool | true | Look around with the mouse (click the game to capture the mouse, Escape to free it). |
| `sensitivity` | number | 0.0025 | Mouse look speed. |

### Follow

Moves its parent towards another node: enemies that chase, pets, homing missiles. Works in 2D and 3D.

Extends Node.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `target` | nodepath | "" | The node to follow; empty follows the first node in the "player" group. |
| `speed` | number | 120 | Speed (pixels or meters per second). |
| `stopDistance` | number | 0 | Stop this close to the target. |
| `rotate` | bool | false | Turn the parent to face the target. |

### Mover

Moves its parent in a straight line: bullets, clouds, conveyor items.

Extends Node.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `speed` | number | 400 | Speed in pixels per second (2D) or meters per second (3D). |
| `useRotation` | bool | true | Move the way the parent faces; off moves along direction. |
| `direction` | angle | 0° | Direction when not using the parent's rotation (2D). |
| `destroyOffscreen` | bool | true | Destroy the parent once it leaves the screen (2D). |

### Spin

Keeps its parent rotating: coins, fans, saws.

Extends Node.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `speed` | angle | 180° | Turns per second, in radians (degrees in the inspector). |
| `axis` | enum | "y" | The axis to spin around (3D only). |

### Draggable

Lets the player drag its parent Node2D with the mouse or a finger: card games, puzzles, editors.

Extends Node.

| Property | Type | Default | |
| --- | --- | --- | --- |
| `button` | int | 1 | Mouse button: 1 left, 2 right, 3 middle. |
| `size` | number (px) | 32 | Grab radius when the parent has no collision shape or sprite. |

Script functions it calls:

- `function Script:dragStarted()`: Sent to the parent: the player picked it up.
- `function Script:dragEnded()`: Sent to the parent: the player let go.
