#!/bin/sh
# Render capsule.toml from capsule.toml.in.
#
# The app image, the Redis image and the platform are parameters instead of
# being committed here: image ids are CPU-specific and a rendered capsule.toml
# belongs to one Instance.
#
# Usage: ./render.sh APP_IMAGE REDIS_IMAGE PLATFORM > capsule.toml
#   APP_IMAGE:   Paperless-ngx image, as printed by build-images.sh
#   REDIS_IMAGE: Redis image, as printed by build-images.sh
#   PLATFORM:    the Runner platform, e.g. linux/amd64
set -eu

usage() {
  echo "usage: render.sh APP_IMAGE REDIS_IMAGE PLATFORM > capsule.toml" >&2
  exit 2
}
die() { echo "render.sh: $*" >&2; exit 1; }

[ $# -eq 3 ] || usage
app_image=$1
redis_image=$2
platform=$3

case $platform in
  linux/*) arch=${platform#linux/} ;;
  *) arch=$platform; platform="linux/$arch" ;;
esac
case $arch in
  ''|*[!a-z0-9]*) die "unsupported PLATFORM: $platform (e.g. linux/amd64)" ;;
esac

for image in "$app_image" "$redis_image"; do
  case $image in
    sha256:*|*@sha256:*) ;;
    *) die "image must be pinned by digest (sha256:... or repo@sha256:...): $image" ;;
  esac
  case $image in
    *[!A-Za-z0-9._/:@-]*) die "invalid image reference: $image" ;;
  esac
done

here=$(cd "$(dirname "$0")" >/dev/null && pwd) || exit 1
template=$here/capsule.toml.in
[ -f "$template" ] || die "missing $template"

# The values are substituted with '|' as the sed delimiter, so escape the
# characters sed treats specially in a replacement.
escape() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }

rendered=$(sed \
  -e "s|@APP_IMAGE@|$(escape "$app_image")|g" \
  -e "s|@REDIS_IMAGE@|$(escape "$redis_image")|g" \
  -e "s|@PLATFORM@|$(escape "$platform")|g" \
  -e "s|@ARCH@|$(escape "$arch")|g" \
  "$template")

case $rendered in
  *"@APP_IMAGE@"*|*"@REDIS_IMAGE@"*|*"@PLATFORM@"*|*"@ARCH@"*)
    die "a placeholder survived rendering" ;;
esac

printf '%s\n' "$rendered"
