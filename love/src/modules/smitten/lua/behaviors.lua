-- The built-in behaviors for objects (docs/objects-and-scenes.md,
-- "Behaviors"): `behaviors = { "platformer" }` in an object definition.
--
-- Each behavior has `defaults` (fields copied into the object type unless it
-- sets them), and `create(o)` / `update(o, dt)` functions the engine calls
-- for every object that has it (update before the object's own update).
-- world.lua loads this file with the pieces of the engine it needs:
-- require("smitten.behaviors")({ W = <the running scene>, move = <moveObject> }).

return function(engine)
	local W, move = engine.W, engine.move

	local min, max, sqrt = math.min, math.max, math.sqrt

	local input
	local function controls()
		if not input then input = require("smitten.input").input end
		return input
	end

	-- Keep an object's hitbox inside the scene from left to right (and from
	-- top to bottom too if `vertical`).
	local function keepInside(o, vertical)
		local l = o.x + o.offsetX
		if l < 0 then
			o.x = -o.offsetX
			if o.vx < 0 then o.vx = 0 end
		elseif l + o.width > W.width then
			o.x = W.width - o.width - o.offsetX
			if o.vx > 0 then o.vx = 0 end
		end
		if vertical then
			local t = o.y + o.offsetY
			if t < 0 then
				o.y = -o.offsetY
				if o.vy < 0 then o.vy = 0 end
			elseif t + o.height > W.height then
				o.y = W.height - o.height - o.offsetY
				if o.vy > 0 then o.vy = 0 end
			end
		end
	end

	-- Play an animation if the sprite has it.
	local function animate(o, name, fallback)
		local a = o.anim
		if not a then return end
		local s = a.sprite
		if s:has(name) then
			a:play(name)
		elseif fallback and s:has(fallback) then
			a:play(fallback)
		end
	end

	local behaviors = {}

	-- Running and jumping, with forgiving controls: coyote time (a jump just
	-- after running off a ledge still works) and jump buffering (a jump
	-- pressed just before landing happens on landing).
	behaviors.platformer = {
		defaults = {
			speed = 90, acceleration = 900, jumpSpeed = 260, gravity = 760, maxFall = 420,
			coyoteTime = 0.1, jumpBuffer = 0.12,
		},
		create = function(o)
			o._coyote, o._buffer = 0, 0
			o._onGround = true -- so an object placed on the ground doesn't "land" when the scene starts
		end,
		update = function(o, dt)
			local dir, pressed, held
			if o.controls then
				local c = controls()
				dir = c.axis("left", "right")
				pressed = c.pressed("jump")
				held = c.down("jump")
			else
				dir = o.moveX or 0
				dir = dir > 1 and 1 or (dir < -1 and -1 or dir)
				pressed = o._wantJump == true
				held = true
			end
			o._wantJump = false
			if pressed then o._buffer = o.jumpBuffer else o._buffer = o._buffer - dt end
			if o._onGround then o._coyote = o.coyoteTime else o._coyote = o._coyote - dt end

			-- Run: accelerate towards the running speed instead of jumping to it.
			local target = dir * o.speed
			local step = o.acceleration * dt
			local vx = o.vx
			if vx < target then vx = min(vx + step, target) elseif vx > target then vx = max(vx - step, target) end
			o.vx = vx
			if dir ~= 0 then o.flipX = dir < 0 end

			if o._buffer > 0 and o._coyote > 0 then
				o.vy = -o.jumpSpeed
				o._buffer, o._coyote = 0, 0
				o._onGround = false
				if o.jumped then o:jumped() end
			end
			-- Letting go of jump early makes a lower jump.
			local g = o.gravity
			if o.vy < 0 and not held then g = g * 2.2 end
			o.vy = min(o.vy + g * dt, o.maxFall)

			local hitX, hitY, ground = move(o, o.vx * dt, o.vy * dt)
			if hitX then o.vx = 0 end
			if hitY then o.vy = 0 end
			keepInside(o, false)
			local was = o._onGround
			o._onGround = ground
			if ground and not was and o.landed then o:landed() end

			if o.y + o.offsetY > W.height then
				if o.fell then o:fell() else o:respawn() end
			end

			if not o._onGround then
				if o.vy < 0 then animate(o, "jump", "fall") else animate(o, "fall", "jump") end
			elseif dir ~= 0 then
				animate(o, "run", "walk")
			else
				animate(o, "idle")
			end
		end,
	}

	-- Walking in 8 directions, as seen from above.
	behaviors.topdown = {
		defaults = { speed = 80 },
		update = function(o, dt)
			local dx, dy
			if o.controls then
				local c = controls()
				dx, dy = c.axis("left", "right"), c.axis("up", "down")
			else
				dx, dy = o.moveX or 0, o.moveY or 0
			end
			local len = sqrt(dx * dx + dy * dy)
			if len > 1 then dx, dy = dx / len, dy / len end
			o.vx, o.vy = dx * o.speed, dy * o.speed
			local hitX, hitY = move(o, o.vx * dt, o.vy * dt)
			if hitX then o.vx = 0 end
			if hitY then o.vy = 0 end
			keepInside(o, true)
			if dx ~= 0 then o.flipX = dx < 0 end
			if dx ~= 0 or dy ~= 0 then animate(o, "walk", "run") else animate(o, "idle") end
		end,
	}

	-- Moving by vx, vy: bullets, patrolling enemies. Stops at walls, or turns
	-- around with bounce = true. Falls if it has a gravity. Destroyed once
	-- it's out of the scene.
	behaviors.mover = {
		defaults = { bounce = false },
		update = function(o, dt)
			local g = o.gravity
			if g then o.vy = min(o.vy + g * dt, o.maxFall or 420) end
			local hitX, hitY = move(o, o.vx * dt, o.vy * dt)
			if hitX then
				if o.bounce then o.vx = -o.vx else o.vx = 0 end
			end
			if hitY then
				if o.bounce and not g then o.vy = -o.vy else o.vy = 0 end
			end
			if o.vx ~= 0 then o.flipX = o.vx < 0 end
			local l, t, w, h = o.x + o.offsetX, o.y + o.offsetY, o.width, o.height
			if l > W.width + w or l + w < -w or t > W.height + h or t + h < -h then
				o:destroy()
				return
			end
			if o.vx ~= 0 or o.vy ~= 0 then animate(o, "walk", "run") else animate(o, "idle") end
		end,
	}

	behaviors._names = { "mover", "platformer", "topdown" }
	behaviors._aliases = { ["top-down"] = "topdown", topDown = "topdown", ["top down"] = "topdown" }
	return behaviors
end
