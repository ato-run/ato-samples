#!/usr/bin/env bash
# Build the TriliumNext image (the official image, flattened) for the Ato Runner.
#
# The release is the official triliumnext/trilium image, pinned to v0.107.0: the
# version is a constant below and the image is addressed by the digest of that
# release's manifest list entry for the platform being built. The tag alone is
# never accepted, and neither is another release's digest, because this sample is
# verified against this one release.
#
# The digests are on the manifest list of triliumnext/trilium:v0.107.0 (published
# 2026-11-08, matching GitHub Release v0.107.0):
#   index (manifest list)          sha256:739ba0f0488f506549f7c21dc9e792decd99382cc759f01d5ec1abba32e87da8
#   linux/amd64 image manifest     sha256:ac72ce66f562a1d6d1baedf7d5c1672f19c3ba1b048603e50c8fc8114c80c502
#   linux/arm64 image manifest     sha256:07a65ffe23c708f9b67a3d2f0f260b5bbf960c8a4c47dc450afd73a0c1488f9e
#   (the same manifest list also carries linux/arm/v7 and linux/arm/v8; this
#   sample supports the two platforms a Runner runs, amd64 and arm64.)
#
# There is no Dockerfile: the image carries Node 24 and the built server with its
# assets. Ato runs it read-only, as a non-root user, and with this workspace
# mounted at /app (the image's application code is /usr/src/app). The upstream
# image declares no VOLUME and no ENTRYPOINT (its CMD is start-docker.sh, which
# runs the server as root for the Docker use case; this sample does not use it).
# The image is flattened once, at the end, so the CMD/HEALTHCHECK are dropped,
# USER is set to 1000:1000 (the image's node user) and the base ENV is kept.
#
# Usage:
#   TRILIUM_IMAGE=triliumnext/trilium:v0.107.0@sha256:<digest for PLATFORM> ./build-images.sh PLATFORM
# Prints one reference on stdout: the flattened TriliumNext image, in the
# digest-pinned local form capsule.toml requires
# (localhost/ato-e2e/trilium-next-flat@sha256:...).
set -euo pipefail

trilium_version=v0.107.0
trilium_index_digest=sha256:739ba0f0488f506549f7c21dc9e792decd99382cc759f01d5ec1abba32e87da8
trilium_digest_amd64=sha256:ac72ce66f562a1d6d1baedf7d5c1672f19c3ba1b048603e50c8fc8114c80c502
trilium_digest_arm64=sha256:07a65ffe23c708f9b67a3d2f0f260b5bbf960c8a4c47dc450afd73a0c1488f9e

usage() {
  echo "usage: TRILIUM_IMAGE=triliumnext/trilium:${trilium_version}@sha256:<digest> build-images.sh PLATFORM" >&2
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
  amd64) expected_digest=$trilium_digest_amd64 ;;
  arm64) expected_digest=$trilium_digest_arm64 ;;
  *) die "unsupported platform: $platform (this sample is pinned for linux/amd64 and linux/arm64)" ;;
esac

[ -n "${TRILIUM_IMAGE:-}" ] || die "TRILIUM_IMAGE is required: triliumnext/trilium:${trilium_version}@$expected_digest"
case $TRILIUM_IMAGE in
  triliumnext/trilium:${trilium_version}@sha256:*|docker.io/triliumnext/trilium:${trilium_version}@sha256:*) ;;
  *) die "TRILIUM_IMAGE must pin triliumnext/trilium:${trilium_version} by digest, got: $TRILIUM_IMAGE" ;;
esac
digest=${TRILIUM_IMAGE##*@}
[ "$digest" = "$expected_digest" ] || die "TRILIUM_IMAGE digest $digest is not the pinned $platform digest $expected_digest"
[ "$digest" != "$trilium_index_digest" ] || die "TRILIUM_IMAGE names the manifest list; use the $platform image manifest digest"

flat_app=localhost/ato-e2e/trilium-next-flat

command -v docker >/dev/null 2>&1 || die "docker is required"

cid=
cleanup() {
  if [ -n "$cid" ]; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

flattened=
# flatten IMAGE USER TAG: set "flattened" to the new image id. Called in this
# shell, not in a command substitution: bash does not inherit errexit into $(...),
# so a failed docker import would otherwise be masked and the script would print
# an empty image id while reporting success.
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

echo "build-images.sh: pulling $TRILIUM_IMAGE for $platform (TriliumNext $trilium_version, index $trilium_index_digest)" >&2
docker pull --platform "$platform" "$TRILIUM_IMAGE" >&2

echo "build-images.sh: flattening the TriliumNext image for $platform" >&2
flatten "$TRILIUM_IMAGE" 1000:1000 "$flat_app"

echo "build-images.sh: built the TriliumNext $trilium_version image for $platform" >&2
printf 'localhost/ato-e2e/trilium-next-flat@%s\n' "$flattened"
