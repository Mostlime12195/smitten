-- Countdown: counts down from a number of seconds and shows the time that
-- remains. Attach it to a Label or a Text. At 0, the root piece of the
-- scene gets the event "timeUp": add function timeUp() to its script.

duration = 60           -- the seconds to count down from
prefix = "Time: "       -- the words before the number
showTenths = false      -- show 9.5, not 10
startNow = true         -- start when the scene starts. If false, a script calls startCountdown()

local left, running = 0, false

local function show()
  local shown = if showTenths then string.format("%.1f", left) else tostring(math.ceil(left))
  text = prefix .. shown
end

-- Starts again from duration (or from the seconds that you give).
function startCountdown(seconds)
  left = seconds or duration
  running = true
  show()
end

function stopCountdown()
  running = false
end

function timeLeft()
  return left
end

function ready()
  left = duration
  show()
  if startNow then startCountdown() end
end

function update(dt)
  if not running then return end
  left = math.max(left - dt, 0)
  show()
  if left == 0 then
    running = false
    root():emit("timeUp", self)
  end
end
