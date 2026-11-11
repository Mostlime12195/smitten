# Sharing and publishing

## Publishing

Use **Publish** in the top bar to put your game on the games site. On the
games site, anyone with the link can play the game in a browser.

To publish, you must have an account. Sign up with a username and password,
or with Hack Club.

1. Give the game a title.
2. Give the game a short description.
3. Give the game a thumbnail.
4. Click **Publish**.

When you publish again from the same project, Smitten changes the same
game. The link of the game stays the same. The page of a game shows:

- who made the game.
- how much time the game took to make (if the maker connected Hackatime).
- the buttons **Play**, **Remix** and **Report**. **Remix** opens your own
  copy of the game in the editor.

A published game can also have [leaderboards](leaderboards.md):
high scores that all players share. The page of the game shows them under
the game. On its page, a game can also have [online rooms](online.md), where
players in different places play together.

## Exporting

**Project › Export** (Ctrl+E) makes files that you can take to other
places:

| | |
| --- | --- |
| **Web game (zip)** | The game and the web player (the program that runs the game in a browser), with only the engine modules that the game uses. Upload it to itch.io as an HTML game, or to a different website |
| **Project (zip)** | All the files of the project. Use it to keep a backup copy, or to open the project in Smitten on a different computer |

## Play builds

When you export a web game or publish a game, Smitten makes a play build
of the game. A play build is a copy of the files of the game that is
smaller and that the engine loads faster. Your project does not change.
The editor, project zips, share links and **Remix** use the project as it
is (the source).

The play build changes these files:

| Files | In the play build |
| --- | --- |
| `.sprite` files | The `layers` field is not there. The engine draws only the image of the sprite (the layers flattened) |
| Tool files: `.js`, `.mjs`, `.cjs`, `.ts`, `.py`, `.sh`, `.bat`, `.cmd` and `.ps1` | Not there, because the engine cannot use them. If the name of the file is in a string in a script, a scene or a data file, the file stays. A string that is only the extension (`".mjs"`) keeps all the files with that extension |
| Files of art programs: `.aseprite`, `.ase`, `.psd`, `.kra`, `.xcf`, `.blend` and `.pdn` | Not there, as tool files. The game uses the PNG images that you export from the art program |
| Scenes, tilesets, sprites, sound effects, songs and `.json` files | The spaces and line breaks between the values are not there. The values do not change |
| PNG images | Smitten writes each image again in the smallest form that keeps all the pixels. For example, an image with 256 colors or fewer gets a palette. The engine gets the same pixels. Smitten decodes each new image and compares it with the original. If one pixel is different, or if the new file is not smaller, the play build keeps the original image |
| The zip | It uses the best compression |

All other files do not change: scripts, sounds, fonts and other data.

On the games site, a published game has two zips: the source and the play
build. The play page runs the play build. **Remix** gets the source, with
the layers and the tool files. A game that you published before play
builds runs from the source until you publish it again.

For example, the play build of the game Lamplight is 23% smaller than its
source (326 KB, not 423 KB). The web export is 5% smaller in total,
because the engine is most of a web export.

### If a game works in the editor, but not after export

The play build can be the cause. To find out, turn off the play build:

1. In the editor, open the console of the browser (F12).
2. Type `localStorage['smitten-editor.play-build'] = '"off"'` and press
   Enter.
3. Export or publish the game again.

If the game works now, turn on the changes again one at a time. To turn
off only one change, use its name: for example,
`localStorage['smitten-editor.play-build'] = '{"png": false}'`. The names
are `layers`, `tools`, `json` and `png`. To turn on the play build again,
type `localStorage.removeItem('smitten-editor.play-build')`. Then tell us
about the problem, because a play build must not change a game.

## Share links

**Project › Copy share link** puts all of a small project into a link. The
limit is 32 KB, after compression. A person who opens the link gets a copy
of the project in the editor, and can play and change it. Smitten does not
upload the project, so share links are good for quick tests. For bigger
games, publish or export.
