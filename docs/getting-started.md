# Getting started

In this tutorial, you make a small platformer. It has a player who runs and
jumps, coins to collect and an enemy to avoid. You change how the game
plays, you write your first script, and you put the game on the internet.
Then anyone can play it. The tutorial takes approximately fifteen minutes.
You do not have to know how to write programs.

## 1. Make a game

1. Open the editor. The home screen shows your games and some templates.
2. Click **Platformer**.
3. Give the game a name.

![The home screen, with templates to start from](images/home.webp)

The editor opens your game. These are the parts of the editor:

![The editor: the Scene panel (1), the scene view (2), the Inspector (3), Files (4) and Output (5)](images/editor-tour.webp)

1. **Scene panel**: all the pieces in the current scene, as a tree. A
   piece is one thing in your game: the player, a coin, a floor, a camera,
   or a Label on the screen.
2. **Scene view**: the level. Click a piece to select it. Drag a piece to
   move it. Scroll to zoom.
3. **Inspector**: the properties of the selected piece, for example its
   position, its color, or how fast it runs.
4. **Files panel**: all the files in your project, for example scenes,
   scripts, images and sounds.
5. **Output**: messages from your game while it runs, and errors.

You can move the panels to different positions. To move a panel, drag its
tab. You can also drag a panel out into a different window.

## 2. Play it

1. Click **Play** at the top right, or press **F5**.
2. To run, use the arrow keys, or A and D.
3. To jump, press Space.
4. Collect the coins. Stay away from the red enemy. If the player touches
   the enemy, the level starts again.

![The platformer running in the editor](images/playing.webp)

To go back to the editor, click **Stop** or press **F8**.

## 3. Change how it plays

1. In the Scene panel, click **Player**. The Inspector shows the properties
   of the player. Near the bottom, under **Script variables**, there are
   numbers for the movement: `speed`, `jumpHeight`, `gravity` and
   more.

   ![The player's script variables in the Inspector](images/inspector.webp)

2. Set `jumpHeight` to `160`.
3. Set `airJumps` to `1`.
4. Play the game again. The player jumps much higher now, and can jump a
   second time in the air.

> **Tip:** You can change these values while the game runs. While the game
> runs, select a piece. Then change a property. The game changes
> immediately. When you stop the game, the scene goes back to its values
> from before.
> Because of this, you can safely try different values. After you stop,
> type in the values that you like.

## 4. Add more coins

Each coin is a placed scene: the level has the scene `scenes/coin.scene`
in it more than one time.

1. To add a coin, drag `coin.scene` from the Files panel into the scene
   view.
2. Change the coin scene one time (for example, its color). All the coins
   in the level change.

The counter at the top of the screen changes automatically. A script on
the level counts the coins when the game starts. Each time the player
collects a coin, the script adds one to the counter.

## 5. Write a script

Scripts make pieces do things. Each piece can have one script, in Lua. In
this step, the enemy moves a little faster each time that you collect a
coin.

1. Select **Enemy** in the Scene panel.
2. Click the script badge of the enemy. The editor opens
   `scripts/patrol.lua`.
3. Add this code at the end of the script:

   ```lua
   function ready()
     root():on("collected", function()
       speed += 20
     end)
   end
   ```

   ![The enemy's script in the Script workspace](images/script.webp)

4. Play the game again. Each time that you collect a coin, the enemy moves
   faster.

The engine calls `ready()` one time, when the enemy comes into the scene.
`root()` is the level. A coin sends the event `collected` when the player
collects it. `on("collected", ...)` listens for this event. In a script,
names such as `speed` belong to the piece. Because of this, `speed += 20` makes this
enemy faster.

> **Tip:** If there is a problem, Output shows the error with the file and
> the line. Click the error to go to that line.

## 6. Share it

When your game is ready, publish it:

1. Click **Publish** in the top bar.
2. Sign in, or make an account.
3. Give the game a title and a short description.
4. Click **Publish**.

You get a link. Anyone can open the link to play your game in a browser,
or to remix their own copy.

![Publishing a game](images/publish.webp)

To put the game on a different website, for example itch.io, use
**Project › Export**.

## Examples

The home screen also has **Examples**. An example is a small project that
shows how one part of Smitten works. When you click an example, the editor
makes a copy of it for you. Then you can play it, read its scripts and
change it. The comments in the scripts tell you what to look at. The
examples make their own images and sounds, so they do not download files.

| Example | What it shows | Read more |
| --- | --- | --- |
| **Lights** | A dark cave with a Tint. A torch (a Light with `shadows` on) moves with the player. The Occluders in the rocks make shadows | [Lights](lights.md) |
| **Levels** | A Tiles piece with a terrain, an animated water tile, and three Backgrounds that scroll at different speeds. A click digs a hole with `setTerrain()` | [Tiles](tiles.md), [Backgrounds](backgrounds.md) |
| **Pathfinding** | A ghost that finds its way to the player through a maze, with `newPathGrid()` and an agent | [Pathfinding](pathfinding.md) |
| **Two players** | Two players on one keyboard or on two gamepads, from one player scene with a `player` variable. Touch pieces show on phones | [Input](input.md#more-than-one-player) |
| **Text** | A dialogue box from a Panel, a Label and `reveal()`, with text tags and an effect of its own | [Text](text.md) |
| **UI** | A settings screen from a Slider, Checkboxes, a TextInput, Rows and a Column. `save()` keeps the values | [UI](ui.md), [Saving](saving.md) |
| **Forces** | Water, wind and a small planet: Zones with forces, and physics bodies to throw into them | [Physics](physics.md#forces-in-zones) |
| **Random** | A cave that a script makes in a Tiles piece from a seed. The seed shows on the screen, and R makes a new cave | [Random and noise](random.md) |
| **Animation** | A door with an Animator. Keys open the door, and a call key plays a sound. A script waits for the animation | [Animation](animation.md) |
| **Sound** | A song with a sample instrument, and pads that play sounds with `sfx()` at a different pitch each time | [Sound and music](sound.md) |
| **Online dots** | Each player in an online room moves a dot and sees the dots of the others, with `smitten.net`. It works on the games site | [Online rooms](online.md) |

Some examples also use the [ready-made scripts](scripts.md#ready-made-scripts):
**Two players** uses `moving-platform.lua` and `countdown.lua`, and
**Forces** uses `spawner.lua`. There is no example for
[leaderboards](leaderboards.md), because they work only on the games site.

## Next steps

- [Scripts](scripts.md) tells more about how scripts work.
- [Scenes and pieces](scenes.md) tells how to make, find and remove pieces.
- [Input](input.md), [Sound and music](sound.md) and [Camera](camera.md)
  each tell about one part of a game.
- [Script API](api.md) shows each function that a script can use.
- The [examples](#examples) show one part of Smitten each.
