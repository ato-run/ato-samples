#!/usr/bin/env bash
# Build the prebuilt quick-start workspace for the OSS walkthrough:
# three sample capsules + a digest-pinned workspace.toml, in one tarball.
#
# The Excalidraw sample needs a Vite build; pass its built `dist/` (or let the
# CI workflow build it) so first-time developers never run npm.
#
# Usage:
#   tools/build-quickstart-bundle.sh --out <dir> --ato <ato> \
#     [--excalidraw-dist <dir>] [--version <tag>]
set -euo pipefail

ato=ato
out=
excalidraw_dist=
version=dev
samples_dir=
root=$(git rev-parse --show-toplevel)

while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --ato) ato=$2; shift 2 ;;
    --excalidraw-dist) excalidraw_dist=$2; shift 2 ;;
    --version) version=$2; shift 2 ;;
    --samples-dir) samples_dir=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] || { echo "--out is required" >&2; exit 2; }
samples_dir=${samples_dir:-$root/samples}
[ -n "$excalidraw_dist" ] || { echo "--excalidraw-dist is required (build the Excalidraw sample first)" >&2; exit 2; }
for sample in shared-json-todo shared-json-calendar; do
  [ -f "$samples_dir/$sample/capsule.toml" ] || { echo "missing $samples_dir/$sample/capsule.toml" >&2; exit 2; }
done

mkdir -p "$out"
out=$(cd "$out" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/ato-quickstart.XXXXXX")
trap 'rm -rf "$work"' EXIT

pkg="$work/ato-oss-quick-start-$version"
mkdir -p "$pkg"
echo "packing TODO"
"$ato" pack "$samples_dir/shared-json-todo" -o "$pkg/todo.capsule" >/dev/null
echo "packing Calendar"
"$ato" pack "$samples_dir/shared-json-calendar" -o "$pkg/calendar.capsule" >/dev/null
echo "packing Excalidraw"
"$ato" pack "$excalidraw_dist" -o "$pkg/excalidraw.capsule" >/dev/null

digest() { shasum -a 256 "$1" | awk '{print "sha256:"$1}'; }
cat > "$pkg/workspace.toml" <<EOF
# The OSS quick-start workspace. The capsules are prebuilt; the digests pin the
# exact bytes the walkthrough was tested with.
schema = "ato.workspace/1"

[layout]
direction = "horizontal"
split = [0.4, 0.3, 0.3]

[[pane]]
id = "todo"
app = "todo"
capsule = "todo.capsule"
digest = "$(digest "$pkg/todo.capsule")"

[[pane]]
id = "calendar"
app = "calendar"
capsule = "calendar.capsule"
digest = "$(digest "$pkg/calendar.capsule")"

[[pane]]
id = "excalidraw"
app = "excalidraw"
capsule = "excalidraw.capsule"
digest = "$(digest "$pkg/excalidraw.capsule")"
EOF
cat > "$pkg/README.md" <<EOF
# ato OSS quick start ($version)

Open this workspace with:

    ato workspace open workspace.toml --local-data --checkpoint-out workspace.checkpoint.toml

Then edit, press Checkpoint (Ctrl-S), and Stop and save. Resume with
\`--checkpoint workspace.checkpoint.toml\`. See docs/guides/quick-start-first-workspace.md
in the ato repository.
EOF
( cd "$work" && tar czf "$out/ato-oss-quick-start-$version.tar.gz" "ato-oss-quick-start-$version" )
( cd "$out" && shasum -a 256 "ato-oss-quick-start-$version.tar.gz" > "ato-oss-quick-start-$version.tar.gz.sha256" )
echo "wrote $out/ato-oss-quick-start-$version.tar.gz"
