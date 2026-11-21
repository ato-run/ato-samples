#!/bin/bash
# Build the flattened Gitea image for one CPU platform and print its image ID.
set -euo pipefail

src=gitea/gitea@sha256:1c17ecaead42eb3b5391553d8708103a4beb0e86edf5b9ebc1eb269c318845f2

usage() {
  echo "usage: $0 linux/amd64|linux/arm64" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

platform=$1
case $platform in
  linux/amd64) arch=amd64 ;;
  linux/arm64) arch=arm64 ;;
  *)
    echo "$0: unsupported platform: $platform" >&2
    usage
    exit 2
    ;;
esac

tag="localhost/ato-samples/gitea-flat:1.27.3-$arch"

# Pull the pinned source for exactly this platform. Build on a machine with the
# guest's CPU: the exported filesystem contains that CPU's binaries.
docker pull --platform "$platform" "$src"
cid=$(docker create --platform "$platform" "$src")
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

# The Runner refuses image VOLUME declarations, so the filesystem is re-imported
# flat with the original user, environment and entrypoint.
docker export "$cid" | docker import \
  --change 'USER 1000:1000' \
  --change 'WORKDIR /var/lib/gitea' \
  --change 'ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
  --change 'ENV GITEA_WORK_DIR=/var/lib/gitea GITEA_CUSTOM=/var/lib/gitea/custom GITEA_TEMP=/tmp/gitea TMPDIR=/tmp/gitea GITEA_APP_INI=/etc/gitea/app.ini HOME=/var/lib/gitea/git' \
  --change 'EXPOSE 3000' \
  --change 'ENTRYPOINT ["/usr/bin/dumb-init","--","/usr/local/bin/docker-entrypoint.sh"]' \
  - "$tag" >/dev/null

echo "built $tag for $platform" >&2
docker image inspect --format '{{.Id}}' "$tag"
