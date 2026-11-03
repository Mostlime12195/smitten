#!/usr/bin/env python3
"""
Stress projects for the engine and the editor.

    python3 tools/stress/gen.py            # all of them, into dist/stress/
    python3 tools/stress/gen.py tiles ui   # just these
    python3 tools/stress/gen.py --list

Each case is a .love (a zipped project) that the player runs:

    python3 serve.py 8770
    http://localhost:8770/player.html?game=stress/sprites.love&autoplay=1
    http://localhost:8770/player.html?game=stress/rigid.love&modules=physics2d&autoplay=1

Every scene's root has scripts/stats.lua, which prints a line to the console
every two seconds: frames per second, the average and worst frame (dt), Lua
memory and the number of pieces. For the time the engine itself spends on a
frame (not capped by the display's refresh rate), paste measure.js into the
page's console: it times every requestAnimationFrame callback.

The editor-* cases are for the editor: import the .love on the home screen
(or see measure.js for a one-liner) and select, drag, paint, scroll and type.
"""
import json
import math
import random
import struct
import sys
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "dist" / "stress"

# ---------------------------------------------------------------------------
# Small helpers


def png(width, height, pixel):
    """An RGBA PNG; pixel(x, y) -> (r, g, b, a) in 0..255."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(kind, data):
        c = kind + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def sprite_png():
    def px(x, y):
        d = math.hypot(x - 7.5, y - 7.5)
        if d > 7.5:
            return (0, 0, 0, 0)
        return (255, 140 + int(d * 10), 90, 255)
    return png(16, 16, px)


TILE_COLORS = [(110, 80, 60), (90, 160, 90), (120, 120, 140), (200, 180, 90)]


def tiles_png():
    # Four 16x16 tiles in a row: dirt, grass, stone, sand.
    def px(x, y):
        r, g, b = TILE_COLORS[x // 16]
        edge = x % 16 in (0, 15) or y in (0, 15)
        k = 0.8 if edge else 1
        return (int(r * k), int(g * k), int(b * k), 255)
    return png(64, 16, px)


TILESET = {"format": "smitten.tileset", "image": "tiles.png", "tileWidth": 16, "tileHeight": 16,
           "tiles": {"0": {"solid": True}, "1": {"solid": True}, "2": {"solid": True}}}


def encode_cells(grid, w, h):
    """grid[y][x] = tile or -1 -> the cells property (tilemap.lua's format)."""
    out, last, run = [], None, 0
    for y in range(h):
        for x in range(w):
            v = grid[y][x]
            if v == last:
                run += 1
            else:
                if run:
                    out.append(f"{last}*{run}" if run > 1 else str(last))
                last, run = v, 1
    if run:
        out.append(f"{last}*{run}" if run > 1 else str(last))
    return {"x": 0, "y": 0, "w": w, "h": h, "data": ",".join(out)}


def piece(name, type_, props=None, children=None, script=None, tags=None):
    e = {"name": name, "type": type_}
    if script:
        e["script"] = script
    if props:
        e["properties"] = props
    if tags:
        e["tags"] = tags
    if children:
        e["children"] = children
    return e


def shape(name="Look", **props):
    return piece(name, "Shape", props)


def color(rng):
    return [round(rng.uniform(0.3, 1), 2), round(rng.uniform(0.3, 1), 2), round(rng.uniform(0.3, 1), 2), 1]


STATS = """-- Prints how the game is doing every two seconds (tools/stress/gen.py).
local Stats = {}

-- Time spent in the scene's update and draw, and in each system (collisions,
-- physics), in ms per frame.
local timing = {}

local function timed(name, t, key)
  local f = t[key]
  t[key] = function(...)
    local t0 = love.timer.getTime()
    local a, b = f(...)
    timing[name] = (timing[name] or 0) + love.timer.getTime() - t0
    return a, b
  end
end

local function count(n)
  local c = 1
  for _, ch in ipairs(n.children) do c = c + count(ch) end
  return c
end

function Stats:ready()
  self._t, self._frames, self._worst, self._sum, self._clock = 0, 0, 0, 0, 0
  timed("update", smitten.scene, "_update")
  timed("draw", smitten.scene, "_draw")
  for name, sys in pairs(smitten.scene._tree.systems) do timed(name, sys, "step") end
  -- smitten.draw runs after the world is drawn: count its draw calls there.
  local stats, prev = self, love.draw
  love.draw = function()
    if prev then prev() end
    stats._draws = love.graphics.getStats().drawcalls
  end
  print(("stress %s: %d pieces, loaded in %.0f ms"):format(self.name, count(self), love.timer.getTime() * 1000))
end

function Stats:update(dt)
  self._t = self._t + dt
  self._clock = self._clock + dt
  self._frames = self._frames + 1
  self._sum = self._sum + dt
  if dt > self._worst then self._worst = dt end
  if self._t >= 2 then
    print(("stress %s t=%ds fps=%.1f dt=%.1fms worst=%.1fms lua=%.0fKB pieces=%d draws=%d"):format(
      self.name, math.floor(self._clock), self._frames / self._t, self._sum / self._frames * 1000,
      self._worst * 1000, collectgarbage("count"), count(self), self._draws or -1))
    local parts = {}
    for name, t in pairs(timing) do parts[#parts + 1] = ("%s=%.2fms"):format(name, t / self._frames * 1000) end
    table.sort(parts)
    print("stress   " .. table.concat(parts, " "))
    timing = {}
    self._t, self._frames, self._worst, self._sum = 0, 0, 0, 0
  end
  if self.tick then self:tick(dt) end
end

return Stats
"""


def root_script(body):
    """A root script built on stats.lua: tick(dt) runs every frame."""
    return "local Root = {}\nfor k, v in pairs(require(\"scripts.stats\")) do Root[k] = v end\n" + body + "\nreturn Root\n"


# ---------------------------------------------------------------------------
# The cases. Each returns (files, smitten.json extras).


def case_sprites(rng, n=5000):
    """Thousands of Sprites and Shapes in 50 Groups that turn, on 4 layers."""
    groups = []
    per = n // 50
    for g in range(50):
        kids = []
        for i in range(per):
            x, y = rng.uniform(-60, 60), rng.uniform(-60, 60)
            layer = rng.randrange(4)
            if i % 5 == 0:
                kids.append(piece(f"S{i}", "Sprite", {"image": "art/ball.png", "x": x, "y": y, "layer": layer}))
            elif i % 2:
                kids.append(shape(f"R{i}", x=x, y=y, width=8, height=8, color=color(rng), layer=layer))
            else:
                kids.append(shape(f"C{i}", x=x, y=y, shape="circle", radius=4, color=color(rng), layer=layer))
        groups.append(piece(f"G{g}", "Group", {"x": 80 + (g % 10) * 120, "y": 80 + (g // 10) * 130}, kids))
    tick = """function Root:tick(dt)
  for _, g in ipairs(self.children) do
    if g.type == "Group" then g.rotation = g.rotation + dt end
  end
end"""
    scene = piece("Sprites", "Group", None, groups, script="scripts/root.lua")
    return {"scenes/main.scene": scene, "scripts/root.lua": root_script(tick), "art/ball.png": sprite_png()}, {}


def terrain(rng, w, h):
    grid = [[-1] * w for _ in range(h)]
    ground = h // 3
    for x in range(w):
        top = ground + int(8 * math.sin(x / 13) + 5 * math.sin(x / 5.3))
        for y in range(max(0, top), h):
            grid[y][x] = 1 if y == top else (2 if y > top + 20 else 0)
    # Caves and floating platforms.
    for _ in range(w * h // 2000):
        cx, cy, r = rng.randrange(w), rng.randrange(ground + 10, h), rng.randrange(2, 8)
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if 0 <= x < w and 0 <= y < h and (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    grid[y][x] = -1
    for _ in range(w * h // 4000):
        px, py, ln = rng.randrange(w), rng.randrange(0, ground - 5), rng.randrange(3, 12)
        for x in range(px, min(w, px + ln)):
            grid[py][x] = 3
    return grid


TILES_PLAYER = """local P = {}
function P:ready() self.dir = 1 end
function P:physicsUpdate(dt)
  self.vx = 120 * self.dir
  self.vy = math.min(self.vy + 900 * dt, 600)
  self:move()
  if self:onWall() then self.dir = -self.dir end
  if self:onGround() and math.random() < 0.02 then self.vy = -380 end
end
return P
"""


def case_tiles(rng, w=500, h=500, dig=False):
    """A 500x500 Tiles map, a camera that pans over it, scripted bodies walking on it."""
    grid = terrain(rng, w, h)
    players = [piece(f"Walker{i}", "Body", {"x": 40 + i * 37, "y": 16 * (h // 3) - 200}, [shape(width=12, height=20)],
                     script="scripts/walker.lua", tags=["walker"]) for i in range(20)]
    cam = piece("Camera", "Camera", {"x": 640, "y": 16 * h // 3})
    tick = f"""function Root:tick(dt)
  self._time = (self._time or 0) + dt
  local cam = self:find("Camera")
  cam.x = {w * 8} + math.sin(self._time * 0.2) * {w * 6}
  cam.y = {h * 8} + math.cos(self._time * 0.13) * {h * 5}
""" + ("""  -- Dig and fill tiles near the camera, as a game with destructible terrain does.
  local map = self:find("Map")
  for i = 1, 4 do
    local cx, cy = map:cellAt(cam.x + math.random(-300, 300), cam.y + math.random(-200, 200))
    map:setTile(cx, cy, map:getTile(cx, cy) < 0 and 2 or -1)
  end
""" if dig else "") + "end"
    scene = piece("Tiles", "Group", None,
                  [piece("Map", "Tiles", {"tileset": "art/tiles.tileset", "cells": encode_cells(grid, w, h)}), *players, cam],
                  script="scripts/root.lua")
    files = {"scenes/main.scene": scene, "scripts/root.lua": root_script(tick), "scripts/walker.lua": TILES_PLAYER,
             "art/tiles.png": tiles_png(), "art/tiles.tileset": TILESET}
    return files, {"display": {"width": 1280, "height": 720, "stretch": "fit"}}


BOUNCER = """local B = {}
function B:ready()
  local a = math.random() * math.pi * 2
  self.sx, self.sy = math.cos(a) * 140, math.sin(a) * 140
end
function B:physicsUpdate(dt)
  self.vx, self.vy = self.sx, self.sy
  self:move()
  if self:onWall() then self.sx = -self.sx end
  if self:onGround() or self:onCeiling() then self.sy = -self.sy end
end
return B
"""


def arena(w, h, t=20):
    def wall(name, x, y, ww, hh):
        return piece(name, "Body", {"x": x, "y": y, "motion": "still"}, [shape(width=ww, height=hh, color=[0.3, 0.3, 0.35, 1])])
    return [wall("Top", w / 2, -t / 2, w + 2 * t, t), wall("Bottom", w / 2, h + t / 2, w + 2 * t, t),
            wall("Left", -t / 2, h / 2, t, h), wall("Right", w + t / 2, h / 2, t, h)]


def case_bodies(rng, n=300):
    """Hundreds of scripted Bodies bouncing off each other and the walls."""
    w, h = 1280, 720
    bodies = []
    for i in range(n):
        x, y = 30 + (i % 30) * 41, 30 + (i // 30) * 60
        bodies.append(piece(f"B{i}", "Body", {"x": x, "y": y}, [shape(width=14, height=14, color=color(rng))],
                            script="scripts/bouncer.lua", tags=["ball"]))
    scene = piece("Bodies", "Group", None, arena(w, h) + bodies, script="scripts/root.lua")
    return ({"scenes/main.scene": scene, "scripts/root.lua": root_script(""), "scripts/bouncer.lua": BOUNCER},
            {"display": {"width": w, "height": h, "stretch": "fit"}})


def case_rigid(rng, n=400, movers=10):
    """Hundreds of physics Bodies falling into a box with pegs and moving platforms."""
    w, h = 1280, 720
    kids = arena(w, h)
    for i in range(40):
        kids.append(piece(f"Peg{i}", "Body", {"x": 80 + (i % 10) * 125 + (i // 10 % 2) * 60, "y": 300 + (i // 10) * 80, "motion": "still"},
                          [shape(shape="circle", radius=8, color=[0.5, 0.5, 0.6, 1])]))
    for i in range(movers):
        kids.append(piece(f"Mover{i}", "Body", {"x": 100 + (i % 10) * 120, "y": 640 - (i // 10) * 40}, [shape(width=80, height=10, color=[0.4, 0.7, 0.9, 1])],
                          script="scripts/mover.lua"))
    for i in range(n):
        look = shape(width=14, height=14, color=color(rng)) if i % 2 else shape(shape="circle", radius=7, color=color(rng))
        kids.append(piece(f"Box{i}", "Body", {"x": 40 + (i % 40) * 30, "y": 20 + (i // 40) * 22, "motion": "physics", "bounce": 0.2},
                          [look], tags=["box"]))
    mover = """local M = {}
function M:ready() self.t = math.random() * 6 end
function M:physicsUpdate(dt)
  self.t = self.t + dt
  self.vx = math.sin(self.t) * 80
  self:move()
end
return M
"""
    scene = piece("Rigid", "Group", None, kids, script="scripts/root.lua")
    return ({"scenes/main.scene": scene, "scripts/root.lua": root_script(""), "scripts/mover.lua": mover},
            {"display": {"width": w, "height": h, "stretch": "fit"}, "modules": {"physics2d": "always"}})


def case_zones(rng, zones=200, bodies=200):
    """Many Zones that detect tags, and scripted Bodies (that pass through each other) wandering through them."""
    w, h = 1280, 720
    kids = arena(w, h)
    for i in range(zones):
        kids.append(piece(f"Zone{i}", "Zone", {"x": rng.uniform(40, w - 40), "y": rng.uniform(40, h - 40),
                                               "detects": "player" if i % 2 else "enemy,player"},
                          [shape(width=40, height=40, color=[0.3, 0.8, 0.4, 0.25])], script="scripts/zone.lua"))
    for i in range(bodies):
        tag = "player" if i % 3 == 0 else "enemy"
        kids.append(piece(f"Walker{i}", "Body", {"x": rng.uniform(40, w - 40), "y": rng.uniform(40, h - 40), "passThrough": "player,enemy"},
                          [shape(width=10, height=10, color=color(rng))], script="scripts/bouncer.lua", tags=[tag]))
    zone = """local Z = {}
function Z:ready() self.count = 0 end
function Z:entered(other) self.count = self.count + 1 end
function Z:exited(other) self.count = self.count - 1 end
return Z
"""
    scene = piece("Zones", "Group", None, kids, script="scripts/root.lua")
    return ({"scenes/main.scene": scene, "scripts/root.lua": root_script(""), "scripts/bouncer.lua": BOUNCER, "scripts/zone.lua": zone},
            {"display": {"width": w, "height": h, "stretch": "fit"}})


def case_nesting(rng, chains=100, depth=30):
    """Deep nesting: chains of Groups 30 deep, each turning, a Shape at every level."""
    kids = []
    for c in range(chains):
        node = piece("Tip", "Body", {"motion": "still"}, [shape(width=6, height=6)])
        for d in range(depth):
            node = piece(f"L{d}", "Group", {"x": 6, "rotation": 0.05}, [shape(width=4, height=4, color=color(rng)), node])
        node["properties"] = {"x": 60 + (c % 10) * 120, "y": 60 + (c // 10) * 66}
        kids.append(node)
    tick = """local function turn(n, dt)
  for _, c in ipairs(n.children) do
    if c.type == "Group" then
      c.rotation = c.rotation + dt * 0.1
      turn(c, dt)
    end
  end
end
function Root:tick(dt) turn(self, dt) end"""
    scene = piece("Nesting", "Group", None, kids, script="scripts/root.lua")
    return {"scenes/main.scene": scene, "scripts/root.lua": root_script(tick)}, {}


def case_ui(rng, panels=40):
    """Lots of UI: panels of Labels, Buttons and Bars, updated every frame."""
    kids = []
    for p in range(panels):
        rows = []
        for i in range(10):
            rows.append(piece(f"Label{i}", "Label", {"text": f"Row {i}", "x": 8, "y": 8 + i * 18, "width": 140, "height": 16, "size": 12}))
        rows.append(piece("Ok", "Button", {"text": "OK", "anchor": "bottomLeft", "x": 8, "y": 8, "width": 60, "height": 24}))
        rows.append(piece("Cancel", "Button", {"text": "Cancel", "anchor": "bottomRight", "x": 8, "y": 8, "width": 60, "height": 24}))
        rows.append(piece("Health", "Bar", {"anchor": "top", "y": 196, "width": 140, "height": 8, "value": 50}))
        rows.append(piece("Mana", "Bar", {"anchor": "top", "y": 208, "width": 140, "height": 8, "value": 50, "showValue": True}))
        kids.append(piece(f"Panel{p}", "Panel", {"x": 8 + (p % 8) * 158, "y": 8 + (p // 8) * 142, "width": 150, "height": 250}, rows))
    tick = """function Root:tick(dt)
  self._time = (self._time or 0) + dt
  for i, p in ipairs(self:find("HUD").children) do
    p:find("Health").value = 50 + 50 * math.sin(self._time + i)
    p:find("Mana").value = 50 + 50 * math.cos(self._time * 1.3 + i)
    p:find("Label0").text = ("Panel %d: %.1f"):format(i, self._time)
  end
end"""
    scene = piece("UI", "Group", None, [piece("HUD", "Group", None, kids)], script="scripts/root.lua")
    return {"scenes/main.scene": scene, "scripts/root.lua": root_script(tick)}, {}


def case_spawn(rng, per_frame=5):
    """Spawning and destroying hundreds of tagged pieces a second, through Zones; run it long to watch memory."""
    w, h = 1280, 720
    kids = arena(w, h)
    for i in range(20):
        kids.append(piece(f"Catcher{i}", "Zone", {"x": 100 + (i % 10) * 120, "y": 200 + (i // 10) * 300, "detects": "bullet"},
                          [shape(width=50, height=50, color=[0.8, 0.3, 0.3, 0.3])]))
    bullet = """local B = {}
function B:ready() self.life = 1.5 end
function B:update(dt)
  self.x = self.x + self.vx * dt
  self.y = self.y + self.vy * dt
  self.life = self.life - dt
  if self.life <= 0 then self:destroy() end
end
return B
"""
    tick = f"""function Root:tick(dt)
  for i = 1, {per_frame} do
    local a = math.random() * math.pi * 2
    local b = smitten.scene.make("Zone", {{ x = 640, y = 360, vx = math.cos(a) * 300, vy = math.sin(a) * 300 }}, "scripts/bullet.lua")
    b:tag("bullet")
    b:add(smitten.scene.make("Shape", {{ shape = "circle", radius = 3 }}))
    self:add(b)
  end
end"""
    scene = piece("Spawn", "Group", None, kids, script="scripts/root.lua")
    return ({"scenes/main.scene": scene, "scripts/root.lua": root_script(tick), "scripts/bullet.lua": bullet},
            {"display": {"width": w, "height": h, "stretch": "fit"}})


def long_script(lines=5000):
    out = ["-- A long script, for the code editor.", "local Long = {}", ""]
    i = 0
    while len(out) < lines:
        out += [f"---Does thing number {i}.", f"function Long:thing{i}(a, b)", f"  local x = a * {i} + (b or 0)",
                f"  if x > {i * 3} then", f"    self.total = (self.total or 0) + x  -- {i}", "  else",
                f"    print(\"thing {i}\", x, `value {{x}}`)", "  end", "  return x", "end", ""]
        i += 1
    return "\n".join(out + ["return Long", ""])


def case_editor(rng, n=4000, tiles=200):
    """For the editor: a 4000-piece scene with nesting, a 200x200 Tiles map and a 5000-line script."""
    kids = []
    count = 0
    g = 0
    while count < n:
        members = []
        for i in range(12):
            kind = rng.randrange(4)
            x, y = rng.uniform(-80, 80), rng.uniform(-80, 80)
            if kind == 0:
                members.append(piece(f"Sprite{i}", "Sprite", {"image": "art/ball.png", "x": x, "y": y}))
            elif kind == 1:
                members.append(shape(f"Shape{i}", x=x, y=y, width=10, height=10, color=color(rng)))
            elif kind == 2:
                members.append(piece(f"Body{i}", "Body", {"x": x, "y": y, "motion": "still"}, [shape(width=8, height=8)]))
                count += 1
            else:
                members.append(piece(f"Zone{i}", "Zone", {"x": x, "y": y}, [shape(shape="circle", radius=6)], tags=["coin"]))
                count += 1
        count += len(members) + 1
        kids.append(piece(f"Group{g}", "Group", {"x": (g % 30) * 200, "y": (g // 30) * 200}, members,
                          script="scripts/long.lua" if g % 50 == 0 else None))
        g += 1
    grid = terrain(rng, tiles, tiles)
    scene = piece("Big", "Group", None, [piece("Map", "Tiles", {"tileset": "art/tiles.tileset", "cells": encode_cells(grid, tiles, tiles), "y": 6000}),
                                         *kids, piece("Camera", "Camera", {"x": 640, "y": 360})], script="scripts/root.lua")
    files = {"scenes/main.scene": scene, "scripts/root.lua": root_script(""), "scripts/long.lua": long_script(),
             "art/ball.png": sprite_png(), "art/tiles.png": tiles_png(), "art/tiles.tileset": TILESET}
    return files, {}


def case_draws(rng, n=3000):
    """3000 draws that can't be batched: Sprites of two pictures alternating with Shapes."""
    kids = []
    for i in range(n):
        x, y = 20 + (i % 60) * 21, 20 + (i // 60) * 14
        if i % 3 == 0:
            kids.append(piece(f"A{i}", "Sprite", {"image": "art/ball.png", "x": x, "y": y}))
        elif i % 3 == 1:
            kids.append(piece(f"B{i}", "Sprite", {"image": "art/tile.png", "x": x, "y": y}))
        else:
            kids.append(shape(f"C{i}", x=x, y=y, width=8, height=8, color=color(rng)))
    scene = piece("Draws", "Group", None, kids, script="scripts/root.lua")
    return {"scenes/main.scene": scene, "scripts/root.lua": root_script(""), "art/ball.png": sprite_png(), "art/tile.png": tiles_png()}, {}


CHECK_BODY = """local B = {}
function B:ready()
  local i = tonumber(self.name:match("%d+")) or 0
  self.sx, self.sy = ((i * 37) % 200) - 100, ((i * 53) % 160) - 80
  self.hits = 0
end
function B:hit() self.hits = self.hits + 1 end
function B:physicsUpdate(dt)
  self.vx, self.vy = self.sx, self.sy
  self:move()
  if self:onWall() then self.sx = -self.sx end
  if self:onGround() or self:onCeiling() then self.sy = -self.sy end
end
return B
"""


def case_physics_check(rng):
    """Deterministic collisions for comparing engine versions: prints a digest of every body after 600 steps."""
    w, h = 960, 540
    kids = arena(w, h)
    # Solid tiles: a floor strip and a few blocks, some one-way.
    grid = [[-1] * 60 for _ in range(34)]
    for x in range(10, 50):
        grid[20][x] = 0
    for x in range(5, 15):
        grid[10][x] = 3
    tiles = {"format": "smitten.tileset", "image": "tiles.png", "tileWidth": 16, "tileHeight": 16,
             "tiles": {"0": {"solid": True}, "3": {"solid": True, "oneWay": True}}}
    kids.append(piece("Map", "Tiles", {"tileset": "art/tiles.tileset", "cells": encode_cells(grid, 60, 34)}))
    for i in range(6):
        kids.append(piece(f"Platform{i}", "Body", {"x": 100 + i * 140, "y": 150 + (i % 3) * 120, "motion": "still"},
                          [shape(width=70, height=12)], script="scripts/platform.lua"))
    group = []
    for i in range(160):
        tags = ["ghost"] if i % 7 == 0 else []
        props = {"x": 30 + (i % 20) * 45, "y": 30 + (i // 20) * 60}
        if i % 11 == 0:
            props["passThrough"] = "ghost"
        kids_ = [shape(width=10 + i % 5, height=10 + i % 3)]
        if i % 13 == 0:
            props["shape"] = "none"
            kids_ = [piece("Hit", "Hitbox", {"width": 12, "height": 18})]
        b = piece(f"B{i}", "Body", props, kids_, script="scripts/body.lua", tags=tags)
        (group if i % 4 == 0 else kids).append(b)
    kids.insert(len(kids) // 2, piece("Teleporter", "Group", None, None, script="scripts/teleporter.lua"))
    kids.append(piece("Moving", "Group", {"x": 0, "y": 0}, group, script="scripts/carrier.lua"))
    for i in range(30):
        kids.append(piece(f"Zone{i}", "Zone", {"x": 60 + (i % 10) * 90, "y": 100 + (i // 10) * 160, "detects": "" if i % 2 else "ghost"},
                          [shape(shape="circle", radius=30)], script="scripts/zone.lua"))
    platform = """local P = {}
function P:ready() self.t, self.ox = 0, self.x end
function P:physicsUpdate(dt)
  self.t = self.t + 1
  self.x = self.ox + math.sin(self.t / 40) * 60
end
return P
"""
    carrier = """local C = {}
function C:ready() self.t = 0 end
function C:physicsUpdate(dt)
  self.t = self.t + 1
  self.x = math.sin(self.t / 50) * 20
end
return C
"""
    teleporter = """local T = {}
function T:ready() self.t = 0 end
function T:physicsUpdate(dt)
  self.t = self.t + 1
  if self.t % 45 == 0 then
    local b = self.parent:find("B" .. ((self.t / 45 * 17) % 160 + 1))
    if b and b.parent == self.parent then b.x, b.y = 480, 270 end
  end
end
return T
"""
    zone = """local Z = {}
function Z:ready() self.n = 0 end
function Z:entered(o) self.n = self.n + 1 end
function Z:exited(o) self.n = self.n + 3 end
return Z
"""
    tick = """local steps = 0
function Root:physicsUpdate(dt)
  steps = steps + 1
  if steps == 600 then
    local sum, hits, n = 0, 0, 0
    local function visit(p)
      for _, c in ipairs(p.children) do
        if c.type == "Body" and c.motion == "scripted" then
          n = n + 1
          local x, y = c:worldPosition()
          sum = sum + math.floor(x * 1000 + 0.5) * n + math.floor(y * 1000 + 0.5) * (n + 7)
          hits = hits + c.hits
        elseif c.type == "Zone" then
          hits = hits + c.n * 1000
        end
        visit(c)
      end
    end
    visit(self)
    print(("check digest=%d hits=%d bodies=%d"):format(sum % 1000000007, hits, n))
  end
end"""
    scene = piece("Check", "Group", None, kids, script="scripts/root.lua")
    files = {"scenes/main.scene": scene, "scripts/root.lua": root_script(tick), "scripts/body.lua": CHECK_BODY,
             "scripts/platform.lua": platform, "scripts/carrier.lua": carrier, "scripts/teleporter.lua": teleporter,
             "scripts/zone.lua": zone, "art/tiles.png": tiles_png(), "art/tiles.tileset": tiles}
    return files, {"display": {"width": w, "height": h, "stretch": "fit"}}


CASES = {
    "physics-check": case_physics_check,
    "draws": case_draws,
    "sprites": case_sprites,
    "tiles": case_tiles,
    "tiles-dig": lambda rng: case_tiles(rng, dig=True),
    "bodies": case_bodies,
    "rigid": case_rigid,
    "rigid-mix": lambda rng: case_rigid(rng, n=300, movers=200),
    "zones": case_zones,
    "nesting": case_nesting,
    "ui": case_ui,
    "spawn": case_spawn,
    "editor-big": case_editor,
}


def write(name, files, extra):
    project = {"format": "smitten.project", "version": 2, "name": f"Stress: {name}", "main": "scenes/main.scene",
               "display": {"width": 1280, "height": 720, "stretch": "fit"}}
    project.update(extra)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.love"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("smitten.json", json.dumps(project, indent=2) + "\n")
        z.writestr("scripts/stats.lua", STATS)
        for p, data in files.items():
            if p.endswith(".scene"):
                data = json.dumps({"format": "smitten.scene", "version": 2, "root": data}, indent=1) + "\n"
            elif isinstance(data, dict):
                data = json.dumps(data, indent=2) + "\n"
            z.writestr(p, data)
    return path


def pack_tests():
    """The scene test projects, to check that they still behave the same."""
    for d in sorted((ROOT / "tools" / "scene-tests").iterdir()):
        if (d / "smitten.json").exists():
            path = OUT / f"test-{d.name}.love"
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
                for f in sorted(d.rglob("*")):
                    if f.is_file():
                        z.write(f, f.relative_to(d).as_posix())
            print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB")


def main():
    args = sys.argv[1:]
    if "--list" in args:
        for name, fn in CASES.items():
            print(f"{name:12} {(fn.__doc__ or '').strip()}")
        return
    names = args or list(CASES)
    for name in names:
        if name not in CASES:
            sys.exit(f"no stress case called {name} (try --list)")
        path = write(name, *CASES[name](random.Random(1)))
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB")
    if not args:
        pack_tests()


if __name__ == "__main__":
    main()
