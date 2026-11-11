-- Tests for smitten.host and smitten.cloud (love/src/modules/host, cloud)
-- under plain Lua 5.1, with stand-ins for the engine: the clock, tasks
-- (love.scene.script) and the host page's messages. Also checks that
-- smitten.boards still works through smitten.host. From the repository's
-- root:
--
--   lua5.1 tools/cloud-tests/test.lua
--
-- With a real engine and browser: the "cloud" and "cloud-host" scene tests
-- and tools/platform-tests/cloud-e2e.mjs.

local root = (arg and arg[0] or ""):match("^(.*)tools[/\\]cloud%-tests[/\\]") or ""
table.insert(package.loaders, 2, function(name)
	local dir, file = name:match("^love%.(%w+)%.?(%w*)$")
	if not dir then return nil end
	if file == "" then file = "init" end
	local path = root .. "love/src/modules/" .. dir .. "/" .. file .. ".lua"
	local f = io.open(path, "r")
	if not f then return "\n\tno file " .. path end
	f:close()
	return assert(loadfile(path))
end)

-- The engine's clock.
local T = 100
love = { timer = { getTime = function() return T end } }

-- Tasks, as love.scene.script runs them (ready() and events are tasks).
local tasks = {}
local script = {}
function script.runTask(owner, fn, ...)
	local co = coroutine.create(fn)
	tasks[co] = true
	local ok, err = coroutine.resume(co, ...)
	if not ok then error(err, 0) end
end
function script.currentTask()
	local co = coroutine.running()
	return co and tasks[co] and co or nil
end
function script.suspendTask() return coroutine.yield() end
function script.resumeTask(co, ...)
	if coroutine.status(co) ~= "suspended" then return end
	local ok, err = coroutine.resume(co, ...)
	if not ok then error(err, 0) end
end
package.loaded["love.scene.script"] = script

-- What the modules print: the lines for the page.
local sent = {}
local realPrint = print
print = function(text)
	text = tostring(text)
	if text:sub(1, 6) == "\1site " then sent[#sent + 1] = text:sub(7) end
end

local json = require("love.json")
local host = require("love.host")
local cloud = require("love.cloud")
local boards = require("love.boards")

local passed, failed = 0, 0
local function check(name, ok, detail)
	if ok then
		passed = passed + 1
	else
		failed = failed + 1
		realPrint("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
	end
end

local function fails(name, fn, want)
	local ok, err = pcall(fn)
	check(name, not ok and tostring(err):find(want, 1, true) ~= nil, ok and "no error" or err)
end

local function lastSent()
	local text = sent[#sent]
	return text and json.decode(text)
end

-- A message from the page, as love.engine.live gives it (decoded JSON).
local function page(t)
	local msg = json.decode(json.encode(t))
	host._receive(msg)
	return msg
end

local function reply(id, result, reason)
	if reason then page({ type = "reply", id = id, ok = false, reason = reason })
	else page({ type = "reply", id = id, ok = true, result = result }) end
end

-- Runs fn as a task (like ready()); returns a table that gets its results.
local function task(fn)
	local result = {}
	script.runTask(nil, function()
		result.values = { fn() }
		result.done = true
	end)
	return result
end

-- 1. No host ------------------------------------------------------------

check("no host: name() is nil", host.name() == nil)
check("no host: info() is nil", host.info() == nil)
check("no host: has() is false", host.has("cloudSaves") == false)
check("no host: user() is nil", host.user() == nil)
check("no host: cloud.available() is false", cloud.available() == false)

local a, b = cloud.save("slot1", { level = 2 })
check("no host: save gives nil, unavailable", a == nil and b == "unavailable", b)
a, b = cloud.load("slot1")
check("no host: load gives nil, unavailable", a == nil and b == "unavailable", b)
a, b = cloud.list()
check("no host: list gives nil, unavailable", a == nil and b == "unavailable", b)
a, b = cloud.remove("slot1")
check("no host: remove gives nil, unavailable", a == nil and b == "unavailable", b)
local got = {}
cloud.load("slot1", function(v, why) got[#got + 1] = why end)
cloud.list(function(v, why) got[#got + 1] = why end)
check("no host: callbacks get unavailable at once", #got == 2 and got[1] == "unavailable" and got[2] == "unavailable")
check("no host: nothing went to a page", #sent == 0, #sent)
check("no host: boards are unavailable", boards.available() == false and select(2, boards.top("best")) == "unavailable")

-- Wrong arguments are errors that say what to do, with or without a host.
fails("a key that is not text", function() cloud.save(12, 1) end, "needs a key")
fails("an empty key", function() cloud.load("") end, "needs a key")
fails("a key with a space", function() cloud.remove("slot 1") end, "needs a key")
fails("a key that is too long", function() cloud.load(("x"):rep(65)) end, "1 to 64")
fails("a value of nil", function() cloud.save("slot1", nil) end, "smitten.cloud.remove")
fails("a value that is a function", function() cloud.save("slot1", { f = print }) end, "can only save")
check("a key of 64 characters is good", select(2, cloud.load(("x"):rep(64))) == "unavailable")
check("a key with _ . - is good", select(2, cloud.load("a_b.c-1")) == "unavailable")
fails("a key that starts with a dot", function() cloud.load("..") end, "a letter or a digit first")
fails("a key that starts with _", function() cloud.load("_x") end, "needs a key")

-- 2. A host says hello -----------------------------------------------------

local hello = page({ type = "hello", protocol = 1, name = "my-portal", version = "2.1",
	features = { "cloudSaves", "net", "cloudSaves", 7, "" }, user = { name = "Ada", id = "secret" } })
check("hello: name", host.name() == "my-portal", host.name())
local info = host.info()
check("hello: info", info.name == "my-portal" and info.version == "2.1" and info.protocol == 1, json.encode(info))
check("hello: features once each, text only", #info.features == 3 and info.features[1] == "cloudSaves" and info.features[2] == "net" and info.features[3] == "7",
	json.encode(info.features))
info.features[1] = "changed"
check("hello: info() is a new table each time", host.info().features[1] == "cloudSaves")
check("hello: has()", host.has("cloudSaves") and host.has("net") and not host.has("boards"))
check("hello: user() is the name only", host.user() == "Ada")
check("hello: smitten.net gets net = true", hello.net == true and hello.boards == false)
check("hello: cloud.available()", cloud.available() == true)

-- 3. Calls in a task ---------------------------------------------------------

local r = task(function() return cloud.save("slot1", { level = 3, name = "Bo" }) end)
local m = lastSent()
check("save: a request goes to the page", m.type == "request" and m.call == "cloud.save" and m.key == "slot1" and type(m.id) == "number", sent[#sent])
check("save: the data is the value as JSON text", type(m.data) == "string" and json.decode(m.data).level == 3 and json.decode(m.data).name == "Bo", m.data)
check("save: the task waits", not r.done)
reply(m.id, {})
check("save: true when the page answers", r.done and r.values[1] == true and r.values[2] == nil)

r = task(function() return cloud.load("slot1") end)
m = lastSent()
check("load: a request", m.call == "cloud.load" and m.key == "slot1" and m.data == nil)
reply(m.id, { data = json.encode({ level = 3, list = { 1, 2 } }) })
check("load: the value comes back", r.done and type(r.values[1]) == "table" and r.values[1].level == 3 and r.values[1].list[2] == 2)

r = task(function() return cloud.load("none") end)
reply(lastSent().id, { data = json.null })
check("load: no save gives nil, missing", r.done and r.values[1] == nil and r.values[2] == "missing", r.values and r.values[2])
r = task(function() return cloud.load("none") end)
reply(lastSent().id, {})
check("load: no data gives nil, missing", r.values[1] == nil and r.values[2] == "missing")
r = task(function() return cloud.load("bad") end)
reply(lastSent().id, { data = "{not json" })
check("load: data that is not JSON gives nil, bad-data", r.values[1] == nil and r.values[2] == "bad-data")
r = task(function() return cloud.load("n") end)
reply(lastSent().id, { data = "42" })
check("load: a number", r.values[1] == 42)

r = task(function() return cloud.list() end)
m = lastSent()
check("list: a request", m.call == "cloud.list")
reply(m.id, { { key = "b", size = 10, time = 1700000000 }, { key = "a", size = 5 }, "junk", { size = 1 } })
local list = r.values[1]
check("list: sorted by key, junk left out", type(list) == "table" and #list == 2 and list[1].key == "a" and list[2].key == "b", json.encode(list))
check("list: size and time", list[2].size == 10 and list[2].time == 1700000000 and list[1].time == 0)

r = task(function() return cloud.remove("slot1") end)
m = lastSent()
check("remove: a request", m.call == "cloud.remove" and m.key == "slot1")
reply(m.id, { removed = false })
check("remove: true", r.values[1] == true)

-- The reasons the page gives come back as they are.
for _, why in ipairs({ "signed-out", "too-big", "quota", "too-many", "offline" }) do
	r = task(function() return cloud.save("slot1", 1) end)
	reply(lastSent().id, nil, why)
	check("a refusal: " .. why, r.values[1] == nil and r.values[2] == why)
end
r = task(function() return cloud.load("slot1") end)
page({ type = "reply", id = lastSent().id, ok = true, result = "not a table" })
check("a broken answer gives nil, error", r.values[1] == nil and r.values[2] == "error")

-- 4. Callbacks, update(), limits ---------------------------------------------------

got = nil
a, b = cloud.load("slot1", function(v, why) got = { v, why } end)
check("a callback: returns nil, sent at once", a == nil and b == "sent")
reply(lastSent().id, { data = "true" })
check("a callback: gets the value later", got and got[1] == true)

a, b = cloud.load("slot1")
check("load from update() without a callback: needs-callback", a == nil and b == "needs-callback")
local before = #sent
a, b = cloud.save("slot1", 5)
check("save from update() goes out without waiting", a == nil and b == "sent" and #sent == before + 1)
reply(lastSent().id, {})

local big = ("x"):rep(cloud.MAX_BYTES)
before = #sent
a, b = cloud.save("slot1", big)
check("a value over 64 KB: too-big, and nothing is sent", a == nil and b == "too-big" and #sent == before)
r = task(function() return cloud.save("slot1", big:sub(3)) end)
check("a value of exactly 64 KB as JSON goes", #lastSent().data == cloud.MAX_BYTES and not r.done)
reply(lastSent().id, {})

r = task(function() return cloud.load("slow") end)
T = T + 11
host._update()
check("no answer in 10 seconds: timeout", r.done and r.values[1] == nil and r.values[2] == "timeout")
reply(lastSent().id, { data = "1" })
check("a late answer is ignored", true)

local waiting = {}
for i = 1, 16 do waiting[i] = task(function() return cloud.load("k" .. i) end) end
r = task(function() return cloud.load("k17") end)
check("17 calls at once: the 17th is busy", r.done and r.values[2] == "busy")
T = T + 11
host._update()
check("then the 16 time out", waiting[16].done and waiting[16].values[2] == "timeout")

-- 5. Boards go through the host too -------------------------------------------

check("no boards feature: boards unavailable", boards.available() == false)
local legacy = page({ type = "hello", boards = true, net = true })
check("an old hello (boards, net): boards and net", boards.available() and host.has("net") and legacy.net == true)
check("an old hello: the games site, protocol 0", host.name() == "smitten-games" and host.info().protocol == 0)
check("an old hello: no cloud saves, no user", not cloud.available() and host.user() == nil)
r = task(function() return boards.top("best", 3) end)
m = lastSent()
check("boards: the same request as before", m.type == "request" and m.call == "top" and m.key == "best" and m.count == 3)
reply(m.id, { { rank = 1, name = "Ada", value = 5 } })
check("boards: the answer comes back", r.values[1][1].name == "Ada")

page({ type = "hello", protocol = 1, name = "smitten-games", version = "1", features = { "cloudSaves", "boards" } })
local ids = {}
task(function() return boards.list() end)
ids[1] = lastSent().id
task(function() return cloud.list() end)
ids[2] = lastSent().id
check("boards and cloud share one set of ids", ids[1] ~= ids[2])
check("a new hello replaces the old one", not host.has("net") and host.user() == nil and host.has("boards"))
page({ type = "hello", protocol = 1, features = {} })
check("a hello with no name: unknown", host.name() == "unknown")

realPrint(("%d passed, %d failed"):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
