-- LuaJIT's language extensions, inside the real engine. The script of
-- main.scene's root piece.
local results = {}
local function check(name, ok, detail)
  results[#results + 1] = ("%s %s%s"):format(ok and "PASS" or "FAIL", name, detail and (": " .. detail) or "")
  print("COMPAT " .. results[#results])
end

function ready()
  local n = 0
  for i = 1, 10 do if i % 2 == 0 then goto continue end n = n + i ::continue:: end
  check("goto", n == 25)
  check("escapes", "\x41\u{20AC}" == "A\226\130\172")
  local co = coroutine.wrap(function()
    local ok, v = pcall(function() return coroutine.yield(1) + 1 end)
    return ok and v
  end)
  co()
  check("yield in pcall", co(41) == 42)
  check("table.new", type(require("table.new")) == "function")
  -- load() in a script is the short API's (saved values); Lua's is _G.load.
  check("load with env", _G.load("return x", "c", "t", { x = 5 })() == 5)
  check("no ffi", not pcall(require, "ffi"))
  check("jit global", jit == nil)
  local f, lerr = loadstring("return 1LL")
  check("LL message", f == nil and lerr:find("FFI") ~= nil, lerr)
  print("COMPAT done")
end

function draw()
  for i, r in ipairs(results) do smitten.graphics.print(r, 10, i * 18) end
end
