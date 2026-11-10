# Random numbers and noise

`rnd()` gives a new random number each time. Usually you want a different
game each time. Sometimes you want the same "random" numbers again: the
same level from a level number, a daily puzzle, or a replay. A **seed**
does that. **Noise** gives smooth random values for hills, caves, clouds
and wobbling things.

## Seeds

`seed(n)` sets where the random numbers start. After `seed(42)`, `rnd()`
gives the same numbers every time the game runs, in every browser.

```lua
level = 3

function ready()
  seed(level)          -- level 3 is the same every time
  for i = 1, 10 do
    spawn("scenes/coin.scene", { x = rnd(600), y = rnd(300) })
  end
end
```

A seed is a whole number or a string, like `seed("daily 2026-11-10")`.
`seed()` with no number picks a new seed that nobody can guess. It also
returns that seed, so you can show it and use it again later:

```lua
worldSeed = seed()
print("World " .. worldSeed)
```

A seed changes the numbers from `rnd()`, `choose()`, and
`smitten.math.random`, `randomFloat`, `randomNormal`, `chance`, `pick`
and `shuffle`. It does not change Particles or a Camera's shake: they use
random numbers of their own. Lua's own `math.random` also has its own
numbers, and a seed does not change them. Use `rnd()` for numbers that
must repeat.

## Random numbers of their own

A world generator and the game often both need random numbers. If they
use the same numbers, an extra `rnd()` in gameplay changes the world. Give
the generator its own random numbers with `smitten.math.newRandom(seed)`:

```lua
local r = smitten.math.newRandom(worldSeed)
local x = r:rnd(600)             -- the same as rnd(), but its own
local kind = r:choose("tree", "rock", "bush")
```

`newRandom()` with no seed picks one that nobody can guess.

| Method | |
| --- | --- |
| `rnd(n)` | `rnd()`: 0 to 1. `rnd(n)`: 0 to n. `rnd(list)`: one of its items |
| `choose(...)` | One of its arguments |
| `random(a, b)` | A whole number from a to b. `random(n)`: from 1 to n |
| `randomFloat(a, b)` | A number with a fraction, from a to b |
| `randomNormal(spread, middle)` | A number that is usually near `middle` |
| `chance(p)` | True with probability p: `chance(0.25)` is true a quarter of the time |
| `pick(list)` | One item of a list |
| `shuffle(list)` | Puts the items of the list in a random order, and returns the list |
| `getSeed()`, `setSeed(seed)` | The seed it started from, and a new start |
| `getState()`, `setState(state)` | Where it is now, as a string. Save the string, and continue from the same place later |

## Noise

`noise(x, y)` gives a value from 0 to 1. Points that are close together
give values that are close together, so the values go up and down
smoothly. The same point always gives the same value. Use `noise(x)` for
a line and `noise(x, y, z)` for 3D. Make `z` the time for noise that
changes slowly:

```lua
function update(dt)
  rotation = (noise(time() * 2) - 0.5) * 20   -- a gentle wobble
end
```

For terrain, `smitten.math.newNoise(options)` makes noise with these
options:

| Option | Default | |
| --- | --- | --- |
| `seed` | (a new one) | A different seed gives a different landscape. The same seed gives the same landscape |
| `scale` | 100 | The size of the hills and holes, in the units you give to `get()` |
| `octaves` | 1 | Layers of finer detail on top: 3 or 4 make rough, natural shapes |
| `roughness` | 0.5 | How strong each finer layer is: 0 gives only the first layer |

`n:get(x, y)` gives the value at a point, from 0 to 1. `get(x)` and
`get(x, y, z)` also work. You can change the options
later: `n.scale = 20`. `n:getSeed()` gives the seed.

Noise with more octaves stays nearer the middle, 0.5, more of the time.

## Example: a cave and hills from a seed

This script is on a Tiles piece. It fills the Tiles with rock where the
noise is high, and leaves air where it is low. Then it cuts the sky above
a line of hills. The same `caveSeed` always makes the same cave.

```lua
caveSeed = 1
rock = 0             -- the tile to fill with

function ready()
  local cave = smitten.math.newNoise({ seed = caveSeed, scale = 12, octaves = 3 })
  local hills = smitten.math.newNoise({ seed = caveSeed, scale = 30, octaves = 2 })
  for column = 0, 59 do
    local ground = math.floor(5 + hills:get(column) * 10)
    for row = ground, 29 do
      if cave:get(column, row) > 0.5 then setTile(column, row, rock) end
    end
  end
end
```

- Change `caveSeed` in the Inspector for another cave.
- Change `0.5` to change how much of it is rock.
- Change `scale` to make the holes bigger or smaller.
- To fill the Tiles again, call `clear()` first.

## Reference

| Call | |
| --- | --- |
| `seed(n)` | `seed(42)`: the random numbers repeat after it. `seed()`: numbers that nobody can guess. Returns the seed |
| `noise(x, y, z)` | Smooth noise from 0 to 1 at a point (`y` and `z` are optional) |
| `smitten.math.seed(n)` | The same as `seed(n)` |
| `smitten.math.noise(x, y, z)` | The same as `noise(x, y, z)` |
| `smitten.math.newRandom(seed)` | Random numbers of their own, with the methods above |
| `smitten.math.newNoise(options)` | Noise with a seed, a scale and octaves. Its `get(x, y)` gives a value from 0 to 1 |
| `smitten.math.shuffle(list)` | Puts the items of a list in a random order, and returns the list |
