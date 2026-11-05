# Releasing SCRIPTMETA Tools

The combined `tools-v1.5.0` release contains SCRIPTMETAKitMini `1.5.0` and scriptmeta CLI
`1.5.0`, using SCRIPTMETAKit `2.1.1`.

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

- `SCRIPTMETAKitMini_1.5.0_macos_universal.dmg`
- `SCRIPTMETAKitMini_1.5.0_windows_x64.zip`
- `scriptmeta_1.5.0_macos_universal.zip`
- `scriptmeta_1.5.0_windows_x64.zip`
- `SHA256SUMS.txt`
- `LICENSE`
- `NOTICE`
- `THIRD_PARTY_LICENSES.md`

## Release checks

Run the CI checks on macOS and Windows before tagging. Regenerate `THIRD_PARTY_LICENSES.md` with `./scripts/generate-third-party-licenses.sh` after locked dependencies change. Release scripts share `.tools/cargo-target` by default; `CARGO_TARGET_DIR` can override it. Final packages are written to `dist`, or `SCRIPTMETA_RELEASE_DIR`. Existing staged packages and archives cause an error rather than being deleted.

The scripts remap source/home paths in Rust builds. Inspect final binaries for personal paths, check architectures and included licenses, and verify notarization results. The Mini app and DMG can be stapled; a standalone CLI executable cannot be stapled, so its signed archive is submitted for notarization. Windows archives use native `tar.exe` and must have portable entry names.

Create a pull request and wait for macOS/Windows CI. After merging, create an annotated `tools-v1.5.0` tag at the validated commit. Publish the four packages and notices listed above, plus SHA-256 checksums. Download the published packages again and verify their hashes and archive contents. Publishing these files does not update the separate Homebrew tap or product website.
