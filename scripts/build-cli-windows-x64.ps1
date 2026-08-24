$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifest = Join-Path $root "crates\scriptmetakitcli\Cargo.toml"
$package = cargo metadata --manifest-path $manifest --locked --no-deps --format-version 1 | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw "cargo metadata failed with exit code $LASTEXITCODE"
}
$version = $package.packages[0].version
$distDir = Join-Path $root "dist"
$stageName = "scriptmeta_${version}_windows_x64"
$stageDir = Join-Path $distDir $stageName
$zipPath = Join-Path $distDir "${stageName}.zip"

cargo build --manifest-path $manifest --release --locked
if ($LASTEXITCODE -ne 0) {
    throw "CLI build failed with exit code $LASTEXITCODE"
}

if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
Copy-Item (Join-Path $root "crates\scriptmetakitcli\target\release\scriptmeta.exe") $stageDir
Copy-Item (Join-Path $root "LICENSE") (Join-Path $stageDir "LICENSE.txt")
Copy-Item (Join-Path $root "NOTICE") (Join-Path $stageDir "NOTICE.txt")
Copy-Item (Join-Path $root "THIRD_PARTY_LICENSES.md") $stageDir
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
tar -a -cf $zipPath -C $distDir $stageName
if ($LASTEXITCODE -ne 0) {
    throw "Archive creation failed with exit code $LASTEXITCODE"
}
tar -tf $zipPath | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Archive verification failed with exit code $LASTEXITCODE"
}

Write-Output "Built Windows CLI: $(Join-Path $stageDir 'scriptmeta.exe')"
Write-Output "Built zip: $zipPath"
