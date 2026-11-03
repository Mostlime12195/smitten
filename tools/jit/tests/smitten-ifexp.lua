-- Smitten syntax: if-expressions
local function check(name, cond) print(name, cond and "ok" or "FAILED"); assert(cond, name) end

local a, b = true, false
check("then", (if a then 1 else 2) == 1)
check("else", (if b then 1 else 2) == 2)
local function grade(n)
  return if n >= 90 then "A" elseif n >= 80 then "B" elseif n >= 70 then "C" else "F"
end
check("elseif", grade(95) .. grade(85) .. grade(75) .. grade(10) == "ABCF")

-- false, nil and values from the branches
check("nil cond", (if nil then 1 else 2) == 2)
check("zero is true", (if 0 then 1 else 2) == 1)
check("false value", (if a then false else true) == false)
check("nil value", (if a then nil else 1) == nil)
local x = if b then 1 else nil
check("nil else", x == nil)

-- only the chosen branch is evaluated
local log = {}
local function f(v) log[#log + 1] = tostring(v); return v end
local r = if f(false) then f("a") elseif f(true) then f("b") else f("c")
check("lazy", r == "b" and table.concat(log, ",") == "false,true,b")
log = {}
r = if f(nil) then f(1) else f(2)
check("lazy else", r == 2 and #log == 2)

-- conditions with and/or/not and comparisons
local n = 5
check("compare", (if n > 3 and n < 10 then "mid" else "out") == "mid")
check("not", (if not a then 1 else 2) == 2)
check("or value", (if b or n then n else 0) == 5)
check("value with and/or", (if a then n > 3 and "y" or "n" else "z") == "y")

-- in arguments, table constructors, returns, conditions
local function pack(...) return { n = select("#", ...), ... } end
local p = pack(if a then 1 else 2, if b then 3 else 4, 5)
check("arguments", p.n == 3 and p[1] == 1 and p[2] == 4 and p[3] == 5)
local t = { if a then "x" else "y", key = if b then 1 else 2, [if a then "k" else "j"] = 3 }
check("constructor", t[1] == "x" and t.key == 2 and t.k == 3)
if (if a then n else 0) == 5 then log = "if cond" end
check("as condition", log == "if cond")
local i = 0
while if i < 3 then true else false do i += 1 end
check("while cond", i == 3)
repeat i -= 1 until if i <= 0 then true else false
check("until", i == 0)

-- the else branch extends as far as possible (as in Luau)
local v = 1 + if a then 2 else 3 + 4
check("precedence", v == 3)
v = 1 + if b then 2 else 3 + 4
check("precedence else", v == 8)
v = if b then 2 else 3 == 3
check("precedence compare", v == true)
check("parenthesized", (if a then 2 else 3) * 10 == 20)
v = -if b then 2 else 3 * 2
check("unary", v == -6)

-- nested
local function sign(v) return if v > 0 then 1 else if v < 0 then -1 else 0 end
check("nested", sign(5) == 1 and sign(-5) == -1 and sign(0) == 0)
check("nested then", (if (if a then b else a) then 1 else 2) == 2)

-- multiple results are truncated to one
local function two() return 1, 2 end
check("one value", select("#", (if a then two() else 0)) == 1 and select("#", if a then two() else 0) == 1)

-- with the other new syntax
local s = `{if a then "on" else "off"}`
check("interpolation", s == "on")
local c = 0
for k = 1, 10 do
  c += if k % 2 == 0 then k else 0
end
check("compound", c == 30)

-- upvalues and closures in branches
local up = 7
local g = if a then function() return up end else nil
check("closure", g() == 7)

-- hot loop
local sum, ref = 0, 0
for k = 1, 500 do
  sum = sum + (if k % 3 == 0 then 3 elseif k % 3 == 1 then 1 else -1)
  if k % 3 == 0 then ref = ref + 3 elseif k % 3 == 1 then ref = ref + 1 else ref = ref - 1 end
end
check("loop", sum == ref and sum == 498)

-- line hooks see the source's lines
local function traced()
  local y = if n > 1
    then 10
    else 20
  y += 1
  for k = 1, 2 do
    if k == 1 then continue end
    y = `{y}`
  end
  return y
end
local info = debug.getinfo(traced, "S")
local base, last = info.linedefined, info.lastlinedefined
local lines = {}
debug.sethook(function(_, l)
  if l > base and l <= last then lines[#lines + 1] = l - base end
end, "l")
local res = traced()
debug.sethook()
print("lines", table.concat(lines, ","))
check("hooked result", res == "11")

-- runtime errors keep their lines
print(pcall(function()
  local v
  return if a then v.field else 0
end))
print(pcall(function()
  return if b then 0
    else nil + 1
end))

-- syntax errors
local function syntax(code) print((select(2, loadstring(code, "=src")))) end
syntax("return if a then 1")
syntax("return if a then 1 end")
syntax("return if a 1 else 2")
syntax("return if a then 1 elseif b then 2")
syntax("x = if then 1 else 2")
