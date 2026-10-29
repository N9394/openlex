#!/usr/bin/env bash
# Build the OpenLex CLI + engine release tarball (one file for macOS, Linux
# and Windows; needs Node >= 20 on the target, no native modules).
#
#   scripts/package-cli.sh            → dist/openlex-<version>.tar.gz (+ .sha256)
#
# Contents: sidecar/{src,bin/*.js,tui,playbooks,skills,package.json} with
# production node_modules (optional native deps left out: better-sqlite3,
# onnxruntime, transformers — the engine runs without them), the Word add-in
# files the engine serves, docs, LICENSE, README. Models are not included:
# use a cloud key, or a local llama.cpp (`brew install llama.cpp`) plus a GGUF.
#
# Reproducible: with GNU tar (Linux, or `gtar` from Homebrew) the archive has
# sorted entries, owner 0:0, normalised permissions and every mtime set to
# SOURCE_DATE_EPOCH (default: the time of the last commit), and gzip writes
# no timestamp. The same commit + lockfile gives the same bytes. The release
# workflow (.github/workflows/release.yml) builds it this way; see docs/VERIFY.md.
set -euo pipefail
umask 022
cd "$(dirname "$0")/.."
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}"
export SOURCE_DATE_EPOCH
VERSION=$(node -p "require('./sidecar/package.json').version")
NAME="openlex-${VERSION}"
DIST="dist"
STAGE="$DIST/$NAME"
rm -rf "$STAGE" "$DIST/$NAME.tar.gz" "$DIST/$NAME.tar.gz.sha256"
mkdir -p "$STAGE/sidecar/bin" "$STAGE/add-in"

cp -R sidecar/src sidecar/playbooks sidecar/skills "$STAGE/sidecar/"
cp sidecar/bin/*.js "$STAGE/sidecar/bin/"
cp -R sidecar/tui "$STAGE/sidecar/"
cp sidecar/package.json sidecar/package-lock.json sidecar/README.md "$STAGE/sidecar/"
cp add-in/commands.html add-in/manifest.xml add-in/taskpane.css add-in/taskpane.html add-in/taskpane.js "$STAGE/add-in/"
cp -R add-in/assets "$STAGE/add-in/assets"
cp -R add-in/lib "$STAGE/add-in/lib"
cp -R docs LICENSE README.md "$STAGE/"

# Production dependencies only, no native optional modules, no install scripts.
(cd "$STAGE/sidecar" && npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --loglevel=error)
# Guard: nothing platform-specific may slip in (the tarball is shared by all platforms).
if find "$STAGE/sidecar/node_modules" -name '*.node' | grep -q .; then
  echo "native module found in node_modules — the tarball would not be portable" >&2
  find "$STAGE/sidecar/node_modules" -name '*.node' >&2
  exit 1
fi
# No symlinks: Windows' tar.exe cannot create them without admin rights or
# Developer Mode. npm's .bin links are not used at runtime.
rm -rf "$STAGE/sidecar/node_modules/.bin"
if find "$STAGE" -type l | grep -q .; then
  echo "symlink found — the tarball would not unpack on Windows" >&2
  find "$STAGE" -type l >&2
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
# The same for Windows (cmd.exe wants CRLF line endings).
printf '@echo off\r\nnode "%%~dp0sidecar\\bin\\openlex.js" %%*\r\n' > "$STAGE/openlex.cmd"

# Archive. GNU tar gives a byte-for-byte reproducible result; BSD tar (macOS
# default) still gets a fixed owner but no sorted entries or fixed mtimes.
GNUTAR=""
for t in gtar tar; do
  if command -v "$t" >/dev/null 2>&1 && "$t" --version 2>/dev/null | grep -q 'GNU tar'; then GNUTAR="$t"; break; fi
done
if [ -n "$GNUTAR" ]; then
  (cd "$DIST" && "$GNUTAR" --format=gnu --sort=name --mtime="@$SOURCE_DATE_EPOCH" \
     --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' \
     -cf - "$NAME" | gzip -9 -n > "$NAME.tar.gz")
else
  echo "note: GNU tar not found, so the archive is not byte-for-byte reproducible (brew install gnu-tar)" >&2
  (cd "$DIST" && COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root -cf - "$NAME" | gzip -9 -n > "$NAME.tar.gz")
fi
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$DIST" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
else
  (cd "$DIST" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
fi
echo "$DIST/$NAME.tar.gz ($(du -h "$DIST/$NAME.tar.gz" | cut -f1)) sha256 $(cut -d' ' -f1 "$DIST/$NAME.tar.gz.sha256")"
