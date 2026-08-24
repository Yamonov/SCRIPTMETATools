# Releasing SCRIPTMETA Tools

The combined `tools-v1.0.0` release contains SCRIPTMETAKitMini `1.1.0` and scriptmeta CLI
`0.1.0`.

## macOS

```console
./scripts/build-cli-macos-universal.sh
cd apps/scriptmetamini
npm ci
npm run dist:mac:universal
```

The Mini build must pass Developer ID signing, notarization, and stapling checks. The CLI universal
binary is Developer ID signed and its zip is submitted to Apple notarization.

## Windows

Run on the Windows host from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-cli-windows-x64.ps1
Set-Location .\apps\scriptmetamini
npm ci
powershell -ExecutionPolicy Bypass -File .\scripts\build-win-x64.ps1
```

Windows artifacts are currently unsigned and must be described as unsigned in the GitHub Release.

## Required release files

- `SCRIPTMETAKitMini_1.1.0_macos_universal.dmg`
- `SCRIPTMETAKitMini_1.1.0_windows_x64.zip`
- `scriptmeta_0.1.0_macos_universal.zip`
- `scriptmeta_0.1.0_windows_x64.zip`
- `SHA256SUMS.txt`
- `LICENSE`
- `NOTICE`
- `THIRD_PARTY_LICENSES.md`
