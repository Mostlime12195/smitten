-- A binary heap for the pathfinders: the entry with the lowest f comes out
-- first; ties go to the lowest h (the one nearer the goal), then the lowest
-- order, so a search always gives the same path. Entries live in four
-- arrays that are reused from one search to the next.

local heap = {}

function heap.new()
	return { n = 0, node = {}, f = {}, h = {}, order = {} }
end

function heap.push(hp, node, f, h, order)
	local nodes, fs, hs, os = hp.node, hp.f, hp.h, hp.order
	local i = hp.n + 1
	hp.n = i
	while i > 1 do
		local p = (i - i % 2) / 2
		local pf = fs[p]
		if pf < f then break end
		if pf == f then
			local ph = hs[p]
			if ph < h or (ph == h and os[p] <= order) then break end
		end
		nodes[i], fs[i], hs[i], os[i] = nodes[p], pf, hs[p], os[p]
		i = p
	end
	nodes[i], fs[i], hs[i], os[i] = node, f, h, order
end

---Takes out the first entry: node, f (nil when the heap is empty). Its h
---is left in heap.lastH.
function heap.pop(hp)
	local n = hp.n
	if n == 0 then return nil end
	local nodes, fs, hs, os = hp.node, hp.f, hp.h, hp.order
	local top, topF = nodes[1], fs[1]
	hp.lastH = hs[1]
	local node, f, h, order = nodes[n], fs[n], hs[n], os[n]
	nodes[n] = nil
	n = n - 1
	hp.n = n
	local i = 1
	while true do
		local c = i * 2
		if c > n then break end
		local cf, ch, co = fs[c], hs[c], os[c]
		if c < n then
			local rf = fs[c + 1]
			if rf < cf or (rf == cf and (hs[c + 1] < ch or (hs[c + 1] == ch and os[c + 1] < co))) then
				c = c + 1
				cf, ch, co = rf, hs[c], os[c]
			end
		end
		if f < cf or (f == cf and (h < ch or (h == ch and order <= co))) then break end
		nodes[i], fs[i], hs[i], os[i] = nodes[c], cf, ch, co
		i = c
	end
	if n > 0 then nodes[i], fs[i], hs[i], os[i] = node, f, h, order end
	return top, topF
end

function heap.clear(hp)
	local nodes = hp.node
	for i = hp.n, 1, -1 do nodes[i] = nil end
	hp.n = 0
end

return heap
