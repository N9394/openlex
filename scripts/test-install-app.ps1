# Tests the desktop app part of install.ps1 against a fake release served
# from this computer (no network, no real release needed). Used by CI on
# Windows. Run it with Windows PowerShell 5.1 (it builds a tiny stand-in
# installer with Add-Type); it then runs install.ps1 the way users do, in
# Windows PowerShell 5.1 and, if present, PowerShell 7:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-install-app.ps1
#
# Checks: the installer is run silently for the current user (/S
# /currentuser) after the checksum matched, via $env:OPENLEX_APP and via
# -App; the SHA256SUMS fallback works; a checksum mismatch stops before the
# installer runs.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$V = '9.9.9'
$File = "OpenLex-$V-windows-x64-setup.exe"
$Script = Join-Path $PSScriptRoot 'install.ps1'
$Work = Join-Path ([IO.Path]::GetTempPath()) ('openlex-apptest-' + [guid]::NewGuid().ToString('N'))
$Port = 8766
$Programs = Join-Path $env:LOCALAPPDATA 'Programs\OpenLex'
$ArgsFile = Join-Path $Programs 'installer-args.txt'

function Fail([string]$Text) { throw "FAIL: $Text" }

New-Item -ItemType Directory -Force -Path "$Work\good", "$Work\sums", "$Work\bad" | Out-Null

# A stand-in for the NSIS installer: records its arguments and "installs"
# itself as OpenLex.exe where the real one goes.
Add-Type -OutputAssembly "$Work\good\$File" -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public static class FakeSetup {
  public static int Main(string[] args) {
    string dir = Path.Combine(Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA"), "Programs"), "OpenLex");
    Directory.CreateDirectory(dir);
    File.WriteAllText(Path.Combine(dir, "installer-args.txt"), String.Join(" ", args));
    File.Copy(System.Reflection.Assembly.GetExecutingAssembly().Location, Path.Combine(dir, "OpenLex.exe"), true);
    return 0;
  }
}
'@

function Write-Sum([string]$Dir, [string]$Name, [string]$Target) {
  $h = (Get-FileHash -LiteralPath (Join-Path $Dir $Name) -Algorithm SHA256).Hash.ToLowerInvariant()
  Add-Content -LiteralPath $Target -Value "$h  $Name" -Encoding ASCII
}
Write-Sum "$Work\good" $File "$Work\good\$File.sha256"
Copy-Item "$Work\good\$File" "$Work\sums\$File"
Write-Sum "$Work\sums" $File "$Work\sums\SHA256SUMS"
Copy-Item "$Work\good\$File" "$Work\bad\$File"
Add-Content -LiteralPath "$Work\bad\$File" -Value 'tampered' -Encoding ASCII
Copy-Item "$Work\good\$File.sha256" "$Work\bad\$File.sha256"

$Python = (Get-Command python -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $Python) { Fail 'python is needed for the local web server' }
$Server = Start-Process -FilePath $Python -ArgumentList @('-m', 'http.server', "$Port", '--bind', '127.0.0.1', '--directory', $Work) -PassThru -WindowStyle Hidden
try {
  $up = $false
  for ($i = 0; $i -lt 50 -and -not $up; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" | Out-Null; $up = $true } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $up) { Fail 'the local web server did not start' }

  # Runs install.ps1 in a fresh shell, as users do. $How: 'env' (piped
  # into Invoke-Expression with $env:OPENLEX_APP=1) or 'switch' (-App).
  function Invoke-Install([string]$Shell, [string]$Dir, [string]$How) {
    $env:OPENLEX_VERSION = $V
    $env:OPENLEX_RELEASE_URL = "http://127.0.0.1:$Port/$Dir"
    if ($How -eq 'env') {
      $env:OPENLEX_APP = '1'
      $cmd = "Get-Content -LiteralPath '$Script' -Raw | Invoke-Expression"
    } else {
      Remove-Item Env:OPENLEX_APP -ErrorAction SilentlyContinue
      $cmd = "& ([scriptblock]::Create((Get-Content -LiteralPath '$Script' -Raw))) -App"
    }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $Shell -NoProfile -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String } finally { $ErrorActionPreference = $old }
    Write-Host $out
    return $out
  }

  $Shells = @('powershell')
  if (Get-Command pwsh -ErrorAction SilentlyContinue) { $Shells += 'pwsh' }
  foreach ($Shell in $Shells) {
    foreach ($Case in @(@('good', 'env'), @('sums', 'switch'))) {
      Write-Host "== $Shell, release '$($Case[0])', options via $($Case[1])"
      Remove-Item -LiteralPath $Programs -Recurse -Force -ErrorAction SilentlyContinue
      $out = Invoke-Install $Shell $Case[0] $Case[1]
      if ($out -notmatch 'sha256 matches') { Fail "$Shell/$($Case[0]): no checksum message" }
      if ($out -notmatch 'Only the checksum was checked') { Fail "$Shell/$($Case[0]): no 'Only the checksum was checked' message" }
      if (-not (Test-Path -LiteralPath $ArgsFile)) { Fail "$Shell/$($Case[0]): the installer did not run" }
      $a = (Get-Content -LiteralPath $ArgsFile -Raw).Trim()
      if ($a -ne '/S /currentuser') { Fail "$Shell/$($Case[0]): installer arguments were '$a'" }
      if ($out -notmatch [regex]::Escape("$Programs\OpenLex.exe")) { Fail "$Shell/$($Case[0]): the install place was not shown" }
    }

    Write-Host "== $Shell, checksum mismatch must stop the install"
    Remove-Item -LiteralPath $Programs -Recurse -Force -ErrorAction SilentlyContinue
    $out = Invoke-Install $Shell 'bad' 'env'
    if ($out -notmatch 'checksum mismatch') { Fail "$Shell/bad: no mismatch message" }
    if (Test-Path -LiteralPath $ArgsFile) { Fail "$Shell/bad: the installer ran despite a checksum mismatch" }
  }
  Write-Host 'OK: install.ps1 desktop app'
} finally {
  Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Programs -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item Env:OPENLEX_APP, Env:OPENLEX_VERSION, Env:OPENLEX_RELEASE_URL -ErrorAction SilentlyContinue
}
