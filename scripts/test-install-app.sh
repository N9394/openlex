#!/usr/bin/env bash
# Tests `install.sh --app` against a fake release served from this computer
# (no network, no real release needed). Used by CI on macOS and Linux.
#
#   bash scripts/test-install-app.sh
#
# Checks: the app is installed from a release whose checksum matches; the
# SHA256SUMS fallback works; a checksum mismatch stops the install and
# leaves nothing behind. macOS: a tiny dmg made with hdiutil, the app has
# no quarantine flag. Linux: the AppImage is executable and has a menu entry.
# OPENLEX_APP_DIR (optional): where the app goes (default: the installer's
# default, /Applications on macOS, ~/Applications on Linux).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
V=9.9.9
WORK=$(mktemp -d)
PORT=${PORT:-8765}
SERVER=""
cleanup() { [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
if command -v sha256sum >/dev/null; then SHA="sha256sum"; else SHA="shasum -a 256"; fi

mkdir -p "$WORK/good" "$WORK/sums" "$WORK/bad" "$WORK/home"
case "$(uname -s)" in
  Darwin)
    app="$WORK/src/OpenLex.app"
    mkdir -p "$app/Contents/MacOS"
    printf '#!/bin/sh\necho fake OpenLex\n' > "$app/Contents/MacOS/OpenLex"
    chmod +x "$app/Contents/MacOS/OpenLex"
    cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>OpenLex</string>
<key>CFBundleIdentifier</key><string>com.lexvault.app.test</string>
<key>CFBundleName</key><string>OpenLex</string>
<key>CFBundleShortVersionString</key><string>$V</string>
</dict></plist>
EOF
    ln -s /Applications "$WORK/src/Applications"
    hdiutil create -quiet -volname "OpenLex $V" -srcfolder "$WORK/src" -format UDZO -ov "$WORK/fake.dmg"
    FILES=("OpenLex-$V-mac-arm64.dmg" "OpenLex-$V-mac-x64.dmg")
    for f in "${FILES[@]}"; do cp "$WORK/fake.dmg" "$WORK/good/$f"; done
    ;;
  Linux)
    FILES=("OpenLex-$V-linux-x64.AppImage")
    printf '#!/bin/sh\necho fake OpenLex\n' > "$WORK/good/${FILES[0]}"
    ;;
  *) fail "macOS or Linux only" ;;
esac

for f in "${FILES[@]}"; do
  (cd "$WORK/good" && $SHA "$f" > "$f.sha256")
  # sums: only a SHA256SUMS file, no per-file .sha256
  cp "$WORK/good/$f" "$WORK/sums/$f"
  (cd "$WORK/sums" && $SHA "$f" >> SHA256SUMS)
  # bad: the published checksum belongs to other bytes
  cp "$WORK/good/$f" "$WORK/bad/$f"
  printf 'tampered' >> "$WORK/bad/$f"
  cp "$WORK/good/$f.sha256" "$WORK/bad/$f.sha256"
done

(cd "$WORK" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >"$WORK/http.log" 2>&1) &
SERVER=$!
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.2; done

run() {  # run DIR: install.sh --app against the fake release in DIR
  OPENLEX_VERSION=$V OPENLEX_RELEASE_URL="http://127.0.0.1:$PORT/$1" \
    bash "$HERE/install.sh" --app 2>&1 | tee "$WORK/$1.log"
  return "${PIPESTATUS[0]}"
}

check_installed() {
  case "$(uname -s)" in
    Darwin)
      dest="${OPENLEX_APP_DIR:-/Applications}"
      [ -x "$dest/OpenLex.app/Contents/MacOS/OpenLex" ] || fail "OpenLex.app not installed in $dest"
      [ ! -e "$dest/.OpenLex.app.new" ] || fail "staging copy left behind"
      if xattr -p com.apple.quarantine "$dest/OpenLex.app" >/dev/null 2>&1; then fail "the app has a quarantine flag"; fi
      if hdiutil info | grep -q "OpenLex-$V-mac"; then fail "the dmg is still mounted"; fi
      ;;
    Linux)
      dest="${OPENLEX_APP_DIR:-$HOME/Applications}"
      [ -x "$dest/OpenLex.AppImage" ] || fail "AppImage not installed or not executable"
      [ "$("$dest/OpenLex.AppImage")" = "fake OpenLex" ] || fail "AppImage does not run"
      grep -q "^Exec=\"$dest/OpenLex.AppImage\"" "${XDG_DATA_HOME:-$HOME/.local/share}/applications/openlex.desktop" || fail "no menu entry"
      ;;
  esac
}

echo "== install from a release with per-file checksums"
run good || fail "install failed"
grep -q "sha256 matches" "$WORK/good.log" || fail "no checksum message"
grep -q "Only the checksum was checked" "$WORK/good.log" || fail "no 'Only the checksum was checked' message"
check_installed

echo "== install from a release with only SHA256SUMS"
run sums || fail "install (SHA256SUMS) failed"
grep -q "sha256 matches" "$WORK/sums.log" || fail "no checksum message (SHA256SUMS)"
check_installed

echo "== checksum mismatch must stop the install"
case "$(uname -s)" in
  Darwin) dest="${OPENLEX_APP_DIR:-/Applications}"; marker="$dest/OpenLex.app/Contents/MacOS/OpenLex" ;;
  Linux) dest="${OPENLEX_APP_DIR:-$HOME/Applications}"; marker="$dest/OpenLex.AppImage" ;;
esac
before=$($SHA "$marker" | cut -d' ' -f1)
if run bad; then fail "install went ahead despite a checksum mismatch"; fi
grep -q "checksum mismatch" "$WORK/bad.log" || fail "no mismatch message"
[ "$($SHA "$marker" | cut -d' ' -f1)" = "$before" ] || fail "the installed app was changed by a failed install"

echo "OK: install.sh --app"
