#!/usr/bin/env bash
# Build the Paperless-ngx image and a Redis image for Ato, and flatten both into
# the single-layer, non-root images the Ato Runner accepts.
#
# Paperless-ngx and Redis come from their upstream images; this script only
# pulls the image pinned by tag and per-platform digest and flattens it. Ato
# runs a workload read-only: it flattens the image filesystem and does not want
# VOLUME declarations, root users or the image's own entrypoint. flatten()
# exports the filesystem and imports it back with the original ENV and
# WORKDIR, USER 1000:1000 and no ENTRYPOINT; the import has no VOLUME. Every
# ENV value is quoted when it is handed to docker import, because values
# containing spaces otherwise break the --change parser.
#
# Usage: ./build-images.sh PLATFORM      (PLATFORM such as linux/amd64)
# Prints two image ids on stdout: the Paperless-ngx image, then the Redis image.
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

# ghcr.io/paperless-ngx/paperless-ngx 3.5.1, per-platform digests of the
# multi-arch tag (docker buildx imagetools inspect ghcr.io/paperless-ngx/paperless-ngx:3.5.1).
paperless_repo=ghcr.io/paperless-ngx/paperless-ngx
paperless_tag=3.5.1
# redis 7.4.12-alpine, per-platform digests of docker.io/library/redis:7.4.12-alpine.
redis_repo=redis
redis_tag=7.4.12-alpine

case $arch in
  amd64)
    paperless_digest=sha256:f477d12a1ff8740d9a32bccc50814cd7740bf00d5e2694c294ae0334bb956539
    redis_digest=sha256:e4ee3e03ce8f75471f40937a7c6b2b0e500390b6812fcdf5cb32c01295ded446
    ;;
  arm64)
    paperless_digest=sha256:9738d423031f6b5beede002cdacae3be38fec9b144e71db7332ef76b27aac5d0
    redis_digest=sha256:52d1ea8a654b10f06af3ecda4e9dbcd035c7868b5c49ee7975de917f81de13db
    ;;
  *)
    echo "build-images.sh: $arch has no pinned digest; add one for the upstream tags above" >&2
    exit 1
    ;;
esac

flat_app=localhost/ato-e2e/paperless-flat:"$paperless_tag"-$arch
flat_redis=localhost/ato-e2e/redis-flat:"$redis_tag"-$arch

here=$(cd "$(dirname "$0")" >/dev/null && pwd) || exit 1
: "$here"

command -v docker >/dev/null 2>&1 || { echo "build-images.sh: docker is required" >&2; exit 1; }

echo "build-images.sh: pulling $paperless_repo@$paperless_digest for $platform" >&2
docker pull --platform "$platform" "$paperless_repo@$paperless_digest" >&2
echo "build-images.sh: pulling $redis_repo@$redis_digest for $platform" >&2
docker pull --platform "$platform" "$redis_repo@$redis_digest" >&2

cid=
cleanup() {
  if [ -n "$cid" ]; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# flatten IMAGE TAG: set "flattened" to the new image id. It is called in this
# shell, not in a command substitution: bash does not inherit errexit into
# $(...), so a failed docker import would otherwise be masked.
flattened=
flatten() {
  local image=$1 tag=$2
  local workdir env_list env_line key value image_id
  local -a args
  workdir=$(docker image inspect --format '{{.Config.WorkingDir}}' "$image")
  env_list=$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image")
  args=(--change "USER 1000:1000" --change 'ENTRYPOINT []' --change "WORKDIR ${workdir:-/}")
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
  echo "build-images.sh: flattened $image -> $tag ($image_id)" >&2
}

flatten "$paperless_repo@$paperless_digest" "$flat_app"
app_id=$flattened
flatten "$redis_repo@$redis_digest" "$flat_redis"
redis_id=$flattened

echo "build-images.sh: built the Paperless-ngx and Redis images for $platform" >&2
printf '%s\n%s\n' "$app_id" "$redis_id"
