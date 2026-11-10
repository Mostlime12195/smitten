local maze
local ghost
local player
local startX, startY


function setup()
  maze = root():find("Maze")
  ghost = root():find("Ghost")
  player = root():find("Player")
  startX, startY = ghost.x, ghost.y
end

steps = {
  { 0.2, function()
    check("the edge of the maze is solid", maze:isSolid(0, 0) and maze:isSolid(39, 21))
    local grid = maze:newPathGrid({ diagonals = "noCorners" })
    local path = grid:findPoints(ghost.x, ghost.y, player.x, player.y)
    check("there is a path from the ghost to the player", path ~= nil and #path > 20, path and #path)
  end },
  { 2.5, function()
    check("the ghost moves", dist(startX, startY, ghost.x, ghost.y) > 30, dist(startX, startY, ghost.x, ghost.y))
    check("the ghost is not in a wall", not maze:isSolid(maze:cellAt(ghost.x, ghost.y)))
    done()
  end },
}
