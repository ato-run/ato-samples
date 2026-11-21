#!/bin/sh
# BookStack for Ato. The code is image content (read-only); the Instance's one
# state directory /var/lib/bookstack holds .env, Laravel's storage, the
# bootstrap cache, uploads and the OIDC public key. People are signed in with
# their Ato account through the ato.oidc-issuer@1 Binding; there is no
# BookStack login form.
set -eu

APP_DIR=/var/www/bookstack
STATE=/var/lib/bookstack
APACHE_BASE=/tmp/apache2

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

# State layout, plus the Apache runtime directories (/tmp is the only writable
# place outside the declared state).
mkdir -p "$STATE/storage/app/public" \
         "$STATE/storage/framework/cache/data" \
         "$STATE/storage/framework/sessions" \
         "$STATE/storage/framework/views" \
         "$STATE/storage/logs" \
         "$STATE/bootstrap-cache" \
         "$STATE/uploads" \
         "$APACHE_BASE/run" "$APACHE_BASE/lock" "$APACHE_BASE/log"

# APP_KEY is generated once and reused; rotating it would drop every session.
if [ ! -s "$STATE/app_key" ]; then
  php -r 'echo "base64:", base64_encode(random_bytes(32)), "\n";' > "$STATE/app_key"
fi
app_key=$(cat "$STATE/app_key")

# Rebuilt on every start: bindings can rotate and the URL can change.
umask 077
oidc_userinfo=
if [ "${BOOKSTACK_OIDC_USERINFO_ENDPOINT:-1}" != "0" ]; then
  # BookStack v26 support for OIDC_USERINFO_ENDPOINT is not verified; set
  # BOOKSTACK_OIDC_USERINFO_ENDPOINT=0 to leave the line out.
  oidc_userinfo="OIDC_USERINFO_ENDPOINT=$ATO_BINDING_OIDC_ISSUER/userinfo"
fi
cat > "$STATE/.env" <<EOF
APP_ENV=production
APP_DEBUG=false
APP_KEY=$app_key
APP_URL=$app_url
APP_PROXY=*

DB_CONNECTION=mysql
DB_HOST=mariadb
DB_PORT=3306
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
OIDC_TOKEN_ENDPOINT=$ATO_BINDING_OIDC_ISSUER/token
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
    $key = null;
    try {
        $key = \phpseclib3\Crypt\PublicKeyLoader::load($jwk);
    } catch (\Throwable $error) {
        try {
            $key = \phpseclib3\Crypt\PublicKeyLoader::loadFormat('JWK', $jwk);
        } catch (\Throwable $error) {
            try {
                $key = \phpseclib3\Crypt\RSA::loadFormat('JWK', $jwk);
            } catch (\Throwable $error) {
                fwrite(STDERR, 'bookstack: cannot read the JWK: ' . $error->getMessage() . "\n");
                continue;
            }
        }
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

# The database service starts in parallel with this one.
i=0
while ! php -r '$socket = @fsockopen("mariadb", 3306, $errno, $errstr, 2); exit($socket === false ? 1 : 0);'; do
  i=$((i + 1))
  [ "$i" -le 120 ] || fatal "MariaDB at mariadb:3306 did not become reachable"
  sleep 1
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

echo "bookstack: serving on $app_url" >&2
exec apache2-foreground
