# BookStack 26.09.3 for the Ato Runner.
#
# Ato runs a workload's image read-only, without capabilities and as a
# non-root user. The image is flattened before use (build-images.sh exports
# and re-imports the filesystem), so it must not declare VOLUME. BookStack's
# code and vendor/ live here in the image; the Instance's state directory
# /var/lib/bookstack holds only config and data, because a state checkpoint is
# limited to 64 MiB.
#
# The php digest below is php:8.3-apache for linux/amd64. A linux/arm64 Runner
# needs the arm64 digest of the same tag instead (use
# `docker buildx imagetools inspect php:8.3-apache`); the composer digest is
# the multi-arch index and usually needs no change.
FROM php@sha256:e520186957084dc0a5baaea83b2ef0c20b16e78c1de31b6fdb21dc1240cce42e

# BookStack needs gd, pdo_mysql and zip on top of the base image. The base
# already carries dom, xml, mbstring, tokenizer, openssl and iconv; the check
# at the end fails the build instead of shipping a BookStack that is missing
# one of them.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        libfreetype6-dev \
        libjpeg62-turbo-dev \
        libpng-dev \
        libzip-dev; \
    rm -rf /var/lib/apt/lists/*; \
    docker-php-ext-configure gd --with-freetype --with-jpeg; \
    docker-php-ext-install -j"$(nproc)" gd pdo_mysql zip; \
    php -r 'foreach (["gd", "pdo_mysql", "zip", "dom", "xml", "mbstring", "tokenizer", "openssl", "iconv", "fileinfo", "ctype", "json"] as $extension) { if (!extension_loaded($extension)) { fwrite(STDERR, "missing PHP extension: {$extension}\n"); exit(1); } }'

# Composer is only needed at build time to install the app's dependencies.
COPY --from=composer@sha256:50ea4d33fdcde1adb0f045547295faa1548b33872e5f789dae5b02ce2fb5de93 /usr/bin/composer /usr/local/bin/composer

# BookStack v26.09.3, pinned by the archive checksum.
ADD --checksum=sha256:d2547a63aee9bca10281eeffcb4965cb3a85f20217d62430c538ec6ad4817a75 \
    https://github.com/BookStackApp/BookStack/archive/refs/tags/v26.09.3.tar.gz /tmp/bookstack.tar.gz

WORKDIR /var/www/bookstack
RUN set -eux; \
    tar -xzf /tmp/bookstack.tar.gz --strip-components=1 -C /var/www/bookstack; \
    rm /tmp/bookstack.tar.gz; \
    composer install --no-dev --optimize-autoloader --no-interaction --no-progress

# Apache: serve public/ on 8080 and let public/.htaccess rewrite (mod_rewrite).
# The pid file, logs and lock live under /tmp because the image is read-only.
RUN set -eux; \
    a2enmod rewrite; \
    sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf; \
    sed -i -e 's#<VirtualHost \*:80>#<VirtualHost *:8080>#' \
           -e 's#DocumentRoot /var/www/html#DocumentRoot /var/www/bookstack/public#' \
           /etc/apache2/sites-available/000-default.conf; \
    printf '<Directory /var/www/bookstack/public>\n    AllowOverride All\n    Require all granted\n</Directory>\n' \
        > /etc/apache2/conf-available/bookstack.conf; \
    a2enconf bookstack

# Everything BookStack writes is a symlink into the state directory that
# start.sh creates on first start: Laravel's storage, the bootstrap cache, the
# uploads directory and the .env the service rewrites on every start.
RUN set -eux; \
    mkdir -p /var/lib/bookstack/storage /var/lib/bookstack/bootstrap-cache /var/lib/bookstack/uploads; \
    rm -rf /var/www/bookstack/storage /var/www/bookstack/bootstrap/cache /var/www/bookstack/public/uploads; \
    ln -s /var/lib/bookstack/storage /var/www/bookstack/storage; \
    ln -s /var/lib/bookstack/bootstrap-cache /var/www/bookstack/bootstrap/cache; \
    ln -s /var/lib/bookstack/uploads /var/www/bookstack/public/uploads; \
    ln -s /var/lib/bookstack/.env /var/www/bookstack/.env

EXPOSE 8080
