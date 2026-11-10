-- A Button's script with the new names.
clicks = 0

function clicked()
  clicks += 1
end

-- pressed() here is the input call, whatever the Button's event is called.
function accepting()
  return pressed("accept")
end
