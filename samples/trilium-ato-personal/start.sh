#!/bin/bash
# TriliumNext v0.107.0 as one person's own notes, behind Ato.
#
# Trilium is a single-user application: one Instance is one person's notes and
# nobody else's. The Instance is imported under that person's Ato account and is
# never shared with an organization, so exactly one person may open it. Its own
# login is therefore turned off (noAuthentication) and Ato's app gateway is the
# only gate; there is no password to know, distribute or reset. That is only safe
# while the app is never reachable outside the gateway: this capsule publishes no
# host port, and the workload only runs on Ato's Runner.
#
# The code is image content (read-only, /usr/src/app). This workspace is mounted
# at /app (read-only). The Instance's one filesystem state /var/lib/trilium is
# Trilium's data directory: document.db, config.ini, the backup directory and the
# session secret. Logs, temporary files and caches go to /tmp.
#
# This script needs bash. The capsule starts it as "/bin/sh /app/start.sh", so
# re-exec under bash when sh is the interpreter.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

APP_DIR=/usr/src/app
STATE=/var/lib/trilium
PORT=8080

fatal() { echo "trilium: $*" >&2; exit 1; }

[ -d "$APP_DIR" ] || fatal "missing $APP_DIR"
[ -f "$APP_DIR/main.mjs" ] || fatal "missing $APP_DIR/main.mjs"
command -v node >/dev/null 2>&1 || fatal "node is required"
[ -d /app ] || fatal "missing /app (the workspace mount)"

mkdir -p "$STATE" || fatal "cannot create $STATE"

# Trilium's data directory is the Instance's one state directory. Logs, temporary
# files, the OCR cache and the anonymized copy are not the person's notes: they
# live under /tmp so the state checkpoint carries only the document, its backups
# and the settings.
export TRILIUM_DATA_DIR=$STATE
export TRILIUM_LOG_DIR=/tmp/trilium/log
export TRILIUM_TMP_DIR=/tmp/trilium/tmp
export TRILIUM_OCR_CACHE_DIR=/tmp/trilium/ocr
export TRILIUM_ANONYMIZED_DB_DIR=/tmp/trilium/anonymized
mkdir -p "$TRILIUM_LOG_DIR" "$TRILIUM_TMP_DIR" "$TRILIUM_OCR_CACHE_DIR" "$TRILIUM_ANONYMIZED_DB_DIR" \
  || fatal "cannot create the /tmp directories"
export HOME=/tmp
export TMPDIR=/tmp

# Trilium's own login is off. The person who may open this Instance is decided by
# Ato's gateway (the Instance's owner, and nobody else); asking again for a
# Trilium password would only invent a secret the person has to keep. Enforced on
# every start, not only the first one.
export TRILIUM_GENERAL_NOAUTHENTICATION=true
export TRILIUM_NETWORK_HOST=0.0.0.0
export TRILIUM_NETWORK_PORT=$PORT
# The log directory is /tmp (not checkpointed) and is kept short nevertheless.
export TRILIUM_LOGGING_RETENTIONDAYS=2
# No sync server: the notes must not be sent to another host. start.sh also
# clears the option on every start (see below), so the UI cannot leave one.
unset TRILIUM_SYNC_SYNCSERVERHOST TRILIUM_SYNC_SYNCPROXY 2>/dev/null || true

cd "$APP_DIR" || fatal "missing $APP_DIR"

# Keep the state's backup directory bounded. Trilium writes fixed-name automatic
# backups (backup-daily/weekly/monthly) and a person can write their own; the
# checkpoint of the state must stay under 64 MiB, so only the newest backup file
# is kept. The notes themselves are never touched.
keep_newest_backup() {
  local dir=$STATE/backup file
  [ -d "$dir" ] || return 0
  ls -1t "$dir" 2>/dev/null | tail -n +2 | while IFS= read -r file; do
    rm -f -- "$dir/$file" 2>/dev/null || true
  done
}
keep_newest_backup

json_field() {
  # json_field NAME: print one top-level field of a JSON document on stdin.
  node -e 'let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    let doc;
    try { doc = JSON.parse(s); } catch { process.exit(1); }
    const value = doc[process.argv[1]];
    if (value === undefined || value === null) process.exit(1);
    process.stdout.write(String(value));
  });' "$1"
}

status_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" 2>/dev/null || true; }

node_pid=
keepalive_pid=
stop() {
  trap - INT TERM
  echo "trilium: stopping" >&2
  [ -n "$keepalive_pid" ] && kill "$keepalive_pid" 2>/dev/null || true
  [ -n "$node_pid" ] && kill "$node_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 143
}
trap stop INT TERM

node ./main.mjs &
node_pid=$!

# 1. Wait for the server.
i=0
while :; do
  [ "$(status_of "http://127.0.0.1:$PORT/api/health-check")" = 200 ] && break
  if ! kill -0 "$node_pid" 2>/dev/null; then
    node_pid=
    fatal "Trilium exited during start-up"
  fi
  i=$((i + 1))
  [ "$i" -le 120 ] || fatal "Trilium did not answer /api/health-check on $PORT"
  sleep 1
done
echo "trilium: the server is up on 127.0.0.1:$PORT" >&2

# 2. First start: create the (empty) document non-interactively, exactly as the
#    setup wizard's "create new document, empty" path does. The document is
#    created once; later starts find it initialized and skip this.
setup_status() { curl -s --max-time 15 "http://127.0.0.1:$PORT/api/setup/status" 2>/dev/null || true; }
initialized=$(setup_status | json_field isInitialized 2>/dev/null || true)
if [ "$initialized" != "true" ]; then
  echo "trilium: creating the document (first start)" >&2
  code=$(curl -s -o /tmp/trilium/setup.out -w '%{http_code}' --max-time 300 \
    -X POST -H 'Content-Type: application/json' --data '{"locale":"en"}' \
    "http://127.0.0.1:$PORT/api/setup/new-document?skipDemoDb" 2>/dev/null || true)
  case $code in
    2*) ;;
    *) fatal "cannot create the document (HTTP ${code:-none})" ;;
  esac
  i=0
  while :; do
    [ "$(setup_status | json_field isInitialized 2>/dev/null || true)" = "true" ] && break
    i=$((i + 1))
    [ "$i" -le 120 ] || fatal "the document was created but the instance does not report it initialized"
    sleep 1
  done
fi

# 3. The app must open with no Trilium password. /bootstrap is the same payload
#    the UI starts from: with the app's login off it reports the visitor as
#    signed in, and /login redirects to the app instead of serving a form.
jar=/tmp/trilium/session.jar
rm -f "$jar"
bootstrap=$(curl -s -c "$jar" --max-time 30 "http://127.0.0.1:$PORT/bootstrap" 2>/dev/null || true)
[ -n "$bootstrap" ] || fatal "cannot read /bootstrap"
logged_in=$(printf '%s' "$bootstrap" | json_field loggedIn 2>/dev/null || true)
csrf=$(printf '%s' "$bootstrap" | json_field csrfToken 2>/dev/null || true)
[ "$logged_in" = "true" ] || fatal "the app did not open without a sign-in (loggedIn=${logged_in:-missing})"
[ -n "$csrf" ] || fatal "the app did not return a CSRF token"

login_code=$(status_of "http://127.0.0.1:$PORT/login")
case $login_code in
  30*) ;;
  *) fatal "/login answered $login_code instead of redirecting: Trilium's own login is not off" ;;
esac

root_code=$(status_of "http://127.0.0.1:$PORT/api/notes/root")
[ "$root_code" = 200 ] || fatal "the note API is not reachable without a session (HTTP $root_code)"

# 4. Keep the settings this sample promises, through the app's own options API
#    with the CSRF token from /bootstrap: compressed backups only (a person's
#    notes must stay inside the 64 MiB state checkpoint for as long as possible)
#    and no sync server. Applied on every start so a value changed in the UI does
#    not survive a restart.
code=$(curl -s -o /tmp/trilium/options.out -w '%{http_code}' -b "$jar" -c "$jar" --max-time 30 \
  -X PUT -H "x-csrf-token: $csrf" -H 'Content-Type: application/json' \
  --data '{"backupEnableCompression":"true","weeklyBackupEnabled":"false","monthlyBackupEnabled":"false","syncServerHost":"","syncProxy":""}' \
  "http://127.0.0.1:$PORT/api/options" 2>/dev/null || true)
case $code in
  2*) ;;
  *) fatal "cannot apply the Instance settings (HTTP ${code:-none})" ;;
esac

# 5. Keep the backup directory bounded while the Instance runs as well.
( while :; do sleep 300; keep_newest_backup; done ) &
keepalive_pid=$!

echo "trilium: serving on 127.0.0.1:$PORT (no app login; headroom for /tmp and the state)" >&2

set +e
wait "$node_pid"
status=$?
set -e
node_pid=
[ -n "$keepalive_pid" ] && kill "$keepalive_pid" 2>/dev/null || true
echo "trilium: the server stopped (exit $status)" >&2
[ "$status" -ne 0 ] || status=1
exit "$status"
