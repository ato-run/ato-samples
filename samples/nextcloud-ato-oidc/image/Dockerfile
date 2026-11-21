# Nextcloud 31 for the Ato Runner. The code is part of the image (read-only);
# the Instance's one state directory, /var/lib/nextcloud, holds config/ and
# data/. Ato's state checkpoints are bounded in size, and the code would not fit.
FROM nextcloud:31-apache
# user_oidc 8.13.0 (Nextcloud 29-36), verified by its release checksum. It is
# part of the read-only code: there is no app store in this installation.
ADD --checksum=sha256:6f13fa0477144a6812d8648626c64cee91807d1d0b60ca41424543086b9e2775 \
    https://github.com/nextcloud-releases/user_oidc/releases/download/v8.13.0/user_oidc-v8.13.0.tar.gz /tmp/user_oidc.tar.gz
RUN tar -xzf /tmp/user_oidc.tar.gz -C /usr/src/nextcloud/apps && rm /tmp/user_oidc.tar.gz
RUN find /usr/src/nextcloud -type l | while read -r link; do \
      target=$(readlink -f "$link"); rm "$link"; cp -p "$target" "$link"; \
    done \
 && cp -a /usr/src/nextcloud/. /var/www/html/ \
 && mkdir -p /var/www/html/data /var/www/html/custom_apps \
 && rm -f /var/www/html/config/*.config.php \
 && chown www-data:www-data /var/www/html/config /var/www/html/data /var/www/html/custom_apps \
 && sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf \
 && sed -i 's/<VirtualHost \*:80>/<VirtualHost *:8080>/' /etc/apache2/sites-available/000-default.conf
