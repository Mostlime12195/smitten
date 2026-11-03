-- A burst of sparks that removes itself once the last one is gone.

function finished()
  print("sparks finished", getCount())
  destroy()
end
