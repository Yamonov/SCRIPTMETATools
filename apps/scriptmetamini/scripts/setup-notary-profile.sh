#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${APPLE_KEYCHAIN_PROFILE:-scriptmetakitapp-notary}"
DEFAULT_APPLE_ID="${APPLE_ID:-}"
DEFAULT_TEAM_ID="${APPLE_TEAM_ID:-5NFE273M7M}"

read -r -p "Apple ID${DEFAULT_APPLE_ID:+ [${DEFAULT_APPLE_ID}]}: " INPUT_APPLE_ID
APPLE_ID_VALUE="${INPUT_APPLE_ID:-$DEFAULT_APPLE_ID}"
if [[ -z "$APPLE_ID_VALUE" ]]; then
  echo "Apple ID is required. Set APPLE_ID or enter it at the prompt." >&2
  exit 1
fi

read -r -p "Team ID [${DEFAULT_TEAM_ID}]: " INPUT_TEAM_ID
TEAM_ID_VALUE="${INPUT_TEAM_ID:-$DEFAULT_TEAM_ID}"

read -r -s -p "app-specific password: " APPLE_PASSWORD_VALUE
echo

xcrun notarytool store-credentials "$PROFILE_NAME" \
  --apple-id "$APPLE_ID_VALUE" \
  --team-id "$TEAM_ID_VALUE" \
  --password "$APPLE_PASSWORD_VALUE"

echo "Saved notary profile: $PROFILE_NAME"
