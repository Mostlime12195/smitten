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

## smitten.storage

<!-- module:storage -->
| Function | |
| --- | --- |
| `smitten.storage.save(key, value)` | Saves a value between plays: smitten.storage.save("best", score). |
| `smitten.storage.load(key, default?)` | Returns a saved value, or default. |
| `smitten.storage.remove(key)` | Deletes a saved value. |
| `smitten.storage.keys()` | Returns the names of all saved values. |
<!-- end -->
