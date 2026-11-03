-- Plain Lua that looks like Smitten syntax still parses and runs the same
local function check(name, cond) print(name, cond and "ok" or "FAILED"); assert(cond, name) end

-- `::continue::' labels and `goto continue'
local t = {}
for i = 1, 5 do
  if i % 2 == 0 then goto continue end
  t[#t + 1] = i
  ::continue::
end
check("goto continue", table.concat(t, ",") == "1,3,5")

t = {}
local i = 0
while i < 4 do
  i = i + 1
  if i == 2 then goto continue end
  t[#t + 1] = i
  ::continue::
end
check("goto continue while", table.concat(t, ",") == "1,3,4")

-- both in one loop
t = {}
for k = 1, 6 do
  if k == 2 then goto continue end
  if k == 4 then continue end
  t[#t + 1] = k
  ::continue::
end
check("goto and continue", table.concat(t, ",") == "1,3,5,6")

-- `continue' as a name
local continue = 1
check("local named continue", continue == 1)
continue = continue + 1
check("assign continue", continue == 2)
continue, i = 3, 4
check("multiple assignment", continue == 3 and i == 4)
local obj = { continue = 5 }
check("field", obj.continue == 5 and obj["continue"] == 5)
obj.continue = 6
check("field assign", obj.continue == 6)
function obj:continue() return "method" end
check("method", obj:continue() == "method")
local function f(continue) return continue * 2 end
check("parameter", f(4) == 8)
do
  local function continue(x) return x or "called" end
  check("call", continue() == "called" and continue "s" == "s" and continue { 1 }[1] == 1)
end
local holder = { continue = {} }
holder.continue.x = 1
check("nested field", holder.continue.x == 1)
for continue = 1, 2 do t.c = continue end
check("loop variable", t.c == 2)
continue = nil
for _, v in ipairs({ 1, 2 }) do
  continue = v  -- an assignment, not the statement
end
check("assign in loop", continue == 2)

-- operators next to = and -
local b, c = 5, 3
local a = b + -c
check("plus minus", a == 2)
a=b-1
check("no spaces", a == 4)
a=-1
check("unary after =", a == -1)
a = b - -c
check("double minus", a == 8)
check("equals minus", (b==-c) == false and (b~=-c) == true)
a = b*-1
check("times minus", a == -5)
a = b/-1
check("divide minus", a == -5)
a = b^-1
check("pow minus", a == 0.2)
a = b%-3
check("mod minus", a == -1)
local tt = {}
tt[1]=-1
check("index =-", tt[1] == -1)
a = 5 --= a comment
check("comment after =", a == 5)

-- comments
--[[ a
long comment with ` and { and += ]]
--[==[ another ]] one ]==]
---a comment with three dashes
a = 1 -- trailing `comment`
check("comments", a == 1)

-- `..' chains
local s = "a" .. "b" .. 1 .. 2
check("concat chain", s == "ab12")
s = "x".."y"
check("concat no spaces", s == "xy")
local function va(...) return select("#", ...) end
check("vararg", va(1, 2, 3) == 3)
s = 1 .. ""
check("number concat", s == "1")

-- strings with backticks and braces
s = "`not {interpolated}`"
check("backticks in strings", #s == 20)
s = '`{a}`'
check("single quotes", s:sub(1, 1) == "`")
s = [[`{x}`]]
check("long string", s == "`{x}`")

-- if statements are still statements
if a == 1 then s = "then" elseif a == 2 then s = "elseif" else s = "else" end
check("if statement", s == "then")
