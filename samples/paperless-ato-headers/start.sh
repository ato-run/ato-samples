#!/bin/bash
# Paperless-ngx for Ato: migrations, the web server, the Celery worker and the
# scheduler in one container, with Redis as a second service.
#
# The code is image content (read-only). The Instance's one state directory
# /var/lib/paperless holds the database, the search index, the media files, the
# consume/export directories and the Celery beat schedule. People are signed in
# with their Ato app account through the header the Ato gateway forwards
# (X-Ato-Account); Paperless itself creates the account on first request and
# has no password login to use.
#
# This script needs bash for the wait -n supervisor at the end. The capsule
# starts it as "/bin/bash /app/start.sh"; re-exec under bash when sh is the
# interpreter.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -eu

PAPERLESS_SRC=/usr/src/paperless/src
STATE=/var/lib/paperless
DATA=$STATE/data
MEDIA=$STATE/media
CONSUME=$STATE/consume
EXPORT=$STATE/export
SCRATCH=/tmp/paperless

fatal() { echo "paperless: $*" >&2; exit 1; }

# The Django secret key never lives in capsule.toml: it is the secret Binding
# and is handed over as ATO_BINDING_SECRET_KEY.
: "${ATO_BINDING_SECRET_KEY:?missing ATO_BINDING_SECRET_KEY}"
export PAPERLESS_SECRET_KEY=$ATO_BINDING_SECRET_KEY

# The capsule's settings module only replaces the remote-user authentication
# backend (see ato_paperless/); everything else is Paperless's own settings.
export DJANGO_SETTINGS_MODULE=ato_paperless.settings
case ${PYTHONPATH:-} in
  /app|/app:*) ;;
  '') export PYTHONPATH=/app ;;
  *) export PYTHONPATH=/app:$PYTHONPATH ;;
esac

# The public origin is only used as a CSRF trusted origin. It is deliberately
# not PAPERLESS_URL: that would pin ALLOWED_HOSTS to the public host and the
# Runner's own contract observation (which does not know the public host) would
# be rejected with 400. The Runner does not promise ATO_APP_ORIGIN to every
# workload, so it stays optional; without it Paperless keeps its default
# ALLOWED_HOSTS and CSRF handling.
app_origin=${ATO_APP_ORIGIN:-}
case $app_origin in
  http://*|https://*)
    export PAPERLESS_CSRF_TRUSTED_ORIGINS=${app_origin%/}
    ;;
esac

# Everything is under the one state mount or /tmp, because the root filesystem
# is read only. /tmp is a small noexec tmpfs; Paperless's scratch space and the
# Celery beat schedule must not grow there, so the schedule lives in state.
mkdir -p "$DATA/index" "$DATA/logs" "$MEDIA/documents/originals" \
         "$MEDIA/documents/thumbnails" "$CONSUME" "$EXPORT" "$SCRATCH"

run_manage() {
  ( cd "$PAPERLESS_SRC" && python3 manage.py "$@" )
}

# Migrations are idempotent and must finish before any process serves a
# request or consumes a document.
run_manage migrate --skip-checks --no-input

# Header-created accounts are regular accounts with no permissions. Paperless
# 3.5.1 only applies PAPERLESS_ACCOUNT_DEFAULT_GROUPS in its allauth adapter,
# so ato_paperless/ applies the same setting to the remote-user backend and
# this creates the group with the regular-user permissions.
run_manage shell -c 'from ato_paperless.auth import ensure_default_group; ensure_default_group()'

web_pid=
worker_pid=
scheduler_pid=
stop() {
  trap - INT TERM
  echo "paperless: stopping" >&2
  for pid in $web_pid $worker_pid $scheduler_pid; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 143
}
trap stop INT TERM

export GRANIAN_HOST=0.0.0.0
export GRANIAN_PORT=8000
export GRANIAN_WORKERS=${GRANIAN_WORKERS:-1}

( cd "$PAPERLESS_SRC" && exec granian --interface asginl --ws --loop uvloop "paperless.asgi:application" ) &
web_pid=$!
( cd "$PAPERLESS_SRC" && exec celery --skip-checks --app paperless worker --loglevel INFO --without-mingle --without-gossip ) &
worker_pid=$!
( cd "$PAPERLESS_SRC" && exec celery --skip-checks --app paperless beat --loglevel INFO --schedule "$DATA/celerybeat-schedule" ) &
scheduler_pid=$!

echo "paperless: serving on port 8000" >&2

set +e
wait -n
status=$?
set -e

if ! kill -0 "$web_pid" 2>/dev/null; then
  echo "paperless: the web server stopped" >&2
elif ! kill -0 "$worker_pid" 2>/dev/null; then
  echo "paperless: the Celery worker stopped" >&2
else
  echo "paperless: the scheduler stopped" >&2
fi
for pid in $web_pid $worker_pid $scheduler_pid; do
  kill "$pid" 2>/dev/null || true
done
wait 2>/dev/null || true
[ "$status" -ne 0 ] || status=1
exit "$status"
