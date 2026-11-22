#!/usr/bin/env bash
# Build the listmonk image (listmonk plus PostgreSQL) and flatten it into the
# single-layer, non-root image the Ato Runner accepts.
#
# The release is listmonk v6.2.0, the current stable release (published
# 2026-06-26). The version is a constant below and its official image is
# addressed by the digest of that release's manifest list entry for the
# platform being built. The tag alone is never accepted, and neither is
# another release's digest, because this sample was written against this one
# release's OIDC implementation (coreos/go-oidc v3.14.1 and the settings-table
# storage of the OIDC configuration).
#
# The digests are on the manifest list of listmonk/listmonk:v6.2.0:
#   index (manifest list)          sha256:f535d59e14991337a9f2d570273685378ae86b0d7698c3e00da444e3bc205286
#   linux/amd64 image manifest     sha256:3089042a786beddb096410da3818b98ce9fe35bdc0a4ad4550f92be674b17291
#   linux/arm64 image manifest     sha256:137c35dc989cd8e500fc449b3b86bf405b690d39cb779c0df9a988ed0bd8d7ba
#
# The image is built by image/Dockerfile: the official image supplies the
# listmonk binary and Debian "bookworm" supplies PostgreSQL 15 (a portable
# capsule carries one filesystem state, so the database lives in the same
# container and state as the app). build then flattens the result once, at the
# end: the flattened filesystem keeps the base ENV, declares no VOLUME, removes
# the ENTRYPOINT (start.sh is the entry point) and sets USER 1000:1000 outside
# the Runner.
#
# Usage:
#   LISTMONK_IMAGE=listmonk/listmonk:v6.2.0@sha256:<digest for PLATFORM> ./build-images.sh PLATFORM
# Prints one reference on stdout: the flattened listmonk image, in the
# digest-pinned local form capsule.toml requires
# (localhost/ato-e2e/listmonk-flat@sha256:...).
set -euo pipefail

listmonk_version=v6.2.0
listmonk_index_digest=sha256:f535d59e14991337a9f2d570273685378ae86b0d7698c3e00da444e3bc205286
listmonk_digest_amd64=sha256:3089042a786beddb096410da3818b98ce9fe35bdc0a4ad4550f92be674b17291
listmonk_digest_arm64=sha256:137c35dc989cd8e500fc449b3b86bf405b690d39cb779c0df9a988ed0bd8d7ba

usage() {
  echo "usage: LISTMONK_IMAGE=listmonk/listmonk:${listmonk_version}@sha256:<digest> build-images.sh PLATFORM" >&2
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
  amd64) expected_digest=$listmonk_digest_amd64 ;;
  arm64) expected_digest=$listmonk_digest_arm64 ;;
  *) die "unsupported platform: $platform (this sample is pinned for linux/amd64 and linux/arm64)" ;;
esac

[ -n "${LISTMONK_IMAGE:-}" ] || die "LISTMONK_IMAGE is required: listmonk/listmonk:${listmonk_version}@$expected_digest"
case $LISTMONK_IMAGE in
  listmonk/listmonk:${listmonk_version}@sha256:*|docker.io/listmonk/listmonk:${listmonk_version}@sha256:*) ;;
  *) die "LISTMONK_IMAGE must pin listmonk/listmonk:${listmonk_version} by digest, got: $LISTMONK_IMAGE" ;;
esac
digest=${LISTMONK_IMAGE##*@}
[ "$digest" = "$expected_digest" ] || die "LISTMONK_IMAGE digest $digest is not the pinned $platform digest $expected_digest"
[ "$digest" != "$listmonk_index_digest" ] || die "LISTMONK_IMAGE names the manifest list; use the $platform image manifest digest"

app_source="listmonk-ato:${listmonk_version#v}-$arch"
flat_app=localhost/ato-e2e/listmonk-flat

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

echo "build-images.sh: pulling $LISTMONK_IMAGE for $platform (listmonk $listmonk_version, index $listmonk_index_digest)" >&2
docker pull --platform "$platform" "$LISTMONK_IMAGE" >&2

echo "build-images.sh: building $app_source for $platform" >&2
docker build --platform "$platform" \
  --build-arg "LISTMONK_IMAGE=$LISTMONK_IMAGE" \
  -t "$app_source" "$here/image" >&2

flatten "$app_source" 1000:1000 "$flat_app"

echo "build-images.sh: built the listmonk $listmonk_version image for $platform" >&2
printf 'localhost/ato-e2e/listmonk-flat@%s\n' "$flattened"
