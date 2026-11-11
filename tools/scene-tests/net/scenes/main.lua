-- Checks smitten.net (online rooms) without the games site, as in the
-- editor or an exported game: every call must answer straight away, with
-- nil and a reason, and no error and no waiting. Data that a message cannot
-- hold must still be an error, so that it shows while you test in the
-- editor. The events of this script must never come.
--
-- Prints PASS or FAIL for each check, then DONE (tools/scene-tests/run.mjs
-- reads them).

local net = smitten.net
local passed, failed = 0, 0
local events = 0

local function check(name, ok, detail)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
  end
end

local function fails(name, fn, want)
  local ok, err = pcall(fn)
  check(name, not ok and tostring(err):find(want, 1, true) ~= nil, if ok then "no error" else err)
end

function peerJoined(peer) events += 1 end
function peerLeft(peer) events += 1 end
function message(from, data) events += 1 end
function disconnected(reason) events += 1 end

function ready()
  local t0 = smitten.timer.getTime()
  check("available() is false", net.available() == false)
  local me, why = net.join("arena")
  check("join in ready(): nil, unavailable", me == nil and why == "unavailable", why)
  me, why = net.join("arena", { maxPlayers = 4, name = "Ada" })
  check("join with options: nil, unavailable", me == nil and why == "unavailable", why)
  local got = nil
  me, why = net.join("arena", function(a, b) got = { a, b } end)
  check("join with a callback returns nil, unavailable", me == nil and why == "unavailable", why)
  check("the callback is called at once", got ~= nil and got[1] == nil and got[2] == "unavailable")
  local ok, err = pcall(function()
    net.join()
    net.join({})
    net.join(12, "not options", 5)
    net.leave()
    net.leave()
  end)
  check("wrong arguments do not raise errors", ok, err)

  local sent, reason = net.send(1, { x = 1 })
  check("send: nil, not-in-room", sent == nil and reason == "not-in-room", reason)
  sent, reason = net.broadcast("hello")
  check("broadcast: nil, not-in-room", sent == nil and reason == "not-in-room", reason)
  check("peers() is an empty list", type(net.peers()) == "table" and #net.peers() == 0)
  check("me(), host(), peer() and room() are nil", net.me() == nil and net.host() == nil and net.peer(1) == nil and net.room() == nil)
  check("isHost() is false", net.isHost() == false)

  fails("a function in the data is an error", function() net.broadcast({ f = print }) end, "smitten.net.broadcast(): data.f is a function")
  fails("a piece in the data is an error", function() net.send(1, { who = self }) end, "data.who is a piece")
  fails("too much data is an error", function() net.broadcast(string.rep("x", 9000)) end, "the most is 8192")

  wait(0.2)
  check("nothing waited", smitten.timer.getTime() - t0 < 0.6, smitten.timer.getTime() - t0)
  check("no event came", events == 0, events)
  print(`DONE {passed} passed, {failed} failed`)
end

function update(dt)
  -- In update() (not a task) join() answers too.
  local me, why = net.join("arena")
  if why ~= "unavailable" then check("join in update(): nil, unavailable", false, why) end
end
