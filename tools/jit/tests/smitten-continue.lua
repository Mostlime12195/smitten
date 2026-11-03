-- Smitten syntax: continue
local function check(name, cond) print(name, cond and "ok" or "FAILED"); assert(cond, name) end

-- numeric for
local t = {}
for i = 1, 10 do
  if i % 2 == 0 then continue end
  t[#t + 1] = i
end
check("for", table.concat(t, ",") == "1,3,5,7,9")

-- negative step
t = {}
for i = 10, 1, -3 do
  if i == 7 then continue end
  t[#t + 1] = i
end
check("for step", table.concat(t, ",") == "10,4,1")

-- generic for
t = {}
for i, v in ipairs({ "a", "b", "c", "d" }) do
  if v == "b" then continue end
  t[#t + 1] = i .. v
end
check("for in", table.concat(t, ",") == "1a,3c,4d")

-- while: continue goes back to the condition
local i = 0
t = {}
while i < 8 do
  i += 1
  if i % 3 == 0 then continue end
  t[#t + 1] = i
end
check("while", table.concat(t, ",") == "1,2,4,5,7,8")

-- repeat: continue goes to the condition, which can end the loop
i = 0
t = {}
repeat
  i += 1
  if i == 2 then continue end
  t[#t + 1] = i
until i >= 4
check("repeat", table.concat(t, ",") == "1,3,4")

i = 0
repeat
  i += 1
  if i < 100 then continue end
until true
check("repeat until true", i == 1)

-- the condition can use locals declared before the continue
i = 0
t = {}
repeat
  local n = i * 2
  i += 1
  if n == 2 then continue end
  t[#t + 1] = n
until n >= 6
check("repeat local", table.concat(t, ",") == "0,4,6")

-- ... and locals declared after it, if it doesn't use them
i = 0
repeat
  i += 1
  if i < 3 then continue end
  local unused = i
until i >= 3
check("repeat later local", i == 3)

-- nested loops: continue applies to the innermost loop
t = {}
for a = 1, 3 do
  if a == 2 then continue end
  for b = 1, 3 do
    if b == a then continue end
    local j = 0
    while j < 2 do
      j += 1
      if j == 1 then continue end
      t[#t + 1] = a .. b .. j
    end
  end
  t[#t + 1] = "|"
end
check("nested", table.concat(t, ",") == "122,132,|,312,322,|")

-- continue from inside nested blocks
t = {}
for k = 1, 6 do
  do
    if k > 1 then
      if k % 2 == 1 then
        continue
      end
    end
  end
  t[#t + 1] = k
end
check("nested blocks", table.concat(t, ",") == "1,2,4,6")

-- with break in the same loop
t = {}
for k = 1, 100 do
  if k % 2 == 0 then continue end
  if k > 7 then break end
  t[#t + 1] = k
end
check("break", table.concat(t, ",") == "1,3,5,7")

-- each iteration's locals are captured separately
local fns = {}
for k = 1, 4 do
  local x = k
  fns[k] = function() return x end
  if k % 2 == 0 then continue end
  x = x + 100
end
check("closures", fns[1]() == 101 and fns[2]() == 2 and fns[3]() == 103 and fns[4]() == 4)

-- continue leaving a block whose local is captured must close it
fns = {}
for k = 1, 4 do
  if k % 2 == 0 then
    local y = k * 10
    fns[#fns + 1] = function() return y end
    continue
  end
  local a, b, c = k, k, k  -- reuse the stack slots
end
check("close inner block", fns[1]() == 20 and fns[2]() == 40)

fns = {}
local w = 0
while w < 4 do
  w += 1
  do
    local z = w
    fns[w] = function() return z end
    if w < 4 then continue end
  end
end
check("close while", fns[1]() == 1 and fns[2]() == 2 and fns[3]() == 3 and fns[4]() == 4)

-- in repeat: closing captured locals of a block, condition sees the rest
fns = {}
i = 0
repeat
  i += 1
  local keep = i
  if i % 2 == 1 then
    local cap = i * 100
    fns[#fns + 1] = function() return cap end
    continue
  end
  local cap2 = keep
  fns[#fns + 1] = function() return cap2 end
until keep >= 4
check("close repeat", fns[1]() == 100 and fns[2]() == 2 and fns[3]() == 300 and fns[4]() == 4)

-- condition calling a closure that changes a captured local
i = 0
local rounds = 0
repeat
  rounds += 1
  local n = 0
  local function inc() n += 1; return n end
  if rounds == 1 then continue end
until inc() == 1 and rounds >= 3
check("repeat upvalue", rounds == 3)

-- functions with their own loops inside a loop
t = {}
for k = 1, 3 do
  local function odds(n)
    local r = {}
    for m = 1, n do
      if m % 2 == 0 then continue end
      r[#r + 1] = m
    end
    return table.concat(r)
  end
  if k == 2 then continue end
  t[#t + 1] = odds(k * 2)
end
check("inner function", table.concat(t, ",") == "1,135")

-- coroutines: yield inside a loop that uses continue
local co = coroutine.wrap(function()
  for k = 1, 6 do
    if k % 3 == 0 then continue end
    coroutine.yield(k)
  end
end)
t = {}
for _ = 1, 4 do t[#t + 1] = co() end
check("coroutine", table.concat(t, ",") == "1,2,4,5")

-- hot loop
local sum = 0
for k = 1, 1000 do
  if k % 7 ~= 0 then continue end
  sum += k
end
check("hot", sum == 71071)

-- `continue' followed by ';'
t = {}
for k = 1, 3 do
  if k == 2 then continue; end
  t[#t + 1] = k
end
check("semicolon", table.concat(t, ",") == "1,3")

-- syntax errors
local function syntax(code) print((select(2, loadstring(code, "=src")))) end
syntax("continue")
syntax("if x then\n  continue\nend")
syntax("for i = 1, 2 do\n  local f = function() continue end\nend")
syntax("for i = 1, 2 do\n  continue\n  print(i)\nend")
syntax("repeat\n  if x then continue end\n  local y = 1\nuntil y")
syntax("repeat\n  if x then continue end\n  local y = 1\nuntil (function() return y end)()")
syntax("repeat\n  do continue end\n  local a, b = 1, 2\nuntil a")
