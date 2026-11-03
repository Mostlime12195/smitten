-- Small helpers shared by the engine's modules.

local util = {}

local function distance(a, b)
	a, b = a:lower(), b:lower()
	local la, lb = #a, #b
	if la == 0 then return lb end
	if lb == 0 then return la end
	local prev, cur = {}, {}
	for j = 0, lb do prev[j] = j end
	for i = 1, la do
		cur[0] = i
		for j = 1, lb do
			local cost = a:sub(i, i) == b:sub(j, j) and 0 or 1
			cur[j] = math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
		end
		prev, cur = cur, prev
	end
	return prev[lb]
end

---" (did you mean "x"?)" for the closest name, or "".
function util.didYouMean(name, names)
	local best, bestD = nil, math.huge
	for _, n in ipairs(names) do
		local d = distance(name, n)
		if d < bestD then best, bestD = n, d end
	end
	if best and bestD <= math.max(2, math.floor(#name / 3)) then
		return (" (did you mean %q?)"):format(best)
	end
	return ""
end

return util
