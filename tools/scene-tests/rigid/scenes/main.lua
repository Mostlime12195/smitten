local Main = {}
function Main:ready()
  self.hits = 0
  self:find("Ball"):on("hit", function(other) self.hits += 1 end)
end
function Main:update(dt)
  local b = self:find("Ball")
  self:find("Info").text = `ball {math.floor(b.x)},{math.floor(b.y)} hits {self.hits} boxes {#smitten.scene.tagged("box")} ghost y {math.floor(self:find("Ghost").y)}`
end
return Main
