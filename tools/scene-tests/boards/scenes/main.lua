-- Checks smitten.boards (leaderboards on the games site), two ways:
--
-- * "boards": the game by itself, as in the editor or an exported game.
--   There is no site, so every call must answer nil, "unavailable" straight
--   away, with no error and no waiting.
-- * "boards-site": the game inside tools/scene-tests/boards-site.html, a
--   page that stands in for a game's page on the site and answers like it.
--   Calls must go out and their answers come back, to tasks and callbacks.
--
-- Prints MODE, PASS or FAIL for each check, then DONE
-- (tools/scene-tests/run.mjs reads them).

local boards = smitten.boards
local passed, failed = 0, 0
local finished = false
local fromUpdate = nil
local updateAsked = false

local function check(name, ok, detail)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
  end
end

local function done()
  finished = true
  print(`DONE {passed} passed, {failed} failed`)
end

local function withoutSite()
  local t0 = smitten.timer.getTime()
  local result, why = boards.submit("best", 120)
  check("submit: nil, unavailable", result == nil and why == "unavailable", why)
  result, why = boards.submit("best", 120, { name = "Ada" })
  check("submit with a name: nil, unavailable", result == nil and why == "unavailable", why)
  result, why = boards.top("best", 10)
  check("top: nil, unavailable", result == nil and why == "unavailable", why)
  result, why = boards.around("best")
  check("around: nil, unavailable", result == nil and why == "unavailable", why)
  result, why = boards.list()
  check("list: nil, unavailable", result == nil and why == "unavailable", why)

  local calls = {}
  local note = function(rows, reason) calls[#calls + 1] = { rows, reason } end
  result, why = boards.submit("best", 5, note)
  check("submit with a callback returns the same", result == nil and why == "unavailable", why)
  boards.submit("best", 5, { name = "Bo" }, note)
  boards.top("best", note)
  boards.top("best", 5, note)
  boards.around("best", 5, note)
  boards.list(note)
  local all = #calls == 6
  for _, c in ipairs(calls) do
    if c[1] ~= nil or c[2] ~= "unavailable" then all = false end
  end
  check("callbacks are called at once with nil, unavailable", all, #calls)

  -- Wrong arguments are answers too, never errors.
  local ok, err = pcall(function()
    boards.submit()
    boards.submit("best", "lots")
    boards.submit("best", 0 / 0)
    boards.submit(12, 12)
    boards.top()
    boards.top({})
    boards.around(nil, "x")
    boards.list("not a function")
  end)
  check("wrong arguments don't raise errors", ok, err)
  check("nothing waited", smitten.timer.getTime() - t0 < 0.5, smitten.timer.getTime() - t0)
end

local function withSite()
  local result, why = boards.submit("best", 250, { name = "Cy" })
  check("submit answers in a task", type(result) == "table" and why == nil, why)
  if result then
    check("submit: rank, value, improved", result.rank == 2 and result.value == 250 and result.improved == true,
      tostring(result.rank) .. " " .. tostring(result.value) .. " " .. tostring(result.improved))
  end
  result = boards.submit("best", 100, { name = "Cy" })
  check("a worse score isn't an improvement", result and result.improved == false and result.value == 250 and result.rank == 2)

  local rows
  rows, why = boards.top("best", 3)
  check("top answers a list", type(rows) == "table" and #rows == 3, why)
  if rows and #rows == 3 then
    check("top: best first", rows[1].name == "Ada" and rows[1].value == 300 and rows[1].rank == 1, rows[1].name)
    check("top: my row is marked", rows[2].name == "Cy" and rows[2].me == true and rows[2].guest == true and rows[1].me == nil)
    check("top: values are numbers", type(rows[3].value) == "number" and rows[3].value == 200.5, rows[3].value)
  end
  rows = boards.top("best")
  check("top: 10 unless asked", rows and #rows == 4, rows and #rows)
  rows = boards.top("best", 1)
  check("top: count", rows and #rows == 1, rows and #rows)
  rows = boards.around("best", 3)
  check("around: the rows near mine", rows and #rows == 3 and rows[1].rank == 1 and rows[2].me == true, rows and #rows)

  result, why = boards.submit("nope", 1)
  check("an unknown board: nil, no-board", result == nil and why == "no-board", why)
  rows, why = boards.top("nope")
  check("top of an unknown board: nil, no-board", rows == nil and why == "no-board", why)
  result, why = boards.submit("best", 1e9)
  check("the site's refusal comes back as a word", result == nil and why == "out-of-range", why)
  result, why = boards.submit("best", 0 / 0)
  check("a score that isn't a number never leaves", result == nil and why == "bad-value", why)

  local list
  list, why = boards.list()
  check("list: the game's boards", type(list) == "table" and #list == 1 and list[1].key == "best" and list[1].title == "High scores", why)

  -- From update(), with callbacks (asked below).
  updateAsked = true
  local t0 = smitten.timer.getTime()
  while not (fromUpdate and fromUpdate.rows and fromUpdate.submitted and fromUpdate.waited) and smitten.timer.getTime() - t0 < 5 do wait(0.05) end
  check("update(): top without a callback sends nothing", fromUpdate and fromUpdate.plain == "needs-callback", fromUpdate and fromUpdate.plain)
  check("update(): submit without a callback is sent", fromUpdate and fromUpdate.sent == "sent", fromUpdate and fromUpdate.sent)
  check("update(): the callback gets the rows", fromUpdate and type(fromUpdate.rows) == "table" and fromUpdate.rows[1].name == "Ada")
  check("update(): the callback gets submit's answer", fromUpdate and type(fromUpdate.submitted) == "table" and fromUpdate.submitted.rank == 4)
  check("a callback can wait()", fromUpdate and fromUpdate.waited == true)
  rows = boards.top("best", 10)
  check("the scores sent from update() arrived", rows and #rows == 6 and rows[4].name == "Dee" and rows[5].name == "Eli", rows and #rows)

  -- A call nobody answers gives up after 10 seconds.
  t0 = smitten.timer.getTime()
  result, why = boards.submit("slow", 1)
  local took = smitten.timer.getTime() - t0
  check("no answer: nil, timeout", result == nil and why == "timeout", why)
  check("the timeout takes about 10 seconds", took > 8 and took < 14, took)
  rows = boards.top("best", 1)
  check("and later calls still work", rows and #rows == 1)
end

function ready()
  print("MODE " .. (boards.available() and "site" or "unavailable"))
  check("available() is a boolean", type(boards.available()) == "boolean")
  if boards.available() then withSite() else withoutSite() end
  done()
end

function update(dt)
  if updateAsked and not fromUpdate then
    fromUpdate = {}
    local _, why = boards.top("best")
    fromUpdate.plain = why
    boards.top("best", 2, function(rows) fromUpdate.rows = rows end)
    boards.submit("best", 150, { name = "Dee" }, function(result)
      fromUpdate.submitted = result
      wait(0.1)
      fromUpdate.waited = true
    end)
    _, why = boards.submit("best", 20, { name = "Eli" })
    fromUpdate.sent = why
  end
end
