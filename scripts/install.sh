#!/usr/bin/env bash
# OpenLex installer (macOS, Linux; Windows: WSL or Git Bash for the CLI).
#
#   curl -fsSL https://openlex.pinemarshlands.com/install | bash                 # CLI + engine
#   curl -fsSL https://openlex.pinemarshlands.com/install | bash -s -- --app     # desktop app
#   curl -fsSL https://openlex.pinemarshlands.com/install | bash -s -- --all     # both
#   ... | bash -s -- --version 0.3.0     (a given version instead of the latest)
#
# CLI + engine: installed into ~/.openlex (no root, no system changes),
# `openlex` linked into ~/.local/bin. Needs Node.js >= 20.
# Desktop app (--app): macOS: OpenLex.app into /Applications (or
# ~/Applications); Linux: the AppImage into ~/Applications plus a menu entry.
# Everything is downloaded from the GitHub release and checked against its
# published sha256 before it is used; with cosign or gh installed, also its
# signature / build attestation (docs/VERIFY.md).
set -euo pipefail

REPO="N9394/openlex"
VERSION="${OPENLEX_VERSION:-}"
PREFIX="${OPENLEX_HOME:-$HOME/.openlex}"
BIN_DIR="${OPENLEX_BIN_DIR:-$HOME/.local/bin}"
# Where the release files are (default: the GitHub release). For mirrors and tests.
RELEASE_URL="${OPENLEX_RELEASE_URL:-}"
WANT_CLI=1
WANT_APP=0
case "${OPENLEX_APP:-}" in 1|true|yes) WANT_CLI=0; WANT_APP=1 ;; esac
case "${OPENLEX_ALL:-}" in 1|true|yes) WANT_CLI=1; WANT_APP=1 ;; esac

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2#v}"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    --app) WANT_CLI=0; WANT_APP=1; shift ;;
    --all) WANT_CLI=1; WANT_APP=1; shift ;;
    -h|--help) sed -n '2,16p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

bold=$(printf '\033[1m'); dim=$(printf '\033[2m'); reset=$(printf '\033[0m')
say() { printf '%s\n' "$*"; }
die() { printf 'openlex install: %s\n' "$*" >&2; exit 1; }

OS=$(uname -s)
command -v curl >/dev/null || die "curl is required"
if command -v sha256sum >/dev/null; then SHA="sha256sum"; elif command -v shasum >/dev/null; then SHA="shasum -a 256"; else die "sha256sum or shasum is required"; fi

if [ "$WANT_APP" = 1 ]; then
  case "$OS" in
    Darwin|Linux) ;;
    MINGW*|MSYS*|CYGWIN*) die "for the desktop app on Windows, run this in PowerShell: \$env:OPENLEX_APP=1; irm https://openlex.pinemarshlands.com/install.ps1 | iex" ;;
    *) die "the desktop app is available for macOS, Windows and Linux only" ;;
  esac
fi
if [ "$WANT_CLI" = 1 ]; then
  command -v tar >/dev/null || die "tar is required"
  if ! command -v node >/dev/null; then
    die "Node.js 20 or newer is required. Install it first (macOS: brew install node · Linux: your package manager or https://nodejs.org), then run this again. (Only the desktop app: add --app.)"
  fi
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  [ "$NODE_MAJOR" -ge 20 ] || die "Node.js $NODE_MAJOR found; OpenLex needs 20 or newer."
fi

if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)
  [ -n "$VERSION" ] || die "could not find the latest release (GitHub API); pass --version X.Y.Z"
fi
BASE="${RELEASE_URL:-https://github.com/$REPO/releases/download/v$VERSION}"
BASE="${BASE%/}"

TMP=$(mktemp -d)
MOUNT=""
cleanup() {
  if [ -n "$MOUNT" ]; then hdiutil detach -quiet "$MOUNT" >/dev/null 2>&1 || hdiutil detach -force -quiet "$MOUNT" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# fetch FILE: download a release file into $TMP and check it. The sha256
# comes from FILE.sha256, or else from the release's SHA256SUMS. Then the
# origin check (see docs/VERIFY.md): the checksum only proves the download
# is intact; it comes from the same release. Releases built by the release
# workflow are also signed (Sigstore) and attested by GitHub. If cosign or
# gh is installed, check that the file was built by this repository's
# release workflow. A failed check stops the install; a missing tool does not.
fetch() {
  local f="$1" expected="" actual checked=""
  curl -fsSL "$BASE/$f" -o "$TMP/$f" || die "${2:-download failed: $BASE/$f}"
  if curl -fsSL "$BASE/$f.sha256" -o "$TMP/$f.sha256" 2>/dev/null; then
    expected=$(cut -d' ' -f1 "$TMP/$f.sha256")
  elif curl -fsSL "$BASE/SHA256SUMS" -o "$TMP/SHA256SUMS" 2>/dev/null; then
    expected=$(awk -v f="$f" '{ n=$2; sub(/^\*/, "", n); if (n == f) { print $1; exit } }' "$TMP/SHA256SUMS")
  else
    die "checksum download failed for $f"
  fi
  [ -n "$expected" ] || die "the release has no checksum for $f — not installing"
  actual=$(cd "$TMP" && $SHA "$f" | cut -d' ' -f1)
  [ "$expected" = "$actual" ] || die "checksum mismatch for $f (expected $expected, got $actual) — not installing"
  say "${dim}✓ sha256 matches the release's checksum file ($f)${reset}"

  local identity="https://github.com/$REPO/.github/workflows/release.yml@refs/tags/v$VERSION"
  local issuer="https://token.actions.githubusercontent.com"
  if curl -fsSL "$BASE/$f.bundle" -o "$TMP/$f.bundle" 2>/dev/null; then
    if command -v cosign >/dev/null; then
      if cosign verify-blob --bundle "$TMP/$f.bundle" --certificate-identity "$identity" \
          --certificate-oidc-issuer "$issuer" "$TMP/$f" >"$TMP/cosign.log" 2>&1; then
        say "${dim}✓ signature (cosign): built by $REPO's release workflow for v$VERSION${reset}"; checked="cosign"
      else
        cat "$TMP/cosign.log" >&2
        die "the signature does not match (cosign verify-blob failed) — not installing"
      fi
    fi
    if command -v gh >/dev/null; then
      if ! gh auth status >/dev/null 2>&1; then
        say "${dim}· gh is installed but not logged in (gh auth login), so the GitHub attestation was not checked${reset}"
      elif gh attestation verify "$TMP/$f" --repo "$REPO" >"$TMP/gh.log" 2>&1; then
        say "${dim}✓ attestation (gh): GitHub build provenance from $REPO${reset}"; checked="$checked gh"
      else
        cat "$TMP/gh.log" >&2
        die "the GitHub attestation does not match (gh attestation verify failed) — not installing"
      fi
    fi
    if [ -z "$checked" ]; then
      say "Only the checksum was checked. To also check who built it, install cosign or gh and run this again (docs/VERIFY.md)."
    fi
  else
    say "Only the checksum was checked: no signature was found for v$VERSION (releases from before signed builds have none)."
  fi
}

install_cli() {
  local name="openlex-$VERSION"
  say "${bold}OpenLex $VERSION${reset} ${dim}(CLI + engine) → $PREFIX${reset}"
  fetch "$name.tar.gz"
  mkdir -p "$PREFIX/versions" "$BIN_DIR"
  rm -rf "$PREFIX/versions/$name"
  tar -xzf "$TMP/$name.tar.gz" -C "$PREFIX/versions"
  ln -sfn "$PREFIX/versions/$name" "$PREFIX/current"
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
}

# macOS: copy OpenLex.app out of the dmg. Files fetched with curl carry no
# quarantine flag, so macOS opens the app without the "unidentified
# developer" prompt; the checks above stand in for Apple's.
install_app_mac() {
  local arch dmg dest app old
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; else arch=x64; fi
  dmg="OpenLex-$VERSION-mac-$arch.dmg"
  dest="${OPENLEX_APP_DIR:-}"
  if [ -z "$dest" ]; then
    dest=/Applications
    if [ ! -w /Applications ] || { [ -e /Applications/OpenLex.app ] && [ ! -w /Applications/OpenLex.app ]; }; then
      dest="$HOME/Applications"
    fi
  fi
  say "${bold}OpenLex $VERSION${reset} ${dim}(desktop app, $([ $arch = arm64 ] && echo 'Apple Silicon' || echo 'Intel')) → $dest${reset}"
  fetch "$dmg" "could not download $dmg (the desktop app is on releases from 0.3.0 on): $BASE/$dmg"
  mkdir -p "$dest" "$TMP/mnt"
  # (Newer macOS prints a deprecation note for -mountpoint; only show hdiutil's output when it fails.)
  hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$TMP/mnt" "$TMP/$dmg" >"$TMP/hdiutil.log" 2>&1 \
    || { cat "$TMP/hdiutil.log" >&2; die "could not open $dmg"; }
  MOUNT="$TMP/mnt"
  [ -d "$MOUNT/OpenLex.app" ] || die "$dmg does not contain OpenLex.app — not installing"
  app="$dest/OpenLex.app"
  rm -rf "$dest/.OpenLex.app.new"
  ditto "$MOUNT/OpenLex.app" "$dest/.OpenLex.app.new" || die "could not copy OpenLex.app to $dest"
  hdiutil detach -quiet "$MOUNT" >/dev/null 2>&1 || true
  MOUNT=""
  if pgrep -xq OpenLex 2>/dev/null; then say "OpenLex is running: quit it and open it again to use the new version."; fi
  rm -rf "$app" || die "could not replace $app"
  mv "$dest/.OpenLex.app.new" "$app"

  say "Installed. ${dim}$app${reset}"
  if [ "$dest" != /Applications ] && [ -d /Applications/OpenLex.app ]; then
    say "An older OpenLex.app is still in /Applications; you can delete it."
  fi
  for old in /Applications/LexVault.app "$HOME/Applications/LexVault.app"; do
    if [ -d "$old" ]; then say "The old ${bold}$old${reset} is no longer needed; you can delete it (your matters and settings stay)."; fi
  done
  say ""
  say "Open it from Launchpad or the Applications folder, or with:"
  say "  open \"$app\""
}

# Linux: the AppImage into ~/Applications, plus a menu entry.
install_app_linux() {
  local file dest target apps
  case "$(uname -m)" in x86_64|amd64) ;; *) die "the desktop app is built for x86_64 Linux only; the CLI works everywhere (run without --app)" ;; esac
  file="OpenLex-$VERSION-linux-x64.AppImage"
  dest="${OPENLEX_APP_DIR:-$HOME/Applications}"
  target="$dest/OpenLex.AppImage"
  say "${bold}OpenLex $VERSION${reset} ${dim}(desktop app) → $target${reset}"
  fetch "$file" "could not download $file (the desktop app is on releases from 0.3.0 on): $BASE/$file"
  mkdir -p "$dest"
  chmod +x "$TMP/$file"
  mv -f "$TMP/$file" "$target"

  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$apps"
  cat > "$apps/openlex.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=OpenLex
Comment=Open-source, local-first legal AI
Exec="$target" %U
Icon=openlex
Terminal=false
Categories=Office;
StartupWMClass=OpenLex
EOF
  if command -v update-desktop-database >/dev/null; then update-desktop-database "$apps" >/dev/null 2>&1 || true; fi

  say "Installed. ${dim}$target (menu entry: $apps/openlex.desktop)${reset}"
  if ! { ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null; } | grep -q 'libfuse\.so\.2'; then
    say ""
    say "AppImages need ${bold}libfuse2${reset}. If OpenLex does not start, install it:"
    say "  sudo apt install libfuse2      ${dim}# Ubuntu 24.04 and newer: sudo apt install libfuse2t64${reset}"
  fi
  say ""
  say "Open it from your applications menu, or with:"
  say "  \"$target\""
}

if [ "$WANT_CLI" = 1 ]; then install_cli; fi
if [ "$WANT_APP" = 1 ]; then
  if [ "$WANT_CLI" = 1 ]; then say ""; fi
  if [ "$OS" = Darwin ]; then install_app_mac; else install_app_linux; fi
fi
