# Smitten docs

Smitten is a 2D game engine in the browser: a fork of LÖVE 12 compiled to
WebAssembly, with an editor, scenes made of pieces, and scripts you own.
These pages explain how to make a game with it and list everything a
script can use.

New here? Start with [Getting started](getting-started.md).

## Making games

| Page | What's in it |
| --- | --- |
| [Scripts](scripts.md) | How a script works: variables, `ready`, `update`, events, waiting, timers, tweens |
| [Scenes and pieces](scenes.md) | Finding, making and removing pieces, tags, changing scenes, transitions, pausing, slow motion |
| [Input](input.md) | Actions, keys, the mouse, touch, gamepads, rebinding, typing |
| [Sound and music](sound.md) | `sfx`, `music`, the Sound piece, fades, volume |
| [Camera](camera.md) | Following, smoothing, zoom, shake, edges, screen and scene coordinates |
| [Tiles](tiles.md) | Reading and changing tile maps from scripts |
| [UI](ui.md) | Labels, buttons, bars, pictures, layout, menus with the keyboard and gamepads |
| [Physics](physics.md) | Bodies that fall and bounce, joints, raycasts |
| [Saving](saving.md) | High scores, settings and progress that stay between plays |
| [Drawing](drawing.md) | Drawing shapes, text and sprites from `draw()` |

## Project

| Page | What's in it |
| --- | --- |
| [Project settings and modules](settings.md) | `smitten.json`, resolution and scaling, fullscreen, engine modules |
| [Sharing and publishing](sharing.md) | Share links, publishing on the site, remixing, exporting for itch.io |

## Reference

| Page | What's in it |
| --- | --- |
| [Script API](api.md) | Every name a script can use, in one list |
| [Pieces](pieces.md) | Every piece type: properties, methods, events |
| [The engine table](engine.md) | `smitten.scene`, `smitten.input`, `smitten.tween` and the rest of `smitten.*` |
| [File formats](formats.md) | `.scene`, `.sprite`, `.tileset`, `.sfx`, `.song` |
| [Editor tools](editor-tools.md) | Adding a tool to the editor |

`smitten` and `love` are the same table, so everything in
[LÖVE's API](https://love2d.org/wiki/Main_Page) works too, and LÖVE games
and libraries run as they are. The API pages, the piece reference and the
editor's completions are generated from the same files, so they always
agree with the engine (`node tools/gen-docs.mjs`).
