# Saving

`save(key, value)` keeps a value after the game closes.
`load(key, default)` gives the value back. If there is no saved value with
that name, `load()` gives `default`. These two functions are sufficient for
high scores, the choices of the player (for example, the volume) and
progress:

```lua
score = 0
best = 0

function ready()
  best = load("best", 0)
end

function gameOver()
  if score > best then
    best = score
    save("best", best)
  end
end
```

<!-- api:Saving -->
| Call | |
| --- | --- |
| `save(key, value)` | Keeps a value between plays: save("best", score). |
| `load(key, default)` | Returns a saved value, or default: load("best", 0). |
<!-- end -->

A saved value can be a number, text, true or false, or a table of these.
You can keep all the progress of a player in one table:

```lua
save("progress", { level = 3, coins = 120, unlocked = { "dash" } })
local progress = load("progress", { level = 1, coins = 0, unlocked = {} })
```

## Where saves live

Each game keeps its own saves. The name of the saves is the name of the
project, or the `identity` setting in `smitten.json` if it has one. Because of this,
the saves of two games do not mix.

- If you rename a project, it starts with no saves.
- In a browser, the saves belong to the website where the game runs. The
  same game on itch.io and on the games site keeps different saves.

## Saves in the cloud

`save()` keeps values on the computer of the player. Some players play on
a different computer each time, for example at school. With
`smitten.cloud`, a game can also keep values on the account of the player
on the games site.

- `save()` and `load()` do not change. They always use this computer.
- `smitten.cloud` does nothing by itself. The game must call it.
- Cloud saves work only when a host page keeps them. On the games site,
  the player must be signed in. Other sites can keep cloud saves too (see
  [Host interface](host-interface.md)).

Each call waits for the answer, as `wait()` waits. Use it in `ready()`, in
an event or in a `task()`. The call gives the result, or `nil` and the
reason:

```lua
local ok, why = smitten.cloud.save("progress", progress)
local progress, why = smitten.cloud.load("progress")
```

### A worked example

This game always saves on the computer. When the player clicks the
**Save** button, it also saves in the cloud. When the game starts, it
loads the two saves, and uses the newer one. Each save keeps the time
(`os.time()`, in seconds) to find the newer one.

```lua
-- scripts/game.lua, on the root of the main scene.
-- The scene has a Button called SaveButton and a Label called Status.
progress = nil

local function newer(a, b)
  if a == nil then return b end
  if b == nil then return a end
  return if (b.time or 0) > (a.time or 0) then b else a
end

local function saveGame()
  progress.time = os.time()
  save("progress", progress)
  if not smitten.cloud.available() then
    Status.text = "Saved"
    return
  end
  local ok, why = smitten.cloud.save("progress", progress)
  Status.text = if ok then "Saved in the cloud" else `Saved on this computer only ({why})`
end

function ready()
  local here = load("progress", nil)
  local there = nil
  if smitten.cloud.available() then
    there = smitten.cloud.load("progress")
  end
  progress = newer(here, there) or { level = 1, coins = 0, time = 0 }
  SaveButton:on("clicked", function() task(saveGame) end)
end
```

On the games site, a player who is not signed in gets `"signed-out"`. The
game then keeps its save on the computer, as before.

### Keys and values

- A key has 1 to 64 letters, digits, `_`, `.` or `-`. The first character
  is a letter or a digit: `"progress"`, `"slot1"`, `"settings.v2"`.
- A value is the same as for `save()`: a number, text, true or false, or a
  table of these.
- A cloud save and a local save with the same key are different saves.
- A wrong key, a value of `nil` or a function in the value is an error.
  The error tells what to do.

### Limits on the games site

| Limit | |
| --- | --- |
| One value | 64 KB (65,536 bytes) as JSON |
| All the values of one game, for one player | 256 KB, and 32 keys |
| Saves and removes | 300 in one hour, for each player |
| Loads and lists | 1200 in one hour, for each player |

Save when something important happens: the player clicks **Save**, or
gets to a checkpoint. Do not save in each frame.

On the account page of the games site, players can see which games keep
cloud saves. They can delete the cloud saves of a game there. If a player
deletes the account, or the maker deletes the game, the cloud saves go
too.

### When it does not work

When a call gives `nil`, the second value tells the cause:

| Cause | What happened |
| --- | --- |
| `"unavailable"` | No host page keeps cloud saves: **Play** in the editor, or an exported game alone |
| `"signed-out"` | The player is not signed in to the games site |
| `"missing"` | `load()` found no save with this key |
| `"too-big"` | The value is longer than 64 KB as JSON |
| `"quota"` | The game has too many keys, or too many bytes, for this player |
| `"too-many"` | Too many saves or loads in the last hour |
| `"busy"` | Too many calls at the same time. Wait for the answers before you ask again |
| `"timeout"`, `"offline"` | The games site did not answer |
| `"needs-callback"` | A call to `load()` or `list()` from `update()`, without a function to give the answer to |

From `update()`, give a function as the last argument. The call returns
at once, and the engine calls the function with the answer later:

```lua
smitten.cloud.load("progress", function(value, why)
  if value then progress = value end
end)
```

To try cloud saves, publish the game, sign in to the games site, and play
the game on its page.

<!-- module:cloud -->
| Function | |
| --- | --- |
| `smitten.cloud.available()` | Returns true if the host keeps cloud saves. On the games site, it is true also when the player is not signed in. |
| `smitten.cloud.save(key, value, callback?)` | Keeps a value on the account of the player: smitten.cloud.save("progress", progress). Waits, then returns true, or nil and the reason. |
| `smitten.cloud.load(key, callback?)` | Returns the value of the cloud save with this key. Returns nil and the reason if it cannot. The reason is "missing" if there is no save. |
| `smitten.cloud.list(callback?)` | Returns the cloud saves of the game: a list of { key, size, time }, sorted by key. |
| `smitten.cloud.remove(key, callback?)` | Deletes a cloud save. Returns true, also if there was no save. |
<!-- end -->

## smitten.storage

<!-- module:storage -->
| Function | |
| --- | --- |
| `smitten.storage.save(key, value)` | Saves a value between plays: smitten.storage.save("best", score). |
| `smitten.storage.load(key, default?)` | Returns a saved value, or default. |
| `smitten.storage.remove(key)` | Deletes a saved value. |
| `smitten.storage.keys()` | Returns the names of all saved values. |
<!-- end -->
