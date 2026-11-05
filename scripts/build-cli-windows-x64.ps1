$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifest = Join-Path $root "crates\scriptmetakitcli\Cargo.toml"
$package = cargo metadata --manifest-path $manifest --locked --no-deps --format-version 1 | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw "cargo metadata failed with exit code $LASTEXITCODE"
}
$version = $package.packages[0].version
$distDir = if ($env:SCRIPTMETA_RELEASE_DIR) { $env:SCRIPTMETA_RELEASE_DIR } else { Join-Path $root "dist" }
$targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root ".tools\cargo-target" }
$env:CARGO_TARGET_DIR = $targetRoot
$stageName = "scriptmeta_${version}_windows_x64"
$stageDir = Join-Path $distDir $stageName
$zipPath = Join-Path $distDir "${stageName}.zip"
$existingRustFlags = $env:RUSTFLAGS
$env:RUSTFLAGS = "$existingRustFlags --remap-path-prefix=$root=. --remap-path-prefix=$env:USERPROFILE=~".Trim()

cargo build --manifest-path $manifest --release --locked --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) {
    throw "CLI build failed with exit code $LASTEXITCODE"
}

if ((Test-Path -LiteralPath $stageDir) -or (Test-Path -LiteralPath $zipPath)) {
    throw "Release output already exists; move it aside before rebuilding: $stageDir"
}
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
Copy-Item (Join-Path $targetRoot "x86_64-pc-windows-msvc\release\scriptmeta.exe") $stageDir
$portableExe = Join-Path $stageDir "scriptmeta.exe"
$binaryText = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($portableExe))
if ($binaryText.Contains($env:USERPROFILE)) {
    throw "CLI binary contains the local user profile path"
}
Copy-Item (Join-Path $root "LICENSE") (Join-Path $stageDir "LICENSE.txt")
Copy-Item (Join-Path $root "NOTICE") (Join-Path $stageDir "NOTICE.txt")
Copy-Item (Join-Path $root "crates\scriptmetakitcli\README.md") $stageDir
Copy-Item (Join-Path $root "THIRD_PARTY_LICENSES.md") $stageDir
tar.exe -a -cf $zipPath -C $distDir $stageName
if ($LASTEXITCODE -ne 0) {
    throw "Archive creation failed with exit code $LASTEXITCODE"
}
tar.exe -tf $zipPath | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Archive verification failed with exit code $LASTEXITCODE"
}

Write-Output "Built Windows CLI: $portableExe"
Write-Output "Built zip: $zipPath"
