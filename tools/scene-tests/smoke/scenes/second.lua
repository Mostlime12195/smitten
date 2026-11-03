-- The smoke test's second scene: gets go()'s values, then goes back.

function ready(word, n)
  print("second scene", word, n, game.visits, smitten.scene.args[1])
  wait(0.5)
  go("scenes/main.scene")
end
