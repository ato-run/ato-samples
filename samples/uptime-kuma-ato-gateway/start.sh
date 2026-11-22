#!/bin/bash
# Uptime Kuma 2.5.12 behind Ato's app gateway, with Uptime Kuma's own login
# disabled: one Instance is one team's shared dashboard.
#
# Uptime Kuma stable 2.5.12 has no OIDC/header login and its accounts are
# admin-centric, so it cannot be signed in with an Ato account. Instead of a
# second, unrelated login, the app's own auth is turned off and Ato's gateway is
# the only gate: a person reaches this app only through the Instance, and the
# gateway refuses anyone who is not a member (403 on the next request after
# removal, 404 on reopening). That is only safe while the app is never exposed
# directly: this capsule publishes no host port and the image must not be run
# anywhere except through Ato.
#
# The code is image content (read-only, /app). This workspace is mounted at
# /workspace (read-only). The Instance's one filesystem state /data holds the
# SQLite database (kuma.db), uploads/screenshots, error.log and db-config.json.
#
# This script needs bash. The capsule starts it as "/bin/bash /workspace/start.sh".
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

APP_DIR=/app
WORKSPACE=/workspace
STATE=/data
PORT=3001
ADMIN_USER=admin

# Heartbeat history retention. 3 days is enough for a team dashboard and keeps the
# 64 MiB filesystem-state checkpoint far away: the history is the only part of
# the state that grows. clear-old-data.js also trims the non-important heartbeats
# to the last day on every run. Recorded here because the number is a choice.
KEEP_DAYS=3

fatal() { echo "uptime-kuma: $*" >&2; exit 1; }

: "${ATO_BINDING_ADMIN_PASSWORD:?missing ATO_BINDING_ADMIN_PASSWORD}"

case $KEEP_DAYS in
  ''|*[!0-9]*) fatal "KEEP_DAYS must be a number of days" ;;
esac
[ "$KEEP_DAYS" -ge 1 ] || fatal "KEEP_DAYS must be at least 1"

[ -d "$APP_DIR" ] || fatal "missing $APP_DIR"
[ -d "$WORKSPACE" ] || fatal "missing $WORKSPACE"

mkdir -p "$STATE" || fatal "cannot create $STATE"

# Root filesystem is read-only and /tmp is a small noexec tmpfs, so everything
# writable lives in the state. HOME/TMPDIR keep Node and the app off the image.
export DATA_DIR=$STATE/
export HOME=/tmp
export TMPDIR=/tmp
export PORT
export UPTIME_KUMA_PORT=$PORT
export UPTIME_KUMA_IS_CONTAINER=1
export NODE_ENV=production
# One filesystem state: SQLite, never the embedded MariaDB the official image
# offers through its ENV (UPTIME_KUMA_ENABLE_EMBEDDED_MARIADB), and no database
# choice page.
export UPTIME_KUMA_DB_TYPE=sqlite
unset UPTIME_KUMA_ENABLE_EMBEDDED_MARIADB

# 1. First run and every start: the admin row (only if the database is empty),
#    auth disabled, the retention period and the update check off. Nothing is
#    interactive and no secret is printed.
KUMA_ADMIN_USER=$ADMIN_USER KUMA_KEEP_DAYS=$KEEP_DAYS \
  node "$WORKSPACE/database-init.js" || fatal "the database initialization failed"

# 2. The server: the image's Node app, which serves the dashboard, the Socket.IO
#    API and the monitors in one process. The image's ENTRYPOINT (dumb-init) is
#    not used; this script supervises Node and stops it with the container.
cd "$APP_DIR" || fatal "missing $APP_DIR"

node_pid=
stop() {
  trap - INT TERM
  echo "uptime-kuma: stopping" >&2
  if [ -n "$node_pid" ]; then
    kill "$node_pid" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit 143
}
trap stop INT TERM

node server/server.js &
node_pid=$!

if ! kill -0 "$node_pid" 2>/dev/null; then
  node_pid=
  fatal "the server exited during start-up"
fi

# 3. Wait for the server and check the state it actually serves: the Socket.IO
#    connection must be auto signed in (no login form) and report the settings
#    above. A login requirement means the Ato gateway is not the only gate, so
#    fail instead of serving.
KUMA_KEEP_DAYS=$KEEP_DAYS node "$WORKSPACE/state-check.js" || {
  kill "$node_pid" 2>/dev/null || true
  wait "$node_pid" 2>/dev/null || true
  node_pid=
  fatal "the server is not serving the expected state (auth disabled, retention $KEEP_DAYS days)"
}

set +e
wait "$node_pid"
status=$?
set -e
node_pid=
echo "uptime-kuma: the server stopped (exit $status)" >&2
[ "$status" -ne 0 ] || status=1
exit "$status"
