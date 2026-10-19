#!/bin/bash
# Sync fixed sidecar + add-in files into the installed Word plugin copy.
# Run once with sudo after updating the repo:
#   sudo word-plugin/scripts/sync-installed.sh
set -euo pipefail

SRC="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
DST="/Library/Application Support/LexVault/WordPlugin"

echo "Syncing $SRC -> $DST"
cp -f "$SRC/sidecar/src/"*.js "$DST/sidecar/src/"
cp -f "$SRC/add-in/taskpane.html" "$SRC/add-in/taskpane.js" "$SRC/add-in/taskpane.css" "$SRC/add-in/commands.html" "$DST/add-in/"
cp -f "$SRC/add-in/manifest.xml" "$DST/add-in/"
cp -f "$SRC/add-in/assets/"*.png "$DST/add-in/assets/"

# License public key — sidecar loadPublicKey() scans ~/.lexvault; without
# it the sidecar runs dev mode (license payloads never signature-verified).
if [ -f "$SRC/certs/public_key.pem" ]; then
  mkdir -p "$HOME/.lexvault"
  cp -f "$SRC/certs/public_key.pem" "$HOME/.lexvault/public_key.pem"
  echo "License public key -> ~/.lexvault/public_key.pem"
fi

# Keep the installed VERSION file truthful (sidecar package.json version).
VER="$(python3 -c "import json;print(json.load(open('$SRC/sidecar/package.json'))['version'])" 2>/dev/null || echo 0.1.0)"
echo "$VER" > "$DST/VERSION"

# Restart the LaunchAgent sidecar so it picks up the new code.
launchctl unload "$HOME/Library/LaunchAgents/com.lexvault.word-sidecar.plist" 2>/dev/null || true
pkill -f "$DST/sidecar/src/server.js" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.lexvault.word-sidecar.plist" 2>/dev/null || true

echo "Synced. LaunchAgent sidecar restarted (log: /tmp/lexvault-sidecar.log)."
