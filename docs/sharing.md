# Sharing and publishing

Three ways to get a game to people, all from the **Project** menu.

## Share links

**Copy share link** puts the whole project in a link (up to 32 KB
compressed: code, scenes, small pictures and sounds). Anyone who opens it
gets their own copy in their editor, to play and change; nothing is
uploaded. Bigger projects: publish them, or export a project zip.

## Publishing

**Publish…** puts the game on the sharing site, where anyone can play it in
the browser. Sign in first (a username and password, or Hack Club's
sign-in). Give it a title, a description and a thumbnail; publishing again
updates the same game, from any computer you're signed in on.

A game's page shows who made it, how long it took when its maker connected
Hackatime, and buttons to:

- **Play** it, full screen if you like;
- **Remix** it: the editor opens with your own copy to change;
- **Report** it, if it shouldn't be there.

Only the engine modules the game uses are downloaded, so small games start
fast.

## Exporting

**Export…** (Ctrl+E) makes:

| | |
| --- | --- |
| **Web game (zip)** | The game and the player, with only the engine modules it uses: upload it to itch.io as an HTML game, or to any website |
| **Project (zip)** | Every file of the project, to back it up or open it in Smitten elsewhere |
| **.love file** | For LÖVE 12 on desktop; only works for games that use LÖVE's API and plain Lua, not Smitten's scenes or syntax |

From the command line, `python3 package.py path/to/game out/ --zip` makes
the same web zip.

## Saves on the web

A game's [saves](saving.md) are kept in the browser, for the site it runs
on: the same game on itch.io and on the sharing site has separate saves.
