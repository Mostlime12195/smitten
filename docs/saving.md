# Saving

`save(key, value)` keeps a value after the game closes, and
`load(key, default)` reads it back, or gives `default` when nothing has
been saved under that name yet. That's all you need for high scores,
settings and progress:

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
| `load(key, default)` | A saved value, or default: load("best", 0). |
<!-- end -->

Saved values can be numbers, text, true/false and tables of those, so a
whole save game fits in one table:

```lua
save("progress", { level = 3, coins = 120, unlocked = { "dash" } })
local progress = load("progress", { level = 1, coins = 0, unlocked = {} })
```

## Where saves live

Each game keeps its own saves, named after the project (or after
`identity` in `smitten.json`), so two games never mix them up. Renaming a
project starts it with no saves. In the browser, saves belong to the site
the game is played on: the same game on itch.io and on the sharing site
keeps separate saves.

## smitten.storage

<!-- module:storage -->
| Function | |
| --- | --- |
| `smitten.storage.save(key, value)` | Saves a value between plays: smitten.storage.save("best", score). |
| `smitten.storage.load(key, default?)` | A saved value, or default. |
| `smitten.storage.remove(key)` | Forgets a saved value. |
| `smitten.storage.keys()` | Every saved value's name. |
<!-- end -->
