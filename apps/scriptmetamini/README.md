# SCRIPTMETAKitMini 1.5.0

Desktop metadata editor and update checker for macOS and Windows, powered by SCRIPTMETAKit 2.1.1.

Register script folders, select a script, edit its metadata, and save with backup and external-change detection. The language list uses `+` / `−` controls and drag reordering; its first entry is the default language. Name, Author, and Description each have independent language tabs, with empty translations marked in pale red. The multilingual checkbox controls whether changes to the language structure are included in the save; existing-language text edits are retained when it is unchecked.

Tags are shared across languages. The full-width tag area wraps between tags rather than inside them. User-defined `X-` fields are entered as `key=value`, one per line, above Description. Invalid lines are highlighted after a typing pause, with IME composition, selection, and undo preserved. A blank value (`X-iw-Note=`) differs from deleting the entire line. Repeated keys are supported.

Update checks report available versions and open distribution pages; they do not automatically replace scripts. Metadata syntax, validation, and writing are implemented by the shared Kit.

## Install

- macOS: copy `SCRIPTMETAKitMini.app` from the DMG to Applications. The Universal app supports Apple Silicon and Intel, is Developer ID signed, notarized, and stapled.
- Windows x64: extract the portable ZIP and run `scriptmetakitmini.exe`. Microsoft Edge WebView2 Runtime is required. The executable is unsigned.

## Build and test from source

```console
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

Use `npm run tauri -- dev` to run a development build. Release packaging is documented in the repository's `RELEASING.md`.

Downloads and source: https://github.com/Yamonov/SCRIPTMETATools
