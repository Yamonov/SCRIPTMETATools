#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ABOUT_VERSION="0.9.1"
ABOUT_CONFIG="$ROOT/licenses/about.toml"
ABOUT_TEMPLATE="$ROOT/licenses/rust-licenses.hbs"
CLI_OUTPUT="$ROOT/licenses/cli-rust.md"
MINI_RUST_OUTPUT="$ROOT/licenses/mini-rust.md"
MINI_NPM_OUTPUT="$ROOT/licenses/mini-npm.md"
FINAL_OUTPUT="$ROOT/THIRD_PARTY_LICENSES.md"

installed_version="$(cargo about --version 2>/dev/null | awk '{print $2}' || true)"
if [[ "$installed_version" != "$ABOUT_VERSION" ]]; then
  echo "cargo-about $ABOUT_VERSION is required; found '${installed_version:-none}'." >&2
  exit 1
fi

cargo about generate \
  --manifest-path "$ROOT/crates/scriptmetakitcli/Cargo.toml" \
  --config "$ABOUT_CONFIG" \
  --locked \
  --fail \
  --output-file "$CLI_OUTPUT" \
  "$ABOUT_TEMPLATE"

cargo about generate \
  --manifest-path "$ROOT/apps/scriptmetamini/src-tauri/Cargo.toml" \
  --config "$ABOUT_CONFIG" \
  --locked \
  --fail \
  --output-file "$MINI_RUST_OUTPUT" \
  "$ABOUT_TEMPLATE"

node "$ROOT/scripts/generate-npm-licenses.mjs" "$ROOT/apps/scriptmetamini" > "$MINI_NPM_OUTPUT"

{
  printf '# Third-Party Licenses\n\n'
  printf 'Generated from the locked dependency graphs for SCRIPTMETA Tools.\n\n'
  printf '## scriptmeta CLI Rust dependencies\n\n'
  cat "$CLI_OUTPUT"
  printf '\n## SCRIPTMETAKitMini Rust dependencies\n\n'
  cat "$MINI_RUST_OUTPUT"
  printf '\n## SCRIPTMETAKitMini bundled npm dependencies\n\n'
  cat "$MINI_NPM_OUTPUT"
} > "$FINAL_OUTPUT"

perl -pi -e 's/[ \t\r]+$//' "$FINAL_OUTPUT"

echo "Generated $FINAL_OUTPUT"
