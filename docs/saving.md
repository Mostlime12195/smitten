# Saving

`save(key, value)` keeps a value between plays; `load(key, default)` reads
it back, or `default` if nothing was saved under that name.

```lua
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

Values are numbers, strings, booleans and tables of them (no pieces or
functions): a whole save game fits in one table.

```lua
save("progress", { level = 3, coins = 120, unlocked = { "dash", "double jump" } })
local progress = load("progress", { level = 1, coins = 0, unlocked = {} })
```

## Where saves go

Saves belong to the game: each game has its own save folder, named after
the project (or `"identity"` in `smitten.json`, or `t.identity` in
`conf.lua`), so two games never read each other's saves. In the browser
they're kept in the browser's storage for the site the game runs on; on
desktop, in LÖVE's save folder. Renaming a project starts it with empty
saves.

## smitten.storage

<!-- module:storage -->
| Function | |
| --- | --- |
| `smitten.storage.save(key, value)` | Saves a value between plays: smitten.storage.save("best", score). |
| `smitten.storage.load(key, default?)` | A saved value, or default. |
| `smitten.storage.remove(key)` | Forgets a saved value. |
| `smitten.storage.keys()` | Every saved value's name. |
<!-- end -->

For files of your own (a level editor's levels, a replay),
[`smitten.filesystem`](https://love2d.org/wiki/love.filesystem) writes to
the same save folder.
