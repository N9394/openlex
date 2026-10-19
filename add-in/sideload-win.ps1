# Sideload the LexVault add-in into Word for Windows.
# 1. Start the sidecar (serves the add-in at https://localhost:18001)
# 2. Run this PowerShell script (as the current user)
# 3. In Word: Insert -> Add-ins -> Shared Folder -> 'LexVault'
#
# Web add-ins sideload via the WEF catalog folder ONLY. Do NOT create
# HKCU\Software\Microsoft\Office\Word\Addins\LexVault — that registry key
# is the COM/VSTO mechanism; pointing it at the web manifest makes the
# VSTO runtime try to parse the OfficeApp XML as a ClickOnce manifest and
# Word shows "InvalidDeploymentException" on every start.
param()

$ErrorActionPreference = 'Stop'

# Remove a stale VSTO registration if an old 0.1.x installer created one
# (buggy installers wrote the VSTO key pointing at the web manifest).
$staleKey = "HKCU:\Software\Microsoft\Office\Word\Addins\LexVault"
if (Test-Path $staleKey) {
    Remove-Item $staleKey -Force
    Write-Host "Removed stale VSTO add-in registration (use the WEF catalog instead)"
}

$manifest = Join-Path $PSScriptRoot "manifest.xml"

if (-not (Test-Path $manifest)) {
    Write-Error "manifest.xml not found next to this script"
    exit 1
}

# WEF catalog sideload (Word 2016+ / Microsoft 365).
$wefPath = Join-Path $env:APPDATA "Microsoft\Word\WEF"
New-Item -ItemType Directory -Force -Path $wefPath | Out-Null
Copy-Item $manifest (Join-Path $wefPath "LexVault.xml") -Force

Write-Host "Manifest copied to $wefPath"
Write-Host "In Word: Insert -> Add-ins -> Shared Folder -> 'LexVault'"
