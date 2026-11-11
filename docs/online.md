# Online rooms

A game on the games site can let players in different places play
together. The players join a **room**. Each player in a room is a
**peer**. `smitten.net` sends **messages** from one peer to the others.

`smitten.net` only carries messages. Your game decides what the messages
mean, who moves what, and what to do when the messages are late. The
[last section](#what-the-engine-does-not-do) tells what the engine does not
do for you.

Online rooms work only while the game runs on its page on the games site.
In other places, the game still runs, and every call gives `nil,
"unavailable"` (see [Testing](#testing-an-online-game)).

## Joining a room

`smitten.net.join(room, options)` puts the player in a room. If nobody is
in the room, it makes the room first. In `ready()`, in an event or in a
`task()`, `join()` waits until the player is in the room, as `wait()`
waits. Then it gives your own peer:

```lua
-- scripts/game.lua, on the root of the main scene
function ready()
  local me, why = smitten.net.join("arena", { maxPlayers = 4 })
  if me then
    Status.text = `You are {me.name}`
  else
    Status.text = `No online play now ({why})`
  end
end
```

The room name is a short text:

- It has 1 to 32 characters: letters, numbers, spaces, `_`, `.` and `-`.
- Upper case and lower case are the same: "Arena" and "arena" are one
  room.
- A room belongs to your game. Another game can have a room with the same
  name, and its players never meet yours.

The options are:

| Option | |
| --- | --- |
| `maxPlayers` | The most players in the room, from 2 to 16. If you do not give it, the room takes 8. Only the player who makes the room sets it |
| `name` | The name for a player who is not signed in to the games site (see [Players and names](#players-and-names)) |

The games site does not show a list of rooms. Because of this, a room name
is also a code. For a private room, make a random code and show it to the
player. The player tells the code to friends, who join with it:

```lua
function ready()
  local code = ""
  for i = 1, 5 do
    code = code .. choose("A", "C", "D", "E", "F", "H", "K", "M", "N", "P", "R", "T", "X")
  end
  Code.text = `Room code: {code}`
  smitten.net.join(code)
end
```

`update()` and `draw()` cannot wait. In these functions, give a function
as the last argument. The engine calls it with the same values that
`join()` gives in `ready()`:

```lua
function update(dt)
  if pressed("jump") and not smitten.net.room() then
    smitten.net.join("arena", function(me, why)
      if not me then print("No room: " .. why) end
    end)
  end
end
```

`smitten.net.leave()` takes the player out of the room. The other peers
get `peerLeft()`. You get no event. Call `leave()` before you join another
room.

## Peers

A peer is a table with these fields:

| Field | |
| --- | --- |
| `id` | A number. It is different for each peer in the room. The first peer in a room has the id 1 |
| `name` | The name of the player |
| `guest` | True if the player is not signed in to the games site |
| `me` | True on your own peer only |

The engine keeps one table for each peer. Because of this, you can use a
peer as a key in a table (`dots[peer] = dot`) and compare two peers with `==`.

| Function | |
| --- | --- |
| `smitten.net.me()` | Your own peer |
| `smitten.net.peers()` | All the peers in the room, you too, in the order that they came in |
| `smitten.net.peer(id)` | The peer with this id |
| `smitten.net.room()` | The name of the room, or `nil` when you are not in a room |
| `smitten.net.host()` | The host |
| `smitten.net.isHost()` | True if you are the host |

The **host** is the peer that is in the room for the longest time. When
the host leaves, the next peer becomes the host. The host is only a fact
that all peers agree about. The engine gives the host no other power. Your
game can use it. For example, the host can start each round, or decide
who caught the ball.

## Sending messages

`smitten.net.send(peer, data)` sends data to one peer. You can give the
peer or its id. `smitten.net.broadcast(data)` sends data to all the other
peers in the room:

```lua
smitten.net.broadcast({ x = round(x), y = round(y) })
smitten.net.send(peer, { kind = "welcome", score = score })
```

Both give `true` when the message goes out. They give `nil` and the reason
when it cannot go (`"not-in-room"`, or `"no-peer"` when the peer is not in
the room). They never wait. Because of this, you can call them in
`update()`.

The data can be:

- a number, a text, `true` or `false`, or `nil`,
- a list (`{ 1, 2, 3 }`, with no gaps),
- a table with text keys (`{ x = 10, name = "Ada" }`),
- lists and tables inside lists and tables.

The data goes as JSON. It can have a maximum of 8192 bytes as JSON.
A function, a piece, a table that contains itself, or a table with
number keys that is not a list cannot go. Then `send()` stops the game
with an error that tells which part of the data is wrong. This shows the
problem while you test in the editor, too. Send the values that you need
from a piece, for example `{ x = p.x, y = p.y }`.

Messages from one peer arrive in the order that the peer sent them. A
message does not come back to the peer that sent it.

## Events

The engine calls these functions in each script that has them, on all
the pieces of the running scene:

| Function | |
| --- | --- |
| `function peerJoined(peer)` | The engine calls it when a peer comes into your room, and once for each peer that is in the room when you join. |
| `function peerLeft(peer)` | The engine calls it when a peer leaves your room. |
| `function message(from, data)` | The engine calls it when a message from another peer arrives. data is what the peer sent. |
| `function disconnected(reason)` | The engine calls it when you are not in the room any more, but did not call leave(). reason tells why. |

When you join, `join()` gives your peer first. Then the engine calls
`peerJoined()` for each peer that was in the room before you. Because of
this, one `peerJoined()` can make the things of all the other players.

A room stays when the scene changes. The pieces of the new scene get the
events of the same room.

## A worked example

The **Online dots** example on the home screen of the editor is a small
online room. Each player moves a dot with the arrow keys, and sees the
dots of the other players. The game makes its own rules:

- Each player **owns** one dot. Only its owner moves it.
- The owner sends the position of its dot, at most 15 times per second,
  and only when the dot moved.
- The other players move their copy of the dot toward the last position
  that came, a part of the way in each frame. Because of this, the copy
  moves smoothly between two messages. This is **interpolation**.

These rules are the choice of this game. A different game can choose
other rules. For example, a card game can send each move one time, and
let the host check each move.

The script, a little shorter:

```lua
local net = smitten.net
speed = 260
sendRate = 15
smoothing = 12

local mine = nil
local others = {}   -- a peer's id -> { dot, x, y }
local untilSend = 0

function ready()
  mine = spawn("scenes/dot.scene", { x = 640, y = 360 })
  net.join("dots", { maxPlayers = 8 })
end

-- The engine calls this for each peer that was there first, and for each new peer.
function peerJoined(peer)
  local dot = spawn("scenes/dot.scene", { x = mine.x, y = mine.y, visible = false })
  others[peer.id] = { dot = dot, x = 0, y = 0 }
  -- The new peer does not know where your dot is: tell only that peer.
  net.send(peer, { x = round(mine.x), y = round(mine.y) })
end

function peerLeft(peer)
  local other = others[peer.id]
  if other then
    other.dot:destroy()
    others[peer.id] = nil
  end
end

function message(from, data)
  local other = others[from.id]
  if other == nil then return end
  other.x, other.y = data.x, data.y
  if not other.dot.visible then
    other.dot.x, other.dot.y = data.x, data.y
    other.dot.visible = true
  end
end

function update(dt)
  local mx, my = vector("left", "right", "up", "down")
  mine.x += mx * speed * dt
  mine.y += my * speed * dt

  untilSend -= dt
  if net.room() and untilSend <= 0 and (mx ~= 0 or my ~= 0) then
    net.broadcast({ x = round(mine.x), y = round(mine.y) })
    untilSend = 1 / sendRate
  end

  -- A part of the way in each frame, the same part at any frame rate.
  local part = 1 - math.exp(-smoothing * dt)
  for _, other in pairs(others) do
    other.dot.x = lerp(other.dot.x, other.x, part)
    other.dot.y = lerp(other.dot.y, other.y, part)
  end
end
```

## Players and names

- A player who is **signed in** to the games site has their display
  name.
- All other players are **guests**. The name of a guest is the `name`
  option of `join()`. A name has 1 to 12 characters: letters, numbers,
  spaces, `-` and `_`. The word filter of the games site checks it. If
  there is no name, the guest is "Guest" and the id, for example "Guest 3".
- If your game asks for a name, ask for a nickname. Never ask for a real
  name.

Online rooms have no chat. Players see only what your game shows. If your
game lets players type text for others, they can send words that hurt.
Do not let them do this.

## Limits

The games site keeps each room small, and each game fair to the other
games:

| Limit | |
| --- | --- |
| Players in a room | 2 to 16, 8 if you do not give `maxPlayers` |
| Data in one message | 8192 bytes as JSON |
| Messages from one player | 30 per second |
| Data from one player | 32 KB per second |
| Rooms of one game | 100 at the same time |
| Connections from one network | 8 |
| A room with no messages | closes after 15 minutes |
| A connection that drops | keeps its place for 10 seconds |

When a player sends too many messages or too much data, the games site
does not send the messages above the limit. The game shows a warning in the
**Output** (or in the console of the browser). Send fewer messages, not
more. For most games, 10 to 20 messages per second are enough.

## When the connection drops

If the connection of a player drops, the page of the game tries to connect
again for a few seconds. The player keeps their place in the room for 10
seconds. If the connection comes back, the game does not see a change. The
messages that went out or came in while the connection was down do not arrive.
Then, if peers came or went in that time, the engine calls
`peerJoined()` and `peerLeft()` for them.

If the connection does not come back, the engine calls
`disconnected(reason)`. The other peers get `peerLeft()`.

While the player cannot see the tab of the game, the game does not run.
The messages wait. If too many messages wait, the page does not keep the
new messages. `peerJoined()` and `peerLeft()` always come.

## Testing an online game

Online rooms work only on the page of the game on the games site. With
**Play** in the editor and in an exported game, `smitten.net.available()` is
false, and `join()` gives `nil, "unavailable"` immediately. Use this to
show a message, and let the game work for one player:

```lua
if not smitten.net.available() then
  Status.text = "Online play works on the games site."
end
```

To test with more than one player:

1. Publish the game.
2. Open its page on the games site.
3. Open the same page in a second tab or a second browser.
4. Click **Play** in each tab.

Each tab is one player. After a change, publish the game again. Then load
the pages again.

When a call gives `nil`, the second value tells the cause. `disconnected()`
gets the same words:

| Cause | What happened |
| --- | --- |
| `"unavailable"` | The game is not on its page on the games site |
| `"bad-room"` | The room name is empty, too long, or has other characters |
| `"bad-name"` | The name of the guest is too long, has other characters, or has a word that the games site does not accept |
| `"full"` | The room has `maxPlayers` players already |
| `"in-room"` | You are in a room already. Call `leave()` first |
| `"needs-callback"` | A call to `join()` from `update()` or `draw()`, without a function to give the answer to |
| `"too-many-rooms"` | The game has too many rooms at the same time |
| `"busy"` | The games site, or the network of the player, has too many connections |
| `"timeout"` | The games site did not answer in 15 seconds |
| `"offline"` | The page did not connect to the games site |
| `"lost"` | The connection dropped and did not come back |
| `"idle"` | Nobody in the room sent a message for 15 minutes |
| `"slow"` | The player did not take the messages fast enough |
| `"no-game"` | A moderator hid the game, to look at it |
| `"banned"` | A moderator stopped this network from online play |
| `"left"` | `leave()` stopped a `join()` that waited |
| `"not-in-room"`, `"no-peer"` | `send()` or `broadcast()` outside a room, or to a peer that is not in the room |

## Reference

<!-- module:net -->
| Function | |
| --- | --- |
| `smitten.net.available()` | Returns true while the game runs on its page on the games site. Returns false in the editor and in exported games. |
| `smitten.net.join(room, options?, callback?)` | Joins a room, and makes it if nobody is in it: smitten.net.join("arena", { maxPlayers = 4 }). options: maxPlayers (2 to 16, 8 if you leave it out) and name (for a player who is not signed in). Waits, then returns your peer, or nil and the reason. |
| `smitten.net.leave()` | Leaves the room. The others get peerLeft(). You get no event. |
| `smitten.net.room()` | Returns the name of the room that you are in, or nil. |
| `smitten.net.me()` | Returns your own peer: { id, name, guest, me = true }, or nil when you are not in a room. |
| `smitten.net.peers()` | Returns all the peers in the room, you too, in the order that they came in: a new list each time. |
| `smitten.net.peer(id)` | Returns the peer with this id, or nil. |
| `smitten.net.host()` | Returns the host: the peer that is in the room for the longest time. The games site chooses a new host when the host leaves. The host has no other power. |
| `smitten.net.isHost()` | Returns true if you are the host. |
| `smitten.net.send(peer, data)` | Sends data to one peer (a peer or its id). data is a table, text, a number or a boolean. Returns true, or nil and the reason. |
| `smitten.net.broadcast(data)` | Sends data to all the other peers in the room. Returns true, or nil and the reason. |
<!-- end -->

## What the engine does not do

Online games are difficult. `smitten.net` keeps its part small and
reliable, and leaves the difficult decisions to your game. Know these
facts before you start:

- **Messages take time.** A message takes from about 30 milliseconds to
  some hundred milliseconds. On a bad network, it takes more. Each player
  sees the other players a little in the past. Fast games feel this most.
  Interpolation (as in the example) makes it smooth, not faster.
- **Players can cheat.** The game runs on the computer of each player. A
  player who wants to cheat can change what their game sends. The games
  site only carries the messages. It does not check them. The host can
  cheat too. Do not use online games for prizes.
- **There is no authority.** The engine does not decide who owns a piece,
  or whose message is correct when two messages disagree. Your game
  decides. Two simple ways are: each player owns their own things, or the
  host decides.
- **There is no prediction and no rollback.** The engine does not guess
  where things go. It does not correct the past when a late message
  comes.
- **Pieces do not copy themselves.** The engine does not send pieces,
  properties or scenes to the other players. Your game sends the values
  that it needs.
- **There is no matchmaking.** Players find each other only through room
  names and codes. There is no list of rooms, no levels of skill, and no
  queue.
- **The site keeps nothing.** A room ends when the last player leaves. To keep
  scores, use [leaderboards](leaderboards.md).
