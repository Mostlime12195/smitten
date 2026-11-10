# Animation

An **Animator** piece changes the properties of pieces over time. You give
it **keys**: a key is a value at a time. Between two keys, the Animator
changes the value smoothly. An animation can change any property of any
piece: a position, a color, the text of a Text piece, the `animation` of a
Sprite.

An animation can also call methods at the times that you choose. Use these
**call keys** to play a sound or to send an event when the animation gets
to a point.

You make animations in the **Animate** panel, under the scene view. A
script plays them with `play()` and can wait until an animation ends.

The Animator does not replace the animations of a `.sprite` file. A Sprite
plays its own animation frames. An Animator can change which animation a
Sprite plays, with a key for the `animation` property of the Sprite.

## Where the Animator goes

Put the Animator inside the piece that it animates. An Animator can change
its parent and all the pieces inside its parent. Each animation of an
Animator has a name, for example `open`, `close` or `idle`. An Animator can
have many animations, and it plays one at a time.

If a scene uses the same animated thing many times (a door, a coin), put the
Animator in the scene of that thing. Each placed copy then has its own
Animator, and the copies play their animations separately.

## A door that opens

This example makes a door that slides up and plays a creak sound. The door
scene has these pieces:

| Piece | Type | What it is |
| --- | --- | --- |
| `Door` | Group | The root of the door scene |
| `Panel` | Sprite | The image of the door |
| `Creak` | Sound | The creak sound, with `sound` set to a sound file |
| `Anim` | Animator | The animations of the door |

1. Open the door scene.
2. Select `Door` in the Scene panel.
3. Open the **Animate** panel. It is a tab next to **Output**.
4. Click **Add an Animator to Door**.
5. In the Inspector, change the name of the Animator to `Anim`.
6. Click the **+** button in the Animate panel.
7. Type the name `open`.
8. Click **Make**.
9. Set **Length** to `0.5`.
10. Choose **+ Track** › **Panel** › **y**. The panel adds a track with a key
    at 0 seconds. The key has the value that `y` has now.
11. Drag the playhead on the ruler to 0.5 seconds.
12. Click **Record**.
13. In the scene view, drag the Panel up by 64 pixels. The Animate panel
    adds a key at 0.5 seconds with the new `y`.
14. Click **Record** again to stop the recording.
15. Click the new key.
16. In the bar above the tracks, set **Easing** to `outQuad`. The door now
    slows down at the end.
17. Choose **+ Track** › **Creak** › **Call keys**. The panel adds a call
    key that calls `play` on the Sound.
18. Click the play button of the panel to see the animation.

When you make the first animation of an Animator, it also becomes the
`autoplay` of the Animator. Because of this, the door opens when the scene
starts. For a door that opens when the player comes
near, clear `autoplay` in the Inspector. Then a script starts the
animation.

## Open the door from a script

The Animator has the name `Anim`, so the script of the door can use it as
`Anim`. Give the door this script:

```lua
-- scripts/door.lua, on the Door
function open()
  if Anim.playing then return end
  Anim:animate("open")     -- the door opens, and this waits until it is open
  wait(2)
  Anim.speed = -1          -- the same animation, backwards: the door closes
  Anim:animate("open")
  Anim.speed = 1
end
```

A different piece calls `open()`. For example, a Zone on the floor in
front of the door:

```lua
-- scripts/plate.lua, on a Zone
function entered(other)
  if other:is("player") then root():find("Door"):open() end
end
```

`animate()` plays the animation and waits until the animation ends. It
returns `true` when the animation gets to its end. It returns `false` if
`stop()` stops the animation, or if a different animation starts on the
same Animator. As `wait()` does, `animate()` works in `ready()`, in event
functions, in functions that other scripts call, and in a `task`. It does
not work in `update()`, `physicsUpdate()` or `draw()`. In these functions,
use `play()`.

The call key at 0 seconds plays the creak when the door starts to open.
When the animation plays backwards, the call key runs at the end, when the
door is down again.

## Tracks and keys

Each row of the Animate panel is a **track**. A track has a piece and a
property of that piece, or it has the call keys for a piece.

| A key holds | What happens between keys |
| --- | --- |
| A number (`x`, `rotation`, `scaleX`) | The value changes smoothly |
| A color | Each part of the color changes smoothly |
| A list of numbers of the same length (`points`) | Each number changes smoothly |
| `true` or `false`, a word, a file name | The value changes at the time of the next key |

- The **easing** of a key shapes the change from the key before it to this
  key. The easings are the same as for `tween()`: `linear` (the default),
  `outQuad`, `inOutSine`, `outBack`, `outBounce` and the others.
- The easing `step` keeps the value of the key before until the time of
  this key. Then the value jumps.
- Before the first key, the property has the value of the first key. After
  the last key, it has the value of the last key.
- Angles are in degrees, as everywhere in scripts and in the Inspector.

A call key calls a method of its piece, or a function of the script of its
piece. A call key has a method name and values to give to the method:

| Call key | What it does |
| --- | --- |
| `play` on a Sound | Plays the sound |
| `emit` with `"opened"` on a piece | Sends the event `opened` from that piece |
| `shake` with `4, 0.2` on a Camera | Shakes the camera: `shake(4, 0.2)` |
| `explode` on a piece with a script | Calls `function explode()` in that script |

The Animator calls each call key one time each time that the animation goes
past it. If a frame is long, the Animator calls all the keys in that frame,
in their time order. Call keys at the same time run in the order of their
tracks.

## The Animate panel

The panel shows the Animator that you selected last. If you select a piece
that has an Animator inside it, the panel shows that Animator.

| To do this | Do this |
| --- | --- |
| Move the playhead | Click or drag on the ruler |
| See the animation | Click the play button, or press Space |
| Show the saved scene again | Click the stop button |
| Add a key | Double-click a track at a time |
| Select keys | Click a key. Shift-click adds a key to the selection |
| Move keys in time | Drag them |
| Change a key | Select it and use the bar above the tracks: time, value, easing |
| Delete keys | Select them and press Delete |
| Delete a track | Hover over its name and click the **x** |
| Zoom the time | Ctrl and the mouse wheel |

- Keys and the playhead snap to the step in the magnet list. Hold Alt to
  move them without the snap.
- While **Record** is on, a property that you change in the Inspector or in
  the scene view becomes a key at the playhead. The piece itself does not
  change. If you record a new track after 0 seconds, the panel also adds a
  key at 0. That key has the value that the piece had.
- The scene view shows the animation at the playhead. This preview does
  not change the scene file and does not go into the undo history. When
  you close the panel, the scene shows its saved values again.
- Undo and redo work for all changes in the panel.
- If you rename or move a piece, its tracks lose the piece. The panel shows
  these tracks in red. Delete them and make them again.

## Play animations from scripts

<!-- piece:Animator -->
| Property | Type | Default | |
| --- | --- | --- | --- |
| `autoplay` | animation | "" | The animation to play when the scene starts. If it is empty, no animation plays until a script calls play(). |
| `speed` | number | 1 | How fast animations play: 2 is two times as fast, and -1 plays them backwards. |
| `physicsStep` | bool | false | When this is on, the animation moves on with each physics step (60 times per second), not with each frame. Use it to animate Bodies. |

`playing`: True while an animation plays.

`current`: The name of the current animation (playing or paused), or "" if there is none.

`position`: Where the current animation is, in seconds from its start.

| Method | |
| --- | --- |
| `play(name?, restart?)` | Plays an animation, or continues the current animation. With restart, the animation starts again from its start. |
| `pause()` | Stops the animation where it is. play() continues it. |
| `stop()` | Stops the animation and puts the pieces back to the values at its start. |
| `seek(seconds)` | Moves the current animation to a time and gives the pieces the values of that time. |
| `animate(name?, restart?)` | Plays an animation and waits until it ends (in ready(), events and tasks). Returns true if the animation got to its end, false if it stopped before. |
| `hasAnimation(name)` | Returns true if the Animator has an animation with this name. |
| `getLength(name?)` | Returns the length of an animation in seconds (of the current animation if you give no name). |

| Event (a function in its script) | |
| --- | --- |
| `function finished(animation)` | The engine calls it when an animation that does not loop gets to its end. |
<!-- end -->

- `play("walk")` in each frame is safe: if `walk` plays already, it
  continues. To start it again from its start, use `play("walk", true)`.
- `speed` changes how fast all animations of the Animator play. A
  negative speed plays them backwards, from the end to the start.
- `seek(seconds)` does not run the call keys before the new time. A call
  key at the new time runs when the animation continues.
- A paused game also pauses Animators, except Animators inside a piece with
  `pausable` off.
- Turn on `physicsStep` to animate a Body, for example a moving platform.
  Then the platform moves with each physics step, at the same time as the
  bodies that stand on it.

To do something when an animation ends without a task, use the `finished`
event:

```lua
-- scripts/chest.lua, on a Chest that has an Animator called Anim
function ready()
  Anim:on("finished", function(name)
    if name == "open" then spawn("scenes/coin.scene", { x = x, y = y - 20 }) end
  end)
end
```

## The animations in the scene file

The Animator keeps its animations in its `animations` property. A script
can make an Animator with animations in the same form:

```lua
local glow = make("Animator", { autoplay = "pulse", animations = {
  pulse = { length = 1, loop = true, tracks = {
    { piece = ".", property = "brightness", keys = {
      { time = 0, value = 1 },
      { time = 0.5, value = 0.3, easing = "inOutSine" },
      { time = 1, value = 1, easing = "inOutSine" },
    } },
  } },
} })
Lamp:add(glow)   -- the Animator animates Lamp (a Light), its parent
```

- Each animation has a `length` in seconds and `loop` (`true` or `false`).
  If `length` is not there, the animation ends at its last key.
- Each track has `piece`: the path of the piece from the parent of the
  Animator. `"."` is the parent. `"Panel"` is a child of the parent.
  `"Panel/Handle"` is a piece inside the Panel.
- A property track has `property` and `keys`. Each key has `time`, `value`
  and, if it is not `linear`, `easing`.
- A call track has `calls`. Each call key has `time`, `method` and, if the
  method takes values, `args`, a list of the values.
- Values of angles are in degrees. In a project older than version 3, the
  Animator changes them to radians for the piece.

The engine reads the animation each time that `play()` starts it. A script
can change the animations, and the change shows the next time that the
animation starts.
