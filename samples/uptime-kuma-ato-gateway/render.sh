#!/bin/sh
# Render capsule.toml from capsule.toml.in.
#
# The app image is CPU-specific, so the image reference and the Runner platform
# are parameters instead of being committed here. This app does not need to know
# its public URL (it has no redirect URI and no absolute self link), so there is
# no APP_URL parameter: the Ato gateway is the only way in and the app is served
# under whatever origin the gateway gives it.
#
# Usage: ./render.sh APP_IMAGE PLATFORM > capsule.toml
#   APP_IMAGE: image id (sha256:...) or a digest-pinned reference, as printed
#              by build-images.sh
#   PLATFORM:  the Runner platform, e.g. linux/arm64
set -eu

usage() {
  echo "usage: render.sh APP_IMAGE PLATFORM > capsule.toml" >&2
  exit 2
}
die() { echo "render.sh: $*" >&2; exit 1; }

[ $# -eq 2 ] || usage
app_image=$1
platform=$2

case $platform in
  linux/*) arch=${platform#linux/} ;;
  *) arch=$platform; platform="linux/$arch" ;;
esac
case $arch in
  ''|*[!a-z0-9]*) die "unsupported PLATFORM: $platform (e.g. linux/arm64)" ;;
esac

case $app_image in
  sha256:*|*@sha256:*) ;;
  *) die "APP_IMAGE must be pinned by digest (sha256:... or repo@sha256:...): $app_image" ;;
esac
case $app_image in
  *[!A-Za-z0-9._/:@-]*) die "invalid image reference: $app_image" ;;
esac

here=$(cd "$(dirname "$0")" >/dev/null && pwd) || exit 1
template=$here/capsule.toml.in
[ -f "$template" ] || die "missing $template"

# The values are substituted with '|' as the sed delimiter, so escape the
# characters sed treats specially in a replacement.
escape() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }

rendered=$(sed \
  -e "s|@APP_IMAGE@|$(escape "$app_image")|g" \
  -e "s|@PLATFORM@|$(escape "$platform")|g" \
  -e "s|@ARCH@|$(escape "$arch")|g" \
  "$template")

case $rendered in
  *"@APP_IMAGE@"*|*"@PLATFORM@"*|*"@ARCH@"*)
    die "a placeholder survived rendering" ;;
esac

printf '%s\n' "$rendered"
