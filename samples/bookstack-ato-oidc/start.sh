#!/bin/bash
# BookStack and its database for Ato, in one container and one state.
#
# The code is image content (read-only). The Instance's one state directory
# /var/lib/bookstack holds .env, Laravel's storage, the bootstrap cache,
# uploads, the OIDC public key and MariaDB's datadir (db/). People are signed
# in with their Ato account through the ato.oidc-issuer@1 Binding; there is no
# BookStack login form.
#
# This script needs bash for the wait -n supervisor at the end. The capsule
# starts it as "/bin/sh /app/start.sh", so re-exec under bash when sh is the
# interpreter.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /bin/bash "$0" "$@"
fi
set -eu

APP_DIR=/var/www/bookstack
STATE=/var/lib/bookstack
DATA=$STATE/db
APACHE_BASE=/tmp/apache2
SOCKET=/tmp/mysqld.sock
MYSQL_CNF=/tmp/bookstack-my.cnf

fatal() { echo "bookstack: $*" >&2; exit 1; }

: "${ATO_BINDING_DB_PASSWORD:?missing ATO_BINDING_DB_PASSWORD}"
: "${ATO_BINDING_OIDC_CLIENT_ID:?missing ATO_BINDING_OIDC_CLIENT_ID}"
: "${ATO_BINDING_OIDC_CLIENT_SECRET:?missing ATO_BINDING_OIDC_CLIENT_SECRET}"
: "${ATO_BINDING_OIDC_ISSUER:?missing ATO_BINDING_OIDC_ISSUER}"
: "${ATO_OIDC_PUBLIC_ISSUER:?missing ATO_OIDC_PUBLIC_ISSUER}"

# APP_URL must be the public origin people open. The Runner does not tell the
# workload its own host name, so the capsule passes it as BOOKSTACK_APP_URL;
# ATO_APP_ORIGIN is preferred when a Runner does provide it.
app_url=${ATO_APP_ORIGIN:-${BOOKSTACK_APP_URL:-}}
[ -n "$app_url" ] || fatal "BOOKSTACK_APP_URL (the Instance's public https origin) is required"
app_url=${app_url%/}

# BookStack accepts only https:// for the token and userinfo endpoints, and the
# Runner's issuer relay is plain http on the container's gateway. When it is,
# socat terminates TLS on localhost and forwards to the relay; PHP trusts that
# certificate, which is made on every start and stays in /tmp. The relay itself
# is still the only way out to the issuer.
relay=${ATO_BINDING_OIDC_ISSUER%/}
tls_dir=/tmp/bookstack-oidc-tls
tls_port=8443
case "$relay" in
  https://*)
    backchannel_issuer=$relay
    ;;
  http://*)
    relay_rest=${relay#http://}
    relay_hostport=${relay_rest%%/*}
    relay_path=
    [ "$relay_rest" = "$relay_hostport" ] || relay_path=/${relay_rest#*/}
    backchannel_issuer=https://localhost:$tls_port$relay_path
    ;;
  *)
    fatal "ATO_BINDING_OIDC_ISSUER must be an http:// or https:// URL"
    ;;
esac

# State layout, the Apache runtime directories (/tmp is the only writable
# place outside the declared state) and the database datadir.
mkdir -p "$STATE/storage/app/public" \
         "$STATE/storage/framework/cache/data" \
         "$STATE/storage/framework/sessions" \
         "$STATE/storage/framework/views" \
         "$STATE/storage/logs" \
         "$STATE/bootstrap-cache" \
         "$STATE/uploads" \
         "$DATA" \
         "$APACHE_BASE/run" "$APACHE_BASE/lock" "$APACHE_BASE/log"

# APP_KEY is generated once and reused; rotating it would drop every session.
if [ ! -s "$STATE/app_key" ]; then
  php -r 'echo "base64:", base64_encode(random_bytes(32)), "\n";' > "$STATE/app_key"
fi
app_key=$(cat "$STATE/app_key")

# A small datadir keeps the state checkpoint (64 MiB limit) plausible: no
# binlog, no performance schema, a 12 MiB system tablespace and an 8 MiB redo
# log. The server listens only on the unix socket; the socket and pid file are
# in /tmp. Someone who outgrows the checkpoint has to export the database
# instead of relying on in-place updates.
cat > "$MYSQL_CNF" <<'EOF'
[mysqld]
datadir=/var/lib/bookstack/db
socket=/tmp/mysqld.sock
pid-file=/tmp/mysqld.pid
skip-networking
skip-name-resolve
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
innodb_data_file_path=ibdata1:12M:autoextend
innodb_log_file_size=8M
innodb_buffer_pool_size=64M
performance_schema=OFF
skip-log-bin
EOF

db_pid=
web_pid=
tls_pid=
stop() {
  trap - INT TERM
  echo "bookstack: stopping" >&2
  for pid in $db_pid $web_pid $tls_pid; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 143
}
trap stop INT TERM

if [ -n "${relay_hostport:-}" ]; then
  mkdir -p "$tls_dir" /tmp/bookstack-php.d
  ( umask 077
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=localhost \
      -addext subjectAltName=DNS:localhost \
      -keyout "$tls_dir/key.pem" -out "$tls_dir/cert.pem" 2>/dev/null ) \
    || fatal "cannot create the local TLS certificate for the OIDC relay"
  # Keep the public CAs next to the local certificate, so other https calls
  # BookStack makes are verified as before.
  cat /etc/ssl/certs/ca-certificates.crt "$tls_dir/cert.pem" > "$tls_dir/ca.pem" 2>/dev/null \
    || cp "$tls_dir/cert.pem" "$tls_dir/ca.pem"
  printf 'curl.cainfo=%s\nopenssl.cafile=%s\n' "$tls_dir/ca.pem" "$tls_dir/ca.pem" \
    > /tmp/bookstack-php.d/ato-oidc-relay.ini
  export PHP_INI_SCAN_DIR="${PHP_INI_DIR:-/usr/local/etc/php}/conf.d:/tmp/bookstack-php.d"
  socat "OPENSSL-LISTEN:$tls_port,bind=127.0.0.1,reuseaddr,fork,cert=$tls_dir/cert.pem,key=$tls_dir/key.pem,verify=0" \
    "TCP:$relay_hostport" &
  tls_pid=$!
fi

# The datadir belongs to the container user and is created on first start, so
# no step needs root.
if [ ! -d "$DATA/mysql" ]; then
  echo "bookstack: initialising the database in $DATA" >&2
  mariadb-install-db --defaults-file="$MYSQL_CNF" --datadir="$DATA" \
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
  [ "$i" -le 60 ] || fatal "MariaDB did not become reachable on $SOCKET"
  sleep 1
done

# The database and user are created once, and the password is re-applied on
# every start so a rotated secret is picked up without touching the datadir.
# SQL string literals escape backslash and the single quote. The password
# never appears on a command line.
db_password=$(printf '%s' "$ATO_BINDING_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")
mariadb --no-defaults --socket="$SOCKET" -uroot <<SQL || fatal "cannot prepare the bookstack database"
CREATE DATABASE IF NOT EXISTS bookstack CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'bookstack'@'localhost' IDENTIFIED BY '${db_password}';
ALTER USER 'bookstack'@'localhost' IDENTIFIED BY '${db_password}';
GRANT ALL PRIVILEGES ON bookstack.* TO 'bookstack'@'localhost';
FLUSH PRIVILEGES;
SQL

# Rebuilt on every start: bindings can rotate and the URL can change. BookStack
# reaches the local server through DB_SOCKET (Laravel's unix_socket), so
# DB_HOST stays localhost and DB_PORT is unset.
umask 077
oidc_userinfo=
if [ "${BOOKSTACK_OIDC_USERINFO_ENDPOINT:-1}" != "0" ]; then
  # BookStack v26 support for OIDC_USERINFO_ENDPOINT is not verified; set
  # BOOKSTACK_OIDC_USERINFO_ENDPOINT=0 to leave the line out.
  oidc_userinfo="OIDC_USERINFO_ENDPOINT=$backchannel_issuer/userinfo"
fi
cat > "$STATE/.env" <<EOF
APP_ENV=production
APP_DEBUG=false
APP_KEY=$app_key
APP_URL=$app_url
APP_PROXY=*

DB_CONNECTION=mysql
DB_HOST=localhost
DB_SOCKET=/tmp/mysqld.sock
DB_DATABASE=bookstack
DB_USERNAME=bookstack
DB_PASSWORD=$ATO_BINDING_DB_PASSWORD

AUTH_METHOD=oidc
AUTH_AUTO_INITIATE=true
OIDC_NAME=Ato
OIDC_DISPLAY_NAME_CLAIMS=name
OIDC_CLIENT_ID=$ATO_BINDING_OIDC_CLIENT_ID
OIDC_CLIENT_SECRET=$ATO_BINDING_OIDC_CLIENT_SECRET
OIDC_ISSUER=$ATO_OIDC_PUBLIC_ISSUER
OIDC_ISSUER_DISCOVER=false
OIDC_AUTH_ENDPOINT=$ATO_OIDC_PUBLIC_ISSUER/authorize
OIDC_TOKEN_ENDPOINT=$backchannel_issuer/token
$oidc_userinfo
OIDC_PUBLIC_KEY=file://$STATE/oidc-key.pem
EOF
umask 022

# BookStack verifies the RS256 id_token itself, so it needs the provider's
# public key. Fetch the JWKS through the Runner relay and keep the PEM in state
# so a restart survives a temporarily unreachable relay. A key rotation is
# picked up on the next restart.
write_oidc_key() {
  cat > /tmp/bookstack-oidc-key.php <<'PHP'
<?php
// Convert the first RS256 key of the issuer's JWKS into the PEM file that
// BookStack's OIDC_PUBLIC_KEY reads. BookStack vendors phpseclib 3.
[$issuer, $keyFile] = [$argv[1], $argv[2]];
require '/var/www/bookstack/vendor/autoload.php';

$jwks = @file_get_contents($issuer . '/jwks');
if ($jwks === false) {
    fwrite(STDERR, 'bookstack: cannot fetch ' . $issuer . "/jwks\n");
    exit(1);
}
$document = json_decode($jwks, true);
foreach ($document['keys'] ?? [] as $jwk) {
    if (($jwk['kty'] ?? '') !== 'RSA') {
        continue;
    }
    if (isset($jwk['alg']) && $jwk['alg'] !== 'RS256') {
        continue;
    }
    // phpseclib 3 reads a JWK as a JSON string, not as a decoded array.
    try {
        $key = \phpseclib3\Crypt\PublicKeyLoader::load(json_encode($jwk));
    } catch (\Throwable $error) {
        fwrite(STDERR, 'bookstack: cannot read the JWK: ' . $error->getMessage() . "\n");
        continue;
    }
    $pem = $key->toString('PKCS8');
    if (file_put_contents($keyFile . '.new', $pem) === false || !rename($keyFile . '.new', $keyFile)) {
        fwrite(STDERR, 'bookstack: cannot write ' . $keyFile . "\n");
        exit(1);
    }
    exit(0);
}
fwrite(STDERR, 'bookstack: no RS256 key in ' . $issuer . "/jwks\n");
exit(1);
PHP
  php /tmp/bookstack-oidc-key.php "$ATO_BINDING_OIDC_ISSUER" "$STATE/oidc-key.pem"
}

i=0
while ! write_oidc_key; do
  i=$((i + 1))
  if [ "$i" -ge 5 ]; then
    if [ -s "$STATE/oidc-key.pem" ]; then
      echo "bookstack: keeping the previous OIDC public key" >&2
      break
    fi
    fatal "cannot prepare $STATE/oidc-key.pem from $ATO_BINDING_OIDC_ISSUER/jwks"
  fi
  sleep 2
done

# Migrations are idempotent; retry briefly in case the first connection lands
# while MariaDB is still finishing its own start-up.
i=0
while ! ( cd "$APP_DIR" && php artisan migrate --force ); do
  i=$((i + 1))
  [ "$i" -le 5 ] || fatal "database migration failed"
  echo "bookstack: migration failed, retrying" >&2
  sleep 3
done

# BookStack gives an account made at OIDC sign-in only the role in its
# "registration-role" setting, and a fresh install has none, so the first
# people would arrive with no permissions. Set it to BOOKSTACK_DEFAULT_ROLE
# (a role's display name, Editor unless told otherwise) once; a role an admin
# chooses later in BookStack is kept.
default_role=$(printf '%s' "${BOOKSTACK_DEFAULT_ROLE:-Editor}" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")
mariadb --no-defaults --socket="$SOCKET" -uroot bookstack <<SQL || fatal "cannot set the default role"
INSERT INTO settings (setting_key, value, type, created_at, updated_at)
SELECT 'registration-role', id, 'string', NOW(), NOW() FROM roles
WHERE display_name = '${default_role}'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE setting_key = 'registration-role')
ORDER BY id LIMIT 1;
SQL

# Apache runs in the background so the container can watch every process: if
# one stops, stop the others and exit non-zero, and the Runner restarts the Run
# instead of serving without a database, an app or a way to finish sign-in.
apache2-foreground &
web_pid=$!

echo "bookstack: serving on $app_url" >&2

set +e
wait -n
status=$?
set -e

if ! kill -0 "$db_pid" 2>/dev/null; then
  echo "bookstack: MariaDB stopped" >&2
elif ! kill -0 "$web_pid" 2>/dev/null; then
  echo "bookstack: Apache stopped" >&2
else
  echo "bookstack: the OIDC relay forwarder stopped" >&2
fi
for pid in $db_pid $web_pid $tls_pid; do
  kill "$pid" 2>/dev/null || true
done
wait 2>/dev/null || true
[ "$status" -ne 0 ] || status=1
exit "$status"
