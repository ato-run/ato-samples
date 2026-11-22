# EspoCRM and its MariaDB database, for the Ato Runner.
#
# Ato runs a workload's image read-only, without capabilities and as a non-root
# user chosen by the Runner (1000:1000 in production). build-images.sh flattens
# images (docker export | docker import) before they are used, so this image
# must not declare VOLUME and must not rely on an ENTRYPOINT: start.sh, from the
# mounted workspace, is the workload's entry point.
#
# EspoCRM comes from the official espocrm/espocrm image, pinned by digest for
# the platform. build-images.sh passes it as ESPOCRM_IMAGE after flattening it
# once: the official image declares VOLUME for data/ and custom/, and the
# flattened copy drops that declaration so this build can replace those
# directories with symlinks into the state mount instead of having runtime
# anonymous volumes hide them. The .capsule itself then pins the one image
# digest build-images.sh prints.
#
# Debian's mariadb-server comes from the same base distribution because a
# portable capsule can carry only one filesystem state and no state may be
# shared by two services: the CRM and its database share this image and the
# single state /var/lib/espocrm. EspoCRM's mutable directories live in that
# state; the installed code, vendor/ and the web root stay read-only here.
ARG ESPOCRM_IMAGE
FROM ${ESPOCRM_IMAGE}

# The flattened base image keeps a USER, and the build has to install packages.
USER root

# mariadb-server plus what start.sh needs for the optional localhost TLS
# forwarder and the admin API calls. The policy-rc.d stub stops the package's
# post-install from starting a server during the build; start.sh owns the
# database at run time as the container user, so the package's datadir, run
# directory and log directory are removed. The build prints the MariaDB version
# and checks the PHP extensions EspoCRM needs instead of shipping a broken
# image.
RUN set -eux; \
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; \
    chmod +x /usr/sbin/policy-rc.d; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        mariadb-server \
        openssl \
        socat; \
    rm -rf /var/lib/apt/lists/* /var/lib/mysql /run/mysqld /var/log/mysql; \
    rm -f /usr/sbin/policy-rc.d; \
    command -v mariadbd >/dev/null; \
    command -v mariadb-install-db >/dev/null; \
    command -v socat >/dev/null; \
    command -v openssl >/dev/null; \
    command -v curl >/dev/null; \
    mariadbd --version; \
    php -r 'foreach (["pdo_mysql", "mbstring", "json", "openssl", "zip", "gd", "curl", "xml", "dom", "fileinfo"] as $extension) { if (!extension_loaded($extension)) { fwrite(STDERR, "missing PHP extension: {$extension}\n"); exit(1); } }'

# Find the installation root once (the official image serves it from
# /var/www/html, older packages use the tree itself) and record it for
# start.sh. data/, custom/ and client/custom/ are what EspoCRM writes at run
# time, so they become symlinks into the state. The /status file is a static
# file the Runner can observe without a sign-in; it is written into both the
# install root and its public/ directory if that exists, and the web server
# serves whichever one is the document root.
RUN set -eux; \
    root=; \
    for candidate in /var/www/html /var/www/espocrm; do \
        if [ -f "$candidate/index.php" ] || [ -f "$candidate/public/index.php" ]; then \
            root=$candidate; \
            break; \
        fi; \
    done; \
    if [ -z "$root" ]; then echo "cannot find the EspoCRM install root" >&2; exit 1; fi; \
    printf '%s\n' "$root" > /etc/espocrm-root; \
    mkdir -p /var/lib/espocrm/data /var/lib/espocrm/custom /var/lib/espocrm/client-custom /var/lib/espocrm/db; \
    printf 'Require all denied\n' > /var/lib/espocrm/data/.htaccess; \
    rm -rf "$root/data" "$root/custom"; \
    ln -s /var/lib/espocrm/data "$root/data"; \
    ln -s /var/lib/espocrm/custom "$root/custom"; \
    if [ -d "$root/client" ]; then \
        rm -rf "$root/client/custom"; \
        ln -s /var/lib/espocrm/client-custom "$root/client/custom"; \
    fi; \
    for web_dir in "$root" "$root/public"; do \
        if [ -d "$web_dir" ]; then printf 'ok\n' > "$web_dir/status"; fi; \
    done; \
    printf 'EspoCRM install root: %s\n' "$root" >&2

# Serve the install root (or its public/ directory) on 8080 with the rewrites
# EspoCRM's .htaccess needs. The data/, custom/ and install/ locations are
# denied over HTTP: the data directory holds EspoCRM's config and uploads, and
# the installation is done by the CLI, so the web installer must never be
# reachable after the image exists.
RUN set -eux; \
    root=$(cat /etc/espocrm-root); \
    docroot=$root; \
    if [ -d "$root/public" ]; then docroot=$root/public; fi; \
    printf '%s\n' "$docroot" > /etc/espocrm-docroot; \
    a2enmod rewrite headers >/dev/null; \
    sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf; \
    printf '%s\n' \
        '<VirtualHost *:8080>' \
        '    ServerName localhost' \
        "    DocumentRoot $docroot" \
        "    <Directory $docroot>" \
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
