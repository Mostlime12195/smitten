-- Tests for love/src/modules/engine/random.lua (seeds, generators of
-- their own, noise) with stand-ins for love.math:
--
--   lua5.1 tools/random-tests/test.lua
--
-- The real generator (LÖVE's xorshift) and the real noise are checked in
-- the engine by the forces scene test (tools/scene-tests/forces).

package.path = "love/src/modules/engine/?.lua;" .. package.path
local random = require("random")

local passed, failed = 0, 0
local function check(name, ok, ...)
	if ok then
		passed = passed + 1
	else
		failed = failed + 1
		print("FAIL " .. name, ...)
	end
end

-- A stand-in for LÖVE's RandomGenerator: a small LCG on the two halves.
local Gen = {}
Gen.__index = Gen
local function newGen()
	return setmetatable({ s = 1 }, Gen)
end
function Gen:setSeed(low, high)
	assert(type(low) == "number" and low >= 0 and low < 2 ^ 32 and low == math.floor(low), "low half")
	assert(type(high) == "number" and high >= 0 and high < 2 ^ 32 and high == math.floor(high), "high half")
	self.s = (low * 7 + high * 13 + 1) % 2147483647
	if self.s == 0 then self.s = 1 end
end
function Gen:_next()
	self.s = (self.s * 48271) % 2147483647
	return self.s / 2147483647
end
function Gen:random(l, u)
	local r = self:_next()
	if u then return math.floor(r * (u - l + 1)) + l end
	if l then return math.floor(r * l) + 1 end
	return r
end
function Gen:randomNormal(sd, mean) return (self:_next() - 0.5) * (sd or 1) + (mean or 0) end
function Gen:getState() return string.format("0x%x", self.s) end
function Gen:setState(st) self.s = tonumber(st:sub(3), 16) end

local global = newGen()
local lastSeed = nil
local lm = {
	random = function(l, u) return global:random(l, u) end,
	setRandomSeed = function(low, high)
		lastSeed = { low, high }
		global:setSeed(low, high)
	end,
	newRandomGenerator = newGen,
	-- Smooth and from 0 to 1, like simplex noise.
	simplexNoise = function(x, y, z, w)
		return 0.5 + 0.25 * math.sin(x * 1.7 + (y or 0) * 0.9) + 0.25 * math.cos((y or 0) * 1.3 - (z or 0) * 0.7 + (w or 0))
	end,
	now = function() return 12.345678 end,
}
random.install(lm)

-- Seeds as two halves
local lo, hi = random.seedParts(42)
check("a small seed is used as it is", lo == 42 and hi == 0, lo, hi)
lo, hi = random.seedParts(2 ^ 40 + 5)
check("a big seed is split", lo == 5 and hi == 256, lo, hi)
local a1, b1 = random.seedParts("level 1")
local a2, b2 = random.seedParts("level 1")
local a3, b3 = random.seedParts("level 2")
check("a string seed is the same every time", a1 == a2 and b1 == b2)
check("different strings, different seeds", a1 ~= a3 or b1 ~= b3)
for _, s in ipairs({ -1, 0.5, -123.25, 2 ^ 60, "", "a long seed with spaces and ünïcode" }) do
	local l, h = random.seedParts(s)
	check("seed " .. tostring(s) .. " gives two 32-bit halves",
		l >= 0 and l < 2 ^ 32 and h >= 0 and h < 2 ^ 32 and l == math.floor(l) and h == math.floor(h), l, h)
end
local l1, h1 = random.seedParts(-1)
local l2, h2 = random.seedParts(1)
check("-1 and 1 differ", l1 ~= l2 or h1 ~= h2)
local ok, err = pcall(random.seedParts, {})
check("a table isn't a seed", not ok and tostring(err):find("a seed is a number or a string", 1, true), err)

-- seed()
check("seed(n) returns n", random.seed(42) == 42)
check("seed(n) seeds the game's generator", lastSeed[1] == 42 and lastSeed[2] == 0)
local first = { lm.random(), lm.random(), lm.random() }
random.seed(42)
check("the same seed, the same numbers", lm.random() == first[1] and lm.random() == first[2] and lm.random() == first[3])
local s = random.seed()
check("seed() makes up a whole number and returns it", type(s) == "number" and s == math.floor(s) and s >= 0, s)
local s2 = random.seed()
check("seed() twice gives two seeds", s ~= s2, s, s2)

-- shuffle
local list = {}
for i = 1, 20 do list[i] = i end
local out = random.shuffle(list)
check("shuffle returns the list", out == list)
local seen, moved = {}, 0
for i = 1, 20 do
	seen[list[i]] = true
	if list[i] ~= i then moved = moved + 1 end
end
local all = true
for i = 1, 20 do all = all and seen[i] == true end
check("shuffle keeps every item", all and #list == 20)
check("shuffle mixes them up", moved > 5, moved)
check("shuffle of an empty list", #random.shuffle({}) == 0)

-- Generators of their own
local r1 = random.newRandom(7)
local r2 = random.newRandom(7)
check("getSeed", r1:getSeed() == 7)
local same = true
for _ = 1, 50 do same = same and r1:rnd() == r2:rnd() end
check("two generators with one seed agree", same)
random.seed(1)
local g1 = lm.random()
random.seed(1)
local r3 = random.newRandom(99)
for _ = 1, 10 do r3:rnd() end
check("a generator doesn't use up the game's numbers", lm.random() == g1)
local st = r1:getState()
local next3 = { r1:rnd(), r1:rnd(), r1:rnd() }
r1:setState(st)
check("setState goes back", r1:rnd() == next3[1] and r1:rnd() == next3[2] and r1:rnd() == next3[3])
local inRange = true
for _ = 1, 200 do
	local v = r1:rnd(10)
	local i = r1:random(3, 5)
	local f = r1:randomFloat(-2, 2)
	inRange = inRange and v >= 0 and v < 10 and i >= 3 and i <= 5 and i == math.floor(i) and f >= -2 and f <= 2
end
check("rnd, random and randomFloat stay in range", inRange)
local picked = {}
for _ = 1, 100 do picked[r1:rnd({ "a", "b", "c" })] = true end
check("rnd(list) picks items", picked.a and picked.b and picked.c)
local chosen = {}
for _ = 1, 100 do chosen[r1:choose("x", "y")] = true end
check("choose", chosen.x and chosen.y)
check("pick", r1:pick({ "only" }) == "only")
local yes = 0
for _ = 1, 1000 do if r1:chance(0.25) then yes = yes + 1 end end
check("chance(0.25) about a quarter of the time", yes > 180 and yes < 320, yes)
local deck = { 1, 2, 3, 4, 5, 6, 7, 8 }
r1:shuffle(deck)
table.sort(deck)
check("a generator's shuffle keeps every item", table.concat(deck, ",") == "1,2,3,4,5,6,7,8")
local r4 = random.newRandom()
check("newRandom() makes up a seed", type(r4:getSeed()) == "number")
r4:setSeed("world")
check("setSeed with a string", r4:getSeed() == "world")

-- Noise
check("noise is from 0 to 1", random.noise(0.3) >= 0 and random.noise(0.3, 2) <= 1 and random.noise(1, 2, 3) >= 0)
check("noise is the same every time", random.noise(1.5, 2.5) == random.noise(1.5, 2.5))
local n1 = random.newNoise({ seed = 5, scale = 40, octaves = 4 })
local n2 = random.newNoise({ seed = 5, scale = 40, octaves = 4 })
local n3 = random.newNoise({ seed = 6, scale = 40, octaves = 4 })
check("noise settings", n1.scale == 40 and n1.octaves == 4 and n1.roughness == 0.5 and n1:getSeed() == 5)
local agree, differ, range, smooth = true, false, true, true
for x = 0, 200, 7 do
	for y = 0, 100, 9 do
		local v = n1:get(x, y)
		agree = agree and v == n2:get(x, y)
		differ = differ or v ~= n3:get(x, y)
		range = range and v >= 0 and v <= 1
		smooth = smooth and math.abs(v - n1:get(x + 0.5, y)) < 0.05
	end
end
check("one seed, the same noise", agree)
check("another seed, other noise", differ)
check("seeded noise is from 0 to 1", range)
check("seeded noise is smooth", smooth)
local n4 = random.newNoise(5)
check("newNoise(seed)", n4:getSeed() == 5 and n4.scale == 100 and n4.octaves == 1)
check("1D and 3D", n4:get(3) >= 0 and n4:get(3, 4, 5) <= 1)
n4.octaves = 3
local v3 = n4:get(10, 20)
n4.octaves = 1
local v1 = n4:get(10, 20)
n4.octaves = 3
check("octaves can change", n4:get(10, 20) == v3 and v1 ~= v3)
n4.scale = 0
ok, err = pcall(n4.get, n4, 1, 2)
check("scale 0 says what to do", not ok and tostring(err):find("isn't 0", 1, true), err)
local n5 = random.newNoise({ seed = 1, octaves = 2, roughness = 0 })
local n6 = random.newNoise({ seed = 1, octaves = 1 })
check("roughness 0 is the first layer only", n5:get(12, 34) == n6:get(12, 34))

print(string.format("DONE %d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
