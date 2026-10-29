#!/usr/bin/env bash
# OpenLex installer (macOS, Linux; Windows: WSL or Git Bash).
#
#   curl -fsSL https://github.com/N9394/openlex/releases/latest/download/install.sh | bash
#   curl -fsSL https://github.com/N9394/openlex/releases/latest/download/install.sh | bash -s -- --version 0.2.0
#
# Installs the OpenLex engine + CLI into ~/.openlex (no root, no system
# changes) and links `openlex` into ~/.local/bin. Needs Node.js >= 20.
# The package is downloaded from the GitHub release and checked against
# its published sha256 before anything is unpacked; with cosign or gh
# installed, also its signature / build attestation (docs/VERIFY.md).
set -euo pipefail

REPO="N9394/openlex"
VERSION="${OPENLEX_VERSION:-}"
PREFIX="${OPENLEX_HOME:-$HOME/.openlex}"
BIN_DIR="${OPENLEX_BIN_DIR:-$HOME/.local/bin}"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2#v}"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

bold=$(printf '\033[1m'); dim=$(printf '\033[2m'); reset=$(printf '\033[0m')
say() { printf '%s\n' "$*"; }
die() { printf 'openlex install: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v tar >/dev/null || die "tar is required"
if command -v sha256sum >/dev/null; then SHA="sha256sum"; elif command -v shasum >/dev/null; then SHA="shasum -a 256"; else die "sha256sum or shasum is required"; fi

if ! command -v node >/dev/null; then
  die "Node.js 20 or newer is required. Install it first (macOS: brew install node · Linux: your package manager or https://nodejs.org), then run this again."
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js $NODE_MAJOR found; OpenLex needs 20 or newer."

if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)
  [ -n "$VERSION" ] || die "could not find the latest release (GitHub API); pass --version X.Y.Z"
fi

NAME="openlex-$VERSION"
URL="https://github.com/$REPO/releases/download/v$VERSION/$NAME.tar.gz"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "${bold}OpenLex $VERSION${reset} ${dim}→ $PREFIX${reset}"
curl -fsSL "$URL" -o "$TMP/$NAME.tar.gz" || die "download failed: $URL"
curl -fsSL "$URL.sha256" -o "$TMP/$NAME.tar.gz.sha256" || die "checksum download failed"
EXPECTED=$(cut -d' ' -f1 "$TMP/$NAME.tar.gz.sha256")
ACTUAL=$(cd "$TMP" && $SHA "$NAME.tar.gz" | cut -d' ' -f1)
[ "$EXPECTED" = "$ACTUAL" ] || die "checksum mismatch (expected $EXPECTED, got $ACTUAL) — not installing"
say "${dim}✓ sha256 matches the release's checksum file${reset}"

# Origin check (see docs/VERIFY.md). The checksum only proves the download
# is intact; it comes from the same release. Releases built by the release
# workflow are also signed (Sigstore) and attested by GitHub. If cosign or
# gh is installed, check that the tarball was built by this repository's
# release workflow. A failed check stops the install; a missing tool does not.
IDENTITY="https://github.com/$REPO/.github/workflows/release.yml@refs/tags/v$VERSION"
ISSUER="https://token.actions.githubusercontent.com"
CHECKED=""
if curl -fsSL "$URL.bundle" -o "$TMP/$NAME.tar.gz.bundle" 2>/dev/null; then
  if command -v cosign >/dev/null; then
    if cosign verify-blob --bundle "$TMP/$NAME.tar.gz.bundle" --certificate-identity "$IDENTITY" \
        --certificate-oidc-issuer "$ISSUER" "$TMP/$NAME.tar.gz" >"$TMP/cosign.log" 2>&1; then
      say "${dim}✓ signature (cosign): built by $REPO's release workflow for v$VERSION${reset}"; CHECKED="cosign"
    else
      cat "$TMP/cosign.log" >&2
      die "the signature does not match (cosign verify-blob failed) — not installing"
    fi
  fi
  if command -v gh >/dev/null; then
    if ! gh auth status >/dev/null 2>&1; then
      say "${dim}· gh is installed but not logged in (gh auth login), so the GitHub attestation was not checked${reset}"
    elif gh attestation verify "$TMP/$NAME.tar.gz" --repo "$REPO" >"$TMP/gh.log" 2>&1; then
      say "${dim}✓ attestation (gh): GitHub build provenance from $REPO${reset}"; CHECKED="$CHECKED gh"
    else
      cat "$TMP/gh.log" >&2
      die "the GitHub attestation does not match (gh attestation verify failed) — not installing"
    fi
  fi
  if [ -z "$CHECKED" ]; then
    say "Only the checksum was checked. To also check who built it, install cosign or gh and run this again (docs/VERIFY.md)."
  fi
else
  say "Only the checksum was checked: no signature was found for v$VERSION (releases from before signed builds have none)."
fi

mkdir -p "$PREFIX/versions" "$BIN_DIR"
rm -rf "$PREFIX/versions/$NAME"
tar -xzf "$TMP/$NAME.tar.gz" -C "$PREFIX/versions"
ln -sfn "$PREFIX/versions/$NAME" "$PREFIX/current"
ln -sf "$PREFIX/current/openlex" "$BIN_DIR/openlex"

say "Installed. ${dim}$BIN_DIR/openlex → $PREFIX/current${reset}"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say ""; say "Add ${bold}$BIN_DIR${reset} to your PATH, e.g.:"; say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.$(basename "${SHELL:-bash}")rc" ;;
esac
say ""
say "Next:"
say "  openlex serve      ${dim}# start the local engine${reset}"
say "  openlex status"
say ""
say "${dim}Models: your own key (Anthropic, OpenAI, Mistral, …) or a local model (brew install llama.cpp).${reset}"
say "${dim}The data policy is local-only until you allow a provider. Docs: https://github.com/$REPO${reset}"
