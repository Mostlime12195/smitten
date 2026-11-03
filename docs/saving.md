# Saving

`save(key, value)` stores a value between plays; `load(key, default)` reads
it.

```lua
best = load("best", 0)
if score > best then save("best", score) end
```

Values can be numbers, strings, booleans and tables of them.

<!-- api:Saving -->
| Call | |
| --- | --- |
| `save(key, value)` | Keeps a value between plays: save("best", score). |
| `load(key, default)` | A saved value, or default: load("best", 0). |
<!-- end -->

Each game has its own save folder, named after the project (or
`"identity"` in `smitten.json`). Renaming the project starts with empty
saves. In the browser, saves are per site: the same game on two sites has
separate saves.

## smitten.storage

<!-- module:storage -->
| Function | |
| --- | --- |
| `smitten.storage.save(key, value)` | Saves a value between plays: smitten.storage.save("best", score). |
| `smitten.storage.load(key, default?)` | A saved value, or default. |
| `smitten.storage.remove(key)` | Forgets a saved value. |
| `smitten.storage.keys()` | Every saved value's name. |
<!-- end -->

For other files, [`smitten.filesystem`](https://love2d.org/wiki/love.filesystem)
writes to the same folder.
