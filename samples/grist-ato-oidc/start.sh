#!/bin/bash
# Grist 1.7.22 (the open-source build) for Ato, signed in with Ato's OpenID
# Provider.
#
# The code is image content (read-only); the Instance's one state directory
# /persist holds Grist's home database (SQLite) and its documents. People are
# signed in with their Ato account: Grist is configured with the Runner's
# issuer relay as the issuer it discovers (GRIST_OIDC_IDP_ISSUER), so the token,
# JWKS and userinfo calls go over the relay, while the authorization endpoint in
# the discovery document stays the public https one the browser opens.
#
# This script needs bash. The capsule starts it as "/bin/sh /app/start.sh", so
# re-exec under bash when sh is the interpreter.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

APP_DIR=/grist
STATE=/persist
DOCS=$STATE/docs
PORT=8484

fatal() { echo "grist: $*" >&2; exit 1; }

: "${ATO_BINDING_OIDC_CLIENT_ID:?missing ATO_BINDING_OIDC_CLIENT_ID}"
: "${ATO_BINDING_OIDC_CLIENT_SECRET:?missing ATO_BINDING_OIDC_CLIENT_SECRET}"
: "${ATO_BINDING_SESSION_SECRET:?missing ATO_BINDING_SESSION_SECRET}"
: "${ATO_BINDING_OIDC_ISSUER:?missing ATO_BINDING_OIDC_ISSUER}"
: "${ATO_OIDC_PUBLIC_ISSUER:?missing ATO_OIDC_PUBLIC_ISSUER}"

# Grist's home URL must be the public origin people open: it is the base of the
# OIDC redirect URI (GRIST_OIDC_SP_HOST) and of Grist's own links. The Runner
# does not tell the workload its own host name, so the capsule passes it as
# GRIST_APP_URL; ATO_APP_ORIGIN is preferred when a Runner does provide it.
app_url=${ATO_APP_ORIGIN:-${GRIST_APP_URL:-}}
[ -n "$app_url" ] || fatal "GRIST_APP_URL (the Instance's public https origin) is required"
app_url=${app_url%/}
case $app_url in
  http://*|https://*) ;;
  *) fatal "GRIST_APP_URL must be an http:// or https:// URL" ;;
esac

# The relay is plain http on the container's gateway. Grist uses it as the
# issuer for discovery and for the token, JWKS and userinfo calls; the discovery
# document's "issuer" and "authorization_endpoint" stay the public https ones.
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

# Grist signs its session cookie with this. A rotated binding signs everyone out;
# the value stays in the state's home database only through the cookies, not here.
[ "${#ATO_BINDING_SESSION_SECRET}" -ge 32 ] \
  || fatal "ATO_BINDING_SESSION_SECRET must be at least 32 characters"

mkdir -p "$DOCS" || fatal "cannot create $DOCS"

# The provider is only usable if the relay's discovery document names the public
# issuer this capsule was rendered for and rewrites the back-channel endpoints
# onto the relay. Checked once on every start, before Grist starts: a mismatched
# issuer would otherwise surface only as a failed sign-in much later.
discovery=$(mktemp) || fatal "cannot create a temporary file"
cleanup_discovery() { rm -f "$discovery"; }
trap cleanup_discovery EXIT INT TERM

# The Runner starts the relay as part of the same launch and the container can
# be running for a moment before the relay's bridge address answers; retry the
# check for a while instead of exiting on the first connection failure.
i=0
while :; do
  if curl -fsS --max-time 10 "$relay/.well-known/openid-configuration" -o "$discovery" 2>/dev/null; then
    if node - "$discovery" "$public_issuer" "$relay" 2>/dev/null <<'NODE'
const fs = require("fs");
const [file, issuer, relay] = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const problems = [];
if (doc.issuer !== issuer) problems.push("issuer is " + doc.issuer);
if (doc.authorization_endpoint !== issuer + "/authorize")
  problems.push("authorization_endpoint is " + doc.authorization_endpoint);
for (const [key, suffix] of [["token_endpoint", "/token"], ["jwks_uri", "/jwks"], ["userinfo_endpoint", "/userinfo"]]) {
  if (!String(doc[key] || "").startsWith(relay + suffix))
    problems.push(key + " is " + doc[key]);
}
if (problems.length) {
  console.error("grist: " + problems.join("; "));
  process.exit(1);
}
NODE
    then
      echo "grist: issuer relay ok ($public_issuer, back-channel $relay)" >&2
      break
    fi
  fi
  i=$((i + 1))
  [ "$i" -lt 45 ] || fatal "the discovery document through $relay does not match the public issuer $public_issuer"
  sleep 2
done

rm -f "$discovery"
trap - EXIT INT TERM

# Grist's settings. GRIST_OIDC_IDP_ISSUER turns the OIDC login system on (Grist
# then reads the discovery document from it); GRIST_FORCE_LOGIN makes every
# anonymous page start the sign-in redirect instead of showing a Grist login
# form; the provider has no end_session_endpoint, so the id_token logout call is
# skipped and a plain sign-out leaves the person signed in to Ato.
export APP_HOME_URL="$app_url"
export GRIST_OIDC_SP_HOST="$app_url"
export GRIST_OIDC_IDP_ISSUER="$relay"
export GRIST_OIDC_IDP_CLIENT_ID="$ATO_BINDING_OIDC_CLIENT_ID"
export GRIST_OIDC_IDP_CLIENT_SECRET="$ATO_BINDING_OIDC_CLIENT_SECRET"
export GRIST_OIDC_IDP_SCOPES="openid profile email"
export GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT=true
export GRIST_FORCE_LOGIN=true
export GRIST_SESSION_SECRET="$ATO_BINDING_SESSION_SECRET"
export GRIST_HOST=0.0.0.0
export PORT
export GRIST_ORG_IN_PATH=true
export GRIST_SERVE_SAME_ORIGIN=true
export GRIST_PERSONAL_ORGS=true
export GRIST_ORG_CREATION_ANYONE=true
export GRIST_DATA_DIR="$DOCS"
export GRIST_INST_DIR="$STATE"
export TYPEORM_DATABASE="$STATE/home.sqlite3"
# Grist's first-run "in service" gate would otherwise send every page to /boot
# with the boot key; this Instance is configured by this script, not by hand.
export GRIST_IN_SERVICE=true
export GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING=false
# The Runner writes only to the state and /tmp. A writable HOME keeps tools that
# look for one from trying the read-only image; the formula sandbox is the
# unsandboxed Python in the image (grist-core's default), run as this user.
export HOME=/tmp
export PYTHONDONTWRITEBYTECODE=1

cd "$APP_DIR" || fatal "missing $APP_DIR"

node_pid=
stop() {
  trap - INT TERM
  echo "grist: stopping" >&2
  if [ -n "$node_pid" ]; then
    kill "$node_pid" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit 143
}
trap stop INT TERM

# The image's bead is the Node server; it serves the home API and the documents
# in one process because GRIST_SERVE_SAME_ORIGIN is set. The image's ENTRYPOINT
# (a root-only permission fixup) and its gvisor check are not used: the Runner
# already starts the container read-only as a non-root user.
env NODE_PATH=_build:_build/ext:_build/stubs:ext/node_modules \
  node _build/stubs/app/server/server.js &
node_pid=$!

i=0
while :; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/status" || true)
  [ "$code" = 200 ] && break
  if ! kill -0 "$node_pid" 2>/dev/null; then
    node_pid=
    fatal "Grist exited during start-up"
  fi
  i=$((i + 1))
  [ "$i" -le 120 ] || fatal "Grist did not answer /status on $PORT"
  sleep 1
done

# A visitor with no Grist session must be sent to the public authorize endpoint.
# This is the check that the OIDC login system is the active one and that the
# browser half of the flow uses the public issuer, not the relay.
location=$(curl -s -o /dev/null -w '%{redirect_url}' "http://127.0.0.1:$PORT/" || true)
case $location in
  "$public_issuer/authorize"*) ;;
  *) fatal "Grist sent an anonymous visitor to '$location', not $public_issuer/authorize" ;;
esac

echo "grist: serving on $app_url" >&2

set +e
wait "$node_pid"
status=$?
set -e
node_pid=
echo "grist: the server stopped (exit $status)" >&2
[ "$status" -ne 0 ] || status=1
exit "$status"
