-- Smitten syntax: string interpolation with backticks
local function check(name, cond) print(name, cond and "ok" or "FAILED"); assert(cond, name) end

local hp, maxHp = 7, 10
check("basic", `HP: {hp}/{maxHp}` == "HP: 7/10")
check("no braces", `plain text` == "plain text")
check("empty", `` == "")
check("only expression", `{hp}` == "7" and type(`{hp}`) == "string")
check("adjacent", `{hp}{maxHp}` == "710")
check("at ends", `{hp} and {maxHp}` == "7 and 10")

-- values are converted as by tostring
check("nil", `{nil}` == "nil")
check("booleans", `{true} {false}` == "true false")
check("numbers", `{1} {1.5} {-2} {1e100} {2^53}` == "1 1.5 -2 1e+100 9.007199254741e+15")
check("number vars", `{hp / 4}` == "1.75")
check("constant folding", `{1 + 2}` == "3")
check("strings", `{"a"}{'b'}{[[c]]}` == "abc")
local obj = setmetatable({}, { __tostring = function(self) return "Obj!" end })
check("__tostring", `<{obj}>` == "<Obj!>")
local plain = {}
check("table", `{plain}` == tostring(plain))
check("function", `{print}` == tostring(print))
local nothing
check("nil local", `[{nothing}]` == "[nil]")

-- expressions, calls and nested strings inside braces
local function name() return "Ann", "ignored" end
local t = { x = 3, list = { 1, 2 } }
function t:get() return self.x end
check("call", `hi {name()}!` == "hi Ann!")
check("method", `{t:get()}` == "3")
check("index", `{t.list[2]} {t["x"]}` == "2 3")
check("arith", `{hp * 2 + 1}` == "15")
check("and/or", `{hp > 5 and "big" or "small"}` == "big")
check("concat inside", `{"a" .. "b" .. hp}` == "ab7")
check("nested", `a{`b{`c{hp}`}`}` == "abc7")
check("braces in strings", `{"}"}{'{'}` == "}{")
check("table constructor", `{ #{ 1, 2, 3 } }` == "3")
check("function", `{(function() return "f" end)()}` == "f")
local function va(...) return `{...}|{select("#", ...)}` end
check("vararg", va("x", "y") == "x|2")

-- escapes
check("brace escapes", `\{hp\}` == "{hp}")
check("backtick escape", `\`` == "`")
check("escapes", `a\tb\n\65\x42\u{43}\\` == "a\tb\nABC\\")
check("escape near expr", `\{{hp}\}` == "{7}")
check("closing brace alone", `a}b` == "a}b")
check("line continuation", `a\z
       b{hp}` == "ab7")

-- combined with ..
check("concat left", "x" .. `{hp}y` == "x7y")
check("concat right", `{hp}y` .. "z" == "7yz")
check("concat both", "<" .. `{hp}` .. `{maxHp}` .. ">" == "<710>")

-- the original tostring, even if the global is replaced
local realtostring = tostring
tostring = function() return "HACKED" end
local r = `{hp} {obj} {true}`
tostring = realtostring
check("tostring replaced", r == "7 Obj! true")
local env = setfenv(function() return `{1}{nil}` end, {})
check("empty environment", env() == "1nil")

-- string.dump keeps it working
local dumped = loadstring(string.dump(function(v) return `<{v}>` end))
check("string.dump", dumped(5) == "<5>" and dumped(obj) == "<Obj!>")

-- many parts
local many = `{1}{2}{3}{4}{5}{6}{7}{8}{9}{10}{hp}{hp}{hp}{hp}{hp}{hp}{hp}{hp}{hp}{hp}`
check("many parts", many == "123456789107777777777")

-- hot loop
local parts = {}
for i = 1, 300 do
  local s = `{i}:{i % 2 == 0}`
  if i % 100 == 0 then parts[#parts + 1] = s end
end
check("loop", table.concat(parts, ",") == "100:true,200:true,300:true")

-- errors
print(pcall(function() return `{setmetatable({}, { __tostring = function() error("in tostring") end })}` end))
local badts = setmetatable({}, { __tostring = function() return {} end })
print(pcall(function() return `{badts}` end))
print(pcall(function() return `a{badts}` end))
print(pcall(function()
  local x
  return `{x.field}`
end))

-- syntax errors
local function syntax(code) print((select(2, loadstring(code, "=src")))) end
syntax("return `{}`")
syntax("return `{{x}}`")
syntax("return `abc")
syntax("return `a{1 2}`")
syntax("return `a{1`")
syntax("return `a\nb`")
syntax("print`x`")
syntax("print`x{1}`")
