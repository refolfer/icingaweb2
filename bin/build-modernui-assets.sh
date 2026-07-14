#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/assets/modernui/js"
OUTPUT="${REPO_ROOT}/public/js/icinga/ux-enhancements.js"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

awk 'FNR == 1 && NR != 1 { print "" } { print }' \
  "${SOURCE_DIR}/00-core-and-tactical.js" \
  "${SOURCE_DIR}/10-operator-workspace.js" \
  "${SOURCE_DIR}/20-incident-drawer.js" \
  "${SOURCE_DIR}/30-command-palette.js" \
  "${SOURCE_DIR}/40-quick-menu.js" > "$TMP"

if [[ ! -f "$OUTPUT" ]] || ! cmp -s "$TMP" "$OUTPUT"; then
  mv "$TMP" "$OUTPUT"
fi

chmod 0644 "$OUTPUT"
