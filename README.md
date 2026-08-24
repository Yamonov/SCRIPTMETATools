# SCRIPTMETA Tools

Cross-platform tools powered by [SCRIPTMETAKit](https://github.com/Yamonov/SCRIPTMETAKit).

## Included tools

### SCRIPTMETAKitMini 1.1.0

A macOS and Windows desktop application for scanning, reviewing, validating, and editing
SCRIPTMETA-enabled scripts.

Source: [`apps/scriptmetamini`](apps/scriptmetamini)

### scriptmeta CLI 0.1.0

A read-only command-line tool for scanning SCRIPTMETA metadata, checking updates, inspecting
individual files, and producing human, JSON, or JSONL output.

Source: [`crates/scriptmetakitcli`](crates/scriptmetakitcli)

## Shared engine

Both tools use the exact SCRIPTMETAKit `1.2.2` release tag at revision
`b1c3803fdf8455ebfe6fd9990e75f24a7ec5f175`. Neither tool contains an app-side metadata parser
fallback.

## Build and test

```console
cd crates/scriptmetakitcli
cargo fmt --all --check
cargo test --locked
cargo clippy --all-targets --all-features --locked -- -D warnings

cd ../../apps/scriptmetamini
npm ci
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

See [`RELEASING.md`](RELEASING.md) for signed macOS and native Windows packaging.

## License

The source code in this repository is available under the [MIT License](LICENSE).
SCRIPTMETAKit and other dependencies remain under their respective licenses; see
[`NOTICE`](NOTICE) and [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
