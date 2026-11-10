#!/usr/bin/env python3
"""
Package a Smitten game for the web.

    python3 package.py path/to/project out/            # or a project zip
    python3 package.py game.zip out/ --zip             # also write out.zip (for itch.io)

The output folder contains index.html (the player), the engine, only the
engine modules the game uses (or --modules a,b), and game.zip (the
project), and can be uploaded to any static host. Requires a built dist/
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
PLAYER_FILES = ["player.js", "player.css", "clips.js", "gif.js", "webm.js", "smitten.mjs", "smitten.wasm"]


def make_game_zip(folder: Path, dest: Path):
    if not (folder / "smitten.json").exists():
        sys.exit(f"{folder} has no smitten.json: it isn't a Smitten project")
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(folder.rglob("*")):
            rel = path.relative_to(folder)
            if path.is_file() and not any(p.startswith(".") for p in rel.parts):
                z.write(path, rel.as_posix())


CODE_MODULES = [
    ("physics2d", re.compile(r"\bsmitten\.physics\.\w|\b(?:make|spawn)\(\s*[\"'`](?:Body|Zone|Joint)[\"'`]")),
    ("video", re.compile(r"\bsmitten\.video\b|\bnewVideo\s*\(")),
    ("synth", re.compile(r"\bsmitten\.synth\b|\.(?:sfx|song)[\"'`]")),
]


def detect_modules(game_zip: Path):
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
    with zipfile.ZipFile(game_zip) as z:
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
    ap.add_argument("game", type=Path, help="project folder (with smitten.json) or a zip of one")
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
    game = args.out / "game.zip"
    if args.game.is_dir():
        make_game_zip(args.game, game)
    elif args.game.suffix == ".zip":
        shutil.copyfile(args.game, game)
    else:
        sys.exit(f"{args.game} is neither a project folder nor a zip")

    for f in PLAYER_FILES:
        shutil.copyfile(DIST / f, args.out / f)
    modules = ([m for m in args.modules.split(",") if m] if args.modules is not None
               else detect_modules(game))
    if modules:
        (args.out / "modules").mkdir(exist_ok=True)
        for m in modules:
            shutil.copyfile(DIST / "modules" / f"{m}.wasm", args.out / "modules" / f"{m}.wasm")
        print(f"Engine modules: {', '.join(modules)}")

    title = args.title or args.game.stem
    html = (DIST / "player.html").read_text()
    meta = (f'<meta name="smitten-game" content="game.zip">\n'
            f'<meta name="smitten-scale" content="{args.scale}">\n'
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
