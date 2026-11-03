# Getting started

Make a small game: a player who runs and jumps and collects coins.
Everything happens in the editor, in the browser; nothing to install.

## 1. Make a project

Open the editor and pick a template, or **Empty**. A project is a folder
of files: scenes (`.scene`), scripts (`.lua`), pictures, sounds and a
`smitten.json` with the project's settings. The editor keeps it in your
browser until you share or export it.

The editor has workspaces across the top: **Scene** (build levels),
**Script** (code), **Paint** (pictures and sprite sheets), **Sound**
(sound effects) and **Music** (songs).

## 2. Build a scene

A scene is a tree of **pieces**. Each piece does one thing:

| Piece | Does |
| --- | --- |
| Group | Holds other pieces; they move with it |
| Sprite, Shape, Text | Something you see |
| Body | Something solid: a player, a wall, a crate |
| Zone | An area that notices things going in: a coin, a checkpoint |
| Tiles | A grid of tiles painted from a tileset |
| Camera | Which part of the scene is on screen |
| Label, Button, Bar, Panel, Picture | UI on top of the game |
| Sound, Timer, Particles | Sound, countdowns, effects |

Add pieces with **Ctrl+A** (Cmd+A on a Mac). Put pieces inside each other
by dragging them in the Scene panel: a Shape inside a Body gives the Body
its look and its collision shape.

For the player: add a **Body**, name it `Player`, put a **Shape** (or a
Sprite) inside it, and give it the tag `player` in the Inspector. For the
floor: another Body with motion **still** and a wide Shape inside.

## 3. Give it a script

Select the player and choose **Attach a script… › Platformer player**. The
script is copied into your project (`scripts/platformer.lua`); open it and
read it, it's yours to change. Press **F5** to play.

A script is the piece's own code. Names in it are the piece's:

```lua
speed = 220            -- a script variable: shown in the Inspector

function physicsUpdate(dt)
  vx = axis("left", "right") * speed   -- vx is the Body's speed
  vy += 1800 * dt                      -- gravity
  move()                               -- the Body's move(): slides along walls
  if pressed("jump") and onGround() then vy = -600 end
end
```

## 4. Coins

Add a **Zone** with a yellow circle Shape inside, and attach the ready-made
**Pickup** script. When something tagged `player` goes in, it plays a sound
(set `sound` in the Inspector) and tells the scene's root piece with an
event. Count them in a script on the root:

```lua
-- scripts/level.lua, on the scene's root piece
coins = 0

function collected(coin)
  coins += 1
  find("HUD/Score").text = `Coins: {coins}`   -- a Label inside a Group called HUD
end
```

Save the coin as its own scene (right-click it › **Save as its own scene…**) and place
it as many times as you like; change `scenes/coin.scene` once and every
coin changes.

## 5. Try things while it runs

While the game runs, select a piece and change its properties: the running
game changes, your files don't (**live tweaking**). When you like a value,
type it into the scene.

## 6. Share it

**Project › Copy share link** gives a link anyone can open to play and
remix their own copy. **Publish** puts it on the sharing site. See
[Sharing and publishing](sharing.md).

## Next

- [Scripts](scripts.md): how scripts work, events and waiting.
- [Script API](api.md): everything a script can call.
- [Pieces](pieces.md): every piece's properties and methods.
