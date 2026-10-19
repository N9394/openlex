# Trust the localhost cert for Word's webview (Windows).
# Run as Administrator.
param(
  [string]$Cert = "$env:USERPROFILE\.lexvault\certs\cert.pem"
)

if (-not (Test-Path $Cert)) {
    Write-Error "cert not found: $Cert — run gen-cert.sh first (or copy cert.pem)"
    exit 1
}

$out = certutil -addstore -f Root $Cert 2>&1
Write-Host $out
Write-Host "Trusted. Restart Word if it was running."
