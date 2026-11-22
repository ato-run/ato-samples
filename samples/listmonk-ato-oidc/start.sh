#!/bin/bash
# listmonk 6.2.0 for Ato, signed in with Ato's OpenID Provider, with PostgreSQL
# 15 in the same container and the same state.
#
# The code and the PostgreSQL binaries are image content (read-only); the
# Instance's one state directory /var/lib/listmonk holds PostgreSQL's data
# directory (pg/) and listmonk's uploaded media (uploads/). People sign in with
# their Ato account: listmonk is configured with the public OpenID Provider URL
# and reaches the Runner's plain-http relay for discovery, token, JWKS and
# userinfo through a loopback TLS front (oidc-relay-proxy.py), because
# coreos/go-oidc's discovery refuses a document whose issuer is not the URL it
# fetched. The browser half of the flow goes to the public https
# authorization_endpoint.
#
# listmonk reads its database and OIDC settings from the "settings" table in
# PostgreSQL, so this script applies them on every start: a rotated Binding or
# a new Instance origin takes effect without touching the datadir.
#
# This script needs bash. The capsule starts it as "/bin/sh /app/start.sh", so
# re-exec under bash when sh is the interpreter.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

STATE=/var/lib/listmonk
PG_DATA=$STATE/pg
UPLOADS=$STATE/uploads
RUN=/tmp/listmonk
TLS_DIR=$RUN/tls
CONFIG=$RUN/config.toml
DISCOVERY=$RUN/discovery.json
APP_PORT=9000
PG_PORT=5432
PROXY_PORT=18443
ADMIN_USER=admin

fatal() { echo "listmonk: $*" >&2; exit 1; }

: "${ATO_BINDING_OIDC_CLIENT_ID:?missing ATO_BINDING_OIDC_CLIENT_ID}"
: "${ATO_BINDING_OIDC_CLIENT_SECRET:?missing ATO_BINDING_OIDC_CLIENT_SECRET}"
: "${ATO_BINDING_OIDC_ISSUER:?missing ATO_BINDING_OIDC_ISSUER}"
: "${ATO_BINDING_DB_PASSWORD:?missing ATO_BINDING_DB_PASSWORD}"
: "${ATO_BINDING_ADMIN_PASSWORD:?missing ATO_BINDING_ADMIN_PASSWORD}"
: "${ATO_OIDC_PUBLIC_ISSUER:?missing ATO_OIDC_PUBLIC_ISSUER}"

client_id=$ATO_BINDING_OIDC_CLIENT_ID
client_secret=$ATO_BINDING_OIDC_CLIENT_SECRET
db_password=$ATO_BINDING_DB_PASSWORD
admin_password=$ATO_BINDING_ADMIN_PASSWORD

# listmonk's app.root_url must be the public origin people open: it is the base
# of the OIDC redirect URI (app.root_url + /auth/oidc) and of listmonk's own
# links. The Runner does not tell the workload its own host name, so the
# capsule passes it as LISTMONK_APP_URL; ATO_APP_ORIGIN is preferred when a
# Runner does provide it.
app_url=${ATO_APP_ORIGIN:-${LISTMONK_APP_URL:-}}
[ -n "$app_url" ] || fatal "LISTMONK_APP_URL (the Instance's public https origin) is required"
app_url=${app_url%/}
case $app_url in
  http://*|https://*) ;;
  *) fatal "LISTMONK_APP_URL must be an http:// or https:// URL" ;;
esac

# The relay is the Runner's plain-http way to the issuer (the public https URL
# is what browsers and the discovery document itself name).
relay=${ATO_BINDING_OIDC_ISSUER%/}
case $relay in
  http://*|https://*) ;;
  *) fatal "ATO_BINDING_OIDC_ISSUER must be an http:// or https:// URL" ;;
esac
public_issuer=${ATO_OIDC_PUBLIC_ISSUER%/}
case $public_issuer in
  https://*|http://*) ;;
  *) fatal "ATO_OIDC_PUBLIC_ISSUER must be an http:// or https:// URL" ;;
esac
issuer_host=${public_issuer#*://}
issuer_host=${issuer_host%%/*}

# A value with a newline or a quote would silently break the TOML config file;
# the generated bindings never contain one.
case $db_password in
  *'
'*) fatal "ATO_BINDING_DB_PASSWORD must not contain a newline" ;;
esac
case $db_password in
  *\\*|*\"*) fatal "ATO_BINDING_DB_PASSWORD must not contain a backslash or a double quote" ;;
esac

# The Runner runs this container read-only, so every write goes to the state or
# /tmp. PostgreSQL, its socket and the listmonk config live under /tmp.
mkdir -p "$PG_DATA" "$UPLOADS" "$RUN" "$TLS_DIR"
chmod 700 "$RUN"

# PostgreSQL's binaries are version-directory'd in the Debian package.
PG_BIN=
for candidate in /usr/lib/postgresql/*/bin; do
  if [ -x "$candidate/pg_ctl" ]; then
    PG_BIN=$candidate
    break
  fi
done
[ -n "$PG_BIN" ] || fatal "PostgreSQL binaries are missing from the image"
PATH=$PG_BIN:$PATH
export PATH

# The database server listens on loopback only and takes its datadir from the
# state. It is initialised on the first start; a rotated db_password is applied
# on every start. The WAL segment size is the distro default except for the
# first start, where initdb is told to use 1 MiB so the checkpoint of the state
# stays small.
pg_start() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$RUN/postgres.log" -w -t 90 \
    -o "-c listen_addresses=127.0.0.1 -c port=$PG_PORT -c unix_socket_directories=/tmp -c wal_level=minimal -c max_wal_senders=0 -c max_connections=20 -c shared_buffers=32MB -c autovacuum=off" \
    start >/dev/null 2>&1
}
pg_stop() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast -w -t 60 stop >/dev/null 2>&1 || true
}
sql_local() {
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h /tmp -p "$PG_PORT" -U listmonk -d postgres "$@"
}

if [ ! -s "$PG_DATA/PG_VERSION" ]; then
  echo "listmonk: initialising PostgreSQL in $PG_DATA" >&2
  umask 077
  printf '%s\n' "$db_password" > "$RUN/pg.pass"
  "$PG_BIN/initdb" -D "$PG_DATA" -U listmonk --pwfile="$RUN/pg.pass" \
    --auth-local=trust --auth-host=scram-sha-256 \
    --encoding=UTF8 --no-locale --wal-segsize=1 > "$RUN/initdb.log" 2>&1 \
    || { tail -20 "$RUN/initdb.log" >&2 || true; fatal "initdb failed: see $RUN/initdb.log"; }
  umask 022
  rm -f "$RUN/pg.pass"
fi

pg_stop
pg_start || fatal "PostgreSQL did not start: see $RUN/postgres.log"

i=0
until "$PG_BIN/pg_isready" -h /tmp -p "$PG_PORT" -U listmonk -q; do
  [ -s "$RUN/postgres.log" ] && tail -5 "$RUN/postgres.log" >&2
  fatal "PostgreSQL did not become reachable"
done

# The role and database are created once; the password is re-applied on every
# start so a rotated Binding is picked up without touching the datadir.
# psql does not interpolate :'variables' in a -c argument, so the password is
# quoted into the statement here (standard_conforming_strings: double the quote).
sql_literal() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }
sql_local -q -c "ALTER USER listmonk PASSWORD $(sql_literal "$db_password")"
if [ -z "$(sql_local -tAc "SELECT 1 FROM pg_database WHERE datname='listmonk'")" ]; then
  "$PG_BIN/createdb" -h /tmp -p "$PG_PORT" -U listmonk listmonk || fatal "cannot create the listmonk database"
fi

# listmonk reads its configuration from a file plus the settings table; the
# file carries the database and the listen address (which the settings table
# does not override), start.sh writes the rest below.
toml_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
umask 077
cat > "$CONFIG" <<EOF
[app]
address = "0.0.0.0:$APP_PORT"
root_url = "$(toml_escape "$app_url")"
check_updates = false

[db]
host = "127.0.0.1"
port = $PG_PORT
user = "listmonk"
password = "$(toml_escape "$db_password")"
database = "listmonk"
ssl_mode = "disable"
max_open = 10
max_idle = 10
max_lifetime = "300s"
EOF
umask 022

# --install --idempotent makes the schema and the sample content the first time
# and skips everything after that; --upgrade applies migrations on every start.
LISTMONK_ADMIN_USER=$ADMIN_USER LISTMONK_ADMIN_PASSWORD=$admin_password \
  /usr/local/bin/listmonk --install --idempotent --yes --config "$CONFIG" \
  > "$RUN/install.log" 2>&1 || {
    tail -30 "$RUN/install.log" >&2
    fatal "listmonk --install failed"
  }
/usr/local/bin/listmonk --upgrade --yes --config "$CONFIG" > "$RUN/upgrade.log" 2>&1 || {
  tail -30 "$RUN/upgrade.log" >&2
  fatal "listmonk --upgrade failed"
}

# The settings table is listmonk's own store: the OIDC configuration is the
# JSON object of the "security.oidc" row, the public origin is "app.root_url",
# and the media path is "upload.filesystem.upload_path". The keys already exist
# (schema.sql seeds every setting), so they are only updated.
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
perm_super_admin="ARRAY['lists:get_all','lists:manage_all','subscribers:get','subscribers:get_all','subscribers:manage','subscribers:import','subscribers:sql_query','tx:send','campaigns:get','campaigns:get_all','campaigns:get_analytics','campaigns:manage','campaigns:manage_all','campaigns:send','bounces:get','bounces:manage','webhooks:post_bounce','media:get','media:manage','templates:get','templates:manage','users:get','users:manage','roles:get','roles:manage','settings:get','settings:manage','settings:maintain']"
perm_ato_user="ARRAY['lists:get_all','subscribers:get','subscribers:get_all','subscribers:manage']"

"$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -v pw="$admin_password" \
  -h /tmp -p "$PG_PORT" -U listmonk -d listmonk <<SQL || fatal "cannot prepare listmonk's roles and administrator"
-- The Super Admin role and the administrator are made by --install when
-- LISTMONK_ADMIN_USER is set; this keeps a restored or pruned database working.
INSERT INTO roles (name, type, permissions)
SELECT 'Super Admin', 'user', $perm_super_admin
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE type = 'user' AND parent_id IS NULL AND name = 'Super Admin'
);
INSERT INTO users (username, password_login, password, email, name, type, user_role_id, status)
SELECT '$ADMIN_USER', TRUE, CRYPT(:'pw', GEN_SALT('bf')), '$ADMIN_USER@listmonk.local', '$ADMIN_USER', 'user',
       (SELECT id FROM roles WHERE type = 'user' AND parent_id IS NULL AND name = 'Super Admin' ORDER BY id LIMIT 1),
       'enabled'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = '$ADMIN_USER');
-- Re-apply the binding every start (a rotated password takes effect here).
UPDATE users SET password = CRYPT(:'pw', GEN_SALT('bf')), password_login = TRUE, status = 'enabled', updated_at = NOW()
WHERE username = '$ADMIN_USER' AND type = 'user';

-- Accounts created at OIDC sign-in get this role: lists and subscribers, no
-- administration. It is not the Super Admin role and never becomes one.
INSERT INTO roles (name, type, permissions)
SELECT 'Ato user', 'user', $perm_ato_user
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE type = 'user' AND parent_id IS NULL AND name = 'Ato user'
);
UPDATE roles SET permissions = $perm_ato_user, updated_at = NOW()
WHERE type = 'user' AND parent_id IS NULL AND name = 'Ato user';
SQL

role_id=$("$PG_BIN/psql" -X -tA -h /tmp -p "$PG_PORT" -U listmonk -d listmonk \
  -c "SELECT id FROM roles WHERE type = 'user' AND parent_id IS NULL AND name = 'Ato user' ORDER BY id LIMIT 1")
case $role_id in
  ''|*[!0-9]*) fatal "cannot resolve the Ato user role id (got '$role_id')" ;;
esac

# listmonk's settings, written the way its Settings API stores them: one JSONB
# value per key. OIDC is switched on with the Instance's client and the public
# issuer; AutoCreateUsers makes the first sign-in create the person's account
# with the Ato user role. There is no default list role: the user role already
# grants the list and subscriber permissions this sample needs.
oidc_json=$(printf '{"enabled":true,"provider_url":"%s","provider_name":"Ato","client_id":"%s","client_secret":"%s","auto_create_users":true,"default_user_role_id":%s,"default_list_role_id":null}' \
  "$(json_escape "$public_issuer")" "$(json_escape "$client_id")" "$(json_escape "$client_secret")" "$role_id")

"$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -v oidc="$oidc_json" -v root="$app_url" -v uploads="$UPLOADS" \
  -h /tmp -p "$PG_PORT" -U listmonk -d listmonk <<'SQL' || fatal "cannot write listmonk's settings"
UPDATE settings SET value = :'oidc'::jsonb, updated_at = NOW() WHERE key = 'security.oidc';
UPDATE settings SET value = to_jsonb(:'root'::text), updated_at = NOW() WHERE key = 'app.root_url';
UPDATE settings SET value = 'false'::jsonb, updated_at = NOW() WHERE key = 'app.check_updates';
UPDATE settings SET value = to_jsonb(:'uploads'::text), updated_at = NOW() WHERE key = 'upload.filesystem.upload_path';
SQL

# The public issuer is not reachable from inside the container (it is the
# installation's https origin). A local CA and a certificate for its host let
# the proxy below present that URL on loopback; listmonk trusts the CA through
# SSL_CERT_FILE and reaches the proxy through HTTPS_PROXY. Nothing is written
# outside /tmp.
umask 077
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=ato-listmonk-oidc-ca \
  -keyout "$TLS_DIR/ca-key.pem" -out "$TLS_DIR/ca.pem" >/dev/null 2>&1 \
  || fatal "cannot create the local CA for the issuer relay"
case $issuer_host in
  *[0-9].[0-9]*.[0-9]*.[0-9]*) san="IP:$issuer_host" ;;
  *) san="DNS:$issuer_host" ;;
esac
openssl req -newkey rsa:2048 -nodes -subj "/CN=$issuer_host" \
  -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/request.csr" >/dev/null 2>&1 \
  || fatal "cannot create the proxy certificate request"
printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$san" > "$TLS_DIR/ext.cnf"
openssl x509 -req -in "$TLS_DIR/request.csr" -CA "$TLS_DIR/ca.pem" -CAkey "$TLS_DIR/ca-key.pem" \
  -CAcreateserial -days 3650 -extfile "$TLS_DIR/ext.cnf" -out "$TLS_DIR/cert.pem" >/dev/null 2>&1 \
  || fatal "cannot sign the proxy certificate"
cat /etc/ssl/certs/ca-certificates.crt "$TLS_DIR/ca.pem" > "$TLS_DIR/bundle.pem" 2>/dev/null \
  || cp "$TLS_DIR/ca.pem" "$TLS_DIR/bundle.pem"
umask 022

proxy_pid=
app_pid=
stop() {
  trap - INT TERM
  echo "listmonk: stopping" >&2
  [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
  [ -n "$proxy_pid" ] && kill "$proxy_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  pg_stop
  exit 143
}
trap stop INT TERM

PROXY_LISTEN_PORT=$PROXY_PORT PROXY_PUBLIC_ISSUER=$public_issuer PROXY_RELAY=$relay \
  PROXY_CERT=$TLS_DIR/cert.pem PROXY_KEY=$TLS_DIR/key.pem \
  python3 /usr/local/lib/ato-listmonk/oidc-relay-proxy.py > "$RUN/proxy.log" 2>&1 &
proxy_pid=$!

# The Runner starts the relay as part of the same launch and the container can be
# running for a moment before it answers; retry the discovery check for a while
# instead of exiting on the first connection failure. The check also proves that
# the proxy presents the public issuer the capsule was rendered for.
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
    sys.stderr.write("listmonk: " + "; ".join(problems) + "\n")
    sys.exit(1)
PY
    then
      echo "listmonk: issuer relay ok ($public_issuer, back-channel $relay)" >&2
      break
    fi
  fi
  if ! kill -0 "$proxy_pid" 2>/dev/null; then
    proxy_pid=
    tail -20 "$RUN/proxy.log" >&2 || true
    fatal "the issuer relay proxy stopped"
  fi
  i=$((i + 1))
  [ "$i" -lt 45 ] || fatal "the discovery document through $relay does not match the public issuer $public_issuer"
  sleep 2
done

# HTTPS_PROXY sends listmonk's one https request (the discovery document) to
# the proxy; SSL_CERT_FILE makes it trust the certificate made above. The relay
# endpoints in the document are plain http, so the token, JWKS and userinfo
# calls go straight to the relay.
HTTPS_PROXY="http://127.0.0.1:$PROXY_PORT" SSL_CERT_FILE="$TLS_DIR/bundle.pem" \
  /usr/local/bin/listmonk --config "$CONFIG" > "$RUN/app.log" 2>&1 &
app_pid=$!

i=0
while :; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/health" || true)
  [ "$code" = 200 ] && break
  if ! kill -0 "$app_pid" 2>/dev/null; then
    app_pid=
    tail -30 "$RUN/app.log" >&2 || true
    fatal "listmonk exited during start-up"
  fi
  i=$((i + 1))
  [ "$i" -le 120 ] || fatal "listmonk did not answer /health on $APP_PORT"
  sleep 1
done

# The login page must carry the OIDC form: that is the check that the settings
# above were read and that a person can start the Ato sign-in. listmonk 6.2.0
# has no way to skip its own login page, so the form is one click (README.md).
login_page=$(curl -s "http://127.0.0.1:$APP_PORT/admin/login" || true)
case $login_page in
  *'action="/auth/oidc"'*) ;;
  *) fatal "listmonk's login page has no Ato sign-in form" ;;
esac

echo "listmonk: serving on $app_url with Ato sign-in" >&2

set +e
wait -n
set -e

# A child that stops on its own is a failure: stop the rest, let PostgreSQL
# finish a clean shutdown and exit non-zero so the Runner restarts the Run
# instead of serving a half-working Instance.
trap - INT TERM
if ! kill -0 "$app_pid" 2>/dev/null; then
  echo "listmonk: the application stopped" >&2
elif ! kill -0 "$proxy_pid" 2>/dev/null; then
  echo "listmonk: the issuer relay proxy stopped" >&2
else
  echo "listmonk: PostgreSQL stopped" >&2
fi
[ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
[ -n "$proxy_pid" ] && kill "$proxy_pid" 2>/dev/null || true
wait 2>/dev/null || true
pg_stop
exit 1