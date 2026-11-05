$ErrorActionPreference = "Stop"

$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $appRoot "..\..")).Path
Set-Location $appRoot

$package = Get-Content -Raw ".\package.json" | ConvertFrom-Json
$productName = "SCRIPTMETAKitMini"
$version = $package.version
$targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repoRoot ".tools\cargo-target" }
$env:CARGO_TARGET_DIR = $targetRoot
$targetDir = Join-Path $targetRoot "x86_64-pc-windows-msvc\release"
$portableRoot = Join-Path $targetDir "bundle\portable"
$portableDir = Join-Path $portableRoot $productName
$zipDir = if ($env:SCRIPTMETA_RELEASE_DIR) { $env:SCRIPTMETA_RELEASE_DIR } else { Join-Path $repoRoot "dist" }
$zipPath = Join-Path $zipDir "${productName}_${version}_windows_x64.zip"
$existingRustFlags = $env:RUSTFLAGS
$env:RUSTFLAGS = "$existingRustFlags --remap-path-prefix=$repoRoot=. --remap-path-prefix=$env:USERPROFILE=~".Trim()

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

& npm.cmd run tauri -- build --no-bundle --target x86_64-pc-windows-msvc -- --locked
if ($LASTEXITCODE -ne 0) {
    throw "Tauri build failed with exit code $LASTEXITCODE"
}

if ((Test-Path -LiteralPath $portableDir) -or (Test-Path -LiteralPath $zipPath)) {
    throw "Release output already exists; move it aside before rebuilding: $portableDir"
}
New-Item -ItemType Directory -Path $portableDir -Force | Out-Null
New-Item -ItemType Directory -Path $zipDir -Force | Out-Null
Copy-Item (Join-Path $targetDir "scriptmetakitmini.exe") $portableDir
Copy-Item (Join-Path $repoRoot "LICENSE") (Join-Path $portableDir "LICENSE.txt")
Copy-Item (Join-Path $repoRoot "NOTICE") (Join-Path $portableDir "NOTICE.txt")
Copy-Item (Join-Path $appRoot "README.md") $portableDir
Copy-Item (Join-Path $repoRoot "THIRD_PARTY_LICENSES.md") $portableDir
$portableExe = Join-Path $portableDir "scriptmetakitmini.exe"
Wait-FileReadable $portableExe
$binaryText = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($portableExe))
if ($binaryText.Contains($env:USERPROFILE)) {
    throw "Mini binary contains the local user profile path"
}
tar.exe -a -cf $zipPath -C $portableRoot $productName
if ($LASTEXITCODE -ne 0) {
    throw "Archive creation failed with exit code $LASTEXITCODE"
}
tar.exe -tf $zipPath | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Archive verification failed with exit code $LASTEXITCODE"
}

Write-Output "Built portable app: $portableExe"
Write-Output "Built zip: $zipPath"
