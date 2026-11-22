#!/bin/bash
# Gatus 5.38.0 for Ato, signed in with Ato's OpenID Provider.
#
# The Gatus binary and the runtime tools are image content (read-only); the
# Instance's one state directory /data holds Gatus's SQLite storage. People are
# signed in with their Ato account: Gatus is configured with the public OpenID
# Provider URL and reaches the Runner's plain-http relay for discovery, token
# exchange and JWKS through a loopback TLS front (oidc-relay-proxy.py), because
# coreos/go-oidc's discovery refuses a document whose issuer is not the URL it
# fetched (security/oidc.go, oidc.NewProvider). The browser half of the flow
# goes to the public https authorization_endpoint.
#
# This script needs bash for wait -n. The capsule starts it as "/bin/sh
# /app/start.sh", so re-exec under bash when sh is the interpreter.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

STATE=/data
RUN=/tmp/gatus
TLS_DIR=$RUN/tls
CONFIG=$RUN/config.yaml
DISCOVERY=$RUN/discovery.json
APP_PORT=8080
PROXY_PORT=18443

fatal() { echo "gatus: $*" >&2; exit 1; }

: "${ATO_BINDING_OIDC_CLIENT_ID:?missing ATO_BINDING_OIDC_CLIENT_ID}"
: "${ATO_BINDING_OIDC_CLIENT_SECRET:?missing ATO_BINDING_OIDC_CLIENT_SECRET}"
: "${ATO_BINDING_OIDC_ISSUER:?missing ATO_BINDING_OIDC_ISSUER}"
: "${ATO_OIDC_PUBLIC_ISSUER:?missing ATO_OIDC_PUBLIC_ISSUER}"

client_id=$ATO_BINDING_OIDC_CLIENT_ID
client_secret=$ATO_BINDING_OIDC_CLIENT_SECRET

# The redirect URL is built from the public origin people open: Gatus requires
# it to end with /authorization-code/callback. The Runner does not tell the
# workload its own host name, so the capsule passes it as GATUS_APP_URL;
# ATO_APP_ORIGIN is preferred when a Runner does provide it.
app_url=${ATO_APP_ORIGIN:-${GATUS_APP_URL:-}}
[ -n "$app_url" ] || fatal "GATUS_APP_URL (the Instance's public https origin) is required"
app_url=${app_url%/}
case $app_url in
  http://*|https://*) ;;
  *) fatal "GATUS_APP_URL must be an http:// or https:// URL" ;;
esac

# The relay is the Runner's plain-http way to the issuer; the public https URL
# is what browsers and the discovery document itself name.
relay=${ATO_BINDING_OIDC_ISSUER%/}
case $relay in
  http://*|https://*) ;;
  *) fatal "ATO_BINDING_OIDC_ISSUER must be an http:// or https:// URL" ;;
esac
public_issuer=${ATO_OIDC_PUBLIC_ISSUER%/}
case $public_issuer in
  http://*|https://*) ;;
  *) fatal "ATO_OIDC_PUBLIC_ISSUER must be an http:// or https:// URL" ;;
esac
issuer_host=${public_issuer#*://}
issuer_host=${issuer_host%%/*}

# The Runner runs this container read-only, so every write goes to the state or
# /tmp: Gatus writes only its SQLite storage (/data), and the generated config,
# certificate and logs stay in /tmp.
mkdir -p "$STATE" "$RUN" "$TLS_DIR" || fatal "cannot create $STATE or $RUN"
chmod 700 "$RUN"

# Gatus expands environment variables in the configuration file, so a literal
# dollar sign has to be written as $$ (config/config.go). YAML 1.1
# double-quoted scalars also need the backslash and the quote escaped.
yaml_dq() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\$/$$/g'
}

# Gatus's own settings. The OIDC block turns the dashboard gate on; there is no
# alerting provider (the Instance sends no notifications anywhere). The
# endpoints monitor the Instance itself, so a check never leaves the container:
#   - /health is the process's own health endpoint,
#   - /api/v1/config reports whether OIDC is on and whether this request is
#     authenticated (it must be false for a request without a session),
#   - /api/v1/endpoints/statuses is the protected dashboard API and must refuse
#     an unauthenticated request, so a green result is the gate being on.
# The retention knobs keep the SQLite state far below the 64 MiB checkpoint:
# at most 100 results and 20 events per endpoint, and Gatus compacts uptime
# entries into hourly/daily buckets by itself.
umask 077
cat > "$CONFIG" <<EOF
storage:
  type: sqlite
  path: $STATE/gatus.db
  maximum-number-of-results: 100
  maximum-number-of-events: 20

web:
  address: 0.0.0.0
  port: $APP_PORT

ui:
  header: "Gatus"
  login-subtitle: "「Login with OIDC」を押すと Ato のアカウントでサインインします"

security:
  oidc:
    issuer-url: "$(yaml_dq "$public_issuer")"
    redirect-url: "$(yaml_dq "$app_url")/authorization-code/callback"
    client-id: "$(yaml_dq "$client_id")"
    client-secret: "$(yaml_dq "$client_secret")"
    scopes:
      - openid
      - profile
      - email
    session-ttl: 8h

endpoints:
  - name: health
    group: gatus
    url: "http://127.0.0.1:$APP_PORT/health"
    interval: 1m
    conditions:
      - "[STATUS] == 200"

  - name: config
    group: gatus
    url: "http://127.0.0.1:$APP_PORT/api/v1/config"
    interval: 1m
    conditions:
      - "[STATUS] == 200"
      - "[BODY].oidc == true"

  - name: anonymous-statuses-refused
    group: gatus
    url: "http://127.0.0.1:$APP_PORT/api/v1/endpoints/statuses"
    interval: 1m
    conditions:
      - "[STATUS] == 401"
EOF
umask 022

# The public issuer is not reachable from inside the container (it is the
# installation's https origin). A local CA and a certificate for its host let
# the loopback front present that URL; Gatus trusts the CA through
# SSL_CERT_FILE and reaches the front through HTTPS_PROXY. Nothing is written
# outside /tmp.
umask 077
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=ato-gatus-oidc-ca \
  -keyout "$TLS_DIR/ca-key.pem" -out "$TLS_DIR/ca.pem" >/dev/null 2>&1 \
  || fatal "cannot create the local CA for the issuer relay"
case $issuer_host in
  *[0-9].[0-9]*.[0-9]*.[0-9]*) san="IP:$issuer_host" ;;
  *) san="DNS:$issuer_host" ;;
esac
openssl req -newkey rsa:2048 -nodes -subj "/CN=$issuer_host" \
  -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/request.csr" >/dev/null 2>&1 \
  || fatal "cannot create the front certificate request"
printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$san" > "$TLS_DIR/ext.cnf"
openssl x509 -req -in "$TLS_DIR/request.csr" -CA "$TLS_DIR/ca.pem" -CAkey "$TLS_DIR/ca-key.pem" \
  -CAcreateserial -days 3650 -extfile "$TLS_DIR/ext.cnf" -out "$TLS_DIR/cert.pem" >/dev/null 2>&1 \
  || fatal "cannot sign the front certificate"
cat /etc/ssl/certs/ca-certificates.crt "$TLS_DIR/ca.pem" > "$TLS_DIR/bundle.pem" 2>/dev/null \
  || cp "$TLS_DIR/ca.pem" "$TLS_DIR/bundle.pem"
umask 022

proxy_pid=
app_pid=
stop() {
  trap - INT TERM
  echo "gatus: stopping" >&2
  [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
  [ -n "$proxy_pid" ] && kill "$proxy_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 143
}
trap stop INT TERM

PROXY_LISTEN_PORT=$PROXY_PORT PROXY_PUBLIC_ISSUER=$public_issuer PROXY_RELAY=$relay \
  PROXY_CERT=$TLS_DIR/cert.pem PROXY_KEY=$TLS_DIR/key.pem \
  python3 /usr/local/lib/ato-gatus/oidc-relay-proxy.py > "$RUN/proxy.log" 2>&1 &
proxy_pid=$!

# The Runner starts the relay as part of the same launch and the container can
# be running for a moment before it answers; retry the discovery check for a
# while instead of exiting on the first connection failure. The check also
# proves that the front presents the public issuer the capsule was rendered for
# and that the back-channel endpoints point at the relay.
i=0
while :; do
  if curl -fsS --max-time 10 --proxy "http://127.0.0.1:$PROXY_PORT" --cacert "$TLS_DIR/bundle.pem" \
      "$public_issuer/.well-known/openid-configuration" -o "$DISCOVERY" 2>/dev/null; then
    if python3 - "$DISCOVERY" "$public_issuer" "$relay" 2>/dev/null <<'PY'
import json
import sys

path, issuer, relay = sys.argv[1:4]
with open(path, "r", encoding="utf-8") as handle:
    document = json.load(handle)
problems = []
if document.get("issuer") != issuer:
    problems.append("issuer is " + str(document.get("issuer")))
if document.get("authorization_endpoint") != issuer + "/authorize":
    problems.append("authorization_endpoint is " + str(document.get("authorization_endpoint")))
for key, suffix in (
    ("token_endpoint", "/token"),
    ("jwks_uri", "/jwks"),
    ("userinfo_endpoint", "/userinfo"),
):
    if not str(document.get(key, "")).startswith(relay + suffix):
        problems.append(key + " is " + str(document.get(key)))
if problems:
    sys.stderr.write("gatus: " + "; ".join(problems) + "\n")
    sys.exit(1)
PY
    then
      echo "gatus: issuer relay ok ($public_issuer, back-channel $relay)" >&2
      break
    fi
  fi
  if ! kill -0 "$proxy_pid" 2>/dev/null; then
    proxy_pid=
    tail -20 "$RUN/proxy.log" >&2 || true
    fatal "the issuer relay front stopped"
  fi
  i=$((i + 1))
  [ "$i" -lt 45 ] || fatal "the discovery document through $relay does not match the public issuer $public_issuer"
  sleep 2
done
rm -f "$DISCOVERY"

# HTTPS_PROXY sends Gatus's one https request (the discovery document) to the
# front; SSL_CERT_FILE makes it trust the certificate made above. The relay
# endpoints in the document are plain http, so the token and JWKS calls go
# straight to the relay, and the self-checks on 127.0.0.1 are plain http too.
# NO_PROXY is deliberately not set: Go matches a "localhost" entry against any
# *.localhost host, so ato.localhost would bypass the front.
export HTTPS_PROXY="http://127.0.0.1:$PROXY_PORT"
export https_proxy=$HTTPS_PROXY
export SSL_CERT_FILE=$TLS_DIR/bundle.pem
export GATUS_CONFIG_PATH=$CONFIG
export GATUS_LOG_LEVEL=${GATUS_LOG_LEVEL:-INFO}
export HOME=/tmp

/usr/local/bin/gatus > "$RUN/app.log" 2>&1 &
app_pid=$!

i=0
while :; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/health" || true)
  [ "$code" = 200 ] && break
  if ! kill -0 "$app_pid" 2>/dev/null; then
    app_pid=
    tail -30 "$RUN/app.log" >&2 || true
    fatal "Gatus exited during start-up"
  fi
  i=$((i + 1))
  [ "$i" -le 120 ] || fatal "Gatus did not answer /health on $APP_PORT"
  sleep 1
done

# The OIDC block must be the active one, and an anonymous request must be
# unauthenticated: if Gatus had started without the provider (or the relay
# front had been silently skipped) the gate would report otherwise.
config_json=$(curl -fsS "http://127.0.0.1:$APP_PORT/api/v1/config" || true)
case $config_json in
  *'"oidc":true'*) ;;
  *) fatal "Gatus is not serving with OIDC enabled: $config_json" ;;
esac
case $config_json in
  *'"authenticated":false'*) ;;
  *) fatal "Gatus reports an anonymous request as authenticated: $config_json" ;;
esac

# A visitor with no Gatus session must be sent to the public authorize endpoint
# by /oidc/login. This is the check that the browser half of the flow uses the
# public issuer, not the relay.
location=$(curl -s -o /dev/null -w '%{redirect_url}' "http://127.0.0.1:$APP_PORT/oidc/login" || true)
case $location in
  "$public_issuer/authorize"*) ;;
  *) fatal "Gatus sent /oidc/login to '$location', not $public_issuer/authorize" ;;
esac

echo "gatus: serving on $app_url with Ato sign-in" >&2

set +e
wait -n
set -e

# A child that stops on its own is a failure: stop the other one and exit
# non-zero so the Runner restarts the Run instead of serving without the app or
# without the way to finish sign-in.
trap - INT TERM
if ! kill -0 "$app_pid" 2>/dev/null; then
  echo "gatus: the application stopped" >&2
else
  echo "gatus: the issuer relay front stopped" >&2
fi
[ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
[ -n "$proxy_pid" ] && kill "$proxy_pid" 2>/dev/null || true
wait 2>/dev/null || true
exit 1