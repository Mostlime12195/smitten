# Leaderboards

A game published on the sharing site can have **leaderboards**: lists of
the best scores (or fastest times) that everyone who plays it shares. They
are optional. A game has none until you add one, and a game that uses them
still works everywhere else, without them.

> Scores are sent by the game from each player's browser, so someone who
> wants to cheat can send a made-up score. Leaderboards are for fun, not
> for prizes. You can remove a score, or reset a whole board, any time.

## Adding a leaderboard

1. Publish the game.
2. On the site, open your **account page**, find the game under *Your
   games* and choose **Leaderboards**.
3. Give the board a **title** ("High scores"), a short **key** your
   scripts use ("best"), and choose what wins: the highest score, the
   lowest score, or the fastest time (seconds, shown as `1:23.45`).

The board appears under the game on its page, with the ten best scores.
A game can have up to 10 boards (one per level, say), each with its own
key. From the same place you can **rename** a board, **reset** it (remove
every score) or **delete** it. On the game's own page, you (and only you)
get a **Remove** button next to every score.

## Sending a score

`smitten.boards.submit(key, value)` sends a score to the board with that
key. In `ready()`, an event or a `task()` it waits for the site's answer,
the way `wait()` waits:

```lua
-- scripts/game.lua, on the main scene's root
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

`result` is a table: `rank` (the player's place on the board), `value`
(their best score so far) and `improved` (true when this score beat their
old one). When something went wrong, `submit` gives `nil` and a word that
says why (see [below](#when-it-doesnt-work)); it never stops the game with
an error.

## Showing the top scores

`smitten.boards.top(key, count)` gives the best scores, best first: a list
of rows, each with `rank`, `name`, `value`, and `me = true` on the
player's own row. With a Label for each line (here ten Labels named
`Row1` to `Row10` inside a Panel called `Scores`):

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

`smitten.boards.around(key, count)` gives the rows around the player's own
score instead (handy when they're 250th), and `smitten.boards.list()` the
game's boards.

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

`update()` and `draw()` can't wait, so there these functions take a
function to call when the answer arrives, as their last argument:

```lua
function update(dt)
  if pressed("tab") then
    smitten.boards.top("best", 10, function(rows, why)
      if rows then show(rows) end
    end)
  end
end
```

`submit` without a function still sends the score from `update()`; it just
doesn't tell you how it went.

## Who the player is

- Someone **signed in** to the site appears under their display name.
  Their scores follow their account.
- Anyone else is a **guest**. A guest's name is whatever the game passes:
  `smitten.boards.submit("best", score, { name = "Ada" })`. Names are 1 to
  12 letters, numbers, spaces, `-` and `_`, and go through the site's word
  filter; with no name, the row says "Guest". Guests show in grey on the
  game's page, and rows have `guest = true`. If your game asks for a name,
  ask for a nickname, never a real name.

A board keeps one score per player, their best. A guest counts as the same
player while they use the same name from the same network.

## When it doesn't work

Leaderboards only work while the game runs **on its page on the sharing
site**. In the editor's Play, in an exported game (on itch.io, say) and
anywhere else, `smitten.boards.available()` is false and every call
answers `nil, "unavailable"` straight away, so the same game works
everywhere:

```lua
if smitten.boards.available() then
  smitten.boards.submit("best", score)
end
```

To try your leaderboard, publish the game and play it on its page.

The second value says why a call gave `nil`:

| Why | What happened |
| --- | --- |
| `"unavailable"` | The game isn't on its page on the site, or it has no boards there |
| `"no-board"` | The game has no board with that key (check the key on your account page) |
| `"bad-value"` | The score wasn't a number |
| `"out-of-range"` | The score is outside the range the board allows |
| `"bad-name"` | The guest's name is too long, has other characters, or a word the site doesn't allow |
| `"too-many"` | Too many scores from this player or network in the last hour |
| `"busy"` | Too many calls at once: wait for answers before asking again |
| `"timeout"`, `"offline"` | The site didn't answer |
| `"needs-callback"` | `top()` from `update()` without a function to give the answer to |

## Keeping it fair

A score is just a number the game sends, and a game runs on the player's
computer, so nothing can prove a score is real. The site keeps things
within bounds: scores must be numbers, each player and network can send
only so many an hour, names are filtered, and a board keeps its best 1000
scores. Beyond that it's up to you:

- Send scores a cheater gains little from faking, and don't promise
  prizes for them.
- Look at your boards now and then. **Remove** scores that can't be real
  on the game's page, or **Reset** the board.
- A board can have a lowest and highest allowed score (`min` and `max`
  through the site's API, see the site's README), which stops the laziest
  fakes: nobody scores 999,999,999 in a game that tops out at 5,000.
