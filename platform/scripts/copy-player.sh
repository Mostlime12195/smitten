#!/bin/sh
# Copies Smitten's player from a build into public/player/, where the site
# serves it: player.html, player.js, player.css, clips.js, gif.js, webm.js,
# smitten.mjs, smitten.wasm and modules/*.wasm.
#
#   sh scripts/copy-player.sh              # from ../dist (python3 build.py)
#   sh scripts/copy-player.sh path/to/dist
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
src=${1:-"$here/../dist"}
dest="$here/public/player"

if [ ! -d "$src" ]; then
  echo "No build at $src. Build Smitten first (python3 build.py in the repository root) or pass the dist folder." >&2
  exit 1
fi
for f in player.html player.js player.css clips.js gif.js webm.js smitten.mjs smitten.wasm; do
  if [ ! -f "$src/$f" ]; then
    echo "$src/$f is missing: is $src a complete build?" >&2
    exit 1
  fi
done
# build.py stamps player.js with a hash of the engine files; web/player/ has
# only the placeholder, which would mix cached engine files across builds.
if grep -q "__SMITTEN_BUILD__" "$src/player.js"; then
  echo "$src/player.js isn't from a build (it still has __SMITTEN_BUILD__). Use dist/, not web/player/." >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest/modules"
cp "$src/player.html" "$src/player.js" "$src/player.css" "$src/clips.js" "$src/gif.js" "$src/webm.js" "$src/smitten.mjs" "$src/smitten.wasm" "$dest/"
count=0
if [ -d "$src/modules" ]; then
  for m in "$src"/modules/*.wasm; do
    [ -f "$m" ] || continue
    cp "$m" "$dest/modules/"
    count=$((count + 1))
  done
fi
echo "Copied the player and $count engine module(s) from $src to $dest."
