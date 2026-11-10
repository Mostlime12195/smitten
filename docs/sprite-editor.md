# Sprite editor

The sprite editor is the **Sprites** workspace of the editor. Use it to
draw and animate the images of a game: sprites, tiles and backgrounds. It
saves each image as a PNG file. For an image with more than one animation
frame, it also saves a `.sprite` file. [File formats](formats.md#sprites)
tells about this file.

## Open the sprite editor

You can open the sprite editor in four ways:

- Click **Sprites** at the top of the editor, or press Alt+3. The workspace
  shows a new sprite. When you draw on it, the editor saves it as
  `sprites/sprite.png`.
- In the **Files** panel, click a `.png` file or a `.sprite` file.
- In the **Files** panel, click **New**. Then click **Sprite**.
- Select a piece that shows an image, for example a `Sprite`. In the
  **Inspector**, click the pencil button next to `image`.

Each image opens in a tab at the top of the workspace. To start one more
new sprite, click **+** at the right of the tabs.

## The parts of the sprite editor

| Part | Where | What it does |
| --- | --- | --- |
| Tools | The column at the left | Brush, eraser, fill, color picker, line, rectangle, ellipse and select |
| Tool options | The bar at the top | The size, the opacity and the other options of the tool. At the right: the mirror buttons, the image size, undo, redo and **More** (the menu with the other commands) |
| Canvas | The middle | The image. Scroll to zoom. To move the view, drag while you hold Space |
| Color | The panel at the right | The color of the left mouse button, the color of the right mouse button, the recent colors and a palette |
| Preview and animations | The panel at the right | The animation as the game plays it, and the list of animations |
| Frames | The bar at the bottom | The animation frames of the image. Drag a frame to move it |

The editor saves your changes automatically, a short time after each
change. To save immediately, press Ctrl+S.

To use an image in a scene, drag the file from the **Files** panel into the
scene view. The editor makes a `Sprite` piece that shows it.
