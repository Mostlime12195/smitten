#!/bin/sh
# Builds and tests love.physics3d:
# - build/p3test.js: Lua + Jolt + the binding linked into one Node.js program
# - build/physics3d.wasm: the binding + Jolt as a WebAssembly side module (LTO)
# - build/p3dyn.js: Lua as a MAIN_MODULE=2 program that dlopens physics3d.wasm
# and runs tools/physics3d/test.lua with p3test.js and p3dyn.js.
#
#   zsh -ic 'tools/physics3d/build.sh'          everything
#   zsh -ic 'tools/physics3d/build.sh test'     p3test.js and its test run only
#   zsh -ic 'tools/physics3d/build.sh side'     the side module only (prints its size)
#   zsh -ic 'tools/physics3d/build.sh dyn'      the side module, p3dyn.js and its test run
#
# Object files are cached in tools/physics3d/build/ (obj/ for the harness,
# lto/ for the side module). emcc must be on PATH.
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$HERE/build
LUA=$ROOT/deps/lua-5.1.5
JOLT=$ROOT/deps/jolt
BINDING=$ROOT/love/src/modules/physics3d

# Code generation shared with the engine (must match for linking).
CODEGEN="-fwasm-exceptions -sSUPPORT_LONGJMP=wasm -msimd128 -O3 -fPIC"
# Jolt configuration (the binding must use the same defines). Not defined on
# purpose: JPH_DEBUG_RENDERER, JPH_PROFILE_ENABLED, JPH_OBJECT_STREAM,
# JPH_ENABLE_ASSERTS, JPH_DOUBLE_PRECISION, JPH_FLOATING_POINT_EXCEPTIONS_ENABLED.
# -msse4.2 lets Jolt use its SSE code, which Emscripten maps to wasm SIMD.
JOLT_FLAGS="-std=c++20 -msse4.2 -DNDEBUG -DJPH_NO_DEBUG -I$JOLT"
BINDING_FLAGS="$JOLT_FLAGS -I$LUA"
LUA_FLAGS="-I$LUA"

# --- internal: compile one file (called through xargs) ----------------------
if [ "$1" = "--cc" ]; then
	obj=$2 src=$3 kind=$4 lto=$5
	case $kind in
		lua) flags="$LUA_FLAGS" ;;
		jolt) flags="$JOLT_FLAGS" ;;
		binding) flags="$BINDING_FLAGS -Wall -Wextra -Wno-unused-parameter" ;;
	esac
	[ "$lto" = lto ] && flags="$flags -flto"
	case $src in *.c) cc=emcc ;; *) cc=em++ ;; esac
	mkdir -p "$(dirname "$obj")"
	echo "  ${src#$ROOT/}$([ "$lto" = lto ] && echo " (lto)")"
	exec $cc $CODEGEN $flags -c "$src" -o "$obj"
fi

what=${1:-all}
if ! command -v emcc >/dev/null 2>&1; then
	echo "emcc not found: run this from an interactive zsh (zsh -ic '$0') or source emsdk_env.sh" >&2
	exit 1
fi
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
mkdir -p "$OUT"

# Throw the cache away when the flags change.
stamp="$CODEGEN | $JOLT_FLAGS | $(emcc --version | head -1)"
if [ ! -f "$OUT/flags" ] || [ "$(cat "$OUT/flags")" != "$stamp" ]; then
	rm -rf "$OUT/obj" "$OUT/lto"
	echo "$stamp" > "$OUT/flags"
fi

LUA_SRC=$(ls "$LUA"/*.c | grep -v -e '/lua\.c$' -e '/luac\.c$' -e '/print\.c$')
# Jolt.cmake's source list: every .cpp except the GPU/CPU compute backends
# and hair shaders (Compute/*/, Shaders/) and the ObjectStream readers and
# writers (only built with JPH_OBJECT_STREAM). Those are all #ifdef'd out or
# unused here, so compiling every .cpp would also work, just slower.
JOLT_SRC=$(find "$JOLT/Jolt" -name '*.cpp' ! -path '*/Compute/*/*' ! -path '*/Shaders/*' \
	! -name 'ObjectStream*.cpp' ! -name 'TypeDeclarations.cpp' | sort)
BINDING_SRC=$(ls "$BINDING"/*.cpp)

# stale OBJ SRC [DEPS...]: true when OBJ is missing or older than any input.
stale() {
	obj=$1
	shift
	[ -f "$obj" ] || return 0
	for f in "$@"; do
		[ "$f" -nt "$obj" ] && return 0
	done
	return 1
}

objpath() { # objpath DIR SRC
	rel=${2#$ROOT/}
	echo "$OUT/$1/${rel%.*}.o"
}

# queue DIR KIND LTO SRCS DEPS: adds stale files to the job list, prints objs.
JOBLIST=$OUT/jobs.txt
: > "$JOBLIST"
queue() {
	dir=$1 kind=$2 lto=$3 srcs=$4 deps=$5
	for src in $srcs; do
		obj=$(objpath "$dir" "$src")
		# shellcheck disable=SC2086
		if stale "$obj" "$src" $deps; then
			echo "$obj $src $kind $lto" >> "$JOBLIST"
		fi
	done
}
objs() { # objs DIR SRCS
	for src in $2; do objpath "$1" "$src"; done
}

LUA_DEPS="$(ls "$LUA"/*.h) $LUA/ljit.inc"
BINDING_DEPS=$(ls "$BINDING"/*.h)

case $what in
	all) TEST=1 SIDE=1 DYN=1 ;;
	test) TEST=1 SIDE= DYN= ;;
	side) TEST= SIDE=1 DYN= ;;
	dyn) TEST= SIDE=1 DYN=1 ;;
	*) echo "usage: $0 [all|test|side|dyn]" >&2; exit 2 ;;
esac

if [ -n "$TEST$DYN" ]; then
	queue obj lua - "$LUA_SRC $HERE/runner.c" "$LUA_DEPS"
fi
if [ -n "$TEST" ]; then
	queue obj jolt - "$JOLT_SRC" ""
	queue obj binding - "$BINDING_SRC" "$BINDING_DEPS"
fi
if [ -n "$SIDE" ]; then
	queue lto jolt lto "$JOLT_SRC" ""
	queue lto binding lto "$BINDING_SRC" "$BINDING_DEPS"
fi

if [ -s "$JOBLIST" ]; then
	echo "compiling $(wc -l < "$JOBLIST" | tr -d ' ') file(s) with $JOBS jobs"
	xargs -P "$JOBS" -L 1 "$0" --cc < "$JOBLIST"
fi

# The Lua JIT (ljit.inc) is always on in Emscripten builds; it needs its JS
# half and a growable function table.
NODE_FLAGS="-sENVIRONMENT=node -sNODERAWFS=1 -sEXIT_RUNTIME=1 \
	-sALLOW_MEMORY_GROWTH=1 -sALLOW_TABLE_GROWTH=1 -sSTACK_SIZE=2MB \
	--js-library $ROOT/web/native/library_ljit.js"
LUA_OBJS=$(objs obj "$LUA_SRC $HERE/runner.c")

if [ -n "$TEST" ]; then
	RUNNER_OBJS="$LUA_OBJS $(objs obj "$JOLT_SRC") $(objs obj "$BINDING_SRC")"
	# shellcheck disable=SC2086
	if stale "$OUT/p3test.js" $RUNNER_OBJS "$0"; then
		echo "linking build/p3test.js"
		# shellcheck disable=SC2086
		em++ $RUNNER_OBJS $CODEGEN $NODE_FLAGS -o "$OUT/p3test.js"
	fi
fi

if [ -n "$SIDE" ]; then
	SIDE_OBJS="$(objs lto "$JOLT_SRC") $(objs lto "$BINDING_SRC")"
	# shellcheck disable=SC2086
	if stale "$OUT/physics3d.wasm" $SIDE_OBJS "$0"; then
		echo "linking build/physics3d.wasm (side module, LTO)"
		# shellcheck disable=SC2086
		em++ $SIDE_OBJS $CODEGEN -flto \
			-sSIDE_MODULE=2 -sEXPORTED_FUNCTIONS=_luaopen_love_physics3d \
			-o "$OUT/physics3d.wasm"
	fi
	raw=$(wc -c < "$OUT/physics3d.wasm" | tr -d ' ')
	gz=$(gzip -9 -c "$OUT/physics3d.wasm" | wc -c | tr -d ' ')
	echo "physics3d.wasm: $raw bytes ($((raw / 1024)) KiB), gzip -9: $gz bytes ($((gz / 1024)) KiB)"
fi

if [ -n "$DYN" ]; then
	# A MAIN_MODULE=2 program that exports only what the side modules on its
	# link line import. With AUTOLOAD_DYLIBS=0 physics3d.wasm isn't loaded at
	# startup: require("love.physics3d") dlopens it (runner.c, PHYSICS3D_DLOPEN).
	DYN_RUNNER=$OUT/obj/tools/physics3d/runner-dlopen.o
	if stale "$DYN_RUNNER" "$HERE/runner.c" "$0"; then
		emcc $CODEGEN $LUA_FLAGS '-DPHYSICS3D_DLOPEN="tools/physics3d/build/physics3d.wasm"' \
			-c "$HERE/runner.c" -o "$DYN_RUNNER"
	fi
	DYN_OBJS="$(objs obj "$LUA_SRC") $DYN_RUNNER"
	# shellcheck disable=SC2086
	if stale "$OUT/p3dyn.js" $DYN_OBJS "$OUT/physics3d.wasm" "$0"; then
		echo "linking build/p3dyn.js (main module that dlopens physics3d.wasm)"
		# shellcheck disable=SC2086
		em++ $DYN_OBJS $CODEGEN $NODE_FLAGS -sMAIN_MODULE=2 -sAUTOLOAD_DYLIBS=0 \
			"$OUT/physics3d.wasm" -o "$OUT/p3dyn.js"
	fi
fi

cd "$ROOT"
status=0
if [ -n "$TEST" ]; then
	echo "== test.lua, statically linked (build/p3test.js)"
	node "$OUT/p3test.js" tools/physics3d/test.lua || status=1
fi
if [ -n "$DYN" ]; then
	echo "== test.lua, physics3d.wasm as a side module (build/p3dyn.js)"
	node "$OUT/p3dyn.js" tools/physics3d/test.lua || status=1
fi
exit $status
