-- smitten.assets: finding and caching the files Smitten's tools make.
--
-- Asset paths are relative to the game folder and may leave out the
-- extension: smitten.sprite("sprites/hero") finds sprites/hero.png.

local json = require("smitten.json").json

local assets = {}

local caches = {}

---Find an asset file. Tries the path as given, then with each extension.
---Raises an error naming every path tried if none exists.
---@param path string
---@param extensions string[] e.g. {".png"}
---@param what string what is being loaded, for the error message, e.g. "sprite"
---@return string
function assets.resolve(path, extensions, what)
	if type(path) ~= "string" or path == "" then
		error(("smitten.%s: expected a file path, got %s"):format(what, type(path)), 3)
	end
	path = path:gsub("\\", "/"):gsub("^%./", "")
	local tried = {}
	local function try(p)
		tried[#tried + 1] = p
		return love.filesystem.getInfo(p, "file") ~= nil
	end
	for _, ext in ipairs(extensions) do
		if path:sub(-#ext):lower() == ext:lower() and try(path) then return path end
	end
	for _, ext in ipairs(extensions) do
		if try(path .. ext) then return path .. ext end
	end
	error(("smitten.%s: can't find %q (looked for %s)"):format(what, path, table.concat(tried, ", ")), 3)
end

---Read and decode a JSON file from the game folder.
---@param path string
---@return table
function assets.readJSON(path)
	local text, err = love.filesystem.read(path)
	if not text then error(("can't read %s: %s"):format(path, tostring(err)), 2) end
	local ok, value = pcall(json.decode, text)
	if not ok then error(("%s: %s"):format(path, value), 2) end
	return value
end

---The folder part of a path ("maps/level1.map.json" -> "maps/"), or "".
---@param path string
---@return string
function assets.folder(path)
	return path:match("^(.*/)") or ""
end

---Join a path relative to the file it appears in ("maps/" + "../tiles.png").
---@param base string a file path, e.g. "maps/level1.map.json"
---@param relative string
---@return string
function assets.join(base, relative)
	if relative:sub(1, 1) == "/" then return relative:sub(2) end
	local parts = {}
	for part in (assets.folder(base) .. relative):gmatch("[^/]+") do
		if part == ".." then parts[#parts] = nil
		elseif part ~= "." then parts[#parts + 1] = part end
	end
	return table.concat(parts, "/")
end

---Load an asset once per kind and path; later calls return the same object.
---@param kind string e.g. "sprite"
---@param path string a resolved path
---@param load fun(path: string): any
function assets.cached(kind, path, load)
	local cache = caches[kind]
	if not cache then
		cache = {}
		caches[kind] = cache
	end
	local value = cache[path]
	if value == nil then
		value = load(path)
		cache[path] = value
	end
	return value
end

---Forget cached assets (all, or one kind), so they're loaded again.
---@param kind? string
function assets.clear(kind)
	if kind then caches[kind] = nil else caches = {} end
end

return { assets = assets }
