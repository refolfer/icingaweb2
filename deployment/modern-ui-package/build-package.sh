#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MANIFEST_FILE="${SCRIPT_DIR}/manifest.txt"
DIST_DIR="${REPO_ROOT}/dist"
BUILD_ROOT="${DIST_DIR}/_build-modern-ui-package"
PACKAGE_NAME="icingaweb2-modern-ui-package"
PACKAGE_DIR="${BUILD_ROOT}/${PACKAGE_NAME}"

require_file() {
  local path="$1"
  [[ -f "$path" ]] || {
    echo "ERROR: Required file not found: $path" >&2
    exit 1
  }
}

require_file "$MANIFEST_FILE"
require_file "${SCRIPT_DIR}/install.sh"
require_file "${SCRIPT_DIR}/README.md"
require_file "${SCRIPT_DIR}/removed-paths.txt"
require_file "${REPO_ROOT}/deployment/nginx/modern-ui-http.conf"
require_file "${REPO_ROOT}/deployment/nginx/modern-ui-server.conf"

bash "${REPO_ROOT}/bin/build-modernui-assets.sh"

rm -rf "$BUILD_ROOT"
mkdir -p "${PACKAGE_DIR}/payload" "$DIST_DIR"
mkdir -p "${PACKAGE_DIR}/examples/nginx"

cp -a "${SCRIPT_DIR}/install.sh" "${PACKAGE_DIR}/install.sh"
cp -a "${SCRIPT_DIR}/README.md" "${PACKAGE_DIR}/README.md"
cp -a "${MANIFEST_FILE}" "${PACKAGE_DIR}/manifest.txt"
cp -a "${SCRIPT_DIR}/removed-paths.txt" "${PACKAGE_DIR}/removed-paths.txt"
cp -a "${REPO_ROOT}/deployment/nginx/modern-ui-http.conf" "${PACKAGE_DIR}/examples/nginx/"
cp -a "${REPO_ROOT}/deployment/nginx/modern-ui-server.conf" "${PACKAGE_DIR}/examples/nginx/"

while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  rel="${entry%%|*}"
  src="${REPO_ROOT}/${rel}"
  dst="${PACKAGE_DIR}/payload/${rel}"
  [[ -f "$src" ]] || {
    echo "ERROR: Manifest file not found in repository: $rel" >&2
    exit 1
  }
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
done < <(grep -v '^[[:space:]]*$' "$MANIFEST_FILE")

chmod +x "${PACKAGE_DIR}/install.sh"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_PATH="${DIST_DIR}/${PACKAGE_NAME}-${STAMP}.tar.gz"

tar -czf "$ARCHIVE_PATH" -C "$BUILD_ROOT" "$PACKAGE_NAME"
(
  cd "$DIST_DIR"
  sha256sum "$(basename "$ARCHIVE_PATH")" > "$(basename "$ARCHIVE_PATH").sha256"
)

echo "Package created:"
echo "  ${ARCHIVE_PATH}"
echo "  ${ARCHIVE_PATH}.sha256"
