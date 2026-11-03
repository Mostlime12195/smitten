#!/usr/bin/env python3
"""
Package a LÖVE game for the web.

    python3 package.py path/to/game-folder out/        # or a .love file
    python3 package.py game.love out/ --zip            # also write out.zip (for itch.io)

The output folder contains index.html (the player), the engine, only the
engine modules the game uses (or --modules a,b), and game.love, and can be
uploaded to any static host. Requires a built dist/
(python3 build.py).
"""
import argparse
import json
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
PLAYER_FILES = ["player.js", "player.css", "smitten.mjs", "smitten.wasm"]
COMPAT_RULES = ROOT / "web" / "editor" / "compat-rules.json"


def strip_lua(text: str):
    """Lua text with comments blanked ('source'), and with comments and string
    contents blanked ('code'); newlines are kept. Mirrors compat.js."""
    def blank(s): return re.sub(r"[^\n]", " ", s)
    def long_end(level, start):
        end = text.find("]" + "=" * level + "]", start)
        return len(text) if end < 0 else end + level + 2
    special = re.compile(r"--|[\"'\[]")
    long_open = re.compile(r"\[(=*)\[")
    source, code, i = [], [], 0
    while True:
        m = special.search(text, i)
        if not m:
            break
        source.append(text[i:m.start()])
        code.append(text[i:m.start()])
        tok = m.group()
        if tok == "--":
            lm = long_open.match(text, m.start() + 2)
            if lm:
                j = long_end(len(lm.group(1)), lm.end())
            else:
                j = text.find("\n", m.start())
                j = len(text) if j < 0 else j
            source.append(blank(text[m.start():j]))
            code.append(blank(text[m.start():j]))
        elif tok == "[":
            lm = long_open.match(text, m.start())
            if not lm:
                source.append("[")
                code.append("[")
                i = m.start() + 1
                continue
            j = long_end(len(lm.group(1)), lm.end())
            source.append(text[m.start():j])
            code.append(blank(text[m.start():j]))
        else:  # quoted string
            j = m.start() + 1
            while j < len(text) and text[j] != tok and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            j = min(j + 1, len(text))
            source.append(text[m.start():j])
            code.append(blank(text[m.start():j]))
        i = j
    source.append(text[i:])
    code.append(text[i:])
    return {"source": "".join(source), "code": "".join(code)}


def check_compat(love_file: Path):
    """Prints web-compatibility issues in the game's Lua files; returns the
    number of errors."""
    rules = json.loads(COMPAT_RULES.read_text())["rules"]
    seen, issues = set(), []
    with zipfile.ZipFile(love_file) as z:
        for name in sorted(n for n in z.namelist() if n.endswith(".lua")):
            stripped = strip_lua(z.read(name).decode("utf-8", "replace"))
            for rule in rules:
                if rule.get("once") and rule["id"] in seen:
                    continue
                if rule.get("unlessFile") and re.search(rule["unlessFile"], stripped["code"]):
                    continue
                text = stripped.get(rule["scope"], stripped["code"])
                for m in re.finditer(rule["pattern"], text):
                    if stripped["code"][m.start()] != text[m.start()]:
                        continue  # starts inside a string
                    start = text.rfind("\n", 0, m.start()) + 1
                    end = text.find("\n", m.start())
                    line_text = stripped["source"][start:end if end >= 0 else None]
                    if rule.get("unless") and re.search(rule["unless"], line_text):
                        continue
                    line = text.count("\n", 0, m.start()) + 1
                    msg = rule["message"].replace("{1}", m.group(1) if m.groups() and m.group(1) else "")
                    issues.append((name, line, rule["severity"], msg))
                    seen.add(rule["id"])
                    if rule.get("once"):
                        break
    for name, line, severity, msg in sorted(issues):
        print(f"{severity}: {name}:{line}: {msg}", file=sys.stderr)
    return sum(1 for i in issues if i[2] == "error")


def make_love(folder: Path, dest: Path):
    if not ((folder / "main.lua").exists() or (folder / "smitten.json").exists()):
        sys.exit(f"{folder} has neither a main.lua nor a smitten.json")
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(folder.rglob("*")):
            rel = path.relative_to(folder)
            if path.is_file() and not any(p.startswith(".") for p in rel.parts):
                z.write(path, rel.as_posix())


PHYSICS_QUERIES = r"(?:raycast|raycastAll|piecesAt|overlap|getGravity|setGravity)\b"
CODE_MODULES = [
    # Scenes' physics (Box2D 3); LÖVE's love.physics API (Box2D 2.4) is lovephysics.
    ("physics2d", re.compile(r"\b(?:smitten|love)\.physics\." + PHYSICS_QUERIES
                             + r"|\b(?:make|spawn)\(\s*[\"'`](?:Body|Zone|Joint)[\"'`]")),
    ("lovephysics", re.compile(r"\b(?:smitten|love)\.physics\.(?!" + PHYSICS_QUERIES + r")\w")),
    ("physics3d", re.compile(r"\b(?:smitten|love)\.physics3d\b|\b(?:RigidBody3D|StaticBody3D|CharacterBody3D|Area3D|CollisionShape3D)\b")),
    ("3d", re.compile(r"\b(?:smitten|love)\.graphics3d\b|\b(?:Node3D|MeshInstance3D|Model3D|Camera3D|Sprite3D)\b")),
    ("video", re.compile(r"\b(?:smitten|love)\.video\b|\bnewVideo\s*\(")),
    ("synth", re.compile(r"\b(?:smitten|love)\.synth\b|\.(?:sfx|song)[\"'`]")),
]


def detect_modules(love_path: Path):
    """The optional engine modules a game uses, as the editor works them out
    (web/editor/core/modules.js): from its scenes' node types, its scripts,
    and smitten.json's overrides."""
    nodes = json.loads((ROOT / "love" / "src" / "modules" / "scene" / "pieces.json").read_text())["types"]

    def module_of(t):
        while t in nodes:
            if nodes[t].get("module"):
                return nodes[t]["module"]
            t = nodes[t].get("extends")
        return None

    found, overrides = set(), {}
    with zipfile.ZipFile(love_path) as z:
        for name in z.namelist():
            if name.endswith(".scene"):
                try:
                    root = json.loads(z.read(name)).get("root")
                except ValueError:
                    continue
                stack = [root] if root else []
                while stack:
                    e = stack.pop()
                    m = module_of(e.get("type", ""))
                    if m:
                        found.add(m)
                    if m == "physics3d":
                        found.add("3d")
                    if str(e.get("properties", {}).get("sound", "")).endswith((".sfx", ".song")):
                        found.add("synth")
                    stack.extend(e.get("children", []))
            elif name.endswith(".lua"):
                text = z.read(name).decode("utf-8", "replace")
                found.update(m for m, rx in CODE_MODULES if rx.search(text))
            elif name == "smitten.json":
                try:
                    overrides = json.loads(z.read(name)).get("modules", {}) or {}
                except ValueError:
                    pass
    for m, how in overrides.items():
        if how == "always":
            found.add(m)
        elif how == "never":
            found.discard(m)
    return sorted(found)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("game", type=Path, help="game folder (with main.lua) or .love file")
    ap.add_argument("out", type=Path, help="output folder")
    ap.add_argument("--title", help="page title (default: game name)")
    ap.add_argument("--scale", choices=["fit", "integer", "none"], default="fit",
                    help="how fixed-size windows are scaled to the page")
    ap.add_argument("--zip", action="store_true", help="also write <out>.zip")
    ap.add_argument("--modules", help="engine modules to include, comma-separated "
                    "(default: the ones the game's scenes and scripts use)")
    args = ap.parse_args()

    missing = [f for f in PLAYER_FILES + ["player.html"] if not (DIST / f).exists()]
    if missing:
        sys.exit(f"dist/ is missing {', '.join(missing)}: run python3 build.py first")

    args.out.mkdir(parents=True, exist_ok=True)
    if args.game.is_dir():
        make_love(args.game, args.out / "game.love")
    elif args.game.suffix in (".love", ".zip"):
        shutil.copyfile(args.game, args.out / "game.love")
    else:
        sys.exit(f"{args.game} is neither a folder nor a .love file")

    errors = check_compat(args.out / "game.love")
    if errors:
        print(f"{errors} part(s) of this game won't work on the web (see above).", file=sys.stderr)

    for f in PLAYER_FILES:
        shutil.copyfile(DIST / f, args.out / f)
    modules = ([m for m in args.modules.split(",") if m] if args.modules is not None
               else detect_modules(args.out / "game.love"))
    if modules:
        (args.out / "modules").mkdir(exist_ok=True)
        for m in modules:
            shutil.copyfile(DIST / "modules" / f"{m}.wasm", args.out / "modules" / f"{m}.wasm")
        print(f"Engine modules: {', '.join(modules)}")

    title = args.title or args.game.stem
    html = (DIST / "player.html").read_text()
    meta = (f'<meta name="love-game" content="game.love">\n'
            f'<meta name="love-scale" content="{args.scale}">\n'
            f'<meta name="smitten-modules" content="{",".join(modules)}">\n')
    html = html.replace("<head>\n", "<head>\n" + meta, 1)
    html = html.replace("<title>Smitten Player</title>", f"<title>{title}</title>")
    (args.out / "index.html").write_text(html)

    size = sum(f.stat().st_size for f in args.out.iterdir() if f.is_file())
    print(f"Wrote {args.out}/ ({size / 1e6:.1f} MB)")

    if args.zip:
        archive = shutil.make_archive(str(args.out), "zip", args.out)
        print(f"Wrote {os.path.relpath(archive)}")


if __name__ == "__main__":
    main()
