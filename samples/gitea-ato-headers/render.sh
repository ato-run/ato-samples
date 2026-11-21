#!/bin/sh
# Render capsule.toml from capsule.toml.in for one CPU platform.
set -eu

usage() {
  echo "usage: $0 IMAGE_REF linux/amd64|linux/arm64 > capsule.toml" >&2
}

if [ "$#" -ne 2 ]; then
  usage
  exit 2
fi

image=$1
platform=$2

if [ -z "$image" ]; then
  echo "$0: IMAGE_REF must not be empty" >&2
  exit 2
fi

case $image in
  *[!A-Za-z0-9._:/@-]*)
    echo "$0: IMAGE_REF must be a Docker image reference: $image" >&2
    exit 2
    ;;
esac

case $platform in
  linux/amd64) arch=amd64 ;;
  linux/arm64) arch=arm64 ;;
  *)
    echo "$0: unsupported platform: $platform" >&2
    usage
    exit 2
    ;;
esac

template=$(dirname "$0")/capsule.toml.in

sed \
  -e "s|@IMAGE@|$image|g" \
  -e "s|@PLATFORM@|$platform|g" \
  -e "s|@ARCH@|linux-$arch|g" \
  "$template"
