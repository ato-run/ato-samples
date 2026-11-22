#!/usr/bin/env bash
# Build the Uptime Kuma image (the official image, flattened) for the Ato Runner.
#
# The release is the official louislam/uptime-kuma image, pinned to 2.5.12: the
# version is a constant below and the image is addressed by the digest of that
# release's manifest list entry for the platform being built. The tag alone is
# never accepted, and neither is another release's digest, because this sample is
# verified against this one release.
#
# The digests are on the manifest list of louislam/uptime-kuma:2.5.12 (published
# 2026-11-17):
#   index (manifest list)          sha256:8e4b6bef96417ec98a35dc103c99cc64fc229a01e584e56d95d9004d2003c02a
#   linux/amd64 image manifest     sha256:bc81e600a1b18824e7eaecbb0167c2a1c732475fc499c1e3253752b965946036
#   linux/arm64 image manifest     sha256:e505afc2d098dd4b745ff523d6fed7442ea280ab8a7bca2ee5887267d5491e39
#
# There is no Dockerfile: the image already carries Node 22, the built client
# (dist/) and the SQLite template (db/kuma.db). Ato runs it read-only, as a
# non-root user, without its ENTRYPOINT (dumb-init), and with this workspace
# mounted at /workspace because the image's application code is /app (start.sh).
# The image declares no VOLUME. The image is flattened once, at the end, so the
# ENTRYPOINT is removed, USER is set to 1000:1000 (the image's node user) and the
# base ENV is kept (start.sh turns the embedded-MariaDB offer off).
#
# Usage:
#   UPTIME_KUMA_IMAGE=louislam/uptime-kuma:2.5.12@sha256:<digest for PLATFORM> ./build-images.sh PLATFORM
# Prints one reference on stdout: the flattened Uptime Kuma image, in the
# digest-pinned local form capsule.toml requires
# (localhost/ato-e2e/uptime-kuma-flat@sha256:...).
set -euo pipefail

uptime_kuma_version=2.5.12
uptime_kuma_index_digest=sha256:8e4b6bef96417ec98a35dc103c99cc64fc229a01e584e56d95d9004d2003c02a
uptime_kuma_digest_amd64=sha256:bc81e600a1b18824e7eaecbb0167c2a1c732475fc499c1e3253752b965946036
uptime_kuma_digest_arm64=sha256:e505afc2d098dd4b745ff523d6fed7442ea280ab8a7bca2ee5887267d5491e39

usage() {
  echo "usage: UPTIME_KUMA_IMAGE=louislam/uptime-kuma:${uptime_kuma_version}@sha256:<digest> build-images.sh PLATFORM" >&2
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
  amd64) expected_digest=$uptime_kuma_digest_amd64 ;;
  arm64) expected_digest=$uptime_kuma_digest_arm64 ;;
  *) die "unsupported platform: $platform (this sample is pinned for linux/amd64 and linux/arm64)" ;;
esac

[ -n "${UPTIME_KUMA_IMAGE:-}" ] || die "UPTIME_KUMA_IMAGE is required: louislam/uptime-kuma:${uptime_kuma_version}@$expected_digest"
case $UPTIME_KUMA_IMAGE in
  louislam/uptime-kuma:${uptime_kuma_version}@sha256:*|docker.io/louislam/uptime-kuma:${uptime_kuma_version}@sha256:*) ;;
  *) die "UPTIME_KUMA_IMAGE must pin louislam/uptime-kuma:${uptime_kuma_version} by digest, got: $UPTIME_KUMA_IMAGE" ;;
esac
digest=${UPTIME_KUMA_IMAGE##*@}
[ "$digest" = "$expected_digest" ] || die "UPTIME_KUMA_IMAGE digest $digest is not the pinned $platform digest $expected_digest"
[ "$digest" != "$uptime_kuma_index_digest" ] || die "UPTIME_KUMA_IMAGE names the manifest list; use the $platform image manifest digest"

flat_app=localhost/ato-e2e/uptime-kuma-flat

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

echo "build-images.sh: pulling $UPTIME_KUMA_IMAGE for $platform (Uptime Kuma $uptime_kuma_version, index $uptime_kuma_index_digest)" >&2
docker pull --platform "$platform" "$UPTIME_KUMA_IMAGE" >&2

echo "build-images.sh: flattening the Uptime Kuma image for $platform" >&2
flatten "$UPTIME_KUMA_IMAGE" 1000:1000 "$flat_app"

echo "build-images.sh: built the Uptime Kuma $uptime_kuma_version image for $platform" >&2
printf 'localhost/ato-e2e/uptime-kuma-flat@%s\n' "$flattened"
