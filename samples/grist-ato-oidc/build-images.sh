#!/usr/bin/env bash
# Build the Grist image (the official open-source build, flattened) for the Ato
# Runner.
#
# The release is the official gristlabs/grist-oss image, pinned to 1.7.22: the
# version is a constant below and the image is addressed by the digest of that
# release's manifest list entry for the platform being built. The tag alone is
# never accepted, and neither is another release's digest, because this sample
# is verified against this one release (its OIDC implementation is what the
# sample is written for).
#
# The digests are on the manifest list of gristlabs/grist-oss:1.7.22 (published
# 2026-10-30):
#   index (manifest list)          sha256:40d2c0ce0c29b2aa1ec1dcf9652ec26a13a8f2b4b44116733bcede428afd27dc
#   linux/amd64 image manifest     sha256:48f5642170fb20a83f835b30c3356d7472fe9fe5b2cc94bbfe70b73d83d4ec2d
#   linux/arm64 image manifest     sha256:c612d328dd36ee7b3b188d2c3b6af3eaadaeba95640846f1c87dd05746553490
#
# There is no Dockerfile: the image already carries the Grist build, Python
# 3.11 with the formula sandbox requirements and the node/grist users. Ato runs
# it read-only, as a non-root user, without its ENTRYPOINT, and with /app as the
# mounted workspace (start.sh). The image is flattened once, at the end, so a
# VOLUME (there is none) would be dropped, ENTRYPOINT is removed, and the base
# ENV is kept.
#
# Usage:
#   GRIST_IMAGE=gristlabs/grist-oss:1.7.22@sha256:<digest for PLATFORM> ./build-images.sh PLATFORM
# Prints one reference on stdout: the flattened Grist image, in the
# digest-pinned local form capsule.toml requires
# (localhost/ato-e2e/grist-flat@sha256:...).
set -euo pipefail

grist_version=1.7.22
grist_index_digest=sha256:40d2c0ce0c29b2aa1ec1dcf9652ec26a13a8f2b4b44116733bcede428afd27dc
grist_digest_amd64=sha256:48f5642170fb20a83f835b30c3356d7472fe9fe5b2cc94bbfe70b73d83d4ec2d
grist_digest_arm64=sha256:c612d328dd36ee7b3b188d2c3b6af3eaadaeba95640846f1c87dd05746553490

usage() {
  echo "usage: GRIST_IMAGE=gristlabs/grist-oss:${grist_version}@sha256:<digest> build-images.sh PLATFORM" >&2
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
  amd64) expected_digest=$grist_digest_amd64 ;;
  arm64) expected_digest=$grist_digest_arm64 ;;
  *) die "unsupported platform: $platform (this sample is pinned for linux/amd64 and linux/arm64)" ;;
esac

[ -n "${GRIST_IMAGE:-}" ] || die "GRIST_IMAGE is required: gristlabs/grist-oss:${grist_version}@$expected_digest"
case $GRIST_IMAGE in
  gristlabs/grist-oss:${grist_version}@sha256:*|docker.io/gristlabs/grist-oss:${grist_version}@sha256:*) ;;
  *) die "GRIST_IMAGE must pin gristlabs/grist-oss:${grist_version} by digest, got: $GRIST_IMAGE" ;;
esac
digest=${GRIST_IMAGE##*@}
[ "$digest" = "$expected_digest" ] || die "GRIST_IMAGE digest $digest is not the pinned $platform digest $expected_digest"
[ "$digest" != "$grist_index_digest" ] || die "GRIST_IMAGE names the manifest list; use the $platform image manifest digest"

flat_app=localhost/ato-e2e/grist-flat

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

echo "build-images.sh: pulling $GRIST_IMAGE for $platform (Grist $grist_version, index $grist_index_digest)" >&2
docker pull --platform "$platform" "$GRIST_IMAGE" >&2

echo "build-images.sh: flattening the Grist image for $platform" >&2
flatten "$GRIST_IMAGE" 1000:1000 "$flat_app"

echo "build-images.sh: built the Grist $grist_version image for $platform" >&2
printf 'localhost/ato-e2e/grist-flat@%s\n' "$flattened"