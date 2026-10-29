; LexVault Word plugin — Windows installer (A2)
; Per-user install to %LOCALAPPDATA%\LexVault\WordPlugin. No admin, no
; system writes. Sideloads the add-in (WEF catalog only — the Word\Addins
; registry key is VSTO and must NOT be used for web add-ins), trusts the
; localhost cert for this user, auto-starts the sidecar.
;
; Build: scripts/package-win.sh (sets APP_VERSION, STAGE_DIR, OUTPUT_FILE)

Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!ifndef APP_VERSION
  !define APP_VERSION "0.1.0"
!endif
!ifndef STAGE_DIR
  !error "STAGE_DIR not defined — run via scripts/package-win.sh"
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "dist\LexVault-Word-Plugin-Setup-${APP_VERSION}.exe"
!endif

Name "LexVault Word Plugin"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\LexVault\WordPlugin"
InstallDirRegKey HKCU "Software\LexVault\WordPlugin" "InstallDir"
RequestExecutionLevel user

; ── pages ───────────────────────────────────────────────────────────────────
Page license
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

; ── strings ─────────────────────────────────────────────────────────────────
!define PRODUCT_GUID "{8F3C1D4E-2A5B-4C6D-9E7F-1A2B3C4D5E6F}"
!define REG_ADDINS "Software\Microsoft\Office\Word\Addins\LexVault"
!define REG_WEF "$APPDATA\Microsoft\Word\WEF"
!define REG_AUTOSTART "Software\Microsoft\Windows\CurrentVersion\Run"

; ── install ─────────────────────────────────────────────────────────────────
Section "LexVault Word Plugin (required)" SEC_MAIN
  SetOutPath "$INSTDIR"
  WriteRegStr HKCU "Software\LexVault\WordPlugin" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\LexVault\WordPlugin" "Version" "${APP_VERSION}"

  ; Core files
  File "${STAGE_DIR}\node.exe"
  File "${STAGE_DIR}\start-sidecar.vbs"
  File /oname=trust-cert.ps1 "${STAGE_DIR}\trust-cert.ps1"

  ; Sidecar (src + win32-x64 node_modules)
  SetOutPath "$INSTDIR\sidecar"
  File /r "${STAGE_DIR}\sidecar\*.*"

  ; Binaries (named to match the sidecar's resolveBinary convention)
  SetOutPath "$INSTDIR\bin"
  File "${STAGE_DIR}\bin\llama-server.exe"
  File "${STAGE_DIR}\bin\llama-server-impl.dll"
  File "${STAGE_DIR}\bin\llama.dll"
  File "${STAGE_DIR}\bin\llama-common.dll"
  File "${STAGE_DIR}\bin\ggml.dll"
  File "${STAGE_DIR}\bin\ggml-vulkan.dll"
  File "${STAGE_DIR}\bin\libomp.dll"
  File "${STAGE_DIR}\bin\mtmd.dll"
  File "${STAGE_DIR}\bin\qdrant-win32-x64.exe"

  ; Add-in assets
  SetOutPath "$INSTDIR\add-in"
  File "${STAGE_DIR}\add-in\manifest.xml"
  File "${STAGE_DIR}\add-in\taskpane.html"
  File "${STAGE_DIR}\add-in\taskpane.js"
  File "${STAGE_DIR}\add-in\taskpane.css"
  File "${STAGE_DIR}\add-in\commands.html"
  File /r "${STAGE_DIR}\add-in\assets\*.*"
  SetOutPath "$INSTDIR\add-in\lib"
  File "${STAGE_DIR}\add-in\lib\*.js"

  ; Certs
  SetOutPath "$INSTDIR\certs"
  File "${STAGE_DIR}\certs\cert.pem"
  File "${STAGE_DIR}\certs\key.pem"
  File "${STAGE_DIR}\certs\public_key.pem"

  ; ── sidecar certs (critical for Windows) ──────────────────────────────
  ; The sidecar reads HTTPS certs from ~/.lexvault/certs (sidecar
  ; config.js) — NOT from the install dir. Without this copy the sidecar
  ; silently serves plain HTTP and the Office pane (https://localhost:
  ; 18001) fails with "add-in error" on every start.
  CreateDirectory "$PROFILE\.lexvault\certs"
  CopyFiles /SILENT "$INSTDIR\certs\cert.pem" "$PROFILE\.lexvault\certs\cert.pem"
  CopyFiles /SILENT "$INSTDIR\certs\key.pem" "$PROFILE\.lexvault\certs\key.pem"

  ; ── license public key (signature verification) ───────────────────────
  ; Without it the sidecar runs "dev mode" — license checks phone home but
  ; the signed payload is never verified. Ship it to ~/.lexvault where the
  ; sidecar's loadPublicKey() fallback scan finds it.
  CreateDirectory "$PROFILE\.lexvault"
  CopyFiles /SILENT "$INSTDIR\certs\public_key.pem" "$PROFILE\.lexvault\public_key.pem"

  ; ── Word add-in sideload ─────────────────────────────────────────────
  ; WEF catalog only. The "Software\Microsoft\Office\Word\Addins" registry
  ; key is the COM/VSTO mechanism — a web add-in manifest there makes the
  ; VSTO runtime parse the OfficeApp XML as a ClickOnce assembly manifest
  ; and Word shows InvalidDeploymentException on every start (0x8007001F,
  ; "line 0 column 0"). Web add-ins sideload via the WEF folder alone:
  ; Word lists them under Insert -> Add-ins -> Shared Folder.
  CreateDirectory "${REG_WEF}"
  CopyFiles /SILENT "$INSTDIR\add-in\manifest.xml" "${REG_WEF}\LexVault.xml"
  ; Cleanup for installs made by the buggy 0.1.x installers (VSTO key
  ; pointing at the web manifest). Idempotent on fresh installs.
  DeleteRegKey HKCU "${REG_ADDINS}"

  ; ── auto-start the sidecar at login ──────────────────────────────────
  WriteRegStr HKCU "${REG_AUTOSTART}" "LexVault Word Sidecar" "wscript.exe $\"$INSTDIR\start-sidecar.vbs$\""

  ; ── shortcuts ────────────────────────────────────────────────────────
  CreateDirectory "$SMPROGRAMS\LexVault"
  CreateShortcut "$SMPROGRAMS\LexVault\Start LexVault Sidecar.lnk" "wscript.exe" "$INSTDIR\start-sidecar.vbs"
  CreateShortcut "$SMPROGRAMS\LexVault\Trust Certificate (once).lnk" "powershell.exe" "-ExecutionPolicy Bypass -File $\"$INSTDIR\trust-cert.ps1$\""
  CreateShortcut "$SMPROGRAMS\LexVault\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  ; ── uninstaller ──────────────────────────────────────────────────────
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LexVaultWordPlugin" "DisplayName" "LexVault Word Plugin"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LexVaultWordPlugin" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LexVaultWordPlugin" "DisplayVersion" "${APP_VERSION}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LexVaultWordPlugin" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LexVaultWordPlugin" "NoRepair" 1

  ; Trust the localhost cert (per-user store — certutil -user, no admin).
  ; Best effort: if the store add fails, the pane still works in dev mode
  ; (HTTP fallback) and the Start-menu shortcut retries.
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\trust-cert.ps1"'

  ; Start the sidecar so Word finds it immediately.
  nsExec::Exec 'wscript.exe "$INSTDIR\start-sidecar.vbs"'
SectionEnd

; ── uninstall ───────────────────────────────────────────────────────────────
Section "Uninstall"
  ; Stop the sidecar (kill node.exe running from our install dir only).
  nsExec::ExecToLog 'powershell.exe -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like ''$LOCALAPPDATA\LexVault\WordPlugin\*'' } | Stop-Process -Force"'

  DeleteRegKey HKCU "Software\Microsoft\Office\Word\Addins\LexVault"
  DeleteRegValue HKCU "${REG_AUTOSTART}" "LexVault Word Sidecar"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LexVaultWordPlugin"
  DeleteRegKey HKCU "Software\LexVault\WordPlugin"
  Delete "${REG_WEF}\LexVault.xml"
  RMDir /r "$SMPROGRAMS\LexVault"
  RMDir /r "$INSTDIR"
SectionEnd
