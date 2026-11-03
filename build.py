#!/usr/bin/env python3
"""
Build LÖVE 12 for the web with Emscripten.

Source lists come straight from love/CMakeLists.txt so upstream updates are
picked up automatically. Objects are cached in build/obj and rebuilt only when
a source or one of its headers changes.

    python3 build.py            # release build -> dist/
    python3 build.py --debug    # assertions, no optimisation, source maps
    python3 build.py -j 8

The engine is split into a core (dist/smitten.wasm, an Emscripten main
module) and optional side modules (dist/modules/*.wasm) that a game only
downloads when it uses them (DESIGN.md, section 3). Everything is compiled
as position-independent code so the two kinds can link at run time.
"""
import argparse
import concurrent.futures as cf
import hashlib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOVE = ROOT / "love"
LUA = ROOT / "deps" / "lua-5.1.5"
THEORA = ROOT / "deps" / "theora"
MODULES = LOVE / "src" / "modules"
SYNTH = MODULES / "synth"
JOLT = ROOT / "deps" / "jolt"
WEB = ROOT / "web"
BUILD = ROOT / "build"
DIST = ROOT / "dist"

# CMake targets from love/CMakeLists.txt that make up the web build.
LOVE_TARGETS = [
    "love_common",
    "love_audio_root", "love_audio_null", "love_audio_openal",
    "love_data",
    "love_event_root", "love_event_sdl",
    "love_filesystem_root", "love_filesystem_physfs",
    "love_font_root", "love_font_freetype",
    "love_graphics_root", "love_graphics_opengl",
    "love_image_root", "love_image_magpie",
    "love_joystick_root", "love_joystick_sdl",
    "love_keyboard_root", "love_keyboard_sdl",
    "love_math",
    "love_mouse_root", "love_mouse_sdl",
    "love_physics_root", "love_physics_box2d",
    "love_sensor_root", "love_sensor_sdl",
    "love_sound_root", "love_sound_lullaby",
    "love_system_root", "love_system_sdl",
    "love_thread_root", "love_thread_sdl",
    "love_timer",
    "love_touch_root", "love_touch_sdl",
    "love_video_root", "love_video_theora",
    "love_window_root", "love_window_sdl",
    "liblove",
    "love_3p_box2d", "love_3p_ddsparse", "love_3p_glad", "love_3p_glslang",
    "love_3p_lodepng", "love_3p_lua53", "love_3p_lz4", "love_3p_noise1234",
    "love_3p_physfs", "love_3p_wuff", "love_3p_xxhash",
    "love_3p_luahttps",
]

# Files listed by CMake that must not be built for the web.
EXCLUDE = {
    "src/libraries/glslang/glslang/OSDependent/Windows/ossource.cpp",
}

# Third-party code is optimised for size; engine code for speed.
SIZE_OPT_PREFIXES = ("src/libraries/glslang/",)

PORTS = ["-sUSE_SDL=3", "-sUSE_FREETYPE=1", "-sUSE_HARFBUZZ=1",
         "-sUSE_OGG=1", "-sUSE_VORBIS=1", "-sUSE_ZLIB=1", "-sUSE_MODPLUG=1"]

COMMON_FLAGS = [
    "-fwasm-exceptions", "-sSUPPORT_LONGJMP=wasm",
    "-msimd128",
    "-fPIC",
    "-DLOVE_WEB=1",
    "-DLOVE_SMITTEN=1",
    "-DLOVE_OPTIONAL_MODULES=1",
    "-I" + str(ROOT / "build" / "gen"),
    "-I" + str(LOVE / "src"),
    "-I" + str(LOVE / "src" / "modules"),
    "-I" + str(LOVE / "src" / "libraries"),
    "-I" + str(LOVE / "src" / "libraries" / "physfs"),
    "-I" + str(LOVE / "src" / "libraries" / "box2d" / "include"),
    "-I" + str(LOVE / "src" / "libraries" / "glslang"),
    "-I" + str(LUA),
    "-I" + str(THEORA / "include"),
    "-w",
] + PORTS


def emscripten_includes():
    """Emscripten's OpenAL headers live in sysroot/include/AL; LÖVE includes them bare."""
    cache = subprocess.run(["em-config", "CACHE"], capture_output=True, text=True).stdout.strip()
    return ["-I" + os.path.join(cache, "sysroot", "include", "AL")]


def cmake_sources():
    """Collect .c/.cpp files for LOVE_TARGETS from add_library/target_sources."""
    text = (LOVE / "CMakeLists.txt").read_text()
    wanted = set(LOVE_TARGETS)
    files = []
    block_re = re.compile(r"(add_library|target_sources)\(\s*([A-Za-z0-9_]+)(.*?)\)", re.S)
    for m in block_re.finditer(text):
        target = m.group(2)
        if target not in wanted:
            continue
        # Skip conditionally-added platform sources (Windows/Apple .mm etc).
        for tok in m.group(3).split():
            if tok.startswith("src/") and tok.endswith((".c", ".cpp")) and tok not in EXCLUDE:
                files.append(tok)
    seen, out = set(), []
    for f in files:
        if f not in seen and (LOVE / f).exists():
            seen.add(f)
            out.append(LOVE / f)
    return out


# Individual files needed from targets that are otherwise left out.
EXTRA_SOURCES = [
    "src/modules/thread/web/GreenThreads.cpp",
    "src/libraries/luahttps/src/emscripten/EmscriptenClient.cpp",
]


def lua_sources():
    skip = {"lua.c", "luac.c", "print.c"}
    lua = sorted(p for p in LUA.glob("*.c") if p.name not in skip)
    return lua + [ROOT / "deps" / "luabitop" / "bit.c"]


def theora_sources():
    """libtheora's decoder (lib/Makefile.am decoder_sources, minus the legacy API wrappers)."""
    return sorted((THEORA / "lib").glob("*.c"))


# Engine modules written in Lua, embedded in the core: love/src/modules/<dir>.
# <dir>/init.lua is require("love.<dir>"), <dir>/<file>.lua is
# require("love.<dir>.<file>").
CORE_LUA_DIRS = ["engine", "json", "input", "tween", "assets", "storage", "display", "scene"]


def lua_entries(directory: Path, prefix: str):
    """(module name, file) pairs for the Lua files of one module folder."""
    out = []
    for f in sorted(directory.glob("*.lua")):
        out.append((prefix if f.stem == "init" else f"{prefix}.{f.stem}", f))
    return out


LUA_KEYWORDS = {"and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in",
                "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while", "continue"}


def lua_literal(value, indent=0):
    """A JSON value as Lua source."""
    pad = "\t" * indent
    if value is None:
        return "nil"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
    if isinstance(value, list):
        return "{" + ", ".join(lua_literal(v, indent) for v in value) + "}"
    items = []
    for k, v in value.items():
        plain = re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k) and k not in LUA_KEYWORDS
        key = k if plain else "[" + lua_literal(k) + "]"
        items.append(f"{pad}\t{key} = {lua_literal(v, indent + 1)},")
    return "{\n" + "\n".join(items) + "\n" + pad + "}"


def write_if_changed(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_text() != text:
        path.write_text(text)


def embed_lua(header: str, entries):
    """Write build/gen/<header>: Lua sources as byte arrays plus a table of them.

    entries are (module name, path or (display path, source text)) pairs.
    Only rewritten when the contents change, so unrelated builds don't
    recompile the files that include it.
    """
    lines = [f"// Generated by build.py. Do not edit.",
             "#pragma once", "#include <cstddef>", "",
             "#ifndef ENGINE_LUA_FILE_DEFINED", "#define ENGINE_LUA_FILE_DEFINED",
             "struct EngineLuaFile { const char *name; const char *path; const unsigned char *data; size_t size; };",
             "#endif", ""]
    prefix = re.sub(r"\W", "_", header)
    names = []
    for i, (name, src) in enumerate(entries):
        if isinstance(src, tuple):
            shown, data = src[0], src[1].encode()
        else:
            shown, data = str(src.relative_to(MODULES)), src.read_bytes()
        names.append((name, shown))
        lines.append(f"static const unsigned char {prefix}_{i}[] = {{{','.join(str(b) for b in data)}}};")
    lines.append(f"static const EngineLuaFile {prefix}_files[] = {{")
    for i, (name, shown) in enumerate(names):
        lines.append(f'\t{{"{name}", "{shown}", {prefix}_{i}, sizeof({prefix}_{i})}},')
    lines.append("\t{nullptr, nullptr, nullptr, 0},")
    lines.append("};")
    write_if_changed(BUILD / "gen" / header, "\n".join(lines) + "\n")


def generate_engine_lua():
    """Embed the core's Lua modules (build/gen/engine_lua.h, read by love.cpp).

    scene/nodes.json, the one description of every node type, becomes the
    Lua module love.scene.schema.
    """
    import json
    entries = []
    for d in CORE_LUA_DIRS:
        entries += lua_entries(MODULES / d, f"love.{d}")
    schema = json.loads((MODULES / "scene" / "nodes.json").read_text())
    entries.append(("love.scene.schema", ("scene/nodes.json",
                    "-- Generated from nodes.json by build.py.\nreturn " + lua_literal(schema) + "\n")))
    embed_lua("engine_lua.h", entries)
    # The synth module's Lua side (loaded by its luaopen).
    embed_lua("synth_lua.h", [("love.synth.sounds", SYNTH / "sounds.lua")])
    # The 3d module is only Lua; it gets a small generated C++ file.
    g3d = MODULES / "graphics3d"
    if (g3d / "init.lua").exists():
        embed_lua("graphics3d_lua.h", lua_entries(g3d, "graphics3d"))
        write_if_changed(BUILD / "gen" / "module_3d.cpp", MODULE_3D_CPP)


MODULE_3D_CPP = """// Generated by build.py: the 3d side module (love/src/modules/graphics3d).
extern "C" {
#include "lua.h"
#include "lauxlib.h"
}
#include <string>
#include "graphics3d_lua.h"

extern "C" int luaopen_love_graphics3d(lua_State *L)
{
\tlua_getglobal(L, "package");
\tlua_getfield(L, -1, "preload");
\tfor (const EngineLuaFile *f = graphics3d_lua_h_files; f->name != nullptr; f++)
\t{
\t\tstd::string chunkname = std::string("=[smitten \\"") + f->path + "\\"]";
\t\tif (luaL_loadbuffer(L, (const char *) f->data, f->size, chunkname.c_str()) != 0)
\t\t\treturn lua_error(L);
\t\tlua_setfield(L, -2, f->name);
\t}
\tlua_pop(L, 2);
\tlua_getglobal(L, "require");
\tlua_pushstring(L, "graphics3d");
\tlua_call(L, 1, 1);
\treturn 1;
}
"""


def module_sources():
    """Sources of each optional side module (DESIGN.md, section 3)."""
    mods = {}
    mods["physics2d"] = [p for p in cmake_sources()
                         if p.relative_to(LOVE).as_posix().startswith(("src/modules/physics/", "src/libraries/box2d/"))]
    mods["video"] = ([MODULES / "video" / "wrap_Video.cpp"] + sorted((MODULES / "video" / "theora").glob("*.cpp"))
                     + theora_sources())
    mods["synth"] = sorted(SYNTH.glob("*.cpp"))
    if (BUILD / "gen" / "module_3d.cpp").exists():
        mods["3d"] = [BUILD / "gen" / "module_3d.cpp"]
    if PHYSICS3D_READY and (MODULES / "physics3d").exists() and (JOLT / "Jolt").exists():
        mods["physics3d"] = sorted((MODULES / "physics3d").glob("*.cpp")) + jolt_sources()
    return mods


MODULE_SYMBOLS = {
    "physics2d": "luaopen_love_physics",
    "video": "luaopen_love_video",
    "synth": "luaopen_love_synth",
    "3d": "luaopen_love_graphics3d",
    "physics3d": "luaopen_love_physics3d",
}

# Jolt's settings (love/src/modules/physics3d/README.md); they must match
# between Jolt and the binding.
PHYSICS3D_READY = True
# Jolt writes its SIMD with SSE intrinsics, which Emscripten maps to wasm
# SIMD. The JPH_* defines must match between Jolt and the binding.
JOLT_FLAGS = ["-I" + str(JOLT), "-msse4.2", "-DNDEBUG", "-DJPH_NO_DEBUG"]


def jolt_sources():
    """Jolt's sources, as in Jolt.cmake: no GPU compute, shaders or object streams."""
    out = []
    for f in sorted((JOLT / "Jolt").rglob("*.cpp")):
        rel = f.relative_to(JOLT / "Jolt").as_posix()
        if rel.startswith(("Compute/", "Shaders/")) or rel == "ObjectStream/TypeDeclarations.cpp":
            continue
        if rel.startswith("ObjectStream/ObjectStream"):
            continue
        out.append(f)
    return out


def build_synth(opt):
    """The sound synthesizer, built on its own for the editor's previews.

    Same C++ as the engine's (love/src/modules/synth/Synth*.cpp), so a sound
    plays the same in the editor as in the game. Exported functions are listed
    in love/src/modules/synth/web/exports.txt.
    """
    web = SYNTH / "web"
    if not (web / "synth_web.cpp").exists():
        return
    sources = sorted(SYNTH.glob("Synth*.cpp")) + sorted(web.glob("*.cpp"))
    out = DIST / "synth.mjs"
    newest = max(p.stat().st_mtime for p in sources + sorted(SYNTH.glob("Synth*.h")) + [web / "exports.txt"])
    if out.exists() and out.stat().st_mtime > newest:
        return
    cmd = ["em++", *[str(s) for s in sources], "-std=c++20", "-I" + str(SYNTH), *opt,
           "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createSynth", "-sENVIRONMENT=web",
           "-sALLOW_MEMORY_GROWTH=1", "-sSINGLE_FILE=1",
           "-sEXPORTED_FUNCTIONS=@" + str(web / "exports.txt"),
           "-sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU8,stringToUTF8,lengthBytesUTF8",
           "-o", str(out)]
    print("building synth.mjs...")
    if subprocess.run(cmd).returncode != 0:
        sys.exit("synth build failed")


def web_sources():
    return sorted((WEB / "native").glob("*.cpp")) + sorted((WEB / "native").glob("*.c"))


def obj_path(src: Path) -> Path:
    # obj-pic: everything is position-independent since the module split, so
    # objects from before it are never reused.
    rel = src.relative_to(ROOT)
    return BUILD / "obj-pic" / rel.with_suffix(rel.suffix + ".o")


def needs_rebuild(src: Path, obj: Path) -> bool:
    if not obj.exists():
        return True
    t = obj.stat().st_mtime
    dep = obj.with_suffix(".d")
    if not dep.exists():
        return True
    # Make-style depfile: escaped newlines, and spaces in paths escaped as "\ ".
    text = dep.read_text().replace("\\\n", " ").split(": ", 1)[-1]
    deps = [d.replace("\\ ", " ") for d in re.split(r"(?<!\\)\s+", text) if d]
    for d in deps:
        try:
            if os.stat(d).st_mtime > t:
                return True
        except FileNotFoundError:
            return True
    return False


def compile_one(src: Path, opt: list):
    obj = obj_path(src)
    obj.parent.mkdir(parents=True, exist_ok=True)
    is_cpp = src.suffix == ".cpp"
    cc = "em++" if is_cpp else "emcc"
    flags = list(COMMON_FLAGS) + list(opt)
    rel = str(src.relative_to(LOVE)) if LOVE in src.parents else ""
    if rel.startswith(SIZE_OPT_PREFIXES) and "-O0" not in opt:
        flags = [f for f in flags if not f.startswith("-O")] + ["-Oz"]
    if is_cpp:
        flags.append("-std=c++20")
    if JOLT in src.parents or (MODULES / "physics3d") in src.parents:
        flags += JOLT_FLAGS

    cmd = [cc, *flags, "-MMD", "-MF", str(obj.with_suffix(".d")), "-c", str(src), "-o", str(obj)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return src, r.returncode, r.stdout + r.stderr


WASM_IMPORTS_JS = """
const fs = require('fs');
const skip = new Set(['memory', '__memory_base', '__table_base', '__stack_pointer',
                      '__indirect_function_table']);
const names = new Set();
for (const f of process.argv.slice(1)) {
  for (const i of WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(f)))) {
    if (!skip.has(i.name) && (i.module === 'env' || i.module.startsWith('GOT.'))) names.add(i.name);
  }
}
console.log([...names].sort().join('\\n'));
"""


def side_module_imports(paths):
    """Symbols the side modules need from the core, which must export them."""
    if not paths:
        return []
    r = subprocess.run(["node", "-e", WASM_IMPORTS_JS, *map(str, paths)], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("could not read side module imports:\n" + r.stderr)
    return [n for n in r.stdout.split() if n]


CHECK_LINKS_JS = """
const fs = require('fs');
const [core, ...mods] = process.argv.slice(1);
const exported = new Set(WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(core))).map((e) => e.name));
const internal = new Set(['memory', '__memory_base', '__table_base', '__indirect_function_table', '__c_longjmp']);
let bad = 0;
for (const m of mods) {
  const missing = WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(m)))
    .filter((i) => (i.module === 'env' || i.module.startsWith('GOT.')) && !internal.has(i.name) && !exported.has(i.name))
    .map((i) => i.name);
  if (missing.length) { bad++; console.log(m + ' needs symbols the core does not export: ' + missing.join(', ')); }
}
process.exit(bad ? 1 : 0);
"""


def check_module_links(core, side):
    """Fails the build if a side module imports something the core doesn't export
    (it would only fail when a game loads it)."""
    r = subprocess.run(["node", "-e", CHECK_LINKS_JS, str(core), *map(str, side)], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(r.stdout + r.stderr)


def compile_all(sources, opt, jobs):
    todo = [s for s in sources if needs_rebuild(s, obj_path(s))]
    print(f"{len(sources)} sources, {len(todo)} to compile")
    failed = []
    with cf.ThreadPoolExecutor(max_workers=jobs) as ex:
        for i, (src, rc, out) in enumerate(ex.map(lambda s: compile_one(s, opt), todo), 1):
            name = src.relative_to(ROOT)
            if rc != 0:
                failed.append(name)
                print(f"[{i}/{len(todo)}] FAILED {name}\n{out}", flush=True)
            elif out.strip():
                print(f"[{i}/{len(todo)}] {name}\n{out}", flush=True)
    if failed:
        sys.exit(f"{len(failed)} file(s) failed to compile")


def link_side_module(name, sources, opt, out_dir):
    out = out_dir / "modules" / f"{name}.wasm"
    out.parent.mkdir(parents=True, exist_ok=True)
    objs = [str(obj_path(s)) for s in sources]
    newest = max(obj_path(s).stat().st_mtime for s in sources)
    if out.exists() and out.stat().st_mtime > newest:
        return out
    cmd = ["em++", *objs, *COMMON_FLAGS, *opt, "-sSIDE_MODULE=2",
           "-sEXPORTED_FUNCTIONS=_" + MODULE_SYMBOLS[name], "-o", str(out)]
    if subprocess.run(cmd).returncode != 0:
        sys.exit(f"linking the {name} module failed")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("-j", type=int, default=os.cpu_count())
    ap.add_argument("--only-compile", action="store_true")
    ap.add_argument("--web-only", action="store_true", help="only copy player/editor files")
    ap.add_argument("--profiling", action="store_true",
                    help="keep function names (for size analysis); output to build/profiling")
    args = ap.parse_args()

    if args.web_only:
        copy_web()
        return
    if not shutil.which("emcc"):
        sys.exit("emcc not found: source emsdk_env.sh first")

    COMMON_FLAGS.extend(emscripten_includes())
    opt = ["-O0", "-g", "-sASSERTIONS=1"] if args.debug else ["-O3", "-flto"]
    if args.debug:
        BUILD.joinpath("debug").mkdir(parents=True, exist_ok=True)

    generate_engine_lua()
    modules = module_sources()
    in_modules = {p for srcs in modules.values() for p in srcs}
    core = [p for p in (cmake_sources() + [LOVE / f for f in EXTRA_SOURCES] + lua_sources() + web_sources())
            if p not in in_modules]
    compile_all(core + sorted(in_modules), opt, args.j)
    if args.only_compile:
        return

    out_dir = BUILD / "profiling" if args.profiling else DIST
    out_dir.mkdir(parents=True, exist_ok=True)
    print("linking modules...")
    side = [link_side_module(name, srcs, opt, out_dir) for name, srcs in modules.items()]
    needed = side_module_imports(side)

    objs = [str(obj_path(s)) for s in core]
    exports = ["_main", "_malloc", "_free",
               "_loveweb_quit", "_loveweb_set_paused", "_loveweb_fit_window",
               "_loveweb_file_dialog_add", "_loveweb_file_dialog_done",
               "_loveweb_text_input", "_loveweb_text_editing", "_loveweb_text_key",
               "_ljit_configure", "_ljit_stats"]
    # Side modules share the core's stack pointer. At -O3, Emscripten's dead
    # code pass removes its export unless it's listed.
    exports += ["___stack_pointer"]
    exports += ["_" + n for n in needed if "_" + n not in exports]
    exports_file = BUILD / "core-exports.txt"
    exports_file.write_text("\n".join(exports) + "\n")
    link = [
        "em++", *objs, *COMMON_FLAGS, *opt,
        "-lopenal", "-lidbfs.js",
        "--js-library", str(WEB / "native" / "library_love.js"),
        "--js-library", str(WEB / "native" / "library_ljit.js"),
        "-sMAIN_MODULE=2",
        "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createSmitten",
        "-sENVIRONMENT=web",
        "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=64MB", "-sSTACK_SIZE=2MB",
        "-sALLOW_TABLE_GROWTH=1",  # Lua JIT adds compiled functions
        "-sMAX_WEBGL_VERSION=2", "-sMIN_WEBGL_VERSION=2", "-sFULL_ES3=1",
        "-sGL_ENABLE_GET_PROC_ADDRESS=1",
        "-sFORCE_FILESYSTEM=1",
        "-sEXPORTED_RUNTIME_METHODS=FS,IDBFS,ENV,callMain,ccall,cwrap,HEAPU8,loadDynamicLibrary",
        "-sEXPORTED_FUNCTIONS=@" + str(exports_file),
        "-sINVOKE_RUN=0", "-sEXIT_RUNTIME=0",
        "-o", str(out_dir / "smitten.mjs"),
    ] + (["--profiling-funcs"] if args.profiling else [])
    print("linking the core...")
    r = subprocess.run(link)
    if r.returncode != 0:
        sys.exit("link failed")
    check_module_links(out_dir / "smitten.wasm", side)
    for f in [out_dir / "smitten.mjs", out_dir / "smitten.wasm", *side]:
        print(f"  {f.relative_to(out_dir)}: {f.stat().st_size / 1e6:.2f} MB")
    if not args.profiling:
        copy_web()
        build_synth(opt)


def build_id():
    h = hashlib.sha1()
    for f in ("smitten.mjs", "smitten.wasm"):
        p = DIST / f
        if p.exists():
            h.update(p.read_bytes())
    return h.hexdigest()[:12]


def copy_web():
    """Copy the player, editor and examples next to the engine."""
    for sub in ("player", "editor", "dev"):
        src = WEB / sub
        if src.exists():
            shutil.copytree(src, DIST, dirs_exist_ok=True)
    player = DIST / "player.js"
    if player.exists():
        player.write_text(player.read_text().replace("__SMITTEN_BUILD__", build_id()))
    if (WEB / "examples").exists():
        shutil.copytree(WEB / "examples", DIST / "examples", dirs_exist_ok=True)


if __name__ == "__main__":
    main()
