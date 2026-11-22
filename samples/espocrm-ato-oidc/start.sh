#!/bin/bash
# EspoCRM and its database for Ato, in one container and one state.
#
# The code is image content (read-only). The Instance's one state directory
# /var/lib/espocrm holds EspoCRM's data/, custom/ and client/custom/ and the
# MariaDB datadir (db/). People sign in with their Ato account through the
# ato.oidc-issuer@1 Binding; OIDC-created accounts get a default role and team
# so they can work without an administrator, and the administrator uses the
# account the installation creates (see README.md for that path).
#
# EspoCRM is installed non-interactively on the first start with its own
# console installer, then its data/config.php is re-applied on every start so a
# rotated db_password, a changed public origin or rotated OIDC client settings
# take effect without touching the datadir. The database listens on 127.0.0.1
# only (inside the container) on a unix socket for the service's own use; the
# datadir is in the state, so no step needs root.
#
# This script needs bash for the wait -n supervisor at the end. The capsule
# starts it as "/bin/sh /app/start.sh", so re-exec under bash when sh is the
# interpreter.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

STATE=/var/lib/espocrm
DATA=$STATE/data
DB=$STATE/db
APACHE_BASE=/tmp/apache2
SOCKET=/tmp/mysqld.sock
MYSQL_CNF=/tmp/espocrm-my.cnf
ATO_PHP_INI_DIR=/tmp/espocrm-php.d
INSTALL_MARKER=$STATE/installed
ROLE_FILE=$STATE/default-role-id
TEAM_FILE=$STATE/default-team-id
ROLE_TEAM_LINK=$STATE/default-role-team
ADMIN_USER=admin
CURL_CONFIG=/tmp/espocrm-curl.cfg
API_URL=http://127.0.0.1:8080/api/v1

fatal() { echo "espocrm: $*" >&2; exit 1; }

APP_DIR=$(cat /etc/espocrm-root 2>/dev/null || true)
[ -n "$APP_DIR" ] && [ -d "$APP_DIR" ] || fatal "missing /etc/espocrm-root or the install root it names"

: "${ATO_BINDING_DB_PASSWORD:?missing ATO_BINDING_DB_PASSWORD}"
: "${ATO_BINDING_ADMIN_PASSWORD:?missing ATO_BINDING_ADMIN_PASSWORD}"
: "${ATO_BINDING_OIDC_CLIENT_ID:?missing ATO_BINDING_OIDC_CLIENT_ID}"
: "${ATO_BINDING_OIDC_CLIENT_SECRET:?missing ATO_BINDING_OIDC_CLIENT_SECRET}"
: "${ATO_BINDING_OIDC_ISSUER:?missing ATO_BINDING_OIDC_ISSUER}"
: "${ATO_OIDC_PUBLIC_ISSUER:?missing ATO_OIDC_PUBLIC_ISSUER}"

# siteUrl must be the public origin people open, because EspoCRM builds the
# OIDC redirect_uri and absolute links from it. The Runner does not tell the
# workload its own host name, so the capsule passes it as ESPOCRM_APP_URL;
# ATO_APP_ORIGIN is preferred when a Runner does provide it.
app_url=${ATO_APP_ORIGIN:-${ESPOCRM_APP_URL:-}}
[ -n "$app_url" ] || fatal "ESPOCRM_APP_URL (the Instance's public https origin) is required"
app_url=${app_url%/}

# EspoCRM reaches the provider's token, userinfo and JWKS endpoints from the
# server side, through the Runner's issuer relay. The relay is a plain-http URL
# on the container gateway; EspoCRM's OIDC client accepts it as-is, so the
# localhost TLS forwarder is off by default. If a release refuses a non-https
# back-channel, set ESPO_OIDC_RELAY_TLS=1 in capsule.toml.in: socat then
# terminates TLS on https://localhost:8443, PHP trusts that one certificate,
# and the relay is still the only way out.
relay=${ATO_BINDING_OIDC_ISSUER%/}
tls_dir=/tmp/espocrm-oidc-tls
tls_port=8443
relay_tls=0
case "$relay" in
  https://*)
    backchannel_issuer=$relay
    ;;
  http://*)
    if [ "${ESPO_OIDC_RELAY_TLS:-0}" = "1" ]; then
      relay_rest=${relay#http://}
      relay_hostport=${relay_rest%%/*}
      relay_path=
      [ "$relay_rest" = "$relay_hostport" ] || relay_path=/${relay_rest#*/}
      backchannel_issuer=https://localhost:$tls_port$relay_path
      relay_tls=1
    else
      backchannel_issuer=$relay
    fi
    ;;
  *)
    fatal "ATO_BINDING_OIDC_ISSUER must be an http:// or https:// URL"
    ;;
esac

# State layout, the Apache runtime directories (/tmp is the only writable place
# outside the declared state), PHP's session and upload directories and the
# database datadir. The image starts with these paths present, but an empty
# state mount hides them, so they are made again here.
mkdir -p "$DATA"          "$STATE/custom"          "$STATE/client-custom"          "$DB"          "$APACHE_BASE/run" "$APACHE_BASE/lock" "$APACHE_BASE/log"          /tmp/php-sessions /tmp/php-upload /tmp/mariadb-tmp "$ATO_PHP_INI_DIR"

# data/ is directly under the web root, so Apache must never serve it. The
# image ships the same file; an empty state mount hides it, hence this.
printf 'Require all denied\n' > "$DATA/.htaccess"

# PHP writes sessions under /tmp and, when the TLS forwarder is on, trusts the
# local certificate as well as the public CAs.
export PHP_INI_SCAN_DIR="${PHP_INI_DIR:-/usr/local/etc/php}/conf.d:$ATO_PHP_INI_DIR"

db_pid=
web_pid=
tls_pid=
stop() {
  trap - INT TERM
  echo "espocrm: stopping" >&2
  for pid in $db_pid $web_pid $tls_pid; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 143
}
trap stop INT TERM

if [ "$relay_tls" = "1" ]; then
  mkdir -p "$tls_dir"
  ( umask 077
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=localhost \
      -addext subjectAltName=DNS:localhost \
      -keyout "$tls_dir/key.pem" -out "$tls_dir/cert.pem" 2>/dev/null ) \
    || fatal "cannot create the local TLS certificate for the OIDC relay"
  # Keep the public CAs next to the local certificate, so other https calls
  # EspoCRM makes are verified as before.
  cat /etc/ssl/certs/ca-certificates.crt "$tls_dir/cert.pem" > "$tls_dir/ca.pem" 2>/dev/null \
    || cp "$tls_dir/cert.pem" "$tls_dir/ca.pem"
  printf 'curl.cainfo=%s\nopenssl.cafile=%s\n' "$tls_dir/ca.pem" "$tls_dir/ca.pem" \
    > "$ATO_PHP_INI_DIR/ato-oidc-relay.ini"
  socat "OPENSSL-LISTEN:$tls_port,bind=127.0.0.1,reuseaddr,fork,cert=$tls_dir/cert.pem,key=$tls_dir/key.pem,verify=0" \
    "TCP:$relay_hostport" &
  tls_pid=$!
fi

# The datadir belongs to the container user and is created on first start, so
# no step needs root. A small datadir keeps the state checkpoint (64 MiB)
# plausible: no binlog, no performance schema, a 12 MiB system tablespace and
# an 8 MiB redo log. EspoCRM talks to the server over TCP on loopback only;
# the socket is for this script and mariadb-admin.
cat > "$MYSQL_CNF" <<'EOF'
[mysqld]
datadir=/var/lib/espocrm/db
socket=/tmp/mysqld.sock
pid-file=/tmp/mysqld.pid
tmpdir=/tmp/mariadb-tmp
bind-address=127.0.0.1
port=3306
skip-name-resolve
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
innodb_data_file_path=ibdata1:12M:autoextend
innodb_log_file_size=8M
innodb_buffer_pool_size=128M
performance_schema=OFF
skip-log-bin
EOF

if [ ! -d "$DB/mysql" ]; then
  echo "espocrm: initialising the database in $DB" >&2
  mariadb-install-db --defaults-file="$MYSQL_CNF" --datadir="$DB" \
    --auth-root-authentication-method=normal --skip-test-db
fi

mariadbd --defaults-file="$MYSQL_CNF" &
db_pid=$!

i=0
until mariadb-admin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null 2>&1; do
  if ! kill -0 "$db_pid" 2>/dev/null; then
    db_pid=
    fatal "MariaDB exited during start-up"
  fi
  i=$((i + 1))
  [ "$i" -le 90 ] || fatal "MariaDB did not become reachable on $SOCKET"
  sleep 1
done

# The database and user are created once, and the password is re-applied on
# every start so a rotated binding is picked up without touching the datadir.
# SQL string literals escape backslash and the single quote. The password never
# appears on a command line.
db_password=$(printf '%s' "$ATO_BINDING_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")
mariadb --no-defaults --socket="$SOCKET" -uroot <<SQL || fatal "cannot prepare the espocrm database"
CREATE DATABASE IF NOT EXISTS espocrm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'espocrm'@'127.0.0.1' IDENTIFIED BY '${db_password}';
CREATE USER IF NOT EXISTS 'espocrm'@'localhost' IDENTIFIED BY '${db_password}';
ALTER USER 'espocrm'@'127.0.0.1' IDENTIFIED BY '${db_password}';
ALTER USER 'espocrm'@'localhost' IDENTIFIED BY '${db_password}';
GRANT ALL PRIVILEGES ON espocrm.* TO 'espocrm'@'127.0.0.1';
GRANT ALL PRIVILEGES ON espocrm.* TO 'espocrm'@'localhost';
FLUSH PRIVILEGES;
SQL

# EspoCRM's console installer: creates data/config.php, the database schema and
# the administrator account, with no browser and no interactive prompt. The
# two passwords are on the command line only for the lifetime of the installer
# process; nothing is written outside the state.
if [ ! -f "$INSTALL_MARKER" ]; then
  echo "espocrm: installing EspoCRM in $APP_DIR" >&2
  ( cd "$APP_DIR" && php command.php install \
      --db-host=127.0.0.1 \
      --db-port=3306 \
      --db-name=espocrm \
      --db-user=espocrm \
      --db-password="$ATO_BINDING_DB_PASSWORD" \
      --admin-username="$ADMIN_USER" \
      --admin-password="$ATO_BINDING_ADMIN_PASSWORD" \
      --site-url="$app_url" \
      --language=en_US \
      --timezone=UTC ) || fatal "EspoCRM installation failed"
  : > "$INSTALL_MARKER"
fi

# Rewrite data/config.php with the current credentials and public origin. This
# runs before Apache starts, so the first request already sees the new values.
patch_config() {
  local mode=$1 role_id='' team_id=''
  if [ -s "$ROLE_FILE" ]; then role_id=$(cat "$ROLE_FILE"); fi
  if [ -s "$TEAM_FILE" ]; then team_id=$(cat "$TEAM_FILE"); fi
  ESPO_CONFIG_FILE="$DATA/config.php" \
  ESPO_CONFIG_MODE="$mode" \
  ESPOCRM_APP_URL="$app_url" \
  ATO_BINDING_DB_PASSWORD="$ATO_BINDING_DB_PASSWORD" \
  ATO_OIDC_PUBLIC_ISSUER="$ATO_OIDC_PUBLIC_ISSUER" \
  ESPO_OIDC_BACKCHANNEL_ISSUER="$backchannel_issuer" \
  ATO_BINDING_OIDC_CLIENT_ID="$ATO_BINDING_OIDC_CLIENT_ID" \
  ATO_BINDING_OIDC_CLIENT_SECRET="$ATO_BINDING_OIDC_CLIENT_SECRET" \
  ESPO_DEFAULT_ROLE_ID="$role_id" \
  ESPO_DEFAULT_TEAM_ID="$team_id" \
  php /usr/local/lib/ato-espocrm-config.php || fatal "cannot update $DATA/config.php"
}

patch_config base

# The administrator calls EspoCRM's REST API with a curl config file, so the
# admin password is not on the command line. OIDC sign-in maps an Ato account
# to an EspoCRM user name; the accounts it creates get the default role and
# team made here, never an administrator flag.
write_curl_config() {
  ( umask 077
    printf 'user = "%s:%s"\n' "$ADMIN_USER" "$(printf '%s' "$ATO_BINDING_ADMIN_PASSWORD" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')" \
      > "$CURL_CONFIG" )
}
api() {
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -fsS --config "$CURL_CONFIG" -X "$method" \
      -H 'Content-Type: application/json' --data-binary "@$body" "$API_URL$path"
  else
    curl -fsS --config "$CURL_CONFIG" -X "$method" "$API_URL$path"
  fi
}
json_field() {
  php -r '$document = json_decode(stream_get_contents(STDIN), true); if (!is_array($document) || !isset($document[$argv[1]])) { exit(1); } echo $document[$argv[1]];' "$1"
}

web_pid=
start_web() {
  if [ -n "$web_pid" ]; then
    return 0
  fi
  apache2-foreground &
  web_pid=$!
  local i=0
  until curl -fsS -o /dev/null "http://127.0.0.1:8080/status"; do
    if ! kill -0 "$web_pid" 2>/dev/null; then
      web_pid=
      fatal "Apache exited during start-up"
    fi
    i=$((i + 1))
    [ "$i" -le 60 ] || fatal "Apache did not answer /status on 8080"
    sleep 1
  done
}

# The default role/team are made through the admin API on the first start,
# while the authentication method is still the installer's standard one. The
# role allows creating Accounts and Contacts and reading and editing the ones
# the user owns; nothing else. The ids are kept in the state and the OIDC
# settings point at them, so the same objects are reused after a restart.
ensure_role_team() {
  if [ -f "$ROLE_TEAM_LINK" ]; then
    return 0
  fi
  start_web
  write_curl_config
  if [ ! -s "$ROLE_FILE" ]; then
    cat > /tmp/ato-default-role.json <<'JSON'
{
  "name": "Ato User",
  "data": {
    "Account": {"create": "yes", "read": "own", "edit": "own", "delete": "no", "stream": true},
    "Contact": {"create": "yes", "read": "own", "edit": "own", "delete": "no", "stream": true}
  },
  "assignmentPermission": "team",
  "userPermission": "team",
  "exportPermission": "team",
  "massUpdatePermission": "team"
}
JSON
    role_id=$(api POST /Role /tmp/ato-default-role.json | json_field id) \
      || fatal "cannot create the default role through the EspoCRM API"
    printf '%s\n' "$role_id" > "$ROLE_FILE"
  fi
  if [ ! -s "$TEAM_FILE" ]; then
    printf '{"name":"Ato"}\n' > /tmp/ato-default-team.json
    team_id=$(api POST /Team /tmp/ato-default-team.json | json_field id) \
      || fatal "cannot create the default team through the EspoCRM API"
    printf '%s\n' "$team_id" > "$TEAM_FILE"
  fi
  role_id=$(cat "$ROLE_FILE")
  team_id=$(cat "$TEAM_FILE")
  printf '{"id":"%s"}\n' "$team_id" > /tmp/ato-default-role-team.json
  api POST "/Role/$role_id/teams" /tmp/ato-default-role-team.json >/dev/null \
    || fatal "cannot assign the default role to the default team through the EspoCRM API"
  : > "$ROLE_TEAM_LINK"
}

ensure_role_team

# Now the OIDC settings, including the default role/team the new accounts get.
patch_config oidc

# EspoCRM caches its merged configuration. The cache is rebuilt from the state
# on the next request; only data/cache is touched, never uploads or config.
if [ -d "$DATA/cache" ]; then
  rm -rf "$DATA"/cache/*
fi

# Apache runs in the background so the container can watch every process: if
# one stops, stop the others and exit non-zero, and the Runner restarts the Run
# instead of serving without a database, an app or a way to finish sign-in.
start_web

echo "espocrm: serving on $app_url" >&2

set +e
wait -n
status=$?
set -e

if ! kill -0 "$db_pid" 2>/dev/null; then
  echo "espocrm: MariaDB stopped" >&2
elif ! kill -0 "$web_pid" 2>/dev/null; then
  echo "espocrm: Apache stopped" >&2
else
  echo "espocrm: the OIDC relay forwarder stopped" >&2
fi
for pid in $db_pid $web_pid $tls_pid; do
  kill "$pid" 2>/dev/null || true
done
wait 2>/dev/null || true
[ "$status" -ne 0 ] || status=1
exit "$status"
