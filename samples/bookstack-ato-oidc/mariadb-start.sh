#!/bin/sh
# MariaDB for the BookStack sample. The database files are the Instance's "db"
# state directory; the server runs as the image's non-root user (999:999 set by
# build-images.sh) and keeps its socket, pid file and defaults file in /tmp or
# in the state directory.
set -eu

STATE=/var/lib/bookstack-db
DATA="$STATE/data"
RUN=/tmp/mariadb
SOCKET="$RUN/mysqld.sock"
PIDFILE="$RUN/mysqld.pid"
DEFAULTS="$STATE/my.cnf"

fatal() { echo "mariadb: $*" >&2; exit 1; }

[ -n "${ATO_BINDING_DB_PASSWORD:-}" ] || fatal "missing ATO_BINDING_DB_PASSWORD"

mkdir -p "$DATA" "$RUN"

# A small datadir keeps the state checkpoint (64 MiB limit) plausible: no
# binlog, no performance schema, no test database, a 12 MiB system tablespace
# and an 8 MiB redo log. Someone who outgrows the checkpoint has to export the
# database instead of relying on in-place updates.
if [ ! -f "$DEFAULTS" ]; then
  cat > "$DEFAULTS" <<'EOF'
[mysqld]
datadir=/var/lib/bookstack-db/data
socket=/tmp/mariadb/mysqld.sock
pid-file=/tmp/mariadb/mysqld.pid
bind-address=0.0.0.0
port=3306
skip-name-resolve
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
innodb_data_file_path=ibdata1:12M:autoextend
innodb_log_file_size=8M
innodb_buffer_pool_size=64M
performance_schema=OFF
skip-log-bin
EOF
fi

# Stop the temporary server if anything fails before the hand-off.
tmp_pid=
cleanup() {
  if [ -n "$tmp_pid" ]; then
    kill "$tmp_pid" 2>/dev/null || true
    wait "$tmp_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ ! -d "$DATA/mysql" ]; then
  echo "mariadb: initialising $DATA" >&2
  mariadb-install-db --defaults-file="$DEFAULTS" --datadir="$DATA" \
    --auth-root-authentication-method=normal --skip-test-db
fi

# A socket-only server creates the database on the first start and re-applies
# the binding password on every start, so a rotated secret is picked up without
# touching the data directory.
mariadbd --defaults-file="$DEFAULTS" --skip-networking \
  --socket="$SOCKET" --pid-file="$PIDFILE" &
tmp_pid=$!

i=0
until mariadb-admin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 60 ] || fatal "the temporary server did not start"
  sleep 1
done

# SQL string literals escape backslash and the single quote. The password never
# appears on a command line.
db_password=$(printf '%s' "$ATO_BINDING_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")
mariadb --no-defaults --socket="$SOCKET" -uroot <<SQL
CREATE DATABASE IF NOT EXISTS bookstack CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'bookstack'@'%' IDENTIFIED BY '${db_password}';
ALTER USER 'bookstack'@'%' IDENTIFIED BY '${db_password}';
GRANT ALL PRIVILEGES ON bookstack.* TO 'bookstack'@'%';
FLUSH PRIVILEGES;
SQL

mariadb-admin --no-defaults --socket="$SOCKET" -uroot shutdown
wait "$tmp_pid" || true
tmp_pid=
trap - EXIT INT TERM

echo "mariadb: serving the bookstack database on 0.0.0.0:3306" >&2
exec mariadbd --defaults-file="$DEFAULTS"
