-- Play builds (web/editor/core/build/): run.mjs runs this project twice,
-- from its source and from its play build, and compares the HASH lines.
-- Each image must decode to the same pixels and draw the same pixels; the
-- sprites with layers must keep their animations; the JSON files must keep
-- their values. Prints PASS or FAIL for each check, HASH lines, the TOOL
-- line (the tool files in the game), then DONE.

local nodes2d = require("love.scene.nodes2d")
local g = smitten.graphics

local passed, failed, state = 0, 0, "start"

local function check(name, ok, why)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. ": " .. tostring(why or "not so"))
  end
end

local function md5(data)
  return smitten.data.encode("string", "hex", smitten.data.hash("string", "md5", data))
end

-- A piece drawn on a clear canvas of its own size, as pixels.
local function drawn(piece, w, h)
  local canvas = g.newCanvas(w, h, { dpiscale = 1 })
  local stage = find("Stage")
  local p = stage:add(piece)
  g.push("all")
  g.setCanvas(canvas)
  g.setScissor()
  g.origin()
  g.clear(0, 0, 0, 0)
  nodes2d.render(stage)
  g.pop()
  p:remove()
  return g.readbackTexture(canvas)
end

local function checks()
  local list = smitten.json.decode(assert(smitten.filesystem.read("data/images.json")))
  check("the list of images is there", #list.images >= 5)
  for _, path in ipairs(list.images) do
    local data = smitten.image.newImageData(path)
    local w, h = data:getWidth(), data:getHeight()
    print(`HASH decode {path} {w}x{h} {md5(data)}`)
    local shot = drawn(make("Sprite", { image = path, x = w / 2, y = h / 2, playing = false }), w, h)
    print(`HASH draw {path} {md5(shot)}`)
    check(`{path} loads and draws`, shot:getWidth() == w)
  end

  for _, path in ipairs({ "art/hero.sprite", "art/walk.sprite" }) do
    local s = make("Sprite", { image = path, playing = false })
    local names = {}
    for _, anim in ipairs({ "idle", "walk" }) do
      if s:hasAnimation(anim) then names[#names + 1] = anim end
    end
    local w, h = s:getSize()
    print(`HASH sprite {path} {table.concat(names, ",")} {w}x{h}`)
    check(`{path} has an animation`, #names > 0)
    for f = 0, 2 do
      local framed = make("Sprite", { image = path, frame = f, playing = false, x = 16, y = 16 })
      print(`HASH sprite-frame {path} {f} {md5(drawn(framed, 32, 32))}`)
    end
  end

  local info = smitten.json.decode(assert(smitten.filesystem.read("data/info.json")))
  check("the JSON file keeps its values", info.title == "Play  build" and info.list[3] == 3 and info.nested.deep == true)
  print(`HASH json {info.title} {#info.list} {tostring(info.nested.deep)} {info.text}`)
  -- make-art.mjs is named here, so it stays; the play build leaves out other.mjs.
  local tools = smitten.filesystem.getDirectoryItems("tools")
  table.sort(tools)
  print("TOOL " .. table.concat(tools, ",") .. (smitten.filesystem.getInfo("tools/make-art.mjs") and "" or " (make-art.mjs is missing)"))
end

function update(dt)
  if state ~= "start" then return end
  state = "done"
  local ok, err = pcall(checks)
  if not ok then check("the checks ran", false, tostring(err)) end
  print(`DONE {passed} passed, {failed} failed`)
end
