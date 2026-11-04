#!/usr/bin/env python3
"""
Development server for the test projects in tools/ and the games in games/.

Serves dist/ like serve.py, plus:

    /tools/<path>.zip        the project in tools/<path>/ zipped on the fly, e.g.
                             player.html?game=tools/scene-tests/smoke.zip
                             player.html?game=tools/video.zip&modules=video
    /games/<name>.zip        games/<name>/ zipped the same way, without its tools/
                             (the art and map generators), e.g.
                             player.html?game=games/my-game.zip

    python3 tools/test_server.py 8772
"""
import functools
import http.server
import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
TOOLS = ROOT / "tools"
GAMES = ROOT / "games"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def project_zip(self):
        """The zipped project for /tools/<path>.zip or /games/<name>.zip, or None for other paths."""
        path = self.path.split("?", 1)[0]
        base = TOOLS if path.startswith("/tools/") else GAMES if path.startswith("/games/") else None
        if base is None or not path.endswith(".zip"):
            return None
        src = (base / path[len(base.name) + 2:-len(".zip")]).resolve()
        if base not in src.parents or not (src / "smitten.json").is_file():
            return b""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(src.rglob("*")):
                rel = f.relative_to(src)
                # A game's art and map generators stay out of the game.
                if f.is_file() and not (base == GAMES and rel.parts[0] == "tools"):
                    z.write(f, rel.as_posix())
        return buf.getvalue()

    def serve_zip(self, head):
        data = self.project_zip()
        if data is None:
            return False
        if not data:
            self.send_error(404, "no such test project")
            return True
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if not head:
            self.wfile.write(data)
        return True

    def do_GET(self):
        if not self.serve_zip(head=False):
            super().do_GET()

    def do_HEAD(self):
        if not self.serve_zip(head=True):
            super().do_HEAD()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8772
    handler = functools.partial(Handler, directory=str(DIST))
    print(f"http://localhost:{port}/player.html?game=tools/scene-tests/smoke.zip")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()


if __name__ == "__main__":
    main()
