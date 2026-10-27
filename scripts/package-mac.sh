#!/bin/bash
# Build the macOS pkg installer for the LexVault Word plugin (A3).
#
# Ships (per arch — arm64 by default, x64 with LEXVAULT_MAC_ARCH=x64):
#   node                     — sidecar runtime (darwin build)
#   sidecar/                 — src + node_modules for darwin-<arch>
#   bin/llama-server + llama-<platform>-<arch>-libs/ + qdrant
#   add-in/                  — manifest.xml + taskpane + icons
#   certs/                   — self-signed localhost cert (generated here)
#   com.lexvault.word-sidecar.plist — LaunchAgent (auto-start at login)
#
# postinstall (runs as root after payload copy):
#   1. copy manifest to the Word WEF folder of every console user
#   2. trust the localhost cert in each user's login keychain
#   3. load the LaunchAgent for the console user
#   4. start the sidecar immediately
#
# Install location: /Library/Application Support/LexVault/WordPlugin
# (admin one-time install; the add-in sideload itself is per-user).
#
# Prereqs: pkgbuild + productbuild (native on macOS), node, npm.
#   Output: dist/LexVault-Word-Plugin-<arch>-<ver>.pkg
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${LEXVAULT_PLUGIN_VERSION:-0.1.0}"
ARCH="${LEXVAULT_MAC_ARCH:-arm64}"
ROOT="$(pwd)"
STAGE="dist/mac-staging"
PAYLOAD="$STAGE/payload/Library/Application Support/LexVault/WordPlugin"
SCRIPTS="$STAGE/scripts"
NODE_VERSION="${LEXVAULT_NODE_VERSION:-v22.23.2}"
PLATFORM="darwin"
APP_BIN="../product/electron/dist/mac-arm64/LexVault.app/Contents/Resources/bin"
if [ "$ARCH" = "x64" ]; then APP_BIN="../product/electron/dist/mac/LexVault.app/Contents/Resources/bin"; fi

echo "== LexVault Word plugin — macOS installer ($ARCH, v$VERSION) =="

# ── 1. Clean stage ──────────────────────────────────────────────────────────
rm -rf "$STAGE"
mkdir -p "$PAYLOAD"/{sidecar,bin,add-in,certs} "$SCRIPTS"

# ── 2. Node runtime (darwin-<arch>) ─────────────────────────────────────────
if [ ! -f "dist/cache/node-${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.gz" ]; then
  echo "… downloading Node $NODE_VERSION ${PLATFORM}-${ARCH}"
  mkdir -p dist/cache
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.gz" \
    -o "dist/cache/node-${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.gz"
fi
tar -xzf "dist/cache/node-${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.gz" -C "$STAGE"
cp "$STAGE/node-${NODE_VERSION}-${PLATFORM}-${ARCH}/bin/node" "$PAYLOAD/node"

# ── 3. Sidecar + deps (darwin-<arch>) ───────────────────────────────────────
echo "… staging sidecar (${PLATFORM}-${ARCH} deps)"
cp -R sidecar/src "$PAYLOAD/sidecar/src"
cp -R sidecar/playbooks "$PAYLOAD/sidecar/playbooks"
cp -R sidecar/skills "$PAYLOAD/sidecar/skills"
# A distributor's licence/update server comes from a private file, never the repo.
[ -n "${OPENLEX_DISTRIBUTION:-}" ] && cp "$OPENLEX_DISTRIBUTION" "$PAYLOAD/sidecar/distribution.json"
cp sidecar/package.json sidecar/package-lock.json "$PAYLOAD/sidecar/"
( cd "$PAYLOAD/sidecar" && npm install --platform=$PLATFORM --arch=$ARCH --omit=dev --no-audit --no-fund >/dev/null 2>&1 )

# ── 4. Binaries (from the App's mac build) ──────────────────────────────────
echo "… staging llama.cpp + qdrant (${ARCH})"
cp "$APP_BIN/llama-server-${PLATFORM}-${ARCH}" "$PAYLOAD/bin/llama-server"
cp -R "$APP_BIN/llama-${PLATFORM}-${ARCH}-libs/." "$PAYLOAD/bin/llama-${PLATFORM}-${ARCH}-libs/"
cp "$APP_BIN/qdrant-${PLATFORM}-${ARCH}" "$PAYLOAD/bin/qdrant-${PLATFORM}-${ARCH}"
chmod +x "$PAYLOAD/bin/llama-server" "$PAYLOAD/bin/qdrant-${PLATFORM}-${ARCH}"

# ── 5. Add-in assets ────────────────────────────────────────────────────────
echo "… staging add-in"
cp -R add-in/commands.html add-in/manifest.xml add-in/taskpane.css add-in/taskpane.html add-in/taskpane.js "$PAYLOAD/add-in/"
cp -R add-in/assets "$PAYLOAD/add-in/assets"

# ── 6. Self-signed localhost cert (10 years) ────────────────────────────────
echo "… generating localhost cert"
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$PAYLOAD/certs/key.pem" -out "$PAYLOAD/certs/cert.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

# ── 7. LaunchAgent (auto-start at login, per-user) ─────────────────────────
cat > "$PAYLOAD/com.lexvault.word-sidecar.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lexvault.word-sidecar</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Library/Application Support/LexVault/WordPlugin/node</string>
    <string>/Library/Application Support/LexVault/WordPlugin/sidecar/src/server.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>/tmp/lexvault-sidecar.log</string>
  <key>StandardErrorPath</key><string>/tmp/lexvault-sidecar.log</string>
</dict>
</plist>
PLIST

# ── 8. postinstall (sideload + trust + launch) ─────────────────────────────
cat > "$SCRIPTS/postinstall" <<'POST'
#!/bin/bash
set -euo pipefail
INSTALL_DIR="/Library/Application Support/LexVault/WordPlugin"
VERSION="${LEXVAULT_PKG_VERSION:-0.1.0}"

log() { echo "[lexvault-word-plugin] $*"; }

# All console users (the add-in sideload + cert trust are per-user).
for U in $(dscl . -list /Users UniqueID | awk '$2 >= 500 {print $1}'); do
  HOME_DIR=$(dscl . -read "/Users/$U" NFSHomeDirectory 2>/dev/null | awk '{print $2}' || true)
  [ -d "$HOME_DIR" ] || continue

  # 8a. WEF sideload — copy the manifest into Word's per-user add-in folder.
  WEF="$HOME_DIR/Library/Containers/com.microsoft.Word/Data/Documents/wef"
  if [ -d "$HOME_DIR/Library/Containers/com.microsoft.Word" ]; then
    mkdir -p "$WEF"
    /bin/cp -f "$INSTALL_DIR/add-in/manifest.xml" "$WEF/LexVault.xml"
    /usr/sbin/chown "$U:staff" "$WEF/LexVault.xml" 2>/dev/null || true
    log "sideloaded manifest for $U"
  else
    log "no Word container for $U (install Word once, rerun trust-cert script)"
  fi

  # 8b. Trust the localhost cert in the user's login keychain (best effort).
  /usr/bin/sudo -u "$U" /usr/bin/security add-trusted-cert -d -r trustRoot \
    -k "$HOME_DIR/Library/Keychains/login.keychain-db" \
    "$INSTALL_DIR/certs/cert.pem" >/dev/null 2>&1 && \
    log "trusted cert for $U" || log "cert trust deferred for $U"

  # 8c. Load the LaunchAgent for this user.
  LA="$HOME_DIR/Library/LaunchAgents"
  mkdir -p "$LA"
  /bin/cp -f "$INSTALL_DIR/com.lexvault.word-sidecar.plist" "$LA/"
  /usr/sbin/chown "$U:staff" "$LA/com.lexvault.word-sidecar.plist" 2>/dev/null || true
  /usr/bin/sudo -u "$U" /bin/launchctl unload "$LA/com.lexvault.word-sidecar.plist" 2>/dev/null || true
  /usr/bin/sudo -u "$U" /bin/launchctl load "$LA/com.lexvault.word-sidecar.plist" 2>/dev/null && \
    log "LaunchAgent loaded for $U" || log "LaunchAgent deferred for $U (relogin starts it)"
done

# 8d. Bundle version marker
echo "$VERSION" > "$INSTALL_DIR/VERSION"
log "install complete (v$VERSION)"
exit 0
POST
chmod +x "$SCRIPTS/postinstall"

# ── 9. Build pkg ────────────────────────────────────────────────────────────
echo "… building pkg with pkgbuild + productbuild"
PKG_ID="com.lexvault.word-plugin"
pkgbuild \
  --root "$STAGE/payload" \
  --scripts "$SCRIPTS" \
  --identifier "$PKG_ID" \
  --version "$VERSION" \
  --install-location "/" \
  "$STAGE/plugin-unsigned.pkg"

productbuild --package "$STAGE/plugin-unsigned.pkg" \
  --version "$VERSION" \
  "$ROOT/dist/LexVault-Word-Plugin-$ARCH-$VERSION.pkg"

echo
echo "== done: dist/LexVault-Word-Plugin-$ARCH-$VERSION.pkg =="
ls -lh "dist/LexVault-Word-Plugin-$ARCH-$VERSION.pkg"
