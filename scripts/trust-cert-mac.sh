#!/bin/bash
# Trust the localhost cert for Word's webview (macOS).
# Requires sudo (adds to system keychain — Word's embedded browser does not
# see per-user login-keychain certs on all macOS versions).
set -euo pipefail

CERT="${1:-$HOME/.lexvault/certs/cert.pem}"
if [ ! -f "$CERT" ]; then
  echo "cert not found: $CERT — run ./gen-cert.sh first"
  exit 1
fi

sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT"
echo "Trusted. Restart Word if it was running."
