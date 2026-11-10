#!/usr/bin/env python3
"""
Serve dist/ for local development.

Unlike `python3 -m http.server`, this makes browsers check for a newer file
every time (so rebuilt files are always picked up; files asked for with
their build's ?v= are kept for good), serves .wasm as application/wasm so
browsers can compile it while it downloads, and compresses text and wasm:
the engine is 6.7 MB as it is and 2.4 MB gzipped. A file.br or file.gz next
to a file is sent as it is (platform/scripts/precompress.mjs writes them);
without one the file is gzipped once and kept in memory.

    python3 serve.py            # http://localhost:8766
    python3 serve.py 9000
"""
import datetime
import email.utils
import functools
import gzip
import io
import os
import socket
import http.server
import sys
import threading
from http import HTTPStatus
from pathlib import Path

DIST = Path(__file__).resolve().parent / "dist"


# Worth compressing: text, and wasm (which shrinks to about a third).
COMPRESSIBLE = {".wasm", ".mjs", ".js", ".css", ".html", ".json", ".svg", ".txt", ".md", ".map", ".lua"}

# Files gzipped here, by path: (modified, size, bytes). A file changes when
# it's rebuilt, which replaces its entry.
_gzipped = {}
_gzipped_lock = threading.Lock()


def gzipped(path, stat):
    key = (stat.st_mtime_ns, stat.st_size)
    with _gzipped_lock:
        had = _gzipped.get(path)
        if had and had[0] == key:
            return had[1]
    with open(path, "rb") as f:
        data = gzip.compress(f.read(), 6, mtime=0)
    with _gzipped_lock:
        _gzipped[path] = (key, data)
    return data


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".love": "application/octet-stream",
    }

    def end_headers(self):
        # A URL with the build's ?v= never changes; anything else is checked
        # again each time (a 304 when it's the same).
        versioned = any(part.startswith("v=") for part in self.path.partition("?")[2].split("&"))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if versioned else "no-cache")
        super().end_headers()

    def send_head(self):
        """Like the base class, but compressed when the browser takes it."""
        path = self.translate_path(self.path)
        if os.path.isdir(path) and self.path.partition("?")[0].endswith("/"):
            path = os.path.join(path, "index.html")
        if os.path.splitext(path)[1].lower() not in COMPRESSIBLE or not os.path.isfile(path):
            return super().send_head()
        stat = os.stat(path)
        if self.not_modified(stat):
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("Vary", "Accept-Encoding")
            self.end_headers()
            return None
        encoding, body = self.encoded(path, stat)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", self.guess_type(path))
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(len(body) if isinstance(body, bytes) else os.fstat(body.fileno()).st_size))
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        return io.BytesIO(body) if isinstance(body, bytes) else body

    def not_modified(self, stat):
        since = self.headers.get("If-Modified-Since")
        if not since or self.headers.get("If-None-Match"):
            return False
        try:
            since = email.utils.parsedate_to_datetime(since)
        except (TypeError, IndexError, OverflowError, ValueError):
            return False
        if since.tzinfo is None:
            since = since.replace(tzinfo=datetime.timezone.utc)
        modified = datetime.datetime.fromtimestamp(stat.st_mtime, datetime.timezone.utc).replace(microsecond=0)
        return modified <= since

    def encoded(self, path, stat):
        """(encoding or None, the body as bytes or an open file)."""
        accepts = {part.split(";")[0].strip().lower() for part in self.headers.get("Accept-Encoding", "").split(",")}
        for encoding, suffix in (("br", ".br"), ("gzip", ".gz")):
            sibling = path + suffix
            if encoding in accepts and os.path.isfile(sibling) and os.stat(sibling).st_mtime >= stat.st_mtime:
                return encoding, open(sibling, "rb")
        if "gzip" in accepts:
            return "gzip", gzipped(path, stat)
        return None, open(path, "rb")

    def log_message(self, fmt, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    # The editor loads dozens of modules at once; the default backlog of 5
    # makes the OS reset some of those connections.
    request_queue_size = 128


class DualStackServer(Server):
    # Listens on IPv6 and IPv4 both (for hosting behind a proxy, e.g. on Nest).
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def main():
    # serve.py [port] [--host ::] [--dir path]
    args = sys.argv[1:]
    opt = lambda name, default: args[args.index(name) + 1] if name in args else default
    port = int(args[0]) if args and args[0].isdigit() else 8766
    host = opt("--host", "")
    root = Path(opt("--dir", DIST)).resolve()
    handler = functools.partial(Handler, directory=str(root))
    server = DualStackServer if ":" in host else Server
    with server((host, port), handler) as httpd:
        print(f"Serving {root} at http://localhost:{port}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
