-- Random numbers that can be repeated, and smooth noise (docs/random.md).
--
-- * seed(n) seeds the generator that rnd(), choose() and smitten.math's
--   random, chance, pick, shuffle and randomFloat use (LÖVE's own, in
--   love.math): the same seed gives the same numbers on every browser.
--   seed() picks a new seed nobody can guess, and returns it. Particles and
--   the camera's shake have generators of their own, so they don't use up
--   a seeded game's numbers.
-- * newRandom(seed) is a generator of its own, for a world generator that
--   repeats without changing the game's other random numbers.
-- * noise(x, y?, z?) is smooth noise from 0 to 1, the same every time;
--   newNoise{ seed, scale, octaves, roughness } is noise with a seed, a size
--   and layers of finer detail, for hills and caves.
--
-- A seed is a whole number from 0 to 2^53 (used as it is) or anything else
-- that prints (a string, a negative number...), turned into a number by a
-- hash. Box2D, timers and the rest never draw from these generators.
--
-- Pure Lua apart from what it's given (init.lua hands over love.math), so
-- tools/random-tests/test.lua runs it with stand-ins.

local floor, max, min = math.floor, math.max, math.min

local M = {}

local TWO32 = 4294967296

-- A seed as the two 32-bit halves a LÖVE RandomGenerator takes.
local function seedParts(s)
	if type(s) == "number" and s >= 0 and s < 2 ^ 53 and s == floor(s) then
		return s % TWO32, floor(s / TWO32)
	end
	local t = type(s)
	if t ~= "number" and t ~= "string" then
		error("a seed is a number or a string, like seed(42) or seed(\"level 1\"), not a " .. t, 3)
	end
	local text = t == "number" and string.format("%.17g", s) or s
	local a, b = 7, 11
	for i = 1, #text do
		local c = text:byte(i)
		a = (a * 31 + c) % TWO32
		b = (b * 131 + c) % TWO32
	end
	return a, b
end
M.seedParts = seedParts

local counter = 0

-- A seed nobody can guess: the time, to the microsecond.
local function freshSeed(lm)
	counter = counter + 1
	local t = (lm.now and lm.now() or 0) * 1e6
	return floor((os.time() * 1000003 + t + counter * 7919) % 2147483647)
end

function M.install(lm)
	-- lm: love.math (random, setRandomSeed, newRandomGenerator, simplexNoise),
	-- plus now(), a time in seconds.
	local random = lm.random

	---seed(n): rnd() and the rest give the same numbers each time after it.
	---seed(): numbers nobody can guess again. Returns the seed.
	function M.seed(s)
		if s == nil then s = freshSeed(lm) end
		lm.setRandomSeed(seedParts(s))
		return s
	end

	---Mixes up a list in place (and returns it).
	function M.shuffle(list, rand)
		rand = rand or random
		for i = #list, 2, -1 do
			local j = rand(1, i)
			list[i], list[j] = list[j], list[i]
		end
		return list
	end

	-------------------------------------------------------------------------
	-- Generators of their own

	local Random = {}
	Random.__index = Random
	M.Random = Random

	function M.newRandom(s)
		local r = setmetatable({ _g = lm.newRandomGenerator() }, Random)
		r:setSeed(s)
		return r
	end

	function Random:setSeed(s)
		if s == nil then s = freshSeed(lm) end
		self._seed = s
		self._g:setSeed(seedParts(s))
		return s
	end
	function Random:getSeed() return self._seed end
	---A string that setState() takes back, to carry on from here later.
	function Random:getState() return self._g:getState() end
	function Random:setState(state) self._g:setState(state) end

	function Random:random(a, b) return self._g:random(a, b) end
	function Random:rnd(n)
		if type(n) == "table" then return n[self._g:random(1, #n)] end
		return self._g:random() * (n or 1)
	end
	function Random:choose(...)
		return (select(self._g:random(1, select("#", ...)), ...))
	end
	function Random:chance(p) return self._g:random() < p end
	function Random:pick(list) return list[self._g:random(1, #list)] end
	function Random:randomFloat(a, b) return a + (b - a) * self._g:random() end
	function Random:randomNormal(stddev, mean) return self._g:randomNormal(stddev, mean) end
	function Random:shuffle(list)
		local g = self._g
		for i = #list, 2, -1 do
			local j = g:random(1, i)
			list[i], list[j] = list[j], list[i]
		end
		return list
	end

	-------------------------------------------------------------------------
	-- Noise

	local simplex = lm.simplexNoise

	local function clamp01(v) return v < 0 and 0 or v > 1 and 1 or v end

	---Smooth noise from 0 to 1 at a point: noise(x), noise(x, y) or
	---noise(x, y, z) (or x, y, z, w). Points close together give values
	---close together.
	function M.noise(x, y, z, w)
		if w ~= nil then return clamp01(simplex(x, y, z, w)) end
		if z ~= nil then return clamp01(simplex(x, y, z)) end
		if y ~= nil then return clamp01(simplex(x, y)) end
		return clamp01(simplex(x))
	end

	local Noise = {}
	Noise.__index = Noise
	M.Noise = Noise

	---newNoise(seed) or newNoise{ seed = 7, scale = 40, octaves = 4, roughness = 0.5 }.
	function M.newNoise(options)
		local o = type(options) == "table" and options or { seed = options }
		local n = setmetatable({
			scale = o.scale or 100,
			octaves = o.octaves or 1,
			roughness = o.roughness or 0.5,
			_offsets = {},
		}, Noise)
		n:setSeed(o.seed)
		return n
	end

	-- Each octave samples the noise somewhere else, picked by the seed.
	function Noise:setSeed(s)
		if s == nil then s = freshSeed(lm) end
		self._seed = s
		self._gen = lm.newRandomGenerator()
		self._gen:setSeed(seedParts(s))
		local offs = self._offsets
		for i = #offs, 1, -1 do offs[i] = nil end
		return s
	end
	function Noise:getSeed() return self._seed end

	local function offsets(self, octaves)
		local offs = self._offsets
		local g = self._gen
		while #offs < octaves * 3 do offs[#offs + 1] = g:random() * 256 end
		return offs
	end

	---The noise at a point, from 0 to 1: get(x), get(x, y) or get(x, y, z).
	function Noise:get(x, y, z)
		local scale = self.scale
		if type(scale) ~= "number" or scale == 0 then
			error("a noise's scale has to be a number that isn't 0, like 40", 2)
		end
		local octaves = max(1, min(16, floor(tonumber(self.octaves) or 1)))
		local rough = max(0, tonumber(self.roughness) or 0.5)
		local offs = offsets(self, octaves)
		local f = 1 / scale
		local amp, sum, total = 1, 0, 0
		for i = 1, octaves do
			local k = i * 3
			local v
			if z ~= nil then
				v = simplex(x * f + offs[k - 2], y * f + offs[k - 1], z * f + offs[k])
			elseif y ~= nil then
				v = simplex(x * f + offs[k - 2], y * f + offs[k - 1])
			else
				v = simplex(x * f + offs[k - 2])
			end
			sum = sum + clamp01(v) * amp
			total = total + amp
			amp = amp * rough
			f = f * 2
		end
		return sum / total
	end

	return M
end

return M
