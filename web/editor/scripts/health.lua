-- Health: hit points for a player, an enemy or a crate.
-- Other scripts call hurt() and heal() on the piece: other:hurt(1).
-- The piece sends the events "damaged", "healed" and "died". Add
-- function died() to this script, or listen from a different script with
-- piece:on("died", function() ... end).

health = 3              -- the hit points now
maxHealth = 3           -- heal() does not go above this number
invincibleTime = 1      -- seconds after a hit when more hits do nothing
blink = true            -- blink while more hits do nothing
removeOnDeath = true    -- remove the piece when its health gets to 0

local safeFor = 0

-- Returns true if the hit counted.
function hurt(amount)
  amount = amount or 1
  if safeFor > 0 or health <= 0 then return false end
  health = math.max(health - amount, 0)
  safeFor = invincibleTime
  emit("damaged", amount)
  if health <= 0 then
    emit("died")
    if removeOnDeath then destroy() end
  end
  return true
end

function heal(amount)
  health = math.min(health + (amount or 1), maxHealth)
  emit("healed", health)
end

function isInvincible()
  return safeFor > 0
end

function update(dt)
  if safeFor <= 0 then return end
  safeFor -= dt
  if blink then visible = safeFor <= 0 or math.floor(safeFor * 10) % 2 == 0 end
end
