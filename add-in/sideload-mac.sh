#!/bin/bash
# Sideload the OpenLex add-in into Word for macOS.
# (The file keeps its old name LexVault.xml so a re-run replaces an existing sideload.)
# 1. Start the sidecar (it serves the add-in at https://localhost:18001)
# 2. Run this script
# 3. In Word: Insert → My Add-ins → Shared Folder → pick manifest
set -euo pipefail

DEST="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
MANIFEST="$(cd "$(dirname "$0")" && pwd)/manifest.xml"

mkdir -p "$DEST"
cp "$MANIFEST" "$DEST/LexVault.xml"

echo "Manifest copied to $DEST"
echo "In Word: Insert → Add-ins → Shared Folder → 'OpenLex'"
echo "(Remove/disable the add-in by deleting $DEST/LexVault.xml)"
