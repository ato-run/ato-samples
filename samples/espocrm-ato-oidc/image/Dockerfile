# EspoCRM 9.3.11 and its MariaDB database, for the Ato Runner.
#
# Ato runs a workload's image read-only, without capabilities and as a non-root
# user chosen by the Runner (1000:1000 in production). The image is flattened
# before use (docker export | docker import), so it must not declare VOLUME and
# must not rely on an ENTRYPOINT: start.sh, from the mounted workspace, is the
# workload's entry point.
#
# EspoCRM comes from the official espocrm/espocrm image, pinned by digest and
# version in build-images.sh. That image carries the application source under
# /usr/src/espocrm and copies it to /var/www/html on start; this image serves
# it from /usr/src/espocrm directly, because the Runner's filesystem is
# read-only and the official entrypoint (which installs the app and copies the
# source) is replaced by start.sh.
#
# Debian's mariadb-server comes from the same base distribution because a
# portable capsule can carry only one filesystem state and no state may be
# shared by two services: the CRM and its database share this image and the
# single state /var/lib/espocrm. EspoCRM's mutable directories live in that
# state; the installed code, vendor/ and the web root stay read-only here.
ARG ESPOCRM_IMAGE
FROM ${ESPOCRM_IMAGE}

# The base image keeps a USER (www-data), and the build has to install
# packages.
USER root

# mariadb-server plus curl for the administrator API calls start.sh makes.
# The policy-rc.d stub stops the package's post-install from starting a server
# during the build; start.sh owns the database at run time as the container
# user, so the package's datadir, run directory and log directory are removed.
# The build checks the PHP extensions and the database binaries instead of
# shipping an image that cannot run EspoCRM.
RUN set -eux; \
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; \
    chmod +x /usr/sbin/policy-rc.d; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        mariadb-server; \
    rm -rf /var/lib/apt/lists/* /var/lib/mysql /run/mysqld /var/log/mysql; \
    rm -f /usr/sbin/policy-rc.d; \
    command -v mariadbd >/dev/null; \
    command -v mariadb-install-db >/dev/null; \
    command -v curl >/dev/null; \
    mariadbd --version; \
    php -r 'foreach (["pdo_mysql", "json", "openssl", "mbstring", "zip", "gd", "iconv", "curl", "xml", "dom", "fileinfo", "ctype", "tokenizer"] as $extension) { if (!extension_loaded($extension)) { fwrite(STDERR, "missing PHP extension: {$extension}\n"); exit(1); } }'

# EspoCRM writes data/, custom/ and client/custom/ at run time, and the
# installer keeps its "installed" flag in install/config.php. They are all
# symlinks into the one state directory the capsule declares, so the read-only
# image never needs to be written. The symlinks are made here (in the image)
# and their state-side directories are created by start.sh; an empty state
# mount hides the files, not the links.
#
# public/status.php is the file the Runner contract observes without a sign-in:
# every EspoCRM page either needs a session or starts a browser redirect to
# Ato. It answers 200 only once the state has the ready marker.
RUN set -eux; \
    test -f /usr/src/espocrm/index.php; \
    test -f /usr/src/espocrm/public/index.php; \
    printf '/usr/src/espocrm\n' > /etc/espocrm-root; \
    mkdir -p /var/lib/espocrm/data \
             /var/lib/espocrm/custom/Espo/Custom \
             /var/lib/espocrm/custom/Espo/Modules \
             /var/lib/espocrm/client-custom; \
    printf 'Require all denied\n' > /var/lib/espocrm/data/.htaccess; \
    rm -rf /usr/src/espocrm/data /usr/src/espocrm/custom /usr/src/espocrm/client/custom; \
    ln -s /var/lib/espocrm/data /usr/src/espocrm/data; \
    ln -s /var/lib/espocrm/custom /usr/src/espocrm/custom; \
    ln -s /var/lib/espocrm/client-custom /usr/src/espocrm/client/custom; \
    ln -s /var/lib/espocrm/install-config.php /usr/src/espocrm/install/config.php; \
    printf '%s\n' '<?php' \
        '// The Runner contract observes this file without a sign-in. It answers' \
        '// 200 only after start.sh finished installing and configuring EspoCRM;' \
        '// a static file would report healthy while sign-in is still being set up.' \
        'if (!is_file("/var/lib/espocrm/ready")) { http_response_code(503); echo "starting\\n"; exit; }' \
        'http_response_code(200); echo "ok\\n";' \
        > /usr/src/espocrm/public/status.php

# Serve the application on 8080. The document root is the application root:
# EspoCRM's own .htaccess redirects every request to public/ (and forbids
# data/, custom/, application/, vendor/ and a direct public/ access), so
# AllowOverride is required. install/ is denied over HTTP because the
# installation is done from the console by start.sh, and data/ and custom/
# are denied in case a rewrite is ever bypassed.
RUN set -eux; \
    a2enmod rewrite headers >/dev/null; \
    sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf; \
    printf '%s\n' \
        '<VirtualHost *:8080>' \
        '    ServerName localhost' \
        '    DocumentRoot /usr/src/espocrm' \
        '    <Directory /usr/src/espocrm>' \
        '        Options FollowSymLinks' \
        '        AllowOverride All' \
        '        Require all granted' \
        '    </Directory>' \
        '    <LocationMatch "^/(data|custom|install)(/|$)">' \
        '        Require all denied' \
        '    </LocationMatch>' \
        '</VirtualHost>' \
        > /etc/apache2/sites-available/000-default.conf; \
    a2ensite 000-default >/dev/null 2>&1 || true

# PHP writes sessions and temporary uploads under /tmp, the only writable place
# outside the declared state, and gets the memory limit EspoCRM documents.
RUN set -eux; \
    ini_dir="${PHP_INI_DIR:-/usr/local/etc/php}/conf.d"; \
    mkdir -p "$ini_dir"; \
    printf '%s\n' \
        'memory_limit=512M' \
        'session.save_path=/tmp/php-sessions' \
        'sys_temp_dir=/tmp' \
        'upload_tmp_dir=/tmp/php-upload' \
        > "$ini_dir/ato-espocrm.ini"

# start.sh merges the bindings into EspoCRM's data/config.php through this
# helper (EspoCRM's configuration file is the installer's and the admin UI's).
COPY espocrm-config.php /usr/local/lib/ato-espocrm-config.php

EXPOSE 8080