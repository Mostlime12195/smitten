local Main = {}
function Main:ready()
  self.hits = 0
  print("title", love.window.getTitle(), smitten.display.stretch, smitten.display.viewWidth)
  self:find("Ball"):on("collided", function(other) self.hits += 1 end)
end
function Main:update(dt)
  local b = self:find("Ball")
  self:find("Info").text = `ball {math.floor(b.x)},{math.floor(b.y)} hits {self.hits} boxes {#smitten.scene.group("boxes")}`
end
return Main
