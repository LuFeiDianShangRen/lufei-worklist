$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$appOut = Join-Path $root "release\win-unpacked"
$icon = Join-Path $root "build\icon.ico"
$cacheRoot = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
$rcedit = $null

if (Test-Path $cacheRoot) {
  $rcedit = Get-ChildItem -Path $cacheRoot -Recurse -Filter "rcedit-x64.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

if (-not $rcedit) {
  $fallback = Join-Path $root "node_modules\electron-winstaller\vendor\rcedit.exe"
  if (Test-Path $fallback) {
    $rcedit = Get-Item $fallback
  }
}

if (-not (Test-Path $appOut)) {
  throw "App output not found: $appOut"
}

$exeFile = Get-ChildItem -Path $appOut -File -Filter "*.exe" |
  Where-Object { $_.Name -notin @("chrome_crashpad_handler.exe", "elevate.exe") } |
  Sort-Object Length -Descending |
  Select-Object -First 1

if (-not $exeFile) {
  throw "Main EXE not found in: $appOut"
}

$exe = $exeFile.FullName

if (-not (Test-Path $icon)) {
  throw "Icon not found: $icon"
}

if (-not $rcedit) {
  throw "rcedit not found"
}

& $rcedit.FullName $exe --set-icon $icon

if ($LASTEXITCODE -ne 0) {
  throw "rcedit failed: $LASTEXITCODE"
}

Write-Host "Applied icon: $icon"
