# OpenLex installer for Windows (Windows PowerShell 5.1 and PowerShell 7).
#
#   irm https://openlex.pinemarshlands.com/install.ps1 | iex                            # CLI + engine
#   $env:OPENLEX_APP = 1; irm https://openlex.pinemarshlands.com/install.ps1 | iex     # desktop app
#   $env:OPENLEX_ALL = 1; irm https://openlex.pinemarshlands.com/install.ps1 | iex     # both
#   $env:OPENLEX_VERSION = '0.3.0'; ...                                                 # a given version
# or, with switches:
#   & ([scriptblock]::Create((irm https://openlex.pinemarshlands.com/install.ps1))) -App   # or -All
#
# CLI + engine: installed into %USERPROFILE%\.openlex (the same folder as
# ~/.openlex on macOS and Linux), with an `openlex.cmd` in
# %USERPROFILE%\.openlex\bin, which is added to your user PATH. Needs
# Node.js >= 20.
# Desktop app (-App): the OpenLex installer runs silently for your user
# only (%LOCALAPPDATA%\Programs, Start menu entry). Files downloaded this
# way carry no "Mark of the Web", so SmartScreen does not stop the
# installer; it is checked here instead.
# No admin rights either way. Everything is downloaded from the GitHub
# release and checked against its published SHA-256 before it is used;
# with cosign or gh installed, also its signature / build attestation
# (docs/VERIFY.md).
#
# Settings (environment variables, all optional):
#   OPENLEX_APP=1       only the desktop app (same as -App)
#   OPENLEX_ALL=1       the CLI + engine and the desktop app (same as -All)
#   OPENLEX_VERSION     version to install (default: the latest release)
#   OPENLEX_HOME        install folder (default: %USERPROFILE%\.openlex)
#   OPENLEX_BIN_DIR     folder for openlex.cmd (default: <install folder>\bin)
#   OPENLEX_RELEASE_URL where the release files are (for mirrors and tests)
#
# Upgrade: run the same line again. Uninstall the CLI:
#   Remove-Item -Recurse -Force "$env:USERPROFILE\.openlex"
#   then remove ...\.openlex\bin from Path in "Edit environment variables
#   for your account". The desktop app: Settings > Apps > OpenLex >
#   Uninstall. Your matters and settings in %USERPROFILE%\.lexvault are
#   kept; delete that folder too to remove everything.
#
# This file is plain ASCII on purpose: Windows PowerShell 5.1 reads a
# downloaded script without a charset as Latin-1.

param([switch]$App, [switch]$All)

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads in 5.1 very slow

  $Repo = 'N9394/openlex'
  $Version = "$env:OPENLEX_VERSION".Trim() -replace '^v', ''
  $Prefix = if ($env:OPENLEX_HOME) { $env:OPENLEX_HOME } else { Join-Path $HOME '.openlex' }
  $BinDir = if ($env:OPENLEX_BIN_DIR) { $env:OPENLEX_BIN_DIR } else { Join-Path $Prefix 'bin' }
  $OnWindows = ($PSVersionTable.PSEdition -ne 'Core') -or $IsWindows
  $Yes = @('1', 'true', 'yes')
  $WantCli = $true
  $WantApp = $false
  if ($App -or ($Yes -contains "$env:OPENLEX_APP".Trim().ToLowerInvariant())) { $WantCli = $false; $WantApp = $true }
  if ($All -or ($Yes -contains "$env:OPENLEX_ALL".Trim().ToLowerInvariant())) { $WantCli = $true; $WantApp = $true }

  function Say([string]$Text, [string]$Color) {
    if ($Color) { Write-Host $Text -ForegroundColor $Color } else { Write-Host $Text }
  }
  function Fail([string]$Text) { throw "openlex install: $Text" }

  # Runs a native tool and returns its exit code and output. Windows
  # PowerShell 5.1 turns native stderr into errors under 'Stop', so relax it here.
  function Invoke-Tool([string]$Exe, [string[]]$ToolArgs) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $out = & $Exe @ToolArgs 2>&1 | Out-String
      return @{ Code = $LASTEXITCODE; Out = $out }
    } finally { $ErrorActionPreference = $old }
  }

  function Remove-Dir([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir)) { return }
    try { Remove-Item -LiteralPath $Dir -Recurse -Force } catch { }
    # Remove-Item in 5.1 sometimes gives up on deep node_modules trees.
    if ((Test-Path -LiteralPath $Dir) -and $OnWindows) { try { & cmd.exe /d /c rd /s /q $Dir 2>$null } catch { } }
    if (Test-Path -LiteralPath $Dir) {
      Fail "could not remove $Dir - quit OpenLex (and any window running openlex), then run the installer again"
    }
  }

  # Downloads a release file into $Tmp and checks it; returns its path.
  # The SHA-256 comes from <file>.sha256, or else from the release's
  # SHA256SUMS. Then the origin check (see docs/VERIFY.md): the checksum
  # only proves the download is intact; it comes from the same release.
  # Releases built by the release workflow are also signed (Sigstore) and
  # attested by GitHub. With cosign or gh installed, check that the file was
  # built by this repository's release workflow. A failed check stops the
  # install; a missing tool does not.
  function Get-Verified([string]$File, [string]$NotFound) {
    $Path = Join-Path $Tmp $File
    try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/$File" -OutFile $Path } catch {
      if ($NotFound) { Fail $NotFound } else { Fail "download failed: $Base/$File" }
    }
    $Expected = ''
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$Base/$File.sha256" -OutFile "$Path.sha256"
      $Expected = ((Get-Content -LiteralPath "$Path.sha256" -Raw).Trim() -split '\s+')[0]
    } catch {
      $Sums = Join-Path $Tmp 'SHA256SUMS'
      try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile $Sums } catch { Fail "checksum download failed for $File" }
      foreach ($Line in (Get-Content -LiteralPath $Sums)) {
        $Parts = $Line.Trim() -split '\s+'
        if ($Parts.Count -ge 2 -and ($Parts[1] -replace '^\*', '') -eq $File) { $Expected = $Parts[0]; break }
      }
    }
    if (-not $Expected) { Fail "the release has no checksum for $File - not installing" }
    $Expected = $Expected.ToLowerInvariant()
    $Actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Expected -ne $Actual) { Fail "checksum mismatch for $File (expected $Expected, got $Actual) - not installing" }
    Say "  sha256 matches the release's checksum file ($File)" 'DarkGray'

    $Bundle = "$Path.bundle"
    $Signed = $true
    try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/$File.bundle" -OutFile $Bundle } catch { $Signed = $false }
    if ($Signed) {
      $Checked = @()
      $Identity = "https://github.com/$Repo/.github/workflows/release.yml@refs/tags/v$Version"
      $Cosign = Get-Command cosign -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($Cosign) {
        $r = Invoke-Tool $Cosign.Path @('verify-blob', '--bundle', $Bundle, '--certificate-identity', $Identity, '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', $Path)
        if ($r.Code -ne 0) { Write-Host $r.Out; Fail 'the signature does not match (cosign verify-blob failed) - not installing' }
        Say "  signature (cosign): built by $Repo's release workflow for v$Version" 'DarkGray'
        $Checked += 'cosign'
      }
      $Gh = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($Gh) {
        if ((Invoke-Tool $Gh.Path @('auth', 'status')).Code -ne 0) {
          Say '  gh is installed but not logged in (gh auth login), so the GitHub attestation was not checked' 'DarkGray'
        } else {
          $r = Invoke-Tool $Gh.Path @('attestation', 'verify', $Path, '--repo', $Repo)
          if ($r.Code -ne 0) { Write-Host $r.Out; Fail 'the GitHub attestation does not match (gh attestation verify failed) - not installing' }
          Say "  attestation (gh): GitHub build provenance from $Repo" 'DarkGray'
          $Checked += 'gh'
        }
      }
      if ($Checked.Count -eq 0) {
        Say 'Only the checksum was checked. To also check who built it, install cosign or gh and run this again (docs/VERIFY.md).'
      }
    } else {
      Say "Only the checksum was checked: no signature was found for v$Version (releases from before signed builds have none)."
    }
    return $Path
  }

  function Install-Cli {
    # tar.exe ships with Windows 10 (1803) and later. Use that one: a GNU tar
    # from Git for Windows on PATH would read C:\... as a remote host.
    $Tar = if ($OnWindows) { Join-Path $env:SystemRoot 'System32\tar.exe' } else { 'tar' }
    $Name = "openlex-$Version"
    Say "OpenLex $Version (CLI + engine) -> $Prefix" 'White'
    $Archive = Get-Verified "$Name.tar.gz"

    # Unpack next to the final place, then move: an interrupted install
    # never leaves a half-written version behind.
    $Versions = Join-Path $Prefix 'versions'
    $Stage = Join-Path $Versions ".staging-$PID"
    New-Item -ItemType Directory -Path $Stage -Force | Out-Null
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    try {
      # node_modules/.bin holds symlinks in older packages; Windows cannot
      # create them without admin rights and OpenLex does not need them.
      & $Tar -xzf $Archive -C $Stage --exclude 'node_modules/.bin'
      if ($LASTEXITCODE -ne 0) { Fail "unpacking failed (tar exit code $LASTEXITCODE)" }
      if (-not (Test-Path -LiteralPath (Join-Path $Stage "$Name\sidecar\bin\openlex.js"))) { Fail 'the package does not look like OpenLex - not installing' }
      $Target = Join-Path $Versions $Name
      Remove-Dir $Target
      Move-Item -LiteralPath (Join-Path $Stage $Name) -Destination $Target
    } finally {
      Remove-Dir $Stage
    }

    # openlex.cmd works in PowerShell, cmd and Windows Terminal. No
    # openlex.ps1 on purpose: PowerShell would prefer it, and the default
    # execution policy blocks unsigned scripts.
    $Js = Join-Path $Target 'sidecar\bin\openlex.js'
    $Inside = [IO.Path]::GetFullPath($BinDir).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath((Join-Path $Prefix 'bin')).TrimEnd('\', '/')
    # %~dp0 keeps the shim independent of the code page when the user name has accents.
    $JsRef = if ($Inside) { "%~dp0..\versions\$Name\sidecar\bin\openlex.js" } else { $Js }
    $Shim = "@echo off`r`nnode `"$JsRef`" %*`r`n"
    [IO.File]::WriteAllText((Join-Path $BinDir 'openlex.cmd'), $Shim, (New-Object Text.ASCIIEncoding))
    if (-not $OnWindows) {
      # Lets the installer be tried with pwsh on macOS/Linux; the PATH below is Windows-only.
      Set-Content -LiteralPath (Join-Path $BinDir 'openlex') -Value "#!/bin/sh`nexec node `"$Js`" `"`$@`"" -Encoding ASCII
      & chmod +x (Join-Path $BinDir 'openlex')
    }

    Say "Installed. $(Join-Path $BinDir 'openlex.cmd') -> $Target" 'Green'

    # User PATH only (HKCU\Environment), never the machine PATH. Read and
    # write the raw value so entries like %USERPROFILE%\... stay unexpanded.
    if ($OnWindows) {
      $Full = [IO.Path]::GetFullPath($BinDir).TrimEnd('\')
      $Key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
      try {
        $UserPath = [string]$Key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $Entries = @($UserPath -split ';' | Where-Object { $_ -ne '' })
        $Present = $Entries | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -eq $Full }
        if (-not $Present) {
          $Key.SetValue('Path', (($Entries + $Full) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
          # Tell Explorer (and terminals opened from now on) that the environment changed.
          [Environment]::SetEnvironmentVariable('OPENLEX_INSTALL_REFRESH', '1', 'User')
          [Environment]::SetEnvironmentVariable('OPENLEX_INSTALL_REFRESH', $null, 'User')
          Say "Added $Full to your user PATH."
        }
      } finally { $Key.Close() }
      if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -eq $Full })) { $env:Path = "$Full;$env:Path" }
    } else {
      Say "Not on Windows: add $BinDir to PATH yourself." 'DarkGray'
    }

    Say ''
    Say 'Next (in this window, or any new one):'
    Say '  openlex            # the terminal app (Windows Terminal recommended)'
    Say '  openlex status'
    Say ''
    Say 'Models: your own key (Anthropic, OpenAI, Mistral, ...) or a local model.' 'DarkGray'
    Say 'The data policy is local-only until you allow a provider.' 'DarkGray'
    Say "Uninstall: Remove-Item -Recurse -Force '$Prefix', then remove $BinDir from your user PATH." 'DarkGray'
    Say "Docs: https://github.com/$Repo" 'DarkGray'
  }

  # The desktop app: electron-builder's NSIS installer, run silently (/S).
  # It installs for the current user only (%LOCALAPPDATA%\Programs) and
  # needs no admin rights; /currentuser keeps it that way. A file saved by
  # Invoke-WebRequest has no Mark of the Web, so SmartScreen does not
  # interrupt it; the checks above stand in for Microsoft's.
  function Install-App {
    if (-not $OnWindows) { Fail 'the desktop app installer is for Windows; on macOS and Linux use install.sh --app' }
    $File = "OpenLex-$Version-windows-x64-setup.exe"
    Say "OpenLex $Version (desktop app) -> your user account" 'White'
    $Setup = Get-Verified $File "could not download $File (the desktop app is on releases from 0.3.0 on): $Base/$File"
    Say '  installing (this takes a minute; OpenLex closes first if it is open) ...' 'DarkGray'
    $p = Start-Process -FilePath $Setup -ArgumentList @('/S', '/currentuser') -PassThru
    $null = $p.Handle   # keeps the exit code readable in Windows PowerShell 5.1
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { Fail "the OpenLex installer stopped with exit code $($p.ExitCode)" }
    $Exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs\*\OpenLex.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Exe) { Say "Installed. $($Exe.FullName)" 'Green' } else { Say 'Installed.' 'Green' }
    Say ''
    Say 'Open it from the Start menu: OpenLex.'
    Say 'Uninstall: Settings > Apps > OpenLex > Uninstall. Your matters and settings stay.' 'DarkGray'
  }

  try {
    # GitHub needs TLS 1.2; older Windows PowerShell 5.1 does not offer it by default.
    if ($PSVersionTable.PSEdition -ne 'Core') {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }

    if ($WantCli) {
      if ($OnWindows -and -not (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\tar.exe'))) {
        Fail 'tar.exe was not found. OpenLex needs Windows 10 (version 1803) or newer.'
      }
      $Node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $Node) {
        Fail ("Node.js 20 or newer is required. Install it, open a new terminal window and run this again:`n" +
          "    winget install OpenJS.NodeJS.LTS`n" +
          "  (or download it from https://nodejs.org). Only the desktop app: set `$env:OPENLEX_APP = 1 first.")
      }
      $NodeVersion = (& $Node.Path -v) -replace '^v', ''
      $NodeMajor = 0
      [void][int]::TryParse(($NodeVersion -split '\.')[0], [ref]$NodeMajor)
      if ($NodeMajor -lt 20) {
        Fail "Node.js $NodeVersion found; OpenLex needs 20 or newer. Update it with: winget upgrade OpenJS.NodeJS.LTS"
      }
    }
    if ($WantApp -and -not $OnWindows) { Fail 'the desktop app installer is for Windows; on macOS and Linux use install.sh --app' }

    if (-not $Version) {
      try {
        $Latest = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest"
        $Version = "$($Latest.tag_name)" -replace '^v', ''
      } catch { }
      if (-not $Version) { Fail 'could not find the latest release (GitHub API); set $env:OPENLEX_VERSION = ''X.Y.Z'' and run again' }
    }
    $Base = if ($env:OPENLEX_RELEASE_URL) { "$env:OPENLEX_RELEASE_URL".TrimEnd('/') } else { "https://github.com/$Repo/releases/download/v$Version" }

    $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("openlex-install-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
    try {
      if ($WantCli) { Install-Cli }
      if ($WantApp) {
        if ($WantCli) { Say '' }
        Install-App
      }
    } finally {
      Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch {
    # No `exit` here: with `irm | iex` that would close the user's window.
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
}
