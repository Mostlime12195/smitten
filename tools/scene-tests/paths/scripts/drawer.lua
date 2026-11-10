-- A piece that's moved, turned and stretched draws a path given in scene
-- coordinates: debugDraw must put it where the scene says, not where this
-- piece is. It draws into a canvas once and reads two pixels back.

result = false

function draw()
  local at = parent.dotOnScreen
  if result or not at then return end
  local g = smitten.graphics
  local ok, err = pcall(function()
    local w, h = g.getDimensions()
    local canvas = g.newCanvas(w, h)
    local before = g.getCanvas()
    g.setCanvas(canvas)
    g.clear(0, 0, 0, 0)
    smitten.paths.debugDraw({ 100, 50, 100, 50 }, { width = 8, color = { 1, 0, 0, 1 } })
    g.setCanvas(before)
    local data = g.readbackTexture(canvas)
    local s = canvas:getDPIScale()
    local r, _, _, a = data:getPixel(math.floor(at.x * s), math.floor(at.y * s))
    local _, _, _, a2 = data:getPixel(math.floor(at.x2 * s), math.floor(at.y2 * s))
    result = { r = r, a = a, a2 = a2 }
  end)
  if not ok then result = { error = tostring(err) } end
end
