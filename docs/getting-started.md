# Getting started

A platformer with a player, a floor and coins.

1. In the editor, make a project from **Empty**.
2. Press **Ctrl+A** (⌘A) and add a **Body** named `Player`. Put a
   **Shape** inside it; the Body takes its size from the Shape. Give the
   Player the tag `player` in the Inspector.
3. Add another Body for the floor. Set its **Motion** to `still` and put a
   wide Shape inside it.
4. Select the Player, choose **Attach a script › Platformer player**, and
   press **F5** to play. The script is copied to `scripts/platformer.lua`.
5. Add a **Zone** with a small circle Shape inside, and attach
   **Pickup**. Give the scene's root piece this script:

   ```lua
   coins = 0

   function collected(coin)
     coins += 1
     print(coins)
   end
   ```

While the game runs, editing a piece in the Inspector changes the running
game only; stopping it restores the scene.

**Project › Publish** puts the game online.

Next: [Scripts](scripts.md).
