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
| Tools | The column at the left | Brush, eraser, fill, color picker, line, rectangle, ellipse and select. Under them: the two mirror buttons |
| Tool options | The bar at the top | The size, the opacity and the other options of the tool. At the right: undo, redo and **More** (the menu with the other commands) |
| Canvas | The middle | The image. Scroll to zoom. To move the view, drag while you hold Space. At the bottom right: the image size, the pixel grid and the zoom |
| Color | The panel at the right | The color of the left mouse button, the color of the right mouse button, the recent colors and a palette |
| Preview and animations | The panel at the right | The animation as the game plays it, and the list of animations |
| Frames | The bar at the bottom | The animation frames of the image. Drag a frame to move it. The onion skin button shows the frames before and after the current frame |

The editor saves your changes automatically, a short time after each
change. To save immediately, press Ctrl+S.

## Layers

A sprite can have layers. Each layer has its own pixels in each animation
frame. All the animation frames have the same layers. The layer at the top
of the list is in front of the others.

- To add a layer, click **+** next to **Layers**. The new layer goes over
  the selected layer.
- Click a layer to paint on it. Double-click a layer to rename it.
- Click the eye button of a layer to hide it or to show it again. You
  cannot paint on a hidden layer.
- **Opacity** sets how much of the selected layer shows.
- The buttons under the list move the selected layer up or down, duplicate
  it, merge it down onto the layer under it, and delete it.
- **More** > **Flatten layers** makes one layer from the layers that show.

The game shows the layers flattened: the editor saves the PNG as you see
it. The `.sprite` file also keeps each layer, so that you can change the
layers later. Because of this, a sprite with layers works in all games, also
in games made with older versions of Smitten. [File formats](formats.md#layers)
tells about the file.

If a different program changes the PNG of a sprite with layers, the editor
puts the new PNG on a new top layer. It hides the other layers, so that the
sprite looks the same as the PNG.

## Mirror drawing

The two mirror buttons under the tools draw each stroke on the two sides of
a mirror line:

- The first button uses a line from the top to the bottom. What you draw on
  the left also appears on the right.
- The second button uses a line from the left to the right. What you draw
  at the top also appears at the bottom.
- With the two buttons on, each stroke appears four times.

The mirror works with all the tools that paint: the brush, the eraser, the
line, the rectangle, the ellipse and fill.

The mirror line starts in the middle of the image. To move it, drag its
round handle. The handle of the first line is above the image, and the
handle of the second line is at the left of the image. The line moves in
steps of half a pixel: it is between two pixels, or through the middle of
one pixel. To put the line back in the middle, double-click its handle, or
click **More** > **Mirror lines to the middle**.

## Select and move

1. Click the select tool, or press M.
2. Drag over the pixels to select them.

Then you can do these things:

- To move the selected pixels, drag inside the selection. To leave a copy
  at the start, hold Alt when you start to drag.
- The arrow keys move the selected pixels by 1 pixel (with Shift, by 8
  pixels).
- R turns the selected pixels a quarter turn to the right. Shift+R turns
  them to the left. Shift+H and Shift+V flip them.
- Ctrl+C copies and Ctrl+X cuts the selected pixels. Ctrl+V pastes them at
  the same place. You can paste on a different animation frame, a different
  layer or a different image.
- Delete deletes the selected pixels.
- Enter puts down the pixels that you move. Escape puts them down and
  removes the selection.

While there is a selection, the brush and the other tools paint only inside
it. Each move, turn, paste and delete is one step for undo.

With no selection, R and Shift+R turn all of the image. If the image is not
square, the editor loses the parts that go out of the image when you put
the pixels down. Undo brings them back.

## Palettes

Under the color picker, **Palette** shows a set of colors. Click a color to
use it. Right-click a color to make it the second color. **Project** is the
palette in `smitten.json`, if the project has one.

The lock button next to **Palette** locks painting to the palette:

- Each pixel that a stroke covers gets the palette color that looks the
  most the same as the color you paint with.
- Soft edges become hard: a pixel shows fully or not at all.
- The eraser is not locked.

Two commands in **More** use palettes:

- **Palette from an image** makes the project palette from the colors of an
  image. The most used colors come first. You select how many colors the
  palette can have: 8, 16, 32 or 64. The editor saves the palette in
  `smitten.json` (`palette`), so all the images of the project can use it.
- **Change this layer to the palette colors** changes each pixel of the
  selected layer to the nearest palette color. It does this in all the
  animation frames.

## Import a sprite sheet

A sprite sheet is one image with many animation frames in a grid. The
editor can cut a sheet into animation frames:

1. Click **More** > **Import sprite sheet**.
2. In **Image**, select a PNG of the project, or **From your computer**.
3. In **Cut by**, select **Frame size** or **Columns × rows**. Then type the
   size of a frame, or the number of columns and rows.
4. If the sheet has empty pixels around it, set **Margin**. If it has empty
   pixels between the frames, set **Spacing**.
5. Look at the preview. The chosen cells are blue, with numbers in the
   order of the animation frames. Click a cell to choose it or not.
   **All**, **Not empty** and **None** change all the cells.
6. Type a name in **Animation**, for example `walk`. To make no animation,
   leave the name empty.
7. Set **Frames per second**.
8. Click **Import**.

Where the frames go:

- If the image is new and empty, it becomes the frames of the sheet.
- If the frames of the sheet are as big as the frames of the image, the
  editor adds them after the last frame.
- If they have a different size, the frames of the sheet replace all the
  frames of the image. Undo brings the old frames back.

The result is an ordinary sprite with a `.sprite` file. The editor does not
change the image of the sheet. Because of this, a tileset image that you
cut into frames still works in Tiles.

## Example: a character with the mirror

1. Click **Sprites**.
2. Click **More** > **New image**. Set the size to 32 × 32. Then click
   **Create**.
3. Click **Pixel** in the tool options.
4. Click the first mirror button under the tools.
5. Draw the left half of the head, the body, one arm and one leg. The
   editor draws the right half at the same time.
6. Click the first mirror button again, to turn the mirror off.
7. Click **+** next to **Layers**. On the new layer, draw the things that
   are not the same on the two sides, for example a sword in one hand.
8. Drag the PNG from the **Files** panel into the scene view.

## Example: a walk cycle from a sprite sheet

This example uses `walk-sheet.png`, a sheet with 4 animation frames in one
row.

1. In the **Files** panel, click the upload button. Then select
   `walk-sheet.png`.
2. In the **Files** panel, click **New**. Then click **Sprite**.
3. Click **More** > **Import sprite sheet**.
4. In **Image**, select `walk-sheet.png`.
5. In **Cut by**, select **Columns × rows**. Set **Columns** to 4. Set
   **Rows** to 1.
6. Type `walk` in **Animation**. Set **Frames per second** to 8.
7. Click **Import**.
8. In a scene, set the `image` of a `Sprite` to the `.sprite` file of the
   new sprite, for example `sprites/sprite.sprite`.
9. In the script of the sprite, play the animation:

```lua
function ready()
  play("walk")
end
```

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
| R and Shift+R | Turns the selection (or all of the image) a quarter turn to the right or to the left |
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

The pressure of the pen can change the brush and the eraser. Click the
**Pen** button in the tool options. Then select what the pressure changes:

| Pressure changes | What a light touch does |
| --- | --- |
| **Nothing** | Each stroke has the full size and opacity |
| **Size** | A light touch makes a thin line |
| **Opacity** | A light touch makes a faint line |
| **Size and opacity** | A light touch makes a thin, faint line |

**Lightest touch gives** in the same menu sets how much of the size or the
opacity the lightest touch gives. The default is 10%. At 0%, the lightest
touch paints almost nothing.

There is one **Pen** setting for smooth brushes and one for pixel brushes.
The brush, the eraser and the eraser end of the pen all use it. For smooth
brushes, the default is **Size**. For pixel brushes, the default is
**Nothing**, so pixel art keeps hard, even lines.

In one stroke, each pixel keeps the strongest paint that the stroke gave
it. Because of this, a light stroke at 100% opacity stays light, also
where it crosses itself. A light press of the eraser erases only part of
the color. While you paint with the pen, the circle of the brush shows the
size that the pressure gives. The pressure does not change strokes that
you make with a mouse.

To use an image in a scene, drag the file from the **Files** panel into the
scene view. The editor makes a `Sprite` piece that shows it.
