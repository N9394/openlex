#!/bin/bash
# Build + publish the Word plugin auto-update payload (sidecar/src + add-in).
#
# The payload is a code zip (NOT a full installer): the sidecar downloads it,
# sha256-verifies, swaps sidecar/src + add-in in place, restarts itself.
# Full installers stay on /api/app/plugin/* for new installs.
#
# Output:
#   dist/lexvault-word-plugin-{mac,win}-<ver>.zip   payload
#   dist/plugin-{mac,win}.json                      manifest (published)
#   uploaded by the distributor to its update server
#
# Usage: scripts/build-update.sh [version]   (default: bump 0.1.0 → 0.1.1)
set -euo pipefail
cd "$(dirname "$0")/.."

CUR="$(python3 -c "import json;print(json.load(open('sidecar/package.json'))['version'])")"
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(python3 -c "
import re
v='$CUR'.split('.')
v[2]=str(int(v[2])+1)
print('.'.join(v))")"
fi
ROOT="$(pwd)"
mkdir -p dist

for PLATFORM in mac win; do
  ZIP="dist/lexvault-word-plugin-$PLATFORM-$VERSION.zip"
  echo "== building $PLATFORM payload v$VERSION =="
  rm -f "$ZIP"
  # Zip with top-level sidecar/ + add-in/ dirs (mirrors install layout, so
  # the updater's applyUpdate can swap files in place). Build from a temp
  # staging dir with the exact structure the installer uses:
  #   sidecar/src/*.js   add-in/*.{html,js,css,xml}  add-in/assets/*
  STAGE="dist/update-stage"
  rm -rf "$STAGE"
  mkdir -p "$STAGE/sidecar" "$STAGE/add-in"
  cp -R sidecar/src "$STAGE/sidecar/src"
  # Version marker: update.js reads sidecar/src/.version in preference to
  # package.json, so applied payloads report the real version (prevents the
  # perpetual "update available" re-apply loop).
  echo "$VERSION" > "$STAGE/sidecar/src/.version"
  # Updates swap only sidecar/src and add-in, so bundled skills/playbooks and the
  # distributor's distribution.json travel inside src/.
  mkdir -p "$STAGE/sidecar/src/bundled"
  cp -R sidecar/skills "$STAGE/sidecar/src/bundled/skills"
  cp -R sidecar/playbooks "$STAGE/sidecar/src/bundled/playbooks"
  if [ -n "${OPENLEX_DISTRIBUTION:-}" ]; then cp "$OPENLEX_DISTRIBUTION" "$STAGE/sidecar/src/distribution.json"
  else echo "  (no OPENLEX_DISTRIBUTION: community payload — installed plugins would lose their licence/update server)"; fi
  cp -R add-in/commands.html add-in/manifest.xml add-in/taskpane.css add-in/taskpane.html add-in/taskpane.js "$STAGE/add-in/"
  cp -R add-in/assets "$STAGE/add-in/assets"
  ( cd "$STAGE" && zip -qr "$ROOT/$ZIP" sidecar add-in -x '*.map' )

  SHA="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
  SIZE="$(stat -f%z "$ZIP")"
  echo "  $ZIP ($(echo "$SIZE" | awk '{printf "%.1f MB", $1/1048576}')) sha256=$SHA"

  cat > "dist/plugin-$PLATFORM.json" <<JSON
{
  "version": "$VERSION",
  "filename": "$(basename "$ZIP")",
  "sha256": "$SHA",
  "size_bytes": $SIZE,
  "notes": "OpenLex Word plugin update (engine + pane code)."
}
JSON
done

# Also bump package.json + version marker so local sidecar reports the new version.
python3 - <<PY
import json
p = 'sidecar/package.json'
d = json.load(open(p))
d['version'] = '$VERSION'
json.dump(d, open(p, 'w'), indent=2)
print('sidecar/package.json → $VERSION')
PY

echo
echo "== built: upload dist/lexvault-word-plugin-*-$VERSION.zip and dist/plugin-*.json to your update server (the distributor's publish step) =="
echo
echo "== done: v$CUR → v$VERSION built =="
