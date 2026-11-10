# Leaderboards

A game that you publish on the games site can have **leaderboards**. A
leaderboard is a list of the best scores (or the fastest times) of all
the players of the game. Leaderboards are optional. A game has no
leaderboards until you add one. A game that uses leaderboards also works
in all other places, without them.

> Each player's browser sends the scores of the game. For this reason, a
> player who wants to cheat can send a false score. Use leaderboards for fun, not for
> prizes. You can remove a score, or reset a full leaderboard, at any time.

## Adding a leaderboard

1. Publish the game.
2. On the games site, open your **account page**.
3. Find the game under *Your games*.
4. Click **Leaderboards**.
5. Give the leaderboard a **title**, for example "High scores".
6. Give the leaderboard a short **key** for your scripts, for example
   "best".
7. Choose what wins: the highest score, the lowest score, or the fastest
   time. The games site shows a time in seconds as `1:23.45`.

The leaderboard shows below the game on its page, with the ten best
scores. A game can have a maximum of 10 leaderboards (for example, one for
each level). Each leaderboard has its own key. On the account page, you
can also do these things to a leaderboard:

- **Rename** it.
- **Reset** it, which removes all its scores.
- **Delete** it.

On the page of the game, you get a **Remove** button next to each score.
Only you see these buttons.

## Sending a score

`smitten.boards.submit(key, value)` sends a score to the leaderboard with
that key. In `ready()`, in an event or in a `task()`, it waits for the
answer from the games site, as `wait()` waits:

```lua
-- scripts/game.lua, on the root of the main scene
score = 0

function gameOver()
  if smitten.boards.available() then
    local result = smitten.boards.submit("best", score)
    if result and result.improved then
      Message.text = `New best! You're number {result.rank}`
    end
  end
  showScores()
end
```

`result` is a table with these fields:

- `rank`: the position of the player on the leaderboard.
- `value`: the best score of the player until now.
- `improved`: true when this score is better than the old best score of
  the player.

If there is a problem, `submit` gives `nil` and a word that tells the
cause (see [below](#when-it-does-not-work)). It never stops the game with
an error.

## Showing the top scores

`smitten.boards.top(key, count)` gives the best scores, with the best
score first. It gives a list of rows. Each row has `rank`, `name` and
`value`, and the row of the player has `me = true`. This example uses one
Label for each line: ten Labels with the names `Row1` to `Row10`, inside a
Panel with the name `Scores`.

```lua
function showScores()
  local rows = smitten.boards.top("best", 10)
  for i = 1, 10 do
    local label = Scores:find("Row" .. i)
    local row = rows and rows[i]
    if row then
      label.text = `{row.rank}. {row.name}  {row.value}`
      label.color = row.me and { 1, 0.85, 0.3 } or { 1, 1, 1 }
    else
      label.text = ""
    end
  end
end
```

`smitten.boards.around(key, count)` gives the rows around the score of the
player. This is good when the player is in position 250, for example.
`smitten.boards.list()` gives the leaderboards of the game.

<!-- module:boards -->
| Function | |
| --- | --- |
| `smitten.boards.available()` | True while the game runs on its page on the games site and has leaderboards there. False in the editor and in exported games. |
| `smitten.boards.submit(key, value, options?, callback?)` | Sends a score to a leaderboard: smitten.boards.submit("best", score). options: { name = "Ada" } for someone not signed in. Answers { rank, value, improved }, or nil and why. |
| `smitten.boards.top(key, count?, callback?)` | The best scores, best first: a list of { rank, name, value, me, guest } (10 unless count says, 100 at most), or nil and why. |
| `smitten.boards.around(key, count?, callback?)` | The scores around the player's own (the top, if they have none). |
| `smitten.boards.list(callback?)` | The game's leaderboards: a list of { key, title, order, format, unit, scores }. |
<!-- end -->

### From update()

`update()` and `draw()` cannot wait. In these functions, give a function
as the last argument. The engine calls that function when the answer
comes:

```lua
function update(dt)
  if pressed("tab") then
    smitten.boards.top("best", 10, function(rows, why)
      if rows then show(rows) end
    end)
  end
end
```

If you call `submit` from `update()` without a function, it still sends
the score. But it does not tell you the result.

## Who the player is

- A player who is **signed in** to the games site shows with their display
  name. Their scores are part of their account.
- All other players are **guests**. The name of a guest is the name that
  the game gives: `smitten.boards.submit("best", score, { name = "Ada" })`.
  - A name has 1 to 12 characters: letters, numbers, spaces, `-` and `_`.
  - The word filter of the games site checks each name.
  - If there is no name, the row shows "Guest".
  - Guests show in grey on the page of the game, and their rows have
    `guest = true`.
- If your game asks for a name, ask for a nickname. Never ask for a real
  name.

A leaderboard keeps one score for each player: the best score. A guest is
the same player while the guest uses the same name from the same network.

## When it does not work

Leaderboards work only while the game runs **on its page on the games
site**. In other places, `smitten.boards.available()` is false. Some
examples are **Play** in the editor and an exported game (on itch.io, for
example). There, all calls give `nil, "unavailable"` immediately.
Because of this, the same game works in all places:

```lua
if smitten.boards.available() then
  smitten.boards.submit("best", score)
end
```

To try your leaderboard, publish the game and play it on its page.

When a call gives `nil`, the second value tells the cause:

| Cause | What happened |
| --- | --- |
| `"unavailable"` | The game is not on its page on the games site, or it has no leaderboards there |
| `"no-board"` | The game has no leaderboard with that key (look at the key on your account page) |
| `"bad-value"` | The score is not a number |
| `"out-of-range"` | The score is outside the range that the leaderboard permits |
| `"bad-name"` | The name of the guest is too long, has other characters, or has a word that the games site does not permit |
| `"too-many"` | Too many scores from this player or network in the last hour |
| `"busy"` | Too many calls at the same time. Wait for the answers before you ask again |
| `"timeout"`, `"offline"` | The games site did not answer |
| `"needs-callback"` | A call to `top()` from `update()`, without a function to give the answer to |

## Keeping it fair

A score is only a number that the game sends. The game runs on the
computer of the player. For this reason, nothing can prove that a score is real. The
games site keeps the scores in limits:

- Scores must be numbers.
- Each player and each network can send only a limited number of scores
  in one hour.
- The word filter checks the names.
- A leaderboard keeps its best 1000 scores.

For more protection, do these things:

- Use scores that give a cheater little reason to make false ones. Do not
  promise prizes for scores.
- Look at your leaderboards from time to time. On the page of the game,
  **Remove** the scores that cannot be real, or **Reset** the leaderboard.
- Give the leaderboard a lowest and a highest permitted score (`min` and
  `max`, through the API of the games site. See the README of the site).
  This stops the most obvious false scores. For example, nobody gets
  999,999,999 in a game where the maximum is 5,000.
