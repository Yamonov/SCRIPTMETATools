# SCRIPTMETAKitMini Distribution

## Release targets

- macOS universal: Apple Silicon and Intel, Developer ID signed and notarized
- Windows x64: unsigned portable zip built natively with MSVC

Every package includes the repository MIT license, NOTICE, and generated third-party license
bundle.

## macOS requirements

- Rust 1.94.0
- `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets
- Node.js satisfying the Vite engine requirement
- Developer ID Application certificate for Team `5NFE273M7M`
- a `notarytool` Keychain profile

Create the notary profile once:

```console
npm run setup:notary:mac
```

The Apple ID must be supplied through `APPLE_ID` or the setup prompt. The default profile name is
`scriptmetakitapp-notary`; override it with `APPLE_KEYCHAIN_PROFILE` when necessary.

Build:

```console
npm ci
npm run dist:mac:universal
```

The release script fails unless Apple accepts both the app and DMG. It verifies the code
signature and stapled notarization tickets before completing.

## Windows requirements

- Windows x64 with the MSVC Rust toolchain 1.94.0
- Node.js 24 or another version supported by the locked Vite release
- WebView2 runtime for running the application

Build from PowerShell:

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File .\scripts\build-win-x64.ps1
```

The script creates `SCRIPTMETAKitMini_1.1.0_windows_x64.zip`, verifies the zip directory, and
includes all required notices. Windows code signing is not currently applied, so the GitHub
Release must identify this artifact as unsigned.

## Release verification

Before uploading artifacts:

1. Run frontend build, npm audit, Rust tests, format, and Clippy checks on macOS and Windows.
2. Confirm SCRIPTMETAKit resolves to tag `1.2.2` and revision
   `b1c3803fdf8455ebfe6fd9990e75f24a7ec5f175`.
3. Confirm the macOS app and CLI contain both `arm64` and `x86_64` slices.
4. Confirm Gatekeeper accepts the Mini app and DMG as Notarized Developer ID.
5. Confirm both Windows files are PE32+ x86-64 and document that they are unsigned.
6. Verify archive contents and publish `SHA256SUMS.txt` with the release.
