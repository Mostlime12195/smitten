-- Names a script may and may not assign inside a function.
score = 0
target = nil

function declared()
  score = score + 1
  target = "x"
  vx = 3
  fromInspector = 6
  self.fresh = 1
  fresh = 2
  local own = 1
  own = 2
  return own
end

function typo()
  local done = false
  scroe = 5
  return done
end

function cleared()
  target = nil
  target = "again"
  fromInspector = nil
  fromInspector = 7
end
