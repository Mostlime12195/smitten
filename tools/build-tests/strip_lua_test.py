"""build.py embeds the engine's Lua without comments (strip_lua). This checks
that luac5.1 compiles every stripped file to the same bytecode as the
original (the line numbers in the bytecode included), and that the engine's
copy of pieces.json keeps everything but the texts.

    python3 tools/build-tests/strip_lua_test.py
"""
import gzip
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ns = {"__file__": str(ROOT / "build.py"), "__name__": "build"}
exec(compile((ROOT / "build.py").read_text(), "build.py", "exec"), ns)
strip_lua, strip_schema = ns["strip_lua"], ns["strip_schema"]
MODULES = ROOT / "love" / "src" / "modules"

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}{': ' + detail if detail else ''}")


def bytecode(source: str, rel: str, tmp: Path) -> bytes:
    """luac5.1's output for source, compiled under the name rel (it is in the bytecode)."""
    src = tmp / rel
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text(source)
    out = tmp / "out.luac"
    r = subprocess.run(["luac5.1", "-o", str(out), rel], cwd=tmp, capture_output=True, text=True)
    if r.returncode != 0:
        return ("error: " + r.stderr).encode()
    return out.read_bytes()


CASES = [
    "local s = 'a -- not a comment' -- a comment\nreturn s\n",
    "local s = \"x\\\"--y\" --[[ long\ncomment ]] local t = [[\n  -- kept\n]]\nreturn s, t\n",
    "return--[[x]]1\n",
    "local a = 1 --[==[ a ]] b\n]==] local b = 2\nreturn a + b\n",
    "local t = { [ [[k]] ] = 1, [\"--\"] = 2 }\nreturn t\n",
    "local x = 1 - -1\nlocal y = 2- -2\nreturn x..y, 1 .. 2, 3e-2, 0x1F\n",
    "if true then\n\t\t-- only a comment\n\treturn 'a\\\nb'\nend\n",
    "#!/usr/bin/lua\nreturn 1 -- end",
    "local s = [=[ ]] ]=] return s",
]

with tempfile.TemporaryDirectory() as d:
    tmp = Path(d)
    for i, case in enumerate(CASES):
        a, b = bytecode(case, "case.lua", tmp), bytecode(strip_lua(case), "case.lua", tmp)
        check(f"case {i + 1}", a == b and not a.startswith(b"error"), repr(strip_lua(case)))
        check(f"case {i + 1} keeps its lines", case.count("\n") == strip_lua(case).count("\n"))

    files = []
    for directory in ns["CORE_LUA_DIRS"]:
        files += sorted((MODULES / directory).glob("*.lua"))
    files.append(MODULES / "synth" / "sounds.lua")
    before = after = gz_before = gz_after = 0
    for f in files:
        rel = str(f.relative_to(MODULES))
        text = f.read_text()
        stripped = strip_lua(text)
        a, b = bytecode(text, rel, tmp), bytecode(stripped, rel, tmp)
        check(rel, a == b and not a.startswith(b"error"), a.decode(errors="replace")[:200] if a.startswith(b"error") else "the bytecode differs")
        check(f"{rel} keeps its lines", text.count("\n") == stripped.count("\n"))
        before += len(text.encode())
        after += len(stripped.encode())
        gz_before += len(gzip.compress(text.encode(), 9))
        gz_after += len(gzip.compress(stripped.encode(), 9))

schema = json.loads((MODULES / "scene" / "pieces.json").read_text())
small = strip_schema(schema)
check("schema keeps every piece type", set(small["types"]) == set(schema["types"]))
for name, t in schema["types"].items():
    s = small["types"][name]
    for part in ("properties", "methods", "events"):
        if isinstance(t.get(part), dict):
            check(f"{name} keeps its {part}", set(s[part]) == set(t[part]))
    for pname, p in (t.get("properties") or {}).items():
        want = {k: v for k, v in p.items() if k not in ("description", "group")}
        check(f"{name}.{pname} keeps type, default and limits", s["properties"][pname] == want)
    for key in ("extends", "abstract", "module", "parent", "fields"):
        if key in t:
            check(f"{name} keeps {key}", s.get(key) == t[key])
check("schema has no descriptions left", '"description"' not in json.dumps(small) and '"doc"' not in json.dumps(small))

print(f"engine Lua: {before} -> {after} bytes, gzip {gz_before} -> {gz_after}")
print(f"pieces.json: {len(json.dumps(schema))} -> {len(json.dumps(small))} bytes")
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
