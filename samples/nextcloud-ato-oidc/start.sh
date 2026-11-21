#!/bin/sh
# Nextcloud for Ato: code from the image (read-only); the Instance's one state
# directory /var/lib/nextcloud holds config/ (NEXTCLOUD_CONFIG_DIR) and data/. Signs people in with Ato's OpenID
# Provider through the ato.oidc-issuer@1 Binding.
set -eu
cd /var/www/html
occ() { php /var/www/html/occ "$@"; }
mkdir -p /var/lib/nextcloud/config /var/lib/nextcloud/data
# Apps come only from the image (user_oidc included); there is no app store.
[ -f /var/lib/nextcloud/config/apps.config.php ] || cat > /var/lib/nextcloud/config/apps.config.php <<'PHP'
<?php
$CONFIG = [
  'appstoreenabled' => false,
  'apps_paths' => [
    ['path' => '/var/www/html/apps', 'url' => '/apps', 'writable' => false],
  ],
];
PHP
if ! occ status --output=json 2>/dev/null | grep -q '"installed":true'; then
  occ maintenance:install --database=sqlite --database-name=nextcloud \
    --admin-user=ato-admin --admin-pass="$ATO_BINDING_NEXTCLOUD_ADMIN_PASSWORD" \
    --data-dir=/var/lib/nextcloud/data >/dev/null
  # People sign in with Ato; no sample files for each new account.
  occ config:system:set skeletondirectory --value='' >/dev/null
fi
occ upgrade --no-interaction >/dev/null 2>&1 || true
i=0
for domain in ${NEXTCLOUD_TRUSTED_DOMAINS:-}; do
  occ config:system:set trusted_domains "$i" --value="$domain" >/dev/null
  i=$((i + 1))
done
occ config:system:set overwriteprotocol --value=https >/dev/null
occ config:system:set allow_local_remote_servers --value=true --type=boolean >/dev/null
occ config:system:set redis host --value=redis >/dev/null
occ config:system:set redis port --value=6379 --type=integer >/dev/null
occ config:system:set memcache.locking --value='\OC\Memcache\Redis' >/dev/null
occ app:enable user_oidc >/dev/null
occ config:app:set user_oidc allow_multiple_user_backends --value=0 --type=string --lazy >/dev/null
occ user_oidc:provider Ato \
  --clientid="$ATO_BINDING_OIDC_CLIENT_ID" \
  --clientsecret-env=ATO_BINDING_OIDC_CLIENT_SECRET \
  --discoveryuri="$ATO_BINDING_OIDC_ISSUER/.well-known/openid-configuration" \
  --scope="openid profile email" --unique-uid=0 \
  --mapping-uid=preferred_username --mapping-display-name=name --mapping-email=email >/dev/null
echo "Ato sign-in configured" >&2
exec apache2-foreground
