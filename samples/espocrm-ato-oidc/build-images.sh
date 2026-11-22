#!/usr/bin/env bash
# Build the EspoCRM image (EspoCRM plus its MariaDB server) and flatten it into
# the single-layer, non-root image the Ato Runner accepts.
#
# The release is the official espocrm/espocrm image, pinned to 9.3.11: the
# version is a constant below and the image is addressed by the digest of that
# release's manifest list entry for the platform being built. The tag alone is
# never accepted, and neither is another release's digest, because this sample
# is verified against this one release (its OIDC implementation and installer
# are what the sample is written for).
#
# The digests are on the manifest list of espocrm/espocrm:9.3.11 (published
# 2026-10-23):
#   index (manifest list)          sha256:c66a18906d54a52e5cda40a3b6b36ac8c8c574deba7b29530c2c6b22227c4d86
#   linux/amd64 image manifest     sha256:7f355480b8be27cc76dfb3eec769bc9f7c3ec968e55208473e8451473e2c54d2
#   linux/arm64 image manifest     sha256:62d569cb48265575cb79521094fe3f36fda898e8bade7d4b303504e7b5eceb72
#
# The image is flattened once, at the end: the official image declares no
# VOLUME, but the Runner runs a single flattened filesystem read-only as a
# non-root user. Flattening keeps the base ENV, removes the ENTRYPOINT
# (start.sh is the entry point) and sets USER 33:33 as the default outside the
# Runner.
#
# Usage:
#   ESPO_IMAGE=espocrm/espocrm:9.3.11@sha256:<digest for PLATFORM> ./build-images.sh PLATFORM
# Prints one reference on stdout: the flattened EspoCRM image, in the
# digest-pinned local form capsule.toml requires
# (localhost/ato-e2e/espocrm-flat@sha256:...).
set -euo pipefail

espocrm_version=9.3.11
espocrm_index_digest=sha256:c66a18906d54a52e5cda40a3b6b36ac8c8c574deba7b29530c2c6b22227c4d86
espocrm_digest_amd64=sha256:7f355480b8be27cc76dfb3eec769bc9f7c3ec968e55208473e8451473e2c54d2
espocrm_digest_arm64=sha256:62d569cb48265575cb79521094fe3f36fda898e8bade7d4b303504e7b5eceb72

usage() {
  echo "usage: ESPO_IMAGE=espocrm/espocrm:${espocrm_version}@sha256:<digest> build-images.sh PLATFORM" >&2
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
  amd64) expected_digest=$espocrm_digest_amd64 ;;
  arm64) expected_digest=$espocrm_digest_arm64 ;;
  *) die "unsupported platform: $platform (this sample is pinned for linux/amd64 and linux/arm64)" ;;
esac

[ -n "${ESPO_IMAGE:-}" ] || die "ESPO_IMAGE is required: espocrm/espocrm:${espocrm_version}@$expected_digest"
case $ESPO_IMAGE in
  espocrm/espocrm:${espocrm_version}@sha256:*|docker.io/espocrm/espocrm:${espocrm_version}@sha256:*) ;;
  *) die "ESPO_IMAGE must pin espocrm/espocrm:${espocrm_version} by digest, got: $ESPO_IMAGE" ;;
esac
digest=${ESPO_IMAGE##*@}
[ "$digest" = "$expected_digest" ] || die "ESPO_IMAGE digest $digest is not the pinned $platform digest $expected_digest"
[ "$digest" != "$espocrm_index_digest" ] || die "ESPO_IMAGE names the manifest list; use the $platform image manifest digest"

app_source="espocrm-ato:${espocrm_version}-${arch}"
flat_app=localhost/ato-e2e/espocrm-flat

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

echo "build-images.sh: pulling $ESPO_IMAGE for $platform (EspoCRM $espocrm_version, index $espocrm_index_digest)" >&2
docker pull --platform "$platform" "$ESPO_IMAGE" >&2

echo "build-images.sh: building $app_source for $platform" >&2
docker build --platform "$platform" \
  --build-arg "ESPOCRM_IMAGE=$ESPO_IMAGE" \
  -t "$app_source" "$here/image" >&2

flatten "$app_source" 33:33 "$flat_app"

echo "build-images.sh: built the EspoCRM $espocrm_version image for $platform" >&2
printf 'localhost/ato-e2e/espocrm-flat@%s\n' "$flattened"