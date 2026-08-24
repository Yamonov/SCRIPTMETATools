# scriptmetakitcli

`scriptmetakitcli` is a read-only, cross-platform command-line interface for
[SCRIPTMETAKit](https://github.com/Yamonov/SCRIPTMETAKit). The executable is named
`scriptmeta`.

The project currently uses SCRIPTMETAKit `1.2.2` directly from its release tag. It does not use
the C FFI or Swift wrapper.

## Build

Rust `1.94.0` is selected by `rust-toolchain.toml`.

```console
cargo build --release --locked
```

The executable is created at:

- macOS/Linux: `target/release/scriptmeta`
- Windows: `target\release\scriptmeta.exe`

## Update check

Passing directories without a subcommand performs an update check. At least one directory is
required; use `.` explicitly for the current directory.

```console
scriptmeta ~/Scripts "/Volumes/Work Scripts"
scriptmeta check ~/Scripts
scriptmeta --paths-from directories.txt
```

The command recursively scans SCRIPTMETA-enabled scripts, then follows each `Meta-URL` through
SCRIPTMETAKit's bounded update resolver. It reports updates but does not download or replace any
files.

## Commands

```text
scriptmeta [OPTIONS] <DIRECTORY>...
scriptmeta check [OPTIONS] <DIRECTORY>...
scriptmeta scan [OPTIONS] <DIRECTORY>...
scriptmeta inspect [OPTIONS] <FILE>
scriptmeta validate [OPTIONS] <PATH>...
scriptmeta formats [OPTIONS]
scriptmeta completions <SHELL>
```

- `check`: scans metadata and accesses each available `Meta-URL`.
- `scan`: produces a local metadata inventory without update-source access.
- `inspect`: reports one file's metadata and edit capability without changing the file.
- `validate`: reports parse issues and duplicate `Script-ID` values.
- `formats`: lists the formats and extensions supported by the linked Kit.
- `completions`: generates completion definitions for bash, elvish, fish, PowerShell, or zsh.

## Output

`--format human` is the default. Use `--format json` for a versioned report envelope or
`--format jsonl` for one record per line. Result data is written to stdout. Progress and fatal
diagnostics are written to stderr, so they never corrupt JSON output.

The JSON schema starts with `schema_version: 1` and records both the CLI and SCRIPTMETAKit
versions. Item status values are:

- `scanned`
- `up_to_date`
- `update_available`
- `not_checkable`
- `failed`
- `cancelled`

Use `--status` more than once to filter output items. Summary counts always describe the complete
operation, not only the filtered items.

## Important options

```text
--paths-from <FILE>            One UTF-8 path per line; use - for stdin
--format human|json|jsonl
--progress auto|always|never
--color auto|always|never
--fail-on never|errors|updates|updates-or-errors
--status <STATUS>
--concurrency <COUNT>          Default: 6
--retries <COUNT>              Default: 2
--request-timeout <DURATION>   Default: 15s
--resource-timeout <DURATION>  Default: 15s
--scan-timeout <DURATION>      Default: 30s per root
--max-depth <COUNT>            Default: 24
--max-nodes <COUNT>            Default: 10000 per root
--include-hidden
--include-packages
--no-follow-symlinks
--no-resolve-aliases
--decompile-osa
```

The shell expands globs. Paths read through `--paths-from` are used exactly as written; empty
lines are ignored. A UTF-8 BOM on the first line is accepted.

## Exit codes

- `0`: operation completed and the selected failure condition did not occur
- `2`: invalid arguments, path list, or input path
- `3`: fatal scan, engine, serialization, signal, or output failure
- `4`: an update check or validation item failed
- `10`: an update is available when `--fail-on updates` or `updates-or-errors` is selected
- `130`: interrupted with Ctrl+C

The default is `--fail-on errors`; an available update is data rather than an execution failure.
Use `--fail-on never` when every completed report should return zero.

## Safety boundaries

Version `0.1.0` is read-only. It does not edit SCRIPTMETA blocks, download releases, install
updates, create backups, maintain a persistent cache, or run as a resident watcher. On macOS,
`--decompile-osa` may invoke the system `osadecompile` tool to inspect compiled scripts; it does
not execute the script.

## Validation

```console
cargo fmt --all --check
cargo test --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo build --release --locked
```

## License

MIT. SCRIPTMETAKit and other dependencies retain their original licenses. See the repository
root `LICENSE`, `NOTICE`, and `THIRD_PARTY_LICENSES.md` files.
