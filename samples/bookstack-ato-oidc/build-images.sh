#!/bin/sh
# Build the two images this sample runs and flatten them into the single-layer,
# non-root images the Ato Runner accepts.
#
# Ato runs a workload read-only: it flattens the image filesystem and does not
# want VOLUME declarations, root users or the image's entrypoint. flatten()
# below exports the built filesystem and imports it back with the original
# image's ENV and WORKDIR, USER 33:33 (BookStack) or 999:999 (MariaDB) and no
# ENTRYPOINT; the import has no VOLUME.
#
# The pinned php and mariadb digests are linux/amd64; a linux/arm64 Runner
# needs the arm64 digests of the same tags (see README.md). The app image is
# therefore built for the CPU of the Runner that will run it.
#
# Usage: ./build-images.sh PLATFORM      (PLATFORM such as linux/amd64)
# Prints two image ids on stdout: the BookStack image, then the MariaDB image.
set -eu

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

# linux/amd64 digests that the Dockerfile and this script pin.
amd64_php_digest=sha256:e520186957084dc0a5baaea83b2ef0c20b16e78c1de31b6fdb21dc1240cce42e
db_source=mariadb@sha256:a8992b5e5404d11e03c54a31d0c1bdea3fd116d283aa6d1a627551f29045309b

app_source="bookstack-ato:26.09.3-$arch"
flat_app=localhost/ato-e2e/bookstack-flat
flat_db=localhost/ato-e2e/mariadb-flat

here=$(cd "$(dirname "$0")" >/dev/null && pwd) || exit 1

command -v docker >/dev/null 2>&1 || { echo "build-images.sh: docker is required" >&2; exit 1; }

if [ "$arch" != amd64 ] && grep -q "$amd64_php_digest" "$here/image/Dockerfile"; then
  echo "build-images.sh: image/Dockerfile still pins the linux/amd64 php digest." >&2
  echo "Replace it (and the mariadb digest above) with the $arch digest first; see README.md." >&2
  exit 1
fi

echo "build-images.sh: building $app_source for $platform" >&2
docker build --platform "$platform" -t "$app_source" "$here/image" >&2

echo "build-images.sh: pulling $db_source for $platform" >&2
docker pull --platform "$platform" "$db_source" >&2

cid=
cleanup() {
  if [ -n "$cid" ]; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# flatten IMAGE USER TAG: print the flattened image id.
flatten() {
  image=$1
  user=$2
  tag=$3
  workdir=$(docker image inspect --format '{{.Config.WorkingDir}}' "$image")
  env_file=$(mktemp)
  docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" > "$env_file"
  set -- --change "USER $user" --change 'ENTRYPOINT []' --change "WORKDIR ${workdir:-/}"
  while IFS= read -r env_line; do
    [ -n "$env_line" ] || continue
    set -- "$@" --change "ENV $env_line"
  done < "$env_file"
  rm -f "$env_file"
  cid=$(docker create --platform "$platform" "$image")
  image_id=$(docker export "$cid" | docker import "$@" - "$tag")
  docker rm -f "$cid" >/dev/null
  cid=
  printf '%s\n' "$image_id"
}

app_image=$(flatten "$app_source" 33:33 "$flat_app")
db_image=$(flatten "$db_source" 999:999 "$flat_db")

echo "build-images.sh: built the BookStack and MariaDB images for $platform" >&2
printf '%s\n' "$app_image"
printf '%s\n' "$db_image"
