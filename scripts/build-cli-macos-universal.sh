#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/crates/scriptmetakitcli/Cargo.toml"
VERSION="$(awk -F '"' '/^version = / { print $2; exit }' "$MANIFEST")"
DIST_DIR="$ROOT/dist"
STAGE_NAME="scriptmeta_${VERSION}_macos_universal"
STAGE_DIR="$DIST_DIR/$STAGE_NAME"
UNIVERSAL_BIN="$STAGE_DIR/scriptmeta"
ZIP_PATH="$DIST_DIR/${STAGE_NAME}.zip"
KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-scriptmetakitapp-notary}"

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

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target add "$target"
  cargo build --manifest-path "$MANIFEST" --release --locked --target "$target"
done

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR" "$DIST_DIR"
lipo -create \
  "$ROOT/crates/scriptmetakitcli/target/aarch64-apple-darwin/release/scriptmeta" \
  "$ROOT/crates/scriptmetakitcli/target/x86_64-apple-darwin/release/scriptmeta" \
  -output "$UNIVERSAL_BIN"
codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$UNIVERSAL_BIN"
cp "$ROOT/LICENSE" "$STAGE_DIR/LICENSE.txt"
cp "$ROOT/NOTICE" "$STAGE_DIR/NOTICE.txt"
cp "$ROOT/THIRD_PARTY_LICENSES.md" "$STAGE_DIR/THIRD_PARTY_LICENSES.md"

rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$STAGE_DIR" "$ZIP_PATH"
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$KEYCHAIN_PROFILE" --wait
codesign --verify --strict --verbose=2 "$UNIVERSAL_BIN"

echo "Built universal CLI: $UNIVERSAL_BIN"
echo "Built zip: $ZIP_PATH"
