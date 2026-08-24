$ErrorActionPreference = "Stop"

$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $appRoot "..\..")).Path
Set-Location $appRoot

$package = Get-Content -Raw ".\package.json" | ConvertFrom-Json
$productName = "SCRIPTMETAKitMini"
$version = $package.version
$targetDir = Join-Path $appRoot "src-tauri\target\release"
$portableRoot = Join-Path $targetDir "bundle\portable"
$portableDir = Join-Path $portableRoot $productName
$zipDir = Join-Path $targetDir "bundle\zip"
$zipPath = Join-Path $zipDir "${productName}_${version}_windows_x64.zip"

function Wait-FileReadable([string]$Path) {
    foreach ($attempt in 1..30) {
        try {
            $stream = [System.IO.File]::Open(
                $Path,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::Read
            )
            $stream.Dispose()
            return
        } catch {
            if ($attempt -eq 30) {
                throw "File remained locked after 30 attempts: $Path"
            }
            Start-Sleep -Seconds 1
        }
    }
}

& npm run tauri -- build --no-bundle
if ($LASTEXITCODE -ne 0) {
    throw "Tauri build failed with exit code $LASTEXITCODE"
}

if (Test-Path -LiteralPath $portableDir) {
    Remove-Item -LiteralPath $portableDir -Recurse -Force
}
New-Item -ItemType Directory -Path $portableDir -Force | Out-Null
New-Item -ItemType Directory -Path $zipDir -Force | Out-Null
Copy-Item (Join-Path $targetDir "scriptmetakitmini.exe") $portableDir
Copy-Item (Join-Path $repoRoot "LICENSE") (Join-Path $portableDir "LICENSE.txt")
Copy-Item (Join-Path $repoRoot "NOTICE") (Join-Path $portableDir "NOTICE.txt")
Copy-Item (Join-Path $repoRoot "THIRD_PARTY_LICENSES.md") $portableDir
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
$portableExe = Join-Path $portableDir "scriptmetakitmini.exe"
Wait-FileReadable $portableExe
tar -a -cf $zipPath -C $portableRoot $productName
if ($LASTEXITCODE -ne 0) {
    throw "Archive creation failed with exit code $LASTEXITCODE"
}
tar -tf $zipPath | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Archive verification failed with exit code $LASTEXITCODE"
}

Write-Output "Built portable app: $portableExe"
Write-Output "Built zip: $zipPath"
