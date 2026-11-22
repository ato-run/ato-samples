# Gatus 5.38.0 for the Ato Runner.
#
# Ato runs a workload's image read-only, without capabilities and as a non-root
# user (uid 1000). The image is flattened before use (build-images.sh exports and
# re-imports the filesystem), so it must not declare VOLUME and start.sh is the
# entry point.
#
# The official twinproduction/gatus image is built FROM scratch: it carries the
# static Go binary, the default config and the CA bundle, and no shell, no /tmp
# and no interpreter. This sample needs three of those at run time:
#   - /bin/sh and bash for start.sh (it waits for the issuer front and runs the
#     server),
#   - openssl to make the loopback CA and certificate that present the public
#     issuer URL to Gatus,
#   - python3 for the loopback HTTPS front (oidc-relay-proxy.py), because
#     coreos/go-oidc's discovery refuses a document whose issuer differs from the
#     URL it fetched (see start.sh and README.md).
# So the binary is copied out of the official, digest-pinned image and placed on
# Debian "bookworm-slim"; the Debian digest is bookworm-slim's manifest list
# (2026-11-04), which resolves per platform.
ARG GATUS_IMAGE=invalid.invalid/gatus:unset

FROM ${GATUS_IMAGE} AS gatus

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc

# curl and python3 are used by start.sh and the issuer front; openssl makes the
# loopback certificate on every start. The last commands fail the build instead
# of shipping an image without what start.sh needs.
RUN set -eux; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        openssl \
        python3; \
    rm -rf /var/lib/apt/lists/*; \
    command -v bash; \
    command -v curl; \
    command -v openssl; \
    command -v python3

# The Runner runs the container as uid 1000 without adding an entry to
# /etc/passwd; the account is here so tools that look the effective user up by
# uid find one.
RUN set -eux; \
    groupadd --gid 1000 gatus; \
    useradd --uid 1000 --gid 1000 --create-home --shell /usr/sbin/nologin gatus; \
    getent passwd 1000; \
    getent group 1000

# The Gatus binary is the one from the pinned official release image.
COPY --from=gatus /gatus /usr/local/bin/gatus

# The loopback HTTPS front for the Runner's plain-http issuer relay.
COPY oidc-relay-proxy.py /usr/local/lib/ato-gatus/oidc-relay-proxy.py

RUN set -eux; \
    chmod 0755 /usr/local/bin/gatus /usr/local/lib/ato-gatus/oidc-relay-proxy.py; \
    ls -l /usr/local/bin/gatus

WORKDIR /app
EXPOSE 8080
