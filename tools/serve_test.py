#!/usr/bin/env python3
"""
Tests serve.py: compression, files compressed ahead of time, and caching.

    python3 tools/serve_test.py
"""
import gzip
import http.client
import os
import sys
import tempfile
import threading
import functools
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import serve  # noqa: E402

failed = 0


def check(name, got, want):
    global failed
    if got == want:
        print(f"ok   {name}")
    else:
        failed += 1
        print(f"FAIL {name}: got {got!r}, wanted {want!r}")


def main():
    with tempfile.TemporaryDirectory() as root:
        root = Path(root)
        js = b"console.log('hello');\n" * 200
        (root / "app.js").write_bytes(js)
        (root / "index.html").write_bytes(b"<!doctype html><title>t</title>" + b" " * 2000)
        (root / "engine.wasm").write_bytes(b"\0asm" + b"\1\2\3\4" * 5000)
        (root / "engine.wasm.br").write_bytes(b"pretend brotli")
        (root / "old.js").write_bytes(js)
        (root / "old.js.gz").write_bytes(b"stale")
        os.utime(root / "old.js.gz", (1, 1))
        (root / "picture.png").write_bytes(b"\x89PNG" + b"x" * 3000)

        httpd = serve.Server(("127.0.0.1", 0), functools.partial(serve.Handler, directory=str(root)))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]

        def get(path, headers=None, method="GET"):
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            conn.request(method, path, headers=headers or {})
            res = conn.getresponse()
            body = res.read()
            conn.close()
            return res, body

        res, body = get("/app.js", {"Accept-Encoding": "gzip, deflate, br"})
        check("gzip: encoding", res.getheader("Content-Encoding"), "gzip")
        check("gzip: body", gzip.decompress(body), js)
        check("gzip: length", res.getheader("Content-Length"), str(len(body)))
        check("gzip: smaller", len(body) < len(js), True)
        check("gzip: vary", res.getheader("Vary"), "Accept-Encoding")
        check("gzip: type", res.getheader("Content-Type"), "text/javascript")
        check("unversioned: checked every time", res.getheader("Cache-Control"), "no-cache")

        res, body = get("/app.js")
        check("identity: no encoding", res.getheader("Content-Encoding"), None)
        check("identity: body", body, js)

        res, body = get("/app.js", {"Accept-Encoding": "gzip"}, method="HEAD")
        check("head: encoding", res.getheader("Content-Encoding"), "gzip")
        check("head: no body", body, b"")

        res, body = get("/engine.wasm?v=abc123", {"Accept-Encoding": "gzip, br"})
        check("sibling: br sent as it is", (res.getheader("Content-Encoding"), body), ("br", b"pretend brotli"))
        check("sibling: type", res.getheader("Content-Type"), "application/wasm")
        check("versioned: kept for good", res.getheader("Cache-Control"), "public, max-age=31536000, immutable")

        res, body = get("/engine.wasm", {"Accept-Encoding": "gzip"})
        check("sibling: gzip when br isn't taken", res.getheader("Content-Encoding"), "gzip")

        res, body = get("/old.js", {"Accept-Encoding": "gzip"})
        check("sibling: a stale one is ignored", gzip.decompress(body), js)

        res, body = get("/", {"Accept-Encoding": "gzip"})
        check("index: status", res.status, 200)
        check("index: encoding", res.getheader("Content-Encoding"), "gzip")
        check("index: body", gzip.decompress(body)[:15], b"<!doctype html>")

        res, body = get("/picture.png", {"Accept-Encoding": "gzip"})
        check("png: not compressed", res.getheader("Content-Encoding"), None)
        check("png: body", len(body), 3004)

        res, body = get("/app.js", {"Accept-Encoding": "gzip"})
        modified = res.getheader("Last-Modified")
        res, body = get("/app.js", {"Accept-Encoding": "gzip", "If-Modified-Since": modified})
        check("not modified: 304", (res.status, body), (304, b""))

        res, body = get("/missing.js", {"Accept-Encoding": "gzip"})
        check("missing: 404", res.status, 404)

        httpd.shutdown()
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
