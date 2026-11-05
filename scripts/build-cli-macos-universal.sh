#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/crates/scriptmetakitcli/Cargo.toml"
VERSION="$(awk -F '"' '/^version = / { print $2; exit }' "$MANIFEST")"
DIST_DIR="${SCRIPTMETA_RELEASE_DIR:-$ROOT/dist}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.tools/cargo-target}"
STAGE_NAME="scriptmeta_${VERSION}_macos_universal"
STAGE_DIR="$DIST_DIR/$STAGE_NAME"
UNIVERSAL_BIN="$STAGE_DIR/scriptmeta"
ZIP_PATH="$DIST_DIR/${STAGE_NAME}.zip"
KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-scriptmetakitapp-notary}"
export RUSTFLAGS="${RUSTFLAGS:+${RUSTFLAGS} }--remap-path-prefix=${ROOT}=. --remap-path-prefix=${HOME}=~"

resolve_identity() {
  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "$APPLE_SIGNING_IDENTITY"
    return
  fi
  security find-identity -v -p codesigning \
    | awk '/Developer ID Application:/ && /5NFE273M7M/ { print $2; exit }'
}

SIGNING_IDENTITY="$(resolve_identity)"
if [[ -z "$SIGNING_IDENTITY" ]]; then
  echo "Developer ID Application certificate was not found." >&2
  exit 1
fi

if [[ -e "$STAGE_DIR" || -e "$ZIP_PATH" ]]; then
  echo "Release output already exists; move it aside before rebuilding: $STAGE_DIR" >&2
  exit 1
fi

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target add "$target"
  cargo build --manifest-path "$MANIFEST" --release --locked --target "$target"
done

mkdir -p "$STAGE_DIR" "$DIST_DIR"
lipo -create \
  "$CARGO_TARGET_DIR/aarch64-apple-darwin/release/scriptmeta" \
  "$CARGO_TARGET_DIR/x86_64-apple-darwin/release/scriptmeta" \
  -output "$UNIVERSAL_BIN"
codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$UNIVERSAL_BIN"
if strings "$UNIVERSAL_BIN" | grep -F "$HOME"; then
  echo "CLI binary contains the local home path." >&2
  exit 1
fi
cp "$ROOT/LICENSE" "$STAGE_DIR/LICENSE.txt"
cp "$ROOT/NOTICE" "$STAGE_DIR/NOTICE.txt"
cp "$ROOT/crates/scriptmetakitcli/README.md" "$STAGE_DIR/README.md"
cp "$ROOT/THIRD_PARTY_LICENSES.md" "$STAGE_DIR/THIRD_PARTY_LICENSES.md"

ditto -c -k --keepParent "$STAGE_DIR" "$ZIP_PATH"
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$KEYCHAIN_PROFILE" --wait --output-format json > "$ZIP_PATH.notary.json"
[[ "$(plutil -extract status raw -o - "$ZIP_PATH.notary.json")" == "Accepted" ]]
codesign --verify --strict --verbose=2 -R=notarized --check-notarization "$UNIVERSAL_BIN"

echo "Built universal CLI: $UNIVERSAL_BIN"
echo "Built zip: $ZIP_PATH"
