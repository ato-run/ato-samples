#!/bin/bash
# EspoCRM 9.3.11 and its database for Ato, in one container and one state.
#
# The code is image content (read-only). The Instance's one state directory
# /var/lib/espocrm holds EspoCRM's data/, custom/ and client/custom/ and the
# MariaDB datadir (db/). People sign in with their Ato account through the
# ato.oidc-issuer@1 Binding; accounts created at sign-in get a default team
# whose role lets them create and read their own Accounts and Contacts, never
# an administrator. The administrator uses the account the installation
# creates with the password from the admin_password Binding (README.md).
#
# EspoCRM's installer has no "install" console command in 9.3.11; the official
# image installs with the steps of install/cli.php. start.sh runs the same
# steps non-interactively on the first start, then re-applies data/config.php
# on every start so a rotated password, a changed public origin or rotated
# OIDC client settings take effect without touching the datadir. The database
# listens on 127.0.0.1 only (inside the container); the datadir is in the
# state, so no step needs root.
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
# OIDC redirect_uri (siteUrl + /oauth-callback.php) and absolute links from it.
# The Runner does not tell the workload its own host name, so the capsule
# passes it as ESPOCRM_APP_URL; ATO_APP_ORIGIN is preferred when a Runner does
# provide it.
app_url=${ATO_APP_ORIGIN:-${ESPOCRM_APP_URL:-}}
[ -n "$app_url" ] || fatal "ESPOCRM_APP_URL (the Instance's public https origin) is required"
app_url=${app_url%/}

# EspoCRM reaches the provider's token, userinfo and JWKS endpoints from the
# server side, through the Runner's issuer relay. Its curl calls accept http
# (CURLPROTO_HTTPS | CURLPROTO_HTTP in the 9.3.11 source), so the relay URL is
# used as-is and no local TLS forwarder is needed.
relay=${ATO_BINDING_OIDC_ISSUER%/}
case "$relay" in
  http://*|https://*) ;;
  *) fatal "ATO_BINDING_OIDC_ISSUER must be an http:// or https:// URL" ;;
esac

# State layout (the installer's writable paths are data/, custom/Espo/Custom,
# custom/Espo/Modules and client/custom, all symlinked into the state by the
# image), the Apache runtime directories (/tmp is the only writable place
# outside the declared state), PHP's session and upload directories and the
# database datadir. An empty state mount hides the image's directories, so they
# are made again here.
mkdir -p "$DATA" \
         "$STATE/custom/Espo/Custom" \
         "$STATE/custom/Espo/Modules" \
         "$STATE/client-custom" \
         "$DB" \
         "$APACHE_BASE/run" "$APACHE_BASE/lock" "$APACHE_BASE/log" \
         /tmp/php-sessions /tmp/php-upload /tmp/mariadb-tmp
# The Apache worker user (the container user under the Runner, www-data when
# run outside it) must be able to write PHP sessions and uploads.
chmod 1777 /tmp/php-sessions /tmp/php-upload

# The contract's health file answers 200 only when this marker exists, so the
# Instance is not reported healthy while the installation or the OIDC setup is
# still in progress.
rm -f "$STATE/ready"

# data/ is directly under the web root, so Apache must never serve it. The
# image ships the same file; an empty state mount hides it, hence this.
printf 'Require all denied\n' > "$DATA/.htaccess"

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
innodb_log_file_size=4M
innodb_buffer_pool_size=128M
# Undo lives in its own tablespaces instead of ibdata1 so the purge thread can
# return it after a burst of DDL and inserts. The installer's initial schema
# build otherwise leaves a ~77 MiB undo high-water mark inside ibdata1, and the
# state would sit above the Runner's 64 MiB state-artifact limit forever.
innodb_undo_tablespaces=2
innodb_undo_log_truncate=ON
innodb_max_undo_log_size=16M
innodb_temp_data_file_path=ibtmp1:5M:autoextend
performance_schema=OFF
skip-log-bin
EOF

if [ ! -d "$DB/mysql" ]; then
  echo "espocrm: initialising the database in $DB" >&2
  mariadb-install-db --defaults-file="$MYSQL_CNF" --datadir="$DB" \
    --auth-root-authentication-method=normal --skip-test-db
fi

db_pid=
web_pid=
stop() {
  trap - INT TERM
  echo "espocrm: stopping" >&2
  for pid in "${db_pid:-}" "${web_pid:-}"; do
    [ -n "$pid" ] || continue
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 143
}
trap stop INT TERM

# Start the server and wait for the loopback socket. The datadir rebuild below
# stops and starts MariaDB a second time, so both places use this.
wait_for_db() {
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
}

start_mariadb() {
  mariadbd --defaults-file="$MYSQL_CNF" &
  db_pid=$!
  wait_for_db
}

# The database and user are created once, and the password is re-applied on
# every start so a rotated binding is picked up without touching the datadir.
# SQL string literals escape backslash and the single quote. The password never
# appears on a command line. It runs again after compact_datadir rebuilt the
# datadir, because the fresh system tables have no application user yet.
ensure_db_user() {
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
}

start_mariadb
ensure_db_user

# One value for the -d query parameter of install/cli.php. The installer reads
# it with parse_str, so every value is percent-encoded.
url_encode() { php -r 'echo rawurlencode($argv[1]);' "$1"; }

# Run one installer step. install/cli.php exits 0 even when the step failed and
# prints "Error: ...", so the output is what decides success (the official
# image checks the same string).
run_install_step() {
  local action=$1 data=${2:-} out
  if [ -n "$data" ]; then
    out=$(cd "$APP_DIR" && php install/cli.php -a "$action" -d "$data" 2>&1) || true
  else
    out=$(cd "$APP_DIR" && php install/cli.php -a "$action" 2>&1) || true
  fi
  case "$out" in
    *"Error:"*) fatal "installation step $action failed: $out" ;;
  esac
}

# The console installer of the official image, in the same order the official
# entrypoint uses: language/licence step, database settings test and
# confirmation (which also stores the database settings in the installer
# session), permission check, settings, schema build, administrator account and
# the finish step that marks both config files installed.
install_espocrm() {
  local dbpass_q adminpass_q site_q
  dbpass_q=$(url_encode "$ATO_BINDING_DB_PASSWORD")
  adminpass_q=$(url_encode "$ATO_BINDING_ADMIN_PASSWORD")
  site_q=$(url_encode "$app_url")
  echo "espocrm: installing EspoCRM in $APP_DIR" >&2
  run_install_step step1 "user-lang=en_US&license-agree=1"
  run_install_step settingsTest "dbPlatform=Mysql&hostName=127.0.0.1:3306&dbName=espocrm&dbUserName=espocrm&dbUserPass=$dbpass_q"
  run_install_step setupConfirmation "db-platform=Mysql&host-name=127.0.0.1:3306&db-name=espocrm&db-user-name=espocrm&db-user-password=$dbpass_q"
  run_install_step checkPermission
  run_install_step saveSettings "site-url=$site_q"
  run_install_step buildDatabase
  run_install_step createUser "user-name=$ADMIN_USER&user-pass=$adminpass_q"
  run_install_step finish
  : > "$INSTALL_MARKER"
  echo "espocrm: installation finished" >&2
}

# Rebuild the datadir from a logical dump once, right after the installation.
#
# The installer creates EspoCRM's 138 tables and their metadata in one long
# transaction and leaves a large undo high-water mark behind: the datadir it
# writes is ~103 MiB, mostly the system tablespace and undo, while the logical
# data is a few hundred KiB. The Runner's state checkpoint is an uncompressed
# tar artifact of at most 64 MiB, so an in-place update of a freshly installed
# Instance would always fail with checkpoint_failed. Rebuilding the datadir
# from a dump, with the undo in its own truncatable tablespaces (the my.cnf
# above), produces the same data in ~60 MiB. The dump is the data the installer
# wrote; the database user is re-created afterwards and on every later start.
compact_datadir() {
  local dump=$STATE/install-dump.sql
  echo "espocrm: rebuilding the datadir to drop the installer's undo high-water mark" >&2
  (
    umask 077
    mariadb-dump --no-defaults --socket="$SOCKET" -uroot \
      --single-transaction --quick --routines --triggers --events \
      --databases espocrm > "$dump"
  ) || fatal "cannot dump the installed database"
  mariadb-admin --no-defaults --socket="$SOCKET" -uroot shutdown \
    || fatal "cannot stop MariaDB for the datadir rebuild"
  wait "$db_pid" 2>/dev/null || true
  db_pid=
  rm -rf "$DB"
  mkdir -p "$DB"
  mariadb-install-db --defaults-file="$MYSQL_CNF" --datadir="$DB" \
    --auth-root-authentication-method=normal --skip-test-db >&2 \
    || fatal "cannot initialise the rebuilt datadir"
  start_mariadb
  mariadb --no-defaults --socket="$SOCKET" -uroot < "$dump" \
    || fatal "cannot import the installed database"
  rm -f "$dump"
  # The installer leaves free space in each of the 138 tables; with one file
  # per table that is several MiB of the checkpoint budget. Rebuilding the
  # tables returns it, and the tables are tiny, so this takes a few seconds.
  for table in $(mariadb --no-defaults --socket="$SOCKET" -uroot -N -B \
    -e "SELECT table_name FROM information_schema.tables WHERE table_schema = 'espocrm' AND engine = 'InnoDB'"); do
    mariadb --no-defaults --socket="$SOCKET" -uroot \
      -e "OPTIMIZE TABLE espocrm.$table" >/dev/null 2>&1 || true
  done
  # The import is a burst of DDL and inserts. The purge thread truncates the
  # undo tablespaces back to their 10 MiB size once its transactions are gone;
  # wait for that, because the state is checkpointed as-is and the whole
  # Instance must stay under the artifact limit.
  i=0
  while :; do
    undo_bytes=$(stat -c %s "$DB"/undo* 2>/dev/null | awk '{sum += $1} END {print sum + 0}')
    [ "${undo_bytes:-0}" -le 25165824 ] && break
    [ "$i" -lt 30 ] || break
    i=$((i + 1))
    sleep 1
  done
  ensure_db_user
}

if [ ! -f "$INSTALL_MARKER" ]; then
  install_espocrm
fi
# A state from an older bundle has the install marker but not this one, so the
# first start of an existing Instance also gets the small datadir.
if [ ! -f "$STATE/datadir-compacted" ]; then
  compact_datadir
  : > "$STATE/datadir-compacted"
fi

# MariaDB's own help tables and the statistics it fills while EspoCRM's 138
# tables are created are not read by the application. They are removed once,
# so the rebuilt datadir stays well inside the 64 MiB checkpoint; OPTIMIZE is
# what returns the space to the filesystem.
if [ ! -f "$STATE/server-data-pruned" ]; then
  mariadb --no-defaults --socket="$SOCKET" -uroot <<'SQL' || true
DROP TABLE IF EXISTS mysql.help_topic, mysql.help_category, mysql.help_relation,
  mysql.help_keyword, mysql.help_topic_seq;
DROP DATABASE IF EXISTS sys;
TRUNCATE TABLE mysql.innodb_index_stats;
TRUNCATE TABLE mysql.innodb_table_stats;
OPTIMIZE TABLE mysql.innodb_index_stats, mysql.innodb_table_stats;
SQL
  : > "$STATE/server-data-pruned"
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
  ESPO_OIDC_BACKCHANNEL_ISSUER="$relay" \
  ATO_BINDING_OIDC_CLIENT_ID="$ATO_BINDING_OIDC_CLIENT_ID" \
  ATO_BINDING_OIDC_CLIENT_SECRET="$ATO_BINDING_OIDC_CLIENT_SECRET" \
  ESPO_DEFAULT_ROLE_ID="$role_id" \
  ESPO_DEFAULT_TEAM_ID="$team_id" \
  php /usr/local/lib/ato-espocrm-config.php || fatal "cannot update $DATA/config.php"
}

patch_config base

# Apache runs in the background so the administrator API calls below can be
# made and so the container can watch every process: if one stops, stop the
# others and exit non-zero, and the Runner restarts the Run instead of serving
# without a database, an app or a way to finish sign-in.
start_web() {
  if [ -n "$web_pid" ]; then
    return 0
  fi
  apache2-foreground &
  web_pid=$!
  local j=0 code
  while :; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8080/status.php" || true)
    case "$code" in
      200|503) break ;;
    esac
    if ! kill -0 "$web_pid" 2>/dev/null; then
      web_pid=
      fatal "Apache exited during start-up"
    fi
    j=$((j + 1))
    [ "$j" -le 60 ] || fatal "Apache did not answer /status.php on 8080"
    sleep 1
  done
}

# The administrator calls EspoCRM's REST API with a curl config file, so the
# admin password is not on the command line.
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

# The default role and team are made through the admin API on the first start,
# while the authentication method is still the installer's standard one.
# EspoCRM has no "default role for OIDC" setting: the created user is put in
# the team (oidcTeamsIds) and the team carries the role. The role allows
# creating Accounts and Contacts and reading and editing the ones the user
# owns; nothing else, and no record of another user. Assignment permissions are
# off, so a user cannot hand a record to somebody else. The ids are kept in the
# state and the OIDC settings point at them, so the same objects are reused
# after a restart.
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
    "Account": {"create": "yes", "read": "own", "edit": "own", "delete": "no"},
    "Contact": {"create": "yes", "read": "own", "edit": "own", "delete": "no"}
  },
  "assignmentPermission": "no",
  "userPermission": "no",
  "messagePermission": "no",
  "exportPermission": "no",
  "massUpdatePermission": "no",
  "dataPrivacyPermission": "no",
  "followerManagementPermission": "no",
  "mentionPermission": "no",
  "auditPermission": "no",
  "portalPermission": "no",
  "groupEmailAccountPermission": "no",
  "userCalendarPermission": "no"
}
JSON
    role_id=$(api POST /Role /tmp/ato-default-role.json | json_field id) \
      || fatal "cannot create the default role through the EspoCRM API"
    printf '%s\n' "$role_id" > "$ROLE_FILE"
  fi
  if [ ! -s "$TEAM_FILE" ]; then
    role_id=$(cat "$ROLE_FILE")
    printf '{"name":"Ato","rolesIds":["%s"]}\n' "$role_id" > /tmp/ato-default-team.json
    team_id=$(api POST /Team /tmp/ato-default-team.json | json_field id) \
      || fatal "cannot create the default team through the EspoCRM API"
    printf '%s\n' "$team_id" > "$TEAM_FILE"
  fi
  : > "$ROLE_TEAM_LINK"
}

ensure_role_team

# Now the OIDC settings, including the team the new accounts get.
patch_config oidc

# EspoCRM caches its merged configuration and metadata. The cache is rebuilt
# from the state on the next request; only data/cache is touched, never uploads
# or config.
if [ -d "$DATA/cache" ]; then
  rm -rf "$DATA"/cache/*
fi

start_web

: > "$STATE/ready"
echo "espocrm: serving on $app_url" >&2

set +e
wait -n
status=$?
set -e

if ! kill -0 "$db_pid" 2>/dev/null; then
  echo "espocrm: MariaDB stopped" >&2
elif ! kill -0 "$web_pid" 2>/dev/null; then
  echo "espocrm: Apache stopped" >&2
fi
for pid in "${db_pid:-}" "${web_pid:-}"; do
  [ -n "$pid" ] || continue
  kill "$pid" 2>/dev/null || true
done
wait 2>/dev/null || true
[ "$status" -ne 0 ] || status=1
exit "$status"