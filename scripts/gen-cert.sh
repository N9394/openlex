#!/bin/bash
# Generate a long-lived self-signed cert for https://localhost:18001
# (Office.js requires HTTPS for the add-in SourceLocation).
# Trust it with trust-cert-mac.sh (macOS) or trust-cert-win.ps1 (Windows).
set -euo pipefail

CERT_DIR="${LEXVAULT_CERT_DIR:-$HOME/.lexvault/certs}"
mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" \
  2>/dev/null

echo "Certificate written to:"
echo "  cert: $CERT_DIR/cert.pem"
echo "  key:  $CERT_DIR/key.pem"
echo "Trust it: ./trust-cert-mac.sh   (or trust-cert-win.ps1 on Windows)"
