#!/bin/sh
# Render capsule.toml from capsule.toml.in.
#
# The app image is CPU-specific and the app URL is the Instance's public
# origin, so both are parameters instead of being committed here.
#
# Usage: ./render.sh APP_IMAGE PLATFORM APP_URL > capsule.toml
#   APP_IMAGE: image id (sha256:...) or a digest-pinned reference, as printed
#              by build-images.sh
#   PLATFORM:  the Runner platform, e.g. linux/amd64
#   APP_URL:   the Instance's public https origin (ends up as EspoCRM's siteUrl)
set -eu

usage() {
  echo "usage: render.sh APP_IMAGE PLATFORM APP_URL > capsule.toml" >&2
  exit 2
}
die() { echo "render.sh: $*" >&2; exit 1; }

[ $# -eq 3 ] || usage
app_image=$1
platform=$2
app_url=$3

case $platform in
  linux/*) arch=${platform#linux/} ;;
  *) arch=$platform; platform="linux/$arch" ;;
esac
case $arch in
  ''|*[!a-z0-9]*) die "unsupported PLATFORM: $platform (e.g. linux/amd64)" ;;
esac

case $app_url in
  http://*|https://*) ;;
  *) die "APP_URL must start with http:// or https://: $app_url" ;;
esac
case $app_url in
  *' '*) die "APP_URL must not contain spaces: $app_url" ;;
esac
app_url=${app_url%/}

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
  -e "s|@APP_URL@|$(escape "$app_url")|g" \
  "$template")

case $rendered in
  *"@APP_IMAGE@"*|*"@PLATFORM@"*|*"@ARCH@"*|*"@APP_URL@"*)
    die "a placeholder survived rendering" ;;
esac

printf '%s\n' "$rendered"
