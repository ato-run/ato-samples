#!/usr/bin/env bash
# Build the BookStack image (BookStack plus its MariaDB server) and flatten it
# into the single-layer, non-root image the Ato Runner accepts.
#
# Ato runs a workload read-only: it flattens the image filesystem and does not
# want VOLUME declarations, root users or the image's entrypoint. flatten()
# below exports the built filesystem and imports it back with the original
# image's ENV and WORKDIR, USER 33:33 and no ENTRYPOINT; the import has no
# VOLUME. Every ENV value is quoted when it is handed to docker import, because
# values such as PHPIZE_DEPS contain spaces and otherwise break the --change
# parser with "Syntax error - can't find = in dpkg-dev".
#
# The pinned php digest is linux/amd64; a linux/arm64 Runner needs the arm64
# digest of the same tag (see README.md). The image is therefore built for the
# CPU of the Runner that will run it.
#
# Usage: ./build-images.sh PLATFORM      (PLATFORM such as linux/amd64)
# Prints one image id on stdout: the BookStack image.
set -euo pipefail

usage() { echo "usage: build-images.sh PLATFORM   (e.g. linux/amd64)" >&2; exit 2; }

[ $# -eq 1 ] || usage
platform=$1
case $platform in
  linux/*) arch=${platform#linux/} ;;
  *) arch=$platform; platform="linux/$arch" ;;
esac
case $arch in
  ''|*[!a-z0-9]*) echo "build-images.sh: unsupported platform: $platform" >&2; exit 2 ;;
esac

# The linux/amd64 php digest that image/Dockerfile pins.
amd64_php_digest=sha256:e520186957084dc0a5baaea83b2ef0c20b16e78c1de31b6fdb21dc1240cce42e

app_source="bookstack-ato:26.09.3-$arch"
flat_app=localhost/ato-e2e/bookstack-flat

here=$(cd "$(dirname "$0")" >/dev/null && pwd) || exit 1

command -v docker >/dev/null 2>&1 || { echo "build-images.sh: docker is required" >&2; exit 1; }

if [ "$arch" != amd64 ] && grep -q "$amd64_php_digest" "$here/image/Dockerfile"; then
  echo "build-images.sh: image/Dockerfile still pins the linux/amd64 php digest." >&2
  echo "Replace it with the $arch digest first; see README.md." >&2
  exit 1
fi

echo "build-images.sh: building $app_source for $platform" >&2
docker build --platform "$platform" -t "$app_source" "$here/image" >&2

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

flatten "$app_source" 33:33 "$flat_app"

echo "build-images.sh: built the BookStack image for $platform" >&2
printf '%s\n' "$flattened"
