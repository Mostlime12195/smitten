-- Innermost loops become wasm loops; every way into, around and out of
-- them must behave like the interpreter.
local out = {}
local function emit(...) out[#out + 1] = table.concat({ ... }, " ") end

-- A loop at the very start of a function.
local n = 0
local function more() n = n + 1; return n % 50 ~= 0 end
local function spin() while more() do end return n end
for i = 1, 5 do spin() end
emit("spin", spin())

-- break, nested loops, repeat-until reading a local declared in the body.
local function nested(m)
  local s = 0
  for i = 1, m do
    for j = 1, m do
      if j > i then break end
      s = s + i * j
    end
    local k = 0
    repeat local stop = k * k > i; k = k + 1 until stop
    s = s + k
  end
  return s
end
for i = 1, 20 do nested(10) end
emit("nested", nested(30))

-- goto and continue.
local function jumps(m)
  local s, i = 0, 0
  ::top::
  i = i + 1
  if i % 3 == 0 then goto top end
  s = s + i
  if i < m then goto top end
  for j = 1, m do
    if j % 2 == 0 then continue end
    s = s + j
  end
  return s
end
for i = 1, 20 do jumps(10) end
emit("jumps", jumps(100))

-- Generic for (entered at its iterator call), with a call in the body that
-- returns through the interpreter at times.
local function body(k, v) return k .. "=" .. v end
local function each(t)
  local parts = {}
  for k, v in ipairs(t) do parts[#parts + 1] = body(k, v) end
  for k, v in pairs({ a = 1 }) do parts[#parts + 1] = body(k, v) end
  return table.concat(parts, ",")
end
for i = 1, 20 do each({ 1, 2, 3 }) end
emit("each", each({ 4, 5, 6, 7 }))

-- Numeric loops with float steps, negative steps, zero trips, huge bounds.
local function steps()
  local a, b, c, d = 0, 0, 0, 0
  for x = 0, 1, 0.1 do a = a + 1 end
  for x = 10, 1, -2.5 do b = b + x end
  for x = 1, 0 do c = c + 1 end
  for x = math.huge, math.huge, 1 do d = d + 1; break end
  return a, b, c, d
end
for i = 1, 20 do steps() end
emit("steps", steps())

-- The loop variable is a copy: changing it doesn't change the loop.
local function copy()
  local s = 0
  for i = 1, 10 do s = s + i; i = i * 100; s = s + i end
  return s
end
for i = 1, 20 do copy() end
emit("copy", copy())

-- A closure capturing the loop variable in each iteration.
local function closures()
  local fs = {}
  for i = 1, 5 do fs[i] = function() return i end end
  local s = ""
  for i = 1, 5 do s = s .. fs[i]() end
  return s
end
for i = 1, 20 do closures() end
emit("closures", closures())

-- A count hook set inside the loop by a function it calls stops the
-- compiled loop at the next iteration.
local hits = 0
local function arm(i) if i == 500 then debug.sethook(function() hits = hits + 1 end, "", 100) end end
local function hooked()
  local s = 0
  for i = 1, 2000 do s = s + i; arm(i) end
  debug.sethook()
  return s
end
emit("hooked", hooked(), tostring(hits > 0))

-- Errors in the middle of a loop, caught, then the loop runs again.
local function risky(t)
  local s = 0
  for i = 1, #t do s = s + t[i] end
  return s
end
local t = {}
for i = 1, 100 do t[i] = i end
for round = 1, 30 do
  t[50] = (round % 3 == 0) and "x" or 50
  local ok, r = pcall(risky, t)
  if round > 27 then emit("risky", tostring(ok), tostring(r)) end
end

print(table.concat(out, "\n"))
