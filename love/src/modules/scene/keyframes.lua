-- Keyframes: the part of animations that is plain maths, with no pieces in
-- it. The Animator piece (animator.lua) uses it to work out a track's value
-- at a time and the call keys that a stretch of time passes.
--
-- The editor has a copy (web/editor/workspaces/scene/keyframes.js) for the
-- Animate panel's preview. Both are checked with the same cases,
-- tools/scene-tests/animation/keyframe-cases.json (written by
-- tools/scene-tests/make-anim-fixture.mjs): keep the two in step.
--
-- A key is { time = seconds, value = v, easing = name }. A key's easing
-- shapes the change from the key before it to this key, as a tween to it
-- would: the first key's easing isn't used. "step" keeps the value of the
-- key before until this key's time. Numbers change smoothly, and so do lists
-- of numbers of the same length (colors, points); anything else (true,
-- "walk") steps. Before the first key a track has the first key's value,
-- after the last key the last key's.

local tween = require("love.tween")

local M = {}

local easings = {}
for name, fn in pairs(tween.easings) do easings[name] = fn end
-- (Never called: sample() keeps the earlier key's value.)
easings.step = function(t) return 0 end
M.easings = easings

local function linear(t) return t end

---Every easing a key can have, sorted.
function M.easingNames()
	local out = {}
	for name in pairs(easings) do out[#out + 1] = name end
	table.sort(out)
	return out
end

---A copy of a list of keys (or call keys) in time order. Keys at the same
---time keep their order.
function M.sorted(keys)
	local out = {}
	for i = 1, #keys do out[i] = keys[i] end
	-- Insertion sort: stable, and the lists are short.
	for i = 2, #out do
		local k = out[i]
		local t = k.time
		local j = i - 1
		while j >= 1 and out[j].time > t do
			out[j + 1] = out[j]
			j = j - 1
		end
		out[j + 1] = k
	end
	return out
end

---The index of the last key at or before time t (0 if t is before the
---first key). hint, an index found before, makes playing forward cheap.
function M.find(keys, t, hint)
	local n = #keys
	if n == 0 or t < keys[1].time then return 0 end
	if t >= keys[n].time then return n end
	local i = hint
	if i and i >= 1 and i < n and keys[i].time <= t then
		-- Usually the same key or the next one.
		if keys[i + 1].time > t then return i end
		if i + 2 <= n and keys[i + 2].time > t then return i + 1 end
	end
	local lo, hi = 1, n -- keys[lo].time <= t < keys[hi].time
	while hi - lo > 1 do
		local mid = math.floor((lo + hi) / 2)
		if keys[mid].time <= t then lo = mid else hi = mid end
	end
	return lo
end

local function numbers(v, n)
	if type(v) ~= "table" or #v ~= n then return false end
	for i = 1, n do
		if type(v[i]) ~= "number" then return false end
	end
	return true
end

---The value of a track's keys (sorted) at time t, and the key index to give
---as hint next time. A list of numbers that changes is written into out (a
---new table if out is nil).
function M.sample(keys, t, hint, out)
	local n = #keys
	if n == 0 then return nil, 0 end
	local i = M.find(keys, t, hint)
	if i == 0 then return keys[1].value, 0 end
	if i == n then return keys[n].value, n end
	local a, b = keys[i], keys[i + 1]
	local va, vb = a.value, b.value
	local name = b.easing
	if name == "step" then return va, i end
	local span = b.time - a.time
	if span <= 0 then return vb, i end
	local e = (easings[name] or linear)((t - a.time) / span)
	if type(va) == "number" then
		if type(vb) ~= "number" then return va, i end
		return va + (vb - va) * e, i
	end
	if type(va) == "table" then
		local count = #va
		if count > 0 and numbers(va, count) and numbers(vb, count) then
			out = out or {}
			for j = 1, count do out[j] = va[j] + (vb[j] - va[j]) * e end
			for j = count + 1, #out do out[j] = nil end
			return out, i
		end
	end
	return va, i
end

---The call keys (sorted) that time passes going from `from` to `to`, as a
---range of indices to call in order: forward (from <= to) the keys after
---from up to and including to; backward the keys before from down to and
---including to. inclusive counts a key at exactly `from` too (the first step
---after play() or seek()). Forward: first <= last when there are any.
---Backward: first >= last, walked with a step of -1.
function M.callRange(calls, from, to, inclusive)
	local n = #calls
	if from <= to then
		local first = n + 1
		for i = 1, n do
			local t = calls[i].time
			if t > from or (inclusive and t == from) then
				first = i
				break
			end
		end
		local last = first - 1
		for i = first, n do
			if calls[i].time <= to then last = i else break end
		end
		return first, last
	end
	local first = 0
	for i = n, 1, -1 do
		local t = calls[i].time
		if t < from or (inclusive and t == from) then
			first = i
			break
		end
	end
	local last = first + 1
	for i = first, 1, -1 do
		if calls[i].time >= to then last = i else break end
	end
	return first, last
end

return M
