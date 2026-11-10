#!/usr/bin/env python3
"""Tiny dynamic server: every response embeds a per-process nonce, so the
output is NOT static. Fixture for S02-C/G."""
import http.server, os, secrets
NONCE = secrets.token_hex(8)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"<h1>E2E_COMPUTE_SERVER_V1</h1><p>nonce={NONCE}</p>".encode()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("0.0.0.0", 8080), H).serve_forever()
