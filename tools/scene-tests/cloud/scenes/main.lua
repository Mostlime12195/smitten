-- Checks smitten.host and smitten.cloud, two ways:
--
-- * "cloud": the game by itself, as in the editor or an exported game.
--   There is no host, so every cloud call must answer nil, "unavailable"
--   straight away, with no error and no waiting. save() and load() work.
-- * "cloud-host": the game inside docs/host-example.html, the host page
--   that the docs show (tools/scene-tests/cloud-host.html loads it). Calls
--   must go out through the player and come back, to tasks and callbacks.
--
-- Prints MODE, PASS or FAIL for each check, then DONE
-- (tools/scene-tests/run.mjs reads them).

local host, cloud = smitten.host, smitten.cloud
local passed, failed = 0, 0
local finished = false
local updateChecked = false
local fromCallback = nil

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

local function same(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" then return a == b end
  for k, v in pairs(a) do if not same(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

local function localSaves()
  save("cloudtest", { where = "here", n = 1 })
  local back = load("cloudtest", nil)
  check("save() and load() work as before", back ~= nil and back.where == "here" and back.n == 1)
end

local function withoutHost()
  local t0 = smitten.timer.getTime()
  check("no host: name() is nil", host.name() == nil)
  check("no host: info() is nil", host.info() == nil)
  check("no host: has() is false", host.has("cloudSaves") == false)
  check("no host: user() is nil", host.user() == nil)
  local a, b = cloud.save("slot1", { level = 1 })
  check("save: nil, unavailable", a == nil and b == "unavailable", b)
  a, b = cloud.load("slot1")
  check("load: nil, unavailable", a == nil and b == "unavailable", b)
  a, b = cloud.list()
  check("list: nil, unavailable", a == nil and b == "unavailable", b)
  a, b = cloud.remove("slot1")
  check("remove: nil, unavailable", a == nil and b == "unavailable", b)
  local calls = 0
  cloud.load("slot1", function(v, why) if v == nil and why == "unavailable" then calls += 1 end end)
  cloud.save("slot1", 1, function(v, why) if v == nil and why == "unavailable" then calls += 1 end end)
  check("callbacks are called at once with nil, unavailable", calls == 2, calls)
  local ok, err = pcall(cloud.save, "bad key", 1)
  check("a bad key is an error that says what to do", not ok and tostring(err):find("needs a key", 1, true) ~= nil, err)
  check("boards and net are unavailable too", not smitten.boards.available() and not smitten.net.available())
  localSaves()
  check("nothing waited", smitten.timer.getTime() - t0 < 0.5, smitten.timer.getTime() - t0)
end

local function withHost()
  check("host: name()", host.name() == "my-site", host.name())
  local info = host.info()
  check("host: info()", info and info.version == "1" and info.protocol == 1 and info.features[1] == "cloudSaves", info and smitten.json.encode(info))
  check("host: has()", host.has("cloudSaves") and not host.has("boards") and not host.has("net"))
  check("host: no boards or rooms here", not smitten.boards.available() and not smitten.net.available())
  check("host: no user", host.user() == nil)
  check("cloud.available()", cloud.available())
  check("os.time() is the time", type(os.time()) == "number" and os.time() > 1600000000, os.time())

  -- The local save and the cloud save with the same key stay apart.
  localSaves()
  save("progress", { level = 1 })
  local progress = { level = 5, name = "Ada é ✓", items = { "dash", "key" }, time = os.time() }
  local ok, why = cloud.save("progress", progress)
  check("save in a task: true", ok == true and why == nil, why)
  local back
  back, why = cloud.load("progress")
  check("load gives the same value back", same(back, progress), why or (back and smitten.json.encode(back)))
  check("the local save is unchanged", load("progress", {}).level == 1)

  back, why = cloud.load("nothing")
  check("load of a key with no save: nil, missing", back == nil and why == "missing", why)

  -- Quotes in the text: the JSON escapes them, and the messages again.
  local big = { text = ("abcdefgh\""):rep(6000), n = 1 }
  ok, why = cloud.save("big", big)
  check("a value of 60 KB as JSON goes", ok == true, why)
  back, why = cloud.load("big")
  check("and comes back the same", back ~= nil and back.text == big.text and back.n == 1, why)
  ok, why = cloud.save("huge", ("x"):rep(70000))
  check("a value over 64 KB: nil, too-big", ok == nil and why == "too-big", why)

  local list
  list, why = cloud.list()
  local keys = {}
  for _, s in ipairs(list or {}) do keys[#keys + 1] = s.key end
  check("list: the keys, sorted", table.concat(keys, " ") == "big progress", table.concat(keys, " ") .. " " .. tostring(why))
  check("list: size and time", list and list[2].size == #smitten.json.encode(progress) and math.abs(list[2].time - os.time()) < 60,
    list and list[2] and (list[2].size .. " " .. list[2].time))

  cloud.load("progress", function(v, w) fromCallback = { v, w } end)
  wait(0.5)
  check("a callback gets the value later", fromCallback and fromCallback[1] and fromCallback[1].level == 5)

  ok, why = cloud.remove("progress")
  check("remove: true", ok == true, why)
  back, why = cloud.load("progress")
  check("after remove: nil, missing", back == nil and why == "missing", why)
  check("remove again: true", cloud.remove("progress") == true)
end

function ready()
  local hasHost = host.name() ~= nil
  print("MODE " .. (hasHost and "host" or "unavailable"))
  if hasHost then withHost() else withoutHost() end
  -- update() checks one thing too, then the test is done.
  wait(0.2)
  if not updateChecked then wait(0.5) end
  check("from update(), load() without a callback: needs-callback or unavailable", updateChecked == true)
  done()
end

function update(dt)
  if updateChecked then return end
  local a, b = cloud.load("slot1")
  if a ~= nil or b ~= (cloud.available() and "needs-callback" or "unavailable") then print("FAIL update(): " .. tostring(b)) end
  updateChecked = true
end
