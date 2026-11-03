# Sharing and publishing

All from the **Project** menu.

| | |
| --- | --- |
| **Copy share link** | The whole project in a link (up to 32 KB compressed). Whoever opens it gets their own copy |
| **Publish** | Puts the game on the sharing site. Requires an account; publishing again updates the same game |
| **Export** (Ctrl+E) | A web zip (for itch.io or any site), a project zip, or a `.love` for desktop LÖVE (plain LÖVE games only) |

A published game's page has **Play**, **Remix** (opens a copy in the
editor) and **Report**. It shows the time tracked by Hackatime if the
author connected it.

Command line: `python3 package.py path/to/game out/ --zip` makes the web
zip.

Saves are stored per site, so a game on itch.io and on the sharing site
keeps separate saves.
