#!/usr/bin/env bash
# Build the OpenLex CLI + engine release tarball (one file for macOS, Linux
# and Windows; needs Node >= 20 on the target, no native modules).
#
#   scripts/package-cli.sh            → dist/openlex-<version>.tar.gz (+ .sha256)
#
# Contents: sidecar/{src,bin/openlex.js,bin/client.js,tui,playbooks,skills,package.json} with
# production node_modules (optional native deps left out: better-sqlite3,
# onnxruntime, transformers — the engine runs without them), the Word add-in
# files the engine serves, docs, LICENSE, README. Models are not included:
# use a cloud key, or a local llama.cpp (`brew install llama.cpp`) plus a GGUF.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./sidecar/package.json').version")
NAME="openlex-${VERSION}"
DIST="dist"
STAGE="$DIST/$NAME"
rm -rf "$STAGE" "$DIST/$NAME.tar.gz" "$DIST/$NAME.tar.gz.sha256"
mkdir -p "$STAGE/sidecar/bin" "$STAGE/add-in"

cp -R sidecar/src sidecar/playbooks sidecar/skills "$STAGE/sidecar/"
cp sidecar/bin/openlex.js sidecar/bin/client.js "$STAGE/sidecar/bin/"
cp -R sidecar/tui "$STAGE/sidecar/"
cp sidecar/package.json sidecar/package-lock.json sidecar/README.md "$STAGE/sidecar/"
cp add-in/commands.html add-in/manifest.xml add-in/taskpane.css add-in/taskpane.html add-in/taskpane.js "$STAGE/add-in/"
cp -R add-in/assets "$STAGE/add-in/assets"
cp -R docs LICENSE README.md "$STAGE/"

# Production dependencies only, no native optional modules, no install scripts.
(cd "$STAGE/sidecar" && npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --loglevel=error)
# Guard: nothing platform-specific may slip in (the tarball is shared by all platforms).
if find "$STAGE/sidecar/node_modules" -name '*.node' | grep -q .; then
  echo "native module found in node_modules — the tarball would not be portable" >&2
  find "$STAGE/sidecar/node_modules" -name '*.node' >&2
  exit 1
fi

# Launcher at the top level so `openlex` works from an unpacked tarball too.
cat > "$STAGE/openlex" <<'SH'
#!/usr/bin/env sh
# OpenLex CLI launcher (tarball / Homebrew). Needs Node >= 20.
DIR=$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)
exec node "$DIR/sidecar/bin/openlex.js" "$@"
SH
chmod +x "$STAGE/openlex" "$STAGE/sidecar/bin/openlex.js"

# Reproducible-ish archive: fixed owner, sorted entries.
(cd "$DIST" && COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root -czf "$NAME.tar.gz" "$NAME" 2>/dev/null || COPYFILE_DISABLE=1 tar -czf "$NAME.tar.gz" "$NAME")
(cd "$DIST" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
echo "$DIST/$NAME.tar.gz ($(du -h "$DIST/$NAME.tar.gz" | cut -f1)) sha256 $(cut -d' ' -f1 "$DIST/$NAME.tar.gz.sha256")"
