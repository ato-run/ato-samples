#!/usr/bin/env bash
# Build the Gatus image (the official release binary plus the runtime tools the
# loopback issuer front needs) and flatten it into the single-layer, non-root
# image the Ato Runner accepts.
#
# The release is Gatus v5.38.0, the current stable release (published
# 2026-10-28). The version is a constant below and its official image is
# addressed by the digest of that release's manifest list entry for the platform
# being built. The tag alone is never accepted, and neither is another release's
# digest, because this sample was written against this one release's OIDC
# implementation (coreos/go-oidc v3, security/oidc.go).
#
# The official image is built FROM scratch: it carries the /gatus binary and the
# CA bundle and nothing else (no shell, no /tmp), so it cannot run start.sh or
# the loopback HTTPS front the issuer discovery needs. image/Dockerfile takes
# the binary from the official image and puts it on Debian "bookworm-slim"
# (bash, curl, openssl, python3, ca-certificates), then build flattens the result
# once, at the end: the flattened filesystem keeps the base ENV, declares no
# VOLUME, removes the ENTRYPOINT (start.sh is the entry point) and sets USER
# 1000:1000 outside the Runner.
#
# The digests are on the manifest list of twinproduction/gatus:v5.38.0:
#   index (manifest list)          sha256:085ed63da963728965d00a3c78aa6167e3bf135218485b893201758e079e8415
#   linux/amd64 image manifest     sha256:20f9ae4963ea074521b8da7f438c797d571a58dc51b24abd08d218a6e17b0aca
#   linux/arm64 image manifest     sha256:80e309905cc9a3980c45c62f807ac37c45c0c0df492ff898e8115346f668711c
#
# Usage:
#   GATUS_IMAGE=twinproduction/gatus:v5.38.0@sha256:<digest for PLATFORM> ./build-images.sh PLATFORM
# Prints one reference on stdout: the flattened Gatus image, in the
# digest-pinned local form capsule.toml requires
# (localhost/ato-e2e/gatus-flat@sha256:...).
set -euo pipefail

gatus_version=v5.38.0
gatus_index_digest=sha256:085ed63da963728965d00a3c78aa6167e3bf135218485b893201758e079e8415
gatus_digest_amd64=sha256:20f9ae4963ea074521b8da7f438c797d571a58dc51b24abd08d218a6e17b0aca
gatus_digest_arm64=sha256:80e309905cc9a3980c45c62f807ac37c45c0c0df492ff898e8115346f668711c

usage() {
  echo "usage: GATUS_IMAGE=twinproduction/gatus:${gatus_version}@sha256:<digest> build-images.sh PLATFORM" >&2
  exit 2
}
die() { echo "build-images.sh: $*" >&2; exit 1; }

[ $# -eq 1 ] || usage
platform=$1
case $platform in
  linux/*) arch=${platform#linux/} ;;
  *) arch=$platform; platform="linux/$arch" ;;
esac
case $arch in
  amd64) expected_digest=$gatus_digest_amd64 ;;
  arm64) expected_digest=$gatus_digest_arm64 ;;
  *) die "unsupported platform: $platform (this sample is pinned for linux/amd64 and linux/arm64)" ;;
esac

[ -n "${GATUS_IMAGE:-}" ] || die "GATUS_IMAGE is required: twinproduction/gatus:${gatus_version}@$expected_digest"
case $GATUS_IMAGE in
  twinproduction/gatus:${gatus_version}@sha256:*|docker.io/twinproduction/gatus:${gatus_version}@sha256:*) ;;
  *) die "GATUS_IMAGE must pin twinproduction/gatus:${gatus_version} by digest, got: $GATUS_IMAGE" ;;
esac
digest=${GATUS_IMAGE##*@}
[ "$digest" = "$expected_digest" ] || die "GATUS_IMAGE digest $digest is not the pinned $platform digest $expected_digest"
[ "$digest" != "$gatus_index_digest" ] || die "GATUS_IMAGE names the manifest list; use the $platform image manifest digest"

app_source="gatus-ato:${gatus_version#v}-$arch"
flat_app=localhost/ato-e2e/gatus-flat

here=$(cd "$(dirname "$0")" >/dev/null && pwd) || exit 1

command -v docker >/dev/null 2>&1 || die "docker is required"

cid=
cleanup() {
  if [ -n "$cid" ]; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

flattened=
# flatten IMAGE USER TAG: set "flattened" to the new image id. It is called in
# this shell, not in a command substitution: bash does not inherit errexit into
# $(...), so a failed docker import would otherwise be masked and the script
# would print an empty image id while reporting success.
flatten() {
  local image=$1 user=$2 tag=$3
  local workdir env_list env_line key value image_id
  local -a args
  workdir=$(docker image inspect --format '{{.Config.WorkingDir}}' "$image")
  env_list=$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image")
  args=(--change "USER $user" --change 'ENTRYPOINT []' --change "WORKDIR ${workdir:-/}")
  while IFS= read -r env_line; do
    [ -n "$env_line" ] || continue
    case $env_line in
      *=*) ;;
      *) continue ;;
    esac
    key=${env_line%%=*}
    value=${env_line#*=}
    # Escape backslash then double quote; docker import receives the value as
    # a quoted string, so values containing spaces stay one ENV value.
    value=${value//\\/\\\\}
    value=${value//\"/\\\"}
    args+=(--change "ENV $key=\"$value\"")
  done <<< "$env_list"
  cid=$(docker create --platform "$platform" "$image")
  image_id=$(docker export "$cid" | docker import "${args[@]}" - "$tag") || {
    echo "build-images.sh: cannot flatten $image" >&2
    return 1
  }
  docker rm -f "$cid" >/dev/null
  cid=
  [ -n "$image_id" ] || {
    echo "build-images.sh: docker import returned no image id for $image" >&2
    return 1
  }
  flattened=$image_id
}

echo "build-images.sh: pulling $GATUS_IMAGE for $platform (Gatus $gatus_version, index $gatus_index_digest)" >&2
docker pull --platform "$platform" "$GATUS_IMAGE" >&2

echo "build-images.sh: building $app_source for $platform" >&2
docker build --platform "$platform" \
  --build-arg "GATUS_IMAGE=$GATUS_IMAGE" \
  -t "$app_source" "$here/image" >&2

flatten "$app_source" 1000:1000 "$flat_app"

echo "build-images.sh: built the Gatus $gatus_version image for $platform" >&2
printf 'localhost/ato-e2e/gatus-flat@%s\n' "$flattened"
