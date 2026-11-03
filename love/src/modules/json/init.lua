-- smitten.json: JSON decoding and encoding.
--
-- decode(text) returns Lua values: objects become tables with string keys,
-- arrays become sequences (1-based), null becomes smitten.json.null.
-- encode(value [, indent]) writes tables with only positive integer keys as
-- arrays and others as objects (keys sorted, so output is stable).

local json = {}

json.null = setmetatable({}, { __tostring = function() return "null" end })

local escapes = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

local function decodeError(text, pos, message)
	local line, col = 1, 1
	for i = 1, pos - 1 do
		if text:sub(i, i) == "\n" then line, col = line + 1, 1 else col = col + 1 end
	end
	error(("JSON: %s at line %d, column %d"):format(message, line, col), 0)
end

local function utf8char(code)
	if code < 0x80 then return string.char(code) end
	if code < 0x800 then return string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40) end
	if code < 0x10000 then
		return string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
	end
	return string.char(0xF0 + math.floor(code / 0x40000), 0x80 + math.floor(code / 0x1000) % 0x40,
		0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
end

local decodeValue

local function skip(text, pos)
	return text:find("[^ \t\r\n]", pos) or #text + 1
end

local function decodeString(text, pos)
	local parts, i = {}, pos + 1
	while true do
		local j = text:find('["\\]', i)
		if not j then decodeError(text, pos, "unterminated string") end
		parts[#parts + 1] = text:sub(i, j - 1)
		if text:sub(j, j) == '"' then return table.concat(parts), j + 1 end
		local c = text:sub(j + 1, j + 1)
		if c == "u" then
			local hex = text:sub(j + 2, j + 5)
			local code = tonumber(hex, 16)
			if not code or #hex < 4 then decodeError(text, j, "invalid \\u escape") end
			i = j + 6
			if code >= 0xD800 and code < 0xDC00 and text:sub(i, i + 1) == "\\u" then
				local low = tonumber(text:sub(i + 2, i + 5), 16)
				if low and low >= 0xDC00 and low < 0xE000 then
					code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
					i = i + 6
				end
			end
			parts[#parts + 1] = utf8char(code)
		elseif escapes[c] then
			parts[#parts + 1] = escapes[c]
			i = j + 2
		else
			decodeError(text, j, "invalid escape")
		end
	end
end

function decodeValue(text, pos)
	pos = skip(text, pos)
	local c = text:sub(pos, pos)
	if c == "{" then
		local obj = {}
		pos = skip(text, pos + 1)
		if text:sub(pos, pos) == "}" then return obj, pos + 1 end
		while true do
			if text:sub(pos, pos) ~= '"' then decodeError(text, pos, "expected a string key") end
			local key
			key, pos = decodeString(text, pos)
			pos = skip(text, pos)
			if text:sub(pos, pos) ~= ":" then decodeError(text, pos, "expected ':'") end
			obj[key], pos = decodeValue(text, pos + 1)
			pos = skip(text, pos)
			local d = text:sub(pos, pos)
			if d == "}" then return obj, pos + 1 end
			if d ~= "," then decodeError(text, pos, "expected ',' or '}'") end
			pos = skip(text, pos + 1)
		end
	elseif c == "[" then
		local arr, n = {}, 0
		pos = skip(text, pos + 1)
		if text:sub(pos, pos) == "]" then return arr, pos + 1 end
		while true do
			n = n + 1
			arr[n], pos = decodeValue(text, pos)
			pos = skip(text, pos)
			local d = text:sub(pos, pos)
			if d == "]" then return arr, pos + 1 end
			if d ~= "," then decodeError(text, pos, "expected ',' or ']'") end
			pos = pos + 1
		end
	elseif c == '"' then
		return decodeString(text, pos)
	elseif text:sub(pos, pos + 3) == "true" then
		return true, pos + 4
	elseif text:sub(pos, pos + 4) == "false" then
		return false, pos + 5
	elseif text:sub(pos, pos + 3) == "null" then
		return json.null, pos + 4
	else
		local num = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
		if not num or num == "" or num == "-" then decodeError(text, pos, "unexpected character") end
		local value = tonumber(num)
		if not value then decodeError(text, pos, "invalid number") end
		return value, pos + #num
	end
end

---Decode a JSON string into Lua values.
---@param text string
---@return any
function json.decode(text)
	assert(type(text) == "string", "json.decode expects a string")
	local value, pos = decodeValue(text, 1)
	pos = skip(text, pos)
	if pos <= #text then decodeError(text, pos, "unexpected text after the value") end
	return value
end

local function isArray(t)
	local n = 0
	for k in pairs(t) do
		if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then return false end
		n = n + 1
	end
	return n == #t
end

local function encodeString(s)
	return '"' .. s:gsub('[%c"\\]', function(c)
		local map = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
		return map[c] or ("\\u%04x"):format(c:byte())
	end) .. '"'
end

local function encodeValue(v, indent, depth, seen)
	local t = type(v)
	if v == nil or v == json.null then return "null" end
	if t == "boolean" then return tostring(v) end
	if t == "number" then
		if v ~= v or v == math.huge or v == -math.huge then error("JSON can't encode " .. tostring(v), 0) end
		if v % 1 == 0 and math.abs(v) < 2^53 then return ("%d"):format(v) end
		return ("%.14g"):format(v)
	end
	if t == "string" then return encodeString(v) end
	if t ~= "table" then error("JSON can't encode a " .. t, 0) end
	if seen[v] then error("JSON can't encode a table that contains itself", 0) end
	seen[v] = true
	local nl, pad, inner = "", "", ""
	if indent then
		nl = "\n"
		pad = indent:rep(depth)
		inner = indent:rep(depth + 1)
	end
	local out
	if next(v) == nil then
		out = isArray(v) and "[]" or "{}"
	elseif isArray(v) then
		local items = {}
		for i = 1, #v do items[i] = inner .. encodeValue(v[i], indent, depth + 1, seen) end
		out = "[" .. nl .. table.concat(items, "," .. nl) .. nl .. pad .. "]"
	else
		local keys = {}
		for k in pairs(v) do
			if type(k) ~= "string" and type(k) ~= "number" then error("JSON object keys must be strings", 0) end
			keys[#keys + 1] = tostring(k)
		end
		table.sort(keys)
		local items = {}
		for i, k in ipairs(keys) do
			local value = v[k]
			if value == nil then value = v[tonumber(k)] end
			items[i] = inner .. encodeString(k) .. (indent and ": " or ":") .. encodeValue(value, indent, depth + 1, seen)
		end
		out = "{" .. nl .. table.concat(items, "," .. nl) .. nl .. pad .. "}"
	end
	seen[v] = nil
	return out
end

---Encode a Lua value as JSON. Pass indent (e.g. "  ") for readable output.
---@param value any
---@param indent? string
---@return string
function json.encode(value, indent)
	return encodeValue(value, indent, 0, {})
end

return json
