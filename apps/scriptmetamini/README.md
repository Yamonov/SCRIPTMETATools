# SCRIPTMETAKitMini

SCRIPTMETAKitMini is a cross-platform Tauri desktop application for scanning, reviewing,
validating, and editing SCRIPTMETA-enabled scripts.

Version `1.1.0` uses SCRIPTMETAKit `1.2.2` from its public release tag.
The bundle identifier remains `com.yamo.scriptmetakitapp` so existing version 1.0 installations
retain their application identity and stored data.

## Development

```console
npm ci
npm run tauri dev
```

## Validation

```console
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

## Distribution

See [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md) and the repository-level
[`RELEASING.md`](../../RELEASING.md).

## License

MIT. SCRIPTMETAKit and other dependencies retain their original licenses. See the repository
`LICENSE`, `NOTICE`, and `THIRD_PARTY_LICENSES.md` files.
