#!/usr/bin/env python3
"""
Serve dist/ for local development.

Unlike `python3 -m http.server`, this disables HTTP caching (so rebuilt
engine files are always picked up) and serves .wasm as application/wasm so
browsers can compile it while it downloads.

    python3 serve.py            # http://localhost:8766
    python3 serve.py 9000
"""
import functools
import socket
import http.server
import sys
from pathlib import Path

DIST = Path(__file__).resolve().parent / "dist"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".love": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

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
