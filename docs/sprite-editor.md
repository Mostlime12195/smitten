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

## Keys and mouse

The keys work while the sprite editor has the keyboard focus. Click the
canvas to give it the keyboard focus. On a Mac, use Cmd for Ctrl.

| Key or mouse | What it does |
| --- | --- |
| B, E, G, I, L, M, O | The brush, the eraser, fill, the color picker, the line, select and the origin |
| U | The rectangle. Press U again for the ellipse. Shift+U selects the ellipse |
| Left mouse button | Paints with the first color |
| Right mouse button | Paints with the second color |
| Alt+click | Picks the color under the mouse pointer, with all tools |
| Shift+click | Draws a straight line from the last point (brush and eraser) |
| Shift while you drag | Lines snap to 45 degrees. Rectangles become squares, and ellipses become circles |
| [ and ] | Makes the brush smaller or bigger |
| Shift+[ and Shift+] | Makes the edge of a smooth brush softer or harder |
| X | Swaps the two colors |
| Scroll | Zooms in or out at the mouse pointer. Ctrl+scroll and a pinch on a touchpad also zoom |
| Drag while you hold Space, or drag with the middle mouse button | Moves the view |
| + and - | Zooms in or out |
| 0 | Fits the image in the view |
| 1 | Zooms to 100% |
| , and . | Goes to the frame before or the frame after |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z or Ctrl+Y | Redo |
| Ctrl+A and Ctrl+D | Selects all of the image, and removes the selection |
| Ctrl+C, Ctrl+X and Ctrl+V | Copy, cut and paste. You can paste on a different frame or a different image |
| Arrow keys | Move the selected pixels by 1 pixel (with Shift, by 8 pixels). With no selection, Left and Right go to the frame before or after |
| Delete | Deletes the selected pixels |
| Enter | Puts down the selected pixels that you move |
| Escape | Puts down the selected pixels and removes the selection |
| Shift+H and Shift+V | Flips the selection (or all of the image) left to right, or top to bottom |
| Ctrl+S | Saves now |

When the mouse pointer goes out of the canvas during a stroke, the stroke
continues. Each stroke is one step for undo.

## Pen and touch

You can draw with a pen on a tablet or on a touch screen.

- The pen paints the same as the left mouse button.
- The eraser end of the pen erases, with all tools.
- The side button of the pen picks the color under the pen.
- While the pen is on or near the screen, the editor ignores fingers.
  Because of this, your hand can lie on the screen while you draw.
- With two fingers, drag to move the view, and pinch to zoom.

The pressure of the pen can change the brush and the eraser. Set **Pen**
in the tool options:

| Pen | What the pressure changes |
| --- | --- |
| **No pressure** | Nothing. Each stroke has the full size and opacity |
| **Pressure: size** | The size of the brush. A light touch makes a thin line |
| **Pressure: opacity** | The opacity of the stroke. A light touch makes a faint line |
| **Pressure: both** | The size and the opacity |

**Lightest** sets how much of the size or the opacity the lightest touch
gives. At 100%, the pressure changes nothing.

The brush and the eraser each keep their own **Pen** setting, for smooth
brushes and for pixel brushes. For smooth brushes, the default is
**Pressure: size**. For pixel brushes, the default is **No pressure**, so
pixel art keeps hard, even lines. The pressure does not change strokes
that you make with a mouse.

To use an image in a scene, drag the file from the **Files** panel into the
scene view. The editor makes a `Sprite` piece that shows it.
