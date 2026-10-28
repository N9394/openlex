# OpenLex installer for Windows (Windows PowerShell 5.1 and PowerShell 7).
#
#   irm https://<site>/install.ps1 | iex
#   $env:OPENLEX_VERSION = '0.2.0'; irm https://<site>/install.ps1 | iex
#
# Installs the OpenLex engine + CLI into %USERPROFILE%\.openlex (the same
# folder as ~/.openlex on macOS and Linux) and puts an `openlex.cmd` into
# %USERPROFILE%\.openlex\bin, which is added to your user PATH. No admin
# rights, nothing outside that folder is changed besides the user PATH
# entry. Needs Node.js >= 20. The package is downloaded from the GitHub
# release and checked against its published SHA-256 before it is unpacked.
#
# Settings (environment variables, all optional):
#   OPENLEX_VERSION   version to install (default: the latest release)
#   OPENLEX_HOME      install folder (default: %USERPROFILE%\.openlex)
#   OPENLEX_BIN_DIR   folder for openlex.cmd (default: <install folder>\bin)
#
# Upgrade: run the same line again. Uninstall:
#   Remove-Item -Recurse -Force "$env:USERPROFILE\.openlex"
#   then remove ...\.openlex\bin from Path in "Edit environment variables
#   for your account". Your matters and settings in %USERPROFILE%\.lexvault
#   are kept; delete that folder too to remove everything.
#
# This file is plain ASCII on purpose: Windows PowerShell 5.1 reads a
# downloaded script without a charset as Latin-1.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads in 5.1 very slow

  $Repo = 'N9394/openlex'
  $Version = "$env:OPENLEX_VERSION".Trim() -replace '^v', ''
  $Prefix = if ($env:OPENLEX_HOME) { $env:OPENLEX_HOME } else { Join-Path $HOME '.openlex' }
  $BinDir = if ($env:OPENLEX_BIN_DIR) { $env:OPENLEX_BIN_DIR } else { Join-Path $Prefix 'bin' }
  $OnWindows = ($PSVersionTable.PSEdition -ne 'Core') -or $IsWindows

  function Say([string]$Text, [string]$Color) {
    if ($Color) { Write-Host $Text -ForegroundColor $Color } else { Write-Host $Text }
  }
  function Fail([string]$Text) { throw "openlex install: $Text" }

  function Remove-Dir([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir)) { return }
    try { Remove-Item -LiteralPath $Dir -Recurse -Force } catch { }
    # Remove-Item in 5.1 sometimes gives up on deep node_modules trees.
    if ((Test-Path -LiteralPath $Dir) -and $OnWindows) { try { & cmd.exe /d /c rd /s /q $Dir 2>$null } catch { } }
    if (Test-Path -LiteralPath $Dir) {
      Fail "could not remove $Dir - quit OpenLex (and any window running openlex), then run the installer again"
    }
  }

  try {
    # GitHub needs TLS 1.2; older Windows PowerShell 5.1 does not offer it by default.
    if ($PSVersionTable.PSEdition -ne 'Core') {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }

    # tar.exe ships with Windows 10 (1803) and later. Use that one: a GNU tar
    # from Git for Windows on PATH would read C:\... as a remote host.
    $Tar = if ($OnWindows) { Join-Path $env:SystemRoot 'System32\tar.exe' } else { 'tar' }
    if ($OnWindows -and -not (Test-Path -LiteralPath $Tar)) {
      Fail 'tar.exe was not found. OpenLex needs Windows 10 (version 1803) or newer.'
    }

    $Node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Node) {
      Fail ("Node.js 20 or newer is required. Install it, open a new terminal window and run this again:`n" +
        "    winget install OpenJS.NodeJS.LTS`n" +
        "  (or download it from https://nodejs.org)")
    }
    $NodeVersion = (& $Node.Path -v) -replace '^v', ''
    $NodeMajor = 0
    [void][int]::TryParse(($NodeVersion -split '\.')[0], [ref]$NodeMajor)
    if ($NodeMajor -lt 20) {
      Fail "Node.js $NodeVersion found; OpenLex needs 20 or newer. Update it with: winget upgrade OpenJS.NodeJS.LTS"
    }

    if (-not $Version) {
      try {
        $Latest = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest"
        $Version = "$($Latest.tag_name)" -replace '^v', ''
      } catch { }
      if (-not $Version) { Fail 'could not find the latest release (GitHub API); set $env:OPENLEX_VERSION = ''X.Y.Z'' and run again' }
    }

    $Name = "openlex-$Version"
    $Url = "https://github.com/$Repo/releases/download/v$Version/$Name.tar.gz"
    $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("openlex-install-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
    try {
      Say "OpenLex $Version -> $Prefix" 'White'
      $Archive = Join-Path $Tmp "$Name.tar.gz"
      try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Archive } catch { Fail "download failed: $Url" }
      try { Invoke-WebRequest -UseBasicParsing -Uri "$Url.sha256" -OutFile "$Archive.sha256" } catch { Fail 'checksum download failed' }
      $Expected = ((Get-Content -LiteralPath "$Archive.sha256" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
      $Actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($Expected -ne $Actual) { Fail "checksum mismatch (expected $Expected, got $Actual) - not installing" }

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
    } finally {
      Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
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
  } catch {
    # No `exit` here: with `irm | iex` that would close the user's window.
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
}
