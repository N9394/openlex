#!/usr/bin/env bash
# Smoke-test a CLI tarball built by scripts/package-cli.sh:
#   - the checksum file matches,
#   - it unpacks, contains no symlinks (Windows' tar.exe cannot create them),
#   - every sidecar/bin/*.js of this checkout is inside,
#   - no native modules (*.node) slipped in, and no ONNX runtime or
#     tokenizer (those come with the desktop app only),
#   - the name finder reports itself as not available ("needs the desktop app"),
#   - `./openlex help` runs.
#
#   scripts/check-cli-tarball.sh [dist/openlex-<version>.tar.gz]
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./sidecar/package.json').version")
TARBALL="${1:-dist/openlex-${VERSION}.tar.gz}"
NAME=$(basename "$TARBALL" .tar.gz)
fail() { echo "FAIL: $*" >&2; exit 1; }

[ -f "$TARBALL" ] || fail "$TARBALL not found (run scripts/package-cli.sh first)"
[ -f "$TARBALL.sha256" ] || fail "$TARBALL.sha256 not found"
want=$(cut -d' ' -f1 "$TARBALL.sha256")
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$TARBALL" | cut -d' ' -f1); else got=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1); fi
[ "$want" = "$got" ] || fail "checksum mismatch: file $got, .sha256 says $want"
echo "ok   sha256 $got"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$TARBALL" -C "$TMP"
ROOT="$TMP/$NAME"
[ -d "$ROOT" ] || fail "tarball does not contain $NAME/"

if find "$ROOT" -type l | grep -q .; then find "$ROOT" -type l >&2; fail "symlinks in the tarball"; fi
echo "ok   no symlinks"
if find "$ROOT" -name '*.node' | grep -q .; then find "$ROOT" -name '*.node' >&2; fail "native modules in the tarball"; fi
echo "ok   no native modules"
for d in onnxruntime-node onnxruntime-common onnxruntime-web @huggingface/tokenizers @huggingface/transformers sharp; do
  [ ! -e "$ROOT/sidecar/node_modules/$d" ] || fail "sidecar/node_modules/$d in the tarball (the ONNX runtime is for the desktop app only)"
done
echo "ok   no ONNX runtime, no tokenizer"
st=$(cd "$TMP" && LEXVAULT_DATA_DIR="$TMP/data" HOME="$TMP/home" node -e "const s=require('$ROOT/sidecar/src/pii_ner').status(); console.log(JSON.stringify({ available: s.available, reason: s.runtime.reason }))")
[ "$st" = '{"available":false,"reason":"not-bundled"}' ] || fail "name finder status in the tarball: $st (expected not available, not bundled)"
echo "ok   name finder: not available here (needs the desktop app)"

missing=0
for f in sidecar/bin/*.js; do
  if [ ! -f "$ROOT/$f" ]; then echo "missing: $f" >&2; missing=1; fi
done
[ "$missing" = 0 ] || fail "sidecar/bin files missing from the tarball"
echo "ok   all sidecar/bin/*.js present ($(ls sidecar/bin/*.js | wc -l | tr -d ' '))"
for f in openlex openlex.cmd LICENSE README.md sidecar/package.json add-in/manifest.xml; do
  [ -e "$ROOT/$f" ] || fail "$f missing"
done
[ -x "$ROOT/openlex" ] || fail "openlex launcher is not executable"

# Run with a throwaway data dir so the check never touches a real install.
out=$(LEXVAULT_DATA_DIR="$TMP/data" HOME="$TMP/home" "$ROOT/openlex" help 2>&1) || { echo "$out" >&2; fail "./openlex help exited non-zero"; }
echo "$out" | grep -qi 'openlex' || { echo "$out" >&2; fail "./openlex help printed no usage"; }
echo "ok   ./openlex help runs"
echo "PASS $TARBALL"
