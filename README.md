# SCRIPTMETA Tools 1.5.0

macOS and Windows tools for working with [SCRIPTMETA](https://github.com/Yamonov/SCRIPTMETAKit) script metadata.

[日本語](README.ja.md) · [Download 1.5.0](https://github.com/Yamonov/SCRIPTMETATools/releases/tag/tools-v1.5.0) · [Changelog](CHANGELOG.md)

## Downloads

| Tool | macOS — Apple Silicon and Intel | Windows — x64 |
| --- | --- | --- |
| **SCRIPTMETAKitMini 1.5.0** | [Universal DMG](https://github.com/Yamonov/SCRIPTMETATools/releases/download/tools-v1.5.0/SCRIPTMETAKitMini_1.5.0_macos_universal.dmg) | [Portable ZIP](https://github.com/Yamonov/SCRIPTMETATools/releases/download/tools-v1.5.0/SCRIPTMETAKitMini_1.5.0_windows_x64.zip) |
| **scriptmeta CLI 1.5.0** | [Universal ZIP](https://github.com/Yamonov/SCRIPTMETATools/releases/download/tools-v1.5.0/scriptmeta_1.5.0_macos_universal.zip) | [Portable ZIP](https://github.com/Yamonov/SCRIPTMETATools/releases/download/tools-v1.5.0/scriptmeta_1.5.0_windows_x64.zip) |

macOS binaries are Developer ID signed and notarized by Apple. The Mini app and DMG have stapled notarization tickets. Windows binaries are unsigned. Check the downloaded files against `SHA256SUMS.txt` in the release.

On macOS, open the Mini DMG and drag the app to Applications. On Windows, extract the Mini ZIP and run `scriptmetakitmini.exe`; Microsoft Edge WebView2 Runtime is required. Extract the CLI ZIP and run `scriptmeta` / `scriptmeta.exe` from a terminal, or place it in a directory on your `PATH`.

## SCRIPTMETAKitMini

The desktop application scans registered script folders, checks update metadata, and edits SCRIPTMETA blocks.

- Edit **Name, Author, and Description in multiple languages**, with an independent language tab for each field. Empty translations are shown with a pale red tab.
- Add languages from the `+` menu, remove a selected language with `−`, and drag languages to reorder them. The first language is the default. The language list supports up to ten added languages and preserves already-existing language entries.
- Edit **Tags** as common metadata across languages. The tag area uses the editor's full width and does not wrap text inside individual tags.
- Edit **user-defined `X-` fields** as `key=value`, one entry per line. Invalid lines are highlighted after a short typing pause; validation waits during IME composition and preserves native text selection and undo.
- Preview metadata before saving. Saves detect external file changes, retain unknown/unchanged fields, and create backups.
- Use Local Subset or Update Profile metadata. Update checks report availability and provide a link to the distribution page; they do not automatically install script updates.

Source and details: [`apps/scriptmetamini`](apps/scriptmetamini).

## scriptmeta CLI

The CLI is **read-only**. It scans, checks updates, inspects metadata, and validates scripts without editing files, downloading releases, or installing updates.

```console
scriptmeta check ./Scripts
scriptmeta scan ./Scripts --format json
scriptmeta scan ./Scripts --language ja --language en --custom-key X- --format json
scriptmeta inspect ./Scripts/Example.jsx --format json
scriptmeta validate ./Scripts
scriptmeta formats
scriptmeta completions zsh
```

Passing directories without a subcommand performs an update check. At least one directory is required; use `.` explicitly for the current directory.

`--language` sets the preferred display languages for `scan` and `check`, in priority order. The Kit selects Name, Author, and Description and reports the selected language for each. `Tags` are shared across languages.

`--custom-key` requests custom metadata in `scan` / `check`; repeat it for specific keys, or pass `X-` for all supported custom keys. Custom keys are matched without ASCII case sensitivity. `inspect` returns all editable translations, Tags, and custom fields, including empty and repeated values. `validate` checks file metadata through the Kit and reports invalid custom/localization fields and duplicate Script-ID values.

Human, JSON, and JSONL output are available. JSON schema version 1 retains the existing fields and adds `author`, `description`, and `presentation` to scan items; `presentation` contains language selection, Tags, requested custom fields, and diagnostics. Progress goes to stderr. See the [CLI README](crates/scriptmetakitcli/README.md) for options and exit codes.

## Shared engine and source builds

Both tools use SCRIPTMETAKit **2.1.1**, pinned to release tag `2.1.1` at revision `4f9bdb27483b869b2fb7280df0e2b2705bdd62f5`. The public project does not require a sibling Kit checkout. Metadata parsing, language conversion, validation, and serialization use the shared Kit.

Rust 1.94.0 is specified by `rust-toolchain.toml`. Use Node.js 24 for the Mini frontend.

```console
cd crates/scriptmetakitcli
cargo fmt --all --check
cargo test --locked
cargo clippy --all-targets --all-features --locked -- -D warnings

cd ../../apps/scriptmetamini
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

See [RELEASING.md](RELEASING.md) for signed macOS Universal and native Windows packaging.

## License

Source code: [MIT](LICENSE). SCRIPTMETAKit remains Apache-2.0 licensed. Dependency notices and license texts are included with the downloads and in [NOTICE](NOTICE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
