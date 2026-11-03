-- graphics3d.json: a small JSON decoder for glTF files.
-- Objects become tables with string keys, arrays become 1-based tables, null
-- becomes nil (array holes stay holes).

local byte, sub, find, char, tonumber = string.byte, string.sub, string.find, string.char, tonumber
local concat = table.concat

local decodeValue

local function fail(str, i, what)
	local line = 1
	for _ in sub(str, 1, i):gmatch("\n") do line = line + 1 end
	error(("JSON error at line %d: %s"):format(line, what), 0)
end

local function skip(str, i)
	local _, e = find(str, "^[ \t\r\n]*", i)
	return e + 1
end

local ESCAPES = { [98] = "\b", [102] = "\f", [110] = "\n", [114] = "\r", [116] = "\t", [34] = '"', [92] = "\\", [47] = "/" }

local function utf8char(cp)
	if cp < 0x80 then return char(cp) end
	if cp < 0x800 then return char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40) end
	if cp < 0x10000 then
		return char(0xE0 + math.floor(cp / 0x1000), 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
	end
	return char(0xF0 + math.floor(cp / 0x40000), 0x80 + math.floor(cp / 0x1000) % 0x40,
		0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
end

local function decodeString(str, i)
	-- i is just after the opening quote.
	local close = find(str, '"', i, true)
	if not close then fail(str, i, "unterminated string") end
	local backslash = find(str, "\\", i, true)
	if not backslash or backslash > close then
		return sub(str, i, close - 1), close + 1
	end
	local parts, n = {}, 0
	local j = i
	while true do
		local s, e = find(str, '["\\]', j)
		if not s then fail(str, j, "unterminated string") end
		n = n + 1
		parts[n] = sub(str, j, s - 1)
		if byte(str, s) == 34 then
			return concat(parts), s + 1
		end
		local c = byte(str, s + 1)
		if c == 117 then -- \uXXXX
			local cp = tonumber(sub(str, s + 2, s + 5), 16)
			if not cp then fail(str, s, "bad \\u escape") end
			local nexti = s + 6
			if cp >= 0xD800 and cp <= 0xDBFF and sub(str, nexti, nexti + 1) == "\\u" then
				local lo = tonumber(sub(str, nexti + 2, nexti + 5), 16)
				if lo and lo >= 0xDC00 and lo <= 0xDFFF then
					cp = 0x10000 + (cp - 0xD800) * 0x400 + (lo - 0xDC00)
					nexti = nexti + 6
				end
			end
			n = n + 1
			parts[n] = utf8char(cp)
			j = nexti
		else
			local esc = ESCAPES[c]
			if not esc then fail(str, s, "bad escape") end
			n = n + 1
			parts[n] = esc
			j = s + 2
		end
	end
end

function decodeValue(str, i)
	i = skip(str, i)
	local c = byte(str, i)
	if c == 123 then -- {
		local obj = {}
		i = skip(str, i + 1)
		if byte(str, i) == 125 then return obj, i + 1 end
		while true do
			if byte(str, i) ~= 34 then fail(str, i, "expected a string key") end
			local key
			key, i = decodeString(str, i + 1)
			i = skip(str, i)
			if byte(str, i) ~= 58 then fail(str, i, "expected ':'") end
			local value
			value, i = decodeValue(str, i + 1)
			obj[key] = value
			i = skip(str, i)
			c = byte(str, i)
			if c == 125 then return obj, i + 1 end
			if c ~= 44 then fail(str, i, "expected ',' or '}'") end
			i = skip(str, i + 1)
		end
	elseif c == 91 then -- [
		local arr, n = {}, 0
		i = skip(str, i + 1)
		if byte(str, i) == 93 then return arr, i + 1 end
		while true do
			local value
			value, i = decodeValue(str, i)
			n = n + 1
			arr[n] = value
			i = skip(str, i)
			c = byte(str, i)
			if c == 93 then return arr, i + 1 end
			if c ~= 44 then fail(str, i, "expected ',' or ']'") end
			i = i + 1
		end
	elseif c == 34 then
		return decodeString(str, i + 1)
	elseif c == 116 then
		if sub(str, i, i + 3) == "true" then return true, i + 4 end
	elseif c == 102 then
		if sub(str, i, i + 4) == "false" then return false, i + 5 end
	elseif c == 110 then
		if sub(str, i, i + 3) == "null" then return nil, i + 4 end
	else
		local s, e = find(str, "^-?%d+%.?%d*[eE]?[-+]?%d*", i)
		if s then
			local num = tonumber(sub(str, s, e))
			if num then return num, e + 1 end
		end
	end
	fail(str, i, "unexpected character '" .. (sub(str, i, i) or "") .. "'")
end

local function decode(str)
	local value, i = decodeValue(str, 1)
	i = skip(str, i)
	if i <= #str then fail(str, i, "trailing characters") end
	return value
end

return { decode = decode }
