#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required for the Windows x64 target."
  echo "Install rustup and run: rustup target add x86_64-pc-windows-msvc"
  exit 1
fi

if ! command -v cargo-xwin >/dev/null 2>&1; then
  echo "cargo-xwin is required."
  echo "Install it with: cargo install --locked cargo-xwin"
  exit 1
fi

if ! command -v ditto >/dev/null 2>&1; then
  echo "ditto is required."
  exit 1
fi

export PATH="/opt/homebrew/opt/llvm/bin:$PATH"

if ! command -v llvm-rc >/dev/null 2>&1; then
  echo "LLVM is required."
  echo "Install it with: brew install llvm"
  exit 1
fi

PRODUCT_NAME="$(node -p "JSON.parse(require('fs').readFileSync('./src-tauri/tauri.conf.json', 'utf8')).productName")"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('./package.json', 'utf8')).version")"
TARGET_DIR="src-tauri/target/x86_64-pc-windows-msvc/release"
PORTABLE_ROOT="${TARGET_DIR}/bundle/portable"
PORTABLE_DIR="${PORTABLE_ROOT}/${PRODUCT_NAME}"
ZIP_DIR="${TARGET_DIR}/bundle/zip"
ZIP_PATH="${ZIP_DIR}/${PRODUCT_NAME}_${VERSION}_windows_x64.zip"

echo "This build creates a portable Windows x64 zip package."
echo "Windows code signing is not applied in this local build."

npm run tauri -- build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle

rm -rf "$PORTABLE_DIR"
mkdir -p "$PORTABLE_DIR" "$ZIP_DIR"
cp "${TARGET_DIR}/scriptmetakitmini.exe" "${PORTABLE_DIR}/scriptmetakitmini.exe"
cp "$REPO_ROOT/LICENSE" "$PORTABLE_DIR/LICENSE.txt"
cp "$REPO_ROOT/NOTICE" "$PORTABLE_DIR/NOTICE.txt"
cp "$REPO_ROOT/THIRD_PARTY_LICENSES.md" "$PORTABLE_DIR/THIRD_PARTY_LICENSES.md"
rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$PORTABLE_DIR" "$ZIP_PATH"

echo "Built portable app: ${PORTABLE_DIR}/scriptmetakitmini.exe"
echo "Built zip: $ZIP_PATH"
