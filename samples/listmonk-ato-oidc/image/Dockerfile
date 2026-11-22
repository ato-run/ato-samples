# listmonk 6.2.0 and PostgreSQL 15, one filesystem, for the Ato Runner.
#
# Ato runs a workload's image read-only, without capabilities and as a non-root
# user (uid 1000). The image is flattened before use (build-images.sh exports
# and re-imports the filesystem), so it must not declare VOLUME and start.sh is
# the entry point. The code and the PostgreSQL binaries are image content; the
# Instance's one state directory /var/lib/listmonk holds PostgreSQL's data
# directory and listmonk's uploaded media.
#
# The official listmonk image supplies the stuffed listmonk binary (release
# v6.2.0, addressed by digest; build-images.sh requires the per-platform digest
# and passes it as LISTMONK_IMAGE). Debian "bookworm" supplies PostgreSQL 15
# from the distribution: a portable capsule can carry only one filesystem state
# and no state may be shared by two services, so the database shares this image
# and that one state. start.sh runs PostgreSQL itself (no cluster manager), on
# loopback only, with its datadir under the state.
#
# The Debian digest is debian:bookworm-slim's manifest list (2026-11-05), which
# resolves per platform; the listmonk digest is per platform and is a build
# argument.
ARG LISTMONK_IMAGE=invalid.invalid/listmonk:unset

FROM ${LISTMONK_IMAGE} AS listmonk

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc

# The policy-rc.d stub stops the PostgreSQL package's post-install from starting
# a server during the build; start.sh owns the server at run time. The cluster
# the package creates under /var/lib/postgresql is removed: the database must
# run as the container user from the state directory. The last commands fail
# the build instead of shipping an image without what start.sh needs.
RUN set -eux; \
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; \
    chmod +x /usr/sbin/policy-rc.d; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        openssl \
        python3 \
        postgresql \
        postgresql-contrib; \
    rm -rf /var/lib/apt/lists/* /var/lib/postgresql /var/log/postgresql /run/postgresql; \
    rm -f /usr/sbin/policy-rc.d; \
    command -v curl; \
    command -v openssl; \
    command -v python3; \
    ls /usr/lib/postgresql/*/bin/initdb; \
    ls /usr/share/postgresql/*/extension/pgcrypto.control

# The Runner runs the container as uid 1000 without adding an entry to
# /etc/passwd. PostgreSQL's initdb (and psql) look the effective user up by uid,
# so the image carries the account the Runner uses, with its home directory.
RUN set -eux; \
    groupadd --gid 1000 listmonk; \
    useradd --uid 1000 --gid 1000 --create-home --shell /usr/sbin/nologin listmonk; \
    getent passwd 1000; \
    getent group 1000

# The stuffed release binary: frontend assets, SQL queries, schema and email
# templates are inside it, so no other listmonk files are needed.
COPY --from=listmonk /listmonk/listmonk /usr/local/bin/listmonk

# The HTTPS front for the Runner's plain-http issuer relay. listmonk discovers
# the provider with coreos/go-oidc's oidc.NewProvider, which refuses a document
# whose issuer is not the URL it fetched; the proxy presents the public issuer
# URL on loopback and forwards to the relay (see start.sh and README.md).
COPY oidc-relay-proxy.py /usr/local/lib/ato-listmonk/oidc-relay-proxy.py

RUN set -eux; \
    chmod 0755 /usr/local/bin/listmonk /usr/local/lib/ato-listmonk/oidc-relay-proxy.py; \
    listmonk --version

WORKDIR /app
EXPOSE 9000