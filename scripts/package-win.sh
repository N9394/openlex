#!/bin/bash
# Build the Windows NSIS installer for the LexVault Word plugin (A2).
#
# What it ships (SPEC §7.1 option A, ~350-500 MB):
#   node.exe          — the sidecar's Node runtime (the App provides Node via
#                       Electron; a standalone plugin bundles its own)
#   sidecar/          — src + node_modules installed for win32-x64 (includes
#                       onnxruntime-node with DirectML for the BGE-M3 path)
#   bin/llama-server.exe + llama-win32-x64-libs/   — CPU llama.cpp (CUDA
#                       bundle is ~1 GB — v1 ships CPU, tiers already pick
#                       Lotus 4B which runs fine on CPU)
#   bin/qdrant.exe     — local law index
#   add-in/            — manifest.xml + taskpane + icons (served by sidecar)
#   certs/             — self-signed localhost cert (generated here), trusted
#                       per-user at install (certutil -user -addstore Root,
#                       no admin needed)
#   start-sidecar.vbs  — hidden-window launcher for auto-start
#
# Install is per-user: %LOCALAPPDATA%\LexVault\WordPlugin. No admin, no
# system writes. Sideload = copy manifest to %APPDATA%\Microsoft\Word\WEF
# (catalog) ONLY — the HKCU Word Addins registry key is the VSTO mechanism
# and must not be used for web add-ins (VSTO loader chokes on the OfficeApp
# XML: InvalidDeploymentException 0x8007001F at every Word start).
#
# Prereqs: makensis (NSIS 3.x), node, npm. Run from word-plugin/.
#   brew install nsis   # macOS
#
# Output: dist/LexVault-Word-Plugin-Setup-<ver>.exe
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${LEXVAULT_PLUGIN_VERSION:-0.1.0}"
# Stage OUTSIDE iCloud — the repo lives in com~apple~CloudDocs and iCloud
# evicts freshly-written small files (node_modules) to dataless placeholders,
# which made npm-installed trees intermittently unreadable mid-build.
STAGE="${LEXVAULT_STAGE_DIR:-/tmp/lexvault-win-staging}"
ROOT="$(pwd)"
NSIS_SCRIPT="scripts/nsis/lexvault-word-plugin.nsi"
NODE_VERSION="${LEXVAULT_NODE_VERSION:-v22.23.2}"

echo "== LexVault Word plugin — Windows installer (v$VERSION) =="

# ── 1. Clean stage ──────────────────────────────────────────────────────────
rm -rf "$STAGE"
mkdir -p "$STAGE"/{sidecar,bin/llama-win32-x64-libs,add-in,certs}

# ── 2. Node runtime (win-x64) ───────────────────────────────────────────────
if [ ! -f "dist/cache/node-${NODE_VERSION}-win-x64/node.exe" ]; then
  echo "… downloading Node $NODE_VERSION win-x64"
  mkdir -p "dist/cache"
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip" \
    -o "dist/cache/node-${NODE_VERSION}-win-x64.zip"
  ( cd dist/cache && unzip -q -o "node-${NODE_VERSION}-win-x64.zip" "node-${NODE_VERSION}-win-x64/node.exe" )
  rm -f "dist/cache/node-${NODE_VERSION}-win-x64.zip"
fi
cp "dist/cache/node-${NODE_VERSION}-win-x64/node.exe" "$STAGE/node.exe"

# ── 3. Sidecar + deps (win32-x64) ───────────────────────────────────────────
echo "… staging sidecar (win32-x64 deps)"
cp -R sidecar/src "$STAGE/sidecar/src"
cp sidecar/package.json sidecar/package-lock.json "$STAGE/sidecar/"
if ! ( cd "$STAGE/sidecar" && npm install --platform=win32 --arch=x64 --omit=dev --no-audit --no-fund >/dev/null 2>&1 ); then
  echo "  npm install (win32-x64) failed — retrying with visible output"
  ( cd "$STAGE/sidecar" && npm install --platform=win32 --arch=x64 --omit=dev --no-audit --no-fund )
fi

# npm's --platform/--arch flags do not reliably pull sharp's win32 optional
# deps when the host is macOS — the staged tree ends up with darwin-arm64
# bindings only, and the ONNX BGE-M3 path dies on Windows with
# "Could not load the sharp module". Force-fetch the win32 binding and prune
# the darwin ones.
SHARP_WIN="$STAGE/sidecar/node_modules/@img/sharp-win32-x64"
if [ ! -f "$SHARP_WIN/package.json" ]; then
  SHARP_VER="$(node -p "require('$STAGE/sidecar/node_modules/sharp/package.json').version")"
  echo "… fetching @img/sharp-win32-x64@$SHARP_VER (npm cross-platform gap)"
  TMPD="$(mktemp -d)"
  curl -fsSL "https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-${SHARP_VER}.tgz" \
    | tar xz -C "$TMPD"
  rm -rf "$SHARP_WIN"
  mv "$TMPD/package" "$SHARP_WIN"
  rm -rf "$TMPD"
fi
rm -rf "$STAGE/sidecar/node_modules/@img/sharp-darwin-arm64" \
       "$STAGE/sidecar/node_modules/@img/sharp-libvips-darwin-arm64" \
       "$STAGE/sidecar/node_modules/@img/sharp-darwin-x64" \
       "$STAGE/sidecar/node_modules/@img/sharp-libvips-darwin-x64"
# Guard: the win32 binding must be present after the fetch
[ -f "$SHARP_WIN/package.json" ] || { echo "  ERROR: @img/sharp-win32-x64 missing after fetch"; exit 1; }

# ── 4. Binaries: Vulkan llama.cpp b10400 + qdrant ───────────────────────────
echo "… staging llama.cpp (Vulkan b10400) + qdrant"
LLAMA_VULKAN="${LEXVAULT_LLAMA_VULKAN_DIR:-/tmp/llama-b10400}"
if [ ! -f "$LLAMA_VULKAN/llama-server.exe" ]; then
  echo "  ERROR: llama-vulkan dir not found at $LLAMA_VULKAN"
  echo "  Download: curl -L -o /tmp/llama-b10400.zip 'https://github.com/ggml-org/llama.cpp/releases/download/b10400/llama-b10400-bin-win-vulkan-x64.zip' && cd /tmp && unzip llama-b10400.zip -d llama-b10400"
  exit 1
fi
# Server binaries + DLLs (Vulkan build)
cp "$LLAMA_VULKAN/llama-server.exe" "$STAGE/bin/llama-server.exe"
cp "$LLAMA_VULKAN/llama-server-impl.dll" "$STAGE/bin/llama-server-impl.dll"
cp "$LLAMA_VULKAN/llama.dll" "$STAGE/bin/llama.dll"
cp "$LLAMA_VULKAN/llama-common.dll" "$STAGE/bin/llama-common.dll"
cp "$LLAMA_VULKAN/ggml.dll" "$STAGE/bin/ggml.dll"
cp "$LLAMA_VULKAN/ggml-vulkan.dll" "$STAGE/bin/ggml-vulkan.dll"
# libomp: b10353 has libomp140.x86_64.dll, newer builds have libomp.dll
if [ -f "$LLAMA_VULKAN/libomp.dll" ]; then
  cp "$LLAMA_VULKAN/libomp.dll" "$STAGE/bin/libomp.dll"
elif [ -f "$LLAMA_VULKAN/libomp140.x86_64.dll" ]; then
  cp "$LLAMA_VULKAN/libomp140.x86_64.dll" "$STAGE/bin/libomp.dll"
fi
cp "$LLAMA_VULKAN/mtmd.dll" "$STAGE/bin/mtmd.dll"
# qdrant from App build or box
APP_BIN="../product/electron/dist/win-unpacked/resources/bin"
if [ -f "$APP_BIN/qdrant-win32-x64.exe" ]; then
  cp "$APP_BIN/qdrant-win32-x64.exe" "$STAGE/bin/qdrant-win32-x64.exe"
else
  # Fallback: download from box (or use a pre-cached copy)
  QDRANT_CACHE="dist/cache/qdrant-win32-x64.exe"
  if [ ! -f "$QDRANT_CACHE" ]; then
    echo "  Downloading qdrant from box..."
    [ -n "${OPENLEX_QDRANT_WIN_SRC:-}" ] && scp -o ConnectTimeout=10 "$OPENLEX_QDRANT_WIN_SRC" "$QDRANT_CACHE" 2>/dev/null || true
  fi
  if [ -f "$QDRANT_CACHE" ]; then
    cp "$QDRANT_CACHE" "$STAGE/bin/qdrant-win32-x64.exe"
  else
    echo "  WARNING: qdrant not found — installer will lack local law index"
  fi
fi

# ── 5. Add-in assets ────────────────────────────────────────────────────────
echo "… staging add-in"
cp -R add-in/commands.html add-in/manifest.xml add-in/taskpane.css add-in/taskpane.html add-in/taskpane.js "$STAGE/add-in/"
cp -R add-in/assets "$STAGE/add-in/assets"

# ── 6. Self-signed localhost cert (10 years) ────────────────────────────────
echo "… generating localhost cert"
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$STAGE/certs/key.pem" -out "$STAGE/certs/cert.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

# License public key — the NSIS script installs it to ~/.lexvault so the
# sidecar signature-verifies license payloads (missing file aborted the
# 0.1.64 build at NSIS line 76).
cp certs/public_key.pem "$STAGE/certs/public_key.pem"

cat > "$STAGE/start-sidecar.vbs" <<'VBS'
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appData = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%")
base = appData & "\LexVault\WordPlugin"
If Not fso.FileExists(base & "\node.exe") Then WScript.Quit 1
sh.CurrentDirectory = base
sh.Environment("Process")("LEXVAULT_LLM_URL") = "http://127.0.0.1:18080"

' Word-watcher launcher: the sidecar starts WITH Word and exits itself
' ~5 min after Word closes (Windows Word-aware lifecycle in server.js).
' This loop only (re)starts node when Word is running, with a backoff for
' crash loops.
Function WordRunning()
  On Error Resume Next
  WordRunning = False
  Dim wmi, col, p
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set col = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = 'WINWORD.EXE'")
  If Not col Is Nothing Then
    For Each p In col
      WordRunning = True
      Exit For
    Next
  End If
  Set col = Nothing
  Set wmi = Nothing
End Function

Dim fastExits
fastExits = 0
Do
  If WordRunning() Then
    Dim t0
    t0 = Timer
    sh.Run """" & base & "\node.exe"" """ & base & "\sidecar\src\server.js""", 0, True
    If Timer - t0 < 30 Then
      fastExits = fastExits + 1
    Else
      fastExits = 0
    End If
    If fastExits >= 5 Then
      WScript.Sleep 60000
      fastExits = 0
    End If
  End If
  WScript.Sleep 10000
Loop
VBS


# ── 8. Trust helper (per-user Root store, no admin) ─────────────────────────
cat > "$STAGE/trust-cert.ps1" <<'PS'
param([string]$Cert = "$env:USERPROFILE\.lexvault\certs\cert.pem")
if (-not (Test-Path $Cert)) {
  # Pre-0.1.28 layout: certs lived only in the install dir.
  $Cert = "$env:LOCALAPPDATA\LexVault\WordPlugin\certs\cert.pem"
}
if (-not (Test-Path $Cert)) { Write-Error "cert not found: $Cert"; exit 1 }
certutil -user -addstore -f Root $Cert | Out-Host
Write-Host "LexVault localhost cert trusted for this user. Restart Word if it was running."
PS

# ── 9. Build installer ──────────────────────────────────────────────────────
echo "… building installer with makensis"
makensis -V3 \
  -DAPP_VERSION="$VERSION" \
  -DSTAGE_DIR="$STAGE" \
  -DOUTPUT_FILE="$ROOT/dist/LexVault-Word-Plugin-Setup-$VERSION.exe" \
  "$NSIS_SCRIPT"

echo
echo "== done: dist/LexVault-Word-Plugin-Setup-$VERSION.exe =="
ls -lh "dist/LexVault-Word-Plugin-Setup-$VERSION.exe"
