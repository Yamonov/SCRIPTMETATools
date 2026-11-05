#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
cd "$ROOT_DIR"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$REPO_ROOT/.tools/cargo-target}"

export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
export RUSTFLAGS="${RUSTFLAGS:+${RUSTFLAGS} }--remap-path-prefix=${REPO_ROOT}=. --remap-path-prefix=${HOME}=~"

submit_notary() {
  local path="$1"
  local profile="$2"
  local attempts=0

  until [[ $attempts -ge 3 ]]; do
    attempts=$((attempts + 1))
    if xcrun notarytool submit "$path" --keychain-profile "$profile" --wait --output-format json > "$path.notary.json"; then
      [[ "$(plutil -extract status raw -o - "$path.notary.json")" == "Accepted" ]] || return 1
      return 0
    fi

    if [[ $attempts -lt 3 ]]; then
      echo "Notarization submit failed. Retrying (${attempts}/3)..."
      sleep 5
    fi
  done

  return 1
}

resolve_identity() {
  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "$APPLE_SIGNING_IDENTITY"
    return 0
  fi

  local resolved
  resolved="$(security find-identity -v -p codesigning | awk 'index($0, "Developer ID Application: Yoshiteru Murakami (5NFE273M7M)") { print $2; exit }')"
  if [[ -z "$resolved" ]]; then
    resolved="$(security find-identity -v -p codesigning | awk '/Developer ID Application:/ && /5NFE273M7M/ { print $2; exit }')"
  fi
  if [[ -z "$resolved" ]]; then
    echo "Developer ID Application certificate was not found."
    exit 1
  fi

  echo "$resolved"
}

export APPLE_SIGNING_IDENTITY="$(resolve_identity)"
KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-scriptmetakitapp-notary}"

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required to build a universal macOS app."
  echo "Install rustup and run:"
  echo "  rustup target add x86_64-apple-darwin aarch64-apple-darwin"
  exit 1
fi

for target in x86_64-apple-darwin aarch64-apple-darwin; do
  if ! rustup target list --installed | grep -qx "$target"; then
    echo "Rust target is missing: $target"
    echo "Run: rustup target add x86_64-apple-darwin aarch64-apple-darwin"
    exit 1
  fi
done

PRODUCT_NAME="$(node -p "JSON.parse(require('fs').readFileSync('./src-tauri/tauri.conf.json', 'utf8')).productName")"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('./package.json', 'utf8')).version")"
APP_BUNDLE="$CARGO_TARGET_DIR/universal-apple-darwin/release/bundle/macos/${PRODUCT_NAME}.app"
APP_ZIP="${SCRIPTMETA_RELEASE_DIR:-$REPO_ROOT/dist}/${PRODUCT_NAME}_${VERSION}.notary-app.zip"
DMG_DIR="${SCRIPTMETA_RELEASE_DIR:-$REPO_ROOT/dist}"
DMG_PATH="${DMG_DIR}/${PRODUCT_NAME}_${VERSION}_macos_universal.dmg"
if [[ -e "$APP_ZIP" || -e "$DMG_PATH" ]]; then
  echo "Release output already exists; move it aside before rebuilding." >&2
  exit 1
fi
mkdir -p "$DMG_DIR"
STAGE_DIR="$(mktemp -d "$DMG_DIR/mini-staging.XXXXXX")"

npm run tauri -- build --target universal-apple-darwin --bundles app -- --locked

if strings "$APP_BUNDLE/Contents/MacOS/scriptmetakitmini" | grep -F "$HOME"; then
  echo "Mini binary contains the local home path." >&2
  exit 1
fi

echo "Submitting app for notarization with profile: $KEYCHAIN_PROFILE"
ditto -c -k --keepParent "$APP_BUNDLE" "$APP_ZIP"
submit_notary "$APP_ZIP" "$KEYCHAIN_PROFILE"
xcrun stapler staple "$APP_BUNDLE"

mkdir -p "$STAGE_DIR"
cp -R "$APP_BUNDLE" "$STAGE_DIR/"
ln -s /Applications "$STAGE_DIR/Applications"
cp "$REPO_ROOT/LICENSE" "$STAGE_DIR/LICENSE.txt"
cp "$REPO_ROOT/NOTICE" "$STAGE_DIR/NOTICE.txt"
cp "$ROOT_DIR/README.md" "$STAGE_DIR/README.md"
cp "$REPO_ROOT/THIRD_PARTY_LICENSES.md" "$STAGE_DIR/THIRD_PARTY_LICENSES.md"

hdiutil create -volname "$PRODUCT_NAME" -srcfolder "$STAGE_DIR" -format UDZO "$DMG_PATH"
codesign --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG_PATH"

echo "Submitting dmg for notarization with profile: $KEYCHAIN_PROFILE"
submit_notary "$DMG_PATH" "$KEYCHAIN_PROFILE"
xcrun stapler staple "$DMG_PATH"


codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
xcrun stapler validate "$APP_BUNDLE"
spctl --assess --type execute --verbose=4 "$APP_BUNDLE"
codesign --verify --verbose=2 "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"

echo "Built app: $APP_BUNDLE"
echo "Built dmg: $DMG_PATH"
