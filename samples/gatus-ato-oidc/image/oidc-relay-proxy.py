#!/usr/bin/env python3
"""Present the public OpenID issuer to Gatus through the Runner's relay.

Gatus 5.38.0 discovers the provider with coreos/go-oidc v3's
oidc.NewProvider (security/oidc.go), which rejects a discovery document whose
"issuer" is not the exact URL it fetched. The Runner hands the workload a
plain-http relay (ATO_BINDING_OIDC_ISSUER) that keeps the public https issuer and
the authorization endpoint as they are and rewrites only the back-channel
endpoints onto the relay. Pointing Gatus at the relay therefore fails the issuer
comparison, and pointing it at the public URL fails because the container cannot
open the installation's https origin.

This front makes the public URL reachable from inside the container: Gatus is
started with HTTPS_PROXY pointing at it (and SSL_CERT_FILE naming a bundle with
the local CA), so the one HTTPS request it makes - the discovery document - is
tunnelled here as a normal CONNECT. The front terminates TLS with a certificate
for the public issuer's host and forwards the request to the relay over plain
http, path prefix included. The document itself is not changed, so its issuer is
the public URL Gatus was configured with and the id_token's "iss" is verified
against the provider's real issuer.

Environment: PROXY_PUBLIC_ISSUER, PROXY_RELAY, PROXY_LISTEN_HOST (default
127.0.0.1), PROXY_LISTEN_PORT, PROXY_CERT, PROXY_KEY.
"""

import os
import signal
import socket
import ssl
import sys
import threading
import urllib.parse


def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise SystemExit("oidc-relay-proxy: " + name + " is required")
    return value


PUBLIC = urllib.parse.urlsplit(required("PROXY_PUBLIC_ISSUER"))
RELAY = urllib.parse.urlsplit(required("PROXY_RELAY"))
ISSUER_PATH = PUBLIC.path.rstrip("/")
RELAY_PATH = RELAY.path.rstrip("/")
RELAY_HOST = RELAY.hostname or ""
RELAY_PORT = RELAY.port or (443 if RELAY.scheme == "https" else 80)
LISTEN_HOST = os.environ.get("PROXY_LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(required("PROXY_LISTEN_PORT"))
CERT = required("PROXY_CERT")
KEY = required("PROXY_KEY")
MAX_HEAD = 65536


def log(message):
    sys.stderr.write("oidc-relay-proxy: " + message + "\n")
    sys.stderr.flush()


def read_head(sock):
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return None
        data += chunk
        if len(data) > MAX_HEAD:
            return None
    return data


def parse_head(head):
    lines = head.split(b"\r\n")
    parts = lines[0].decode("latin1").split(" ")
    if len(parts) != 3:
        return None
    headers = []
    for line in lines[1:]:
        if not line:
            continue
        name, _, value = line.partition(b":")
        headers.append((name.strip().decode("latin1"), value.strip().decode("latin1")))
    return parts, headers


def read_body(sock, head):
    length = 0
    for line in head.split(b"\r\n")[1:]:
        name, _, value = line.partition(b":")
        if name.strip().lower() == b"content-length":
            try:
                length = int(value.strip())
            except ValueError:
                length = 0
    body = b""
    while len(body) < length:
        chunk = sock.recv(min(65536, length - len(body)))
        if not chunk:
            break
        body += chunk
    return body


def relay_path(request_path):
    """The relay serves the issuer path at its own root unless it carries one."""
    if ISSUER_PATH and request_path.startswith(ISSUER_PATH):
        suffix = request_path[len(ISSUER_PATH):]
    else:
        suffix = request_path
    return RELAY_PATH + suffix


def with_connection_close(response):
    head, separator, body = response.partition(b"\r\n\r\n")
    if not separator:
        return response
    lines = head.split(b"\r\n")
    kept = [lines[0]]
    for line in lines[1:]:
        lower = line.lower()
        if lower.startswith(b"connection:") or lower.startswith(b"keep-alive:"):
            continue
        kept.append(line)
    kept.append(b"Connection: close")
    return b"\r\n".join(kept) + separator + body


def forward(method, target, headers, body):
    parsed = urllib.parse.urlsplit(target)
    path = relay_path(parsed.path or "/")
    request = method + " " + path + " HTTP/1.1\r\n"
    request += "Host: " + RELAY_HOST + "\r\n"
    request += "Connection: close\r\n"
    for name, value in headers:
        lower = name.lower()
        if lower in ("host", "connection", "proxy-connection", "content-length", "accept-encoding"):
            continue
        request += name + ": " + value + "\r\n"
    if body:
        request += "Content-Length: " + str(len(body)) + "\r\n"
    request += "\r\n"
    upstream = socket.create_connection((RELAY_HOST, RELAY_PORT), timeout=30)
    if RELAY.scheme == "https":
        upstream = ssl.create_default_context().wrap_socket(upstream, server_hostname=RELAY_HOST)
    try:
        upstream.sendall(request.encode("latin1") + body)
        chunks = []
        while True:
            chunk = upstream.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
        response = b"".join(chunks)
    finally:
        upstream.close()
    status = "?"
    if response.startswith(b"HTTP/"):
        status = response.split(b" ", 2)[1].decode("latin1")
    log(method + " " + path + " -> " + status)
    return with_connection_close(response)


def handle_connection(conn, context):
    try:
        conn.settimeout(60)
        head = read_head(conn)
        if head is None:
            return
        parsed = parse_head(head)
        if parsed is None:
            return
        (method, target, _), _headers = parsed
        if method != "CONNECT":
            conn.sendall(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            return
        host = target.rsplit(":", 1)[0].strip("[]")
        if host != (PUBLIC.hostname or ""):
            conn.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            log("refused CONNECT to " + target)
            return
        conn.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        tls = context.wrap_socket(conn, server_side=True)
        try:
            request_head = read_head(tls)
            if request_head is None:
                return
            parsed = parse_head(request_head)
            if parsed is None:
                return
            (method, target, _), headers = parsed
            body = read_body(tls, request_head)
            tls.sendall(forward(method, target, headers, body))
        finally:
            try:
                tls.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            tls.close()
    except (OSError, ssl.SSLError) as error:
        log("connection failed: " + str(error))
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main():
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(CERT, KEY)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((LISTEN_HOST, LISTEN_PORT))
    listener.listen(16)

    def stop(_signum, _frame):
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log(
        "presenting "
        + PUBLIC.geturl()
        + " on "
        + LISTEN_HOST
        + ":"
        + str(LISTEN_PORT)
        + ", forwarding to "
        + RELAY.geturl()
    )
    while True:
        conn, _ = listener.accept()
        threading.Thread(target=handle_connection, args=(conn, context), daemon=True).start()


if __name__ == "__main__":
    main()
