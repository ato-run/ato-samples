#!/usr/bin/env bash
# Build the EspoCRM image (EspoCRM plus its MariaDB server) and flatten it into
# the single-layer, non-root image the Ato Runner accepts.
#
# The EspoCRM release is the official espocrm/espocrm image, and the version is
# fixed below. The digest is not committed because it is per platform and this
# repository is built on more than one: ESPO_IMAGE must carry the
# linux/<arch> digest of that version, which makes every build reproducible
# from the same published image. The digest is resolved from the registry at
# build time, never from a mutable tag.
#
# Two flattens happen. The first flattens the official image so its VOLUME
# declarations for data/ and custom/ are gone before Dockerfile replaces those
# directories with symlinks into the state (a runtime anonymous volume would
# otherwise hide them and docker export would not carry their content). The
# second flattens the built image into the one layer the Runner runs: no
# VOLUME, no ENTRYPOINT, ENV values preserved and quoted (values with spaces
# would otherwise break docker import), USER 33:33 outside the Runner.
#
# Usage:
#   ESPO_IMAGE=espocrm/espocrm:9.1.5@sha256:<64 hex> ./build-images.sh linux/amd64
# Prints one image id on stdout: the EspoCRM image.
set -euo pipefail

espocrm_version=9.1.5

usage() {
  echo "usage: ESPO_IMAGE=espocrm/espocrm:${espocrm_version}@sha256:<64 hex> build-images.sh PLATFORM" >&2
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
  ''|*[!a-z0-9]*) die "unsupported platform: $platform (e.g. linux/amd64)" ;;
esac

[ -n "${ESPO_IMAGE:-}" ] || die "ESPO_IMAGE is required: the official EspoCRM image pinned by digest (espocrm/espocrm:${espocrm_version}@sha256:...)"
case $ESPO_IMAGE in
  espocrm/espocrm:${espocrm_version}@sha256:*|docker.io/espocrm/espocrm:${espocrm_version}@sha256:*) ;;
  *) die "ESPO_IMAGE must pin espocrm/espocrm:${espocrm_version} by digest, got: $ESPO_IMAGE" ;;
esac
digest=${ESPO_IMAGE##*@}
hex=${digest#sha256:}
case $hex in
  ''|*[!0-9a-f]*) die "ESPO_IMAGE digest is not hexadecimal: $digest" ;;
esac
[ ${#hex} -eq 64 ] || die "ESPO_IMAGE digest must be 64 hex characters: $digest"

app_source="espocrm-ato:${espocrm_version}-${arch}"
flat_base="localhost/ato-e2e/espocrm-base:${espocrm_version}-${arch}"
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

echo "build-images.sh: pulling $ESPO_IMAGE for $platform" >&2
docker pull --platform "$platform" "$ESPO_IMAGE" >&2

echo "build-images.sh: flattening $ESPO_IMAGE (drops its VOLUME declarations)" >&2
flatten "$ESPO_IMAGE" 33:33 "$flat_base"

echo "build-images.sh: building $app_source for $platform" >&2
docker build --platform "$platform" \
  --build-arg "ESPOCRM_IMAGE=$flat_base" \
  -t "$app_source" "$here/image" >&2

flatten "$app_source" 33:33 "$flat_app"

echo "build-images.sh: built the EspoCRM image for $platform" >&2
printf '%s\n' "$flattened"
