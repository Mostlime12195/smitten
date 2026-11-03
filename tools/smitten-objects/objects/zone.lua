-- No sprite and no color: invisible; its hitbox is the placed size.
local Zone = smitten.object {}
function Zone:create() self.entered = 0 end
function Zone:touch(other) self.entered += 1 end
return Zone
