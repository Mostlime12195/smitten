-- Smitten syntax: compound assignment (+= -= *= /= %= ^= ..=)
local function check(name, cond) print(name, cond and "ok" or "FAILED"); assert(cond, name) end

-- locals, every operator
local x = 10
x += 5; check("+=", x == 15)
x -= 3; check("-=", x == 12)
x *= 2; check("*=", x == 24)
x /= 8; check("/=", x == 3)
x %= 2; check("%=", x == 1)
x = 3; x ^= 2; check("^=", x == 9)
local s = "a"
s ..= "b"; check("..=", s == "ab")
s ..= 1; check("..= number", s == "ab1")
s ..= "c" .. "d" .. 2; check("..= chain", s == "ab1cd2")

-- the right side is a whole expression
x = 2; x *= 3 + 4; check("rhs precedence", x == 14)
x = 10; x -= -1; check("rhs unary", x == 11)
x = 2; x ^= 1 + 1; check("rhs pow", x == 4)
x = 1; x += x; check("rhs uses target", x == 2)

-- multiple results are truncated to one
local function two() return 5, 6 end
x = 1; x += two(); check("rhs call", x == 6)
local function va(...) local y = 0; y += ...; return y end
check("rhs vararg", va(3, 4) == 3)

-- globals and upvalues
gcount = 1
gcount += 1; check("global", gcount == 2)
local up = 0
local function bump(n) up += n; return up end
bump(2); bump(3); check("upvalue", up == 5)
local function outer()
  local v = 1
  local function inner() v *= 10 end
  inner(); inner()
  return v
end
check("nested upvalue", outer() == 100)

-- fields and indexes
local t = { a = 1, b = { c = 2 }, [5] = 7, list = { 1, 2, 3 } }
t.a += 1; check("field", t.a == 2)
t.b.c *= 5; check("nested field", t.b.c == 10)
t[5] -= 2; check("constant index", t[5] == 5)
local i = 2
t.list[i] += 40; check("register index", t.list[2] == 42)
t.list[i + 1] ..= "!"; check("expression index", t.list[3] == "3!")
t["a"] += 0.5; check("string index", t.a == 2.5)

-- table and key are evaluated once
local calls, keycalls = 0, 0
local store = { n = 0, [3] = 100 }
local function gettable() calls += 1; return store end
local function key() keycalls += 1; return 3 end
gettable().n += 1
check("table once", calls == 1 and store.n == 1)
gettable()[key()] += 1
check("table and key once", calls == 2 and keycalls == 1 and store[3] == 101)

-- one __index and one __newindex
local log = {}
local proxy = setmetatable({}, {
  __index = function(_, k) log[#log + 1] = "get " .. k; return 10 end,
  __newindex = function(_, k, v) log[#log + 1] = "set " .. k .. "=" .. v end,
})
proxy.hp -= 3
check("metamethods", table.concat(log, ",") == "get hp,set hp=7")

-- arithmetic metamethods
local V = {}
V.__index = V
V.__add = function(a, b) return setmetatable({ x = a.x + b.x }, V) end
V.__concat = function(a, b) return setmetatable({ x = a.x .. "|" .. b }, V) end
local p = setmetatable({ x = 1 }, V)
p += setmetatable({ x = 2 }, V)
check("__add", p.x == 3)
p ..= "z"
check("__concat", p.x == "3|z")

-- the right side sees the old value; local named like the target
local a, b = 1, 2
a += b; b += a
check("chained", a == 3 and b == 5)

-- many registers in use (table and key in temporaries above locals)
local grid = { { 0, 0 }, { 0, 0 } }
for r = 1, 2 do
  for c = 1, 2 do
    grid[r][c] += r * 10 + c
    grid[r][c] *= 2
  end
end
check("grid", grid[1][1] == 22 and grid[2][2] == 44)

-- hot loop (the JIT compiles it)
local sum, str = 0, ""
for n = 1, 200 do
  sum += n
  if n % 50 == 0 then str ..= n .. "," end
end
check("loop", sum == 20100 and str == "50,100,150,200,")

-- arithmetic errors name the field and the line
local ok, err = pcall(function()
  local q = {}
  q.missing += 1
end)
print(err)
ok, err = pcall(function()
  local q = { name = {} }
  q.name ..= "x"
end)
print(err)
ok, err = pcall(function() undefinedglobal -= 1 end)
print(err)

-- syntax errors
local function syntax(code) print((select(2, loadstring(code, "=src")))) end
syntax("x += ")
syntax("local x = 1\nx ..=\nend")
syntax("a, b += 1")
syntax("f() += 1")
syntax("local x += 1")
syntax("x + = 1")
